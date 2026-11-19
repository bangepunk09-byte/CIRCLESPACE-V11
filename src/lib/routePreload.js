// Shared dynamic import loaders so React.lazy routes and hover-prefetching share identical chunks.
export const routeLoaders = {
  "/login": () => import("../pages/Login"),
  "/": () => import("../pages/Dashboard"),
  "/beranda": () => import("../pages/Beranda"),
  "/messages": () => import("../pages/Messages"),
  "/groups": () => import("../pages/Groups"),
  "/directory": () => import("../pages/Directory"),
  "/employee": () => import("../pages/Employees"),
  "/people": () => import("../pages/Profile"),
  "/org": () => import("../pages/Org"),
  "/tasks": () => import("../pages/Tasks"),
  "/schedule": () => import("../pages/Schedule"),
  "/projects": () => import("../pages/Projects"),
  "/marketplace": () => import("../pages/Marketplace"),
  "/settings": () => import("../pages/Settings"),
  "/onboarding": () => import("../pages/Onboarding"),
};

const prefetched = new Set();

export function preloadRoute(path) {
  if (!path || typeof path !== "string") return;
  const normalized = path === "/" ? "/" : `/${path.split("/").filter(Boolean)[0] || ""}`;
  if (prefetched.has(normalized)) return;
  const loader = routeLoaders[normalized];
  if (!loader) return;
  prefetched.add(normalized);
  try {
    void loader().catch(() => {
      prefetched.delete(normalized);
    });
  } catch {
    prefetched.delete(normalized);
  }
}
