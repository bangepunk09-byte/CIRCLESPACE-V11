import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api, errMsg, fileUrl, uploadFile } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar } from "../../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function MemberPicker({ open, onOpenChange, exclude = [], onPick, title = "Tambah Anggota", submitLabel = "Tambah" }) {
  const { users } = useApp();
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari rekan kerja…" className="h-10 rounded-xl border bg-surface2 px-3 text-sm outline-none" />
        <div className="max-h-72 overflow-y-auto">
          {users.filter((u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant" && !exclude.includes(u.user_id) && u.name.toLowerCase().includes(q.toLowerCase())).map((u) => (
            <label key={u.user_id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface2"><input type="checkbox" checked={sel.includes(u.user_id)} onChange={() => setSel(sel.includes(u.user_id) ? sel.filter((x) => x !== u.user_id) : [...sel, u.user_id])} className="h-4 w-4 accent-[var(--c-accent)]" data-testid={`pick-member-${u.user_id}`} /><Avatar user={u} size={28} showStatus={false} /><span className="text-sm">{u.name}</span></label>
          ))}
        </div>
        <button onClick={() => { onPick(sel); setSel([]); onOpenChange(false); }} disabled={!sel.length} className="btn-accent h-11 font-semibold disabled:opacity-50" data-testid="confirm-members-btn">{submitLabel} {sel.length || ""}</button>
      </DialogContent>
    </Dialog>
  );
}

const GROUP_TYPE_LABELS = { public: "Publik", private: "Privat", department: "Divisi", project: "Proyek" };
const GROUP_TYPE_HINTS = {
  public: "Publik: Semua anggota workspace bisa melihat dan langsung bergabung ke grup tanpa perlu izin.",
  private: "Privat: Anggota lain wajib meminta izin dan disetujui Pembuat / Co-Admin Grup sebelum masuk.",
  department: "Divisi: Khusus anggota divisi terkait. Rekan tim dari divisi lain hanya bisa masuk melalui undangan resmi.",
  project: "Proyek: Ruang kolaborasi khusus untuk tim yang menangani proyek tertentu."
};

export function GroupDialog({ open, onOpenChange, group, onSaved }) {
  const { users, me, isAdmin, t } = useApp();
  const [f, setF] = useState({ name: "", description: "", group_type: "public", location: "", image: "", member_ids: [], admin_ids: [] });
  useEffect(() => {
    if (open) {
      if (group) {
        setF({
          ...group,
          member_ids: Array.isArray(group.member_ids) ? group.member_ids : [],
          admin_ids: Array.isArray(group.admin_ids) ? group.admin_ids : (group.created_by ? [group.created_by] : []),
        });
      } else {
        setF({
          name: "",
          description: "",
          group_type: "public",
          location: "",
          image: "",
          member_ids: [],
          admin_ids: me?.user_id ? [me.user_id] : [],
        });
      }
    }
  }, [open, group, me?.user_id]);

  const creatorId = group?.created_by || me?.user_id;
  const canManageAdmins = !group || isAdmin || creatorId === me?.user_id || (Array.isArray(group?.admin_ids) && group.admin_ids.includes(me?.user_id));

  const toggleMember = (uid) => {
    const exists = f.member_ids.includes(uid);
    if (exists) {
      setF((prev) => ({
        ...prev,
        member_ids: prev.member_ids.filter((x) => x !== uid),
        admin_ids: prev.admin_ids.filter((x) => x !== uid || x === creatorId),
      }));
    } else {
      setF((prev) => ({ ...prev, member_ids: [...prev.member_ids, uid] }));
    }
  };

  const toggleDeputyAdmin = (uid) => {
    if (!uid || uid === creatorId) return;
    const isDeputy = (f.admin_ids || []).includes(uid);
    if (isDeputy) {
      setF((prev) => ({ ...prev, admin_ids: (prev.admin_ids || []).filter((x) => x !== uid) }));
    } else {
      setF((prev) => ({
        ...prev,
        admin_ids: Array.from(new Set([...(prev.admin_ids || []), creatorId, uid].filter(Boolean))),
        member_ids: Array.from(new Set([...(prev.member_ids || []), creatorId, uid].filter(Boolean))),
      }));
    }
  };

  const save = async () => {
    if (!f.name?.trim()) {
      toast.error("Nama grup wajib diisi");
      return;
    }
    const deputyAdminIds = (f.admin_ids || []).filter((id) => id && id !== creatorId);
    const mergedAdmins = Array.from(new Set([creatorId, ...deputyAdminIds].filter(Boolean)));
    try {
      const body = {
        name: f.name.trim(),
        description: f.description,
        group_type: f.group_type,
        location: f.location,
        image: f.image,
        ...(canManageAdmins ? { admin_ids: mergedAdmins, deputy_admin_ids: deputyAdminIds } : {}),
      };
      if (group) {
        onOpenChange(false);
        onSaved?.({ ...group, ...body });
        const { data } = await api.patch(`/groups/${group.id}`, body);
        toast.success("Grup berhasil diperbarui");
        if (data) onSaved?.(data);
      } else {
        const mergedMembers = Array.from(new Set([...(f.member_ids || []), ...mergedAdmins].filter(Boolean)));
        const { data } = await api.post("/groups", { ...body, member_ids: mergedMembers });
        toast.success("Grup berhasil dibuat");
        onOpenChange(false);
        onSaved?.(data);
      }
    } catch (e) { toast.error(errMsg(e)); }
  };
  const img = async (e) => { try { const up = await uploadFile(e.target.files[0]); setF({ ...f, image: up.id }); } catch (er) { toast.error(errMsg(er)); } };
  const humanUsers = users.filter((u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant");
  const eligibleDeputies = group
    ? humanUsers.filter((u) => u.user_id !== creatorId && (f.member_ids.includes(u.user_id) || (f.admin_ids || []).includes(u.user_id)))
    : humanUsers.filter((u) => u.user_id !== creatorId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{group ? "Ubah Grup" : "Buat Grup Baru"}</DialogTitle>
            {me.role === "super_admin" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                <ShieldCheck size={10} strokeWidth={3} />
                RESMI
              </span>
            )}
          </div>
        </DialogHeader>
        {me.role === "super_admin" ? <div className="flex items-center gap-3">
          {f.image ? <img src={fileUrl(f.image)} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : <span className="h-14 w-14 rounded-2xl bg-soft-purple" />}
          <label className="cursor-pointer text-sm font-semibold text-brand">Unggah foto grup<input type="file" accept="image/*" hidden onChange={img} data-testid="group-image-input" /></label>
          {f.image && <button type="button" onClick={() => setF({ ...f, image: "" })} className="text-xs text-sub" data-testid="group-image-remove">Hapus</button>}
        </div> : f.image ? <img src={fileUrl(f.image)} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : null}
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nama grup" className="h-11 rounded-xl border bg-surface2 px-3 text-sm outline-none" data-testid="group-name-input" />
        <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Deskripsi grup" className="min-h-[72px] rounded-xl border bg-surface2 p-3 text-sm outline-none" data-testid="group-description-input" />
        <div className="grid grid-cols-2 gap-2">
          {["public", "private", "department", "project"].map((t) => <button type="button" key={t} onClick={() => setF({ ...f, group_type: t })} className={`h-10 rounded-xl border text-sm font-medium ${f.group_type === t ? "border-[var(--c-accent)] bg-soft-red text-ink font-semibold" : "text-sub"}`} data-testid={`group-type-${t}`}>{GROUP_TYPE_LABELS[t]}</button>)}
        </div>
        <p className="rounded-xl bg-surface2/80 px-3 py-2 text-[11px] leading-relaxed text-sub" data-testid="group-privacy-hint">
          {GROUP_TYPE_HINTS[f.group_type] || GROUP_TYPE_HINTS.public}
        </p>
        <input value={f.location || ""} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Lokasi / divisi" className="h-10 rounded-xl border bg-surface2 px-3 text-sm outline-none" data-testid="group-location-input" />
        {!group && (
          <div className="space-y-1">
            <span className="block text-xs font-bold text-sub">Anggota Awal:</span>
            <div className="max-h-36 overflow-y-auto rounded-xl border p-1">
              {humanUsers.filter((u) => u.user_id !== me?.user_id).map((u) => (
                <label key={u.user_id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-surface2 cursor-pointer">
                  <input type="checkbox" checked={f.member_ids.includes(u.user_id)} onChange={() => toggleMember(u.user_id)} className="accent-[var(--c-accent)]" data-testid={`group-member-${u.user_id}`} />
                  <span>{u.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {canManageAdmins && (
          <div className="space-y-1.5" data-testid="group-deputy-admins-section">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sub">{t("groups_manage_admins_title", "Admin Utama & Co-Admin Grup")}</span>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">Pembuat = Admin Otomatis</span>
            </div>
            <div className="max-h-32 overflow-y-auto rounded-xl border p-1.5 space-y-1">
              {eligibleDeputies.length > 0 ? eligibleDeputies.map((u) => (
                <label key={u.user_id} className="flex items-center justify-between gap-2 rounded-lg p-1.5 text-sm hover:bg-surface2 cursor-pointer">
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={(f.admin_ids || []).includes(u.user_id)}
                      onChange={() => toggleDeputyAdmin(u.user_id)}
                      className="accent-[var(--c-accent)]"
                      data-testid={`group-deputy-${u.user_id}`}
                    />
                    <span className="truncate">{u.name}</span>
                  </span>
                  {(f.admin_ids || []).includes(u.user_id) && (
                    <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      {t("groups_co_admin_badge", "Co-Admin")}
                    </span>
                  )}
                </label>
              )) : (
                <p className="p-2 text-xs text-sub">{t("groups_co_admin_empty_hint", "Tambahkan anggota untuk menunjuk Co-Admin Grup.")}</p>
              )}
            </div>
          </div>
        )}
        <button onClick={save} className="btn-accent h-11 font-semibold" data-testid="group-save-btn">{group ? "Simpan Perubahan" : "Buat Grup"}</button>
      </DialogContent>
    </Dialog>
  );
}
