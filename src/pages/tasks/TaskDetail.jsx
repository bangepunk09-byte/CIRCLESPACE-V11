import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Share2, Paperclip, CheckCircle2, RotateCcw, Send, MessageSquare, History, Link2, X, Printer } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { DatePicker, DateTimePicker } from "../../components/ui/date-picker";
import { Avatar, Spinner, fmtDate, rel, dueInfo, getTaskCompliance, getTaskComplianceDetail } from "../../components/common";
import RichEditor, { RichView } from "../../components/RichEditor";
import { inp, UserSelect, MultiUserSelect, PrioritySelect, LabelPicker, ItemPicker, ColorPicker, AttachmentList, useUploader, ListEditor } from "./fields";
import { getBoardAssigneeScope } from "./boardScope";
import { AppSelect, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { toDeadline } from "./TaskCreate";
import Checkpoints, { CommentItem, CommentMentionInput, extractCommentMentions } from "./Checkpoints";
import { playSound } from "../../lib/sound";
import { INITIAL_TASKS } from "../../data/initialTasks";
import PrintPreviewDialog from "../../components/PrintPreviewDialog";
import { tryNativePrint } from "../../lib/printReport";

function Row({ label, children }) {
  return <div className="grid w-full min-w-0 items-center gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3"><span className="text-xs font-semibold text-sub">{label}</span><div className="min-w-0 w-full max-w-full">{children}</div></div>;
}

function Comments({ t, reload }) {
  const { users, userMap, me } = useApp();
  const [text, setText] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    const ids = extractCommentMentions(text, mentionIds, users);
    setBusy(true);
    try {
      await api.post(`/tasks/${t.id}/comments`, { text, mention_ids: ids });
      const notifiedNames = ids
        .filter((uid) => uid !== me?.user_id)
        .map((uid) => userMap?.[uid]?.name)
        .filter(Boolean);
      if (notifiedNames.length > 0) {
        toast.success(`Komentar terkirim · Notifikasi dikirim ke ${notifiedNames.join(", ")}`);
      }
      setText("");
      setMentionIds([]);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="task-comments">
      {(t.comments || []).map((c) => <CommentItem key={c.id} c={c} t={t} reload={reload} showCheckpoint />)}
      <CommentMentionInput
        value={text}
        onChange={setText}
        mentionIds={mentionIds}
        onMentionIdsChange={setMentionIds}
        onSubmit={send}
        placeholder="Tulis komentar… ketik @Nama untuk menyebut rekan"
        testid="task-comment-input"
        rightSlot={
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="btn-accent flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 cursor-pointer"
            aria-label="Kirim komentar"
            data-testid="task-comment-submit"
          >
            <Send size={16} />
          </button>
        }
      />
    </div>
  );
}

const getInitialTask = (id) => {
  if (!id) return null;
  try {
    const c1 = localStorage.getItem("circle_tasks_cache");
    if (c1) {
      const arr = JSON.parse(c1);
      const found = Array.isArray(arr) && arr.find((x) => x && x.id === id);
      if (found) return found;
    }
    const c2 = localStorage.getItem("circle_cache_tasks");
    if (c2) {
      const arr = JSON.parse(c2);
      const found = Array.isArray(arr) && arr.find((x) => x && x.id === id);
      if (found) return found;
    }
  } catch {}
  return INITIAL_TASKS.find((x) => x.id === id) || {
    id,
    number_str: "TSK",
    title: "Detail Tugas",
    status: "todo",
    priority: "medium",
    checkpoints: [],
    comments: [],
    activity: []
  };
};

export default function TaskDetail({ id, onClose, onChanged }) {
  const { me, statuses, userMap, labelMap, isManager, subscribe } = useApp();
  const [t, setT] = useState(() => getInitialTask(id));
  const [boards, setBoards] = useState(() => {
    try {
      const saved = localStorage.getItem("circle_boards_cache");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [tab, setTab] = useState("comments");
  const [groups, setGroups] = useState(null);
  const [approving, setApproving] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    if (!id) return;
    api.get(`/tasks/${id}`)
      .then((r) => {
        if (r.data) setT(r.data);
      })
      .catch(() => {
        const local = getInitialTask(id);
        if (local) setT(local);
      });
  };
  useEffect(() => {
    if (id) {
      setT(getInitialTask(id));
      load();
      api.get("/boards").then((r) => {
        if (Array.isArray(r.data)) {
          setBoards(r.data);
          try { localStorage.setItem("circle_boards_cache", JSON.stringify(r.data)); } catch {}
        }
      }).catch(() => {});
    }
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!id || !subscribe) return;
    return subscribe((e) => {
      if (e.type === "tasks:changed" && e.task?.id === id) {
        setT((prev) => ({ ...(prev || {}), ...e.task }));
      }
    });
  }, [id, subscribe]);

  const patch = async (body, msg) => {
    setT((prev) => (prev ? { ...prev, ...body, updated_at: new Date().toISOString() } : prev));
    try {
      const { data } = await api.patch(`/tasks/${id}`, body);
      setT(data);
      if (body.status === "done" || statuses.find((s) => s.key === body.status)?.is_done) {
        playSound("task_done");
      } else {
        playSound("click");
      }
      onChanged?.(data);
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
      load();
    }
  };
  const setAtt = (fn) => patch({ attachments: fn(t.attachments) });
  const { pick, input } = useUploader(setAtt);
  const share = async (cid) => { try { await api.patch(`/tasks/${id}`, { status: "in_review" }); await api.post(`/tasks/${id}/share`, { conversation_id: cid }); toast.success("Preview dikirim ke grup dan status diubah ke In Review"); setGroups(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const done = statuses.find((s) => s.key === t?.status)?.is_done;
  const ro = t ? t.can_edit === false : false;
  const d = t && dueInfo(t.deadline, done);
  const reqIds = t?.requestor_ids && t.requestor_ids.length ? t.requestor_ids : (t?.requestor_id ? [t.requestor_id] : (t?.created_by ? [t.created_by] : []));
  const revIds = t?.reviewer_ids && t.reviewer_ids.length ? t.reviewer_ids : reqIds;
  const reviewer = t && me?.user_id && (revIds.includes(me.user_id) || reqIds.includes(me.user_id));

  const approvalObj = t?.approvals || t?.approval || {
    needed: 2,
    approved_by: [],
    status: done ? "approved" : "pending",
  };
  const approvedList = Array.isArray(approvalObj.approved_by) ? approvalObj.approved_by : [];
  const approvedCount = approvedList.length;
  const isApprovedFull = approvedCount >= 2 || approvalObj.status === "approved" || Boolean(done && approvedCount > 0);
  const approvalProgressPct = isApprovedFull ? 100 : approvedCount === 1 ? 50 : 0;
  const alreadyApprovedByMe = Boolean(me?.user_id && approvedList.includes(me.user_id));

  const activeBoardObj = boards.find((b) => b.id === t?.board_id) || t?.board || null;
  const assigneeScope = getBoardAssigneeScope({
    board: activeBoardObj,
    boards,
    boardId: t?.board_id || "",
    projectId: t?.project_id || "",
    department: t?.department || "",
    users: Object.values(userMap || {})
  });
  const members = assigneeScope.ids;

  const handleReviseRedirectToChat = async () => {
    try {
      await api.post(`/tasks/${id}/approval`, { decision: "revise", note: "" });
    } catch (err) {
      toast.error(errMsg(err));
    }
    let targetCid = t?.conversation_id || "";
    if (!targetCid) {
      try {
        const { data: convs } = await api.get("/conversations");
        const list = Array.isArray(convs) ? convs : [];
        const deptName = String(activeBoardObj?.department || t?.department || "").trim().toLowerCase();
        const deptGroup = deptName && list.find((c) => c.type === "group" && String(c.name || "").trim().toLowerCase() === deptName);
        const anyGroup = list.find((c) => c.type === "group");
        const primaryAssignee = t?.assignee_id || t?.assignee_ids?.[0];
        const dmWithAssignee = primaryAssignee && list.find((c) => c.type === "dm" && Array.isArray(c.member_ids) && c.member_ids.includes(primaryAssignee));
        targetCid = deptGroup?.id || dmWithAssignee?.id || anyGroup?.id || "";
      } catch {}
    }
    toast.info("Mengarahkan ke chat untuk mengirim catatan revisi");
    onChanged?.();
    onClose?.();
    const qs = new URLSearchParams({
      reviseTask: id || "",
      taskNum: t?.number_str || "",
      taskTitle: t?.title || ""
    }).toString();
    if (targetCid) {
      navigate(`/messages/${targetCid}?${qs}`);
    } else {
      navigate(`/messages?${qs}`);
    }
  };

  const handleApproveTask = async () => {
    if (approving) return;
    setApproving(true);
    try {
      const res = await api.post(`/tasks/${id}/approval`, { decision: "approve" });
      const updatedTask = res.data?.task || res.data;
      const nextApproved =
        res.data?.approvals?.approved_by ||
        updatedTask?.approvals?.approved_by ||
        updatedTask?.approval?.approved_by ||
        [];
      if (updatedTask && updatedTask.id) {
        setT((prev) => ({ ...(prev || {}), ...updatedTask }));
      }
      if (updatedTask?.status === "done" || nextApproved.length >= 2) {
        playSound("task_done");
        toast.success("Tugas disetujui 2/2 (100%) dan otomatis dipindah ke Done!");
      } else {
        playSound("click");
        toast.success("Disetujui 1/2 (50%). Menunggu 1 persetujuan lagi.");
      }
      load();
      onChanged?.(updatedTask);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setApproving(false);
    }
  };

  return (
    <>
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full max-w-full overflow-y-auto overflow-x-hidden bg-surface p-0 sm:max-w-3xl print:max-w-none print:static print:shadow-none print:border-0" data-testid="task-detail-panel">
        <SheetHeader className="flex flex-row items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
          <SheetTitle className="text-base font-bold">Detail Tugas</SheetTitle>
          <div className="flex items-center gap-1 print:hidden">
            <button
              type="button"
              onClick={() => {
                if (!tryNativePrint()) {
                  setPrintPreviewOpen(true);
                }
              }}
              className="flex h-9 sm:h-10 items-center gap-2 rounded-full border px-3 sm:px-4 text-sm font-semibold text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
              title="Cetak Detail Tugas"
              data-testid="task-detail-print-btn"
            >
              <Printer size={16} />
              <span className="hidden sm:inline">Cetak / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
              aria-label="Tutup detail"
              data-testid="task-detail-close-btn"
            >
              <X size={18} />
            </button>
          </div>
        </SheetHeader>
        {!t ? <Spinner /> : (
          <div className="animate-task-reveal w-full max-w-full min-w-0 overflow-x-hidden pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            <div className="h-2" style={{ background: t.card_color || "transparent" }} />
            <div className="w-full max-w-full min-w-0 space-y-4 sm:space-y-5 p-4 sm:p-6 overflow-x-hidden">
              <div>
                <p className="text-xs font-semibold text-sub" data-testid="task-detail-id">{t.number_str}{t.archived && " · Diarsipkan"}{done && t.completed_at && <span className="text-emerald-600"> · Selesai {fmtDate(t.completed_at, "d MMM yyyy HH:mm")} oleh {userMap[t.completed_by]?.name}</span>}</p>
                <input defaultValue={t.title} key={t.updated_at} disabled={ro} onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && patch({ title: e.target.value })} className="mt-1 w-full bg-transparent text-xl sm:text-2xl font-bold outline-none" data-testid="task-detail-title" />
              </div>
              {ro ? (
                t.description ? <RichView html={t.description} className="rounded-2xl bg-surface2 p-4" /> : null
              ) : (
                <RichEditor
                  key={`desc-${t.id}`}
                  value={t.description || ""}
                  onBlur={(html) => {
                    if (html !== (t.description || "")) {
                      patch({ description: html });
                    }
                  }}
                  testid="task-detail-editor"
                />
              )}
              
              {/* Approval status banner */}
              {(t.status === "in_review" || approvedCount > 0) && (
                <div
                  className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 transition-colors ${
                    isApprovedFull
                      ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                      : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-800"
                  }`}
                  data-testid="review-actions"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`text-xs sm:text-sm font-bold ${
                        isApprovedFull
                          ? "text-emerald-800 dark:text-emerald-200"
                          : "text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      {isApprovedFull ? "✓ Disetujui 100% · Status: Done" : "Menunggu Approval"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] sm:text-xs font-bold whitespace-nowrap shrink-0 ${
                        isApprovedFull
                          ? "bg-emerald-200/70 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200"
                          : "bg-amber-200/60 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      {isApprovedFull
                        ? `${approvedCount >= 2 ? `${approvedCount}/2` : "2/2"} Disetujui`
                        : `${approvedCount}/2 Disetujui`}
                    </span>
                  </div>
                  <div
                    className={`h-2.5 w-full overflow-hidden rounded-full ${
                      isApprovedFull ? "bg-emerald-200/50 dark:bg-emerald-950" : "bg-amber-200/50 dark:bg-amber-950"
                    }`}
                  >
                    <div
                      className={`h-full transition-all duration-500 ${
                        isApprovedFull ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      style={{ width: `${approvalProgressPct}%` }}
                      data-testid="review-approval-progress-bar"
                    />
                  </div>
                  {approvedList.length > 0 && (
                    <div
                      className={`flex flex-wrap items-center gap-1.5 text-xs ${
                        isApprovedFull
                          ? "text-emerald-800 dark:text-emerald-300"
                          : "text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      <span>Telah disetujui oleh:</span>
                      <b>{approvedList.map((uid) => userMap[uid]?.name?.split(" ")[0] || uid).join(", ")}</b>
                    </div>
                  )}
                  {!isApprovedFull ? (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleReviseRedirectToChat}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-surface px-4 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:bg-surface2 cursor-pointer"
                        data-testid="request-revision-btn"
                      >
                        <RotateCcw size={14} /> Revisi
                      </button>
                      <button
                        type="button"
                        disabled={approving || alreadyApprovedByMe}
                        onClick={handleApproveTask}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
                        data-testid="approve-task-btn"
                      >
                        <CheckCircle2 size={14} />
                        {approving ? "Memproses…" : alreadyApprovedByMe ? "Sudah Setuju ✓" : "Setuju"}
                      </button>
                    </div>
                  ) : (
                    !alreadyApprovedByMe && (
                      <div className="pt-1">
                        <button
                          type="button"
                          disabled={approving}
                          onClick={handleApproveTask}
                          className="w-full h-9 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50 transition-colors cursor-pointer"
                          data-testid="approve-task-more-btn"
                        >
                          + Setuju Juga ({approvedCount} telah setuju)
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}


              <div className="space-y-3">
                <Row label="Status">
                  <div className="space-y-1.5 w-full">
                    <Select value={t.status} disabled={ro} onValueChange={(val) => patch({ status: val })}>
                      <SelectTrigger className="w-full bg-surface2 border-slate-200 dark:border-slate-800 rounded-xl" data-testid="task-detail-status">
                        <SelectValue placeholder="Pilih status..." />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s.key} value={s.key} data-testid={`status-option-${s.key}`}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const comp = getTaskCompliance(t);
                      const detail = getTaskComplianceDetail(t);
                      if (!comp) return null;
                      return (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            comp === "On time"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : comp === "Overdue"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${comp === "On time" ? "bg-emerald-500" : comp === "Overdue" ? "bg-rose-500" : "bg-amber-500"}`} />
                            {comp}
                          </span>
                          <span className="text-[11px] text-sub truncate">{detail}</span>
                        </div>
                      );
                    })()}
                  </div>
                </Row>

                {/* Multi Requestor */}
                <Row label="Requestor">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reqIds.map((uid) => (
                        <span key={uid} className="inline-flex items-center gap-1.5 rounded-full border bg-surface2 px-2.5 py-1 text-xs font-semibold">
                          <Avatar user={userMap[uid]} size={18} showStatus={false} />
                          {userMap[uid]?.name || "Pengguna"}
                          {!ro && reqIds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = reqIds.filter((x) => x !== uid);
                                patch({ requestor_ids: next, reviewer_ids: next }, "Requestor diperbarui");
                              }}
                              className="ml-0.5 text-slate-400 hover:text-rose-500"
                              title="Hapus requestor"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {!ro && (
                        <AppSelect
                          value=""
                          onChange={(e) => {
                            if (e.target.value && !reqIds.includes(e.target.value)) {
                              const next = [...reqIds, e.target.value];
                              patch({ requestor_ids: next, reviewer_ids: next }, "Requestor ditambah");
                            }
                          }}
                          className="h-7 rounded-full border bg-surface px-2.5 text-xs font-medium"
                        >
                          <option value="">+ Tambah Requestor</option>
                          {Object.values(userMap || {})
                            .filter((u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant" && !reqIds.includes(u.user_id))
                            .map((u) => (
                              <option key={u.user_id} value={u.user_id}>{u.name}</option>
                            ))}
                        </AppSelect>
                      )}
                    </div>
                  </div>
                </Row>

                <Row label="Assignee">
                  <MultiUserSelect
                    value={t.assignee_ids && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : [])}
                    ids={members}
                    scopeLabel={assigneeScope.scopeLabel}
                    emptyMessage={assigneeScope.emptyMessage}
                    onChange={(ids) => {
                      const nextIds = Array.isArray(ids) ? ids : [];
                      const nextPrimary = nextIds[0] || null;
                      const prevPrimary = t.assignee_ids?.[0] || t.assignee_id || null;
                      const patchBody = {
                        assignee_ids: nextIds,
                        assignee_id: nextPrimary
                      };
                      if (Array.isArray(t.checkpoints) && t.checkpoints.length > 0 && nextPrimary) {
                        patchBody.checkpoints = t.checkpoints.map((c) => {
                          if (!c || c.unassigned) return c;
                          if (!c.assignee_id || (prevPrimary && c.assignee_id === prevPrimary && !nextIds.includes(prevPrimary))) {
                            return { ...c, assignee_id: nextPrimary };
                          }
                          return c;
                        });
                      }
                      patch(patchBody);
                    }}
                    testid="task-detail-assignee"
                  />
                </Row>
                <Row label="Prioritas"><PrioritySelect value={t.priority} onChange={(v) => patch({ priority: v })} testid="task-detail-priority" /></Row>
                <Row label="Deadline"><div className="flex flex-wrap items-center gap-2"><DateTimePicker disabled={ro} value={t.deadline ? fmtDate(t.deadline, "yyyy-MM-dd'T'HH:mm") : ""} onChange={(val) => { const v = val ? new Date(val).toISOString() : null; if (v !== t.deadline) patch({ deadline: v }); }} placeholder="Pilih deadline & jam" className={`${inp} flex-1 min-w-[180px]`} data-testid="task-detail-deadline" />{d && <span className={`whitespace-nowrap text-xs ${d.cls}`}>{d.state === "overdue" ? "Overdue" : d.state === "today" ? "Hari Ini" : ""}</span>}</div></Row>
                <Row label="IP / Brand"><LabelPicker value={t.label_ids} onChange={(v) => patch({ label_ids: v })} testid="task-detail-labels" /></Row>
                <Row label="Jenis Item"><ItemPicker value={t.item_type} onChange={(v) => patch({ item_type: v })} testid="task-detail-item" /></Row>
                <Row label="Link File / Folder"><input disabled={ro} defaultValue={t.link_url || ""} key={`l${t.link_url}`} onBlur={(e) => e.target.value.trim() !== (t.link_url || "") && patch({ link_url: e.target.value.trim() })} placeholder="https://…" className={inp} data-testid="task-detail-link" /></Row>
                <Row label="Tanggal Submit"><DatePicker disabled={ro} value={t.submit_date || ""} onChange={(val) => (val || null) !== (t.submit_date || null) && patch({ submit_date: val || null })} placeholder="Pilih tanggal submit" className={inp} data-testid="task-detail-submit-date" /></Row>
                <Row label="Board">
                  <Select
                    value={t.board_id || "none"}
                    disabled={ro}
                    onValueChange={(val) => {
                      const nextBoardId = val === "none" ? "" : val;
                      const b = boards.find((x) => x.id === nextBoardId);
                      patch({
                        board_id: nextBoardId,
                        ...(b?.department ? { department: b.department } : {}),
                      }, "Board tugas diperbarui");
                    }}
                  >
                    <SelectTrigger className="w-full bg-surface2 border-slate-200 dark:border-slate-800 rounded-xl" data-testid="task-detail-board">
                      <SelectValue placeholder="Pilih board..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Semua Board</SelectItem>
                      {boards.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Warna Kartu"><ColorPicker value={t.card_color} onChange={(v) => patch({ card_color: v })} style={t.card_style} onStyle={(v) => patch({ card_style: v })} /></Row>
                {t.estimate && <Row label="Estimasi"><span className="text-sm">{t.estimate}</span></Row>}
              </div>
              <Checkpoints t={t} ro={ro} patch={patch} reload={load} members={members} emptyMessage={assigneeScope.emptyMessage} />
              {t.links?.length > 0 && <section><h4 className="mb-2 text-sm font-bold">Link Referensi</h4>{t.links.map((l, i) => <a key={`${l}-${i}`} href={l} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-0.5 text-sm text-brand"><Link2 size={13} /><span className="truncate">{l}</span></a>)}</section>}
              <section><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-bold">Lampiran · {(t.attachments || []).length}</h4>{!ro && <button onClick={pick} className="flex items-center gap-1 text-xs font-semibold text-brand" data-testid="task-detail-add-attachment"><Paperclip size={12} />Tambah</button>}{input}</div><AttachmentList items={t.attachments || []} onRemove={ro ? null : (a) => setAtt((x) => x.filter((y) => y.id !== a.id))} /></section>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => (groups ? setGroups(null) : api.get("/conversations").then((r) => setGroups((Array.isArray(r.data) ? r.data : []).filter((c) => c.type === "group"))).catch((e) => toast.error(errMsg(e, "Gagal memuat daftar grup"))))} className="btn-accent flex h-10 items-center gap-1.5 px-4 text-sm font-semibold shadow-sm" data-testid="task-share-btn"><Share2 size={15} />Kirim Preview ke Grup</button>
                {t.conversation_id && <button onClick={() => navigate(`/messages/${t.conversation_id}`)} className="btn-ghost flex h-10 items-center gap-1.5 border px-4 text-sm font-semibold" data-testid="task-open-conversation"><MessageSquare size={14} />Buka Obrolan</button>}
                {(isManager || (me?.user_id && reqIds.includes(me.user_id))) && <button onClick={() => patch({ archived: !t.archived }, t.archived ? "Dipulihkan" : "Diarsipkan")} className="btn-ghost flex h-10 items-center gap-1.5 border px-4 text-sm font-semibold" data-testid="task-archive-btn"><Archive size={14} />{t.archived ? "Pulihkan" : "Arsipkan"}</button>}
              </div>
              {groups && (
                <div className="rounded-2xl border bg-surface2/60 p-3 space-y-2">
                  <p className="text-xs font-bold text-sub">Pilih grup tujuan pengiriman preview & approval:</p>
                  {groups.length === 0 ? (
                    <p className="text-xs text-sub py-2">Anda belum bergabung ke grup mana pun.</p>
                  ) : (
                    <div className="grid gap-1 sm:grid-cols-2">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => share(g.id)}
                          className="flex items-center gap-2 rounded-xl border bg-surface p-2.5 text-left text-sm font-medium hover:border-brand transition-colors"
                          data-testid={`share-to-${g.id}`}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-soft-purple text-xs font-bold">#</span>
                          <span className="truncate">{g.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <section>
                <div className="mb-3 flex items-center gap-1 border-b text-sm font-semibold">{[["comments", MessageSquare, `Komentar · ${(t.comments || []).length}`], ["activity", History, `Aktivitas · ${(t.activity || []).length}`]].map(([k, I, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px flex items-center gap-1.5 rounded-none border-b-2 px-3 py-2 transition-colors cursor-pointer ${tab === k ? "border-[var(--c-accent)] text-ink" : "border-transparent text-sub hover:text-ink hover:border-slate-300 dark:hover:border-slate-700"}`} data-testid={`task-tab-${k}`}><I size={14} />{l}</button>)}</div>
                {tab === "comments" ? <Comments t={t} reload={load} /> : (
                  (t.activity || []).length === 0 ? (
                    <p className="py-4 text-center text-xs text-sub">Belum ada riwayat aktivitas pada tugas ini.</p>
                  ) : (
                    <ul className="space-y-3" data-testid="task-activity">
                      {(t.activity || []).map((a, i) => (
                        <li key={a.id || `act_${i}`} className="flex items-start gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-surface2/40 p-3 text-sm">
                          <Avatar user={userMap[a.actor_id]} size={26} showStatus={false} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="leading-snug">
                              <b className="text-ink">{userMap[a.actor_id]?.name || "Pengguna"}</b>{" "}
                              <span className="text-sub">{a.action}</span>
                              {!a.detail && a.changes?.from !== undefined && a.changes?.to !== undefined && typeof a.changes.to !== "object" && a.changes.to !== null && (
                                <span className="text-sub">
                                  {" "}→ <b className="text-ink">{userMap[a.changes.to]?.name || statuses.find((s) => s.key === a.changes.to)?.name || String(a.changes.to).slice(0, 80)}</b>
                                </span>
                              )}
                            </p>
                            {a.detail && (
                              <div className="mt-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-surface px-3 py-2 text-xs text-ink/90 whitespace-pre-wrap break-words">
                                {a.detail}
                              </div>
                            )}
                            <span className="mt-1 block text-[11px] text-sub">
                              {fmtDate(a.created_at, "d MMM yyyy, HH:mm:ss")} · {rel(a.created_at)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <PrintPreviewDialog
      open={printPreviewOpen}
      onOpenChange={setPrintPreviewOpen}
      mode="detail"
      task={t}
      boardName={activeBoardObj?.name || t?.department || "Detail Tugas"}
      userMap={userMap}
      labelMap={labelMap}
      statuses={statuses}
    />
    </>
  );
}
