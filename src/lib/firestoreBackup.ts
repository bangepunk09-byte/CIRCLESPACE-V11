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
  enableNetwork,
  disableNetwork,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  computePayloadSummary,
  hasMeaningfulWorkspaceData,
  mergeTwoSnapshotsNonDestructive,
} from './snapshotMerge';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);

export const SHARED_LIVE_BACKUP_ID = 'shared_workspace_live';
const QUOTA_PAUSE_KEY = `circle_firestore_quota_paused_until_${firebaseConfig.projectId || 'default'}`;
const LAST_UPLOADED_DIGEST_KEY = `circle_firestore_last_uploaded_digest_v1_${firebaseConfig.projectId || 'default'}`;
const LAST_HOURLY_KEY = `circle_firestore_last_hourly_key_v1_${firebaseConfig.projectId || 'default'}`;
try {
  localStorage.removeItem('circle_firestore_quota_paused_until');
} catch {}
const FIRESTORE_PRICING_URL = 'https://firebase.google.com/pricing#cloud-firestore';

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

export interface CloudSyncStatus {
  firebaseConnected: boolean;
  emailVerified: boolean;
  userEmail: string | null;
  isSharedTeamMember: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastSyncedSummary: Record<string, number> | null;
  lastError: string | null;
  lastErrorIsQuota: boolean;
  quotaUpgradeUrl: string | null;
}

const BOOTSTRAPPED_ADMIN_EMAILS = new Set([
  'bangepunk09@gmail.com',
  'be.creativestudio21@gmail.com',
  'saeful.rohman@asliri.id',
  'saeful@asliri.id',
]);

export function isBootstrappedAdminUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email &&
      BOOTSTRAPPED_ADMIN_EMAILS.has(user.email.toLowerCase())
  );
}

export function isTeamDomainUser(user: User | null): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  if (isBootstrappedAdminUser(user)) return true;
  return /^[a-zA-Z0-9._%+-]+@asliri\.id$/i.test(user.email.trim());
}

function isSharedDocId(backupId: string): boolean {
  return backupId === SHARED_LIVE_BACKUP_ID || /^hourly_\d{8}_\d{2}_shared$/.test(backupId);
}

function getNextUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    5,
    0,
    0
  );
}

function getQuotaPausedUntil(): number {
  try {
    const raw = localStorage.getItem(QUOTA_PAUSE_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export function isFirestoreQuotaPaused(): boolean {
  return Date.now() < getQuotaPausedUntil();
}

export function clearFirestoreQuotaPause(): void {
  try {
    localStorage.removeItem(QUOTA_PAUSE_KEY);
  } catch {}
}

function activateQuotaPause(): string {
  const until = getNextUtcMidnightMs();
  try {
    localStorage.setItem(QUOTA_PAUSE_KEY, String(until));
  } catch {}
  // Immediately abort Firestore SDK internal PersistentWriteStream exponential backoff queue
  void disableNetwork(firestoreDb).catch(() => {});
  return FIRESTORE_PRICING_URL;
}

const initialQuotaPaused = isFirestoreQuotaPaused();
if (initialQuotaPaused) {
  void disableNetwork(firestoreDb).catch(() => {});
}

let currentCloudStatus: CloudSyncStatus = {
  firebaseConnected: Boolean(firebaseAuth.currentUser),
  emailVerified: Boolean(firebaseAuth.currentUser?.emailVerified),
  userEmail: firebaseAuth.currentUser?.email || null,
  isSharedTeamMember: isTeamDomainUser(firebaseAuth.currentUser),
  syncing: false,
  lastSyncedAt: null,
  lastSyncedSummary: null,
  lastError: initialQuotaPaused
    ? 'Quota exceeded. Kuota tulis harian gratis Firestore tercapai (reset besok UTC). Data tetap aman tersimpan di server & IndexedDB lokal.'
    : null,
  lastErrorIsQuota: initialQuotaPaused,
  quotaUpgradeUrl: initialQuotaPaused ? FIRESTORE_PRICING_URL : null,
};

const cloudStatusListeners = new Set<(status: CloudSyncStatus) => void>();

function emitCloudSyncStatus() {
  const snapshot = { ...currentCloudStatus };
  cloudStatusListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {}
  });
}

function updateCloudSyncStatus(patch: Partial<CloudSyncStatus>) {
  currentCloudStatus = { ...currentCloudStatus, ...patch };
  emitCloudSyncStatus();
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return { ...currentCloudStatus };
}

export function subscribeCloudSyncStatus(cb: (status: CloudSyncStatus) => void) {
  cloudStatusListeners.add(cb);
  try {
    cb({ ...currentCloudStatus });
  } catch {}
  return () => {
    cloudStatusListeners.delete(cb);
  };
}

function formatReadableFirestoreError(error: unknown): {
  message: string;
  isQuota: boolean;
  upgradeUrl: string | null;
} {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();
  if (lower.includes('quota') || lower.includes('resource-exhausted')) {
    const upgradeUrl = activateQuotaPause();
    return {
      message:
        'Quota exceeded. Kuota tulis harian gratis Firestore tercapai (reset besok UTC). Data tetap aman tersimpan di server & IndexedDB lokal.',
      isQuota: true,
      upgradeUrl,
    };
  }
  if (lower.includes('missing or insufficient permissions') || lower.includes('permission-denied')) {
    return {
      message:
        'Izin Cloud Firestore ditolak — pastikan login dengan akun Google terverifikasi (@asliri.id / Admin).',
      isQuota: false,
      upgradeUrl: null,
    };
  }
  if (lower.includes('client is offline') || lower.includes('network')) {
    return {
      message: 'Jaringan sedang offline — perubahan disimpan lokal & akan tersinkron otomatis.',
      isQuota: false,
      upgradeUrl: null,
    };
  }
  return {
    message: 'Sinkronisasi Cloud Firestore tertunda — data tetap aman di cache browser.',
    isQuota: false,
    upgradeUrl: null,
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
  const formatted = formatReadableFirestoreError(error);
  updateCloudSyncStatus({
    syncing: false,
    lastError: formatted.message,
    lastErrorIsQuota: formatted.isQuota,
    quotaUpgradeUrl: formatted.upgradeUrl,
  });
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function guardedFirestoreWrite<T>(
  fn: () => Promise<T>,
  operationType: OperationType,
  path: string,
  timeoutMs = 6500
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Quota exceeded (resource-exhausted write backoff timeout).'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    return handleFirestoreError(error, operationType, path);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

onAuthStateChanged(firebaseAuth, (user) => {
  const paused = isFirestoreQuotaPaused();
  updateCloudSyncStatus({
    firebaseConnected: Boolean(user),
    emailVerified: Boolean(user?.emailVerified),
    userEmail: user?.email || null,
    isSharedTeamMember: isTeamDomainUser(user),
    ...(!user && !paused
      ? { lastError: null, lastErrorIsQuota: false, quotaUpgradeUrl: null }
      : {}),
  });
});

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

function trimOversizedInlineBlobs(val: unknown, depth = 0): unknown {
  if (depth > 8 || val === null || val === undefined) return val;
  if (typeof val === 'string') {
    if (val.length > 320000 && val.startsWith('data:')) {
      return '';
    }
    if (val.length > 400000) {
      return val.slice(0, 400000);
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => trimOversizedInlineBlobs(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = trimOversizedInlineBlobs(v, depth + 1);
    }
    return out;
  }
  return val;
}

function splitArrayIntoChunks(
  section: ChunkSection,
  key: string,
  items: unknown[],
  maxBytesPerChunk = 280000,
  maxItemsPerChunk = 55
): PreparedChunk[] {
  const cleanItems = Array.isArray(items)
    ? (sanitizeFirestoreValue(items) as unknown[])
    : [];
  if (cleanItems.length === 0) return [];

  const chunks: PreparedChunk[] = [];
  let bucket: unknown[] = [];
  let bucketBytes = 0;

  for (const rawItem of cleanItems) {
    let item = rawItem;
    let approxBytes = JSON.stringify(item).length;
    if (approxBytes > 300000) {
      item = trimOversizedInlineBlobs(item);
      approxBytes = JSON.stringify(item).length;
    }
    if (approxBytes > 680000) {
      continue;
    }
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
      revision: Number(backupPayload?.revision ?? data.revision ?? 0),
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
      deleted_user_ids: data.deleted_user_ids || [],
      deleted_user_emails: data.deleted_user_emails || [],
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
    ...splitArrayIntoChunks('extra', 'circle_notes', data.circle_notes || []),
    ...splitArrayIntoChunks('extra', 'marketplace_listings', data.marketplace_listings || []),
    ...splitArrayIntoChunks('extra', 'marketplace_orders', data.marketplace_orders || []),
    ...splitArrayIntoChunks('extra', 'marketplace_reviews', data.marketplace_reviews || []),
    ...splitArrayIntoChunks('extra', 'marketplace_vouchers', data.marketplace_vouchers || [])
  );

  const uploadsObj = backupPayload?.uploaded_files_base64 || {};
  const uploadEntries = Object.entries(uploadsObj);
  let uploadBucket: Record<string, string> = {};
  let uploadBytes = 0;
  let uploadIdx = 0;
  for (const [fname, b64] of uploadEntries) {
    if (typeof b64 !== 'string') continue;
    if (b64.length > 500000) continue;
    if (uploadBytes > 0 && uploadBytes + b64.length > 420000) {
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

function fastStringHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${h >>> 0}`;
}

function buildChunkHashMap(chunks: PreparedChunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of chunks) {
    map.set(c.chunkId, fastStringHash(JSON.stringify(c.payload)));
  }
  return map;
}

function computeChunksDigest(chunks: PreparedChunk[]): string {
  const parts = chunks.map((c) => {
    // Exclude volatile revision inside core_0 when comparing pure data state across accounts
    if (c.chunkId === 'core_0') {
      const { revision: _rev, ...rest } = c.payload || {};
      return `core_0:${fastStringHash(JSON.stringify(rest))}`;
    }
    return `${c.chunkId}:${fastStringHash(JSON.stringify(c.payload))}`;
  });
  return fastStringHash(parts.join('|'));
}

function getPersistedUploadedDigest(targetId: string): string {
  try {
    const raw = localStorage.getItem(LAST_UPLOADED_DIGEST_KEY);
    if (!raw) return '';
    const map = JSON.parse(raw);
    return typeof map?.[targetId] === 'string' ? map[targetId] : '';
  } catch {
    return '';
  }
}

function setPersistedUploadedDigest(targetId: string, digest: string): void {
  try {
    const raw = localStorage.getItem(LAST_UPLOADED_DIGEST_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const next = map && typeof map === 'object' ? { ...map, [targetId]: digest } : { [targetId]: digest };
    localStorage.setItem(LAST_UPLOADED_DIGEST_KEY, JSON.stringify(next));
  } catch {}
}

function getPersistedLastHourlyKey(): string {
  try {
    return localStorage.getItem(LAST_HOURLY_KEY) || '';
  } catch {
    return '';
  }
}

function setPersistedLastHourlyKey(key: string): void {
  try {
    localStorage.setItem(LAST_HOURLY_KEY, key);
  } catch {}
}

// Per-backupId map of chunkId -> payload hash so unchanged chunks NEVER consume daily write quota
const lastWrittenChunkHashes = new Map<string, Map<string, string>>();

function isIncomingPayloadEmptyRelativeToExisting(
  existingData: any,
  incomingSummary: Record<string, unknown>,
  backupPayload: any
): boolean {
  if (!existingData) return false;
  const existingTasksCount = Number(existingData?.summary?.tasks || 0);
  const existingMsgsCount = Number(existingData?.summary?.messages || 0);
  const existingPostsCount = Number(existingData?.summary?.posts || 0);
  const existingUsersCount = Number(existingData?.summary?.users || 0);
  const incomingTasksCount = Number((incomingSummary as any)?.tasks ?? backupPayload?.data?.tasks?.length ?? 0);
  const incomingMsgsCount = Number((incomingSummary as any)?.messages ?? backupPayload?.data?.messages?.length ?? 0);
  const incomingPostsCount = Number((incomingSummary as any)?.posts ?? backupPayload?.data?.posts?.length ?? 0);
  const incomingUsersCount = Number((incomingSummary as any)?.users ?? backupPayload?.data?.users?.length ?? 0);

  return (
    incomingTasksCount === 0 &&
    (existingTasksCount > 0 ||
      existingMsgsCount > Math.max(3, incomingMsgsCount) ||
      existingPostsCount > Math.max(1, incomingPostsCount) ||
      existingUsersCount > Math.max(2, incomingUsersCount))
  );
}

async function upsertBackupDocumentWithChunks(
  backupId: string,
  label: string,
  workspaceName: string,
  chunks: PreparedChunk[],
  summary: Record<string, unknown>,
  user: User,
  existingSnapData?: any
) {
  const headerRef = doc(firestoreDb, 'workspaceBackups', backupId);
  const exists = Boolean(existingSnapData);

  const nextHashes = new Map<string, string>();
  chunks.forEach((c) => nextHashes.set(c.chunkId, fastStringHash(JSON.stringify(c.payload))));

  let docHashes = lastWrittenChunkHashes.get(backupId);
  const nextChunkIds = new Set(chunks.map((c) => c.chunkId));
  let existingChunkDocs: any[] = [];
  let existingChunkMap = new Map<string, any>();

  // Only list existing chunks if we haven't indexed them locally yet OR header exists with different chunkCount
  const needChunkRead =
    exists && (!docHashes || docHashes.size !== Number(existingSnapData?.chunkCount || 0));

  if (needChunkRead || !docHashes) {
    try {
      const canListAllChunks =
        isBootstrappedAdminUser(user) || (isSharedDocId(backupId) && isTeamDomainUser(user));
      const existingChunksQuery = canListAllChunks
        ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
        : query(
            collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
            where('ownerUid', '==', user.uid)
          );
      const existingChunksSnap = await getDocs(existingChunksQuery);
      existingChunkDocs = existingChunksSnap.docs;
      existingChunkMap = new Map(existingChunkDocs.map((d) => [d.id, d.data()]));
      if (!docHashes) {
        docHashes = new Map<string, string>();
        existingChunkDocs.forEach((d) => {
          const data = d.data();
          if (data?.payload) {
            docHashes!.set(d.id, fastStringHash(JSON.stringify(data.payload)));
          }
        });
        lastWrittenChunkHashes.set(backupId, docHashes);
      }
    } catch {}
  }

  // Determine exact delta chunks to write vs delete
  const chunksToWrite = chunks.filter((c) => {
    const prevHash = docHashes?.get(c.chunkId);
    const nextHash = nextHashes.get(c.chunkId);
    return !prevHash || prevHash !== nextHash;
  });

  const staleDocs = existingChunkDocs.filter((d) => !nextChunkIds.has(d.id));
  const staleChunkIdsFromCache = Array.from(docHashes?.keys() || []).filter(
    (id) => !nextChunkIds.has(id)
  );

  // Skip all writes if document already exists and NOTHING changed in header summary or chunks
  const prevSummaryStr = JSON.stringify(existingSnapData?.summary || {});
  const nextSummaryStr = JSON.stringify(summary || {});
  if (
    exists &&
    chunksToWrite.length === 0 &&
    staleDocs.length === 0 &&
    staleChunkIdsFromCache.length === 0 &&
    prevSummaryStr === nextSummaryStr &&
    Number(existingSnapData?.chunkCount || 0) === chunks.length
  ) {
    return;
  }

  const headerPath = `workspaceBackups/${backupId}`;
  await guardedFirestoreWrite(
    async () => {
      if (!exists) {
        await setDoc(headerRef, {
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
    },
    exists ? OperationType.UPDATE : OperationType.CREATE,
    headerPath
  );

  for (let i = 0; i < chunksToWrite.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    const slice = chunksToWrite.slice(i, i + 200);
    for (const chunk of slice) {
      const chunkRef = doc(firestoreDb, 'workspaceBackups', backupId, 'chunks', chunk.chunkId);
      const alreadyExists = existingChunkMap.has(chunk.chunkId) || Boolean(docHashes?.has(chunk.chunkId));
      if (alreadyExists) {
        batch.update(chunkRef, {
          section: chunk.section,
          chunkIndex: chunk.chunkIndex,
          payload: chunk.payload,
          updatedAt: serverTimestamp(),
        });
      } else {
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
    }
    await guardedFirestoreWrite(
      () => batch.commit(),
      OperationType.WRITE,
      `workspaceBackups/${backupId}/chunks`
    );
  }

  // Delete obsolete chunks if any
  const refsToDelete =
    staleDocs.length > 0
      ? staleDocs.map((d) => d.ref)
      : staleChunkIdsFromCache.map((id) => doc(firestoreDb, 'workspaceBackups', backupId, 'chunks', id));

  for (let i = 0; i < refsToDelete.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    refsToDelete.slice(i, i + 200).forEach((ref) => batch.delete(ref));
    try {
      await guardedFirestoreWrite(
        () => batch.commit(),
        OperationType.DELETE,
        `workspaceBackups/${backupId}/chunks`
      );
    } catch {}
  }

  lastWrittenChunkHashes.set(backupId, nextHashes);
}

export async function saveBackupToFirestore(backupPayload: any, customLabel?: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error(
      'Silakan hubungkan akun Google (Firebase Auth) terlebih dahulu untuk menyimpan ke Cloud.'
    );
  }

  clearFirestoreQuotaPause();
  await enableNetwork(firestoreDb).catch(() => {});

  const backupId = `bk_${Date.now()}`;
  const chunks = buildChunksFromBackup(backupPayload);
  const rawSummary = backupPayload?.summary || computePayloadSummary(backupPayload);
  const summary = (sanitizeFirestoreValue(rawSummary) || {}) as Record<string, unknown>;
  const label = (customLabel || `Backup ${new Date().toLocaleString('id-ID')}`).slice(0, 120);
  const workspaceName = String(backupPayload?.workspace_name || 'CIRCLE Workspace').slice(0, 120);

  const backupDocPath = `workspaceBackups/${backupId}`;
  await guardedFirestoreWrite(
    () =>
      setDoc(doc(firestoreDb, 'workspaceBackups', backupId), {
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
      }),
    OperationType.CREATE,
    backupDocPath
  );

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
    await guardedFirestoreWrite(
      () => batch.commit(),
      OperationType.CREATE,
      `workspaceBackups/${backupId}/chunks`
    );
  }

  updateCloudSyncStatus({
    lastSyncedAt: new Date().toISOString(),
    lastSyncedSummary: summary as Record<string, number>,
    lastError: null,
    lastErrorIsQuota: false,
    quotaUpgradeUrl: null,
  });

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
  isSharedTeam?: boolean;
}

function mapBackupDocToRecord(id: string, data: any): CloudBackupRecord {
  const isLiveSync = id.startsWith('live_sync_') || id === SHARED_LIVE_BACKUP_ID;
  const ts = isLiveSync ? data.updatedAt || data.createdAt : data.createdAt || data.updatedAt;
  let createdAtIso = new Date().toISOString();
  if (ts instanceof Timestamp) {
    createdAtIso = ts.toDate().toISOString();
  } else if (ts && typeof ts.toDate === 'function') {
    createdAtIso = ts.toDate().toISOString();
  } else if (typeof ts === 'string') {
    createdAtIso = ts;
  }
  return {
    id,
    ownerUid: String(data.ownerUid || ''),
    ownerEmail: String(data.ownerEmail || ''),
    workspaceName: String(data.workspaceName || 'CIRCLE Workspace'),
    label: String(data.label || id),
    version: Number(data.version || 2),
    chunkCount: Number(data.chunkCount || 0),
    summary: (data.summary || {}) as Record<string, number>,
    createdAtIso,
    isLiveSync,
    isSharedTeam: isSharedDocId(id),
  };
}

export async function listFirestoreBackups(): Promise<CloudBackupRecord[]> {
  const user = firebaseAuth.currentUser;
  if (!user) return [];

  const path = 'workspaceBackups';
  try {
    const isAdmin = isBootstrappedAdminUser(user);
    const byId = new Map<string, CloudBackupRecord>();

    if (isAdmin) {
      const snap = await getDocs(query(collection(firestoreDb, 'workspaceBackups')));
      snap.docs.forEach((d) => byId.set(d.id, mapBackupDocToRecord(d.id, d.data() || {})));
    } else {
      const ownSnap = await getDocs(
        query(collection(firestoreDb, 'workspaceBackups'), where('ownerUid', '==', user.uid))
      );
      ownSnap.docs.forEach((d) => byId.set(d.id, mapBackupDocToRecord(d.id, d.data() || {})));

      if (isTeamDomainUser(user)) {
        try {
          const sharedSnap = await getDocFromServer(
            doc(firestoreDb, 'workspaceBackups', SHARED_LIVE_BACKUP_ID)
          );
          if (sharedSnap.exists()) {
            byId.set(
              sharedSnap.id,
              mapBackupDocToRecord(sharedSnap.id, sharedSnap.data() || {})
            );
          }
        } catch {}
      }
    }

    const rows = Array.from(byId.values());
    rows.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

let lastCheckedSharedToken = '';
let lastHourlySnapshotHourKey = getPersistedLastHourlyKey();

export async function saveLiveSyncToFirestore(
  backupPayload: any,
  options?: { manualForce?: boolean }
): Promise<{
  id: string;
  chunkCount: number;
  summary: Record<string, unknown>;
  mergedPayload?: any;
  pulledNewFromShared?: boolean;
} | null> {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) return null;

  if (options?.manualForce) {
    clearFirestoreQuotaPause();
    await enableNetwork(firestoreDb).catch(() => {});
  } else if (isFirestoreQuotaPaused()) {
    // Respect UTC-midnight quota circuit breaker on background syncs
    return null;
  }

  // Never initiate automatic cloud writes for empty seed state
  if (!options?.manualForce && !hasMeaningfulWorkspaceData(backupPayload)) {
    return null;
  }

  updateCloudSyncStatus({
    syncing: true,
    firebaseConnected: true,
    emailVerified: true,
    userEmail: user.email || null,
    isSharedTeamMember: isTeamDomainUser(user),
  });

  try {
    let payloadToSave = backupPayload;
    let pulledNewFromShared = false;
    let cloudSharedDigest = '';

    const teamEligible = isTeamDomainUser(user);
    const primaryTargetId = teamEligible ? SHARED_LIVE_BACKUP_ID : `live_sync_${user.uid}`;
    const primaryLabel = teamEligible
      ? '[Live Sync Tim] Data Workspace Bersama'
      : '[Auto Live Sync] Data Workspace Terkini';
    const workspaceName = String(payloadToSave?.workspace_name || 'CIRCLE Workspace').slice(0, 120);

    let existingHeaderData: any = null;
    try {
      const headerSnap = await getDocFromServer(
        doc(firestoreDb, 'workspaceBackups', primaryTargetId)
      );
      if (headerSnap.exists()) {
        existingHeaderData = headerSnap.data();

        if (teamEligible) {
          const updatedAtStr =
            existingHeaderData?.updatedAt?.toDate?.()?.toISOString?.() ||
            String(existingHeaderData?.updatedAt || '');
          const sharedTasks = Number(existingHeaderData?.summary?.tasks || 0);
          const sharedMsgs = Number(existingHeaderData?.summary?.messages || 0);
          const sharedPosts = Number(existingHeaderData?.summary?.posts || 0);
          const sharedUsers = Number(existingHeaderData?.summary?.users || 0);
          const localTasks = Number(payloadToSave?.data?.tasks?.length || 0);
          const localMsgs = Number(payloadToSave?.data?.messages?.length || 0);
          const localPosts = Number(payloadToSave?.data?.posts?.length || 0);
          const localUsers = Number(
            (payloadToSave?.data?.users || []).filter(
              (u: any) => !u?.is_bot && u?.role !== 'assistant'
            ).length
          );

          const sharedToken = `${updatedAtStr}|${sharedTasks}|${sharedMsgs}|${sharedPosts}|${sharedUsers}`;
          const sharedMightHaveMore =
            options?.manualForce ||
            sharedToken !== lastCheckedSharedToken ||
            sharedTasks > localTasks ||
            sharedMsgs > localMsgs ||
            sharedPosts > localPosts ||
            sharedUsers > localUsers;

          if (sharedMightHaveMore) {
            const cloudShared = await loadBackupFromFirestoreOptional(SHARED_LIVE_BACKUP_ID);
            if (cloudShared && hasMeaningfulWorkspaceData(cloudShared)) {
              const cloudChunks = buildChunksFromBackup(cloudShared);
              cloudSharedDigest = computeChunksDigest(cloudChunks);
              // Seed delta chunk hashes from live cloud doc so only changed chunks write
              lastWrittenChunkHashes.set(SHARED_LIVE_BACKUP_ID, buildChunkHashMap(cloudChunks));

              const localBeforeDigest = computeChunksDigest(buildChunksFromBackup(payloadToSave));
              const merged = mergeTwoSnapshotsNonDestructive(payloadToSave, cloudShared);
              const mergedDigest = computeChunksDigest(buildChunksFromBackup(merged));
              if (mergedDigest !== localBeforeDigest) {
                payloadToSave = merged;
                pulledNewFromShared = true;
              }
            }
            lastCheckedSharedToken = sharedToken;
          }
        }
      }
    } catch {}

    const summaryRaw = computePayloadSummary(payloadToSave);
    const summary = (sanitizeFirestoreValue(summaryRaw) || {}) as Record<string, unknown>;

    if (isIncomingPayloadEmptyRelativeToExisting(existingHeaderData, summary, payloadToSave)) {
      updateCloudSyncStatus({ syncing: false });
      return null;
    }

    const chunks = buildChunksFromBackup(payloadToSave);
    const currentDigest = computeChunksDigest(chunks);
    const persistedDigest = getPersistedUploadedDigest(primaryTargetId);

    // If cloud already matches merged state (e.g., we only pulled updates from teammate), do ZERO writes!
    const cloudAlreadyMatches = Boolean(cloudSharedDigest && cloudSharedDigest === currentDigest);
    // If we already uploaded this exact payload digest in a previous session/reload and nothing changed, do ZERO writes!
    const unchangedSinceLastUpload = Boolean(
      !options?.manualForce &&
        existingHeaderData &&
        persistedDigest &&
        persistedDigest === currentDigest
    );

    if (cloudAlreadyMatches || unchangedSinceLastUpload) {
      setPersistedUploadedDigest(primaryTargetId, currentDigest);
      updateCloudSyncStatus({
        syncing: false,
        lastSyncedAt: new Date().toISOString(),
        lastSyncedSummary: summaryRaw,
        lastError: null,
        lastErrorIsQuota: false,
        quotaUpgradeUrl: null,
      });
      return {
        id: primaryTargetId,
        chunkCount: chunks.length,
        summary,
        mergedPayload: pulledNewFromShared ? payloadToSave : undefined,
        pulledNewFromShared,
      };
    }

    // Save ONLY the primary target using chunk delta comparison
    await upsertBackupDocumentWithChunks(
      primaryTargetId,
      primaryLabel,
      workspaceName,
      chunks,
      summary,
      user,
      existingHeaderData
    );

    setPersistedUploadedDigest(primaryTargetId, currentDigest);
    if (teamEligible) {
      lastCheckedSharedToken = `${new Date().toISOString()}|${summaryRaw.tasks}|${summaryRaw.messages}|${summaryRaw.posts}|${summaryRaw.users}`;
    }

    // Create at most ONE hourly rolling snapshot per hour (shared for team, personal otherwise)
    if (summaryRaw.tasks > 0 || summaryRaw.messages > 3) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const hhmm = `${pad(now.getHours())}:00`;
      const ddmm = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
      const yyyymmdd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const hh = pad(now.getHours());
      const hourKey = `${yyyymmdd}_${hh}`;

      if (hourKey !== lastHourlySnapshotHourKey) {
        const hourId = teamEligible
          ? `hourly_${hourKey}_shared`
          : `hourly_${hourKey}_${user.uid.slice(0, 8)}`;
        const hourLabel = teamEligible
          ? `[Auto Per Jam Tim] ${ddmm} · ${hhmm}`
          : `[Auto Per Jam] ${ddmm} · ${hhmm}`;
        try {
          const hourSnap = await getDoc(doc(firestoreDb, 'workspaceBackups', hourId));
          lastHourlySnapshotHourKey = hourKey;
          setPersistedLastHourlyKey(hourKey);
          if (!hourSnap.exists()) {
            await upsertBackupDocumentWithChunks(
              hourId,
              hourLabel,
              workspaceName,
              chunks,
              summary,
              user,
              null
            );
          }
        } catch {}
      }
    }

    updateCloudSyncStatus({
      syncing: false,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedSummary: summaryRaw,
      lastError: null,
      lastErrorIsQuota: false,
      quotaUpgradeUrl: null,
    });

    return {
      id: primaryTargetId,
      chunkCount: chunks.length,
      summary,
      mergedPayload: pulledNewFromShared ? payloadToSave : undefined,
      pulledNewFromShared,
    };
  } catch (err) {
    updateCloudSyncStatus({ syncing: false });
    throw err;
  }
}

async function loadBackupFromFirestoreOptional(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) return null;

  const headerPath = `workspaceBackups/${backupId}`;
  let headerSnap;
  try {
    headerSnap = await getDocFromServer(doc(firestoreDb, 'workspaceBackups', backupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, headerPath);
  }

  // Non-existent doc is normal during bootstrap/discovery — do NOT throw or log Firestore Error
  if (!headerSnap || !headerSnap.exists()) {
    return null;
  }

  const headerData: any = headerSnap.data();
  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  let chunkDocs: any[] = [];
  try {
    const canListAll =
      isBootstrappedAdminUser(user) || (isSharedDocId(backupId) && isTeamDomainUser(user));
    const chunksQuery = canListAll
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
    circle_notes: [],
    deleted_user_ids: [],
    deleted_user_emails: [],
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
    revision: Number(headerData.revision ?? reconstructedData.revision ?? 0),
    workspace_name: headerData.workspaceName || 'CIRCLE Workspace',
    summary: headerData.summary || {},
    data: reconstructedData,
    uploaded_files_base64: uploadedFilesBase64,
  };
}

export async function loadLiveSyncFromFirestore() {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) return null;

  const liveId = `live_sync_${user.uid}`;
  const candidateIds: string[] = [];

  if (isTeamDomainUser(user)) {
    candidateIds.push(SHARED_LIVE_BACKUP_ID);
  }
  candidateIds.push(liveId);

  try {
    const rows = await listFirestoreBackups();
    if (Array.isArray(rows) && rows.length > 0) {
      rows.sort((a, b) => {
        const aTasks = Number(a.summary?.tasks || 0);
        const bTasks = Number(b.summary?.tasks || 0);
        if ((aTasks > 0) !== (bTasks > 0)) return bTasks > 0 ? 1 : -1;
        if (bTasks !== aTasks) return bTasks - aTasks;
        const aMsgs = Number(a.summary?.messages || 0);
        const bMsgs = Number(b.summary?.messages || 0);
        if (bMsgs !== aMsgs) return bMsgs - aMsgs;
        return b.createdAtIso.localeCompare(a.createdAtIso);
      });
      for (const row of rows.slice(0, 3)) {
        if (!candidateIds.includes(row.id)) {
          candidateIds.push(row.id);
        }
      }
    }
  } catch {}

  const loadedSnapshots: Array<{ id: string; payload: any; score: number }> = [];
  for (const id of candidateIds.slice(0, 4)) {
    try {
      const payload = await loadBackupFromFirestoreOptional(id);
      if (payload && hasMeaningfulWorkspaceData(payload)) {
        const s = computePayloadSummary(payload);
        const score = s.tasks * 100 + s.messages * 5 + s.posts * 3 + s.users * 2;
        loadedSnapshots.push({ id, payload, score });
      }
    } catch {}
  }

  if (loadedSnapshots.length === 0) return null;

  loadedSnapshots.sort((a, b) => b.score - a.score);
  let merged = loadedSnapshots[0].payload;
  for (let i = 1; i < loadedSnapshots.length; i++) {
    merged = mergeTwoSnapshotsNonDestructive(merged, loadedSnapshots[i].payload);
  }

  return {
    id: loadedSnapshots[0].id,
    payload: merged,
    updatedAtIso: new Date().toISOString(),
  };
}

export async function loadBackupFromFirestore(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google terlebih dahulu.');
  }
  const result = await loadBackupFromFirestoreOptional(backupId);
  if (!result) {
    throw new Error('Snapshot cloud tidak ditemukan.');
  }
  return result;
}

export async function deleteFirestoreBackup(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  try {
    const canListAll =
      isBootstrappedAdminUser(user) || (isSharedDocId(backupId) && isTeamDomainUser(user));
    const chunksQuery = canListAll
      ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
      : query(
          collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
          where('ownerUid', '==', user.uid)
        );
    const snap = await getDocs(chunksQuery);
    for (let i = 0; i < snap.docs.length; i += 200) {
      const batch = writeBatch(firestoreDb);
      snap.docs.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
      await guardedFirestoreWrite(() => batch.commit(), OperationType.DELETE, chunksPath);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('{')) throw error;
    handleFirestoreError(error, OperationType.DELETE, chunksPath);
  }

  await guardedFirestoreWrite(
    () => deleteDoc(doc(firestoreDb, 'workspaceBackups', backupId)),
    OperationType.DELETE,
    `workspaceBackups/${backupId}`
  );
}
