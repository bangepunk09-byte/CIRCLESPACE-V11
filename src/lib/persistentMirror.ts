import { firebaseAuth, loadLiveSyncFromFirestore, saveLiveSyncToFirestore } from './firestoreBackup';

const IDB_NAME = 'circle_persistent_mirror_v1';
const IDB_STORE = 'snapshots';
const MIRROR_KEY = 'latest_workspace_mirror';

export interface PersistentMirrorEnvelope {
  snapshot: any;
  snapshot_sig?: string;
  revision: number;
  last_mutated_at?: string;
  saved_at: string;
}

function openMirrorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveMirrorSnapshot(envelope: PersistentMirrorEnvelope): Promise<void> {
  if (!envelope?.snapshot) return;
  const db = await openMirrorDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(envelope, MIRROR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadMirrorSnapshot(): Promise<PersistentMirrorEnvelope | null> {
  const db = await openMirrorDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(MIRROR_KEY);
      req.onsuccess = () => resolve((req.result as PersistentMirrorEnvelope) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let inFlightHydrate: Promise<boolean> | null = null;
let lastSyncedRevision = -1;
let lastFirestoreSyncAt = 0;

function hasMeaningfulData(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const usersCount = Array.isArray(d.users)
    ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant').length
    : 0;
  const tasksCount = Array.isArray(d.tasks) ? d.tasks.length : 0;
  const msgsCount = Array.isArray(d.messages) ? d.messages.length : 0;
  const postsCount = Array.isArray(d.posts) ? d.posts.length : 0;
  return usersCount > 3 || tasksCount > 0 || msgsCount > 2 || postsCount > 1;
}

/**
 * Checks if the backend server just booted with an empty/fresh seed database
 * (e.g., after container restart/cold-start) and automatically hydrates it
 * from the newest persistent mirror (IndexedDB or Cloud Firestore).
 */
export async function attemptAutoHydrateServer(api: any): Promise<boolean> {
  if (inFlightHydrate) return inFlightHydrate;

  inFlightHydrate = (async () => {
    try {
      const { data: status } = await api.get('/workspace/persistence-status');
      if (!status?.booted_fresh_seed) {
        return false;
      }

      const idbEnv = await loadMirrorSnapshot();
      let cloudSync: { id: string; payload: any; updatedAtIso: string } | null = null;

      if (firebaseAuth.currentUser?.emailVerified) {
        try {
          cloudSync = await loadLiveSyncFromFirestore();
        } catch {}
      }

      const idbValid = Boolean(idbEnv?.snapshot && idbEnv?.snapshot_sig && hasMeaningfulData(idbEnv.snapshot));
      const cloudValid = Boolean(cloudSync?.payload && hasMeaningfulData(cloudSync.payload));

      if (!idbValid && !cloudValid) {
        return false;
      }

      // Prefer newest by timestamp, or signed IndexedDB mirror if cloud isn't newer
      let chosenPayload: any = null;
      let chosenSig: string | undefined;
      let chosenSource = 'indexeddb';

      if (cloudValid && idbValid) {
        const cloudTime = new Date(cloudSync!.updatedAtIso || cloudSync!.payload?.exported_at || 0).getTime();
        const idbTime = new Date(idbEnv!.last_mutated_at || idbEnv!.saved_at || idbEnv!.snapshot?.exported_at || 0).getTime();
        if (cloudTime > idbTime) {
          chosenPayload = cloudSync!.payload;
          chosenSource = 'firestore';
        } else {
          chosenPayload = idbEnv!.snapshot;
          chosenSig = idbEnv!.snapshot_sig;
          chosenSource = 'indexeddb';
        }
      } else if (idbValid) {
        chosenPayload = idbEnv!.snapshot;
        chosenSig = idbEnv!.snapshot_sig;
        chosenSource = 'indexeddb';
      } else if (cloudValid) {
        chosenPayload = cloudSync!.payload;
        chosenSource = 'firestore';
      }

      if (!chosenPayload) return false;

      const { data: res } = await api.post('/workspace/auto-hydrate', {
        snapshot: chosenPayload,
        snapshot_sig: chosenSig,
        source: chosenSource,
      });

      if (res?.restored) {
        lastSyncedRevision = Number(res.revision || 0);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inFlightHydrate = null;
    }
  })();

  return inFlightHydrate;
}

/**
 * Pulls a signed live snapshot from the backend and mirrors it to IndexedDB
 * (always) and Cloud Firestore (when verified Google/Firebase Auth is active).
 */
export async function syncWorkspaceMirror(api: any, force = false): Promise<void> {
  try {
    const { data: status } = await api.get('/workspace/persistence-status');
    const rev = Number(status?.revision || 0);
    if (!force && rev > 0 && rev === lastSyncedRevision) {
      // Still sync Firestore periodically if not synced recently
      const now = Date.now();
      if (!firebaseAuth.currentUser?.emailVerified || now - lastFirestoreSyncAt < 60000) {
        return;
      }
    }

    const { data } = await api.get('/workspace/persistent-snapshot');
    if (!data?.snapshot) return;

    const envelope: PersistentMirrorEnvelope = {
      snapshot: data.snapshot,
      snapshot_sig: data.snapshot_sig,
      revision: Number(data.revision || rev || 1),
      last_mutated_at: data.last_mutated_at,
      saved_at: new Date().toISOString(),
    };
    await saveMirrorSnapshot(envelope);
    lastSyncedRevision = envelope.revision;

    if (firebaseAuth.currentUser?.emailVerified) {
      const now = Date.now();
      if (force || now - lastFirestoreSyncAt >= 12000) {
        lastFirestoreSyncAt = now;
        saveLiveSyncToFirestore(data.snapshot).catch(() => {});
      }
    }
  } catch {
    // Silent background mirror failure should never disrupt UI
  }
}
