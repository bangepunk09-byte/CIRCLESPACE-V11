import { useState, useEffect, useRef } from "react";
import { Camera, Save, Check, Upload, Lock, Eye, EyeOff, KeyRound, ShieldCheck, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { api, errMsg, uploadFile, fileUrl } from "../../lib/api";
import { PRESET_AVATARS } from "../../lib/avatars";
import { upsertAccountInVault } from "../../lib/persistentMirror";
import { PasswordStrengthMeter } from "../../components/PasswordStrengthMeter";
import { ROLE_NAMES } from "../../components/common";
import { AppSelect } from "../../components/ui/select";
import { DatePicker } from "../../components/ui/date-picker";
import { Card } from "./AdminPanels";

const DEFAULT_DEPARTMENTS = ["Management", "Marketing", "Sales", "IT", "Finance", "Legal", "HRGA"];
const EMPLOYMENT_OPTIONS = [
  ["Full-time", "Penuh Waktu"],
  ["Part-time", "Paruh Waktu"],
  ["Contract", "Kontrak"],
  ["Intern", "Magang"],
  ["On leave", "Sedang Cuti"],
];

export function UserProfileSettings() {
  const { me, ws, setSession, reloadUsers } = useApp();
  const [f, setF] = useState({
    name: me?.name || "",
    job_title: me?.job_title || "",
    department: me?.department || "Marketing",
    phone: me?.phone || "",
    employee_id: me?.employee_id || "",
    employment_status: me?.employment_status || "",
    join_date: me?.join_date || "",
    bio: me?.bio || "",
    avatar: me?.avatar || me?.picture || PRESET_AVATARS[0],
    custom_fields: { ...(me?.custom || {}), ...(me?.custom_fields || {}) }
  });
  const [busy, setBusy] = useState(false);

  // Change password state
  const [pwForm, setPwForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: ""
  });
  const [showPw, setShowPw] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const [busyRevoke, setBusyRevoke] = useState(false);

  const loadedKeyRef = useRef("");

  useEffect(() => {
    if (!me?.user_id) return;
    const syncKey = `${me.user_id}:${me.updated_at || ""}`;
    if (loadedKeyRef.current === syncKey) return;
    loadedKeyRef.current = syncKey;
    setF({
      name: me.name || "",
      job_title: me.job_title || "",
      department: me.department || "Marketing",
      phone: me.phone || "",
      employee_id: me.employee_id || "",
      employment_status: me.employment_status || "",
      join_date: me.join_date || "",
      bio: me.bio || "",
      avatar: me.avatar || me.picture || PRESET_AVATARS[0],
      custom_fields: { ...(me.custom || {}), ...(me.custom_fields || {}) }
    });
  }, [me?.user_id, me?.updated_at]); // eslint-disable-line

  const baseDivisions = Array.isArray(ws?.divisions) && ws.divisions.length > 0 ? ws.divisions : DEFAULT_DEPARTMENTS;
  const departments = Array.from(new Set([...baseDivisions, f.department].filter(Boolean)));
  const customProfileFields = Array.isArray(ws?.profile_fields) ? ws.profile_fields : [];

  const handleSelectPresetAvatar = async (avUrl) => {
    setF((prev) => ({ ...prev, avatar: avUrl, picture: avUrl }));
    try {
      const targetId = me?.user_id || "me";
      const { data } = await api.patch(`/users/${targetId}`, { avatar: avUrl, picture: avUrl });
      upsertAccountInVault(data);
      setSession((s) => {
        const next = {
          ...s,
          user: { ...s?.user, ...data, avatar: avUrl, picture: avUrl }
        };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      reloadUsers();
      toast.success("Avatar profil berhasil diperbarui!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui avatar"));
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Pilih file gambar untuk foto profil");
    try {
      const up = await uploadFile(file);
      const url = fileUrl(up.id);
      setF((prev) => ({ ...prev, avatar: url, picture: url }));

      const targetId = me?.user_id || "me";
      const { data } = await api.patch(`/users/${targetId}`, { avatar: url, picture: url });
      upsertAccountInVault(data);
      setSession((s) => {
        const next = {
          ...s,
          user: { ...s?.user, ...data, avatar: url, picture: url }
        };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      reloadUsers();
      toast.success("Foto profil berhasil diperbarui!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengupload foto profil"));
    } finally {
      e.target.value = "";
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!f.name.trim()) {
      return toast.error("Nama lengkap wajib diisi.");
    }
    setBusy(true);
    try {
      const payload = {
        ...f,
        name: f.name.trim(),
        avatar: f.avatar || f.picture || "",
        picture: f.avatar || f.picture || "",
        custom: f.custom_fields || {},
        custom_fields: f.custom_fields || {}
      };
      const targetId = me?.user_id || "me";
      const { data } = await api.patch(`/users/${targetId}`, payload);
      loadedKeyRef.current = `${data?.user_id || targetId}:${data?.updated_at || ""}`;
      upsertAccountInVault(data);
      setSession((s) => {
        const next = {
          ...s,
          user: { ...s?.user, ...data, avatar: data.avatar || data.picture, picture: data.avatar || data.picture }
        };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      reloadUsers();
      toast.success("Data diri lengkap & divisi organisasi berhasil disimpan!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan data diri"));
    } finally {
      setBusy(false);
    }
  };

  const hasPassword = me?.has_password !== false;

  const handleChangePassword = async (e) => {
    if (e) e.preventDefault();
    if (hasPassword && !pwForm.current_password) {
      return toast.error("Masukkan password saat ini terlebih dahulu.");
    }
    if (!pwForm.new_password || pwForm.new_password.length < 6) {
      return toast.error("Password baru minimal 6 karakter.");
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      return toast.error("Konfirmasi password baru tidak cocok.");
    }
    setBusyPw(true);
    try {
      const { data } = await api.post("/auth/change-password", {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password
      });
      setSession((s) => {
        const next = {
          ...s,
          ...(data?.token ? { token: data.token } : {}),
          user: { ...s?.user, ...(data?.user || {}), has_password: true }
        };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      setPwForm({ current_password: "", new_password: "", confirm_password: "" });
      toast.success(data?.detail || "Password akun berhasil diperbarui!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengubah password"));
    } finally {
      setBusyPw(false);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setBusyRevoke(true);
    try {
      const { data } = await api.post("/auth/revoke-sessions", { keep_current: true });
      setSession((s) => {
        const next = {
          ...s,
          ...(data?.token ? { token: data.token } : {}),
          user: { ...s?.user, ...(data?.user || {}) }
        };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      toast.success(data?.detail || "Semua sesi di perangkat lain berhasil dikeluarkan!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mencabut sesi perangkat lain"));
    } finally {
      setBusyRevoke(false);
    }
  };

  return (
    <div className="space-y-5">
    <Card title="Data Diri Lengkap" testid="user-profile-settings-card">
      <form onSubmit={handleSave} className="space-y-4 pt-1">
        <p className="text-xs text-sub leading-relaxed">
          Ubah informasi profil dan data diri Anda yang akan dilihat oleh rekan kerja di seluruh workspace CIRCLE.
        </p>

        {/* Avatar Upload & Preset Selector */}
        <div className="rounded-2xl border bg-surface2/50 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <img
                  src={f.avatar || PRESET_AVATARS[0]}
                  alt="Avatar preview"
                  className="h-20 w-20 rounded-full object-cover border-2 border-brand/40 shadow-sm"
                  onError={(e) => { e.currentTarget.src = PRESET_AVATARS[0]; }}
                />
                <label className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-brand text-white shadow-md hover:bg-brand/90 transition-colors" title="Upload foto profil">
                  <Camera size={13} />
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">{f.name || "Nama Pengguna"}</h4>
                <p className="text-xs text-sub">{me?.email}</p>
                <p className="mt-1 text-[11px] font-semibold text-brand">Peran: {ROLE_NAMES[me?.role] || me?.role}</p>
              </div>
            </div>

            <label className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity cursor-pointer">
              <Upload size={14} />
              <span>Unggah Foto</span>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" data-testid="profile-upload-photo-input" />
            </label>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold text-sub">Pilih Avatar Karakter:</p>
            <div className="flex flex-wrap items-center gap-2.5">
              {PRESET_AVATARS.slice(0, 6).map((avUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectPresetAvatar(avUrl)}
                  className={`relative h-10 w-10 rounded-full overflow-hidden border-2 transition-transform hover:scale-110 cursor-pointer ${
                    f.avatar === avUrl ? "border-brand ring-2 ring-brand/30 scale-105" : "border-transparent opacity-80 hover:opacity-100"
                  }`}
                  data-testid={`profile-avatar-option-${idx}`}
                >
                  <img src={avUrl} alt={`Avatar ${idx + 1}`} className="h-full w-full object-cover" />
                  {f.avatar === avUrl && (
                    <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand text-white">
                      <Check size={8} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Nama Lengkap *</label>
            <input
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Nama lengkap Anda"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              data-testid="profile-name-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Alamat Email</label>
            <input
              disabled
              value={me?.email || ""}
              className="h-10 w-full rounded-xl border bg-surface2/50 px-3 text-xs text-sub cursor-not-allowed"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Divisi / Departemen</label>
            <AppSelect
              value={f.department}
              onChange={(e) => setF({ ...f, department: e.target.value })}
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs font-medium text-ink"
              data-testid="profile-dept-select"
            >
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </AppSelect>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Jabatan / Posisi</label>
            <input
              value={f.job_title}
              onChange={(e) => setF({ ...f, job_title: e.target.value })}
              placeholder="Mis. Senior Software Engineer"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              data-testid="profile-title-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Nomor Telepon / WhatsApp</label>
            <input
              value={f.phone || ""}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
              placeholder="+62 812-3456-7890"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              data-testid="profile-phone-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">ID Employee</label>
            <input
              value={f.employee_id || ""}
              onChange={(e) => setF({ ...f, employee_id: e.target.value })}
              placeholder="mis. EMP-001"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              data-testid="profile-settings-empid-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Status Kepegawaian</label>
            <AppSelect
              value={f.employment_status || ""}
              onChange={(e) => setF({ ...f, employment_status: e.target.value })}
              placeholder="Pilih status"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs font-medium text-ink"
              data-testid="profile-settings-empstatus-select"
            >
              {EMPLOYMENT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </AppSelect>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Tanggal Bergabung</label>
            <DatePicker
              showQuickPresets={false}
              value={f.join_date || ""}
              onChange={(val) => setF({ ...f, join_date: val })}
              placeholder="Pilih tanggal bergabung"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              data-testid="profile-settings-joindate-input"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-sub">Bio / Tentang Saya</label>
          <textarea
            rows={3}
            value={f.bio || ""}
            onChange={(e) => setF({ ...f, bio: e.target.value })}
            placeholder="Tuliskan sedikit tentang keahlian atau fokus kerja Anda..."
            className="w-full rounded-xl border bg-surface2 p-3 text-xs outline-none focus:border-brand resize-none"
            data-testid="profile-bio-input"
          />
        </div>

        {customProfileFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t">
            {customProfileFields.map((cf) => (
              <div key={cf.key}>
                <label className="mb-1 block text-xs font-semibold text-sub">{cf.name}</label>
                {cf.type === "dropdown" && Array.isArray(cf.options) && cf.options.length > 0 ? (
                  <AppSelect
                    value={f.custom_fields?.[cf.key] || ""}
                    onChange={(e) => setF({ ...f, custom_fields: { ...(f.custom_fields || {}), [cf.key]: e.target.value } })}
                    placeholder={`Pilih ${cf.name}...`}
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs font-medium text-ink"
                  >
                    <option value="">Pilih {cf.name}...</option>
                    {cf.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </AppSelect>
                ) : (
                  <input
                    type={cf.type === "date" ? "date" : cf.type === "url" ? "url" : "text"}
                    value={f.custom_fields?.[cf.key] || ""}
                    onChange={(e) => setF({ ...f, custom_fields: { ...(f.custom_fields || {}), [cf.key]: e.target.value } })}
                    placeholder={cf.name}
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <button
            type="submit"
            disabled={busy}
            className="btn-accent flex h-10 items-center gap-2 rounded-full px-5 text-xs font-semibold shadow-xs disabled:opacity-50"
            data-testid="profile-save-btn"
          >
            <Save size={14} />
            <span>{busy ? "Menyimpan..." : "Simpan Perubahan Profil"}</span>
          </button>
        </div>
      </form>
    </Card>

    <Card title="Keamanan & Ubah Password" testid="user-password-settings-card">
      <form onSubmit={handleChangePassword} className="space-y-4 pt-1">
        <p className="text-xs text-sub leading-relaxed">
          {hasPassword
            ? "Perbarui password akun Anda secara berkala untuk menjaga keamanan akses ke workspace CIRCLE."
            : "Akun Anda belum memiliki password lokal. Buat password di bawah ini agar Anda bisa login menggunakan Email & Password."}
        </p>

        {hasPassword && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Password Saat Ini *</label>
            <div className="relative flex items-center">
              <Lock size={14} className="absolute left-3 text-sub" />
              <input
                type={showPw ? "text" : "password"}
                required
                value={pwForm.current_password}
                onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                placeholder="Masukkan password saat ini"
                className="h-10 w-full rounded-xl border bg-surface2 pl-9 pr-10 text-xs outline-none focus:border-brand"
                data-testid="profile-current-password-input"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 text-sub hover:text-ink cursor-pointer"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/25 p-3.5 space-y-2.5" data-testid="account-encryption-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck size={16} />
              </div>
              <div>
                <p className="text-xs font-bold text-ink">Enkripsi & Proteksi Akun Aktif</p>
                <p className="text-[11px] text-sub">
                  {me?.password_updated_at
                    ? `Password terakhir diperbarui ${new Date(me.password_updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
                    : "Kredensial akun terenkripsi penuh di server."}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={busyRevoke}
              onClick={handleRevokeOtherSessions}
              className="h-8 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-surface px-3 text-[11px] font-bold text-ink hover:bg-surface2 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              data-testid="revoke-other-sessions-btn"
            >
              <LogOut size={13} className="text-rose-500" />
              <span>{busyRevoke ? "Memproses..." : "Keluarkan Perangkat Lain"}</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-xl bg-surface/90 border px-2.5 py-1.5">
              <span className="text-sub block">Hash Password</span>
              <b className="text-ink font-mono">scrypt + Salt 128-bit</b>
            </div>
            <div className="rounded-xl bg-surface/90 border px-2.5 py-1.5">
              <span className="text-sub block">Enkripsi Rahasia</span>
              <b className="text-ink font-mono">AES-256-GCM</b>
            </div>
            <div className="rounded-xl bg-surface/90 border px-2.5 py-1.5">
              <span className="text-sub block">Token Sesi</span>
              <b className="text-ink font-mono">HMAC-SHA256 · v{me?.token_version || 1}</b>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Password Baru *</label>
            <div className="relative flex items-center">
              <KeyRound size={14} className="absolute left-3 text-sub" />
              <input
                type={showPw ? "text" : "password"}
                required
                value={pwForm.new_password}
                onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                placeholder="Minimal 6 karakter"
                className="h-10 w-full rounded-xl border bg-surface2 pl-9 pr-10 text-xs outline-none focus:border-brand"
                data-testid="profile-new-password-input"
              />
              {!hasPassword && (
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 text-sub hover:text-ink cursor-pointer"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">Konfirmasi Password Baru *</label>
            <div className="relative flex items-center">
              <KeyRound size={14} className="absolute left-3 text-sub" />
              <input
                type={showPw ? "text" : "password"}
                required
                value={pwForm.confirm_password}
                onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                placeholder="Ulangi password baru"
                className="h-10 w-full rounded-xl border bg-surface2 pl-9 pr-3 text-xs outline-none focus:border-brand"
                data-testid="profile-confirm-password-input"
              />
            </div>
          </div>
        </div>
        <PasswordStrengthMeter password={pwForm.new_password} />

        <div className="flex justify-end pt-2 border-t">
          <button
            type="submit"
            disabled={busyPw}
            className="btn-accent flex h-10 items-center gap-2 rounded-full px-5 text-xs font-semibold shadow-xs disabled:opacity-50"
            data-testid="profile-save-password-btn"
          >
            <KeyRound size={14} />
            <span>{busyPw ? "Menyimpan..." : hasPassword ? "Simpan Password Baru" : "Buat Password Akun"}</span>
          </button>
        </div>
      </form>
    </Card>
    </div>
  );
}
