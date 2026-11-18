import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  StickyNote,
  Plus,
  Check,
  CheckCircle2,
  Archive,
  ArchiveRestore,
  Send,
  Pencil,
  Trash2,
  X,
  Users,
  Pin,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg } from "../lib/api";
import { hasCompletedInitialHydrate, rehydrateIfServerRestarted } from "../lib/persistentMirror";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

const NOTE_THEMES = {
  amber: {
    label: "Kuning",
    swatch: "#F59E0B",
    card: "bg-amber-50/90 border-amber-200/90 dark:bg-amber-950/25 dark:border-amber-800/60",
    topBar: "#F59E0B",
    barFill: "bg-amber-500",
    checkBg: "bg-amber-500 border-amber-500 text-white",
  },
  emerald: {
    label: "Mint",
    swatch: "#10B981",
    card: "bg-emerald-50/85 border-emerald-200/90 dark:bg-emerald-950/25 dark:border-emerald-800/60",
    topBar: "#10B981",
    barFill: "bg-emerald-500",
    checkBg: "bg-emerald-500 border-emerald-500 text-white",
  },
  sky: {
    label: "Biru",
    swatch: "#0EA5E9",
    card: "bg-sky-50/90 border-sky-200/90 dark:bg-sky-950/25 dark:border-sky-800/60",
    topBar: "#0EA5E9",
    barFill: "bg-sky-500",
    checkBg: "bg-sky-500 border-sky-500 text-white",
  },
  rose: {
    label: "Mawar",
    swatch: "#F43F5E",
    card: "bg-rose-50/85 border-rose-200/90 dark:bg-rose-950/25 dark:border-rose-800/60",
    topBar: "#F43F5E",
    barFill: "bg-rose-500",
    checkBg: "bg-rose-500 border-rose-500 text-white",
  },
  violet: {
    label: "Ungu",
    swatch: "#8B5CF6",
    card: "bg-violet-50/85 border-violet-200/90 dark:bg-violet-950/25 dark:border-violet-800/60",
    topBar: "#8B5CF6",
    barFill: "bg-violet-500",
    checkBg: "bg-violet-500 border-violet-500 text-white",
  },
};

function notesCacheKey(uid) {
  return `circle_notes_cache_${uid || "anon"}`;
}

function readCachedNotes(uid) {
  try {
    const raw = localStorage.getItem(notesCacheKey(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function writeCachedNotes(uid, list) {
  try {
    localStorage.setItem(notesCacheKey(uid), JSON.stringify(list));
  } catch {}
}

function computeProgress(items = [], completedFallback = false) {
  const arr = Array.isArray(items) ? items : [];
  const total = arr.length;
  const doneCount = arr.filter((i) => i?.done).length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : completedFallback ? 100 : 0;
  return { total, doneCount, progress, isExecuted: total > 0 && doneCount === total };
}

export default function StickyNotesWidget({ densityStyles }) {
  const { me, subscribe, t } = useApp();
  const navigate = useNavigate();
  const uid = me?.user_id;

  const [notes, setNotes] = useState(() => readCachedNotes(uid));
  const [viewMode, setViewMode] = useState("active"); // 'active' | 'archived'
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Create/Edit dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftColor, setDraftColor] = useState("amber");
  const [draftPinned, setDraftPinned] = useState(false);
  const [draftItems, setDraftItems] = useState([]);
  const [newPointInput, setNewPointInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Send to Group dialog state
  const [sendNote, setSendNote] = useState(null);
  const [groupsList, setGroupsList] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [extraNoteText, setExtraNoteText] = useState("");
  const [sendingGroup, setSendingGroup] = useState(false);

  const commitNotes = useCallback(
    (updater) => {
      setNotes((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        writeCachedNotes(uid, next);
        return next;
      });
    },
    [uid]
  );

  const loadNotes = useCallback(async () => {
    if (!uid) return;
    try {
      const { data } = await api.get("/notes");
      if (Array.isArray(data)) {
        const cached = readCachedNotes(uid);
        if (data.length === 0 && cached.length > 0 && !hasCompletedInitialHydrate()) {
          rehydrateIfServerRestarted(api).catch(() => {});
          return;
        }
        commitNotes(data);
      }
    } catch {}
  }, [uid, commitNotes]);

  useEffect(() => {
    setNotes(readCachedNotes(uid));
    loadNotes();
  }, [uid, loadNotes]);

  useEffect(() => {
    return subscribe((evt) => {
      if (evt.type !== "notes:changed") return;
      if (evt.user_id && uid && evt.user_id !== uid) return;
      if (evt.action === "delete" && evt.deleted_id) {
        commitNotes((prev) => prev.filter((n) => n.id !== evt.deleted_id));
      } else if (evt.action === "upsert" && evt.note) {
        commitNotes((prev) => {
          const exists = prev.some((n) => n.id === evt.note.id);
          const next = exists
            ? prev.map((n) => (n.id === evt.note.id ? evt.note : n))
            : [evt.note, ...prev];
          return [...next].sort((a, b) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            return String(b.updated_at || b.created_at || "").localeCompare(
              String(a.updated_at || a.created_at || "")
            );
          });
        });
      } else {
        loadNotes();
      }
    });
  }, [subscribe, uid, commitNotes, loadNotes]);

  const activeNotes = useMemo(() => notes.filter((n) => !n.archived), [notes]);
  const archivedNotes = useMemo(() => notes.filter((n) => Boolean(n.archived)), [notes]);
  const visibleNotes = viewMode === "archived" ? archivedNotes : activeNotes;

  const openCreateDialog = () => {
    setEditingNote(null);
    setDraftTitle("");
    setDraftColor("amber");
    setDraftPinned(false);
    setDraftItems([]);
    setNewPointInput("");
    setEditorOpen(true);
  };

  const openEditDialog = (note) => {
    setEditingNote(note);
    setDraftTitle(note.title || "");
    setDraftColor(NOTE_THEMES[note.color] ? note.color : "amber");
    setDraftPinned(Boolean(note.pinned));
    setDraftItems(
      Array.isArray(note.items)
        ? note.items.map((it) => ({ ...it }))
        : []
    );
    setNewPointInput("");
    setEditorOpen(true);
  };

  const appendPointFromInput = () => {
    const raw = newPointInput.trim();
    if (!raw) return;
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setDraftItems((prev) => [
      ...prev,
      ...lines.map((line, i) => ({
        id: `ni_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        text: line,
        done: false,
      })),
    ]);
    setNewPointInput("");
  };

  const handleSaveEditor = async (e) => {
    e.preventDefault();
    const pendingLine = newPointInput.trim();
    const finalItems = pendingLine
      ? [
          ...draftItems,
          ...pendingLine
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((line, i) => ({
              id: `ni_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
              text: line,
              done: false,
            })),
        ]
      : draftItems;

    const cleanItems = finalItems
      .map((it) => ({ ...it, text: String(it.text || "").trim() }))
      .filter((it) => it.text.length > 0);

    const cleanTitle = draftTitle.trim() || "Catatan Checklist";
    if (cleanItems.length === 0 && !draftTitle.trim()) {
      toast.error("Isi judul atau minimal satu poin checklist.");
      return;
    }

    const { total, doneCount, progress } = computeProgress(cleanItems);
    const nowIso = new Date().toISOString();

    setSavingNote(true);
    try {
      if (editingNote) {
        const optimistic = {
          ...editingNote,
          title: cleanTitle,
          color: draftColor,
          pinned: draftPinned,
          items: cleanItems,
          progress,
          done_count: doneCount,
          total_count: total,
          completed: total > 0 && doneCount === total,
          updated_at: nowIso,
        };
        commitNotes((prev) => prev.map((n) => (n.id === editingNote.id ? optimistic : n)));
        setEditorOpen(false);
        const { data } = await api.patch(`/notes/${editingNote.id}`, {
          title: cleanTitle,
          color: draftColor,
          pinned: draftPinned,
          items: cleanItems,
        });
        if (data?.id) {
          commitNotes((prev) => prev.map((n) => (n.id === data.id ? data : n)));
        }
        toast.success("Sticky note diperbarui");
      } else {
        const tempId = `note_opt_${Date.now()}`;
        const optimistic = {
          id: tempId,
          user_id: uid,
          title: cleanTitle,
          color: draftColor,
          pinned: draftPinned,
          items: cleanItems,
          progress,
          done_count: doneCount,
          total_count: total,
          completed: total > 0 && doneCount === total,
          archived: false,
          sent_groups: [],
          created_at: nowIso,
          updated_at: nowIso,
        };
        commitNotes((prev) => [optimistic, ...prev]);
        setViewMode("active");
        setEditorOpen(false);
        const { data } = await api.post("/notes", {
          title: cleanTitle,
          color: draftColor,
          pinned: draftPinned,
          items: cleanItems,
        });
        if (data?.id) {
          commitNotes((prev) => prev.map((n) => (n.id === tempId ? data : n)));
        }
        toast.success("Sticky note berhasil ditambahkan");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan sticky note"));
      loadNotes();
    } finally {
      setSavingNote(false);
    }
  };

  const handleToggleChecklistItem = async (note, itemId) => {
    const prevNote = note;
    const nextItems = (note.items || []).map((it) =>
      it.id === itemId ? { ...it, done: !it.done } : it
    );
    const { total, doneCount, progress, isExecuted } = computeProgress(nextItems);
    const nowIso = new Date().toISOString();
    const optimistic = {
      ...note,
      items: nextItems,
      progress,
      done_count: doneCount,
      total_count: total,
      completed: isExecuted,
      updated_at: nowIso,
    };

    commitNotes((prev) => prev.map((n) => (n.id === note.id ? optimistic : n)));
    if (isExecuted && prevNote.progress < 100) {
      toast.success(`"${note.title}" selesai 100% — Terlaksana!`);
    }

    try {
      const { data } = await api.patch(`/notes/${note.id}`, { items: nextItems });
      if (data?.id) {
        commitNotes((prev) => prev.map((n) => (n.id === data.id ? data : n)));
      }
    } catch (err) {
      commitNotes((prev) => prev.map((n) => (n.id === prevNote.id ? prevNote : n)));
      toast.error(errMsg(err, "Gagal menyimpan perubahan checklist"));
    }
  };

  const handleToggleArchive = async (note) => {
    const nextArchived = !note.archived;
    const prevNote = note;
    commitNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? { ...n, archived: nextArchived, updated_at: new Date().toISOString() }
          : n
      )
    );
    toast.success(nextArchived ? "Sticky note diarsipkan" : "Sticky note dipulihkan ke Aktif");
    try {
      const { data } = await api.patch(`/notes/${note.id}`, { archived: nextArchived });
      if (data?.id) {
        commitNotes((prev) => prev.map((n) => (n.id === data.id ? data : n)));
      }
    } catch (err) {
      commitNotes((prev) => prev.map((n) => (n.id === prevNote.id ? prevNote : n)));
      toast.error(errMsg(err, "Gagal mengubah status arsip"));
    }
  };

  const handleDeleteNote = async (noteId) => {
    const backup = notes;
    setConfirmDeleteId(null);
    commitNotes((prev) => prev.filter((n) => n.id !== noteId));
    toast.success("Sticky note dihapus");
    try {
      await api.delete(`/notes/${noteId}`);
    } catch (err) {
      commitNotes(backup);
      toast.error(errMsg(err, "Gagal menghapus sticky note"));
    }
  };

  const openSendToGroupModal = async (note) => {
    setSendNote(note);
    setExtraNoteText("");
    setSelectedGroupId("");
    try {
      const [convRes, browseRes] = await Promise.all([
        api.get("/conversations").catch(() => ({ data: [] })),
        api.get("/groups/browse").catch(() => ({ data: [] })),
      ]);
      const convGroups = Array.isArray(convRes.data)
        ? convRes.data.filter((c) => c && c.type === "group")
        : [];
      const browseGroups = Array.isArray(browseRes.data)
        ? browseRes.data.filter(
            (g) =>
              g &&
              (g.is_member ||
                (Array.isArray(g.member_ids) && g.member_ids.includes(uid)) ||
                me?.role === "super_admin")
          )
        : [];
      const mergedMap = new Map();
      [...convGroups, ...browseGroups].forEach((g) => {
        if (!g?.id) return;
        const existing = mergedMap.get(g.id) || {};
        mergedMap.set(g.id, { ...existing, ...g });
      });
      const list = Array.from(mergedMap.values()).sort((a, b) => {
        const aDept = a.group_type === "department" ? 0 : 1;
        const bDept = b.group_type === "department" ? 0 : 1;
        if (aDept !== bDept) return aDept - bDept;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      setGroupsList(list);
      if (list.length > 0) setSelectedGroupId(list[0].id);
    } catch {}
  };

  const handleConfirmSendToGroup = async (e) => {
    e.preventDefault();
    if (!sendNote || !selectedGroupId) return;
    setSendingGroup(true);
    try {
      const { data } = await api.post(`/notes/${sendNote.id}/send-to-group`, {
        conversation_id: selectedGroupId,
        extra_note: extraNoteText.trim(),
      });
      if (data?.note?.id) {
        commitNotes((prev) => prev.map((n) => (n.id === data.note.id ? data.note : n)));
      }
      const targetName = data?.group_name || "Grup";
      const targetId = selectedGroupId;
      setSendNote(null);
      toast.success(`Sticky note dikirim ke grup ${targetName}`, {
        action: {
          label: "Buka Grup",
          onClick: () => navigate(`/messages/${targetId}`),
        },
      });
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengirim sticky note ke grup"));
    } finally {
      setSendingGroup(false);
    }
  };

  return (
    <div
      key="messages"
      data-testid="sticky-notes-widget"
      className={`flex min-w-0 w-full flex-col justify-between overflow-hidden rounded-2xl sm:rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 ${densityStyles.cardPadding} shadow-[0_4px_24px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-200`}
    >
      <div className="min-w-0">
        {/* Header */}
        <div
          className={`flex items-center justify-between gap-2 min-w-0 border-b border-slate-100 dark:border-slate-800 ${densityStyles.cardHeader}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <StickyNote size={15} />
            </span>
            <span className="truncate text-sm font-extrabold text-ink">{t("notes_widget_title", "Sticky Notes")}</span>
          </div>

          <div className="inline-flex shrink-0 items-center rounded-xl border border-slate-200/80 dark:border-slate-700 bg-surface2 p-0.5 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setViewMode("active")}
              className={`rounded-lg px-2.5 py-1 transition-colors cursor-pointer ${
                viewMode === "active"
                  ? "bg-white dark:bg-slate-800 text-ink shadow-xs"
                  : "text-sub hover:text-ink"
              }`}
              data-testid="notes-tab-active"
            >
              {t("notes_tab_active", "Aktif")} ({activeNotes.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode("archived")}
              className={`rounded-lg px-2.5 py-1 transition-colors cursor-pointer ${
                viewMode === "archived"
                  ? "bg-white dark:bg-slate-800 text-ink shadow-xs"
                  : "text-sub hover:text-ink"
              }`}
              data-testid="notes-tab-archived"
            >
              {t("notes_tab_archived", "Arsip")} ({archivedNotes.length})
            </button>
          </div>
        </div>

        {/* Sticky Notes Stack */}
        <div className="max-h-[450px] overflow-y-auto scroll-thin pr-0.5 space-y-3">
          {visibleNotes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-6 text-center">
              <StickyNote size={24} className="mx-auto text-amber-500/70 mb-2" />
              <p className="text-xs font-bold text-ink">
                {viewMode === "archived"
                  ? t("notes_empty_archived_title", "Belum ada sticky note yang diarsipkan")
                  : t("notes_empty_title", "Belum ada Sticky Notes")}
              </p>
              <p className="text-[11px] text-sub mt-1 leading-relaxed">
                {viewMode === "archived"
                  ? t("notes_empty_archived_desc", "Catatan yang Anda arsipkan akan tersimpan rapi di sini.")
                  : t("notes_empty_desc", "Catat poin-poin kerja sebagai checklist, pantau persentase selesai, lalu kirimkan progresnya ke grup tim.")}
              </p>
            </div>
          ) : (
            visibleNotes.map((note) => {
              const theme = NOTE_THEMES[note.color] || NOTE_THEMES.amber;
              const items = Array.isArray(note.items) ? note.items : [];
              const { total, doneCount, progress, isExecuted } = computeProgress(
                items,
                note.completed
              );
              const isExpanded = expandedIds.has(note.id);
              const visibleItems = isExpanded ? items : items.slice(0, 5);
              const hiddenCount = Math.max(0, items.length - visibleItems.length);
              const isConfirmingDel = confirmDeleteId === note.id;

              return (
                <article
                  key={note.id}
                  data-testid={`sticky-note-card-${note.id}`}
                  className={`rounded-2xl border border-t-[3px] p-3.5 transition-all ${theme.card}`}
                  style={{ borderTopColor: theme.topBar }}
                >
                  {/* Title & Progress % */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {note.pinned && (
                          <Pin size={12} className="text-amber-600 dark:text-amber-400 shrink-0 fill-current" />
                        )}
                        <h4 className="text-sm font-extrabold text-ink truncate leading-snug">
                          {note.title}
                        </h4>
                      </div>
                    </div>

                    <div
                      className={`inline-flex shrink-0 items-center gap-1 font-mono text-xs font-extrabold tabular-nums ${
                        isExecuted
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-slate-700 dark:text-slate-200"
                      }`}
                      data-testid={`sticky-note-progress-${note.id}`}
                    >
                      {isExecuted && <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />}
                      <span>
                        {progress}%{isExecuted ? ` · ${t("notes_status_done", "Terlaksana")}` : ""}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isExecuted ? "bg-emerald-500" : theme.barFill
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[10.5px] font-semibold text-sub tabular-nums shrink-0">
                      {doneCount}/{total}
                    </span>
                  </div>

                  {/* Interactive Checklist Points */}
                  {items.length > 0 ? (
                    <ul className="mt-2.5 space-y-1.5">
                      {visibleItems.map((it) => (
                        <li key={it.id}>
                          <button
                            type="button"
                            onClick={() => handleToggleChecklistItem(note, it.id)}
                            className="group flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-white/60 dark:hover:bg-slate-900/40 transition-colors cursor-pointer"
                            data-testid={`sticky-note-check-${it.id}`}
                          >
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                it.done
                                  ? theme.checkBg
                                  : "border-slate-400/70 bg-white/80 dark:border-slate-600 dark:bg-slate-900/70 group-hover:border-slate-600"
                              }`}
                            >
                              {it.done && <Check size={11} strokeWidth={3} />}
                            </span>
                            <span
                              className={`text-xs leading-snug break-words flex-1 ${
                                it.done
                                  ? "line-through text-slate-400 dark:text-slate-500"
                                  : "text-slate-800 dark:text-slate-100 font-medium"
                              }`}
                            >
                              {it.text}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : note.content ? (
                    <p className="mt-2 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-line">
                      {note.content}
                    </p>
                  ) : null}

                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIds((prev) => new Set([...prev, note.id]))
                      }
                      className="mt-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                    >
                      +{hiddenCount} poin lainnya
                    </button>
                  )}
                  {isExpanded && items.length > 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(note.id);
                          return next;
                        })
                      }
                      className="mt-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                    >
                      Tampilkan ringkas
                    </button>
                  )}

                  {/* Sent Groups Meta */}
                  {Array.isArray(note.sent_groups) && note.sent_groups.length > 0 && (
                    <p className="mt-2 text-[10.5px] font-semibold text-sub truncate">
                      Terkirim ke #{note.sent_groups[0].group_name} ({note.sent_groups[0].pct}%)
                    </p>
                  )}

                  {/* Card Actions */}
                  <div className="mt-3 pt-2 border-t border-black/8 dark:border-white/10 flex flex-wrap items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => openSendToGroupModal(note)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/85 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700 px-2.5 text-[11px] font-bold text-ink hover:border-brand hover:text-brand transition-colors cursor-pointer"
                      data-testid={`sticky-note-send-${note.id}`}
                    >
                      <Send size={11} />
                      <span>{t("notes_send_group_btn", "Kirim ke Grup")}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleArchive(note)}
                        title={note.archived ? t("notes_restore_btn", "Pulihkan") : t("notes_archive_btn", "Arsip")}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/75 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700 px-2 text-[11px] font-semibold text-sub hover:text-ink transition-colors cursor-pointer"
                        data-testid={`sticky-note-archive-${note.id}`}
                      >
                        {note.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                        <span className="hidden sm:inline">{note.archived ? t("notes_restore_btn", "Pulihkan") : t("notes_archive_btn", "Arsip")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditDialog(note)}
                        title="Edit Sticky Note"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/75 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700 text-sub hover:text-ink transition-colors cursor-pointer"
                        aria-label="Edit catatan"
                      >
                        <Pencil size={12} />
                      </button>

                      {isConfirmingDel ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note.id)}
                          className="inline-flex h-7 items-center rounded-lg bg-rose-600 px-2 text-[10.5px] font-bold text-white cursor-pointer"
                        >
                          Hapus?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(note.id)}
                          title="Hapus Sticky Note"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/75 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700 text-sub hover:text-rose-600 transition-colors cursor-pointer"
                          aria-label="Hapus catatan"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom Action CTA */}
      <div className={`${densityStyles.footerMargin} border-t border-slate-100 dark:border-slate-800`}>
        <button
          type="button"
          onClick={openCreateDialog}
          data-testid="create-sticky-note-btn"
          className="btn-accent inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-white font-bold text-sm shadow-md shadow-rose-500/25 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
        >
          <Plus size={16} />
          <span>{t("notes_create_btn", "Buat Sticky Note")}</span>
        </button>
      </div>

      {/* Create / Edit Sticky Note Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg p-0 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b text-left pr-10">
            <DialogTitle className="text-base sm:text-lg font-extrabold text-ink">
              {editingNote ? t("notes_modal_edit_title", "Edit Sticky Note") : t("notes_modal_create_title", "Buat Sticky Note Checklist")}
            </DialogTitle>
            <DialogDescription className="text-xs text-sub">
              {t("notes_modal_desc", "Catat poin penting sebagai checklist. Persentase keterlaksanaan terhitung otomatis saat poin dicentang.")}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEditor} className="p-5 space-y-4 max-h-[75dvh] overflow-y-auto scroll-thin">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-ink">Judul Catatan *</label>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Mis. Checklist Persiapan Launch Campaign"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm font-semibold outline-none focus:border-brand"
                data-testid="note-title-input"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-sub mb-1.5">
                  Warna Sticky Note
                </p>
                <div className="flex items-center gap-2">
                  {Object.entries(NOTE_THEMES).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDraftColor(key)}
                      title={cfg.label}
                      className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                        draftColor === key ? "scale-110 border-ink" : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: cfg.swatch }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDraftPinned((p) => !p)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors cursor-pointer ${
                  draftPinned
                    ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-surface2 text-sub hover:text-ink"
                }`}
              >
                <Pin size={13} className={draftPinned ? "fill-current" : ""} />
                <span>{draftPinned ? "Disematkan" : "Sematkan"}</span>
              </button>
            </div>

            {/* Checklist Builder */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-ink">
                  Poin Checklist ({draftItems.length})
                </label>
                {draftItems.length > 0 && (
                  <span className="font-mono text-[11px] font-bold text-sub tabular-nums">
                    {computeProgress(draftItems).progress}% selesai
                  </span>
                )}
              </div>

              {draftItems.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto scroll-thin pr-1">
                  {draftItems.map((it, idx) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-2 rounded-xl border bg-surface2/60 px-2.5 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setDraftItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, done: !row.done } : row))
                          )
                        }
                        className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border cursor-pointer ${
                          it.done
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-slate-400 bg-surface"
                        }`}
                      >
                        {it.done && <Check size={11} strokeWidth={3} />}
                      </button>
                      <input
                        value={it.text}
                        onChange={(e) =>
                          setDraftItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, text: e.target.value } : row))
                          )
                        }
                        className={`flex-1 bg-transparent text-xs outline-none ${
                          it.done ? "line-through text-sub" : "text-ink font-medium"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-sub hover:text-rose-600 p-1 cursor-pointer"
                        aria-label="Hapus poin"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  value={newPointInput}
                  onChange={(e) => setNewPointInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      appendPointFromInput();
                    }
                  }}
                  placeholder="Tulis poin checklist lalu tekan Enter..."
                  className="h-9 flex-1 rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
                  data-testid="note-point-input"
                />
                <button
                  type="button"
                  onClick={appendPointFromInput}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border bg-surface px-3 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer shrink-0"
                  data-testid="note-add-point-btn"
                >
                  <Plus size={13} /> Tambah
                </button>
              </div>
            </div>

            <DialogFooter className="pt-2 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="h-10 rounded-xl border bg-surface px-4 text-xs font-bold text-sub hover:text-ink cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingNote}
                className="btn-accent h-10 rounded-xl px-5 text-xs font-bold text-white cursor-pointer"
                data-testid="note-save-btn"
              >
                {savingNote ? "Menyimpan..." : editingNote ? "Simpan Perubahan" : "Simpan Sticky Note"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Sticky Note to Group Dialog */}
      <Dialog open={Boolean(sendNote)} onOpenChange={(v) => !v && setSendNote(null)}>
        <DialogContent className="max-w-md p-0 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b text-left pr-10">
            <DialogTitle className="text-base font-extrabold text-ink">
              {t("notes_send_modal_title", "Kirim Sticky Note ke Grup")}
            </DialogTitle>
            <DialogDescription className="text-xs text-sub">
              Bagikan poin checklist dan persentase progres ({sendNote ? computeProgress(sendNote.items, sendNote.completed).progress : 0}%) langsung ke obrolan grup.
            </DialogDescription>
          </DialogHeader>

          {sendNote && (
            <form onSubmit={handleConfirmSendToGroup} className="p-5 space-y-4">
              <div className="rounded-xl border bg-surface2/60 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 font-bold text-ink">
                  <span className="truncate">{sendNote.title}</span>
                  <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300 shrink-0">
                    {computeProgress(sendNote.items, sendNote.completed).progress}%
                  </span>
                </div>
                <p className="text-[11px] text-sub">
                  {computeProgress(sendNote.items, sendNote.completed).doneCount} dari{" "}
                  {computeProgress(sendNote.items, sendNote.completed).total} poin selesai
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-ink">Pilih Grup Tujuan *</label>
                {groupsList.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-3 text-xs text-sub text-center">
                    Anda belum tergabung di grup mana pun.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto scroll-thin space-y-1.5">
                    {groupsList.map((grp) => {
                      const active = selectedGroupId === grp.id;
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => setSelectedGroupId(grp.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition-colors cursor-pointer ${
                            active
                              ? "border-brand bg-brand/8 text-ink"
                              : "bg-surface2/40 text-sub hover:text-ink"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Users size={13} className="shrink-0 text-brand" />
                            <span className="truncate">#{grp.name}</span>
                          </span>
                          <span className="text-[10.5px] font-semibold text-sub shrink-0">
                            {grp.group_type === "department" ? "Divisi" : "Grup"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">
                  Catatan Tambahan (Opsional)
                </label>
                <input
                  value={extraNoteText}
                  onChange={(e) => setExtraNoteText(e.target.value)}
                  placeholder="Mis. Mohon dicek progres hari ini ya tim"
                  className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
                />
              </div>

              <DialogFooter className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setSendNote(null)}
                  className="h-9 rounded-xl border bg-surface px-4 text-xs font-bold text-sub cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={sendingGroup || !selectedGroupId}
                  className="btn-accent inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                  data-testid="confirm-send-note-group-btn"
                >
                  <Send size={13} />
                  <span>{sendingGroup ? "Mengirim..." : t("notes_send_group_btn", "Kirim ke Grup")}</span>
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
