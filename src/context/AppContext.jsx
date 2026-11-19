import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, wsUrl, fileUrl, setAuthUserId, setAuthToken, getAuthToken } from "../lib/api";
import { applyTheme, buildTheme } from "../lib/theme";
import { getTranslation, getEffectiveCopywriting } from "../lib/i18n";
import { playSound } from "../lib/sound";
import {
  hydrateConversationsCache,
  upsertConversationInCache,
  appendMessageToCache,
  updateMessageInCache,
  clearChatCache,
  hydratePostsCache,
  hydrateGroupsCache,
  upsertGroupInCache,
} from "../lib/workspaceCaches";
import { setCachedDriveShortcuts } from "../data/initialDriveShortcuts";
import { showSystemNotification, syncPushSubscription, syncAppBadge } from "../lib/systemNotifications";
import { attemptAutoHydrateServer, syncWorkspaceMirror, scheduleRealtimeCloudSync, upsertAccountInVault, upsertAccountsListInVault, getKnownAccountsFromVault, hasCompletedInitialHydrate, rehydrateIfServerRestarted } from "../lib/persistentMirror";
import { firebaseAuth, subscribeFirebaseAuth, getCloudSyncStatus, subscribeCloudSyncStatus } from "../lib/firestoreBackup";
import { googleBasicSignIn } from "../lib/auth";
import { prefetchMarketplaceState, reconcileMarketplaceEnabledCache } from "../pages/marketplace/marketplaceStore";
import { setTopQuickActionNotifActive } from "../lib/sonnerCompat";
import { hasTopNotifQuickAction } from "../components/TopNotificationPopup";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const DEFAULT_USERS = [
  { user_id: "user_admin1", name: "Admin ASLI RI", email: "admin@asliri.local", role: "super_admin", job_title: "Super Admin", department: "Management", org_unit_id: "unit_mgmt", manager_id: "user_superadmin_saeful", status: "active", online: true, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" },
  { user_id: "user_superadmin_saeful", name: "Saeful", email: "saeful@asliri.id", role: "super_admin", job_title: "Super Administrator", department: "Management", org_unit_id: "unit_mgmt", manager_id: null, status: "active", online: true, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" }
];

try {
  if (typeof window !== "undefined" && localStorage.getItem("circle_prod_clean_v5") !== "1") {
    localStorage.setItem("circle_prod_clean_v5", "1");
  }
} catch {}

export function AppProvider({ children }) {
  const [session, setSessionState] = useState(() => {
    try {
      const tabCached = sessionStorage.getItem("circle_tab_session_cache");
      const cached = tabCached || localStorage.getItem("circle_session_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.user?.user_id) {
          setAuthUserId(parsed.user.user_id);
          setAuthToken(parsed.token || null);
          return parsed;
        }
      }
    } catch {}
    setAuthUserId(null);
    setAuthToken(null);
    return null;
  });

  const setSession = useCallback((updater) => {
    setSessionState((prev) => {
      const rawNext = typeof updater === "function" ? updater(prev) : updater;
      const prevUid = prev?.user?.user_id || null;
      const rawNextUid = rawNext?.user?.user_id || null;
      const next =
        rawNext && rawNextUid && !rawNext.token && prev?.token && prevUid === rawNextUid
          ? { ...rawNext, token: prev.token }
          : rawNext;
      const nextUid = next?.user?.user_id || null;

      if (prevUid !== nextUid) {
        clearChatCache();
        try {
          localStorage.removeItem("circle_convs_cache");
          localStorage.removeItem("circle_cache_conversations");
        } catch {}
      }

      setAuthUserId(nextUid);
      setAuthToken(next?.token || null);

      try {
        if (next && nextUid) {
          upsertAccountInVault(next.account_vault_entry || next.user);
          const serialized = JSON.stringify(next);
          sessionStorage.setItem("circle_tab_session_cache", serialized);
          localStorage.setItem("circle_session_cache", serialized);
        } else {
          sessionStorage.removeItem("circle_tab_session_cache");
          localStorage.removeItem("circle_session_cache");
        }
      } catch {}

      return next;
    });
  }, []);

  const [users, setUsers] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_users_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_USERS;
  });
  const [labels, setLabels] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_labels_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      { id: "lbl_asliri", name: "ASLI RI", color: "#EF4444" },
      { id: "lbl_tixfly", name: "TIXFLY", color: "#8B5CF6" },
      { id: "lbl_internal", name: "INTERNAL", color: "#1E293B" }
    ];
  });
  const [online, setOnline] = useState(() => new Set(DEFAULT_USERS.map((u) => u.user_id)));
  const [unread, setUnread] = useState(0);
  const [themeDraft, setThemeDraft] = useState(null);
  const [topNotif, setTopNotif] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState(() => getCloudSyncStatus());
  const [tasks, setTasks] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_tasks_cache") || localStorage.getItem("circle_cache_tasks");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const subs = useRef(new Set());
  const sock = useRef(null);
  const loadAllRef = useRef(null);
  const loadAllInFlightRef = useRef(null);
  const lastLoadAllAtRef = useRef(0);

  const me = session?.user;
  const ws = session?.workspace;
  const prefs = useMemo(() => session?.prefs || {}, [session?.prefs]);
  const meRef = useRef(me);
  const wsRef = useRef(ws);
  const usersRef = useRef(users);
  const prefsRef = useRef(prefs);
  const tasksRef = useRef(tasks);
  meRef.current = me;
  wsRef.current = ws;
  usersRef.current = users;
  prefsRef.current = prefs;
  tasksRef.current = tasks;

  const applyServerTasksSafely = useCallback((incomingList, { silentSync = false } = {}) => {
    if (!Array.isArray(incomingList)) return false;
    if (incomingList.length === 0 && (!hasCompletedInitialHydrate() || (Array.isArray(tasksRef.current) && tasksRef.current.length > 0))) {
      rehydrateIfServerRestarted(api).then((restored) => {
        if (restored) {
          api.get("/tasks").then((r) => {
            if (Array.isArray(r.data) && r.data.length > 0) {
              setTasks(r.data);
              try {
                localStorage.setItem("circle_tasks_cache", JSON.stringify(r.data));
                localStorage.setItem("circle_cache_tasks", JSON.stringify(r.data));
              } catch {}
              subs.current.forEach((fn) => fn({ type: "tasks:changed", silentSync: true }));
            }
          }).catch(() => {});
        }
      }).catch(() => {});
      return false;
    }
    setTasks(incomingList);
    try {
      localStorage.setItem("circle_tasks_cache", JSON.stringify(incomingList));
      localStorage.setItem("circle_cache_tasks", JSON.stringify(incomingList));
    } catch {}
    if (silentSync) {
      subs.current.forEach((fn) => fn({ type: "tasks:changed", silentSync: true }));
    }
    return true;
  }, []);

  const userDeadlinesToday = useMemo(() => {
    const set = new Set();
    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();

    (tasks || []).forEach((item) => {
      if (!item || item.status === "done" || !item.deadline) return;
      try {
        const dl = new Date(item.deadline);
        if (isNaN(dl.getTime())) return;

        const isToday = dl.getFullYear() === todayY && dl.getMonth() === todayM && dl.getDate() === todayD;
        const isOverdue = dl < today;

        if (isToday || isOverdue) {
          if (item.assignee_id) set.add(item.assignee_id);
          if (Array.isArray(item.assignee_ids)) {
            item.assignee_ids.forEach((id) => set.add(id));
          }
        }
      } catch {}
    });
    return set;
  }, [tasks]);

  const hasDeadlineToday = useCallback((userId) => {
    return Boolean(userId && userDeadlinesToday.has(userId));
  }, [userDeadlinesToday]);

  const lastBootstrapEtagRef = useRef(null);

  const loadAll = useCallback(async (force = false) => {
    if (!me?.user_id) return;
    if (loadAllInFlightRef.current) return loadAllInFlightRef.current;
    const now = Date.now();
    if (!force && now - lastLoadAllAtRef.current < 2000) {
      return;
    }
    const currentUid = me.user_id;
    const runPromise = (async () => {
      try {
        let bootData = null;
        try {
          const headers = !force && lastBootstrapEtagRef.current ? { "If-None-Match": lastBootstrapEtagRef.current } : {};
          const res = await api.get("/bootstrap", {
            headers,
            validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
          });
          if (res.status === 304) {
            lastLoadAllAtRef.current = Date.now();
            return;
          }
          if (res.headers?.etag) {
            lastBootstrapEtagRef.current = res.headers.etag;
          }
          bootData = res.data;
        } catch {
          // Fallback to legacy individual calls if /bootstrap fails
          const [w, u, l, n, c, t, ds, p, tr, g] = await Promise.all([
            api.get("/workspace").catch(() => ({ data: null })),
            api.get("/users").catch(() => ({ data: null })),
            api.get("/labels").catch(() => ({ data: null })),
            api.get("/notifications").catch(() => ({ data: null })),
            api.get("/conversations").catch(() => ({ data: null })),
            api.get("/tasks").catch(() => ({ data: null })),
            api.get("/drive-shortcuts").catch(() => ({ data: null })),
            api.get("/posts").catch(() => ({ data: null })),
            api.get("/posts/trending").catch(() => ({ data: null })),
            api.get("/groups/browse").catch(() => ({ data: null })),
          ]);
          bootData = {
            workspace: w?.data,
            users: u?.data,
            labels: l?.data,
            notifications: n?.data,
            conversations: c?.data,
            tasks: t?.data,
            drive_shortcuts: ds?.data,
            posts: p?.data,
            trending: tr?.data,
            groups: g?.data,
          };
        }

        if (!bootData || typeof bootData !== "object") return;

        if (bootData.workspace && typeof bootData.workspace === "object") {
          setSession((s) => (s ? { ...s, workspace: bootData.workspace } : s));
          reconcileMarketplaceEnabledCache(
            currentUid,
            bootData.workspace.marketplace_enabled !== false,
            bootData.workspace.marketplace_config
          );
        }
        if (Array.isArray(bootData.users) && bootData.users.length > 0) {
          const syncedUsers = bootData.users.map((x) => (x.user_id === currentUid ? { ...x, online: true } : x));
          setUsers(syncedUsers);
          upsertAccountsListInVault(syncedUsers);
          setOnline(new Set([...syncedUsers.filter((x) => x.online).map((x) => x.user_id), currentUid]));
          try { localStorage.setItem("circle_users_cache", JSON.stringify(syncedUsers)); } catch {}
          const syncedMe = syncedUsers.find((x) => x.user_id === currentUid);
          if (syncedMe) {
            setSession((s) => {
              if (!s?.user) return s;
              const next = { ...s, user: { ...s.user, ...syncedMe } };
              try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
              return next;
            });
            upsertAccountInVault(syncedMe);
          }
        } else {
          setOnline((prev) => new Set([...prev, currentUid]));
        }
        if (Array.isArray(bootData.labels)) {
          setLabels(bootData.labels);
          try { localStorage.setItem("circle_labels_cache", JSON.stringify(bootData.labels)); } catch {}
        }
        if (bootData.notifications) {
          setUnread(bootData.notifications.unread || 0);
          try { localStorage.setItem(`circle_notifications_cache_${currentUid}`, JSON.stringify(bootData.notifications)); } catch {}
        }
        if (Array.isArray(bootData.conversations)) {
          hydrateConversationsCache(bootData.conversations, currentUid);
        }
        if (Array.isArray(bootData.tasks)) {
          applyServerTasksSafely(bootData.tasks);
        }
        if (Array.isArray(bootData.drive_shortcuts)) {
          setCachedDriveShortcuts(bootData.drive_shortcuts);
        }
        if (Array.isArray(bootData.posts) || Array.isArray(bootData.trending)) {
          hydratePostsCache(
            Array.isArray(bootData.posts) ? bootData.posts : undefined,
            Array.isArray(bootData.trending) ? bootData.trending : undefined
          );
        }
        if (Array.isArray(bootData.groups)) {
          hydrateGroupsCache(bootData.groups, currentUid);
        }
        lastLoadAllAtRef.current = Date.now();
      } finally {
        loadAllInFlightRef.current = null;
      }
    })();
    loadAllInFlightRef.current = runPromise;
    return runPromise;
  }, [me?.user_id, setSession, applyServerTasksSafely]);
  loadAllRef.current = loadAll;

  const checkAuth = useCallback(async () => {
    let cachedPrefs = {};
    try {
      cachedPrefs = JSON.parse(localStorage.getItem("circle_user_prefs") || "{}");
    } catch {}
    try {
      const { data } = await api.get("/auth/me");
      const mergedPrefs = { ...cachedPrefs, ...(data.prefs || {}) };
      const resolvedToken = data.token || getAuthToken();
      if (resolvedToken) setAuthToken(resolvedToken);
      const nextSession = {
        token: resolvedToken || undefined,
        user: data.user,
        account_vault_entry: data.account_vault_entry || data.user,
        workspace: data.workspace,
        prefs: mergedPrefs
      };
      setSession(nextSession);
      if (data.workspace && typeof data.workspace === "object") {
        reconcileMarketplaceEnabledCache(
          data.user?.user_id,
          data.workspace.marketplace_enabled !== false,
          data.workspace.marketplace_config
        );
      }
      if (data.account_vault_entry || data.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      if (Array.isArray(data.users) && data.users.length > 0) {
        setUsers(data.users);
        upsertAccountsListInVault(data.users);
        setOnline(new Set(data.users.filter((x) => x.online).map((x) => x.user_id)));
        try { localStorage.setItem("circle_users_cache", JSON.stringify(data.users)); } catch {}
      }
      if (Array.isArray(data.labels) && data.labels.length > 0) {
        setLabels(data.labels);
        try { localStorage.setItem("circle_labels_cache", JSON.stringify(data.labels)); } catch {}
      }
      if (Array.isArray(data.org_units)) {
        try { localStorage.setItem("circle_org_units_cache", JSON.stringify(data.org_units)); } catch {}
      }
      if (Array.isArray(data.drive_shortcuts)) {
        setCachedDriveShortcuts(data.drive_shortcuts);
      }
      try {
        localStorage.setItem("circle_user_prefs", JSON.stringify(mergedPrefs));
      } catch {}
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await attemptAutoHydrateServer(api).catch(() => false);
        try {
          const cachedRaw = sessionStorage.getItem("circle_tab_session_cache") || localStorage.getItem("circle_session_cache");
          const cachedSess = cachedRaw ? JSON.parse(cachedRaw) : null;
          if (cachedSess?.user?.user_id) {
            const { data: rec } = await api.post("/auth/session-recover", {
              token: cachedSess.token || getAuthToken(),
              user: cachedSess.user,
              known_accounts: getKnownAccountsFromVault()
            });
            if (rec?.token && rec?.user) {
              setAuthToken(rec.token);
              setSession({
                token: rec.token,
                user: rec.user,
                account_vault_entry: rec.account_vault_entry || rec.user,
                workspace: rec.workspace || cachedSess.workspace,
                prefs: { ...cachedPrefs, ...(rec.prefs || cachedSess.prefs || {}) }
              });
              return;
            }
          }
        } catch {}
        setSession(null);
      }
    }
  }, [setSession]);

  // Verify legacy tokenless cached sessions via cookie or cleanly return to Login
  useEffect(() => {
    if (me?.user_id && !session?.token) {
      checkAuth();
    }
  }, [me?.user_id, session?.token, checkAuth]);

  // Listen for 401 session revocation / expiration from API interceptor (attempt auto-hydrate & session-recover before kicking out)
  useEffect(() => {
    let lastNotified = 0;
    let handling = false;
    const handleExpired = async () => {
      if (handling) return;
      handling = true;
      try {
        await attemptAutoHydrateServer(api).catch(() => false);
        try {
          const cachedRaw = sessionStorage.getItem("circle_tab_session_cache") || localStorage.getItem("circle_session_cache");
          const cachedSess = cachedRaw ? JSON.parse(cachedRaw) : null;
          if (cachedSess?.user?.user_id) {
            const { data: rec } = await api.post("/auth/session-recover", {
              token: cachedSess.token || getAuthToken(),
              user: cachedSess.user,
              known_accounts: getKnownAccountsFromVault()
            });
            if (rec?.token && rec?.user) {
              setAuthToken(rec.token);
              setSession((prev) => ({
                ...(prev || cachedSess),
                token: rec.token,
                user: rec.user,
                account_vault_entry: rec.account_vault_entry || rec.user,
                workspace: rec.workspace || prev?.workspace || cachedSess.workspace
              }));
              return;
            }
          }
        } catch {}
        const now = Date.now();
        setSession(null);
        if (now - lastNotified > 3000) {
          lastNotified = now;
          toast.error("Sesi login berakhir atau telah dicabut. Silakan masuk kembali.");
        }
      } finally {
        handling = false;
      }
    };
    window.addEventListener("circle:session-expired", handleExpired);
    return () => window.removeEventListener("circle:session-expired", handleExpired);
  }, [setSession, checkAuth]);

  useEffect(() => {
    if (me?.user_id) {
      setAuthUserId(me.user_id);
      if (session?.token) setAuthToken(session.token);
      let cancelled = false;
      let bgHydrateTimer = null;
      let bgMirrorTimer = null;
      let bgPrefetchTimer = null;
      (async () => {
        // 1. Critical path: 1 single /api/bootstrap request so workspace is interactive ASAP
        await loadAll(true).catch(() => {});
        if (cancelled) return;
        // 2. Defer non-critical background hydration, marketplace prefetch & push sync so first paint stays snappy
        bgHydrateTimer = setTimeout(async () => {
          if (cancelled) return;
          const restored = await attemptAutoHydrateServer(api).catch(() => false);
          if (!cancelled && restored) {
            await loadAll(true).catch(() => {});
          }
          if (!cancelled) {
            bgMirrorTimer = setTimeout(() => {
              if (!cancelled) {
                syncWorkspaceMirror(api, false).catch(() => {});
              }
            }, 3500);
          }
        }, 1200);
        bgPrefetchTimer = setTimeout(() => {
          if (cancelled) return;
          prefetchMarketplaceState(me.user_id).catch(() => null);
          syncPushSubscription(api).catch(() => {});
        }, 2500);
      })();
      return () => {
        cancelled = true;
        if (bgHydrateTimer) clearTimeout(bgHydrateTimer);
        if (bgMirrorTimer) clearTimeout(bgMirrorTimer);
        if (bgPrefetchTimer) clearTimeout(bgPrefetchTimer);
      };
    }
  }, [me?.user_id, session?.token, loadAll]);

  // Reactive Cloud Firestore sync status + automatic persistent mirror (IndexedDB + Firestore live sync)
  useEffect(() => {
    const unsubStatus = subscribeCloudSyncStatus(setCloudSyncStatus);
    const unsubFb = subscribeFirebaseAuth(async (fbUser) => {
      if (fbUser?.emailVerified) {
        const restored = await attemptAutoHydrateServer(api).catch(() => false);
        if (restored && me?.user_id) {
          loadAll().catch(() => {});
        } else if (me?.user_id) {
          syncWorkspaceMirror(api, false, () => loadAllRef.current?.().catch(() => {})).catch(() => {});
        }
      }
    });

    if (!me?.user_id) {
      return () => {
        unsubStatus();
        unsubFb();
      };
    }

    const intervalId = setInterval(() => {
      syncWorkspaceMirror(api, false, () => loadAllRef.current?.().catch(() => {})).catch(() => {});
    }, 300000);

    const onHide = () => {
      if (document.visibilityState === "hidden") {
        syncWorkspaceMirror(api, false).catch(() => {});
      }
    };
    const onPageHide = () => syncWorkspaceMirror(api, false).catch(() => {});

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsubStatus();
      unsubFb();
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [me?.user_id, loadAll]);

  const syncCloudNow = useCallback(async () => {
    if (!firebaseAuth.currentUser?.emailVerified) {
      toast.info("Hubungkan akun Google terlebih dahulu agar Cloud Firestore aktif.");
      return false;
    }
    const res = await syncWorkspaceMirror(api, true, () => loadAllRef.current?.().catch(() => {}), true);
    const latest = getCloudSyncStatus();
    if (latest.lastError) {
      toast.error(latest.lastError);
      return false;
    }
    if (res?.pulledNewFromShared) {
      await loadAllRef.current?.().catch(() => {});
      toast.success("Data tim terbaru dari Cloud Firestore berhasil digabungkan & disinkronkan!");
    } else {
      toast.success("Semua data workspace tersimpan aman di Cloud Firestore!");
    }
    return true;
  }, []);

  const connectCloudGoogle = useCallback(async () => {
    try {
      const res = await googleBasicSignIn();
      if (res?.user) {
        await attemptAutoHydrateServer(api).catch(() => false);
        await syncWorkspaceMirror(api, true, () => loadAllRef.current?.().catch(() => {}), true).catch(() => {});
        await loadAllRef.current?.().catch(() => {});
        toast.success(`Cloud Firestore aktif (${res.user.email})!`);
        return true;
      }
      return false;
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/unauthorized-domain") {
        toast.error(`Domain "${window.location.hostname}" belum ditambahkan ke Authorized Domains Firebase Auth.`);
      } else if (code === "auth/popup-blocked") {
        toast.error("Popup Google diblokir browser. Izinkan pop-up untuk menghubungkan Cloud Firestore.");
      } else if (code === "auth/popup-closed-by-user") {
        toast.info("Popup login Google ditutup sebelum selesai.");
      } else {
        toast.error(err?.message || "Gagal menghubungkan Google OAuth (pastikan popup tidak diblokir atau email terverifikasi).");
      }
      return false;
    }
  }, []);

  // Sync PWA App Badge count with unread notifications
  useEffect(() => {
    syncAppBadge(unread);
  }, [unread]);

  // Forward Service Worker notificationclick navigation events into React Router
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const onSwMessage = (event) => {
      if (event?.data?.type === "CIRCLE_NAVIGATE" && event?.data?.url) {
        window.dispatchEvent(new CustomEvent("circle:navigate", { detail: { url: event.data.url } }));
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, []);

  useEffect(() => {
    applyTheme(buildTheme(ws?.theme, prefs, themeDraft));
  }, [ws?.theme, prefs, themeDraft]);

  // Synchronize browser tab Favicon dynamically with Workspace Favicon / Logo
  useEffect(() => {
    const faviconFileId = ws?.favicon_file_id || ws?.logo_file_id;
    const faviconHref = faviconFileId
      ? (faviconFileId === "default_workspace_logo" ? "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png" : fileUrl(faviconFileId))
      : "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png";
    
    // Update or create standard icon link
    let iconLink = document.querySelector("link[rel='icon']");
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }
    iconLink.href = faviconHref;

    // Update or create Apple touch icon link
    let appleTouchLink = document.querySelector("link[rel='apple-touch-icon']");
    if (!appleTouchLink) {
      appleTouchLink = document.createElement("link");
      appleTouchLink.rel = "apple-touch-icon";
      document.head.appendChild(appleTouchLink);
    }
    appleTouchLink.href = faviconHref;
  }, [ws?.favicon_file_id, ws?.logo_file_id]);

  useEffect(() => {
    if (prefs.theme_mode !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme(buildTheme(ws?.theme, prefs, themeDraft));
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [prefs, ws?.theme, themeDraft]);

  const emit = (evt) => subs.current.forEach((fn) => fn(evt));

  useEffect(() => {
    if (!me?.user_id || me?.is_demo || me?.needs_onboarding || me?.is_verified) return;
    const seenKey = `circle_verify_prompt_seen_${me.user_id}`;
    try {
      if (localStorage.getItem(seenKey)) return;
      localStorage.setItem(seenKey, "1");
    } catch {}
    const timer = setTimeout(() => {
      setTopNotif({
        id: `verify_prompt_${me.user_id}`,
        title: "Lengkapi Profil 100% untuk Centang Verified",
        body: `Profil Anda baru terisi ${me.profile_completion || 0}%. Lengkapi seluruh form di Ubah Profil untuk mendapatkan centang Verified!`,
        type: "profile_verify",
        link: `/people/${me.user_id}?edit=1`,
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [me?.user_id, me?.is_demo, me?.needs_onboarding, me?.is_verified, me?.profile_completion]);

  useEffect(() => {
    if (!me?.user_id) return undefined;
    let closed = false;
    let timer;
    let hasWsConnectedOnce = false;
    const connect = () => {
      const s = new WebSocket(wsUrl());
      sock.current = s;
      s.onopen = () => {
        if (me?.user_id && s.readyState === 1) {
          s.send(JSON.stringify({ type: "identify", user_id: me.user_id, token: getAuthToken() }));
        }
        if (hasWsConnectedOnce) {
          api.get("/tasks").then((r) => {
            if (Array.isArray(r.data)) {
              applyServerTasksSafely(r.data, { silentSync: true });
            }
          }).catch(() => {});
        }
        hasWsConnectedOnce = true;
      };
      s.onmessage = (m) => {
        let evt;
        try {
          evt = JSON.parse(m.data);
        } catch {
          return;
        }
        if (!evt || typeof evt !== "object") return;
        if (evt.type === "presence" && evt.data?.user_id) {
          const isUserOnline = evt.data.user_id === me?.user_id ? true : Boolean(evt.data.online);
          const incomingAvail = evt.data.availability_status;
          setOnline((prev) => {
            const n = new Set(prev);
            isUserOnline ? n.add(evt.data.user_id) : n.delete(evt.data.user_id);
            if (me?.user_id) n.add(me.user_id);
            return n;
          });
          setUsers((prev) => {
            const next = (Array.isArray(prev) ? prev : []).map((u) =>
              u.user_id === evt.data.user_id
                ? {
                    ...u,
                    online: isUserOnline,
                    ...(incomingAvail ? { availability_status: incomingAvail } : {}),
                  }
                : u
            );
            try { localStorage.setItem("circle_users_cache", JSON.stringify(next)); } catch {}
            return next;
          });
          if (incomingAvail && evt.data.user_id === me?.user_id) {
            setSession((s) => {
              if (!s?.user) return s;
              const next = { ...s, user: { ...s.user, availability_status: incomingAvail, online: true } };
              try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
              return next;
            });
          }
        }
        if (evt.type === "notification") {
          if (evt.data?.user_id && me?.user_id && evt.data.user_id !== me.user_id) return;
          setUnread((x) => x + 1);
          const nextNotif = {
            id: evt.data.id || `notif_${Date.now()}`,
            title: evt.data.title,
            body: evt.data.body,
            type: evt.data.type,
            link: evt.data.link,
            access_request: evt.data.access_request,
            group_id: evt.data.group_id,
            requester_id: evt.data.requester_id,
            conversation_id: evt.data.conversation_id,
            task_id: evt.data.task_id,
            sender: evt.data.sender
          };
          if (hasTopNotifQuickAction(nextNotif)) setTopQuickActionNotifActive(true);
          setTopNotif(nextNotif);
          playSound("notification");
          const curPrefs = prefsRef.current || prefs;
          const catKey = evt.data?.category === "dm" ? "messages" : evt.data?.category;
          const catEnabled = !catKey || curPrefs?.notifications?.[catKey] !== false;
          if (catEnabled) {
            showSystemNotification(evt.data, {
              alwaysWhenVisible: Boolean(curPrefs?.notifications?.system_always_in_pwa)
            });
          }
        }
        if (evt.type === "message:new" && evt.data) {
          // Ignore private messages meant for conversations this user is not part of
          if (Array.isArray(evt.data.member_ids) && me?.user_id && !evt.data.member_ids.includes(me.user_id)) {
            return;
          }
          if (String(evt.data.conversation_id || "").startsWith("conv_circle_") && evt.data.conversation_id !== `conv_circle_${me?.user_id}`) {
            return;
          }
          // Always cache incoming messages immediately in memory & localStorage so opening any chat has 0ms delay
          appendMessageToCache(evt.data);
          if (evt.data.sender_id !== me?.user_id && !evt.data.silent_popup) {
            const isCurrentlyInThisChat = window.location.pathname === `/messages/${evt.data.conversation_id}`;
            if (!isCurrentlyInThisChat) {
              const curUsers = usersRef.current || users;
              const curWs = wsRef.current || ws;
              const curPrefs = prefsRef.current || prefs;
              const userMapObj = Object.fromEntries((Array.isArray(curUsers) ? curUsers : []).map((u) => [u.user_id, u]));
              const sender = userMapObj[evt.data.sender_id] || (evt.data.sender_id === "user_circle_assistant" ? { name: curWs?.assistant_name || "Circle", avatar: curWs?.assistant_avatar } : null);
              const msgTitle = evt.data.conversation_type === "group" && evt.data.conversation_name
                ? `${sender?.name || "Rekan Kerja"} di ${evt.data.conversation_name}`
                : `Pesan Baru dari ${sender?.name || "Circle"}`;
              const msgBody = evt.data.text || "Mengirimkan pesan baru";
              const nextNotif = {
                id: `msg_notif_${Date.now()}`,
                title: msgTitle,
                body: msgBody,
                type: evt.data.type || "dm",
                conversation_id: evt.data.conversation_id,
                sender,
                access_request: evt.data.access_request
              };
              if (hasTopNotifQuickAction(nextNotif)) setTopQuickActionNotifActive(true);
              setTopNotif(nextNotif);
              // For group chats (which don't emit a separate notification event), trigger OS/PWA notification too
              if (evt.data.conversation_type === "group" && curPrefs?.notifications?.messages !== false) {
                showSystemNotification(
                  {
                    id: evt.data.id,
                    title: msgTitle,
                    body: msgBody,
                    type: "message",
                    conversation_id: evt.data.conversation_id,
                    tag: evt.data.conversation_id
                  },
                  { alwaysWhenVisible: Boolean(curPrefs?.notifications?.system_always_in_pwa) }
                );
              }
            }
          }
        }
        if (evt.type === "message:update" && evt.data) {
          updateMessageInCache(evt.data);
        }
        if (evt.type === "conversation:upsert" && evt.data) {
          upsertConversationInCache(evt.data, me?.user_id);
        }
        if ((evt.type === "groups:changed" || evt.type === "group:updated") && evt.data) {
          upsertGroupInCache(evt.data, me?.user_id);
          upsertConversationInCache({ ...evt.data, type: "group" }, me?.user_id);
        }
        if (evt.type === "conversations:changed") {
          api.get("/conversations").then((r) => {
            if (Array.isArray(r.data)) hydrateConversationsCache(r.data, me?.user_id);
          }).catch(() => {});
        }
        if (evt.type === "workspace:changed" || evt.type === "workspace:updated") {
          if (evt.data && typeof evt.data === "object") {
            setSession((s) => (s ? { ...s, workspace: evt.data } : s));
            reconcileMarketplaceEnabledCache(
              me?.user_id,
              evt.data.marketplace_enabled !== false,
              evt.data.marketplace_config
            );
          } else {
            api.get("/workspace").then((r) => {
              if (r.data && typeof r.data === "object") {
                setSession((s) => (s ? { ...s, workspace: r.data } : s));
                reconcileMarketplaceEnabledCache(
                  me?.user_id,
                  r.data.marketplace_enabled !== false,
                  r.data.marketplace_config
                );
              }
            }).catch(() => {});
          }
          if (evt.data?.marketplace_enabled !== undefined) {
            prefetchMarketplaceState(me?.user_id).catch(() => null);
          }
        }
        if (evt.type === "users:changed") {
          api.get("/users").then((r) => {
            if (Array.isArray(r.data)) {
              setUsers(r.data);
              try { localStorage.setItem("circle_users_cache", JSON.stringify(r.data)); } catch {}
              setSession((s) => {
                if (!s?.user) return s;
                const updatedMe = r.data.find((u) => u.user_id === s.user.user_id);
                if (!updatedMe) return s;
                const next = { ...s, user: updatedMe };
                try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
                return next;
              });
            }
          }).catch(() => {});
        }
        if (evt.type === "org:changed" && Array.isArray(evt.units)) {
          try { localStorage.setItem("circle_org_units_cache", JSON.stringify(evt.units)); } catch {}
        }
        if (evt.type === "drive_shortcuts:changed" && Array.isArray(evt.data)) {
          setCachedDriveShortcuts(evt.data);
        }
        if (evt.type === "tasks:changed") {
          if (evt.deleted_id) {
            setTasks((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              const next = list.filter((x) => x.id !== evt.deleted_id);
              try {
                localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
                localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
              } catch {}
              return next;
            });
          } else if (evt.task) {
            const incoming = evt.task;
            const curMe = meRef.current || me;
            const uid = curMe?.user_id;
            const isSuper = ["super_admin", "workspace_admin"].includes(curMe?.role);
            const isInvolved = Boolean(
              uid && (
                incoming.assignee_id === uid ||
                (Array.isArray(incoming.assignee_ids) && incoming.assignee_ids.includes(uid)) ||
                incoming.created_by === uid ||
                (Array.isArray(incoming.requestor_ids) && incoming.requestor_ids.includes(uid)) ||
                (Array.isArray(incoming.collaborator_ids) && incoming.collaborator_ids.includes(uid)) ||
                (Array.isArray(incoming.checkpoints) && incoming.checkpoints.some((c) => c && c.assignee_id === uid))
              )
            );
            const matchesDept = Boolean(
              curMe?.department && incoming.department &&
              String(curMe.department).trim().toLowerCase() === String(incoming.department).trim().toLowerCase()
            );
            if (isSuper || isInvolved || matchesDept) {
              setTasks((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const exists = list.some((x) => x.id === incoming.id);
                const next = exists ? list.map((x) => (x.id === incoming.id ? { ...x, ...incoming } : x)) : [incoming, ...list];
                try {
                  localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
                  localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
                } catch {}
                return next;
              });
            } else {
              // If user previously saw it or might have invited-board access, sync cleanly with server
              api.get("/tasks").then((r) => {
                if (Array.isArray(r.data)) {
                  applyServerTasksSafely(r.data);
                }
              }).catch(() => {});
            }
          } else {
            api.get("/tasks").then((r) => {
              if (Array.isArray(r.data)) {
                applyServerTasksSafely(r.data);
              }
            }).catch(() => {});
          }
        }
        if (evt.type === "tasks:deleted" && evt.id) {
          setTasks((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.filter((x) => x.id !== evt.id);
            try {
              localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
              localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
            } catch {}
            return next;
          });
        }
        if (evt.type === "marketplace:changed") {
          if (typeof evt.enabled === "boolean") {
            setSession((s) => {
              if (!s?.workspace || s.workspace.marketplace_enabled === evt.enabled) return s;
              return { ...s, workspace: { ...s.workspace, marketplace_enabled: evt.enabled } };
            });
            reconcileMarketplaceEnabledCache(me?.user_id, evt.enabled);
            prefetchMarketplaceState(me?.user_id).catch(() => null);
          }
        }
        if (
          [
            "tasks:changed",
            "tasks:deleted",
            "notes:changed",
            "message:new",
            "message:update",
            "posts:changed",
            "users:changed",
            "workspace:changed",
            "workspace:updated",
            "org:changed",
            "groups:changed",
            "conversations:changed",
            "marketplace:changed",
            "auto_backup:created",
          ].includes(evt.type)
        ) {
          scheduleRealtimeCloudSync(api, 4000, () => {
            loadAllRef.current?.().catch(() => {});
          });
        }
        emit(evt);
      };
      s.onerror = () => {
        // Silent error handler to prevent unhandled rejection when connection closes prematurely
      };
      s.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000);
      };
    };
    connect();
    const ping = setInterval(() => {
      if (sock.current?.readyState === 1) {
        sock.current.send(JSON.stringify({ type: "ping", user_id: me.user_id }));
      }
    }, 20000);
    let lastFocusWorkspaceSync = 0;
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible" && me?.user_id) {
        const wsOpen = sock.current?.readyState === 1;
        if (wsOpen) {
          sock.current.send(JSON.stringify({ type: "identify", user_id: me.user_id, token: getAuthToken() }));
        }
        const now = Date.now();
        // Throttle focus sync to 30s and leverage ETag-cached /api/bootstrap (304 Not Modified when unchanged)
        if (now - lastFocusWorkspaceSync >= 30000) {
          lastFocusWorkspaceSync = now;
          if (!wsOpen) {
            loadAllRef.current?.(false).catch(() => {});
          }
        }
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      sock.current?.close();
    };
  }, [me?.user_id]);

  const value = useMemo(() => {
    const userMap = Object.fromEntries((Array.isArray(users) ? users : []).map((u) => [u.user_id, u]));
    const labelMap = Object.fromEntries((Array.isArray(labels) ? labels : []).map((l) => [l.id, l]));
    return {
      session, setSession, me, ws, prefs, users, userMap, labels, labelMap, online, unread, setUnread,
      tasks, userDeadlinesToday, hasDeadlineToday,
      reloadTasks: () => api.get("/tasks").then((r) => {
        if (Array.isArray(r.data)) {
          applyServerTasksSafely(r.data);
        }
      }),
      topNotif,
      setTopNotif: (d) => {
        setTopQuickActionNotifActive(hasTopNotifQuickAction(d));
        setTopNotif(d);
      },
      showTopNotif: (d) => {
        setTopQuickActionNotifActive(hasTopNotifQuickAction(d));
        setTopNotif(d);
      },
      closeTopNotif: () => {
        setTopQuickActionNotifActive(false);
        setTopNotif(null);
      },
      statuses: (ws?.task_statuses || ["todo", "in_progress", "in_review", "done"]).map((s) => typeof s === "string" ? { key: s, name: s.replace(/_/g, " "), color: "#F0F4FA", is_done: s === "done" } : s),
      isAdmin: ["super_admin", "workspace_admin"].includes(me?.role),
      isManager: ["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(me?.role),
      isDemo: !!me?.is_demo,
      lang: "en",
      effectiveCopywriting: getEffectiveCopywriting(ws?.custom_copywriting, prefs?.custom_copywriting),
      t: (key, fallback) => getTranslation(key, getEffectiveCopywriting(ws?.custom_copywriting, prefs?.custom_copywriting), fallback),
      themeDraft, setThemeDraft,
      reloadUsers: () => api.get("/users").then((r) => {
        if (Array.isArray(r.data)) {
          setUsers(r.data);
          try { localStorage.setItem("circle_users_cache", JSON.stringify(r.data)); } catch {}
          setSession((s) => {
            if (!s?.user) return s;
            const updatedMe = r.data.find((u) => u.user_id === s.user.user_id);
            if (!updatedMe) return s;
            const next = { ...s, user: updatedMe };
            try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
            return next;
          });
        }
      }),
      reloadLabels: () => api.get("/labels").then((r) => {
        if (Array.isArray(r.data)) {
          setLabels(r.data);
          try { localStorage.setItem("circle_labels_cache", JSON.stringify(r.data)); } catch {}
        }
      }),
      reloadWs: () => api.get("/workspace").then((r) => {
        if (r.data && typeof r.data === "object") {
          reconcileMarketplaceEnabledCache(
            meRef.current?.user_id || me?.user_id,
            r.data.marketplace_enabled !== false,
            r.data.marketplace_config
          );
        }
        setSession((s) => {
          const next = { ...s, workspace: r.data };
          try {
            localStorage.setItem("circle_session_cache", JSON.stringify(next));
            if (Array.isArray(r.data?.divisions)) {
              localStorage.setItem("circle_admin_divisions", JSON.stringify(r.data.divisions));
            }
          } catch {}
          return next;
        });
      }),
      savePrefs: async (patch) => {
        setSession((s) => {
          const nextPrefs = { ...(s?.prefs || {}), ...patch };
          const nextSession = { ...s, prefs: nextPrefs };
          try {
            localStorage.setItem("circle_user_prefs", JSON.stringify(nextPrefs));
            localStorage.setItem("circle_session_cache", JSON.stringify(nextSession));
          } catch {}
          return nextSession;
        });
        try {
          const { data } = await api.put("/prefs", patch);
          setSession((s) => {
            const synced = { ...(s?.prefs || {}), ...data };
            const nextSession = { ...s, prefs: synced };
            try {
              localStorage.setItem("circle_user_prefs", JSON.stringify(synced));
              localStorage.setItem("circle_session_cache", JSON.stringify(nextSession));
            } catch {}
            return nextSession;
          });
        } catch (e) {
          console.warn("Server prefs sync warning:", e);
        }
      },
      subscribe: (fn) => {
        subs.current.add(fn);
        return () => subs.current.delete(fn);
      },
      send: (obj) => sock.current?.readyState === 1 && sock.current.send(JSON.stringify(obj)),
      updateAvailabilityStatus: async (newStatus) => {
        const normalized = String(newStatus || "online").toLowerCase().trim();
        const uid = me?.user_id;
        if (!uid) return;
        setSession((s) => {
          if (!s?.user) return s;
          const next = { ...s, user: { ...s.user, availability_status: normalized, online: true } };
          try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
          return next;
        });
        setUsers((prev) => {
          const next = (Array.isArray(prev) ? prev : []).map((u) =>
            u.user_id === uid ? { ...u, availability_status: normalized, online: true } : u
          );
          try { localStorage.setItem("circle_users_cache", JSON.stringify(next)); } catch {}
          return next;
        });
        try {
          await api.post("/presence/status", { user_id: uid, availability_status: normalized });
        } catch (err) {
          console.warn("Failed to sync availability status:", err);
        }
      },
      logout: async () => {
        await api.post("/auth/logout").catch(() => {});
        setSession(null);
      },
      checkAuth,
      reloadAll: loadAll,
      cloudSyncStatus,
      syncCloudNow,
      connectCloudGoogle,
    };
  }, [session, setSession, me, ws, prefs, users, labels, online, unread, topNotif, themeDraft, tasks, userDeadlinesToday, hasDeadlineToday, checkAuth, loadAll, cloudSyncStatus, syncCloudNow, connectCloudGoogle]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
