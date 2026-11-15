import axios from "axios";

export const BASE = "";
export const api = axios.create({ baseURL: `/api`, withCredentials: true });

let activeTabUserId = null;
let activeAuthToken = null;

export function setAuthToken(token) {
  activeAuthToken = token || null;
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
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const reqUrl = String(err?.config?.url || "");
    const isPublicOrLogin =
      reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/register") ||
      reqUrl.includes("/auth/forgot-password") ||
      reqUrl.includes("/auth/reset-with-recovery-key") ||
      reqUrl.includes("/auth/google") ||
      reqUrl.includes("/workspace/persistence-status") ||
      reqUrl.includes("/workspace/auto-hydrate") ||
      reqUrl.includes("/public/");
    if (status === 401 && !isPublicOrLogin && (getAuthToken() || getAuthUserId())) {
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
