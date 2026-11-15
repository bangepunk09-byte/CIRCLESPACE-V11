import { firebaseAuth, loadLiveSyncFromFirestore, saveLiveSyncToFirestore } from './firestoreBackup';

const IDB_NAME = 'circle_persistent_mirror_v1';
const IDB_STORE = 'snapshots';
const MIRROR_KEY = 'latest_workspace_mirror';
const VAULT_STORAGE_KEY = 'circle_account_vault_v1';

const DEFAULT_SEED_USER_IDS = new Set([
  'user_admin1',
  'user_superadmin_saeful',
  'user_circle_assistant',
]);

export interface PersistentMirrorEnvelope {
  snapshot: any;
  snapshot_sig?: string;
  revision: number;
  last_mutated_at?: string;
  saved_at: string;
}

export interface VaultAccountRecord {
  user_id: string;
  email: string;
  name: string;
  role?: string;
  job_title?: string;
  department?: string;
  org_unit_id?: string | null;
  status?: string;
  avatar?: string;
  picture?: string;
  password_hash?: string;
  password_updated_at?: string;
  token_version?: number;
  updated_at?: string;
}

export function getKnownAccountsFromVault(): VaultAccountRecord[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u) => u && u.email && u.user_id) : [];
  } catch {
    return [];
  }
}

export function upsertAccountInVault(account: any): void {
  if (!account || typeof account !== 'object' || !account.email || !account.user_id) return;
  if (account.is_bot || account.role === 'assistant' || account.user_id === 'user_circle_assistant') return;
  try {
    const cleanEmail = String(account.email).toLowerCase().trim();
    const list = getKnownAccountsFromVault();
    const idx = list.findIndex(
      (u) => u.user_id === account.user_id || String(u.email || '').toLowerCase().trim() === cleanEmail
    );
    const prev: Partial<VaultAccountRecord> = idx >= 0 ? list[idx] : {};
    const merged: VaultAccountRecord = {
      user_id: account.user_id || prev.user_id!,
      email: cleanEmail,
      name: account.name || prev.name || cleanEmail.split('@')[0],
      role: account.role || prev.role || 'employee',
      job_title: account.job_title || prev.job_title || 'Staff Member',
      department: account.department || prev.department || 'Marketing',
      org_unit_id: account.org_unit_id !== undefined ? account.org_unit_id : (prev.org_unit_id ?? null),
      // Prefer 'active' status once an account has been active unless explicitly set to inactive/rejected
      status:
        account.status === 'active' || (prev.status === 'active' && account.status === 'pending')
          ? 'active'
          : account.status || prev.status || 'active',
      avatar: account.avatar || account.picture || prev.avatar || '',
      picture: account.picture || account.avatar || prev.picture || '',
      password_hash: account.password_hash || prev.password_hash || undefined,
      password_updated_at: account.password_updated_at || prev.password_updated_at || undefined,
      token_version: Number(account.token_version || prev.token_version || 1),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) {
      list[idx] = merged;
    } else {
      list.push(merged);
    }
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export function upsertAccountsListInVault(accounts: any[]): void {
  if (!Array.isArray(accounts)) return;
  for (const acc of accounts) {
    upsertAccountInVault(acc);
  }
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
  try {
    const snapUsers = envelope.snapshot?.data?.users || envelope.snapshot?.users;
    if (Array.isArray(snapUsers)) {
      upsertAccountsListInVault(snapUsers);
    }
  } catch {}
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
      req.onsuccess = () => {
        const env = (req.result as PersistentMirrorEnvelope) || null;
        try {
          const snapUsers = env?.snapshot?.data?.users || env?.snapshot?.users;
          if (Array.isArray(snapUsers)) {
            upsertAccountsListInVault(snapUsers);
          }
        } catch {}
        resolve(env);
      };
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
  const humanUsers = Array.isArray(d.users)
    ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant')
    : [];
  const hasCustomUser = humanUsers.some((u: any) => u?.user_id && !DEFAULT_SEED_USER_IDS.has(u.user_id));
  const usersCount = humanUsers.length;
  const tasksCount = Array.isArray(d.tasks) ? d.tasks.length : 0;
  const msgsCount = Array.isArray(d.messages) ? d.messages.length : 0;
  const postsCount = Array.isArray(d.posts) ? d.posts.length : 0;
  const ordersCount = Array.isArray(d.marketplace_orders) ? d.marketplace_orders.length : 0;
  const listingsCount = Array.isArray(d.marketplace_listings) ? d.marketplace_listings.length : 0;
  const accessReqCount = Array.isArray(d.access_requests) ? d.access_requests.length : 0;
  return (
    hasCustomUser ||
    usersCount > 2 ||
    tasksCount > 0 ||
    msgsCount > 0 ||
    postsCount > 1 ||
    ordersCount > 0 ||
    listingsCount > 4 ||
    accessReqCount > 0
  );
}

/**
 * Checks if the backend server just booted with an empty/fresh seed database
 * OR is missing accounts/data stored in the client mirror/vault, and hydrates it.
 */
export async function attemptAutoHydrateServer(api: any): Promise<boolean> {
  if (inFlightHydrate) return inFlightHydrate;

  inFlightHydrate = (async () => {
    try {
      const { data: status } = await api.get('/workspace/persistence-status');
      const idbEnv = await loadMirrorSnapshot();
      let cloudSync: { id: string; payload: any; updatedAtIso: string } | null = null;

      if (firebaseAuth.currentUser?.emailVerified) {
        try {
          cloudSync = await loadLiveSyncFromFirestore();
        } catch {}
      }

      const vaultAccounts = getKnownAccountsFromVault();
      const serverEmails = new Set(
        Array.isArray(status?.user_emails)
          ? status.user_emails.map((e: string) => String(e || '').toLowerCase().trim())
          : []
      );
      const hasMissingVaultAccount = vaultAccounts.some(
        (acc) => acc.email && !serverEmails.has(String(acc.email).toLowerCase().trim())
      );

      const idbValid = Boolean(idbEnv?.snapshot && hasMeaningfulData(idbEnv.snapshot));
      const cloudValid = Boolean(cloudSync?.payload && hasMeaningfulData(cloudSync.payload));

      // Check if local snapshot has users that server does not have
      let hasMissingSnapshotUser = false;
      const snapUsers = idbEnv?.snapshot?.data?.users || idbEnv?.snapshot?.users;
      if (Array.isArray(snapUsers) && serverEmails.size > 0) {
        hasMissingSnapshotUser = snapUsers.some(
          (u: any) =>
            u &&
            !u.is_bot &&
            u.role !== 'assistant' &&
            u.email &&
            !serverEmails.has(String(u.email).toLowerCase().trim())
        );
      }

      const needsFullHydrate = Boolean(status?.booted_fresh_seed) || hasMissingSnapshotUser;

      if (!needsFullHydrate && !hasMissingVaultAccount) {
        return false;
      }

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
      } else if (vaultAccounts.length > 0) {
        chosenPayload = { data: { users: vaultAccounts } };
        chosenSource = 'vault';
      }

      if (!chosenPayload && vaultAccounts.length === 0) return false;

      const { data: res } = await api.post('/workspace/auto-hydrate', {
        snapshot: chosenPayload || { data: { users: vaultAccounts } },
        snapshot_sig: chosenSig,
        known_accounts: vaultAccounts,
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
