export function isSystemNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isServiceWorkerSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export function isPushSupported() {
  return isServiceWorkerSupported() && typeof window !== "undefined" && "PushManager" in window;
}

export function isStandalonePWA() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true
  );
}

export function isInIframe() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getNotificationPermission() {
  if (!isSystemNotificationSupported()) return "unsupported";
  return window.Notification.permission || "default";
}

export function resolveNotificationUrl(notif) {
  if (!notif) return "/notifications";
  if (notif.link) return notif.link;
  if (notif.access_request) return "/settings";
  if (notif.conversation_id) return `/messages/${notif.conversation_id}`;
  if (notif.task_id) return `/tasks?task=${notif.task_id}`;
  return "/notifications";
}

async function getActiveSWRegistration() {
  if (!isServiceWorkerSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    const readyPromise = navigator.serviceWorker.ready;
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
    return await Promise.race([readyPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function showSystemNotification(notif, options = {}) {
  const { force = false, alwaysWhenVisible = false, onNavigate = null } = options;
  if (!isSystemNotificationSupported() || window.Notification.permission !== "granted") {
    return false;
  }

  const isAppHiddenOrUnfocused =
    typeof document !== "undefined" ? document.hidden || !document.hasFocus() : true;
  if (!force && !alwaysWhenVisible && !isAppHiddenOrUnfocused) {
    return false;
  }

  const title = notif?.title || "CIRCLE Workspace";
  const body = notif?.body || "Ada pembaruan baru di CIRCLE Workspace.";
  const targetUrl = resolveNotificationUrl(notif);
  const tag = String(notif?.tag || notif?.conversation_id || notif?.task_id || notif?.id || `circle-${Date.now()}`);

  const swReg = await getActiveSWRegistration();
  if (swReg && typeof swReg.showNotification === "function") {
    try {
      await swReg.showNotification(title, {
        body,
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag,
        renotify: true,
        vibrate: [120, 60, 120],
        data: {
          url: targetUrl,
          id: notif?.id || null,
          type: notif?.type || "general",
          conversation_id: notif?.conversation_id || null,
          task_id: notif?.task_id || null,
        },
      });
      return true;
    } catch {
      // Fall through to standard Notification constructor on desktop if SW showNotification fails
    }
  }

  try {
    const n = new window.Notification(title, {
      body,
      icon: "/pwa-192x192.png",
      tag,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      if (typeof onNavigate === "function") {
        onNavigate(targetUrl);
      } else {
        window.dispatchEvent(new CustomEvent("circle:navigate", { detail: { url: targetUrl } }));
      }
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export async function syncPushSubscription(api) {
  if (!isPushSupported() || getNotificationPermission() !== "granted") {
    return { subscribed: false };
  }
  try {
    const swReg = await getActiveSWRegistration();
    if (!swReg?.pushManager) return { subscribed: false };

    let sub = await swReg.pushManager.getSubscription();
    if (!sub) {
      const { data } = await api.get("/notifications/push/public-key");
      const publicKey = data?.publicKey;
      if (!publicKey) return { subscribed: false };
      sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    if (sub) {
      await api.post("/notifications/push/subscribe", { subscription: sub.toJSON() });
      return { subscribed: true, endpoint: sub.endpoint };
    }
  } catch {
    // Push subscription can fail in unsupported preview environments; local SW notifications still work
  }
  return { subscribed: false };
}

export async function enableSystemAndPushNotifications(api) {
  if (!isSystemNotificationSupported()) {
    return { permission: "unsupported", pushSubscribed: false };
  }
  const permission = await window.Notification.requestPermission();
  let pushSubscribed = false;
  if (permission === "granted" && api) {
    const pushRes = await syncPushSubscription(api);
    pushSubscribed = Boolean(pushRes?.subscribed);
  }
  return { permission, pushSubscribed };
}

export function syncAppBadge(count) {
  if (typeof navigator === "undefined") return;
  try {
    const num = Number(count || 0);
    if (num > 0 && typeof navigator.setAppBadge === "function") {
      navigator.setAppBadge(num).catch(() => {});
    } else if (num <= 0 && typeof navigator.clearAppBadge === "function") {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch {}
}
