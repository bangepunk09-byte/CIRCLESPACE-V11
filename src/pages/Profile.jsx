import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageCircle, Mail, MapPin, Briefcase, Users2, Pencil, Calendar, IdCard, Link2, Phone, Newspaper, CornerDownRight, Heart, BarChart3, Paperclip, Hash, ArrowUpRight, BadgeCheck, Sparkles, Palette, ImagePlus, RotateCcw, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, uploadFile } from "../lib/api";
import { Avatar, Spinner, rel, AccentButton, GhostButton, getAvailabilityStatusMeta, VerifiedBadge, MentionText } from "../components/common";
import { getProfileCompletion } from "../lib/profileCompletion";
import { upsertAccountInVault } from "../lib/persistentMirror";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";
import { Switch } from "../components/ui/switch";

const MODES = ["Office", "Remote", "Hybrid", "On-site", "Kustom"];
const EMPLOYMENT_OPTIONS = [
  ["Full-time", "Penuh Waktu"],
  ["Part-time", "Paruh Waktu"],
  ["Contract", "Kontrak"],
  ["Intern", "Magang"],
  ["On leave", "Sedang Cuti"],
];
const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT_OPTIONS);

const DEFAULT_COVER_BG = "linear-gradient(120deg, var(--s-red), var(--s-purple), var(--s-blue))";
const COVER_PRESETS = [
  { id: "pastel_default", label: "Pastel Default", value: DEFAULT_COVER_BG },
  { id: "sunset_coral", label: "Sunset Coral", value: "linear-gradient(135deg, #FF6B6B 0%, #FF8E53 50%, #FBBF24 100%)" },
  { id: "ocean_breeze", label: "Samudra Biru", value: "linear-gradient(135deg, #0284C7 0%, #3B82F6 50%, #6366F1 100%)" },
  { id: "emerald_mint", label: "Hijau Zamrud", value: "linear-gradient(135deg, #059669 0%, #14B8A6 55%, #06B6D4 100%)" },
  { id: "royal_violet", label: "Ungu Elegan", value: "linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)" },
  { id: "warm_rose", label: "Mawar Hangat", value: "linear-gradient(135deg, #E11D48 0%, #FB7185 55%, #FDA4AF 100%)" },
  { id: "midnight_slate", label: "Midnight Gelap", value: "linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #334155 100%)" },
  { id: "aurora_indigo", label: "Aurora Malam", value: "linear-gradient(135deg, #1E1B4B 0%, #4338CA 50%, #0EA5E9 100%)" },
];

const COVER_POSITIONS = [
  { value: "top", label: "Atas" },
  { value: "center", label: "Tengah" },
  { value: "bottom", label: "Bawah" },
];

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
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setF({
        ...p,
        custom: { ...(p?.custom_fields || {}), ...(p?.custom || {}) },
        skillsText: (p.skills || []).join(", "),
      });
    }
    wasOpenRef.current = open;
  }, [open, p]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const liveCompletion = useMemo(() => getProfileCompletion(f), [f]);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    const keys = [
      "name",
      "picture",
      "avatar",
      "cover_bg",
      "cover_image",
      "cover_position",
      "phone",
      "employee_id",
      "employment_status",
      "join_date",
      "bio",
      "work_mode",
      "city",
      "office",
      "custom_location",
      "location_status",
      "share_location",
      "custom",
      ...(isAdmin ? ["job_title", "department", "division", "team", "manager_id"] : []),
    ];
    const body = Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
    if (body.picture && !body.avatar) body.avatar = body.picture;
    if (body.avatar && !body.picture) body.picture = body.avatar;
    if (body.custom) body.custom_fields = body.custom;
    body.skills = (f.skillsText || "").split(",").map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      const { data } = await api.patch(`/users/${p.user_id}`, body);
      if (data?.is_verified && !p?.is_verified) {
        toast.success("Profil 100% lengkap! Akun Anda kini mendapat centang Verified.");
      } else {
        toast.success("Profil berhasil disimpan");
      }
      onSaved(data);
      onOpenChange(false);
    } catch (e) { toast.error(errMsg(e)); } finally {
      setSaving(false);
    }
  };
  const photo = async (e) => {
    try {
      const up = await uploadFile(e.target.files[0]);
      const url = fileUrl(up.id);
      setF((prev) => ({ ...prev, picture: url, avatar: url }));
    } catch (er) { toast.error(errMsg(er)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>Ubah Profil</DialogTitle></DialogHeader>
        <div
          className={`rounded-2xl border p-3.5 transition-colors ${
            liveCompletion.isVerified
              ? "border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30"
              : "border-slate-200/80 dark:border-slate-800 bg-surface2/70"
          }`}
          data-testid="edit-profile-completion-card"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-ink">
              {liveCompletion.isVerified ? (
                <>
                  <VerifiedBadge user={{ is_verified: true }} size={16} />
                  <span>Profil 100% Lengkap — Siap Terverifikasi!</span>
                </>
              ) : (
                <>
                  <BadgeCheck size={16} className="text-sky-500 shrink-0" />
                  <span>Kelengkapan Profil untuk Centang Verified</span>
                </>
              )}
            </span>
            <span className={liveCompletion.isVerified ? "text-sky-600 dark:text-sky-400" : "text-brand"}>
              {liveCompletion.percent}% ({liveCompletion.filledCount}/{liveCompletion.totalCount})
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                liveCompletion.isVerified ? "bg-sky-500" : "bg-brand"
              }`}
              style={{ width: `${liveCompletion.percent}%` }}
            />
          </div>
          {!liveCompletion.isVerified && liveCompletion.missingFields.length > 0 && (
            <p className="mt-2 text-[11px] text-sub leading-relaxed">
              Belum terisi:{" "}
              <span className="font-medium text-ink">{liveCompletion.missingFields.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3"><Avatar user={f} size={56} showStatus={false} /><label className="cursor-pointer text-sm font-semibold text-brand">Ganti Foto<input type="file" accept="image/*" hidden onChange={photo} data-testid="profile-photo-input" /></label></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama Lengkap"><input value={f.name || ""} onChange={set("name")} className={inp} data-testid="profile-name-input" /></Field>
          <Field label="No. Telepon"><input value={f.phone || ""} onChange={set("phone")} className={inp} data-testid="profile-phone-input" /></Field>
          <Field label="ID Employee"><input value={f.employee_id || ""} onChange={set("employee_id")} placeholder="mis. EMP-001" className={inp} data-testid="profile-employee-id-input" /></Field>
          <Field label="Status Kepegawaian"><AppSelect value={f.employment_status || ""} onChange={set("employment_status")} placeholder="Pilih status" className={inp} data-testid="profile-employment-status-select">{EMPLOYMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AppSelect></Field>
          <Field label="Tanggal Bergabung"><DatePicker showQuickPresets={false} value={f.join_date || ""} onChange={(val) => setF({ ...f, join_date: val })} placeholder="Pilih tanggal bergabung" className={inp} data-testid="profile-join-date-input" /></Field>
          {isAdmin && <>
            <Field label="Jabatan"><input value={f.job_title || ""} onChange={set("job_title")} className={inp} data-testid="profile-title-input" /></Field>
            <Field label="Divisi"><input value={f.department || ""} onChange={set("department")} className={inp} /></Field>
            <Field label="Tim"><input value={f.team || ""} onChange={set("team")} className={inp} /></Field>
            <Field label="Atasan Langsung"><AppSelect value={f.manager_id || ""} onChange={set("manager_id")} placeholder="Tidak ada" className={inp}><option value="">Tidak ada</option>{users.filter((u) => u.user_id !== p.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</AppSelect></Field>
          </>}
          <Field label="Mode Kerja"><AppSelect value={f.work_mode || ""} onChange={set("work_mode")} placeholder="Pilih mode kerja" className={inp} data-testid="profile-workmode-select">{MODES.map((m) => <option key={m}>{m}</option>)}</AppSelect></Field>
          <Field label="Kota"><input value={f.city || ""} onChange={set("city")} className={inp} data-testid="profile-city-input" /></Field>
          <Field label="Kantor"><input value={f.office || ""} onChange={set("office")} className={inp} /></Field>
          {(f.work_mode === "Custom" || f.work_mode === "Kustom") && <Field label="Lokasi Kustom"><input value={f.custom_location || ""} onChange={set("custom_location")} className={inp} /></Field>}
          <Field label="Status Lokasi"><input value={f.location_status || ""} onChange={set("location_status")} placeholder="mis. Di lokasi klien hari ini" className={inp} /></Field>
        </div>
        <label className="flex items-center justify-between rounded-xl bg-surface2 p-3 text-sm">Bagikan lokasi kerja saya dengan rekan tim<Switch checked={f.share_location !== false} onCheckedChange={set("share_location")} data-testid="profile-share-location" /></label>
        <Field label="Keahlian"><input value={f.skillsText || ""} onChange={set("skillsText")} placeholder="Pisahkan dengan koma" className={inp} data-testid="profile-skills-input" /></Field>
        <Field label="Biodata"><textarea value={f.bio || ""} onChange={set("bio")} className={`${inp} h-20 py-2`} data-testid="profile-bio-input" /></Field>
        {(ws.profile_fields || []).length > 0 && <div className="grid gap-3 sm:grid-cols-2">{ws.profile_fields.map((cf) => <Field key={cf.key} label={cf.name}><CustomInput f={cf} value={f.custom?.[cf.key]} onChange={(v) => setF({ ...f, custom: { ...(f.custom || {}), [cf.key]: v } })} /></Field>)}</div>}
        <AccentButton onClick={save} disabled={saving} data-testid="profile-save-btn">{saving ? "Menyimpan…" : "Simpan Profil"}</AccentButton>
      </DialogContent>
    </Dialog>
  );
}

function CustomizeCoverDialog({ open, onOpenChange, p, onSaved }) {
  const [coverBg, setCoverBg] = useState(p?.cover_bg || DEFAULT_COVER_BG);
  const [coverImage, setCoverImage] = useState(p?.cover_image || "");
  const [coverPosition, setCoverPosition] = useState(p?.cover_position || "center");
  const [customColor, setCustomColor] = useState("#3B82F6");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const currentBg = p?.cover_bg || DEFAULT_COVER_BG;
      setCoverBg(currentBg);
      setCoverImage(p?.cover_image || "");
      setCoverPosition(p?.cover_position || "center");
      if (/^#[0-9a-fA-F]{6}$/.test(currentBg)) {
        setCustomColor(currentBg);
      }
    }
    wasOpenRef.current = open;
  }, [open, p]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      setCoverImage(fileUrl(up.id));
    } catch (er) {
      toast.error(errMsg(er));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleReset = () => {
    setCoverImage("");
    setCoverBg(DEFAULT_COVER_BG);
    setCoverPosition("center");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/users/${p.user_id}`, {
        cover_bg: coverBg || DEFAULT_COVER_BG,
        cover_image: coverImage || "",
        cover_position: coverPosition || "center",
      });
      toast.success("Background cover profil berhasil diperbarui");
      onSaved(data);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const objectPositionClass =
    coverPosition === "top"
      ? "object-top"
      : coverPosition === "bottom"
      ? "object-bottom"
      : "object-center";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette size={18} className="text-brand" />
            <span>Kustomisasi Background Cover</span>
          </DialogTitle>
        </DialogHeader>

        {/* Live Preview */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface shadow-xs" data-testid="cover-preview-card">
          <div
            className="relative h-28 w-full overflow-hidden transition-all"
            style={!coverImage ? { background: coverBg || DEFAULT_COVER_BG } : undefined}
          >
            {coverImage && (
              <img
                src={coverImage}
                alt="Preview cover"
                className={`h-full w-full object-cover ${objectPositionClass}`}
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />
          </div>
          <div className="px-4 pb-3 pt-2.5 flex items-center gap-3">
            <div className="-mt-10 w-fit shrink-0 rounded-full border-4 border-[var(--c-surface)] bg-[var(--c-surface)] shadow-xs">
              <Avatar user={p} size={56} showStatus={false} ringDeadline={false} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{p?.name}</p>
              <p className="truncate text-xs text-sub">{p?.job_title || "Anggota Tim"}</p>
            </div>
          </div>
        </div>

        {/* Upload Gambar Cover */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-sub">Gambar Cover Kustom</span>
            {coverImage && (
              <button
                type="button"
                onClick={() => setCoverImage("")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 cursor-pointer"
                data-testid="cover-remove-image-btn"
              >
                <Trash2 size={12} />
                Hapus Gambar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-surface2/70 hover:bg-surface2 px-3.5 text-xs font-semibold text-ink transition-colors cursor-pointer ${
                uploading ? "opacity-60 pointer-events-none" : ""
              }`}
            >
              <ImagePlus size={14} className="text-brand" />
              <span>{uploading ? "Mengunggah..." : coverImage ? "Ganti Gambar Cover" : "Unggah Foto / Banner"}</span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={handleUpload}
                data-testid="cover-image-input"
              />
            </label>
            {coverImage && (
              <div className="inline-flex items-center rounded-xl bg-surface2 p-0.5 text-[11px] font-semibold">
                {COVER_POSITIONS.map((pos) => (
                  <button
                    key={pos.value}
                    type="button"
                    onClick={() => setCoverPosition(pos.value)}
                    className={`rounded-lg px-2.5 py-1 transition-colors cursor-pointer ${
                      coverPosition === pos.value
                        ? "bg-surface text-ink shadow-xs"
                        : "text-sub hover:text-ink"
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preset Gradien */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-sub">Pilih Tema Gradien</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COVER_PRESETS.map((preset) => {
              const active = !coverImage && coverBg === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setCoverImage("");
                    setCoverBg(preset.value);
                  }}
                  data-testid={`cover-preset-${preset.id}`}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? "border-[var(--c-accent)] ring-2 ring-[var(--c-accent)]/25"
                      : "border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="relative h-10 w-full" style={{ background: preset.value }}>
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-900 shadow-xs">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <span className="truncate bg-surface px-2 py-1.5 text-[11px] font-semibold text-ink">
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Warna Solid Kustom */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-sub">Warna Solid Kustom</span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-surface2/50 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomColor(val);
                  setCoverImage("");
                  setCoverBg(val);
                }}
                aria-label="Pilih warna cover kustom"
                data-testid="cover-custom-color-input"
                className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0"
              />
              <div>
                <p className="text-xs font-semibold text-ink">Pilih Warna Bebas</p>
                <p className="text-[11px] font-mono text-sub uppercase">{!coverImage && /^#/.test(coverBg) ? coverBg : customColor}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCoverImage("");
                setCoverBg(customColor);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface2 transition-colors cursor-pointer"
            >
              Terapkan Warna
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
          <GhostButton type="button" onClick={handleReset} data-testid="cover-reset-btn">
            <RotateCcw size={14} />
            Reset Default
          </GhostButton>
          <AccentButton type="button" onClick={handleSave} disabled={saving || uploading} data-testid="cover-save-btn">
            {saving ? "Menyimpan..." : "Simpan Cover"}
          </AccentButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const USER_FEED_CACHE = new Map();

function readCachedUserFeedHistory(uid, userMap) {
  if (!uid) return null;
  if (USER_FEED_CACHE.has(uid)) {
    return USER_FEED_CACHE.get(uid);
  }
  try {
    const raw = localStorage.getItem(`circle_user_feed_history_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        USER_FEED_CACHE.set(uid, parsed);
        return parsed;
      }
    }
  } catch {}
  // Fallback: extract posts/replies synchronously from Beranda/Dashboard feed cache so first visit is instant too
  try {
    const rawPosts =
      localStorage.getItem("circle_cache_posts_feed") ||
      localStorage.getItem("circle_cache_posts");
    if (rawPosts) {
      const posts = JSON.parse(rawPosts);
      if (Array.isArray(posts)) {
        const extracted = [];
        for (const post of posts) {
          if (post?.author_id === uid) extracted.push(post);
          if (Array.isArray(post?.replies_preview)) {
            for (const rep of post.replies_preview) {
              if (rep?.author_id === uid) {
                extracted.push({
                  ...rep,
                  parent_id: post.id,
                  parent_post: {
                    id: post.id,
                    text: post.text || "",
                    topic: post.topic || null,
                    author_id: post.author_id,
                    author_name: userMap?.[post.author_id]?.name || "Rekan Kerja",
                  },
                });
              }
            }
          }
        }
        extracted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return extracted;
      }
    }
  } catch {}
  return null;
}

export default function Profile() {
  const { uid } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { me, userMap, ws, online, reloadUsers, setSession, hasDeadlineToday, subscribe } = useApp();
  const [rawP, setP] = useState(() => userMap?.[uid] || (uid === me?.user_id ? me : null));
  const [edit, setEdit] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [feedState, setFeedState] = useState(() => {
    const cached = readCachedUserFeedHistory(uid, userMap);
    return { uid, items: cached || [], loading: cached === null };
  });
  const [feedTab, setFeedTab] = useState("all");
  const navigate = useNavigate();

  const syncCachedFeed = readCachedUserFeedHistory(uid, userMap);
  const feedHistory = feedState.uid === uid ? feedState.items : (syncCachedFeed || []);
  const feedLoading = feedState.uid === uid ? feedState.loading : (syncCachedFeed === null);

  const loadFeedHistory = useCallback(() => {
    if (!uid) return;
    api.get(`/users/${uid}/posts`)
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        USER_FEED_CACHE.set(uid, list);
        try { localStorage.setItem(`circle_user_feed_history_${uid}`, JSON.stringify(list)); } catch {}
        setFeedState({ uid, items: list, loading: false });
      })
      .catch(() => {
        setFeedState((prev) => (prev.uid === uid ? { ...prev, loading: false } : { uid, items: [], loading: false }));
      });
  }, [uid]);

  useEffect(() => {
    const cachedFeed = readCachedUserFeedHistory(uid, userMap);
    setFeedState({
      uid,
      items: cachedFeed || [],
      loading: cachedFeed === null,
    });
    setFeedTab("all");
    const cachedUser = userMap?.[uid] || (uid === me?.user_id ? me : null);
    if (cachedUser) setP(cachedUser);
    api.get(`/users/${uid}`).then((r) => setP(r.data)).catch(() => {
      if (!cachedUser) navigate("/people");
    });
    loadFeedHistory();
  }, [uid, loadFeedHistory]); // eslint-disable-line

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((evt) => {
      if (evt?.type === "post:new" || evt?.type === "post:updated" || evt?.type === "post:deleted") {
        loadFeedHistory();
      }
    });
  }, [subscribe, loadFeedHistory]);

  const activeRawP = rawP?.user_id === uid ? rawP : null;
  const liveUser = (uid === me?.user_id ? me : null) || userMap?.[uid];
  const baseP = activeRawP || liveUser || { user_id: uid, name: "Karyawan", job_title: "Anggota Tim" };
  const p = liveUser
    ? {
        ...liveUser,
        ...baseP,
        online: liveUser.online ?? baseP.online,
        availability_status: liveUser.availability_status || baseP.availability_status,
        can_edit: baseP.can_edit ?? liveUser.can_edit,
      }
    : baseP;
  const syncSavedProfile = (d) => {
    if (!d?.user_id) return;
    setP(d);
    upsertAccountInVault(d);
    try {
      const cachedUsersRaw = localStorage.getItem("circle_users_cache");
      if (cachedUsersRaw) {
        const list = JSON.parse(cachedUsersRaw);
        if (Array.isArray(list)) {
          const next = list.map((u) => (u?.user_id === d.user_id ? { ...u, ...d } : u));
          localStorage.setItem("circle_users_cache", JSON.stringify(next));
        }
      }
    } catch {}
    if (d.user_id === me?.user_id) {
      setSession((s) => {
        if (!s) return s;
        const next = { ...s, user: { ...s.user, ...d } };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
    }
    reloadUsers();
  };
  const [dmBusy, setDmBusy] = useState(false);
  const openDm = async () => {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: uid });
      if (data?.id) navigate(`/messages/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka pesan"));
    } finally {
      setDmBusy(false);
    }
  };
  const mgr = userMap[p.manager_id];
  const isDeadlineToday = Boolean(hasDeadlineToday?.(p.user_id));
  const canEdit = Boolean(p.can_edit || uid === me?.user_id || ["super_admin", "workspace_admin"].includes(me?.role));
  const profileComp = useMemo(() => getProfileCompletion(p), [p]);

  useEffect(() => {
    if (searchParams.get("edit") === "1" && canEdit) {
      setEdit(true);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("edit");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, canEdit, setSearchParams]);

  const postItems = useMemo(() => feedHistory.filter((item) => !item.parent_id), [feedHistory]);
  const replyItems = useMemo(() => feedHistory.filter((item) => Boolean(item.parent_id)), [feedHistory]);
  const filteredFeed = useMemo(() => {
    if (feedTab === "posts") return postItems;
    if (feedTab === "replies") return replyItems;
    return feedHistory;
  }, [feedHistory, postItems, replyItems, feedTab]);

  const canSeeField = (vis) => {
    if (!vis || vis === "everyone") return true;
    if (uid === me?.user_id || ["super_admin", "workspace_admin"].includes(me?.role)) return true;
    if (vis === "managers") return Boolean(p.manager_id === me?.user_id || ["manager", "department_manager", "project_manager"].includes(me?.role));
    return false;
  };
  const fv = ws?.field_visibility || {};
  const info = [
    [Mail, "Email", p.email, "email"],
    [Phone, "Telepon", p.phone, "phone"],
    [IdCard, "ID Employee", p.employee_id, "employee_id"],
    [Briefcase, "Kepegawaian", EMPLOYMENT_LABELS[p.employment_status] || p.employment_status, "employment_status"],
    [Calendar, "Bergabung", p.join_date, "join_date"],
    [MapPin, "Lokasi", [p.office, p.city, (p.work_mode === "Custom" || p.work_mode === "Kustom") ? p.custom_location : p.work_mode].filter(Boolean).join(" · ")],
    [Users2, "Divisi / Tim", [p.division, p.team].filter(Boolean).join(" / ")],
  ].filter((x) => x[2] && canSeeField(x[3] ? fv[x[3]] : "everyone"));
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-10 animate-subpage-enter" data-testid="profile-page">
      <div className="card overflow-hidden">
        <div
          className="relative h-32 w-full overflow-hidden sm:h-40"
          style={!p.cover_image ? { background: p.cover_bg || DEFAULT_COVER_BG } : undefined}
          data-testid="profile-cover-banner"
        >
          {p.cover_image && (
            <img
              src={p.cover_image}
              alt={`Cover ${p.name}`}
              className={`h-full w-full object-cover ${
                p.cover_position === "top"
                  ? "object-top"
                  : p.cover_position === "bottom"
                  ? "object-bottom"
                  : "object-center"
              }`}
              referrerPolicy="no-referrer"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />
          {canEdit && (
            <button
              type="button"
              onClick={() => setCoverOpen(true)}
              data-testid="profile-cover-btn"
              className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-slate-900/55 hover:bg-slate-900/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md border border-white/15 shadow-sm transition-all cursor-pointer"
            >
              <Palette size={14} />
              <span>Ubah Cover</span>
            </button>
          )}
        </div>
        <div className="px-4 pb-5 pt-3.5 sm:px-8 sm:pb-6 sm:pt-4">
          <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5 min-w-0 flex-1">
              <div className="-mt-14 sm:-mt-16 w-fit shrink-0 rounded-full border-4 border-[var(--c-surface)] bg-[var(--c-surface)] shadow-sm">
                <Avatar user={p} size={96} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl sm:text-3xl font-bold tracking-tight leading-snug text-ink" data-testid="profile-name">
                  <span>{p.name}</span>
                  <VerifiedBadge user={p} size={22} />
                </h1>
                <p className="text-sub" data-testid="profile-job-title">{p.job_title || "Belum ada jabatan"}{p.department && ` · ${p.department}`}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  {(() => {
                    const statusMeta = getAvailabilityStatusMeta(p.availability_status);
                    const isOn = online.has(p.user_id) || p.online;
                    if (statusMeta.value !== "online") {
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold ${statusMeta.badgeClass}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                      );
                    }
                    return (
                      <span className={isOn ? "text-emerald-600 font-semibold" : "text-sub"}>
                        {isOn ? "● Online" : "○ Offline"}
                      </span>
                    );
                  })()}
                  {p.location_status && <span className="text-sub"> · {p.location_status}</span>}
                  {isDeadlineToday ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2.5 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]" /> Ada Deadline Hari Ini
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" /> Bebas Deadline
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pt-0.5">
              {uid !== me.user_id && <>
                <AccentButton onClick={openDm} disabled={dmBusy} data-testid="profile-message-btn"><MessageCircle size={16} />Pesan</AccentButton>
              </>}
              {canEdit && <GhostButton onClick={() => setEdit(true)} data-testid="profile-edit-btn"><Pencil size={15} />Ubah</GhostButton>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3 min-w-0">
        <div className="min-w-0 space-y-5">
          {uid === me?.user_id && !profileComp.isVerified && (
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5 border-sky-200/80 dark:border-sky-800/70 bg-gradient-to-br from-sky-50/60 to-surface dark:from-sky-950/30 dark:to-surface" data-testid="profile-verify-cta">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-ink">Dapatkan Centang Verified</h3>
                    <p className="text-[11px] text-sub">Kelengkapan profil {profileComp.percent}% ({profileComp.filledCount}/{profileComp.totalCount})</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                <div className="h-full rounded-full bg-sky-500 transition-all duration-300" style={{ width: `${profileComp.percent}%` }} />
              </div>
              <p className="mt-2.5 text-xs text-sub leading-relaxed">
                Lengkapi {profileComp.missingFields.length} kolom tersisa agar akun Anda terverifikasi di workspace.
              </p>
              <button
                type="button"
                onClick={() => setEdit(true)}
                data-testid="profile-complete-now-btn"
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white transition-colors"
              >
                <BadgeCheck size={15} />
                <span>Lengkapi Profil 100%</span>
              </button>
            </section>
          )}
          <section className="card min-w-0 overflow-hidden p-4 sm:p-5"><h3 className="mb-3 text-sm font-bold">Tentang</h3><p className="text-sm text-sub break-words">{p.bio || "Belum ada biodata."}</p>
            {p.skills?.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-soft-purple px-2.5 py-1 text-xs font-medium">{s}</span>)}</div>}</section>
          <section className="card min-w-0 overflow-hidden space-y-3 p-4 sm:p-5" data-testid="profile-contact-info">
            {info.map(([I, l, v]) => <div key={l} className="flex items-center gap-2.5 sm:gap-3 text-sm min-w-0"><I size={15} className="text-sub shrink-0" /><span className="w-24 sm:w-28 shrink-0 text-sub">{l}</span><span className="min-w-0 flex-1 truncate font-medium">{v}</span></div>)}
            {mgr && <button onClick={() => navigate(`/people/${mgr.user_id}`)} className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-surface2 p-2 text-left text-sm"><Avatar user={mgr} size={28} showStatus={false} /><span className="min-w-0"><span className="block text-[11px] text-sub">Melapor ke</span><span className="block truncate font-semibold">{mgr.name}</span></span></button>}
            {(ws.profile_fields || [])
              .filter((cf) => canSeeField(cf.visibility) && (p.custom?.[cf.key] ?? p.custom_fields?.[cf.key]) !== undefined && (p.custom?.[cf.key] ?? p.custom_fields?.[cf.key]) !== "")
              .map((cf) => {
                const rawVal = p.custom?.[cf.key] ?? p.custom_fields?.[cf.key];
                const displayVal = typeof rawVal === "boolean" ? (rawVal ? "Ya" : "Tidak") : Array.isArray(rawVal) ? rawVal.join(", ") : String(rawVal);
                return (
                  <div key={cf.key} className="flex items-center gap-2.5 sm:gap-3 text-sm min-w-0">
                    <Link2 size={15} className="text-sub shrink-0" />
                    <span className="w-24 sm:w-28 shrink-0 text-sub">{cf.name}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{displayVal}</span>
                  </div>
                );
              })}
          </section>
        </div>
        <section className="card min-w-0 overflow-hidden p-4 sm:p-5 lg:col-span-2" data-testid="profile-feed-history">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Newspaper size={16} className="text-brand shrink-0" />
              <h3 className="text-sm font-bold text-ink">Riwayat Aktivitas Feed</h3>
              <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-sub">
                {feedHistory.length}
              </span>
            </div>
            <div className="inline-flex items-center rounded-xl bg-surface2 p-0.5 text-xs font-semibold" data-testid="profile-feed-tabs">
              {[
                { key: "all", label: `Semua (${feedHistory.length})` },
                { key: "posts", label: `Postingan (${postItems.length})` },
                { key: "replies", label: `Balasan (${replyItems.length})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFeedTab(tab.key)}
                  data-testid={`profile-feed-tab-${tab.key}`}
                  className={`rounded-lg px-2.5 py-1 transition-colors ${
                    feedTab === tab.key
                      ? "bg-surface text-ink shadow-xs"
                      : "text-sub hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {feedLoading ? (
            <div className="py-10 flex justify-center">
              <Spinner label="Memuat riwayat feed" />
            </div>
          ) : filteredFeed.length > 0 ? (
            <div className="space-y-2.5">
              {filteredFeed.map((item) => {
                const isReply = Boolean(item.parent_id);
                const targetPostId = item.parent_id || item.id;
                const attachmentCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
                const reactionTotal = Object.values(item.reactions || {}).reduce(
                  (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
                  0
                );
                const totalLikes = (item.like_count || 0) + reactionTotal;

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/beranda/${targetPostId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/beranda/${targetPostId}`);
                      }
                    }}
                    data-testid={`profile-feed-item-${item.id}`}
                    className="group block w-full cursor-pointer rounded-2xl border border-slate-200/80 dark:border-slate-800/90 bg-surface2/40 hover:bg-surface2/80 p-3.5 text-left transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            isReply
                              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                              : "bg-soft-red text-brand"
                          }`}
                        >
                          {isReply ? <CornerDownRight size={11} /> : <Newspaper size={11} />}
                          {isReply ? "Balasan" : "Postingan"}
                        </span>
                        {item.topic && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-sub border border-slate-200/70 dark:border-slate-700/70">
                            <Hash size={10} />
                            {item.topic}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-sub">
                        <span>{rel(item.created_at)}</span>
                        <ArrowUpRight size={13} className="opacity-0 group-hover:opacity-100 text-brand transition-opacity" />
                      </span>
                    </div>

                    {isReply && item.parent_post && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border-l-2 border-brand/50 bg-surface/80 px-2.5 py-1.5 text-xs text-sub">
                        <span className="min-w-0 line-clamp-1">
                          Membalas{" "}
                          {item.parent_post.author_id ? (
                            <Link
                              to={`/people/${item.parent_post.author_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-ink font-semibold hover:underline"
                            >
                              {item.parent_post.author_name}
                            </Link>
                          ) : (
                            <strong className="text-ink font-semibold">{item.parent_post.author_name}</strong>
                          )}
                          {item.parent_post.text ? `: "${item.parent_post.text}"` : ""}
                        </span>
                      </div>
                    )}

                    {item.text && (
                      <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words line-clamp-4 leading-relaxed">
                        <MentionText text={item.text} mentionIds={item.mention_ids} />
                      </p>
                    )}

                    {item.poll?.question && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-soft-purple px-2.5 py-1 text-xs font-medium text-ink">
                        <BarChart3 size={13} className="text-purple-600 dark:text-purple-300 shrink-0" />
                        <span className="truncate max-w-xs">Polling: {item.poll.question}</span>
                      </div>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-sub">
                      <span className="inline-flex items-center gap-1">
                        <Heart size={12} className={item.liked ? "text-rose-500 fill-rose-500" : ""} />
                        {totalLikes}
                      </span>
                      {!isReply && (
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle size={12} />
                          {item.reply_count || 0} balasan
                        </span>
                      )}
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} />
                          {attachmentCount} lampiran
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center">
              <p className="text-sm font-semibold text-ink">
                {feedTab === "posts"
                  ? "Belum ada postingan di Beranda."
                  : feedTab === "replies"
                  ? "Belum ada balasan di Beranda."
                  : "Belum ada aktivitas di Feed Beranda."}
              </p>
              <p className="mt-1 text-xs text-sub">
                Semua postingan dan balasan yang dikirim ke Beranda akan tercatat di sini.
              </p>
            </div>
          )}
        </section>
      </div>
      <EditProfile
        open={edit}
        onOpenChange={setEdit}
        p={p}
        onSaved={syncSavedProfile}
      />
      <CustomizeCoverDialog
        open={coverOpen}
        onOpenChange={setCoverOpen}
        p={p}
        onSaved={syncSavedProfile}
      />
    </div>
  );
}
