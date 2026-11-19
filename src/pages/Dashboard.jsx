import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  CheckSquare,
  Clock,
  Video,
  ChevronRight,
  Plus,
  CalendarDays,
  CheckCircle2,
  Image,
  ExternalLink,
  BarChart3,
  TrendingUp,
  SlidersHorizontal,
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  LayoutGrid,
  Columns,
  Maximize2,
  Check,
  Move,
  FolderKanban,
  ShieldCheck,
  Pin,
  Pencil,
  StickyNote
} from "lucide-react";
import StickyNotesWidget from "../components/StickyNotesWidget";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl } from "../lib/api";
import { hasCompletedInitialHydrate } from "../lib/persistentMirror";
import { bgLayer } from "../lib/theme";
import { AvatarStack, AccentButton, GhostButton } from "../components/common";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../components/ui/sheet";
import BackgroundEditor from "./settings/BackgroundEditor";
import TaskCreate from "./tasks/TaskCreate";
import TaskDetail from "./tasks/TaskDetail";
const MonthlyStats = lazy(() => import("./dashboard/MonthlyStats"));
import { playSound } from "../lib/sound";

const DEFAULT_WIDGET_CONFIG = {
  columns: ["meetings", "tasks", "messages"],
  visible: {
    meetings: true,
    tasks: true,
    messages: true,
    performance: true,
    personnel: true,
    drive_directory: true
  },
  gridStyle: "3col", // '3col' | '2col' | 'focus'
  density: "spacious" // 'spacious' | 'normal' | 'compact'
};

const getWidgetLabels = (t) => ({
  meetings: {
    title: t("dash_meetings_title", "Jadwal Rapat Mendatang"),
    desc: "Agenda rapat Google Calendar & Google Meet",
    icon: Video,
    color: "emerald"
  },
  tasks: {
    title: t("dash_tasks_title", "Tugas Prioritas Hari Ini"),
    desc: "Checklist tugas operasional & deadline aktif",
    icon: CheckSquare,
    color: "amber"
  },
  messages: {
    title: t("dash_messages_title", "Sticky Notes Checklist"),
    desc: "Catatan tempel, checklist progres %, arsip & kirim ke grup",
    icon: StickyNote,
    color: "amber"
  }
});

import { INITIAL_TASKS } from "../data/initialTasks";
import {
  getCachedDriveShortcuts,
  setCachedDriveShortcuts,
  hasShortcutAccess
} from "../data/initialDriveShortcuts";
import {
  DriveIcon,
  DriveShortcutDialog,
  DriveAccessDialog,
  GoogleDriveBrowserDialog
} from "./Directory";

export default function Dashboard() {
  const { me, prefs, users, t, subscribe, tasks: ctxTasks } = useApp();
  // Dashboard Data Caching & Hydration
  const [tasks, setTasks] = useState(() => {
    if (Array.isArray(ctxTasks) && ctxTasks.length > 0) return ctxTasks;
    try {
      const saved = localStorage.getItem("circle_cache_tasks");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return INITIAL_TASKS.slice(0, 8);
  });
  useEffect(() => {
    if (Array.isArray(ctxTasks) && ctxTasks.length > 0) {
      setTasks(ctxTasks);
    }
  }, [ctxTasks]);
  const [meetings, setMeetings] = useState(() => {
    try {
      const saved = localStorage.getItem("circle_cache_meetings");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [driveShortcuts, setDriveShortcuts] = useState(() => getCachedDriveShortcuts());
  const [driveCatFilter, setDriveCatFilter] = useState("ALL");
  const [showAllMobileDrive, setShowAllMobileDrive] = useState(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState(null);
  const [accessDialogShortcut, setAccessDialogShortcut] = useState(null);
  const [driveBrowserOpen, setDriveBrowserOpen] = useState(false);

  const [bgOpen, setBgOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const navigate = useNavigate();

  // Widget Layout Configuration
  const [widgetLayout, setWidgetLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("circle_dashboard_layout_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_WIDGET_CONFIG,
          ...parsed,
          visible: { ...DEFAULT_WIDGET_CONFIG.visible, ...(parsed.visible || {}) }
        };
      }
    } catch (e) {
      // ignore
    }
    return DEFAULT_WIDGET_CONFIG;
  });

  const updateLayout = (updater) => {
    setWidgetLayout((prev) => {
      const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      try {
        localStorage.setItem("circle_dashboard_layout_v2", JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });
  };

  const moveColumn = (colKey, direction) => {
    playSound("click");
    updateLayout((prev) => {
      const cols = [...prev.columns];
      const idx = cols.indexOf(colKey);
      if (idx === -1) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= cols.length) return prev;
      const temp = cols[idx];
      cols[idx] = cols[targetIdx];
      cols[targetIdx] = temp;
      return { ...prev, columns: cols };
    });
  };

  const toggleWidget = (widgetKey) => {
    playSound("click");
    updateLayout((prev) => ({
      ...prev,
      visible: {
        ...prev.visible,
        [widgetKey]: !prev.visible[widgetKey]
      }
    }));
  };

  const resetLayout = () => {
    playSound("click");
    updateLayout(DEFAULT_WIDGET_CONFIG);
    toast.success("Tata letak dikembalikan ke pengaturan default.");
  };

  const loadData = async () => {
    try {
      const needTasks = !Array.isArray(ctxTasks) || ctxTasks.length === 0;
      const needDrive = !Array.isArray(driveShortcuts) || driveShortcuts.length === 0;
      const [tRes, mRes, dRes] = await Promise.all([
        needTasks ? api.get("/tasks") : Promise.resolve({ data: null }),
        api.get("/meetings").catch(() => ({ data: [] })),
        needDrive ? api.get("/drive-shortcuts").catch(() => ({ data: null })) : Promise.resolve({ data: null })
      ]);

      if (tRes?.data && ((Array.isArray(tRes.data) && tRes.data.length > 0) || hasCompletedInitialHydrate())) {
        setTasks(tRes.data || []);
        try { localStorage.setItem("circle_cache_tasks", JSON.stringify(tRes.data || [])); } catch {}
      }
      setMeetings(mRes.data || []);
      if (Array.isArray(dRes.data)) {
        setDriveShortcuts(dRes.data);
        setCachedDriveShortcuts(dRes.data);
      }

      // Update Cache
      if ((Array.isArray(mRes.data) && mRes.data.length > 0) || hasCompletedInitialHydrate()) {
        try { localStorage.setItem("circle_cache_meetings", JSON.stringify(mRes.data || [])); } catch {}
      }
    } catch (e) {
      console.warn("Failed to load dashboard data:", e);
    }
  };

  useEffect(() => {
    loadData();
  }, [me?.user_id]);

  useEffect(
    () =>
      subscribe((evt) => {
        if (evt.type === "drive_shortcuts:changed" && Array.isArray(evt.data)) {
          setDriveShortcuts(evt.data);
          setCachedDriveShortcuts(evt.data);
        }
        if (evt.type === "tasks:changed") {
          if (evt.deleted_id) {
            setTasks((prev) => {
              const next = (Array.isArray(prev) ? prev : []).filter((x) => x.id !== evt.deleted_id);
              try { localStorage.setItem("circle_cache_tasks", JSON.stringify(next)); } catch {}
              return next;
            });
          } else if (evt.task?.id) {
            setTasks((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              const exists = list.some((x) => x.id === evt.task.id);
              const next = exists
                ? list.map((x) => (x.id === evt.task.id ? { ...x, ...evt.task } : x))
                : [evt.task, ...list];
              try { localStorage.setItem("circle_cache_tasks", JSON.stringify(next)); } catch {}
              return next;
            });
          } else {
            api.get("/tasks").then((r) => {
              if (Array.isArray(r.data)) {
                setTasks(r.data);
                try { localStorage.setItem("circle_cache_tasks", JSON.stringify(r.data)); } catch {}
              }
            }).catch(() => {});
          }
        }
        if (evt.type === "tasks:deleted" && evt.id) {
          setTasks((prev) => {
            const next = (Array.isArray(prev) ? prev : []).filter((x) => x.id !== evt.id);
            try {
              localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
              localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
            } catch {}
            return next;
          });
        }
        if (evt.type === "meeting:new" && evt.data) {
          setMeetings((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = [...list.filter((m) => m.id !== evt.data.id), evt.data];
            try { localStorage.setItem("circle_cache_meetings", JSON.stringify(next)); } catch {}
            return next;
          });
        }
        if (evt.type === "meeting:update" && evt.data) {
          setMeetings((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.map((m) => (m.id === evt.data.id ? evt.data : m));
            try { localStorage.setItem("circle_cache_meetings", JSON.stringify(next)); } catch {}
            return next;
          });
        }
        if (evt.type === "meeting:delete" && evt.id) {
          setMeetings((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.filter((m) => m.id !== evt.id);
            try { localStorage.setItem("circle_cache_meetings", JSON.stringify(next)); } catch {}
            return next;
          });
        }
        if (evt.type === "meetings:synced" && Array.isArray(evt.data)) {
          setMeetings(evt.data);
          try { localStorage.setItem("circle_cache_meetings", JSON.stringify(evt.data)); } catch {}
        }
      }),
    [subscribe]
  );

  const humanUsers = (users || []).filter(
    (u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
  const divisionsList = [...new Set(humanUsers.map((u) => u.department || "Lainnya"))].sort();

  // Strictly filter shortcuts on Dashboard so ONLY shortcuts the current user has access to are shown
  const accessibleDashboardShortcuts = driveShortcuts
    .filter((s) => s.show_on_dashboard !== false && hasShortcutAccess(s, me))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  const dashboardDriveCategories = [
    "ALL",
    ...new Set(accessibleDashboardShortcuts.map((s) => s.category || "General"))
  ];

  const displayedDriveShortcuts = accessibleDashboardShortcuts.filter(
    (s) => driveCatFilter === "ALL" || (s.category || "General") === driveCatFilter
  );

  const handleSaveDashboardShortcut = (payload) => {
    const exists = driveShortcuts.some((s) => s.id === payload.id);
    let next;
    if (exists) {
      const updated = { ...payload, updated_at: new Date().toISOString() };
      next = driveShortcuts.map((s) => (s.id === payload.id ? updated : s));
      api.patch(`/drive-shortcuts/${payload.id}`, updated).catch((e) => toast.error(errMsg(e)));
      toast.success(`Shortcut "${payload.name}" berhasil diperbarui`);
    } else {
      const created = {
        ...payload,
        id: `drv_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        created_by: me?.user_id || "user_admin1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      next = [created, ...driveShortcuts];
      api.post("/drive-shortcuts", created).catch((e) => toast.error(errMsg(e)));
      toast.success(`Shortcut folder "${created.name}" berhasil ditambahkan`);
    }
    setDriveShortcuts(next);
    setCachedDriveShortcuts(next);
  };

  const handleSaveDashboardAccess = (shortcutId, patch) => {
    setDriveShortcuts((prev) => {
      const next = prev.map((s) =>
        s.id === shortcutId ? { ...s, ...patch, updated_at: new Date().toISOString() } : s
      );
      setCachedDriveShortcuts(next);
      return next;
    });
    toast.success("Akses member folder berhasil diperbarui");
    api.patch(`/drive-shortcuts/${shortcutId}`, patch).catch((e) => toast.error(errMsg(e)));
  };

  const toggleTaskDone = (t, e) => {
    e.stopPropagation();
    const isDone = t.status === "done";
    const nextStatus = isDone ? "in_progress" : "done";
    if (!isDone) {
      playSound("task_done");
    } else {
      playSound("click");
    }
    setTasks((prev) => {
      const next = prev.map((item) => (item.id === t.id ? { ...item, status: nextStatus, progress: !isDone ? 100 : 50 } : item));
      try {
        localStorage.setItem("circle_cache_tasks", JSON.stringify(next));
        localStorage.setItem("circle_tasks_cache", JSON.stringify(next));
      } catch {}
      return next;
    });
    toast.success(isDone ? `Tugas dikembalikan ke In Progress` : `Tugas selesai! (100%)`);
    api.patch(`/tasks/${t.id}`, { status: nextStatus }).catch((err) => {
      toast.error(errMsg(err));
      loadData();
    });
  };

  const layer = bgLayer(prefs.background, prefs.background?.file_id ? fileUrl(prefs.background.file_id) : null);
  const hour = new Date().getHours();
  const greet = hour < 12
    ? t("dash_greeting_morning", "Selamat Pagi")
    : hour < 17
    ? t("dash_greeting_afternoon", "Selamat Siang")
    : hour < 21
    ? t("dash_greeting_evening", "Selamat Sore")
    : t("dash_greeting_night", "Selamat Malam");

  // Data for Column 1: Meetings
  const displayMeetings = meetings.slice(0, 3);

  // Data for Column 2: Today's Priority Tasks (active non-archived tasks sorted by closest deadline)
  const todayTasks = (tasks || [])
    .filter((t) => t && !t.archived && t.status !== "done")
    .sort((a, b) => new Date(a.deadline || "9999-12-31").getTime() - new Date(b.deadline || "9999-12-31").getTime())
    .slice(0, 3);

  // Density Spacing Presets (Responsive mobile-first padding + spacious desktop)
  const densityStyles = {
    spacious: {
      outer: "space-y-5 sm:space-y-10 py-4 sm:py-8 px-3.5 sm:px-6 lg:px-8",
      gridGap: "gap-5 sm:gap-8",
      cardPadding: "p-4 sm:p-7 lg:p-8",
      cardHeader: "pb-3.5 sm:pb-5 mb-3.5 sm:mb-5",
      itemSpacing: "space-y-3 sm:space-y-4",
      itemPadding: "p-3.5 sm:p-5",
      footerMargin: "mt-5 sm:mt-7 pt-4 sm:pt-5"
    },
    normal: {
      outer: "space-y-5 sm:space-y-8 py-4 sm:py-6 px-3.5 sm:px-6 lg:px-8",
      gridGap: "gap-4 sm:gap-6",
      cardPadding: "p-4 sm:p-6 lg:p-7",
      cardHeader: "pb-3.5 sm:pb-5 mb-3.5 sm:mb-4",
      itemSpacing: "space-y-3 sm:space-y-3.5",
      itemPadding: "p-3.5 sm:p-4",
      footerMargin: "mt-4 sm:mt-6 pt-3.5 sm:pt-4"
    },
    compact: {
      outer: "space-y-4 sm:space-y-6 py-3.5 sm:py-4 px-3.5 sm:px-5 lg:px-6",
      gridGap: "gap-4 sm:gap-5",
      cardPadding: "p-4 sm:p-5",
      cardHeader: "pb-3 sm:pb-4 mb-3",
      itemSpacing: "space-y-2.5",
      itemPadding: "p-3 sm:p-3.5",
      footerMargin: "mt-4 sm:mt-5 pt-3 sm:pt-3.5"
    }
  }[widgetLayout.density || "spacious"];

  // Filter visible columns
  const visibleColumns = widgetLayout.columns.filter((c) => widgetLayout.visible[c] !== false);

  // Compute Grid Classes based on count & layout mode
  let gridColsClass = "grid grid-cols-1 gap-6 lg:grid-cols-3";
  if (widgetLayout.gridStyle === "focus" || visibleColumns.length === 1) {
    gridColsClass = "grid grid-cols-1 max-w-4xl mx-auto";
  } else if (widgetLayout.gridStyle === "2col" || visibleColumns.length === 2) {
    gridColsClass = "grid grid-cols-1 md:grid-cols-2";
  } else {
    gridColsClass = "grid grid-cols-1 lg:grid-cols-3";
  }

  // Column Renderer: Upcoming Meetings
  const renderMeetingsColumn = () => (
    <div
      key="meetings"
      className={`flex min-w-0 w-full flex-col justify-between overflow-hidden rounded-2xl sm:rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 ${densityStyles.cardPadding} shadow-[0_4px_24px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-200`}
    >
      <div className="min-w-0">
        {/* Header */}
        <div className={`flex items-center justify-between gap-2 min-w-0 border-b border-slate-100 dark:border-slate-800 ${densityStyles.cardHeader}`}>
          <span className="inline-flex min-w-0 items-center gap-1.5 sm:gap-2 rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 sm:px-3.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-xs">
            <Video size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate leading-snug py-0.5">{t("dash_meetings_title", "Jadwal Rapat Mendatang")}</span>
          </span>
          <Link
            to="/schedule"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 transition-colors whitespace-nowrap"
          >
            {t("dash_view_all", "Lihat Semua")} <ChevronRight size={14} />
          </Link>
        </div>

        {/* Cards List */}
        <div className={densityStyles.itemSpacing}>
          {displayMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed">
              <CalendarDays size={24} className="text-sub mb-2 opacity-50" />
              <p className="text-xs font-semibold text-ink">{t("dash_meetings_empty", "Tidak ada meeting hari ini")}</p>
              <p className="text-[11px] text-sub mt-0.5">{t("dash_meetings_empty_sub", "Jadwal baru akan muncul di sini")}</p>
            </div>
          ) : (
            displayMeetings.map((m) => (
              <div
                key={m.id}
                className={`group rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-800/40 ${densityStyles.itemPadding} transition-all hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800`}
              >
                {/* Time pill & Date */}
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800/60 bg-emerald-100/70 dark:bg-emerald-950/60 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-200">
                    <Clock size={11} strokeWidth={2.4} />
                    <span>{m.start_time} — {m.end_time}</span>
                  </span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {m.date}
                  </span>
                </div>

                {/* Title & Location */}
                <h4 className="mt-2 text-base font-bold text-ink leading-normal line-clamp-1">
                  {m.title}
                </h4>
                <p className="mt-1.5 text-xs text-sub truncate">
                  {m.location || "Google Calendar / Google Meet"}
                </p>

                {/* Footer: Attendees & Join button */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center gap-2 text-xs font-medium text-sub">
                    <AvatarStack ids={m.attendee_ids || [me?.user_id]} max={2} size={22} />
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">
                      {(m.attendee_ids?.length || 1)} peserta
                    </span>
                  </div>
                  <a
                    href={m.meet_link || "https://meet.google.com"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-bold shadow-sm transition-all hover:scale-102 active:scale-98"
                  >
                    <Video size={13} />
                    <span>{t("dash_meetings_join", "Gabung")}</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Action (Single primary CTA, avoiding redundancy with header link) */}
      <div className={`${densityStyles.footerMargin} border-t border-slate-100 dark:border-slate-800`}>
        <button
          onClick={() => navigate("/schedule")}
          className="flex h-11 sm:h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-200/90 dark:border-slate-700 bg-surface px-4 text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:border-emerald-400 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <Plus size={15} />
          <span>{t("dash_new_schedule", "Jadwal Baru")}</span>
        </button>
      </div>
    </div>
  );

  // Column Renderer: Today's Priority Tasks
  const renderTasksColumn = () => (
    <div
      key="tasks"
      className={`flex min-w-0 w-full flex-col justify-between overflow-hidden rounded-2xl sm:rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 ${densityStyles.cardPadding} shadow-[0_4px_24px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-200`}
    >
      <div className="min-w-0">
        {/* Header */}
        <div className={`flex items-center justify-between gap-2 min-w-0 border-b border-slate-100 dark:border-slate-800 ${densityStyles.cardHeader}`}>
          <span className="inline-flex min-w-0 items-center gap-1.5 sm:gap-2 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 sm:px-3.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 shadow-xs">
            <CheckSquare size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="truncate leading-snug py-0.5">{t("dash_tasks_title", "Tugas Prioritas Hari Ini")}</span>
          </span>
          <Link
            to="/tasks?kanban=1"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 transition-colors whitespace-nowrap"
          >
            {t("dash_view_kanban", "Buka Board")} <ChevronRight size={14} />
          </Link>
        </div>

        {/* Tasks List */}
        <div className={densityStyles.itemSpacing}>
          {todayTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed">
              <CheckSquare size={24} className="text-sub mb-2 opacity-50" />
              <p className="text-xs font-semibold text-ink">{t("dash_tasks_empty", "Semua tugas selesai")}</p>
              <p className="text-[11px] text-sub mt-0.5">{t("dash_tasks_empty_sub", "Belum ada tugas prioritas aktif")}</p>
            </div>
          ) : (
            todayTasks.map((t) => {
            const isDone = t.status === "done";
            const checkpointTotal = t.checkpoints?.length || t.checkpoints_total || 3;
            const checkpointDone = t.checkpoints?.filter((c) => c.done).length ?? (isDone ? checkpointTotal : 0);

            return (
              <div
                key={t.id}
                onClick={() => setSelectedTaskId(t.id)}
                className={`group cursor-pointer rounded-2xl border ${densityStyles.itemPadding} transition-all duration-200 ${
                  isDone
                    ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    : "border-slate-100 bg-slate-50/70 hover:border-slate-300 hover:bg-white dark:border-slate-800/80 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                }`}
              >
                {/* Badges + Check toggle */}
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                      {({ low: "Rendah", medium: "Sedang", high: "Tinggi", urgent: "Urgent" }[String(t.priority || "medium").toLowerCase()] || t.priority || "Sedang")}
                    </span>
                    <span className="rounded-full bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300">
                      {t.label || "Umum"}
                    </span>
                  </div>

                  {/* Circular Done Checkbox Button */}
                  <button
                    type="button"
                    onClick={(e) => toggleTaskDone(t, e)}
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 ${
                      isDone
                        ? "bg-emerald-500 text-white shadow-xs"
                        : "border-2 border-slate-300 hover:border-emerald-500 dark:border-slate-600"
                    }`}
                    title={isDone ? "Tandai belum selesai" : "Tandai selesai"}
                  >
                    {isDone && <CheckCircle2 size={16} strokeWidth={2.5} />}
                  </button>
                </div>

                {/* Task Title */}
                <h4
                  className={`text-[15px] font-bold tracking-tight text-ink leading-normal line-clamp-1 group-hover:text-brand transition-colors ${
                    isDone ? "line-through text-slate-400 dark:text-slate-500" : ""
                  }`}
                >
                  {t.title}
                </h4>

                {/* Footer: Deadline & Checklist info */}
                <div className="mt-3.5 flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 pt-2.5 border-t border-slate-200/50 dark:border-slate-800/60">
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} />
                    <span>Deadline: {t.deadline ? t.deadline.slice(0, 10) : "Tanpa deadline"}</span>
                  </span>
                  <span>
                    {checkpointDone}/{checkpointTotal} Checklist
                  </span>
                </div>
              </div>
            );
          })
          )}
        </div>
      </div>

      {/* Bottom Add Task Button */}
      <div className={`${densityStyles.footerMargin} border-t border-slate-100 dark:border-slate-800`}>
        <button
          onClick={() => setNewTaskOpen(true)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-200/90 dark:border-slate-700 bg-surface px-4 text-xs sm:text-sm font-bold text-sub hover:text-ink hover:border-slate-400 dark:hover:border-slate-500 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <Plus size={15} className="text-rose-500" />
          <span>{t("dash_add_task_item", "Tugas Baru")}</span>
        </button>
      </div>
    </div>
  );

  // Column Renderer: Sticky Notes Checklist
  const renderMessagesColumn = () => <StickyNotesWidget key="messages" densityStyles={densityStyles} />;

  return (
    <div className="relative min-h-full w-full max-w-full min-w-0 overflow-x-clip animate-crossfade" data-testid="dashboard-page">
      {/* Background Layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={layer.base} />
        <div className="absolute inset-0" style={layer.overlay} />
      </div>

      <div className={`relative z-10 mx-auto w-full min-w-0 max-w-[1520px] ${densityStyles.outer}`}>
        {/* Top Header */}
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200/70 dark:border-slate-800/80 pb-4 sm:border-b-0 sm:pb-0">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-sub" data-testid="dashboard-date">
              {format(new Date(), "EEEE, d MMMM yyyy", { locale: localeId })}
            </p>
            <h1 className="mt-0.5 text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.3] pb-0.5 break-words" data-testid="dashboard-greeting">
              {greet}, {me?.name?.split(" ")[0]} 👋
            </h1>
          </div>

          {/* Action Buttons in Top Right: Responsive Grid on Mobile, Flex on Desktop */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
            <AccentButton
              onClick={() => setNewTaskOpen(true)}
              data-testid="dashboard-new-task-btn"
              className="col-span-2 sm:col-span-1 h-10 w-full sm:w-auto justify-center"
            >
              <Plus size={16} /> {t("dash_new_task")}
            </AccentButton>

            <GhostButton
              onClick={() => setBgOpen(true)}
              data-testid="dashboard-background-btn"
              className="h-10 w-full min-w-0 sm:w-auto justify-center text-xs sm:text-sm px-2.5 sm:px-4"
            >
              <Image size={15} className="shrink-0" /> <span className="truncate">{t("dash_background")}</span>
            </GhostButton>

            <GhostButton
              onClick={() => {
                playSound("click");
                setLayoutOpen(true);
              }}
              data-testid="dashboard-customize-layout-btn"
              className="h-10 w-full min-w-0 sm:w-auto justify-center border-slate-200 dark:border-slate-700 font-semibold text-xs sm:text-sm px-2.5 sm:px-4 shadow-xs hover:border-slate-300 dark:hover:border-slate-600"
            >
              <SlidersHorizontal size={15} className="text-rose-500 shrink-0" />
              <span className="truncate">{t("dash_customize_layout")}</span>
            </GhostButton>
          </div>
        </div>

        {/* ============================================================ */}
        {/* TEAM WORKLOAD & MONTHLY PERFORMANCE SECTION (MOVED TO TOP)   */}
        {/* ============================================================ */}
        {(widgetLayout.visible.performance !== false || widgetLayout.visible.personnel !== false) && (
          <div className="w-full min-w-0">
            <Suspense
              fallback={
                <div className="h-[220px] w-full animate-pulse rounded-3xl border border-slate-200/70 bg-surface/60 dark:border-slate-800/70" />
              }
            >
              <MonthlyStats
                showPerformance={widgetLayout.visible.performance !== false}
                showPersonnel={widgetLayout.visible.personnel !== false}
              />
            </Suspense>
          </div>
        )}

        {/* ============================================================ */}
        {/* DYNAMIC 3-COLUMN DASHBOARD LAYOUT (CONFIGURABLE & SPACIOUS)  */}
        {/* ============================================================ */}
        {visibleColumns.length > 0 ? (
          <div className={`${gridColsClass} ${densityStyles.gridGap}`} data-testid="main-3-columns">
            {visibleColumns.map((colKey) => {
              if (colKey === "meetings") return renderMeetingsColumn();
              if (colKey === "tasks") return renderTasksColumn();
              if (colKey === "messages") return renderMessagesColumn();
              return null;
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center bg-white/50 dark:bg-slate-900/50">
            <LayoutGrid size={32} className="mx-auto text-sub mb-3" />
            <h3 className="font-bold text-ink text-lg">Semua widget utama disembunyikan</h3>
            <p className="text-sub text-sm mt-1 max-w-md mx-auto">
              Anda dapat mengaktifkan kembali widget melalui menu Atur Tata Letak di pojok kanan atas.
            </p>
            <button
              onClick={resetLayout}
              className="btn-accent mt-5 px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2"
            >
              <RotateCcw size={15} /> Reset ke Tampilan Standar
            </button>
          </div>
        )}

        {/* ============================================================ */}
        {/* DIREKTORI SHORTCUT FOLDER GOOGLE DRIVE (FILTERED BY ACCESS)  */}
        {/* ============================================================ */}
        {widgetLayout.visible.drive_directory !== false && (
          <div
            className={`w-full min-w-0 overflow-hidden rounded-2xl sm:rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 ${densityStyles.cardPadding} shadow-[0_4px_24px_rgba(0,0,0,0.03)]`}
            data-testid="dashboard-drive-directory"
          >
            <div className="flex flex-col gap-3.5 sm:gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-4 sm:pb-5 mb-4 sm:mb-5 min-w-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 sm:gap-2 rounded-full border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 sm:px-3.5 py-1 text-xs font-bold text-rose-700 dark:text-rose-300">
                    <FolderKanban size={14} className="text-brand shrink-0" />
                    <span className="truncate leading-snug py-0.5">{t("dash_drive_title", "Direktori Shortcut Google Drive")}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                    <ShieldCheck size={13} /> Akses Anda ({accessibleDashboardShortcuts.length})
                  </span>
                </div>
                <p className="mt-1.5 text-xs sm:text-sm text-sub break-words">
                  {t("dash_drive_subtitle", "Akses cepat ke folder Google Drive sesuai otorisasi akun Anda.")} ({me?.name} · {me?.department || "Management"}).
                </p>
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto min-w-0 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingShortcut(null);
                    setShortcutDialogOpen(true);
                  }}
                  className="btn-accent inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 sm:px-4 text-xs sm:text-sm font-bold text-white shadow-xs"
                  data-testid="dashboard-add-drive-shortcut-btn"
                >
                  <Plus size={15} className="shrink-0" />
                  <span className="truncate">{t("dash_drive_add", "Tambah Shortcut")}</span>
                </button>
                <Link
                  to="/directory"
                  className="inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border bg-surface px-2.5 sm:px-4 text-xs sm:text-sm font-bold text-sub hover:text-ink transition-colors"
                  data-testid="dashboard-open-directory-link"
                >
                  <span className="truncate">{t("dash_drive_manage", "Kelola Direktori")}</span>
                  <ChevronRight size={14} className="shrink-0" />
                </Link>
              </div>
            </div>

            {/* Category Filter Pills (single-line scrollable on mobile) */}
            <div className="mb-4 sm:mb-5 flex w-full max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 scroll-thin">
              {dashboardDriveCategories.map((cat) => {
                const active = driveCatFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setDriveCatFilter(cat)}
                    className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-xs sm:text-sm font-semibold transition-colors ${
                      active
                        ? "bg-brand text-white shadow-xs"
                        : "border bg-surface text-sub hover:text-ink"
                    }`}
                  >
                    {cat === "ALL" ? "Semua Folder Akses Saya" : cat}
                  </button>
                );
              })}
            </div>

            {displayedDriveShortcuts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-slate-50/70 dark:bg-slate-800/40 p-8 text-center">
                <FolderKanban size={28} className="text-sub mb-2 opacity-60" />
                <p className="text-sm font-bold text-ink">Belum ada shortcut folder untuk kategori ini</p>
                <p className="text-xs text-sub mt-1 max-w-md">
                  Tambahkan shortcut folder Google Drive baru atau atur hak akses member melalui halaman Direktori.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
                  {displayedDriveShortcuts.map((s, idx) => {
                    const accentColor = s.color || "#FF5364";
                    const cardStyle = s.card_style || "accent_top";
                    const memberIds =
                      s.access_type === "all"
                        ? humanUsers.map((u) => u.user_id)
                        : Array.from(
                            new Set([
                              ...(Array.isArray(s.allowed_user_ids) ? s.allowed_user_ids : []),
                              ...(s.access_type === "department" && Array.isArray(s.allowed_departments)
                                ? humanUsers
                                    .filter((u) => s.allowed_departments.includes(u.department))
                                    .map((u) => u.user_id)
                                : [])
                            ])
                          );

                    return (
                      <div
                        key={s.id}
                        className={`group relative min-w-0 w-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 sm:p-5 transition-all hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm ${
                          !showAllMobileDrive && idx >= 3 ? "hidden sm:flex" : "flex"
                        }`}
                        style={{
                          borderTopWidth: cardStyle === "accent_top" ? "4px" : undefined,
                          borderTopColor: cardStyle === "accent_top" ? accentColor : undefined,
                          backgroundColor: cardStyle === "soft_tint" ? `${accentColor}08` : undefined
                        }}
                        data-testid={`dashboard-drive-card-${s.id}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2.5 min-w-0">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                              <div
                                className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-xs transition-transform group-hover:scale-105"
                                style={{ backgroundColor: accentColor }}
                              >
                                <DriveIcon name={s.icon} size={20} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <h4 className="truncate min-w-0 text-sm sm:text-base font-bold text-ink leading-snug py-0.5">{s.name}</h4>
                                  {s.pinned && <Pin size={12} className="text-brand shrink-0 fill-current" />}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="rounded-full bg-surface2 px-2 py-0.5 font-semibold text-sub">
                                    {s.category || "General"}
                                  </span>
                                  {s.badge && (
                                    <span
                                      className="rounded-full px-2 py-0.5 font-bold"
                                      style={{ backgroundColor: `${accentColor}1A`, color: accentColor }}
                                    >
                                      {s.badge}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setEditingShortcut(s);
                                setShortcutDialogOpen(true);
                              }}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border bg-surface text-sub hover:text-ink"
                              title="Atur Shortcut"
                            >
                              <Pencil size={13} />
                            </button>
                          </div>

                          <p className="mt-2.5 sm:mt-3 line-clamp-2 text-xs sm:text-sm text-sub leading-relaxed break-words">
                            {s.description || "Shortcut folder Google Drive terhubung langsung."}
                          </p>
                        </div>

                        <div className="mt-3.5 sm:mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/60 flex flex-wrap items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <AvatarStack ids={memberIds} max={3} size={22} />
                            <button
                              type="button"
                              onClick={() => setAccessDialogShortcut(s)}
                              className="inline-flex min-w-0 items-center gap-1 text-xs font-bold text-sub hover:text-brand transition-colors"
                              title="Atur siapa saja member yang punya akses"
                            >
                              <ShieldCheck size={13} className="text-brand shrink-0" />
                              <span className="truncate">Atur Akses ({memberIds.length})</span>
                            </button>
                          </div>

                          <a
                            href={s.drive_url || "https://drive.google.com"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-accent inline-flex h-8 sm:h-9 shrink-0 items-center gap-1.5 rounded-full px-3 sm:px-3.5 text-xs font-bold text-white shadow-xs whitespace-nowrap"
                          >
                            <span>{t("dash_drive_open", "Buka Folder")}</span>
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {displayedDriveShortcuts.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllMobileDrive((v) => !v)}
                    className="mt-3.5 sm:hidden w-full rounded-2xl border bg-surface2/60 py-2.5 text-xs font-bold text-sub hover:text-ink transition-colors"
                    data-testid="dashboard-drive-toggle-all"
                  >
                    {showAllMobileDrive ? "Tampilkan lebih sedikit" : `Lihat semua folder (${displayedDriveShortcuts.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* WIDGET LAYOUT CUSTOMIZER DRAWER (SHEET)                      */}
      {/* ============================================================ */}
      <Sheet open={layoutOpen} onOpenChange={setLayoutOpen}>
        <SheetContent className="w-full overflow-y-auto bg-surface sm:max-w-lg p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-5 sm:space-y-7">
          <SheetHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <SlidersHorizontal size={20} />
              </span>
              <div>
                <SheetTitle className="text-lg font-bold">Atur Tata Letak Widget</SheetTitle>
                <SheetDescription className="text-xs text-sub mt-0.5">
                  Atur urutan kartu, visibilitas widget, dan kerapatan tampilan dashboard Anda.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Section 1: Kerapatan & Jarak Tampilan (Spacing Audit) */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-sub">
              Kerapatan Margin & Spacing
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: "spacious", label: "Lega & Luas", desc: "Margin lega", badge: "Lega" },
                { id: "normal", label: "Standar", desc: "Proporsional", badge: "Normal" },
                { id: "compact", label: "Kompak", desc: "Hemat ruang", badge: "Padat" }
              ].map((d) => {
                const active = (widgetLayout.density || "spacious") === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => {
                      playSound("click");
                      updateLayout({ density: d.id });
                    }}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 text-center transition-all ${
                      active
                        ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-2 ring-rose-500/20"
                        : "border-slate-200 dark:border-slate-800 bg-surface2/50 hover:bg-surface2 text-sub"
                    }`}
                  >
                    <span className="text-xs font-bold text-ink">{d.label}</span>
                    <span className="text-[10px] text-sub mt-0.5">{d.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Format Tata Letak Grid */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-sub">
              Format Kolom Grid
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: "3col", label: "3 Kolom", icon: LayoutGrid, desc: "Seimbang" },
                { id: "2col", label: "2 Kolom", icon: Columns, desc: "Lebar" },
                { id: "focus", label: "1 Kolom", icon: Maximize2, desc: "Fokus" }
              ].map((style) => {
                const active = (widgetLayout.gridStyle || "3col") === style.id;
                const Icon = style.icon;
                return (
                  <button
                    key={style.id}
                    onClick={() => {
                      playSound("click");
                      updateLayout({ gridStyle: style.id });
                    }}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 text-center transition-all ${
                      active
                        ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-2 ring-rose-500/20"
                        : "border-slate-200 dark:border-slate-800 bg-surface2/50 hover:bg-surface2 text-sub"
                    }`}
                  >
                    <Icon size={18} className={active ? "text-rose-500" : "text-sub"} />
                    <span className="text-xs font-bold text-ink mt-1.5">{style.label}</span>
                    <span className="text-[10px] text-sub">{style.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Urutan & Visibilitas 3 Widget Utama */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-sub">
                Urutan & Visibilitas 3 Widget Utama
              </label>
              <span className="text-[11px] text-sub">Geser urutan posisi:</span>
            </div>

            <div className="space-y-2.5">
              {widgetLayout.columns.map((colKey, index) => {
                const meta = getWidgetLabels(t)[colKey];
                const Icon = meta.icon;
                const isVisible = widgetLayout.visible[colKey] !== false;
                const isFirst = index === 0;
                const isLast = index === widgetLayout.columns.length - 1;

                return (
                  <div
                    key={colKey}
                    className={`flex items-center justify-between rounded-2xl border p-3.5 transition-all ${
                      isVisible
                        ? "border-slate-200 dark:border-slate-700 bg-surface shadow-xs"
                        : "border-slate-200/60 dark:border-slate-800/60 bg-surface2/40 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Icon size={14} className="text-slate-500 shrink-0" />
                          <p className="text-xs sm:text-sm font-bold text-ink truncate">{meta.title}</p>
                        </div>
                        <p className="text-[11px] text-sub truncate mt-0.5">{meta.desc}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {/* Move Up/Left */}
                      <button
                        onClick={() => moveColumn(colKey, -1)}
                        disabled={isFirst}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border bg-surface hover:bg-surface2 text-sub disabled:opacity-30 disabled:pointer-events-none"
                        title="Pindah ke kiri / atas"
                      >
                        <ArrowLeft size={14} />
                      </button>

                      {/* Move Down/Right */}
                      <button
                        onClick={() => moveColumn(colKey, 1)}
                        disabled={isLast}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border bg-surface hover:bg-surface2 text-sub disabled:opacity-30 disabled:pointer-events-none"
                        title="Pindah ke kanan / bawah"
                      >
                        <ArrowRight size={14} />
                      </button>

                      {/* Toggle Visibility */}
                      <button
                        onClick={() => toggleWidget(colKey)}
                        className={`flex h-8 px-2.5 items-center gap-1.5 rounded-xl border text-xs font-semibold transition-all ${
                          isVisible
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-slate-200 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                        <span>{isVisible ? "Tampil" : "Disembunyikan"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4: Widget Analitik & Tim */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-bold uppercase tracking-wider text-sub">
              Widget Analitik & Performa Tim
            </label>
            <div className="space-y-2.5">
              {[
                {
                  key: "performance",
                  title: "Performa & Monitoring Bulanan",
                  desc: "Grafik tugas selesai, overdue, dan ketepatan waktu",
                  icon: TrendingUp
                },
                {
                  key: "personnel",
                  title: "Kapasitas & Beban Kerja Personel",
                  desc: "Kartu beban kerja anggota tim dan indikator tekanan",
                  icon: BarChart3
                },
                {
                  key: "drive_directory",
                  title: "Direktori Shortcut Google Drive",
                  desc: "Tampilkan shortcut folder Google Drive sesuai hak akses Anda",
                  icon: FolderKanban
                }
              ].map((item) => {
                const Icon = item.icon;
                const isVisible = widgetLayout.visible[item.key] !== false;
                return (
                  <div
                    key={item.key}
                    className={`flex items-center justify-between rounded-2xl border p-3.5 transition-all ${
                      isVisible
                        ? "border-slate-200 dark:border-slate-700 bg-surface shadow-xs"
                        : "border-slate-200/60 dark:border-slate-800/60 bg-surface2/40 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-ink truncate">{item.title}</p>
                        <p className="text-[11px] text-sub truncate mt-0.5">{item.desc}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleWidget(item.key)}
                      className={`flex h-8 px-2.5 items-center gap-1.5 rounded-xl border text-xs font-semibold transition-all shrink-0 ml-2 ${
                        isVisible
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-slate-200 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                      <span>{isVisible ? "Tampil" : "Disembunyikan"}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <button
              onClick={resetLayout}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-sub hover:text-ink px-3 py-2 rounded-xl transition-colors"
            >
              <RotateCcw size={14} /> Reset Default
            </button>
            <button
              onClick={() => {
                playSound("click");
                setLayoutOpen(false);
                toast.success("Tata letak widget berhasil disimpan!");
              }}
              className="btn-accent px-5 py-2.5 text-xs font-bold shadow-md inline-flex items-center gap-2"
            >
              <Check size={14} /> Simpan & Terapkan
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Background Customizer Drawer */}
      <Sheet open={bgOpen} onOpenChange={setBgOpen}>
        <SheetContent className="w-full overflow-y-auto bg-surface sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Latar Dashboard</SheetTitle>
          </SheetHeader>
          <BackgroundEditor />
        </SheetContent>
      </Sheet>

      {/* Task Creation & Detail Sheets */}
      <TaskCreate open={newTaskOpen} onOpenChange={setNewTaskOpen} onCreated={loadData} />
      {selectedTaskId && (
        <TaskDetail id={selectedTaskId} onClose={() => setSelectedTaskId(null)} onChanged={loadData} />
      )}

      {/* Drive Shortcut Customize & Member Access Dialogs */}
      <DriveShortcutDialog
        open={shortcutDialogOpen}
        onOpenChange={setShortcutDialogOpen}
        initialData={editingShortcut}
        users={humanUsers}
        divisions={divisionsList}
        me={me}
        onSave={handleSaveDashboardShortcut}
        onOpenDriveBrowser={() => setDriveBrowserOpen(true)}
      />
      <DriveAccessDialog
        open={!!accessDialogShortcut}
        onOpenChange={(v) => !v && setAccessDialogShortcut(null)}
        shortcut={accessDialogShortcut}
        users={humanUsers}
        divisions={divisionsList}
        me={me}
        onSaveAccess={handleSaveDashboardAccess}
      />
      <GoogleDriveBrowserDialog
        open={driveBrowserOpen}
        onOpenChange={setDriveBrowserOpen}
        onSelectDriveFolder={(folderData) => {
          setEditingShortcut({
            name: folderData.name,
            drive_folder_id: folderData.drive_folder_id,
            drive_url: folderData.drive_url,
            category: me?.department || "General",
            badge: "Google Drive",
            color: "#FF5364",
            icon: "Folder",
            pinned: true,
            show_on_dashboard: true,
            access_type: "custom",
            allowed_departments: me?.department ? [me.department] : [],
            allowed_user_ids: me?.user_id ? [me.user_id] : ["user_admin1"]
          });
          setShortcutDialogOpen(true);
        }}
      />
    </div>
  );
}
