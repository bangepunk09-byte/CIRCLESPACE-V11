import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  Download,
  Upload,
  Cloud,
  CloudUpload,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  MessageCircle,
  CheckSquare,
  Users,
  Newspaper,
  FolderKanban,
  FileArchive,
  Clock,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  CalendarClock,
  Play,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import {
  firebaseAuth,
  subscribeFirebaseAuth,
  saveBackupToFirestore,
  listFirestoreBackups,
  loadBackupFromFirestore,
  deleteFirestoreBackup,
} from "../../lib/firestoreBackup";
import {
  inspectLocalMirrorSources,
  forceHydrateFromLocalSources,
} from "../../lib/persistentMirror";
import { Card } from "./AdminPanels";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";
import { AppSelect } from "../../components/ui/select";

let BACKUP_SUMMARY_CACHE = null;
let AUTO_BACKUP_CACHE = null;
let CLOUD_BACKUPS_CACHE = null;

try {
  const s = localStorage.getItem("circle_admin_backup_summary");
  if (s) BACKUP_SUMMARY_CACHE = JSON.parse(s);
  const a = localStorage.getItem("circle_admin_auto_backup");
  if (a) AUTO_BACKUP_CACHE = JSON.parse(a);
  const c = localStorage.getItem("circle_admin_cloud_backups");
  if (c) CLOUD_BACKUPS_CACHE = JSON.parse(c);
} catch {}

export async function prefetchBackupSummary() {
  try {
    const { data } = await api.get("/admin/backup/summary");
    if (data?.summary) {
      BACKUP_SUMMARY_CACHE = data.summary;
      try { localStorage.setItem("circle_admin_backup_summary", JSON.stringify(data.summary)); } catch {}
    }
    if (data?.auto_backup) {
      AUTO_BACKUP_CACHE = data.auto_backup;
      try { localStorage.setItem("circle_admin_auto_backup", JSON.stringify(data.auto_backup)); } catch {}
    }
    return data?.summary || BACKUP_SUMMARY_CACHE;
  } catch {}
  return BACKUP_SUMMARY_CACHE;
}

function clearWorkspaceCaches() {
  try {
    const prefixes = [
      "circle_tasks_cache",
      "circle_cache_tasks",
      "circle_users_cache",
      "circle_projects_cache",
      "circle_groups_cache",
      "circle_cache_posts",
      "circle_posts_cache",
      "circle_cache_meetings",
      "circle_cache_conversations",
      "circle_convs_cache",
      "circle_drive_shortcuts_cache",
      "circle_stats_team_cache",
      "circle_org_units_cache",
      "circle_admin_",
      "circle_boards_cache",
      "circle_notifications_cache",
      "circle_labels_cache",
    ];
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

function summarizeBackupPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.summary && typeof payload.summary === "object") {
    return payload.summary;
  }
  const d = payload.data && typeof payload.data === "object" ? payload.data : payload;
  return {
    users: Array.isArray(d.users)
      ? d.users.filter((u) => !u?.is_bot && u?.role !== "assistant").length
      : 0,
    tasks: Array.isArray(d.tasks) ? d.tasks.length : 0,
    projects: Array.isArray(d.projects) ? d.projects.length : 0,
    boards: Array.isArray(d.boards) ? d.boards.length : 0,
    conversations: Array.isArray(d.conversations) ? d.conversations.length : 0,
    groups: Array.isArray(d.groups) ? d.groups.length : 0,
    messages: Array.isArray(d.messages) ? d.messages.length : 0,
    posts: Array.isArray(d.posts) ? d.posts.length : 0,
  };
}

const ID_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const ID_WEEKDAYS = {
  Sun: "Minggu",
  Mon: "Senin",
  Tue: "Selasa",
  Wed: "Rabu",
  Thu: "Kamis",
  Fri: "Jumat",
  Sat: "Sabtu",
};

function getWibDateParts(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map = {};
  for (const part of fmt.formatToParts(safeDate)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = map.year || String(safeDate.getFullYear());
  const month = map.month || String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = map.day || String(safeDate.getDate()).padStart(2, "0");
  const hour = map.hour === "24" ? "00" : (map.hour || "00");
  const minute = map.minute || "00";
  const monthIdx = Math.max(0, Math.min(11, Number(month) - 1));
  const monthName = ID_MONTHS[monthIdx] || month;
  const weekday = ID_WEEKDAYS[map.weekday] || map.weekday || "";
  const ddMmYyyy = `${day}-${month}-${year}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    monthName,
    monthFolder: `${month}-${monthName}`,
    weekday,
    ddMmYyyy,
    hhmm: `${hour}:${minute}`,
  };
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function buildFolderTree(items = []) {
  const yearMap = new Map();

  for (const item of items) {
    const parts = getWibDateParts(item.createdAtIso);
    const year = item.year || parts.year;
    const month = item.month || parts.month;
    const monthName = item.monthName || parts.monthName;
    const monthFolder = item.monthFolder || `${month}-${monthName}`;
    const ddMmYyyy = item.ddMmYyyy || parts.ddMmYyyy;
    const weekday = item.weekday || parts.weekday;
    const dayNum = item.day || parts.day;

    if (!yearMap.has(year)) {
      yearMap.set(year, {
        year,
        count: 0,
        months: new Map(),
      });
    }
    const yNode = yearMap.get(year);
    yNode.count += 1;

    if (!yNode.months.has(monthFolder)) {
      yNode.months.set(monthFolder, {
        key: `${year}/${monthFolder}`,
        month,
        monthName,
        monthFolder,
        label: `${monthName} ${year}`,
        count: 0,
        days: new Map(),
      });
    }
    const mNode = yNode.months.get(monthFolder);
    mNode.count += 1;

    if (!mNode.days.has(ddMmYyyy)) {
      mNode.days.set(ddMmYyyy, {
        key: `${year}/${monthFolder}/${ddMmYyyy}`,
        ddMmYyyy,
        dayNum,
        weekday,
        displayLabel: `${ddMmYyyy}${weekday ? ` · ${weekday}, ${Number(dayNum)} ${monthName.slice(0, 3)} ${year}` : ""}`,
        folderPath: item.folderPath || `${year}/${monthFolder}/${ddMmYyyy}`,
        items: [],
      });
    }
    mNode.days.get(ddMmYyyy).items.push(item);
  }

  return Array.from(yearMap.values())
    .sort((a, b) => b.year.localeCompare(a.year))
    .map((y) => ({
      year: y.year,
      count: y.count,
      months: Array.from(y.months.values())
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((m) => ({
          ...m,
          days: Array.from(m.days.values()).sort((a, b) => b.dayNum.localeCompare(a.dayNum)),
        })),
    }));
}

function FolderTreeExplorer({
  items,
  renderItem,
  emptyText,
  testIdPrefix,
}) {
  const tree = useMemo(() => buildFolderTree(items), [items]);
  const [expanded, setExpanded] = useState({});

  // Auto-open the newest Year -> Month -> Day folder once items arrive
  useEffect(() => {
    if (!tree.length) return;
    const newestYear = tree[0];
    const newestMonth = newestYear?.months?.[0];
    const newestDay = newestMonth?.days?.[0];
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next = {};
      if (newestYear) next[`y:${newestYear.year}`] = true;
      if (newestMonth) next[`m:${newestMonth.key}`] = true;
      if (newestDay) next[`d:${newestDay.key}`] = true;
      return next;
    });
  }, [tree]);

  if (!tree.length) {
    return (
      <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-sub">
        {emptyText}
      </p>
    );
  }

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-tree`}>
      {tree.map((yNode) => {
        const yOpen = Boolean(expanded[`y:${yNode.year}`]);
        return (
          <div key={yNode.year} className="overflow-hidden rounded-2xl border bg-surface">
            {/* Level 1: Tahun */}
            <button
              type="button"
              onClick={() => toggle(`y:${yNode.year}`)}
              className="flex w-full items-center justify-between gap-2 bg-surface2/45 px-3.5 py-2.5 text-left hover:bg-surface2 transition-colors cursor-pointer"
              data-testid={`${testIdPrefix}-year-${yNode.year}`}
            >
              <span className="flex items-center gap-2 text-xs font-bold text-ink">
                {yOpen ? <ChevronDown size={14} className="text-sub" /> : <ChevronRight size={14} className="text-sub" />}
                {yOpen ? <FolderOpen size={15} className="text-amber-500" /> : <Folder size={15} className="text-amber-500" />}
                <span>Tahun {yNode.year}</span>
              </span>
              <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-sub border">
                {yNode.count} snapshot
              </span>
            </button>

            {yOpen && (
              <div className="divide-y border-t">
                {yNode.months.map((mNode) => {
                  const mOpen = Boolean(expanded[`m:${mNode.key}`]);
                  return (
                    <div key={mNode.key} className="bg-surface">
                      {/* Level 2: Bulan */}
                      <button
                        type="button"
                        onClick={() => toggle(`m:${mNode.key}`)}
                        className="flex w-full items-center justify-between gap-2 pl-4 sm:pl-6 pr-3 sm:pr-3.5 py-2 text-left hover:bg-surface2/40 transition-colors cursor-pointer"
                        data-testid={`${testIdPrefix}-month-${mNode.monthFolder}`}
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                          {mOpen ? <ChevronDown size={13} className="text-sub" /> : <ChevronRight size={13} className="text-sub" />}
                          {mOpen ? <FolderOpen size={14} className="text-brand" /> : <Folder size={14} className="text-brand" />}
                          <span>{mNode.label}</span>
                        </span>
                        <span className="text-[11px] font-medium text-sub">
                          {mNode.days.length} hari · {mNode.count} file
                        </span>
                      </button>

                      {mOpen && (
                        <div className="space-y-1.5 bg-surface2/20 px-2.5 sm:px-3.5 py-2 sm:py-2.5 pl-4 sm:pl-8 border-t">
                          {mNode.days.map((dNode) => {
                            const dOpen = Boolean(expanded[`d:${dNode.key}`]);
                            return (
                              <div key={dNode.key} className="overflow-hidden rounded-xl border bg-surface">
                                {/* Level 3: Hari-Bulan-Tahun (DD-MM-YYYY) */}
                                <button
                                  type="button"
                                  onClick={() => toggle(`d:${dNode.key}`)}
                                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface2/45 transition-colors cursor-pointer"
                                  data-testid={`${testIdPrefix}-day-${dNode.ddMmYyyy}`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    {dOpen ? <ChevronDown size={13} className="text-sub shrink-0" /> : <ChevronRight size={13} className="text-sub shrink-0" />}
                                    {dOpen ? <FolderOpen size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" /> : <Folder size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
                                    <span className="text-xs font-bold text-ink truncate">{dNode.displayLabel}</span>
                                  </span>
                                  <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
                                    {dNode.items.length} file
                                  </span>
                                </button>

                                {dOpen && (
                                  <div className="divide-y border-t bg-surface">
                                    {dNode.items.map((item) => renderItem(item))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function BackupRestorePanel() {
  const { checkAuth, reloadAll, reloadWs, reloadUsers, reloadTasks, reloadLabels, subscribe, cloudSyncStatus, syncCloudNow, connectCloudGoogle } = useApp();
  const [summary, setSummary] = useState(() => BACKUP_SUMMARY_CACHE);
  const [loadingSummary, setLoadingSummary] = useState(() => !BACKUP_SUMMARY_CACHE);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Auto backup daily state (23:59 WIB)
  const [autoConfig, setAutoConfig] = useState(
    () => AUTO_BACKUP_CACHE?.config || { enabled: true, schedule_time: "23:59", timezone: "Asia/Jakarta", retention_days: 30 }
  );
  const [autoSnapshots, setAutoSnapshots] = useState(() => AUTO_BACKUP_CACHE?.snapshots || []);
  const [runningAutoNow, setRunningAutoNow] = useState(false);
  const [savingAutoCfg, setSavingAutoCfg] = useState(false);
  const [loadingAutoId, setLoadingAutoId] = useState(null);

  // File restore confirmation dialog
  const [pendingRestore, setPendingRestore] = useState(null); // { source: 'file' | 'cloud' | 'auto', label, payload, summary }

  // Cloud Firestore state
  const [fbUser, setFbUser] = useState(() => firebaseAuth.currentUser || null);
  const [cloudLabel, setCloudLabel] = useState("");
  const [cloudBackups, setCloudBackups] = useState(() => (Array.isArray(CLOUD_BACKUPS_CACHE) ? CLOUD_BACKUPS_CACHE : []));
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  // Emergency diagnostic & local/cloud recovery scanner
  const [diagSources, setDiagSources] = useState(null);
  const [scanningDiag, setScanningDiag] = useState(false);
  const [recoveringDiag, setRecoveringDiag] = useState(false);

  const scanRecoverySources = useCallback(async () => {
    setScanningDiag(true);
    try {
      const localInfo = await inspectLocalMirrorSources();
      setDiagSources(localInfo);
    } catch {
      toast.error("Gagal memindai cache lokal browser.");
    } finally {
      setScanningDiag(false);
    }
  }, []);

  useEffect(() => {
    scanRecoverySources();
  }, [scanRecoverySources]);

  const handleForceRecoverFromAllSources = async () => {
    setRecoveringDiag(true);
    try {
      const res = await forceHydrateFromLocalSources(api);
      await Promise.allSettled([
        checkAuth?.(),
        reloadWs?.(),
        reloadUsers?.(),
        reloadTasks?.(),
        reloadLabels?.(),
        reloadAll?.(),
      ]);
      await fetchSummary({ silent: true });
      await scanRecoverySources();
      if (res?.restored) {
        toast.success("Pemulihan & penggabungan data ke server berhasil dijalankan!");
      } else {
        toast.info("Pemindaian selesai. Tidak ada data tambahan yang perlu dipulihkan dari browser ini.");
      }
    } catch (e) {
      toast.error(errMsg(e, "Gagal memulihkan data dari sumber lokal & cloud."));
    } finally {
      setRecoveringDiag(false);
    }
  };

  const fetchSummary = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingSummary(true);
    try {
      const { data } = await api.get("/admin/backup/summary");
      const next = data?.summary || null;
      if (next) {
        BACKUP_SUMMARY_CACHE = next;
        try { localStorage.setItem("circle_admin_backup_summary", JSON.stringify(next)); } catch {}
      }
      setSummary(next);
      if (data?.auto_backup) {
        AUTO_BACKUP_CACHE = data.auto_backup;
        try { localStorage.setItem("circle_admin_auto_backup", JSON.stringify(data.auto_backup)); } catch {}
        if (data.auto_backup.config) setAutoConfig(data.auto_backup.config);
        if (Array.isArray(data.auto_backup.snapshots)) setAutoSnapshots(data.auto_backup.snapshots);
      }
    } catch (e) {
      if (!BACKUP_SUMMARY_CACHE) {
        toast.error(errMsg(e, "Gagal memuat ringkasan data workspace"));
      }
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchCloudSnapshots = useCallback(async (user) => {
    if (!user) {
      setCloudBackups([]);
      return;
    }
    setLoadingCloud(true);
    setCloudError("");
    try {
      const rows = await listFirestoreBackups();
      CLOUD_BACKUPS_CACHE = rows;
      try { localStorage.setItem("circle_admin_cloud_backups", JSON.stringify(rows)); } catch {}
      setCloudBackups(rows);
    } catch (e) {
      const rawMsg = e?.message || "";
      if (rawMsg.includes("Missing or insufficient permissions") || rawMsg.includes("permission-denied")) {
        setCloudError("Aturan keamanan Firestore (firestore.rules) belum dipublikasikan ke project Firebase Anda, atau akun belum terverifikasi. Anda tetap dapat menggunakan Auto Backup Harian & Backup File (.json) di atas.");
      } else {
        setCloudError("Gagal memuat daftar snapshot Cloud Firestore.");
      }
    } finally {
      setLoadingCloud(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary({ silent: Boolean(BACKUP_SUMMARY_CACHE) });
  }, [fetchSummary]);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((evt) => {
      if (evt?.type === "auto_backup:created") {
        fetchSummary({ silent: true });
      }
    });
  }, [subscribe, fetchSummary]);

  useEffect(() => {
    const unsub = subscribeFirebaseAuth((user) => {
      setFbUser(user || null);
      if (user) {
        fetchCloudSnapshots(user);
      } else {
        setCloudBackups([]);
      }
    });
    return () => unsub();
  }, [fetchCloudSnapshots]);

  const handleUpdateAutoConfig = async (patch) => {
    setSavingAutoCfg(true);
    const prev = autoConfig;
    const optimistic = { ...autoConfig, ...patch };
    setAutoConfig(optimistic);
    try {
      const { data } = await api.patch("/admin/backup/auto/config", patch);
      if (data?.config) {
        setAutoConfig(data.config);
        AUTO_BACKUP_CACHE = { ...(AUTO_BACKUP_CACHE || {}), config: data.config, snapshots: autoSnapshots };
        try { localStorage.setItem("circle_admin_auto_backup", JSON.stringify(AUTO_BACKUP_CACHE)); } catch {}
      }
      toast.success("Pengaturan Auto Backup Harian diperbarui.");
    } catch (e) {
      setAutoConfig(prev);
      toast.error(errMsg(e, "Gagal memperbarui pengaturan auto backup"));
    } finally {
      setSavingAutoCfg(false);
    }
  };

  const handleRunAutoBackupNow = async () => {
    setRunningAutoNow(true);
    try {
      const { data } = await api.post("/admin/backup/auto/run");
      if (data?.config) setAutoConfig(data.config);
      if (Array.isArray(data?.snapshots)) setAutoSnapshots(data.snapshots);
      AUTO_BACKUP_CACHE = {
        config: data?.config || autoConfig,
        snapshots: data?.snapshots || autoSnapshots,
      };
      try { localStorage.setItem("circle_admin_auto_backup", JSON.stringify(AUTO_BACKUP_CACHE)); } catch {}
      toast.success(`Backup harian tersimpan ke folder ${data?.snapshot?.folderPath || "hari ini"}!`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal menjalankan backup ke folder hari ini"));
    } finally {
      setRunningAutoNow(false);
    }
  };

  const handlePrepareAutoRestore = async (snap) => {
    setLoadingAutoId(snap.id);
    try {
      const { data } = await api.get(`/admin/backup/auto/snapshot/${encodeURIComponent(snap.id)}`);
      setPendingRestore({
        source: "auto",
        label: `${snap.ddMmYyyy} · ${snap.label}`,
        payload: data,
        summary: snap.summary && Object.keys(snap.summary).length ? snap.summary : summarizeBackupPayload(data),
      });
    } catch (e) {
      toast.error(errMsg(e, "Gagal memuat isi snapshot backup"));
    } finally {
      setLoadingAutoId(null);
    }
  };

  const handleDownloadAutoSnapshot = async (snap) => {
    setLoadingAutoId(snap.id);
    try {
      const { data } = await api.get(`/admin/backup/auto/snapshot/${encodeURIComponent(snap.id)}`);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = snap.fileName || `circle-backup-${snap.ddMmYyyy}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`File ${snap.fileName} diunduh!`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengunduh snapshot"));
    } finally {
      setLoadingAutoId(null);
    }
  };

  const handleDeleteAutoSnapshot = async (snap) => {
    try {
      const { data } = await api.delete(`/admin/backup/auto/snapshot/${encodeURIComponent(snap.id)}`);
      if (Array.isArray(data?.snapshots)) {
        setAutoSnapshots(data.snapshots);
        AUTO_BACKUP_CACHE = { config: autoConfig, snapshots: data.snapshots };
        try { localStorage.setItem("circle_admin_auto_backup", JSON.stringify(AUTO_BACKUP_CACHE)); } catch {}
      }
      toast.success("Snapshot harian dihapus.");
    } catch (e) {
      toast.error(errMsg(e, "Gagal menghapus snapshot harian"));
    }
  };

  const handleDownloadJson = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get("/admin/backup/export");
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const parts = getWibDateParts(new Date());
      const a = document.createElement("a");
      a.href = url;
      a.download = `circle-workspace-backup-${parts.ddMmYyyy}-${parts.hour}${parts.minute}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Full backup berhasil diunduh (.json)!");
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengunduh file backup"));
    } finally {
      setDownloading(false);
    }
  };

  const handleSelectRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const sum = summarizeBackupPayload(parsed);
      const rawData = parsed?.data || parsed;
      if (!rawData || typeof rawData !== "object") {
        throw new Error("Struktur file tidak valid");
      }
      setPendingRestore({
        source: "file",
        label: file.name,
        payload: parsed,
        summary: sum,
      });
    } catch {
      toast.error("File backup tidak valid. Pastikan memilih file .json hasil ekspor CIRCLE Workspace.");
    } finally {
      e.target.value = "";
    }
  };

  const executeRestore = async () => {
    if (!pendingRestore?.payload) return;
    setRestoring(true);
    try {
      const { data } = await api.post("/admin/backup/restore", pendingRestore.payload);
      clearWorkspaceCaches();
      await Promise.allSettled([
        checkAuth?.(),
        reloadWs?.(),
        reloadUsers?.(),
        reloadTasks?.(),
        reloadLabels?.(),
        reloadAll?.(),
      ]);
      setSummary(data?.summary || pendingRestore.summary);
      setPendingRestore(null);
      toast.success("Semua data workspace (pesan, tugas, anggota, beranda, dll) berhasil dipulihkan!");
      fetchSummary();
    } catch (e) {
      toast.error(errMsg(e, "Gagal memulihkan data backup"));
    } finally {
      setRestoring(false);
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setCloudError("");
    try {
      const ok = await connectCloudGoogle?.();
      if (ok && firebaseAuth.currentUser) {
        await fetchCloudSnapshots(firebaseAuth.currentUser);
      }
    } catch {
      toast.error("Gagal menghubungkan Google OAuth (pastikan popup tidak diblokir dan email terdaftar sebagai Test User di Google Cloud Console).");
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleSaveToCloud = async () => {
    setSavingCloud(true);
    setCloudError("");
    try {
      const { data } = await api.get("/admin/backup/export");
      const parts = getWibDateParts(new Date());
      const defaultLabel = `[${parts.ddMmYyyy}] Backup ${parts.hhmm} WIB`;
      const finalLabel = cloudLabel.trim() ? `[${parts.ddMmYyyy}] ${cloudLabel.trim()}` : defaultLabel;
      const saved = await saveBackupToFirestore(data, finalLabel);
      setCloudLabel("");
      toast.success(`Snapshot "${saved.label}" berhasil disimpan ke Cloud Firestore!`);
      await fetchCloudSnapshots(fbUser);
    } catch (e) {
      const rawMsg = e?.message || "";
      if (rawMsg.includes("Missing or insufficient permissions") || rawMsg.includes("permission-denied")) {
        setCloudError("Gagal menulis ke Firestore karena rules keamanan belum aktif/sesuai di project Firebase. Gunakan Auto Backup Harian atau Unduh Backup (.json) di atas.");
      }
      toast.error("Gagal menyimpan backup ke Cloud Firestore.");
    } finally {
      setSavingCloud(false);
    }
  };

  const handlePrepareCloudRestore = async (record) => {
    setLoadingCloud(true);
    try {
      const payload = await loadBackupFromFirestore(record.id);
      setPendingRestore({
        source: "cloud",
        label: record.label,
        payload,
        summary: record.summary || summarizeBackupPayload(payload),
      });
    } catch {
      toast.error("Gagal mengunduh snapshot dari Cloud Firestore.");
    } finally {
      setLoadingCloud(false);
    }
  };

  const handleDeleteCloudSnapshot = async (record) => {
    try {
      await deleteFirestoreBackup(record.id);
      setCloudBackups((prev) => prev.filter((x) => x.id !== record.id));
      toast.success("Snapshot cloud dihapus.");
    } catch {
      toast.error("Gagal menghapus snapshot cloud.");
    }
  };

  const metrics = summary
    ? [
        { label: "Pesan & Ruang Obrolan", value: `${summary.conversations || 0} ruang · ${summary.messages || 0} pesan`, icon: MessageCircle, tone: "bg-soft-blue text-blue-700 dark:text-blue-300" },
        { label: "Tugas & Proyek", value: `${summary.tasks || 0} tugas · ${summary.projects || 0} proyek`, icon: CheckSquare, tone: "bg-soft-red text-rose-700 dark:text-rose-300" },
        { label: "Karyawan & Divisi", value: `${summary.users || 0} karyawan · ${summary.org_units || 0} unit`, icon: Users, tone: "bg-soft-green text-emerald-700 dark:text-emerald-300" },
        { label: "Beranda & Polling", value: `${summary.posts || 0} postingan · ${summary.polls || 0} polling`, icon: Newspaper, tone: "bg-soft-purple text-violet-700 dark:text-violet-300" },
        { label: "Board & Label", value: `${summary.boards || 0} board · ${summary.labels || 0} label`, icon: FolderKanban, tone: "bg-soft-yellow text-amber-700 dark:text-amber-300" },
        { label: "File & Stiker", value: `${summary.upload_files || 0} file unggahan · ${summary.stickers || 0} stiker`, icon: FileArchive, tone: "bg-surface2 text-ink" },
      ]
    : [];

  const lastRunWib = autoConfig?.last_run_at ? getWibDateParts(autoConfig.last_run_at) : null;

  return (
    <div className="space-y-5 animate-crossfade" data-testid="backup-restore-panel">
      {/* Live Inventory */}
      <Card title="Data Workspace Saat Ini" testid="backup-summary-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <p className="text-xs text-sub">
            Seluruh data pesan, tugas, proyek, anggota, feed Beranda, struktur divisi, pengaturan branding, dan file terunggah ikut dicadangkan.
          </p>
          <button
            type="button"
            onClick={() => fetchSummary()}
            disabled={loadingSummary}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border bg-surface2 px-3 text-xs font-semibold text-ink hover:bg-surface transition-colors"
            data-testid="refresh-backup-summary-btn"
          >
            <RefreshCw size={13} className={loadingSummary ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        {loadingSummary && !summary ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-surface2 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {metrics.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  className="flex items-center gap-3 rounded-2xl border bg-surface2/50 p-3"
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-sub">{m.label}</p>
                    <p className="text-xs font-bold text-ink truncate">{m.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Sinkronisasi Cloud & Pemulihan Darurat */}
      <Card title="Sinkronisasi Cloud & Pemulihan Darurat" testid="emergency-recovery-card">
        <div className="space-y-3.5">
          {!fbUser ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 p-3.5">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-bold text-ink">Auto Live Sync Cloud Firestore Belum Aktif di Browser Ini</p>
                  <p className="text-[11px] text-sub leading-relaxed">
                    Login dengan Email/Password hanya menyimpan data di disk sementara server &amp; cache browser ini. Hubungkan Google (<strong>be.creativestudio21@gmail.com</strong>) agar semua task, chat, dan board otomatis dicadangkan tiap perubahan ke Cloud Firestore dan aman saat Republish atau server restart.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={connectingGoogle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                <ShieldCheck size={14} />
                <span>{connectingGoogle ? "Menghubungkan..." : "Hubungkan Google Sekarang"}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink truncate">
                    Auto Live Sync Firestore Aktif ({fbUser.email}) — sinkronisasi real-time tim &amp; snapshot per jam aktif.
                  </p>
                  {cloudSyncStatus?.lastSyncedAt && (
                    <p className="text-[11px] text-sub">
                      Sinkron terakhir: {getWibDateParts(cloudSyncStatus.lastSyncedAt).ddMmYyyy} · {getWibDateParts(cloudSyncStatus.lastSyncedAt).hhmm} WIB
                    </p>
                  )}
                  {cloudSyncStatus?.lastError && (
                    <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                      {cloudSyncStatus.lastError}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(cloudSyncStatus?.syncing)}
                onClick={async () => {
                  await syncCloudNow?.();
                  await fetchSummary({ silent: true });
                  await fetchCloudSnapshots(fbUser);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-300/80 dark:border-emerald-800 bg-surface px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/60 disabled:opacity-50 shrink-0 cursor-pointer"
                data-testid="sync-cloud-now-btn"
              >
                <RefreshCw size={12} className={cloudSyncStatus?.syncing ? "animate-spin" : ""} />
                <span>{cloudSyncStatus?.syncing ? "Menyimpan..." : "Sync Cloud Sekarang"}</span>
              </button>
            </div>
          )}

          <div className="rounded-2xl border bg-surface2/50 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink">Deteksi Cadangan Lokal (IndexedDB + Cache Browser Ini)</p>
                <p className="text-[11px] text-sub mt-0.5">
                  {diagSources
                    ? `${diagSources.counts.tasks} tugas · ${diagSources.counts.messages} pesan · ${diagSources.counts.boards} board · ${diagSources.counts.users} akun · ${diagSources.counts.notes} catatan · ${diagSources.counts.templates} template`
                    : "Memindai penyimpanan lokal..."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={scanRecoverySources}
                  disabled={scanningDiag || recoveringDiag}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface2 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} className={scanningDiag ? "animate-spin" : ""} />
                  <span>Scan Ulang</span>
                </button>
                <button
                  type="button"
                  onClick={handleForceRecoverFromAllSources}
                  disabled={recoveringDiag}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  data-testid="force-recover-all-btn"
                >
                  <Database size={13} />
                  <span>{recoveringDiag ? "Memulihkan..." : "Pulihkan & Gabungkan ke Server"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Auto Backup Harian (23:59 WIB) & Foldering Hari-Bulan-Tahun */}
      <Card title="Auto Backup Harian · 23:59 WIB" testid="auto-backup-daily-card">
        <div className="space-y-4">
          {/* Clean Two-Row Control Box */}
          <div className="rounded-2xl border bg-surface2/45 p-3 sm:p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    autoConfig.enabled
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-surface text-sub border"
                  }`}
                >
                  <CalendarClock size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-ink">Jadwal Otomatis · 23:59 WIB</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        autoConfig.enabled
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {autoConfig.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  <p className="text-[11px] text-sub mt-0.5">
                    Tersimpan otomatis tiap malam ke folder <span className="font-semibold text-ink">Tahun / Bulan / DD-MM-YYYY</span>.
                  </p>
                </div>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-[11px] font-medium text-sub shrink-0">
                <Clock size={12} className="text-brand shrink-0" />
                <span>
                  {lastRunWib
                    ? `Terakhir: ${lastRunWib.ddMmYyyy} · ${lastRunWib.hhmm} WIB`
                    : "Menunggu jadwal 23:59 WIB"}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 dark:border-slate-800/70 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <AppSelect
                  value={String(autoConfig.retention_days ?? 30)}
                  disabled={savingAutoCfg}
                  onChange={(e) => handleUpdateAutoConfig({ retention_days: Number(e.target.value) })}
                  className="h-9 rounded-xl border bg-surface px-3 text-xs font-semibold text-ink"
                  title="Batas simpan folder harian"
                  data-testid="auto-backup-retention-select"
                >
                  <option value="14">Simpan 14 Hari</option>
                  <option value="30">Simpan 30 Hari</option>
                  <option value="60">Simpan 60 Hari</option>
                  <option value="90">Simpan 90 Hari</option>
                  <option value="0">Simpan Selamanya</option>
                </AppSelect>

                <button
                  type="button"
                  disabled={savingAutoCfg}
                  onClick={() => handleUpdateAutoConfig({ enabled: !autoConfig.enabled })}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                    autoConfig.enabled
                      ? "border bg-surface text-ink hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                  data-testid="auto-backup-toggle-btn"
                >
                  <span>{autoConfig.enabled ? "Matikan Jadwal" : "Aktifkan 23:59 WIB"}</span>
                </button>
              </div>

              <button
                type="button"
                disabled={runningAutoNow}
                onClick={handleRunAutoBackupNow}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
                data-testid="auto-backup-run-now-btn"
              >
                <Play size={13} />
                <span>{runningAutoNow ? "Menyimpan..." : "Backup Hari Ini Sekarang"}</span>
              </button>
            </div>
          </div>

          {/* Foldering Explorer (Tahun -> Bulan -> Hari-Bulan-Tahun) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <HardDrive size={14} className="text-brand" />
                <span>Arsip Folder Harian</span>
              </p>
              <span className="text-[11px] font-semibold text-sub">{autoSnapshots.length} snapshot</span>
            </div>

            <FolderTreeExplorer
              items={autoSnapshots}
              testIdPrefix="auto-backup"
              emptyText="Belum ada arsip harian. Klik 'Backup Hari Ini Sekarang' untuk membuat snapshot ke folder hari ini, atau tunggu jadwal otomatis pukul 23:59 WIB."
              renderItem={(snap) => {
                const busy = loadingAutoId === snap.id;
                return (
                  <div
                    key={snap.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-3.5 py-2.5"
                    data-testid={`auto-snapshot-row-${snap.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            snap.triggerType === "auto"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                          }`}
                        >
                          {snap.triggerType === "auto" ? "Auto 23:59" : "Manual"}
                        </span>
                        <p className="text-xs font-bold text-ink truncate">{snap.fileName}</p>
                        <span className="text-[11px] font-medium text-sub">{formatBytes(snap.sizeBytes)}</span>
                      </div>
                      <p className="text-[11px] text-sub mt-0.5">
                        {snap.timeLabel || getWibDateParts(snap.createdAtIso).hhmm + " WIB"} ·{" "}
                        {snap.summary?.messages || 0} pesan · {snap.summary?.tasks || 0} tugas ·{" "}
                        {snap.summary?.users || 0} anggota · {snap.summary?.posts || 0} postingan
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handlePrepareAutoRestore(snap)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-brand/10 px-3 text-xs font-bold text-brand hover:bg-brand hover:text-white transition-colors disabled:opacity-50"
                        data-testid={`auto-restore-${snap.id}`}
                      >
                        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
                        <span>Pulihkan</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDownloadAutoSnapshot(snap)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border bg-surface2 text-ink hover:bg-surface transition-colors disabled:opacity-50"
                        title="Unduh file JSON"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeleteAutoSnapshot(snap)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-sub hover:bg-rose-500/10 hover:text-rose-600 transition-colors disabled:opacity-50"
                        title="Hapus snapshot"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </div>
      </Card>

      {/* File JSON Backup & Restore */}
      <Card title="Backup & Restore File (.json) — Siap Sebelum & Sesudah Republish" testid="backup-file-card">
        <div className="space-y-4">
          <div className="rounded-2xl border border-brand/20 bg-brand/5 p-3.5 text-xs text-ink leading-relaxed">
            <p className="font-bold flex items-center gap-1.5 text-brand mb-1">
              <Database size={14} />
              <span>Cara menjaga data tetap utuh saat Republish aplikasi:</span>
            </p>
            <ol className="list-decimal pl-4 space-y-1 text-sub">
              <li>Sebelum melakukan <strong>Republish</strong>, klik <strong>Unduh Full Backup (.json)</strong> untuk menyimpan semua pesan, tugas, karyawan, beranda, board, dan file ke perangkat Anda.</li>
              <li>Setelah aplikasi selesai di-republish, buka menu <strong>Pengaturan → Backup &amp; Restore</strong> lalu unggah file <code>.json</code> tersebut melalui tombol <strong>Pulihkan dari File (.json)</strong>.</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={downloading}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 transition-opacity disabled:opacity-50"
              data-testid="backup-download-json-btn"
            >
              <Download size={15} />
              <span>{downloading ? "Menyiapkan Backup..." : "Unduh Full Backup (.json)"}</span>
            </button>

            <label
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border bg-surface2 px-4 text-xs font-bold text-ink hover:bg-surface transition-colors shadow-2xs"
              data-testid="backup-restore-file-label"
            >
              <Upload size={15} className="text-brand" />
              <span>Pulihkan dari File (.json)</span>
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={handleSelectRestoreFile}
                data-testid="backup-restore-file-input"
              />
            </label>
          </div>
        </div>
      </Card>

      {/* Cloud Backup (Firebase Firestore) */}
      <Card title="Cloud Backup (Firebase Firestore)" testid="backup-cloud-card">
        <div className="space-y-4">
          <p className="text-xs text-sub">
            Simpan snapshot workspace langsung ke database cloud Firestore agar dapat dipulihkan dari perangkat mana saja setelah republish, dikelompokkan rapi per folder Tahun / Bulan / Hari-Bulan-Tahun.
          </p>

          {!fbUser ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface2/60 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Cloud size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink">Hubungkan Akun Google untuk Cloud Backup</p>
                  <p className="text-[11px] text-sub">Autentikasi Firebase diperlukan agar snapshot Anda tersimpan aman di Firestore.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={connectingGoogle}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50"
                data-testid="backup-connect-google-btn"
              >
                <ShieldCheck size={14} />
                <span>{connectingGoogle ? "Menghubungkan..." : "Hubungkan Google"}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-ink truncate">
                    Terhubung ke Firestore sebagai <strong>{fbUser.email || fbUser.displayName}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchCloudSnapshots(fbUser)}
                  disabled={loadingCloud}
                  className="text-[11px] font-bold text-brand hover:underline"
                >
                  {loadingCloud ? "Memuat..." : "Muat Ulang Daftar"}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={cloudLabel}
                  onChange={(e) => setCloudLabel(e.target.value)}
                  placeholder="Label snapshot (contoh: Sebelum Republish v2)"
                  maxLength={100}
                  className="h-10 flex-1 rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none"
                  data-testid="cloud-backup-label-input"
                />
                <button
                  type="button"
                  onClick={handleSaveToCloud}
                  disabled={savingCloud}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50 shrink-0"
                  data-testid="cloud-backup-save-btn"
                >
                  <CloudUpload size={15} />
                  <span>{savingCloud ? "Menyimpan ke Cloud..." : "Backup ke Cloud"}</span>
                </button>
              </div>

              {cloudError && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{cloudError}</p>
                </div>
              )}

              {!cloudError && (
                <FolderTreeExplorer
                  items={cloudBackups}
                  testIdPrefix="cloud-backup"
                  emptyText={
                    loadingCloud
                      ? "Memuat snapshot cloud..."
                      : "Belum ada snapshot cloud tersimpan. Klik 'Backup ke Cloud' untuk membuat snapshot pertama."
                  }
                  renderItem={(bk) => {
                    const parts = getWibDateParts(bk.createdAtIso);
                    return (
                      <div key={bk.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-xs font-bold text-ink truncate">{bk.label}</p>
                            {bk.isLiveSync && (
                              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                Live Cloud Sync
                              </span>
                            )}
                            {bk.isSharedTeam && (
                              <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                Tim Bersama
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-sub mt-0.5">
                            {parts.ddMmYyyy} · {parts.hhmm} WIB · {bk.summary?.messages || 0} pesan · {bk.summary?.tasks || 0} tugas · {bk.summary?.users || 0} anggota · {bk.summary?.posts || 0} postingan
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => handlePrepareCloudRestore(bk)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-brand/10 px-3 text-xs font-bold text-brand hover:bg-brand hover:text-white transition-colors"
                            data-testid={`cloud-restore-${bk.id}`}
                          >
                            <RefreshCw size={12} />
                            <span>Pulihkan</span>
                          </button>
                          {bk.id !== "shared_workspace_live" && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCloudSnapshot(bk)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-sub hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                              title="Hapus snapshot"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Restore Confirmation Dialog */}
      <Dialog open={Boolean(pendingRestore)} onOpenChange={(open) => { if (!open && !restoring) setPendingRestore(null); }}>
        <DialogContent className="max-w-md rounded-2xl sm:rounded-3xl bg-surface p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-ink">
              <AlertTriangle size={18} className="text-amber-500" />
              <span>Konfirmasi Pemulihan Data</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-sub pt-1">
              Data workspace saat ini akan digantikan oleh isi backup <strong>{pendingRestore?.label}</strong>. Pastikan Anda sudah membuat cadangan jika masih ada data baru yang ingin disimpan.
            </DialogDescription>
          </DialogHeader>

          {pendingRestore?.summary && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-surface2/60 p-3 text-xs">
              <div><span className="text-sub">Karyawan:</span> <strong className="text-ink">{pendingRestore.summary.users || 0}</strong></div>
              <div><span className="text-sub">Tugas:</span> <strong className="text-ink">{pendingRestore.summary.tasks || 0}</strong></div>
              <div><span className="text-sub">Ruang Obrolan:</span> <strong className="text-ink">{pendingRestore.summary.conversations || 0}</strong></div>
              <div><span className="text-sub">Pesan:</span> <strong className="text-ink">{pendingRestore.summary.messages || 0}</strong></div>
              <div><span className="text-sub">Postingan Beranda:</span> <strong className="text-ink">{pendingRestore.summary.posts || 0}</strong></div>
              <div><span className="text-sub">Proyek / Board:</span> <strong className="text-ink">{pendingRestore.summary.projects || 0} / {pendingRestore.summary.boards || 0}</strong></div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={restoring}
              onClick={() => setPendingRestore(null)}
              className="h-10 rounded-xl border bg-surface2 px-4 text-xs font-semibold text-ink hover:bg-surface"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={restoring}
              onClick={executeRestore}
              className="h-10 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 disabled:opacity-50"
              data-testid="confirm-backup-restore-btn"
            >
              {restoring ? "Memulihkan Data..." : "Ya, Pulihkan Semua Data"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
