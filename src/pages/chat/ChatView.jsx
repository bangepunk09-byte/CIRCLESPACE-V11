import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, PanelRight, BellOff, Bell, X, Pin, FileText, CheckSquare, UserPlus, MailPlus, Lock, LogOut, Archive, Trash2, Shield, MapPin, ShieldCheck, Sparkles, Check } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { hasCompletedInitialHydrate, rehydrateIfServerRestarted } from "../../lib/persistentMirror";
import { Avatar, Spinner, fmtDate, GroupIcon, ImageLightbox } from "../../components/common";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import MessageItem from "./MessageItem";
import Composer from "./Composer";
import CreatePollDialog from "./CreatePollDialog";
import {
  CHAT_CACHE,
  clearChatCache,
  getInitialMsgs,
  hydrateConversationsCache,
  upsertConversationInCache,
  appendMessageToCache,
  updateMessageInCache,
  seedPollCache,
} from "../../lib/workspaceCaches";
import TaskCreate from "../tasks/TaskCreate";
import { GroupDialog, MemberPicker } from "./GroupDialog";
import { playSound } from "../../lib/sound";
import CircleFeatureHub from "./CircleFeatureHub";

export {
  CHAT_CACHE,
  clearChatCache,
  getInitialMsgs,
  hydrateConversationsCache,
  upsertConversationInCache,
  appendMessageToCache,
  updateMessageInCache,
};

const CIRCLE_QUICK_PROMPTS = [
  { label: "Morning Brief", prompt: "/morning-brief" },
  { label: "KPI & Scorecard", prompt: "/kpi" },
  { label: "Rebalance Beban", prompt: "/rebalance" },
  { label: "Kendala & Bottleneck", prompt: "/blockers" },
  { label: "Mode Fokus Top 3", prompt: "/focus" },
  { label: "Daily Standup", prompt: "/standup" },
  { label: "Kesehatan Proyek", prompt: "/project-health" },
  { label: "Agenda Hari Ini", prompt: "/schedule-today" },
  { label: "Risiko Deadline", prompt: "/risk" },
  { label: "Kepatuhan SLA", prompt: "/sla" },
  { label: "Leaderboard Tim", prompt: "/leaderboard" },
  { label: "Ringkasan Workspace", prompt: "Ringkasan semua data workspace" }
];

function Panel({ conv, reload, onClose }) {
  const { me, userMap, prefs, savePrefs, isAdmin, online, t } = useApp();
  const [tab, setTab] = useState("members");
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const navigate = useNavigate();
  const isOfficialOrDept = conv.group_type === "department" || String(conv.id || "").startsWith("group_official_");
  const isMyDeptManager = isOfficialOrDept && ["manager", "department_manager", "project_manager"].includes(me?.role) && me?.department && String(me.department).trim().toLowerCase() === String(conv.name || "").trim().toLowerCase();
  const amAdmin = Boolean(conv.can_manage || isAdmin || (conv.created_by && conv.created_by === me?.user_id) || conv.admin_ids?.includes(me?.user_id) || isMyDeptManager);
  const canDeleteOfficial = !isOfficialOrDept && !conv.is_verified ? amAdmin : isAdmin;
  const muted = (prefs.muted_conversations || []).includes(conv.id);
  const run = (fn, msg) => async () => {
    if (busyAction) return;
    setBusyAction(true);
    try { await fn(); msg && toast.success(msg); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusyAction(false); }
  };
  const toggleMute = async () => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      await api.post(`/conversations/${conv.id}/mute`, { muted: !muted });
      savePrefs({ muted_conversations: muted ? (prefs.muted_conversations || []).filter((x) => x !== conv.id) : [...(prefs.muted_conversations || []), conv.id] });
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengubah pengaturan notifikasi"));
    } finally {
      setBusyAction(false);
    }
  };
  return (
    <div className="flex h-full flex-col" data-testid="chat-context-panel">
      <div className="flex h-14 sm:h-16 shrink-0 items-center justify-between border-b bg-surface px-4 pt-safe">
        <p className="font-bold">Detail</p>
        <button onClick={onClose} aria-label="Tutup panel" className="btn-ghost flex h-9 w-9 items-center justify-center text-sub hover:text-ink"><X size={18} /></button>
      </div>
      <div className="p-4">
        {conv.type === "group" && <p className="text-sm text-sub">{conv.description}</p>}
        {conv.location && <p className="mt-2 flex items-center gap-1 text-xs text-sub"><MapPin size={12} />{conv.location}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={toggleMute} className="btn-ghost flex h-9 items-center gap-1.5 border px-3 text-xs font-semibold" data-testid="mute-conversation-btn">{muted ? <Bell size={14} /> : <BellOff size={14} />}{muted ? "Aktifkan Notif" : "Bisukan"}</button>
          {conv.type === "group" && amAdmin && <button onClick={() => setEdit(true)} className="btn-ghost h-9 border px-3 text-xs font-semibold" data-testid="edit-group-btn">Ubah Grup</button>}
          {conv.type === "group" && !conv.is_default && <button onClick={run(async () => { await api.post(`/groups/${conv.id}/leave`); navigate("/messages"); }, "Keluar dari grup")} className="btn-ghost flex h-9 items-center gap-1 border px-3 text-xs font-semibold" data-testid="leave-group-btn"><LogOut size={13} />Keluar</button>}
        </div>
      </div>
      <div className="flex items-center gap-1 border-b px-4 text-xs font-semibold">
        {[["members", "Anggota"], ["pinned", "Disematkan"], ["files", "File"], ["tasks", "Tugas"]].map(([tKey, tLabel]) => (
          <button
            key={tKey}
            type="button"
            onClick={() => setTab(tKey)}
            className={`-mb-px rounded-none border-b-2 px-2.5 py-2.5 transition-colors cursor-pointer ${
              tab === tKey
                ? "border-[var(--c-accent)] text-ink"
                : "border-transparent text-sub hover:text-ink hover:border-slate-300 dark:hover:border-slate-700"
            }`}
            data-testid={`panel-tab-${tKey}`}
          >
            {tLabel}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 scroll-thin">
        {tab === "members" && (<>
          {conv.type === "group" && amAdmin && conv.group_type === "private" && Array.isArray(conv.join_requests) && conv.join_requests.length > 0 && (
            <div className="mb-3 rounded-2xl border border-amber-200/80 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 space-y-2" data-testid="group-join-requests-box">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Permintaan Bergabung ({conv.join_requests.length})
              </p>
              {conv.join_requests.map((req) => {
                const ru = userMap[req.user_id] || { user_id: req.user_id, name: req.name || "Karyawan" };
                return (
                  <div key={req.user_id} className="flex items-center justify-between gap-2 rounded-xl bg-surface p-2 border border-amber-100 dark:border-amber-900/50">
                    <button type="button" onClick={() => navigate(`/people/${req.user_id}`)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <Avatar user={ru} size={28} showStatus={false} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">{ru.name}</p>
                        <p className="truncate text-[10px] text-sub">{ru.department || ru.job_title || "Ingin bergabung"}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={run(() => api.post(`/groups/${conv.id}/join-requests/${req.user_id}/approve`), `${ru.name} disetujui masuk grup`)}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white cursor-pointer"
                        data-testid={`approve-join-${req.user_id}`}
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={run(() => api.post(`/groups/${conv.id}/join-requests/${req.user_id}/reject`), `Permintaan ${ru.name} ditolak`)}
                        className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100 cursor-pointer"
                        data-testid={`reject-join-${req.user_id}`}
                      >
                        Tolak
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {conv.type === "group" && amAdmin && isOfficialOrDept && Array.isArray(conv.invitations) && conv.invitations.length > 0 && (
            <div className="mb-3 rounded-2xl border border-sky-200/80 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 p-2.5 space-y-2" data-testid="group-invitations-box">
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                Undangan Terkirim ({conv.invitations.length})
              </p>
              {conv.invitations.map((inv) => {
                const iu = userMap[inv.user_id] || { user_id: inv.user_id, name: inv.name || "Karyawan" };
                return (
                  <div key={inv.user_id} className="flex items-center justify-between gap-2 rounded-xl bg-surface p-2 border border-sky-100 dark:border-sky-900/50">
                    <button type="button" onClick={() => navigate(`/people/${inv.user_id}`)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <Avatar user={iu} size={28} showStatus={false} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">{iu.name}</p>
                        <p className="truncate text-[10px] text-sub">{iu.department || iu.job_title || "Menunggu konfirmasi"}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={run(() => api.delete(`/groups/${conv.id}/invitations/${inv.user_id}`), `Undangan untuk ${iu.name} dibatalkan`)}
                      className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100 cursor-pointer shrink-0"
                      data-testid={`cancel-invite-${inv.user_id}`}
                    >
                      Batalkan
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {conv.type === "group" && amAdmin && (
            <button onClick={() => setAdd(true)} className="mb-2 flex w-full items-center gap-2 rounded-xl p-2 text-sm font-semibold text-brand hover:bg-surface2 cursor-pointer" data-testid="add-members-btn">
              {isOfficialOrDept ? <MailPlus size={16} /> : <UserPlus size={16} />}
              {isOfficialOrDept ? "Undang anggota" : "Tambah anggota"}
            </button>
          )}
          {(conv.member_ids || [])
            .filter((id) => conv.type !== "group" || id !== "user_circle_assistant")
            .map((id, i) => {
              const u = userMap[id];
              if (!u || (conv.type === "group" && (u.is_bot || u.role === "assistant"))) return null;
              const isCreator = conv.created_by === id;
              const adm = isCreator || conv.admin_ids?.includes(id);
              const canActOnMember = conv.type === "group" && amAdmin && id !== me?.user_id && !isCreator;
              return (
            <div key={`${id}-${i}`} className="group flex items-center gap-2.5 rounded-xl p-2 hover:bg-surface2">
              <button onClick={() => navigate(`/people/${id}`)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <Avatar user={u} size={32} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 truncate text-sm font-medium">
                    <span className="truncate">{u.name}</span>
                    {adm && <Shield size={11} className="shrink-0 text-brand" />}
                    {isCreator && <span className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.2 text-[9px] font-bold text-brand">{t("groups_creator_badge", "Pembuat")}</span>}
                    {!isCreator && adm && <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300">{t("groups_co_admin_badge", "Co-Admin")}</span>}
                  </span>
                  <span className="block text-[11px] text-sub">{online.has(id) ? "Online" : u.job_title}</span>
                </span>
              </button>
              {canActOnMember && (
                <span className="hidden gap-1 group-hover:flex shrink-0">
                  <button onClick={run(() => api.post(`/groups/${conv.id}/members`, { admin_id: id, make_admin: !adm }))} className="text-[10px] font-semibold text-sub hover:text-ink cursor-pointer" data-testid={`toggle-admin-${id}`}>{adm ? t("groups_revoke_co_admin", "Cabut Co-Admin") : t("groups_make_co_admin", "Jadikan Co-Admin")}</button>
                  <button onClick={run(() => api.post(`/groups/${conv.id}/members`, { remove: [id] }), "Dikeluarkan")} className="text-[10px] font-semibold text-rose-500 cursor-pointer" data-testid={`remove-member-${id}`}>Keluarkan</button>
                </span>
              )}
            </div>); })}
        </>)}
        {tab === "pinned" && (conv.pinned?.length ? conv.pinned.map((m) => <div key={m.id} className="mb-2 rounded-xl bg-surface2 p-2.5 text-sm"><p className="text-[11px] text-sub"><Pin size={10} className="inline" /> {userMap[m.sender_id]?.name} · {fmtDate(m.created_at, "d MMM")}</p><p className="mt-0.5 line-clamp-3">{m.text || "Lampiran"}</p></div>) : <p className="p-2 text-sm text-sub">Belum ada pesan disematkan.</p>)}
        {tab === "files" && (conv.files?.length ? <div className="grid grid-cols-3 gap-2">{conv.files.map((f) => f.content_type?.startsWith("image/") ? <button key={f.id} type="button" onClick={() => setLightboxImg(f)} className="overflow-hidden rounded-xl border focus:outline-none cursor-zoom-in"><img src={fileUrl(f.id)} alt={f.name} className="aspect-square w-full object-cover transition-transform hover:scale-105" /></button> : <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="col-span-3 flex items-center gap-2 rounded-xl bg-surface2 p-2 text-xs"><FileText size={14} />{f.name}</a>)}</div> : <p className="p-2 text-sm text-sub">Belum ada file yang dibagikan.</p>)}
        {tab === "tasks" && (conv.tasks?.length ? conv.tasks.map((t) => <button key={t.id} onClick={() => navigate(`/tasks?task=${t.id}`)} className="mb-1 flex w-full items-center gap-2 rounded-xl p-2 text-left text-sm hover:bg-surface2"><CheckSquare size={14} className="text-brand" /><span className="text-xs text-sub">T-{t.number}</span>{t.title}</button>) : <p className="p-2 text-sm text-sub">Tugas yang dibuat dari obrolan ini akan muncul di sini.</p>)}
      </div>
      {conv.type === "group" && amAdmin && !conv.is_default && canDeleteOfficial && (
        <div className="flex gap-2 border-t p-3">
          <button onClick={run(() => api.patch(`/groups/${conv.id}`, { archived: !conv.archived }), conv.archived ? "Dipulihkan" : "Diarsipkan")} className="btn-ghost flex h-9 flex-1 items-center justify-center gap-1 border text-xs font-semibold" data-testid="archive-group-btn"><Archive size={13} />{conv.archived ? "Pulihkan" : "Arsipkan"}</button>
          <button onClick={() => setConfirmDeleteGroup(true)} className="flex h-9 flex-1 items-center justify-center gap-1 rounded-full border border-rose-200 text-xs font-semibold text-rose-600" data-testid="delete-group-btn"><Trash2 size={13} />Hapus</button>
        </div>
      )}
      <Dialog open={confirmDeleteGroup} onOpenChange={setConfirmDeleteGroup}>
        <DialogContent className="bg-surface rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Grup Ini?</DialogTitle>
            <DialogDescription>Anggota tidak lagi dapat mengakses obrolan grup ini setelah dihapus.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setConfirmDeleteGroup(false)} className="btn-ghost h-9 border px-4 text-xs font-semibold">Batal</button>
            <button
              type="button"
              onClick={async () => {
                setConfirmDeleteGroup(false);
                try {
                  await api.delete(`/groups/${conv.id}`);
                  toast.success("Grup dihapus");
                  navigate("/messages");
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
              className="h-9 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Ya, Hapus Grup
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <GroupDialog open={edit} onOpenChange={setEdit} group={conv} onSaved={reload} />
      <MemberPicker
        open={add}
        onOpenChange={setAdd}
        exclude={Array.from(new Set([...(conv.member_ids || []), ...(isOfficialOrDept ? (conv.invitations || []).map((i) => i.user_id) : [])]))}
        title={isOfficialOrDept ? `Undang ke ${conv.name || "Grup Divisi"}` : "Tambah Anggota"}
        submitLabel={isOfficialOrDept ? "Kirim Undangan" : "Tambah"}
        onPick={(ids) =>
          isOfficialOrDept
            ? run(() => api.post(`/groups/${conv.id}/invite`, { user_ids: ids }), "Undangan terkirim ke rekan tim")()
            : run(() => api.post(`/groups/${conv.id}/members`, { add: ids }), "Anggota ditambahkan")()
        }
      />
      <ImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
    </div>
  );
}



const getInitialConv = (cid, me) => {
  if (CHAT_CACHE[`conv_${cid}`]) return CHAT_CACHE[`conv_${cid}`];
  try {
    const uid = me?.user_id;
    const saved = (uid && localStorage.getItem(`circle_convs_cache_${uid}`)) || localStorage.getItem("circle_convs_cache");
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        const found = arr.find((x) => x && x.id === cid);
        if (found) {
          CHAT_CACHE[`conv_${cid}`] = found;
          if (Array.isArray(found.messages) && !CHAT_CACHE[`msgs_${cid}`]) {
            CHAT_CACHE[`msgs_${cid}`] = found.messages;
          }
          return found;
        }
      }
    }
  } catch {}
  
  const isOfficial = cid.startsWith("group_official_");
  let name = "Obrolan";
  if (isOfficial) {
    name = cid.replace("group_official_", "");
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return {
    id: cid,
    type: isOfficial ? "group" : "dm",
    group_type: isOfficial ? "department" : undefined,
    name: name,
    member_ids: isOfficial ? [] : ["user_circle_assistant", me?.user_id].filter(Boolean),
    admin_ids: [],
    unread: 0,
    is_verified: isOfficial,
    ...(isOfficial ? { is_member: false } : {})
  };
};




export default function ChatView({ cid, onChange, onRead }) {
  const { me, ws, userMap, subscribe, online, t } = useApp();
  const [conv, setConv] = useState(() => getInitialConv(cid, me));
  const [msgs, setMsgs] = useState(() => getInitialMsgs(cid));
  const [more, setMore] = useState(false);
  const [reply, setReply] = useState(null);
  const [typing, setTyping] = useState({});
  const [panel, setPanel] = useState(window.innerWidth >= 1280);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [poll, setPoll] = useState(false);
  const [taskFrom, setTaskFrom] = useState(null);
  const [featureHubOpen, setFeatureHubOpen] = useState(false);
  const [search, setSearch] = useState(null);
  const [results, setResults] = useState([]);
  const prevCid = useRef(cid);
  const bottom = useRef(null);
  const scroller = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Synchronously swap state on cid change during render so there is 0ms lag between conversations
  if (prevCid.current !== cid) {
    prevCid.current = cid;
    const nextConv = getInitialConv(cid, me);
    const nextMsgs = getInitialMsgs(cid);
    setConv(nextConv);
    setMsgs(nextMsgs);
    setReply(null);
  }

  const loadConv = () => api.get(`/conversations/${cid}`).then((r) => {
    if (r.data) {
      setConv(r.data);
      CHAT_CACHE[`conv_${cid}`] = r.data;
    }
  }).catch((err) => {
    if (err?.response?.status === 404) {
      delete CHAT_CACHE[`conv_${cid}`];
      navigate("/messages", { replace: true });
    }
  });

  const markRead = () => {
    if (CHAT_CACHE[`conv_${cid}`]) {
      CHAT_CACHE[`conv_${cid}`].unread = 0;
    }
    onRead?.(cid);
    api.post(`/conversations/${cid}/read`).catch(() => {});
  };

  const acceptInvite = async () => {
    try {
      const { data } = await api.post(`/groups/${cid}/accept-invite`);
      const next = { ...(conv || {}), ...(data || {}), is_member: true, has_invitation: false };
      setConv(next);
      upsertConversationInCache(next, me?.user_id);
      toast.success(`Undangan diterima! Bergabung dengan ${conv?.name || "grup"}`);
      api.get(`/conversations/${cid}/messages`).then((r) => {
        const arr = Array.isArray(r.data) ? r.data : [];
        setMsgs(arr);
      }).catch(() => {});
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const declineInvite = async () => {
    try {
      await api.post(`/groups/${cid}/decline-invite`);
      setConv((prev) => ({ ...(prev || {}), has_invitation: false }));
      toast.info(`Undangan ke grup "${conv?.name || "grup"}" ditolak.`);
      navigate("/groups");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const join = async () => {
    const isDeptGroup = conv?.group_type === "department" || String(cid || "").startsWith("group_official_");
    if (isDeptGroup) {
      if (conv?.has_invitation) return acceptInvite();
      toast.error(`Grup divisi "${conv?.name || "grup"}" hanya dapat dimasuki melalui undangan resmi.`);
      return;
    }

    if (conv?.group_type === "private") {
      try {
        const { data } = await api.post(`/groups/${cid}/join`);
        if (data?.pending || data?.request_status === "pending") {
          setConv((prev) => ({ ...(prev || {}), has_pending_request: true, is_member: false }));
          toast.success(`Permintaan izin bergabung ke "${conv?.name || "grup"}" telah dikirim ke pembuat/admin grup`);
        } else if (data?.id) {
          setConv((prev) => ({ ...prev, ...data, is_member: true, has_pending_request: false }));
          upsertConversationInCache({ ...conv, ...data, is_member: true }, me?.user_id);
          toast.success(`Bergabung dengan ${conv?.name || "grup"}`);
          api.get(`/conversations/${cid}/messages`).then((r) => {
            const arr = Array.isArray(r.data) ? r.data : [];
            setMsgs(arr);
          }).catch(() => {});
        }
      } catch (e) {
        toast.error(errMsg(e));
      }
      return;
    }

    const nextMems = Array.from(new Set([...(conv?.member_ids || []), me?.user_id].filter(Boolean)));
    const optimistic = { ...conv, is_member: true, member_ids: nextMems, members: nextMems };
    setConv(optimistic);
    upsertConversationInCache(optimistic, me?.user_id);
    toast.success(`Bergabung dengan ${conv?.name || "grup"}`);
    try {
      const { data } = await api.post(`/groups/${cid}/join`);
      if (data && data.id) {
        setConv((prev) => ({ ...prev, ...data, is_member: true }));
        upsertConversationInCache({ ...optimistic, ...data, is_member: true }, me?.user_id);
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  useEffect(() => {
    const initialConv = getInitialConv(cid, me);
    const initialMsgs = getInitialMsgs(cid);
    setConv(initialConv);
    setMsgs(initialMsgs);
    requestAnimationFrame(() => bottom.current?.scrollIntoView());
    markRead();
    loadConv();
    api.get(`/conversations/${cid}/messages`).then((r) => {
      const arr = Array.isArray(r.data) ? r.data : [];
      if (arr.length === 0 && initialMsgs.length > 0 && !hasCompletedInitialHydrate()) {
        rehydrateIfServerRestarted(api).catch(() => {});
        return;
      }
      arr.forEach((m) => { if (m?.poll) seedPollCache(m.poll); });
      const hadCount = initialMsgs.length;
      setMsgs(arr);
      CHAT_CACHE[`msgs_${cid}`] = arr;
      try { localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(arr)); } catch {}
      setMore(arr.length >= 50);
      if (arr.length !== hadCount) {
        requestAnimationFrame(() => bottom.current?.scrollIntoView());
      }
    }).catch((err) => {
      if (err?.response?.status === 403) {
        setMsgs([]);
      }
    });
  }, [cid, me?.user_id]); // eslint-disable-line

  useEffect(() => {
    const onPrefill = (ev) => {
      const detail = ev?.detail || {};
      if (detail.conversationId && detail.conversationId !== cid) return;
      if (detail.replyMsg) setReply(detail.replyMsg);
    };
    window.addEventListener("circle:composer-prefill", onPrefill);
    return () => window.removeEventListener("circle:composer-prefill", onPrefill);
  }, [cid]);

  useEffect(() => {
    const reviseTask = searchParams.get("reviseTask");
    if (!reviseTask || !cid) return;
    const taskNum = searchParams.get("taskNum") || "";
    const taskTitle = searchParams.get("taskTitle") || "";
    const label = [taskNum, taskTitle ? `(${taskTitle})` : ""].filter(Boolean).join(" ");
    const prefillText = `Revisi ${label}: `.replace(/\s+/g, " ");
    const t = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("circle:composer-prefill", {
          detail: { conversationId: cid, text: prefillText }
        })
      );
      navigate(`/messages/${cid}`, { replace: true });
    }, 60);
    return () => clearTimeout(t);
  }, [searchParams, cid, navigate]);

  useEffect(() => subscribe((e) => {
    const d = e.data;
    if ((e.type === "group:updated" || e.type === "conversation:upsert") && d?.id === cid) {
      let becameMember = false;
      setConv((prev) => {
        const wasMember = prev?.is_member === true;
        const mems = Array.isArray(d.member_ids) ? d.member_ids : null;
        const nowMember = mems ? Boolean(me?.user_id && mems.includes(me.user_id)) : (d.is_member ?? prev?.is_member);
        if (!wasMember && nowMember) becameMember = true;
        const next = {
          ...(prev || {}),
          ...d,
          ...(mems ? { is_member: nowMember } : {}),
          ...(Array.isArray(d.invitations) ? {
            has_invitation: Boolean(me?.user_id && d.invitations.some((inv) => inv?.user_id === me.user_id && inv?.status === "pending")),
          } : {}),
        };
        CHAT_CACHE[`conv_${cid}`] = next;
        return next;
      });
      if (becameMember) {
        loadConv();
        api.get(`/conversations/${cid}/messages`).then((r) => {
          const arr = Array.isArray(r.data) ? r.data : [];
          setMsgs(arr);
        }).catch(() => {});
      }
    }
    if (e.type === "group:deleted" && e.id === cid) {
      navigate("/messages");
    }
    if (e.type === "message:new" && d?.conversation_id === cid) {
      if (d.poll) seedPollCache(d.poll);
      setMsgs((x) => {
        const arr = Array.isArray(x) ? x : [];
        // Replace optimistic message if matching id, poll question, or text/sender
        const optIdx = arr.findIndex((y) => y.id === d.id || (y._optimistic && y.sender_id === d.sender_id && (y.text === d.text || (y.type === "poll" && d.type === "poll"))));
        const next = optIdx !== -1
          ? arr.map((y, idx) => (idx === optIdx ? d : y))
          : [...arr, d];
        CHAT_CACHE[`msgs_${cid}`] = next;
        try { localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(next)); } catch {}
        return next;
      });
      setTyping((t) => ({ ...t, [d.sender_id]: 0 }));
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth" }));
      if (d.sender_id !== me?.user_id) {
        markRead();
        playSound("message");
      }
    }
    if (e.type === "message:update" && d?.conversation_id === cid) {
      setMsgs((x) => {
        const arr = (Array.isArray(x) ? x : []).map((y) => (y.id === d.id ? d : y));
        CHAT_CACHE[`msgs_${cid}`] = arr;
        try { localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(arr)); } catch {}
        return arr;
      });
      if (d?.pinned !== undefined) loadConv();
    }
    if (e.type === "read" && d?.conversation_id === cid) setConv((c) => c && ({ ...c, reads: { ...(c.reads || {}), [d.user_id]: d.at } }));
    if (e.type === "typing" && d?.conversation_id === cid) setTyping((t) => ({ ...t, [d.user_id]: Date.now() }));
  }), [subscribe, cid, me?.user_id]); // eslint-disable-line

  useEffect(() => { const t = setInterval(() => setTyping((x) => ({ ...x })), 2000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!search) { setResults([]); return undefined; }
    const qLower = search.toLowerCase();
    // Instant client-side search first
    const localMatches = (Array.isArray(msgs) ? msgs : []).filter((m) => (m.text || "").toLowerCase().includes(qLower));
    setResults(localMatches);
    const t = setTimeout(() => api.get(`/conversations/${cid}/messages`, { params: { q: search } }).then((r) => setResults(Array.isArray(r.data) ? r.data : [])), 20);
    return () => clearTimeout(t);
  }, [search, cid]);

  const older = async () => {
    const h = scroller.current.scrollHeight;
    const { data } = await api.get(`/conversations/${cid}/messages`, { params: { before: msgs[0]?.created_at } });
    const arr = Array.isArray(data) ? data : [];
    setMore(arr.length >= 50);
    setMsgs((x) => [...arr, ...(Array.isArray(x) ? x : [])]);
    requestAnimationFrame(() => { scroller.current.scrollTop = scroller.current.scrollHeight - h; });
  };

  const activeConv = conv || getInitialConv(cid, me);
  const memList = Array.isArray(activeConv.member_ids) ? activeConv.member_ids : (Array.isArray(activeConv.members) ? activeConv.members : []);
  const otherMemberId = memList.find((x) => x && x !== me?.user_id) || me?.user_id;
  const isCircleAssistantConv = activeConv.type === "dm" && (otherMemberId === "user_circle_assistant" || activeConv.id?.startsWith("conv_circle_"));
  const other = activeConv.type === "dm" ? (
    isCircleAssistantConv ? {
      user_id: "user_circle_assistant",
      name: ws?.assistant_name || "Circle",
      job_title: "Asisten AI Workspace",
      avatar: ws?.assistant_avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364"
    } : (userMap?.[otherMemberId] || null)
  ) : null;


  const title = activeConv.type === "dm"
    ? (other?.name || (activeConv.name && activeConv.name !== "Direct Message" ? activeConv.name : "Pesan Langsung"))
    : (activeConv.name || "Grup Chat");
  const typers = Object.entries(typing).filter(([, t]) => Date.now() - t < 4000).map(([id]) => userMap[id]?.name?.split(" ")[0]).filter(Boolean);
  const readers = (ts) => Object.entries(activeConv.reads || {}).filter(([id, at]) => id !== me?.user_id && at >= ts).length;
  const safeMsgs = Array.isArray(msgs) ? msgs : [];
  const isMyMessage = (m) => Boolean(me?.user_id && (m.sender_id === me.user_id || m.user_id === me.user_id));
  const lastMine = [...safeMsgs].reverse().find((m) => isMyMessage(m))?.id;
  const openPanel = () => (window.innerWidth >= 1280 ? setPanel(!panel) : setMobilePanel(true));

  const handleSent = (m, replaceId) => {
    setMsgs((x) => {
      const arr = Array.isArray(x) ? x : [];
      let next;
      if (m === null && replaceId) {
        next = arr.filter((y) => y.id !== replaceId);
      } else if (replaceId) {
        const idx = arr.findIndex((y) => y.id === replaceId || y.id === m.id);
        next = idx !== -1 ? arr.map((y, i) => (i === idx ? m : y)) : [...arr, m];
      } else {
        next = arr.some((y) => y.id === m.id) ? arr : [...arr, m];
      }
      CHAT_CACHE[`msgs_${cid}`] = next;
      try { localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(next)); } catch {}
      return next;
    });
    if (m !== null) {
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  const askCircleQuick = async (promptText) => {
    if (!promptText || !cid) return;
    const tempId = `msg_opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg = {
      id: tempId,
      conversation_id: cid,
      sender_id: me?.user_id || "user_admin1",
      user_id: me?.user_id || "user_admin1",
      text: promptText,
      type: "text",
      attachments: [],
      created_at: new Date().toISOString(),
      _optimistic: true
    };
    playSound("message");
    handleSent(optimisticMsg);
    try {
      const { data } = await api.post(`/conversations/${cid}/messages`, { text: promptText });
      handleSent(data, tempId);
    } catch (e) {
      handleSent(null, tempId);
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="flex h-full max-h-full w-full max-w-full min-w-0 flex-1 overflow-hidden overscroll-none" data-testid="chat-view">
      <div className="flex h-full max-h-full w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex h-14 sm:h-16 shrink-0 items-center gap-1.5 sm:gap-2 border-b bg-surface px-1.5 sm:px-4 pt-safe select-none">
          <button onClick={() => navigate("/messages")} className="btn-ghost flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center lg:hidden" aria-label="Kembali" data-testid="chat-back-btn"><ArrowLeft size={20} /></button>
          <button onClick={openPanel} className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 text-left">
            {other ? <Avatar user={other} size={36} /> : <GroupIcon c={activeConv} size={36} />}
            <span className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-sm sm:text-base font-bold leading-snug py-0.5" data-testid="chat-title">{title}</span>
                {activeConv.is_verified && <ShieldCheck size={14} className="shrink-0 text-blue-500 fill-blue-500/10" />}
              </div>
              <span className="block truncate text-[11px] sm:text-xs text-sub leading-snug">{typers.length ? <span className="text-brand" data-testid="typing-indicator">{typers.join(", ")} sedang mengetik…</span> : other ? (online.has(other.user_id) ? "Online" : other.job_title) : `${(activeConv.member_ids || []).filter((id) => id !== "user_circle_assistant").length} anggota${activeConv.archived ? " · Diarsipkan" : ""}`}</span>
            </span>
          </button>
          {isCircleAssistantConv && (
            <button
              type="button"
              onClick={() => setFeatureHubOpen(true)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-2.5 sm:px-3 text-xs font-bold text-brand hover:bg-brand/15 transition-colors"
              data-testid="circle-hub-header-btn"
            >
              <Sparkles size={14} />
              <span className="hidden sm:inline">60+ Fitur AI</span>
              <span className="sm:hidden">Fitur AI</span>
            </button>
          )}
          <button onClick={() => setSearch(search === null ? "" : null)} className={`btn-ghost flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center ${search !== null ? "text-brand bg-brand/10" : "text-sub"}`} aria-label="Cari di obrolan" data-testid="chat-search-toggle"><Search size={18} /></button>
          <button onClick={openPanel} className="btn-ghost flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center text-sub" aria-label="Detail" data-testid="chat-details-toggle"><PanelRight size={18} /></button>
        </header>

        {search !== null && (
          <div className="shrink-0 border-b bg-surface p-2.5 sm:p-3">
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pesan di obrolan ini…" className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none" data-testid="chat-search-input" />
            {results.length > 0 && <div className="mt-2 max-h-48 overflow-y-auto">{results.map((m, i) => <div key={m.id || i} className="rounded-lg p-2 text-sm hover:bg-surface2"><b>{userMap[m.sender_id]?.name}</b> <span className="text-xs text-sub">{fmtDate(m.created_at, "d MMM HH:mm")}</span><p className="truncate">{m.text}</p></div>)}</div>}
          </div>
        )}
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2.5 py-3 sm:px-6 sm:py-4 scroll-thin" data-testid="message-list">
          {more && safeMsgs.length > 0 && <div className="text-center"><button onClick={older} className="rounded-full bg-surface2 px-3 py-1 text-xs font-semibold text-sub" data-testid="load-older-btn">Muat pesan sebelumnya</button></div>}
          {safeMsgs.map((m, i) => {
            const prev = safeMsgs[i - 1];
            const grouped = prev && prev.sender_id === m.sender_id && prev.type !== "call" && new Date(m.created_at) - new Date(prev.created_at) < 300000;
            const mine = isMyMessage(m);
            return <MessageItem key={m.id || i} m={m} mine={mine} grouped={grouped} conv={activeConv} onReply={setReply} onCreateTask={setTaskFrom} readBy={m.id === lastMine ? readers(m.created_at) : undefined} />;
          })}
          {!safeMsgs.length && (() => {
            const isDeptLocked = (activeConv.group_type === "department" || String(activeConv.id || "").startsWith("group_official_")) && activeConv.is_member === false;
            return (
              <div className="mx-auto max-w-md py-16 text-center">
                <p className="text-sm font-semibold text-ink">
                  {isDeptLocked
                    ? "Grup Divisi Khusus Undangan"
                    : activeConv.group_type === "private" && activeConv.is_member === false
                    ? "Grup Privat Terkunci"
                    : isCircleAssistantConv
                    ? "Halo! Saya Circle, Asisten Analitik Workspace Anda."
                    : `Mulai sapa ${title}.`}
                </p>
                {isDeptLocked ? (
                  <p className="mt-1.5 text-xs text-sub leading-relaxed">
                    {activeConv.has_invitation
                      ? `Anda memiliki undangan resmi untuk bergabung ke grup divisi ${activeConv.name}. Klik Terima Undangan di bawah untuk masuk.`
                      : `Hanya anggota divisi ${activeConv.name} atau rekan tim yang menerima undangan resmi yang dapat mengakses obrolan di sini.`}
                  </p>
                ) : activeConv.group_type === "private" && activeConv.is_member === false ? (
                  <p className="mt-1.5 text-xs text-sub leading-relaxed">
                    {t("groups_private_lock_desc", "Grup ini bersifat privat. Anda memerlukan persetujuan dari Pembuat atau Co-Admin Grup untuk melihat dan mengirim pesan di sini.")}
                  </p>
                ) : isCircleAssistantConv && (
                  <p className="mt-1.5 text-xs text-sub leading-relaxed">
                    Tanyakan apa saja soal data live workspace: jumlah karyawan, load tim, tugas telat per divisi, proyek, feed Beranda, polling, atau ketik <code className="rounded bg-surface2 px-1 py-0.5">/task judul</code>.
                  </p>
                )}
              </div>
            );
          })()}
          <div ref={bottom} />
        </div>
        {isCircleAssistantConv && activeConv.is_member !== false && (
          <div className="border-t bg-surface/80 px-2.5 py-1.5 sm:px-4 sm:py-2" data-testid="circle-quick-prompts">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setFeatureHubOpen(true)}
                className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-xl bg-brand px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:opacity-90 transition-opacity"
                data-testid="circle-quick-hub-btn"
              >
                <Sparkles size={12} /> Semua 60+ Fitur
              </button>
              {CIRCLE_QUICK_PROMPTS.map((q) => (
                <button
                  key={q.prompt}
                  type="button"
                  onClick={() => askCircleQuick(q.prompt)}
                  className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-surface2/70 px-2.5 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeConv.is_member === false ? (
          <div className="border-t bg-surface p-4 text-center">
            {activeConv.has_invitation ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={declineInvite} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-5 text-sm font-semibold text-rose-600 hover:bg-rose-100 cursor-pointer" data-testid="decline-group-invite-btn">
                  <X size={15} /> Tolak Undangan
                </button>
                <button type="button" onClick={acceptInvite} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 px-6 text-sm font-bold text-white shadow-xs cursor-pointer" data-testid="accept-group-invite-btn">
                  <Check size={15} /> Terima Undangan
                </button>
              </div>
            ) : (activeConv.group_type === "department" || String(activeConv.id || "").startsWith("group_official_")) ? (
              <span className="inline-flex h-11 items-center gap-2 rounded-full border bg-surface2 px-6 text-sm font-semibold text-sub" data-testid="invite-only-group-footer">
                <Lock size={15} /> Khusus Anggota & Undangan
              </span>
            ) : activeConv.has_pending_request ? (
              <button type="button" disabled className="inline-flex h-11 items-center rounded-full border bg-surface2 px-6 text-sm font-semibold text-sub opacity-85 cursor-not-allowed" data-testid="pending-group-join-btn">
                Menunggu Persetujuan Pembuat / Admin Grup…
              </button>
            ) : (
              <button onClick={join} className="btn-accent h-11 px-6 font-semibold" data-testid="join-group-btn">
                {activeConv.group_type === "private" ? `Minta Izin Gabung ke ${activeConv.name}` : `Gabung ke ${activeConv.name}`}
              </button>
            )}
          </div>
        ) : <Composer conv={activeConv} reply={reply} onCancelReply={() => setReply(null)} onPoll={() => setPoll(true)} onSent={handleSent} isCircleConv={isCircleAssistantConv} onOpenFeatureHub={() => setFeatureHubOpen(true)} />}
      </div>
      {panel && <aside className="hidden w-[320px] shrink-0 border-l bg-surface xl:block"><Panel conv={activeConv} reload={() => { loadConv(); onChange(); }} onClose={() => setPanel(false)} /></aside>}
      <Sheet open={mobilePanel} onOpenChange={setMobilePanel}><SheetContent className="w-full bg-surface p-0 sm:max-w-sm"><SheetHeader className="sr-only"><SheetTitle>Detail</SheetTitle></SheetHeader><Panel conv={activeConv} reload={() => { loadConv(); onChange(); }} onClose={() => setMobilePanel(false)} /></SheetContent></Sheet>
      <CreatePollDialog open={poll} onOpenChange={setPoll} conversationId={cid} onCreated={handleSent} />
      <TaskCreate open={!!taskFrom} onOpenChange={(v) => !v && setTaskFrom(null)} preset={taskFrom ? { title: (taskFrom.text || "Tugas dari pesan").slice(0, 120), description: `<p>${(taskFrom.text || "").replace(/</g, "&lt;")}</p><p><i>Dari obrolan: ${title}</i></p>`, conversation_id: cid, message_id: taskFrom.id } : null} onCreated={(t) => { setTaskFrom(null); api.post(`/tasks/${t.id}/share`, { conversation_id: cid }).catch(() => {}); loadConv(); }} />
      <CircleFeatureHub
        open={featureHubOpen}
        onOpenChange={setFeatureHubOpen}
        onRunCommand={(cmd) => {
          setFeatureHubOpen(false);
          askCircleQuick(cmd);
        }}
        onFillTemplate={(tpl) => {
          setFeatureHubOpen(false);
          window.dispatchEvent(new CustomEvent("circle:composer-prefill", { detail: { conversationId: cid, text: tpl } }));
        }}
      />
    </div>
  );
}
