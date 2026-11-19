import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  MessageCircle,
  Hash,
  Users,
  Network,
  CheckSquare,
  FolderKanban,
  Bell,
  Settings,
  Search,
  Moon,
  Sun,
  LogOut,
  Menu,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Newspaper,
  CalendarDays,
  Volume2,
  VolumeX,
  HardDrive,
  ChevronRight,
  ChevronDown,
  Check,
  User as UserIcon,
  ShoppingBag
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { Avatar, Logo, AVAILABILITY_STATUS_OPTIONS, getAvailabilityStatusMeta, VerifiedBadge } from "./common";
import SearchDialog from "./SearchDialog";
import { NotificationRail } from "./NotificationPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { isSoundEnabled, setSoundEnabled, playSound } from "../lib/sound";
import TopNotificationPopup from "./TopNotificationPopup";
import { PWAInstallButton, OfflineIndicator } from "./PWAInstallButton";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { preloadRoute } from "../lib/routePreload";

const NAV = [
  { to: "/", icon: Home, label: "Dashboard", id: "home", group: "main" },
  { to: "/beranda", icon: Newspaper, label: "Beranda", id: "beranda", group: "main" },
  { to: "/messages", icon: MessageCircle, label: "Pesan", id: "messages", group: "main" },
  { to: "/schedule", icon: CalendarDays, label: "Jadwal", id: "schedule", group: "collab" },
  { to: "/groups", icon: Hash, label: "Grup", id: "groups", group: "collab" },
  { to: "/directory", icon: HardDrive, label: "Direktori Drive", id: "directory", group: "collab" },
  { to: "/marketplace", icon: ShoppingBag, label: "Marketplace", id: "marketplace", group: "collab", requiresMarketplace: true },
  { to: "/employee", icon: Users, label: "Karyawan", id: "employee", group: "org" },
  { to: "/org", icon: Network, label: "Struktur Organisasi", id: "org", group: "org" },
  { to: "/tasks", icon: CheckSquare, label: "Tugas", id: "tasks", group: "main" },
  { to: "/projects", icon: FolderKanban, label: "Proyek", id: "projects", group: "org" },
  { to: "/settings", icon: Settings, label: "Pengaturan", id: "settings", group: "sys" },
];

const MOBILE_TABS = [
  { to: "/", icon: Home, label: "Dashboard", id: "home" },
  { to: "/beranda", icon: Newspaper, label: "Beranda", id: "beranda" },
  { to: "/messages", icon: MessageCircle, label: "Pesan", id: "messages" },
  { to: "/tasks", icon: CheckSquare, label: "Tugas", id: "tasks" },
];

function NavItem({ item, compact, unread, onClick }) {
  const { t } = useApp();
  const Icon = item.icon;
  const label = t(`nav_${item.id}`, item.label);
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onClick}
      onMouseEnter={() => preloadRoute(item.to)}
      onFocus={() => preloadRoute(item.to)}
      onTouchStart={() => preloadRoute(item.to)}
      data-testid={`sidebar-${item.id}-link`}
      title={label}
      className={({ isActive }) =>
        `group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
          isActive ? "bg-surface2 text-ink font-semibold" : "text-sub hover:bg-surface2 hover:text-ink"
        } ${compact ? "justify-center px-0" : ""}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-brand" />}
          <Icon size={18} className={isActive ? "text-brand" : ""} />
          {!compact && <span className="flex-1 truncate">{label}</span>}
          {item.id === "notifications" && unread > 0 && (
            <span
              className={`rounded-full bg-brand px-1.5 text-[10px] font-bold text-white ${
                compact ? "absolute right-1 top-1" : ""
              }`}
              data-testid="unread-count"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}


function Sidebar({ compact, setCompact, openSearch }) {
  const { me, ws, savePrefs, logout, unread, isDemo, t, updateAvailabilityStatus } = useApp();
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const { isInstalled } = usePWAInstall();
  const navigate = useNavigate();
  const dark = document.documentElement.classList.contains("dark");
  const currentStatusMeta = getAvailabilityStatusMeta(me?.availability_status);

  const handleSelectStatus = async (statusValue) => {
    setStatusMenuOpen(false);
    const meta = getAvailabilityStatusMeta(statusValue);
    await updateAvailabilityStatus?.(statusValue);
    toast.success(`Status diubah ke ${meta.label}`);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSound("click");
  };
  return (
    <aside
      className={`hidden md:flex fixed inset-y-0 left-0 z-40 h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ${
        compact ? "w-[76px]" : "w-[248px]"
      }`}
      data-testid="sidebar"
    >
      <div className={`flex items-center gap-2.5 p-4 ${compact ? "justify-center" : ""}`}>
        <Logo ws={ws} />
        {!compact && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold tracking-tight" data-testid="workspace-brand">
              {ws?.brand_name || "CIRCLE"}
            </p>
            <p className="truncate text-xs text-sub" data-testid="workspace-name">
              {ws?.name}
              {isDemo && " · Demo"}
            </p>
          </div>
        )}
        <button
          onClick={() => setCompact(!compact)}
          className="btn-ghost hidden h-8 w-8 items-center justify-center lg:flex text-sub"
          aria-label="Toggle sidebar"
          data-testid="sidebar-collapse-btn"
        >
          {compact ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      {isDemo && !compact && (
        <div
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-soft-yellow px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200"
          data-testid="demo-banner"
        >
          <FlaskConical size={14} />
          Mode Demo · Data Contoh
        </div>
      )}
      <div className="px-3">
        <button
          onClick={openSearch}
          className={`flex h-10 w-full items-center gap-2 rounded-xl border bg-surface2 px-3 text-sm text-sub ${
            compact ? "justify-center px-0" : ""
          }`}
          data-testid="sidebar-search-btn"
        >
          <Search size={16} />
          {!compact && (
            <>
              <span className="flex-1 text-left">{t("nav_search")}</span>
              <kbd className="rounded-md border bg-surface px-1.5 text-[10px]">Ctrl K</kbd>
            </>
          )}
        </button>
      </div>
      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 scroll-thin">
        {NAV.filter((n) => !n.requiresMarketplace || ws?.marketplace_enabled !== false).map((n) => (
          <NavItem key={n.id} item={n} compact={compact} unread={unread} />
        ))}
      </nav>
      <div className="border-t border-slate-200/70 dark:border-slate-800/70 px-2.5 py-2.5 space-y-1.5 relative">
        {statusMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setStatusMenuOpen(false)}
            />
            <div
              className={`absolute bottom-full mb-1.5 z-50 rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-surface p-2 shadow-xl animate-in fade-in zoom-in-95 duration-150 ${
                compact ? "left-2.5 w-48" : "inset-x-2.5"
              }`}
              data-testid="sidebar-status-menu"
            >
              <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sub">
                Pilih Status
              </p>
              <div className="mt-0.5 space-y-0.5">
                {AVAILABILITY_STATUS_OPTIONS.map((opt) => {
                  const isActive = currentStatusMeta.value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleSelectStatus(opt.value)}
                      data-testid={`status-option-${opt.value}`}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors ${
                        isActive
                          ? opt.activeRowClass
                          : "text-ink hover:bg-surface2"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${opt.dotClass}`} />
                        <span>{opt.label}</span>
                      </span>
                      {isActive && <Check size={14} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 border-t border-slate-200/70 dark:border-slate-800 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setStatusMenuOpen(false);
                    navigate(`/people/${me.user_id}`);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-sub hover:bg-surface2 hover:text-ink transition-colors"
                >
                  <UserIcon size={13} />
                  <span>Lihat Profil Saya</span>
                </button>
              </div>
            </div>
          </>
        )}

        <div
          className={`flex w-full items-center rounded-xl bg-surface2/60 transition-colors hover:bg-surface2 ${
            compact ? "flex-col justify-center p-1.5 gap-1.5" : "gap-2.5 px-2.5 py-2"
          }`}
        >
          <button
            type="button"
            onClick={() => (compact ? setStatusMenuOpen((v) => !v) : navigate(`/people/${me.user_id}`))}
            className="shrink-0 rounded-full focus:outline-none"
            data-testid="sidebar-profile-btn"
            title={`${me.name} (${currentStatusMeta.label})`}
          >
            <Avatar user={me} size={compact ? 34 : 36} />
          </button>
          {!compact ? (
            <>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigate(`/people/${me.user_id}`)}
                  className="flex w-full items-center gap-1 truncate text-left text-[13px] font-bold text-ink leading-tight hover:text-brand transition-colors"
                >
                  <span className="truncate">{me.name}</span>
                  <VerifiedBadge user={me} size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setStatusMenuOpen((v) => !v)}
                  data-testid="sidebar-status-trigger"
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold leading-none transition-all hover:opacity-90 ${currentStatusMeta.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${currentStatusMeta.dotClass}`} />
                  <span>{currentStatusMeta.label}</span>
                  <ChevronDown size={11} className="opacity-75" />
                </button>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-colors"
                aria-label="Log out"
                title={t("nav_logout", "Keluar Akun")}
                data-testid="logout-btn"
              >
                <LogOut size={15} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setStatusMenuOpen((v) => !v)}
              data-testid="sidebar-status-trigger-compact"
              title={`Status: ${currentStatusMeta.label}`}
              className={`inline-flex items-center justify-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${currentStatusMeta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentStatusMeta.dotClass}`} />
            </button>
          )}
        </div>

        <div className={`flex items-center ${compact ? "flex-col gap-1" : "gap-1.5"}`}>
          {!compact && <PWAInstallButton variant="sidebar" compact={false} />}
          <div
            className={`rounded-lg border border-slate-200/70 dark:border-slate-800/80 bg-surface2/60 p-0.5 ${
              compact
                ? "flex flex-col items-center gap-0.5 w-full"
                : !isInstalled
                ? "flex items-center shrink-0 gap-0.5"
                : "flex items-center w-full gap-0.5"
            }`}
          >
            <button
              onClick={toggleSound}
              className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-sub hover:bg-surface hover:text-ink transition-colors ${
                !compact && isInstalled ? "flex-1 px-2 text-[11px] font-medium" : "w-7"
              }`}
              aria-label="Toggle sound"
              title={soundOn ? "Sound FX: Aktif" : "Sound FX: Mute"}
              data-testid="sound-toggle-btn"
            >
              {soundOn ? <Volume2 size={14} className="text-brand" /> : <VolumeX size={14} />}
              {!compact && isInstalled && <span>{soundOn ? "Suara" : "Senyap"}</span>}
            </button>
            <button
              onClick={() => savePrefs({ theme_mode: dark ? "light" : "dark" })}
              className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-sub hover:bg-surface hover:text-ink transition-colors ${
                !compact && isInstalled ? "flex-1 px-2 text-[11px] font-medium" : "w-7"
              }`}
              aria-label="Toggle theme"
              title={dark ? "Mode Terang" : "Mode Gelap"}
              data-testid="theme-toggle-btn"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {!compact && isInstalled && <span>{dark ? "Terang" : "Gelap"}</span>}
            </button>
            {compact && (
              <button
                onClick={logout}
                className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-colors"
                aria-label="Log out"
                title={t("nav_logout", "Keluar Akun")}
                data-testid="logout-btn"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
          {compact && <PWAInstallButton variant="sidebar" compact={true} />}
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ openSearch }) {
  const [more, setMore] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const { unread, me, logout, ws, savePrefs, isDemo, t, updateAvailabilityStatus } = useApp();
  const loc = useLocation();
  const navigate = useNavigate();
  const dark = document.documentElement.classList.contains("dark");
  const currentStatusMeta = getAvailabilityStatusMeta(me?.availability_status);

  const handleMobileStatusSelect = async (statusValue) => {
    const meta = getAvailabilityStatusMeta(statusValue);
    await updateAvailabilityStatus?.(statusValue);
    toast.success(`Status diubah ke ${meta.label}`);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSound("click");
  };

  const currentNav = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)));
  const activeTitle = currentNav ? t(`nav_${currentNav.id}`, currentNav.label) : (ws?.brand_name || "CIRCLE");

  const marketplaceOn = ws?.marketplace_enabled !== false;
  const collabItems = NAV.filter(
    (n) => ["schedule", "directory", "groups", "marketplace"].includes(n.id) && (!n.requiresMarketplace || marketplaceOn)
  );
  const orgItems = NAV.filter((n) => ["employee", "org", "projects"].includes(n.id));
  const sysItems = NAV.filter((n) => ["settings"].includes(n.id));

  return (
    <>
      {/* Mobile Top App Bar (48px height, clean 3-zone structure) */}
      <header
        className="md:hidden shrink-0 z-30 flex min-h-12 w-full max-w-full items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 pt-safe select-none"
        data-testid="mobile-header"
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 min-w-0 text-left py-1"
        >
          <Logo size={26} ws={ws} />
          <div className="min-w-0">
            <span className="block truncate text-[13px] font-extrabold tracking-tight text-ink leading-snug">
              {ws?.brand_name || "CIRCLE"}
            </span>
            <span className="block truncate text-[10.5px] font-medium text-sub leading-snug">
              {activeTitle}
              {isDemo ? " · Demo" : ""}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <PWAInstallButton variant="mobile-header" />
          <button
            type="button"
            onClick={openSearch}
            className="btn-ghost flex h-10 w-10 items-center justify-center rounded-xl text-sub hover:text-ink"
            aria-label="Cari di Workspace"
            data-testid="mobile-search-btn"
          >
            <Search size={18} />
          </button>
          <NavLink
            to="/notifications"
            className="btn-ghost relative flex h-10 w-10 items-center justify-center rounded-xl text-sub hover:text-ink"
            aria-label="Notifikasi"
            data-testid="mobile-notifications-btn"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-[16px] rounded-full bg-brand px-1 text-center text-[9px] font-bold leading-4 text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </NavLink>
        </div>
      </header>

      {/* Mobile Fixed Bottom Navigation Bar (56px ergonomic thumb zone) */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 grid w-full max-w-[100vw] grid-cols-5 items-center min-h-14 border-t border-slate-200/90 dark:border-slate-800/90 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe select-none touch-none"
        data-testid="mobile-bottom-nav"
      >
        {MOBILE_TABS.map((n) => (
          <NavLink
            key={n.id}
            to={n.to}
            end={n.to === "/"}
            data-testid={`mobile-nav-${n.id}`}
            className={({ isActive }) =>
              `relative flex h-14 min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? "text-brand font-bold" : "text-sub font-medium hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 h-0.5 w-7 rounded-full bg-brand" />
                )}
                <n.icon size={19} strokeWidth={isActive ? 2.4 : 2} />
                <span className="text-[10px] tracking-tight leading-tight pb-0.5">{t(`nav_${n.id}`, n.label)}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMore(true)}
          className={`relative flex h-14 min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
            more ? "text-brand font-bold" : "text-sub font-medium hover:text-ink"
          }`}
          data-testid="mobile-nav-more"
        >
          <Menu size={19} />
          <span className="text-[10px] tracking-tight leading-tight pb-0.5">{t("nav_menu", "Menu")}</span>
        </button>
      </nav>

      {/* Structured Mobile Workspace Menu Sheet */}
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] w-full max-w-[100vw] overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-3xl bg-surface px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-base font-extrabold text-ink">Menu Workspace</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            {/* Profile Card + Status Selector */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/60 p-3 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setMore(false);
                  navigate(`/people/${me.user_id}`);
                }}
                className="flex w-full items-center justify-between gap-3 text-left hover:opacity-90 transition-opacity"
                data-testid="more-nav-profile"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={me} size={42} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate text-sm font-bold text-ink">
                      <span className="truncate">{me.name}</span>
                      <VerifiedBadge user={me} size={14} />
                    </p>
                    <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${currentStatusMeta.badgeClass}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${currentStatusMeta.dotClass}`} />
                      <span>{currentStatusMeta.label}</span>
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand shrink-0">
                  {t("nav_profile", "Profil")} <ChevronRight size={14} />
                </span>
              </button>

              <div className="border-t border-slate-200/70 dark:border-slate-800/80 pt-2.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-sub">
                  Status Kehadiran
                </p>
                <div className="grid grid-cols-4 gap-1.5" data-testid="mobile-status-selector">
                  {AVAILABILITY_STATUS_OPTIONS.map((opt) => {
                    const isActive = currentStatusMeta.value === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleMobileStatusSelect(opt.value)}
                        data-testid={`mobile-status-${opt.value}`}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition-all ${
                          isActive
                            ? opt.badgeClass
                            : "border-slate-200/70 dark:border-slate-800 bg-surface text-sub hover:text-ink"
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dotClass}`} />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* PWA Install Banner inside Drawer */}
            <PWAInstallButton variant="card" />

            {/* Section 1: Kolaborasi & Direktori */}
            <div>
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-sub">
                Jadwal & Direktori Drive
              </p>
              <div className={`grid gap-2 ${collabItems.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
                {collabItems.map((n) => (
                  <NavLink
                    key={n.id}
                    to={n.to}
                    onClick={() => setMore(false)}
                    onMouseEnter={() => preloadRoute(n.to)}
                    onTouchStart={() => preloadRoute(n.to)}
                    data-testid={`more-nav-${n.id}`}
                    className={({ isActive }) =>
                      `flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-2.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-slate-200/70 dark:border-slate-800 bg-surface2/60 text-ink hover:bg-surface2"
                      }`
                    }
                  >
                    <n.icon size={20} className="text-brand shrink-0" />
                    <span className="text-center text-[11px] leading-snug pb-0.5 line-clamp-2 max-w-full">{t(`nav_${n.id}`, n.label)}</span>
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Section 2: Organisasi & Proyek */}
            <div>
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-sub">
                Organisasi & Proyek
              </p>
              <div className="grid grid-cols-3 gap-2">
                {orgItems.map((n) => (
                  <NavLink
                    key={n.id}
                    to={n.to}
                    onClick={() => setMore(false)}
                    onMouseEnter={() => preloadRoute(n.to)}
                    onTouchStart={() => preloadRoute(n.to)}
                    data-testid={`more-nav-${n.id}`}
                    className={({ isActive }) =>
                      `flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-2.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-slate-200/70 dark:border-slate-800 bg-surface2/60 text-ink hover:bg-surface2"
                      }`
                    }
                  >
                    <n.icon size={20} className="text-brand shrink-0" />
                    <span className="text-center text-[11px] leading-snug pb-0.5 line-clamp-2 max-w-full">{t(`nav_${n.id}`, n.label)}</span>
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Section 3: Pengaturan & Preferensi */}
            <div>
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-sub">
                Pengaturan & Sistem
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sysItems.map((n) => (
                  <NavLink
                    key={n.id}
                    to={n.to}
                    onClick={() => setMore(false)}
                    data-testid={`more-nav-${n.id}`}
                    className="flex h-12 items-center gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/60 px-3.5 text-xs font-semibold text-ink hover:bg-surface2"
                  >
                    <n.icon size={18} className="text-brand shrink-0" />
                    <span>{t(`nav_${n.id}`, n.label)}</span>
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={() => savePrefs({ theme_mode: dark ? "light" : "dark" })}
                  className="flex h-12 items-center gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/60 px-3.5 text-xs font-semibold text-ink hover:bg-surface2"
                >
                  {dark ? <Sun size={18} className="text-amber-500 shrink-0" /> : <Moon size={18} className="text-brand shrink-0" />}
                  <span>{dark ? "Mode Terang" : "Mode Gelap"}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleSound}
                  className="flex h-12 items-center gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/60 px-3.5 text-xs font-semibold text-ink hover:bg-surface2"
                >
                  {soundOn ? <Volume2 size={18} className="text-emerald-600 shrink-0" /> : <VolumeX size={18} className="text-sub shrink-0" />}
                  <span>{soundOn ? "Suara: Aktif" : "Suara: Mute"}</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  data-testid="more-nav-logout"
                  className="flex h-12 items-center gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/30 px-3.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
                >
                  <LogOut size={18} className="shrink-0" />
                  <span>{t("nav_logout", "Keluar Akun")}</span>
                </button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function Shell() {
  const { prefs, topNotif, closeTopNotif } = useApp();
  const [search, setSearch] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [compact, setCompactState] = useState(() => window.innerWidth < 1024 || !!prefs.sidebar_compact);
  const loc = useLocation();
  const chatOpen = /^\/messages\/.+/.test(loc.pathname);
  const isMessagesRoot = loc.pathname === "/messages";

  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    const r = () => window.innerWidth < 1024 && setCompactState(true);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  const setCompact = setCompactState;
  return (
    <>
      <TopNotificationPopup notif={topNotif} onClose={closeTopNotif} />
      <OfflineIndicator />
      <div className="fixed inset-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] bg-background overflow-hidden overscroll-none print:static print:h-auto print:max-h-none print:overflow-visible">
        <Sidebar compact={compact} setCompact={setCompact} openSearch={() => setSearch(true)} />
        <div className={`flex h-full max-h-[100dvh] min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 ${compact ? "md:ml-[76px]" : "md:ml-[248px]"} ${notifOpen ? "md:mr-[320px] xl:md:mr-[360px]" : "md:mr-[60px]"} print:!ml-0 print:!mr-0 print:h-auto print:max-h-none print:overflow-visible`}>
          {!chatOpen && <MobileNav openSearch={() => setSearch(true)} />}
          <main
            className={`min-w-0 min-h-0 flex-1 w-full max-w-full overflow-x-hidden overscroll-y-contain ${
              chatOpen || isMessagesRoot
                ? "overflow-hidden"
                : "overflow-y-auto pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0"
            } print:!pb-0 print:overflow-visible`}
          >
            <div className={`${chatOpen || isMessagesRoot ? "h-full max-h-full" : "min-h-full"} w-full max-w-full min-w-0 overflow-x-hidden`}>
              <Outlet />
            </div>
          </main>
        </div>
        <NotificationRail open={notifOpen} setOpen={setNotifOpen} />
      </div>
      <SearchDialog open={search} onOpenChange={setSearch} />
    </>
  );
}
