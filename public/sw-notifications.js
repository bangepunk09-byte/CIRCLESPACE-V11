// CIRCLE Workspace PWA Service Worker Extension: System Push & Notification Click Handling

self.addEventListener("push", function (event) {
  if (!event) return;
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch {
      data = {};
    }
  }

  const title = data.title || "CIRCLE Workspace";
  const targetUrl =
    data.url ||
    (data.conversation_id
      ? "/messages/" + data.conversation_id
      : data.task_id
      ? "/tasks?task=" + data.task_id
      : data.access_request
      ? "/settings"
      : "/notifications");

  const options = {
    body: data.body || "Ada pembaruan baru di CIRCLE Workspace.",
    icon: data.icon || "/pwa-192x192.png",
    badge: data.badge || "/pwa-192x192.png",
    tag: data.tag || data.id || "circle-notif",
    renotify: true,
    vibrate: [120, 60, 120],
    data: {
      url: targetUrl,
      id: data.id || null,
      type: data.type || "general",
      conversation_id: data.conversation_id || null,
      task_id: data.task_id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || "/notifications";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if ("focus" in client) {
            return client.focus().then(function (focused) {
              try {
                focused.postMessage({ type: "CIRCLE_NAVIGATE", url: targetUrl });
              } catch {}
              return focused;
            });
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
