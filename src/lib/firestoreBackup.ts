import { initializeApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: {
      providerId: string | null;
      displayName?: string | null;
      email: string | null;
      photoUrl?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const BOOTSTRAPPED_ADMIN_EMAILS = new Set([
  'bangepunk09@gmail.com',
  'be.creativestudio21@gmail.com',
  'saeful.rohman@asliri.id',
]);

function isBootstrappedAdminUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email &&
      BOOTSTRAPPED_ADMIN_EMAILS.has(user.email.toLowerCase())
  );
}

async function testConnection() {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function subscribeFirebaseAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(firebaseAuth, callback);
}

function sanitizeFirestoreValue(val: unknown): unknown {
  if (val === undefined) return null;
  if (val === null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val === 'string' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeFirestoreValue(item));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitizeFirestoreValue(v);
    }
    return out;
  }
  return String(val);
}

type ChunkSection =
  | 'core'
  | 'users'
  | 'tasks'
  | 'conversations'
  | 'messages'
  | 'posts'
  | 'extra'
  | 'uploads';

interface PreparedChunk {
  chunkId: string;
  section: ChunkSection;
  chunkIndex: number;
  payload: Record<string, unknown>;
}

function splitArrayIntoChunks(
  section: ChunkSection,
  key: string,
  items: unknown[],
  maxBytesPerChunk = 450000,
  maxItemsPerChunk = 80
): PreparedChunk[] {
  const cleanItems = Array.isArray(items)
    ? (sanitizeFirestoreValue(items) as unknown[])
    : [];
  if (cleanItems.length === 0) return [];

  const chunks: PreparedChunk[] = [];
  let bucket: unknown[] = [];
  let bucketBytes = 0;

  for (const item of cleanItems) {
    const approxBytes = JSON.stringify(item).length;
    if (
      bucket.length > 0 &&
      (bucket.length >= maxItemsPerChunk || bucketBytes + approxBytes > maxBytesPerChunk)
    ) {
      const idx = chunks.length;
      chunks.push({
        chunkId: `${section}_${key}_${idx}`,
        section,
        chunkIndex: idx,
        payload: { key, records: bucket },
      });
      bucket = [];
      bucketBytes = 0;
    }
    bucket.push(item);
    bucketBytes += approxBytes;
  }

  if (bucket.length > 0) {
    const idx = chunks.length;
    chunks.push({
      chunkId: `${section}_${key}_${idx}`,
      section,
      chunkIndex: idx,
      payload: { key, records: bucket },
    });
  }

  return chunks;
}

function buildChunksFromBackup(backupPayload: any): PreparedChunk[] {
  const data = backupPayload?.data || {};
  const chunks: PreparedChunk[] = [];

  chunks.push({
    chunkId: 'core_0',
    section: 'core',
    chunkIndex: 0,
    payload: sanitizeFirestoreValue({
      workspace: data.workspace || {},
      labels: data.labels || [],
      boards: data.boards || [],
      org_units: data.org_units || [],
      drive_shortcuts: data.drive_shortcuts || [],
      prefs: data.prefs || {},
      sticker_packs: data.sticker_packs || [],
      stickers: data.stickers || [],
      files: data.files || {},
      marketplace_carts: data.marketplace_carts || {},
      marketplace_wishlists: data.marketplace_wishlists || {},
    }) as Record<string, unknown>,
  });

  chunks.push(...splitArrayIntoChunks('users', 'users', data.users || []));
  chunks.push(...splitArrayIntoChunks('users', 'access_requests', data.access_requests || []));
  chunks.push(...splitArrayIntoChunks('users', 'invitations', data.invitations || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'tasks', data.tasks || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'projects', data.projects || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'reminders', data.reminders || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'task_automations', data.task_automations || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'conversations', data.conversations || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'groups', data.groups || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'polls', data.polls || []));
  chunks.push(...splitArrayIntoChunks('messages', 'messages', data.messages || []));
  chunks.push(...splitArrayIntoChunks('posts', 'posts', data.posts || []));
  chunks.push(
    ...splitArrayIntoChunks('extra', 'notifications', data.notifications || []),
    ...splitArrayIntoChunks('extra', 'activity', data.activity || []),
    ...splitArrayIntoChunks('extra', 'audit_logs', data.audit_logs || []),
    ...splitArrayIntoChunks('extra', 'meetings', data.meetings || []),
    ...splitArrayIntoChunks('extra', 'marketplace_listings', data.marketplace_listings || []),
    ...splitArrayIntoChunks('extra', 'marketplace_orders', data.marketplace_orders || []),
    ...splitArrayIntoChunks('extra', 'marketplace_reviews', data.marketplace_reviews || []),
    ...splitArrayIntoChunks('extra', 'marketplace_vouchers', data.marketplace_vouchers || [])
  );

  // Split uploaded base64 files safely (< 450 KB per chunk)
  const uploadsObj = backupPayload?.uploaded_files_base64 || {};
  const uploadEntries = Object.entries(uploadsObj);
  let uploadBucket: Record<string, string> = {};
  let uploadBytes = 0;
  let uploadIdx = 0;
  for (const [fname, b64] of uploadEntries) {
    if (typeof b64 !== 'string') continue;
    if (b64.length > 500000) continue; // skip single file >500KB in Firestore snapshot to protect 1MB doc limit
    if (uploadBytes > 0 && uploadBytes + b64.length > 450000) {
      chunks.push({
        chunkId: `uploads_${uploadIdx}`,
        section: 'uploads',
        chunkIndex: uploadIdx,
        payload: { uploaded_files_base64: uploadBucket },
      });
      uploadIdx += 1;
      uploadBucket = {};
      uploadBytes = 0;
    }
    uploadBucket[fname] = b64;
    uploadBytes += b64.length;
  }
  if (Object.keys(uploadBucket).length > 0) {
    chunks.push({
      chunkId: `uploads_${uploadIdx}`,
      section: 'uploads',
      chunkIndex: uploadIdx,
      payload: { uploaded_files_base64: uploadBucket },
    });
  }

  return chunks;
}

export async function saveBackupToFirestore(backupPayload: any, customLabel?: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google (Firebase Auth) terlebih dahulu untuk menyimpan ke Cloud.');
  }

  const backupId = `bk_${Date.now()}`;
  const chunks = buildChunksFromBackup(backupPayload);
  const summary = (sanitizeFirestoreValue(backupPayload?.summary || {}) || {}) as Record<string, unknown>;
  const label = (customLabel || `Backup ${new Date().toLocaleString('id-ID')}`).slice(0, 120);
  const workspaceName = String(backupPayload?.workspace_name || 'CIRCLE Workspace').slice(0, 120);

  const backupDocPath = `workspaceBackups/${backupId}`;
  try {
    await setDoc(doc(firestoreDb, 'workspaceBackups', backupId), {
      id: backupId,
      ownerUid: user.uid,
      ownerEmail: (user.email || 'admin@asliri.id').slice(0, 200),
      workspaceName,
      label,
      version: 2,
      chunkCount: chunks.length,
      summary,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, backupDocPath);
  }

  // Write chunks in batches of 200
  for (let i = 0; i < chunks.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    const slice = chunks.slice(i, i + 200);
    for (const chunk of slice) {
      const chunkRef = doc(firestoreDb, 'workspaceBackups', backupId, 'chunks', chunk.chunkId);
      batch.set(chunkRef, {
        backupId,
        ownerUid: user.uid,
        section: chunk.section,
        chunkIndex: chunk.chunkIndex,
        payload: chunk.payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `workspaceBackups/${backupId}/chunks`);
    }
  }

  return { id: backupId, label, chunkCount: chunks.length, summary };
}

export interface CloudBackupRecord {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  workspaceName: string;
  label: string;
  version: number;
  chunkCount: number;
  summary: Record<string, number>;
  createdAtIso: string;
  isLiveSync?: boolean;
}

export async function listFirestoreBackups(): Promise<CloudBackupRecord[]> {
  const user = firebaseAuth.currentUser;
  if (!user) return [];

  const path = 'workspaceBackups';
  try {
    const isBootstrappedAdmin = isBootstrappedAdminUser(user);
    const q = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups'))
      : query(collection(firestoreDb, 'workspaceBackups'), where('ownerUid', '==', user.uid));

    const snap = await getDocs(q);
    const rows: CloudBackupRecord[] = snap.docs.map((d) => {
      const data = d.data() || {};
      const ts = data.createdAt;
      let createdAtIso = new Date().toISOString();
      if (ts instanceof Timestamp) {
        createdAtIso = ts.toDate().toISOString();
      } else if (ts && typeof ts.toDate === 'function') {
        createdAtIso = ts.toDate().toISOString();
      } else if (typeof ts === 'string') {
        createdAtIso = ts;
      }
      return {
        id: d.id,
        ownerUid: String(data.ownerUid || ''),
        ownerEmail: String(data.ownerEmail || ''),
        workspaceName: String(data.workspaceName || 'CIRCLE Workspace'),
        label: String(data.label || d.id),
        version: Number(data.version || 2),
        chunkCount: Number(data.chunkCount || 0),
        summary: (data.summary || {}) as Record<string, number>,
        createdAtIso,
        isLiveSync: d.id.startsWith('live_sync_'),
      };
    });
    rows.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveLiveSyncToFirestore(backupPayload: any) {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) return null;

  const liveId = `live_sync_${user.uid}`;
  const chunks = buildChunksFromBackup(backupPayload);
  const summary = (sanitizeFirestoreValue(backupPayload?.summary || {}) || {}) as Record<string, unknown>;
  const label = '[Auto Live Sync] Data Workspace Terkini';
  const workspaceName = String(backupPayload?.workspace_name || 'CIRCLE Workspace').slice(0, 120);
  const headerRef = doc(firestoreDb, 'workspaceBackups', liveId);

  let exists = false;
  try {
    const existingSnap = await getDoc(headerRef);
    exists = existingSnap.exists();
  } catch {}

  try {
    if (!exists) {
      await setDoc(headerRef, {
        id: liveId,
        ownerUid: user.uid,
        ownerEmail: (user.email || 'admin@asliri.id').slice(0, 200),
        workspaceName,
        label,
        version: 2,
        chunkCount: chunks.length,
        summary,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        headerRef,
        {
          workspaceName,
          label,
          version: 2,
          chunkCount: chunks.length,
          summary,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, `workspaceBackups/${liveId}`);
  }

  const nextChunkIds = new Set(chunks.map((c) => c.chunkId));
  let existingChunkDocs: any[] = [];
  try {
    const existingChunksSnap = await getDocs(
      query(collection(firestoreDb, 'workspaceBackups', liveId, 'chunks'), where('ownerUid', '==', user.uid))
    );
    existingChunkDocs = existingChunksSnap.docs;
  } catch {}
  const existingChunkMap = new Map(existingChunkDocs.map((d) => [d.id, d.data()]));

  for (let i = 0; i < chunks.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    const slice = chunks.slice(i, i + 200);
    for (const chunk of slice) {
      const chunkRef = doc(firestoreDb, 'workspaceBackups', liveId, 'chunks', chunk.chunkId);
      if (existingChunkMap.has(chunk.chunkId)) {
        batch.update(chunkRef, {
          section: chunk.section,
          chunkIndex: chunk.chunkIndex,
          payload: chunk.payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(chunkRef, {
          backupId: liveId,
          ownerUid: user.uid,
          section: chunk.section,
          chunkIndex: chunk.chunkIndex,
          payload: chunk.payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `workspaceBackups/${liveId}/chunks`);
    }
  }

  // Remove any obsolete chunks when snapshot shrinks
  const staleDocs = existingChunkDocs.filter((d) => !nextChunkIds.has(d.id));
  for (let i = 0; i < staleDocs.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    staleDocs.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
    try {
      await batch.commit();
    } catch {}
  }

  return { id: liveId, chunkCount: chunks.length, summary };
}

export async function loadLiveSyncFromFirestore() {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) return null;

  const liveId = `live_sync_${user.uid}`;
  try {
    const snap = await getDocFromServer(doc(firestoreDb, 'workspaceBackups', liveId));
    if (snap.exists()) {
      const payload = await loadBackupFromFirestore(liveId);
      const data = snap.data() || {};
      const ts = data.updatedAt || data.createdAt;
      let updatedAtIso = new Date().toISOString();
      if (ts instanceof Timestamp) updatedAtIso = ts.toDate().toISOString();
      else if (ts && typeof ts.toDate === 'function') updatedAtIso = ts.toDate().toISOString();
      return { id: liveId, payload, updatedAtIso };
    }
  } catch {
    // Fallback to newest manual backup owned by this user or admin
  }

  try {
    const rows = await listFirestoreBackups();
    if (rows && rows.length > 0) {
      const newest = rows[0];
      const payload = await loadBackupFromFirestore(newest.id);
      return { id: newest.id, payload, updatedAtIso: newest.createdAtIso };
    }
  } catch {}
  return null;
}

export async function loadBackupFromFirestore(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google terlebih dahulu.');
  }

  let headerData: any = null;
  const headerPath = `workspaceBackups/${backupId}`;
  try {
    const headerSnap = await getDoc(doc(firestoreDb, 'workspaceBackups', backupId));
    if (!headerSnap.exists()) {
      throw new Error('Snapshot cloud tidak ditemukan.');
    }
    headerData = headerSnap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, headerPath);
  }

  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  let chunkDocs: any[] = [];
  try {
    const isBootstrappedAdmin = isBootstrappedAdminUser(user);
    const chunksQuery = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
      : query(
          collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
          where('ownerUid', '==', headerData.ownerUid || user.uid)
        );
    const snap = await getDocs(chunksQuery);
    chunkDocs = snap.docs
      .map((d): Record<string, any> => ({ id: d.id, ...(d.data() as Record<string, any>) }))
      .sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, chunksPath);
  }

  const reconstructedData: Record<string, any> = {
    workspace: {},
    users: [],
    labels: [],
    notifications: [],
    tasks: [],
    projects: [],
    boards: [],
    conversations: [],
    groups: [],
    messages: [],
    posts: [],
    org_units: [],
    activity: [],
    reminders: [],
    polls: [],
    task_automations: [],
    audit_logs: [],
    invitations: [],
    drive_shortcuts: [],
    prefs: {},
    access_requests: [],
    sticker_packs: [],
    stickers: [],
    files: {},
    meetings: [],
    marketplace_listings: [],
    marketplace_orders: [],
    marketplace_reviews: [],
    marketplace_vouchers: [],
    marketplace_carts: {},
    marketplace_wishlists: {},
  };
  const uploadedFilesBase64: Record<string, string> = {};

  for (const ch of chunkDocs) {
    const payload = ch.payload || {};
    if (ch.section === 'core') {
      Object.assign(reconstructedData, payload);
    } else if (ch.section === 'uploads' && payload.uploaded_files_base64) {
      Object.assign(uploadedFilesBase64, payload.uploaded_files_base64);
    } else if (payload.key && Array.isArray(payload.records)) {
      if (!Array.isArray(reconstructedData[payload.key])) {
        reconstructedData[payload.key] = [];
      }
      reconstructedData[payload.key].push(...payload.records);
    }
  }

  return {
    app: 'CIRCLE Workspace',
    version: headerData.version || 2,
    workspace_name: headerData.workspaceName || 'CIRCLE Workspace',
    summary: headerData.summary || {},
    data: reconstructedData,
    uploaded_files_base64: uploadedFilesBase64,
  };
}

export async function deleteFirestoreBackup(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  try {
    const isBootstrappedAdmin = isBootstrappedAdminUser(user);
    const chunksQuery = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
      : query(
          collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
          where('ownerUid', '==', user.uid)
        );
    const snap = await getDocs(chunksQuery);
    for (let i = 0; i < snap.docs.length; i += 200) {
      const batch = writeBatch(firestoreDb);
      snap.docs.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, chunksPath);
  }

  try {
    await deleteDoc(doc(firestoreDb, 'workspaceBackups', backupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaceBackups/${backupId}`);
  }
}
