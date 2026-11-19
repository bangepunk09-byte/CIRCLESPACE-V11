import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, Sparkles, MessageCircle, CheckSquare, Users, Eye, EyeOff, Mail, Lock, User, Building2, Briefcase, CheckCircle2, ArrowRight, ShieldAlert, Check, Upload, KeyRound, RefreshCw, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, uploadFile, fileUrl } from "../lib/api";
import { Avatar } from "../components/common";
import { googleBasicSignIn, setManualGoogleAuth } from "../lib/auth";
import { getTranslation } from "../lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import { PasswordStrengthMeter } from "../components/PasswordStrengthMeter";
import { attemptAutoHydrateServer, syncWorkspaceMirror, upsertAccountInVault, getKnownAccountsFromVault } from "../lib/persistentMirror";

const STATUS_MSG = {
  pending: "Akun Anda sedang dalam proses peninjauan & approval oleh Super Admin. Anda akan bisa masuk setelah akun disetujui.",
  inactive: "Akun Anda telah dinonaktifkan. Silakan hubungi Workspace Administrator.",
  not_allowed: "Akun ini tidak memiliki izin untuk bergabung dengan workspace.",
  error: "Proses masuk gagal. Silakan coba beberapa saat lagi.",
};

const DEFAULT_LOGIN_IMG = "/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg";

import { PRESET_AVATARS } from "../lib/avatars";

const DEFAULT_DIVISIONS = ["Management", "Marketing", "Sales", "IT", "Finance", "Legal", "HRGA"];

function Floating({ image, t }) {
  const src = image ? `/api/public/login-image/${image}` : DEFAULT_LOGIN_IMG;
  const heroCards = [
    [MessageCircle, t("auth_hero_card_1", "Pesan & Panggilan")],
    [CheckSquare, t("auth_hero_card_2", "Tugas & Proyek")],
    [Users, t("auth_hero_card_3", "Tim & Organisasi")],
  ];
  return (
    <div className="relative hidden lg:flex lg:h-full flex-1 overflow-hidden rounded-[32px] bg-[#20283B] p-10 text-white shrink-0" data-testid="login-hero">
      <img src={src} alt="Login background" onError={(e) => { e.currentTarget.src = DEFAULT_LOGIN_IMG; }} className="absolute inset-0 h-full w-full object-cover" data-testid="login-hero-image" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#20283B]/90 via-[#20283B]/30 to-transparent" />
      <div className="relative z-10 flex w-full flex-col justify-between">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium backdrop-blur" data-testid="login-hero-badge">
          <Sparkles size={14} />
          {t("auth_hero_badge", "Satu Workspace. Satu Lingkaran Kolaborasi.")}
        </span>
        <div>
          <h2 className="max-w-md text-5xl font-extrabold leading-[1.05] tracking-tight" data-testid="login-hero-title">
            {t("auth_hero_title", "Satukan Tim, Percepat Eksekusi.")}
          </h2>
          <p className="mt-4 max-w-md text-white/85" data-testid="login-hero-subtitle">
            {t("auth_hero_subtitle", "Satu ruang kerja terpadu untuk komunikasi tim, manajemen tugas, dan kontrol operasional perusahaan.")}
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {heroCards.map(([I, label], i) => (
              <div key={i} className="animate-float rounded-3xl bg-white/90 p-4 text-[#20283B] shadow-xl" style={{ animationDelay: `${i * 0.8}s` }}>
                <I size={20} className="text-[#FF5364]" /><p className="mt-6 text-sm font-semibold">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { session, setSession, ws } = useApp();
  const [params] = useSearchParams();
  const [brand, setBrand] = useState({});
  const status = params.get("status");
  const effectiveCopy = {
    ...(ws?.custom_copywriting || {}),
    ...(brand?.custom_copywriting || {}),
  };
  const t = (key, fallback) => getTranslation(key, effectiveCopy, fallback);

  // Mode: 'login' | 'signup'
  const [mode, setMode] = useState("login");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busyLogin, setBusyLogin] = useState(false);
  const [loginAlert, setLoginAlert] = useState(null);

  // Sign Up form state
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    department: "Marketing",
    job_title: "",
    note: "",
    avatar: PRESET_AVATARS[0]
  });
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [busySignup, setBusySignup] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Success dialog state for signup/access request
  const [successDialog, setSuccessDialog] = useState(false);
  const [registeredData, setRegisteredData] = useState(null);

  // Forgot Password modal state
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotTab, setForgotTab] = useState("email"); // "email" | "approval" | "recovery"
  const [forgotForm, setForgotForm] = useState({
    email: "",
    newPassword: "",
    confirmPassword: "",
    note: "",
    recoveryKey: "",
    otpCode: ""
  });
  const [showForgotPw, setShowForgotPw] = useState(false);
  const [busyForgot, setBusyForgot] = useState(false);
  const [forgotTicket, setForgotTicket] = useState(null); // { request_id, email, status, approved_by, rejected_by }
  const [checkingForgot, setCheckingForgot] = useState(false);
  const [verifiedEmailToken, setVerifiedEmailToken] = useState("");
  const [verifiedGoogleEmail, setVerifiedGoogleEmail] = useState("");
  const [verifyingGoogleEmail, setVerifyingGoogleEmail] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpNotice, setOtpNotice] = useState("");

  // Google fallback modal state (used if popup is blocked or Google OAuth is in Testing mode / Error 403)
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [googleFallbackReason, setGoogleFallbackReason] = useState("");
  const [googleForm, setGoogleForm] = useState({
    name: "",
    email: "",
    department: "Marketing",
    job_title: ""
  });
  const [busyGoogle, setBusyGoogle] = useState(false);

  const availableDivisions = Array.isArray(brand?.divisions) && brand.divisions.length > 0
    ? brand.divisions
    : DEFAULT_DIVISIONS;

  useEffect(() => {
    let active = true;
    api.get("/public/branding").then((r) => {
      if (!active) return;
      setBrand(r.data);
      if (Array.isArray(r.data?.divisions) && r.data.divisions.length > 0) {
        const firstDept = r.data.divisions.find((d) => d.toLowerCase() !== "management") || r.data.divisions[0];
        setSignupForm((prev) => ({
          ...prev,
          department: r.data.divisions.includes(prev.department) ? prev.department : firstDept
        }));
      }
    }).catch(() => {});
    attemptAutoHydrateServer(api).then((restored) => {
      if (restored && active) {
        api.get("/public/branding").then((r) => active && setBrand(r.data)).catch(() => {});
      }
    }).catch(() => false);
    return () => { active = false; };
  }, []);

  // Poll Forgot Password approval status while dialog is open in pending state
  useEffect(() => {
    if (!forgotModalOpen || !forgotTicket?.request_id || forgotTicket?.status !== "pending") return undefined;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get("/auth/forgot-password/status", {
          params: { request_id: forgotTicket.request_id }
        });
        if (data?.status && data.status !== forgotTicket.status) {
          setForgotTicket((prev) => (prev ? { ...prev, ...data } : prev));
          if (data.status === "approved") {
            toast.success("Reset password Anda sudah disetujui! Silakan login.");
          } else if (data.status === "rejected") {
            toast.error("Permintaan reset password Anda ditolak oleh Admin.");
          }
        }
      } catch {}
    }, 4000);
    return () => clearInterval(timer);
  }, [forgotModalOpen, forgotTicket?.request_id, forgotTicket?.status]);

  if (session?.user?.user_id) return <Navigate to="/" replace />;

  const handleSignupPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return toast.error("Pilih file gambar untuk foto profil");
    }
    setUploadingPhoto(true);
    try {
      const up = await uploadFile(file);
      if (up?.id) {
        const url = fileUrl(up.id);
        setSignupForm((prev) => ({ ...prev, avatar: url }));
        toast.success("Foto profil berhasil diunggah!");
      }
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setSignupForm((prev) => ({ ...prev, avatar: reader.result }));
          toast.success("Foto profil berhasil dipilih!");
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  // Submit Login
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      return toast.error("Email dan password wajib diisi.");
    }
    setBusyLogin(true);
    setLoginAlert(null);
    try {
      const payload = {
        email: loginEmail,
        password: loginPassword,
        known_accounts: getKnownAccountsFromVault(),
      };
      let res;
      try {
        res = await api.post("/auth/login", payload);
      } catch (firstErr) {
        const st = firstErr?.response?.status;
        if (st === 401 || st === 404) {
          const restored = await attemptAutoHydrateServer(api).catch(() => false);
          if (restored) {
            res = await api.post("/auth/login", payload);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      const { data } = res;
      if (data?.account_vault_entry || data?.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      setSession(data);
      syncWorkspaceMirror(api, true).catch(() => {});
      toast.success("Berhasil masuk ke workspace!");
    } catch (err) {
      const respData = err?.response?.data;
      if (respData?.status === "pending") {
        setLoginAlert(respData.detail || "Akun Anda sedang dalam proses peninjauan & approval oleh Super Admin.");
        toast.warning("Akun Anda sedang menunggu persetujuan Super Admin.");
      } else {
        const message = respData?.detail || errMsg(err, "Gagal masuk");
        setLoginAlert(message);
        toast.error(message);
      }
    } finally {
      setBusyLogin(false);
    }
  };

  const openForgotModal = () => {
    setForgotForm({
      email: loginEmail || "",
      newPassword: "",
      confirmPassword: "",
      note: "",
      recoveryKey: "",
      otpCode: ""
    });
    setShowForgotPw(false);
    setForgotTicket(null);
    setVerifiedEmailToken("");
    setVerifiedGoogleEmail("");
    setOtpSent(false);
    setOtpNotice("");
    setForgotTab("email");
    setForgotModalOpen(true);
  };

  const handleVerifyEmailViaGoogle = async () => {
    setVerifyingGoogleEmail(true);
    try {
      const result = await googleBasicSignIn();
      const userObj = result?.user;
      const gEmail = String(userObj?.email || "").toLowerCase().trim();
      if (!userObj || !gEmail) {
        return toast.error("Gagal mendapatkan email dari verifikasi Google.");
      }
      const idToken = typeof userObj.getIdToken === "function" ? await userObj.getIdToken(true) : "";
      if (!idToken) {
        return toast.error("Token verifikasi email tidak ditemukan.");
      }
      setVerifiedEmailToken(idToken);
      setVerifiedGoogleEmail(gEmail);
      setForgotForm((prev) => ({ ...prev, email: gEmail }));
      toast.success(`Email ${gEmail} berhasil diverifikasi! Silakan isi password baru Anda.`);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/popup-closed-by-user") {
        toast.info("Popup verifikasi email ditutup.");
      } else {
        toast.error(errMsg(err, "Gagal memverifikasi kepemilikan email Google"));
      }
    } finally {
      setVerifyingGoogleEmail(false);
    }
  };

  const handleSendResetOtp = async () => {
    const cleanEmail = forgotForm.email.trim();
    if (!cleanEmail) {
      return toast.error("Masukkan alamat email akun Anda terlebih dahulu.");
    }
    setSendingOtp(true);
    setOtpNotice("");
    try {
      const { data } = await api.post("/auth/forgot-password/send-otp", {
        email: cleanEmail,
        known_accounts: getKnownAccountsFromVault(),
      });
      setOtpSent(true);
      setOtpNotice(data?.detail || `Kode OTP 6 digit telah dikirim ke ${cleanEmail}.`);
      if (data?.smtp_configured === false) {
        toast.info(data.detail);
      } else {
        toast.success(data?.detail || "Kode OTP verifikasi dikirim ke email Anda!");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengirim kode OTP ke email"));
    } finally {
      setSendingOtp(false);
    }
  };

  const handleEmailVerifiedResetSubmit = async (e) => {
    e.preventDefault();
    if (!forgotForm.email.trim() || !forgotForm.newPassword) {
      return toast.error("Email dan password baru wajib diisi.");
    }
    if (forgotForm.newPassword.length < 6) {
      return toast.error("Password baru minimal 6 karakter.");
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      return toast.error("Konfirmasi password tidak cocok.");
    }

    setBusyForgot(true);
    try {
      let data;
      if (verifiedEmailToken && verifiedGoogleEmail === forgotForm.email.trim().toLowerCase()) {
        const res = await api.post("/auth/forgot-password/verify-google", {
          email: forgotForm.email.trim(),
          id_token: verifiedEmailToken,
          new_password: forgotForm.newPassword,
          known_accounts: getKnownAccountsFromVault(),
        });
        data = res.data;
      } else if (forgotForm.otpCode.trim()) {
        const res = await api.post("/auth/forgot-password/verify-otp", {
          email: forgotForm.email.trim(),
          otp_code: forgotForm.otpCode.trim(),
          new_password: forgotForm.newPassword,
          known_accounts: getKnownAccountsFromVault(),
        });
        data = res.data;
      } else {
        setBusyForgot(false);
        return toast.error("Silakan klik Verifikasi Kepemilikan Email atau masukkan Kode OTP 6 digit terlebih dahulu.");
      }

      if (data?.account_vault_entry || data?.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      toast.success(data?.detail || "Password berhasil direset!");
      setLoginEmail(forgotForm.email.trim());
      setLoginPassword("");
      setLoginAlert(null);
      setForgotModalOpen(false);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mereset password melalui verifikasi email"));
    } finally {
      setBusyForgot(false);
    }
  };

  const handleForgotApprovalSubmit = async (e) => {
    e.preventDefault();
    if (!forgotForm.email.trim() || !forgotForm.newPassword) {
      return toast.error("Email dan password baru wajib diisi.");
    }
    if (forgotForm.newPassword.length < 6) {
      return toast.error("Password baru minimal 6 karakter.");
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      return toast.error("Konfirmasi password tidak cocok.");
    }
    setBusyForgot(true);
    try {
      const { data } = await api.post("/auth/forgot-password", {
        email: forgotForm.email.trim(),
        new_password: forgotForm.newPassword,
        note: forgotForm.note.trim()
      });
      setForgotTicket({
        request_id: data.request_id,
        email: forgotForm.email.trim(),
        status: data.status || "pending"
      });
      toast.success(data.detail || "Permintaan reset password berhasil diajukan!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengajukan reset password"));
    } finally {
      setBusyForgot(false);
    }
  };

  const handleCheckForgotStatus = async () => {
    if (!forgotTicket?.request_id && !forgotForm.email.trim()) return;
    setCheckingForgot(true);
    try {
      const { data } = await api.get("/auth/forgot-password/status", {
        params: forgotTicket?.request_id
          ? { request_id: forgotTicket.request_id }
          : { email: forgotForm.email.trim() }
      });
      setForgotTicket((prev) => ({ ...(prev || {}), email: prev?.email || forgotForm.email.trim(), ...data }));
      if (data.status === "approved") {
        toast.success("Reset password sudah disetujui! Silakan login.");
      } else if (data.status === "rejected") {
        toast.error("Permintaan reset password ditolak.");
      } else {
        toast.info("Masih menunggu persetujuan Super Admin / Manajer.");
      }
    } catch (err) {
      toast.error(errMsg(err, "Status belum ditemukan"));
    } finally {
      setCheckingForgot(false);
    }
  };

  const handleRecoveryKeySubmit = async (e) => {
    e.preventDefault();
    if (!forgotForm.email.trim() || !forgotForm.recoveryKey.trim() || !forgotForm.newPassword) {
      return toast.error("Email, Kode Pemulihan, dan password baru wajib diisi.");
    }
    if (forgotForm.newPassword.length < 6) {
      return toast.error("Password baru minimal 6 karakter.");
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      return toast.error("Konfirmasi password tidak cocok.");
    }
    setBusyForgot(true);
    try {
      const { data } = await api.post("/auth/reset-with-recovery-key", {
        email: forgotForm.email.trim(),
        recovery_key: forgotForm.recoveryKey.trim(),
        new_password: forgotForm.newPassword,
        known_accounts: getKnownAccountsFromVault(),
      });
      if (data?.account_vault_entry || data?.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      toast.success(data.detail || "Password berhasil direset!");
      setLoginEmail(forgotForm.email.trim());
      setLoginPassword("");
      setLoginAlert(null);
      setForgotModalOpen(false);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mereset password dengan kode pemulihan"));
    } finally {
      setBusyForgot(false);
    }
  };

  // Submit Signup
  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    if (!signupForm.name.trim() || !signupForm.email.trim() || !signupForm.password) {
      return toast.error("Nama lengkap, email, dan password wajib diisi.");
    }

    if (signupForm.password.length < 6) {
      return toast.error("Password minimal 6 karakter.");
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      return toast.error("Konfirmasi password tidak cocok dengan password yang dimasukkan.");
    }

    setBusySignup(true);
    try {
      const res = await api.post("/auth/register", signupForm);
      if (res.data?.account_vault_entry || res.data?.user) {
        upsertAccountInVault(res.data.account_vault_entry || res.data.user);
      }
      if (res.data?.status === "active" && res.data?.token) {
        setSession(res.data);
        syncWorkspaceMirror(api, true).catch(() => {});
        toast.success(res.data?.detail || "Akun domain perusahaan otomatis aktif! Selamat datang.");
        return;
      }
      setRegisteredData({ ...signupForm });
      setSuccessDialog(true);
      toast.success(res.data?.detail || "Pendaftaran akun berhasil diajukan!");
      const defaultDept = availableDivisions.find((d) => d.toLowerCase() !== "management") || availableDivisions[0] || "Marketing";
      setSignupForm({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        department: defaultDept,
        job_title: "",
        note: "",
        avatar: PRESET_AVATARS[0]
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || errMsg(err, "Pendaftaran gagal"));
    } finally {
      setBusySignup(false);
    }
  };

  const submitGoogleAccount = async (payload) => {
    setBusyGoogle(true);
    const fallbackDept = availableDivisions.find((d) => d.toLowerCase() !== "management") || availableDivisions[0] || "Marketing";
    try {
      const { data } = await api.post("/auth/google", {
        email: payload.email,
        name: payload.name,
        picture: payload.picture || signupForm.avatar,
        department: payload.department || signupForm.department || fallbackDept,
        job_title: payload.job_title || signupForm.job_title || "Anggota Tim",
        mode: payload.mode || mode,
        idToken: payload.idToken || undefined
      });
      setGoogleModalOpen(false);
      if (data?.account_vault_entry || data?.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      if (data?.status === "registered_pending") {
        setRegisteredData({
          name: data.user?.name || payload.name,
          email: data.user?.email || payload.email,
          department: data.user?.department || payload.department || fallbackDept,
          avatar: data.user?.avatar || payload.picture || signupForm.avatar
        });
        setSuccessDialog(true);
        toast.success(data.detail || "Pendaftaran akun Google berhasil diajukan!");
      } else if (data?.user) {
        setManualGoogleAuth(data.user);
        setSession(data);
        syncWorkspaceMirror(api, true).catch(() => {});
        toast.success("Berhasil masuk menggunakan Google!");
      }
    } catch (errPost) {
      const statusResp = errPost?.response?.data?.status;
      if (statusResp === "pending") {
        setGoogleModalOpen(false);
        const msg = errPost?.response?.data?.detail || "Akun Google Anda sedang menunggu persetujuan Super Admin.";
        setLoginAlert(msg);
        toast.warning(msg);
      } else if (statusResp === "unregistered") {
        setGoogleModalOpen(false);
        const msg =
          errPost?.response?.data?.detail ||
          "Email tersebut belum terdaftar. Silakan daftar terlebih dahulu untuk meminta persetujuan Super Admin.";
        setLoginAlert(msg);
        setSignupForm((prev) => ({
          ...prev,
          email: payload.email || prev.email,
          name: payload.name || prev.name,
        }));
        toast.error(msg);
      } else {
        toast.error(errPost?.response?.data?.detail || errMsg(errPost, "Gagal memproses akun Google"));
      }
    } finally {
      setBusyGoogle(false);
    }
  };

  const openGoogleEmailModal = (fallbackReasonCode = "") => {
    const fallbackDept = availableDivisions.find((d) => d.toLowerCase() !== "management") || availableDivisions[0] || "Marketing";
    setGoogleFallbackReason(fallbackReasonCode || "generic");
    setGoogleForm({
      name: signupForm.name || "",
      email: (mode === "login" ? loginEmail : signupForm.email) || loginEmail || "",
      department: signupForm.department || fallbackDept,
      job_title: signupForm.job_title || ""
    });
    setGoogleModalOpen(true);
  };

  // Google Sign-In / Sign-Up
  const google = async () => {
    const fallbackDept = availableDivisions.find((d) => d.toLowerCase() !== "management") || availableDivisions[0] || "Marketing";
    let errReason = "";
    try {
      const res = await googleBasicSignIn();
      if (res?.user?.email) {
        let idToken = null;
        try {
          if (typeof res.user.getIdToken === "function") {
            idToken = await res.user.getIdToken();
          }
        } catch {}
        await submitGoogleAccount({
          email: res.user.email,
          name: res.user.displayName || res.user.email.split("@")[0],
          picture: res.user.photoURL || signupForm.avatar,
          department: signupForm.department || fallbackDept,
          job_title: signupForm.job_title || "Anggota Tim",
          mode,
          idToken
        });
        return;
      }
    } catch (err) {
      errReason = String(err?.code || err?.message || "generic");
    }

    openGoogleEmailModal(errReason);
  };

  return (
    <div className="flex min-h-dvh lg:h-dvh lg:overflow-hidden bg-background p-2.5 sm:p-5">
      <Floating image={brand.login_image_file_id} t={t} />
      <div className="flex flex-1 flex-col items-center justify-start lg:h-full lg:overflow-y-auto scroll-thin px-2.5 py-4 sm:px-4 sm:py-6 lg:max-w-[620px]">
        <div className="my-auto w-full max-w-md py-2 sm:py-4 animate-rise">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink mb-6">
            {mode === "login" ? t("auth_welcome_login", "Selamat Datang Kembali") : t("auth_welcome_signup", "Daftar Akun Baru")}
          </h1>

          {/* Tab Switcher: Masuk vs Daftar Akun */}
          <div className="flex rounded-2xl bg-surface2 p-1.5 border mb-6 shadow-xs" data-testid="auth-tab-group">
            <button
              type="button"
              onClick={() => { setMode("login"); setLoginAlert(null); }}
              className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all cursor-pointer ${
                mode === "login"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-sub hover:text-ink"
              }`}
              data-testid="tab-login"
            >
              {t("auth_login_tab", "Masuk")}
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all cursor-pointer ${
                mode === "signup"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-sub hover:text-ink"
              }`}
              data-testid="tab-signup"
            >
              {t("auth_signup_tab", "Daftar Akun")}
            </button>
          </div>

          {/* URL Status Message if present */}
          {status && (
            <div className="mb-5 rounded-2xl border bg-soft-yellow p-3.5 text-xs text-amber-900 dark:text-amber-100 flex items-start gap-2.5 leading-relaxed" data-testid="login-status-message">
              <ShieldAlert size={17} className="shrink-0 mt-0.5 text-amber-600" />
              <span>
                {status === "pending"
                  ? t("auth_status_pending", STATUS_MSG.pending)
                  : status === "inactive"
                  ? t("auth_status_inactive", STATUS_MSG.inactive)
                  : status === "not_allowed"
                  ? t("auth_status_not_allowed", STATUS_MSG.not_allowed)
                  : (STATUS_MSG[status] || STATUS_MSG.error)}
              </span>
            </div>
          )}

          {/* Alert Message for Login */}
          {loginAlert && (
            <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5 leading-relaxed animate-fadeIn">
              <ShieldAlert size={17} className="shrink-0 mt-0.5 text-amber-600" />
              <span>{loginAlert}</span>
            </div>
          )}

          {/* FORM 1: LOGIN */}
          {mode === "login" && (
            <form onSubmit={handleLoginSubmit} className="space-y-4 animate-fadeIn" data-testid="login-form">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_email_label", "Alamat Email *")}</label>
                <div className="relative flex items-center">
                  <Mail size={16} className="absolute left-3.5 text-sub" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder={t("auth_email_placeholder", "nama@asliri.id atau email perusahaan")}
                    className="h-11 w-full rounded-2xl border bg-surface pl-10 pr-4 text-xs text-ink outline-none transition-colors focus:border-brand"
                    data-testid="login-email-input"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-sub">{t("auth_password_label", "Password *")}</label>
                  <button
                    type="button"
                    onClick={openForgotModal}
                    className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
                    data-testid="login-forgot-password-link"
                  >
                    {t("auth_forgot_password", "Lupa password?")}
                  </button>
                </div>
                <div className="relative flex items-center">
                  <Lock size={16} className="absolute left-3.5 text-sub" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={t("auth_password_placeholder", "Masukkan password")}
                    className="h-11 w-full rounded-2xl border bg-surface pl-10 pr-10 text-xs text-ink outline-none transition-colors focus:border-brand"
                    data-testid="login-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-sub hover:text-ink cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busyLogin}
                className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md transition-all hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
                data-testid="login-submit-btn"
              >
                {busyLogin ? "Memproses..." : t("auth_submit_login", "Masuk ke Workspace")}
                <ArrowRight size={15} />
              </button>
            </form>
          )}

          {/* FORM 2: SIGN UP */}
          {mode === "signup" && (
            <form onSubmit={handleSignupSubmit} className="space-y-4 animate-fadeIn" data-testid="signup-form">
              {/* Avatar selection (6 options + Direct Photo Upload) */}
              <div className="rounded-2xl border bg-surface2 p-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-sub">{t("auth_signup_photo_label", "Foto Profil")}</span>
                  <label className="inline-flex items-center gap-1.5 rounded-xl border bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand transition-colors cursor-pointer shadow-2xs" data-testid="signup-upload-photo-btn">
                    <Upload size={12} />
                    <span>{uploadingPhoto ? "Mengunggah..." : t("auth_signup_upload_btn", "Unggah Foto")}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSignupPhotoUpload}
                      className="hidden"
                      data-testid="signup-upload-photo-input"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    <img
                      src={signupForm.avatar}
                      alt="Selected Avatar"
                      className="h-14 w-14 rounded-full object-cover border-2 border-brand shadow-sm"
                    />
                    <div className="absolute -bottom-0.5 -right-0.5 bg-brand text-white rounded-full p-0.5 shadow-xs">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 sm:gap-2 flex-1">
                    {PRESET_AVATARS.slice(0, 6).map((avUrl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSignupForm({ ...signupForm, avatar: avUrl })}
                        className={`h-8 w-8 sm:h-9 sm:w-9 rounded-full overflow-hidden border-2 transition-transform hover:scale-110 cursor-pointer ${
                          signupForm.avatar === avUrl ? "border-brand ring-2 ring-brand/30 scale-105" : "border-transparent opacity-80 hover:opacity-100"
                        }`}
                        data-testid={`signup-avatar-option-${idx}`}
                      >
                        <img src={avUrl} alt={`Avatar ${idx + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_name_label", "Nama Lengkap *")}</label>
                <div className="relative flex items-center">
                  <User size={16} className="absolute left-3.5 text-sub" />
                  <input
                    type="text"
                    required
                    value={signupForm.name}
                    onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    placeholder={t("auth_name_placeholder", "Contoh: Saeful Hidayat")}
                    className="h-10 w-full rounded-2xl border bg-surface pl-10 pr-4 text-xs text-ink outline-none transition-colors focus:border-brand"
                    data-testid="signup-name-input"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_email_label", "Alamat Email *")}</label>
                <div className="relative flex items-center">
                  <Mail size={16} className="absolute left-3.5 text-sub" />
                  <input
                    type="email"
                    required
                    value={signupForm.email}
                    onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                    placeholder={t("auth_signup_email_placeholder", "email.anda@asliri.id atau domain kantor")}
                    className="h-10 w-full rounded-2xl border bg-surface pl-10 pr-4 text-xs text-ink outline-none transition-colors focus:border-brand"
                    data-testid="signup-email-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_password_label", "Password *")}</label>
                  <div className="relative flex items-center">
                    <Lock size={15} className="absolute left-3 text-sub" />
                    <input
                      type={showSignupPassword ? "text" : "password"}
                      required
                      value={signupForm.password}
                      onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                      placeholder={t("auth_signup_password_placeholder", "Min. 6 karakter")}
                      className="h-10 w-full rounded-2xl border bg-surface pl-9 pr-8 text-xs text-ink outline-none transition-colors focus:border-brand"
                      data-testid="signup-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                      className="absolute right-2.5 text-sub hover:text-ink cursor-pointer"
                    >
                      {showSignupPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_confirm_password_label", "Konfirmasi Password *")}</label>
                  <div className="relative flex items-center">
                    <Lock size={15} className="absolute left-3 text-sub" />
                    <input
                      type={showSignupPassword ? "text" : "password"}
                      required
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                      placeholder={t("auth_signup_confirm_placeholder", "Ulangi")}
                      className="h-10 w-full rounded-2xl border bg-surface pl-9 pr-3 text-xs text-ink outline-none transition-colors focus:border-brand"
                      data-testid="signup-confirmpassword-input"
                    />
                  </div>
                </div>
              </div>
              <PasswordStrengthMeter password={signupForm.password} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_division_label", "Divisi")}</label>
                  <div className="relative flex items-center">
                    <Building2 size={15} className="absolute left-3.5 text-sub pointer-events-none z-10" />
                    <AppSelect
                      value={signupForm.department}
                      onChange={(e) => setSignupForm({ ...signupForm, department: e.target.value })}
                      style={{ paddingLeft: "2.35rem" }}
                      className="h-10 w-full rounded-2xl border bg-surface pr-3 text-xs font-medium text-ink"
                      data-testid="signup-dept-select"
                    >
                      {availableDivisions.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </AppSelect>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_job_label", "Jabatan / Posisi")}</label>
                  <div className="relative flex items-center">
                    <Briefcase size={15} className="absolute left-3 text-sub pointer-events-none" />
                    <input
                      type="text"
                      value={signupForm.job_title}
                      onChange={(e) => setSignupForm({ ...signupForm, job_title: e.target.value })}
                      placeholder={t("auth_job_placeholder", "Mis. Senior Specialist")}
                      className="h-10 w-full rounded-2xl border bg-surface pl-9 pr-3 text-xs text-ink outline-none transition-colors focus:border-brand"
                      data-testid="signup-title-input"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-sub">{t("auth_note_label", "Catatan")}</label>
                <textarea
                  rows={2}
                  value={signupForm.note}
                  onChange={(e) => setSignupForm({ ...signupForm, note: e.target.value })}
                  placeholder={t("auth_note_placeholder", "Keterangan singkat keperluan bergabung...")}
                  className="w-full rounded-2xl border bg-surface p-2.5 text-xs text-ink outline-none focus:border-brand resize-none"
                  data-testid="signup-note-input"
                />
              </div>

              <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                {t("auth_approval_notice", "⚠️ Catatan Approval: Akun yang baru didaftarkan akan berstatus pending dan memerlukan persetujuan dari Super Admin sebelum dapat masuk.")}
              </div>

              <button
                type="submit"
                disabled={busySignup}
                className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md transition-all hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
                data-testid="signup-submit-btn"
              >
                {busySignup ? "Mengirim Pendaftaran..." : t("auth_submit_signup", "Daftar & Minta Approval Super Admin")}
              </button>
            </form>
          )}

          {/* SECONDARY METHODS DIVIDER */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-[1px] flex-1 bg-border" />
            <span className="text-[11px] font-medium text-sub">{t("auth_google_divider", "atau gunakan akun Google")}</span>
            <div className="h-[1px] flex-1 bg-border" />
          </div>

          {/* SECONDARY METHOD: Google Sign-In / Sign-Up */}
          <button
            type="button"
            onClick={google}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-2xl border bg-surface text-xs font-semibold shadow-xs transition-transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
            data-testid="login-google-button"
          >
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            {mode === "signup" ? t("auth_google_signup", "Daftar dengan Akun Google") : t("auth_google_login", "Masuk dengan Akun Google")}
          </button>

          <button
            type="button"
            onClick={() => openGoogleEmailModal(false)}
            className="mt-2 w-full text-center text-[11px] font-semibold text-brand hover:underline cursor-pointer"
            data-testid="login-google-direct-btn"
          >
            {t("auth_google_fallback_link", "Muncul Error 403 / akses diblokir? Masuk langsung dengan Email Kantor / Google")}
          </button>

          <p className="mt-3.5 flex items-center justify-center gap-1.5 text-[11px] text-sub text-center">
            <ShieldCheck size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{t("auth_footer_security_note", "Semua permohonan akun ditinjau langsung oleh Super Admin workspace.")}</span>
          </p>
        </div>
      </div>

      {/* Google Account Quick Sign-In / Sign-Up Modal */}
      <Dialog open={googleModalOpen} onOpenChange={setGoogleModalOpen}>
        <DialogContent className="max-w-md rounded-3xl bg-surface p-6 shadow-xl" data-testid="google-auth-dialog">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border bg-surface2 shadow-xs">
              <svg width="24" height="24" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            </div>
            <DialogTitle className="text-center text-lg font-bold text-ink">
              {mode === "signup" ? "Daftar dengan Akun Google" : "Masuk dengan Akun Google"}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!googleForm.email.trim()) return toast.error("Masukkan alamat email Google Anda");
              submitGoogleAccount({
                email: googleForm.email.trim(),
                name: googleForm.name.trim() || googleForm.email.split("@")[0],
                department: googleForm.department,
                job_title: googleForm.job_title || "Anggota Tim",
                mode
              });
            }}
            className="space-y-3.5 pt-2"
          >
            {googleFallbackReason && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/80 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                {googleFallbackReason.includes("unauthorized-domain") ? (
                  <>
                    Domain <b>{window.location.hostname}</b> belum terdaftar di <b>Authorized Domains</b> Firebase Auth. Masukkan email Anda di bawah untuk sementara agar tetap bisa {mode === "login" ? "masuk" : "mendaftar"} ke workspace.
                  </>
                ) : googleFallbackReason.includes("popup-blocked") ? (
                  <>
                    Popup Google diblokir oleh browser Anda. Izinkan pop-up atau masukkan email Anda di bawah agar tetap bisa {mode === "login" ? "masuk" : "mendaftar"}.
                  </>
                ) : googleFallbackReason.includes("popup-closed-by-user") ? (
                  <>
                    Popup login Google ditutup sebelum selesai. Anda tetap bisa memasukkan email Anda di bawah untuk {mode === "login" ? "masuk" : "mendaftar"} ke workspace.
                  </>
                ) : (
                  <>
                    Popup Google OAuth sedang dibatasi atau gagal (<b>Error 403 / Testing Mode</b>). Masukkan email Anda di bawah agar tetap bisa {mode === "login" ? "masuk" : "mendaftar"} ke workspace.
                  </>
                )}
              </div>
            )}
            <p className="text-center text-xs text-sub leading-relaxed">
              {mode === "login"
                ? "Masukkan email Google Anda untuk langsung masuk ke workspace CIRCLE."
                : "Masukkan email Google dan divisi Anda untuk mendaftarkan akun baru."}
            </p>

            <div>
              <label className="mb-1 block text-xs font-semibold text-sub">Email Google *</label>
              <input
                type="email"
                required
                autoFocus
                value={googleForm.email}
                onChange={(e) => setGoogleForm({ ...googleForm, email: e.target.value })}
                placeholder="nama@gmail.com atau email Google Workspace"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                data-testid="google-modal-email"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-sub">Nama Lengkap</label>
              <input
                type="text"
                value={googleForm.name}
                onChange={(e) => setGoogleForm({ ...googleForm, name: e.target.value })}
                placeholder="Nama sesuai akun Google Anda"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                data-testid="google-modal-name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Divisi</label>
                <AppSelect
                  value={googleForm.department}
                  onChange={(e) => setGoogleForm({ ...googleForm, department: e.target.value })}
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs font-medium text-ink"
                >
                  {availableDivisions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </AppSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Jabatan / Posisi</label>
                <input
                  type="text"
                  value={googleForm.job_title}
                  onChange={(e) => setGoogleForm({ ...googleForm, job_title: e.target.value })}
                  placeholder="Mis. Specialist"
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busyGoogle}
              className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 mt-2"
              data-testid="google-modal-submit"
            >
              {busyGoogle ? "Memproses Akun Google..." : mode === "login" ? "Masuk Sekarang" : "Daftar dengan Akun Google"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Success Registration Dialog */}
      <Dialog open={successDialog} onOpenChange={setSuccessDialog}>
        <DialogContent className="max-w-md rounded-3xl bg-surface p-6 shadow-xl" data-testid="signup-success-dialog">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 size={32} />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-ink">
              {t("auth_signup_success_title", "Pendaftaran Akun Berhasil!")}
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-center space-y-3">
            <p className="text-xs text-sub leading-relaxed max-w-xs mx-auto">
              {t("auth_signup_success_desc", "Permohonan pendaftaran akun Anda telah diterima. Asisten Circle telah meneruskan Approval Card ke Super Admin.")}
            </p>

            {registeredData && (
              <div className="rounded-2xl border bg-surface2 p-3 text-left text-xs space-y-1.5 flex items-center gap-3">
                <Avatar user={{ name: registeredData.name, avatar: registeredData.avatar }} size={42} showStatus={false} />
                <div className="min-w-0 flex-1">
                  <p><span className="text-sub font-medium">Nama:</span> <b className="text-ink">{registeredData.name}</b></p>
                  <p><span className="text-sub font-medium">Email:</span> <b className="text-ink">{registeredData.email}</b></p>
                  <p><span className="text-sub font-medium">Divisi:</span> <b className="text-ink">{registeredData.department}</b></p>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setSuccessDialog(false);
                setMode("login");
                if (registeredData?.email) {
                  setLoginEmail(registeredData.email);
                }
              }}
              className="btn-accent h-10 w-full rounded-full text-xs font-semibold cursor-pointer"
              data-testid="signup-done-btn"
            >
              Kembali ke Halaman Masuk
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotModalOpen} onOpenChange={setForgotModalOpen}>
        <DialogContent className="max-w-md rounded-3xl bg-surface p-6 shadow-xl" data-testid="forgot-password-dialog">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <KeyRound size={22} />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-ink">
              {t("auth_forgot_title", "Reset & Pemulihan Password")}
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-sub">
              {t("auth_forgot_subtitle", "Verifikasi kepemilikan email Anda untuk reset langsung, atau ajukan ke Admin.")}
            </DialogDescription>
          </DialogHeader>

          {/* Method Switcher */}
          {!forgotTicket && (
            <div className="grid grid-cols-3 rounded-2xl bg-surface2 p-1 border my-1 gap-1">
              <button
                type="button"
                onClick={() => setForgotTab("email")}
                className={`rounded-xl py-2 px-2 text-[11px] font-bold transition-all cursor-pointer ${
                  forgotTab === "email" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
                }`}
                data-testid="forgot-tab-email"
              >
                Verifikasi Email
              </button>
              <button
                type="button"
                onClick={() => setForgotTab("approval")}
                className={`rounded-xl py-2 px-2 text-[11px] font-bold transition-all cursor-pointer ${
                  forgotTab === "approval" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
                }`}
                data-testid="forgot-tab-approval"
              >
                Approval Admin
              </button>
              <button
                type="button"
                onClick={() => setForgotTab("recovery")}
                className={`rounded-xl py-2 px-2 text-[11px] font-bold transition-all cursor-pointer ${
                  forgotTab === "recovery" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
                }`}
                data-testid="forgot-tab-recovery"
              >
                Kode Pemulihan
              </button>
            </div>
          )}

          {/* Ticket Status Screen */}
          {forgotTicket ? (
            <div className="space-y-4 pt-2" data-testid="forgot-ticket-status">
              <div className={`rounded-2xl border p-4 text-center space-y-2 ${
                forgotTicket.status === "approved"
                  ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                  : forgotTicket.status === "rejected"
                  ? "border-rose-200 bg-rose-50/70 dark:border-rose-800/60 dark:bg-rose-950/30"
                  : "border-amber-200 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30"
              }`}>
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-xs">
                  {forgotTicket.status === "approved" ? (
                    <CheckCircle2 size={24} className="text-emerald-600" />
                  ) : forgotTicket.status === "rejected" ? (
                    <XCircle size={24} className="text-rose-600" />
                  ) : (
                    <Clock size={24} className="text-amber-600" />
                  )}
                </div>
                <h4 className="text-sm font-bold text-ink">
                  {forgotTicket.status === "approved"
                    ? "Password Berhasil Direset!"
                    : forgotTicket.status === "rejected"
                    ? "Permintaan Reset Ditolak"
                    : "Menunggu Persetujuan Admin"}
                </h4>
                <p className="text-xs text-sub leading-relaxed">
                  {forgotTicket.status === "approved"
                    ? `Disetujui oleh ${forgotTicket.approved_by || "Super Admin"}. Anda sekarang bisa masuk dengan password baru Anda.`
                    : forgotTicket.status === "rejected"
                    ? `Ditolak oleh ${forgotTicket.rejected_by || "Super Admin"}. Silakan hubungi Admin workspace atau ajukan ulang.`
                    : `Asisten Circle telah mengirim Approval Card untuk ${forgotTicket.email} ke Super Admin / Manajer Divisi.`}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                {forgotTicket.status === "pending" && (
                  <button
                    type="button"
                    onClick={handleCheckForgotStatus}
                    disabled={checkingForgot}
                    className="h-10 w-full rounded-2xl border bg-surface2 hover:bg-surface text-xs font-bold text-ink flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    data-testid="forgot-check-status-btn"
                  >
                    <RefreshCw size={14} className={checkingForgot ? "animate-spin" : ""} />
                    {checkingForgot ? "Memeriksa..." : "Cek Status Approval Sekarang"}
                  </button>
                )}

                {forgotTicket.status === "approved" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLoginEmail(forgotTicket.email || forgotForm.email);
                      setLoginPassword("");
                      setLoginAlert(null);
                      setForgotModalOpen(false);
                    }}
                    className="btn-accent h-11 w-full rounded-2xl text-xs font-bold cursor-pointer"
                    data-testid="forgot-go-login-btn"
                  >
                    Masuk dengan Password Baru
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setForgotTicket(null)}
                    className="h-10 w-full rounded-2xl text-xs font-semibold text-sub hover:text-ink cursor-pointer"
                  >
                    {forgotTicket.status === "rejected" ? "Ajukan Ulang Reset Password" : "Ubah Metode Reset"}
                  </button>
                )}
              </div>
            </div>
          ) : forgotTab === "email" ? (
            <form onSubmit={handleEmailVerifiedResetSubmit} className="space-y-3 pt-1" data-testid="forgot-email-verify-form">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Email Akun Anda *</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={forgotForm.email}
                    onChange={(e) => {
                      setForgotForm({ ...forgotForm, email: e.target.value });
                      if (verifiedGoogleEmail && e.target.value.trim().toLowerCase() !== verifiedGoogleEmail) {
                        setVerifiedEmailToken("");
                        setVerifiedGoogleEmail("");
                      }
                    }}
                    placeholder="nama@asliri.id"
                    className="h-10 flex-1 rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                    data-testid="forgot-verify-email-input"
                  />
                  <button
                    type="button"
                    onClick={handleSendResetOtp}
                    disabled={sendingOtp || !forgotForm.email.trim()}
                    className="h-10 shrink-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-surface hover:bg-surface2 px-3 text-[11px] font-bold text-ink disabled:opacity-50 cursor-pointer"
                    data-testid="forgot-send-otp-btn"
                  >
                    {sendingOtp ? "Mengirim..." : otpSent ? "Kirim Ulang OTP" : "Kirim OTP Email"}
                  </button>
                </div>
              </div>

              {/* Instant Google Email Verification Card */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-ink">
                    1. Verifikasi Instan Kepemilikan Email
                  </span>
                  {verifiedEmailToken && verifiedGoogleEmail === forgotForm.email.trim().toLowerCase() && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                      <Check size={11} /> Terverifikasi
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleVerifyEmailViaGoogle}
                  disabled={verifyingGoogleEmail}
                  className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition-all cursor-pointer ${
                    verifiedEmailToken && verifiedGoogleEmail === forgotForm.email.trim().toLowerCase()
                      ? "border-emerald-300 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-surface hover:bg-surface2 text-ink shadow-2xs"
                  }`}
                  data-testid="forgot-verify-google-btn"
                >
                  <Mail size={14} className="text-brand" />
                  <span>
                    {verifyingGoogleEmail
                      ? "Memverifikasi Email..."
                      : verifiedEmailToken && verifiedGoogleEmail === forgotForm.email.trim().toLowerCase()
                      ? `Terverifikasi: ${verifiedGoogleEmail}`
                      : "Verifikasi Kepemilikan Email (Google)"}
                  </span>
                </button>
              </div>

              {/* Optional 6-digit OTP Input */}
              {(otpSent || !verifiedEmailToken) && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">
                    2. Atau Masukkan Kode OTP 6 Digit dari Email
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={forgotForm.otpCode}
                    onChange={(e) => setForgotForm({ ...forgotForm, otpCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    placeholder="Contoh: 482910"
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 font-mono text-xs tracking-widest text-ink outline-none focus:border-brand"
                    data-testid="forgot-otp-input"
                  />
                  {otpNotice && (
                    <p className="mt-1 text-[11px] text-sub leading-relaxed">{otpNotice}</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Password Baru *</label>
                  <div className="relative flex items-center">
                    <input
                      type={showForgotPw ? "text" : "password"}
                      required
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm({ ...forgotForm, newPassword: e.target.value })}
                      placeholder="Min. 6 karakter"
                      className="h-10 w-full rounded-xl border bg-surface2 pl-3 pr-8 text-xs text-ink outline-none focus:border-brand"
                      data-testid="forgot-email-newpw-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotPw(!showForgotPw)}
                      className="absolute right-2.5 text-sub hover:text-ink cursor-pointer"
                    >
                      {showForgotPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Konfirmasi *</label>
                  <input
                    type={showForgotPw ? "text" : "password"}
                    required
                    value={forgotForm.confirmPassword}
                    onChange={(e) => setForgotForm({ ...forgotForm, confirmPassword: e.target.value })}
                    placeholder="Ulangi password"
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                    data-testid="forgot-email-confirmpw-input"
                  />
                </div>
              </div>
              <PasswordStrengthMeter password={forgotForm.newPassword} />

              <button
                type="submit"
                disabled={busyForgot}
                className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer"
                data-testid="forgot-email-reset-submit-btn"
              >
                {busyForgot ? "Memverifikasi & Mereset..." : "Verifikasi & Reset Password Sekarang"}
              </button>
            </form>
          ) : forgotTab === "approval" ? (
            <form onSubmit={handleForgotApprovalSubmit} className="space-y-3 pt-1" data-testid="forgot-approval-form">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Email Akun Anda *</label>
                <input
                  type="email"
                  required
                  value={forgotForm.email}
                  onChange={(e) => setForgotForm({ ...forgotForm, email: e.target.value })}
                  placeholder="nama@asliri.id"
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                  data-testid="forgot-email-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Password Baru *</label>
                  <div className="relative flex items-center">
                    <input
                      type={showForgotPw ? "text" : "password"}
                      required
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm({ ...forgotForm, newPassword: e.target.value })}
                      placeholder="Min. 6 karakter"
                      className="h-10 w-full rounded-xl border bg-surface2 pl-3 pr-8 text-xs text-ink outline-none focus:border-brand"
                      data-testid="forgot-newpw-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotPw(!showForgotPw)}
                      className="absolute right-2.5 text-sub hover:text-ink cursor-pointer"
                    >
                      {showForgotPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Konfirmasi *</label>
                  <input
                    type={showForgotPw ? "text" : "password"}
                    required
                    value={forgotForm.confirmPassword}
                    onChange={(e) => setForgotForm({ ...forgotForm, confirmPassword: e.target.value })}
                    placeholder="Ulangi password"
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                    data-testid="forgot-confirmpw-input"
                  />
                </div>
              </div>
              <PasswordStrengthMeter password={forgotForm.newPassword} />

              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Catatan untuk Admin</label>
                <input
                  type="text"
                  value={forgotForm.note}
                  onChange={(e) => setForgotForm({ ...forgotForm, note: e.target.value })}
                  placeholder="Mis. Lupa password setelah ganti perangkat"
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                />
              </div>

              <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                Asisten <b>Circle</b> akan mengirim kartu persetujuan ke Super Admin / Manajer Divisi Anda. Setelah disetujui, password baru langsung aktif.
              </div>

              <button
                type="submit"
                disabled={busyForgot}
                className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer"
                data-testid="forgot-submit-btn"
              >
                {busyForgot ? "Mengirim Permintaan..." : "Ajukan Reset Password"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRecoveryKeySubmit} className="space-y-3 pt-1" data-testid="forgot-recovery-form">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Email Akun Anda *</label>
                <input
                  type="email"
                  required
                  value={forgotForm.email}
                  onChange={(e) => setForgotForm({ ...forgotForm, email: e.target.value })}
                  placeholder="nama@asliri.id"
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                  data-testid="recovery-email-input"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">Kode Pemulihan Workspace *</label>
                <input
                  type="text"
                  required
                  value={forgotForm.recoveryKey}
                  onChange={(e) => setForgotForm({ ...forgotForm, recoveryKey: e.target.value.toUpperCase() })}
                  placeholder="CRCL-XXXX-XXXX"
                  className="h-10 w-full rounded-xl border bg-surface2 px-3 font-mono text-xs uppercase tracking-wider text-ink outline-none focus:border-brand"
                  data-testid="recovery-key-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Password Baru *</label>
                  <div className="relative flex items-center">
                    <input
                      type={showForgotPw ? "text" : "password"}
                      required
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm({ ...forgotForm, newPassword: e.target.value })}
                      placeholder="Min. 6 karakter"
                      className="h-10 w-full rounded-xl border bg-surface2 pl-3 pr-8 text-xs text-ink outline-none focus:border-brand"
                      data-testid="recovery-newpw-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotPw(!showForgotPw)}
                      className="absolute right-2.5 text-sub hover:text-ink cursor-pointer"
                    >
                      {showForgotPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-sub">Konfirmasi *</label>
                  <input
                    type={showForgotPw ? "text" : "password"}
                    required
                    value={forgotForm.confirmPassword}
                    onChange={(e) => setForgotForm({ ...forgotForm, confirmPassword: e.target.value })}
                    placeholder="Ulangi password"
                    className="h-10 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                    data-testid="recovery-confirmpw-input"
                  />
                </div>
              </div>
              <PasswordStrengthMeter password={forgotForm.newPassword} />

              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/70 dark:bg-indigo-950/30 p-2.5 text-[11px] text-indigo-900 dark:text-indigo-200 leading-relaxed">
                Kode Pemulihan Workspace tersedia di <b>Pengaturan → Tim, Divisi & Akses</b> milik Super Admin. Cocok untuk reset darurat tanpa menunggu approval.
              </div>

              <button
                type="submit"
                disabled={busyForgot}
                className="btn-accent h-11 w-full rounded-2xl text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer"
                data-testid="recovery-submit-btn"
              >
                {busyForgot ? "Mereset Password..." : "Reset Password Sekarang"}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
