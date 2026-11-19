import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hash, Lock, Plus, Users, Building2, FolderKanban, MapPin, ShieldCheck, MailPlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl } from "../lib/api";
import { useApp } from "../context/AppContext";
import { PageHeader, AccentButton, Empty } from "../components/common";
import { GroupDialog, MemberPicker } from "./chat/GroupDialog";
import {
  upsertConversationInCache,
  getGroupsCache,
  setGroupsCache,
  readGroupsCacheForUser,
  hydrateGroupsCache,
  upsertGroupInCache,
} from "../lib/workspaceCaches";

export { hydrateGroupsCache, upsertGroupInCache };

const ICON = { public: Hash, private: Lock, department: Building2, project: FolderKanban };
const TINT = { public: "bg-soft-blue", private: "bg-soft-purple", department: "bg-soft-green", project: "bg-soft-yellow" };

function getCacheKey(userId) {
  return userId ? `circle_groups_cache_${userId}` : "circle_groups_cache";
}

export default function Groups() {
  const { me, subscribe, t } = useApp();
  const [groups, setGroups] = useState(() => readGroupsCacheForUser(me?.user_id));
  const [open, setOpen] = useState(false);
  const [inviteGroup, setInviteGroup] = useState(null);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  const load = useCallback(() => {
    if (!me?.user_id) return;
    api.get("/groups/browse").then((r) => {
      if (Array.isArray(r.data)) {
        const clean = r.data.filter((g) => g && g.id && (g.is_member || g.has_invitation));
        setGroupsCache(clean);
        setGroups(clean);
        try { localStorage.setItem(getCacheKey(me.user_id), JSON.stringify(clean)); } catch {}
      }
    }).catch(() => {});
  }, [me?.user_id]);

  useEffect(() => {
    const cached = readGroupsCacheForUser(me?.user_id);
    setGroupsCache(cached);
    setGroups(cached);
    load();
  }, [load, me?.user_id]);

  useEffect(() => subscribe((e) => {
    if ((e.type === "groups:changed" || e.type === "group:updated") && e.data) {
      const d = e.data;
      const mems = Array.isArray(d.member_ids) ? d.member_ids : null;
      const hydrated = {
        ...d,
        ...(mems ? { is_member: Boolean(me?.user_id && mems.includes(me.user_id)), member_count: mems.length } : {}),
        ...(Array.isArray(d.invitations) ? {
          has_invitation: Boolean(me?.user_id && d.invitations.some((inv) => inv?.user_id === me.user_id && inv?.status === "pending")),
        } : {}),
      };
      const next = upsertGroupInCache(hydrated, me?.user_id);
      setGroups(next);
    } else if (e.type === "group:deleted" && e.id) {
      const next = getGroupsCache().filter((g) => g.id !== e.id);
      setGroupsCache(next);
      setGroups(next);
      try { localStorage.setItem(getCacheKey(me?.user_id), JSON.stringify(next)); } catch {}
    } else if (e.type === "groups:changed" || e.type === "workspace:changed" || e.type === "org:changed") {
      load();
    }
  }), [subscribe, load, me?.user_id]);

  const openGroup = (g) => {
    upsertConversationInCache({
      ...g,
      type: "group",
      is_member: true,
      member_ids: Array.from(new Set([...(g.member_ids || []), me?.user_id].filter(Boolean)))
    }, me?.user_id);
    navigate(`/messages/${g.id}`);
  };

  const acceptInvite = async (g) => {
    try {
      const { data } = await api.post(`/groups/${g.id}/accept-invite`);
      const synced = upsertGroupInCache({ ...g, ...(data || {}), is_member: true, has_invitation: false }, me?.user_id);
      setGroups(synced);
      upsertConversationInCache({ ...g, ...(data || {}), type: "group", is_member: true, has_invitation: false }, me?.user_id);
      toast.success(`Undangan diterima! Anda sekarang bergabung ke "${g.name}".`);
      navigate(`/messages/${g.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const declineInvite = async (g) => {
    try {
      await api.post(`/groups/${g.id}/decline-invite`);
      const nextList = upsertGroupInCache({
        ...g,
        is_member: false,
        has_invitation: false,
        invitations: (g.invitations || []).filter((inv) => inv?.user_id !== me?.user_id),
      }, me?.user_id);
      setGroups(nextList);
      toast.info(`Undangan ke grup "${g.name}" ditolak.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sendGroupInvite = async (groupId, userIds) => {
    try {
      const { data } = await api.post(`/groups/${groupId}/invite`, { user_ids: userIds });
      if (data?.group) {
        const nextList = upsertGroupInCache(data.group, me?.user_id);
        setGroups(nextList);
      } else {
        load();
      }
      toast.success(`Undangan dikirim ke ${userIds.length} rekan tim.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const normalized = (groups || []).map((g) => {
    const mems = Array.isArray(g.member_ids) ? g.member_ids : null;
    const isDeptGroup = g.group_type === "department" || String(g.id || "").startsWith("group_official_");
    const isMyDept = Boolean(me?.department && String(g.name || "").trim().toLowerCase() === String(me.department).trim().toLowerCase());
    const computedMember = mems ? mems.includes(me?.user_id) : Boolean(g.is_member);
    const isDeptManager = isDeptGroup && ["manager", "department_manager", "project_manager"].includes(me?.role) && isMyDept;
    const canManage = Boolean(
      g.can_manage ||
      me?.role === "super_admin" ||
      (g.created_by && me?.user_id === g.created_by) ||
      (Array.isArray(g.admin_ids) && g.admin_ids.includes(me?.user_id)) ||
      isDeptManager
    );
    return { ...g, is_member: computedMember, can_manage: canManage, is_dept_group: isDeptGroup };
  });

  // Only show groups the user has actually joined in the main list
  const myGroups = normalized
    .filter((g) => g.is_member)
    .filter((g) => filter === "all" || g.group_type === filter);

  // Any pending group invitations waiting for user confirmation
  const invitedGroups = normalized.filter((g) => !g.is_member && g.has_invitation);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-10 animate-crossfade" data-testid="groups-page">
      <PageHeader
        icon={Hash}
        title={t("groups_title", "Grup & Channel")}
        subtitle={t("groups_subtitle", "Daftar grup dan channel yang Anda ikuti di workspace.")}
        actions={<AccentButton onClick={() => setOpen(true)} data-testid="create-group-btn"><Plus size={16} />{t("groups_new_btn", "Grup Baru")}</AccentButton>}
      />

      {invitedGroups.length > 0 && (
        <div className="mb-6 rounded-3xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/25 p-4 sm:p-5" data-testid="group-invitations-section">
          <div className="mb-3 flex items-center gap-2">
            <MailPlus size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-ink">Undangan Grup Masuk ({invitedGroups.length})</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {invitedGroups.map((g) => {
              const I = ICON[g.group_type] || Hash;
              return (
                <div key={g.id} className="card flex flex-col justify-between p-4 bg-surface" data-testid={`invited-group-card-${g.id}`}>
                  <div className="flex items-start gap-3">
                    {g.image ? <img src={fileUrl(g.image)} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${TINT[g.group_type]}`}><I size={18} /></span>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-bold text-sm">{g.name}</p>
                        {g.is_verified && <ShieldCheck size={14} className="shrink-0 text-blue-500" />}
                      </div>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">Anda diundang bergabung</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => declineInvite(g)}
                      className="inline-flex h-9 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-100 cursor-pointer"
                      data-testid={`decline-invite-group-${g.id}`}
                    >
                      <X size={13} /> Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => acceptInvite(g)}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-emerald-600 hover:bg-emerald-700 px-3.5 text-xs font-bold text-white shadow-xs cursor-pointer"
                      data-testid={`accept-invite-group-${g.id}`}
                    >
                      <Check size={13} /> Terima Undangan
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-5 flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
        {[["all", "Semua"], ["public", "Publik"], ["private", "Privat"], ["department", "Divisi"], ["project", "Proyek"]].map(([f, lbl]) => <button key={f} onClick={() => setFilter(f)} className={`inline-flex h-9 sm:h-10 items-center whitespace-nowrap rounded-full px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${filter === f ? "bg-brand text-white shadow-xs" : "border bg-surface text-sub hover:bg-surface2"}`} data-testid={`group-filter-${f}`}>{lbl}</button>)}
      </div>
      {!myGroups.length ? (
        <Empty
          icon={Hash}
          title={t("groups_empty", "Belum ada grup yang diikuti")}
          subtitle={t("groups_empty_subtitle", "Anda hanya melihat grup dan channel yang Anda masuki. Buat grup baru atau terima undangan dari admin.")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {myGroups.map((g) => {
            const I = ICON[g.group_type] || Hash;
            const typeLabel = { public: "Publik", private: "Privat", department: "Divisi", project: "Proyek" }[g.group_type] || g.group_type;
            const isCreator = g.created_by && me?.user_id === g.created_by;
            const isGroupAdmin = !isCreator && Array.isArray(g.admin_ids) && g.admin_ids.includes(me?.user_id);
            const pendingCount = Array.isArray(g.join_requests) ? g.join_requests.length : (g.pending_requests_count || 0);
            const pendingInviteCount = Array.isArray(g.invitations) ? g.invitations.length : 0;
            return (
            <div key={g.id} className="card flex min-w-0 w-full flex-col overflow-hidden p-4 sm:p-5" data-testid={`group-card-${g.id}`}>
              <div className="flex items-start gap-3">
                {g.image ? <img src={fileUrl(g.image)} alt="" className="h-12 w-12 rounded-2xl object-cover" /> : <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${TINT[g.group_type]}`}><I size={20} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="truncate font-bold leading-snug py-0.5">{g.name}</p>
                    {g.is_verified && <ShieldCheck size={14} className="shrink-0 text-blue-500" fill="currentColor" fillOpacity={0.1} title="Grup Resmi" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-sub leading-snug">
                    <span>{typeLabel}{g.archived ? " · diarsipkan" : ""}</span>
                    {isCreator && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">{t("groups_creator_badge", "Pembuat")}</span>}
                    {isGroupAdmin && <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">{t("groups_co_admin_badge", "Co-Admin")}</span>}
                    {g.can_manage && pendingCount > 0 && (
                      <span className="rounded-full bg-rose-100 dark:bg-rose-900/40 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                        {pendingCount} Izin Masuk
                      </span>
                    )}
                    {g.can_manage && pendingInviteCount > 0 && (
                      <span className="rounded-full bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                        {pendingInviteCount} Diundang
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-sm text-sub leading-normal">{g.description || "Belum ada deskripsi"}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-sub">
                <span className="flex items-center gap-3"><span className="flex items-center gap-1"><Users size={13} />{g.member_count}</span>{g.location && <span className="flex items-center gap-1"><MapPin size={12} />{g.location}</span>}</span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {g.can_manage && (
                    <button
                      type="button"
                      onClick={() => setInviteGroup(g)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface2 cursor-pointer"
                      title="Undang rekan tim ke grup ini"
                      data-testid={`invite-group-${g.id}`}
                    >
                      <MailPlus size={14} />
                      <span>Undang</span>
                    </button>
                  )}
                  <button onClick={() => openGroup(g)} className="inline-flex h-10 items-center justify-center rounded-full bg-surface2 px-4 text-sm font-semibold text-ink hover:bg-border/60 cursor-pointer" data-testid={`open-group-${g.id}`}>Buka</button>
                </div>
              </div>
            </div>); })}
        </div>
      )}
      <GroupDialog
        open={open}
        onOpenChange={setOpen}
        onSaved={(g) => {
          const next = upsertGroupInCache({ ...g, is_member: true }, me?.user_id);
          setGroups(next);
          upsertConversationInCache({ ...g, type: "group", is_member: true }, me?.user_id);
          navigate(`/messages/${g.id}`);
        }}
      />
      <MemberPicker
        open={!!inviteGroup}
        onOpenChange={(v) => !v && setInviteGroup(null)}
        exclude={Array.from(new Set([
          ...(inviteGroup?.member_ids || []),
          ...((inviteGroup?.invitations || []).map((inv) => inv.user_id).filter(Boolean)),
        ]))}
        title={`Undang ke ${inviteGroup?.name || "Grup"}`}
        submitLabel="Kirim Undangan"
        onPick={(ids) => inviteGroup && sendGroupInvite(inviteGroup.id, ids)}
      />
    </div>
  );
}
