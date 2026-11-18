import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Folder, FolderOpen, Search, RotateCcw, CheckCircle2, Zap, ArrowRight, X,
  ChevronDown, ChevronRight, Inbox, Trash2, CheckSquare, Square, ShieldAlert, Check
} from "lucide-react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar, Labels, PriorityBadge, PRIORITY } from "../../components/common";
import { AppSelect } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { playSound } from "../../lib/sound";

const MONTH_NAMES = {
  "01": "Januari", "02": "Februari", "03": "Maret", "04": "April",
  "05": "Mei", "06": "Juni", "07": "Juli", "08": "Agustus",
  "09": "September", "10": "Oktober", "11": "November", "12": "Desember"
};

function formatMonthFolder(monthKey) {
  if (!monthKey || monthKey.length < 7 || monthKey === "unknown") return "Lainnya / Tanpa Tanggal";
  const [year, month] = monthKey.split("-");
  return `${MONTH_NAMES[month] || month} ${year}`;
}

export default function ArchiveView({ tasks, onOpen, reload, projects }) {
  const { users, me, subscribe } = useApp();
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [selectedPriority, setSelectedPriority] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [openFolders, setOpenFolders] = useState({});
  const [syncing, setSyncing] = useState(false);

  // Empty Task / Deletion States
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteRequests, setDeleteRequests] = useState([]);
  const [emptyModalOpen, setEmptyModalOpen] = useState(false);
  const [emptyMonthTarget, setEmptyMonthTarget] = useState("");
  const [confirmSingleTask, setConfirmSingleTask] = useState(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmMonthDelete, setConfirmMonthDelete] = useState(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const loadDeleteRequests = useCallback(() => {
    api.get("/tasks/archive/delete-requests").then((r) => {
      if (Array.isArray(r.data)) setDeleteRequests(r.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadDeleteRequests();
  }, [loadDeleteRequests, tasks.length]);

  useEffect(() => subscribe((e) => {
    if (e.type === "archive_delete:changed" || e.type === "tasks:changed") {
      loadDeleteRequests();
    }
  }), [subscribe, loadDeleteRequests]);

  // Prune selectedIds if tasks disappear
  useEffect(() => {
    const validSet = new Set(tasks.map((t) => t.id));
    setSelectedIds((prev) => prev.filter((id) => validSet.has(id)));
  }, [tasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesTitle = (t.title || "").toLowerCase().includes(q);
        const matchesDesc = (t.description || "").toLowerCase().includes(q);
        const matchesNum = (t.number_str || "").toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesNum) return false;
      }
      if (selectedMonth && (t.archived_month || (t.archived_at || t.completed_at || t.created_at || "").slice(0, 7)) !== selectedMonth) {
        return false;
      }
      if (selectedAssignee) {
        const uids = t.assignee_ids && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : []);
        if (!uids.includes(selectedAssignee)) return false;
      }
      if (selectedPriority && (t.priority || "").toLowerCase() !== selectedPriority.toLowerCase()) {
        return false;
      }
      if (selectedDept && t.department !== selectedDept) {
        return false;
      }
      return true;
    });
  }, [tasks, search, selectedMonth, selectedAssignee, selectedPriority, selectedDept]);

  // Group into monthly folders
  const monthlyFolders = useMemo(() => {
    const groups = {};
    filteredTasks.forEach((t) => {
      const monthKey = t.archived_month || (t.archived_at || t.completed_at || t.created_at || "").slice(0, 7) || "unknown";
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(t);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredTasks]);

  const allMonths = useMemo(() => {
    const m = new Set();
    tasks.forEach((t) => {
      const key = t.archived_month || (t.archived_at || t.completed_at || t.created_at || "").slice(0, 7);
      if (key && key.length >= 7) m.add(key.slice(0, 7));
    });
    return Array.from(m).sort((a, b) => b.localeCompare(a));
  }, [tasks]);

  const toggleFolder = (key) => {
    setOpenFolders((prev) => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key]
    }));
  };

  const isFolderOpen = (key) => openFolders[key] !== false;

  const toggleSelect = (id, e) => {
    e?.stopPropagation();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectFolder = (folderTasks, e) => {
    e?.stopPropagation();
    const ids = folderTasks.map((t) => t.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const unarchiveTask = async (id, e) => {
    e?.stopPropagation();
    try {
      await api.patch(`/tasks/${id}`, { archived: false, status: "todo" });
      playSound("click");
      toast.success("Tugas dipulihkan dan dikembalikan ke Board!");
      reload?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memulihkan tugas"));
    }
  };

  const deleteSingleArchivedTask = async () => {
    if (!confirmSingleTask) return;
    setBusyDelete(true);
    try {
      await api.delete(`/tasks/${confirmSingleTask.id}`);
      playSound("click");
      toast.success(`Tugas "${confirmSingleTask.title}" dihapus dari arsip.`);
      setSelectedIds((prev) => prev.filter((x) => x !== confirmSingleTask.id));
      setConfirmSingleTask(null);
      reload?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus tugas"));
    } finally {
      setBusyDelete(false);
    }
  };

  const deleteSelectedArchivedTasks = async () => {
    if (!selectedIds.length) return;
    setBusyDelete(true);
    try {
      const { data } = await api.post("/tasks/archive/bulk-delete", { ids: selectedIds });
      playSound("click");
      toast.success(`${data?.deleted_count || selectedIds.length} tugas arsip berhasil dihapus.`);
      setSelectedIds([]);
      setConfirmBulkDelete(false);
      setEmptyModalOpen(false);
      reload?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus tugas terpilih"));
    } finally {
      setBusyDelete(false);
    }
  };

  const requestMonthDelete = async () => {
    if (!confirmMonthDelete?.monthKey) return;
    setBusyDelete(true);
    try {
      const { data } = await api.post("/tasks/archive/delete-month", { month: confirmMonthDelete.monthKey });
      playSound("click");
      if (data?.existing) {
        toast.info(`Permintaan hapus arsip ${confirmMonthDelete.folderName} sudah diajukan · ${data.request?.approved_count || 0}/2 persetujuan.`);
      } else {
        toast.success(`Permintaan hapus arsip ${confirmMonthDelete.folderName} dikirim! Menunggu persetujuan minimal 2 orang.`);
      }
      setConfirmMonthDelete(null);
      setEmptyModalOpen(false);
      loadDeleteRequests();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengajukan penghapusan arsip bulan"));
    } finally {
      setBusyDelete(false);
    }
  };

  const decideMonthDelete = async (reqId, decision) => {
    setBusyDelete(true);
    try {
      const { data } = await api.post(`/tasks/archive/delete-requests/${reqId}/decision`, { decision });
      playSound("click");
      if (data?.status === "rejected") {
        toast.info("Permintaan hapus arsip bulan ditolak.");
      } else if (data?.executed) {
        toast.success(`Persetujuan 2/2 lengkap! ${data.deleted_count || 0} tugas arsip bulan tersebut berhasil dihapus.`);
        reload?.();
      } else {
        toast.success(`Persetujuan ${data?.approved_count || 1}/${data?.needed || 2} tercatat. Menunggu 1 persetujuan lagi untuk menghapus.`);
      }
      loadDeleteRequests();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memproses persetujuan"));
    } finally {
      setBusyDelete(false);
    }
  };

  const triggerAutoArchive = async () => {
    setSyncing(true);
    try {
      const res = await api.post("/tasks/auto-archive");
      playSound("task_done");
      toast.success(res.data?.message || "Auto-archive mingguan selesai diproses!");
      reload?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memproses auto-archive"));
    } finally {
      setSyncing(false);
    }
  };

  const openEmptyModal = () => {
    if (!emptyMonthTarget && allMonths.length > 0) {
      setEmptyMonthTarget(allMonths[0]);
    }
    setEmptyModalOpen(true);
  };

  const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
  const reqByMonth = useMemo(() => {
    const map = {};
    deleteRequests.forEach((r) => {
      if (r && r.month && (r.status === "pending" || r.status === "partial")) {
        map[r.month] = r;
      }
    });
    return map;
  }, [deleteRequests]);

  return (
    <div className="space-y-5 animate-rise" data-testid="task-archive-view">
      {/* Auto-archive system banner + Empty Task trigger */}
      <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sky-900 lg:flex-row lg:items-center lg:justify-between dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm">
            <Zap size={16} />
          </div>
          <div>
            <p className="text-sm font-bold">Auto-Archive Mingguan Aktif</p>
            <p className="text-xs text-sky-800/90 dark:text-sky-300/90">
              Tugas dengan status <b>Selesai</b> otomatis diarsipkan ke dalam folder bulanan setiap hari <b>Minggu pukul 23:00 WIB</b>.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openEmptyModal}
            disabled={tasks.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-45 cursor-pointer"
            data-testid="archive-empty-task-btn"
          >
            <Trash2 size={13} />
            Empty Task
          </button>
          <button
            type="button"
            onClick={triggerAutoArchive}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 dark:bg-sky-500 cursor-pointer"
            data-testid="trigger-auto-archive-btn"
          >
            <RotateCcw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Memproses..." : "Arsipkan Tugas Selesai Sekarang"}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border bg-surface p-3 shadow-sm">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border bg-surface2 px-3">
          <Search size={15} className="text-sub" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul, ID, atau deskripsi arsip..."
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-sub"
            data-testid="archive-search-input"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-sub hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>

        <AppSelect
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="h-10 rounded-xl border bg-surface2 px-3 text-xs font-medium"
          data-testid="archive-filter-month"
        >
          <option value="">Semua Bulan Folder</option>
          {allMonths.map((m) => (
            <option key={m} value={m}>
              📁 {formatMonthFolder(m)}
            </option>
          ))}
        </AppSelect>

        <AppSelect
          value={selectedAssignee}
          onChange={(e) => setSelectedAssignee(e.target.value)}
          className="h-10 rounded-xl border bg-surface2 px-3 text-xs font-medium"
          data-testid="archive-filter-assignee"
        >
          <option value="">Semua PIC / Assignee</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.name}
            </option>
          ))}
        </AppSelect>

        <AppSelect
          value={selectedPriority}
          onChange={(e) => setSelectedPriority(e.target.value)}
          className="h-10 rounded-xl border bg-surface2 px-3 text-xs font-medium"
          data-testid="archive-filter-priority"
        >
          <option value="">Semua Prioritas</option>
          {Object.entries(PRIORITY).map(([k, p]) => (
            <option key={k} value={k}>
              {p.name}
            </option>
          ))}
        </AppSelect>

        {depts.length > 0 && (
          <AppSelect
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="h-10 rounded-xl border bg-surface2 px-3 text-xs font-medium"
            data-testid="archive-filter-dept"
          >
            <option value="">Semua Divisi</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </AppSelect>
        )}

        {(search || selectedMonth || selectedAssignee || selectedPriority || selectedDept) && (
          <button
            onClick={() => {
              setSearch("");
              setSelectedMonth("");
              setSelectedAssignee("");
              setSelectedPriority("");
              setSelectedDept("");
            }}
            className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-brand hover:underline"
          >
            <X size={13} /> Reset Filter
          </button>
        )}
      </div>

      {/* Multi-select Bulk Delete Bar */}
      {selectedIds.length > 0 && (
        <div
          className="sticky top-14 md:top-2 z-30 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 dark:border-rose-800/70 bg-surface px-4 py-2.5 shadow-lg"
          data-testid="archive-bulk-bar"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-ink">
            <CheckSquare size={16} className="text-rose-600" />
            <span>{selectedIds.length} tugas arsip dipilih</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold text-sub hover:bg-surface2 cursor-pointer"
              data-testid="archive-clear-selection-btn"
            >
              Batal Pilih
            </button>
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 text-xs font-bold text-white shadow-xs cursor-pointer"
              data-testid="archive-delete-selected-btn"
            >
              <Trash2 size={13} /> Hapus {selectedIds.length} Terpilih
            </button>
          </div>
        </div>
      )}

      {/* Monthly Folders List */}
      <div className="space-y-4">
        {monthlyFolders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed bg-surface p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface2 text-sub">
              <Inbox size={28} />
            </div>
            <h4 className="mt-4 text-base font-bold">Tidak ada tugas dalam arsip</h4>
            <p className="mt-1 max-w-sm text-xs text-sub">
              {search || selectedMonth
                ? "Tidak ada tugas arsip yang cocok dengan kata kunci atau filter yang dipilih."
                : "Tugas yang selesai akan otomatis masuk ke folder arsip tiap Minggu pukul 23:00 WIB, atau klik tombol di atas untuk mengarsipkan sekarang."}
            </p>
          </div>
        ) : (
          monthlyFolders.map(([monthKey, folderTasks]) => {
            const isOpen = isFolderOpen(monthKey);
            const folderName = formatMonthFolder(monthKey);
            const allFolderSelected = folderTasks.length > 0 && folderTasks.every((t) => selectedIds.includes(t.id));
            const monthReq = reqByMonth[monthKey];
            const alreadyApprovedByMe = Boolean(monthReq && me?.user_id && (monthReq.approved_by || []).includes(me.user_id));

            return (
              <div
                key={monthKey}
                className="overflow-hidden rounded-3xl border bg-surface shadow-sm transition-all"
                data-testid={`archive-folder-${monthKey}`}
              >
                {/* Folder Accordion Header */}
                <div
                  onClick={() => toggleFolder(monthKey)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFolder(monthKey); } }}
                  className="flex w-full flex-wrap items-center justify-between gap-3 border-b bg-surface2/60 px-5 py-4 text-left transition-colors hover:bg-surface2 cursor-pointer"
                  data-testid={`folder-toggle-${monthKey}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => toggleSelectFolder(folderTasks, e)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-surface text-sub hover:text-brand hover:border-brand transition-colors cursor-pointer"
                      title={allFolderSelected ? "Batalkan pilihan bulan ini" : "Pilih semua tugas di bulan ini"}
                      data-testid={`select-folder-${monthKey}`}
                    >
                      {allFolderSelected ? <CheckSquare size={15} className="text-brand" /> : <Square size={15} />}
                    </button>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
                      {isOpen ? <FolderOpen size={18} /> : <Folder size={18} />}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-ink flex flex-wrap items-center gap-2">
                        <span>{folderName}</span>
                        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-sub shadow-sm">
                          {folderTasks.length} tugas
                        </span>
                        {monthReq && (
                          <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">
                            Persetujuan Hapus {monthReq.approved_count || 0}/{monthReq.needed || 2}
                          </span>
                        )}
                      </h3>
                      <p className="text-[11px] text-sub">
                        Periode arsip otomatis bulanan · {folderTasks.filter((t) => t.status === "done").length} tugas selesai
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sub ml-auto" onClick={(e) => e.stopPropagation()}>
                    {!monthReq && (
                      <button
                        type="button"
                        onClick={() => setConfirmMonthDelete({ monthKey, folderName, count: folderTasks.length })}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer whitespace-nowrap"
                        title="Ajukan hapus seluruh arsip bulan ini"
                        data-testid={`empty-month-${monthKey}`}
                      >
                        <Trash2 size={12} />
                        Hapus 1 Bulan
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleFolder(monthKey)}
                      className="flex items-center gap-1 text-xs font-medium text-sub hover:text-ink px-1 py-1 cursor-pointer"
                    >
                      <span>{isOpen ? "Tutup Folder" : "Buka Folder"}</span>
                      {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>
                  </div>
                </div>

                {/* Month Delete 2-Approval Status Banner */}
                {monthReq && (
                  <div
                    className="flex flex-col gap-3 border-b border-amber-200/80 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`month-delete-approval-${monthKey}`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-ink">
                          Menunggu Persetujuan Hapus 1 Bulan · {monthReq.approved_count || 0}/{monthReq.needed || 2}
                        </p>
                        <p className="text-[11px] text-sub">
                          Diajukan oleh <b>{monthReq.requested_by_name}</b> · Minimal <b>2 orang</b> menyetujui sebelum {monthReq.task_count} tugas di {folderName} dihapus permanen.
                          {Array.isArray(monthReq.approvers) && monthReq.approvers.length > 0 && (
                            <> Sudah setuju: <b>{monthReq.approvers.map((a) => a.name).join(", ")}</b>.</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyDelete}
                        onClick={() => decideMonthDelete(monthReq.id, "reject")}
                        className="inline-flex h-8 items-center gap-1 rounded-xl border border-rose-200 bg-surface px-3 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        data-testid={`reject-month-delete-${monthKey}`}
                      >
                        <X size={13} /> Tolak
                      </button>
                      <button
                        type="button"
                        disabled={busyDelete || alreadyApprovedByMe}
                        onClick={() => decideMonthDelete(monthReq.id, "approve")}
                        className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs disabled:opacity-55 cursor-pointer whitespace-nowrap"
                        data-testid={`approve-month-delete-${monthKey}`}
                      >
                        <Check size={13} />
                        {alreadyApprovedByMe
                          ? `Sudah Setuju ${monthReq.approved_count}/${monthReq.needed}`
                          : `Setujui Hapus ${monthReq.approved_count}/${monthReq.needed}`}
                      </button>
                    </div>
                  </div>
                )}

                {/* Folder Content / Tasks List */}
                {isOpen && (
                  <div className="divide-y p-1">
                    {folderTasks.map((task) => {
                      const user = users.find((u) => u.user_id === task.assignee_id);
                      const project = projects?.[task.project_id];
                      const isChecked = selectedIds.includes(task.id);

                      let completedTimeStr = "Selesai";
                      if (task.completed_at || task.archived_at) {
                        try {
                          const dateObj = new Date(task.completed_at || task.archived_at);
                          completedTimeStr = format(dateObj, "d MMM yyyy, HH:mm", { locale: localeId }) + " WIB";
                        } catch {
                          completedTimeStr = "Selesai";
                        }
                      }

                      return (
                        <div
                          key={task.id}
                          onClick={() => onOpen(task.id)}
                          className={`group flex flex-col gap-3 rounded-2xl p-4 transition-colors sm:flex-row sm:items-center sm:justify-between cursor-pointer ${isChecked ? "bg-rose-50/50 dark:bg-rose-950/20" : "hover:bg-surface2/80"}`}
                          data-testid={`archive-task-${task.id}`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={(e) => toggleSelect(task.id, e)}
                              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sub hover:text-brand cursor-pointer"
                              aria-label="Pilih tugas arsip"
                              data-testid={`select-archive-task-${task.id}`}
                            >
                              {isChecked ? <CheckSquare size={16} className="text-rose-600" /> : <Square size={16} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold text-sub w-16">{task.number_str || "TSK"}</span>
                                <PriorityBadge value={task.priority} />
                                {project && (
                                  <span className="rounded-lg bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-sub">
                                    📁 {project.name}
                                  </span>
                                )}
                                <Labels ids={task.label_ids} small max={2} />
                              </div>
                              <h4 className="mt-1.5 text-sm font-bold text-ink group-hover:text-brand transition-colors">
                                {task.title}
                              </h4>
                              {task.description && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-sub opacity-85">
                                  {task.description.replace(/<[^>]*>?/gm, "")}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-sub sm:shrink-0">
                            <div className="flex items-center gap-2">
                              <Avatar user={user} size={24} showStatus={false} />
                              <span className="font-medium text-ink">{user?.name || "Belum Ditugaskan"}</span>
                            </div>

                            <span className="flex items-center gap-1 text-[11px]" title="Waktu selesai/arsip">
                              <CheckCircle2 size={13} className="text-emerald-500" />
                              {completedTimeStr}
                            </span>

                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => unarchiveTask(task.id, e)}
                                className="flex items-center gap-1 rounded-xl border bg-surface px-2.5 py-1 text-xs font-semibold text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
                                title="Kembalikan tugas ini ke Board aktif"
                                data-testid={`unarchive-task-${task.id}`}
                              >
                                <RotateCcw size={12} />
                                Pulihkan
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmSingleTask(task)}
                                className="flex items-center gap-1 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                                title="Hapus permanen tugas ini"
                                data-testid={`delete-archive-task-${task.id}`}
                              >
                                <Trash2 size={12} />
                                Hapus
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpen(task.id)}
                                className="flex items-center gap-1 rounded-xl bg-surface2 px-2.5 py-1 text-xs font-semibold text-brand hover:underline cursor-pointer"
                              >
                                Detail <ArrowRight size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Empty Task Modal */}
      <Dialog open={emptyModalOpen} onOpenChange={setEmptyModalOpen}>
        <DialogContent className="bg-surface rounded-3xl max-w-md" data-testid="empty-task-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Trash2 size={18} className="text-rose-600" />
              Hapus Arsip Tugas
            </DialogTitle>
            <DialogDescription>
              Pilih cara menghapus arsip tugas: hapus tugas terpilih atau ajukan penghapusan 1 bulan penuh.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Option A: Selected Tasks */}
            <div className="rounded-2xl border bg-surface2/50 p-3.5 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-sub">1. Hapus Tugas Terpilih</p>
              <p className="text-xs text-sub">
                {selectedIds.length > 0
                  ? `${selectedIds.length} tugas arsip sedang dipilih untuk dihapus permanen.`
                  : "Centang beberapa tugas di daftar arsip, lalu klik Hapus Terpilih."}
              </p>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 text-xs font-bold text-white cursor-pointer"
                  data-testid="modal-delete-selected-btn"
                >
                  <Trash2 size={13} /> Hapus {selectedIds.length} Tugas Terpilih
                </button>
              )}
            </div>

            {/* Option B: Delete Entire Month (Requires >= 2 Approvals) */}
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">2. Hapus 1 Bulan Penuh</p>
                <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                  Min. 2 Persetujuan
                </span>
              </div>
              <p className="text-xs text-sub">
                Seluruh tugas pada bulan yang dipilih baru akan terhapus permanen setelah mendapat minimal <b>2 persetujuan</b>.
              </p>
              <AppSelect
                value={emptyMonthTarget}
                onChange={(e) => setEmptyMonthTarget(e.target.value)}
                className="h-10 w-full rounded-xl border bg-surface px-3 text-xs font-semibold"
                data-testid="empty-modal-month-select"
              >
                {allMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthFolder(m)}
                  </option>
                ))}
              </AppSelect>
              <button
                type="button"
                disabled={!emptyMonthTarget || Boolean(reqByMonth[emptyMonthTarget])}
                onClick={() => {
                  const foundFolder = monthlyFolders.find(([k]) => k === emptyMonthTarget);
                  const count = foundFolder ? foundFolder[1].length : tasks.filter((t) => (t.archived_month || (t.archived_at || t.completed_at || t.created_at || "").slice(0, 7)) === emptyMonthTarget).length;
                  setConfirmMonthDelete({
                    monthKey: emptyMonthTarget,
                    folderName: formatMonthFolder(emptyMonthTarget),
                    count,
                  });
                }}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3.5 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                data-testid="modal-request-month-delete-btn"
              >
                <ShieldAlert size={13} />
                {reqByMonth[emptyMonthTarget]
                  ? `Menunggu Persetujuan ${reqByMonth[emptyMonthTarget].approved_count || 0}/2`
                  : `Ajukan Hapus ${formatMonthFolder(emptyMonthTarget)}`}
              </button>
            </div>
          </div>

          <DialogFooter>
            <button type="button" onClick={() => setEmptyModalOpen(false)} className="btn-ghost h-9 border px-4 text-xs font-semibold">
              Tutup
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Single Delete */}
      <Dialog open={!!confirmSingleTask} onOpenChange={(v) => !v && setConfirmSingleTask(null)}>
        <DialogContent className="bg-surface rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Tugas Arsip?</DialogTitle>
            <DialogDescription>
              Tugas <b>"{confirmSingleTask?.title}"</b> akan dihapus permanen dari arsip dan tidak dapat dipulihkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setConfirmSingleTask(null)} className="btn-ghost h-9 border px-4 text-xs font-semibold">Batal</button>
            <button
              type="button"
              disabled={busyDelete}
              onClick={deleteSingleArchivedTask}
              className="h-9 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              data-testid="confirm-single-archive-delete-btn"
            >
              Ya, Hapus Permanen
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Bulk Selected Delete */}
      <Dialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <DialogContent className="bg-surface rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus {selectedIds.length} Tugas Arsip?</DialogTitle>
            <DialogDescription>
              Sebanyak <b>{selectedIds.length} tugas arsip</b> yang dipilih akan dihapus permanen dari sistem.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setConfirmBulkDelete(false)} className="btn-ghost h-9 border px-4 text-xs font-semibold">Batal</button>
            <button
              type="button"
              disabled={busyDelete}
              onClick={deleteSelectedArchivedTasks}
              className="h-9 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              data-testid="confirm-bulk-archive-delete-btn"
            >
              Hapus {selectedIds.length} Tugas
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Month Delete Request (Requires 2 Approvals) */}
      <Dialog open={!!confirmMonthDelete} onOpenChange={(v) => !v && setConfirmMonthDelete(null)}>
        <DialogContent className="bg-surface rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-600" />
              Ajukan Hapus Arsip {confirmMonthDelete?.folderName}?
            </DialogTitle>
            <DialogDescription>
              Folder bulan <b>{confirmMonthDelete?.folderName}</b> berisi <b>{confirmMonthDelete?.count || 0} tugas</b>. Penghapusan 1 bulan penuh memerlukan <b>minimal persetujuan 2 orang</b> sebelum seluruh tugas benar-benar terhapus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setConfirmMonthDelete(null)} className="btn-ghost h-9 border px-4 text-xs font-semibold">Batal</button>
            <button
              type="button"
              disabled={busyDelete}
              onClick={requestMonthDelete}
              className="h-9 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              data-testid="confirm-request-month-delete-btn"
            >
              Ajukan Penghapusan
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
