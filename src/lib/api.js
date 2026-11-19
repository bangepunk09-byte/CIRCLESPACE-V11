import axios from "axios";
import { getKnownAccountsFromVault, upsertAccountInVault, attemptAutoHydrateServer } from "./persistentMirror";

export const BASE = "";
export const api = axios.create({ baseURL: `/api`, withCredentials: true });

let activeTabUserId = null;
let activeAuthToken = null;
let recoveryInFlight = null;
let cachedProfileHeader = { uid: null, token: null, value: "", expiresAt: 0 };

export function invalidateProfileHeaderCache() {
  cachedProfileHeader = { uid: null, token: null, value: "", expiresAt: 0 };
}

export function setAuthToken(token) {
  activeAuthToken = token || null;
  invalidateProfileHeaderCache();
  try {
    if (token) {
      sessionStorage.setItem("circle_active_token", token);
    } else {
      sessionStorage.removeItem("circle_active_token");
    }
  } catch {}
}

export function getAuthToken() {
  if (activeAuthToken) return activeAuthToken;
  try {
    const tabTok = sessionStorage.getItem("circle_active_token");
    if (tabTok) {
      activeAuthToken = tabTok;
      return tabTok;
    }
    const tabSess = sessionStorage.getItem("circle_tab_session_cache");
    if (tabSess) {
      const parsed = JSON.parse(tabSess);
      if (parsed?.token) {
        activeAuthToken = parsed.token;
        return activeAuthToken;
      }
    }
    const cached = localStorage.getItem("circle_session_cache");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.token) {
        activeAuthToken = parsed.token;
        return activeAuthToken;
      }
    }
  } catch {}
  return null;
}

export function setAuthUserId(uid) {
  activeTabUserId = uid || null;
  invalidateProfileHeaderCache();
  try {
    if (uid) {
      sessionStorage.setItem("circle_active_user_id", uid);
    } else {
      sessionStorage.removeItem("circle_active_user_id");
    }
  } catch {}
}

export function getAuthUserId() {
  if (activeTabUserId) return activeTabUserId;
  try {
    const tabUid = sessionStorage.getItem("circle_active_user_id");
    if (tabUid) {
      activeTabUserId = tabUid;
      return tabUid;
    }
    const tabSess = sessionStorage.getItem("circle_tab_session_cache");
    if (tabSess) {
      const parsed = JSON.parse(tabSess);
      if (parsed?.user?.user_id) {
        activeTabUserId = parsed.user.user_id;
        return activeTabUserId;
      }
    }
    const cached = localStorage.getItem("circle_session_cache");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.user?.user_id) {
        activeTabUserId = parsed.user.user_id;
        return activeTabUserId;
      }
    }
  } catch {}
  return null;
}

export function getCachedSessionUser() {
  try {
    const tabSess = sessionStorage.getItem("circle_tab_session_cache");
    const raw = tabSess || localStorage.getItem("circle_session_cache");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user?.user_id) return parsed.user;
    }
  } catch {}
  return null;
}

function encodeBase64Json(obj) {
  try {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return "";
  }
}

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  const uid = getAuthUserId();
  config.headers = config.headers || {};
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  if (uid) {
    config.headers["x-user-id"] = uid;
  }

  // Attach compact self-healing session user profile header (memoized 5s to avoid per-request localStorage/btoa overhead)
  const nowTs = Date.now();
  if (
    cachedProfileHeader.value &&
    cachedProfileHeader.uid === uid &&
    cachedProfileHeader.token === token &&
    nowTs < cachedProfileHeader.expiresAt
  ) {
    config.headers["x-user-profile"] = cachedProfileHeader.value;
  } else {
    const sessUser = getCachedSessionUser();
    if (sessUser?.user_id && sessUser?.email) {
      const vaultMatch = getKnownAccountsFromVault().find(
        (u) => u.user_id === sessUser.user_id || u.email?.toLowerCase() === sessUser.email?.toLowerCase()
      );
      const compactProfile = {
        user_id: sessUser.user_id,
        email: sessUser.email,
        name: sessUser.name,
        role: sessUser.role || vaultMatch?.role || "employee",
        department: sessUser.department || vaultMatch?.department || "Marketing",
        job_title: sessUser.job_title || vaultMatch?.job_title || "Staff Member",
        org_unit_id: sessUser.org_unit_id || vaultMatch?.org_unit_id || null,
        status: "active",
        avatar:
          sessUser.avatar && !String(sessUser.avatar).startsWith("data:")
            ? sessUser.avatar
            : undefined,
        password_hash: vaultMatch?.password_hash || sessUser.password_hash || undefined,
        token_version: Number(sessUser.token_version || vaultMatch?.token_version || 1),
      };
      const encoded = encodeBase64Json(compactProfile);
      if (encoded && encoded.length < 4096) {
        cachedProfileHeader = { uid, token, value: encoded, expiresAt: nowTs + 5000 };
        config.headers["x-user-profile"] = encoded;
      }
    }
  }

  // Automatically include known registered accounts from local vault on auth endpoints
  // so login/reset after a container restart always recognizes previously registered users.
  const reqUrl = String(config.url || "");
  if (
    config.method === "post" &&
    config.data &&
    typeof config.data === "object" &&
    !(config.data instanceof FormData) &&
    (reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/google") ||
      reqUrl.includes("/auth/forgot-password") ||
      reqUrl.includes("/auth/reset-with-recovery-key"))
  ) {
    const known = getKnownAccountsFromVault();
    if (known.length > 0 && !config.data.known_accounts) {
      config.data = { ...config.data, known_accounts: known };
    }
  }

  return config;
});

async function recoverActiveSession() {
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = (async () => {
    try {
      const sessUser = getCachedSessionUser();
      const token = getAuthToken();
      const known = getKnownAccountsFromVault();
      if (!sessUser?.user_id || !sessUser?.email) return false;

      // 1. Hydrate workspace mirror if server cold-started
      await attemptAutoHydrateServer(api).catch(() => false);

      // 2. Request session self-healing from server
      const { data } = await api.post("/auth/session-recover", {
        token,
        user: sessUser,
        known_accounts: known,
      });

      if (data?.token && data?.user?.user_id) {
        setAuthToken(data.token);
        setAuthUserId(data.user.user_id);
        upsertAccountInVault(data.account_vault_entry || data.user);
        try {
          const tabRaw = sessionStorage.getItem("circle_tab_session_cache");
          const locRaw = localStorage.getItem("circle_session_cache");
          const prev = JSON.parse(tabRaw || locRaw || "{}");
          const next = {
            ...prev,
            token: data.token,
            user: data.user,
            workspace: data.workspace || prev.workspace,
          };
          const serialized = JSON.stringify(next);
          sessionStorage.setItem("circle_tab_session_cache", serialized);
          localStorage.setItem("circle_session_cache", serialized);
        } catch {}
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      recoveryInFlight = null;
    }
  })();
  return recoveryInFlight;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const originalConfig = err?.config;
    const reqUrl = String(originalConfig?.url || "");
    const isPublicOrLogin =
      reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/register") ||
      reqUrl.includes("/auth/forgot-password") ||
      reqUrl.includes("/auth/reset-with-recovery-key") ||
      reqUrl.includes("/auth/google") ||
      reqUrl.includes("/auth/session-recover") ||
      reqUrl.includes("/workspace/persistence-status") ||
      reqUrl.includes("/workspace/auto-hydrate") ||
      reqUrl.includes("/public/");

    if (status === 401 && !isPublicOrLogin && (getAuthToken() || getAuthUserId())) {
      // Attempt silent session recovery once before kicking the user out
      if (originalConfig && !originalConfig._retriedAfterRecover) {
        originalConfig._retriedAfterRecover = true;
        const recovered = await recoverActiveSession();
        if (recovered) {
          const freshToken = getAuthToken();
          originalConfig.headers = originalConfig.headers || {};
          if (freshToken) {
            originalConfig.headers["Authorization"] = `Bearer ${freshToken}`;
          }
          return api.request(originalConfig);
        }
      }

      try {
        window.dispatchEvent(new CustomEvent("circle:session-expired"));
      } catch {}
    }
    return Promise.reject(err);
  }
);

export const fileUrl = (id) => (id ? `/api/files/${id}` : "");
export const wsUrl = () => {
  const token = getAuthToken();
  const uid = getAuthUserId();
  const base = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ws`;
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (uid) params.set("user_id", uid);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};

export function errMsg(e, fallback = "Something went wrong") {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return e?.message || fallback;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await api.post("/upload", fd);
  return data;
}

export async function downloadFrom(path, params, filename) {
  const res = await api.get(path, { params, responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return res;
}
