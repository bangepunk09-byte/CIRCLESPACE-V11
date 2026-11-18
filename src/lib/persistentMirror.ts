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
  phone?: string;
  employee_id?: string;
  employment_status?: string;
  join_date?: string;
  bio?: string;
  skills?: string[];
  work_mode?: string;
  custom_location?: string;
  city?: string;
  office?: string;
  location_status?: string;
  share_location?: boolean;
  timezone?: string;
  team?: string;
  division?: string;
  manager_id?: string | null;
  cover_bg?: string;
  cover_image?: string;
  cover_position?: string;
  is_verified?: boolean;
  verified_at?: string | null;
  profile_completion?: number;
  onboarded?: boolean;
  custom?: Record<string, any>;
  custom_fields?: Record<string, any>;
  nickname?: string;
  company?: string;
  password_hash?: string;
  password_updated_at?: string;
  token_version?: number;
  updated_at?: string;
}

const VAULT_PROFILE_KEYS = [
  'phone',
  'employee_id',
  'employment_status',
  'join_date',
  'bio',
  'skills',
  'work_mode',
  'custom_location',
  'city',
  'office',
  'location_status',
  'share_location',
  'timezone',
  'team',
  'division',
  'manager_id',
  'cover_bg',
  'cover_image',
  'cover_position',
  'is_verified',
  'verified_at',
  'profile_completion',
  'onboarded',
  'custom',
  'custom_fields',
  'nickname',
  'company',
] as const;

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

export function pruneDeletedAccountsFromVault(deletedIds: string[] = [], deletedEmails: string[] = []): void {
  try {
    const idSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((x) => String(x || "").trim()).filter(Boolean));
    const emailSet = new Set((Array.isArray(deletedEmails) ? deletedEmails : []).map((x) => String(x || "").toLowerCase().trim()).filter(Boolean));
    if (idSet.size === 0 && emailSet.size === 0) return;
    const list = getKnownAccountsFromVault();
    const filtered = list.filter((u) => {
      const uid = String(u?.user_id || "").trim();
      const email = String(u?.email || "").toLowerCase().trim();
      return !idSet.has(uid) && !emailSet.has(email);
    });
    if (filtered.length !== list.length) {
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {}
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
      ...prev,
      user_id: account.user_id || prev.user_id!,
      email: cleanEmail,
      name: account.name || prev.name || cleanEmail.split('@')[0],
      role: account.role || prev.role || 'employee',
      job_title: account.job_title !== undefined ? account.job_title : (prev.job_title || 'Staff Member'),
      department: account.department !== undefined ? account.department : (prev.department || 'Marketing'),
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
      updated_at: account.updated_at || new Date().toISOString(),
    };
    for (const k of VAULT_PROFILE_KEYS) {
      if (account[k] !== undefined) {
        (merged as any)[k] = account[k];
      }
    }
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

const RICHEST_MIRROR_KEY = 'richest_workspace_mirror';

function getItemId(item: any, altKey?: string): string {
  if (!item || typeof item !== 'object') return '';
  const raw = item.id ?? (altKey ? item[altKey] : undefined) ?? item.task_id ?? item.board_id ?? item.post_id ?? item.note_id ?? item.user_id;
  return raw ? String(raw).trim() : '';
}

function mergeItemsById(existingList: any[], incomingList: any[], altKey?: string): any[] {
  const out = Array.isArray(existingList) ? [...existingList] : [];
  const idxMap = new Map<string, number>();
  out.forEach((it, idx) => {
    const id = getItemId(it, altKey);
    if (id) idxMap.set(id, idx);
  });
  for (const inc of Array.isArray(incomingList) ? incomingList : []) {
    const id = getItemId(inc, altKey);
    if (!id) continue;
    const normalized = !inc.id && altKey !== 'user_id' ? { ...inc, id } : inc;
    const existingIdx = idxMap.get(id);
    if (existingIdx === undefined) {
      idxMap.set(id, out.length);
      out.push(normalized);
    } else {
      const cur = out[existingIdx];
      const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
      const incTime = new Date(normalized?.updated_at || normalized?.created_at || 0).getTime();
      if (incTime > curTime) {
        out[existingIdx] = { ...cur, ...normalized };
      }
    }
  }
  return out;
}

interface LocalCacheHarvest {
  users: any[];
  tasks: any[];
  boards: any[];
  templates: any[];
  messages: any[];
  conversations: any[];
  groups: any[];
  meetings: any[];
  projects: any[];
  notes: any[];
  posts: any[];
  org_units: any[];
  divisions: string[];
  drive_shortcuts: any[];
}

function harvestAllLocalStorageCaches(): LocalCacheHarvest {
  const harvest: LocalCacheHarvest = {
    users: [],
    tasks: [],
    boards: [],
    templates: [],
    messages: [],
    conversations: [],
    groups: [],
    meetings: [],
    projects: [],
    notes: [],
    posts: [],
    org_units: [],
    divisions: [],
    drive_shortcuts: [],
  };

  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return harvest;
  }

  const readJsonArray = (key: string): any[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // 1. Users from vault, users cache, and admin users cache
  harvest.users = mergeItemsById(
    mergeItemsById(getKnownAccountsFromVault(), readJsonArray('circle_users_cache'), 'user_id'),
    readJsonArray('circle_admin_users'),
    'user_id'
  );

  // 2. Tasks from circle_tasks_cache and circle_cache_tasks
  harvest.tasks = mergeItemsById(
    readJsonArray('circle_tasks_cache'),
    readJsonArray('circle_cache_tasks'),
    'task_id'
  );

  // 3. Boards & Custom Checkpoint Templates
  harvest.boards = readJsonArray('circle_boards_cache').filter((b) => b && b.id !== 'brd_1');
  harvest.templates = readJsonArray('circle_checkpoint_templates');

  // 4. Meetings, Projects, Org Units, Divisions, Drive Shortcuts
  harvest.meetings = mergeItemsById(
    readJsonArray('circle_meetings_cache'),
    readJsonArray('circle_cache_meetings')
  );
  harvest.projects = readJsonArray('circle_projects_cache');
  harvest.org_units = readJsonArray('circle_org_units_cache');
  harvest.divisions = readJsonArray('circle_admin_divisions').filter((d) => typeof d === 'string' && d.trim());
  harvest.drive_shortcuts = readJsonArray('circle_drive_shortcuts_cache');

  // 5. Posts
  for (const pk of ['circle_cache_posts_feed', 'circle_cache_posts']) {
    try {
      const raw = localStorage.getItem(pk);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.posts) ? parsed.posts : [];
      if (list.length > 0) {
        harvest.posts = mergeItemsById(harvest.posts, list, 'post_id');
      }
    } catch {}
  }

  // 6. Scan dynamic prefix keys in localStorage (messages, convs, groups, sticky notes, user feed history)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('circle_msgs_cache_')) {
        const msgs = readJsonArray(key);
        if (msgs.length > 0) {
          harvest.messages = mergeItemsById(harvest.messages, msgs);
          // Extract any full task objects embedded inside shared approval_card messages!
          const extractedTasks: any[] = [];
          for (const m of msgs) {
            if (m && m.task && typeof m.task === 'object' && (m.task.id || m.task.task_id) && m.task.title) {
              const tCopy = { ...m.task, id: String(m.task.id || m.task.task_id) };
              if (m.approvals && typeof m.approvals === 'object') {
                tCopy.approvals = m.approvals;
                tCopy.approval = m.approvals;
              }
              extractedTasks.push(tCopy);
            }
          }
          if (extractedTasks.length > 0) {
            harvest.tasks = mergeItemsById(harvest.tasks, extractedTasks, 'task_id');
          }
        }
      } else if (key === 'circle_convs_cache' || key.startsWith('circle_convs_cache_')) {
        const convs = readJsonArray(key);
        if (convs.length > 0) {
          harvest.conversations = mergeItemsById(harvest.conversations, convs);
        }
      } else if (key === 'circle_groups_cache' || key.startsWith('circle_groups_cache_')) {
        const grps = readJsonArray(key);
        if (grps.length > 0) {
          harvest.groups = mergeItemsById(harvest.groups, grps);
        }
      } else if (key.startsWith('circle_sticky_notes_') || key.startsWith('circle_notes_cache_')) {
        const notes = readJsonArray(key);
        if (notes.length > 0) {
          harvest.notes = mergeItemsById(harvest.notes, notes, 'note_id');
        }
      } else if (key.startsWith('circle_user_feed_history_')) {
        const posts = readJsonArray(key);
        if (posts.length > 0) {
          harvest.posts = mergeItemsById(harvest.posts, posts, 'post_id');
        }
      }
    }
  } catch {}

  return harvest;
}

// Capture boot-time localStorage caches synchronously at module import time BEFORE any API calls run
const BOOT_HARVEST: LocalCacheHarvest = harvestAllLocalStorageCaches();

function mergeHarvestIntoSnapshotPayload(basePayload: any, harvest: LocalCacheHarvest): any {
  const clone = basePayload
    ? JSON.parse(JSON.stringify(basePayload))
    : { app: 'CIRCLE Workspace', version: 2, data: {} };
  const root = clone.data && typeof clone.data === 'object' ? clone.data : clone;

  if (harvest.users.length > 0) {
    root.users = mergeItemsById(root.users || [], harvest.users, 'user_id');
  }
  if (harvest.tasks.length > 0) {
    root.tasks = mergeItemsById(root.tasks || [], harvest.tasks, 'task_id');
  }
  if (harvest.boards.length > 0) {
    root.boards = mergeItemsById(root.boards || [], harvest.boards, 'board_id');
  }
  if (harvest.messages.length > 0) {
    root.messages = mergeItemsById(root.messages || [], harvest.messages);
  }
  if (harvest.conversations.length > 0) {
    root.conversations = mergeItemsById(root.conversations || [], harvest.conversations);
  }
  if (harvest.groups.length > 0) {
    root.groups = mergeItemsById(root.groups || [], harvest.groups);
  }
  if (harvest.meetings.length > 0) {
    root.meetings = mergeItemsById(root.meetings || [], harvest.meetings);
  }
  if (harvest.projects.length > 0) {
    root.projects = mergeItemsById(root.projects || [], harvest.projects);
  }
  if (harvest.notes.length > 0) {
    root.circle_notes = mergeItemsById(root.circle_notes || [], harvest.notes, 'note_id');
  }
  if (harvest.posts.length > 0) {
    root.posts = mergeItemsById(root.posts || [], harvest.posts, 'post_id');
  }
  if (harvest.org_units.length > 0) {
    root.org_units = mergeItemsById(root.org_units || [], harvest.org_units);
  }
  if (harvest.drive_shortcuts.length > 0) {
    root.drive_shortcuts = mergeItemsById(root.drive_shortcuts || [], harvest.drive_shortcuts);
  }
  if (harvest.templates.length > 0 || harvest.divisions.length > 0) {
    root.workspace = root.workspace && typeof root.workspace === 'object' ? root.workspace : {};
    if (harvest.templates.length > 0) {
      root.workspace.checkpoint_templates = mergeItemsById(
        root.workspace.checkpoint_templates || [],
        harvest.templates
      );
    }
    if (harvest.divisions.length > 0) {
      const existingDivs = Array.isArray(root.workspace.divisions) ? root.workspace.divisions : [];
      root.workspace.divisions = Array.from(new Set([...existingDivs, ...harvest.divisions]));
    }
  }
  return clone;
}

function mergeTwoSnapshotsNonDestructive(primarySnap: any, secondarySnap: any): any {
  if (!primarySnap) return secondarySnap;
  if (!secondarySnap) return primarySnap;
  const clone = JSON.parse(JSON.stringify(primarySnap));
  const pRoot = clone.data && typeof clone.data === 'object' ? clone.data : clone;
  const sRoot = secondarySnap.data && typeof secondarySnap.data === 'object' ? secondarySnap.data : secondarySnap;

  pRoot.users = mergeItemsById(pRoot.users || [], sRoot.users || [], 'user_id');
  pRoot.tasks = mergeItemsById(pRoot.tasks || [], sRoot.tasks || [], 'task_id');
  pRoot.boards = mergeItemsById(pRoot.boards || [], sRoot.boards || [], 'board_id');
  pRoot.messages = mergeItemsById(pRoot.messages || [], sRoot.messages || []);
  pRoot.conversations = mergeItemsById(pRoot.conversations || [], sRoot.conversations || []);
  pRoot.groups = mergeItemsById(pRoot.groups || [], sRoot.groups || []);
  pRoot.posts = mergeItemsById(pRoot.posts || [], sRoot.posts || [], 'post_id');
  pRoot.circle_notes = mergeItemsById(pRoot.circle_notes || [], sRoot.circle_notes || [], 'note_id');
  pRoot.meetings = mergeItemsById(pRoot.meetings || [], sRoot.meetings || []);
  pRoot.projects = mergeItemsById(pRoot.projects || [], sRoot.projects || []);
  pRoot.org_units = mergeItemsById(pRoot.org_units || [], sRoot.org_units || []);
  pRoot.drive_shortcuts = mergeItemsById(pRoot.drive_shortcuts || [], sRoot.drive_shortcuts || []);
  if (sRoot.workspace?.checkpoint_templates) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    pRoot.workspace.checkpoint_templates = mergeItemsById(
      pRoot.workspace.checkpoint_templates || [],
      sRoot.workspace.checkpoint_templates
    );
  }
  return clone;
}

export async function saveMirrorSnapshot(envelope: PersistentMirrorEnvelope): Promise<void> {
  if (!envelope?.snapshot) return;
  try {
    const snapUsers = envelope.snapshot?.data?.users || envelope.snapshot?.users;
    const delIds = envelope.snapshot?.data?.deleted_user_ids || [];
    const delEmails = envelope.snapshot?.data?.deleted_user_emails || [];
    pruneDeletedAccountsFromVault(delIds, delEmails);
    if (Array.isArray(snapUsers)) {
      upsertAccountsListInVault(snapUsers);
    }
  } catch {}
  const db = await openMirrorDb();
  if (!db) return;

  // Read existing mirrors so we NEVER overwrite a richer IndexedDB snapshot with an empty seed snapshot
  const existingPair = await new Promise<{ latest: PersistentMirrorEnvelope | null; richest: PersistentMirrorEnvelope | null }>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const reqLatest = store.get(MIRROR_KEY);
      const reqRichest = store.get(RICHEST_MIRROR_KEY);
      let latest: PersistentMirrorEnvelope | null = null;
      let richest: PersistentMirrorEnvelope | null = null;
      reqLatest.onsuccess = () => {
        latest = (reqLatest.result as PersistentMirrorEnvelope) || null;
      };
      reqRichest.onsuccess = () => {
        richest = (reqRichest.result as PersistentMirrorEnvelope) || null;
      };
      tx.oncomplete = () => resolve({ latest, richest });
      tx.onerror = () => resolve({ latest: null, richest: null });
    } catch {
      resolve({ latest: null, richest: null });
    }
  });

  let mergedSnapshot = envelope.snapshot;
  if (existingPair.latest?.snapshot) {
    mergedSnapshot = mergeTwoSnapshotsNonDestructive(mergedSnapshot, existingPair.latest.snapshot);
  }
  if (existingPair.richest?.snapshot) {
    mergedSnapshot = mergeTwoSnapshotsNonDestructive(mergedSnapshot, existingPair.richest.snapshot);
  }

  const finalEnvelope: PersistentMirrorEnvelope = {
    ...envelope,
    snapshot: mergedSnapshot,
  };

  const mergedData = mergedSnapshot?.data || mergedSnapshot || {};
  const mergedTasksCount = Array.isArray(mergedData.tasks) ? mergedData.tasks.length : 0;
  const richestData = existingPair.richest?.snapshot?.data || existingPair.richest?.snapshot || {};
  const richestTasksCount = Array.isArray(richestData.tasks) ? richestData.tasks.length : 0;
  const shouldUpdateRichest = !existingPair.richest || mergedTasksCount >= richestTasksCount;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(finalEnvelope, MIRROR_KEY);
      if (shouldUpdateRichest && hasMeaningfulData(mergedSnapshot)) {
        store.put(finalEnvelope, RICHEST_MIRROR_KEY);
      }
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
      const store = tx.objectStore(IDB_STORE);
      const reqLatest = store.get(MIRROR_KEY);
      const reqRichest = store.get(RICHEST_MIRROR_KEY);
      let latest: PersistentMirrorEnvelope | null = null;
      let richest: PersistentMirrorEnvelope | null = null;
      reqLatest.onsuccess = () => {
        latest = (reqLatest.result as PersistentMirrorEnvelope) || null;
      };
      reqRichest.onsuccess = () => {
        richest = (reqRichest.result as PersistentMirrorEnvelope) || null;
      };
      tx.oncomplete = () => {
        let env = latest || richest || null;
        if (latest?.snapshot && richest?.snapshot) {
          env = {
            ...latest,
            snapshot: mergeTwoSnapshotsNonDestructive(latest.snapshot, richest.snapshot),
            revision: Math.max(Number(latest.revision || 0), Number(richest.revision || 0)),
          };
        }
        try {
          const snapUsers = env?.snapshot?.data?.users || env?.snapshot?.users;
          const delIds = env?.snapshot?.data?.deleted_user_ids || [];
          const delEmails = env?.snapshot?.data?.deleted_user_emails || [];
          pruneDeletedAccountsFromVault(delIds, delEmails);
          if (Array.isArray(snapUsers)) {
            upsertAccountsListInVault(snapUsers);
          }
        } catch {}
        resolve(env);
      };
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let inFlightHydrate: Promise<boolean> | null = null;
let lastSyncedRevision = -1;
let lastFirestoreSyncAt = 0;
let initialHydrateCompleted = false;

export function hasCompletedInitialHydrate(): boolean {
  return initialHydrateCompleted;
}

export async function rehydrateIfServerRestarted(api: any): Promise<boolean> {
  try {
    const { data: status } = await api.get('/workspace/persistence-status');
    const serverTasksCount = Number(status?.counts?.tasks || 0);
    if (Boolean(status?.booted_fresh_seed) || serverTasksCount === 0) {
      const idbEnv = await loadMirrorSnapshot();
      const idbData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
      const liveHarvest = harvestAllLocalStorageCaches();
      const hasLocalData =
        (Array.isArray(idbData.tasks) && idbData.tasks.length > 0) ||
        BOOT_HARVEST.tasks.length > 0 ||
        liveHarvest.tasks.length > 0 ||
        (Array.isArray(idbData.messages) && idbData.messages.length > 3) ||
        liveHarvest.messages.length > 3 ||
        Boolean(firebaseAuth.currentUser?.emailVerified);
      if (hasLocalData) {
        initialHydrateCompleted = false;
        return await attemptAutoHydrateServer(api);
      }
    }
  } catch {}
  return false;
}

export async function inspectLocalMirrorSources() {
  const idbEnv = await loadMirrorSnapshot();
  const idbData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
  const liveHarvest = harvestAllLocalStorageCaches();
  const combinedTasks = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.tasks, liveHarvest.tasks, 'task_id'),
    Array.isArray(idbData.tasks) ? idbData.tasks : [],
    'task_id'
  );
  const combinedMessages = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.messages, liveHarvest.messages),
    Array.isArray(idbData.messages) ? idbData.messages : []
  );
  const combinedBoards = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.boards, liveHarvest.boards, 'board_id'),
    Array.isArray(idbData.boards) ? idbData.boards : [],
    'board_id'
  );
  const combinedUsers = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.users, liveHarvest.users, 'user_id'),
    Array.isArray(idbData.users) ? idbData.users : [],
    'user_id'
  ).filter((u: any) => u && !u.is_bot && u.role !== 'assistant');
  const combinedNotes = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.notes, liveHarvest.notes, 'note_id'),
    Array.isArray(idbData.circle_notes) ? idbData.circle_notes : [],
    'note_id'
  );
  const combinedPosts = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.posts, liveHarvest.posts, 'post_id'),
    Array.isArray(idbData.posts) ? idbData.posts : [],
    'post_id'
  );
  const combinedTemplates = mergeItemsById(
    mergeItemsById(BOOT_HARVEST.templates, liveHarvest.templates),
    Array.isArray(idbData.workspace?.checkpoint_templates) ? idbData.workspace.checkpoint_templates : []
  );

  return {
    indexedDbRevision: Number(idbEnv?.revision || 0),
    indexedDbSavedAt: idbEnv?.saved_at || null,
    counts: {
      tasks: combinedTasks.length,
      messages: combinedMessages.length,
      boards: combinedBoards.length,
      users: combinedUsers.length,
      notes: combinedNotes.length,
      posts: combinedPosts.length,
      templates: combinedTemplates.length,
    },
  };
}

export async function forceHydrateFromLocalSources(api: any): Promise<{ restored: boolean; summary?: any }> {
  initialHydrateCompleted = false;
  lastSyncedRevision = -1;
  const restored = await attemptAutoHydrateServer(api);
  try {
    const { data: status } = await api.get('/workspace/persistence-status');
    return { restored, summary: status?.counts };
  } catch {
    return { restored };
  }
}

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
  const notesCount = Array.isArray(d.circle_notes) ? d.circle_notes.length : 0;
  const ordersCount = Array.isArray(d.marketplace_orders) ? d.marketplace_orders.length : 0;
  const listingsCount = Array.isArray(d.marketplace_listings) ? d.marketplace_listings.length : 0;
  const accessReqCount = Array.isArray(d.access_requests) ? d.access_requests.length : 0;
  const templatesCount = Array.isArray(d.workspace?.checkpoint_templates)
    ? d.workspace.checkpoint_templates.length
    : 0;
  return (
    hasCustomUser ||
    usersCount > 2 ||
    tasksCount > 0 ||
    msgsCount > 0 ||
    postsCount > 1 ||
    notesCount > 0 ||
    ordersCount > 0 ||
    listingsCount > 4 ||
    accessReqCount > 0 ||
    templatesCount > 0
  );
}

/**
 * Checks if the backend server just booted with an empty/fresh seed database
 * OR is missing accounts/data stored in the client mirror/vault/caches, and hydrates it.
 */
export async function attemptAutoHydrateServer(api: any): Promise<boolean> {
  if (inFlightHydrate) return inFlightHydrate;

  inFlightHydrate = (async () => {
    try {
      const { data: status } = await api.get('/workspace/persistence-status');
      const deletedIdsList = Array.isArray(status?.deleted_user_ids) ? status.deleted_user_ids : [];
      const deletedEmailsList = Array.isArray(status?.deleted_user_emails) ? status.deleted_user_emails : [];
      pruneDeletedAccountsFromVault(deletedIdsList, deletedEmailsList);

      const idbEnv = await loadMirrorSnapshot();
      let cloudSync: { id: string; payload: any; updatedAtIso: string } | null = null;

      const serverEmails = new Set(
        Array.isArray(status?.user_emails)
          ? status.user_emails.map((e: string) => String(e || '').toLowerCase().trim())
          : []
      );
      const serverTaskIds = new Set(
        Array.isArray(status?.task_ids) ? status.task_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverBoardIds = new Set(
        Array.isArray(status?.board_ids) ? status.board_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverPostIds = new Set(
        Array.isArray(status?.post_ids) ? status.post_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverNoteIds = new Set(
        Array.isArray(status?.note_ids) ? status.note_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverMessageIds = new Set(
        Array.isArray(status?.message_ids) ? status.message_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverMeetingIds = new Set(
        Array.isArray(status?.meeting_ids) ? status.meeting_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverProjectIds = new Set(
        Array.isArray(status?.project_ids) ? status.project_ids.map((id: string) => String(id || '').trim()) : []
      );
      const serverTemplateIds = new Set(
        Array.isArray(status?.template_ids) ? status.template_ids.map((id: string) => String(id || '').trim()) : []
      );

      const deletedIds = new Set(deletedIdsList.map((id: string) => String(id || '').trim()));
      const deletedEmails = new Set(deletedEmailsList.map((e: string) => String(e || '').toLowerCase().trim()));

      // Combine boot-time harvest with current live localStorage harvest so nothing is missed
      const liveHarvest = harvestAllLocalStorageCaches();
      const combinedHarvest: LocalCacheHarvest = {
        users: mergeItemsById(BOOT_HARVEST.users, liveHarvest.users, 'user_id').filter(
          (u) =>
            u &&
            u.email &&
            !u.is_bot &&
            u.role !== 'assistant' &&
            !deletedIds.has(String(u.user_id || '').trim()) &&
            !deletedEmails.has(String(u.email).toLowerCase().trim())
        ),
        tasks: mergeItemsById(BOOT_HARVEST.tasks, liveHarvest.tasks, 'task_id'),
        boards: mergeItemsById(BOOT_HARVEST.boards, liveHarvest.boards, 'board_id'),
        templates: mergeItemsById(BOOT_HARVEST.templates, liveHarvest.templates),
        messages: mergeItemsById(BOOT_HARVEST.messages, liveHarvest.messages),
        conversations: mergeItemsById(BOOT_HARVEST.conversations, liveHarvest.conversations),
        groups: mergeItemsById(BOOT_HARVEST.groups, liveHarvest.groups),
        meetings: mergeItemsById(BOOT_HARVEST.meetings, liveHarvest.meetings),
        projects: mergeItemsById(BOOT_HARVEST.projects, liveHarvest.projects),
        notes: mergeItemsById(BOOT_HARVEST.notes, liveHarvest.notes, 'note_id'),
        posts: mergeItemsById(BOOT_HARVEST.posts, liveHarvest.posts, 'post_id'),
        org_units: mergeItemsById(BOOT_HARVEST.org_units, liveHarvest.org_units),
        divisions: Array.from(new Set([...BOOT_HARVEST.divisions, ...liveHarvest.divisions])),
        drive_shortcuts: mergeItemsById(BOOT_HARVEST.drive_shortcuts, liveHarvest.drive_shortcuts),
      };

      const activeVaultAccounts = getKnownAccountsFromVault().filter(
        (acc) =>
          acc.email &&
          !deletedIds.has(String(acc.user_id || '').trim()) &&
          !deletedEmails.has(String(acc.email).toLowerCase().trim())
      );

      const hasMissingVaultAccount =
        activeVaultAccounts.some((acc) => acc.email && !serverEmails.has(String(acc.email).toLowerCase().trim())) ||
        combinedHarvest.users.some((u) => u.email && !serverEmails.has(String(u.email).toLowerCase().trim()));

      const snapData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
      const snapUsers = Array.isArray(snapData.users) ? snapData.users : [];
      const snapTasks = Array.isArray(snapData.tasks) ? snapData.tasks : [];
      const snapBoards = Array.isArray(snapData.boards) ? snapData.boards : [];
      const snapPosts = Array.isArray(snapData.posts) ? snapData.posts : [];
      const snapNotes = Array.isArray(snapData.circle_notes) ? snapData.circle_notes : [];
      const snapMessages = Array.isArray(snapData.messages) ? snapData.messages : [];
      const snapMeetings = Array.isArray(snapData.meetings) ? snapData.meetings : [];
      const snapProjects = Array.isArray(snapData.projects) ? snapData.projects : [];
      const snapTemplates = Array.isArray(snapData.workspace?.checkpoint_templates)
        ? snapData.workspace.checkpoint_templates
        : [];

      const hasMissingSnapshotUser =
        snapUsers.length > 0 &&
        snapUsers.some(
          (u: any) =>
            u &&
            !u.is_bot &&
            u.role !== 'assistant' &&
            u.email &&
            !deletedEmails.has(String(u.email).toLowerCase().trim()) &&
            !serverEmails.has(String(u.email).toLowerCase().trim())
        );

      const hasMissingSnapshotData =
        snapTasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        combinedHarvest.tasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        snapBoards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        combinedHarvest.boards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        snapPosts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        combinedHarvest.posts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        snapNotes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        combinedHarvest.notes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        snapMessages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        }) ||
        combinedHarvest.messages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        }) ||
        snapMeetings.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMeetingIds.has(id);
        }) ||
        combinedHarvest.meetings.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMeetingIds.has(id);
        }) ||
        snapProjects.some((p: any) => {
          const id = getItemId(p);
          return id && !serverProjectIds.has(id);
        }) ||
        combinedHarvest.projects.some((p: any) => {
          const id = getItemId(p);
          return id && !serverProjectIds.has(id);
        }) ||
        snapTemplates.some((t: any) => {
          const id = getItemId(t);
          return id && !serverTemplateIds.has(id);
        }) ||
        combinedHarvest.templates.some((t: any) => {
          const id = getItemId(t);
          return id && !serverTemplateIds.has(id);
        });

      const serverRev = Number(status?.revision || 0);
      const idbRev = Number(idbEnv?.revision ?? idbEnv?.snapshot?.revision ?? idbEnv?.snapshot?.data?.revision ?? 0);

      // Download Firestore live backup if server has 0 tasks, booted fresh seed, client has missing data, or on initial boot
      if (
        (Boolean(status?.booted_fresh_seed) ||
          serverTaskIds.size === 0 ||
          hasMissingVaultAccount ||
          hasMissingSnapshotUser ||
          hasMissingSnapshotData ||
          !initialHydrateCompleted) &&
        firebaseAuth.currentUser?.emailVerified
      ) {
        try {
          cloudSync = await loadLiveSyncFromFirestore();
        } catch {}
      }

      const cloudData = cloudSync?.payload?.data || cloudSync?.payload || {};
      const cloudTasks = Array.isArray(cloudData.tasks) ? cloudData.tasks : [];
      const cloudBoards = Array.isArray(cloudData.boards) ? cloudData.boards : [];
      const cloudPosts = Array.isArray(cloudData.posts) ? cloudData.posts : [];
      const cloudNotes = Array.isArray(cloudData.circle_notes) ? cloudData.circle_notes : [];
      const cloudMessages = Array.isArray(cloudData.messages) ? cloudData.messages : [];
      const hasMissingCloudData =
        cloudTasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        cloudBoards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        cloudPosts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        cloudNotes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        cloudMessages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        });

      const idbValid = Boolean(idbEnv?.snapshot && hasMeaningfulData(idbEnv.snapshot));
      const cloudValid = Boolean(cloudSync?.payload && hasMeaningfulData(cloudSync.payload));
      const cloudRev = Number(cloudSync?.payload?.revision ?? cloudSync?.payload?.data?.revision ?? 0);
      const bestMirrorRev = Math.max(idbRev, cloudRev);
      const needsFullHydrate =
        Boolean(status?.booted_fresh_seed) ||
        bestMirrorRev > serverRev ||
        hasMissingSnapshotUser ||
        hasMissingSnapshotData ||
        hasMissingCloudData;

      if (!needsFullHydrate && !hasMissingVaultAccount) {
        initialHydrateCompleted = true;
        return false;
      }

      let chosenPayload: any = null;
      let chosenSig: string | undefined;
      let chosenSource = 'indexeddb';
      let chosenRev = Math.max(idbRev, cloudRev);

      if (cloudValid && idbValid) {
        // Combine both cloud and IndexedDB non-destructively so neither loses data
        const cloudTasksLen = cloudTasks.length;
        const idbTasksLen = snapTasks.length;
        if (cloudTasksLen > idbTasksLen || cloudRev > idbRev) {
          chosenPayload = mergeTwoSnapshotsNonDestructive(cloudSync!.payload, idbEnv!.snapshot);
          chosenSource = 'firestore+indexeddb';
        } else {
          chosenPayload = mergeTwoSnapshotsNonDestructive(idbEnv!.snapshot, cloudSync!.payload);
          chosenSig = idbEnv!.snapshot_sig;
          chosenSource = 'indexeddb+firestore';
        }
      } else if (idbValid) {
        chosenPayload = idbEnv!.snapshot;
        chosenSig = idbEnv!.snapshot_sig;
        chosenSource = 'indexeddb';
      } else if (cloudValid) {
        chosenPayload = cloudSync!.payload;
        chosenSource = 'firestore';
      } else {
        chosenPayload = {
          app: 'CIRCLE Workspace',
          version: 2,
          data: {
            users: activeVaultAccounts,
          },
        };
        chosenSource = 'local_caches';
        chosenRev = 0;
      }

      // Enrich chosenPayload with ALL harvested localStorage caches (tasks, messages, embedded approval tasks, boards, templates, meetings, projects, notes, posts, users)
      const enrichedPayload = mergeHarvestIntoSnapshotPayload(chosenPayload, combinedHarvest);

      if (!hasMeaningfulData(enrichedPayload) && activeVaultAccounts.length === 0) {
        initialHydrateCompleted = true;
        return false;
      }

      const { data: res } = await api.post('/workspace/auto-hydrate', {
        snapshot: enrichedPayload,
        snapshot_sig: chosenSig,
        revision: chosenRev,
        known_accounts: mergeItemsById(activeVaultAccounts, combinedHarvest.users, 'user_id'),
        source: chosenSource,
      });

      initialHydrateCompleted = true;
      if (res?.restored) {
        lastSyncedRevision = Number(res.revision || 0);
        syncWorkspaceMirror(api, true).catch(() => {});
        return true;
      }
      return false;
    } catch {
      initialHydrateCompleted = true;
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
    // Always ensure auto-hydration check has completed first before pulling from server
    if (!initialHydrateCompleted) {
      await attemptAutoHydrateServer(api).catch(() => false);
    }

    const { data: status } = await api.get('/workspace/persistence-status');
    const rev = Number(status?.revision || 0);

    // Check if local mirror or local caches have tasks/users that are still missing on the server
    const serverTaskIds = new Set(
      Array.isArray(status?.task_ids) ? status.task_ids.map((id: string) => String(id || '').trim()) : []
    );
    const idbEnv = await loadMirrorSnapshot();
    const idbTasks = idbEnv?.snapshot?.data?.tasks || idbEnv?.snapshot?.tasks || [];
    const hasLocalTasksMissingOnServer =
      (Array.isArray(idbTasks) && idbTasks.some((t: any) => getItemId(t, 'task_id') && !serverTaskIds.has(getItemId(t, 'task_id')))) ||
      BOOT_HARVEST.tasks.some((t: any) => getItemId(t, 'task_id') && !serverTaskIds.has(getItemId(t, 'task_id')));

    if (hasLocalTasksMissingOnServer) {
      await attemptAutoHydrateServer(api).catch(() => false);
    }

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
        const latestMerged = await loadMirrorSnapshot();
        saveLiveSyncToFirestore(latestMerged?.snapshot || data.snapshot).catch(() => {});
      }
    }
  } catch {
    // Silent background mirror failure should never disrupt UI
  }
}
