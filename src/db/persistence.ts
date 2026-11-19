import fs from 'fs';
import path from 'path';
import { eq, notInArray, desc, sql } from 'drizzle-orm';
import { db as pgDb } from './index.ts';
import {
  users,
  tasks,
  conversations,
  messages,
  posts,
  circleNotes,
  workspaceState,
  uploadedFiles,
  workspaceSnapshots,
} from './schema.ts';

const NORMALIZED_TABLE_KEYS = new Set([
  'users',
  'tasks',
  'conversations',
  'messages',
  'posts',
  'circle_notes',
]);

let postgresTemporaryBackoffUntil = 0;

function isPostgresSocketReachable(): boolean {
  const sqlHost = process.env.SQL_HOST;
  if (!sqlHost || !process.env.SQL_USER || !process.env.SQL_DB_NAME) {
    return false;
  }
  if (Date.now() < postgresTemporaryBackoffUntil) {
    return false;
  }
  // If SQL_HOST is a local Unix socket directory (e.g. /app/cloudsql/...), verify the .s.PGSQL.5432 socket exists
  if (sqlHost.startsWith('/')) {
    const socketFile = path.join(sqlHost, '.s.PGSQL.5432');
    if (!fs.existsSync(socketFile)) {
      return false;
    }
  }
  return true;
}

function markPostgresUnavailable() {
  // Pause retries for 60s if the connection/socket is unreachable
  postgresTemporaryBackoffUntil = Date.now() + 60_000;
}

export function isPostgresAvailable(): boolean {
  return isPostgresSocketReachable();
}

function safeDate(val: any): Date {
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function chunkArray<T>(arr: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = getKey(item);
    if (!k) continue;
    map.set(k, item);
  }
  return Array.from(map.values());
}

export function isWorkspaceSeedState(workspaceDb: Record<string, any>): boolean {
  const humanUsers = (Array.isArray(workspaceDb.users) ? workspaceDb.users : []).filter(
    (u: any) => u && !u.is_bot && u.role !== 'assistant'
  );
  const hasCustomUser = humanUsers.some(
    (u: any) =>
      u?.user_id &&
      !['user_admin1', 'user_superadmin_saeful', 'user_circle_assistant'].includes(String(u.user_id))
  );
  const tasksCount = Array.isArray(workspaceDb.tasks) ? workspaceDb.tasks.length : 0;
  const notesCount = Array.isArray(workspaceDb.circle_notes) ? workspaceDb.circle_notes.length : 0;
  const postsCount = Array.isArray(workspaceDb.posts) ? workspaceDb.posts.length : 0;
  const msgsCount = Array.isArray(workspaceDb.messages) ? workspaceDb.messages.length : 0;
  return !hasCustomUser && humanUsers.length <= 2 && tasksCount === 0 && notesCount === 0 && postsCount <= 1 && msgsCount <= 3;
}

export interface LoadedPostgresWorkspace {
  hasPersistedData: boolean;
  revision: number;
  stateData: Record<string, any>;
  users: any[];
  tasks: any[];
  conversations: any[];
  messages: any[];
  posts: any[];
  circle_notes: any[];
  uploadedFilesRestored: number;
}

export async function loadWorkspaceFromPostgres(uploadsDir?: string): Promise<LoadedPostgresWorkspace | null> {
  if (!isPostgresSocketReachable()) {
    return null;
  }
  try {
    const [
      stateRows,
      userRows,
      taskRows,
      convRows,
      msgRows,
      postRows,
      noteRows,
      fileRows,
    ] = await Promise.all([
      pgDb.select().from(workspaceState).where(eq(workspaceState.key, 'main')).limit(1),
      pgDb.select().from(users),
      pgDb.select().from(tasks),
      pgDb.select().from(conversations),
      pgDb.select().from(messages),
      pgDb.select().from(posts),
      pgDb.select().from(circleNotes),
      pgDb.select().from(uploadedFiles),
    ]);

    const mainState = stateRows[0];
    const hasRows =
      Boolean(mainState) ||
      userRows.length > 0 ||
      taskRows.length > 0 ||
      convRows.length > 0 ||
      msgRows.length > 0 ||
      postRows.length > 0 ||
      noteRows.length > 0 ||
      fileRows.length > 0;

    if (!hasRows) {
      return null;
    }

    let restoredFilesCount = 0;
    if (uploadsDir && fileRows.length > 0) {
      try {
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        for (const f of fileRows) {
          const safeName = path.basename(f.filename || `${f.id}.bin`);
          if (!safeName || safeName.startsWith('.')) continue;
          const dest = path.join(uploadsDir, safeName);
          if (!fs.existsSync(dest) && f.contentBase64) {
            fs.writeFileSync(dest, Buffer.from(f.contentBase64, 'base64'));
            restoredFilesCount++;
          }
        }
      } catch (fileErr) {
        console.warn('Warning restoring uploaded files from PostgreSQL:', fileErr);
      }
    }

    const stateData = (mainState?.data && typeof mainState.data === 'object' ? mainState.data : {}) as Record<string, any>;
    const hydratedFilesMap = { ...(stateData.files && typeof stateData.files === 'object' ? stateData.files : {}) };
    for (const f of fileRows) {
      if (!hydratedFilesMap[f.id]) {
        hydratedFilesMap[f.id] = {
          id: f.id,
          name: f.originalName || f.filename,
          filename: f.filename,
          mimetype: f.mimetype,
          size: f.sizeBytes,
        };
      }
    }
    stateData.files = hydratedFilesMap;

    const loadedUsers = userRows.map((r) => ({
      ...(r.profileData || {}),
      user_id: r.userId,
      firebase_uid: r.uid !== r.userId ? r.uid : (r.profileData as any)?.firebase_uid,
      email: r.email,
      name: r.name,
      role: r.role,
      department: r.department,
      job_title: r.jobTitle,
      status: r.status,
      avatar: r.avatar || (r.profileData as any)?.avatar,
    }));

    const loadedTasks = taskRows.map((r) => ({ ...(r.data || {}), id: r.id }));
    const loadedConvs = convRows.map((r) => ({ ...(r.data || {}), id: r.id }));
    const loadedMsgs = msgRows
      .map((r) => ({ ...(r.data || {}), id: r.id }))
      .sort((a: any, b: any) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime());
    const loadedPosts = postRows
      .map((r) => ({ ...(r.data || {}), id: r.id }))
      .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
    const loadedNotes = noteRows.map((r) => ({ ...(r.data || {}), id: r.id }));

    return {
      hasPersistedData: true,
      revision: Number(mainState?.revision ?? stateData.revision ?? 0),
      stateData,
      users: loadedUsers,
      tasks: loadedTasks,
      conversations: loadedConvs,
      messages: loadedMsgs,
      posts: loadedPosts,
      circle_notes: loadedNotes,
      uploadedFilesRestored: restoredFilesCount,
    };
  } catch (error) {
    markPostgresUnavailable();
    return null;
  }
}

export async function saveWorkspaceToPostgres(
  workspaceDb: Record<string, any>,
  options: { allowEmptyOverwrite?: boolean } = {}
): Promise<void> {
  if (!isPostgresSocketReachable()) {
    return;
  }
  try {
    const isSeed = isWorkspaceSeedState(workspaceDb);
    if (isSeed && !options.allowEmptyOverwrite) {
      const existingState = await pgDb
        .select({ revision: workspaceState.revision })
        .from(workspaceState)
        .where(eq(workspaceState.key, 'main'))
        .limit(1);
      if (existingState[0] && Number(existingState[0].revision || 0) > 0) {
        return;
      }
      const existingTasks = await pgDb.select({ id: tasks.id }).from(tasks).limit(1);
      if (existingTasks.length > 0) {
        return;
      }
    }

    const revision = Number(workspaceDb.revision || 0);
    const statePayload: Record<string, any> = {};
    for (const [key, val] of Object.entries(workspaceDb)) {
      if (NORMALIZED_TABLE_KEYS.has(key) || val === undefined) continue;
      if (key === 'files' && val && typeof val === 'object') {
        const cleanFiles: Record<string, any> = {};
        for (const [fid, fmeta] of Object.entries(val)) {
          if (!fmeta || typeof fmeta !== 'object') continue;
          const { buffer: _buf, ...restMeta } = fmeta as any;
          cleanFiles[fid] = restMeta;
        }
        statePayload.files = cleanFiles;
      } else {
        statePayload[key] = val;
      }
    }

    const rawUsers = Array.isArray(workspaceDb.users) ? workspaceDb.users : [];
    const preparedUsers = dedupeByKey(
      dedupeByKey(
        rawUsers.filter((u: any) => u && u.user_id && u.email),
        (u: any) => String(u.user_id)
      ),
      (u: any) => String(u.firebase_uid || u.uid || u.user_id)
    ).map((u: any) => ({
      uid: String(u.firebase_uid || u.uid || u.user_id),
      userId: String(u.user_id),
      email: String(u.email).toLowerCase().trim(),
      name: String(u.name || u.email).trim(),
      role: String(u.role || 'employee'),
      department: u.department ? String(u.department) : 'Marketing',
      jobTitle: u.job_title ? String(u.job_title) : 'Staff Member',
      status: String(u.status || 'active'),
      avatar: u.avatar || u.picture || null,
      profileData: u,
      createdAt: safeDate(u.created_at),
      updatedAt: new Date(),
    }));

    const rawTasks = Array.isArray(workspaceDb.tasks) ? workspaceDb.tasks : [];
    const preparedTasks = dedupeByKey(
      rawTasks.filter((t: any) => t && (t.id || t.task_id)),
      (t: any) => String(t.id || t.task_id)
    ).map((t: any) => {
      const tid = String(t.id || t.task_id);
      return {
        id: tid,
        numberStr: t.number_str ? String(t.number_str) : null,
        title: String(t.title || 'Untitled Task'),
        status: String(t.status || 'todo'),
        priority: t.priority ? String(t.priority) : 'medium',
        boardId: t.board_id ? String(t.board_id) : null,
        projectId: t.project_id ? String(t.project_id) : null,
        assigneeId: t.assignee_id ? String(t.assignee_id) : null,
        reporterId: t.reporter_id ? String(t.reporter_id) : null,
        data: { ...t, id: tid },
        createdAt: safeDate(t.created_at),
        updatedAt: safeDate(t.updated_at || t.created_at),
      };
    });

    const rawConvs = Array.isArray(workspaceDb.conversations) ? workspaceDb.conversations : [];
    const preparedConvs = dedupeByKey(
      rawConvs.filter((c: any) => c && c.id),
      (c: any) => String(c.id)
    ).map((c: any) => ({
      id: String(c.id),
      type: String(c.type || 'dm'),
      name: c.name ? String(c.name) : null,
      data: c,
      updatedAt: safeDate(c.last_message_at || c.updated_at || c.created_at),
    }));

    const rawMsgs = Array.isArray(workspaceDb.messages) ? workspaceDb.messages : [];
    const preparedMsgs = dedupeByKey(
      rawMsgs.filter((m: any) => m && m.id && m.conversation_id),
      (m: any) => String(m.id)
    ).map((m: any) => ({
      id: String(m.id),
      conversationId: String(m.conversation_id),
      senderId: String(m.sender_id || m.user_id || 'system'),
      text: typeof m.text === 'string' ? m.text : null,
      type: String(m.type || 'text'),
      data: m,
      createdAt: safeDate(m.created_at),
    }));

    const rawPosts = Array.isArray(workspaceDb.posts) ? workspaceDb.posts : [];
    const preparedPosts = dedupeByKey(
      rawPosts.filter((p: any) => p && p.id),
      (p: any) => String(p.id)
    ).map((p: any) => ({
      id: String(p.id),
      authorId: p.author_id || p.user_id ? String(p.author_id || p.user_id) : null,
      parentId: p.parent_id ? String(p.parent_id) : null,
      content: typeof p.content === 'string' ? p.content : (typeof p.text === 'string' ? p.text : null),
      data: p,
      createdAt: safeDate(p.created_at),
    }));

    const rawNotes = Array.isArray(workspaceDb.circle_notes) ? workspaceDb.circle_notes : [];
    const preparedNotes = dedupeByKey(
      rawNotes.filter((n: any) => n && n.id),
      (n: any) => String(n.id)
    ).map((n: any) => ({
      id: String(n.id),
      userId: n.user_id || n.owner_id ? String(n.user_id || n.owner_id) : null,
      title: typeof n.title === 'string' ? n.title : null,
      data: n,
      updatedAt: safeDate(n.updated_at || n.created_at),
    }));

    await pgDb.transaction(async (tx) => {
      await tx
        .insert(workspaceState)
        .values({
          key: 'main',
          revision,
          data: statePayload,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: workspaceState.key,
          set: {
            revision,
            data: statePayload,
            updatedAt: new Date(),
          },
        });

      // Users
      const userIds = preparedUsers.map((u) => u.userId);
      if (userIds.length > 0) {
        await tx.delete(users).where(notInArray(users.userId, userIds));
        for (const chunk of chunkArray(preparedUsers, 80)) {
          for (const row of chunk) {
            await tx
              .insert(users)
              .values(row)
              .onConflictDoUpdate({
                target: users.userId,
                set: {
                  uid: row.uid,
                  email: row.email,
                  name: row.name,
                  role: row.role,
                  department: row.department,
                  jobTitle: row.jobTitle,
                  status: row.status,
                  avatar: row.avatar,
                  profileData: row.profileData,
                  updatedAt: row.updatedAt,
                },
              });
          }
        }
      }

      // Tasks (batch multi-row upsert per chunk)
      const taskIds = preparedTasks.map((t) => t.id);
      if (taskIds.length > 0) {
        await tx.delete(tasks).where(notInArray(tasks.id, taskIds));
        for (const chunk of chunkArray(preparedTasks, 120)) {
          await tx
            .insert(tasks)
            .values(chunk)
            .onConflictDoUpdate({
              target: tasks.id,
              set: {
                numberStr: sql`excluded.number_str`,
                title: sql`excluded.title`,
                status: sql`excluded.status`,
                priority: sql`excluded.priority`,
                boardId: sql`excluded.board_id`,
                projectId: sql`excluded.project_id`,
                assigneeId: sql`excluded.assignee_id`,
                reporterId: sql`excluded.reporter_id`,
                data: sql`excluded.data`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
      } else {
        await tx.delete(tasks);
      }

      // Conversations (batch multi-row upsert per chunk)
      const convIds = preparedConvs.map((c) => c.id);
      if (convIds.length > 0) {
        await tx.delete(conversations).where(notInArray(conversations.id, convIds));
        for (const chunk of chunkArray(preparedConvs, 120)) {
          await tx
            .insert(conversations)
            .values(chunk)
            .onConflictDoUpdate({
              target: conversations.id,
              set: {
                type: sql`excluded.type`,
                name: sql`excluded.name`,
                data: sql`excluded.data`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
      } else {
        await tx.delete(conversations);
      }

      // Messages (batch multi-row upsert per chunk)
      const msgIds = preparedMsgs.map((m) => m.id);
      if (msgIds.length > 0) {
        await tx.delete(messages).where(notInArray(messages.id, msgIds));
        for (const chunk of chunkArray(preparedMsgs, 150)) {
          await tx
            .insert(messages)
            .values(chunk)
            .onConflictDoUpdate({
              target: messages.id,
              set: {
                conversationId: sql`excluded.conversation_id`,
                senderId: sql`excluded.sender_id`,
                text: sql`excluded.text`,
                type: sql`excluded.type`,
                data: sql`excluded.data`,
              },
            });
        }
      } else {
        await tx.delete(messages);
      }

      // Posts (batch multi-row upsert per chunk)
      const postIds = preparedPosts.map((p) => p.id);
      if (postIds.length > 0) {
        await tx.delete(posts).where(notInArray(posts.id, postIds));
        for (const chunk of chunkArray(preparedPosts, 120)) {
          await tx
            .insert(posts)
            .values(chunk)
            .onConflictDoUpdate({
              target: posts.id,
              set: {
                authorId: sql`excluded.author_id`,
                parentId: sql`excluded.parent_id`,
                content: sql`excluded.content`,
                data: sql`excluded.data`,
              },
            });
        }
      } else {
        await tx.delete(posts);
      }

      // Circle Notes (batch multi-row upsert per chunk)
      const noteIds = preparedNotes.map((n) => n.id);
      if (noteIds.length > 0) {
        await tx.delete(circleNotes).where(notInArray(circleNotes.id, noteIds));
        for (const chunk of chunkArray(preparedNotes, 120)) {
          await tx
            .insert(circleNotes)
            .values(chunk)
            .onConflictDoUpdate({
              target: circleNotes.id,
              set: {
                userId: sql`excluded.user_id`,
                title: sql`excluded.title`,
                data: sql`excluded.data`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
      } else {
        await tx.delete(circleNotes);
      }
    });
  } catch (error) {
    markPostgresUnavailable();
  }
}

export async function saveUploadedFileToPostgres(params: {
  id: string;
  filename: string;
  originalName?: string;
  mimetype: string;
  sizeBytes: number;
  buffer: Buffer;
}) {
  if (!isPostgresSocketReachable()) {
    return;
  }
  try {
    const contentBase64 = params.buffer.toString('base64');
    await pgDb
      .insert(uploadedFiles)
      .values({
        id: params.id,
        filename: params.filename,
        originalName: params.originalName || params.filename,
        mimetype: params.mimetype || 'application/octet-stream',
        sizeBytes: params.sizeBytes || params.buffer.length,
        contentBase64,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: uploadedFiles.id,
        set: {
          filename: params.filename,
          originalName: params.originalName || params.filename,
          mimetype: params.mimetype || 'application/octet-stream',
          sizeBytes: params.sizeBytes || params.buffer.length,
          contentBase64,
        },
      });
  } catch (error) {
    markPostgresUnavailable();
  }
}

export async function getUploadedFileFromPostgres(id: string) {
  if (!isPostgresSocketReachable()) {
    return null;
  }
  try {
    const rows = await pgDb.select().from(uploadedFiles).where(eq(uploadedFiles.id, id)).limit(1);
    return rows[0] || null;
  } catch (error) {
    markPostgresUnavailable();
    return null;
  }
}

export async function syncUploadedFilesMapToPostgres(
  uploadedBase64: Record<string, string>,
  filesMeta: Record<string, any> = {}
) {
  if (!isPostgresSocketReachable()) {
    return;
  }
  try {
    for (const [rawName, b64] of Object.entries(uploadedBase64)) {
      if (typeof b64 !== 'string' || !rawName) continue;
      const safeName = path.basename(rawName);
      if (!safeName || safeName.startsWith('.')) continue;
      const matchedMeta = Object.values(filesMeta).find(
        (m: any) => m && (m.filename === safeName || m.id === safeName)
      ) as any;
      const fileId = matchedMeta?.id || safeName.replace(/\.[^.]+$/, '');
      const buf = Buffer.from(b64, 'base64');
      await saveUploadedFileToPostgres({
        id: String(fileId),
        filename: safeName,
        originalName: matchedMeta?.name || safeName,
        mimetype: matchedMeta?.mimetype || 'application/octet-stream',
        sizeBytes: buf.length,
        buffer: buf,
      });
    }
  } catch {
    markPostgresUnavailable();
  }
}

export async function saveWorkspaceSnapshotToPostgres(params: {
  snapshotId: string;
  label: string;
  source: string;
  revision: number;
  summary: Record<string, any>;
  payload: Record<string, any>;
}) {
  if (!isPostgresSocketReachable()) {
    return;
  }
  try {
    await pgDb
      .insert(workspaceSnapshots)
      .values({
        snapshotId: params.snapshotId,
        label: params.label,
        source: params.source,
        revision: params.revision,
        summary: params.summary,
        payload: params.payload,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceSnapshots.snapshotId,
        set: {
          label: params.label,
          source: params.source,
          revision: params.revision,
          summary: params.summary,
          payload: params.payload,
        },
      });
  } catch {
    markPostgresUnavailable();
  }
}

export async function listWorkspaceSnapshotsFromPostgres(limit = 30) {
  if (!isPostgresSocketReachable()) {
    return [];
  }
  try {
    return await pgDb
      .select({
        id: workspaceSnapshots.id,
        snapshotId: workspaceSnapshots.snapshotId,
        label: workspaceSnapshots.label,
        source: workspaceSnapshots.source,
        revision: workspaceSnapshots.revision,
        summary: workspaceSnapshots.summary,
        createdAt: workspaceSnapshots.createdAt,
      })
      .from(workspaceSnapshots)
      .orderBy(desc(workspaceSnapshots.createdAt))
      .limit(limit);
  } catch {
    markPostgresUnavailable();
    return [];
  }
}

export async function getWorkspaceSnapshotFromPostgres(snapshotId: string) {
  if (!isPostgresSocketReachable()) {
    return null;
  }
  try {
    const rows = await pgDb
      .select()
      .from(workspaceSnapshots)
      .where(eq(workspaceSnapshots.snapshotId, snapshotId))
      .limit(1);
    return rows[0] || null;
  } catch {
    markPostgresUnavailable();
    return null;
  }
}
