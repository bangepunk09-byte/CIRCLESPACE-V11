import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessageCircle, Mail, MapPin, Briefcase, Users2, Pencil, Calendar, Clock, IdCard, Link2, Phone } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, uploadFile } from "../lib/api";
import { Avatar, Spinner, StatusBadge, PriorityBadge, Labels, dueInfo, AccentButton, GhostButton } from "../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";
import { Switch } from "../components/ui/switch";

const MODES = ["Office", "Remote", "Hybrid", "On-site", "Kustom"];

function Field({ label, children }) {
  return <div className="block text-xs font-semibold text-sub">{label}<div className="mt-1 text-sm font-normal text-ink">{children}</div></div>;
}
const inp = "h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none";

function CustomInput({ f, value, onChange }) {
  if (f.type === "long_text") return <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${inp} h-20 py-2`} />;
  if (f.type === "boolean") return <Switch checked={!!value} onCheckedChange={onChange} />;
  if (f.type === "dropdown") return <AppSelect value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Pilih opsi" className={inp}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</AppSelect>;
  if (f.type === "multi_select") return <div className="flex flex-wrap gap-1">{f.options.map((o) => { const on = (value || []).includes(o); return <button type="button" key={o} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...(value || []), o])} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "bg-soft-red border-[var(--c-accent)]" : ""}`}>{o}</button>; })}</div>;
  if (f.type === "date") return <DatePicker showQuickPresets={false} value={value || ""} onChange={onChange} className={inp} />;
  const type = { email: "email", phone: "tel", url: "url" }[f.type] || "text";
  return <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inp} />;
}

function EditProfile({ open, onOpenChange, p, onSaved }) {
  const { ws, isAdmin, users } = useApp();
  const [f, setF] = useState(p);
  useEffect(() => { if (open) setF({ ...p, skillsText: (p.skills || []).join(", ") }); }, [open, p]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    const keys = ["name", "picture", "phone", "bio", "work_mode", "city", "office", "custom_location", "location_status", "share_location", "timezone", "custom", ...(isAdmin ? ["employee_id", "job_title", "department", "division", "team", "employment_status", "join_date", "manager_id"] : [])];
    const body = Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
    body.skills = f.skillsText.split(",").map((s) => s.trim()).filter(Boolean);
    try { const { data } = await api.patch(`/users/${p.user_id}`, body); toast.success("Profil berhasil disimpan"); onSaved(data); onOpenChange(false); } catch (e) { toast.error(errMsg(e)); }
  };
  const photo = async (e) => { try { const up = await uploadFile(e.target.files[0]); setF({ ...f, picture: fileUrl(up.id) }); } catch (er) { toast.error(errMsg(er)); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Ubah Profil</DialogTitle></DialogHeader>
        <div className="flex items-center gap-3"><Avatar user={f} size={56} showStatus={false} /><label className="cursor-pointer text-sm font-semibold text-brand">Ganti Foto<input type="file" accept="image/*" hidden onChange={photo} data-testid="profile-photo-input" /></label></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama Lengkap"><input value={f.name || ""} onChange={set("name")} className={inp} data-testid="profile-name-input" /></Field>
          <Field label="No. Telepon"><input value={f.phone || ""} onChange={set("phone")} className={inp} data-testid="profile-phone-input" /></Field>
          {isAdmin && <>
            <Field label="Jabatan"><input value={f.job_title || ""} onChange={set("job_title")} className={inp} data-testid="profile-title-input" /></Field>
            <Field label="ID Karyawan"><input value={f.employee_id || ""} onChange={set("employee_id")} className={inp} /></Field>
            <Field label="Divisi"><input value={f.department || ""} onChange={set("department")} className={inp} /></Field>
            <Field label="Tim"><input value={f.team || ""} onChange={set("team")} className={inp} /></Field>
            <Field label="Status Kepegawaian"><AppSelect value={f.employment_status || ""} onChange={set("employment_status")} placeholder="Pilih status" className={inp}>{[["Full-time", "Penuh Waktu"], ["Part-time", "Paruh Waktu"], ["Contract", "Kontrak"], ["Intern", "Magang"], ["On leave", "Sedang Cuti"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AppSelect></Field>
            <Field label="Tanggal Bergabung"><DatePicker showQuickPresets={false} value={f.join_date || ""} onChange={(val) => setF({ ...f, join_date: val })} placeholder="Pilih tanggal bergabung" className={inp} /></Field>
            <Field label="Atasan Langsung"><AppSelect value={f.manager_id || ""} onChange={set("manager_id")} placeholder="Tidak ada" className={inp}><option value="">Tidak ada</option>{users.filter((u) => u.user_id !== p.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</AppSelect></Field>
          </>}
          <Field label="Mode Kerja"><AppSelect value={f.work_mode || ""} onChange={set("work_mode")} placeholder="Pilih mode kerja" className={inp} data-testid="profile-workmode-select">{MODES.map((m) => <option key={m}>{m}</option>)}</AppSelect></Field>
          <Field label="Kota"><input value={f.city || ""} onChange={set("city")} className={inp} data-testid="profile-city-input" /></Field>
          <Field label="Kantor"><input value={f.office || ""} onChange={set("office")} className={inp} /></Field>
          {(f.work_mode === "Custom" || f.work_mode === "Kustom") && <Field label="Lokasi Kustom"><input value={f.custom_location || ""} onChange={set("custom_location")} className={inp} /></Field>}
          <Field label="Status Lokasi"><input value={f.location_status || ""} onChange={set("location_status")} placeholder="mis. Di lokasi klien hari ini" className={inp} /></Field>
          <Field label="Zona Waktu"><input value={f.timezone || ""} onChange={set("timezone")} className={inp} /></Field>
        </div>
        <label className="flex items-center justify-between rounded-xl bg-surface2 p-3 text-sm">Bagikan lokasi kerja saya dengan rekan tim<Switch checked={f.share_location !== false} onCheckedChange={set("share_location")} data-testid="profile-share-location" /></label>
        <Field label="Keahlian (pisahkan dengan koma)"><input value={f.skillsText || ""} onChange={set("skillsText")} className={inp} data-testid="profile-skills-input" /></Field>
        <Field label="Biodata"><textarea value={f.bio || ""} onChange={set("bio")} className={`${inp} h-20 py-2`} data-testid="profile-bio-input" /></Field>
        {(ws.profile_fields || []).length > 0 && <div className="grid gap-3 sm:grid-cols-2">{ws.profile_fields.map((cf) => <Field key={cf.key} label={`${cf.name}${cf.visibility !== "everyone" ? ` (khusus ${cf.visibility})` : ""}`}><CustomInput f={cf} value={f.custom?.[cf.key]} onChange={(v) => setF({ ...f, custom: { ...(f.custom || {}), [cf.key]: v } })} /></Field>)}</div>}
        <AccentButton onClick={save} data-testid="profile-save-btn">Simpan Profil</AccentButton>
      </DialogContent>
    </Dialog>
  );
}

export default function Profile() {
  const { uid } = useParams();
  const { me, userMap, ws, statuses, online, reloadUsers, hasDeadlineToday } = useApp();
  const [rawP, setP] = useState(() => userMap?.[uid] || (uid === me?.user_id ? me : null));
  const [edit, setEdit] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const cachedUser = userMap?.[uid] || (uid === me?.user_id ? me : null);
    if (cachedUser) setP((prev) => (prev?.user_id === uid ? prev : cachedUser));
    api.get(`/users/${uid}`).then((r) => setP(r.data)).catch(() => {
      if (!cachedUser) navigate("/people");
    });
  }, [uid]); // eslint-disable-line
  const p = rawP || userMap?.[uid] || me || { user_id: uid, name: "Karyawan", job_title: "Anggota Tim", tasks: [] };
  const dmId = async () => (await api.post("/conversations/dm", { user_id: uid })).data.id;
  const done = statuses.filter((s) => s.is_done).map((s) => s.key);
  const mgr = userMap[p.manager_id];
  const isDeadlineToday = Boolean(hasDeadlineToday?.(p.user_id));
  const info = [[Mail, "Email", p.email], [Phone, "Telepon", p.phone], [IdCard, "ID Karyawan", p.employee_id], [Briefcase, "Kepegawaian", p.employment_status], [Calendar, "Bergabung", p.join_date], [Clock, "Zona Waktu", p.timezone],
    [MapPin, "Lokasi", [p.office, p.city, (p.work_mode === "Custom" || p.work_mode === "Kustom") ? p.custom_location : p.work_mode].filter(Boolean).join(" · ")], [Users2, "Divisi / Tim", [p.division, p.team].filter(Boolean).join(" / ")]].filter((x) => x[2]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10 animate-subpage-enter" data-testid="profile-page">
      <div className="card overflow-hidden">
        <div className="h-28 bg-[linear-gradient(120deg,var(--s-red),var(--s-purple),var(--s-blue))] sm:h-36" />
        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="rounded-full border-4 border-[var(--c-surface)] w-fit"><Avatar user={p} size={96} /></div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="profile-name">{p.name}</h1>
              <p className="text-sub" data-testid="profile-job-title">{p.job_title || "Belum ada jabatan"}{p.department && ` · ${p.department}`}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={online.has(p.user_id) ? "text-emerald-600 font-semibold" : "text-sub"}>{online.has(p.user_id) ? "● Online" : "○ Offline"}</span>
                {p.location_status && <span className="text-sub"> · {p.location_status}</span>}
                {isDeadlineToday ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2.5 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]" /> Ada Deadline Hari Ini
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" /> Bebas Deadline (Aman)
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {uid !== me.user_id && <>
                <AccentButton onClick={async () => navigate(`/messages/${await dmId()}`)} data-testid="profile-message-btn"><MessageCircle size={16} />Pesan</AccentButton>
              </>}
              {p.can_edit && <GhostButton onClick={() => setEdit(true)} data-testid="profile-edit-btn"><Pencil size={15} />Ubah</GhostButton>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <section className="card p-5"><h3 className="mb-3 text-sm font-bold">Tentang</h3><p className="text-sm text-sub">{p.bio || "Belum ada biodata."}</p>
            {p.skills?.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-soft-purple px-2.5 py-1 text-xs font-medium">{s}</span>)}</div>}</section>
          <section className="card space-y-3 p-5" data-testid="profile-contact-info">
            {info.map(([I, l, v]) => <div key={l} className="flex items-center gap-3 text-sm"><I size={15} className="text-sub" /><span className="w-28 text-sub">{l}</span><span className="min-w-0 flex-1 truncate font-medium">{v}</span></div>)}
            {mgr && <button onClick={() => navigate(`/people/${mgr.user_id}`)} className="flex w-full items-center gap-3 rounded-xl bg-surface2 p-2 text-left text-sm"><Avatar user={mgr} size={28} showStatus={false} /><span><span className="block text-[11px] text-sub">Melapor ke</span><span className="font-semibold">{mgr.name}</span></span></button>}
            {(ws.profile_fields || []).filter((f) => p.custom?.[f.key] !== undefined && p.custom[f.key] !== "").map((f) => <div key={f.key} className="flex items-center gap-3 text-sm"><Link2 size={15} className="text-sub" /><span className="w-28 text-sub">{f.name}</span><span className="min-w-0 flex-1 truncate font-medium">{Array.isArray(p.custom[f.key]) ? p.custom[f.key].join(", ") : String(p.custom[f.key])}</span></div>)}
          </section>
        </div>
        <section className="card p-5 lg:col-span-2" data-testid="profile-tasks"><h3 className="mb-3 text-sm font-bold">Tugas yang Ditugaskan</h3>
          {p.tasks?.length ? <div className="divide-y">{p.tasks.map((t) => { const d = dueInfo(t.deadline, done.includes(t.status)); return (
            <button key={t.id} onClick={() => navigate(`/tasks?task=${t.id}`)} className="flex w-full flex-wrap items-center gap-2 py-2.5 text-left"><span className="w-10 text-xs text-sub">T-{t.number}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span><Labels ids={t.label_ids} small max={1} /><StatusBadge status={t.status} /><PriorityBadge value={t.priority} />{d && <span className={`text-xs ${d.cls}`}>{d.text}</span>}</button>); })}</div> : <p className="text-sm text-sub">Belum ada tugas yang ditugaskan.</p>}
        </section>
      </div>
      <EditProfile open={edit} onOpenChange={setEdit} p={p} onSaved={(d) => { setP(d); reloadUsers(); }} />
    </div>
  );
}
