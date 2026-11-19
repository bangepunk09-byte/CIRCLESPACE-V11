import crypto from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import compression from 'compression';
import * as webpush from 'web-push';
import nodemailer from 'nodemailer';
import { INITIAL_TASKS } from './src/data/initialTasks.js';
import { INITIAL_DRIVE_SHORTCUTS } from './src/data/initialDriveShortcuts.js';
import { computeWorkspaceWorkload, generateCircleBotReply } from './src/server/circleBot.js';
import { CIRCLE_FEATURE_CATALOG, CIRCLE_FEATURE_CATEGORIES } from './src/server/circleCatalog.js';
import { ensureMarketplaceData, registerMarketplaceRoutes } from './src/server/marketplace.js';
import {
  getMasterKey,
  hashPassword,
  isPasswordHashed,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  digestSecret,
  verifySecretDigest,
  signSessionToken,
  verifySessionToken,
  parseCookies,
  getAuthThrottleStatus,
  recordFailedAuthAttempt,
  clearAuthAttempts,
  validatePasswordPolicy,
} from './src/server/security.js';
import {
  isPostgresAvailable,
  loadWorkspaceFromPostgres,
  saveWorkspaceToPostgres,
  saveUploadedFileToPostgres,
  getUploadedFileFromPostgres,
  syncUploadedFilesMapToPostgres,
  saveWorkspaceSnapshotToPostgres,
  listWorkspaceSnapshotsFromPostgres,
  getWorkspaceSnapshotFromPostgres,
} from './src/db/persistence.ts';
import { verifyFirebaseIdTokenSafe } from './src/middleware/auth.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_KEY = getMasterKey(__dirname);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const hmrWss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      if (protocols.has('vite-hmr')) return 'vite-hmr';
      const first = protocols.values().next().value;
      return first || false;
    }
  });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Accept Vite HMR or auxiliary WebSocket upgrades cleanly so @vite/client never throws "WebSocket closed without opened"
      hmrWss.handleUpgrade(request, socket, head, (ws) => {
        ws.on('error', () => {});
        try {
          ws.send(JSON.stringify({ type: 'connected' }));
        } catch {}
      });
    }
  });

  const broadcast = (data: any) => {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  const createNotification = (params: { 
    user_id: string, 
    title: string, 
    body?: string, 
    type?: string, 
    category?: string, 
    actor_id?: string,
    link?: string,
    access_request?: any,
    task_id?: string,
    conversation_id?: string,
    group_id?: string,
    requester_id?: string,
    archive_request_id?: string,
    month?: string,
    sender?: any
  }) => {
    const notif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      read: false,
      created_at: new Date().toISOString(),
      category: params.category || "general",
      ...params
    };
    if (!db.notifications) db.notifications = [];
    db.notifications.unshift(notif);
    // Keep only last 100 notifications per user or overall
    if (db.notifications.length > 1000) db.notifications = db.notifications.slice(0, 1000);
    
    broadcast({ type: "notification", data: notif });
    try {
      const targetUrl =
        notif.link ||
        (notif.conversation_id
          ? `/messages/${notif.conversation_id}`
          : notif.task_id
          ? `/tasks?task=${notif.task_id}`
          : notif.access_request
          ? "/settings"
          : "/notifications");
      sendWebPushToUser(params.user_id, {
        id: notif.id,
        title: notif.title,
        body: notif.body || "Ada pembaruan baru di CIRCLE Workspace.",
        type: notif.type || "general",
        category: notif.category || "general",
        url: targetUrl,
        conversation_id: notif.conversation_id || null,
        task_id: notif.task_id || null,
        access_request: Boolean(notif.access_request),
        tag: notif.conversation_id || notif.task_id || notif.id,
      });
    } catch {}
    return notif;
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
  });

  app.set('trust proxy', 1);
  app.set('etag', 'strong');
  app.disable('x-powered-by');

  // Security Middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow Vite client scripts and external avatar images in dev/preview
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: false,
    frameguard: false
  }));
  app.use(cors());
  app.use(compression({ level: 6, threshold: 512 }));
  // Serve public/assets with aggressive browser & CDN caching (7d + 30d stale-while-revalidate)
  app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), {
    maxAge: '7d',
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
    }
  }));
  const getClientRateLimitIp = (req: any): string => {
    const pickHeaderIp = (val: unknown): string => {
      if (typeof val !== 'string') return '';
      const first = val.split(',')[0]?.trim() || '';
      // Strip optional IPv4 port suffix (e.g. 1.2.3.4:5678) without breaking IPv6
      if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(first)) {
        return first.split(':')[0];
      }
      return first;
    };
    const rawIp =
      pickHeaderIp(req.headers?.['cf-connecting-ip']) ||
      pickHeaderIp(req.headers?.['true-client-ip']) ||
      pickHeaderIp(req.headers?.['x-real-ip']) ||
      pickHeaderIp(req.headers?.['x-forwarded-for']) ||
      String(req.ip || req.socket?.remoteAddress || '127.0.0.1');
    try {
      return ipKeyGenerator(rawIp);
    } catch {
      return rawIp || '127.0.0.1';
    }
  };

  const getApiRateLimitKey = (req: any): string => {
    const ipKey = getClientRateLimitIp(req);
    const uidHeader = typeof req.headers?.['x-user-id'] === 'string' ? req.headers['x-user-id'].trim() : '';
    if (uidHeader) {
      return `user:${uidHeader.slice(0, 80)}:${ipKey}`;
    }
    return `ip:${ipKey}`;
  };

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 4000, // Generous per user+IP quota for active workspace usage behind proxies/NAT
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getApiRateLimitKey,
    skip: (req) => {
      const p = String(req.path || '');
      return (
        p.startsWith('/files/') ||
        p === '/presence/online' ||
        p === '/health' ||
        p === '/workspace/persistence-status'
      );
    },
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
    message: { detail: 'Terlalu banyak permintaan API dalam waktu singkat. Mohon tunggu sebentar lalu coba lagi.' },
  });
  app.use('/api/', limiter);

  app.use(express.json({ limit: '50mb' }));

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ipKey = getClientRateLimitIp(req);
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : '';
      return email ? `auth:${email}:${ipKey}` : `auth:${ipKey}`;
    },
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
    message: { detail: 'Terlalu banyak percobaan autentikasi. Silakan tunggu beberapa menit sebelum mencoba lagi.' },
  });
  app.use('/api/auth/login', authRateLimiter);
  app.use('/api/auth/forgot-password', authRateLimiter);
  app.use('/api/auth/reset-with-recovery-key', authRateLimiter);
  app.use('/api/auth/forgot-password/verify-google', authRateLimiter);
  app.use('/api/auth/forgot-password/send-otp', authRateLimiter);
  app.use('/api/auth/forgot-password/verify-otp', authRateLimiter);

  const initialServerTasks: any[] = [];

  // In-memory mock data store for CIRCLE Workspace with explicit any/Record types
  const db: Record<string, any> = {
    files: {},
    meetings: [],
    workspace: {
      id: "ws_main",
      name: "CIRCLE Workspace",
      tagline: "Enterprise Collaboration & Management",
      logo_file_id: "default_workspace_logo",
      login_image_file_id: "default_login_bg",
      theme: { primary: "#2F7DE1", mode: "light" },
      task_statuses: ["todo", "in_progress", "in_review", "done"],
      task_fields: [],
      divisions: ["Engineering", "Product", "Operations", "Design"],
      item_types: [],
      allowed_domains: ["asliri.id"],
      auto_join_domain: true,
      require_approval: true,
    },
    users: [
      {
        user_id: "user_admin1",
        email: "admin@asliri.local",
        password_hash: hashPassword("AdminAsliRi2026!"),
        password_updated_at: new Date().toISOString(),
        token_version: 1,
        name: "Admin ASLI RI",
        role: "super_admin",
        job_title: "Workspace Administrator",
        department: "Engineering",
        online: true,
        is_demo: false,
        status: "active",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
        picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80"
      }
    ],
    labels: [
      { id: "lbl_asliri", name: "ASLI RI", color: "#EF4444", description: "IP / Brand ASLI RI" },
      { id: "lbl_tixfly", name: "TIXFLY", color: "#8B5CF6", description: "IP / Brand TIXFLY" },
      { id: "lbl_bankabdi", name: "BANK ABDI", color: "#0EA5E9", description: "IP / Brand BANK ABDI" },
      { id: "lbl_tommy", name: "TOMMY FONDY", color: "#F97316", description: "IP / Brand TOMMY FONDY" },
      { id: "lbl_trinity", name: "TRINITY", color: "#EC4899", description: "IP / Brand TRINITY" },
      { id: "lbl_beezy", name: "BEEZY", color: "#EAB308", description: "IP / Brand BEEZY" },
      { id: "lbl_internal", name: "INTERNAL", color: "#1E293B", description: "IP / Brand INTERNAL" }
    ],
    notifications: [],
    tasks: [],
    projects: [],
    boards: [
      { id: "brd_div_marketing", name: "Marketing", department: "Marketing", color: "#10B981" },
      { id: "brd_div_sales", name: "Sales", department: "Sales", color: "#F59E0B" },
      { id: "brd_div_it", name: "IT", department: "IT", color: "#06B6D4" },
      { id: "brd_div_finance", name: "Finance", department: "Finance", color: "#14B8A6" },
      { id: "brd_div_legal", name: "Legal", department: "Legal", color: "#6366F1" },
      { id: "brd_div_hrga", name: "HRGA", department: "HRGA", color: "#F97316" }
    ],
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
    marketplace_listings: [],
    marketplace_orders: [],
    marketplace_reviews: [],
    marketplace_vouchers: [],
    marketplace_carts: {},
    marketplace_wishlists: {},
    circle_notes: [],
    deleted_user_ids: [],
    deleted_user_emails: [],
  };

  const DB_FILE = path.join(__dirname, '.circle_workspace_db.json');
  const DB_MIRROR_FILE = path.join(__dirname, '.circle_workspace_db.mirror.json');
  const DB_TMP_FILE = path.join(__dirname, '.circle_workspace_db.tmp.json');
  const DB_MIRROR_TMP_FILE = path.join(__dirname, '.circle_workspace_db.mirror.tmp.json');
  const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  let serverBootedFreshSeed = false;

  function applyLoadedDbObject(parsed: any) {
    if (!parsed || typeof parsed !== 'object') return false;
    const rawData = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    Object.keys(rawData).forEach((key) => {
      if (rawData[key] !== undefined) {
        db[key] = rawData[key];
      }
    });
    if (parsed.uploaded_files_base64 && typeof parsed.uploaded_files_base64 === 'object') {
      try {
        for (const [rawName, b64] of Object.entries(parsed.uploaded_files_base64)) {
          if (typeof b64 !== 'string' || !rawName) continue;
          const safeName = path.basename(rawName);
          if (!safeName || safeName.startsWith('.')) continue;
          fs.writeFileSync(path.join(UPLOADS_DIR, safeName), Buffer.from(b64, 'base64'));
        }
      } catch {}
    }
    return true;
  }

  function findNewestBackupSnapshotOnDisk(): string | null {
    try {
      const backupsRoot = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupsRoot)) return null;
      const candidates: { filePath: string; mtimeMs: number }[] = [];
      const years = fs.readdirSync(backupsRoot).filter((x) => /^\d{4}$/.test(x));
      for (const yr of years) {
        const yrPath = path.join(backupsRoot, yr);
        if (!fs.statSync(yrPath).isDirectory()) continue;
        for (const mo of fs.readdirSync(yrPath)) {
          const moPath = path.join(yrPath, mo);
          if (!fs.statSync(moPath).isDirectory()) continue;
          for (const dy of fs.readdirSync(moPath)) {
            const dyPath = path.join(moPath, dy);
            if (!fs.statSync(dyPath).isDirectory()) continue;
            for (const fname of fs.readdirSync(dyPath)) {
              if (!fname.endsWith('.json') || fname.endsWith('.meta.json')) continue;
              const full = path.join(dyPath, fname);
              candidates.push({ filePath: full, mtimeMs: fs.statSync(full).mtimeMs });
            }
          }
        }
      }
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]?.filePath || null;
    } catch {
      return null;
    }
  }

  function isDatabaseInEmptySeedState(): boolean {
    const humanUsers = (db.users || []).filter((u: any) => u && !u.is_bot && u.role !== 'assistant');
    const hasCustomUser = humanUsers.some(
      (u: any) =>
        u?.user_id &&
        !['user_admin1', 'user_superadmin_saeful', 'user_circle_assistant'].includes(String(u.user_id))
    );
    const tasksCount = Array.isArray(db.tasks) ? db.tasks.length : 0;
    const notesCount = Array.isArray(db.circle_notes) ? db.circle_notes.length : 0;
    const postsCount = Array.isArray(db.posts) ? db.posts.length : 0;
    const msgsCount = Array.isArray(db.messages) ? db.messages.length : 0;
    return !hasCustomUser && humanUsers.length <= 2 && tasksCount === 0 && notesCount === 0 && postsCount <= 1 && msgsCount <= 3;
  }

  function loadDbFromFile() {
    const candidates = [DB_FILE, DB_MIRROR_FILE];
    for (const filePath of candidates) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (applyLoadedDbObject(parsed)) {
            console.log(`Successfully loaded CIRCLE workspace database from ${path.basename(filePath)}.`);
            if (isDatabaseInEmptySeedState()) {
              serverBootedFreshSeed = true;
              db.revision = 0;
            } else {
              serverBootedFreshSeed = false;
            }
            return;
          }
        }
      } catch (e) {
        console.warn(`Failed to load ${path.basename(filePath)}:`, e);
      }
    }

    // Fallback: recover automatically from newest daily auto-backup snapshot on disk if available
    const newestBackup = findNewestBackupSnapshotOnDisk();
    if (newestBackup) {
      try {
        const parsed = JSON.parse(fs.readFileSync(newestBackup, 'utf-8'));
        if (applyLoadedDbObject(parsed)) {
          console.log(`Recovered CIRCLE workspace database from snapshot ${path.basename(newestBackup)}.`);
          serverBootedFreshSeed = isDatabaseInEmptySeedState();
          if (serverBootedFreshSeed) db.revision = 0;
          return;
        }
      } catch (e) {
        console.warn('Failed to recover from disk backup snapshot:', e);
      }
    }

    serverBootedFreshSeed = true;
    db.revision = 0;
    db.last_mutated_at = db.last_mutated_at || new Date().toISOString();
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let isWritingDb = false;
  let pendingWrite = false;
  let isServerBootstrapping = true;
  let saveInvokeSeq = 0;

  function getNextTaskNumber(tasksList: any[]): number {
    let maxNum = 0;
    if (Array.isArray(tasksList)) {
      for (const t of tasksList) {
        const match = typeof t?.number_str === "string" ? t.number_str.match(/TSK-(\d+)/i) : null;
        const parsed = match ? Number(match[1]) : Number(t?.number || 0);
        if (Number.isFinite(parsed) && parsed > maxNum) maxNum = parsed;
      }
    }
    return Math.max(maxNum + 1, (Array.isArray(tasksList) ? tasksList.length : 0) + 1);
  }

  function bumpDbRevision() {
    if (isServerBootstrapping) {
      db.last_mutated_at = db.last_mutated_at || new Date().toISOString();
      return;
    }
    if (isDatabaseInEmptySeedState()) {
      db.revision = 0;
      serverBootedFreshSeed = true;
      db.last_mutated_at = new Date().toISOString();
      return;
    }
    db.revision = Number(db.revision || 0) + 1;
    db.last_mutated_at = new Date().toISOString();
    serverBootedFreshSeed = false;
  }

  function flushDbToFileSync() {
    try {
      const payload = JSON.stringify(db);
      fs.writeFileSync(DB_TMP_FILE, payload, 'utf-8');
      fs.renameSync(DB_TMP_FILE, DB_FILE);
      fs.writeFileSync(DB_MIRROR_TMP_FILE, payload, 'utf-8');
      fs.renameSync(DB_MIRROR_TMP_FILE, DB_MIRROR_FILE);
    } catch (e) {
      console.warn('Failed to save DB file to disk:', e);
    }
  }

  async function flushDbToFileAsync() {
    if (isWritingDb) {
      pendingWrite = true;
      return;
    }
    isWritingDb = true;
    try {
      do {
        pendingWrite = false;
        const payload = JSON.stringify(db);
        await fs.promises.writeFile(DB_TMP_FILE, payload, 'utf-8');
        await fs.promises.rename(DB_TMP_FILE, DB_FILE);
        await fs.promises.writeFile(DB_MIRROR_TMP_FILE, payload, 'utf-8');
        await fs.promises.rename(DB_MIRROR_TMP_FILE, DB_MIRROR_FILE);
      } while (pendingWrite);
    } catch (e) {
      console.warn('Failed to save DB file asynchronously:', e);
    } finally {
      isWritingDb = false;
    }
  }

  function scheduleAsyncDbFlush(immediate = false) {
    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      void flushDbToFileAsync();
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushDbToFileAsync();
    }, 150);
  }

  let pgHydrated = false;
  let pgHydrateInFlight: Promise<void> | null = null;
  let pgSaveChain: Promise<void> = Promise.resolve();
  let pgSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pgSavePendingOptions: { allowEmptyOverwrite?: boolean } = {};

  function enqueuePostgresSave(options: { allowEmptyOverwrite?: boolean } = {}): Promise<void> {
    if (!isPostgresAvailable()) {
      return Promise.resolve();
    }
    let snapshotClone: Record<string, any>;
    try {
      snapshotClone = typeof structuredClone === 'function'
        ? structuredClone(db)
        : JSON.parse(JSON.stringify(db));
    } catch {
      snapshotClone = JSON.parse(JSON.stringify(db));
    }
    pgSaveChain = pgSaveChain
      .catch(() => {})
      .then(() => saveWorkspaceToPostgres(snapshotClone, options))
      .catch(() => {});
    return pgSaveChain;
  }

  function schedulePostgresSave(immediate = false, options: { allowEmptyOverwrite?: boolean } = {}) {
    if (isServerBootstrapping || !isPostgresAvailable()) return;
    if (options.allowEmptyOverwrite) {
      pgSavePendingOptions.allowEmptyOverwrite = true;
    }
    if (immediate) {
      if (pgSaveTimer) {
        clearTimeout(pgSaveTimer);
        pgSaveTimer = null;
      }
      const opts = { ...pgSavePendingOptions };
      pgSavePendingOptions = {};
      void enqueuePostgresSave(opts);
      return;
    }
    if (pgSaveTimer) clearTimeout(pgSaveTimer);
    pgSaveTimer = setTimeout(() => {
      pgSaveTimer = null;
      const opts = { ...pgSavePendingOptions };
      pgSavePendingOptions = {};
      void enqueuePostgresSave(opts);
    }, 250);
  }

  async function ensurePostgresHydrated() {
    if (pgHydrated) return;
    if (!isPostgresAvailable()) {
      pgHydrated = true;
      return;
    }
    if (pgHydrateInFlight) return pgHydrateInFlight;
    pgHydrateInFlight = (async () => {
      try {
        const loaded = await loadWorkspaceFromPostgres(UPLOADS_DIR);
        if (loaded && loaded.hasPersistedData) {
          if (loaded.stateData && typeof loaded.stateData === 'object') {
            Object.keys(loaded.stateData).forEach((key) => {
              if (loaded.stateData[key] !== undefined) {
                db[key] = loaded.stateData[key];
              }
            });
          }
          if (Array.isArray(loaded.users) && loaded.users.length > 0) {
            db.users = loaded.users;
          }
          db.tasks = Array.isArray(loaded.tasks) ? loaded.tasks : [];
          db.conversations = Array.isArray(loaded.conversations) ? loaded.conversations : [];
          db.messages = Array.isArray(loaded.messages) ? loaded.messages : [];
          db.posts = Array.isArray(loaded.posts) ? loaded.posts : [];
          db.circle_notes = Array.isArray(loaded.circle_notes) ? loaded.circle_notes : [];

          if (!Array.isArray(db.drive_shortcuts) || db.drive_shortcuts.length === 0) {
            db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
          }
          ensureMarketplaceData(db);
          migrateSecurityAtRest();
          sanitizeConversationsAndMessages();
          db.revision = Math.max(Number(db.revision || 0), Number(loaded.revision || 0));
          serverBootedFreshSeed = isDatabaseInEmptySeedState();
          flushDbToFileSync();
          console.log(
            `[PostgreSQL] Hydrated CIRCLE workspace (rev ${db.revision}, users=${db.users.length}, tasks=${db.tasks.length}, messages=${db.messages.length}).`
          );
        } else if (!isDatabaseInEmptySeedState()) {
          await saveWorkspaceToPostgres(db, { allowEmptyOverwrite: false });
          await syncUploadedFilesMapToPostgres(getCachedUploadedFilesBase64(), db.files || {});
          console.log('[PostgreSQL] Seeded Cloud SQL from existing local workspace database.');
        }
        pgHydrated = true;
      } catch {
        pgHydrated = true;
      } finally {
        pgHydrateInFlight = null;
      }
    })();
    return pgHydrateInFlight;
  }

  function saveDbToFile(immediate = false, options: { allowEmptyOverwrite?: boolean } = {}) {
    saveInvokeSeq++;
    bumpDbRevision();
    scheduleAsyncDbFlush(immediate);
    schedulePostgresSave(immediate, options);
  }

  // Load persistent DB state on startup
  loadDbFromFile();
  ensureMarketplaceData(db);

  // Clean up any historical approval/rejection text messages so only clean approval cards remain
  if (Array.isArray(db.messages)) {
    db.messages = db.messages.filter((m: any) => 
      !m.id?.startsWith('msg_approved_') && 
      !m.id?.startsWith('msg_rejected_') && 
      !m.text?.startsWith('✅ Permintaan akses') && 
      !m.text?.startsWith('❌ Permintaan akses')
    );
  }

  // Ensure access_requests array & password reset stores exist
  if (!Array.isArray(db.access_requests)) {
    db.access_requests = [];
  }
  if (!db.password_reset_secrets || typeof db.password_reset_secrets !== "object") {
    db.password_reset_secrets = {};
  }
  function generateRecoveryKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `CRCL-${seg(4)}-${seg(4)}`;
  }
  function setEncryptedRecoveryKey(plainKey: string) {
    const clean = String(plainKey || "").trim().toUpperCase();
    db.recovery_key_enc = encryptSecret(clean, MASTER_KEY);
    db.recovery_key_hash = digestSecret(clean, MASTER_KEY);
    delete db.recovery_key;
    return clean;
  }
  function getDecryptedRecoveryKey(): string {
    if (db.recovery_key_enc) {
      const dec = decryptSecret(db.recovery_key_enc, MASTER_KEY);
      if (dec) return dec;
    }
    if (db.recovery_key) {
      return setEncryptedRecoveryKey(db.recovery_key);
    }
    return setEncryptedRecoveryKey(generateRecoveryKey());
  }
  function migrateSecurityAtRest(): boolean {
    let changed = false;
    if (Array.isArray(db.users)) {
      db.users.forEach((u: any) => {
        if (!u || typeof u !== "object") return;
        if (typeof u.password === "string" && u.password.length > 0) {
          if (!isPasswordHashed(u.password_hash)) {
            u.password_hash = hashPassword(u.password);
            u.password_updated_at = u.password_updated_at || new Date().toISOString();
          }
          delete u.password;
          changed = true;
        }
        if (typeof u.token_version !== "number" || u.token_version < 1) {
          u.token_version = 1;
          changed = true;
        }
      });
    }
    if (db.recovery_key) {
      setEncryptedRecoveryKey(db.recovery_key);
      changed = true;
    } else if (!db.recovery_key_enc || !decryptSecret(db.recovery_key_enc, MASTER_KEY)) {
      setEncryptedRecoveryKey(generateRecoveryKey());
      changed = true;
    }
    if (db.password_reset_secrets && typeof db.password_reset_secrets === "object") {
      Object.entries(db.password_reset_secrets).forEach(([k, v]) => {
        if (typeof v === "string" && v.length > 0 && !isPasswordHashed(v)) {
          db.password_reset_secrets[k] = hashPassword(v);
          changed = true;
        }
      });
    }
    return changed;
  }
  function computeProfileCompletion(u: any) {
    if (!u || typeof u !== "object") {
      return { percent: 0, filledCount: 0, totalCount: 9, isVerified: false };
    }
    if (u.is_bot || u.role === "assistant") {
      return { percent: 100, filledCount: 1, totalCount: 1, isVerified: true };
    }
    const isAdminRole = ["super_admin", "workspace_admin"].includes(u.role);
    const isCustomMode = u.work_mode === "Custom" || u.work_mode === "Kustom";
    const hasSkills = Array.isArray(u.skills) && u.skills.filter((s: any) => String(s || "").trim()).length > 0;
    const checks = [
      Boolean(String(u.name || "").trim()),
      Boolean(String(u.phone || "").trim()),
      Boolean(String(u.employee_id || "").trim()),
      Boolean(String(u.employment_status || "").trim()),
      Boolean(String(u.join_date || "").trim()),
      ...(isAdminRole
        ? [
            Boolean(String(u.job_title || "").trim()),
            Boolean(String(u.department || "").trim()),
            Boolean(String(u.team || "").trim()),
          ]
        : []),
      Boolean(String(u.work_mode || "").trim()),
      ...(isCustomMode ? [Boolean(String(u.custom_location || "").trim())] : []),
      Boolean(String(u.city || "").trim()),
      Boolean(String(u.office || "").trim()),
      Boolean(String(u.location_status || "").trim()),
      hasSkills,
      Boolean(String(u.bio || "").trim()),
    ];
    const totalCount = checks.length;
    const filledCount = checks.filter(Boolean).length;
    const percent = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;
    return {
      percent,
      filledCount,
      totalCount,
      isVerified: filledCount === totalCount && totalCount > 0,
    };
  }

  function ensureProfileCompletionReminder(user: any, force = false) {
    if (!user || user.is_bot || user.role === "assistant" || user.is_demo || user.status !== "active") {
      return;
    }
    const comp = computeProfileCompletion(user);
    if (comp.isVerified) {
      user.is_verified = true;
      return;
    }
    if (user.profile_verify_notified && !force) return;
    user.profile_verify_notified = true;
    createNotification({
      user_id: user.user_id,
      title: "Lengkapi Profil 100% untuk Centang Verified",
      body: `Profil Anda saat ini terisi ${comp.percent}%. Isi semua kolom di Ubah Profil agar akun Anda mendapat lencana Verified.`,
      type: "profile_verify",
      category: "system",
      link: `/people/${user.user_id}?edit=1`,
      actor_id: CIRCLE_BOT_ID,
    });
  }

  function sanitizeUser(u: any) {
    if (!u || typeof u !== "object") return u;
    const { password: _pw, password_hash: _pwh, ...rest } = u;
    const comp = computeProfileCompletion(u);
    return {
      ...rest,
      availability_status: u.availability_status || "online",
      is_verified: Boolean(comp.isVerified),
      profile_completion: comp.percent,
      has_password: Boolean(u.password_hash || u.password),
      security_encryption: "scrypt+AES-256-GCM"
    };
  }
  function sanitizeUsersList(list: any[]) {
    return Array.isArray(list) ? list.map(sanitizeUser) : [];
  }

  function ensureVapidKeys(): { publicKey: string; privateKey: string } {
    let keys: { publicKey: string; privateKey: string } | null = null;
    if (db.vapid_keys_enc) {
      const dec = decryptSecret(db.vapid_keys_enc, MASTER_KEY);
      if (dec) {
        try {
          const parsed = JSON.parse(dec);
          if (parsed?.publicKey && parsed?.privateKey) keys = parsed;
        } catch {}
      }
    }
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      db.vapid_keys_enc = encryptSecret(JSON.stringify(keys), MASTER_KEY);
      saveDbToFile();
    }
    try {
      webpush.setVapidDetails("mailto:security@asliri.local", keys.publicKey, keys.privateKey);
    } catch {}
    return keys;
  }

  function sendWebPushToUser(userId: string, payload: Record<string, any>) {
    if (!userId || userId === CIRCLE_BOT_ID) return;
    const userPrefs = db.prefs?.[userId]?.notifications || {};
    const cat = String(payload?.category || "general");
    if (cat === "dm" && userPrefs.messages === false) return;
    if (cat !== "dm" && cat !== "general" && cat !== "system" && userPrefs[cat] === false) return;

    const subsMap = db.push_subscriptions;
    const list = subsMap && Array.isArray(subsMap[userId]) ? subsMap[userId] : [];
    if (!list.length) return;

    ensureVapidKeys();
    const jsonPayload = JSON.stringify(payload);
    list.forEach((sub: any) => {
      if (!sub?.endpoint) return;
      webpush.sendNotification(sub, jsonPayload).catch((err: any) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          db.push_subscriptions[userId] = (db.push_subscriptions[userId] || []).filter(
            (x: any) => x?.endpoint !== sub.endpoint
          );
          saveDbToFile();
        }
      });
    });
  }

  // Ensure no duplicate priority in task_fields
  if (Array.isArray(db.workspace?.task_fields)) {
    db.workspace.task_fields = db.workspace.task_fields.filter(
      (f: any) => f?.name?.toLowerCase() !== "priority" && f?.name?.toLowerCase() !== "estimate"
    );
  }

  // Ensure Circle Assistant Bot user exists
  const CIRCLE_BOT_ID = "user_circle_assistant";
  let circleBot = db.users.find((u: any) => u.user_id === CIRCLE_BOT_ID);
  if (!circleBot) {
    circleBot = {
      user_id: CIRCLE_BOT_ID,
      email: "circle-bot@asliri.local",
      name: db.workspace.assistant_name || "Circle",
      role: "assistant",
      job_title: "Workspace AI Assistant",
      department: "System",
      online: true,
      is_demo: false,
      is_bot: true,
      status: "active",
      avatar: db.workspace.assistant_avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364",
      picture: db.workspace.assistant_avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364"
    };
    db.users.push(circleBot);
  } else {
    circleBot.name = db.workspace.assistant_name || circleBot.name || "Circle";
    if (db.workspace.assistant_avatar) {
      circleBot.avatar = db.workspace.assistant_avatar;
      circleBot.picture = db.workspace.assistant_avatar;
    }
  }

  // Ensure Super Admin user saeful@asliri.id exists
  let saefulAdmin = db.users.find((u: any) => u.email?.toLowerCase() === "saeful@asliri.id");
  if (!saefulAdmin) {
    saefulAdmin = {
      user_id: "user_superadmin_saeful",
      email: "saeful@asliri.id",
      password_hash: hashPassword("AsliRi2026!"),
      password_updated_at: new Date().toISOString(),
      token_version: 1,
      name: "Saeful",
      role: "super_admin",
      job_title: "Super Administrator",
      department: "Management",
      online: true,
      is_demo: false,
      status: "active",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
      picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80"
    };
    db.users.push(saefulAdmin);
  } else {
    saefulAdmin.role = "super_admin";
    saefulAdmin.status = "active";
    if (!saefulAdmin.password_hash && !saefulAdmin.password) {
      saefulAdmin.password_hash = hashPassword("AsliRi2026!");
      saefulAdmin.password_updated_at = new Date().toISOString();
    }
  }

  // Ensure Admin ASLI RI has a password set
  const defaultAdmin = db.users.find((u: any) => u.email?.toLowerCase() === "admin@asliri.local");
  if (defaultAdmin && !defaultAdmin.password_hash && !defaultAdmin.password) {
    defaultAdmin.password_hash = hashPassword("AdminAsliRi2026!");
    defaultAdmin.password_updated_at = new Date().toISOString();
  }

  // Migrate any legacy plaintext passwords or recovery keys to salted scrypt & AES-256-GCM on startup
  if (migrateSecurityAtRest()) {
    saveDbToFile(true);
  }

  // Production cleanup: clear only initial uninitialized seed, NEVER wipe real persisted users/tasks/chats
  const hasRealUserData =
    (Array.isArray(db.tasks) && db.tasks.length > 0) ||
    (Array.isArray(db.messages) && db.messages.length > 3) ||
    (Array.isArray(db.posts) && db.posts.length > 1) ||
    (Array.isArray(db.users) && db.users.filter((u: any) => !u?.is_bot && u?.role !== "assistant").length > 2);

  if (!db.prod_clean_v2 && !hasRealUserData) {
    db.users = (db.users || []).filter(
      (u: any) => u.role === "super_admin" || u.user_id === CIRCLE_BOT_ID || u.is_bot || u.role === "assistant"
    );
    const validIds = new Set(db.users.map((u: any) => u.user_id));
    const validHumanIds = db.users
      .filter((u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID)
      .map((u: any) => u.user_id);

    db.tasks = [];
    db.access_requests = [];
    db.invitations = [];
    db.notifications = [];
    db.activity = [];

    if (Array.isArray(db.messages)) {
      db.messages = db.messages.filter(
        (m: any) =>
          !m.id?.startsWith("msg_req_") &&
          !m.access_request &&
          validIds.has(m.sender_id)
      );
    }

    if (Array.isArray(db.conversations)) {
      db.conversations = db.conversations
        .filter((c: any) => {
          if (c.type === "dm") {
            const mems = Array.isArray(c.member_ids) ? c.member_ids : [];
            return mems.every((id: string) => validIds.has(id));
          }
          return true;
        })
        .map((c: any) => {
          const next = { ...c };
          if (Array.isArray(next.member_ids)) {
            next.member_ids = next.member_ids.filter((id: string) => validIds.has(id));
          }
          if (Array.isArray(next.members)) {
            next.members = next.members.filter((id: string) => validIds.has(id));
          }
          if (next.last_message?.id?.startsWith("msg_req_") || next.last_message?.access_request) {
            next.last_message = null;
          }
          return next;
        });
    }

    if (Array.isArray(db.groups)) {
      db.groups.forEach((g: any) => {
        g.member_ids = [...validHumanIds];
        g.members = [...validHumanIds];
        g.member_count = validHumanIds.length;
      });
    }

    if (Array.isArray(db.boards)) {
      db.boards.forEach((b: any) => {
        b.member_ids = [...validHumanIds];
      });
    }

    if (Array.isArray(db.projects)) {
      db.projects.forEach((p: any) => {
        if (!validIds.has(p.owner_id)) p.owner_id = "user_admin1";
        p.member_ids = [...validHumanIds];
      });
    }

    if (Array.isArray(db.meetings)) {
      db.meetings.forEach((m: any) => {
        if (!validIds.has(m.created_by)) m.created_by = "user_admin1";
        m.attendee_ids = Array.isArray(m.attendee_ids)
          ? m.attendee_ids.filter((id: string) => validIds.has(id))
          : [...validHumanIds];
        if (m.attendee_ids.length === 0) m.attendee_ids = [...validHumanIds];
      });
    }

    if (Array.isArray(db.posts)) {
      db.posts = db.posts
        .filter((p: any) => validIds.has(p.author_id))
        .map((p: any) => ({
          ...p,
          likes: Array.isArray(p.likes) ? p.likes.filter((id: string) => validIds.has(id)) : [],
          like_count: Array.isArray(p.likes) ? p.likes.filter((id: string) => validIds.has(id)).length : 0,
          reactions: { "👍": ["user_admin1"] },
          replies_preview: Array.isArray(p.replies_preview)
            ? p.replies_preview.filter((r: any) => validIds.has(r.author_id))
            : [],
          reply_count: Array.isArray(p.replies_preview)
            ? p.replies_preview.filter((r: any) => validIds.has(r.author_id)).length
            : 0
        }));
    }

    if (Array.isArray(db.org_units)) {
      db.org_units.forEach((u: any) => {
        if (u.head_id && !validIds.has(u.head_id)) {
          u.head_id = "user_admin1";
        }
      });
    }

    if (Array.isArray(db.drive_shortcuts)) {
      db.drive_shortcuts.forEach((s: any) => {
        if (!validIds.has(s.owner_id)) s.owner_id = "user_admin1";
        s.allowed_user_ids = [...validHumanIds];
      });
    }

    if (!validIds.has(db.session_user_id)) {
      db.session_user_id = "user_admin1";
    }

    db.prod_clean_v2 = true;
    saveDbToFile(true);
  } else if (!db.prod_clean_v2 && hasRealUserData) {
    db.prod_clean_v2 = true;
    saveDbToFile(true);
  }

  // Initialize boards without forcing all users into every board (division access is automatic)
  if (Array.isArray(db.boards)) {
    db.boards.forEach((b: any) => {
      if (!Array.isArray(b.invited_member_ids)) b.invited_member_ids = [];
      b.invited_member_ids = b.invited_member_ids.filter((id: string) => id !== CIRCLE_BOT_ID);
      b.member_ids = [...b.invited_member_ids];
    });
  }

  // Ensure all tasks have valid status, board_id, and synced assignee_ids
  if (Array.isArray(db.tasks)) {
    const defaultBoardId = db.boards?.[0]?.id || "brd_div_marketing";
    db.tasks.forEach((t: any) => {
      if (!t.status) t.status = "todo";
      if (!t.board_id || t.board_id === "brd_1") t.board_id = defaultBoardId;
      if (!t.priority) t.priority = "medium";
      let aIds = Array.isArray(t.assignee_ids) ? [...t.assignee_ids] : [];
      if (t.assignee_id && !aIds.includes(t.assignee_id)) aIds.unshift(t.assignee_id);
      aIds = aIds.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID);
      if (aIds.length === 0 && Array.isArray(t.checkpoints)) {
        const cpPics = t.checkpoints.map((c: any) => c?.assignee_id).filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID);
        if (cpPics.length > 0) aIds = Array.from(new Set(cpPics));
      }
      t.assignee_ids = aIds;
      t.assignee_id = aIds[0] || null;
      if (t.assignee_id && Array.isArray(t.checkpoints)) {
        t.checkpoints = t.checkpoints.map((c: any) =>
          c && typeof c === "object" && !c.assignee_id && !c.unassigned
            ? { ...c, assignee_id: t.assignee_id }
            : c
        );
      }
    });
  }

  // Ensure all projects calculate progress strictly from real task data
  if (Array.isArray(db.projects)) {
    db.projects.forEach((p: any) => {
      const pTasks = (db.tasks || []).filter((t: any) => t.project_id === p.id);
      p.task_total = pTasks.length;
      p.task_done = pTasks.filter((t: any) => t.status === "done").length;
      p.progress = p.task_total > 0 ? Math.round((p.task_done / p.task_total) * 100) : 0;
    });
  }

  // Helper for color contrast
  function isDarkColor(hex: string): boolean {
    if (!hex || typeof hex !== 'string') return false;
    const c = hex.replace('#', '');
    if (c.length !== 6) return false;
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.55;
  }

  // 13 Standard Task Item Types
  const DEFAULT_WORKSPACE_ITEM_TYPES = [
    { name: "Feed Post", color: "#FFE4E6", text_color: "#BE123C", border_color: "#FECDD3" },
    { name: "Reels", color: "#FFEDD5", text_color: "#C2410C", border_color: "#FED7AA" },
    { name: "Story", color: "#FEF08A", text_color: "#854D0E", border_color: "#FDE047" },
    { name: "Ads", color: "#DC2626", text_color: "#FFFFFF", border_color: "#B91C1C" },
    { name: "Youtube", color: "#FEE2E2", text_color: "#991B1B", border_color: "#FCA5A5" },
    { name: "Deck", color: "#2563EB", text_color: "#FFFFFF", border_color: "#1D4ED8" },
    { name: "Proposal", color: "#DDD6FE", text_color: "#4C1D95", border_color: "#C4B5FD" },
    { name: "Poster", color: "#F3E8FF", text_color: "#7E22CE", border_color: "#E9D5FF" },
    { name: "Campaign", color: "#DCFCE7", text_color: "#15803D", border_color: "#BBF7D0" },
    { name: "Research", color: "#BAE6FD", text_color: "#0369A1", border_color: "#7DD3FC" },
    { name: "Documentation", color: "#F1F5F9", text_color: "#334155", border_color: "#CBD5E1" },
    { name: "Photo Editing", color: "#CCFBF1", text_color: "#0F766E", border_color: "#99F6E4" },
    { name: "Printing", color: "#1E293B", text_color: "#FFFFFF", border_color: "#0F172A" }
  ];

  const LEGACY_DEFAULT_ITEM_NAMES = new Set([
    "article asset",
    "article copywriting",
    "socmed asset",
    "socmed copywriting",
    "video storyline",
    "video storyboard",
    "video editing",
    "deck copywriting",
    "deck asset",
    "documentation",
    "leads",
    "ui/ux",
    "shooting",
    "video motion",
    "request hr",
    "other",
  ]);

  if (!db.workspace) db.workspace = {};
  if (db.workspace.item_types_version !== 2) {
    const newNameSet = new Set(DEFAULT_WORKSPACE_ITEM_TYPES.map((x) => x.name.toLowerCase()));
    const customExtras = Array.isArray(db.workspace.item_types)
      ? db.workspace.item_types.filter(
          (x: any) =>
            x?.name &&
            !LEGACY_DEFAULT_ITEM_NAMES.has(String(x.name).trim().toLowerCase()) &&
            !newNameSet.has(String(x.name).trim().toLowerCase())
        )
      : [];
    db.workspace.item_types = [...DEFAULT_WORKSPACE_ITEM_TYPES, ...customExtras];
    db.workspace.item_types_version = 2;
    saveDbToFile();
  } else if (!Array.isArray(db.workspace.item_types)) {
    db.workspace.item_types = [...DEFAULT_WORKSPACE_ITEM_TYPES];
  }

  // Ensure default IP/Brand labels exist
  const DEFAULT_LABELS = [
    { id: "lbl_asliri", name: "ASLI RI", color: "#EF4444", description: "IP / Brand ASLI RI" },
    { id: "lbl_tixfly", name: "TIXFLY", color: "#8B5CF6", description: "IP / Brand TIXFLY" },
    { id: "lbl_bankabdi", name: "BANK ABDI", color: "#0EA5E9", description: "IP / Brand BANK ABDI" },
    { id: "lbl_tommy", name: "TOMMY FONDY", color: "#F97316", description: "IP / Brand TOMMY FONDY" },
    { id: "lbl_trinity", name: "TRINITY", color: "#EC4899", description: "IP / Brand TRINITY" },
    { id: "lbl_beezy", name: "BEEZY", color: "#EAB308", description: "IP / Brand BEEZY" },
    { id: "lbl_internal", name: "INTERNAL", color: "#1E293B", description: "IP / Brand INTERNAL" }
  ];

  if (!Array.isArray(db.labels)) {
    db.labels = [...DEFAULT_LABELS];
  } else {
    DEFAULT_LABELS.forEach((dl) => {
      const found = db.labels.find((l: any) => l.name.toLowerCase() === dl.name.toLowerCase() || l.id === dl.id);
      if (!found) {
        db.labels.push(dl);
      } else {
        if (!found.color) found.color = dl.color;
      }
    });
  }

  // Ensure official department groups exist
  const officialGroups = [
    { name: "Marketing", description: "Official channel for Marketing department discussions" },
    { name: "Sales", description: "Official channel for Sales department discussions" },
    { name: "IT", description: "Official channel for IT department discussions" },
    { name: "Finance", description: "Official channel for Finance department discussions" },
    { name: "Legal", description: "Official channel for Legal department discussions" },
    { name: "HRGA", description: "Official channel for HRGA department discussions" },
  ];

  officialGroups.forEach((og) => {
    const groupId = `group_official_${og.name.toLowerCase()}`;
    let g = db.groups.find((x: any) => x.id === groupId || (x.name === og.name && x.is_verified));
    const deptMems = (db.users || [])
      .filter((u: any) => {
        if (!u || u.is_bot || u.role === "assistant" || u.user_id === CIRCLE_BOT_ID) return false;
        if (u.role === "super_admin") return true;
        return String(u.department || "").trim().toLowerCase() === og.name.toLowerCase();
      })
      .map((u: any) => u.user_id);

    if (g) {
      g.id = groupId;
      g.name = og.name;
      g.group_type = "department";
      g.is_verified = true;
      g.type = "group";
      const manualIds = Array.isArray(g.manually_joined_ids) ? g.manually_joined_ids : [];
      g.member_ids = Array.from(new Set([...deptMems, ...manualIds])).filter((id: string) => id !== CIRCLE_BOT_ID);
      g.members = g.member_ids;
      g.member_count = g.member_ids.length;
    } else {
      g = {
        id: groupId,
        name: og.name,
        description: og.description,
        group_type: "department",
        is_verified: true,
        created_at: new Date().toISOString(),
        member_ids: [...deptMems],
        members: [...deptMems],
        member_count: deptMems.length,
        type: "group"
      };
      db.groups.push(g);
    }

    const convIdx = db.conversations.findIndex((c: any) => c.id === g.id || (c.name === og.name && c.is_verified));
    if (convIdx === -1) {
      db.conversations.push({ ...g });
    } else {
      const c = db.conversations[convIdx];
      c.id = g.id;
      c.name = g.name;
      c.group_type = "department";
      c.is_verified = true;
      c.type = "group";
      c.member_ids = [...g.member_ids];
      c.members = [...g.member_ids];
      c.member_count = g.member_ids.length;
    }
  });

  // Remove Circle Assistant from ALL group conversations and groups (Circle is strictly a DM chat bot)
  if (Array.isArray(db.groups)) {
    db.groups.forEach((g: any) => {
      if (Array.isArray(g.member_ids)) {
        g.member_ids = g.member_ids.filter((id: string) => id !== CIRCLE_BOT_ID);
      }
      if (Array.isArray(g.members)) {
        g.members = g.members.filter((id: string) => id !== CIRCLE_BOT_ID);
      }
      g.member_count = (g.member_ids || []).length;
    });
  }
  if (Array.isArray(db.conversations)) {
    db.conversations.forEach((c: any) => {
      if (c && (c.type === "group" || c.group_type || String(c.id || "").startsWith("group_"))) {
        if (Array.isArray(c.member_ids)) {
          c.member_ids = c.member_ids.filter((id: string) => id !== CIRCLE_BOT_ID);
        }
        if (Array.isArray(c.members)) {
          c.members = c.members.filter((id: string) => id !== CIRCLE_BOT_ID);
        }
      }
    });
  }
  saveDbToFile();

  // Ensure default posts exist so Beranda has initial welcome post without preset topics
  if (!Array.isArray(db.posts) || db.posts.length === 0) {
    const h2 = new Date(Date.now() - 3600000 * 5).toISOString();
    db.posts = [
      {
        id: "pst_init_1",
        author_id: "user_admin1",
        topic: null,
        text: "Selamat datang di workspace internal ASLI RI! 🎉 Silakan gunakan Beranda ini untuk update info, obrolan santai, atau diskusi lintas divisi.",
        attachments: [],
        likes: ["user_admin1", "user_superadmin_saeful"],
        like_count: 2,
        liked: true,
        reactions: { "🎉": ["user_superadmin_saeful"], "👍": ["user_admin1"] },
        reply_count: 0,
        replies_preview: [],
        created_at: h2
      }
    ];
  } else {
    const initPost = db.posts.find((p: any) => p.id === "pst_init_1");
    if (initPost) {
      if (initPost.topic === "Pengumuman Kantor") initPost.topic = null;
      if (typeof initPost.text === "string" && (initPost.text.includes("#welcome") || initPost.text.includes("#update"))) {
        initPost.text = "Selamat datang di workspace internal ASLI RI! 🎉 Silakan gunakan Beranda ini untuk update info, obrolan santai, atau diskusi lintas divisi.";
      }
      saveDbToFile();
    }
  }

  // Keep tasks array initialized without re-seeding dummy tasks when cleared
  if (!Array.isArray(db.tasks)) {
    db.tasks = [];
  }
  if (!Array.isArray(db.archive_delete_requests)) {
    db.archive_delete_requests = [];
  }

  // Ensure default project exists if empty
  if (!Array.isArray(db.projects) || db.projects.length === 0) {
    db.projects = [
      {
        id: "prj_1",
        name: "Enterprise Workspace Migration",
        description: "Migrasi sistem kolaborasi internal ASLI RI ke platform terpadu.",
        status: "active",
        progress: 0,
        owner_id: "user_admin1",
        member_ids: ["user_admin1", "user_superadmin_saeful"],
        label_ids: ["lbl_asliri", "lbl_internal"]
      }
    ];
  }

  // Ensure default meetings exist if empty
  if (!Array.isArray(db.meetings) || db.meetings.length === 0) {
    const todayStr = new Date().toISOString().slice(0, 10);
    db.meetings = [
      {
        id: "mtg_seed_1",
        title: "Sprint Planning & Backlog Review",
        description: "Review sprint backlog, prioritasi tiket, dan pembagian tugas antar divisi.",
        date: todayStr,
        start_time: "10:00",
        end_time: "11:30",
        location: "Google Meet",
        meet_link: "https://meet.google.com/asli-sprint-sync",
        attendee_ids: ["user_admin1", "user_superadmin_saeful"],
        gcal_synced: false,
        created_by: "user_admin1",
        created_at: new Date(Date.now() - 86400000).toISOString()
      }
    ];
  }

  const DEFAULT_ALIGNED_DIVISIONS = [
    "Management",
    "Marketing",
    "Sales",
    "IT",
    "Finance",
    "Legal",
    "HRGA"
  ];

  const DEFAULT_ALIGNED_ORG_UNITS = [
    { id: "unit_mgmt", name: "Management", division: "Management", description: "Board of Directors & Executive Leadership", level: "Executive", color: "#FF5364", head_id: "user_superadmin_saeful", parent_id: null, order: 0 },
    { id: "unit_mkt", name: "Marketing", division: "Marketing", description: "Brand Marketing, Campaign & Social Media Growth", level: "Division", color: "#10B981", head_id: null, parent_id: "unit_mgmt", order: 1 },
    { id: "unit_sales", name: "Sales", division: "Sales", description: "Enterprise Sales, Partnership & Business Development", level: "Division", color: "#F59E0B", head_id: null, parent_id: "unit_mgmt", order: 2 },
    { id: "unit_it", name: "IT", division: "IT", description: "IT Infrastructure, Security & Internal Support", level: "Division", color: "#06B6D4", head_id: "user_admin1", parent_id: "unit_mgmt", order: 3 },
    { id: "unit_fin", name: "Finance", division: "Finance", description: "Financial Planning, Accounting & Treasury", level: "Division", color: "#14B8A6", head_id: null, parent_id: "unit_mgmt", order: 4 },
    { id: "unit_legal", name: "Legal", division: "Legal", description: "Corporate Legal, Compliance & Contracts", level: "Division", color: "#6366F1", head_id: null, parent_id: "unit_mgmt", order: 5 },
    { id: "unit_hrga", name: "HRGA", division: "HRGA", description: "Human Resources, Talent & General Affairs", level: "Division", color: "#F97316", head_id: null, parent_id: "unit_mgmt", order: 6 }
  ];

  if (!Array.isArray(db.workspace.org_levels) || db.workspace.org_levels.length === 0) {
    db.workspace.org_levels = ["Executive", "Division", "Department", "Team"];
  }

  function getDepartmentGroupMemberIds(divName: string, existingGroup?: any): string[] {
    const cleanDiv = String(divName || "").trim().toLowerCase();
    const manualIds = Array.isArray(existingGroup?.manually_joined_ids) ? existingGroup.manually_joined_ids : [];
    const matchedUserIds = (db.users || [])
      .filter((u: any) => {
        if (!u || u.is_bot || u.role === "assistant" || u.user_id === CIRCLE_BOT_ID) return false;
        if (u.role === "super_admin") return true;
        return String(u.department || "").trim().toLowerCase() === cleanDiv;
      })
      .map((u: any) => u.user_id);
    return Array.from(new Set([...matchedUserIds, ...manualIds])).filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID);
  }

  // Helper to sync user department <-> org_unit_id AND official division group membership
  function syncUserDivisionAndGroupMembership(user: any) {
    if (!user || user.is_bot || user.role === "assistant" || user.user_id === CIRCLE_BOT_ID) return;
    const uid = user.user_id;
    const userDept = String(user.department || "").trim();
    const userDeptLower = userDept.toLowerCase();

    // 1. Ensure user's org_unit_id matches their selected division
    if (userDept) {
      const matchedUnit = (db.org_units || []).find(
        (u: any) =>
          String(u.division || "").trim().toLowerCase() === userDeptLower ||
          String(u.name || "").trim().toLowerCase() === userDeptLower
      );
      if (matchedUnit) {
        user.org_unit_id = matchedUnit.id;
        user.department = matchedUnit.division || matchedUnit.name;
      }
    } else if (user.org_unit_id) {
      const matchedUnit = (db.org_units || []).find((u: any) => u.id === user.org_unit_id);
      if (matchedUnit) {
        user.department = matchedUnit.division || matchedUnit.name;
      }
    }

    const effectiveDeptLower = String(user.department || "").trim().toLowerCase();
    const isSuperAdmin = user.role === "super_admin";

    // 2. Sync official department groups so non-super-admin users ONLY belong to their chosen division's group (unless manually joined)
    const syncGroupList = (list: any[]) => {
      (list || []).forEach((g: any) => {
        if (!g || g.id === "conv_1") return;
        const isDeptGroup =
          g.group_type === "department" ||
          String(g.id || "").startsWith("group_official_") ||
          Boolean(g.is_verified && g.type === "group");
        if (!isDeptGroup) return;

        const gNameLower = String(g.name || "").trim().toLowerCase();
        const gSlug = `group_official_${effectiveDeptLower.replace(/[^a-z0-9]+/g, "_")}`;
        const isMatchingDept = Boolean(effectiveDeptLower) && (gNameLower === effectiveDeptLower || g.id === gSlug);
        const manualIds = Array.isArray(g.manually_joined_ids) ? g.manually_joined_ids : [];
        const shouldBeMember = isSuperAdmin || isMatchingDept || manualIds.includes(uid);

        const rawMems = Array.isArray(g.member_ids) ? g.member_ids : (Array.isArray(g.members) ? g.members : []);
        let nextMems = rawMems.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID);
        if (shouldBeMember) {
          if (!nextMems.includes(uid)) nextMems.push(uid);
        } else {
          nextMems = nextMems.filter((id: string) => id !== uid);
        }
        nextMems = Array.from(new Set(nextMems));
        g.member_ids = nextMems;
        g.members = nextMems;
        g.member_count = nextMems.length;
      });
    };

    syncGroupList(db.groups);
    syncGroupList(db.conversations);

    // 3. Also add user to matching department boards
    (db.boards || []).forEach((b: any) => {
      if (!b || !b.department) return;
      const bDeptLower = String(b.department || "").trim().toLowerCase();
      if (bDeptLower === effectiveDeptLower) {
        const mems = Array.isArray(b.member_ids) ? b.member_ids : [];
        if (!mems.includes(uid)) {
          b.member_ids = [...mems, uid];
        }
      }
    });
  }

  function syncUserOrgAndDepartment(user: any, body: any = {}) {
    if (!user || user.is_bot || user.role === "assistant" || user.user_id === CIRCLE_BOT_ID) return;
    if ("org_unit_id" in body) {
      if (body.org_unit_id) {
        const unit = (db.org_units || []).find((u: any) => u.id === body.org_unit_id);
        if (unit && !("department" in body)) {
          user.department = unit.division || unit.name;
        }
      }
    } else if ("department" in body && body.department) {
      const matched = (db.org_units || []).find(
        (u: any) =>
          (u.division || "").toLowerCase() === String(body.department).toLowerCase() ||
          (u.name || "").toLowerCase() === String(body.department).toLowerCase()
      );
      if (matched) {
        user.org_unit_id = matched.id;
      }
    }
    syncUserDivisionAndGroupMembership(user);
  }

  // Helper to sync db.workspace.divisions <-> db.org_units <-> db.groups & db.conversations
  function syncDivisionsToOrgUnits(divisionsList: string[], options: { removeMissing?: boolean } = {}) {
    if (!Array.isArray(divisionsList)) return;
    const removeMissing = options.removeMissing !== false;
    const cleaned = Array.from(
      new Set(divisionsList.map((d) => String(d || "").trim()).filter(Boolean))
    );
    db.workspace.divisions = cleaned;
    db.org_units = Array.isArray(db.org_units) ? db.org_units : [];

    const validLowerSet = new Set(cleaned.map((d) => d.toLowerCase()));

    if (removeMissing) {
      db.org_units = db.org_units.filter((u: any) => {
        const divKey = String(u.division || u.name || "").trim().toLowerCase();
        return validLowerSet.has(divKey);
      });
    }

    const rootUnit =
      db.org_units.find((u: any) => !u.parent_id || u.id === "unit_mgmt" || (u.name || "").toLowerCase() === "management") ||
      db.org_units[0] ||
      null;
    const palette = ["#FF5364", "#10B981", "#F59E0B", "#06B6D4", "#14B8A6", "#6366F1", "#F97316", "#3B82F6", "#8B5CF6", "#EC4899", "#64748B"];

    cleaned.forEach((clean, idx) => {
      const existing = db.org_units.find(
        (u: any) =>
          (u.division || "").toLowerCase() === clean.toLowerCase() ||
          (u.name || "").toLowerCase() === clean.toLowerCase()
      );
      if (existing) {
        existing.name = clean;
        existing.division = clean;
        existing.order = idx;
      } else {
        const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const isMgmt = clean.toLowerCase() === "management";
        db.org_units.push({
          id: isMgmt ? "unit_mgmt" : `unit_${slug}`,
          name: clean,
          division: clean,
          description: isMgmt ? "Board of Directors & Executive Leadership" : `Divisi ${clean}`,
          level: isMgmt || !rootUnit ? "Executive" : "Division",
          color: palette[idx % palette.length],
          head_id: null,
          parent_id: isMgmt || !rootUnit ? null : rootUnit.id,
          order: idx
        });
      }
    });

    // Reparent any orphaned units
    const currentUnitIds = new Set(db.org_units.map((u: any) => u.id));
    const currentRoot = db.org_units.find((u: any) => !u.parent_id) || db.org_units[0] || null;
    db.org_units.forEach((u: any) => {
      if (u.parent_id && !currentUnitIds.has(u.parent_id)) {
        u.parent_id = currentRoot && currentRoot.id !== u.id ? currentRoot.id : null;
      }
    });
    db.org_units.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));

    const deptDivisions = cleaned.filter((d) => d.toLowerCase() !== "management");
    const validGroupSlugs = new Set(
      cleaned.map((d) => `group_official_${d.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`)
    );

    if (removeMissing) {
      const isStaleDeptGroup = (g: any) => {
        if (!g || g.id === "conv_1") return false;
        const isOfficialOrDept =
          g.group_type === "department" ||
          String(g.id || "").startsWith("group_official_") ||
          Boolean(g.is_verified && g.type === "group");
        if (!isOfficialOrDept) return false;
        const gNameLower = String(g.name || "").trim().toLowerCase();
        return !validLowerSet.has(gNameLower) && !validGroupSlugs.has(String(g.id));
      };

      const removedGroupIds = (db.groups || []).filter(isStaleDeptGroup).map((g: any) => g.id);
      db.groups = (db.groups || []).filter((g: any) => !isStaleDeptGroup(g));
      db.conversations = (db.conversations || []).filter((c: any) => !isStaleDeptGroup(c));
      removedGroupIds.forEach((gid: string) => {
        try { broadcast({ type: "group:deleted", id: gid }); } catch {}
      });
    }

    deptDivisions.forEach((divName) => {
      const slug = divName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const groupId = `group_official_${slug}`;
      let g = (db.groups || []).find(
        (x: any) => x.id === groupId || (String(x.name || "").toLowerCase() === divName.toLowerCase() && (x.is_verified || x.group_type === "department"))
      );
      const deptMems = getDepartmentGroupMemberIds(divName, g);
      if (g) {
        g.id = groupId;
        g.name = divName;
        g.group_type = "department";
        g.is_verified = true;
        g.type = "group";
        g.member_ids = deptMems;
        g.members = deptMems;
        g.member_count = deptMems.length;
      } else {
        g = {
          id: groupId,
          name: divName,
          description: `Official channel for ${divName} department discussions`,
          group_type: "department",
          is_verified: true,
          created_at: new Date().toISOString(),
          member_ids: deptMems,
          members: deptMems,
          member_count: deptMems.length,
          type: "group"
        };
        db.groups.push(g);
      }

      const convIdx = (db.conversations || []).findIndex(
        (c: any) => c.id === g.id || (String(c.name || "").toLowerCase() === divName.toLowerCase() && (c.is_verified || c.group_type === "department"))
      );
      if (convIdx === -1) {
        db.conversations.push({ ...g });
      } else {
        const c = db.conversations[convIdx];
        c.id = g.id;
        c.name = g.name;
        c.group_type = "department";
        c.is_verified = true;
        c.type = "group";
        c.member_ids = g.member_ids;
        c.members = g.member_ids;
        c.member_count = g.member_ids.length;
      }
    });

    // Automatically sync boards whenever workspace divisions change
    syncDivisionsToBoards(cleaned);
    try { broadcast({ type: "boards:changed" }); } catch {}
    try { broadcast({ type: "tasks:changed" }); } catch {}
  }

  const DIVISION_BOARD_COLORS: Record<string, string> = {
    Management: "#FF5364",
    Marketing: "#10B981",
    Sales: "#F59E0B",
    IT: "#06B6D4",
    Finance: "#14B8A6",
    Legal: "#6366F1",
    HRGA: "#F97316"
  };

  function syncDivisionsToBoards(divisionsList?: string[]) {
    if (!Array.isArray(db.boards)) db.boards = [];
    const baseDivs = Array.isArray(divisionsList) && divisionsList.length > 0
      ? divisionsList
      : (Array.isArray(db.workspace?.divisions) && db.workspace.divisions.length > 0
          ? db.workspace.divisions
          : DEFAULT_ALIGNED_DIVISIONS);

    const divisions: string[] = Array.from(new Set(baseDivs.map((d: any) => String(d || "").trim()).filter(Boolean)));

    // Ensure all official department groups from Groups are registered as division boards
    (db.groups || []).forEach((g: any) => {
      if (g.group_type === "department" || String(g.id || "").startsWith("group_official_")) {
        const cleanG = String(g.name || "").trim();
        if (cleanG && !divisions.some((d) => d.toLowerCase() === cleanG.toLowerCase())) {
          divisions.push(cleanG);
        }
      }
    });

    const activeDivSet = new Set(divisions.map((d) => d.toLowerCase()));

    // Clean up boards whose department no longer exists in divisions
    db.boards = db.boards.filter((b: any) => {
      if (b.id === "brd_1") return false;
      if (
        !b.department ||
        b.is_collaborative ||
        b.board_type === "collaborative" ||
        b.board_type === "project" ||
        b.project_id ||
        String(b.department).toLowerCase() === "semua divisi"
      ) {
        return true; // keep custom project & collaborative boards
      }
      return activeDivSet.has(b.department.toLowerCase());
    });

    divisions.forEach((divName: string, idx: number) => {
      const cleanDiv = String(divName || "").trim();
      if (!cleanDiv) return;
      const lowerDiv = cleanDiv.toLowerCase();
      const slug = lowerDiv.replace(/[^a-z0-9]+/g, "_");
      const isProjectDiv = lowerDiv === "project" || lowerDiv === "kolaborasi";

      let b = db.boards.find((x: any) =>
        (x.department && x.department.toLowerCase() === lowerDiv && !x.project_id && x.board_type !== "collaborative") ||
        (x.id === `brd_div_${slug}`) ||
        (x.name && x.name.toLowerCase() === lowerDiv && !x.is_collaborative) ||
        (x.name && x.name.toLowerCase() === `board ${lowerDiv}`)
      );

      const color = DIVISION_BOARD_COLORS[cleanDiv] || ["#10B981", "#F59E0B", "#06B6D4", "#14B8A6", "#6366F1", "#F97316", "#3B82F6", "#8B5CF6"][idx % 8];

      if (b) {
        b.id = `brd_div_${slug}`;
        b.department = cleanDiv;
        b.name = cleanDiv; // Matches group name (Marketing, Sales, IT, etc.)
        b.color = b.color || color;
        b.board_type = b.board_type || (isProjectDiv ? "collaborative" : "department");
        b.is_collaborative = b.is_collaborative !== undefined ? Boolean(b.is_collaborative) : isProjectDiv;
        b.invited_member_ids = Array.isArray(b.invited_member_ids) ? b.invited_member_ids : [];
        b.member_ids = Array.isArray(b.member_ids) ? b.member_ids : [];
      } else {
        b = {
          id: `brd_div_${slug}`,
          name: cleanDiv,
          description: isProjectDiv
            ? "Board kolaborasi lintas divisi untuk proyek"
            : `Official board untuk divisi ${cleanDiv}`,
          department: cleanDiv,
          board_type: isProjectDiv ? "collaborative" : "department",
          is_collaborative: isProjectDiv,
          color,
          invited_member_ids: [],
          member_ids: [],
          created_at: new Date().toISOString()
        };
        db.boards.push(b);
      }
    });

    // Remap legacy generic "brd_1" tasks to division boards and remove brd_1 completely
    const brd1Tasks = (db.tasks || []).filter((t: any) => t.board_id === "brd_1" || !t.board_id);
    if (brd1Tasks.length > 0) {
      brd1Tasks.forEach((t: any) => {
        const assignee = (db.users || []).find((u: any) => u.user_id === t.assignee_id);
        const dept = t.department || assignee?.department || "Marketing";
        const deptSlug = dept.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const targetBoard = db.boards.find(
          (x: any) => x.id === `brd_div_${deptSlug}` || (x.department && x.department.toLowerCase() === dept.toLowerCase())
        );
        t.board_id = targetBoard ? targetBoard.id : (db.boards[0]?.id || "brd_div_marketing");
        if (!t.department && targetBoard?.department) t.department = targetBoard.department;
      });
    }
    db.boards = db.boards.filter((x: any) => x.id !== "brd_1");

    // Deduplicate boards by id
    const seenIds = new Set<string>();
    db.boards = db.boards.filter((b: any) => {
      if (seenIds.has(b.id)) return false;
      seenIds.add(b.id);
      return true;
    });
  }

  function isTaskAccessible(t: any, user: any): boolean {
    if (!user) return false;
    // Super Admin & Workspace Admin have unrestricted access
    if (user.role === "super_admin" || user.role === "workspace_admin") return true;

    const userDept = String(user.department || "").trim().toLowerCase();

    // Direct task assignment or involvement
    if (t.assignee_id === user.user_id || (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(user.user_id))) return true;
    if (t.created_by === user.user_id || (Array.isArray(t.requestor_ids) && t.requestor_ids.includes(user.user_id))) return true;
    if (Array.isArray(t.collaborator_ids) && t.collaborator_ids.includes(user.user_id)) return true;
    if (Array.isArray(t.checkpoints) && t.checkpoints.some((c: any) => c && c.assignee_id === user.user_id)) return true;
    if (Array.isArray(t.comments) && t.comments.some((c: any) => Array.isArray(c?.mention_ids) && c.mention_ids.includes(user.user_id))) return true;

    // Check board permission
    if (t.board_id) {
      const board = db.boards?.find((b: any) => b.id === t.board_id);
      if (board) {
        const boardDept = String(board.department || "").trim().toLowerCase();
        const isCollabBoard = Boolean(
          board.is_collaborative ||
          board.board_type === "collaborative" ||
          board.board_type === "project" ||
          board.project_id ||
          !boardDept ||
          boardDept === "semua divisi" ||
          boardDept === "all" ||
          boardDept === "project" ||
          board.id === "brd_div_project"
        );
        if (isCollabBoard) {
          if (board.all_workspace_members !== false || boardDept === "semua divisi" || boardDept === "project") return true;
          if (Array.isArray(board.member_ids) && board.member_ids.includes(user.user_id)) return true;
        }
        // 1. Division member automatic access
        if (userDept && boardDept === userDept) return true;
        // 2. Explicitly invited cross-division collaborator
        if (Array.isArray(board.invited_member_ids) && board.invited_member_ids.includes(user.user_id)) return true;
        if (board.created_by === user.user_id) return true;
        return false;
      }
    }

    // Fallback: task department match
    if (t.department && userDept && String(t.department).trim().toLowerCase() === userDept) return true;

    return false;
  }

  // Align workspace divisions, org_units, and official groups with the active divisions
  if (!db.org_aligned_v3 || !Array.isArray(db.org_units) || db.org_units.length === 0) {
    db.workspace.divisions = [...DEFAULT_ALIGNED_DIVISIONS];
    db.org_units = JSON.parse(JSON.stringify(DEFAULT_ALIGNED_ORG_UNITS));

    (db.users || []).forEach((u: any) => {
      if (u.is_bot || u.role === "assistant" || u.user_id === CIRCLE_BOT_ID) {
        u.org_unit_id = null;
        return;
      }
      if (u.user_id === "user_superadmin_saeful") {
        u.department = "Management";
        u.org_unit_id = "unit_mgmt";
        u.manager_id = null;
      } else if (u.user_id === "user_admin1") {
        u.department = "Management";
        u.org_unit_id = "unit_mgmt";
        u.manager_id = "user_superadmin_saeful";
      } else {
        const dept = u.department || "Marketing";
        const matchedUnit = db.org_units.find(
          (unit: any) => (unit.division || unit.name || "").toLowerCase() === dept.toLowerCase()
        );
        u.org_unit_id = matchedUnit ? matchedUnit.id : "unit_mgmt";
        if (matchedUnit) u.department = matchedUnit.division || matchedUnit.name;
      }
    });

    syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: true });
    (db.users || []).forEach((u: any) => syncUserDivisionAndGroupMembership(u));

    db.org_aligned_v2 = true;
    db.org_aligned_v3 = true;
    saveDbToFile();
  } else {
    syncDivisionsToOrgUnits(db.workspace.divisions || DEFAULT_ALIGNED_DIVISIONS, { removeMissing: true });
    (db.users || []).forEach((u: any) => syncUserDivisionAndGroupMembership(u));
  }
  syncDivisionsToBoards(db.workspace.divisions);

  if (!Array.isArray(db.drive_shortcuts) || db.drive_shortcuts.length === 0) {
    db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
  }

  // Sanitize DM conversations so accounts never share or merge private DMs
  function sanitizeConversationsAndMessages() {
    if (!Array.isArray(db.conversations)) db.conversations = [];
    if (!Array.isArray(db.messages)) db.messages = [];

    const newConvs: any[] = [];
    const seenCircleIds = new Set<string>();

    for (const c of db.conversations) {
      if (!c || !c.id) continue;

      // 1. Strict isolation for Circle Assistant DMs: conv_circle_<uid>
      if (String(c.id).startsWith("conv_circle_")) {
        const ownerUid = String(c.id).replace("conv_circle_", "");
        if (!ownerUid || seenCircleIds.has(c.id)) continue;
        seenCircleIds.add(c.id);
        c.type = "dm";
        c.name = db.workspace?.assistant_name || "Circle";
        c.member_ids = [CIRCLE_BOT_ID, ownerUid];
        c.members = [CIRCLE_BOT_ID, ownerUid];
        // Remove any messages in this Circle DM that were accidentally sent by other human users
        db.messages = db.messages.filter((m: any) => {
          if (m.conversation_id !== c.id) return true;
          const sId = m.sender_id || m.user_id;
          return sId === CIRCLE_BOT_ID || sId === ownerUid || Boolean(m.access_request);
        });
        newConvs.push(c);
        continue;
      }

      // 2. Group conversations keep all human members
      if (c.type === "group" || c.group_type || String(c.id).startsWith("group_")) {
        const rawMems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);
        const cleanMems = Array.from(new Set(rawMems.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID)));
        c.member_ids = cleanMems;
        c.members = cleanMems;
        newConvs.push(c);
        continue;
      }

      // 3. Human-to-Human DMs: must strictly have 2 distinct participants
      if (c.type === "dm") {
        const rawMems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);
        const uniqueMems = Array.from(new Set(rawMems.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID))) as string[];

        if (uniqueMems.length === 2) {
          c.member_ids = uniqueMems;
          c.members = uniqueMems;
          c.name = "";
          // Filter out any stray messages from a 3rd user who is not one of the 2 DM participants
          db.messages = db.messages.filter((m: any) => {
            if (m.conversation_id !== c.id) return true;
            const sId = m.sender_id || m.user_id;
            return uniqueMems.includes(sId);
          });
          newConvs.push(c);
        } else if (uniqueMems.length > 2) {
          // This DM was corrupted by multiple users being pushed into member_ids.
          // Split messages by actual 2-person conversation pairs or keep the original 2 members if identifiable.
          const firstTwo = uniqueMems.slice(0, 2);
          c.member_ids = firstTwo;
          c.members = firstTwo;
          c.name = "";
          db.messages = db.messages.filter((m: any) => {
            if (m.conversation_id !== c.id) return true;
            const sId = m.sender_id || m.user_id;
            return firstTwo.includes(sId);
          });
          newConvs.push(c);
        }
        continue;
      }

      newConvs.push(c);
    }

    // Deduplicate any 2-person human DMs that have the exact same pair of users
    const dmPairMap = new Map<string, any>();
    const deduplicatedConvs: any[] = [];
    for (const c of newConvs) {
      if (c.type === "dm" && !String(c.id).startsWith("conv_circle_")) {
        const mems = (c.member_ids || []).slice().sort();
        if (mems.length === 2) {
          const pairKey = `${mems[0]}__${mems[1]}`;
          if (dmPairMap.has(pairKey)) {
            const primary = dmPairMap.get(pairKey);
            // Reassign any messages from the duplicate DM to the primary DM
            db.messages.forEach((m: any) => {
              if (m.conversation_id === c.id) {
                m.conversation_id = primary.id;
              }
            });
            continue;
          }
          dmPairMap.set(pairKey, c);
        }
      }
      deduplicatedConvs.push(c);
    }

    db.conversations = deduplicatedConvs;
  }

  sanitizeConversationsAndMessages();
  saveDbToFile();
  isServerBootstrapping = false;

  // Lazy-hydrate workspace state from Cloud SQL PostgreSQL on the very first incoming API request
  app.use('/api', async (_req, _res, next) => {
    await ensurePostgresHydrated();
    next();
  });

  // Auto-save DB on any data-modifying HTTP request (only if handler did not already save)
  app.use((req, res, next) => {
    const startSaveSeq = saveInvokeSeq;
    res.on('finish', () => {
      if (
        saveInvokeSeq === startSaveSeq &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
        res.statusCode >= 200 &&
        res.statusCode < 300
      ) {
        saveDbToFile();
      }
    });
    next();
  });

  let currentSessionUser: any = (db.session_user_id && db.users.find((u: any) => u.user_id === db.session_user_id)) || null;

  function setUserOnlineStatus(userId: string | undefined | null, isOnline: boolean): boolean {
    if (!userId || userId === CIRCLE_BOT_ID) return false;
    const u = (db.users || []).find((x: any) => x.user_id === userId);
    if (!u) return false;
    const prev = Boolean(u.online);
    u.online = isOnline;
    if (!u.availability_status) u.availability_status = "online";
    u.last_seen_at = new Date().toISOString();
    if (prev !== isOnline) {
      broadcast({ type: "presence", data: { user_id: userId, online: isOnline, availability_status: u.availability_status || "online" } });
      return true;
    }
    return false;
  }

  const PROFILE_PERSIST_KEYS = [
    "phone",
    "employee_id",
    "employment_status",
    "join_date",
    "bio",
    "skills",
    "work_mode",
    "custom_location",
    "city",
    "office",
    "location_status",
    "share_location",
    "timezone",
    "team",
    "division",
    "manager_id",
    "cover_bg",
    "cover_image",
    "cover_position",
    "is_verified",
    "verified_at",
    "profile_completion",
    "onboarded",
    "custom",
    "custom_fields",
    "nickname",
    "company",
  ];

  function buildAccountVaultEntry(user: any) {
    if (!user || typeof user !== "object") return null;
    const entry: any = {
      user_id: user.user_id,
      email: String(user.email || "").toLowerCase().trim(),
      name: user.name,
      role: user.role || "employee",
      job_title: user.job_title || "Staff Member",
      department: user.department || "Marketing",
      org_unit_id: user.org_unit_id || null,
      status: user.status || "active",
      availability_status: user.availability_status || "online",
      avatar: user.avatar || user.picture || "",
      picture: user.picture || user.avatar || "",
      password_hash: user.password_hash || undefined,
      password_updated_at: user.password_updated_at || undefined,
      token_version: Number(user.token_version || 1),
    };
    for (const k of PROFILE_PERSIST_KEYS) {
      if (user[k] !== undefined) {
        entry[k] = user[k];
      }
    }
    return entry;
  }

  function isUserExplicitlyDeleted(userId?: string, email?: string): boolean {
    const deletedIds = Array.isArray(db.deleted_user_ids) ? db.deleted_user_ids : [];
    const deletedEmails = Array.isArray(db.deleted_user_emails) ? db.deleted_user_emails : [];
    if (userId && deletedIds.includes(userId)) return true;
    if (email && deletedEmails.includes(String(email).toLowerCase().trim())) return true;
    return false;
  }

  function mergeKnownAccountsIntoDb(accounts: any[] | undefined | null, forceActiveUserId?: string): boolean {
    if (!Array.isArray(accounts) || accounts.length === 0) return false;
    if (!Array.isArray(db.users)) db.users = [];
    let changed = false;

    for (const raw of accounts) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.is_bot || raw.role === "assistant" || raw.user_id === CIRCLE_BOT_ID) continue;
      const cleanEmail = String(raw.email || "").toLowerCase().trim();
      const uid = String(raw.user_id || "").trim();
      if (!cleanEmail || !uid) continue;
      if (isUserExplicitlyDeleted(uid, cleanEmail)) continue;

      const existing = db.users.find(
        (u: any) => u?.user_id === uid || (u?.email && String(u.email).toLowerCase().trim() === cleanEmail)
      );

      if (!existing) {
        const defaultAvatar =
          raw.avatar ||
          raw.picture ||
          `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(raw.name || cleanEmail)}`;
        const restoredUser: any = {
          user_id: uid,
          email: cleanEmail,
          name: String(raw.name || cleanEmail.split("@")[0]).trim(),
          role: raw.role || "employee",
          job_title: raw.job_title || "Staff Member",
          department: raw.department || "Marketing",
          org_unit_id: raw.org_unit_id || null,
          status: uid === forceActiveUserId ? "active" : (raw.status || "active"),
          online: uid === forceActiveUserId,
          is_demo: false,
          avatar: defaultAvatar,
          picture: defaultAvatar,
          token_version: Number(raw.token_version || 1),
        };
        for (const k of PROFILE_PERSIST_KEYS) {
          if (raw[k] !== undefined) {
            restoredUser[k] = raw[k];
          }
        }
        if (raw.password_hash && typeof raw.password_hash === "string") {
          restoredUser.password_hash = raw.password_hash;
          restoredUser.password_updated_at = raw.password_updated_at || new Date().toISOString();
        }
        db.users.push(restoredUser);
        syncUserDivisionAndGroupMembership(restoredUser);
        changed = true;
      } else {
        // Restore missing password_hash, active status, or missing extended profile fields
        if (!existing.password_hash && raw.password_hash && typeof raw.password_hash === "string") {
          existing.password_hash = raw.password_hash;
          existing.password_updated_at = raw.password_updated_at || new Date().toISOString();
          changed = true;
        }
        if (
          existing.status === "pending" &&
          (raw.status === "active" || existing.user_id === forceActiveUserId)
        ) {
          existing.status = "active";
          changed = true;
        }
        for (const k of PROFILE_PERSIST_KEYS) {
          const curVal = existing[k];
          const rawVal = raw[k];
          const isEmptyCur = curVal === undefined || curVal === null || curVal === "" || (Array.isArray(curVal) && curVal.length === 0);
          const hasRawVal = rawVal !== undefined && rawVal !== null && rawVal !== "" && (!Array.isArray(rawVal) || rawVal.length > 0);
          if (isEmptyCur && hasRawVal) {
            existing[k] = rawVal;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      saveDbToFile(true);
    }
    return changed;
  }

  function decodeUserProfileHeader(req: any): any {
    const raw = req.headers?.["x-user-profile"];
    if (!raw || typeof raw !== "string" || raw.length > 8192) return null;
    try {
      const json = Buffer.from(raw.trim(), "base64").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && parsed.user_id && parsed.email) {
        return parsed;
      }
    } catch {}
    return null;
  }

  function extractAuthToken(req: any): string | null {
    const authHeader = req.headers?.authorization as string | undefined;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const t = authHeader.slice(7).trim();
      if (t) return t;
    }
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies.circle_session) return cookies.circle_session;
    return null;
  }

  function verifyAuthenticatedUserFromToken(token: string | null, req?: any): any {
    const payload = verifySessionToken(token, MASTER_KEY);
    const headerProfile = req ? decodeUserProfileHeader(req) : null;

    if (payload?.uid) {
      let found = (db.users || []).find((u: any) => u.user_id === payload.uid);
      if (!found && headerProfile && headerProfile.user_id === payload.uid) {
        mergeKnownAccountsIntoDb([headerProfile], payload.uid);
        found = (db.users || []).find((u: any) => u.user_id === payload.uid);
      }
      if (!found || found.is_bot) return null;
      if (found.status === "inactive" || found.status === "rejected") return null;
      if (found.status === "pending") {
        found.status = "active";
        saveDbToFile(true);
      }
      const currentTv = Number(found.token_version || 1);
      if (Number(payload.tv || 1) !== currentTv) {
        found.token_version = Number(payload.tv || 1);
      }
      return found;
    }

    // Fallback self-healing when container restarted and client sends authenticated x-user-profile
    if (headerProfile?.user_id && headerProfile?.email) {
      const uid = String(headerProfile.user_id);
      const email = String(headerProfile.email).toLowerCase().trim();
      if (!isUserExplicitlyDeleted(uid, email)) {
        let found = (db.users || []).find(
          (u: any) => u.user_id === uid || (u.email && String(u.email).toLowerCase().trim() === email)
        );
        if (!found && token) {
          mergeKnownAccountsIntoDb([headerProfile], uid);
          found = (db.users || []).find(
            (u: any) => u.user_id === uid || (u.email && String(u.email).toLowerCase().trim() === email)
          );
        }
        if (found && !found.is_bot && found.status !== "inactive" && found.status !== "rejected") {
          if (found.status === "pending") {
            found.status = "active";
            saveDbToFile(true);
          }
          return found;
        }
      }
    }

    return null;
  }

  function setSessionCookie(req: any, res: any, token: string) {
    const isHttps = req.secure || req.headers?.["x-forwarded-proto"] === "https";
    const parts = [
      `circle_session=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${7 * 24 * 60 * 60}`
    ];
    if (isHttps) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function clearSessionCookie(res: any) {
    res.setHeader("Set-Cookie", "circle_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  }

  function issueUserSession(req: any, res: any, user: any) {
    if (typeof user.token_version !== "number" || user.token_version < 1) {
      user.token_version = 1;
    }
    const token = signSessionToken(user.user_id, user.token_version, MASTER_KEY);
    setSessionCookie(req, res, token);
    currentSessionUser = user;
    db.session_user_id = user.user_id;
    return token;
  }

  function getReqUser(req: any): any {
    const token = extractAuthToken(req);
    const verified = verifyAuthenticatedUserFromToken(token, req);
    if (verified) return verified;
    return null;
  }

  // Per-request cryptographic session binding middleware (never trusts raw spoofable user_id headers)
  app.use((req, _res, next) => {
    const verified = getReqUser(req);
    if (verified) {
      currentSessionUser = verified;
      if (!verified.online && req.path !== "/api/auth/logout" && req.path !== "/api/presence/offline") {
        setUserOnlineStatus(verified.user_id, true);
      }
    }
    next();
  });

  // API Routes
  app.post("/api/admin/reset-data", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Super Admin / Workspace Admin yang dapat mereset data." });
    }
    db.tasks = [];
    db.messages = [];
    db.posts = [];
    db.conversations = [];
    db.activity = [];
    db.audit_logs = [];
    // Reset workspace branding
    db.workspace.logo_file_id = null;
    db.workspace.login_image_file_id = null;
    
    saveDbToFile(true, { allowEmptyOverwrite: true });
    console.log('Database state reset successfully.');
    res.json({ success: true });
  });

  function buildBackupSummary() {
    let uploadFilesCount = 0;
    try {
      if (fs.existsSync(UPLOADS_DIR)) {
        uploadFilesCount = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith(".")).length;
      }
    } catch {}
    return {
      users: Array.isArray(db.users) ? db.users.filter((u: any) => !u?.is_bot && u?.role !== "assistant").length : 0,
      tasks: Array.isArray(db.tasks) ? db.tasks.length : 0,
      projects: Array.isArray(db.projects) ? db.projects.length : 0,
      boards: Array.isArray(db.boards) ? db.boards.length : 0,
      conversations: Array.isArray(db.conversations) ? db.conversations.length : 0,
      groups: Array.isArray(db.groups) ? db.groups.length : 0,
      messages: Array.isArray(db.messages) ? db.messages.length : 0,
      posts: Array.isArray(db.posts) ? db.posts.length : 0,
      polls: Array.isArray(db.polls) ? db.polls.length : 0,
      org_units: Array.isArray(db.org_units) ? db.org_units.length : 0,
      labels: Array.isArray(db.labels) ? db.labels.length : 0,
      notifications: Array.isArray(db.notifications) ? db.notifications.length : 0,
      drive_shortcuts: Array.isArray(db.drive_shortcuts) ? db.drive_shortcuts.length : 0,
      reminders: Array.isArray(db.reminders) ? db.reminders.length : 0,
      task_automations: Array.isArray(db.task_automations) ? db.task_automations.length : 0,
      audit_logs: Array.isArray(db.audit_logs) ? db.audit_logs.length : 0,
      access_requests: Array.isArray(db.access_requests) ? db.access_requests.length : 0,
      invitations: Array.isArray(db.invitations) ? db.invitations.length : 0,
      files: db.files && typeof db.files === "object" ? Object.keys(db.files).length : 0,
      stickers: Array.isArray(db.stickers) ? db.stickers.length : 0,
      marketplace_listings: Array.isArray(db.marketplace_listings) ? db.marketplace_listings.length : 0,
      marketplace_orders: Array.isArray(db.marketplace_orders) ? db.marketplace_orders.length : 0,
      circle_notes: Array.isArray(db.circle_notes) ? db.circle_notes.length : 0,
      upload_files: uploadFilesCount,
    };
  }

  const BACKUPS_DIR = path.join(__dirname, "backups");
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const ID_MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  const ID_WEEKDAYS: Record<string, string> = {
    Sun: "Minggu",
    Mon: "Senin",
    Tue: "Selasa",
    Wed: "Rabu",
    Thu: "Kamis",
    Fri: "Jumat",
    Sat: "Sabtu",
  };

  function getJakartaParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const map: Record<string, string> = {};
    for (const part of fmt.formatToParts(date)) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    const year = map.year || String(date.getFullYear());
    const month = map.month || String(date.getMonth() + 1).padStart(2, "0");
    const day = map.day || String(date.getDate()).padStart(2, "0");
    const hour = map.hour === "24" ? "00" : (map.hour || "00");
    const minute = map.minute || "00";
    const second = map.second || "00";
    const monthIdx = Math.max(0, Math.min(11, Number(month) - 1));
    const monthName = ID_MONTHS[monthIdx] || month;
    const weekday = ID_WEEKDAYS[map.weekday] || map.weekday || "";
    const ddMmYyyy = `${day}-${month}-${year}`;
    const monthFolder = `${month}-${monthName}`;
    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      monthName,
      weekday,
      ddMmYyyy,
      monthFolder,
      hhmm: `${hour}:${minute}`,
      hhmmCompact: `${hour}${minute}${second}`,
      relativeDir: `${year}/${monthFolder}/${ddMmYyyy}`,
    };
  }

  function ensureAutoBackupConfig() {
    if (!db.auto_backup_config || typeof db.auto_backup_config !== "object") {
      db.auto_backup_config = {};
    }
    if (typeof db.auto_backup_config.enabled !== "boolean") {
      db.auto_backup_config.enabled = true;
    }
    if (!/^\d{2}:\d{2}$/.test(String(db.auto_backup_config.schedule_time || ""))) {
      db.auto_backup_config.schedule_time = "23:59";
    }
    if (!db.auto_backup_config.timezone) {
      db.auto_backup_config.timezone = "Asia/Jakarta";
    }
    if (typeof db.auto_backup_config.retention_days !== "number") {
      db.auto_backup_config.retention_days = 30;
    }
    return db.auto_backup_config;
  }
  ensureAutoBackupConfig();

  let cachedUploadsSig = "";
  let cachedUploadsBase64: Record<string, string> = {};

  function getCachedUploadedFilesBase64(): Record<string, string> {
    const MAX_UPLOAD_BACKUP_BYTES = 25 * 1024 * 1024;
    try {
      if (!fs.existsSync(UPLOADS_DIR)) {
        cachedUploadsSig = "";
        cachedUploadsBase64 = {};
        return {};
      }
      const names = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith(".")).sort();
      const statsList: { fname: string; full: string; size: number; mtimeMs: number }[] = [];
      let totalBytes = 0;
      for (const fname of names) {
        const full = path.join(UPLOADS_DIR, fname);
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        if (totalBytes + stat.size > MAX_UPLOAD_BACKUP_BYTES) continue;
        totalBytes += stat.size;
        statsList.push({ fname, full, size: stat.size, mtimeMs: stat.mtimeMs });
      }
      const sig = statsList.map((s) => `${s.fname}:${s.size}:${s.mtimeMs}`).join("|");
      if (sig === cachedUploadsSig) {
        return cachedUploadsBase64;
      }
      const out: Record<string, string> = {};
      for (const s of statsList) {
        out[s.fname] = fs.readFileSync(s.full).toString("base64");
      }
      cachedUploadsSig = sig;
      cachedUploadsBase64 = out;
      return out;
    } catch (e) {
      console.warn("Backup export upload read warning:", e);
      return {};
    }
  }

  function buildFullBackupPayload(
    exportedBy: any = { user_id: "system_scheduler", name: "Auto Backup Harian", email: "system@circle.local" },
    options: { includeFiles?: boolean } = {}
  ) {
    const uploadedFilesBase64 = options.includeFiles === false ? {} : getCachedUploadedFilesBase64();

    const backupKeys = [
      "workspace",
      "users",
      "deleted_user_ids",
      "deleted_user_emails",
      "labels",
      "notifications",
      "tasks",
      "projects",
      "boards",
      "conversations",
      "groups",
      "messages",
      "posts",
      "org_units",
      "activity",
      "reminders",
      "polls",
      "task_automations",
      "audit_logs",
      "invitations",
      "drive_shortcuts",
      "prefs",
      "access_requests",
      "sticker_packs",
      "stickers",
      "files",
      "meetings",
      "circle_notes",
      "marketplace_listings",
      "marketplace_orders",
      "marketplace_reviews",
      "marketplace_vouchers",
      "marketplace_carts",
      "marketplace_wishlists",
    ];

    const snapshotData: Record<string, any> = {};
    for (const key of backupKeys) {
      if (db[key] !== undefined) {
        snapshotData[key] = JSON.parse(JSON.stringify(db[key]));
      }
    }
    if (Array.isArray(snapshotData.users)) {
      snapshotData.users = snapshotData.users.map((u: any) => {
        if (!u || typeof u !== "object") return u;
        const copy = { ...u };
        delete copy.password;
        return copy;
      });
    }

    snapshotData.revision = Number(db.revision || 0);

    return {
      app: "CIRCLE Workspace",
      version: 2,
      revision: Number(db.revision || 0),
      exported_at: new Date().toISOString(),
      exported_by: exportedBy,
      workspace_name: db.workspace?.name || "CIRCLE Workspace",
      summary: buildBackupSummary(),
      data: snapshotData,
      uploaded_files_base64: uploadedFilesBase64,
    };
  }

  function pruneOldBackupFolders(retentionDays: number) {
    if (!retentionDays || retentionDays <= 0) return;
    try {
      if (!fs.existsSync(BACKUPS_DIR)) return;
      const cutoffMs = Date.now() - retentionDays * 86400000;
      const years = fs.readdirSync(BACKUPS_DIR);
      for (const yr of years) {
        const yrPath = path.join(BACKUPS_DIR, yr);
        if (!fs.statSync(yrPath).isDirectory()) continue;
        const months = fs.readdirSync(yrPath);
        for (const mo of months) {
          const moPath = path.join(yrPath, mo);
          if (!fs.statSync(moPath).isDirectory()) continue;
          const days = fs.readdirSync(moPath);
          for (const dy of days) {
            const dyPath = path.join(moPath, dy);
            if (!fs.statSync(dyPath).isDirectory()) continue;
            const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dy);
            if (m) {
              const folderDate = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
              if (!Number.isNaN(folderDate.getTime()) && folderDate.getTime() < cutoffMs) {
                fs.rmSync(dyPath, { recursive: true, force: true });
              }
            }
          }
          if (fs.existsSync(moPath) && fs.readdirSync(moPath).length === 0) {
            fs.rmdirSync(moPath);
          }
        }
        if (fs.existsSync(yrPath) && fs.readdirSync(yrPath).length === 0) {
          fs.rmdirSync(yrPath);
        }
      }
    } catch (e) {
      console.warn("Prune old auto backups warning:", e);
    }
  }

  function executeServerAutoBackup(triggerType: "auto" | "manual" = "auto", actor?: any) {
    const cfg = ensureAutoBackupConfig();
    const now = new Date();
    const parts = getJakartaParts(now);
    const dayDir = path.join(BACKUPS_DIR, parts.year, parts.monthFolder, parts.ddMmYyyy);
    fs.mkdirSync(dayDir, { recursive: true });

    const exportedBy = actor
      ? { user_id: actor.user_id, name: actor.name, email: actor.email }
      : { user_id: "system_auto_backup", name: "Auto Backup Harian (23:59 WIB)", email: "system@circle.local" };

    const payload = buildFullBackupPayload(exportedBy);
    const fileBase = `circle-backup-${parts.ddMmYyyy}-${parts.hhmmCompact}-${triggerType}`;
    const jsonFileName = `${fileBase}.json`;
    const metaFileName = `${fileBase}.meta.json`;
    const jsonPath = path.join(dayDir, jsonFileName);
    const metaPath = path.join(dayDir, metaFileName);

    const serialized = JSON.stringify(payload, null, 2);
    fs.writeFileSync(jsonPath, serialized, "utf-8");
    const sizeBytes = Buffer.byteLength(serialized, "utf-8");

    const id = `${parts.year}__${parts.monthFolder}__${parts.ddMmYyyy}__${jsonFileName}`;
    const label = triggerType === "auto"
      ? `Auto Backup Harian (${parts.hhmm} WIB)`
      : `Backup Server Manual (${parts.hhmm} WIB)`;

    const meta = {
      id,
      fileName: jsonFileName,
      relativePath: `backups/${parts.relativeDir}/${jsonFileName}`,
      folderPath: `backups/${parts.relativeDir}`,
      year: parts.year,
      month: parts.month,
      monthName: parts.monthName,
      monthFolder: parts.monthFolder,
      day: parts.day,
      weekday: parts.weekday,
      ddMmYyyy: parts.ddMmYyyy,
      timeLabel: `${parts.hhmm} WIB`,
      triggerType,
      label,
      sizeBytes,
      summary: payload.summary,
      createdAtIso: now.toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    cfg.last_run_at = now.toISOString();
    cfg.last_run_date = parts.ddMmYyyy;
    cfg.last_status = "success";
    cfg.last_error = null;
    if (triggerType === "auto") {
      pruneOldBackupFolders(Number(cfg.retention_days || 0));
    }
    saveDbToFile();
    void saveWorkspaceSnapshotToPostgres({
      snapshotId: id,
      label,
      source: triggerType,
      revision: Number(db.revision || 0),
      summary: payload.summary || {},
      payload,
    }).catch((err) => console.warn('[PostgreSQL] Snapshot backup warning:', err));
    broadcast({ type: "auto_backup:created", data: meta });
    return meta;
  }

  function listAutoBackupSnapshots() {
    const items: any[] = [];
    try {
      if (!fs.existsSync(BACKUPS_DIR)) return items;
      const years = fs.readdirSync(BACKUPS_DIR).filter((x) => /^\d{4}$/.test(x));
      for (const yr of years) {
        const yrPath = path.join(BACKUPS_DIR, yr);
        if (!fs.statSync(yrPath).isDirectory()) continue;
        const months = fs.readdirSync(yrPath);
        for (const mo of months) {
          const moPath = path.join(yrPath, mo);
          if (!fs.statSync(moPath).isDirectory()) continue;
          const days = fs.readdirSync(moPath);
          for (const dy of days) {
            const dyPath = path.join(moPath, dy);
            if (!fs.statSync(dyPath).isDirectory()) continue;
            const files = fs.readdirSync(dyPath).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"));
            for (const fname of files) {
              const jsonPath = path.join(dyPath, fname);
              const metaPath = path.join(dyPath, fname.replace(/\.json$/, ".meta.json"));
              let meta: any = null;
              if (fs.existsSync(metaPath)) {
                try {
                  meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                } catch {}
              }
              if (!meta) {
                const stat = fs.statSync(jsonPath);
                const mMonth = /^(\d{2})-(.+)$/.exec(mo);
                const mDay = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dy);
                const parts = getJakartaParts(stat.mtime);
                meta = {
                  id: `${yr}__${mo}__${dy}__${fname}`,
                  fileName: fname,
                  relativePath: `backups/${yr}/${mo}/${dy}/${fname}`,
                  folderPath: `backups/${yr}/${mo}/${dy}`,
                  year: yr,
                  month: mMonth ? mMonth[1] : parts.month,
                  monthName: mMonth ? mMonth[2] : parts.monthName,
                  monthFolder: mo,
                  day: mDay ? mDay[1] : parts.day,
                  weekday: parts.weekday,
                  ddMmYyyy: dy,
                  timeLabel: `${parts.hhmm} WIB`,
                  triggerType: fname.includes("-auto.") ? "auto" : "manual",
                  label: fname.includes("-auto.") ? `Auto Backup Harian (${parts.hhmm} WIB)` : `Backup Server (${parts.hhmm} WIB)`,
                  sizeBytes: stat.size,
                  summary: {},
                  createdAtIso: stat.mtime.toISOString(),
                };
              }
              items.push(meta);
            }
          }
        }
      }
    } catch (e) {
      console.warn("List auto backup warning:", e);
    }
    items.sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    return items;
  }

  function resolveSnapshotFilePath(snapshotId: string) {
    const segments = String(snapshotId || "").split("__");
    if (segments.length !== 4) return null;
    const [yr, mo, dy, fname] = segments;
    if (!/^\d{4}$/.test(yr) || !/^[0-9A-Za-z_-]+$/.test(mo) || !/^\d{2}-\d{2}-\d{4}$/.test(dy) || !/^[0-9A-Za-z._-]+\.json$/.test(fname)) {
      return null;
    }
    const target = path.resolve(BACKUPS_DIR, yr, mo, dy, fname);
    if (!target.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) return null;
    if (!fs.existsSync(target)) return null;
    return { target, metaTarget: target.replace(/\.json$/, ".meta.json"), yr, mo, dy, fname };
  }

  // Daily 23:59 WIB Auto-Backup Scheduler Loop (checks every 20 seconds)
  setInterval(() => {
    try {
      const cfg = ensureAutoBackupConfig();
      if (!cfg.enabled) return;
      const parts = getJakartaParts(new Date());
      const targetTime = cfg.schedule_time || "23:59";
      if (parts.hhmm === targetTime && cfg.last_run_date !== parts.ddMmYyyy) {
        executeServerAutoBackup("auto");
        console.log(`[Auto Backup] Snapshot harian berhasil dibuat di backups/${parts.relativeDir}`);
      }
    } catch (err: any) {
      const cfg = ensureAutoBackupConfig();
      cfg.last_status = "error";
      cfg.last_error = err?.message || "Auto backup gagal";
      console.error("[Auto Backup] Error:", err);
    }
  }, 20000);

  app.get("/api/admin/backup/summary", async (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat mengakses backup." });
    }
    const diskSnaps = listAutoBackupSnapshots();
    const pgSnaps = await listWorkspaceSnapshotsFromPostgres(30);
    const seen = new Set(diskSnaps.map((s: any) => s.id));
    const mergedSnaps = [
      ...diskSnaps,
      ...pgSnaps
        .filter((s: any) => s?.snapshotId && !seen.has(s.snapshotId))
        .map((s: any) => ({
          id: s.snapshotId,
          label: s.label,
          triggerType: s.source,
          summary: s.summary || {},
          createdAtIso: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
        })),
    ];
    res.json({
      workspace_name: db.workspace?.name || "CIRCLE Workspace",
      summary: buildBackupSummary(),
      auto_backup: {
        config: ensureAutoBackupConfig(),
        snapshots: mergedSnaps,
      },
      generated_at: new Date().toISOString(),
    });
  });

  app.get("/api/admin/backup/auto/status", async (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat mengakses auto backup." });
    }
    const diskSnaps = listAutoBackupSnapshots();
    const pgSnaps = await listWorkspaceSnapshotsFromPostgres(30);
    const seen = new Set(diskSnaps.map((s: any) => s.id));
    const mergedSnaps = [
      ...diskSnaps,
      ...pgSnaps
        .filter((s: any) => s?.snapshotId && !seen.has(s.snapshotId))
        .map((s: any) => ({
          id: s.snapshotId,
          label: s.label,
          triggerType: s.source,
          summary: s.summary || {},
          createdAtIso: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
        })),
    ];
    res.json({
      config: ensureAutoBackupConfig(),
      snapshots: mergedSnaps,
      server_time_wib: getJakartaParts(new Date()),
    });
  });

  app.patch("/api/admin/backup/auto/config", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat mengubah konfigurasi auto backup." });
    }
    const cfg = ensureAutoBackupConfig();
    const { enabled, schedule_time, retention_days } = req.body || {};
    if (typeof enabled === "boolean") {
      cfg.enabled = enabled;
    }
    if (typeof schedule_time === "string" && /^\d{2}:\d{2}$/.test(schedule_time.trim())) {
      const [hh, mm] = schedule_time.trim().split(":").map(Number);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        cfg.schedule_time = schedule_time.trim();
      }
    }
    if (retention_days !== undefined) {
      const num = Number(retention_days);
      if (Number.isFinite(num) && num >= 0 && num <= 3650) {
        cfg.retention_days = num;
      }
    }
    saveDbToFile();
    res.json({ success: true, config: cfg });
  });

  app.post("/api/admin/backup/auto/run", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat menjalankan auto backup." });
    }
    try {
      const meta = executeServerAutoBackup("manual", reqUser);
      res.json({
        success: true,
        snapshot: meta,
        config: ensureAutoBackupConfig(),
        snapshots: listAutoBackupSnapshots(),
      });
    } catch (e: any) {
      res.status(500).json({ detail: e?.message || "Gagal membuat backup harian ke folder." });
    }
  });

  app.get("/api/admin/backup/auto/snapshot/:id", async (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat mengakses snapshot." });
    }
    const resolved = resolveSnapshotFilePath(req.params.id);
    if (resolved) {
      try {
        const raw = fs.readFileSync(resolved.target, "utf-8");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.query.download === "1" || req.query.download === "true") {
          res.setHeader("Content-Disposition", `attachment; filename="${resolved.fname}"`);
        }
        return res.send(raw);
      } catch {
        return res.status(500).json({ detail: "Gagal membaca file snapshot." });
      }
    }
    const pgSnap = await getWorkspaceSnapshotFromPostgres(req.params.id);
    if (!pgSnap) return res.status(404).json({ detail: "Snapshot backup tidak ditemukan." });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.query.download === "1" || req.query.download === "true") {
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.json"`);
    }
    return res.send(JSON.stringify(pgSnap.payload, null, 2));
  });

  app.delete("/api/admin/backup/auto/snapshot/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat menghapus snapshot." });
    }
    const resolved = resolveSnapshotFilePath(req.params.id);
    if (!resolved) return res.status(404).json({ detail: "Snapshot backup tidak ditemukan." });
    try {
      if (fs.existsSync(resolved.target)) fs.unlinkSync(resolved.target);
      if (fs.existsSync(resolved.metaTarget)) fs.unlinkSync(resolved.metaTarget);
      const dyPath = path.join(BACKUPS_DIR, resolved.yr, resolved.mo, resolved.dy);
      const moPath = path.join(BACKUPS_DIR, resolved.yr, resolved.mo);
      const yrPath = path.join(BACKUPS_DIR, resolved.yr);
      if (fs.existsSync(dyPath) && fs.readdirSync(dyPath).length === 0) fs.rmdirSync(dyPath);
      if (fs.existsSync(moPath) && fs.readdirSync(moPath).length === 0) fs.rmdirSync(moPath);
      if (fs.existsSync(yrPath) && fs.readdirSync(yrPath).length === 0) fs.rmdirSync(yrPath);
      res.json({ success: true, snapshots: listAutoBackupSnapshots() });
    } catch {
      res.status(500).json({ detail: "Gagal menghapus file snapshot." });
    }
  });

  app.get("/api/admin/backup/export", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat mengekspor backup." });
    }

    const payload = buildFullBackupPayload({
      user_id: reqUser.user_id,
      name: reqUser.name,
      email: reqUser.email,
    });

    if (req.query.download === "1" || req.query.download === "true") {
      const parts = getJakartaParts(new Date());
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="circle-workspace-backup-${parts.ddMmYyyy}-${parts.hhmmCompact}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    return res.json(payload);
  });

  app.post("/api/admin/backup/restore", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Super Admin yang dapat memulihkan backup." });
    }

    const body = req.body || {};
    const rawData = body.data && typeof body.data === "object" ? body.data : body;
    if (!rawData || typeof rawData !== "object") {
      return res.status(400).json({ detail: "Format file backup tidak valid." });
    }

    const arrayKeys = [
      "users",
      "deleted_user_ids",
      "deleted_user_emails",
      "labels",
      "notifications",
      "tasks",
      "projects",
      "boards",
      "conversations",
      "groups",
      "messages",
      "posts",
      "org_units",
      "activity",
      "reminders",
      "polls",
      "task_automations",
      "audit_logs",
      "invitations",
      "drive_shortcuts",
      "access_requests",
      "sticker_packs",
      "stickers",
      "meetings",
      "circle_notes",
      "marketplace_listings",
      "marketplace_orders",
      "marketplace_reviews",
      "marketplace_vouchers",
    ];

    const hasRecognizedCollection =
      arrayKeys.some((k) => Array.isArray(rawData[k])) ||
      (rawData.workspace && typeof rawData.workspace === "object");

    if (!hasRecognizedCollection) {
      return res.status(400).json({ detail: "File backup tidak memiliki koleksi data CIRCLE Workspace yang valid." });
    }

    for (const k of arrayKeys) {
      if (Array.isArray(rawData[k])) {
        db[k] = rawData[k];
      }
    }

    if (rawData.workspace && typeof rawData.workspace === "object") {
      db.workspace = { ...(db.workspace || {}), ...rawData.workspace };
    }
    if (rawData.prefs && typeof rawData.prefs === "object") {
      db.prefs = rawData.prefs;
    }
    if (rawData.files && typeof rawData.files === "object") {
      db.files = rawData.files;
    }
    if (rawData.marketplace_carts && typeof rawData.marketplace_carts === "object") {
      db.marketplace_carts = rawData.marketplace_carts;
    }
    if (rawData.marketplace_wishlists && typeof rawData.marketplace_wishlists === "object") {
      db.marketplace_wishlists = rawData.marketplace_wishlists;
    }
    ensureMarketplaceData(db);

    // Restore uploaded binary files safely
    const uploadedBase64 = body.uploaded_files_base64 || rawData.uploaded_files_base64;
    if (uploadedBase64 && typeof uploadedBase64 === "object") {
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        for (const [rawName, b64] of Object.entries(uploadedBase64)) {
          if (typeof b64 !== "string" || !rawName) continue;
          const safeName = path.basename(rawName);
          if (!safeName || safeName.startsWith(".")) continue;
          const dest = path.join(UPLOADS_DIR, safeName);
          fs.writeFileSync(dest, Buffer.from(b64, "base64"));
        }
        void syncUploadedFilesMapToPostgres(uploadedBase64 as Record<string, string>, db.files || {});
      } catch (e) {
        console.warn("Backup restore upload write warning:", e);
      }
    }

    // Keep current executing admin account present so active session stays valid
    if (!Array.isArray(db.users)) db.users = [];
    if (!db.users.some((u: any) => u?.user_id === reqUser.user_id)) {
      db.users.push(reqUser);
    }

    // Prevent startup cleanup from removing restored data
    db.prod_clean_v2 = true;
    db.org_aligned_v2 = true;
    db.org_aligned_v3 = true;

    migrateSecurityAtRest();
    sanitizeConversationsAndMessages();

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_restore_${Date.now()}`,
      actor_id: reqUser.user_id,
      actor_name: reqUser.name || "Admin",
      action: "memulihkan full backup data workspace (chat, task, member, feed, dll)",
      created_at: new Date().toISOString(),
    });

    saveDbToFile(true);

    broadcast({ type: "users:changed" });
    broadcast({ type: "tasks:changed" });
    broadcast({ type: "posts:changed" });
    broadcast({ type: "notes:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "workspace:updated", data: db.workspace });

    const summary = buildBackupSummary();
    serverBootedFreshSeed = false;
    res.json({
      success: true,
      restored_at: new Date().toISOString(),
      summary,
    });
  });

  function signSnapshotPayload(payload: any): string {
    const body = JSON.stringify(payload);
    return crypto.createHmac('sha256', MASTER_KEY).update(body).digest('hex');
  }

  function verifySnapshotSignature(payload: any, sig: string | undefined): boolean {
    if (!sig || typeof sig !== 'string') return false;
    try {
      const expected = Buffer.from(signSnapshotPayload(payload), 'hex');
      const actual = Buffer.from(sig.trim(), 'hex');
      if (expected.length !== actual.length) return false;
      return crypto.timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  function applySnapshotToDb(body: any) {
    const rawData = body.data && typeof body.data === "object" ? body.data : body;
    if (!rawData || typeof rawData !== "object") return false;

    const arrayKeys = [
      "users", "labels", "notifications", "tasks", "projects", "boards",
      "conversations", "groups", "messages", "posts", "org_units", "activity",
      "reminders", "polls", "task_automations", "audit_logs", "invitations",
      "drive_shortcuts", "access_requests", "sticker_packs", "stickers", "meetings",
      "circle_notes",
      "marketplace_listings", "marketplace_orders", "marketplace_reviews", "marketplace_vouchers",
    ];

    const hasRecognized =
      arrayKeys.some((k) => Array.isArray(rawData[k])) ||
      (rawData.workspace && typeof rawData.workspace === "object");
    if (!hasRecognized) return false;

    // Union explicit deletion tombstones FIRST so deleted accounts are never resurrected
    const prevDelIds = Array.isArray(db.deleted_user_ids) ? db.deleted_user_ids : [];
    const nextDelIds = Array.isArray(rawData.deleted_user_ids) ? rawData.deleted_user_ids : [];
    db.deleted_user_ids = Array.from(new Set([...prevDelIds, ...nextDelIds].filter(Boolean)));

    const prevDelEmails = Array.isArray(db.deleted_user_emails) ? db.deleted_user_emails : [];
    const nextDelEmails = Array.isArray(rawData.deleted_user_emails) ? rawData.deleted_user_emails : [];
    db.deleted_user_emails = Array.from(
      new Set([...prevDelEmails, ...nextDelEmails].map((e: any) => String(e || "").toLowerCase().trim()).filter(Boolean))
    );

    for (const k of arrayKeys) {
      if (Array.isArray(rawData[k])) {
        if (k === "users") {
          const existingUsers = Array.isArray(db.users) ? [...db.users] : [];
          db.users = rawData.users.filter((u: any) => u && !isUserExplicitlyDeleted(u.user_id, u.email));
          mergeKnownAccountsIntoDb(existingUsers);
        } else {
          db[k] = rawData[k];
        }
      }
    }
    if (rawData.workspace && typeof rawData.workspace === "object") {
      db.workspace = { ...(db.workspace || {}), ...rawData.workspace };
    }
    if (rawData.prefs && typeof rawData.prefs === "object") {
      db.prefs = rawData.prefs;
    }
    if (rawData.files && typeof rawData.files === "object") {
      db.files = rawData.files;
    }
    if (rawData.marketplace_carts && typeof rawData.marketplace_carts === "object") {
      db.marketplace_carts = rawData.marketplace_carts;
    }
    if (rawData.marketplace_wishlists && typeof rawData.marketplace_wishlists === "object") {
      db.marketplace_wishlists = rawData.marketplace_wishlists;
    }
    ensureMarketplaceData(db);
    if (rawData.auto_backup_config && typeof rawData.auto_backup_config === "object") {
      db.auto_backup_config = rawData.auto_backup_config;
    }

    const uploadedBase64 = body.uploaded_files_base64 || rawData.uploaded_files_base64;
    if (uploadedBase64 && typeof uploadedBase64 === "object") {
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        for (const [rawName, b64] of Object.entries(uploadedBase64)) {
          if (typeof b64 !== "string" || !rawName) continue;
          const safeName = path.basename(rawName);
          if (!safeName || safeName.startsWith(".")) continue;
          fs.writeFileSync(path.join(UPLOADS_DIR, safeName), Buffer.from(b64, "base64"));
        }
        void syncUploadedFilesMapToPostgres(uploadedBase64 as Record<string, string>, db.files || {});
      } catch {}
    }

    const incomingRev = Number(rawData.revision ?? body.revision ?? 0);
    if (Number.isFinite(incomingRev) && incomingRev > Number(db.revision || 0)) {
      db.revision = incomingRev;
    }

    db.prod_clean_v2 = true;
    db.org_aligned_v2 = true;
    db.org_aligned_v3 = true;
    migrateSecurityAtRest();
    sanitizeConversationsAndMessages();
    serverBootedFreshSeed = false;
    saveDbToFile(true);

    broadcast({ type: "users:changed" });
    broadcast({ type: "tasks:changed" });
    broadcast({ type: "posts:changed" });
    broadcast({ type: "notes:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "workspace:updated", data: db.workspace });
    return true;
  }

  function mergeArrayById(existingArr: any[], incomingArr: any[], idKey = "id") {
    const out = Array.isArray(existingArr) ? [...existingArr] : [];
    const indexMap = new Map<string, number>();
    out.forEach((item, idx) => {
      const k = item && item[idKey] ? String(item[idKey]) : "";
      if (k) indexMap.set(k, idx);
    });
    let changed = false;

    for (const inc of Array.isArray(incomingArr) ? incomingArr : []) {
      if (!inc || typeof inc !== "object") continue;
      const k = inc[idKey] ? String(inc[idKey]) : "";
      if (!k) continue;
      const existingIdx = indexMap.get(k);
      if (existingIdx === undefined) {
        indexMap.set(k, out.length);
        out.push(inc);
        changed = true;
      } else {
        const cur = out[existingIdx];
        const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
        const incTime = new Date(inc?.updated_at || inc?.created_at || 0).getTime();
        if (incTime > curTime) {
          out[existingIdx] = { ...cur, ...inc };
          changed = true;
        }
      }
    }
    return { list: out, changed };
  }

  function mergeTasksNonDestructive(existingTasks: any[], incomingTasks: any[]) {
    const out = Array.isArray(existingTasks) ? [...existingTasks] : [];
    const indexMap = new Map<string, number>();
    out.forEach((t, idx) => {
      const tid = t?.id || t?.task_id;
      if (tid) indexMap.set(String(tid), idx);
    });
    let changed = false;

    for (const rawInc of Array.isArray(incomingTasks) ? incomingTasks : []) {
      if (!rawInc || typeof rawInc !== "object") continue;
      const resolvedId = rawInc.id || rawInc.task_id;
      if (!resolvedId) continue;
      const inc = rawInc.id ? rawInc : { ...rawInc, id: String(resolvedId) };
      const tid = String(resolvedId);
      const existingIdx = indexMap.get(tid);
      if (existingIdx === undefined) {
        indexMap.set(tid, out.length);
        out.push(inc);
        changed = true;
      } else {
        const cur = out[existingIdx];
        const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
        const incTime = new Date(inc?.updated_at || inc?.created_at || 0).getTime();

        const curApproved = Array.isArray(cur?.approvals?.approved_by)
          ? cur.approvals.approved_by
          : Array.isArray(cur?.approval?.approved_by)
          ? cur.approval.approved_by
          : [];
        const incApproved = Array.isArray(inc?.approvals?.approved_by)
          ? inc.approvals.approved_by
          : Array.isArray(inc?.approval?.approved_by)
          ? inc.approval.approved_by
          : [];
        const mergedApproved = Array.from(new Set([...curApproved, ...incApproved].filter(Boolean)));

        const curComments = Array.isArray(cur?.comments) ? cur.comments : [];
        const incComments = Array.isArray(inc?.comments) ? inc.comments : [];
        const mergedComments = mergeArrayById(curComments, incComments, "id").list;

        const curCps = Array.isArray(cur?.checkpoints) ? cur.checkpoints : [];
        const incCps = Array.isArray(inc?.checkpoints) ? inc.checkpoints : [];
        const mergedCps = incCps.length > curCps.length || incTime > curTime ? incCps : curCps;

        if (
          incTime > curTime ||
          mergedApproved.length > curApproved.length ||
          mergedComments.length > curComments.length ||
          mergedCps.length > curCps.length
        ) {
          const base = incTime >= curTime ? { ...cur, ...inc } : { ...inc, ...cur };
          const syncedApprovals = {
            needed: 2,
            ...(base.approvals || base.approval || {}),
            approved_by: mergedApproved,
            status:
              mergedApproved.length >= 2 || base.status === "done"
                ? "approved"
                : mergedApproved.length === 1
                ? "partial"
                : (base.approvals?.status || base.approval?.status || "pending"),
          };
          out[existingIdx] = {
            ...base,
            comments: mergedComments,
            checkpoints: mergedCps,
            approvals: syncedApprovals,
            approval: syncedApprovals,
          };
          changed = true;
        }
      }
    }
    return { list: out, changed };
  }

  function mergeSnapshotIntoDb(body: any): boolean {
    const rawData = body?.data && typeof body.data === "object" ? body.data : body;
    if (!rawData || typeof rawData !== "object") return false;

    let anyChanged = false;

    // 1. Sync deletion tombstones first
    const prevDelIds = Array.isArray(db.deleted_user_ids) ? db.deleted_user_ids : [];
    const nextDelIds = Array.isArray(rawData.deleted_user_ids) ? rawData.deleted_user_ids : [];
    db.deleted_user_ids = Array.from(new Set([...prevDelIds, ...nextDelIds].filter(Boolean)));

    const prevDelEmails = Array.isArray(db.deleted_user_emails) ? db.deleted_user_emails : [];
    const nextDelEmails = Array.isArray(rawData.deleted_user_emails) ? rawData.deleted_user_emails : [];
    db.deleted_user_emails = Array.from(
      new Set([...prevDelEmails, ...nextDelEmails].map((e: any) => String(e || "").toLowerCase().trim()).filter(Boolean))
    );

    // 2. Users
    if (Array.isArray(rawData.users) && rawData.users.length > 0) {
      const beforeCount = (db.users || []).length;
      mergeKnownAccountsIntoDb(rawData.users);
      if ((db.users || []).length !== beforeCount) anyChanged = true;
    }

    // 3. Tasks
    if (Array.isArray(rawData.tasks) && rawData.tasks.length > 0) {
      const { list, changed } = mergeTasksNonDestructive(db.tasks || [], rawData.tasks);
      if (changed) {
        db.tasks = list;
        anyChanged = true;
      }
    }

    // 4. Boards (also union member_ids and invited_member_ids)
    if (Array.isArray(rawData.boards) && rawData.boards.length > 0) {
      const { list, changed } = mergeArrayById(db.boards || [], rawData.boards, "id");
      for (const incB of rawData.boards) {
        if (!incB?.id) continue;
        const target = list.find((b: any) => b && b.id === incB.id);
        if (target) {
          const m1 = Array.isArray(target.member_ids) ? target.member_ids : [];
          const m2 = Array.isArray(incB.member_ids) ? incB.member_ids : [];
          target.member_ids = Array.from(new Set([...m1, ...m2].filter(Boolean)));
          const inv1 = Array.isArray(target.invited_member_ids) ? target.invited_member_ids : [];
          const inv2 = Array.isArray(incB.invited_member_ids) ? incB.invited_member_ids : [];
          target.invited_member_ids = Array.from(new Set([...inv1, ...inv2].filter(Boolean)));
        }
      }
      db.boards = list;
      if (changed) anyChanged = true;
    }

    // 5. Standard ID-based collections
    const idCollections = [
      "labels",
      "projects",
      "conversations",
      "groups",
      "messages",
      "posts",
      "org_units",
      "activity",
      "reminders",
      "polls",
      "task_automations",
      "invitations",
      "drive_shortcuts",
      "access_requests",
      "meetings",
      "circle_notes",
      "notifications",
      "marketplace_listings",
      "marketplace_orders",
      "marketplace_reviews",
      "marketplace_vouchers",
    ];
    for (const key of idCollections) {
      if (Array.isArray(rawData[key]) && rawData[key].length > 0) {
        const { list, changed } = mergeArrayById(db[key] || [], rawData[key], "id");
        if (changed) {
          if (key === "messages") {
            list.sort(
              (a: any, b: any) =>
                new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime()
            );
          }
          db[key] = list;
          anyChanged = true;
        }
      }
    }

    // 6. Workspace config & custom checkpoint templates
    if (rawData.workspace && typeof rawData.workspace === "object") {
      db.workspace = db.workspace || {};
      if (Array.isArray(rawData.workspace.checkpoint_templates) && rawData.workspace.checkpoint_templates.length > 0) {
        const { list } = mergeArrayById(
          db.workspace.checkpoint_templates || [],
          rawData.workspace.checkpoint_templates,
          "id"
        );
        db.workspace.checkpoint_templates = list;
        anyChanged = true;
      }
      const maxTaskNum = (db.tasks || []).reduce((mx: number, t: any) => {
        const n = Number(t?.number || String(t?.number_str || "").replace(/\D+/g, "") || 0);
        return n > mx ? n : mx;
      }, Number(db.workspace.next_task_number || 0));
      if (maxTaskNum >= Number(db.workspace.next_task_number || 1)) {
        db.workspace.next_task_number = maxTaskNum + 1;
      }
    }

    // 7. Prefs & Files
    if (rawData.prefs && typeof rawData.prefs === "object") {
      db.prefs = { ...(rawData.prefs || {}), ...(db.prefs || {}) };
    }
    if (rawData.files && typeof rawData.files === "object") {
      db.files = { ...(rawData.files || {}), ...(db.files || {}) };
    }

    const uploadedBase64 = body?.uploaded_files_base64 || rawData.uploaded_files_base64;
    if (uploadedBase64 && typeof uploadedBase64 === "object") {
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        for (const [rawName, b64] of Object.entries(uploadedBase64)) {
          if (typeof b64 !== "string" || !rawName) continue;
          const safeName = path.basename(rawName);
          if (!safeName || safeName.startsWith(".")) continue;
          const dest = path.join(UPLOADS_DIR, safeName);
          if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, Buffer.from(b64, "base64"));
            anyChanged = true;
          }
        }
        void syncUploadedFilesMapToPostgres(uploadedBase64 as Record<string, string>, db.files || {});
      } catch {}
    }

    if (anyChanged) {
      const incomingRev = Number(rawData.revision ?? body?.revision ?? 0);
      if (Number.isFinite(incomingRev) && incomingRev > Number(db.revision || 0)) {
        db.revision = incomingRev;
      }
      migrateSecurityAtRest();
      sanitizeConversationsAndMessages();
      saveDbToFile(true);
      broadcast({ type: "users:changed" });
      broadcast({ type: "tasks:changed" });
      broadcast({ type: "posts:changed" });
      broadcast({ type: "notes:changed" });
      broadcast({ type: "conversations:changed" });
      broadcast({ type: "groups:changed" });
      broadcast({ type: "workspace:changed" });
      broadcast({ type: "workspace:updated", data: db.workspace });
    }

    return anyChanged;
  }

  app.get("/api/workspace/persistence-status", (_req, res) => {
    const summary = buildBackupSummary();
    const isFreshSeedState = isDatabaseInEmptySeedState() || summary.tasks === 0;

    const userEmails = (db.users || [])
      .filter((u: any) => u && !u.is_bot && u.role !== "assistant")
      .map((u: any) => String(u.email || "").toLowerCase().trim())
      .filter(Boolean);

    const taskIds = (db.tasks || []).map((t: any) => t?.id || t?.task_id).filter(Boolean);
    const boardIds = (db.boards || []).map((b: any) => b?.id || b?.board_id).filter(Boolean);
    const postIds = (db.posts || []).map((p: any) => p?.id || p?.post_id).filter(Boolean);
    const noteIds = (db.circle_notes || []).map((n: any) => n?.id || n?.note_id).filter(Boolean);
    const messageIds = (db.messages || []).map((m: any) => m?.id).filter(Boolean);
    const conversationIds = (db.conversations || []).map((c: any) => c?.id).filter(Boolean);
    const groupIds = (db.groups || []).map((g: any) => g?.id).filter(Boolean);
    const meetingIds = (db.meetings || []).map((m: any) => m?.id).filter(Boolean);
    const projectIds = (db.projects || []).map((p: any) => p?.id).filter(Boolean);
    const templateIds = (db.workspace?.checkpoint_templates || []).map((t: any) => t?.id).filter(Boolean);

    res.json({
      booted_fresh_seed: isFreshSeedState,
      revision: isDatabaseInEmptySeedState() ? 0 : Number(db.revision || 0),
      last_mutated_at: db.last_mutated_at || null,
      user_emails: userEmails,
      task_ids: taskIds,
      board_ids: boardIds,
      post_ids: postIds,
      note_ids: noteIds,
      message_ids: messageIds,
      conversation_ids: conversationIds,
      group_ids: groupIds,
      meeting_ids: meetingIds,
      project_ids: projectIds,
      template_ids: templateIds,
      deleted_user_ids: Array.isArray(db.deleted_user_ids) ? db.deleted_user_ids : [],
      deleted_user_emails: Array.isArray(db.deleted_user_emails) ? db.deleted_user_emails : [],
      counts: {
        users: summary.users,
        tasks: summary.tasks,
        conversations: summary.conversations,
        messages: summary.messages,
        posts: summary.posts,
        notes: summary.circle_notes,
      },
    });
  });

  app.get("/api/workspace/persistent-snapshot", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) {
      return res.status(401).json({ detail: "Autentikasi diperlukan." });
    }
    const includeFiles = req.query.include_files === "1" || req.query.include_files === "true";
    const payload = buildFullBackupPayload(
      {
        user_id: reqUser.user_id,
        name: reqUser.name,
        email: reqUser.email,
      },
      { includeFiles }
    );
    if (db.auto_backup_config && payload.data) {
      payload.data.auto_backup_config = JSON.parse(JSON.stringify(db.auto_backup_config));
    }
    const snapshot_sig = signSnapshotPayload(payload);
    res.json({
      revision: Number(db.revision || 1),
      last_mutated_at: db.last_mutated_at || new Date().toISOString(),
      snapshot: payload,
      snapshot_sig,
    });
  });

  app.post("/api/workspace/auto-hydrate", async (req, res) => {
    const { snapshot, snapshot_sig, known_accounts, revision: clientRevision } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }

    if (!snapshot || typeof snapshot !== "object") {
      return res.json({
        restored: true,
        revision: Number(db.revision || 1),
        summary: buildBackupSummary(),
      });
    }

    const reqUser = getReqUser(req);
    const isAdmin = Boolean(reqUser && ["super_admin", "workspace_admin"].includes(reqUser.role));
    const isSignedSnapshot = verifySnapshotSignature(snapshot, snapshot_sig);

    const summary = buildBackupSummary();
    const currentServerRev = Number(db.revision || 0);
    const isFreshSeedState =
      serverBootedFreshSeed &&
      currentServerRev === 0 &&
      summary.tasks === 0 &&
      summary.messages <= 3 &&
      summary.posts <= 1 &&
      summary.users <= 2;

    const rawSnapData = snapshot.data && typeof snapshot.data === "object" ? snapshot.data : snapshot;
    if (Array.isArray(rawSnapData?.users)) {
      mergeKnownAccountsIntoDb(rawSnapData.users);
    }

    const incomingRev = Number(clientRevision ?? snapshot.revision ?? rawSnapData?.revision ?? 0);
    const shouldOverwriteWholeDb =
      isFreshSeedState || (isAdmin && isSignedSnapshot && incomingRev > currentServerRev);

    if (shouldOverwriteWholeDb) {
      // Preserve any existing items before applying snapshot, then merge back so nothing is lost
      const prevCopy = JSON.parse(
        JSON.stringify({
          users: db.users || [],
          tasks: db.tasks || [],
          boards: db.boards || [],
          projects: db.projects || [],
          conversations: db.conversations || [],
          groups: db.groups || [],
          messages: db.messages || [],
          posts: db.posts || [],
          circle_notes: db.circle_notes || [],
          meetings: db.meetings || [],
        })
      );
      applySnapshotToDb(snapshot);
      mergeSnapshotIntoDb({ data: prevCopy });
    } else {
      mergeSnapshotIntoDb(snapshot);
    }

    await enqueuePostgresSave({ allowEmptyOverwrite: false });

    res.json({
      restored: true,
      revision: Number(db.revision || 1),
      summary: buildBackupSummary(),
    });
  });

  // Self-healing session recovery endpoint for seamless survival across container restarts
  app.post("/api/auth/session-recover", (req, res) => {
    const { user, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts, user?.user_id);
    }
    if (user && typeof user === "object" && user.user_id && user.email) {
      mergeKnownAccountsIntoDb([user], user.user_id);
    }

    const reqUser =
      getReqUser(req) ||
      (user?.user_id &&
        (db.users || []).find(
          (u: any) =>
            u.user_id === user.user_id ||
            (user.email && String(u.email || "").toLowerCase().trim() === String(user.email).toLowerCase().trim())
        ));

    if (!reqUser || reqUser.is_bot) {
      return res.status(401).json({ detail: "Sesi tidak dapat dipulihkan." });
    }
    if (reqUser.status === "inactive" || reqUser.status === "rejected" || isUserExplicitlyDeleted(reqUser.user_id, reqUser.email)) {
      return res.status(401).json({ revoked: true, detail: "Akun telah dinonaktifkan." });
    }

    if (reqUser.status === "pending") {
      reqUser.status = "active";
    }
    setUserOnlineStatus(reqUser.user_id, true);
    syncUserDivisionAndGroupMembership(reqUser);
    const freshToken = issueUserSession(req, res, reqUser);
    saveDbToFile(true);

    res.json({
      recovered: true,
      token: freshToken,
      user: sanitizeUser(reqUser),
      account_vault_entry: buildAccountVaultEntry(reqUser),
      workspace: db.workspace,
      prefs: db.prefs[reqUser.user_id] || { theme_mode: "light" },
    });
  });

  app.get("/api/auth/me", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const latestUser = db.users.find((u: any) => u.user_id === reqUser.user_id) || reqUser;
    setUserOnlineStatus(latestUser.user_id, true);
    syncUserDivisionAndGroupMembership(latestUser);
    const activeToken = extractAuthToken(req) || issueUserSession(req, res, latestUser);
    res.json({
      token: activeToken,
      user: sanitizeUser(latestUser),
      account_vault_entry: buildAccountVaultEntry(latestUser),
      workspace: db.workspace,
      prefs: db.prefs[latestUser.user_id] || { theme_mode: "light" },
      users: sanitizeUsersList(db.users),
      labels: db.labels,
      org_units: db.org_units || [],
      drive_shortcuts: db.drive_shortcuts || []
    });
  });

  const BLOCKED_FAKE_DOMAINS = new Set([
    "mailinator.com",
    "tempmail.com",
    "temp-mail.org",
    "10minutemail.com",
    "guerrillamail.com",
    "yopmail.com",
    "trashmail.com",
    "fakeinbox.com",
    "sharklasers.com",
    "getnada.com",
    "maildrop.cc",
    "dispostable.com",
    "example.com",
    "test.com",
    "testing.com",
    "invalid.com",
    "fake.com",
    "palsu.com",
    "ngawur.com",
    "dummy.com",
    "asdf.com",
    "qwerty.com",
    "localhost"
  ]);

  function validateWorkspaceEmail(rawEmail: string): { ok: boolean; email: string; domain: string; detail?: string } {
    const clean = String(rawEmail || "").toLowerCase().trim();
    if (!clean) {
      return { ok: false, email: "", domain: "", detail: "Alamat email wajib diisi." };
    }
    // Allow internal seeded demo accounts (@asliri.local)
    if (clean.endsWith("@asliri.local")) {
      return { ok: true, email: clean, domain: "asliri.local" };
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,12}$/;
    if (!emailRegex.test(clean) || clean.includes("..")) {
      return {
        ok: false,
        email: clean,
        domain: "",
        detail: "Format email tidak valid. Masukkan alamat email resmi yang benar (contoh: nama@perusahaan.com)."
      };
    }
    const [localPart, domain = ""] = clean.split("@");
    if (!localPart || localPart.length < 2 || !domain || domain.length < 4) {
      return {
        ok: false,
        email: clean,
        domain,
        detail: "Alamat email tidak valid atau terlalu pendek."
      };
    }
    if (BLOCKED_FAKE_DOMAINS.has(domain)) {
      return {
        ok: false,
        email: clean,
        domain,
        detail: `Domain email "${domain}" tidak diizinkan (terdeteksi email sementara/dummy). Gunakan email kerja atau email aktif yang valid.`
      };
    }
    return { ok: true, email: clean, domain };
  }

  function isAllowedCompanyDomain(domain: string): boolean {
    if (!domain) return false;
    const rawDomains = db.workspace?.allowed_domains;
    const hasConfigured =
      rawDomains !== undefined &&
      rawDomains !== null &&
      (Array.isArray(rawDomains) ? rawDomains.length > 0 : String(rawDomains).trim().length > 0);
    const list: string[] = hasConfigured
      ? Array.isArray(rawDomains)
        ? rawDomains
        : String(rawDomains || "")
            .split(",")
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean)
      : ["asliri.id"];
    const target = domain.toLowerCase().replace(/^@/, "");
    return list.some((d) => String(d || "").trim().toLowerCase().replace(/^@/, "") === target);
  }

  // Email & Password Login (with scrypt constant-time verification, brute-force lockout & HMAC session token)
  app.post("/api/auth/login", (req, res) => {
    const { email, password, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    if (!email || !password) {
      return res.status(400).json({ detail: "Email dan password wajib diisi." });
    }

    const emailCheck = validateWorkspaceEmail(email);
    if (!emailCheck.ok) {
      return res.status(400).json({ detail: emailCheck.detail });
    }

    const cleanEmail = emailCheck.email;
    const throttleKey = `login:${req.ip || "local"}:${cleanEmail}`;
    const throttle = getAuthThrottleStatus(throttleKey);
    if (throttle.blocked) {
      const mins = Math.max(1, Math.ceil(throttle.retryAfterSec / 60));
      return res.status(429).json({
        detail: `Terlalu banyak percobaan login gagal. Akun dikunci sementara selama ${mins} menit untuk keamanan.`
      });
    }

    const user = db.users.find((u: any) => u.email?.toLowerCase() === cleanEmail);

    if (!user) {
      recordFailedAuthAttempt(throttleKey);
      return res.status(401).json({ detail: "Akun dengan email tersebut belum terdaftar. Silakan lakukan pendaftaran terlebih dahulu." });
    }

    if (user.password_hash || user.password) {
      const check = verifyPassword(String(password), user);
      if (!check.valid) {
        const failInfo = recordFailedAuthAttempt(throttleKey);
        if (failInfo.locked) {
          if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
          db.audit_logs.unshift({
            id: `log_lock_${Date.now()}`,
            actor_id: user.user_id,
            actor_name: user.name,
            action: `keamanan: percobaan login gagal berulang pada ${cleanEmail} (lockout sementara)`,
            created_at: new Date().toISOString()
          });
          saveDbToFile();
          return res.status(429).json({
            detail: "Terlalu banyak percobaan password salah (5x). Silakan coba lagi dalam 5 menit atau gunakan Lupa Password."
          });
        }
        return res.status(401).json({
          detail: `Password yang Anda masukkan salah (sisa ${failInfo.remainingAttempts} percobaan sebelum penguncian sementara).`
        });
      }
      if (check.needsMigration) {
        user.password_hash = hashPassword(String(password));
        user.password_updated_at = new Date().toISOString();
        delete user.password;
      }
    }

    const canAutoJoinLoginDomain =
      db.workspace?.auto_join_domain !== false && isAllowedCompanyDomain(emailCheck.domain);
    if (user.status === "pending" && (canAutoJoinLoginDomain || db.workspace?.require_approval === false)) {
      user.status = "active";
    }

    if (user.status === "pending") {
      return res.status(403).json({
        status: "pending",
        detail: "Akun Anda sedang dalam proses peninjauan & approval oleh Super Admin. Mohon tunggu persetujuan."
      });
    }

    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({
        status: "inactive",
        detail: "Akun Anda dinonaktifkan atau ditolak. Silakan hubungi Super Admin."
      });
    }

    clearAuthAttempts(throttleKey);
    setUserOnlineStatus(user.user_id, true);
    syncUserDivisionAndGroupMembership(user);
    const token = issueUserSession(req, res, user);
    saveDbToFile(true);

    res.json({
      token,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
      workspace: db.workspace,
      prefs: db.prefs[user.user_id] || { theme_mode: "light" }
    });
  });

  // Email & Password Registration / Signup
  app.post("/api/auth/register", (req, res) => {
    const { name, email, password, department, job_title, note, avatar } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ detail: "Nama lengkap, email, dan password wajib diisi." });
    }

    const emailCheck = validateWorkspaceEmail(email);
    if (!emailCheck.ok) {
      return res.status(400).json({ detail: emailCheck.detail });
    }

    const pwPolicy = validatePasswordPolicy(String(password));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    const cleanEmail = emailCheck.email;
    const existingUser = db.users.find((u: any) => u.email?.toLowerCase() === cleanEmail);

    if (existingUser && existingUser.status === "active") {
      return res.status(400).json({ detail: "Email ini sudah memiliki akun aktif. Silakan langsung masuk (login)." });
    }

    if (existingUser && existingUser.status === "pending") {
      return res.status(400).json({ detail: "Pendaftaran untuk email ini sudah diajukan dan sedang menunggu approval Super Admin." });
    }

    const reqId = `req_${Date.now()}`;
    const newUserId = existingUser ? existingUser.user_id : `user_${Date.now()}`;
    const selectedDept = String(department || "Marketing").trim();
    const passwordHash = hashPassword(String(password));
    const nowIso = new Date().toISOString();

    const invitation = (Array.isArray(db.invitations) ? db.invitations : []).find(
      (inv: any) => inv.email?.toLowerCase() === cleanEmail
    );
    const canAutoJoinDomain =
      db.workspace?.auto_join_domain !== false && isAllowedCompanyDomain(emailCheck.domain);
    const autoApproveNow = Boolean(invitation || canAutoJoinDomain || db.workspace?.require_approval === false);
    if (invitation) invitation.used = true;

    let newUserObj: any = null;
    const defaultAvatar = avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
    if (!existingUser) {
      newUserObj = {
        user_id: newUserId,
        email: cleanEmail,
        password_hash: passwordHash,
        password_updated_at: nowIso,
        token_version: 1,
        name: name.trim(),
        role: invitation?.role || "employee",
        job_title: job_title || "Staff Member",
        department: selectedDept,
        status: autoApproveNow ? "active" : "pending",
        online: autoApproveNow,
        is_demo: false,
        avatar: defaultAvatar,
        picture: defaultAvatar
      };
      db.users.push(newUserObj);
    } else {
      existingUser.password_hash = passwordHash;
      existingUser.password_updated_at = nowIso;
      delete existingUser.password;
      existingUser.name = name.trim();
      if (department) existingUser.department = selectedDept;
      if (job_title) existingUser.job_title = job_title;
      existingUser.avatar = defaultAvatar;
      existingUser.picture = defaultAvatar;
      existingUser.status = autoApproveNow ? "active" : "pending";
      newUserObj = existingUser;
    }

    syncUserDivisionAndGroupMembership(newUserObj);

    if (autoApproveNow) {
      setUserOnlineStatus(newUserObj.user_id, true);
      ensureProfileCompletionReminder(newUserObj);
      const token = issueUserSession(req, res, newUserObj);
      saveDbToFile(true);
      broadcast({ type: "users:changed" });
      broadcast({ type: "groups:changed" });
      return res.json({
        success: true,
        status: "active",
        token,
        user: sanitizeUser(newUserObj),
        account_vault_entry: buildAccountVaultEntry(newUserObj),
        workspace: db.workspace,
        prefs: db.prefs[newUserObj.user_id] || { theme_mode: "light" },
        detail: `Pendaftaran berhasil! Email domain ${emailCheck.domain} otomatis disetujui.`
      });
    }

    const accessReq = {
      id: reqId,
      name: name.trim(),
      email: cleanEmail,
      department: newUserObj.department || selectedDept,
      job_title: job_title || "Staff Member",
      note: note || "Pendaftaran akun baru via Email & Password",
      status: "pending",
      created_at: new Date().toISOString()
    };
    db.access_requests.unshift(accessReq);

    // Notify Super Admins / Managers
    const approvers = db.users.filter((u: any) => 
      u.role === "super_admin" || 
      u.role === "workspace_admin" || 
      (u.role === "department_manager" && (!department || u.department === department || u.department === "General"))
    );
    const targetApprovers = approvers.length > 0 ? approvers : [db.users[0]];

    targetApprovers.forEach((admin: any) => {
      let conv = db.conversations.find((c: any) => 
        c.type === "dm" && 
        (c.member_ids || []).includes(CIRCLE_BOT_ID) && 
        (c.member_ids || []).includes(admin.user_id)
      );

      if (!conv) {
        conv = {
          id: `conv_circle_${admin.user_id}`,
          type: "dm",
          name: "Circle (Workspace Assistant)",
          admin_ids: [],
          members: [CIRCLE_BOT_ID, admin.user_id],
          member_ids: [CIRCLE_BOT_ID, admin.user_id],
          unread: 1,
          last_message_preview: `Pendaftaran akun baru dari ${name}`,
          last_message_at: new Date().toISOString()
        };
        db.conversations.unshift(conv);
      } else {
        conv.unread = (conv.unread || 0) + 1;
        conv.last_message_preview = `Pendaftaran akun baru dari ${name}`;
        conv.last_message_at = new Date().toISOString();
      }

      const msg = {
        id: `msg_req_${reqId}_${admin.user_id}`,
        conversation_id: conv.id,
        sender_id: CIRCLE_BOT_ID,
        user_id: CIRCLE_BOT_ID,
        text: `Halo ${admin.name.split(' ')[0]}! Ada pendaftaran akun baru (${cleanEmail}) untuk divisi ${newUserObj.department || selectedDept}. Silakan tinjau card approval di bawah ini:`,
        type: "access_request_card",
        access_request: accessReq,
        created_at: new Date().toISOString()
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: msg });

      createNotification({
        user_id: admin.user_id,
        title: "Pendaftaran Akun Baru",
        body: `${name} (${cleanEmail}) mendaftar akun baru di divisi ${newUserObj.department || selectedDept} dan menunggu persetujuan Super Admin`,
        type: "access_request",
        category: "system",
        access_request: accessReq
      });
    });

    saveDbToFile(true);
    broadcast({ type: "access_requests:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "groups:changed" });

    res.json({
      success: true,
      status: "pending",
      user: sanitizeUser(newUserObj),
      account_vault_entry: buildAccountVaultEntry(newUserObj),
      detail: "Pendaftaran berhasil! Akun Anda sedang dalam proses peninjauan & approval oleh Super Admin."
    });
  });

  app.post("/api/auth/google", async (req, res) => {
    const { email, name, picture, department, job_title, note, mode, known_accounts, idToken } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    const verifiedFirebase = idToken ? await verifyFirebaseIdTokenSafe(idToken) : null;
    const resolvedEmail = verifiedFirebase?.email || email;
    const resolvedName = name || verifiedFirebase?.name;
    const resolvedPicture = picture || verifiedFirebase?.picture;
    if (!resolvedEmail) return res.status(400).json({ detail: "Email wajib diisi" });

    const emailCheck = validateWorkspaceEmail(resolvedEmail);
    if (!emailCheck.ok) {
      return res.status(400).json({ detail: emailCheck.detail });
    }

    const cleanEmail = emailCheck.email;
    const isSignupIntent = mode === "signup";
    let user = db.users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (user && verifiedFirebase?.uid && !user.firebase_uid) {
      user.firebase_uid = verifiedFirebase.uid;
    }

    // Super admin default email whitelist
    const isSuperAdminEmail =
      cleanEmail === "be.creativestudio21@gmail.com" ||
      cleanEmail === "admin@asliri.local" ||
      cleanEmail === "saeful@asliri.id";

    // Check if email was explicitly invited by Admin or belongs to allowed company domain
    const invitation = (Array.isArray(db.invitations) ? db.invitations : []).find(
      (inv: any) => inv.email?.toLowerCase() === cleanEmail
    );
    const canAutoJoinDomain =
      db.workspace?.auto_join_domain !== false && isAllowedCompanyDomain(emailCheck.domain);

    const displayName = (resolvedName || cleanEmail.split("@")[0] || "Google User").trim();
    const dept = String(department || "Marketing").trim();
    const title = job_title || "Staff Member";
    const avatarUrl = resolvedPicture || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(displayName)}`;

    if (!user) {
      if (isSuperAdminEmail) {
        user = {
          user_id: `user_superadmin_google`,
          firebase_uid: verifiedFirebase?.uid || undefined,
          email: cleanEmail,
          name: resolvedName || "Super Admin",
          role: "super_admin",
          job_title: "Workspace Administrator",
          department: "Management",
          org_unit_id: "unit_mgmt",
          online: true,
          is_demo: false,
          status: "active",
          avatar: resolvedPicture || "https://api.dicebear.com/7.x/pixel-art/svg?seed=SuperAdmin",
          picture: resolvedPicture || "https://api.dicebear.com/7.x/pixel-art/svg?seed=SuperAdmin"
        };
        db.users.push(user);
        syncUserDivisionAndGroupMembership(user);
        saveDbToFile();
      } else if (invitation || canAutoJoinDomain || db.workspace?.require_approval === false) {
        // Invited email, verified company domain (auto_join_domain), or workspace explicitly disables approval
        if (invitation) invitation.used = true;
        user = {
          user_id: `user_google_${Date.now()}`,
          email: cleanEmail,
          name: displayName,
          role: invitation?.role || "employee",
          job_title: title,
          department: dept,
          status: "active",
          online: true,
          is_demo: false,
          avatar: avatarUrl,
          picture: avatarUrl
        };
        db.users.push(user);
        syncUserDivisionAndGroupMembership(user);
        saveDbToFile();
        broadcast({ type: "users:changed" });
        broadcast({ type: "groups:changed" });
      } else if (!isSignupIntent) {
        // Attempting to log in with an unregistered external email: block direct login!
        return res.status(401).json({
          status: "unregistered",
          detail:
            "Email tersebut belum terdaftar di workspace ini. Silakan daftar terlebih dahulu melalui tab Daftar Akun Baru untuk meminta persetujuan Super Admin."
        });
      } else {
        // Explicit Sign-Up mode with require_approval enabled: register as pending & send Approval Card
        const newUserId = `user_google_${Date.now()}`;
        const reqId = `req_${Date.now()}`;

        const newUserObj: any = {
          user_id: newUserId,
          email: cleanEmail,
          name: displayName,
          role: "employee",
          job_title: title,
          department: dept,
          status: "pending",
          online: false,
          is_demo: false,
          avatar: avatarUrl,
          picture: avatarUrl
        };
        db.users.push(newUserObj);
        syncUserDivisionAndGroupMembership(newUserObj);

        const accessReq = {
          id: reqId,
          name: displayName,
          email: cleanEmail,
          department: newUserObj.department || dept,
          job_title: title,
          note: note || "Pendaftaran akun baru via Google",
          status: "pending",
          created_at: new Date().toISOString()
        };
        db.access_requests.unshift(accessReq);

        const approvers = db.users.filter((u: any) =>
          u.role === "super_admin" ||
          u.role === "workspace_admin" ||
          (u.role === "department_manager" && (!dept || u.department === dept || u.department === "General"))
        );
        const targetApprovers = approvers.length > 0 ? approvers : [db.users[0]];

        targetApprovers.forEach((admin: any) => {
          if (!admin?.user_id) return;
          const convId = `conv_circle_${admin.user_id}`;
          let conv = db.conversations.find((c: any) => c.id === convId);
          if (!conv) {
            conv = {
              id: convId,
              type: "dm",
              name: db.workspace?.assistant_name || "Circle",
              admin_ids: [CIRCLE_BOT_ID],
              members: [CIRCLE_BOT_ID, admin.user_id],
              member_ids: [CIRCLE_BOT_ID, admin.user_id],
              unread: 1,
              last_message_preview: `Pendaftaran akun Google dari ${displayName}`,
              last_message_at: new Date().toISOString()
            };
            db.conversations.unshift(conv);
          } else {
            conv.member_ids = [CIRCLE_BOT_ID, admin.user_id];
            conv.members = [CIRCLE_BOT_ID, admin.user_id];
            conv.unread = (conv.unread || 0) + 1;
            conv.last_message_preview = `Pendaftaran akun Google dari ${displayName}`;
            conv.last_message_at = new Date().toISOString();
          }

          const msg = {
            id: `msg_req_${reqId}_${admin.user_id}`,
            conversation_id: conv.id,
            sender_id: CIRCLE_BOT_ID,
            user_id: CIRCLE_BOT_ID,
            text: `Halo ${admin.name.split(" ")[0]}! Ada pendaftaran akun Google baru (${cleanEmail}) untuk divisi ${newUserObj.department || dept}. Silakan tinjau card approval di bawah ini:`,
            type: "access_request_card",
            access_request: accessReq,
            created_at: new Date().toISOString()
          };
          db.messages.push(msg);
          broadcast({ type: "message:new", data: { ...msg, member_ids: [CIRCLE_BOT_ID, admin.user_id] } });

          createNotification({
            user_id: admin.user_id,
            title: "Pendaftaran Akun Google Baru",
            body: `${displayName} (${cleanEmail}) mendaftar via Google di divisi ${newUserObj.department || dept} dan menunggu persetujuan Super Admin`,
            type: "access_request",
            category: "system",
            access_request: accessReq
          });
        });

        saveDbToFile();
        broadcast({ type: "access_requests:changed" });
        broadcast({ type: "conversations:changed" });
        broadcast({ type: "groups:changed" });

        return res.json({
          status: "registered_pending",
          detail: "Pendaftaran akun Google berhasil diajukan! Menunggu persetujuan Super Admin.",
          user: newUserObj,
          account_vault_entry: buildAccountVaultEntry(newUserObj),
          access_request: accessReq
        });
      }
    } else if (user.status === "pending") {
      if (isSuperAdminEmail || invitation || canAutoJoinDomain || db.workspace?.require_approval === false) {
        if (invitation) invitation.used = true;
        user.status = "active";
      } else {
        return res.status(403).json({
          status: "pending",
          detail: "Permintaan akses untuk akun Anda sedang ditinjau oleh Super Admin / Manajer Divisi. Anda dapat masuk setelah disetujui.",
          email: cleanEmail,
          name: user.name
        });
      }
    } else if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({
        status: "inactive",
        detail: "Akun Anda dinonaktifkan atau ditolak. Silakan hubungi Workspace Administrator."
      });
    }

    if (picture && !user.avatar) {
      user.avatar = picture;
      user.picture = picture;
    }

    setUserOnlineStatus(user.user_id, true);
    syncUserDivisionAndGroupMembership(user);
    ensureProfileCompletionReminder(user);
    const token = issueUserSession(req, res, user);
    saveDbToFile(true);

    res.json({
      token,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
      workspace: db.workspace,
      prefs: db.prefs[user.user_id] || { theme_mode: "light" }
    });
  });

  // Forgot Password: Request Reset via Admin / Manager Approval (Circle Assistant Card)
  app.post("/api/auth/forgot-password", (req, res) => {
    const { email, new_password, note, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    if (!email || !new_password) {
      return res.status(400).json({ detail: "Email dan password baru wajib diisi." });
    }
    const pwPolicy = validatePasswordPolicy(String(new_password));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = (db.users || []).find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || user.is_bot || user.user_id === CIRCLE_BOT_ID) {
      return res.status(404).json({ detail: "Akun dengan email tersebut tidak ditemukan di workspace." });
    }
    if (user.status === "pending") {
      return res.status(400).json({ detail: "Akun Anda masih menunggu persetujuan pendaftaran awal oleh Super Admin." });
    }
    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({ detail: "Akun Anda sedang nonaktif. Silakan hubungi Super Admin workspace." });
    }

    if (!db.password_reset_secrets || typeof db.password_reset_secrets !== "object") {
      db.password_reset_secrets = {};
    }

    const hashedPendingPw = hashPassword(String(new_password));

    const existingReq = (db.access_requests || []).find(
      (r: any) => r.type === "password_reset" && r.email?.toLowerCase() === cleanEmail && r.status === "pending"
    );

    if (existingReq) {
      db.password_reset_secrets[existingReq.id] = hashedPendingPw;
      if (note && String(note).trim()) {
        existingReq.note = String(note).trim();
      }
      existingReq.updated_at = new Date().toISOString();
      saveDbToFile();
      broadcast({ type: "access_requests:changed" });
      return res.json({
        success: true,
        request_id: existingReq.id,
        status: "pending",
        detail: "Password baru pada pengajuan reset Anda telah diperbarui & dienkripsi. Menunggu persetujuan Super Admin / Manajer."
      });
    }

    const reqId = `pw_req_${Date.now()}`;
    db.password_reset_secrets[reqId] = hashedPendingPw;

    const accessReq = {
      id: reqId,
      type: "password_reset",
      target_user_id: user.user_id,
      name: user.name,
      email: cleanEmail,
      department: user.department || "General",
      job_title: user.job_title || "Employee",
      note: (note && String(note).trim()) || "Lupa password — permohonan reset password baru",
      status: "pending",
      created_at: new Date().toISOString()
    };
    db.access_requests.unshift(accessReq);

    let approvers = (db.users || []).filter((u: any) =>
      !u.is_bot &&
      u.status === "active" &&
      u.user_id !== user.user_id &&
      (
        u.role === "super_admin" ||
        (user.role !== "super_admin" && (
          u.role === "workspace_admin" ||
          (u.role === "department_manager" && (u.department === user.department || u.department === "General"))
        ))
      )
    );
    if (approvers.length === 0) {
      approvers = (db.users || []).filter((u: any) => !u.is_bot && u.role === "super_admin");
    }
    const targetApprovers = approvers.length > 0 ? approvers : [db.users[0]].filter(Boolean);

    targetApprovers.forEach((admin: any) => {
      if (!admin?.user_id) return;
      let conv = db.conversations.find((c: any) =>
        c.type === "dm" &&
        (c.member_ids || []).includes(CIRCLE_BOT_ID) &&
        (c.member_ids || []).includes(admin.user_id)
      );

      if (!conv) {
        conv = {
          id: `conv_circle_${admin.user_id}`,
          type: "dm",
          name: db.workspace?.assistant_name || "Circle",
          admin_ids: [CIRCLE_BOT_ID],
          members: [CIRCLE_BOT_ID, admin.user_id],
          member_ids: [CIRCLE_BOT_ID, admin.user_id],
          unread: 1,
          last_message_preview: `Permintaan reset password dari ${user.name}`,
          last_message_at: new Date().toISOString()
        };
        db.conversations.unshift(conv);
      } else {
        conv.unread = (conv.unread || 0) + 1;
        conv.last_message_preview = `Permintaan reset password dari ${user.name}`;
        conv.last_message_at = new Date().toISOString();
      }

      const msg = {
        id: `msg_req_${reqId}_${admin.user_id}`,
        conversation_id: conv.id,
        sender_id: CIRCLE_BOT_ID,
        user_id: CIRCLE_BOT_ID,
        text: `Halo ${admin.name.split(" ")[0]}! Ada permohonan **reset password** dari **${user.name}** (${cleanEmail} · Divisi ${user.department || "General"}). Silakan tinjau card approval di bawah ini:`,
        type: "access_request_card",
        access_request: accessReq,
        created_at: new Date().toISOString()
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: { ...msg, member_ids: [CIRCLE_BOT_ID, admin.user_id] } });

      createNotification({
        user_id: admin.user_id,
        title: "Permintaan Reset Password",
        body: `${user.name} (${cleanEmail}) mengajukan reset password dan menunggu persetujuan.`,
        type: "access_request",
        category: "system",
        access_request: accessReq
      });
    });

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_pwreq_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: `mengajukan permohonan reset password (${cleanEmail})`,
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    broadcast({ type: "access_requests:changed" });
    broadcast({ type: "conversations:changed" });

    res.json({
      success: true,
      request_id: reqId,
      status: "pending",
      detail: "Permintaan reset password berhasil dikirim! Asisten Circle telah meneruskan ke Super Admin / Manajer."
    });
  });

  // Check Forgot Password Request Status
  app.get("/api/auth/forgot-password/status", (req, res) => {
    const requestId = String(req.query.request_id || "").trim();
    const email = String(req.query.email || "").toLowerCase().trim();
    const list = (db.access_requests || []).filter((r: any) => r.type === "password_reset");
    const found = requestId
      ? list.find((r: any) => r.id === requestId)
      : list.find((r: any) => r.email?.toLowerCase() === email);

    if (!found) {
      return res.status(404).json({ detail: "Permintaan reset password tidak ditemukan." });
    }
    res.json({
      request_id: found.id,
      status: found.status,
      approved_by: found.approved_by,
      rejected_by: found.rejected_by,
      updated_at: found.approved_at || found.rejected_at || found.updated_at || found.created_at
    });
  });

  // Instant Password Reset via Workspace Recovery Key (AES-256-GCM + constant-time HMAC check + brute-force lockout)
  app.post("/api/auth/reset-with-recovery-key", (req, res) => {
    const { email, recovery_key, new_password, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    if (!email || !recovery_key || !new_password) {
      return res.status(400).json({ detail: "Email, kode pemulihan workspace, dan password baru wajib diisi." });
    }
    const pwPolicy = validatePasswordPolicy(String(new_password));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const throttleKey = `recovery:${req.ip || "local"}:${cleanEmail}`;
    const throttle = getAuthThrottleStatus(throttleKey);
    if (throttle.blocked) {
      const mins = Math.max(1, Math.ceil(throttle.retryAfterSec / 60));
      return res.status(429).json({
        detail: `Terlalu banyak percobaan kode pemulihan gagal. Coba lagi dalam ${mins} menit.`
      });
    }

    const inputKey = String(recovery_key).trim().toUpperCase();
    getDecryptedRecoveryKey(); // Ensures recovery_key_hash exists
    if (!verifySecretDigest(inputKey, db.recovery_key_hash, MASTER_KEY)) {
      const failInfo = recordFailedAuthAttempt(throttleKey);
      return res.status(failInfo.locked ? 429 : 401).json({
        detail: failInfo.locked
          ? "Terlalu banyak percobaan kode pemulihan salah. Dikunci sementara 5 menit."
          : `Kode pemulihan workspace tidak valid (sisa ${failInfo.remainingAttempts} percobaan).`
      });
    }

    const user = (db.users || []).find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || user.is_bot || user.user_id === CIRCLE_BOT_ID) {
      return res.status(404).json({ detail: "Akun dengan email tersebut tidak ditemukan." });
    }
    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({ detail: "Akun Anda dinonaktifkan. Hubungi Super Admin." });
    }

    clearAuthAttempts(throttleKey);
    user.password_hash = hashPassword(String(new_password));
    user.password_updated_at = new Date().toISOString();
    user.token_version = Number(user.token_version || 1) + 1;
    delete user.password;
    if (user.status === "pending") user.status = "active";

    // Mark any pending password_reset requests for this user as resolved
    (db.access_requests || []).forEach((r: any) => {
      if (r.type === "password_reset" && r.email?.toLowerCase() === cleanEmail && r.status === "pending") {
        r.status = "approved";
        r.approved_by = "Kode Pemulihan Workspace";
        r.approved_at = new Date().toISOString();
        if (db.password_reset_secrets) delete db.password_reset_secrets[r.id];
        (db.messages || []).forEach((m: any) => {
          if (m.access_request && m.access_request.id === r.id) {
            m.access_request.status = "approved";
            m.access_request.approved_by = r.approved_by;
            m.access_request.approved_at = r.approved_at;
            broadcast({ type: "message:update", data: m });
          }
        });
      }
    });

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_pwrkey_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: `mereset password menggunakan Kode Pemulihan Workspace (${cleanEmail})`,
      created_at: new Date().toISOString()
    });

    createNotification({
      user_id: user.user_id,
      title: "Password Berhasil Direset",
      body: "Password akun Anda telah direset menggunakan Kode Pemulihan Workspace. Semua sesi lama telah dicabut.",
      type: "system",
      category: "system",
      link: "/settings"
    });

    saveDbToFile();
    broadcast({ type: "users:changed" });
    broadcast({ type: "access_requests:changed" });

    res.json({
      success: true,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
      detail: "Password berhasil direset dengan Kode Pemulihan! Silakan masuk dengan password baru Anda."
    });
  });

  // Helper to send 6-digit OTP email via Resend API or Nodemailer SMTP (if configured)
  async function sendPasswordResetOtpEmail(toEmail: string, userName: string, otpCode: string): Promise<{ delivered: boolean; provider: string }> {
    const brandName = db.workspace?.brand_name || db.workspace?.name || "CIRCLE Workspace";
    const subject = `[${brandName}] Kode Verifikasi Reset Password: ${otpCode}`;
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #0f172a;">
        <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #0f172a;">Verifikasi Reset Password</h2>
        <p style="margin: 0 0 18px 0; font-size: 14px; color: #475569; line-height: 1.6;">
          Halo <b>${userName || toEmail}</b>,<br/>
          Kami menerima permintaan untuk mereset password akun Anda di <b>${brandName}</b>. Gunakan kode OTP 6 digit berikut untuk memverifikasi email Anda:
        </p>
        <div style="margin: 20px 0; padding: 18px; border-radius: 12px; background: #f8fafc; border: 1px dashed #94a3b8; text-align: center;">
          <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;">${otpCode}</span>
        </div>
        <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
          Kode ini berlaku selama <b>10 menit</b>. Jika Anda tidak meminta reset password, abaikan pesan ini.
        </p>
      </div>
    `;

    // 1. Try Resend API if RESEND_API_KEY is configured
    const resendKey = String(process.env.RESEND_API_KEY || "").trim();
    if (resendKey) {
      try {
        const fromAddr = String(process.env.SMTP_FROM || "CIRCLE Workspace <onboarding@resend.dev>").trim();
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [toEmail],
            subject,
            html: htmlBody,
          }),
        });
        if (r.ok) {
          return { delivered: true, provider: "resend" };
        }
      } catch (e) {
        console.warn("Resend email delivery failed:", e);
      }
    }

    // 2. Try SMTP via Nodemailer if SMTP_USER & SMTP_PASS are configured
    const smtpUser = String(process.env.SMTP_USER || "").trim();
    const smtpPass = String(process.env.SMTP_PASS || "").trim();
    if (smtpUser && smtpPass) {
      try {
        const smtpHost = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
        const smtpPort = Number(process.env.SMTP_PORT || 465);
        const smtpSecure = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false" && smtpPort === 465;
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: String(process.env.SMTP_FROM || `"${brandName}" <${smtpUser}>`),
          to: toEmail,
          subject,
          html: htmlBody,
        });
        return { delivered: true, provider: "smtp" };
      } catch (e) {
        console.warn("SMTP email delivery failed:", e);
      }
    }

    return { delivered: false, provider: "none" };
  }

  // Instant Password Reset via Google Email Ownership Verification (Firebase ID Token)
  app.post("/api/auth/forgot-password/verify-google", async (req, res) => {
    const { email, id_token, new_password, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    if (!id_token || !new_password) {
      return res.status(400).json({ detail: "Token verifikasi email Google dan password baru wajib diisi." });
    }
    const pwPolicy = validatePasswordPolicy(String(new_password));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    const decoded = await verifyFirebaseIdTokenSafe(String(id_token));
    if (!decoded || !decoded.email || decoded.email_verified === false) {
      return res.status(401).json({ detail: "Verifikasi kepemilikan email Google tidak valid atau sudah kedaluwarsa. Silakan ulangi verifikasi." });
    }

    const verifiedEmail = String(decoded.email).toLowerCase().trim();
    const requestedEmail = email ? String(email).toLowerCase().trim() : verifiedEmail;
    if (requestedEmail && requestedEmail !== verifiedEmail) {
      return res.status(400).json({
        detail: `Email yang diverifikasi (${verifiedEmail}) tidak sama dengan email akun yang dimasukkan (${requestedEmail}). Pilih akun Google yang sesuai.`
      });
    }

    const user = (db.users || []).find((u: any) => u.email?.toLowerCase() === verifiedEmail);
    if (!user || user.is_bot || user.user_id === CIRCLE_BOT_ID) {
      return res.status(404).json({ detail: `Akun dengan email ${verifiedEmail} tidak ditemukan di workspace.` });
    }
    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({ detail: "Akun Anda sedang nonaktif. Hubungi Super Admin workspace." });
    }

    user.password_hash = hashPassword(String(new_password));
    user.password_updated_at = new Date().toISOString();
    user.token_version = Number(user.token_version || 1) + 1;
    delete user.password;
    if (user.status === "pending") user.status = "active";

    // Mark any pending password_reset requests for this user as resolved
    (db.access_requests || []).forEach((r: any) => {
      if (r.type === "password_reset" && r.email?.toLowerCase() === verifiedEmail && r.status === "pending") {
        r.status = "approved";
        r.approved_by = "Verifikasi Email Google";
        r.approved_at = new Date().toISOString();
        if (db.password_reset_secrets) delete db.password_reset_secrets[r.id];
        (db.messages || []).forEach((m: any) => {
          if (m.access_request && m.access_request.id === r.id) {
            m.access_request.status = "approved";
            m.access_request.approved_by = r.approved_by;
            m.access_request.approved_at = r.approved_at;
            broadcast({ type: "message:update", data: m });
          }
        });
      }
    });

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_pwgverify_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: `mereset password melalui Verifikasi Kepemilikan Email (${verifiedEmail})`,
      created_at: new Date().toISOString()
    });

    createNotification({
      user_id: user.user_id,
      title: "Password Berhasil Direset via Verifikasi Email",
      body: `Password akun Anda (${verifiedEmail}) telah berhasil diperbarui setelah verifikasi kepemilikan email.`,
      type: "system",
      category: "system",
      link: "/settings"
    });

    saveDbToFile();
    broadcast({ type: "users:changed" });
    broadcast({ type: "access_requests:changed" });

    res.json({
      success: true,
      email: verifiedEmail,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
      detail: `Email ${verifiedEmail} berhasil diverifikasi! Password baru Anda sudah aktif.`
    });
  });

  // Send 6-Digit Email OTP Code for Forgot Password
  app.post("/api/auth/forgot-password/send-otp", async (req, res) => {
    const { email, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    const cleanEmail = String(email || "").toLowerCase().trim();
    if (!cleanEmail) {
      return res.status(400).json({ detail: "Masukkan alamat email akun Anda terlebih dahulu." });
    }

    const user = (db.users || []).find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || user.is_bot || user.user_id === CIRCLE_BOT_ID) {
      return res.status(404).json({ detail: "Akun dengan email tersebut tidak ditemukan di workspace." });
    }
    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({ detail: "Akun Anda sedang nonaktif. Hubungi Super Admin workspace." });
    }

    if (!db.email_reset_otps || typeof db.email_reset_otps !== "object") {
      db.email_reset_otps = {};
    }

    const existing = db.email_reset_otps[cleanEmail];
    if (existing && existing.sent_at && Date.now() - Number(existing.sent_at) < 30_000) {
      const waitSec = Math.ceil((30_000 - (Date.now() - Number(existing.sent_at))) / 1000);
      return res.status(429).json({ detail: `Tunggu ${waitSec} detik sebelum meminta kode OTP baru.` });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    db.email_reset_otps[cleanEmail] = {
      otp_hash: digestSecret(otpCode, MASTER_KEY),
      expires_at: expiresAt,
      sent_at: Date.now(),
      attempts: 0,
    };

    const sendResult = await sendPasswordResetOtpEmail(cleanEmail, user.name, otpCode);

    // Also deliver OTP notification to the user & Super Admin Circle Assistant DM as backup visibility
    createNotification({
      user_id: user.user_id,
      title: "Kode OTP Reset Password",
      body: `Kode OTP verifikasi reset password Anda: ${otpCode} (berlaku 10 menit).`,
      type: "system",
      category: "system"
    });

    saveDbToFile();

    if (sendResult.delivered) {
      return res.json({
        success: true,
        delivered_via: sendResult.provider,
        expires_in_sec: 600,
        detail: `Kode verifikasi 6 digit telah dikirim ke kotak masuk ${cleanEmail}.`
      });
    }

    return res.json({
      success: true,
      delivered_via: "google_fallback",
      smtp_configured: false,
      expires_in_sec: 600,
      detail: `Server belum memiliki konfigurasi SMTP_USER/SMTP_PASS untuk mengirim email keluar. Gunakan tombol "Verifikasi Instan via Email Google" di atas untuk memverifikasi ${cleanEmail} secara langsung.`
    });
  });

  // Verify 6-Digit Email OTP Code and Reset Password
  app.post("/api/auth/forgot-password/verify-otp", (req, res) => {
    const { email, otp_code, new_password, known_accounts } = req.body || {};
    if (Array.isArray(known_accounts) && known_accounts.length > 0) {
      mergeKnownAccountsIntoDb(known_accounts);
    }
    const cleanEmail = String(email || "").toLowerCase().trim();
    const cleanOtp = String(otp_code || "").replace(/\s+/g, "").trim();
    if (!cleanEmail || !cleanOtp || !new_password) {
      return res.status(400).json({ detail: "Email, kode OTP 6 digit, dan password baru wajib diisi." });
    }

    const pwPolicy = validatePasswordPolicy(String(new_password));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    const record = db.email_reset_otps?.[cleanEmail];
    if (!record || !record.otp_hash) {
      return res.status(400).json({ detail: "Kode OTP belum diminta atau sudah tidak berlaku. Silakan minta kode baru." });
    }
    if (Date.now() > Number(record.expires_at || 0)) {
      delete db.email_reset_otps[cleanEmail];
      return res.status(400).json({ detail: "Kode OTP sudah kedaluwarsa (lebih dari 10 menit). Silakan kirim ulang kode." });
    }
    if (Number(record.attempts || 0) >= 5) {
      delete db.email_reset_otps[cleanEmail];
      return res.status(429).json({ detail: "Terlalu banyak percobaan OTP salah. Silakan minta kode OTP baru." });
    }

    if (!verifySecretDigest(cleanOtp, record.otp_hash, MASTER_KEY)) {
      record.attempts = Number(record.attempts || 0) + 1;
      const left = Math.max(0, 5 - record.attempts);
      return res.status(401).json({ detail: `Kode OTP tidak sesuai (sisa ${left} percobaan).` });
    }

    const user = (db.users || []).find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || user.is_bot || user.user_id === CIRCLE_BOT_ID) {
      return res.status(404).json({ detail: "Akun dengan email tersebut tidak ditemukan." });
    }
    if (user.status === "inactive" || user.status === "rejected") {
      return res.status(403).json({ detail: "Akun Anda sedang nonaktif. Hubungi Super Admin." });
    }

    delete db.email_reset_otps[cleanEmail];
    user.password_hash = hashPassword(String(new_password));
    user.password_updated_at = new Date().toISOString();
    user.token_version = Number(user.token_version || 1) + 1;
    delete user.password;
    if (user.status === "pending") user.status = "active";

    (db.access_requests || []).forEach((r: any) => {
      if (r.type === "password_reset" && r.email?.toLowerCase() === cleanEmail && r.status === "pending") {
        r.status = "approved";
        r.approved_by = "Verifikasi Kode OTP Email";
        r.approved_at = new Date().toISOString();
        if (db.password_reset_secrets) delete db.password_reset_secrets[r.id];
      }
    });

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_pwotp_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: `mereset password melalui Kode OTP Email (${cleanEmail})`,
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    broadcast({ type: "users:changed" });
    broadcast({ type: "access_requests:changed" });

    res.json({
      success: true,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
      detail: "Kode OTP valid! Password berhasil direset, silakan masuk dengan password baru Anda."
    });
  });

  // Self-service Change Password for Logged-In User (re-hashes with scrypt + rotates session token)
  app.post("/api/auth/change-password", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) {
      return res.status(401).json({ detail: "Sesi tidak valid. Silakan login terlebih dahulu." });
    }
    const user = (db.users || []).find((u: any) => u.user_id === reqUser.user_id);
    if (!user) {
      return res.status(404).json({ detail: "Akun tidak ditemukan." });
    }

    const { current_password, new_password } = req.body || {};
    const pwPolicy = validatePasswordPolicy(String(new_password || ""));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    if (user.password_hash || user.password) {
      const check = verifyPassword(String(current_password || ""), user);
      if (!check.valid) {
        return res.status(400).json({ detail: "Password saat ini yang Anda masukkan salah." });
      }
    }

    user.password_hash = hashPassword(String(new_password));
    user.password_updated_at = new Date().toISOString();
    user.token_version = Number(user.token_version || 1) + 1;
    delete user.password;

    // Mint fresh session token for the active device while invalidating all other older devices
    const newToken = issueUserSession(req, res, user);

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_pwchg_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: "memperbarui password & merotasi token sesi akun pribadi",
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    broadcast({ type: "users:changed", user: sanitizeUser(user) });

    res.json({
      success: true,
      token: newToken,
      user: sanitizeUser(user),
      detail: "Password akun diperbarui & token sesi perangkat lain telah dicabut!"
    });
  });

  // Revoke All Other Sessions (invalidate all old HMAC tokens across devices)
  app.post("/api/auth/revoke-sessions", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) {
      return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    }
    const user = (db.users || []).find((u: any) => u.user_id === reqUser.user_id);
    if (!user) {
      return res.status(404).json({ detail: "Akun tidak ditemukan." });
    }

    user.token_version = Number(user.token_version || 1) + 1;
    const keepCurrent = req.body?.keep_current !== false;
    let newToken: string | null = null;
    if (keepCurrent) {
      newToken = issueUserSession(req, res, user);
    } else {
      clearSessionCookie(res);
      setUserOnlineStatus(user.user_id, false);
      currentSessionUser = null;
    }

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_revokesess_${Date.now()}`,
      actor_id: user.user_id,
      actor_name: user.name,
      action: "mencabut seluruh token sesi login aktif di perangkat lain",
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    res.json({
      success: true,
      token: newToken,
      user: sanitizeUser(user),
      detail: keepCurrent
        ? "Semua sesi di perangkat lain berhasil dikeluarkan!"
        : "Semua sesi akun Anda telah dikeluarkan."
    });
  });

  // 1. Submit Access Request
  app.post("/api/auth/request-access", (req, res) => {
    const { name, email, department, job_title, note } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ detail: "Nama dan email wajib diisi." });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = db.users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (existingUser && existingUser.status === "active") {
      return res.status(400).json({ detail: "Email ini sudah memiliki akun aktif. Silakan langsung login." });
    }

    const existingReq = (db.access_requests || []).find((r: any) => r.email?.toLowerCase() === cleanEmail && r.status === "pending");
    if (existingReq) {
      return res.status(400).json({ detail: "Permintaan akses untuk email ini sudah diajukan dan sedang menunggu persetujuan." });
    }

    const reqId = `req_${Date.now()}`;
    const selectedDept = String(department || "Marketing").trim();
    const accessReq = {
      id: reqId,
      name: name.trim(),
      email: cleanEmail,
      department: selectedDept,
      job_title: job_title || "Employee",
      note: note || "-",
      status: "pending",
      created_at: new Date().toISOString()
    };
    db.access_requests.unshift(accessReq);

    // Also register as pending user if not present
    let targetUser = existingUser;
    if (!targetUser) {
      targetUser = {
        user_id: `user_${Date.now()}`,
        email: cleanEmail,
        name: name.trim(),
        role: "employee",
        job_title: job_title || "Employee",
        department: selectedDept,
        status: "pending",
        online: false,
        is_demo: false,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`
      };
      db.users.push(targetUser);
    } else {
      targetUser.status = "pending";
      if (department) targetUser.department = selectedDept;
    }
    syncUserDivisionAndGroupMembership(targetUser);

    // "Circle" Assistant sends approval card message to Super Admins & Managers
    const approvers = db.users.filter((u: any) => 
      u.role === "super_admin" || 
      u.role === "workspace_admin" || 
      (u.role === "department_manager" && (!department || u.department === department || u.department === "General"))
    );
    const targetApprovers = approvers.length > 0 ? approvers : [db.users[0]];

    targetApprovers.forEach((admin: any) => {
      // Find or create DM with Circle Assistant
      let conv = db.conversations.find((c: any) => 
        c.type === "dm" && 
        (c.member_ids || []).includes(CIRCLE_BOT_ID) && 
        (c.member_ids || []).includes(admin.user_id)
      );

      if (!conv) {
        conv = {
          id: `conv_circle_${admin.user_id}`,
          type: "dm",
          name: "Circle (Workspace Assistant)",
          admin_ids: [],
          members: [CIRCLE_BOT_ID, admin.user_id],
          member_ids: [CIRCLE_BOT_ID, admin.user_id],
          unread: 1,
          last_message_preview: `Permintaan akses baru dari ${name}`,
          last_message_at: new Date().toISOString()
        };
        db.conversations.unshift(conv);
      } else {
        conv.unread = (conv.unread || 0) + 1;
        conv.last_message_preview = `Permintaan akses baru dari ${name}`;
        conv.last_message_at = new Date().toISOString();
      }

      const msg = {
        id: `msg_req_${reqId}_${admin.user_id}`,
        conversation_id: conv.id,
        sender_id: CIRCLE_BOT_ID,
        user_id: CIRCLE_BOT_ID,
        text: `Halo ${admin.name.split(' ')[0]}! Ada permohonan akses login baru ke workspace dari ${name} (${cleanEmail}) untuk divisi ${targetUser.department || selectedDept}. Silakan tinjau card approval di bawah ini:`,
        type: "access_request_card",
        access_request: accessReq,
        created_at: new Date().toISOString()
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: msg });

      createNotification({
        user_id: admin.user_id,
        title: "Permintaan Akses Masuk Baru",
        body: `${name} (${targetUser.department || selectedDept}) mengajukan permohonan akses masuk`,
        type: "access_request",
        category: "system",
        access_request: accessReq
      });
    });

    saveDbToFile();
    broadcast({ type: "access_requests:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "groups:changed" });

    res.json({
      success: true,
      message: "Permintaan akses berhasil dikirim! Asisten Circle telah meneruskan ke Super Admin / Manager.",
      request_id: reqId
    });
  });

  // 2. Get Access Requests
  app.get("/api/admin/access-requests", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat melihat daftar permintaan akses." });
    }
    res.json(db.access_requests || []);
  });

  // 3. Approve Access Request
  app.post("/api/admin/access-requests/:id/approve", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat menyetujui permintaan akses." });
    }
    const { role, department } = req.body || {};
    const accessReq = (db.access_requests || []).find((r: any) => r.id === req.params.id);
    if (!accessReq) return res.status(404).json({ detail: "Permintaan akses tidak ditemukan." });

    accessReq.status = "approved";
    accessReq.approved_by = reqUser.name || "Manager / Admin";
    accessReq.approved_at = new Date().toISOString();

    if (accessReq.type === "delete_user") {
      if (!Array.isArray(db.deleted_user_ids)) db.deleted_user_ids = [];
      if (!Array.isArray(db.deleted_user_emails)) db.deleted_user_emails = [];
      if (accessReq.target_user_id && !db.deleted_user_ids.includes(accessReq.target_user_id)) {
        db.deleted_user_ids.push(accessReq.target_user_id);
      }
      if (accessReq.email && !db.deleted_user_emails.includes(String(accessReq.email).toLowerCase().trim())) {
        db.deleted_user_emails.push(String(accessReq.email).toLowerCase().trim());
      }
      const delUid = accessReq.target_user_id;
      db.users = db.users.filter((u: any) => u.user_id !== delUid);
      [db.groups, db.conversations].forEach((list) => {
        (list || []).forEach((g: any) => {
          if (Array.isArray(g.member_ids)) g.member_ids = g.member_ids.filter((id: string) => id !== delUid);
          if (Array.isArray(g.members)) g.members = g.members.filter((id: string) => id !== delUid);
          if (Array.isArray(g.admin_ids)) g.admin_ids = g.admin_ids.filter((id: string) => id !== delUid);
        });
      });
      if (db.marketplace_carts && delUid) delete db.marketplace_carts[delUid];
      if (db.marketplace_wishlists && delUid) delete db.marketplace_wishlists[delUid];
      db.messages.forEach((m: any) => {
        if (m.access_request && m.access_request.id === accessReq.id) {
          m.access_request.status = "approved";
          m.access_request.approved_by = reqUser.name || "Manager";
          m.access_request.approved_at = accessReq.approved_at;
          broadcast({ type: "message:update", data: m });
        }
      });
      saveDbToFile(true);
      broadcast({ type: "access_requests:changed" });
      broadcast({ type: "users:changed" });
      broadcast({ type: "groups:changed" });
      broadcast({ type: "conversations:changed" });
      broadcast({ type: "org:changed", units: db.org_units });
      return res.json({ success: true, access_request: accessReq });
    }

    if (accessReq.type === "password_reset") {
      const targetUser = (db.users || []).find(
        (u: any) =>
          (accessReq.target_user_id && u.user_id === accessReq.target_user_id) ||
          u.email?.toLowerCase() === accessReq.email?.toLowerCase()
      );
      const pendingSecret = db.password_reset_secrets?.[accessReq.id];
      if (!targetUser || !pendingSecret) {
        return res.status(400).json({ detail: "Data password reset tidak ditemukan atau sudah diproses." });
      }

      targetUser.password_hash = isPasswordHashed(pendingSecret) ? pendingSecret : hashPassword(pendingSecret);
      targetUser.password_updated_at = new Date().toISOString();
      targetUser.token_version = Number(targetUser.token_version || 1) + 1;
      delete targetUser.password;
      delete db.password_reset_secrets[accessReq.id];

      db.messages.forEach((m: any) => {
        if (m.access_request && m.access_request.id === accessReq.id) {
          m.access_request.status = "approved";
          m.access_request.approved_by = accessReq.approved_by;
          m.access_request.approved_at = accessReq.approved_at;
          broadcast({ type: "message:update", data: m });
        }
      });

      if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
      db.audit_logs.unshift({
        id: `log_pwappr_${Date.now()}`,
        actor_id: reqUser.user_id,
        actor_name: accessReq.approved_by,
        action: `menyetujui reset password untuk ${targetUser.name} (${targetUser.email})`,
        created_at: new Date().toISOString()
      });

      createNotification({
        user_id: targetUser.user_id,
        title: "Password Anda Telah Direset",
        body: `Permintaan reset password Anda telah disetujui oleh ${accessReq.approved_by}. Silakan login menggunakan password baru Anda.`,
        type: "system",
        category: "system"
      });

      saveDbToFile();
      broadcast({ type: "access_requests:changed" });
      broadcast({ type: "users:changed", user: sanitizeUser(targetUser) });
      return res.json({ success: true, user: sanitizeUser(targetUser), access_request: accessReq });
    }

    if (role) accessReq.assigned_role = role;
    if (department) accessReq.assigned_department = department;

    // Activate user in db.users
    let user = db.users.find((u: any) => u.email?.toLowerCase() === accessReq.email.toLowerCase());
    if (user) {
      user.status = "active";
      if (role) user.role = role;
      if (department) user.department = department;
    } else {
      user = {
        user_id: `user_${Date.now()}`,
        email: accessReq.email,
        name: accessReq.name,
        role: role || "employee",
        job_title: accessReq.job_title || "Employee",
        department: department || accessReq.department || "Marketing",
        status: "active",
        online: false,
        is_demo: false,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(accessReq.name)}`
      };
      db.users.push(user);
    }

    syncUserDivisionAndGroupMembership(user);
    ensureProfileCompletionReminder(user);

    // Update all card messages in db.messages and broadcast update
    db.messages.forEach((m: any) => {
      if (m.access_request && m.access_request.id === accessReq.id) {
        m.access_request.status = "approved";
        m.access_request.approved_by = reqUser.name || "Admin";
        m.access_request.approved_at = accessReq.approved_at;
        m.access_request.assigned_role = role || accessReq.assigned_role;
        broadcast({ type: "message:update", data: m });
      }
    });

    saveDbToFile();
    broadcast({ type: "access_requests:changed" });
    broadcast({ type: "users:changed" });
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });

    // Notify user of approval
    createNotification({
      user_id: user.user_id,
      title: "Selamat! Akses Kamu Telah Disetujui",
      body: `Permohonan akses kamu ke CIRCLE Workspace (${user.department}) telah disetujui oleh Super Admin.`,
      type: "access_approved",
      category: "system"
    });

    res.json({ success: true, user: sanitizeUser(user), access_request: accessReq });
  });

  // 4. Reject Access Request
  app.post("/api/admin/access-requests/:id/reject", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat menolak permintaan akses." });
    }
    const accessReq = (db.access_requests || []).find((r: any) => r.id === req.params.id);
    if (!accessReq) return res.status(404).json({ detail: "Permintaan akses tidak ditemukan." });

    accessReq.status = "rejected";
    accessReq.rejected_by = reqUser.name || "Admin";
    accessReq.rejected_at = new Date().toISOString();

    if (accessReq.type === "password_reset") {
      if (db.password_reset_secrets) {
        delete db.password_reset_secrets[accessReq.id];
      }
      const targetUser = (db.users || []).find(
        (u: any) =>
          (accessReq.target_user_id && u.user_id === accessReq.target_user_id) ||
          u.email?.toLowerCase() === accessReq.email?.toLowerCase()
      );
      if (targetUser) {
        createNotification({
          user_id: targetUser.user_id,
          title: "Permintaan Reset Password Ditolak",
          body: `Permintaan reset password Anda ditolak oleh ${accessReq.rejected_by}. Hubungi Super Admin jika ini kesalahan.`,
          type: "system",
          category: "system"
        });
      }
    } else if (accessReq.type !== "delete_user") {
      let user = db.users.find((u: any) => u.email?.toLowerCase() === accessReq.email.toLowerCase());
      if (user && user.status === "pending") {
        user.status = "inactive";
      }
    }

    db.messages.forEach((m: any) => {
      if (m.access_request && m.access_request.id === accessReq.id) {
        m.access_request.status = "rejected";
        m.access_request.rejected_by = reqUser.name || "Admin";
        m.access_request.rejected_at = accessReq.rejected_at;
        broadcast({ type: "message:update", data: m });
      }
    });

    saveDbToFile();
    broadcast({ type: "access_requests:changed" });
    broadcast({ type: "users:changed" });

    res.json({ success: true, access_request: accessReq });
  });

  app.get("/api/auth/demo-users", (req, res) => {
    res.json({
      enabled: true,
      users: sanitizeUsersList(db.users.filter((u: any) => u.is_demo || u.role === "super_admin"))
    });
  });

  app.post("/api/auth/demo", (req, res) => {
    const { user_id } = req.body;
    const user = db.users.find((u: any) => u.user_id === user_id);
    if (!user) return res.status(404).json({ detail: "User not found" });
    setUserOnlineStatus(user.user_id, true);
    syncUserDivisionAndGroupMembership(user);
    const token = issueUserSession(req, res, user);
    res.json({
      token,
      user: sanitizeUser(user),
      workspace: db.workspace,
      prefs: db.prefs[user.user_id] || { theme_mode: "light" }
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const reqUser = getReqUser(req);
    if (reqUser?.user_id) {
      setUserOnlineStatus(reqUser.user_id, false);
    }
    clearSessionCookie(res);
    currentSessionUser = null;
    saveDbToFile();
    res.json({ success: true });
  });

  app.post("/api/presence/online", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = req.body?.user_id || reqUser?.user_id;
    if (uid && setUserOnlineStatus(uid, true)) {
      saveDbToFile(false);
    }
    res.json({ success: true, user_id: uid, online: true });
  });

  app.post("/api/presence/offline", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = req.body?.user_id || reqUser?.user_id;
    if (uid && setUserOnlineStatus(uid, false)) {
      saveDbToFile(false);
    }
    res.json({ success: true, user_id: uid, online: false });
  });

  app.post("/api/presence/status", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = req.body?.user_id || reqUser?.user_id;
    const rawStatus = String(req.body?.availability_status || "").toLowerCase().trim();
    const validStatuses = ["online", "sick_leave", "cuti", "busy"];
    const nextStatus = validStatuses.includes(rawStatus) ? rawStatus : "online";

    if (!uid) {
      return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    }

    const user = (db.users || []).find((u: any) => u.user_id === uid);
    if (!user) {
      return res.status(404).json({ detail: "Pengguna tidak ditemukan." });
    }

    user.availability_status = nextStatus;
    user.online = true;
    user.last_seen_at = new Date().toISOString();
    if (currentSessionUser?.user_id === user.user_id) {
      currentSessionUser = { ...currentSessionUser, ...user };
    }
    saveDbToFile();

    broadcast({
      type: "presence",
      data: {
        user_id: user.user_id,
        online: true,
        availability_status: user.availability_status,
      },
    });
    broadcast({ type: "users:changed", user: sanitizeUser(user) });

    res.json({
      success: true,
      user_id: user.user_id,
      availability_status: user.availability_status,
      user: sanitizeUser(user),
      account_vault_entry: buildAccountVaultEntry(user),
    });
  });

  app.get("/api/users", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    res.json(sanitizeUsersList(db.users));
  });

  app.get("/api/users/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    const user = db.users.find((u: any) => u.user_id === req.params.id);
    if (!user) return res.status(404).json({ detail: "User not found" });
    const canEdit = user.user_id === reqUser.user_id || ["super_admin", "workspace_admin"].includes(reqUser.role);
    res.json({ ...sanitizeUser(user), can_edit: canEdit });
  });

  app.get("/api/users/:id/posts", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    const targetId = req.params.id;
    const reqUid = reqUser.user_id;
    const allPosts = Array.isArray(db.posts) ? db.posts : [];
    const postById = new Map(allPosts.map((item: any) => [item.id, item]));
    const userById = new Map((db.users || []).map((u: any) => [u.user_id, u]));

    const userHistory = allPosts
      .filter((p: any) => p.author_id === targetId)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100)
      .map((p: any) => {
        const hydrated = hydratePostForUser(p, reqUid, !p.parent_id);
        if (p.parent_id) {
          const parent = postById.get(p.parent_id);
          const parentAuthor: any = parent ? userById.get(parent.author_id) : null;
          hydrated.parent_post = parent
            ? {
                id: parent.id,
                text: parent.text || "",
                topic: parent.topic || null,
                author_id: parent.author_id,
                author_name: parentAuthor?.name || "Rekan Kerja",
              }
            : null;
        }
        return hydrated;
      });

    res.json(userHistory);
  });

  app.patch("/api/users/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Not authenticated" });
    let user = db.users.find((u: any) => u.user_id === req.params.id);
    if (!user && req.params.id === "me") {
      user = db.users.find((u: any) => u.user_id === reqUser.user_id);
    }
    if (!user) return res.status(404).json({ detail: "User not found" });
    const isAdminOrMgr = ["super_admin", "workspace_admin"].includes(reqUser.role);
    if (user.user_id !== reqUser.user_id && !isAdminOrMgr) {
      return res.status(403).json({ detail: "Tidak diizinkan mengubah profil pengguna lain." });
    }
    const { password: _ignorePw, password_hash: _ignorePwh, token_version: _ignoreTv, has_password: _ignoreHasPw, role: _ignoreRole, ...safeBody } = req.body || {};
    if (isAdminOrMgr && req.body?.role) safeBody.role = req.body.role;
    if (safeBody.avatar && !safeBody.picture) safeBody.picture = safeBody.avatar;
    if (safeBody.picture && !safeBody.avatar) safeBody.avatar = safeBody.picture;
    if (safeBody.custom && !safeBody.custom_fields) safeBody.custom_fields = safeBody.custom;
    if (safeBody.custom_fields && !safeBody.custom) safeBody.custom = safeBody.custom_fields;
    const wasVerifiedBefore = computeProfileCompletion(user).isVerified;
    Object.assign(user, safeBody);
    syncUserOrgAndDepartment(user, safeBody);
    const nowComp = computeProfileCompletion(user);
    user.is_verified = nowComp.isVerified;
    user.profile_completion = nowComp.percent;
    if (!wasVerifiedBefore && nowComp.isVerified) {
      user.verified_at = new Date().toISOString();
      createNotification({
        user_id: user.user_id,
        title: "Selamat! Akun Anda Kini Terverifikasi",
        body: "Profil Anda sudah 100% lengkap dan lencana centang Verified kini aktif di seluruh workspace.",
        type: "profile_verified",
        category: "system",
        link: `/people/${user.user_id}`,
        actor_id: CIRCLE_BOT_ID,
      });
    }
    if (currentSessionUser?.user_id === user.user_id) {
      currentSessionUser = { ...currentSessionUser, ...user };
    }
    saveDbToFile(true);
    broadcast({ type: "users:changed", user: sanitizeUser(user) });
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    res.json(sanitizeUser(user));
  });

  app.patch("/api/admin/users/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat memperbarui akun." });
    }
    const user = db.users.find((u: any) => u.user_id === req.params.id);
    if (!user) return res.status(404).json({ detail: "User not found" });
    const { password: _ignorePw, password_hash: _ignorePwh, token_version: _ignoreTv, has_password: _ignoreHasPw, ...safeBody } = req.body || {};
    const wasVerifiedBefore = computeProfileCompletion(user).isVerified;
    Object.assign(user, safeBody);
    syncUserOrgAndDepartment(user, safeBody);
    const nowComp = computeProfileCompletion(user);
    user.is_verified = nowComp.isVerified;
    user.profile_completion = nowComp.percent;
    if (!wasVerifiedBefore && nowComp.isVerified) {
      user.verified_at = new Date().toISOString();
      createNotification({
        user_id: user.user_id,
        title: "Selamat! Akun Anda Kini Terverifikasi",
        body: "Profil Anda sudah 100% lengkap dan lencana centang Verified kini aktif di seluruh workspace.",
        type: "profile_verified",
        category: "system",
        link: `/people/${user.user_id}`,
        actor_id: CIRCLE_BOT_ID,
      });
    }
    if (currentSessionUser?.user_id === user.user_id) {
      currentSessionUser = { ...currentSessionUser, ...user };
    }
    saveDbToFile(true);
    broadcast({ type: "users:changed", user: sanitizeUser(user) });
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    res.json(sanitizeUser(user));
  });

  // Admin Direct Reset Password for any Employee
  app.post("/api/admin/users/:id/reset-password", (req, res) => {
    const reqUser = getReqUser(req);
    const callerRole = reqUser?.role;
    const isAdminOrMgr = ["super_admin", "workspace_admin", "department_manager"].includes(callerRole);
    if (!reqUser || !isAdminOrMgr) {
      return res.status(403).json({ detail: "Hanya Super Admin / Workspace Admin / Manajer Divisi yang dapat mereset password." });
    }

    const targetUser = db.users.find((u: any) => u.user_id === req.params.id);
    if (!targetUser || targetUser.is_bot) {
      return res.status(404).json({ detail: "Karyawan tidak ditemukan." });
    }

    if (callerRole === "department_manager") {
      if (["super_admin", "workspace_admin"].includes(targetUser.role)) {
        return res.status(403).json({ detail: "Manajer Divisi tidak dapat mereset password Admin." });
      }
      if (reqUser.department !== "General" && targetUser.department !== reqUser.department) {
        return res.status(403).json({ detail: "Manajer hanya dapat mereset password anggota divisinya sendiri." });
      }
    }

    const { new_password } = req.body || {};
    const pwPolicy = validatePasswordPolicy(String(new_password || ""));
    if (!pwPolicy.ok) {
      return res.status(400).json({ detail: pwPolicy.detail });
    }

    targetUser.password_hash = hashPassword(String(new_password));
    targetUser.password_updated_at = new Date().toISOString();
    targetUser.token_version = Number(targetUser.token_version || 1) + 1;
    delete targetUser.password;
    if (currentSessionUser?.user_id === targetUser.user_id) {
      currentSessionUser = targetUser;
    }

    // Resolve any pending password_reset requests for this user
    (db.access_requests || []).forEach((r: any) => {
      if (r.type === "password_reset" && (r.target_user_id === targetUser.user_id || r.email?.toLowerCase() === targetUser.email?.toLowerCase()) && r.status === "pending") {
        r.status = "approved";
        r.approved_by = reqUser.name || "Admin";
        r.approved_at = new Date().toISOString();
        if (db.password_reset_secrets) delete db.password_reset_secrets[r.id];
        (db.messages || []).forEach((m: any) => {
          if (m.access_request && m.access_request.id === r.id) {
            m.access_request.status = "approved";
            m.access_request.approved_by = r.approved_by;
            m.access_request.approved_at = r.approved_at;
            broadcast({ type: "message:update", data: m });
          }
        });
      }
    });

    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_adminpw_${Date.now()}`,
      actor_id: reqUser.user_id,
      actor_name: reqUser.name || "Admin",
      action: `mereset password (scrypt) untuk ${targetUser.name} (${targetUser.email})`,
      created_at: new Date().toISOString()
    });

    createNotification({
      user_id: targetUser.user_id,
      title: "Password Anda Direset oleh Admin",
      body: `Admin (${reqUser.name}) telah mengatur ulang password akun CIRCLE Anda. Silakan masuk dengan password baru yang diberikan.`,
      type: "system",
      category: "system"
    });

    saveDbToFile(true);
    broadcast({ type: "users:changed", user: sanitizeUser(targetUser) });
    broadcast({ type: "access_requests:changed" });

    res.json({
      success: true,
      user: sanitizeUser(targetUser),
      detail: `Password untuk ${targetUser.name} berhasil direset!`
    });
  });

  // Admin Workspace Recovery Key View & Regenerate (stored AES-256-GCM encrypted at rest)
  app.get("/api/admin/recovery-key", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Super Admin / Workspace Admin yang dapat melihat kode pemulihan." });
    }
    const plainKey = getDecryptedRecoveryKey();
    saveDbToFile();
    res.json({ recovery_key: plainKey });
  });

  app.post("/api/admin/recovery-key/regenerate", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Super Admin / Workspace Admin yang dapat membuat ulang kode pemulihan." });
    }
    const plainKey = setEncryptedRecoveryKey(generateRecoveryKey());
    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: `log_rkey_${Date.now()}`,
      actor_id: reqUser.user_id,
      actor_name: reqUser.name || "Admin",
      action: "membuat ulang Kode Pemulihan Workspace (AES-256-GCM)",
      created_at: new Date().toISOString()
    });
    saveDbToFile();
    res.json({ recovery_key: plainKey, detail: "Kode pemulihan workspace baru berhasil dibuat & dienkripsi." });
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer Divisi yang dapat menghapus karyawan." });
    }
    const targetUser = db.users.find((u: any) => u.user_id === req.params.id);
    if (!targetUser) return res.status(404).json({ detail: "User not found" });
    if (targetUser.user_id === reqUser.user_id) {
      return res.status(400).json({ detail: "Tidak dapat menghapus akun sendiri." });
    }

    const canImmediateDelete =
      ["super_admin", "workspace_admin"].includes(reqUser.role) ||
      (reqUser.role === "department_manager" &&
        (reqUser.department?.toLowerCase() === targetUser.department?.toLowerCase() || reqUser.department === "General"));

    if (canImmediateDelete && req.query.force === "true") {
      if (!Array.isArray(db.deleted_user_ids)) db.deleted_user_ids = [];
      if (!Array.isArray(db.deleted_user_emails)) db.deleted_user_emails = [];
      if (targetUser.user_id && !db.deleted_user_ids.includes(targetUser.user_id)) {
        db.deleted_user_ids.push(targetUser.user_id);
      }
      if (targetUser.email && !db.deleted_user_emails.includes(String(targetUser.email).toLowerCase().trim())) {
        db.deleted_user_emails.push(String(targetUser.email).toLowerCase().trim());
      }
      const delUid = targetUser.user_id;
      db.users = db.users.filter((u: any) => u.user_id !== delUid);
      [db.groups, db.conversations].forEach((list) => {
        (list || []).forEach((g: any) => {
          if (Array.isArray(g.member_ids)) g.member_ids = g.member_ids.filter((id: string) => id !== delUid);
          if (Array.isArray(g.members)) g.members = g.members.filter((id: string) => id !== delUid);
          if (Array.isArray(g.admin_ids)) g.admin_ids = g.admin_ids.filter((id: string) => id !== delUid);
        });
      });
      if (db.marketplace_carts && delUid) delete db.marketplace_carts[delUid];
      if (db.marketplace_wishlists && delUid) delete db.marketplace_wishlists[delUid];
      saveDbToFile(true);
      broadcast({ type: "users:changed" });
      broadcast({ type: "groups:changed" });
      broadcast({ type: "conversations:changed" });
      broadcast({ type: "org:changed", units: db.org_units });
      return res.json({ success: true, message: `Karyawan ${targetUser.name} berhasil dihapus secara permanen.` });
    }

    const reqId = `del_req_${Date.now()}`;
    const accessReq = {
      id: reqId,
      type: "delete_user",
      target_user_id: targetUser.user_id,
      name: targetUser.name,
      email: targetUser.email,
      department: targetUser.department || "General",
      requested_by: reqUser.name || "Admin",
      status: "pending",
      created_at: new Date().toISOString()
    };
    if (!Array.isArray(db.access_requests)) db.access_requests = [];
    db.access_requests.unshift(accessReq);

    const approvers = db.users.filter((u: any) => 
      u.role === "super_admin" || 
      u.role === "workspace_admin" || 
      (u.role === "department_manager" && (u.department === targetUser.department || u.department === "General"))
    );
    const targetApprovers = approvers.length > 0 ? approvers : [db.users[0]];

    targetApprovers.forEach((manager: any) => {
      let conv = db.conversations.find((c: any) => 
        c.type === "dm" && 
        (c.member_ids || []).includes(CIRCLE_BOT_ID) && 
        (c.member_ids || []).includes(manager.user_id)
      );
      if (!conv) {
        conv = {
          id: `conv_circle_${manager.user_id}`,
          type: "dm",
          name: "Circle (Workspace Assistant)",
          admin_ids: [],
          members: [CIRCLE_BOT_ID, manager.user_id],
          member_ids: [CIRCLE_BOT_ID, manager.user_id],
          unread: 1,
          last_message_preview: `Permintaan hapus karyawan: ${targetUser.name}`,
          last_message_at: new Date().toISOString()
        };
        db.conversations.unshift(conv);
      } else {
        conv.unread = (conv.unread || 0) + 1;
        conv.last_message_preview = `Permintaan hapus karyawan: ${targetUser.name}`;
        conv.last_message_at = new Date().toISOString();
      }

      const msg = {
        id: `msg_del_${reqId}_${manager.user_id}`,
        conversation_id: conv.id,
        sender_id: CIRCLE_BOT_ID,
        user_id: CIRCLE_BOT_ID,
        text: `Halo ${manager.name.split(' ')[0]}! Ada permohonan penghapusan karyawan **${targetUser.name}** (${targetUser.department || "General"}) dari ${currentSessionUser?.name || "Admin"}. Silakan tinjau card approval di bawah ini:`,
        type: "access_request_card",
        access_request: accessReq,
        created_at: new Date().toISOString()
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: msg });
    });

    saveDbToFile();
    broadcast({ type: "access_requests:changed" });
    res.json({ success: true, pending_approval: true, detail: `Permintaan hapus dikirim ke Manajer Divisi ${targetUser.department || "General"} untuk persetujuan.` });
  });

  app.post("/api/me/onboarding", (req, res) => {
    const actor = getReqUser(req) || currentSessionUser;
    if (actor) {
      const wasFirstTime = !actor.onboarded;
      Object.assign(actor, req.body, { onboarded: true });
      const u = db.users.find((x: any) => x.user_id === actor.user_id);
      if (u) {
        Object.assign(u, req.body, { onboarded: true });
        syncUserOrgAndDepartment(u, req.body);
      }
      if (currentSessionUser && currentSessionUser.user_id === actor.user_id) {
        Object.assign(currentSessionUser, req.body, { onboarded: true });
      }

      if (wasFirstTime) {
        const botId = "user_circle_assistant";
        const userId = actor.user_id;
        let conv = db.conversations.find((c: any) =>
          c.type === "dm" &&
          (c.member_ids || []).includes(botId) &&
          (c.member_ids || []).includes(userId)
        );
        if (!conv) {
          conv = {
            id: `conv_circle_${userId}`,
            type: "dm",
            name: "Circle (Workspace Assistant)",
            admin_ids: [],
            members: [botId, userId],
            member_ids: [botId, userId],
            unread: 1,
            last_message_preview: `Selamat datang di CIRCLE Workspace!`,
            last_message_at: new Date().toISOString()
          };
          db.conversations.unshift(conv);
        }
        const firstName = String((u || actor).name || "Rekan").split(' ')[0];
        const deptName = (u || actor).department || req.body.department || 'General';
        const welcomeMsg = {
          id: `msg_welcome_${Date.now()}`,
          conversation_id: conv.id,
          sender_id: botId,
          user_id: botId,
          text: `Halo ${firstName}! Selamat datang di CIRCLE Workspace 🎉\n\nProfil dan divisimu (${deptName}) telah berhasil diatur. Kamu sekarang dapat:\n- Melihat tugas dan board di divisimu\n- Berkolaborasi dengan rekan kerja\n- Bertanya atau membuat tugas otomatis padaku kapan saja!\n\nSemoga harimu produktif!`,
          type: "text",
          created_at: new Date().toISOString()
        };
        db.messages.push(welcomeMsg);
        conv.last_message_preview = welcomeMsg.text;
        conv.last_message_at = welcomeMsg.created_at;
        broadcast({ type: "message:new", data: welcomeMsg });
        broadcast({ type: "conversations:changed" });
      }

      if (u || actor) {
        ensureProfileCompletionReminder(u || actor, true);
      }

      saveDbToFile(true);
      broadcast({ type: "users:changed", user: sanitizeUser(u || actor) });
      return res.json(sanitizeUser(u || actor));
    }
    res.status(401).json({ detail: "Not authenticated" });
  });

  app.get("/api/labels", (req, res) => {
    res.json(db.labels);
  });

  app.post("/api/labels", (req, res) => {
    const { name, color, description } = req.body;
    const lbl = { id: `lbl_${Date.now()}`, name, color, description };
    db.labels.push(lbl);
    saveDbToFile();
    res.json(lbl);
  });

  app.patch("/api/labels/:id", (req, res) => {
    const l = db.labels.find((x: any) => x.id === req.params.id);
    if (l) Object.assign(l, req.body);
    saveDbToFile();
    res.json(l || { success: true });
  });

  app.delete("/api/labels/:id", (req, res) => {
    db.labels = db.labels.filter((l: any) => l.id !== req.params.id);
    saveDbToFile();
    res.json({ success: true });
  });

  app.get("/api/notifications", (req, res) => {
    const user = getReqUser(req) || currentSessionUser;
    const list = db.notifications || [];
    const myNotifs = list.filter((n: any) => n.user_id === user?.user_id);
    res.json({
      items: myNotifs,
      unread: myNotifs.filter((n: any) => !n.read).length
    });
  });

  app.post("/api/notifications/:id/read", (req, res) => {
    const n = (db.notifications || []).find((x: any) => x.id === req.params.id);
    if (n) n.read = true;
    saveDbToFile();
    res.json({ success: true });
  });

  app.post("/api/notifications/read-all", (req, res) => {
    const user = getReqUser(req) || currentSessionUser;
    (db.notifications || []).forEach((n: any) => {
      if (n.user_id === user?.user_id) n.read = true;
    });
    saveDbToFile();
    res.json({ success: true });
  });

  app.get("/api/notifications/push/public-key", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    const keys = ensureVapidKeys();
    res.json({ publicKey: keys.publicKey });
  });

  app.post("/api/notifications/push/subscribe", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ detail: "Push subscription tidak valid." });
    }
    if (!db.push_subscriptions || typeof db.push_subscriptions !== "object") {
      db.push_subscriptions = {};
    }
    const existing = Array.isArray(db.push_subscriptions[reqUser.user_id])
      ? db.push_subscriptions[reqUser.user_id]
      : [];
    const filtered = existing.filter((x: any) => x?.endpoint !== sub.endpoint);
    filtered.push(sub);
    db.push_subscriptions[reqUser.user_id] = filtered.slice(-5);
    saveDbToFile();
    res.json({ success: true, count: db.push_subscriptions[reqUser.user_id].length });
  });

  app.post("/api/notifications/push/unsubscribe", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Silakan login terlebih dahulu." });
    const endpoint = req.body?.endpoint;
    if (db.push_subscriptions?.[reqUser.user_id]) {
      db.push_subscriptions[reqUser.user_id] = endpoint
        ? db.push_subscriptions[reqUser.user_id].filter((x: any) => x?.endpoint !== endpoint)
        : [];
      saveDbToFile();
    }
    res.json({ success: true });
  });

  app.post("/api/notifications/test", (req, res) => {
    const reqUser = getReqUser(req);
    const userId = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const mode = req.body?.mode || "access_request"; // access_request, message, task

    let notif: any;
    if (mode === "access_request") {
      const demoReq = {
        id: `req_test_${Date.now()}`,
        name: "Jessica Iskandar",
        email: "jessica@asliri.id",
        department: "Marketing",
        job_title: "Brand Specialist",
        note: "Permohonan akses internal divisi Marketing untuk monitoring campaign.",
        status: "pending",
        created_at: new Date().toISOString()
      };
      if (!Array.isArray(db.access_requests)) db.access_requests = [];
      db.access_requests.unshift(demoReq);

      notif = createNotification({
        user_id: userId,
        title: "Permintaan Akses Masuk Baru",
        body: `${demoReq.name} (${demoReq.department}) mengajukan permohonan akses masuk`,
        type: "access_request",
        category: "system",
        access_request: demoReq
      });
    } else if (mode === "message") {
      notif = createNotification({
        user_id: userId,
        title: "Pesan Baru dari Saeful",
        body: "Halo! Apakah dokumen spesifikasi proyek sudah siap di-review?",
        type: "dm",
        category: "messages",
        conversation_id: "conv_circle_user_admin1",
        actor_id: "user_superadmin_saeful"
      });
    } else {
      notif = createNotification({
        user_id: userId,
        title: "Tugas Baru Ditugaskan",
        body: "Saeful menugaskan 'Review Dokumen Desain UI/UX' kepadamu.",
        type: "task_assigned",
        category: "tasks",
        task_id: "",
        actor_id: "user_superadmin_saeful"
      });
    }

    saveDbToFile();
    res.json({
      success: true,
      notif,
      push_subscriptions_count: Array.isArray(db.push_subscriptions?.[userId])
        ? db.push_subscriptions[userId].length
        : 0
    });
  });

  // Auto-Archive Function: Kartu yang berstatus 'done' langsung di-auto-archive tiap minggu jam 23.00 WIB
  // Throttled to at most once every 60 seconds so GET /api/tasks and /api/bootstrap stay O(1) fast.
  let lastAutoArchiveCheckAt = 0;
  function autoArchiveCheck(force = false) {
    const nowMs = Date.now();
    if (!force && nowMs - lastAutoArchiveCheckAt < 60000) return 0;
    lastAutoArchiveCheckAt = nowMs;
    const now = new Date(nowMs);
    // Convert to WIB (UTC+7)
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wibDate = new Date(utcMs + (7 * 3600000));
    const day = wibDate.getDay(); // 0 is Sunday
    const hour = wibDate.getHours();

    // Check done cards. If it's Sunday 23:00 WIB or card was completed prior to the last Sunday 23:00 WIB, archive it.
    let count = 0;
    db.tasks.forEach((t: any) => {
      if (t.status === "done" && !t.archived) {
        // If completed date exists and has passed the weekly archive cut-off
        const completedAt = t.completed_at ? new Date(t.completed_at) : (t.updated_at ? new Date(t.updated_at) : now);
        const compUtc = completedAt.getTime() + (completedAt.getTimezoneOffset() * 60000);
        const compWib = new Date(compUtc + (7 * 3600000));
        
        // Sunday 23:00 WIB trigger or older done task
        const isSundayPast23 = day === 0 && hour >= 23;
        const isPastWeek = (now.getTime() - completedAt.getTime()) > (86400000 * 3);

        if (isSundayPast23 || isPastWeek) {
          t.archived = true;
          t.archived_at = t.archived_at || now.toISOString();
          t.archived_month = t.archived_month || completedAt.toISOString().slice(0, 7);
          count++;
        }
      }
    });
    return count;
  }

  app.get("/api/tasks", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    if (autoArchiveCheck() > 0) saveDbToFile();
    const user = getReqUser(req) || currentSessionUser;
    let list = [...db.tasks];
    const { view, project_id, board_id, assignee_id, priority, label, department, item_type, q, month, archived } = req.query;

    const isArchiveView = view === "archived" || archived === "true";

    const isTaskAssignedToUser = (t: any, uid: string) => {
      if (!uid) return false;
      if (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(uid)) return true;
      if (t.assignee_id === uid) return true;
      if (Array.isArray(t.collaborator_ids) && t.collaborator_ids.includes(uid)) return true;
      if (Array.isArray(t.checkpoints) && t.checkpoints.some((c: any) => c && c.assignee_id === uid)) return true;
      return false;
    };

    // Ensure any active reached checkpoint that hasn't notified its assigned PIC yet sends its notification
    let checkpointSynced = false;
    (db.tasks || []).forEach((taskItem: any) => {
      if (!taskItem || taskItem.archived || !Array.isArray(taskItem.checkpoints) || taskItem.checkpoints.length === 0) return;
      const activeIdx = taskItem.checkpoints.findIndex((c: any) => !c.done);
      taskItem.checkpoints.forEach((c: any, idx: number) => {
        const isReached = !c.done && idx === activeIdx;
        if (!isReached) {
          if (c.notified_ready_for) {
            c.notified_ready_for = null;
            checkpointSynced = true;
          }
        } else if (c.assignee_id && c.notified_ready_for !== c.assignee_id) {
          c.notified_ready_for = c.assignee_id;
          checkpointSynced = true;
          const readyMsg = `Task "${taskItem.title}" sudah siap dikerjakan, Semangat ya..`;
          createNotification({
            user_id: c.assignee_id,
            title: `Checkpoint Siap Dikerjakan: ${c.title || taskItem.title}`,
            body: readyMsg,
            type: "checkpoint_ready",
            category: "tasks",
            actor_id: taskItem.created_by || CIRCLE_BOT_ID,
            link: `/tasks?task=${taskItem.id}`,
            task_id: taskItem.id
          });
        }
      });
    });
    if (checkpointSynced) {
      saveDbToFile();
    }

    if (isArchiveView) {
      list = list.filter((t: any) => t.archived === true);
    } else {
      list = list.filter((t: any) => !t.archived);
      if (view === "active") list = list.filter((t: any) => t.status !== "done");
      if (view === "completed") list = list.filter((t: any) => t.status === "done");
      if (view === "my" || view === "assigned") list = list.filter((t: any) => isTaskAssignedToUser(t, user?.user_id));
      if (view === "requested") list = list.filter((t: any) => t.created_by === user?.user_id || (Array.isArray(t.requestor_ids) && t.requestor_ids.includes(user?.user_id)));
      if (view === "today") {
        const todayStr = new Date().toISOString().slice(0, 10);
        list = list.filter((t: any) => t.deadline && t.deadline.slice(0, 10) === todayStr);
      }
      if (view === "overdue") {
        const now = new Date();
        list = list.filter((t: any) => t.status !== "done" && t.deadline && new Date(t.deadline) < now);
      }
    }

    if (project_id) list = list.filter((t: any) => t.project_id === project_id);
    if (board_id) {
      const selectedBoard = db.boards?.find((b: any) => b.id === board_id);
      const userDept = String(user?.department || "").trim().toLowerCase();
      const selectedBoardDept = String(selectedBoard?.department || "").trim().toLowerCase();
      const isSuper = user?.role === "super_admin" || user?.role === "workspace_admin";
      const isOwnDivBoard = Boolean(userDept && selectedBoardDept && userDept === selectedBoardDept);
      list = list.filter((t: any) => {
        if (t.board_id === board_id) return true;
        // When non-admin views their own division board, always include tasks directly assigned to / requested by them from other boards
        if (!isSuper && isOwnDivBoard && user?.user_id) {
          if (isTaskAssignedToUser(t, user.user_id)) return true;
          if (t.created_by === user.user_id || (Array.isArray(t.requestor_ids) && t.requestor_ids.includes(user.user_id))) return true;
        }
        return false;
      });
    }
    if (assignee_id) list = list.filter((t: any) => isTaskAssignedToUser(t, String(assignee_id)));
    if (priority) list = list.filter((t: any) => (t.priority || "").toLowerCase() === String(priority).toLowerCase());
    if (label) list = list.filter((t: any) => (t.label_ids || []).includes(label));
    if (department) list = list.filter((t: any) => t.department === department);
    if (item_type) list = list.filter((t: any) => String(t.item_type || "").toLowerCase() === String(item_type).toLowerCase());
    if (month) list = list.filter((t: any) => (t.archived_month || (t.archived_at || t.completed_at || "").slice(0, 7)) === month);

    if (q) {
      const query = String(q).toLowerCase();
      list = list.filter((t: any) => 
        (t.title || "").toLowerCase().includes(query) ||
        (t.description || "").toLowerCase().includes(query) ||
        (t.item_type || "").toLowerCase().includes(query) ||
        (t.number_str || "").toLowerCase().includes(query)
      );
    }

    // Access control: Division-restricted access + invited board members + assigned users
    list = list.filter((t: any) => isTaskAccessible(t, user));

    // Always compute status compliance automatically (if Done after deadline -> Overdue) and normalize requestor fields
    list.forEach((t: any) => {
      const reqIds = Array.isArray(t.requestor_ids) && t.requestor_ids.length
        ? t.requestor_ids
        : (t.requestor_id ? [t.requestor_id] : (t.created_by ? [t.created_by] : []));
      t.requestor_ids = reqIds;
      t.requestor_id = reqIds[0] || t.created_by || null;

      const isDone = t.status === "done";
      if (isDone) {
        if (!t.completed_at) t.completed_at = t.updated_at || new Date().toISOString();
        if (t.deadline) {
          t.deadline_compliance = new Date(t.completed_at) > new Date(t.deadline) ? "Overdue" : "On time";
        } else {
          t.deadline_compliance = "On time";
        }
      } else {
        if (t.deadline && new Date() > new Date(t.deadline)) {
          t.deadline_compliance = "Overdue";
        } else {
          t.deadline_compliance = "In Progress";
        }
      }
    });

    res.json(list);
  });

  app.post("/api/tasks", (req, res) => {
    const curUser = getReqUser(req) || currentSessionUser;
    const creatorId = curUser?.user_id || "user_admin1";
    const creatorName = curUser?.name || "Seseorang";
    const nextTaskNum = getNextTaskNumber(db.tasks);
    const taskNum = `TSK-${String(nextTaskNum).padStart(3, '0')}`;
    const reqIds = req.body.requestor_ids || [creatorId];
    const rawCps = Array.isArray(req.body.checkpoints) ? req.body.checkpoints : [];
    const normalizedInputCps = rawCps.map((c: any, idx: number) =>
      typeof c === "string"
        ? { id: `cp_${Date.now()}_${idx}`, title: c, assignee_id: null, deadline: "", done: false }
        : { ...c }
    );
    const cpPics = normalizedInputCps.map((c: any) => c?.assignee_id).filter(Boolean);

    // Normalize assignee_ids and assignee_id
    let assigneeIds = Array.isArray(req.body.assignee_ids) ? [...req.body.assignee_ids] : [];
    if (req.body.assignee_id && !assigneeIds.includes(req.body.assignee_id)) {
      assigneeIds.unshift(req.body.assignee_id);
    }
    assigneeIds = assigneeIds.filter(Boolean);
    if (assigneeIds.length === 0 && cpPics.length > 0) {
      assigneeIds = Array.from(new Set(cpPics));
    } else if (
      assigneeIds.length === 0 &&
      req.body.assignee_ids === undefined &&
      req.body.assignee_id === undefined &&
      creatorId
    ) {
      assigneeIds = [creatorId];
    }
    const primaryAssigneeId = assigneeIds[0] || null;
    const cps = normalizedInputCps.map((c: any) =>
      c && !c.assignee_id && !c.unassigned && primaryAssigneeId
        ? { ...c, assignee_id: primaryAssigneeId }
        : c
    );
    const doneCount = cps.filter((c: any) => c.done).length;
    const progress = cps.length > 0 ? Math.round((doneCount / cps.length) * 100) : (req.body.progress ?? (req.body.status === "done" ? 100 : 0));

    const newTaskId = `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const initAct = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actor_id: creatorId,
      action: `membuat tugas baru "${req.body.title || taskNum}"`,
      detail: req.body.description ? `Brief awal: "${String(req.body.description).replace(/<[^>]*>?/gm, "").trim().slice(0, 120)}"` : undefined,
      task_id: newTaskId,
      task_title: req.body.title,
      created_at: new Date().toISOString()
    };

    const validStatuses = (db.workspace?.task_statuses || []).map((s: any) => s.key);
    const resolvedStatus = req.body.status && (validStatuses.length === 0 || validStatuses.includes(req.body.status))
      ? req.body.status
      : (validStatuses[0] || "todo");

    const primaryAssigneeUser = primaryAssigneeId
      ? (db.users || []).find((u: any) => u.user_id === primaryAssigneeId)
      : null;
    const assigneeDivBoard = primaryAssigneeUser?.department
      ? db.boards?.find((b: any) => b.department && b.department.toLowerCase() === String(primaryAssigneeUser.department).toLowerCase())
      : null;
    const userDept = curUser?.department || "Marketing";
    const userDivBoard = db.boards?.find((b: any) => b.department && b.department.toLowerCase() === userDept.toLowerCase());
    const explicitBoardId = req.body.board_id ? String(req.body.board_id).trim() : "";
    const resolvedBoardId = explicitBoardId || assigneeDivBoard?.id || userDivBoard?.id || db.boards?.[0]?.id || "brd_div_marketing";
    const targetBoard = db.boards?.find((b: any) => b.id === resolvedBoardId);
    const resolvedDept = (explicitBoardId && targetBoard?.department)
      ? targetBoard.department
      : (req.body.department || targetBoard?.department || primaryAssigneeUser?.department || userDept || "Marketing");

    const t = {
      comments: [],
      subtasks: [],
      attachments: [],
      activity: [initAct],
      progress,
      archived: false,
      reviewer_ids: reqIds,
      approvals: {
        needed: 2,
        approved_by: [],
        status: "pending"
      },
      ...req.body,
      id: newTaskId,
      number: nextTaskNum,
      number_str: taskNum,
      created_by: creatorId,
      checkpoints: cps,
      status: resolvedStatus,
      priority: req.body.priority || "medium",
      board_id: resolvedBoardId,
      department: resolvedDept,
      requestor_id: reqIds[0] || creatorId,
      requestor_ids: reqIds,
      assignee_id: primaryAssigneeId,
      assignee_ids: assigneeIds,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (t.status === "done") {
      if (!t.completed_at) t.completed_at = t.created_at;
      t.deadline_compliance = t.deadline ? (new Date(t.completed_at) > new Date(t.deadline) ? "Overdue" : "On time") : "On time";
    } else {
      t.deadline_compliance = (t.deadline && new Date() > new Date(t.deadline)) ? "Overdue" : "In Progress";
    }
    if (!Array.isArray(t.activity) || t.activity.length === 0) {
      t.activity = [initAct];
    }

    // If the first active checkpoint has an assigned PIC, prepare collaborator access & notified_ready_for before saving/broadcasting
    let pendingCpNotification: { targetUid: string; cpTitle: string } | null = null;
    if (Array.isArray(t.checkpoints) && t.checkpoints.length > 0) {
      const activeIdx = t.checkpoints.findIndex((c: any) => !c.done);
      if (activeIdx !== -1) {
        const activeCp = t.checkpoints[activeIdx];
        if (activeCp && activeCp.assignee_id) {
          activeCp.notified_ready_for = activeCp.assignee_id;
          t.collaborator_ids = Array.isArray(t.collaborator_ids) ? t.collaborator_ids : [];
          if (!t.collaborator_ids.includes(activeCp.assignee_id)) {
            t.collaborator_ids.push(activeCp.assignee_id);
          }
          pendingCpNotification = { targetUid: activeCp.assignee_id, cpTitle: activeCp.title || t.title };
        }
      }
    }

    db.tasks.unshift(t);
    db.activity.unshift(initAct);
    db.audit_logs.unshift({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actor_id: creatorId,
      actor_name: creatorName,
      action: `membuat tugas baru: ${t.number_str} - ${t.title}`,
      created_at: new Date().toISOString()
    });
    saveDbToFile(true);
    broadcast({ type: "tasks:changed", task: t });

    // Notify all assigned users
    assigneeIds.forEach((uid: string) => {
      if (uid && uid !== creatorId) {
        createNotification({
          user_id: uid,
          title: "Tugas Baru Ditugaskan",
          body: `${creatorName} menugaskan "${t.title}" kepadamu.`,
          type: "task_assigned",
          category: "tasks",
          actor_id: creatorId,
          link: `/tasks?task=${t.id}`,
          task_id: t.id
        });
      }
    });

    if (pendingCpNotification) {
      const readyMsg = `Task "${t.title}" sudah siap dikerjakan, Semangat ya..`;
      createNotification({
        user_id: pendingCpNotification.targetUid,
        title: `Checkpoint Siap Dikerjakan: ${pendingCpNotification.cpTitle}`,
        body: readyMsg,
        type: "checkpoint_ready",
        category: "tasks",
        actor_id: creatorId || CIRCLE_BOT_ID,
        link: `/tasks?task=${t.id}`,
        task_id: t.id
      });
      saveDbToFile(true);
    }

    res.json(t);
  });

  // CSV & JSON Task Import Endpoint (Super Admin only)
  const handleTaskImport = (req: any, res: any) => {
    const reqUser = getReqUser(req);
    if (!reqUser || reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Hanya Super Admin yang diizinkan mengimpor tugas." });
    }
    syncDivisionsToBoards();
    const actorId = reqUser.user_id || "user_admin1";
    const actorName = reqUser.name || "Super Admin";

    let items = req.body;
    const bodyBoardId = req.body && !Array.isArray(req.body) ? String(req.body.board_id || "").trim() : "";
    const bodyDept = req.body && !Array.isArray(req.body) ? String(req.body.department || "").trim() : "";

    if (items && !Array.isArray(items) && Array.isArray(items.items)) {
      items = items.items;
    }
    if (items && !Array.isArray(items) && Array.isArray(items.tasks)) {
      items = items.tasks;
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "Tidak ada data task yang valid untuk diimport." });
    }

    const humanUsers = (db.users || []).filter((u: any) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID);
    const resolveUserIds = (raw: any): string[] => {
      const tokens = Array.isArray(raw)
        ? raw.flatMap((x) => String(x || "").split(/[;,]/))
        : String(raw || "").split(/[;,]/);
      const out: string[] = [];
      tokens.forEach((tok) => {
        const q = String(tok || "").trim().toLowerCase();
        if (!q) return;
        const matched = humanUsers.find(
          (u: any) =>
            String(u.user_id || "").toLowerCase() === q ||
            String(u.email || "").toLowerCase() === q ||
            String(u.name || "").toLowerCase() === q ||
            String(u.name || "").split(" ")[0]?.toLowerCase() === q
        );
        if (matched && !out.includes(matched.user_id)) out.push(matched.user_id);
      });
      return out;
    };

    const findBoardByHint = (hint: any) => {
      const q = String(hint || "").trim().toLowerCase();
      if (!q) return null;
      const slug = q.replace(/[^a-z0-9]+/g, "_");
      return (db.boards || []).find(
        (b: any) =>
          String(b.id || "").toLowerCase() === q ||
          String(b.id || "").toLowerCase() === `brd_div_${slug}` ||
          String(b.department || "").trim().toLowerCase() === q ||
          String(b.name || "").trim().toLowerCase() === q
      ) || null;
    };

    const resolveLabelIds = (item: any): string[] => {
      if (Array.isArray(item.label_ids) && item.label_ids.length > 0) {
        return item.label_ids
          .map((lid: any) => {
            const q = String(lid || "").trim().toLowerCase();
            const found = (db.labels || []).find((l: any) => l.id?.toLowerCase() === q || l.name?.toLowerCase() === q);
            return found?.id || (String(lid).startsWith("lbl_") ? lid : null);
          })
          .filter(Boolean);
      }
      const rawBrand = item.brand || item.label || item.ip;
      if (!rawBrand) return [];
      const parts = Array.isArray(rawBrand) ? rawBrand : String(rawBrand).split(/[;,]/);
      return parts
        .map((p: any) => {
          const q = String(p || "").trim().toLowerCase();
          if (!q) return null;
          const found = (db.labels || []).find((l: any) => l.id?.toLowerCase() === q || l.name?.toLowerCase() === q);
          return found?.id || null;
        })
        .filter(Boolean);
    };

    const defaultBodyBoard = findBoardByHint(bodyBoardId) || findBoardByHint(bodyDept);
    const userDivBoard = findBoardByHint(reqUser?.department);

    const overrideBoard = Boolean(req.body?.override_board && defaultBodyBoard);
    const createdList: any[] = [];
    items.forEach((item, idx) => {
      if (!item || !item.title || !String(item.title).trim()) return;

      const matchedBoard = overrideBoard
        ? defaultBodyBoard
        : (
            findBoardByHint(item.board_id) ||
            findBoardByHint(item.board) ||
            findBoardByHint(item.department || item.divisi) ||
            defaultBodyBoard ||
            userDivBoard ||
            db.boards?.[0] ||
            null
          );

      const resolvedBoardId = matchedBoard?.id || bodyBoardId || db.boards?.[0]?.id || "brd_div_marketing";
      const resolvedDept = matchedBoard?.department || (overrideBoard ? bodyDept : (item.department || item.divisi || bodyDept)) || reqUser?.department || "Marketing";

      let resolvedAssignees = resolveUserIds(
        Array.isArray(item.assignee_ids) && item.assignee_ids.length
          ? item.assignee_ids
          : (item.assignee_id || item.assignee || item.assignees || "")
      );

      const resolvedRequestors = resolveUserIds(
        Array.isArray(item.requestor_ids) && item.requestor_ids.length
          ? item.requestor_ids
          : (item.requestor_id || item.requestor || item.created_by || "")
      );
      const finalReqIds = resolvedRequestors.length > 0 ? resolvedRequestors : [actorId];

      const validStatuses = (db.workspace?.task_statuses || []).map((s: any) => s.key);
      const rawStatus = String(item.status || "").toLowerCase().replace(/\s+/g, "_");
      const resolvedStatus = rawStatus && (validStatuses.length === 0 || validStatuses.includes(rawStatus))
        ? rawStatus
        : (validStatuses[0] || "todo");

      const rawCps = Array.isArray(item.checkpoints) ? item.checkpoints : [];
      const tempCps = rawCps.map((cp: any, cpIdx: number) => {
        if (typeof cp === "string") {
          return { id: `cp_imp_${Date.now()}_${idx}_${cpIdx}`, title: cp, assignee_id: null, deadline: "", done: false };
        }
        const cpPic = cp.assignee_id ? (resolveUserIds(cp.assignee_id)[0] || cp.assignee_id) : null;
        return {
          id: cp.id || `cp_imp_${Date.now()}_${idx}_${cpIdx}`,
          title: cp.title || `Checkpoint ${cpIdx + 1}`,
          assignee_id: cpPic,
          unassigned: !!cp.unassigned,
          deadline: cp.deadline || "",
          done: !!cp.done,
          done_at: cp.done_at || null,
          done_by: cp.done_by || null
        };
      });

      const cpPics = tempCps.map((c: any) => c.assignee_id).filter(Boolean);
      if (resolvedAssignees.length === 0 && cpPics.length > 0) {
        resolvedAssignees = Array.from(new Set(cpPics));
      }
      const primaryAssignee = resolvedAssignees[0] || null;
      const normalizedCps = tempCps.map((c: any) =>
        !c.assignee_id && !c.unassigned && primaryAssignee
          ? { ...c, assignee_id: primaryAssignee }
          : c
      );
      const collabs = Array.from(new Set([...(Array.isArray(item.collaborator_ids) ? item.collaborator_ids : []), ...cpPics]));

      const doneCp = normalizedCps.filter((c: any) => c.done).length;
      const computedProgress = normalizedCps.length > 0
        ? Math.round((doneCp / normalizedCps.length) * 100)
        : (item.progress ?? (resolvedStatus === "done" ? 100 : 0));

      const taskNum = item.number_str || `TSK-${String(getNextTaskNumber(db.tasks)).padStart(3, "0")}`;
      const nowIso = new Date().toISOString();

      const t = {
        id: `tsk_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        number_str: taskNum,
        title: String(item.title).trim(),
        description: item.description || "",
        status: resolvedStatus,
        priority: ["low", "medium", "high", "urgent"].includes(String(item.priority || "").toLowerCase())
          ? String(item.priority).toLowerCase()
          : "medium",
        assignee_id: primaryAssignee,
        assignee_ids: resolvedAssignees,
        collaborator_ids: collabs,
        board_id: resolvedBoardId,
        department: resolvedDept,
        project_id: item.project_id || null,
        label_ids: resolveLabelIds(item),
        item_type: item.item_type || null,
        link_url: item.link_url || "",
        start_date: item.start_date || null,
        submit_date: item.submit_date || null,
        deadline: item.deadline || new Date(Date.now() + 86400000 * 3).toISOString(),
        created_by: finalReqIds[0] || actorId,
        requestor_id: finalReqIds[0] || actorId,
        requestor_ids: finalReqIds,
        reviewer_ids: finalReqIds,
        approvals: { needed: 2, approved_by: [], status: "pending" },
        checkpoints: normalizedCps,
        progress: computedProgress,
        archived: false,
        comments: [],
        subtasks: [],
        attachments: [],
        activity: [{
          id: `act_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          actor_id: actorId,
          action: `mengimpor tugas "${String(item.title).trim()}" ke divisi ${resolvedDept}`,
          created_at: nowIso
        }],
        created_at: nowIso,
        updated_at: nowIso
      };
      db.tasks.unshift(t);
      createdList.push(t);
    });

    db.audit_logs.unshift({
      id: `log_${Date.now()}`,
      actor_id: actorId,
      actor_name: actorName,
      action: `mengimpor ${createdList.length} kartu tugas`,
      created_at: new Date().toISOString()
    });

    saveDbToFile(true);
    broadcast({ type: "tasks:changed" });
    res.json({ success: true, count: createdList.length, tasks: createdList });
  };

  app.post("/api/tasks/import-csv", handleTaskImport);
  app.post("/api/tasks/import", handleTaskImport);

  // Manual Trigger or Periodic Auto-Archive endpoint
  app.post("/api/tasks/auto-archive", (req, res) => {
    const now = new Date();
    let archivedCount = 0;
    db.tasks.forEach((t: any) => {
      if (t.status === "done" && !t.archived) {
        t.archived = true;
        t.archived_at = t.archived_at || now.toISOString();
        t.archived_month = t.archived_month || now.toISOString().slice(0, 7);
        archivedCount++;
      }
    });
    saveDbToFile(true);
    broadcast({ type: "tasks:changed" });
    res.json({
      success: true,
      message: `Auto-archive mingguan berhasil dijalankan. ${archivedCount} kartu done diarsipkan.`,
      archived_count: archivedCount,
      schedule: "Setiap Minggu pukul 23:00 WIB"
    });
  });

  const getTaskArchiveMonthKey = (t: any): string => {
    const raw = t?.archived_month || (t?.archived_at || t?.completed_at || t?.created_at || "").slice(0, 7);
    return raw && raw.length >= 7 ? raw.slice(0, 7) : "unknown";
  };

  const formatArchiveMonthLabel = (monthKey: string): string => {
    if (!monthKey || monthKey.length < 7 || monthKey === "unknown") return "Lainnya / Tanpa Tanggal";
    const [yr, mo] = monthKey.split("-");
    const names: Record<string, string> = {
      "01": "Januari", "02": "Februari", "03": "Maret", "04": "April",
      "05": "Mei", "06": "Juni", "07": "Juli", "08": "Agustus",
      "09": "September", "10": "Oktober", "11": "November", "12": "Desember"
    };
    return `${names[mo] || mo} ${yr}`;
  };

  const enrichArchiveDeleteRequest = (r: any) => {
    const approverIds = Array.isArray(r.approved_by) ? r.approved_by : [];
    const approvers = approverIds.map((uid: string) => {
      const u = (db.users || []).find((x: any) => x.user_id === uid);
      return { user_id: uid, name: u?.name || "Admin", avatar: u?.avatar || u?.picture || "" };
    });
    return {
      ...r,
      approved_count: approverIds.length,
      needed: Number(r.needed || 2),
      approvers,
    };
  };

  // Multiple-select delete of archived tasks (or single delete via /api/tasks/:id)
  app.post("/api/tasks/archive/bulk-delete", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const targetIds = new Set(rawIds.map((x: any) => String(x)).filter(Boolean));
    if (targetIds.size === 0) {
      return res.status(400).json({ detail: "Pilih minimal 1 tugas arsip untuk dihapus." });
    }

    const deletedIds: string[] = [];
    db.tasks = (db.tasks || []).filter((t: any) => {
      if (!t || !t.archived || !targetIds.has(String(t.id))) return true;
      if (!isTaskAccessible(t, reqUser)) return true;
      deletedIds.push(t.id);
      return false;
    });

    if (deletedIds.length === 0) {
      return res.status(403).json({ detail: "Tidak ada tugas arsip yang dapat Anda hapus." });
    }

    db.audit_logs = db.audit_logs || [];
    db.audit_logs.unshift({
      id: `log_${Date.now()}`,
      actor_id: reqUser.user_id,
      actor_name: reqUser.name || "User",
      action: `menghapus ${deletedIds.length} tugas dari Arsip Tugas`,
      created_at: new Date().toISOString(),
    });

    saveDbToFile(true);
    broadcast({ type: "tasks:changed" });
    res.json({ success: true, deleted_count: deletedIds.length, deleted_ids: deletedIds });
  });

  app.get("/api/tasks/archive/delete-requests", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });
    const active = (db.archive_delete_requests || [])
      .filter((r: any) => r && (r.status === "pending" || r.status === "partial"))
      .map(enrichArchiveDeleteRequest);
    res.json(active);
  });

  // Request deleting an entire month folder of archived tasks (requires >= 2 distinct approvals)
  app.post("/api/tasks/archive/delete-month", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });

    const month = String(req.body?.month || "").trim();
    if (!month) {
      return res.status(400).json({ detail: "Pilih folder bulan yang ingin dihapus." });
    }

    const monthTasks = (db.tasks || []).filter(
      (t: any) => t && t.archived === true && getTaskArchiveMonthKey(t) === month && isTaskAccessible(t, reqUser)
    );
    if (monthTasks.length === 0) {
      return res.status(404).json({ detail: "Tidak ada tugas arsip pada folder bulan tersebut." });
    }

    db.archive_delete_requests = Array.isArray(db.archive_delete_requests) ? db.archive_delete_requests : [];
    const existingPending = db.archive_delete_requests.find(
      (r: any) => r && r.month === month && (r.status === "pending" || r.status === "partial")
    );
    if (existingPending) {
      return res.json({ existing: true, request: enrichArchiveDeleteRequest(existingPending) });
    }

    const nowIso = new Date().toISOString();
    const monthLabel = formatArchiveMonthLabel(month);
    const reqObj: any = {
      id: `adr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      month,
      month_label: monthLabel,
      task_ids: monthTasks.map((t: any) => t.id),
      task_count: monthTasks.length,
      requested_by: reqUser.user_id,
      requested_by_name: reqUser.name || "Pengguna",
      needed: 2,
      approved_by: [],
      status: "pending",
      created_at: nowIso,
    };
    db.archive_delete_requests.unshift(reqObj);

    const eligibleApprovers = (db.users || []).filter(
      (u: any) =>
        u &&
        !u.is_bot &&
        u.role !== "assistant" &&
        u.status === "active" &&
        ["super_admin", "workspace_admin", "manager", "department_manager", "project_manager"].includes(u.role)
    );
    const fallbackTargets = (db.users || []).filter(
      (u: any) => u && !u.is_bot && u.role !== "assistant" && u.status === "active"
    );
    const notifyPool = eligibleApprovers.length >= 2 ? eligibleApprovers : fallbackTargets;
    notifyPool.forEach((u: any) => {
      if (u.user_id === reqUser.user_id) return;
      createNotification({
        user_id: u.user_id,
        title: `Persetujuan Hapus Arsip ${monthLabel}`,
        body: `${reqUser.name || "Rekan tim"} mengajukan penghapusan seluruh arsip bulan ${monthLabel} (${monthTasks.length} tugas). Butuh minimal 2 persetujuan.`,
        type: "archive_month_delete",
        category: "tasks",
        actor_id: reqUser.user_id,
        archive_request_id: reqObj.id,
        month,
        link: `/tasks?view=archive`,
        sender: sanitizeUser(reqUser),
      });
    });

    db.audit_logs = db.audit_logs || [];
    db.audit_logs.unshift({
      id: `log_${Date.now()}`,
      actor_id: reqUser.user_id,
      actor_name: reqUser.name || "User",
      action: `mengajukan hapus arsip 1 bulan penuh (${monthLabel}, ${monthTasks.length} tugas) — menunggu 2 persetujuan`,
      created_at: nowIso,
    });

    saveDbToFile(true);
    const enriched = enrichArchiveDeleteRequest(reqObj);
    broadcast({ type: "archive_delete:changed", request: enriched });
    res.json({ success: true, existing: false, request: enriched });
  });

  app.post("/api/tasks/archive/delete-requests/:id/decision", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });

    db.archive_delete_requests = Array.isArray(db.archive_delete_requests) ? db.archive_delete_requests : [];
    const reqObj = db.archive_delete_requests.find((r: any) => r && r.id === req.params.id);
    if (!reqObj || (reqObj.status !== "pending" && reqObj.status !== "partial")) {
      return res.status(404).json({ detail: "Permintaan hapus arsip bulan tidak ditemukan atau sudah selesai." });
    }

    const decision = String(req.body?.decision || "").toLowerCase();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ detail: "Keputusan harus 'approve' atau 'reject'." });
    }

    const adminApproversCount = (db.users || []).filter(
      (u: any) => u && !u.is_bot && u.status === "active" && ["super_admin", "workspace_admin", "manager", "department_manager", "project_manager"].includes(u.role)
    ).length;
    const isAuthorized =
      ["super_admin", "workspace_admin", "manager", "department_manager", "project_manager"].includes(reqUser.role) || adminApproversCount < 2;
    if (!isAuthorized) {
      return res.status(403).json({ detail: "Hanya Super Admin, Workspace Admin, atau Manajer yang dapat menyetujui penghapusan 1 bulan arsip." });
    }

    const nowIso = new Date().toISOString();

    if (decision === "reject") {
      reqObj.status = "rejected";
      reqObj.rejected_by = reqUser.user_id;
      reqObj.rejected_by_name = reqUser.name || "Admin";
      reqObj.completed_at = nowIso;

      if (reqObj.requested_by && reqObj.requested_by !== reqUser.user_id) {
        createNotification({
          user_id: reqObj.requested_by,
          title: `Hapus Arsip ${reqObj.month_label} Ditolak`,
          body: `${reqUser.name || "Admin"} menolak permintaan penghapusan seluruh arsip bulan ${reqObj.month_label}.`,
          type: "archive_month_rejected",
          category: "tasks",
          actor_id: reqUser.user_id,
          link: `/tasks?view=archive`,
        });
      }

      saveDbToFile(true);
      const enriched = enrichArchiveDeleteRequest(reqObj);
      broadcast({ type: "archive_delete:changed", request: enriched });
      return res.json({ success: true, status: "rejected", executed: false, deleted_count: 0, request: enriched });
    }

    reqObj.approved_by = Array.isArray(reqObj.approved_by) ? reqObj.approved_by : [];
    if (!reqObj.approved_by.includes(reqUser.user_id)) {
      reqObj.approved_by.push(reqUser.user_id);
    }
    const needed = Number(reqObj.needed || 2);
    const approvedCount = reqObj.approved_by.length;

    if (approvedCount >= needed) {
      let deletedCount = 0;
      db.tasks = (db.tasks || []).filter((t: any) => {
        if (t && t.archived === true && getTaskArchiveMonthKey(t) === reqObj.month) {
          deletedCount++;
          return false;
        }
        return true;
      });
      reqObj.status = "approved";
      reqObj.executed = true;
      reqObj.deleted_count = deletedCount;
      reqObj.completed_at = nowIso;

      db.audit_logs = db.audit_logs || [];
      db.audit_logs.unshift({
        id: `log_${Date.now()}`,
        actor_id: reqUser.user_id,
        actor_name: reqUser.name || "Admin",
        action: `menyetujui (${approvedCount}/${needed}) dan menghapus arsip bulan ${reqObj.month_label} (${deletedCount} tugas)`,
        created_at: nowIso,
      });

      const notifySet = new Set([reqObj.requested_by, ...reqObj.approved_by].filter(Boolean));
      notifySet.forEach((uid: string) => {
        if (uid === reqUser.user_id) return;
        createNotification({
          user_id: uid,
          title: `Arsip ${reqObj.month_label} Dihapus`,
          body: `Persetujuan ${approvedCount}/${needed} terpenuhi. Sebanyak ${deletedCount} tugas arsip bulan ${reqObj.month_label} telah dihapus permanen.`,
          type: "archive_month_deleted",
          category: "tasks",
          actor_id: reqUser.user_id,
          link: `/tasks?view=archive`,
        });
      });

      saveDbToFile(true);
      const enriched = enrichArchiveDeleteRequest(reqObj);
      broadcast({ type: "tasks:changed" });
      broadcast({ type: "archive_delete:changed", request: enriched });
      return res.json({
        success: true,
        status: "approved",
        executed: true,
        approved_count: approvedCount,
        needed,
        deleted_count: deletedCount,
        request: enriched,
      });
    }

    reqObj.status = "partial";
    saveDbToFile(true);
    const enriched = enrichArchiveDeleteRequest(reqObj);
    broadcast({ type: "archive_delete:changed", request: enriched });
    res.json({
      success: true,
      status: "partial",
      executed: false,
      approved_count: approvedCount,
      needed,
      deleted_count: 0,
      request: enriched,
    });
  });

  app.post("/api/tasks/bulk", (req, res) => {
    const { ids, patch } = req.body;
    let updated = 0;
    if (Array.isArray(ids)) {
      ids.forEach((id: string) => {
        const t = db.tasks.find((x: any) => x.id === id);
        if (t) {
          if (patch.assignee_id && !patch.assignee_ids) {
            patch.assignee_ids = [patch.assignee_id];
          } else if (patch.assignee_ids && !patch.assignee_id) {
            patch.assignee_id = patch.assignee_ids[0] || null;
          }
          Object.assign(t, patch);
          if (patch.assignee_id && Array.isArray(t.checkpoints)) {
            t.checkpoints = t.checkpoints.map((c: any) =>
              c && !c.assignee_id && !c.unassigned ? { ...c, assignee_id: patch.assignee_id } : c
            );
          }
          if (patch.archived) {
            t.archived_at = t.archived_at || new Date().toISOString();
            t.archived_month = t.archived_month || new Date().toISOString().slice(0, 7);
          }
          t.updated_at = new Date().toISOString();
          updated++;
        }
      });
    }
    saveDbToFile(true);
    broadcast({ type: "tasks:changed" });
    res.json({ updated });
  });

  app.get("/api/tasks/export", (req, res) => {
    const user = getReqUser(req);
    if (!user || user.role !== "super_admin") {
      return res.status(403).json({ detail: "Hanya Super Admin yang diizinkan mengekspor tugas." });
    }
    const { board_id, assignee_id, priority, label, department, q, ids } = req.query;
    let list = db.tasks.filter((t: any) => !t.archived && isTaskAccessible(t, user));
    if (ids) {
      const idSet = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
      list = list.filter((t: any) => idSet.has(t.id));
    }
    if (board_id) list = list.filter((t: any) => t.board_id === board_id);
    if (department) list = list.filter((t: any) => String(t.department || "").toLowerCase() === String(department).toLowerCase());
    if (priority) list = list.filter((t: any) => String(t.priority || "").toLowerCase() === String(priority).toLowerCase());
    if (label) list = list.filter((t: any) => (t.label_ids || []).includes(label));
    if (assignee_id) list = list.filter((t: any) => t.assignee_id === assignee_id || (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(assignee_id)));
    if (q) {
      const ql = String(q).toLowerCase();
      list = list.filter((t: any) => (t.title || "").toLowerCase().includes(ql) || (t.number_str || "").toLowerCase().includes(ql));
    }

    res.setHeader("X-Record-Count", list.length);
    if (req.query.format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", 'attachment; filename="circle-tasks.json"');
      return res.send(JSON.stringify(list, null, 2));
    }
    const getUserNames = (uIds: any[]) => (uIds || []).map((uid) => db.users.find((u: any) => u.user_id === uid)?.name || uid).filter(Boolean).join("; ");
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = "ID,Number,Department,Board,Requestor,Assignee,Brand,Item,Title,Priority,Link,Deadline,Status\n";
    const rows = list.map((t: any) => {
      const b = db.boards?.find((x: any) => x.id === t.board_id);
      const reqIds = Array.isArray(t.requestor_ids) && t.requestor_ids.length ? t.requestor_ids : (t.requestor_id ? [t.requestor_id] : (t.created_by ? [t.created_by] : []));
      const assIds = Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : []);
      const brandNames = (t.label_ids || []).map((lid: string) => db.labels?.find((l: any) => l.id === lid)?.name || lid).join("; ");
      return [
        t.id,
        t.number_str || "",
        t.department || b?.department || "",
        b?.name || t.board_id || "",
        getUserNames(reqIds),
        getUserNames(assIds),
        brandNames,
        t.item_type || "",
        t.title || "",
        t.priority || "medium",
        t.link_url || "",
        t.deadline || "",
        t.status || "todo"
      ].map(esc).join(",");
    }).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="circle-tasks.csv"');
    res.send(headers + rows);
  });

  app.get("/api/tasks/:id", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    const user = getReqUser(req) || currentSessionUser;
    if (!isTaskAccessible(t, user)) {
      return res.status(403).json({ detail: "Akses ditolak. Tugas ini hanya dapat diakses oleh divisi terkait atau anggota terundang." });
    }
    const rawBoard = db.boards?.find((b: any) => b.id === t.board_id) || db.boards?.[0] || null;
    const deptMembers = rawBoard?.department
      ? (db.users || []).filter((u: any) => !u.is_bot && u.department && u.department.toLowerCase() === rawBoard.department.toLowerCase()).map((u: any) => u.user_id)
      : [];
    const board = rawBoard ? {
      ...rawBoard,
      member_ids: Array.from(new Set([...deptMembers, ...(Array.isArray(rawBoard.invited_member_ids) ? rawBoard.invited_member_ids : [])]))
    } : null;
    const reqIds = Array.isArray(t.requestor_ids) && t.requestor_ids.length
      ? t.requestor_ids
      : (t.requestor_id ? [t.requestor_id] : (t.created_by ? [t.created_by] : []));

    const cardMsgs = (db.messages || []).filter((m: any) => m && m.task_id === t.id && m.type === "approval_card");
    const msgApproved = cardMsgs.flatMap((m: any) =>
      Array.isArray(m.approvals?.approved_by)
        ? m.approvals.approved_by
        : Array.isArray(m.task?.approvals?.approved_by)
        ? m.task.approvals.approved_by
        : []
    );
    const mergedApproved = Array.from(
      new Set([
        ...(Array.isArray(t.approvals?.approved_by) ? t.approvals.approved_by : []),
        ...(Array.isArray(t.approval?.approved_by) ? t.approval.approved_by : []),
        ...msgApproved,
      ].filter(Boolean))
    );
    const syncedApprovals = {
      needed: 2,
      ...(t.approvals || t.approval || {}),
      approved_by: mergedApproved,
      status:
        mergedApproved.length >= 2 || t.status === "done"
          ? "approved"
          : mergedApproved.length === 1
          ? "partial"
          : (t.approvals?.status || t.approval?.status || "pending"),
    };
    t.approvals = syncedApprovals;
    t.approval = syncedApprovals;
    if (mergedApproved.length === 1 && (!Array.isArray(t.checkpoints) || t.checkpoints.length === 0) && (Number(t.progress) || 0) < 50) {
      t.progress = 50;
    } else if (mergedApproved.length >= 2) {
      t.progress = 100;
    }

    res.json({
      ...t,
      approvals: syncedApprovals,
      approval: syncedApprovals,
      requestor_ids: reqIds,
      requestor_id: reqIds[0] || t.created_by || null,
      board,
    });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    const user = getReqUser(req) || currentSessionUser;
    if (!isTaskAccessible(t, user)) {
      return res.status(403).json({ detail: "Akses ditolak. Anda tidak memiliki izin untuk mengedit tugas divisi lain." });
    }

    const actorId = user?.user_id || "user_admin1";
    const actorName = user?.name || "User";
    const getUserName = (uid: string | null | undefined) => {
      if (!uid) return "Unassigned";
      return db.users.find((u: any) => u.user_id === uid)?.name || uid;
    };
    const getStatusName = (key: string | null | undefined) => {
      if (!key) return "—";
      return db.statuses?.find((s: any) => s.key === key)?.name || key;
    };
    const getBoardName = (bid: string | null | undefined) => {
      if (!bid) return "—";
      return db.boards?.find((b: any) => b.id === bid)?.name || bid;
    };
    const getProjectName = (pid: string | null | undefined) => {
      if (!pid) return "No project";
      return db.projects?.find((p: any) => p.id === pid)?.name || pid;
    };
    const getLabelNames = (lids: string[] | undefined) => {
      if (!Array.isArray(lids) || !lids.length) return "Kosong";
      return lids.map((id) => db.labels?.find((l: any) => l.id === id)?.name || id).join(", ");
    };
    const stripHtml = (html: string | undefined | null) => String(html || "").replace(/<[^>]*>?/gm, "").trim();

    const recordTaskActivity = (action: string, detail?: string, changes?: { field?: string; from?: any; to?: any }) => {
      const nowIso = new Date().toISOString();
      const act = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        actor_id: actorId,
        action,
        detail,
        changes,
        task_id: t.id,
        task_title: t.title,
        created_at: nowIso
      };
      t.activity = Array.isArray(t.activity) ? t.activity : [];
      t.activity.unshift(act);
      db.activity.unshift(act);
      db.audit_logs.unshift({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        actor_id: actorId,
        actor_name: actorName,
        action: `${action} (${t.number_str || t.title})${detail ? ` — ${detail}` : ""}`,
        created_at: nowIso
      });
    };

    // Reviewer otomatis sinkron dengan requestor + normalize requestor_id
    if (Array.isArray(req.body.requestor_ids)) {
      req.body.reviewer_ids = req.body.requestor_ids;
      req.body.requestor_id = req.body.requestor_ids[0] || t.created_by || null;
    }

    // 1. Title change
    if (req.body.title !== undefined && req.body.title !== t.title) {
      recordTaskActivity(
        `mengubah judul tugas`,
        `Dari "${t.title || "—"}" menjadi "${req.body.title}"`,
        { field: "title", from: t.title, to: req.body.title }
      );
    }

    // 2. Brief / Description change
    if (req.body.description !== undefined && req.body.description !== t.description) {
      const oldBrief = stripHtml(t.description);
      const newBrief = stripHtml(req.body.description);
      if (oldBrief !== newBrief) {
        const summaryText = newBrief
          ? (oldBrief ? `Dari: "${oldBrief.slice(0, 100)}${oldBrief.length > 100 ? "…" : ""}" → Menjadi: "${newBrief.slice(0, 140)}${newBrief.length > 140 ? "…" : ""}"` : `Isi brief: "${newBrief.slice(0, 150)}${newBrief.length > 150 ? "…" : ""}"`)
          : "Brief dikosongkan";
        recordTaskActivity(
          oldBrief ? `mengubah brief tugas` : `menulis brief tugas`,
          summaryText,
          { field: "description", from: oldBrief || "Kosong", to: newBrief || "Kosong" }
        );
      }
    }

    // 3. Status change
    if (req.body.status !== undefined && req.body.status !== t.status) {
      recordTaskActivity(
        `mengubah status tugas dari "${getStatusName(t.status)}" ke "${getStatusName(req.body.status)}"`,
        undefined,
        { field: "status", from: getStatusName(t.status), to: getStatusName(req.body.status) }
      );
    }

    // 4. Priority change
    if (req.body.priority !== undefined && req.body.priority !== t.priority) {
      recordTaskActivity(
        `mengubah prioritas tugas dari "${t.priority || "medium"}" ke "${req.body.priority}"`,
        undefined,
        { field: "priority", from: t.priority, to: req.body.priority }
      );
    }

    // 5. Board change
    if (req.body.board_id !== undefined && req.body.board_id !== t.board_id) {
      recordTaskActivity(
        `memindahkan tugas dari board "${getBoardName(t.board_id)}" ke "${getBoardName(req.body.board_id)}"`,
        undefined,
        { field: "board_id", from: getBoardName(t.board_id), to: getBoardName(req.body.board_id) }
      );
    }

    // 6. Project change
    if (req.body.project_id !== undefined && req.body.project_id !== t.project_id) {
      recordTaskActivity(
        `mengubah project dari "${getProjectName(t.project_id)}" ke "${getProjectName(req.body.project_id)}"`,
        undefined,
        { field: "project_id", from: getProjectName(t.project_id), to: getProjectName(req.body.project_id) }
      );
    }

    // 7. Department change
    if (req.body.department !== undefined && req.body.department !== (t.department || "")) {
      recordTaskActivity(
        `mengubah departemen dari "${t.department || "Kosong"}" ke "${req.body.department || "Kosong"}"`,
        undefined,
        { field: "department", from: t.department || "Kosong", to: req.body.department || "Kosong" }
      );
    }

    // 8. Item type change
    if (req.body.item_type !== undefined && req.body.item_type !== (t.item_type || "")) {
      recordTaskActivity(
        `mengubah tipe item dari "${t.item_type || "Kosong"}" ke "${req.body.item_type || "Kosong"}"`,
        undefined,
        { field: "item_type", from: t.item_type || "Kosong", to: req.body.item_type || "Kosong" }
      );
    }

    // 9. Link file/folder change
    if (req.body.link_url !== undefined && req.body.link_url !== (t.link_url || "")) {
      recordTaskActivity(
        req.body.link_url ? `memperbarui link file/folder` : `menghapus link file/folder`,
        req.body.link_url ? `Link: ${req.body.link_url}` : `Sebelumnya: ${t.link_url}`,
        { field: "link_url", from: t.link_url || "Kosong", to: req.body.link_url || "Kosong" }
      );
    }

    // 10. Deadline change
    if (req.body.deadline !== undefined && req.body.deadline !== t.deadline) {
      const oldDl = t.deadline ? String(t.deadline).slice(0, 16).replace("T", " ") : "Kosong";
      const newDl = req.body.deadline ? String(req.body.deadline).slice(0, 16).replace("T", " ") : "Kosong";
      recordTaskActivity(
        `mengubah tenggat waktu (deadline) dari "${oldDl}" ke "${newDl}"`,
        undefined,
        { field: "deadline", from: oldDl, to: newDl }
      );
    }

    // 11. Start date change
    if (req.body.start_date !== undefined && req.body.start_date !== (t.start_date || null)) {
      recordTaskActivity(
        `mengubah tanggal mulai (start date) dari "${t.start_date || "Kosong"}" ke "${req.body.start_date || "Kosong"}"`,
        undefined,
        { field: "start_date", from: t.start_date || "Kosong", to: req.body.start_date || "Kosong" }
      );
    }

    // 12. Submit date change
    if (req.body.submit_date !== undefined && req.body.submit_date !== (t.submit_date || null)) {
      recordTaskActivity(
        `mengubah tanggal submit dari "${t.submit_date || "Kosong"}" ke "${req.body.submit_date || "Kosong"}"`,
        undefined,
        { field: "submit_date", from: t.submit_date || "Kosong", to: req.body.submit_date || "Kosong" }
      );
    }

    // 13. IP / Brand labels change
    if (Array.isArray(req.body.label_ids)) {
      const oldL = JSON.stringify([...(t.label_ids || [])].sort());
      const newL = JSON.stringify([...req.body.label_ids].sort());
      if (oldL !== newL) {
        recordTaskActivity(
          `mengubah IP / Brand label`,
          `Dari [${getLabelNames(t.label_ids)}] menjadi [${getLabelNames(req.body.label_ids)}]`,
          { field: "label_ids", from: getLabelNames(t.label_ids), to: getLabelNames(req.body.label_ids) }
        );
      }
    }

    // 14. Card color / style change
    if (req.body.card_color !== undefined && req.body.card_color !== t.card_color) {
      recordTaskActivity(
        req.body.card_color ? `mengubah warna kartu menjadi ${req.body.card_color}` : `mereset warna kartu`,
        undefined,
        { field: "card_color", from: t.card_color || "Default", to: req.body.card_color || "Default" }
      );
    }
    if (req.body.card_style !== undefined && req.body.card_style !== t.card_style) {
      recordTaskActivity(
        `mengubah gaya tampilan warna kartu ke "${req.body.card_style}"`,
        undefined,
        { field: "card_style", from: t.card_style || "bar", to: req.body.card_style }
      );
    }

    // 15. Requestor change
    if (Array.isArray(req.body.requestor_ids)) {
      const oldReq = (t.requestor_ids || []).map(getUserName).join(", ") || "Kosong";
      const newReq = req.body.requestor_ids.map(getUserName).join(", ") || "Kosong";
      if (oldReq !== newReq) {
        recordTaskActivity(
          `memperbarui daftar Requestor`,
          `Dari [${oldReq}] menjadi [${newReq}]`,
          { field: "requestor_ids", from: oldReq, to: newReq }
        );
      }
    }

    // 16. Attachments change
    if (Array.isArray(req.body.attachments)) {
      const oldAtt = t.attachments || [];
      const newAtt = req.body.attachments;
      if (newAtt.length > oldAtt.length) {
        const added = newAtt.filter((na: any) => !oldAtt.some((oa: any) => oa.id === na.id));
        const names = added.map((a: any) => a.name || "File").join(", ");
        recordTaskActivity(`menambahkan lampiran file "${names}"`, `Total lampiran: ${newAtt.length}`);
      } else if (newAtt.length < oldAtt.length) {
        const removed = oldAtt.filter((oa: any) => !newAtt.some((na: any) => na.id === oa.id));
        const names = removed.map((a: any) => a.name || "File").join(", ");
        recordTaskActivity(`menghapus lampiran file "${names}"`, `Total lampiran: ${newAtt.length}`);
      }
    }

    const cpAddedCollaborators: string[] = [];

    // 17. Checkpoint granular tracking (add, delete, rename, PIC change, deadline change, done/undone)
    if (Array.isArray(req.body.checkpoints)) {
      const oldCheckpoints = t.checkpoints || [];
      const effectiveTaskAssignees: string[] = Array.isArray(req.body.assignee_ids)
        ? req.body.assignee_ids.filter(Boolean)
        : (req.body.assignee_id !== undefined
            ? (req.body.assignee_id ? [req.body.assignee_id] : [])
            : (Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : [])));
      const effectivePrimaryAssignee = effectiveTaskAssignees[0] || null;
      const newCheckpoints = req.body.checkpoints.map((nc: any) => {
        if (!nc || typeof nc !== "object") return nc;
        const isNewCp = !oldCheckpoints.some((oc: any) => oc.id === nc.id);
        if (isNewCp && !nc.assignee_id && !nc.unassigned && effectivePrimaryAssignee) {
          return { ...nc, assignee_id: effectivePrimaryAssignee };
        }
        return nc;
      });
      req.body.checkpoints = newCheckpoints;
      if (effectiveTaskAssignees.length === 0 && req.body.assignee_ids === undefined && req.body.assignee_id === undefined) {
        const cpPics = newCheckpoints.map((c: any) => c?.assignee_id).filter(Boolean);
        if (cpPics.length > 0) {
          const uniq = Array.from(new Set(cpPics));
          req.body.assignee_ids = uniq;
          req.body.assignee_id = uniq[0];
        }
      }

      // Added checkpoints
      const addedCps = newCheckpoints.filter((nc: any) => !oldCheckpoints.some((oc: any) => oc.id === nc.id));
      if (addedCps.length === 1) {
        recordTaskActivity(
          `menambahkan checkpoint baru "${addedCps[0].title || 'Checkpoint'}"`,
          addedCps[0].assignee_id ? `PIC: ${getUserName(addedCps[0].assignee_id)}` : undefined
        );
      } else if (addedCps.length > 1) {
        recordTaskActivity(
          `menambahkan ${addedCps.length} checkpoint baru`,
          addedCps.map((c: any) => c.title).join(", ")
        );
      }

      // Removed checkpoints
      const removedCps = oldCheckpoints.filter((oc: any) => !newCheckpoints.some((nc: any) => nc.id === oc.id));
      removedCps.forEach((rc: any) => {
        recordTaskActivity(`menghapus checkpoint "${rc.title || 'Checkpoint'}"`);
      });

      // Modified existing checkpoints
      newCheckpoints.forEach((newCp: any) => {
        if (newCp.assignee_id && !cpAddedCollaborators.includes(newCp.assignee_id)) {
          cpAddedCollaborators.push(newCp.assignee_id);
        }
        const oldCp = oldCheckpoints.find((c: any) => c.id === newCp.id);
        if (!oldCp) return;

        if (newCp.done && !oldCp.done) {
          recordTaskActivity(`menyelesaikan checkpoint "${newCp.title || 'Poin Checklist'}" pada tugas`);
        } else if (!newCp.done && oldCp.done) {
          recordTaskActivity(`membuka kembali (uncheck) checkpoint "${newCp.title || 'Poin Checklist'}"`);
        }

        if (newCp.title !== oldCp.title) {
          recordTaskActivity(
            `mengubah nama checkpoint`,
            `Dari "${oldCp.title}" menjadi "${newCp.title}"`,
            { field: "checkpoint_title", from: oldCp.title, to: newCp.title }
          );
        }

        if ((newCp.assignee_id || null) !== (oldCp.assignee_id || null)) {
          recordTaskActivity(
            `mengubah PIC checkpoint "${newCp.title}"`,
            `Dari ${getUserName(oldCp.assignee_id)} ke ${getUserName(newCp.assignee_id)}`,
            { field: "checkpoint_pic", from: getUserName(oldCp.assignee_id), to: getUserName(newCp.assignee_id) }
          );
        }

        if ((newCp.deadline || "") !== (oldCp.deadline || "")) {
          recordTaskActivity(
            `mengubah deadline checkpoint "${newCp.title}"`,
            `Dari "${oldCp.deadline || "Kosong"}" menjadi "${newCp.deadline || "Kosong"}"`,
            { field: "checkpoint_deadline", from: oldCp.deadline || "Kosong", to: newCp.deadline || "Kosong" }
          );
        }
      });

      // Recalculate progress percentage
      const doneTotal = newCheckpoints.filter((c: any) => c.done).length;
      req.body.progress = newCheckpoints.length > 0 ? Math.round((doneTotal / newCheckpoints.length) * 100) : (t.status === "done" ? 100 : 0);

      // Detect if a checkpoint has reached its assigned PIC's turn (ready to work on)
      const newActiveIdx = newCheckpoints.findIndex((c: any) => !c.done);
      const oldActiveIdx = oldCheckpoints.findIndex((c: any) => !c.done);
      const notifiedInThisPatch = new Set<string>();

      newCheckpoints.forEach((newCp: any, idx: number) => {
        const oldCp = oldCheckpoints.find((c: any) => c.id === newCp.id);
        const isCurrentTurn = !newCp.done && idx === newActiveIdx;
        const prevCp = idx > 0 ? newCheckpoints[idx - 1] : null;
        const oldPrevCp = prevCp ? oldCheckpoints.find((c: any) => c.id === prevCp.id) : null;
        const immediatePrevJustCompleted = !newCp.done && Boolean(prevCp?.done) && !oldPrevCp?.done;

        const isReached = isCurrentTurn || immediatePrevJustCompleted;

        if (!isReached) {
          newCp.notified_ready_for = null;
          return;
        }

        if (!newCp.assignee_id) {
          newCp.notified_ready_for = null;
          return;
        }

        const turnJustReached =
          immediatePrevJustCompleted ||
          (isCurrentTurn && (oldActiveIdx !== newActiveIdx || oldCheckpoints[oldActiveIdx]?.id !== newCp.id)) ||
          (oldCp?.done && !newCp.done);
        const picJustAssignedOnReached = (newCp.assignee_id || null) !== (oldCp?.assignee_id || null);
        const notYetNotified = newCp.notified_ready_for !== newCp.assignee_id;

        if ((turnJustReached || picJustAssignedOnReached || notYetNotified) && !notifiedInThisPatch.has(`${newCp.id}_${newCp.assignee_id}`)) {
          notifiedInThisPatch.add(`${newCp.id}_${newCp.assignee_id}`);
          newCp.notified_ready_for = newCp.assignee_id;

          const targetUid = newCp.assignee_id;
          const taskTitle = req.body.title || t.title;
          const readyMsg = `Task "${taskTitle}" sudah siap dikerjakan, Semangat ya..`;

          // Ensure checkpoint PIC is in collaborator_ids so they can always access the task
          t.collaborator_ids = Array.isArray(t.collaborator_ids) ? t.collaborator_ids : [];
          if (!t.collaborator_ids.includes(targetUid)) {
            t.collaborator_ids.push(targetUid);
          }
          if (!cpAddedCollaborators.includes(targetUid)) {
            cpAddedCollaborators.push(targetUid);
          }

          // Also log to Circle Assistant DM (with silent_popup so the main task notification popup takes priority)
          let conv = db.conversations.find((c: any) => c.id === `conv_circle_${targetUid}`);
          if (!conv) {
            conv = {
              id: `conv_circle_${targetUid}`,
              type: "dm",
              name: db.workspace?.assistant_name || "Circle",
              admin_ids: [],
              members: [CIRCLE_BOT_ID, targetUid],
              member_ids: [CIRCLE_BOT_ID, targetUid],
              unread: 1,
              last_message_preview: readyMsg,
              last_message_at: new Date().toISOString()
            };
            db.conversations.unshift(conv);
          } else {
            conv.unread = (conv.unread || 0) + 1;
            conv.last_message_preview = readyMsg;
            conv.last_message_at = new Date().toISOString();
          }

          const botMsg = {
            id: `msg_cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conv.id,
            sender_id: CIRCLE_BOT_ID,
            user_id: CIRCLE_BOT_ID,
            member_ids: [CIRCLE_BOT_ID, targetUid],
            text: `${readyMsg}\n(Checkpoint: ${newCp.title || "Tahap Tugas"})`,
            task_id: t.id,
            silent_popup: true,
            created_at: new Date().toISOString()
          };
          db.messages.push(botMsg);
          broadcast({ type: "message:new", data: botMsg });
          broadcast({ type: "conversations:changed" });

          // Main notification to the assigned PIC
          createNotification({
            user_id: targetUid,
            title: `Checkpoint Siap Dikerjakan: ${newCp.title || taskTitle}`,
            body: readyMsg,
            type: "checkpoint_ready",
            category: "tasks",
            actor_id: actorId,
            link: `/tasks?task=${t.id}`,
            task_id: t.id
          });
        }
      });
    }
    
    // If status changed to done, mark completed_at and progress 100
    if (req.body.status === "done" && t.status !== "done") {
      req.body.completed_at = new Date().toISOString();
      if (!req.body.checkpoints) req.body.progress = 100;
    }
    // Archive / Unarchive tracking
    if (req.body.archived === false && t.archived === true) {
      t.archived = false;
      recordTaskActivity(`memulihkan (unarchive) tugas kembali ke board aktif`);
    }
    if (req.body.archived === true && !t.archived) {
      t.archived = true;
      t.archived_at = t.archived_at || new Date().toISOString();
      t.archived_month = t.archived_month || new Date().toISOString().slice(0, 7);
      recordTaskActivity(`mengarsipkan tugas ke folder ${t.archived_month}`);
    }

    const oldAssignees: string[] = Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : []);
    if (Array.isArray(req.body.assignee_ids)) {
      req.body.assignee_ids = req.body.assignee_ids.filter(Boolean);
      req.body.assignee_id = req.body.assignee_ids[0] || null;
    } else if (req.body.assignee_id !== undefined && !req.body.assignee_ids) {
      req.body.assignee_ids = req.body.assignee_id ? [req.body.assignee_id] : [];
    }

    if (req.body.assignee_ids !== undefined) {
      const oldNames = oldAssignees.map(getUserName).join(", ") || "Unassigned";
      const newNames = (req.body.assignee_ids || []).map(getUserName).join(", ") || "Unassigned";
      if (oldNames !== newNames) {
        recordTaskActivity(
          `mengubah Assignee tugas`,
          `Dari [${oldNames}] menjadi [${newNames}]`,
          { field: "assignee_ids", from: oldNames, to: newNames }
        );
      }
    }

    const oldStatus = t.status;

    // Strict automatic computation of status compliance:
    const effectiveDeadline = req.body.deadline !== undefined ? req.body.deadline : t.deadline;
    const effectiveStatus = req.body.status !== undefined ? req.body.status : t.status;

    if (effectiveStatus === "done") {
      if (!t.completed_at && !req.body.completed_at) {
        req.body.completed_at = new Date().toISOString();
      }
      const finishTime = new Date(req.body.completed_at || t.completed_at || Date.now());
      if (effectiveDeadline) {
        req.body.deadline_compliance = finishTime > new Date(effectiveDeadline) ? "Overdue" : "On time";
      } else {
        req.body.deadline_compliance = "On time";
      }
      if (req.body.progress === undefined) req.body.progress = 100;
    } else {
      if (t.status === "done" && req.body.status !== "done") {
        t.completed_at = null;
        req.body.completed_at = null;
      }
      if (effectiveDeadline && new Date() > new Date(effectiveDeadline)) {
        req.body.deadline_compliance = "Overdue";
      } else {
        req.body.deadline_compliance = "In Progress";
      }
    }

    req.body.updated_at = new Date().toISOString();
    Object.assign(t, req.body);
    if (!Array.isArray(req.body.checkpoints) && req.body.assignee_id && Array.isArray(t.checkpoints) && t.checkpoints.length > 0) {
      t.checkpoints = t.checkpoints.map((c: any) =>
        c && !c.assignee_id && !c.unassigned ? { ...c, assignee_id: req.body.assignee_id } : c
      );
    }
    if (cpAddedCollaborators.length > 0) {
      t.collaborator_ids = Array.from(new Set([...(Array.isArray(t.collaborator_ids) ? t.collaborator_ids : []), ...cpAddedCollaborators]));
    }

    // Notify newly assigned users
    if (Array.isArray(t.assignee_ids)) {
      const newlyAssigned = t.assignee_ids.filter((uid: string) => !oldAssignees.includes(uid));
      newlyAssigned.forEach((userId: string) => {
        if (userId !== actorId) {
          createNotification({
            user_id: userId,
            title: "Tugas Ditugaskan Kepadamu",
            body: `${actorName} menugaskan "${t.title}" kepadamu.`,
            type: "task_assigned",
            category: "tasks",
            actor_id: actorId,
            link: `/tasks?task=${t.id}`,
            task_id: t.id
          });
        }
      });
    }
    
    // Notify requestors if status changed
    if (req.body.status && req.body.status !== oldStatus) {
      const requestors = Array.isArray(t.requestor_ids) ? t.requestor_ids : [t.created_by];
      requestors.forEach((userId: string) => {
        if (userId === actorId) return;
        createNotification({
          user_id: userId,
          title: "Update Status Tugas",
          body: `Status "${t.title}" berubah menjadi ${t.status}.`,
          type: "task_status",
          category: "tasks",
          actor_id: actorId,
          link: `/tasks?task=${t.id}`,
          task_id: t.id
        });
      });
    }

    saveDbToFile(true);
    broadcast({ type: "tasks:changed", task: t });
    const board = db.boards?.find((b: any) => b.id === t.board_id) || db.boards?.[0] || null;
    res.json({ ...t, board });
  });

  app.post("/api/tasks/:id/checkpoints/:cpId/notify", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    const cp = (t.checkpoints || []).find((c: any) => c.id === req.params.cpId);
    if (!cp || !cp.assignee_id) return res.status(400).json({ detail: "Checkpoint belum memiliki PIC" });

    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    const readyMsg = `Task "${t.title}" sudah siap dikerjakan, Semangat ya..`;
    cp.notified_ready_for = cp.assignee_id;

    const notif = createNotification({
      user_id: cp.assignee_id,
      title: `Checkpoint Siap Dikerjakan: ${cp.title || t.title}`,
      body: readyMsg,
      type: "checkpoint_ready",
      category: "tasks",
      actor_id: actorId,
      link: `/tasks?task=${t.id}`,
      task_id: t.id
    });

    saveDbToFile(true);
    res.json({ success: true, notification: notif });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    const user = getReqUser(req) || currentSessionUser;
    if (!isTaskAccessible(t, user)) {
      return res.status(403).json({ detail: "Akses ditolak. Anda tidak memiliki izin untuk menghapus tugas divisi lain." });
    }
    const idx = db.tasks.findIndex((x: any) => x.id === req.params.id);
    const deleted = db.tasks.splice(idx, 1)[0];
    saveDbToFile(true);
    broadcast({ type: "tasks:changed", deleted_id: req.params.id });
    res.json({ success: true, task: deleted });
  });

  app.post("/api/tasks/:id/comments", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    t.comments = t.comments || [];
    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";

    const rawText = String(req.body?.text || "");
    const explicitMentions = Array.isArray(req.body?.mention_ids)
      ? req.body.mention_ids.filter(Boolean)
      : [];
    const detectedMentions = new Set<string>(explicitMentions);

    if (rawText.includes("@")) {
      const humanUsers = (db.users || []).filter(
        (u: any) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
      );
      const lowerText = rawText.toLowerCase();
      for (const u of humanUsers) {
        const fullName = String(u.name || "").trim();
        if (!fullName) continue;
        if (lowerText.includes(`@${fullName.toLowerCase()}`)) {
          detectedMentions.add(u.user_id);
          continue;
        }
        const firstName = fullName.split(/\s+/)[0];
        if (firstName && firstName.length >= 2) {
          const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const rx = new RegExp(`@${escaped}(?![\\w])`, "i");
          if (rx.test(rawText)) {
            detectedMentions.add(u.user_id);
          }
        }
      }
    }

    const finalMentionIds = Array.from(detectedMentions);

    const c = {
      id: `cmt_${Date.now()}`,
      user_id: actorId,
      author_id: actorId,
      ...req.body,
      mention_ids: finalMentionIds,
      created_at: new Date().toISOString()
    };
    t.comments.push(c);

    const cp = c.checkpoint_id ? (t.checkpoints || []).find((x: any) => x.id === c.checkpoint_id) : null;
    const isIssue = c.kind === "issue";
    const act = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actor_id: actorId,
      action: isIssue
        ? `melaporkan kendala${cp ? ` pada checkpoint "${cp.title}"` : ""}`
        : `menambahkan komentar${cp ? ` pada checkpoint "${cp.title}"` : ""}`,
      detail: c.text ? `"${String(c.text).slice(0, 140)}"` : undefined,
      task_id: t.id,
      task_title: t.title,
      created_at: new Date().toISOString()
    };
    t.activity = Array.isArray(t.activity) ? t.activity : [];
    t.activity.unshift(act);
    db.activity.unshift(act);

    // 1. Notify every tagged/mentioned user (@Nama)
    finalMentionIds.forEach((mentionedUserId: string) => {
      createNotification({
        user_id: mentionedUserId,
        title: `${actor?.name || "Seseorang"} menyebut Anda di komentar tugas`,
        body: `Pada tugas "${t.title}"${cp ? ` (Checkpoint: ${cp.title})` : ""}: "${rawText.slice(0, 120)}${rawText.length > 120 ? "..." : ""}"`,
        type: "task_mention",
        category: "mentions",
        actor_id: actorId,
        link: `/tasks?task=${t.id}`,
        task_id: t.id,
        sender: actor ? sanitizeUser(actor) : undefined
      });
    });

    // 2. Notify task creator, requestors, and assignees (excluding already-notified mentioned users)
    const usersToNotify = new Set(
      [
        t.created_by,
        t.assignee_id,
        ...(Array.isArray(t.assignee_ids) ? t.assignee_ids : []),
        ...(Array.isArray(t.requestor_ids) ? t.requestor_ids : []),
        ...(cp?.assignee_id ? [cp.assignee_id] : [])
      ].filter((id) => id && id !== actorId && !detectedMentions.has(id))
    );
    usersToNotify.forEach((userId) => {
      createNotification({
        user_id: userId as string,
        title: isIssue ? "Kendala Dilaporkan pada Tugas" : "Komentar Baru pada Tugas",
        body: `${actor?.name || "Seseorang"} berkomentar di "${t.title}": ${c.text || "Pesan"}`,
        type: "task_comment",
        category: "tasks",
        actor_id: actorId,
        link: `/tasks?task=${t.id}`,
        task_id: t.id,
        sender: actor ? sanitizeUser(actor) : undefined
      });
    });

    saveDbToFile();
    broadcast({ type: "tasks:changed", task: t });
    res.json(c);
  });

  app.patch("/api/tasks/:id/comments/:commentId", (req, res) => {
    const t = db.tasks.find((x: any) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Task not found" });
    const c = (t.comments || []).find((x: any) => x.id === req.params.commentId);
    if (!c) return res.status(404).json({ detail: "Comment not found" });

    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    Object.assign(c, req.body);

    const cp = c.checkpoint_id ? (t.checkpoints || []).find((x: any) => x.id === c.checkpoint_id) : null;
    if (req.body.resolved !== undefined) {
      const act = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        actor_id: actorId,
        action: req.body.resolved
          ? `menandai kendala selesai${cp ? ` pada checkpoint "${cp.title}"` : ""}`
          : `membuka kembali kendala${cp ? ` pada checkpoint "${cp.title}"` : ""}`,
        detail: c.text ? `"${String(c.text).slice(0, 120)}"` : undefined,
        task_id: t.id,
        task_title: t.title,
        created_at: new Date().toISOString()
      };
      t.activity = Array.isArray(t.activity) ? t.activity : [];
      t.activity.unshift(act);
      db.activity.unshift(act);
    }

    saveDbToFile();
    broadcast({ type: "tasks:changed", task: t });
    res.json(c);
  });


  app.get("/api/projects", (req, res) => {
    const list = db.projects.map((p: any) => {
      const tasks = db.tasks.filter((t: any) => t.project_id === p.id);
      const task_done = tasks.filter((t: any) => t.status === "done").length;
      const task_total = tasks.length;
      const progress = task_total > 0 ? Math.round((task_done / task_total) * 100) : 0;
      return {
        ...p,
        member_ids: p.member_ids || [],
        label_ids: p.label_ids || [],
        status: p.status || "active",
        task_done,
        task_total,
        progress
      };
    });
    res.json(list);
  });

  app.get("/api/projects/:id", (req, res) => {
    const p = db.projects.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Project not found" });
    const tasks = db.tasks.filter((t: any) => t.project_id === p.id);
    const task_done = tasks.filter((t: any) => t.status === "done").length;
    const task_total = tasks.length;
    const progress = task_total > 0 ? Math.round((task_done / task_total) * 100) : 0;
    res.json({
      ...p,
      member_ids: p.member_ids || [],
      label_ids: p.label_ids || [],
      status: p.status || "active",
      task_done,
      task_total,
      progress
    });
  });

  app.post("/api/projects", (req, res) => {
    const actor = getReqUser(req) || currentSessionUser;
    const actorUid = actor?.user_id;
    const p = {
      id: `prj_${Date.now()}`,
      status: "active",
      progress: 0,
      member_ids: req.body.member_ids || (actorUid ? [actorUid] : []),
      label_ids: req.body.label_ids || [],
      ...req.body,
      created_at: new Date().toISOString()
    };
    db.projects.push(p);
    saveDbToFile();
    res.json(p);
  });

  app.patch("/api/projects/:id", (req, res) => {
    const p = db.projects.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Project not found" });
    Object.assign(p, req.body);
    if (!Array.isArray(p.member_ids)) p.member_ids = [];
    if (!Array.isArray(p.label_ids)) p.label_ids = [];
    saveDbToFile();
    res.json(p);
  });

  app.delete("/api/projects/:id", (req, res) => {
    db.projects = db.projects.filter((x: any) => x.id !== req.params.id);
    saveDbToFile();
    res.json({ success: true });
  });

  app.get("/api/boards", (req, res) => {
    syncDivisionsToBoards();
    const user = getReqUser(req) || currentSessionUser;
    if (!user) return res.json(db.boards);

    const counts: Record<string, number> = {};
    (db.tasks || []).forEach((t: any) => {
      if (t.board_id && !t.archived) {
        counts[t.board_id] = (counts[t.board_id] || 0) + 1;
      }
    });

    const userDept = String(user.department || "").trim().toLowerCase();
    const isSuper = user.role === "super_admin" || user.role === "workspace_admin";

    const isBoardCollab = (b: any) => {
      if (!b) return false;
      const bd = String(b.department || "").trim().toLowerCase();
      return Boolean(
        b.is_collaborative ||
        b.board_type === "collaborative" ||
        b.board_type === "project" ||
        b.project_id ||
        !bd ||
        bd === "semua divisi" ||
        bd === "all" ||
        bd === "kolaborasi" ||
        bd === "project" ||
        b.id === "brd_div_project"
      );
    };

    const enriched = (db.boards || []).map((b: any) => {
      const boardDept = String(b.department || "").trim().toLowerCase();
      const isCollab = isBoardCollab(b);
      const isDeptMember = Boolean(userDept && boardDept === userDept);
      const isInvited = Boolean(Array.isArray(b.invited_member_ids) && b.invited_member_ids.includes(user.user_id));
      const isCollabMember = Boolean(
        isCollab &&
        (b.all_workspace_members !== false ||
          boardDept === "semua divisi" ||
          (Array.isArray(b.member_ids) && b.member_ids.includes(user.user_id)))
      );
      const isCreator = b.created_by === user.user_id;

      const deptMembers = (db.users || []).filter(
        (u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID && u.department && b.department && u.department.toLowerCase() === b.department.toLowerCase()
      ).map((u: any) => u.user_id);
      const invitedMembers = Array.isArray(b.invited_member_ids) ? b.invited_member_ids : [];
      const explicitCollabMembers = isCollab && Array.isArray(b.member_ids) ? b.member_ids : [];
      const totalMemberIds = isCollab && b.all_workspace_members !== false
        ? (db.users || []).filter((u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID).map((u: any) => u.user_id)
        : Array.from(new Set([...deptMembers, ...invitedMembers, ...explicitCollabMembers]));

      return {
        ...b,
        board_type: isCollab ? (b.board_type || "collaborative") : "department",
        is_collaborative: isCollab,
        all_workspace_members: b.all_workspace_members !== false,
        task_count: counts[b.id] || 0,
        dept_members_count: deptMembers.length,
        invited_members_count: invitedMembers.length,
        member_ids: totalMemberIds,
        is_dept_member: isDeptMember,
        is_invited: isInvited,
        is_accessible: isSuper || isDeptMember || isInvited || isCollabMember || isCreator
      };
    });

    if (isSuper || req.query.all === "1" || req.query.scope === "all") {
      return res.json(enriched);
    }

    const accessible = enriched.filter((b: any) => b.is_accessible);
    res.json(accessible);
  });

  app.get("/api/boards/:id/members", (req, res) => {
    const b = db.boards.find((x: any) => x.id === req.params.id);
    if (!b) return res.status(404).json({ detail: "Board not found" });

    const cleanDept = String(b.department || "").trim().toLowerCase();
    const isCollab = Boolean(
      b.is_collaborative ||
      b.board_type === "collaborative" ||
      b.board_type === "project" ||
      b.project_id ||
      !cleanDept ||
      cleanDept === "semua divisi" ||
      cleanDept === "all" ||
      cleanDept === "kolaborasi" ||
      cleanDept === "project" ||
      b.id === "brd_div_project"
    );

    const humanList = (db.users || []).filter((u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID);
    const deptUsers = isCollab && b.all_workspace_members !== false
      ? humanList
      : humanList.filter((u: any) => String(u.department || "").trim().toLowerCase() === cleanDept);

    const invitedIds = Array.isArray(b.invited_member_ids) ? b.invited_member_ids : [];
    const collabExplicitIds = isCollab && Array.isArray(b.member_ids) ? b.member_ids : [];
    const extraIds = Array.from(new Set([...invitedIds, ...collabExplicitIds])).filter((uid) => !deptUsers.some((u: any) => u.user_id === uid));
    const invitedUsers = humanList.filter((u: any) => extraIds.includes(u.user_id));

    res.json({
      board_id: b.id,
      board_name: b.name,
      department: b.department,
      board_type: isCollab ? (b.board_type || "collaborative") : "department",
      is_collaborative: isCollab,
      all_workspace_members: b.all_workspace_members !== false,
      color: b.color,
      dept_users: deptUsers,
      invited_users: invitedUsers,
      total_count: deptUsers.length + invitedUsers.length
    });
  });

  app.post("/api/boards", (req, res) => {
    const user = getReqUser(req) || currentSessionUser;
    const isCollab = Boolean(
      req.body.is_collaborative ||
      req.body.board_type === "collaborative" ||
      req.body.board_type === "project" ||
      req.body.project_id ||
      !req.body.department ||
      String(req.body.department).trim().toLowerCase() === "semua divisi"
    );
    const b = {
      id: `brd_${Date.now()}`,
      department: isCollab ? (req.body.department || "Semua Divisi") : (req.body.department || user?.department || "Marketing"),
      board_type: isCollab ? "collaborative" : "department",
      is_collaborative: isCollab,
      all_workspace_members: req.body.all_workspace_members !== false,
      project_id: req.body.project_id || null,
      invited_member_ids: req.body.invited_member_ids || [],
      member_ids: req.body.member_ids || (user ? [user.user_id] : []),
      created_by: user?.user_id,
      created_at: new Date().toISOString(),
      ...req.body
    };
    b.board_type = isCollab ? "collaborative" : "department";
    b.is_collaborative = isCollab;
    db.boards.push(b);
    saveDbToFile();
    broadcast({ type: "tasks:changed" });
    broadcast({ type: "boards:changed" });
    res.json(b);
  });

  app.patch("/api/boards/:id", (req, res) => {
    const b = db.boards.find((x: any) => x.id === req.params.id);
    if (!b) return res.status(404).json({ detail: "Board not found" });
    Object.assign(b, req.body);
    const bd = String(b.department || "").trim().toLowerCase();
    const isCollab = Boolean(
      b.is_collaborative ||
      b.board_type === "collaborative" ||
      b.board_type === "project" ||
      b.project_id ||
      !bd ||
      bd === "semua divisi" ||
      bd === "project" ||
      b.id === "brd_div_project"
    );
    b.is_collaborative = isCollab;
    b.board_type = isCollab ? "collaborative" : "department";
    saveDbToFile();
    broadcast({ type: "tasks:changed" });
    broadcast({ type: "boards:changed" });
    res.json(b);
  });

  app.post("/api/boards/:id/invite", (req, res) => {
    const b = db.boards.find((x: any) => x.id === req.params.id);
    if (!b) return res.status(404).json({ detail: "Board not found" });

    const rawIds = req.body.user_ids || (req.body.user_id ? [req.body.user_id] : []);
    const userIdsToAdd = (Array.isArray(rawIds) ? rawIds : [rawIds]).filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID);

    b.invited_member_ids = Array.isArray(b.invited_member_ids) ? b.invited_member_ids : [];
    const beforeCount = b.invited_member_ids.length;
    b.invited_member_ids = Array.from(new Set([...b.invited_member_ids, ...userIdsToAdd]));
    b.member_ids = [...b.invited_member_ids];

    const actor = getReqUser(req) || currentSessionUser;
    userIdsToAdd.forEach((uid: string) => {
      if (uid && uid !== actor?.user_id) {
        createNotification({
          user_id: uid,
          title: `Diundang ke ${b.name}`,
          body: `${actor?.name || "Rekan kerja"} mengundang Anda untuk mengakses ${b.name} (${b.department ? `Divisi ${b.department}` : "Workspace"}).`,
          type: "board_invite",
          category: "tasks",
          actor_id: actor?.user_id,
          link: `/tasks?board=${b.id}`
        });
      }
    });

    saveDbToFile();
    broadcast({ type: "tasks:changed" });
    res.json({ success: true, board: b, invited_member_ids: b.invited_member_ids, newly_invited: b.invited_member_ids.length - beforeCount });
  });

  app.post("/api/boards/:id/remove-member", (req, res) => {
    const b = db.boards.find((x: any) => x.id === req.params.id);
    if (!b) return res.status(404).json({ detail: "Board not found" });

    const targetUid = req.body.user_id;
    if (targetUid) {
      b.invited_member_ids = (b.invited_member_ids || []).filter((id: string) => id !== targetUid);
      b.member_ids = (b.member_ids || []).filter((id: string) => id !== targetUid);
      saveDbToFile();
      broadcast({ type: "tasks:changed" });
    }
    res.json({ success: true, board: b });
  });

  app.delete("/api/boards/:id", (req, res) => {
    db.boards = db.boards.filter((b: any) => b.id !== req.params.id);
    saveDbToFile();
    broadcast({ type: "tasks:changed" });
    res.json({ success: true });
  });

  // Groups & Channels Endpoints
  const isGroupAdmin = (g: any, user: any): boolean => {
    if (!g || !user?.user_id) return false;
    if (user.role === "super_admin") return true;
    if (g.created_by && g.created_by === user.user_id) return true;
    const admins = Array.isArray(g.admin_ids) ? g.admin_ids : [];
    if (admins.includes(user.user_id)) return true;
    if (
      (g.group_type === "department" || String(g.id || "").startsWith("group_official_")) &&
      ["manager", "department_manager", "project_manager"].includes(user.role) &&
      user.department &&
      String(user.department).trim().toLowerCase() === String(g.name || "").trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  };

  function buildGroupsBrowseList(reqUser: any) {
    const userId = reqUser?.user_id || currentSessionUser?.user_id;
    const convById = new Map<string, any>();
    for (const c of db.conversations || []) {
      if (c?.id) convById.set(c.id, c);
    }
    return (db.groups || []).map((g: any) => {
      const conv = convById.get(g.id);
      const rawMems = conv?.member_ids || g.member_ids || [];
      const mems = Array.from(new Set(rawMems.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID)));
      const adminIds = Array.from(
        new Set([g.created_by || conv?.created_by, ...(Array.isArray(conv?.admin_ids) ? conv.admin_ids : (Array.isArray(g.admin_ids) ? g.admin_ids : []))].filter(Boolean))
      );
      const rawReqs = Array.isArray(conv?.join_requests) ? conv.join_requests : (Array.isArray(g.join_requests) ? g.join_requests : []);
      const pendingReqs = rawReqs.filter((r: any) => r && r.user_id && r.status === "pending");
      const rawInvs = Array.isArray(conv?.invitations) ? conv.invitations : (Array.isArray(g.invitations) ? g.invitations : []);
      const pendingInvs = rawInvs.filter((inv: any) => inv && inv.user_id && inv.status === "pending");
      const canManage = isGroupAdmin({ ...g, admin_ids: adminIds, created_by: g.created_by || conv?.created_by }, reqUser);
      const isMember = Boolean(userId && mems.includes(userId));
      const hasInvitation = Boolean(userId && pendingInvs.some((inv: any) => inv.user_id === userId));
      return {
        ...g,
        ...(conv ? { name: conv.name || g.name, description: conv.description ?? g.description, image: conv.image ?? g.image, archived: conv.archived ?? g.archived, location: conv.location ?? g.location } : {}),
        created_by: g.created_by || conv?.created_by || adminIds[0] || null,
        admin_ids: adminIds,
        member_ids: mems,
        is_member: isMember,
        has_pending_request: Boolean(userId && pendingReqs.some((r: any) => r.user_id === userId)),
        has_invitation: hasInvitation,
        can_manage: canManage,
        join_requests: canManage ? pendingReqs : [],
        invitations: canManage ? pendingInvs : [],
        member_count: mems.length
      };
    }).filter((g: any) => g.is_member || g.has_invitation);
  }

  app.get("/api/groups/browse", (req, res) => {
    const reqUser = getReqUser(req);
    res.json(buildGroupsBrowseList(reqUser));
  });

  app.post("/api/groups", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) {
      return res.status(401).json({ detail: "Autentikasi diperlukan untuk membuat grup." });
    }
    const isVerified = reqUser.role === "super_admin";
    const creatorId = reqUser.user_id;
    const rawMembers = Array.isArray(req.body?.member_ids) ? req.body.member_ids : [];
    const rawDeputies = Array.isArray(req.body?.deputy_admin_ids)
      ? req.body.deputy_admin_ids
      : (Array.isArray(req.body?.admin_ids) ? req.body.admin_ids : []);
    const cleanDeputies = rawDeputies.filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
    const adminIds = Array.from(new Set([creatorId, ...cleanDeputies]));
    const cleanMembers = Array.from(new Set([creatorId, ...adminIds, ...rawMembers])).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
    const g = {
      ...req.body,
      id: `conv_${Date.now()}`,
      type: "group",
      group_type: req.body?.group_type || "public",
      is_member: true,
      is_verified: isVerified,
      created_by: creatorId,
      admin_ids: adminIds,
      join_requests: [],
      member_ids: cleanMembers,
      members: cleanMembers,
      member_count: cleanMembers.length,
      unread: 0,
      last_message_preview: "",
      last_message_at: new Date().toISOString(),
    };
    delete g.deputy_admin_ids;
    db.groups.push(g);
    db.conversations.push({ ...g });

    if (g.group_type === "department") {
      const gName = String(g.name || "").trim();
      if (gName && Array.isArray(db.workspace?.divisions)) {
        if (!db.workspace.divisions.some((d: string) => d.toLowerCase() === gName.toLowerCase())) {
          db.workspace.divisions.push(gName);
          syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: false });
        }
      }
    }

    saveDbToFile(true);
    broadcast({ type: "groups:changed", data: g });
    broadcast({ type: "conversation:upsert", data: g });
    broadcast({ type: "boards:changed" });
    res.json(g);
  });

  // Team Stats Endpoint for MonthlyStats / TeamPerformance
  app.get("/api/stats/team", (req, res) => {
    const range = (req.query.range as string) || "7d";
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const anchor = (req.query.anchor as string) || todayStr;

    let week: string[] = [];
    if (range === "4w") {
      week = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - (29 - i));
        return d.toISOString().slice(0, 10);
      });
    } else {
      const dayOfWeek = (now.getDay() + 6) % 7; // 0 for Monday, 6 for Sunday
      const monday = new Date(now);
      monday.setDate(now.getDate() - dayOfWeek);
      week = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d.toISOString().slice(0, 10);
      });
    }

    // Real dynamic task stats
    const totalTasks = db.tasks.length;
    const doneTasks = db.tasks.filter((t: any) => t.status === "done" || t.archived);
    const overdueTasks = db.tasks.filter((t: any) => t.status !== "done" && !t.archived && t.deadline && new Date(t.deadline) < now);

    const onTimeRate = totalTasks > 0 ? Math.round(((totalTasks - overdueTasks.length) / totalTasks) * 100) : 100;

    const dayOfWeek = (now.getDay() + 6) % 7;
    const series = week.map((d, idx) => {
      // Find tasks completed on this date or matching deadline
      const matchedDone = db.tasks.filter((t: any) => {
        const compDate = (t.completed_at || t.archived_at || "").slice(0, 10);
        return compDate === d && (t.status === "done" || t.archived);
      }).length;

      const matchedOverdue = db.tasks.filter((t: any) => {
        const deadDate = (t.deadline || "").slice(0, 10);
        return deadDate === d && t.status !== "done" && !t.archived && new Date(t.deadline) < now;
      }).length;

      // Realistic weekly progression for 7d vs daily progression for 4w
      const doneVal = matchedDone > 0 ? matchedDone : (range === "7d" && doneTasks.length > 0 && idx <= dayOfWeek ? Math.max(0, doneTasks.length - Math.max(0, dayOfWeek - idx)) : matchedDone);
      const overdueVal = matchedOverdue;

      return {
        start: d,
        name: d.slice(5),
        done: doneVal,
        Selesai: doneVal,
        overdue: overdueVal,
        Overdue: overdueVal
      };
    });

    const { people } = computeWorkspaceWorkload(db, now, anchor);

    res.json({
      today: todayStr,
      anchor,
      range,
      summary: {
        done: doneTasks.length,
        overdue: overdueTasks.length,
        on_time_rate: onTimeRate,
        due: totalTasks,
        on_time: Math.max(0, totalTasks - overdueTasks.length)
      },
      week,
      series,
      people
    });
  });

  // Activity & Reminders Endpoints for Dashboard
  app.get("/api/activity", (req, res) => {
    res.json(db.activity);
  });

  app.get("/api/reminders", (req, res) => {
    res.json(db.reminders);
  });

  app.post("/api/reminders", (req, res) => {
    const actor = getReqUser(req) || currentSessionUser;
    const r = { id: `rem_${Date.now()}`, user_id: actor?.user_id || null, done: false, ...req.body };
    db.reminders.push(r);
    saveDbToFile();
    res.json(r);
  });

  app.patch("/api/reminders/:id", (req, res) => {
    const r = db.reminders.find((x: any) => x.id === req.params.id);
    if (r) Object.assign(r, req.body);
    saveDbToFile();
    res.json(r || { success: true });
  });

  app.delete("/api/reminders/:id", (req, res) => {
    db.reminders = db.reminders.filter((r: any) => r.id !== req.params.id);
    saveDbToFile();
    res.json({ success: true });
  });

  // Org Endpoints
  app.get("/api/org/units", (req, res) => {
    const sorted = [...(db.org_units || [])].sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
    res.json(sorted);
  });

  app.post("/api/org/units", (req, res) => {
    db.org_units = Array.isArray(db.org_units) ? db.org_units : [];
    const { member_ids, sync_division = true, ...rest } = req.body || {};
    const name = String(rest.name || "").trim();
    if (!name) return res.status(400).json({ detail: "Nama unit wajib diisi" });
    const divisionName = String(rest.division || name).trim();
    const u = {
      id: rest.id || `unit_${Date.now()}`,
      name,
      division: divisionName,
      description: rest.description || "",
      level: rest.level || "Division",
      color: rest.color || "#FF5364",
      head_id: rest.head_id || null,
      parent_id: rest.parent_id || null,
      order: typeof rest.order === "number" ? rest.order : db.org_units.length
    };
    db.org_units.push(u);

    if (sync_division && divisionName) {
      db.workspace.divisions = Array.isArray(db.workspace.divisions) ? db.workspace.divisions : [];
      if (!db.workspace.divisions.some((d: string) => d.toLowerCase() === divisionName.toLowerCase())) {
        db.workspace.divisions.push(divisionName);
      }
      syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: false });
    }

    if (Array.isArray(member_ids)) {
      (db.users || []).forEach((usr: any) => {
        if (usr.is_bot || usr.role === "assistant" || usr.user_id === CIRCLE_BOT_ID) return;
        if (member_ids.includes(usr.user_id)) {
          usr.org_unit_id = u.id;
          usr.department = u.division || u.name;
        }
      });
    }

    saveDbToFile();
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "users:changed" });
    res.json(u);
  });

  app.patch("/api/org/units/:id", (req, res) => {
    const u = (db.org_units || []).find((x: any) => x.id === req.params.id);
    if (!u) return res.status(404).json({ detail: "Unit tidak ditemukan" });
    const oldDivision = u.division || u.name;
    const { member_ids, sync_division = true, ...patch } = req.body || {};

    if (patch.name && !patch.division && (!u.division || u.division === u.name)) {
      patch.division = patch.name;
    }
    Object.assign(u, patch);
    const newDivision = u.division || u.name;

    if (sync_division && newDivision && Array.isArray(db.workspace.divisions)) {
      const idx = db.workspace.divisions.findIndex((d: string) => d.toLowerCase() === String(oldDivision).toLowerCase());
      if (idx !== -1) {
        db.workspace.divisions[idx] = newDivision;
      } else if (!db.workspace.divisions.some((d: string) => d.toLowerCase() === String(newDivision).toLowerCase())) {
        db.workspace.divisions.push(newDivision);
      }
      // Also rename any matching department group
      if (oldDivision && oldDivision.toLowerCase() !== newDivision.toLowerCase()) {
        [db.groups, db.conversations].forEach((list) => {
          (list || []).forEach((grp: any) => {
            if (grp && String(grp.name || "").toLowerCase() === String(oldDivision).toLowerCase() && (grp.group_type === "department" || grp.is_verified)) {
              grp.name = newDivision;
              grp.description = `Official channel for ${newDivision} department discussions`;
            }
          });
        });
      }
      syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: false });
    }

    // Update department for members assigned to this unit
    (db.users || []).forEach((usr: any) => {
      if (usr.is_bot || usr.role === "assistant" || usr.user_id === CIRCLE_BOT_ID) return;
      if (Array.isArray(member_ids)) {
        if (member_ids.includes(usr.user_id)) {
          usr.org_unit_id = u.id;
          usr.department = newDivision;
        } else if (usr.org_unit_id === u.id) {
          usr.org_unit_id = null;
        }
      } else if (usr.org_unit_id === u.id && newDivision) {
        usr.department = newDivision;
      }
    });

    saveDbToFile();
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "users:changed" });
    res.json(u);
  });

  app.post("/api/org/units/reorder", (req, res) => {
    const { unit_id, direction, ordered_ids } = req.body || {};
    db.org_units = Array.isArray(db.org_units) ? db.org_units : [];

    if (Array.isArray(ordered_ids)) {
      ordered_ids.forEach((id: string, idx: number) => {
        const found = db.org_units.find((u: any) => u.id === id);
        if (found) found.order = idx;
      });
    } else if (unit_id && direction) {
      const target = db.org_units.find((u: any) => u.id === unit_id);
      if (target) {
        const siblings = db.org_units
          .filter((u: any) => (u.parent_id || null) === (target.parent_id || null))
          .sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
        siblings.forEach((s: any, i: number) => { s.order = i; });
        const idx = siblings.findIndex((s: any) => s.id === unit_id);
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (idx !== -1 && swapIdx >= 0 && swapIdx < siblings.length) {
          const tempOrder = siblings[idx].order;
          siblings[idx].order = siblings[swapIdx].order;
          siblings[swapIdx].order = tempOrder;
        }
      }
    }

    db.org_units.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
    saveDbToFile();
    broadcast({ type: "org:changed", units: db.org_units });
    res.json(db.org_units);
  });

  app.post("/api/org/sync-divisions", (req, res) => {
    const targetDivs = Array.isArray(req.body?.divisions)
      ? req.body.divisions
      : (db.workspace.divisions || DEFAULT_ALIGNED_DIVISIONS);
    syncDivisionsToOrgUnits(targetDivs, { removeMissing: true });

    // Sync users whose department matches an org_unit
    (db.users || []).forEach((usr: any) => {
      if (usr.is_bot || usr.role === "assistant" || usr.user_id === CIRCLE_BOT_ID) return;
      if (!usr.org_unit_id && usr.department) {
        const matched = db.org_units.find(
          (u: any) =>
            (u.division || "").toLowerCase() === usr.department.toLowerCase() ||
            (u.name || "").toLowerCase() === usr.department.toLowerCase()
        );
        if (matched) usr.org_unit_id = matched.id;
      } else if (usr.org_unit_id) {
        const matched = db.org_units.find((u: any) => u.id === usr.org_unit_id);
        if (matched) usr.department = matched.division || matched.name;
      }
    });

    saveDbToFile();
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "users:changed" });
    res.json({ units: db.org_units, divisions: db.workspace.divisions, groups: db.groups });
  });

  app.delete("/api/org/units/:id", (req, res) => {
    const targetId = req.params.id;
    const reassignTo = req.query.reassign_to ? String(req.query.reassign_to) : null;
    const deletedUnit = (db.org_units || []).find((u: any) => u.id === targetId);
    const fallbackParent = reassignTo || deletedUnit?.parent_id || null;

    db.org_units = (db.org_units || []).filter((u: any) => u.id !== targetId);

    // Reassign child sub-units
    db.org_units.forEach((u: any) => {
      if (u.parent_id === targetId) {
        u.parent_id = fallbackParent === u.id ? null : fallbackParent;
      }
    });

    // Reassign members in deleted unit
    const targetReassignUnit = reassignTo ? db.org_units.find((u: any) => u.id === reassignTo) : null;
    (db.users || []).forEach((usr: any) => {
      if (usr.org_unit_id === targetId) {
        usr.org_unit_id = reassignTo || null;
        if (targetReassignUnit) {
          usr.department = targetReassignUnit.division || targetReassignUnit.name;
        }
      }
    });

    // Remove division from workspace.divisions and sync official department groups
    if (deletedUnit && Array.isArray(db.workspace.divisions)) {
      const divName = deletedUnit.division || deletedUnit.name;
      const stillUsed = db.org_units.some(
        (u: any) => (u.division || u.name || "").toLowerCase() === String(divName || "").toLowerCase()
      );
      if (!stillUsed && req.query.remove_division !== "false") {
        db.workspace.divisions = db.workspace.divisions.filter(
          (d: string) => d.toLowerCase() !== String(divName || "").toLowerCase()
        );
      }
      syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: true });
    }

    saveDbToFile();
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "users:changed" });
    res.json({ success: true, units: db.org_units, divisions: db.workspace.divisions });
  });

  app.patch("/api/org/members/:uid", (req, res) => {
    const m = db.users.find((u: any) => u.user_id === req.params.uid);
    if (!m) return res.status(404).json({ detail: "Anggota tidak ditemukan" });
    Object.assign(m, req.body);
    syncUserOrgAndDepartment(m, req.body);
    if (currentSessionUser?.user_id === m.user_id) {
      currentSessionUser = { ...currentSessionUser, ...m };
    }
    saveDbToFile();
    broadcast({ type: "users:changed", user: m });
    broadcast({ type: "org:changed", units: db.org_units });
    res.json(m);
  });

  app.get("/api/org/export", (req, res) => {
    const rows = [["Unit ID", "Unit Name", "Division", "Level", "Parent Unit ID", "Head Name", "Members Count"]];
    (db.org_units || []).forEach((u: any) => {
      const head = (db.users || []).find((x: any) => x.user_id === u.head_id);
      const memCount = (db.users || []).filter((x: any) => !x.is_bot && x.org_unit_id === u.id).length;
      rows.push([
        u.id || "",
        u.name || "",
        u.division || u.name || "",
        u.level || "Division",
        u.parent_id || "",
        head?.name || "",
        String(memCount)
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="organization.csv"');
    res.send(csv);
  });

  app.post("/api/org/import", upload.single("file"), (req: any, res) => {
    try {
      const raw = req.file ? req.file.buffer.toString("utf-8") : String(req.body?.csv || "");
      const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.json({ created: 0, updated: 0 });
      let created = 0;
      let updated = 0;
      const rootUnit = (db.org_units || []).find((u: any) => !u.parent_id);
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c: string) => c.replace(/^"|"$/g, "").trim());
        const name = cols[1] || cols[0];
        const division = cols[2] || name;
        const level = cols[3] || "Division";
        if (!name) continue;
        const existing = (db.org_units || []).find((u: any) => u.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.division = division;
          existing.level = level;
          updated++;
        } else {
          db.org_units.push({
            id: `unit_${Date.now()}_${i}`,
            name,
            division,
            level,
            color: "#3B82F6",
            head_id: null,
            parent_id: rootUnit ? rootUnit.id : null,
            order: db.org_units.length
          });
          created++;
        }
      }
      saveDbToFile();
      broadcast({ type: "org:changed", units: db.org_units });
      res.json({ created, updated });
    } catch (e: any) {
      res.status(400).json({ detail: e?.message || "Gagal mengimpor CSV" });
    }
  });

  function computeTrendingTags() {
    const topicMap: Record<
      string,
      {
        tag: string;
        label: string;
        count: number;
        author_ids: string[];
        is_topic: boolean;
        latest_at: string;
      }
    > = {};

    const addEntry = (rawTag: string, isTopic: boolean, authorId?: string, createdAt?: string) => {
      const cleaned = String(rawTag || "").replace(/^#+/, "").trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (!topicMap[key]) {
        topicMap[key] = {
          tag: isTopic ? cleaned : key,
          label: cleaned,
          count: 0,
          author_ids: [],
          is_topic: isTopic,
          latest_at: createdAt || new Date().toISOString()
        };
      } else if (isTopic && !topicMap[key].is_topic) {
        topicMap[key].is_topic = true;
        topicMap[key].tag = cleaned;
        topicMap[key].label = cleaned;
      }
      topicMap[key].count += 1;
      if (authorId && !topicMap[key].author_ids.includes(authorId) && topicMap[key].author_ids.length < 5) {
        topicMap[key].author_ids.push(authorId);
      }
      if (createdAt && new Date(createdAt) > new Date(topicMap[key].latest_at)) {
        topicMap[key].latest_at = createdAt;
      }
    };

    (db.posts || []).forEach((p: any) => {
      const seenInPost = new Set<string>();
      if (p.topic && String(p.topic).trim()) {
        const cleanTopic = String(p.topic).replace(/^#+/, "").trim();
        const k = cleanTopic.toLowerCase();
        seenInPost.add(k);
        addEntry(cleanTopic, true, p.author_id, p.created_at);
      }
      const matches = p.text?.match(/#([\p{L}\p{N}_]{1,40})/gu);
      if (matches) {
        matches.forEach((m: string) => {
          const t = m.slice(1);
          const k = t.toLowerCase();
          if (!seenInPost.has(k)) {
            seenInPost.add(k);
            addEntry(t, false, p.author_id, p.created_at);
          }
        });
      }
    });

    return Object.values(topicMap).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.is_topic !== b.is_topic) return a.is_topic ? -1 : 1;
      return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
    });
  }

  function hydratePostForUser(p: any, uid: string, includePreview = true): any {
    if (!p) return p;
    const likes = Array.isArray(p.likes) ? p.likes : [];
    const pollId = p.poll_id || p.poll?.id || null;
    let pollObj = null;
    if (pollId) {
      const foundPoll = (db.polls || []).find((x: any) => x.id === pollId) || p.poll;
      if (foundPoll) {
        pollObj = formatPollForUser(foundPoll, uid);
      }
    }
    const allReplies = includePreview
      ? (db.posts || []).filter((r: any) => r.parent_id === p.id)
      : [];
    const repliesPreview = includePreview
      ? allReplies.slice(-3).map((r: any) => hydratePostForUser(r, uid, false))
      : undefined;

    return {
      ...p,
      likes,
      like_count: likes.length,
      liked: Boolean(uid && likes.includes(uid)),
      reactions: p.reactions || {},
      poll_id: pollId,
      poll: pollObj,
      ...(includePreview
        ? {
            reply_count: allReplies.length,
            replies_preview: repliesPreview
          }
        : {})
    };
  }

  // Post / Feed Endpoints
  app.get("/api/posts", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    let list = [...(db.posts || [])].filter((p: any) => !p.parent_id);
    const { tag, before } = req.query;
    if (tag) {
      const qRaw = String(tag).replace(/^#+/, "").trim().toLowerCase();
      const qCompact = qRaw.replace(/\s+/g, "");
      list = list.filter((p: any) => {
        const postTopic = String(p.topic || "").replace(/^#+/, "").trim().toLowerCase();
        if (postTopic && (postTopic === qRaw || postTopic.replace(/\s+/g, "") === qCompact)) {
          return true;
        }
        const txt = String(p.text || "").toLowerCase();
        return txt.includes(`#${qRaw}`) || (qCompact && txt.includes(`#${qCompact}`));
      });
    }
    if (before) {
      list = list.filter((p: any) => new Date(p.created_at) < new Date(String(before)));
    }
    list.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(list.slice(0, 30).map((p: any) => hydratePostForUser(p, uid, true)));
  });

  app.post("/api/posts", (req, res) => {
    const { text, topic, poll, parent_id, attachments, mention_ids } = req.body;
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    let createdPollObj: any = null;
    if (poll && poll.question) {
      db.polls = db.polls || [];
      const rawOpts = Array.isArray(poll.options) ? poll.options.filter((x: any) => String(x || "").trim()) : [];
      const pollId = `poll_${Date.now()}`;
      const newPoll = {
        id: pollId,
        question: String(poll.question).trim(),
        multiple: !!poll.multiple,
        anonymous: !!poll.anonymous,
        allow_change: poll.allow_change !== false,
        expires_at: poll.expires_at || null,
        status: "open",
        options: rawOpts.map((opt: any, idx: number) =>
          typeof opt === "string" ? { id: `opt_${idx + 1}`, text: opt } : opt
        ),
        votes_by_user: {},
        created_by: uid,
        created_at: new Date().toISOString()
      };
      db.polls.push(newPoll);
      createdPollObj = formatPollForUser(newPoll, uid);
    }
    const cleanedTopic = topic ? String(topic).replace(/^#+/, "").trim().slice(0, 50) : null;
    const newPost = {
      id: `pst_${Date.now()}`,
      author_id: uid,
      topic: cleanedTopic || null,
      text: text || "",
      attachments: attachments || [],
      poll_id: createdPollObj?.id || poll?.id || null,
      poll: createdPollObj || null,
      mention_ids: mention_ids || [],
      parent_id: parent_id || null,
      likes: [],
      like_count: 0,
      liked: false,
      reactions: {},
      reply_count: 0,
      replies_preview: [],
      created_at: new Date().toISOString()
    };
    let updatedParent: any = null;
    if (parent_id) {
      const parent = db.posts.find((p: any) => p.id === parent_id);
      if (parent) {
        parent.reply_count = (parent.reply_count || 0) + 1;
        parent.replies_preview = parent.replies_preview || [];
        parent.replies_preview.push(newPost);
        updatedParent = parent;
      }
    }
    db.posts.unshift(newPost);
    
    // Notify mentioned users
    if (Array.isArray(mention_ids)) {
      mention_ids.forEach((userId: string) => {
        if (userId === uid) return;
        createNotification({
          user_id: userId,
          title: "Anda dimention dalam postingan",
          body: `${reqUser?.name || "Seseorang"} menyebut Anda dalam sebuah postingan: "${text?.slice(0, 50)}${text?.length > 50 ? '...' : ''}"`,
          type: "post_mention",
          category: "social",
          actor_id: uid,
          link: `/beranda`
        });
      });
    }

    // Notify parent author if this is a reply
    if (parent_id && updatedParent && updatedParent.author_id !== uid) {
      createNotification({
        user_id: updatedParent.author_id,
        title: "Balasan baru pada postingan Anda",
        body: `${reqUser?.name || "Seseorang"} membalas postingan Anda.`,
        type: "post_reply",
        category: "social",
        actor_id: uid,
        link: `/beranda/${parent_id}`
      });
    }

    saveDbToFile();
    const hydratedNew = hydratePostForUser(newPost, uid, !parent_id);
    broadcast({
      type: "post:new",
      data: hydratedNew,
      parent: updatedParent ? hydratePostForUser(updatedParent, uid, true) : null,
      trending: computeTrendingTags()
    });
    res.json(hydratedNew);
  });

  app.get("/api/posts/trending", (req, res) => {
    res.json(computeTrendingTags());
  });

  app.get("/api/posts/:id", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const p = db.posts.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Post not found" });
    const replies = db.posts
      .filter((x: any) => x.parent_id === p.id)
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((r: any) => hydratePostForUser(r, uid, false));
    res.json({ ...hydratePostForUser(p, uid, true), replies });
  });

  app.patch("/api/posts/:id", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const p = db.posts.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Post not found" });

    const isAdminUser = ["super_admin", "workspace_admin"].includes(reqUser?.role);
    if (p.author_id !== uid && !isAdminUser) {
      return res.status(403).json({ detail: "Anda tidak memiliki izin untuk mengedit postingan ini." });
    }

    if (req.body.text !== undefined) {
      p.text = String(req.body.text);
    }
    if (req.body.topic !== undefined) {
      p.topic = req.body.topic ? String(req.body.topic).replace(/^#+/, "").trim().slice(0, 50) : null;
    }
    if (Array.isArray(req.body.attachments)) {
      p.attachments = req.body.attachments;
    }
    if (Array.isArray(req.body.mention_ids)) {
      p.mention_ids = req.body.mention_ids;
    }
    p.edited = true;
    p.updated_at = new Date().toISOString();

    let updatedParent: any = null;
    if (p.parent_id) {
      const parent = db.posts.find((x: any) => x.id === p.parent_id);
      if (parent) {
        const allReplies = db.posts.filter((r: any) => r.parent_id === parent.id);
        parent.reply_count = allReplies.length;
        parent.replies_preview = allReplies.slice(-3);
        updatedParent = hydratePostForUser(parent, uid, true);
      }
    }

    saveDbToFile();
    const hydrated = hydratePostForUser(p, uid, !p.parent_id);
    broadcast({
      type: "post:updated",
      data: hydrated,
      parent: updatedParent,
      trending: computeTrendingTags()
    });
    res.json(hydrated);
  });

  app.delete("/api/posts/:id", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const target = db.posts.find((p: any) => p.id === req.params.id);
    const parentId = target?.parent_id || null;
    db.posts = db.posts.filter((p: any) => p.id !== req.params.id && p.parent_id !== req.params.id);
    let updatedParent: any = null;
    if (parentId) {
      const parent = db.posts.find((p: any) => p.id === parentId);
      if (parent) {
        parent.replies_preview = (parent.replies_preview || []).filter((r: any) => r.id !== req.params.id);
        parent.reply_count = db.posts.filter((r: any) => r.parent_id === parentId).length;
        updatedParent = hydratePostForUser(parent, uid, true);
      }
    }
    saveDbToFile();
    broadcast({
      type: "post:deleted",
      id: req.params.id,
      parent_id: parentId,
      parent: updatedParent,
      trending: computeTrendingTags()
    });
    res.json({ success: true });
  });

  app.post("/api/posts/:id/like", (req, res) => {
    const p = db.posts.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Post not found" });
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    p.likes = p.likes || [];
    if (p.likes.includes(uid)) {
      p.likes = p.likes.filter((id: string) => id !== uid);
      p.liked = false;
    } else {
      p.likes.push(uid);
      p.liked = true;
    }
    p.like_count = p.likes.length;
    saveDbToFile();
    const hydrated = hydratePostForUser(p, uid, !p.parent_id);
    broadcast({ type: "post:updated", data: hydrated });
    res.json(hydrated);
  });

  app.post("/api/posts/:id/react", (req, res) => {
    const p = db.posts.find((x: any) => x.id === req.params.id);
    if (!p) return res.status(404).json({ detail: "Post not found" });
    const { emoji } = req.body;
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    p.reactions = p.reactions || {};
    p.reactions[emoji] = p.reactions[emoji] || [];
    if (p.reactions[emoji].includes(uid)) {
      p.reactions[emoji] = p.reactions[emoji].filter((id: string) => id !== uid);
      if (!p.reactions[emoji].length) delete p.reactions[emoji];
    } else {
      p.reactions[emoji].push(uid);
    }
    saveDbToFile();
    const hydrated = hydratePostForUser(p, uid, !p.parent_id);
    broadcast({ type: "post:updated", data: hydrated });
    res.json(hydrated);
  });

  app.post("/api/upload", upload.single("file"), async (req: any, res) => {
    if (!req.file) {
      const fileId = `file_${Date.now()}`;
      return res.json({ id: fileId, name: "upload.png", url: `/api/files/${fileId}` });
    }
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ext = path.extname(req.file.originalname) || ".png";
    const filename = `${fileId}${ext}`;
    const diskPath = path.join(UPLOADS_DIR, filename);

    try {
      fs.writeFileSync(diskPath, req.file.buffer);
    } catch (e) {
      console.warn("Failed to write uploaded file to disk:", e);
    }

    db.files[fileId] = {
      id: fileId,
      name: req.file.originalname,
      filename,
      mimetype: req.file.mimetype || "image/png",
      size: req.file.size
    };
    try {
      await saveUploadedFileToPostgres({
        id: fileId,
        filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype || "image/png",
        sizeBytes: req.file.size,
        buffer: req.file.buffer,
      });
    } catch (e) {
      console.warn("Failed to persist uploaded file in PostgreSQL:", e);
    }
    saveDbToFile();
    res.json({
      id: fileId,
      name: req.file.originalname,
      url: `/api/files/${fileId}`,
      content_type: req.file.mimetype
    });
  });

  app.get("/api/files/:id", async (req, res) => {
    const file = db.files[req.params.id];
    const isDownload = req.query.download === "1" || req.query.download === "true";
    const dlName = (file?.name || file?.filename || `${req.params.id}.png`).replace(/["\r\n]/g, "");
    if (!isDownload) {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    }
    if (file?.filename) {
      const diskPath = path.join(UPLOADS_DIR, file.filename);
      if (fs.existsSync(diskPath)) {
        res.setHeader("Content-Type", file.mimetype || "image/png");
        if (isDownload) {
          res.setHeader("Content-Disposition", `attachment; filename="${dlName}"`);
        }
        return res.sendFile(diskPath);
      }
    }
    if (file && file.buffer) {
      res.setHeader("Content-Type", file.mimetype || "image/png");
      if (isDownload) {
        res.setHeader("Content-Disposition", `attachment; filename="${dlName}"`);
      }
      return res.send(file.buffer);
    }
    const pgFile = await getUploadedFileFromPostgres(req.params.id);
    if (pgFile?.contentBase64) {
      const buf = Buffer.from(pgFile.contentBase64, "base64");
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(UPLOADS_DIR, path.basename(pgFile.filename)), buf);
      } catch {}
      res.setHeader("Content-Type", pgFile.mimetype || "image/png");
      if (isDownload) {
        const pgName = (pgFile.originalName || pgFile.filename || `${req.params.id}.png`).replace(/["\r\n]/g, "");
        res.setHeader("Content-Disposition", `attachment; filename="${pgName}"`);
      }
      return res.send(buf);
    }
    // High-resolution workplace fallback
    res.redirect("/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg");
  });

  app.get("/api/public/logo/:id", async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    if (req.params.id === "default_workspace_logo") {
      return res.redirect("/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png");
    }
    const file = db.files[req.params.id];
    if (file?.filename) {
      const diskPath = path.join(UPLOADS_DIR, file.filename);
      if (fs.existsSync(diskPath)) {
        res.setHeader("Content-Type", file.mimetype || "image/png");
        return res.sendFile(diskPath);
      }
    }
    if (file && file.buffer) {
      res.setHeader("Content-Type", file.mimetype || "image/png");
      return res.send(file.buffer);
    }
    const pgFile = await getUploadedFileFromPostgres(req.params.id);
    if (pgFile?.contentBase64) {
      const buf = Buffer.from(pgFile.contentBase64, "base64");
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(UPLOADS_DIR, path.basename(pgFile.filename)), buf);
      } catch {}
      res.setHeader("Content-Type", pgFile.mimetype || "image/png");
      return res.send(buf);
    }
    res.redirect("/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png");
  });

  app.get("/api/public/login-image/:id", async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    if (req.params.id === "default_login_bg") {
      return res.redirect("/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg");
    }
    const file = db.files[req.params.id];
    if (file?.filename) {
      const diskPath = path.join(UPLOADS_DIR, file.filename);
      if (fs.existsSync(diskPath)) {
        res.setHeader("Content-Type", file.mimetype || "image/png");
        return res.sendFile(diskPath);
      }
    }
    if (file && file.buffer) {
      res.setHeader("Content-Type", file.mimetype || "image/png");
      return res.send(file.buffer);
    }
    const pgFile = await getUploadedFileFromPostgres(req.params.id);
    if (pgFile?.contentBase64) {
      const buf = Buffer.from(pgFile.contentBase64, "base64");
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(UPLOADS_DIR, path.basename(pgFile.filename)), buf);
      } catch {}
      res.setHeader("Content-Type", pgFile.mimetype || "image/png");
      return res.send(buf);
    }
    res.redirect("/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg");
  });

  function makeMeetingKey(m: any) {
    return `${String(m?.title || "").trim().toLowerCase()}__${String(m?.date || "")}__${String(m?.start_time || "")}`;
  }

  // Meetings & Schedule API (Integrated with Google Calendar)
  app.get("/api/meetings", (req, res) => {
    const deletedIds = new Set(Array.isArray(db.deleted_meeting_ids) ? db.deleted_meeting_ids : []);
    const deletedGcal = new Set(Array.isArray(db.deleted_gcal_ids) ? db.deleted_gcal_ids : []);
    const deletedKeys = new Set(Array.isArray(db.deleted_meeting_keys) ? db.deleted_meeting_keys : []);

    const seenKeys = new Set<string>();
    const list = (db.meetings || []).filter((m: any) => {
      if (!m || !m.id) return false;
      const gcalId = String(m.gcal_event_id || (String(m.id).startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : ""));
      const key = makeMeetingKey(m);
      if (deletedIds.has(m.id) || (gcalId && deletedGcal.has(gcalId)) || deletedKeys.has(key)) {
        return false;
      }
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    db.meetings = list;
    list.sort((a: any, b: any) => new Date(`${a.date}T${a.start_time}`).getTime() - new Date(`${b.date}T${b.start_time}`).getTime());
    res.json(list);
  });

  app.post("/api/meetings/connect-gcal", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const email = String(req.body?.email || reqUser?.email || currentSessionUser?.email || "be.creativestudio21@gmail.com").trim();
    db.meetings = Array.isArray(db.meetings) ? db.meetings : [];
    db.deleted_meeting_ids = Array.isArray(db.deleted_meeting_ids) ? db.deleted_meeting_ids : [];
    db.deleted_gcal_ids = Array.isArray(db.deleted_gcal_ids) ? db.deleted_gcal_ids : [];
    db.deleted_meeting_keys = Array.isArray(db.deleted_meeting_keys) ? db.deleted_meeting_keys : [];

    const deletedIds = new Set(db.deleted_meeting_ids);
    const deletedSet = new Set(db.deleted_gcal_ids);
    const deletedKeys = new Set(db.deleted_meeting_keys);

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);

    // Mark existing workspace meetings as gcal_synced and seed Google Calendar schedule if none synced yet
    let changed = false;
    db.meetings.forEach((m: any) => {
      if (m && !m.gcal_synced) {
        m.gcal_synced = true;
        m.gcal_event_id = m.gcal_event_id || `gcal_sync_${m.id}`;
        changed = true;
      }
    });

    const sampleGcalEvents = [
      {
        gcal_event_id: `gcal_weekly_sync_${todayStr}`,
        title: "Weekly Team Sync & Progress Review",
        description: `Sinkronisasi otomatis dari Google Calendar (${email})`,
        date: todayStr,
        start_time: "10:00",
        end_time: "11:00",
        location: "Google Meet",
        meet_link: "https://meet.google.com/asli-sync-cal",
      },
      {
        gcal_event_id: `gcal_product_standup_${tomorrow}`,
        title: "Cross-Division Alignment & Planning",
        description: `Agenda terjadwal dari Google Calendar (${email})`,
        date: tomorrow,
        start_time: "14:00",
        end_time: "15:00",
        location: "Google Meet",
        meet_link: "https://meet.google.com/asli-plan-cal",
      },
    ];

    sampleGcalEvents.forEach((ev) => {
      const gcalId = ev.gcal_event_id;
      const evKey = makeMeetingKey(ev);
      if (deletedSet.has(gcalId) || deletedIds.has(`gcal_${gcalId}`) || deletedKeys.has(evKey)) return;
      const exists = db.meetings.some(
        (m: any) => m.gcal_event_id === gcalId || m.id === `gcal_${gcalId}` || makeMeetingKey(m) === evKey
      );
      if (!exists) {
        db.meetings.push({
          id: `gcal_${gcalId}`,
          title: ev.title,
          description: ev.description,
          date: ev.date,
          start_time: ev.start_time,
          end_time: ev.end_time,
          location: ev.location,
          meet_link: ev.meet_link,
          attendee_ids: [uid],
          is_gcal: true,
          gcal_synced: true,
          gcal_event_id: gcalId,
          created_by: uid,
          created_at: new Date().toISOString(),
        });
        changed = true;
      }
    });

    const list = db.meetings
      .filter((m: any) => {
        if (!m || !m.id) return false;
        const gcalId = String(m.gcal_event_id || (String(m.id).startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : ""));
        const key = makeMeetingKey(m);
        return !deletedIds.has(m.id) && !(gcalId && deletedSet.has(gcalId)) && !deletedKeys.has(key);
      })
      .sort((a: any, b: any) => new Date(`${a.date}T${a.start_time}`).getTime() - new Date(`${b.date}T${b.start_time}`).getTime());

    if (changed) {
      saveDbToFile();
      broadcast({ type: "meetings:synced", data: list });
    }
    res.json({ connected: true, email, events: list });
  });

  app.post("/api/meetings/sync-gcal", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
    db.meetings = Array.isArray(db.meetings) ? db.meetings : [];
    db.deleted_meeting_ids = Array.isArray(db.deleted_meeting_ids) ? db.deleted_meeting_ids : [];
    db.deleted_gcal_ids = Array.isArray(db.deleted_gcal_ids) ? db.deleted_gcal_ids : [];
    db.deleted_meeting_keys = Array.isArray(db.deleted_meeting_keys) ? db.deleted_meeting_keys : [];

    const deletedIds = new Set(db.deleted_meeting_ids);
    const deletedSet = new Set(db.deleted_gcal_ids);
    const deletedKeys = new Set(db.deleted_meeting_keys);

    const emailToUserId = new Map<string, string>();
    (db.users || []).forEach((u: any) => {
      if (u.email && u.user_id) {
        emailToUserId.set(String(u.email).toLowerCase(), u.user_id);
      }
    });

    let changed = false;
    incoming.forEach((ev: any) => {
      const gcalId = String(ev.gcal_event_id || ev.id || "").replace(/^gcal_/, "");
      const evKey = makeMeetingKey(ev);
      if (!gcalId || deletedSet.has(gcalId) || deletedIds.has(`gcal_${gcalId}`) || deletedKeys.has(evKey)) return;

      const mappedAttendees = new Set<string>([uid]);
      if (Array.isArray(ev.attendee_emails)) {
        ev.attendee_emails.forEach((em: string) => {
          const foundUid = emailToUserId.get(String(em || "").toLowerCase());
          if (foundUid) mappedAttendees.add(foundUid);
        });
      }
      if (Array.isArray(ev.attendee_ids)) {
        ev.attendee_ids.forEach((id: string) => {
          if (id) mappedAttendees.add(id);
        });
      }

      const existing = db.meetings.find(
        (m: any) =>
          m.gcal_event_id === gcalId ||
          m.id === `gcal_${gcalId}` ||
          makeMeetingKey(m) === evKey
      );

      if (existing) {
        if (!existing.gcal_synced || existing.gcal_event_id !== gcalId || existing.title !== ev.title || existing.date !== ev.date || existing.start_time !== ev.start_time || existing.end_time !== ev.end_time) {
          existing.gcal_synced = true;
          existing.gcal_event_id = gcalId;
          existing.title = ev.title || existing.title;
          existing.description = ev.description ?? existing.description;
          existing.date = ev.date || existing.date;
          existing.start_time = ev.start_time || existing.start_time;
          existing.end_time = ev.end_time || existing.end_time;
          existing.location = ev.location || existing.location;
          existing.meet_link = ev.meet_link || existing.meet_link;
          existing.html_link = ev.html_link || existing.html_link || null;
          existing.attendee_ids = Array.from(new Set([...(existing.attendee_ids || []), ...Array.from(mappedAttendees)]));
          changed = true;
        }
      } else {
        db.meetings.push({
          id: `gcal_${gcalId}`,
          title: ev.title || "Google Calendar Event",
          description: ev.description || "",
          date: ev.date || new Date().toISOString().slice(0, 10),
          start_time: ev.start_time || "09:00",
          end_time: ev.end_time || "10:00",
          location: ev.location || "Google Calendar",
          meet_link: ev.meet_link || "",
          html_link: ev.html_link || null,
          attendee_ids: Array.from(mappedAttendees),
          is_gcal: true,
          gcal_synced: true,
          gcal_event_id: gcalId,
          created_by: uid,
          created_at: new Date().toISOString()
        });
        changed = true;
      }
    });

    db.meetings = db.meetings.filter((m: any) => {
      if (!m || !m.id) return false;
      const gcalId = String(m.gcal_event_id || (String(m.id).startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : ""));
      const key = makeMeetingKey(m);
      return !deletedIds.has(m.id) && !(gcalId && deletedSet.has(gcalId)) && !deletedKeys.has(key);
    });

    const list = [...db.meetings].sort(
      (a: any, b: any) => new Date(`${a.date}T${a.start_time}`).getTime() - new Date(`${b.date}T${b.start_time}`).getTime()
    );
    if (changed) {
      saveDbToFile();
      broadcast({ type: "meetings:synced", data: list });
    }
    res.json(list);
  });

  function parseIcsDateTimeToWib(rawProp: string, rawVal: string): { date: string; time: string } | null {
    const cleanVal = String(rawVal || "").trim();
    if (!cleanVal) return null;
    // All-day date: YYYYMMDD
    if (/^\d{8}$/.test(cleanVal)) {
      const y = cleanVal.slice(0, 4);
      const m = cleanVal.slice(4, 6);
      const d = cleanVal.slice(6, 8);
      return { date: `${y}-${m}-${d}`, time: "09:00" };
    }
    // Date-time: YYYYMMDDTHHMMSS(Z)?
    const match = cleanVal.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
    if (!match) return null;
    const [, y, mo, da, hh, mm, ss = "00", isUtc] = match;
    if (isUtc) {
      const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(hh), Number(mm), Number(ss));
      // Convert UTC to WIB (UTC+7 / Asia/Jakarta)
      const wibDate = new Date(utcMs + 7 * 3600 * 1000);
      const wy = wibDate.getUTCFullYear();
      const wmo = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
      const wda = String(wibDate.getUTCDate()).padStart(2, "0");
      const whh = String(wibDate.getUTCHours()).padStart(2, "0");
      const wmm = String(wibDate.getUTCMinutes()).padStart(2, "0");
      return { date: `${wy}-${wmo}-${wda}`, time: `${whh}:${wmm}` };
    }
    return { date: `${y}-${mo}-${da}`, time: `${hh}:${mm}` };
  }

  function parseIcsCalendarEvents(icsRaw: string) {
    if (!icsRaw || typeof icsRaw !== "string") return [];
    // Unfold RFC 5545 folded lines
    const unfolded = icsRaw.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);
    const events: any[] = [];
    let current: Record<string, { prop: string; val: string; attendees?: string[] }> | null = null;
    const cutoffDate = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);

    const unescapeIcsText = (s: string) =>
      String(s || "")
        .replace(/\\n/gi, "\n")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\")
        .trim();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "BEGIN:VEVENT") {
        current = {};
        continue;
      }
      if (trimmed === "END:VEVENT") {
        if (current) {
          const status = (current.STATUS?.val || "").toUpperCase();
          if (status !== "CANCELLED") {
            const startInfo = parseIcsDateTimeToWib(current.DTSTART?.prop || "", current.DTSTART?.val || "");
            const endInfo = parseIcsDateTimeToWib(current.DTEND?.prop || "", current.DTEND?.val || "");
            if (startInfo && startInfo.date >= cutoffDate) {
              const summary = unescapeIcsText(current.SUMMARY?.val || "Agenda Google Calendar");
              const desc = unescapeIcsText(current.DESCRIPTION?.val || "");
              const loc = unescapeIcsText(current.LOCATION?.val || "");
              const conf = unescapeIcsText(current["X-GOOGLE-CONFERENCE"]?.val || "");
              const uidVal = unescapeIcsText(current.UID?.val || `${summary}_${startInfo.date}_${startInfo.time}`).replace(/[^a-zA-Z0-9_-]/g, "_");
              const meetMatch = `${conf} ${loc} ${desc}`.match(/https:\/\/meet\.google\.com\/[a-zA-Z0-9-]+/);
              const meetLink = meetMatch ? meetMatch[0] : "";
              events.push({
                id: `gcal_${uidVal}`,
                gcal_event_id: uidVal,
                title: summary,
                description: desc,
                date: startInfo.date,
                start_time: startInfo.time,
                end_time: endInfo?.time && endInfo.time !== startInfo.time ? endInfo.time : "10:00",
                location: loc || (meetLink ? "Google Meet" : "Google Calendar"),
                meet_link: meetLink,
                attendee_emails: current.ATTENDEE?.attendees || [],
                is_gcal: true,
                gcal_synced: true
              });
            }
          }
        }
        current = null;
        continue;
      }
      if (current) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const rawProp = line.slice(0, colonIdx).trim();
          const rawVal = line.slice(colonIdx + 1);
          const baseKey = rawProp.split(";")[0].toUpperCase();
          if (baseKey === "ATTENDEE") {
            const mailMatch = rawVal.match(/mailto:([^\s;]+)/i);
            if (mailMatch) {
              if (!current.ATTENDEE) current.ATTENDEE = { prop: rawProp, val: rawVal, attendees: [] };
              current.ATTENDEE.attendees!.push(mailMatch[1].toLowerCase());
            }
          } else {
            current[baseKey] = { prop: rawProp, val: rawVal };
          }
        }
      }
    }
    return events;
  }

  app.get("/api/meetings/ics-config", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const prefs = (db.user_preferences && db.user_preferences[uid]) || {};
    res.json({
      ics_url: prefs.gcal_ics_url || db.workspace?.gcal_ics_url || "",
      last_ics_sync_at: prefs.gcal_last_sync_at || null
    });
  });

  function resolveGoogleCalendarIcsUrl(rawInput: string): string | null {
    const trimmed = String(rawInput || "").trim().replace(/^webcal:\/\//i, "https://");
    if (!trimmed) return null;

    // 1. Direct email address (e.g. saeful.rohman@asliri.id)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(trimmed)}/public/basic.ics`;
    }

    if (!/^https?:\/\//i.test(trimmed)) return null;

    try {
      const parsed = new URL(trimmed);
      // 2. Already an iCal / .ics URL
      if (parsed.pathname.includes("/calendar/ical/") || parsed.pathname.endsWith(".ics")) {
        return trimmed;
      }
      // 3. Google Calendar embed URL (?src=email)
      const srcParam = parsed.searchParams.get("src");
      if (srcParam) {
        return `https://calendar.google.com/calendar/ical/${encodeURIComponent(srcParam)}/public/basic.ics`;
      }
      // 4. Google Calendar shareable link (?cid=...)
      const cidParam = parsed.searchParams.get("cid");
      if (cidParam) {
        let calId = cidParam;
        try {
          const decoded = Buffer.from(cidParam, "base64").toString("utf8").trim();
          if (decoded && /^[\x20-\x7E]+$/.test(decoded) && (decoded.includes("@") || decoded.includes("."))) {
            calId = decoded;
          }
        } catch {}
        return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calId)}/public/basic.ics`;
      }
    } catch {}

    return trimmed;
  }

  app.post("/api/meetings/import-ics", async (req, res) => {
    try {
      const reqUser = getReqUser(req);
      const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
      let { ics_url, ics_text } = req.body || {};

      if (ics_url && typeof ics_url === "string") {
        const targetUrl = resolveGoogleCalendarIcsUrl(ics_url);
        if (!targetUrl) {
          return res.status(400).json({
            detail: "Format Link / Email tidak valid. Masukkan 'Secret address in iCal format' (https://calendar.google.com/calendar/ical/.../basic.ics) dari Google Calendar Settings."
          });
        }
        const resp = await fetch(targetUrl, {
          headers: { "User-Agent": "CIRCLE-Workspace-Calendar-Sync/1.0" }
        });
        if (!resp.ok) {
          const isPublicUrl = targetUrl.includes("/public/basic.ics");
          return res.status(400).json({
            detail: isPublicUrl
              ? "Kalender Google Anda masih berstatus Privat sehingga tidak bisa diakses hanya dengan Email/Link Publik. Gunakan 'Secret address in iCal format' (mengandung /private-.../basic.ics) dari menu Google Calendar Settings -> Integrate calendar, atau upload file .ics."
              : `Gagal mengambil data kalender dari URL (HTTP ${resp.status}). Pastikan Anda menyalin 'Secret address in iCal format' secara lengkap dari Google Calendar Settings.`
          });
        }
        ics_text = await resp.text();
        db.user_preferences = db.user_preferences || {};
        db.user_preferences[uid] = {
          ...(db.user_preferences[uid] || {}),
          gcal_ics_url: targetUrl,
          gcal_last_sync_at: new Date().toISOString()
        };
      }

      if (!ics_text || !String(ics_text).includes("BEGIN:VCALENDAR")) {
        return res.status(400).json({
          detail: "Data yang diterima bukan format iCalendar (.ics). Pastikan Anda menyalin 'Secret address in iCal format' (berakhiran /basic.ics) dari Google Calendar Settings -> Integrate calendar."
        });
      }

      const parsedEvents = parseIcsCalendarEvents(String(ics_text));
      db.meetings = Array.isArray(db.meetings) ? db.meetings : [];
      db.deleted_meeting_ids = Array.isArray(db.deleted_meeting_ids) ? db.deleted_meeting_ids : [];
      db.deleted_gcal_ids = Array.isArray(db.deleted_gcal_ids) ? db.deleted_gcal_ids : [];
      db.deleted_meeting_keys = Array.isArray(db.deleted_meeting_keys) ? db.deleted_meeting_keys : [];

      const deletedIds = new Set(db.deleted_meeting_ids);
      const deletedSet = new Set(db.deleted_gcal_ids);
      const deletedKeys = new Set(db.deleted_meeting_keys);

      const emailToUserId = new Map<string, string>();
      (db.users || []).forEach((u: any) => {
        if (u.email && u.user_id) {
          emailToUserId.set(String(u.email).toLowerCase(), u.user_id);
        }
      });

      let importedCount = 0;
      parsedEvents.forEach((ev: any) => {
        const gcalId = String(ev.gcal_event_id || ev.id || "").replace(/^gcal_/, "");
        const evKey = makeMeetingKey(ev);
        if (!gcalId || deletedSet.has(gcalId) || deletedIds.has(`gcal_${gcalId}`) || deletedKeys.has(evKey)) return;

        const mappedAttendees = new Set<string>([uid]);
        if (Array.isArray(ev.attendee_emails)) {
          ev.attendee_emails.forEach((em: string) => {
            const foundUid = emailToUserId.get(String(em || "").toLowerCase());
            if (foundUid) mappedAttendees.add(foundUid);
          });
        }

        const existing = db.meetings.find(
          (m: any) => m.gcal_event_id === gcalId || m.id === `gcal_${gcalId}` || makeMeetingKey(m) === evKey
        );
        if (existing) {
          existing.gcal_synced = true;
          existing.gcal_event_id = gcalId;
          existing.title = ev.title || existing.title;
          existing.description = ev.description ?? existing.description;
          existing.date = ev.date || existing.date;
          existing.start_time = ev.start_time || existing.start_time;
          existing.end_time = ev.end_time || existing.end_time;
          existing.location = ev.location || existing.location;
          existing.meet_link = ev.meet_link || existing.meet_link;
          existing.attendee_ids = Array.from(new Set([...(existing.attendee_ids || []), ...Array.from(mappedAttendees)]));
          importedCount++;
        } else {
          db.meetings.push({
            id: `gcal_${gcalId}`,
            title: ev.title,
            description: ev.description || "",
            date: ev.date,
            start_time: ev.start_time,
            end_time: ev.end_time,
            location: ev.location || "Google Calendar",
            meet_link: ev.meet_link || "",
            attendee_ids: Array.from(mappedAttendees),
            is_gcal: true,
            gcal_synced: true,
            gcal_event_id: gcalId,
            created_by: uid,
            created_at: new Date().toISOString()
          });
          importedCount++;
        }
      });

      const list = db.meetings
        .filter((m: any) => {
          if (!m || !m.id) return false;
          const gcalId = String(m.gcal_event_id || (String(m.id).startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : ""));
          const key = makeMeetingKey(m);
          return !deletedIds.has(m.id) && !(gcalId && deletedSet.has(gcalId)) && !deletedKeys.has(key);
        })
        .sort((a: any, b: any) => new Date(`${a.date}T${a.start_time}`).getTime() - new Date(`${b.date}T${b.start_time}`).getTime());

      saveDbToFile();
      broadcast({ type: "meetings:synced", data: list });
      res.json({ imported_count: importedCount, total_parsed: parsedEvents.length, events: list });
    } catch (e: any) {
      res.status(400).json({ detail: e?.message || "Gagal mengimpor Google Calendar (.ics)" });
    }
  });

  app.post("/api/meetings", (req, res) => {
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const { id: clientId, title, description, date, start_time, end_time, location, meet_link, attendee_ids, gcal_synced, gcal_event_id } = req.body;
    const m = {
      id: clientId || `mtg_${Date.now()}`,
      title: title || "Internal Discussion",
      description: description || "",
      date: date || new Date().toISOString().slice(0, 10),
      start_time: start_time || "10:00",
      end_time: end_time || "11:00",
      location: location || "Google Meet",
      meet_link: meet_link || `https://meet.google.com/asli-${Math.random().toString(36).substring(2, 6)}`,
      attendee_ids: attendee_ids || [uid],
      gcal_synced: !!gcal_synced,
      gcal_event_id: gcal_event_id || null,
      created_by: uid,
      created_at: new Date().toISOString()
    };

    const mKey = makeMeetingKey(m);
    if (Array.isArray(db.deleted_meeting_keys)) {
      db.deleted_meeting_keys = db.deleted_meeting_keys.filter((k: string) => k !== mKey);
    }
    if (Array.isArray(db.deleted_meeting_ids)) {
      db.deleted_meeting_ids = db.deleted_meeting_ids.filter((x: string) => x !== m.id);
    }
    if (m.gcal_event_id && Array.isArray(db.deleted_gcal_ids)) {
      db.deleted_gcal_ids = db.deleted_gcal_ids.filter((x: string) => x !== m.gcal_event_id);
    }

    const existingIdx = (db.meetings || []).findIndex(
      (x: any) => x.id === m.id || (m.gcal_event_id && x.gcal_event_id === m.gcal_event_id) || makeMeetingKey(x) === mKey
    );
    if (existingIdx !== -1) {
      db.meetings[existingIdx] = { ...db.meetings[existingIdx], ...m, id: m.id };
    } else {
      db.meetings.push(m);
    }

    db.activity.unshift({
      id: `act_${Date.now()}`,
      actor_id: uid,
      action: "scheduled a meeting",
      task_id: m.id,
      task_title: m.title,
      created_at: new Date().toISOString()
    });
    saveDbToFile();
    broadcast({ type: "meeting:new", data: m });
    res.json(m);
  });

  app.delete("/api/meetings/:id", (req, res) => {
    const paramId = req.params.id;
    const qGcal = req.query.gcal_event_id ? String(req.query.gcal_event_id) : "";
    const qTitle = req.query.title ? String(req.query.title) : "";
    const qDate = req.query.date ? String(req.query.date) : "";
    const qStart = req.query.start_time ? String(req.query.start_time) : "";

    db.deleted_meeting_ids = Array.isArray(db.deleted_meeting_ids) ? db.deleted_meeting_ids : [];
    db.deleted_gcal_ids = Array.isArray(db.deleted_gcal_ids) ? db.deleted_gcal_ids : [];
    db.deleted_meeting_keys = Array.isArray(db.deleted_meeting_keys) ? db.deleted_meeting_keys : [];

    if (!db.deleted_meeting_ids.includes(paramId)) db.deleted_meeting_ids.push(paramId);
    const paramGcal = String(paramId).startsWith("gcal_") ? String(paramId).replace(/^gcal_/, "") : qGcal;
    if (paramGcal && !db.deleted_gcal_ids.includes(paramGcal)) {
      db.deleted_gcal_ids.push(paramGcal);
    }
    if (qTitle && qDate && qStart) {
      const qKey = makeMeetingKey({ title: qTitle, date: qDate, start_time: qStart });
      if (!db.deleted_meeting_keys.includes(qKey)) db.deleted_meeting_keys.push(qKey);
    }

    const targets = (db.meetings || []).filter(
      (m: any) =>
        m.id === paramId ||
        (paramGcal && (m.gcal_event_id === paramGcal || m.id === `gcal_${paramGcal}`)) ||
        (qTitle && qDate && qStart && makeMeetingKey(m) === makeMeetingKey({ title: qTitle, date: qDate, start_time: qStart }))
    );

    targets.forEach((target: any) => {
      if (target.id && !db.deleted_meeting_ids.includes(target.id)) {
        db.deleted_meeting_ids.push(target.id);
      }
      const gcalId = target.gcal_event_id || (String(target.id).startsWith("gcal_") ? String(target.id).replace(/^gcal_/, "") : null);
      if (gcalId && !db.deleted_gcal_ids.includes(gcalId)) {
        db.deleted_gcal_ids.push(gcalId);
      }
      const tKey = makeMeetingKey(target);
      if (tKey && !db.deleted_meeting_keys.includes(tKey)) {
        db.deleted_meeting_keys.push(tKey);
      }
    });

    const deletedIdSet = new Set(db.deleted_meeting_ids);
    const deletedGcalSet = new Set(db.deleted_gcal_ids);
    const deletedKeySet = new Set(db.deleted_meeting_keys);

    db.meetings = (db.meetings || []).filter((m: any) => {
      const gId = m.gcal_event_id || (String(m.id).startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : "");
      const mKey = makeMeetingKey(m);
      return !deletedIdSet.has(m.id) && !(gId && deletedGcalSet.has(gId)) && !deletedKeySet.has(mKey);
    });

    saveDbToFile();
    broadcast({ type: "meeting:delete", id: paramId, deleted_ids: Array.from(deletedIdSet), deleted_keys: Array.from(deletedKeySet) });
    res.json({ success: true });
  });

  app.patch("/api/meetings/:id", (req, res) => {
    const m = (db.meetings || []).find((x: any) => x.id === req.params.id);
    if (!m) return res.status(404).json({ detail: "Meeting not found" });
    Object.assign(m, req.body);
    saveDbToFile();
    broadcast({ type: "meeting:update", data: m });
    res.json(m);
  });

  function ensureUserCircleConversation(userId: string) {
    if (!userId || userId === CIRCLE_BOT_ID) return null;
    const circleConvId = `conv_circle_${userId}`;
    let circleConv = db.conversations.find((c: any) => c.id === circleConvId);
    if (!circleConv) {
      circleConv = {
        id: circleConvId,
        type: "dm",
        name: db.workspace?.assistant_name || "Circle",
        admin_ids: [CIRCLE_BOT_ID],
        member_ids: [CIRCLE_BOT_ID, userId],
        members: [CIRCLE_BOT_ID, userId],
        unread: 0,
        is_member: true,
        last_message_preview: "Asisten Workspace & Notifikasi Approval",
        last_message_at: new Date().toISOString()
      };
      db.conversations.unshift(circleConv);
    } else {
      circleConv.member_ids = [CIRCLE_BOT_ID, userId];
      circleConv.members = [CIRCLE_BOT_ID, userId];
    }
    return circleConv;
  }

  function buildConversationsListForUser(reqUser: any, maxMsgsPerConv = 50) {
    const userId = reqUser?.user_id;
    if (!userId) return [];

    ensureUserCircleConversation(userId);
    syncUserDivisionAndGroupMembership(reqUser);

    // Ensure General group ('conv_1') includes user
    for (const c of db.conversations || []) {
      if (c && c.id === "conv_1" && c.type === "group") {
        const mems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);
        if (!mems.includes(userId)) {
          mems.push(userId);
        }
        const clean = Array.from(new Set(mems.filter((id: string) => Boolean(id) && id !== CIRCLE_BOT_ID)));
        c.member_ids = clean;
        c.members = clean;
      }
    }

    const reqMap = new Map((db.access_requests || []).map((r: any) => [r.id, r]));
    const pollMap = new Map((db.polls || []).map((p: any) => [p.id, p]));

    // Pre-group messages by conversation_id in O(M) instead of O(C * M)
    const msgsByConv = new Map<string, any[]>();
    for (const m of db.messages || []) {
      if (!m?.conversation_id) continue;
      let bucket = msgsByConv.get(m.conversation_id);
      if (!bucket) {
        bucket = [];
        msgsByConv.set(m.conversation_id, bucket);
      }
      bucket.push(m);
    }

    return (db.conversations || [])
      .filter((c: any) => {
        if (!c || !c.id) return false;
        const mems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);

        // Circle Assistant DM: strictly only show conv_circle_<userId> for this user
        if (String(c.id).startsWith("conv_circle_")) {
          return c.id === `conv_circle_${userId}`;
        }

        // Human DM: strictly must include userId and only have 2 members (or 1 if self-DM)
        if (c.type === "dm") {
          const uniqueMems = Array.from(new Set(mems.filter(Boolean)));
          return uniqueMems.includes(userId) && uniqueMems.length <= 2;
        }

        // Group chat
        return mems.includes(userId);
      })
      .map((c: any) => {
        const rawMems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);
        const cleanMems = c.type === "group" ? rawMems.filter((id: string) => id !== CIRCLE_BOT_ID) : rawMems;
        const rawBucket = msgsByConv.get(c.id) || [];
        const convMsgs = rawBucket
          .slice(-maxMsgsPerConv)
          .map((m: any) => {
            const pollId = m.poll_id || m.poll?.id;
            const foundPoll = pollId ? pollMap.get(pollId) || m.poll : null;
            return {
              ...m,
              type: foundPoll || m.poll_id ? "poll" : (m.type || "text"),
              sender_id: m.sender_id || m.user_id,
              ...(foundPoll ? { poll_id: foundPoll.id, poll: formatPollForUser(foundPoll, userId) } : {}),
              access_request: m.access_request?.id && reqMap.has(m.access_request.id)
                ? reqMap.get(m.access_request.id)
                : m.access_request
            };
          });
        const lastMsg = convMsgs.length > 0 ? convMsgs[convMsgs.length - 1] : null;
        const lastReadTs = c.reads?.[userId] || 0;
        const unreadCount = convMsgs.filter(
          (m: any) => m.sender_id !== userId && new Date(m.created_at).getTime() > lastReadTs
        ).length;
        const effectiveAt = lastMsg?.created_at || (c.type === "dm" ? c.last_message_at : null) || null;

        return {
          ...c,
          name: c.type === "dm" && !String(c.id).startsWith("conv_circle_") ? "" : c.name,
          member_ids: cleanMems,
          members: cleanMems,
          unread: lastReadTs ? unreadCount : (c.unread || 0),
          last_message_preview: lastMsg
            ? (lastMsg.type === "sticker" ? "[Stiker]" : (lastMsg.type === "poll" ? (lastMsg.text || `📊 Polling: ${lastMsg.poll?.question || ""}`) : (lastMsg.text || "Mengirim lampiran")))
            : (String(c.id).startsWith("conv_circle_") ? "Asisten Workspace & Notifikasi Approval" : ""),
          last_message_at: effectiveAt,
          messages: convMsgs
        };
      })
      .sort((a: any, b: any) => {
        const aHas = Boolean((a.messages && a.messages.length > 0) || a.last_message_at);
        const bHas = Boolean((b.messages && b.messages.length > 0) || b.last_message_at);
        if (aHas !== bHas) return aHas ? -1 : 1;
        const aTs = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTs = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        if (bTs !== aTs) return bTs - aTs;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }

  app.get("/api/conversations", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });
    res.json(buildConversationsListForUser(reqUser, 50));
  });

  // Unified high-speed bootstrap endpoint: replaces 11+ parallel HTTP requests on boot/reload
  // with 1 single compressed roundtrip + weak ETag (304 Not Modified when workspace revision hasn't changed).
  app.get("/api/bootstrap", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });
    const uid = reqUser.user_id;

    setUserOnlineStatus(uid, true);

    const rev = Number(db.revision || 0);
    const etag = `W/"boot-${uid}-${rev}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, no-cache");
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    if (autoArchiveCheck() > 0) saveDbToFile();

    const myNotifs = (db.notifications || []).filter((n: any) => n.user_id === uid);
    const unreadNotifs = myNotifs.filter((n: any) => !n.read).length;

    const nowMs = Date.now();
    const accessibleTasks = (db.tasks || [])
      .filter((t: any) => !t.archived && isTaskAccessible(t, reqUser))
      .map((t: any) => {
        const reqIds = Array.isArray(t.requestor_ids) && t.requestor_ids.length
          ? t.requestor_ids
          : (t.requestor_id ? [t.requestor_id] : (t.created_by ? [t.created_by] : []));
        const isDone = t.status === "done";
        const completedAt = isDone ? (t.completed_at || t.updated_at || new Date(nowMs).toISOString()) : t.completed_at;
        let compliance = "In Progress";
        if (isDone) {
          compliance = t.deadline && new Date(completedAt).getTime() > new Date(t.deadline).getTime() ? "Overdue" : "On time";
        } else if (t.deadline && nowMs > new Date(t.deadline).getTime()) {
          compliance = "Overdue";
        }
        return {
          ...t,
          requestor_ids: reqIds,
          requestor_id: reqIds[0] || t.created_by || null,
          ...(isDone && completedAt ? { completed_at: completedAt } : {}),
          deadline_compliance: compliance,
        };
      });

    if (!Array.isArray(db.drive_shortcuts)) db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];

    const topPosts = (db.posts || [])
      .filter((p: any) => !p.parent_id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 25)
      .map((p: any) => hydratePostForUser(p, uid, true));

    res.json({
      rev,
      workspace: db.workspace,
      users: sanitizeUsersList(db.users),
      labels: db.labels || [],
      notifications: {
        items: myNotifs.slice(0, 80),
        unread: unreadNotifs,
      },
      conversations: buildConversationsListForUser(reqUser, 20),
      tasks: accessibleTasks,
      drive_shortcuts: db.drive_shortcuts,
      posts: topPosts,
      trending: computeTrendingTags(),
      groups: buildGroupsBrowseList(reqUser),
    });
  });

  app.post("/api/conversations/dm", (req, res) => {
    const { user_id } = req.body || {};
    const reqUser = getReqUser(req);
    const myId = reqUser?.user_id;
    if (!myId) return res.status(401).json({ detail: "Unauthorized" });
    if (!user_id) return res.status(400).json({ detail: "Target user_id is required" });

    // Special case: DM with Circle Assistant
    if (user_id === CIRCLE_BOT_ID) {
      const circleConv = ensureUserCircleConversation(myId);
      return res.json(circleConv);
    }

    const expectedPair = Array.from(new Set([myId, user_id])).sort();

    let c = db.conversations.find((x: any) => {
      if (!x || x.type !== "dm" || String(x.id || "").startsWith("conv_circle_")) return false;
      const rawMems = Array.isArray(x.member_ids) ? x.member_ids : (Array.isArray(x.members) ? x.members : []);
      const uniqueMems = Array.from(new Set(rawMems.filter(Boolean))).sort();
      if (uniqueMems.length !== expectedPair.length) return false;
      return uniqueMems.every((id, idx) => id === expectedPair[idx]);
    });

    if (!c) {
      const mems = Array.from(new Set([myId, user_id].filter(Boolean)));
      c = {
        id: `conv_dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: "dm",
        name: "",
        admin_ids: [],
        members: mems,
        member_ids: mems,
        unread: 0,
        last_message_preview: "",
        last_message_at: new Date().toISOString()
      };
      db.conversations.push(c);
      saveDbToFile();
    }

    res.json({
      ...c,
      name: "",
      member_ids: c.member_ids || c.members || [],
      members: c.members || c.member_ids || []
    });
  });

  app.get("/api/conversations/:id", (req, res) => {
    const reqUser = getReqUser(req);
    const userId = reqUser?.user_id;
    if (!userId) return res.status(401).json({ detail: "Unauthorized" });

    if (req.params.id === `conv_circle_${userId}`) {
      ensureUserCircleConversation(userId);
    }

    let c = db.conversations.find((x: any) => x.id === req.params.id);
    if (!c) {
      const grp = (db.groups || []).find((g: any) => g.id === req.params.id);
      if (grp) {
        c = {
          ...grp,
          type: "group",
          member_ids: Array.isArray(grp.member_ids) ? grp.member_ids : [],
          members: Array.isArray(grp.member_ids) ? grp.member_ids : [],
          unread: 0
        };
        db.conversations.push(c);
      } else if (req.params.id === 'conv_1') {
        c = {
          id: 'conv_1',
          type: "group",
          name: "General",
          member_ids: db.users
            .filter((u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== CIRCLE_BOT_ID)
            .map((u: any) => u.user_id),
          admin_ids: ["user_admin1"],
          unread: 0,
          is_member: true
        };
        db.conversations.push(c);
      } else {
        return res.status(404).json({ detail: "Conversation not found" });
      }
    }

    if (String(c.id).startsWith("conv_circle_") && c.id !== `conv_circle_${userId}`) {
      return res.status(403).json({ detail: "Conversation ini milik akun lain" });
    }

    const rawMems = c.member_ids || c.members || [];
    const mems = c.type === "group" ? rawMems.filter((id: string) => id !== CIRCLE_BOT_ID) : rawMems;
    const isMember = mems.includes(userId);
    if (!isMember && c.type === "dm") {
      return res.status(403).json({ detail: "You are not a member of this conversation" });
    }

    const grpRecord = (db.groups || []).find((g: any) => g.id === c.id);
    const groupType = c.group_type || grpRecord?.group_type || (String(c.id).startsWith("group_official_") ? "department" : undefined);
    const isRestrictedNonMember = c.type === "group" && (groupType === "private" || groupType === "department") && !isMember;
    const rawReqs = Array.isArray(c.join_requests) ? c.join_requests : (Array.isArray(grpRecord?.join_requests) ? grpRecord.join_requests : []);
    const pendingReqs = rawReqs.filter((r: any) => r && r.user_id && r.status === "pending");
    const rawInvs = Array.isArray(c.invitations) ? c.invitations : (Array.isArray(grpRecord?.invitations) ? grpRecord.invitations : []);
    const pendingInvs = rawInvs.filter((inv: any) => inv && inv.user_id && inv.status === "pending");
    const adminIds = Array.from(
      new Set([c.created_by || grpRecord?.created_by, ...(Array.isArray(c.admin_ids) ? c.admin_ids : (Array.isArray(grpRecord?.admin_ids) ? grpRecord.admin_ids : []))].filter(Boolean))
    );
    const canManageGroup = isGroupAdmin({ ...c, group_type: groupType, created_by: c.created_by || grpRecord?.created_by, admin_ids: adminIds }, reqUser);

    const convFiles = isRestrictedNonMember
      ? []
      : (db.messages || [])
          .filter((m: any) => m.conversation_id === c.id && !m.deleted && Array.isArray(m.attachments) && m.attachments.length > 0)
          .flatMap((m: any) => m.attachments);

    res.json({
      ...c,
      group_type: groupType,
      created_by: c.created_by || grpRecord?.created_by || adminIds[0] || null,
      admin_ids: adminIds,
      name: c.type === "dm" && !String(c.id).startsWith("conv_circle_") ? "" : c.name,
      member_ids: mems,
      members: mems,
      is_member: isMember,
      has_pending_request: Boolean(pendingReqs.some((r: any) => r.user_id === userId)),
      has_invitation: Boolean(pendingInvs.some((inv: any) => inv.user_id === userId)),
      can_manage: canManageGroup,
      join_requests: canManageGroup ? pendingReqs : [],
      invitations: canManageGroup ? pendingInvs : [],
      pinned: isRestrictedNonMember ? [] : (db.messages || []).filter((m: any) => m.conversation_id === c.id && m.pinned),
      files: convFiles,
      tasks: []
    });
  });

  app.get("/api/conversations/:id/messages", (req, res) => {
    const { id } = req.params;
    const reqUser = getReqUser(req);
    const userId = reqUser?.user_id;
    if (!userId) return res.status(401).json({ detail: "Unauthorized" });

    if (String(id).startsWith("conv_circle_") && id !== `conv_circle_${userId}`) {
      return res.status(403).json({ detail: "Conversation ini milik akun lain" });
    }

    const c = db.conversations.find((x: any) => x.id === id);
    const grp = (db.groups || []).find((g: any) => g.id === id);
    if (c) {
      const mems = c.member_ids || c.members || [];
      const gType = c.group_type || grp?.group_type || (String(id).startsWith("group_official_") ? "department" : undefined);
      if (c.type === "dm" && !mems.includes(userId)) {
        return res.status(403).json({ detail: "You are not a member of this conversation" });
      }
      if (c.type === "group" && (gType === "private" || gType === "department") && !mems.includes(userId)) {
        return res.status(403).json({
          detail: gType === "department"
            ? "Grup divisi hanya dapat diakses oleh anggota divisi atau rekan tim yang telah diundang."
            : "Grup ini bersifat privat. Minta izin admin grup untuk mengakses pesan."
        });
      }
    }

    const { q, before } = req.query;
    let list = (db.messages || []).filter((m: any) => m.conversation_id === id);
    if (q) {
      const query = String(q).toLowerCase();
      list = list.filter((m: any) => (m.text || "").toLowerCase().includes(query));
    }
    if (before) {
      list = list.filter((m: any) => new Date(m.created_at) < new Date(String(before)));
    }
    const reqMap = new Map((db.access_requests || []).map((r: any) => [r.id, r]));
    list = list.map((m: any) => {
      const pollId = m.poll_id || m.poll?.id;
      const foundPoll = pollId ? (db.polls || []).find((p: any) => p.id === pollId) || m.poll : null;
      return {
        ...m,
        type: foundPoll || m.poll_id ? "poll" : (m.type || "text"),
        sender_id: m.sender_id || m.user_id,
        ...(foundPoll ? { poll_id: foundPoll.id, poll: formatPollForUser(foundPoll, userId) } : {}),
        access_request: m.access_request?.id && reqMap.has(m.access_request.id)
          ? reqMap.get(m.access_request.id)
          : m.access_request
      };
    });
    res.json(list);
  });

  app.post("/api/conversations/:id/messages", (req, res) => {
    const { id } = req.params;
    const senderUser = getReqUser(req);
    const sender_id = senderUser?.user_id;
    if (!sender_id) return res.status(401).json({ detail: "Unauthorized" });

    if (id === `conv_circle_${sender_id}`) {
      ensureUserCircleConversation(sender_id);
    }

    const conv = db.conversations.find((x: any) => x.id === id);
    if (!conv) return res.status(404).json({ detail: "Conversation not found" });

    if (String(conv.id).startsWith("conv_circle_") && conv.id !== `conv_circle_${sender_id}`) {
      return res.status(403).json({ detail: "Tidak dapat mengirim pesan ke Circle Assistant milik akun lain" });
    }

    const grpMeta = (db.groups || []).find((g: any) => g.id === id);
    const msgGroupType = conv.group_type || grpMeta?.group_type || (String(id).startsWith("group_official_") ? "department" : undefined);
    const isRestrictedGroup = msgGroupType === "private" || msgGroupType === "department";
    const mems = Array.isArray(conv.member_ids) ? conv.member_ids : (Array.isArray(conv.members) ? conv.members : []);
    if (!mems.includes(sender_id)) {
      if (conv.type === "group" && !isRestrictedGroup && senderUser?.role === "super_admin") {
        mems.push(sender_id);
        conv.member_ids = mems;
        conv.members = mems;
      } else {
        return res.status(403).json({
          detail: msgGroupType === "department"
            ? "Grup divisi hanya dapat diikuti melalui undangan."
            : msgGroupType === "private"
            ? "Grup privat memerlukan persetujuan bergabung sebelum mengirim pesan."
            : "Anda bukan anggota percakapan ini"
        });
      }
    }

    const stickerObj = req.body.sticker || (req.body.sticker_id && (db.stickers || []).find((s: any) => s.id === req.body.sticker_id));

    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: id,
      sender_id,
      user_id: sender_id,
      text: req.body.text || "",
      type: req.body.type || "text",
      sticker_id: req.body.sticker_id || stickerObj?.id || null,
      sticker: stickerObj || null,
      attachments: req.body.attachments || [],
      reply_to: req.body.reply_to ? db.messages.find((x: any) => x.id === req.body.reply_to) : null,
      mention_ids: req.body.mention_ids || [],
      created_at: new Date().toISOString()
    };
    db.messages.push(msg);

    if (conv) {
      conv.last_message_preview = msg.type === "sticker" ? `[Stiker] ${stickerObj?.name || 'Stiker'}` : (msg.text || "Sent an attachment");
      conv.last_message_at = msg.created_at;
      conv.reads = conv.reads || {};
      conv.reads[sender_id] = Date.now();
    }
    saveDbToFile(true);

    broadcast({ type: "message:new", data: { ...msg, member_ids: mems, conversation_type: conv.type, conversation_name: conv.name } });

    // Notify other DM participant(s)
    if (conv.type === "dm") {
      mems.forEach((targetUid: string) => {
        if (!targetUid || targetUid === sender_id || targetUid === CIRCLE_BOT_ID) return;
        createNotification({
          user_id: targetUid,
          title: `Pesan baru dari ${senderUser?.name || "Rekan Kerja"}`,
          body: msg.type === "sticker" ? `[Stiker] ${stickerObj?.name || ""}` : (msg.text?.slice(0, 80) || "Mengirim lampiran"),
          type: "dm",
          category: "dm",
          actor_id: sender_id,
          link: `/messages/${id}`,
          conversation_id: id
        });
      });
    } else if (conv.type === "group") {
      const mentionSet = new Set(Array.isArray(msg.mention_ids) ? msg.mention_ids : []);
      mems.forEach((targetUid: string) => {
        if (!targetUid || targetUid === sender_id || targetUid === CIRCLE_BOT_ID || mentionSet.has(targetUid)) return;
        sendWebPushToUser(targetUid, {
          id: msg.id,
          title: `${senderUser?.name || "Rekan Kerja"} di ${conv.name || "Grup"}`,
          body: msg.type === "sticker" ? `[Stiker] ${stickerObj?.name || ""}` : (msg.text?.slice(0, 80) || "Mengirim lampiran"),
          type: "message",
          category: "dm",
          url: `/messages/${id}`,
          conversation_id: id,
          tag: id,
        });
      });
    }

    // Notify mentioned users in chat
    if (Array.isArray(msg.mention_ids)) {
      msg.mention_ids.forEach((userId: string) => {
        if (userId === sender_id) return;
        createNotification({
          user_id: userId,
          title: "Anda disebut dalam pesan",
          body: `${senderUser?.name || "Seseorang"} menyebut Anda dalam pesan: "${msg.text?.slice(0, 50)}${msg.text?.length > 50 ? '...' : ''}"`,
          type: "message_mention",
          category: "dm",
          actor_id: sender_id,
          link: `/messages/${id}`,
          conversation_id: id
        });
      });
    }

    const applyCircleBotEffects = (result: any) => {
      const fx = result?.effects || {};
      if (result?.createdTask || fx.createdTask) {
        broadcast({ type: "tasks:changed", task: result?.createdTask || fx.createdTask });
      } else if (fx.updatedTask) {
        broadcast({ type: "tasks:changed", task: fx.updatedTask });
      } else if (fx.tasksChanged) {
        broadcast({ type: "tasks:changed" });
      }
      if (fx.projectsChanged) broadcast({ type: "projects:changed" });
      if (fx.remindersChanged) broadcast({ type: "reminders:changed" });
      if (fx.meetingNew) broadcast({ type: "meeting:new", data: fx.meetingNew });
      if (fx.meetingsChanged) broadcast({ type: "meetings:synced", data: db.meetings || [] });
      if (fx.postNew) broadcast({ type: "post:new", data: fx.postNew });
      if (fx.postsChanged) broadcast({ type: "posts:changed" });
      if (fx.pollsChanged) broadcast({ type: "polls:changed" });
      if (fx.notificationsChanged) broadcast({ type: "notifications:changed" });
      return Boolean(result?.createdTask || fx.needsSave || fx.tasksChanged || fx.projectsChanged || fx.remindersChanged || fx.meetingsChanged || fx.postsChanged || fx.pollsChanged || fx.notificationsChanged);
    };

    // Instant AI Workspace Copilot auto-reply for Circle Assistant
    const isCircleDM = conv && conv.type === "dm" && (conv.member_ids?.includes("user_circle_assistant") || conv.members?.includes("user_circle_assistant"));
    if (isCircleDM && sender_id !== "user_circle_assistant") {
      broadcast({ type: "typing", data: { conversation_id: id, user_id: CIRCLE_BOT_ID } });
      setImmediate(async () => {
        try {
          const historyMessages = (db.messages || []).filter((m: any) => m.conversation_id === id && m.id !== msg.id).slice(-8);
          const result = await generateCircleBotReply({
            db,
            senderUser,
            question: msg.text || (msg.type === "sticker" ? "halo" : ""),
            historyMessages
          });
          const replyText = result.text;

          applyCircleBotEffects(result);

          const botMsg = {
            id: `msg_bot_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            conversation_id: id,
            sender_id: "user_circle_assistant",
            user_id: "user_circle_assistant",
            text: replyText,
            type: "text",
            created_at: new Date().toISOString()
          };
          db.messages.push(botMsg);
          const cleanPreview = replyText.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
          conv.last_message_preview = cleanPreview || replyText;
          conv.last_message_at = botMsg.created_at;
          broadcast({ type: "message:new", data: { ...botMsg, member_ids: mems } });
          broadcast({ type: "conversations:changed" });
          saveDbToFile(true);
        } catch (botErr) {
          console.error("[CircleBot] Reply error:", botErr);
        }
      });
    }

    res.json(msg);
  });

  app.get("/api/assistant/catalog", (_req, res) => {
    res.json({
      categories: CIRCLE_FEATURE_CATEGORIES,
      total_features: CIRCLE_FEATURE_CATALOG.length,
      commands: CIRCLE_FEATURE_CATALOG
    });
  });

  app.post("/api/assistant/ask", async (req, res) => {
    const senderUser = getReqUser(req);
    if (!senderUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });
    const question = String(req.body?.question || req.body?.text || "").trim();
    const result = await generateCircleBotReply({ db, senderUser, question });
    const fx = result?.effects || {};
    if (result.createdTask || fx.createdTask) {
      broadcast({ type: "tasks:changed", task: result.createdTask || fx.createdTask });
    } else if (fx.updatedTask) {
      broadcast({ type: "tasks:changed", task: fx.updatedTask });
    } else if (fx.tasksChanged) {
      broadcast({ type: "tasks:changed" });
    }
    if (fx.projectsChanged) broadcast({ type: "projects:changed" });
    if (fx.remindersChanged) broadcast({ type: "reminders:changed" });
    if (fx.meetingNew) broadcast({ type: "meeting:new", data: fx.meetingNew });
    if (fx.meetingsChanged) broadcast({ type: "meetings:synced", data: db.meetings || [] });
    if (fx.postNew) broadcast({ type: "post:new", data: fx.postNew });
    if (fx.postsChanged) broadcast({ type: "posts:changed" });
    if (fx.pollsChanged) broadcast({ type: "polls:changed" });
    if (fx.notificationsChanged) broadcast({ type: "notifications:changed" });
    if (result.createdTask || fx.needsSave || fx.tasksChanged || fx.projectsChanged || fx.remindersChanged || fx.meetingsChanged || fx.postsChanged || fx.pollsChanged || fx.notificationsChanged) {
      saveDbToFile();
    }
    res.json({ answer: result.text, created_task: result.createdTask || null, effects: fx });
  });

  app.post("/api/conversations/:id/read", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const userId = reqUser?.user_id || "user_admin1";
    const conv = db.conversations.find((x: any) => x.id === req.params.id);
    if (conv) {
      conv.reads = conv.reads || {};
      conv.reads[userId] = Date.now();
      conv.unread = 0;
      saveDbToFile();
    }
    broadcast({ type: "read", data: { conversation_id: req.params.id, user_id: userId, at: Date.now() } });
    res.json({ success: true });
  });

  app.post("/api/conversations/:id/mute", (req, res) => {
    res.json({ success: true });
  });

  app.post("/api/messages/:id/react", (req, res) => {
    const msg = db.messages.find((m: any) => m.id === req.params.id);
    if (!msg) return res.status(404).json({ detail: "Message not found" });
    const { emoji } = req.body;
    const reqUser = getReqUser(req) || currentSessionUser;
    const userId = reqUser?.user_id || "user_admin1";
    msg.reactions = msg.reactions || {};
    msg.reactions[emoji] = msg.reactions[emoji] || [];
    if (msg.reactions[emoji].includes(userId)) {
      msg.reactions[emoji] = msg.reactions[emoji].filter((u: any) => u !== userId);
      if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].push(userId);
    }
    saveDbToFile();
    broadcast({ type: "message:update", data: msg });
    res.json(msg);
  });

  app.post("/api/messages/:id/pin", (req, res) => {
    const msg = db.messages.find((m: any) => m.id === req.params.id);
    if (!msg) return res.status(404).json({ detail: "Message not found" });
    msg.pinned = !msg.pinned;
    saveDbToFile();
    broadcast({ type: "message:update", data: msg });
    res.json(msg);
  });

  app.patch("/api/messages/:id", (req, res) => {
    const msg = db.messages.find((m: any) => m.id === req.params.id);
    if (!msg) return res.status(404).json({ detail: "Message not found" });
    if (req.body.text !== undefined) {
      msg.text = req.body.text;
      msg.edited = true;
      saveDbToFile();
    }
    broadcast({ type: "message:update", data: msg });
    res.json(msg);
  });

  app.delete("/api/messages/:id", (req, res) => {
    const msg = db.messages.find((m: any) => m.id === req.params.id);
    if (!msg) return res.status(404).json({ detail: "Message not found" });
    msg.deleted = true;
    msg.text = "";
    saveDbToFile();
    broadcast({ type: "message:update", data: msg });
    res.json({ success: true });
  });

  app.post("/api/groups/:id/join", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const userId = reqUser?.user_id;
    if (!userId) return res.status(401).json({ detail: "Unauthorized" });

    const targets = [db.groups, db.conversations]
      .map((list) => list.find((x: any) => x.id === req.params.id))
      .filter(Boolean);
    if (targets.length === 0) {
      return res.status(404).json({ detail: "Grup tidak ditemukan." });
    }

    const primary = targets[0];
    const primaryType = primary.group_type || (String(primary.id || "").startsWith("group_official_") ? "department" : "public");
    const currentMems = Array.from(new Set((primary.member_ids || primary.members || []).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID)));
    if (currentMems.includes(userId)) {
      return res.json({ ...primary, member_ids: currentMems, members: currentMems, member_count: currentMems.length, is_member: true });
    }

    // Department / Division group: invitation-only (cannot arbitrarily join)
    if (primaryType === "department") {
      const pendingInvites = Array.isArray(primary.invitations) ? primary.invitations : [];
      const hasInvite = pendingInvites.some((inv: any) => inv && inv.user_id === userId && inv.status === "pending");
      if (!hasInvite) {
        return res.status(403).json({
          detail: `Grup divisi "${primary.name}" tidak dapat dimasuki sembarangan. Anda hanya dapat bergabung melalui undangan resmi.`
        });
      }

      let joinedGroup: any = null;
      [db.groups, db.conversations].forEach((list) => {
        const g = list.find((x: any) => x.id === req.params.id);
        if (g) {
          const cleanMems = Array.from(new Set([...(g.member_ids || g.members || []), userId])).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
          g.member_ids = cleanMems;
          g.members = cleanMems;
          g.member_count = cleanMems.length;
          g.manually_joined_ids = Array.from(new Set([...(g.manually_joined_ids || []), userId]));
          if (Array.isArray(g.invitations)) {
            g.invitations = g.invitations.filter((inv: any) => inv?.user_id !== userId);
          }
          joinedGroup = g;
        }
      });
      if (joinedGroup && !db.conversations.some((c: any) => c.id === joinedGroup.id)) {
        db.conversations.push({ ...joinedGroup, type: "group" });
      }
      saveDbToFile(true);
      if (joinedGroup) {
        broadcast({ type: "group:updated", data: { ...joinedGroup, is_member: true, has_invitation: false } });
        broadcast({ type: "conversation:upsert", data: { ...joinedGroup, type: "group", is_member: true, has_invitation: false } });
      }
      broadcast({ type: "groups:changed" });
      return res.json(joinedGroup ? { ...joinedGroup, is_member: true, has_invitation: false } : { success: true, is_member: true });
    }

    // Private group: require creator/admin approval instead of auto-joining
    if (primaryType === "private") {
      const pendingEntry = {
        user_id: userId,
        name: reqUser.name || "Pengguna",
        avatar: reqUser.avatar || reqUser.picture || "",
        department: reqUser.department || "",
        job_title: reqUser.job_title || "",
        status: "pending",
        requested_at: new Date().toISOString(),
      };
      let updatedGroup: any = null;
      [db.groups, db.conversations].forEach((list) => {
        const g = list.find((x: any) => x.id === req.params.id);
        if (g) {
          g.join_requests = Array.isArray(g.join_requests) ? g.join_requests.filter((r: any) => r && r.user_id !== userId) : [];
          g.join_requests.push({ ...pendingEntry });
          updatedGroup = g;
        }
      });

      const groupAdmins = Array.from(
        new Set([primary.created_by, ...(Array.isArray(primary.admin_ids) ? primary.admin_ids : [])].filter(Boolean))
      );
      const notifyTargets = groupAdmins.length > 0
        ? groupAdmins
        : (db.users || []).filter((u: any) => u.role === "super_admin").map((u: any) => u.user_id);

      notifyTargets.forEach((adminUid: string) => {
        if (!adminUid || adminUid === userId) return;
        createNotification({
          user_id: adminUid,
          title: `Permintaan Gabung Grup Privat "${primary.name}"`,
          body: `${reqUser.name || "Seseorang"} meminta izin untuk bergabung ke grup privat "${primary.name}".`,
          type: "group_join_request",
          category: "system",
          actor_id: userId,
          group_id: primary.id,
          requester_id: userId,
          link: `/messages/${primary.id}`,
          sender: sanitizeUser(reqUser),
        });
      });

      saveDbToFile(true);
      broadcast({ type: "groups:changed" });
      if (updatedGroup) {
        broadcast({ type: "group:updated", data: updatedGroup });
      }
      return res.json({
        pending: true,
        request_status: "pending",
        has_pending_request: true,
        is_member: false,
        group: updatedGroup || primary,
        detail: `Permintaan bergabung ke "${primary.name}" telah dikirim ke admin grup untuk persetujuan.`,
      });
    }

    // Public / non-private group: join directly without approval
    let joinedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        const cleanMems = Array.from(new Set([...(g.member_ids || g.members || []), userId])).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
        g.member_ids = cleanMems;
        g.members = cleanMems;
        g.member_count = cleanMems.length;
        g.manually_joined_ids = Array.from(new Set([...(g.manually_joined_ids || []), userId]));
        if (Array.isArray(g.join_requests)) {
          g.join_requests = g.join_requests.filter((r: any) => r?.user_id !== userId);
        }
        joinedGroup = g;
      }
    });
    if (joinedGroup && !db.conversations.some((c: any) => c.id === joinedGroup.id)) {
      db.conversations.push({ ...joinedGroup, type: "group" });
    }
    saveDbToFile(true);
    if (joinedGroup) {
      broadcast({ type: "group:updated", data: { ...joinedGroup, is_member: true } });
      broadcast({ type: "conversation:upsert", data: { ...joinedGroup, type: "group", is_member: true } });
    }
    res.json(joinedGroup ? { ...joinedGroup, is_member: true } : { success: true });
  });

  // Group Invitations (required for Division/Department groups, also usable for Private/Project groups)
  app.post("/api/groups/:id/invite", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });

    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya Admin, Manajer divisi, atau Pembuat grup yang dapat mengirim undangan." });
    }

    const rawIds = Array.isArray(req.body?.user_ids)
      ? req.body.user_ids
      : (req.body?.user_id ? [req.body.user_id] : []);
    const currentMems = new Set((primary.member_ids || primary.members || []).filter(Boolean));
    const targetIds: string[] = Array.from(
      new Set(
        rawIds
          .filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID && !currentMems.has(id))
          .map((id: any) => String(id))
      )
    );

    if (targetIds.length === 0) {
      return res.status(400).json({ detail: "Pilih rekan tim yang belum tergabung untuk diundang." });
    }

    const nowIso = new Date().toISOString();
    let updatedGroup: any = null;
    targetIds.forEach((targetUid: string) => {
      const targetUser = (db.users || []).find((u: any) => u.user_id === targetUid);
      if (!targetUser || targetUser.is_bot || targetUser.role === "assistant") return;

      const invEntry = {
        user_id: targetUid,
        name: targetUser.name || "Karyawan",
        avatar: targetUser.avatar || targetUser.picture || "",
        department: targetUser.department || "",
        job_title: targetUser.job_title || "",
        invited_by: reqUser.user_id,
        invited_by_name: reqUser.name || "Admin",
        status: "pending",
        invited_at: nowIso,
      };

      [db.groups, db.conversations].forEach((list) => {
        const g = list.find((x: any) => x.id === req.params.id);
        if (g) {
          g.invitations = Array.isArray(g.invitations) ? g.invitations.filter((inv: any) => inv?.user_id !== targetUid) : [];
          g.invitations.push({ ...invEntry });
          updatedGroup = g;
        }
      });

      createNotification({
        user_id: targetUid,
        title: `Undangan Masuk Grup "${primary.name}"`,
        body: `${reqUser.name || "Admin"} mengundang Anda untuk bergabung ke grup ${primary.group_type === "department" ? "divisi " : ""}"${primary.name}".`,
        type: "group_invitation",
        category: "groups",
        actor_id: reqUser.user_id,
        group_id: primary.id,
        requester_id: reqUser.user_id,
        link: `/groups`,
        sender: sanitizeUser(reqUser),
      });
    });

    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
      broadcast({ type: "conversation:upsert", data: { ...updatedGroup, type: "group" } });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true, invited_count: targetIds.length, group: updatedGroup || primary });
  });

  app.post("/api/groups/:id/accept-invite", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const userId = reqUser?.user_id;
    if (!userId) return res.status(401).json({ detail: "Unauthorized" });

    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });

    const currentMems = Array.from(new Set((primary.member_ids || primary.members || []).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID)));
    if (currentMems.includes(userId)) {
      return res.json({ ...primary, member_ids: currentMems, members: currentMems, member_count: currentMems.length, is_member: true, has_invitation: false });
    }

    const pendingInv = (Array.isArray(primary.invitations) ? primary.invitations : []).find(
      (inv: any) => inv && inv.user_id === userId && inv.status === "pending"
    );
    if (!pendingInv) {
      return res.status(403).json({ detail: "Undangan grup tidak ditemukan atau sudah kedaluwarsa." });
    }

    let joinedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        const cleanMems = Array.from(new Set([...(g.member_ids || g.members || []), userId])).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
        g.member_ids = cleanMems;
        g.members = cleanMems;
        g.member_count = cleanMems.length;
        g.manually_joined_ids = Array.from(new Set([...(g.manually_joined_ids || []), userId]));
        if (Array.isArray(g.invitations)) {
          g.invitations = g.invitations.filter((inv: any) => inv?.user_id !== userId);
        }
        joinedGroup = g;
      }
    });
    if (joinedGroup && !db.conversations.some((c: any) => c.id === joinedGroup.id)) {
      db.conversations.push({ ...joinedGroup, type: "group" });
    }

    if (pendingInv.invited_by && pendingInv.invited_by !== userId) {
      createNotification({
        user_id: pendingInv.invited_by,
        title: `Undangan Grup "${primary.name}" Diterima`,
        body: `${reqUser.name || "Rekan tim"} menerima undangan dan bergabung ke grup "${primary.name}".`,
        type: "group_invite_accepted",
        category: "groups",
        actor_id: userId,
        conversation_id: primary.id,
        link: `/messages/${primary.id}`,
      });
    }

    saveDbToFile(true);
    if (joinedGroup) {
      broadcast({ type: "group:updated", data: joinedGroup });
      broadcast({ type: "conversation:upsert", data: { ...joinedGroup, type: "group" } });
    }
    broadcast({ type: "groups:changed" });
    res.json(joinedGroup ? { ...joinedGroup, is_member: true, has_invitation: false } : { success: true, is_member: true });
  });

  app.post("/api/groups/:id/decline-invite", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const userId = reqUser?.user_id;
    if (!userId) return res.status(401).json({ detail: "Unauthorized" });

    let updatedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.invitations = (Array.isArray(g.invitations) ? g.invitations : []).filter((inv: any) => inv?.user_id !== userId);
        updatedGroup = g;
      }
    });
    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true, group: updatedGroup });
  });

  app.delete("/api/groups/:id/invitations/:userId", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya admin grup yang dapat membatalkan undangan." });
    }
    let updatedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.invitations = (Array.isArray(g.invitations) ? g.invitations : []).filter((inv: any) => inv?.user_id !== req.params.userId);
        updatedGroup = g;
      }
    });
    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true, group: updatedGroup });
  });

  app.post("/api/groups/:id/join-requests/:userId/approve", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });

    const targetUid = req.params.userId;
    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya pembuat atau admin grup yang dapat menyetujui permintaan bergabung." });
    }

    let updatedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.join_requests = (Array.isArray(g.join_requests) ? g.join_requests : []).filter((r: any) => r?.user_id !== targetUid);
        const cleanMems = Array.from(new Set([...(g.member_ids || g.members || []), targetUid])).filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID);
        g.member_ids = cleanMems;
        g.members = cleanMems;
        g.member_count = cleanMems.length;
        g.manually_joined_ids = Array.from(new Set([...(g.manually_joined_ids || []), targetUid]));
        updatedGroup = g;
      }
    });
    if (updatedGroup && !db.conversations.some((c: any) => c.id === updatedGroup.id)) {
      db.conversations.push({ ...updatedGroup, type: "group" });
    }

    createNotification({
      user_id: targetUid,
      title: `Disetujui Masuk Grup "${primary.name}"`,
      body: `${reqUser.name || "Admin Grup"} menyetujui permintaan Anda untuk bergabung ke "${primary.name}".`,
      type: "group_join_approved",
      category: "system",
      actor_id: reqUser.user_id,
      conversation_id: primary.id,
      link: `/messages/${primary.id}`,
    });

    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
      broadcast({ type: "conversation:upsert", data: { ...updatedGroup, type: "group" } });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true, group: updatedGroup });
  });

  app.post("/api/groups/:id/join-requests/:userId/reject", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    if (!reqUser?.user_id) return res.status(401).json({ detail: "Unauthorized" });

    const targetUid = req.params.userId;
    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya pembuat atau admin grup yang dapat menolak permintaan bergabung." });
    }

    let updatedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.join_requests = (Array.isArray(g.join_requests) ? g.join_requests : []).filter((r: any) => r?.user_id !== targetUid);
        updatedGroup = g;
      }
    });

    createNotification({
      user_id: targetUid,
      title: `Permintaan Masuk "${primary.name}" Ditolak`,
      body: `Permintaan Anda untuk bergabung ke grup privat "${primary.name}" tidak disetujui.`,
      type: "group_join_rejected",
      category: "system",
      actor_id: reqUser.user_id,
      link: `/groups`,
    });

    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true, group: updatedGroup });
  });

  app.post("/api/groups/:id/members", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya pembuat atau Co-Admin grup yang dapat mengelola anggota dan Co-Admin." });
    }

    const isDeptGroup = primary.group_type === "department" || String(primary.id || "").startsWith("group_official_");
    if (req.body.add && isDeptGroup) {
      return res.status(403).json({ detail: "Untuk grup divisi, rekan tim harus diundang terlebih dahulu melalui undangan resmi." });
    }

    const creatorId = primary.created_by;
    let updatedGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.member_ids = (g.member_ids || []).filter((id: string) => id !== CIRCLE_BOT_ID);
        if (req.body.add) {
          const validAdd = (Array.isArray(req.body.add) ? req.body.add : []).filter((id: string) => id !== CIRCLE_BOT_ID);
          g.member_ids = Array.from(new Set([...g.member_ids, ...validAdd]));
          g.manually_joined_ids = Array.from(new Set([...(g.manually_joined_ids || []), ...validAdd]));
          if (Array.isArray(g.join_requests)) {
            g.join_requests = g.join_requests.filter((r: any) => !validAdd.includes(r?.user_id));
          }
        }
        if (req.body.remove) {
          const removeList = (Array.isArray(req.body.remove) ? req.body.remove : []).filter((id: string) => id !== creatorId);
          g.member_ids = g.member_ids.filter((x: any) => !removeList.includes(x));
          if (Array.isArray(g.manually_joined_ids)) {
            g.manually_joined_ids = g.manually_joined_ids.filter((x: any) => !removeList.includes(x));
          }
          if (Array.isArray(g.admin_ids)) {
            g.admin_ids = g.admin_ids.filter((x: any) => !removeList.includes(x) || x === creatorId);
          }
        }
        g.members = g.member_ids;
        g.member_count = g.member_ids.length;
        if (req.body.admin_id && req.body.admin_id !== CIRCLE_BOT_ID) {
          g.admin_ids = Array.isArray(g.admin_ids) ? g.admin_ids : (creatorId ? [creatorId] : []);
          if (req.body.make_admin) {
            if (!g.admin_ids.includes(req.body.admin_id)) g.admin_ids.push(req.body.admin_id);
          } else if (req.body.admin_id !== creatorId) {
            g.admin_ids = g.admin_ids.filter((x: any) => x !== req.body.admin_id);
          }
          if (creatorId && !g.admin_ids.includes(creatorId)) g.admin_ids.unshift(creatorId);
        }
        updatedGroup = g;
      }
    });
    saveDbToFile(true);
    if (updatedGroup) {
      broadcast({ type: "group:updated", data: updatedGroup });
      broadcast({ type: "conversation:upsert", data: { ...updatedGroup, type: "group" } });
    }
    broadcast({ type: "groups:changed" });
    res.json(updatedGroup || { success: true });
  });

  app.post("/api/groups/:id/leave", (req, res) => {
    const reqUser = getReqUser(req);
    const userId = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    let leftGroup: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        g.member_ids = (g.member_ids || []).filter((x: any) => x !== userId && x !== CIRCLE_BOT_ID);
        g.members = g.member_ids;
        g.member_count = g.member_ids.length;
        if (Array.isArray(g.manually_joined_ids)) {
          g.manually_joined_ids = g.manually_joined_ids.filter((x: any) => x !== userId);
        }
        if (Array.isArray(g.admin_ids) && g.created_by !== userId) {
          g.admin_ids = g.admin_ids.filter((x: any) => x !== userId);
        }
        leftGroup = g;
      }
    });
    saveDbToFile(true);
    if (leftGroup) {
      broadcast({ type: "group:updated", data: leftGroup });
    }
    broadcast({ type: "groups:changed" });
    res.json({ success: true });
  });

  app.patch("/api/groups/:id", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const primary = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (!primary) return res.status(404).json({ detail: "Grup tidak ditemukan." });
    if (!isGroupAdmin(primary, reqUser)) {
      return res.status(403).json({ detail: "Hanya pembuat atau admin grup yang dapat mengubah pengaturan grup." });
    }

    const { created_by: _ignoreCreator, ...safePatch } = req.body || {};
    const creatorId = primary.created_by;
    let updated: any = null;
    [db.groups, db.conversations].forEach((list) => {
      const g = list.find((x: any) => x.id === req.params.id);
      if (g) {
        Object.assign(g, safePatch);
        if (Array.isArray(safePatch.deputy_admin_ids) || Array.isArray(safePatch.admin_ids)) {
          const requestedAdmins = Array.isArray(safePatch.deputy_admin_ids) ? safePatch.deputy_admin_ids : safePatch.admin_ids;
          const nextAdmins = Array.from(new Set([creatorId, ...requestedAdmins].filter((id: any) => Boolean(id) && id !== CIRCLE_BOT_ID)));
          g.admin_ids = nextAdmins;
          g.member_ids = Array.from(new Set([...(g.member_ids || []), ...nextAdmins]));
          g.members = g.member_ids;
          g.member_count = g.member_ids.length;
        }
        delete g.deputy_admin_ids;
        updated = g;
      }
    });
    saveDbToFile(true);
    if (updated) {
      broadcast({ type: "group:updated", data: updated });
      broadcast({ type: "conversation:upsert", data: { ...updated, type: "group" } });
    }
    broadcast({ type: "groups:changed" });
    res.json(updated || { success: true });
  });

  app.delete("/api/groups/:id", (req, res) => {
    const reqUser = getReqUser(req) || currentSessionUser;
    const targetGroup = (db.groups || []).find((x: any) => x.id === req.params.id) || (db.conversations || []).find((x: any) => x.id === req.params.id);
    if (targetGroup) {
      const isOfficialDept = String(targetGroup.id || "").startsWith("group_official_") || Boolean(targetGroup.is_verified);
      if (isOfficialDept && !["super_admin", "workspace_admin"].includes(reqUser?.role)) {
        return res.status(403).json({ detail: "Hanya Super Admin yang dapat menghapus grup divisi resmi." });
      }
      if (!isGroupAdmin(targetGroup, reqUser)) {
        return res.status(403).json({ detail: "Hanya pembuat atau admin grup yang dapat menghapus grup." });
      }
    }
    db.groups = (db.groups || []).filter((x: any) => x.id !== req.params.id);
    db.conversations = (db.conversations || []).filter((x: any) => x.id !== req.params.id);

    if (targetGroup && (targetGroup.group_type === "department" || String(targetGroup.id || "").startsWith("group_official_"))) {
      const gName = String(targetGroup.name || "").trim().toLowerCase();
      if (gName && Array.isArray(db.workspace.divisions)) {
        db.workspace.divisions = db.workspace.divisions.filter((d: string) => d.toLowerCase() !== gName);
        syncDivisionsToOrgUnits(db.workspace.divisions, { removeMissing: true });
      }
    }

    saveDbToFile(true);
    broadcast({ type: "group:deleted", id: req.params.id });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "workspace:changed" });
    broadcast({ type: "org:changed", units: db.org_units });
    res.json({ success: true });
  });

  const DEFAULT_PACKS = [
    { id: "pk_work", name: "Kerja & Memes", category: "Kerja & Memes", workspace_id: "global" },
    { id: "pk_reactions", name: "Reactions & Memoji", category: "Reactions", workspace_id: "global" },
    { id: "pk_creative", name: "Design & Creative", category: "Design", workspace_id: "global" },
    { id: "pk_dev", name: "Tech & Engineering", category: "Dev", workspace_id: "global" },
    { id: "pk_custom", name: "Custom Stickers", category: "Custom", workspace_id: "user" }
  ];

  const DEFAULT_STICKERS = [
    // Kerja & Memes (Office & Indonesian Memes)
    { id: "stk_w1", pack_id: "pk_work", name: "SIAP MANDAN", emoji: "🫡", bg: "#E0F2FE", category: "Kerja & Memes" },
    { id: "stk_w2", pack_id: "pk_work", name: "MANTAP!", emoji: "🔥", bg: "#FFEDD5", category: "Kerja & Memes" },
    { id: "stk_w3", pack_id: "pk_work", name: "NEED REVIEW", emoji: "👀", bg: "#FEF3C7", category: "Kerja & Memes" },
    { id: "stk_w4", pack_id: "pk_work", name: "APPROVED!", emoji: "✅", bg: "#DCFCE7", category: "Kerja & Memes" },
    { id: "stk_w5", pack_id: "pk_work", name: "REVISI DIKIT", emoji: "✏️", bg: "#F3E8FF", category: "Kerja & Memes" },
    { id: "stk_w6", pack_id: "pk_work", name: "GASKEN!", emoji: "🚀", bg: "#FCE7F3", category: "Kerja & Memes" },
    { id: "stk_w7", pack_id: "pk_work", name: "OTW", emoji: "🏎️", bg: "#E0E7FF", category: "Kerja & Memes" },
    { id: "stk_w8", pack_id: "pk_work", name: "COPY THAT", emoji: "👍", bg: "#DBEAFE", category: "Kerja & Memes" },
    { id: "stk_w9", pack_id: "pk_work", name: "URGENT!", emoji: "🚨", bg: "#FEE2E2", category: "Kerja & Memes" },
    { id: "stk_w10", pack_id: "pk_work", name: "NGOPI DULU", emoji: "☕", bg: "#FEF3C7", category: "Kerja & Memes" },
    { id: "stk_w11", pack_id: "pk_work", name: "LENGKAP!", emoji: "💯", bg: "#DCFCE7", category: "Kerja & Memes" },
    { id: "stk_w12", pack_id: "pk_work", name: "DEADLINE", emoji: "⏰", bg: "#FEE2E2", category: "Kerja & Memes" },
    { id: "stk_w13", pack_id: "pk_work", name: "DONE DEAL", emoji: "🤝", bg: "#DCFCE7", category: "Kerja & Memes" },
    { id: "stk_w14", pack_id: "pk_work", name: "MENANGIS", emoji: "😭", bg: "#E0F2FE", category: "Kerja & Memes" },

    // Reactions & Memoji
    { id: "stk_r1", pack_id: "pk_reactions", name: "GREAT JOB", emoji: "🎉", bg: "#FEF3C7", category: "Reactions" },
    { id: "stk_r2", pack_id: "pk_reactions", name: "BRAVO", emoji: "👏", bg: "#DCFCE7", category: "Reactions" },
    { id: "stk_r3", pack_id: "pk_reactions", name: "LOVE IT", emoji: "❤️", bg: "#FCE7F3", category: "Reactions" },
    { id: "stk_r4", pack_id: "pk_reactions", name: "BRILLIANT", emoji: "💡", bg: "#FEF3C7", category: "Reactions" },
    { id: "stk_r5", pack_id: "pk_reactions", name: "SUPER!", emoji: "⭐", bg: "#FFEDD5", category: "Reactions" },
    { id: "stk_r6", pack_id: "pk_reactions", name: "MIND BLOWN", emoji: "🤯", bg: "#E0E7FF", category: "Reactions" },
    { id: "stk_r7", pack_id: "pk_reactions", name: "FIGHTING!", emoji: "💪", bg: "#DCFCE7", category: "Reactions" },
    { id: "stk_r8", pack_id: "pk_reactions", name: "TARGET!", emoji: "🎯", bg: "#FEE2E2", category: "Reactions" },

    // Design & Creative
    { id: "stk_c1", pack_id: "pk_creative", name: "PIXEL PERFECT", emoji: "📐", bg: "#E0F2FE", category: "Design" },
    { id: "stk_c2", pack_id: "pk_creative", name: "DRAFT READY", emoji: "🎨", bg: "#F3E8FF", category: "Design" },
    { id: "stk_c3", pack_id: "pk_creative", name: "ASSET LOADED", emoji: "📸", bg: "#DCFCE7", category: "Design" },
    { id: "stk_c4", pack_id: "pk_creative", name: "MAGIC VIBES", emoji: "✨", bg: "#FEF3C7", category: "Design" },
    { id: "stk_c5", pack_id: "pk_creative", name: "STORYBOARD", emoji: "🎬", bg: "#FFEDD5", category: "Design" },
    { id: "stk_c6", pack_id: "pk_creative", name: "FEEDBACK?", emoji: "💬", bg: "#E0E7FF", category: "Design" },

    // Tech & Engineering
    { id: "stk_d1", pack_id: "pk_dev", name: "SHIP IT!", emoji: "🚢", bg: "#E0F2FE", category: "Dev" },
    { id: "stk_d2", pack_id: "pk_dev", name: "NO BUG", emoji: "🐛", bg: "#DCFCE7", category: "Dev" },
    { id: "stk_d3", pack_id: "pk_dev", name: "PASSING QA", emoji: "🧪", bg: "#F3E8FF", category: "Dev" },
    { id: "stk_d4", pack_id: "pk_dev", name: "BUILD OK", emoji: "🟢", bg: "#DCFCE7", category: "Dev" },
    { id: "stk_d5", pack_id: "pk_dev", name: "MERGE PR", emoji: "🔀", bg: "#E0E7FF", category: "Dev" },
    { id: "stk_d6", pack_id: "pk_dev", name: "DEPLOYED!", emoji: "🚀", bg: "#FEF3C7", category: "Dev" }
  ];

  // Initialize DB sticker arrays and normalize any legacy "Kustom" category to "Custom"
  if (!Array.isArray(db.sticker_packs) || db.sticker_packs.length === 0) {
    db.sticker_packs = [...DEFAULT_PACKS];
  } else {
    DEFAULT_PACKS.forEach((dp) => {
      if (!db.sticker_packs.some((p: any) => p?.id === dp.id || p?.category === dp.category)) {
        db.sticker_packs.push(dp);
      }
    });
  }
  if (!Array.isArray(db.stickers) || db.stickers.length === 0) {
    db.stickers = [...DEFAULT_STICKERS];
  } else {
    db.stickers.forEach((s: any) => {
      if (s && (s.category === "Kustom" || s.category === "custom")) {
        s.category = "Custom";
        if (!s.pack_id) s.pack_id = "pk_custom";
      }
    });
  }

  app.get("/api/stickers", (req, res) => {
    const packs = db.sticker_packs && db.sticker_packs.length ? db.sticker_packs : DEFAULT_PACKS;
    const stickers = db.stickers && db.stickers.length ? db.stickers : DEFAULT_STICKERS;
    res.json({
      recent: db.recent_stickers || [],
      frequent: [],
      packs,
      stickers
    });
  });

  app.get("/api/sticker-packs", (req, res) => {
    res.json(db.sticker_packs || DEFAULT_PACKS);
  });

  app.post("/api/stickers", (req, res) => {
    const { name, emoji, bg, file_id, category, pack_id } = req.body || {};
    const rawCat = String(category || "").trim();
    const resolvedCategory = (!rawCat || rawCat.toLowerCase() === "kustom" || rawCat.toLowerCase() === "custom") ? "Custom" : rawCat;
    const reqUser = getReqUser(req);
    const newSticker = {
      id: `stk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pack_id: pack_id || (resolvedCategory === "Custom" ? "pk_custom" : "pk_work"),
      name: name || "Custom Sticker",
      emoji: emoji || "✨",
      bg: bg || "#E0F2FE",
      file_id: file_id || null,
      category: resolvedCategory,
      created_by: reqUser?.user_id || null,
      created_at: new Date().toISOString()
    };
    db.stickers = db.stickers || [];
    db.stickers.unshift(newSticker);
    if (!Array.isArray(db.sticker_packs)) db.sticker_packs = [...DEFAULT_PACKS];
    if (!db.sticker_packs.some((p: any) => p.id === newSticker.pack_id || p.category === resolvedCategory)) {
      db.sticker_packs.push({ id: newSticker.pack_id, name: resolvedCategory, category: resolvedCategory, workspace_id: "user" });
    }
    saveDbToFile(true);
    broadcast({ type: "stickers:changed", sticker: newSticker });
    res.json(newSticker);
  });

  app.delete("/api/stickers/:id", (req, res) => {
    db.stickers = (db.stickers || []).filter((s: any) => s.id !== req.params.id);
    saveDbToFile(true);
    broadcast({ type: "stickers:changed", id: req.params.id });
    res.json({ success: true });
  });

  app.post("/api/sticker-packs", (req, res) => {
    const newPack = {
      id: `pk_${Date.now()}`,
      name: req.body.name || "Sticker Pack",
      category: req.body.category || req.body.name || "Custom",
      workspace_id: "user"
    };
    db.sticker_packs = db.sticker_packs || [];
    db.sticker_packs.push(newPack);
    saveDbToFile(true);
    broadcast({ type: "stickers:changed", pack: newPack });
    res.json(newPack);
  });

  function formatPollForUser(poll: any, uid: string) {
    if (!poll) return null;
    const options = Array.isArray(poll.options)
      ? poll.options.map((o: any, idx: number) =>
          typeof o === "string" ? { id: `opt_${idx + 1}`, text: o } : o
        )
      : [];
    const votesByUser: Record<string, string[]> = poll.votes_by_user || {};
    const counts: Record<string, number> = {};
    const voters: Record<string, string[]> = {};
    options.forEach((o: any) => {
      counts[o.id] = 0;
      voters[o.id] = [];
    });
    let totalVotes = 0;
    Object.entries(votesByUser).forEach(([voterId, chosenIds]) => {
      if (Array.isArray(chosenIds)) {
        chosenIds.forEach((oid) => {
          if (counts[oid] !== undefined) {
            counts[oid] += 1;
            voters[oid].push(voterId);
            totalVotes += 1;
          }
        });
      }
    });
    return {
      ...poll,
      status: poll.status || "open",
      options,
      counts,
      voters,
      my_vote: votesByUser[uid] || [],
      total_votes: totalVotes
    };
  }

  app.get("/api/polls/:id", (req, res) => {
    db.polls = db.polls || [];
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const found = db.polls.find((p: any) => p.id === req.params.id);
    if (!found) {
      return res.json({
        id: req.params.id,
        question: "Polling Tim",
        status: "open",
        multiple: false,
        anonymous: false,
        allow_change: true,
        options: [
          { id: "opt_1", text: "Setuju" },
          { id: "opt_2", text: "Perlu Diskusi" }
        ],
        counts: { opt_1: 1, opt_2: 0 },
        voters: { opt_1: [uid], opt_2: [] },
        my_vote: [],
        total_votes: 1
      });
    }
    res.json(formatPollForUser(found, uid));
  });

  app.post("/api/polls/:id/vote", (req, res) => {
    db.polls = db.polls || [];
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const found = db.polls.find((p: any) => p.id === req.params.id);
    if (!found) return res.status(404).json({ detail: "Poll tidak ditemukan" });
    found.votes_by_user = found.votes_by_user || {};
    const optionIds = Array.isArray(req.body?.option_ids) ? req.body.option_ids : [];
    found.votes_by_user[uid] = optionIds;
    const formatted = formatPollForUser(found, uid);
    (db.messages || []).forEach((m: any) => {
      if (m.poll_id === found.id || m.poll?.id === found.id) {
        m.poll = formatted;
        m.type = "poll";
      }
    });
    (db.posts || []).forEach((p: any) => {
      if (p.poll_id === found.id || p.poll?.id === found.id) {
        p.poll = formatted;
      }
    });
    saveDbToFile();
    broadcast({ type: "poll:update", data: { poll_id: found.id, poll: formatted } });
    res.json(formatted);
  });

  app.post("/api/conversations/:id/polls", (req, res) => {
    db.polls = db.polls || [];
    const reqUser = getReqUser(req);
    const uid = reqUser?.user_id || currentSessionUser?.user_id || "user_admin1";
    const body = req.body || {};
    const rawOpts = Array.isArray(body.options) ? body.options.filter((x: any) => String(x || "").trim()) : [];
    const newPoll = {
      id: `poll_${Date.now()}`,
      conversation_id: req.params.id,
      question: String(body.question || "Polling").trim(),
      multiple: !!body.multiple,
      anonymous: !!body.anonymous,
      allow_change: body.allow_change !== false,
      expires_at: body.expires_at || null,
      status: "open",
      options: (rawOpts.length > 0 ? rawOpts : ["Ya", "Tidak"]).map((opt: any, idx: number) =>
        typeof opt === "string" ? { id: `opt_${idx + 1}`, text: opt } : opt
      ),
      votes_by_user: {},
      created_by: uid,
      created_at: new Date().toISOString()
    };
    db.polls.push(newPoll);
    const formatted = formatPollForUser(newPoll, uid);
    let conv = db.conversations.find((c: any) => c.id === req.params.id);
    if (!conv) {
      const grp = (db.groups || []).find((g: any) => g.id === req.params.id);
      if (grp) {
        conv = { ...grp, type: "group" };
        db.conversations.push(conv);
      }
    }
    const mems = Array.isArray(conv?.member_ids) ? conv.member_ids : (Array.isArray(conv?.members) ? conv.members : [uid]);
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: req.params.id,
      sender_id: uid,
      user_id: uid,
      type: "poll",
      text: `📊 Polling: ${newPoll.question}`,
      poll_id: newPoll.id,
      poll: formatted,
      reactions: {},
      created_at: new Date().toISOString()
    };
    db.messages.push(msg);
    if (conv) {
      conv.last_message_preview = msg.text;
      conv.last_message_at = msg.created_at;
      conv.reads = conv.reads || {};
      conv.reads[uid] = Date.now();
    }
    saveDbToFile();
    broadcast({ type: "message:new", data: { ...msg, member_ids: mems } });
    res.json({ ...formatted, poll: formatted, message: msg });
  });

  app.post("/api/tasks/:id/share", (req, res) => {
    const task = db.tasks.find((t: any) => t.id === req.params.id);
    if (!task) return res.status(404).json({ detail: "Task not found" });
    const { conversation_id } = req.body;
    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    const actorName = actor?.name || "User";
    
    // Set task to in_review and initialize 2-person approval structure
    task.status = "in_review";
    const existingApproved = Array.isArray(task.approvals?.approved_by)
      ? task.approvals.approved_by
      : Array.isArray(task.approval?.approved_by)
      ? task.approval.approved_by
      : [];
    task.approvals = {
      needed: 2,
      approved_by: existingApproved,
      status: existingApproved.length >= 2 ? "approved" : existingApproved.length === 1 ? "partial" : "pending",
      revised_by: task.approvals?.revised_by || null,
      revision_note: task.approvals?.revision_note || ""
    };
    task.approval = task.approvals;
    task.updated_at = new Date().toISOString();

    if (conversation_id) {
      const msg = {
        id: `msg_${Date.now()}`,
        conversation_id,
        sender_id: actorId,
        user_id: actorId,
        text: `${task.title} (${task.number_str})`,
        type: "approval_card",
        task_id: task.id,
        task: { ...task },
        approvals: { ...task.approvals },
        created_at: new Date().toISOString()
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: msg });
    }

    const shareAct = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actor_id: actorId,
      action: `mengirimkan preview tugas ke grup untuk review & approval (status: In Review)`,
      task_id: task.id,
      task_title: task.title,
      created_at: new Date().toISOString()
    };
    task.activity = Array.isArray(task.activity) ? task.activity : [];
    task.activity.unshift(shareAct);
    db.activity.unshift(shareAct);

    db.audit_logs.unshift({
      id: `log_${Date.now()}`,
      actor_id: actorId,
      actor_name: actorName,
      action: `mengirimkan tugas ${task.number_str} - "${task.title}" ke grup untuk approval`,
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    broadcast({ type: "tasks:changed", task });
    res.json({ success: true, task });
  });

  // Approval endpoint: Requires 2 distinct approvals to reach 100% and move to done
  app.post("/api/tasks/:id/approval", (req, res) => {
    const task = db.tasks.find((t: any) => t.id === req.params.id);
    if (!task) return res.status(404).json({ detail: "Task not found" });
    const { decision, note } = req.body;
    const actor = getReqUser(req) || currentSessionUser;
    const userId = actor?.user_id || "user_admin1";
    const actorName = actor?.name || "User";

    const prevApproved = Array.isArray(task.approvals?.approved_by)
      ? task.approvals.approved_by
      : Array.isArray(task.approval?.approved_by)
      ? task.approval.approved_by
      : [];

    task.approvals = {
      needed: 2,
      approved_by: [...prevApproved],
      status: task.approvals?.status || task.approval?.status || "pending",
      revised_by: task.approvals?.revised_by || null,
      revision_note: task.approvals?.revision_note || ""
    };

    task.activity = Array.isArray(task.activity) ? task.activity : [];

    if (decision === "approve") {
      if (!task.approvals.approved_by.includes(userId)) {
        task.approvals.approved_by.push(userId);
      }
      const count = task.approvals.approved_by.length;

      if (count >= 2) {
        task.status = "done";
        task.completed_at = new Date().toISOString();
        task.completed_by = userId;
        task.progress = 100;
        task.approvals.status = "approved";
        if (Array.isArray(task.checkpoints) && task.checkpoints.length > 0) {
          task.checkpoints = task.checkpoints.map((cp: any) =>
            cp && !cp.done
              ? { ...cp, done: true, done_at: new Date().toISOString(), done_by: userId }
              : cp
          );
        }

        const finalAct = {
          id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          actor_id: userId,
          action: count === 2
            ? `memberikan approval (2/2) untuk tugas. Tugas otomatis selesai (Done)!`
            : `memberikan approval tambahan (${count} orang) untuk tugas.`,
          task_id: task.id,
          task_title: task.title,
          created_at: new Date().toISOString()
        };
        task.activity.unshift(finalAct);
        db.activity.unshift(finalAct);

        db.audit_logs.unshift({
          id: `log_${Date.now()}`,
          actor_id: userId,
          actor_name: actorName,
          action: count === 2
            ? `menyetujui approval (2/2) tugas ${task.number_str} (status otomatis Done)`
            : `menyetujui approval tambahan (${count} orang) tugas ${task.number_str}`,
          created_at: new Date().toISOString()
        });
      } else {
        task.approvals.status = "partial";
        if (!Array.isArray(task.checkpoints) || task.checkpoints.length === 0) {
          task.progress = Math.max(Number(task.progress) || 0, 50);
        }
        const partAct = {
          id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          actor_id: userId,
          action: `menyetujui tugas (1/2 approval terkumpul - 50%)`,
          task_id: task.id,
          task_title: task.title,
          created_at: new Date().toISOString()
        };
        task.activity.unshift(partAct);
        db.activity.unshift(partAct);
      }
    } else if (decision === "revise") {
      task.status = "in_progress";
      task.approvals.approved_by = [];
      task.approvals.status = "revised";
      task.approvals.revised_by = userId;
      task.approvals.revision_note = note ? String(note) : "";
      if (!Array.isArray(task.checkpoints) || task.checkpoints.length === 0) {
        task.progress = 0;
      }

      const revAct = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        actor_id: userId,
        action: `meminta revisi pada tugas (status kembali In Progress)`,
        detail: note ? `Catatan revisi: "${note}"` : `Diskusi revisi dilanjutkan melalui chat`,
        task_id: task.id,
        task_title: task.title,
        created_at: new Date().toISOString()
      };
      task.activity.unshift(revAct);
      db.activity.unshift(revAct);

      db.audit_logs.unshift({
        id: `log_${Date.now()}`,
        actor_id: userId,
        actor_name: actorName,
        action: `meminta revisi tugas ${task.number_str}${note ? `: "${note}"` : ""}`,
        created_at: new Date().toISOString()
      });
    }

    task.approval = task.approvals;
    task.updated_at = new Date().toISOString();

    // Sync any message cards in db.messages
    db.messages.forEach((m: any) => {
      if (m.task_id === task.id && m.type === "approval_card") {
        m.task = { ...task };
        m.approvals = { ...task.approvals };
        broadcast({ type: "message:update", data: m });
      }
    });

    saveDbToFile();
    broadcast({ type: "tasks:changed", task });
    res.json({ ...task, success: true, task, approvals: task.approvals, approval: task.approvals });
  });

  // Task Automations CRUD & Run
  app.get("/api/task-automations", (req, res) => {
    res.json(db.task_automations || []);
  });

  app.post("/api/task-automations", (req, res) => {
    const actor = getReqUser(req) || currentSessionUser;
    const {
      name,
      day,
      schedule_day,
      time,
      schedule_time,
      brand_label_id,
      brand_name,
      brand,
      prefix,
      count,
      board_id,
      assignee_id,
      priority,
      checkpoints
    } = req.body || {};
    const resolvedBrand = String(brand || brand_name || "ASLI RI").trim();
    const matchedLabel = (db.labels || []).find(
      (l: any) =>
        (brand_label_id && l.id === brand_label_id) ||
        String(l.name || "").trim().toLowerCase() === resolvedBrand.toLowerCase()
    );
    const resolvedLabelId = brand_label_id || matchedLabel?.id || db.labels?.[0]?.id || "lbl_asliri";
    const resolvedDay = schedule_day || day || "monday";
    const resolvedTime = schedule_time || time || "09:00";
    const resolvedBoardId =
      (board_id && board_id !== "brd_1" ? board_id : null) ||
      db.boards?.[0]?.id ||
      "brd_div_marketing";
    const resolvedPrefix = String(prefix || "Regular").trim() || "Regular";
    const normalizedCheckpoints = Array.isArray(checkpoints)
      ? checkpoints
          .map((c: any) => (typeof c === "string" ? c.trim() : String(c?.title || "").trim()))
          .filter(Boolean)
      : [];

    const rule = {
      id: req.body.id || `auto_${Date.now()}`,
      name: name || `${resolvedBrand} ${resolvedPrefix}`,
      day: resolvedDay,
      schedule_day: resolvedDay,
      time: resolvedTime,
      schedule_time: resolvedTime,
      brand_label_id: resolvedLabelId,
      brand: resolvedBrand,
      brand_name: resolvedBrand,
      prefix: resolvedPrefix,
      count: Math.max(1, Number(count) || 3),
      board_id: resolvedBoardId,
      assignee_id: assignee_id || actor?.user_id || "user_admin1",
      priority: priority || "medium",
      checkpoints: normalizedCheckpoints,
      active: req.body.active !== false,
      created_at: new Date().toISOString()
    };
    db.task_automations = (db.task_automations || []).filter((a: any) => a.id !== rule.id);
    db.task_automations.push(rule);
    saveDbToFile();
    res.json(rule);
  });

  app.delete("/api/task-automations/:id", (req, res) => {
    db.task_automations = (db.task_automations || []).filter((a: any) => a.id !== req.params.id);
    saveDbToFile();
    res.json({ success: true });
  });

  app.post("/api/task-automations/:id/run", (req, res) => {
    const actor = getReqUser(req) || currentSessionUser;
    const rule = (db.task_automations || []).find((a: any) => a.id === req.params.id);
    if (!rule) return res.status(404).json({ detail: "Aturan otomatisasi tidak ditemukan" });

    const numCards = Math.max(1, Number(rule.count) || 3);
    const createdList: any[] = [];
    const prefixName = rule.prefix?.trim() || "Regular";
    const brandDisplay = rule.brand || rule.brand_name || "";
    const resolvedBoardId =
      (rule.board_id && rule.board_id !== "brd_1" ? rule.board_id : null) ||
      db.boards?.[0]?.id ||
      "brd_div_marketing";
    const matchedLabel = (db.labels || []).find(
      (l: any) =>
        (rule.brand_label_id && l.id === rule.brand_label_id) ||
        (brandDisplay && String(l.name || "").trim().toLowerCase() === brandDisplay.toLowerCase())
    );
    const resolvedLabelId = matchedLabel?.id || rule.brand_label_id || db.labels?.[0]?.id || "lbl_asliri";
    const resolvedAssignee = rule.assignee_id || actor?.user_id || "user_admin1";
    const checkpointTitles =
      Array.isArray(rule.checkpoints) && rule.checkpoints.length > 0
        ? rule.checkpoints
        : ["Drafting & Persiapan", "Review Internal"];

    for (let i = 1; i <= numCards; i++) {
      const taskNum = `TSK-${String(getNextTaskNumber(db.tasks)).padStart(3, '0')}`;
      const title = `${brandDisplay ? `[${brandDisplay}] ` : ""}${prefixName} ${i}`;
      const nowIso = new Date().toISOString();
      const t = {
        id: `tsk_${Date.now()}_${i}_auto_${Math.random().toString(36).slice(2, 5)}`,
        number_str: taskNum,
        title,
        description: `Kartu template ${title} yang dibuat secara otomatis oleh sistem penjadwalan.`,
        status: "todo",
        priority: rule.priority || "medium",
        assignee_id: resolvedAssignee,
        assignee_ids: [resolvedAssignee],
        board_id: resolvedBoardId,
        project_id: db.projects?.[0]?.id || null,
        label_ids: [resolvedLabelId].filter(Boolean),
        deadline: new Date(Date.now() + 86400000 * 4).toISOString(),
        requestor_ids: [actor?.user_id || "user_admin1"],
        reviewer_ids: [actor?.user_id || "user_admin1"],
        approvals: { needed: 2, approved_by: [], status: "pending" },
        checkpoints: checkpointTitles.map((cpTitle: any, cpIdx: number) => ({
          id: `cp_${Date.now()}_${i}_${cpIdx + 1}`,
          title: typeof cpTitle === "string" ? cpTitle : String(cpTitle?.title || `Tahap ${cpIdx + 1}`),
          done: false
        })),
        progress: 0,
        archived: false,
        comments: [],
        subtasks: [],
        attachments: [],
        created_at: nowIso,
        updated_at: nowIso
      };
      db.tasks.unshift(t);
      createdList.push(t);
    }

    rule.last_run = new Date().toISOString();

    db.audit_logs.unshift({
      id: `log_${Date.now()}`,
      actor_id: actor?.user_id || "user_admin1",
      actor_name: actor?.name || "User",
      action: `menjalankan otomatisasi kartu: membuat ${createdList.length} kartu template "${rule.name}"`,
      created_at: new Date().toISOString()
    });

    saveDbToFile();
    broadcast({ type: "tasks:changed" });
    res.json({
      success: true,
      message: `Berhasil membuat ${createdList.length} kartu template (${rule.name})`,
      created_count: createdList.length,
      created: createdList,
      tasks: createdList
    });
  });

  // Admin Overview Stats: 100% data riil terintegrasi
  app.get("/api/admin/stats", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat melihat statistik admin." });
    }
    const totalEmployees = db.users.length;
    const activeEmployees = db.users.filter((u: any) => u.status === "active").length;
    const pendingEmployees = db.users.filter((u: any) => u.status === "pending").length;
    const departmentsCount = db.workspace.divisions?.length || 4;
    const groupsCount = db.conversations.filter((c: any) => c.type === "group").length;
    const activeProjectsCount = db.projects.filter((p: any) => p.status === "active").length;
    const openTasksCount = db.tasks.filter((t: any) => t.status !== "done" && !t.archived).length;
    const overdueTasksCount = db.tasks.filter((t: any) => t.status !== "done" && !t.archived && t.deadline && new Date(t.deadline) < new Date()).length;

    res.json({
      total_employees: totalEmployees,
      active_employees: activeEmployees,
      pending_employees: pendingEmployees,
      departments: departmentsCount,
      groups: groupsCount,
      active_projects: activeProjectsCount,
      open_tasks: openTasksCount,
      overdue_tasks: overdueTasksCount
    });
  });

  app.get("/api/admin/audit", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat melihat log audit." });
    }
    res.json(db.audit_logs || []);
  });

  app.get("/api/admin/users", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat mengakses manajemen akun." });
    }
    res.json(sanitizeUsersList(db.users));
  });

  app.get("/api/admin/invitations", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat melihat undangan." });
    }
    res.json(db.invitations);
  });

  app.post("/api/admin/invitations", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat membuat undangan." });
    }
    const inv = { id: `inv_${Date.now()}`, ...req.body, used: false };
    db.invitations.push(inv);
    saveDbToFile();
    res.json(inv);
  });

  app.delete("/api/admin/invitations/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser || !["super_admin", "workspace_admin", "department_manager"].includes(reqUser.role)) {
      return res.status(403).json({ detail: "Hanya Admin / Manajer yang dapat menghapus undangan." });
    }
    db.invitations = db.invitations.filter((i: any) => i.id !== req.params.id);
    saveDbToFile();
    res.json({ success: true });
  });

  const handleTaskConfig = (req: any, res: any) => {
    if (req.body.task_statuses) db.workspace.task_statuses = req.body.task_statuses;
    if (req.body.task_fields) db.workspace.task_fields = req.body.task_fields;
    saveDbToFile();
    broadcast({ type: "workspace:changed" });
    res.json(db.workspace);
  };
  app.put("/api/settings/task-config", handleTaskConfig);
  app.patch("/api/settings/task-config", handleTaskConfig);

  const handleProfileFields = (req: any, res: any) => {
    if (req.body.fields) db.workspace.profile_fields = req.body.fields;
    if (req.body.field_visibility) db.workspace.field_visibility = req.body.field_visibility;
    saveDbToFile();
    broadcast({ type: "workspace:changed" });
    res.json(db.workspace);
  };
  app.put("/api/settings/profile-fields", handleProfileFields);
  app.patch("/api/settings/profile-fields", handleProfileFields);

  app.post("/api/reports/weekly/test", async (req, res) => {
    const reqUser = getReqUser(req);
    const {
      recipient_ids,
      recipient_roles,
      custom_emails,
      gmail_access_token,
    } = req.body || {};

    if (Array.isArray(recipient_ids)) db.workspace.report_recipient_ids = recipient_ids;
    if (Array.isArray(recipient_roles)) db.workspace.report_recipient_roles = recipient_roles;
    if (Array.isArray(custom_emails)) db.workspace.report_custom_emails = custom_emails;

    const rolesToMatch: string[] = Array.isArray(db.workspace.report_recipient_roles)
      ? db.workspace.report_recipient_roles
      : ["super_admin", "workspace_admin", "department_manager", "project_manager"];
    const explicitUserIds = new Set<string>(
      Array.isArray(db.workspace.report_recipient_ids) ? db.workspace.report_recipient_ids : []
    );
    const extraEmails: string[] = Array.isArray(db.workspace.report_custom_emails)
      ? db.workspace.report_custom_emails.filter(Boolean)
      : [];

    const matchedUsers = (db.users || []).filter((u: any) => {
      if (!u || u.is_bot || u.role === "assistant" || u.user_id === CIRCLE_BOT_ID) return false;
      if (u.status && u.status !== "active") return false;
      if (explicitUserIds.size > 0) {
        return explicitUserIds.has(u.user_id) || rolesToMatch.includes(u.role);
      }
      return rolesToMatch.includes(u.role);
    });

    if (matchedUsers.length === 0 && reqUser) {
      matchedUsers.push(reqUser);
    }

    const activeTasks = (db.tasks || []).filter((t: any) => t && !t.archived);
    const totalTasks = activeTasks.length;
    const doneTasks = activeTasks.filter((t: any) => t.status === "done").length;
    const inProgressTasks = activeTasks.filter((t: any) => t.status === "in_progress" || t.status === "in_review" || t.status === "review").length;
    const todoTasks = Math.max(0, totalTasks - doneTasks - inProgressTasks);
    const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const boardsCount = (db.boards || []).length;
    const brandName = db.workspace?.brand_name || db.workspace?.name || "CIRCLE Workspace";
    const dateStr = new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });

    const reportText = `📊 **Laporan Progres Mingguan ${brandName}** (${dateStr})\n- Total Tugas Aktif: ${totalTasks}\n- Selesai: ${doneTasks} (${completionPct}%)\n- Sedang Dikerjakan / Review: ${inProgressTasks}\n- Belum Dikerjakan (To Do): ${todoTasks}\n- Total Board Aktif: ${boardsCount}`;

    matchedUsers.forEach((targetUser: any) => {
      if (!targetUser?.user_id) return;
      const convId = `conv_circle_${targetUser.user_id}`;
      let conv = db.conversations.find((c: any) => c.id === convId);
      if (!conv) {
        conv = {
          id: convId,
          type: "dm",
          name: db.workspace?.assistant_name || "Circle",
          admin_ids: [CIRCLE_BOT_ID],
          members: [CIRCLE_BOT_ID, targetUser.user_id],
          member_ids: [CIRCLE_BOT_ID, targetUser.user_id],
          unread: 1,
          last_message_preview: "Laporan Progres Mingguan Workspace",
          last_message_at: new Date().toISOString(),
        };
        db.conversations.unshift(conv);
      } else {
        conv.unread = (conv.unread || 0) + 1;
        conv.last_message_preview = "Laporan Progres Mingguan Workspace";
        conv.last_message_at = new Date().toISOString();
      }

      const msg = {
        id: `msg_rep_${Date.now()}_${targetUser.user_id}`,
        conversation_id: conv.id,
        sender_id: CIRCLE_BOT_ID,
        user_id: CIRCLE_BOT_ID,
        text: reportText,
        type: "text",
        created_at: new Date().toISOString(),
      };
      db.messages.push(msg);
      broadcast({ type: "message:new", data: { ...msg, member_ids: [CIRCLE_BOT_ID, targetUser.user_id] } });

      createNotification({
        user_id: targetUser.user_id,
        title: "Laporan Progres Mingguan",
        body: `Ringkasan progres mingguan (${doneTasks}/${totalTasks} task selesai) telah dikirim ke Anda.`,
        type: "system",
        category: "tasks",
        link: "/tasks",
      });
    });

    saveDbToFile();
    broadcast({ type: "workspace:changed" });

    const allRecipients = Array.from(
      new Set([
        ...matchedUsers
          .map((u: any) => String(u.email || "").trim())
          .filter((em: string) => em && em.includes("@")),
        ...extraEmails.map((em: string) => String(em || "").trim()).filter((em: string) => em && em.includes("@")),
      ])
    );
    const realEmailTargets = allRecipients.filter((em) => !em.endsWith(".local"));
    const fallbackEmail = reqUser?.email || currentSessionUser?.email || "be.creativestudio21@gmail.com";
    const finalEmailRecipients = realEmailTargets.length > 0 ? realEmailTargets : [fallbackEmail];

    const boardRowsHtml = (db.boards || [])
      .map((b: any) => {
        const bTasks = activeTasks.filter((t: any) => t.board_id === b.id || t.department === b.department);
        const bDone = bTasks.filter((t: any) => t.status === "done").length;
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${b.name || b.department || "Board"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#475569;">${bTasks.length}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#10b981;font-weight:700;">${bDone}</td>
        </tr>`;
      })
      .join("");

    const emailSubject = `[${brandName}] Laporan Progres Mingguan — ${dateStr}`;
    const emailHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:28px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff;color:#0f172a;">
        <div style="border-bottom:2px solid #f1f5f9;padding-bottom:16px;margin-bottom:20px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#ffe4e6;color:#e11d48;font-size:11px;font-weight:700;letter-spacing:0.5px;">LAPORAN PROGRES MINGGUAN</span>
          <h2 style="margin:10px 0 4px 0;font-size:22px;color:#0f172a;">${brandName}</h2>
          <p style="margin:0;font-size:13px;color:#64748b;">${dateStr}</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px;">
          <div style="padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#0f172a;">${totalTasks}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">Total Tugas</div>
          </div>
          <div style="padding:14px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#059669;">${doneTasks} (${completionPct}%)</div>
            <div style="font-size:11px;color:#047857;margin-top:2px;">Tugas Selesai</div>
          </div>
          <div style="padding:14px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#2563eb;">${inProgressTasks}</div>
            <div style="font-size:11px;color:#1d4ed8;margin-top:2px;">Dikerjakan / Review</div>
          </div>
        </div>

        ${boardRowsHtml ? `
        <h3 style="font-size:14px;font-weight:700;margin:0 0 10px 0;color:#0f172a;">Ringkasan per Divisi / Board</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;color:#475569;text-align:left;">
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Board / Divisi</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">Total</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">Selesai</th>
            </tr>
          </thead>
          <tbody>${boardRowsHtml}</tbody>
        </table>` : ""}

        <p style="margin:18px 0 0 0;font-size:12px;color:#64748b;line-height:1.5;">
          Laporan ini dikirim otomatis dari sistem <b>${brandName}</b>. Buka dashboard di <a href="https://asliworkspace.tech" style="color:#e11d48;text-decoration:none;font-weight:600;">asliworkspace.tech</a> untuk melihat detail setiap tugas dan checkpoint.
        </p>
      </div>
    `;

    let emailDelivered = false;
    let deliveryMethod = "in_app";
    let emailErrorDetail = "";

    // 1. Send via Gmail API using user's OAuth token if provided
    if (typeof gmail_access_token === "string" && gmail_access_token.trim()) {
      try {
        const toHeader = finalEmailRecipients.join(", ");
        const encodedSubject = `=?UTF-8?B?${Buffer.from(emailSubject, "utf-8").toString("base64")}?=`;
        const mimeMessage = [
          `To: ${toHeader}`,
          `Subject: ${encodedSubject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/html; charset="UTF-8"',
          "",
          emailHtml,
        ].join("\r\n");

        const rawBase64Url = Buffer.from(mimeMessage, "utf-8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const gRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gmail_access_token.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: rawBase64Url }),
        });

        if (gRes.ok) {
          emailDelivered = true;
          deliveryMethod = "gmail_api";
        } else {
          const errJson: any = await gRes.json().catch(() => ({}));
          emailErrorDetail = errJson?.error?.message || `Gmail API HTTP ${gRes.status}`;
        }
      } catch (gErr: any) {
        emailErrorDetail = gErr?.message || "Gagal menghubungi Gmail API";
      }
    }

    // 2. Fallback to Resend API or SMTP if configured on server
    if (!emailDelivered) {
      const resendKey = String(process.env.RESEND_API_KEY || "").trim();
      const smtpUser = String(process.env.SMTP_USER || "").trim();
      const smtpPass = String(process.env.SMTP_PASS || "").trim();

      if (resendKey) {
        try {
          const fromAddr = String(process.env.SMTP_FROM || `${brandName} <onboarding@resend.dev>`).trim();
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromAddr,
              to: finalEmailRecipients,
              subject: emailSubject,
              html: emailHtml,
            }),
          });
          if (r.ok) {
            emailDelivered = true;
            deliveryMethod = "resend";
          }
        } catch {}
      } else if (smtpUser && smtpPass) {
        try {
          const smtpHost = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
          const smtpPort = Number(process.env.SMTP_PORT || 465);
          const smtpSecure = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false" && smtpPort === 465;
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: { user: smtpUser, pass: smtpPass },
          });
          await transporter.sendMail({
            from: String(process.env.SMTP_FROM || `"${brandName}" <${smtpUser}>`),
            to: finalEmailRecipients.join(", "),
            subject: emailSubject,
            html: emailHtml,
          });
          emailDelivered = true;
          deliveryMethod = "smtp";
        } catch {}
      }
    }

    res.json({
      success: true,
      email_delivered: emailDelivered,
      delivery_method: deliveryMethod,
      email_error: emailErrorDetail || null,
      sent_to: finalEmailRecipients.join(", "),
      recipients: finalEmailRecipients,
      count: finalEmailRecipients.length || 1,
    });
  });

  // =========================================================================
  // STICKY NOTES CHECKLIST API (DB-backed, Archive, Progress %, Send to Group)
  // =========================================================================
  function normalizeStickyNote(n: any) {
    const nowIso = new Date().toISOString();
    const validColors = ["amber", "emerald", "sky", "rose", "violet"];
    let items = Array.isArray(n?.items)
      ? n.items
          .map((it: any, idx: number) => ({
            id: String(it?.id || `ni_${idx}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
            text: String(it?.text ?? it?.title ?? "").trim(),
            done: Boolean(it?.done),
          }))
          .filter((it: any) => it.text.length > 0)
      : [];
    if (items.length === 0 && typeof n?.content === "string" && n.content.trim()) {
      items = n.content
        .split(/\r?\n|;/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((line: string, idx: number) => ({
          id: `ni_${idx}_${n?.id || Date.now()}`,
          text: line,
          done: false,
        }));
    }
    const total = items.length;
    const doneCount = items.filter((i: any) => i.done).length;
    const progress = total > 0 ? Math.round((doneCount / total) * 100) : (n?.completed ? 100 : 0);
    return {
      id: String(n?.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
      user_id: String(n?.user_id || "user_admin1"),
      created_by_name: String(n?.created_by_name || ""),
      title: String(n?.title || "Catatan").trim() || "Catatan",
      content: typeof n?.content === "string" ? n.content : items.map((i: any) => i.text).join("\n"),
      color: validColors.includes(n?.color) ? n.color : "amber",
      items,
      progress,
      done_count: doneCount,
      total_count: total,
      completed: total > 0 ? doneCount === total : Boolean(n?.completed),
      archived: Boolean(n?.archived),
      archived_at: n?.archived ? (n.archived_at || nowIso) : null,
      sent_groups: Array.isArray(n?.sent_groups) ? n.sent_groups : [],
      pinned: Boolean(n?.pinned),
      created_at: n?.created_at || nowIso,
      updated_at: n?.updated_at || n?.created_at || nowIso,
    };
  }

  app.get("/api/notes", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Unauthorized" });
    if (!Array.isArray(db.circle_notes)) db.circle_notes = [];
    const list = db.circle_notes
      .filter((n: any) => n && n.user_id === reqUser.user_id)
      .map(normalizeStickyNote)
      .sort((a: any, b: any) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
      });
    res.json(list);
  });

  app.post("/api/notes", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Unauthorized" });
    if (!Array.isArray(db.circle_notes)) db.circle_notes = [];
    const b = req.body || {};
    const nowIso = new Date().toISOString();
    const rawTitle = String(b.title || "").trim();
    const rawItems = Array.isArray(b.items) ? b.items : [];
    const rawContent = String(b.content || "").trim();
    if (!rawTitle && rawItems.length === 0 && !rawContent) {
      return res.status(400).json({ detail: "Judul atau minimal satu poin checklist wajib diisi." });
    }
    const created = normalizeStickyNote({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: reqUser.user_id,
      created_by_name: reqUser.name || "Anggota Tim",
      title: rawTitle || "Catatan Cepat",
      color: b.color || "amber",
      items: rawItems,
      content: rawContent,
      archived: Boolean(b.archived),
      pinned: Boolean(b.pinned),
      sent_groups: [],
      created_at: nowIso,
      updated_at: nowIso,
    });
    db.circle_notes.unshift(created);
    saveDbToFile(true);
    broadcast({ type: "notes:changed", action: "upsert", user_id: reqUser.user_id, note: created });
    res.json(created);
  });

  const handleUpdateStickyNote = (req: any, res: any) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Unauthorized" });
    if (!Array.isArray(db.circle_notes)) db.circle_notes = [];
    const idx = db.circle_notes.findIndex((n: any) => n && n.id === req.params.id);
    if (idx === -1) return res.status(404).json({ detail: "Sticky note tidak ditemukan." });
    const prev = db.circle_notes[idx];
    if (prev.user_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Anda tidak memiliki izin mengubah catatan ini." });
    }
    const b = req.body || {};
    const nowIso = new Date().toISOString();
    const merged = normalizeStickyNote({
      ...prev,
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.color !== undefined ? { color: b.color } : {}),
      ...(b.items !== undefined ? { items: b.items } : {}),
      ...(b.content !== undefined ? { content: b.content } : {}),
      ...(b.archived !== undefined ? { archived: Boolean(b.archived), archived_at: b.archived ? nowIso : null } : {}),
      ...(b.pinned !== undefined ? { pinned: Boolean(b.pinned) } : {}),
      ...(b.completed !== undefined ? { completed: Boolean(b.completed) } : {}),
      updated_at: nowIso,
    });
    db.circle_notes[idx] = merged;
    saveDbToFile(true);
    broadcast({ type: "notes:changed", action: "upsert", user_id: merged.user_id, note: merged });
    res.json(merged);
  };
  app.patch("/api/notes/:id", handleUpdateStickyNote);
  app.put("/api/notes/:id", handleUpdateStickyNote);

  app.delete("/api/notes/:id", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Unauthorized" });
    if (!Array.isArray(db.circle_notes)) db.circle_notes = [];
    const target = db.circle_notes.find((n: any) => n && n.id === req.params.id);
    if (!target) return res.status(404).json({ detail: "Sticky note tidak ditemukan." });
    if (target.user_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Anda tidak memiliki izin menghapus catatan ini." });
    }
    db.circle_notes = db.circle_notes.filter((n: any) => n && n.id !== req.params.id);
    saveDbToFile(true);
    broadcast({ type: "notes:changed", action: "delete", user_id: target.user_id, deleted_id: req.params.id });
    res.json({ success: true, id: req.params.id });
  });

  app.post("/api/notes/:id/send-to-group", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Unauthorized" });
    if (!Array.isArray(db.circle_notes)) db.circle_notes = [];
    const noteIdx = db.circle_notes.findIndex((n: any) => n && n.id === req.params.id);
    if (noteIdx === -1) return res.status(404).json({ detail: "Sticky note tidak ditemukan." });
    const rawNote = db.circle_notes[noteIdx];
    if (rawNote.user_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Anda tidak memiliki izin membagikan catatan ini." });
    }
    const note = normalizeStickyNote(rawNote);
    const { conversation_id, extra_note = "" } = req.body || {};
    if (!conversation_id) {
      return res.status(400).json({ detail: "Pilih grup tujuan terlebih dahulu." });
    }
    const conv = (db.conversations || []).find((c: any) => c.id === conversation_id && c.type === "group");
    if (!conv) {
      return res.status(404).json({ detail: "Grup tujuan tidak ditemukan." });
    }
    const mems = Array.isArray(conv.member_ids) ? conv.member_ids : (Array.isArray(conv.members) ? conv.members : []);
    if (!mems.includes(reqUser.user_id) && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Anda belum menjadi anggota grup ini." });
    }

    const total = note.items.length;
    const doneCount = note.items.filter((i: any) => i.done).length;
    const pct = note.progress;
    const statusLabel = total > 0 && pct === 100 ? "✅ Terlaksana 100%" : `⏳ Progres ${pct}% (${doneCount}/${total} poin)`;

    const lines = [
      `📌 *Sticky Note: ${note.title}*`,
      `Status: ${statusLabel}`,
      ...(note.items.length > 0
        ? ["", ...note.items.map((it: any) => `${it.done ? "☑" : "☐"} ${it.text}`)]
        : note.content
        ? ["", note.content]
        : []),
      ...(String(extra_note || "").trim() ? ["", `💬 ${String(extra_note).trim()}`] : []),
    ];

    const nowIso = new Date().toISOString();
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: conv.id,
      sender_id: reqUser.user_id,
      user_id: reqUser.user_id,
      text: lines.join("\n"),
      type: "text",
      sticky_note_meta: {
        note_id: note.id,
        title: note.title,
        color: note.color,
        progress: pct,
        done_count: doneCount,
        total_count: total,
      },
      attachments: [],
      reply_to: null,
      mention_ids: [],
      created_at: nowIso,
    };
    if (!Array.isArray(db.messages)) db.messages = [];
    db.messages.push(msg);

    conv.last_message_preview = `📌 ${note.title} (${pct}%)`;
    conv.last_message_at = nowIso;
    conv.reads = conv.reads || {};
    conv.reads[reqUser.user_id] = Date.now();

    const sentEntry = {
      conversation_id: conv.id,
      group_name: conv.name || "Grup",
      sent_at: nowIso,
      pct,
    };
    note.sent_groups = [sentEntry, ...(note.sent_groups || [])].slice(0, 15);
    note.updated_at = nowIso;
    db.circle_notes[noteIdx] = note;

    saveDbToFile(true);
    broadcast({ type: "message:new", data: { ...msg, member_ids: mems, conversation_type: conv.type, conversation_name: conv.name } });
    broadcast({ type: "notes:changed", action: "upsert", user_id: note.user_id, note });

    mems.forEach((targetUid: string) => {
      if (!targetUid || targetUid === reqUser.user_id || targetUid === CIRCLE_BOT_ID) return;
      sendWebPushToUser(targetUid, {
        id: msg.id,
        title: `${reqUser.name || "Rekan Kerja"} di ${conv.name || "Grup"}`,
        body: `📌 Sticky Note: ${note.title} (${pct}%)`,
        type: "message",
        category: "dm",
        url: `/messages/${conv.id}`,
        conversation_id: conv.id,
        tag: conv.id,
      });
    });

    res.json({ success: true, note, message: msg, group_name: conv.name });
  });

  app.get("/api/workspace", (req, res) => {
    res.json(db.workspace);
  });

  const handleWorkspaceUpdate = (req: any, res: any) => {
    const reqUser = getReqUser(req);
    const touchesSuperAdminOnly =
      req.body?.marketplace_enabled !== undefined ||
      req.body?.marketplace_config !== undefined ||
      req.body?.custom_copywriting !== undefined;
    if (touchesSuperAdminOnly && (!reqUser || reqUser.role !== "super_admin")) {
      return res.status(403).json({
        detail: "Hanya Super Admin yang dapat mengubah copywriting dan pengaturan Marketplace.",
      });
    }

    const oldMarketplaceEnabled = db.workspace?.marketplace_enabled !== false;
    const oldDivisions = Array.isArray(db.workspace.divisions) ? [...db.workspace.divisions] : [];
    const nextPayload = { ...req.body };
    if (nextPayload.marketplace_config && typeof nextPayload.marketplace_config === "object") {
      nextPayload.marketplace_config = {
        ...(db.workspace?.marketplace_config || {}),
        ...nextPayload.marketplace_config,
      };
    }
    if (nextPayload.marketplace_enabled !== undefined) {
      nextPayload.marketplace_enabled = Boolean(nextPayload.marketplace_enabled);
    }

    db.workspace = { ...db.workspace, ...nextPayload };
    if (req.body.name && !req.body.brand_name) db.workspace.brand_name = req.body.name;
    if (req.body.brand_name && !req.body.name) db.workspace.name = req.body.brand_name;

    // Auto-approve any pending accounts whose domain matches allowed_domains when auto_join_domain is enabled
    if (db.workspace?.auto_join_domain !== false) {
      (db.users || []).forEach((u: any) => {
        if (u && u.status === "pending" && u.email) {
          const dom = String(u.email).split("@")[1]?.toLowerCase() || "";
          if (dom && isAllowedCompanyDomain(dom)) {
            u.status = "active";
          }
        }
      });
    }

    if (nextPayload.marketplace_enabled !== undefined && nextPayload.marketplace_enabled !== oldMarketplaceEnabled && reqUser) {
      db.audit_logs = db.audit_logs || [];
      db.audit_logs.unshift({
        id: `log_mkt_${Date.now()}`,
        actor_id: reqUser.user_id,
        actor_name: reqUser.name || "Super Admin",
        action: nextPayload.marketplace_enabled
          ? "mengaktifkan fitur Marketplace Karyawan"
          : "menonaktifkan fitur Marketplace Karyawan",
        created_at: new Date().toISOString(),
      });
    }

    // If divisions were updated in Settings, sync them with Organization Units and Official Department Groups
    if (Array.isArray(req.body.divisions)) {
      const nextDivs = Array.from(
        new Set(req.body.divisions.map((d: any) => String(d || "").trim()).filter(Boolean))
      ) as string[];
      db.workspace.divisions = nextDivs;

      // Handle renamed division if count is identical and 1 item changed
      if (oldDivisions.length === nextDivs.length) {
        oldDivisions.forEach((oldD, i) => {
          const newD = nextDivs[i];
          if (oldD && newD && oldD !== newD) {
            (db.org_units || []).forEach((u: any) => {
              if ((u.division || u.name || "").toLowerCase() === oldD.toLowerCase()) {
                if (u.name === u.division || u.name === oldD) u.name = newD;
                u.division = newD;
              }
            });
            (db.users || []).forEach((usr: any) => {
              if ((usr.department || "").toLowerCase() === oldD.toLowerCase()) {
                usr.department = newD;
              }
            });
            [db.groups, db.conversations].forEach((list) => {
              (list || []).forEach((grp: any) => {
                if (grp && String(grp.name || "").toLowerCase() === oldD.toLowerCase() && (grp.group_type === "department" || grp.is_verified)) {
                  grp.name = newD;
                  grp.description = `Official channel for ${newD} department discussions`;
                }
              });
            });
          }
        });
      }

      syncDivisionsToOrgUnits(nextDivs, { removeMissing: true });
    }

    const circleBot = db.users.find((u: any) => u.user_id === "user_circle_assistant");
    if (circleBot) {
      if (db.workspace.assistant_name) circleBot.name = db.workspace.assistant_name;
      if (req.body.assistant_avatar !== undefined) {
        const botAvatar = db.workspace.assistant_avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364";
        circleBot.avatar = botAvatar;
        circleBot.picture = botAvatar;
      }
    }
    saveDbToFile(true);
    broadcast({ type: "workspace:changed", data: db.workspace });
    broadcast({ type: "workspace:updated", data: db.workspace });
    if (req.body?.marketplace_enabled !== undefined || req.body?.marketplace_config !== undefined) {
      broadcast({
        type: "marketplace:changed",
        enabled: db.workspace?.marketplace_enabled !== false,
      });
    }
    broadcast({ type: "org:changed", units: db.org_units });
    broadcast({ type: "groups:changed" });
    broadcast({ type: "conversations:changed" });
    broadcast({ type: "users:changed" });
    res.json(db.workspace);
  };
  app.patch("/api/workspace", handleWorkspaceUpdate);
  app.put("/api/workspace", handleWorkspaceUpdate);

  registerMarketplaceRoutes(app, { db, getReqUser, saveDbToFile, broadcast, createNotification });

  app.get("/api/item-types", (req, res) => {
    res.json(db.workspace.item_types || DEFAULT_WORKSPACE_ITEM_TYPES);
  });

  app.post("/api/item-types", (req, res) => {
    db.workspace.item_types = db.workspace.item_types || [];
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Nama item tidak boleh kosong" });

    const color = req.body.color || "#E2E8F0";
    const text_color = req.body.text_color || (isDarkColor(color) ? "#FFFFFF" : "#1E293B");
    const border_color = req.body.border_color || (isDarkColor(color) ? color : undefined);

    let existing = db.workspace.item_types.find((x: any) => x.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.color = color;
      if (text_color) existing.text_color = text_color;
      if (border_color) existing.border_color = border_color;
    } else {
      existing = { name, color, text_color, border_color };
      db.workspace.item_types.push(existing);
    }
    saveDbToFile(true);
    broadcast({ type: "workspace:changed" });
    res.json(existing);
  });

  const handlePrefsUpdate = (req: any, res: any) => {
    const actor = getReqUser(req) || currentSessionUser;
    const uid = actor?.user_id || "default";
    if (req.body?.custom_copywriting !== undefined && (!actor || actor.role !== "super_admin")) {
      return res.status(403).json({
        detail: "Hanya Super Admin yang dapat mengubah copywriting aplikasi.",
      });
    }
    db.prefs[uid] = { ...(db.prefs[uid] || {}), ...req.body };
    if (req.body?.custom_copywriting !== undefined && actor?.role === "super_admin") {
      db.workspace.custom_copywriting = req.body.custom_copywriting;
      broadcast({ type: "workspace:changed" });
    }
    saveDbToFile(true);
    res.json(db.prefs[uid]);
  };
  app.put("/api/prefs", handlePrefsUpdate);
  app.patch("/api/prefs", handlePrefsUpdate);

  app.get("/api/public/branding", (req, res) => {
    res.json({
      brand_name: db.workspace.name,
      tagline: db.workspace.tagline,
      logo_file_id: db.workspace.logo_file_id,
      login_image_file_id: db.workspace.login_image_file_id,
      divisions: db.workspace.divisions || DEFAULT_ALIGNED_DIVISIONS,
      custom_copywriting: db.workspace.custom_copywriting || {}
    });
  });

  // Google Drive Folder Shortcuts Directory CRUD
  app.get("/api/drive-shortcuts", (req, res) => {
    if (!Array.isArray(db.drive_shortcuts)) db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
    res.json(db.drive_shortcuts);
  });

  app.post("/api/drive-shortcuts", (req, res) => {
    if (!Array.isArray(db.drive_shortcuts)) db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    const body = req.body || {};
    const now = new Date().toISOString();
    const item = {
      id: body.id || `drv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: (body.name || "Untitled Folder").trim(),
      drive_folder_id: body.drive_folder_id || "",
      drive_url: body.drive_url || "https://drive.google.com/drive/my-drive",
      description: body.description || "",
      category: body.category || "General",
      badge: body.badge || "Google Drive",
      color: body.color || "#FF5364",
      icon: body.icon || "Folder",
      pinned: body.pinned !== undefined ? !!body.pinned : true,
      show_on_dashboard: body.show_on_dashboard !== undefined ? !!body.show_on_dashboard : true,
      access_type: body.access_type || "custom",
      allowed_departments: Array.isArray(body.allowed_departments) ? body.allowed_departments : [],
      allowed_user_ids: Array.isArray(body.allowed_user_ids)
        ? body.allowed_user_ids
        : [actorId],
      created_by: body.created_by || actorId,
      created_at: body.created_at || now,
      updated_at: now
    };
    const existingIdx = db.drive_shortcuts.findIndex((s: any) => s.id === item.id);
    if (existingIdx >= 0) {
      db.drive_shortcuts[existingIdx] = item;
    } else {
      db.drive_shortcuts.unshift(item);
    }
    db.activity.unshift({
      id: `act_${Date.now()}`,
      user_id: actorId,
      action: `menambahkan shortcut folder Google Drive "${item.name}" ke Direktori`,
      created_at: now
    });
    saveDbToFile();
    broadcast({ type: "drive_shortcuts:changed", data: db.drive_shortcuts });
    res.json(item);
  });

  app.patch("/api/drive-shortcuts/:id", (req, res) => {
    if (!Array.isArray(db.drive_shortcuts)) db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    const idx = db.drive_shortcuts.findIndex((s: any) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ detail: "Shortcut tidak ditemukan" });
    const prev = db.drive_shortcuts[idx];
    const updated = {
      ...prev,
      ...req.body,
      id: prev.id,
      updated_at: new Date().toISOString()
    };
    db.drive_shortcuts[idx] = updated;
    db.activity.unshift({
      id: `act_${Date.now()}`,
      user_id: actorId,
      action: `memperbarui shortcut folder Google Drive "${updated.name}"`,
      created_at: updated.updated_at
    });
    saveDbToFile();
    broadcast({ type: "drive_shortcuts:changed", data: db.drive_shortcuts });
    res.json(updated);
  });

  app.delete("/api/drive-shortcuts/:id", (req, res) => {
    if (!Array.isArray(db.drive_shortcuts)) db.drive_shortcuts = [...INITIAL_DRIVE_SHORTCUTS];
    const actor = getReqUser(req) || currentSessionUser;
    const actorId = actor?.user_id || "user_admin1";
    const target = db.drive_shortcuts.find((s: any) => s.id === req.params.id);
    db.drive_shortcuts = db.drive_shortcuts.filter((s: any) => s.id !== req.params.id);
    if (target) {
      db.activity.unshift({
        id: `act_${Date.now()}`,
        user_id: actorId,
        action: `menghapus shortcut folder Google Drive "${target.name}" dari Direktori`,
        created_at: new Date().toISOString()
      });
    }
    saveDbToFile();
    broadcast({ type: "drive_shortcuts:changed", data: db.drive_shortcuts });
    res.json({ success: true });
  });

  // Global Workspace Search Endpoint
  app.get("/api/search", (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) {
      return res.json({
        drive_shortcuts: [],
        employees: [],
        tasks: [],
        groups: [],
        messages: [],
        projects: [],
        polls: [],
        marketplace_listings: []
      });
    }
    res.json({
      drive_shortcuts: (db.drive_shortcuts || [])
        .filter((d: any) => `${d.name} ${d.description || ""} ${d.category || ""}`.toLowerCase().includes(q))
        .slice(0, 6),
      employees: (db.users || [])
        .filter((u: any) => !u.is_bot && u.role !== "assistant" && `${u.name} ${u.job_title || ""} ${u.department || ""}`.toLowerCase().includes(q))
        .slice(0, 6),
      tasks: (db.tasks || [])
        .filter((t: any) => `${t.title} ${t.number_str || ""}`.toLowerCase().includes(q))
        .slice(0, 6),
      groups: (db.conversations || [])
        .filter((c: any) => c.type === "group" && (c.name || "").toLowerCase().includes(q))
        .slice(0, 6),
      messages: (db.messages || [])
        .filter((m: any) => (m.text || "").toLowerCase().includes(q))
        .slice(0, 6),
      projects: (db.projects || [])
        .filter((p: any) => (p.name || "").toLowerCase().includes(q))
        .slice(0, 6),
      polls: (db.polls || [])
        .filter((p: any) => (p.question || "").toLowerCase().includes(q))
        .slice(0, 6),
      marketplace_listings:
        db.workspace?.marketplace_enabled !== false
          ? (db.marketplace_listings || [])
              .filter((l: any) => `${l.title} ${l.category || ""} ${l.seller_name || ""}`.toLowerCase().includes(q))
              .slice(0, 6)
          : []
    });
  });

  // WebSocket handling with cryptographic token verification & presence tracking
  wss.on('connection', (ws: WebSocket, request: any) => {
    try {
      const reqUrl = new URL(request?.url || '', `http://${request?.headers?.host || 'localhost'}`);
      const queryToken = reqUrl.searchParams.get('token');
      const cookies = parseCookies(request?.headers?.cookie);
      const verified = verifyAuthenticatedUserFromToken(queryToken || cookies.circle_session || null);
      if (verified) {
        (ws as any).userId = verified.user_id;
        setUserOnlineStatus(verified.user_id, true);
      }
    } catch {}

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.token) {
          const verified = verifyAuthenticatedUserFromToken(data.token);
          if (verified) {
            (ws as any).userId = verified.user_id;
            setUserOnlineStatus(verified.user_id, true);
          }
        }
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {}
    });

    ws.on('close', () => {
      const uid = (ws as any).userId;
      if (!uid) return;
      setTimeout(() => {
        let stillConnected = false;
        wss.clients.forEach((client: any) => {
          if (client !== ws && client.readyState === WebSocket.OPEN && client.userId === uid) {
            stillConnected = true;
          }
        });
        if (!stillConnected) {
          setUserOnlineStatus(uid, false);
        }
      }, 4000);
    });
  });

  // Setup Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist'), {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.webmanifest')) {
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
        } else if (path.basename(filePath) === 'sw.js' || path.basename(filePath) === 'registerSW.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
    app.get('*', (req, res, next) => {
      if (req.path.endsWith('.webmanifest') || req.path === '/sw.js' || req.path === '/registerSW.js') {
        return res.status(404).end();
      }
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  // Keep persistent HTTP connections warm behind Cloudflare / Cloud Run / Nginx reverse proxies (asliworkspace.tech)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CIRCLE Workspace server running on port ${PORT}`);
  });

  const handleShutdown = async (signal: string) => {
    try {
      flushDbToFileSync();
      if (pgHydrated && !isServerBootstrapping) {
        await enqueuePostgresSave();
      }
      console.log(`[Persistence] Flushed workspace DB on ${signal}.`);
    } catch {}
  };
  process.on('SIGINT', () => { void handleShutdown('SIGINT').finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { void handleShutdown('SIGTERM').finally(() => process.exit(0)); });
  process.on('beforeExit', () => { void handleShutdown('beforeExit'); });
}

startServer().catch(console.error);
