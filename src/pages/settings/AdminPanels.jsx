import { useEffect, useRef, useState } from "react";
import { Trash2, Plus, ArrowUp, ArrowDown, Upload, KeyRound, Eye, EyeOff, RefreshCw, Copy, Check, ShieldCheck, Zap, Webhook, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { api, errMsg, uploadFile, fileUrl } from "../../lib/api";
import { DEFAULT_COPYWRITING, LOGIN_COPYWRITING_SECTIONS, cleanCopywritingMap } from "../../lib/i18n";
import { Avatar, LabelChip, ROLE_NAMES, rel, Logo, Spinner } from "../../components/common";
import { Switch } from "../../components/ui/switch";
import { AppSelect, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { ItemChip, DEFAULT_ITEM_TYPES, isDarkHex } from "../tasks/fields";
import { PasswordStrengthMeter } from "../../components/PasswordStrengthMeter";
import {
  getCachedMarketplaceStats,
  setCachedMarketplaceStats,
  getCachedGatewayInfo,
  setCachedGatewayInfo,
  DEFAULT_MARKETPLACE_COPYWRITING,
  prefetchMarketplaceState,
  reconcileMarketplaceEnabledCache,
} from "../marketplace/marketplaceStore";
import { syncWorkspaceMirror } from "../../lib/persistentMirror";
import { googleGmailOAuthSignIn, getGmailAccessToken, clearGmailAuth } from "../../lib/auth";
import {
  BANNER_IMAGE_PRESETS,
  BANNER_OVERLAY_STYLES,
  resolveMarketplaceBannerImage,
  resolveMarketplaceBannerOverlay,
} from "../marketplace/catalogAssets";

const inp = "h-10 rounded-xl border bg-surface2 px-3 text-sm outline-none";
const run = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); return true; } catch (e) { toast.error(errMsg(e)); return false; } };
export const Card = ({ title, children, testid }) => <section className="card p-4 sm:p-5" data-testid={testid}><h3 className="mb-3.5 sm:mb-4 font-bold">{title}</h3>{children}</section>;

const INITIAL_ADMIN_STATS = {
  total_employees: 5,
  active_employees: 4,
  pending_employees: 1,
  departments: 4,
  groups: 1,
  active_projects: 1,
  open_tasks: 1,
  overdue_tasks: 0
};

const INITIAL_AUDIT_LOGS = [
  { id: "log_1", actor_name: "Admin ASLI RI", action: "memperbarui konfigurasi workspace identity & logo portal", created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: "log_2", actor_name: "Admin ASLI RI", action: "menghubungkan integrasi Google Workspace (Calendar & Meet)", created_at: new Date(Date.now() - 28800000).toISOString() },
  { id: "log_3", actor_name: "Siti Rahma", action: "menyetujui approval final (2/2) pada tugas TSK-002", created_at: new Date(Date.now() - 64800000).toISOString() },
  { id: "log_4", actor_name: "Budi Santoso", action: "menyelesaikan checkpoint 'Audit stats endpoint' pada tugas TSK-002", created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: "log_5", actor_name: "Admin ASLI RI", action: "menerima permohonan bergabung karyawan baru Dian Pratama", created_at: new Date(Date.now() - 172800000).toISOString() }
];

let ADMIN_STATS_CACHE = null;
let AUDIT_LOGS_CACHE = null;
let USERS_CACHE = null;
let INVITES_CACHE = null;
let ACCESS_REQ_CACHE = null;
let DIVISIONS_CACHE = null;
let STICKERS_CACHE = null;

try {
  const sStats = localStorage.getItem("circle_admin_stats");
  if (sStats) ADMIN_STATS_CACHE = JSON.parse(sStats);
  const sAudit = localStorage.getItem("circle_admin_audit");
  if (sAudit) AUDIT_LOGS_CACHE = JSON.parse(sAudit);
  const sUsers = localStorage.getItem("circle_admin_users");
  if (sUsers) USERS_CACHE = JSON.parse(sUsers);
  const sInvites = localStorage.getItem("circle_admin_invites");
  if (sInvites) INVITES_CACHE = JSON.parse(sInvites);
  const sAccess = localStorage.getItem("circle_admin_access_reqs");
  if (sAccess) ACCESS_REQ_CACHE = JSON.parse(sAccess);
  const sDivs = localStorage.getItem("circle_admin_divisions");
  if (sDivs) DIVISIONS_CACHE = JSON.parse(sDivs);
  const sStickers = localStorage.getItem("circle_admin_stickers_data");
  if (sStickers) STICKERS_CACHE = JSON.parse(sStickers);
} catch (e) {
  console.warn("Failed to load admin cache", e);
}

export function AdminOverview() {
  const [s, setS] = useState(ADMIN_STATS_CACHE || INITIAL_ADMIN_STATS);
  const [logs, setLogs] = useState(AUDIT_LOGS_CACHE || INITIAL_AUDIT_LOGS);
  const [loading, setLoading] = useState(!ADMIN_STATS_CACHE);
  const { userMap } = useApp();

  useEffect(() => {
    api.get("/admin/stats").then((r) => { 
      if (r.data) { 
        ADMIN_STATS_CACHE = r.data; 
        setS(r.data); 
        localStorage.setItem("circle_admin_stats", JSON.stringify(r.data));
      } 
    }).catch(() => {});
    api.get("/admin/audit").then((r) => { 
      if (Array.isArray(r.data) && r.data.length > 0) { 
        AUDIT_LOGS_CACHE = r.data; 
        setLogs(r.data); 
        localStorage.setItem("circle_admin_audit", JSON.stringify(r.data));
      } 
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const stats = s ? [
    ["Total Karyawan", s.total_employees],
    ["Aktif", s.active_employees],
    ["Menunggu Persetujuan", s.pending_employees],
    ["Divisi", s.departments],
    ["Grup", s.groups],
    ["Proyek Aktif", s.active_projects],
    ["Tugas Terbuka", s.open_tasks],
    ["Tugas Overdue", s.overdue_tasks]
  ] : [];

  return (
    <div className="space-y-5 animate-crossfade">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="admin-stats">
        {stats.map(([l, v], i) => (
          <div
            key={l}
            className={`rounded-2xl sm:rounded-3xl p-3.5 sm:p-4 transition-all duration-200 hover:shadow-sm ${
              ["bg-soft-red", "bg-soft-blue", "bg-soft-yellow", "bg-soft-purple", "bg-soft-green"][i % 5]
            }`}
          >
            <p className="text-xs font-semibold text-sub">{l}</p>
            <p className="mt-2 text-3xl font-bold text-ink">{v}</p>
          </div>
        ))}
      </div>

      <Card title="Aktivitas Workspace Terbaru" testid="audit-log">
        <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {logs.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
              <Avatar user={userMap[l.actor_id] || { name: l.actor_name }} size={24} showStatus={false} />
              <span className="font-bold text-ink">{l.actor_name}</span>
              <span className="text-sub truncate min-w-0 flex-1">{l.action}</span>
              <span className="ml-auto text-[11px] text-sub shrink-0">{rel(l.created_at)}</span>
            </li>
          ))}
          {!logs.length && <li className="text-sm text-sub">Belum ada aktivitas admin.</li>}
        </ul>
      </Card>
    </div>
  );
}

export function PeopleAccess() {
  const { me, ws, users: appUsers, reloadWs, reloadUsers, subscribe } = useApp();
  const [users, setUsers] = useState(() => USERS_CACHE || appUsers || []);
  const [invites, setInvites] = useState(INVITES_CACHE || []);
  const [accessRequests, setAccessRequests] = useState(ACCESS_REQ_CACHE || []);
  const [loading, setLoading] = useState(false);
  const [reqFilter, setReqFilter] = useState("all");
  const [inv, setInv] = useState({ email: "", role: "employee" });
  const formatDomains = (raw) => {
    if (Array.isArray(raw) && raw.length > 0) return raw.join(", ");
    if (typeof raw === "string" && raw.trim()) return raw;
    return "asliri.id";
  };
  const [domains, setDomains] = useState(formatDomains(ws?.allowed_domains));
  useEffect(() => {
    setDomains(formatDomains(ws?.allowed_domains));
  }, [ws?.allowed_domains]);
  const [busyAction, setBusyAction] = useState(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Admin Reset Password modal & Recovery Key state
  const [resetPwUser, setResetPwUser] = useState(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [busyResetPw, setBusyResetPw] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [copiedRecoveryKey, setCopiedRecoveryKey] = useState(false);
  const [busyRecoveryKey, setBusyRecoveryKey] = useState(false);

  const isTopAdmin = me?.role === "super_admin" || me?.role === "workspace_admin";

  const handleDeleteClick = (userToDelete) => {
    if (userToDelete.user_id === me?.user_id) {
      toast.error("Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.");
      return;
    }
    setDeleteTargetUser(userToDelete);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetUser) return;
    setIsDeleting(true);
    try {
      const res = await api.delete(`/admin/users/${deleteTargetUser.user_id}`);
      const selfIsApprover =
        isTopAdmin ||
        (me?.role === "department_manager" &&
          (me?.department === deleteTargetUser.department || me?.department === "General"));
      if (res.data?.pending_approval) {
        if (!selfIsApprover) {
          toast.success(res.data.detail || `Permohonan hapus ${deleteTargetUser.name} diajukan ke Manajer Divisi.`);
        }
      } else {
        toast.success(res.data?.message || `Karyawan ${deleteTargetUser.name} berhasil dihapus.`);
      }
      setDeleteTargetUser(null);
      load();
      reloadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setIsDeleting(false);
    }
  };

  const load = () => {
    api.get("/admin/users").then((r) => { 
      USERS_CACHE = r.data; 
      setUsers(r.data); 
      localStorage.setItem("circle_admin_users", JSON.stringify(r.data));
    }).catch(() => {});
    api.get("/admin/invitations").then((r) => { 
      INVITES_CACHE = r.data; 
      setInvites(r.data); 
      localStorage.setItem("circle_admin_invites", JSON.stringify(r.data));
    }).catch(() => {});
    api.get("/admin/access-requests").then((r) => { 
      ACCESS_REQ_CACHE = r.data; 
      setAccessRequests(r.data); 
      localStorage.setItem("circle_admin_access_reqs", JSON.stringify(r.data));
    }).catch(() => {}).finally(() => setLoading(false));
    if (isTopAdmin) {
      api.get("/admin/recovery-key").then((r) => {
        if (r.data?.recovery_key) setRecoveryKey(r.data.recovery_key);
      }).catch(() => {});
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    return subscribe((e) => {
      if (e.type === "access_requests:changed" || e.type === "users:changed") {
        load();
      }
    });
  }, [subscribe]);

  const upd = (uid, body) => run(() => api.patch(`/admin/users/${uid}`, body), "Data anggota diperbarui").then(() => { load(); reloadUsers(); });

  const approveRequest = async (id, role, department, reqType) => {
    setBusyAction(id);
    try {
      await api.post(
        `/admin/access-requests/${id}/approve`,
        reqType === "password_reset" || reqType === "delete_user" ? {} : { role, department }
      );
      toast.success(
        reqType === "password_reset"
          ? "Permintaan reset password disetujui! Password baru sekarang aktif."
          : reqType === "delete_user"
          ? "Permohonan hapus karyawan disetujui."
          : "Permintaan akses berhasil disetujui! Akun sekarang aktif."
      );
      load();
      reloadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyAction(null);
    }
  };

  const rejectRequest = async (id) => {
    setBusyAction(id);
    try {
      await api.post(`/admin/access-requests/${id}/reject`);
      toast.info("Permintaan telah ditolak.");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyAction(null);
    }
  };

  const openResetPwModal = (targetUser) => {
    setResetPwUser(targetUser);
    setResetPwValue("");
    setShowResetPw(true);
  };

  const generateRandomPassword = () => {
    const num = Math.floor(1000 + Math.random() * 9000);
    setResetPwValue(`AsliRi#${num}`);
    setShowResetPw(true);
  };

  const handleConfirmResetPw = async (e) => {
    if (e) e.preventDefault();
    if (!resetPwUser) return;
    if (!resetPwValue || resetPwValue.length < 6) {
      return toast.error("Password baru minimal 6 karakter.");
    }
    setBusyResetPw(true);
    try {
      const { data } = await api.post(`/admin/users/${resetPwUser.user_id}/reset-password`, {
        new_password: resetPwValue
      });
      toast.success(data?.detail || `Password untuk ${resetPwUser.name} berhasil direset!`);
      setResetPwUser(null);
      setResetPwValue("");
      load();
      reloadUsers();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mereset password"));
    } finally {
      setBusyResetPw(false);
    }
  };

  const handleCopyRecoveryKey = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopiedRecoveryKey(true);
      toast.success("Kode Pemulihan Workspace disalin!");
      setTimeout(() => setCopiedRecoveryKey(false), 2000);
    } catch {
      toast.info(`Kode Pemulihan: ${recoveryKey}`);
    }
  };

  const handleRegenerateRecoveryKey = async () => {
    setBusyRecoveryKey(true);
    try {
      const { data } = await api.post("/admin/recovery-key/regenerate");
      if (data?.recovery_key) setRecoveryKey(data.recovery_key);
      setShowRecoveryKey(true);
      toast.success(data?.detail || "Kode Pemulihan baru berhasil dibuat!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal membuat ulang kode pemulihan"));
    } finally {
      setBusyRecoveryKey(false);
    }
  };

  const pendingCount = accessRequests.filter((r) => r.status === "pending").length;
  const filteredRequests = accessRequests.filter((r) => {
    if (reqFilter === "pending") return r.status === "pending";
    if (reqFilter === "approved") return r.status === "approved";
    if (reqFilter === "rejected") return r.status === "rejected";
    return true;
  });

  return (
    <div className="space-y-5 animate-crossfade">
      {/* 1. Access Requests & Password Resets from "Circle" Assistant */}
      <Card title="Permintaan Akses & Reset Password" testid="access-requests-card">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <p className="text-xs text-sub leading-relaxed max-w-md">
              Permintaan akses masuk karyawan baru dan permohonan <b>reset lupa password</b> diteruskan melalui Asisten <b className="text-ink">"Circle"</b> berupa Approval Card.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReqFilter("all")}
                className={`h-10 rounded-2xl px-4 text-sm font-semibold transition-colors cursor-pointer ${
                  reqFilter === "all" ? "bg-brand text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"
                }`}
              >
                Semua · {accessRequests.length}
              </button>
              <button
                type="button"
                onClick={() => setReqFilter("pending")}
                className={`h-10 rounded-2xl px-4 text-sm font-semibold transition-colors cursor-pointer ${
                  reqFilter === "pending" ? "bg-amber-500 text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"
                }`}
              >
                Menunggu · {pendingCount}
              </button>
              <button
                type="button"
                onClick={() => setReqFilter("approved")}
                className={`h-10 rounded-2xl px-4 text-sm font-semibold transition-colors cursor-pointer ${
                  reqFilter === "approved" ? "bg-emerald-600 text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"
                }`}
              >
                Disetujui
              </button>
              <button
                type="button"
                onClick={() => setReqFilter("rejected")}
                className={`h-10 rounded-2xl px-4 text-sm font-semibold transition-colors cursor-pointer ${
                  reqFilter === "rejected" ? "bg-rose-500 text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"
                }`}
              >
                Ditolak
              </button>
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="py-6 text-center text-xs text-sub">
              {reqFilter === "pending"
                ? "Tidak ada permintaan akses yang sedang menunggu persetujuan."
                : "Belum ada riwayat permohonan akses masuk."}
            </div>
          ) : (
            <div className="divide-y">
              {filteredRequests.map((r) => {
                const isPending = r.status === "pending";
                const isApproved = r.status === "approved";
                const isRejected = r.status === "rejected";
                return (
                  <div key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs" data-testid={`req-row-${r.id}`}>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-ink">{r.name}</span>
                        {r.type === "password_reset" && (
                          <span className="rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 px-2 py-0.5 text-[10px] font-bold">
                            🔑 Reset Password
                          </span>
                        )}
                        {r.type === "delete_user" && (
                          <span className="rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 px-2 py-0.5 text-[10px] font-bold">
                            Hapus Akun
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isApproved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : isRejected
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}>
                          {isApproved ? "Disetujui" : isRejected ? "Ditolak" : "Menunggu"}
                        </span>
                      </div>
                      <p className="text-sub truncate">{r.email}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-sub pt-0.5">
                        <span className="font-medium text-ink">Divisi: <b className="text-brand">{r.department}</b></span>
                        <span>·</span>
                        <span>Jabatan: {r.job_title}</span>
                        {r.note && r.note !== "-" && (
                          <>
                            <span>·</span>
                            <span className="italic truncate max-w-xs">"{r.note}"</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                      {isPending ? (
                        <>
                          <button
                            disabled={busyAction === r.id}
                            onClick={() => approveRequest(r.id, "employee", r.department, r.type)}
                            className={`rounded-full px-3 py-1.5 font-bold text-white shadow-2xs transition-colors disabled:opacity-50 ${
                              r.type === "password_reset" ? "bg-indigo-600 hover:bg-indigo-700" : "bg-emerald-600 hover:bg-emerald-700"
                            }`}
                            data-testid={`admin-approve-req-${r.id}`}
                          >
                            {r.type === "password_reset" ? "Setujui Reset" : "Setujui"}
                          </button>
                          <button
                            disabled={busyAction === r.id}
                            onClick={() => rejectRequest(r.id)}
                            className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 transition-colors disabled:opacity-50"
                            data-testid={`admin-reject-req-${r.id}`}
                          >
                            Tolak
                          </button>
                        </>
                      ) : (
                        <div className="text-[11px] text-sub text-right">
                          {isApproved ? `Disetujui oleh ${r.approved_by || "Admin"}` : `Ditolak oleh ${r.rejected_by || "Admin"}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card title="Akses Masuk Workspace" testid="access-settings">
        <label className="block text-xs font-semibold text-sub">
          Domain email perusahaan (otomatis masuk tanpa persetujuan, pisahkan dengan koma)
          <input
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="Contoh: asliri.id, company.co.id"
            className={`${inp} mt-1 w-full`}
            data-testid="allowed-domains-input"
          />
        </label>
        <label className="mt-3 flex items-center justify-between text-sm">Akun dengan domain perusahaan otomatis bergabung<Switch checked={ws.auto_join_domain !== false} onCheckedChange={(v) => run(() => api.patch("/workspace", { auto_join_domain: v })).then(reloadWs)} data-testid="auto-join-switch" /></label>
        <label className="mt-3 flex items-center justify-between text-sm">Akun di luar domain masuk antrean persetujuan<Switch checked={ws.require_approval !== false} onCheckedChange={(v) => run(() => api.patch("/workspace", { require_approval: v })).then(reloadWs)} data-testid="require-approval-switch" /></label>
        <button type="button" onClick={() => run(() => api.patch("/workspace", { allowed_domains: String(domains || "").split(",").map((x) => x.trim().replace(/^@/, "")).filter(Boolean) }), "Domain berhasil disimpan!").then(reloadWs)} className="btn-accent mt-3 h-10 px-4 text-sm font-semibold" data-testid="save-domains-btn">Simpan Domain</button>
      </Card>

      <Card title="Undang Anggota Baru" testid="invite-card">
        <div className="flex flex-wrap gap-2"><input value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="nama@perusahaan.com" className={`${inp} min-w-[200px] flex-1`} data-testid="invite-email-input" />
          <AppSelect value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} className={`${inp} font-medium`} data-testid="invite-role-select">{Object.entries(ROLE_NAMES).filter(([k]) => me?.role === "super_admin" || !["super_admin", "workspace_admin"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</AppSelect>
          <button onClick={() => run(() => api.post("/admin/invitations", inv), "Undangan tersimpan — rekan tim dapat langsung masuk dengan Google").then((ok) => { if (ok) { setInv({ email: "", role: "employee" }); load(); } })} className="btn-accent h-10 px-4 text-sm font-semibold" data-testid="invite-submit-btn">Undang</button></div>
        <ul className="mt-3 space-y-1">{invites.map((i) => <li key={i.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{i.email}</span><span className="text-xs text-sub">{ROLE_NAMES[i.role] || i.role} · {i.used ? "bergabung" : "menunggu"}</span><button onClick={() => run(() => api.delete(`/admin/invitations/${i.id}`)).then(load)} className="text-sub" aria-label="Hapus undangan"><Trash2 size={14} /></button></li>)}</ul>
      </Card>

      <Card title="Tim, Divisi & Akses" testid="users-admin">
        <div className="divide-y">
          {users
            .filter((u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant")
            .map((u) => {
              const allDivs = Array.from(
                new Set([
                  ...(ws?.divisions || []),
                  "Management",
                  "Engineering",
                  "Product",
                  "Design",
                  "Marketing",
                  "Sales",
                  "IT",
                  "Finance",
                  "Legal",
                  "HRGA",
                  "Operations",
                  u.department
                ].filter(Boolean))
              );
              return (
                <div key={u.user_id} className="flex flex-col sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between gap-2 py-2.5" data-testid={`admin-user-${u.user_id}`}>
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Avatar user={u} size={32} showStatus={false} />
                    <span className="text-sm font-bold text-ink truncate" title={u.name}>{u.name}</span>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
                    <Select
                      value={u.department || "Management"}
                      onValueChange={(val) => upd(u.user_id, { department: val })}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[120px] shrink-0 rounded-xl bg-surface2 border-slate-200 dark:border-slate-800 px-3 text-xs font-medium" data-testid={`dept-select-${u.user_id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allDivs.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={u.role || "employee"}
                      onValueChange={(val) => upd(u.user_id, { role: val })}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[144px] shrink-0 rounded-xl bg-surface2 border-slate-200 dark:border-slate-800 px-3 text-xs font-medium" data-testid={`role-select-${u.user_id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {u.role && !ROLE_NAMES[u.role] && (
                          <SelectItem value={u.role}>{u.role}</SelectItem>
                        )}
                        {Object.entries(ROLE_NAMES).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={u.status || "active"}
                      onValueChange={(val) => upd(u.user_id, { status: val })}
                      disabled={u.user_id === me?.user_id}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[98px] shrink-0 rounded-xl bg-surface2 border-slate-200 dark:border-slate-800 px-3 text-xs font-medium" data-testid={`status-select-${u.user_id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Aktif</SelectItem>
                        <SelectItem value="pending">Menunggu</SelectItem>
                        <SelectItem value="inactive">Nonaktif</SelectItem>
                      </SelectContent>
                    </Select>

                    <button
                      type="button"
                      onClick={() => openResetPwModal(u)}
                      className="h-8 px-2.5 shrink-0 whitespace-nowrap rounded-xl flex items-center gap-1 text-xs font-semibold text-sub hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-900/50 transition-all cursor-pointer"
                      title={`Reset password untuk ${u.name}`}
                      data-testid={`reset-pw-user-${u.user_id}`}
                    >
                      <KeyRound size={14} />
                      <span>Reset PW</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteClick(u)}
                      className={`h-8 w-8 shrink-0 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                        u.user_id === me?.user_id
                          ? "text-slate-300 dark:text-slate-600 hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          : "text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50"
                      }`}
                      title={u.user_id === me?.user_id ? "Tidak dapat menghapus akun sendiri" : `Hapus ${u.name} (perlu persetujuan Manajer Divisi)`}
                      data-testid={`delete-user-${u.user_id}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

      {/* Dialog Konfirmasi Penghapusan Karyawan */}
      <Dialog open={!!deleteTargetUser} onOpenChange={(open) => !open && !isDeleting && setDeleteTargetUser(null)}>
        <DialogContent className="max-w-md p-4 sm:p-6 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl">
          <DialogHeader className="pb-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-bold text-ink">Hapus Karyawan</DialogTitle>
                <DialogDescription className="text-xs text-sub">Memerlukan persetujuan Manajer Divisi</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {deleteTargetUser && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface2/70 border border-slate-200/60 dark:border-slate-700/60">
                <Avatar user={deleteTargetUser} size={40} showStatus={false} />
                <div className="min-w-0 flex-1 text-left">
                  <p className="font-bold text-sm text-ink truncate">{deleteTargetUser.name}</p>
                  <p className="text-xs text-sub truncate">{deleteTargetUser.email}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand/10 text-brand">
                      Divisi: {deleteTargetUser.department || "General"}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface text-sub border">
                      {ROLE_NAMES[deleteTargetUser.role] || deleteTargetUser.role}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed text-left">
                <p className="font-bold mb-1 flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                  <span>⚠️</span> Persetujuan Manajer Divisi
                </p>
                <p className="text-[11.5px] opacity-90">
                  Penghapusan akun <b>{deleteTargetUser.name}</b> akan diajukan ke <b>Manajer Divisi {deleteTargetUser.department || "General"}</b> melalui Asisten <b>"Circle"</b> berupa kartu persetujuan (approval card). Akun akan dihapus permanen setelah disetujui.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="pt-3 border-t flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setDeleteTargetUser(null)}
              className="h-10 px-4 rounded-xl border bg-surface hover:bg-surface2 text-xs font-semibold text-sub hover:text-ink transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
              className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              data-testid="confirm-delete-user-btn"
            >
              <Trash2 size={14} />
              {isDeleting ? "Memproses..." : "Ajukan Hapus ke Manajer Divisi"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workspace Recovery Key (Super Admin / Workspace Admin Only) */}
      {isTopAdmin && (
        <Card title="Kode Pemulihan Password Darurat (Super Admin)" testid="workspace-recovery-key-card">
          <div className="space-y-3">
            <p className="text-xs text-sub leading-relaxed">
              Gunakan kode ini pada menu <b>"Lupa password? → Kode Pemulihan"</b> di halaman Login untuk mereset password secara instan (termasuk jika Super Admin lupa password dan tidak ada admin lain yang sedang online).
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-surface2/60 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
                <KeyRound size={17} />
              </div>
              <div className="min-w-0 flex-1 font-mono text-sm font-bold tracking-wider text-ink">
                {showRecoveryKey ? (recoveryKey || "Memuat...") : "CRCL-••••-••••"}
              </div>
              <button
                type="button"
                onClick={() => setShowRecoveryKey(!showRecoveryKey)}
                className="h-9 rounded-xl border bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface2 flex items-center gap-1.5 cursor-pointer"
                data-testid="toggle-recovery-key-btn"
              >
                {showRecoveryKey ? <EyeOff size={14} /> : <Eye size={14} />}
                <span>{showRecoveryKey ? "Sembunyikan" : "Tampilkan"}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyRecoveryKey}
                disabled={!recoveryKey}
                className="h-9 rounded-xl border bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface2 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                data-testid="copy-recovery-key-btn"
              >
                {copiedRecoveryKey ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                <span>{copiedRecoveryKey ? "Disalin" : "Salin"}</span>
              </button>
              <button
                type="button"
                onClick={handleRegenerateRecoveryKey}
                disabled={busyRecoveryKey}
                className="h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                data-testid="regenerate-recovery-key-btn"
              >
                <RefreshCw size={13} className={busyRecoveryKey ? "animate-spin" : ""} />
                <span>Buat Kode Baru</span>
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Dialog Reset Password Karyawan oleh Admin */}
      <Dialog open={!!resetPwUser} onOpenChange={(open) => !open && !busyResetPw && setResetPwUser(null)}>
        <DialogContent className="max-w-md p-6 bg-surface rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl" data-testid="admin-reset-pw-dialog">
          <DialogHeader className="pb-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 shrink-0">
                <KeyRound size={20} />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-bold text-ink">Reset Password Karyawan</DialogTitle>
                <DialogDescription className="text-xs text-sub">Atur ulang password login untuk akun anggota</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {resetPwUser && (
            <form onSubmit={handleConfirmResetPw} className="space-y-4 pt-2">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface2/70 border border-slate-200/60 dark:border-slate-700/60">
                <Avatar user={resetPwUser} size={40} showStatus={false} />
                <div className="min-w-0 flex-1 text-left">
                  <p className="font-bold text-sm text-ink truncate">{resetPwUser.name}</p>
                  <p className="text-xs text-sub truncate">{resetPwUser.email}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-sub">Password Baru *</label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                    data-testid="generate-random-pw-btn"
                  >
                    <RefreshCw size={11} /> Generate Acak
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type={showResetPw ? "text" : "password"}
                    required
                    autoFocus
                    value={resetPwValue}
                    onChange={(e) => setResetPwValue(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="h-10 w-full rounded-xl border bg-surface2 pl-3 pr-10 text-xs text-ink outline-none focus:border-brand font-mono"
                    data-testid="admin-reset-pw-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw(!showResetPw)}
                    className="absolute right-3 text-sub hover:text-ink cursor-pointer"
                  >
                    {showResetPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <PasswordStrengthMeter password={resetPwValue} />
              </div>

              <DialogFooter className="pt-2 border-t flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busyResetPw}
                  onClick={() => setResetPwUser(null)}
                  className="h-10 px-4 rounded-xl border bg-surface hover:bg-surface2 text-xs font-semibold text-sub hover:text-ink transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={busyResetPw}
                  className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  data-testid="confirm-reset-pw-btn"
                >
                  <KeyRound size={14} />
                  {busyResetPw ? "Menyimpan..." : "Simpan Password Baru"}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WeeklyReportCard() {
  const { ws, users = [], reloadWs } = useApp();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState(() =>
    Array.isArray(ws?.report_recipient_roles)
      ? ws.report_recipient_roles
      : ["super_admin", "workspace_admin", "department_manager", "project_manager"]
  );
  const [selectedUserIds, setSelectedUserIds] = useState(() =>
    Array.isArray(ws?.report_recipient_ids) ? ws.report_recipient_ids : []
  );
  const [customEmails, setCustomEmails] = useState(() =>
    Array.isArray(ws?.report_custom_emails) ? ws.report_custom_emails : []
  );
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    if (Array.isArray(ws?.report_recipient_roles)) setSelectedRoles(ws.report_recipient_roles);
    if (Array.isArray(ws?.report_recipient_ids)) setSelectedUserIds(ws.report_recipient_ids);
    if (Array.isArray(ws?.report_custom_emails)) setCustomEmails(ws.report_custom_emails);
  }, [ws?.report_recipient_roles, ws?.report_recipient_ids, ws?.report_custom_emails]);

  const humanUsers = (users || []).filter(
    (u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant" && u.status !== "inactive"
  );

  const toggleRole = (roleKey) => {
    setSelectedRoles((prev) =>
      prev.includes(roleKey) ? prev.filter((r) => r !== roleKey) : [...prev, roleKey]
    );
  };

  const toggleUser = (uid) => {
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const addCustomEmail = () => {
    const clean = newEmail.trim().toLowerCase();
    if (!clean || !clean.includes("@")) return toast.error("Masukkan alamat email yang valid");
    if (customEmails.includes(clean)) return toast.error("Email sudah ada di daftar penerima");
    setCustomEmails((prev) => [...prev, clean]);
    setNewEmail("");
  };

  const removeCustomEmail = (em) => {
    setCustomEmails((prev) => prev.filter((x) => x !== em));
  };

  const saveRecipients = async () => {
    setSaving(true);
    try {
      await api.patch("/workspace", {
        report_recipient_roles: selectedRoles,
        report_recipient_ids: selectedUserIds,
        report_custom_emails: customEmails,
      });
      await reloadWs();
      toast.success("Daftar penerima laporan berhasil disimpan!");
    } catch (e) {
      toast.error(errMsg(e, "Gagal menyimpan penerima laporan"));
    } finally {
      setSaving(false);
    }
  };

  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  const activeRecipientUsers = humanUsers.filter(
    (u) => selectedUserIds.includes(u.user_id) || selectedRoles.includes(u.role)
  );

  const computedRecipientEmails = Array.from(
    new Set([
      ...activeRecipientUsers
        .map((u) => String(u.email || "").trim())
        .filter((em) => em && em.includes("@") && !em.endsWith(".local")),
      ...customEmails.map((em) => String(em || "").trim()).filter((em) => em && em.includes("@")),
    ])
  );

  const handleOpenSendConfirm = () => {
    setConfirmSendOpen(true);
  };

  const executeSendWeeklyReport = async () => {
    setConfirmSendOpen(false);
    setBusy(true);
    try {
      let gmailToken = await getGmailAccessToken();
      if (!gmailToken) {
        try {
          const authRes = await googleGmailOAuthSignIn();
          gmailToken = authRes?.accessToken || null;
        } catch (authErr) {
          const code = authErr?.code || "";
          if (code === "auth/popup-closed-by-user") {
            toast.info("Popup otorisasi Gmail ditutup.");
            setBusy(false);
            return;
          }
          console.warn("Gmail OAuth popup note:", authErr);
        }
      }

      let { data } = await api.post("/reports/weekly/test", {
        recipient_roles: selectedRoles,
        recipient_ids: selectedUserIds,
        custom_emails: customEmails,
        gmail_access_token: gmailToken,
      });

      // If cached token expired (401/403 from Gmail API), clear & re-prompt once
      if (!data?.email_delivered && gmailToken && data?.email_error) {
        clearGmailAuth();
        try {
          const retryAuth = await googleGmailOAuthSignIn();
          if (retryAuth?.accessToken) {
            const retryRes = await api.post("/reports/weekly/test", {
              recipient_roles: selectedRoles,
              recipient_ids: selectedUserIds,
              custom_emails: customEmails,
              gmail_access_token: retryAuth.accessToken,
            });
            data = retryRes.data;
          }
        } catch {}
      }

      await reloadWs();
      if (data?.email_delivered) {
        toast.success(`Email Laporan Progres Mingguan berhasil terkirim ke inbox: ${data.sent_to}`);
      } else if (data?.email_error) {
        toast.warning(`Laporan terkirim ke chat Circle (${data.sent_to}), namun pengiriman Gmail gagal: ${data.email_error}`);
      } else {
        toast.info(`Laporan terkirim ke chat Circle (${data.sent_to}). Izinkan popup Google Gmail agar masuk ke kotak masuk email.`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Laporan Progres Mingguan" testid="weekly-report-card">
      <p className="text-xs text-sub leading-relaxed">
        Atur penerima laporan progres mingguan, ringkasan checkpoint, dan kendala tugas di seluruh board workspace.
      </p>

      {/* 1. Filter by Role */}
      <div className="mt-4">
        <p className="text-xs font-bold text-ink mb-2">Role Penerima Otomatis</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ROLE_NAMES).map(([roleKey, roleLabel]) => {
            const active = selectedRoles.includes(roleKey);
            return (
              <button
                key={roleKey}
                type="button"
                onClick={() => toggleRole(roleKey)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-brand text-white border-brand shadow-xs"
                    : "bg-surface2 text-sub border-transparent hover:text-ink"
                }`}
                data-testid={`report-role-${roleKey}`}
              >
                <span>{roleLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Specific Team Members */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-ink">Pilih Anggota Tim Tertentu</p>
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedUserIds(humanUsers.map((u) => u.user_id))}
              className="font-semibold text-brand hover:underline cursor-pointer"
            >
              Pilih Semua
            </button>
            <span className="text-sub">·</span>
            <button
              type="button"
              onClick={() => setSelectedUserIds([])}
              className="font-medium text-sub hover:text-ink cursor-pointer"
            >
              Reset Pilihan
            </button>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto divide-y rounded-2xl border bg-surface2/40 px-3 py-1">
          {humanUsers.map((u) => {
            const isRoleMatched = selectedRoles.includes(u.role);
            const isChecked = selectedUserIds.includes(u.user_id) || isRoleMatched;
            return (
              <label
                key={u.user_id}
                className="flex items-center justify-between gap-3 py-2 text-xs cursor-pointer"
                data-testid={`report-recipient-user-${u.user_id}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      if (isRoleMatched && !selectedUserIds.includes(u.user_id)) {
                        toggleRole(u.role);
                      } else {
                        toggleUser(u.user_id);
                      }
                    }}
                    className="h-4 w-4 rounded accent-[var(--c-accent)]"
                  />
                  <Avatar user={u} size={26} showStatus={false} />
                  <div className="min-w-0">
                    <p className="font-bold text-ink truncate">{u.name}</p>
                    <p className="text-[11px] text-sub truncate">{u.email} · {u.department || "Workspace"}</p>
                  </div>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-semibold text-sub border shrink-0">
                  {ROLE_NAMES[u.role] || u.role}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 3. Additional Custom Emails */}
      <div className="mt-4">
        <p className="text-xs font-bold text-ink mb-1.5">Email Penerima Tambahan</p>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomEmail())}
            placeholder="Tambahkan email eksternal / manajemen..."
            className={`${inp} flex-1 text-xs`}
            data-testid="report-custom-email-input"
          />
          <button
            type="button"
            onClick={addCustomEmail}
            className="btn-ghost h-10 border bg-surface px-4 text-xs font-semibold text-ink shrink-0 cursor-pointer"
            data-testid="report-add-email-btn"
          >
            + Tambah Email
          </button>
        </div>
        {customEmails.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {customEmails.map((em) => (
              <span
                key={em}
                className="inline-flex items-center gap-1.5 rounded-full border bg-surface2 px-3 py-1 text-xs font-medium text-ink"
              >
                {em}
                <button
                  type="button"
                  onClick={() => removeCustomEmail(em)}
                  className="text-sub hover:text-rose-500 font-bold cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-sub">
          Total penerima aktif: <b className="text-ink">{activeRecipientUsers.length + customEmails.length} orang</b>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveRecipients}
            disabled={saving}
            className="btn-accent h-10 px-5 text-xs font-bold disabled:opacity-50 cursor-pointer"
            data-testid="save-report-recipients-btn"
          >
            {saving ? "Menyimpan..." : "Simpan Penerima Laporan"}
          </button>
          <button
            type="button"
            onClick={handleOpenSendConfirm}
            disabled={busy}
            className="btn-ghost h-10 border bg-surface px-5 text-xs font-semibold text-ink disabled:opacity-50 cursor-pointer"
            data-testid="weekly-report-test-btn"
          >
            {busy ? "Mengirim ke Email…" : "Kirim Laporan Sekarang"}
          </button>
        </div>
      </div>

      <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <DialogContent className="max-w-md rounded-3xl bg-surface p-6 shadow-xl" data-testid="weekly-report-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ink">
              Kirim Email Laporan Progres Mingguan?
            </DialogTitle>
            <DialogDescription className="text-xs text-sub leading-relaxed pt-1">
              Laporan progres mingguan beserta ringkasan tugas per divisi/board akan dikirim langsung ke kotak masuk email penerima melalui akun Gmail Anda:
            </DialogDescription>
          </DialogHeader>
          <div className="my-2 max-h-36 overflow-y-auto rounded-2xl border bg-surface2/60 p-3 text-xs text-ink space-y-1">
            {computedRecipientEmails.length > 0 ? (
              computedRecipientEmails.map((em) => (
                <div key={em} className="flex items-center gap-2 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand shrink-0" />
                  <span className="truncate">{em}</span>
                </div>
              ))
            ) : (
              <p className="text-sub">
                Belum ada email eksternal/anggota yang dipilih (Catatan: akun <code>admin@asliri.local</code> adalah akun lokal, tambahkan email aktif seperti <code>@asliri.id</code> atau <code>@gmail.com</code> di daftar penerima).
              </p>
            )}
          </div>
          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmSendOpen(false)}
              className="btn-ghost h-10 rounded-xl border px-4 text-xs font-semibold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={executeSendWeeklyReport}
              className="btn-accent h-10 rounded-xl px-4 text-xs font-bold cursor-pointer"
              data-testid="confirm-send-weekly-report-btn"
            >
              Ya, Kirim Email Sekarang
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function WorkspaceBranding() {
  const { ws, reloadWs, setSession, savePrefs } = useApp();
  const formatOrgLevels = (val) => Array.isArray(val) ? val.join(", ") : String(val || "");
  const [f, setF] = useState({
    brand_name: ws?.brand_name || ws?.name || "",
    name: ws?.name || "",
    tagline: ws?.tagline || "",
    description: ws?.description || "",
    org_levels: formatOrgLevels(ws?.org_levels)
  });

  const buildLoginTextsState = (copyMap) => {
    const src = copyMap && typeof copyMap === "object" ? copyMap : {};
    const next = {};
    LOGIN_COPYWRITING_SECTIONS.forEach((sec) => {
      sec.fields.forEach(([key]) => {
        next[key] = typeof src[key] === "string" && src[key].trim() ? src[key] : (DEFAULT_COPYWRITING[key] || "");
      });
    });
    return next;
  };

  const [loginTexts, setLoginTexts] = useState(() => buildLoginTextsState(ws?.custom_copywriting));
  const [activeLoginSec, setActiveLoginSec] = useState(0);
  const [savingLoginTexts, setSavingLoginTexts] = useState(false);

  useEffect(() => {
    setF({
      brand_name: ws?.brand_name || ws?.name || "",
      name: ws?.name || "",
      tagline: ws?.tagline || "",
      description: ws?.description || "",
      org_levels: formatOrgLevels(ws?.org_levels)
    });
    setLoginTexts(buildLoginTextsState(ws?.custom_copywriting));
  }, [ws]);

  const computeMergedCopywriting = (overrideLoginMap = loginTexts) => {
    const base = cleanCopywritingMap(ws?.custom_copywriting || {});
    LOGIN_COPYWRITING_SECTIONS.forEach((sec) => {
      sec.fields.forEach(([key]) => {
        const val = String(overrideLoginMap[key] ?? "").trim();
        const defVal = String(DEFAULT_COPYWRITING[key] ?? "").trim();
        if (!val || val === defVal) {
          delete base[key];
        } else {
          base[key] = val;
        }
      });
    });
    return cleanCopywritingMap(base);
  };

  const saveAllWorkspaceAndLogin = async () => {
    setSavingLoginTexts(true);
    try {
      const mergedCopy = computeMergedCopywriting(loginTexts);
      const payload = {
        ...f,
        name: f.name || f.brand_name,
        brand_name: f.brand_name || f.name,
        org_levels: String(f.org_levels || "").split(",").map((x) => x.trim()).filter(Boolean),
        custom_copywriting: mergedCopy,
      };
      const { data } = await api.patch("/workspace", payload);
      if (data && typeof data === "object") {
        setSession?.((s) => (s ? { ...s, workspace: data } : s));
      } else {
        await reloadWs();
      }
      await savePrefs?.({ custom_copywriting: mergedCopy });
      syncWorkspaceMirror(api, true).catch(() => {});
      toast.success("Identitas Workspace & teks halaman login berhasil disimpan!");
    } catch (er) {
      toast.error(errMsg(er, "Gagal menyimpan pengaturan workspace"));
    } finally {
      setSavingLoginTexts(false);
    }
  };

  const resetAllLoginTexts = async () => {
    const defaultLoginMap = buildLoginTextsState({});
    setLoginTexts(defaultLoginMap);
    setSavingLoginTexts(true);
    try {
      const mergedCopy = computeMergedCopywriting({});
      const { data } = await api.patch("/workspace", { custom_copywriting: mergedCopy });
      if (data && typeof data === "object") {
        setSession?.((s) => (s ? { ...s, workspace: data } : s));
      } else {
        await reloadWs();
      }
      await savePrefs?.({ custom_copywriting: mergedCopy });
      syncWorkspaceMirror(api, true).catch(() => {});
      toast.success("Seluruh teks halaman login dikembalikan ke default!");
    } catch (er) {
      toast.error(errMsg(er, "Gagal mereset teks halaman login"));
    } finally {
      setSavingLoginTexts(false);
    }
  };

  const logo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const up = await uploadFile(file);
      await api.patch("/workspace", { logo_file_id: up.id });
      toast.success("Foto profil workspace berhasil diperbarui!");
      reloadWs();
    } catch (er) {
      toast.error(errMsg(er, "Gagal mengupload logo workspace"));
    }
  };
  const favicon = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const up = await uploadFile(file);
      await api.patch("/workspace", { favicon_file_id: up.id });
      toast.success("Icon website berhasil diperbarui!");
      reloadWs();
    } catch (er) {
      toast.error(errMsg(er, "Gagal mengupload favicon website"));
    }
  };
  const loginImg = async (e) => {
    const fl = e.target.files[0];
    if (!fl) return;
    if (!fl.type.startsWith("image/")) return toast.error("Pilih file gambar");
    try {
      const up = await uploadFile(fl);
      await api.patch("/workspace", { login_image_file_id: up.id });
      toast.success("Gambar halaman login berhasil diperbarui!");
      reloadWs();
    } catch (er) {
      toast.error(errMsg(er, "Gagal mengupload gambar login"));
    }
  };
  return (
    <Card title="Identitas & Branding Workspace" testid="workspace-branding">
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface2/50 p-4">
        <Logo ws={ws} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Foto Profil / Logo Workspace</p>
          <p className="text-xs text-sub">Tampil di header sidebar, login, dan seluruh workspace CIRCLE.</p>
          <div className="mt-2 flex items-center gap-3">
            <label className="cursor-pointer rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
              Ubah Foto Profil Workspace
              <input type="file" accept="image/*" hidden onChange={logo} data-testid="logo-upload-input" />
            </label>
            {ws.logo_file_id && (
              <button onClick={() => run(() => api.patch("/workspace", { logo_file_id: null }), "Logo dihapus").then(reloadWs)} className="text-xs text-rose-500 hover:underline">
                Hapus Logo Kustom
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Favicon (Icon Tab Website) Setting */}
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface2/50 p-4" data-testid="favicon-setting">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-surface p-2 shadow-xs">
          {ws?.favicon_file_id ? (
            <img
              src={`/api/files/${ws.favicon_file_id}`}
              alt="Favicon preview"
              className="h-10 w-10 object-contain rounded-lg"
              data-testid="favicon-preview"
            />
          ) : (
            <img
              src={ws?.logo_file_id && ws.logo_file_id !== "default_workspace_logo" ? `/api/files/${ws.logo_file_id}` : "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png"}
              alt="Default icon"
              className="h-10 w-10 object-contain rounded-lg"
              data-testid="favicon-preview-default"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold">Icon Website</p>
            <span className="rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 text-[10px] font-bold">
              Browser Tab & PWA
            </span>
          </div>
          <p className="text-xs text-sub mt-0.5">
            Icon kecil yang muncul di tab browser, bookmark bar, dan shortcut home screen aplikasi. Format disarankan: PNG, SVG, atau ICO.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <label className="cursor-pointer rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
              Ubah Icon Website
              <input type="file" accept="image/*,.ico,.svg" hidden onChange={favicon} data-testid="favicon-upload-input" />
            </label>
            {ws.favicon_file_id && (
              <button
                type="button"
                onClick={() => run(() => api.patch("/workspace", { favicon_file_id: null }), "Favicon kustom dihapus, memakai logo default").then(reloadWs)}
                className="text-xs text-sub hover:underline"
                data-testid="favicon-reset-btn"
              >
                Gunakan Logo Workspace
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface2/50 p-4" data-testid="login-image-setting">
        <img
          src={ws.login_image_file_id && ws.login_image_file_id !== "default_login_bg" ? `/api/public/login-image/${ws.login_image_file_id}` : "/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg"}
          alt="Gambar login"
          onError={(e) => { e.currentTarget.src = "/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg"; }}
          className="h-16 w-28 rounded-xl object-cover shadow-sm border"
          data-testid="login-image-preview"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Gambar Halaman Login</p>
          <p className="text-xs text-sub">Background ilustrasi di sisi kiri halaman masuk.</p>
          <div className="mt-2 flex items-center gap-3">
            <label className="cursor-pointer rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
              Ubah Gambar Login
              <input type="file" accept="image/*" hidden onChange={loginImg} data-testid="login-image-upload-input" />
            </label>
            {ws.login_image_file_id && (
              <button onClick={() => run(() => api.patch("/workspace", { login_image_file_id: null }), "Kembali ke gambar default").then(reloadWs)} className="text-xs text-sub hover:underline" data-testid="login-image-reset">
                Pakai Default
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[["brand_name", "Nama Aplikasi"], ["name", "Nama Workspace"], ["tagline", "Tagline"], ["description", "Deskripsi"], ["org_levels", "Level Organisasi"]].map(([k, l]) => <label key={k} className="text-xs font-semibold text-sub">{l}<input value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={`${inp} mt-1 w-full`} data-testid={`ws-${k}-input`} /></label>)}
      </div>

      {/* Pengaturan Teks Halaman Login & Pendaftaran */}
      <div className="mt-6 rounded-2xl border bg-surface2/40 p-4 sm:p-5" data-testid="login-page-text-settings">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3.5">
          <div>
            <h4 className="text-sm font-bold text-ink">Pengaturan Teks Halaman Login & Pendaftaran</h4>
            <p className="text-xs text-sub mt-0.5">
              Ubah seluruh teks, judul hero, tab, label input, placeholder, tombol, hingga pesan di halaman masuk & pendaftaran akun.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetAllLoginTexts}
              disabled={savingLoginTexts}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border bg-surface px-3 text-xs font-semibold text-sub hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
              data-testid="reset-login-texts-btn"
            >
              <RotateCcw size={12} /> Reset Default
            </button>
            <button
              type="button"
              onClick={saveAllWorkspaceAndLogin}
              disabled={savingLoginTexts}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
              data-testid="save-login-texts-btn"
            >
              <Check size={13} /> {savingLoginTexts ? "Menyimpan..." : "Simpan Teks Login"}
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 scroll-thin">
          {LOGIN_COPYWRITING_SECTIONS.map((sec, idx) => {
            const active = activeLoginSec === idx;
            return (
              <button
                key={sec.title}
                type="button"
                onClick={() => setActiveLoginSec(idx)}
                className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active ? "bg-brand text-white shadow-xs" : "border bg-surface text-sub hover:bg-surface2 hover:text-ink"
                }`}
                data-testid={`login-text-tab-${idx}`}
              >
                {sec.title}
              </button>
            );
          })}
        </div>

        {LOGIN_COPYWRITING_SECTIONS[activeLoginSec] && (
          <div className="space-y-3">
            <p className="text-[11px] font-medium text-sub">
              {LOGIN_COPYWRITING_SECTIONS[activeLoginSec].subtitle}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {LOGIN_COPYWRITING_SECTIONS[activeLoginSec].fields.map(([key, label]) => {
                const defVal = DEFAULT_COPYWRITING[key] || "";
                const curVal = loginTexts[key] ?? defVal;
                const isModified = String(curVal).trim() !== String(defVal).trim();
                const isLongText = defVal.length > 70 || key.includes("subtitle") || key.includes("notice") || key.includes("desc") || key.includes("status_");
                return (
                  <div
                    key={key}
                    className={`flex flex-col justify-between rounded-xl border bg-surface p-3 ${isLongText ? "sm:col-span-2" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-ink">{label}</span>
                      {isModified && (
                        <button
                          type="button"
                          onClick={() => setLoginTexts((prev) => ({ ...prev, [key]: defVal }))}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-500 hover:underline cursor-pointer"
                          title="Kembalikan ke teks default"
                        >
                          <RotateCcw size={10} /> Default
                        </button>
                      )}
                    </div>
                    {isLongText ? (
                      <textarea
                        rows={2}
                        value={curVal}
                        onChange={(e) => setLoginTexts((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={defVal}
                        className="w-full rounded-xl border bg-surface2 p-2.5 text-xs text-ink outline-none focus:border-brand resize-none"
                        data-testid={`login-copy-${key}`}
                      />
                    ) : (
                      <input
                        value={curVal}
                        onChange={(e) => setLoginTexts((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={defVal}
                        className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                        data-testid={`login-copy-${key}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={savingLoginTexts}
        onClick={saveAllWorkspaceAndLogin}
        className="btn-accent mt-5 h-10 px-5 text-sm font-semibold cursor-pointer disabled:opacity-50"
        data-testid="ws-save-btn"
      >
        {savingLoginTexts ? "Menyimpan..." : "Simpan"}
      </button>
    </Card>
  );
}

export function DivisionsAdmin() {
  const { ws, reloadWs } = useApp();
  const [list, setList] = useState(() => DIVISIONS_CACHE || ws?.divisions || []);
  const [n, setN] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/workspace").then((r) => {
      const divs = Array.isArray(r.data?.divisions) ? r.data.divisions : [];
      DIVISIONS_CACHE = divs;
      setList(divs);
      try { localStorage.setItem("circle_admin_divisions", JSON.stringify(divs)); } catch {}
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (Array.isArray(ws?.divisions)) {
      DIVISIONS_CACHE = ws.divisions;
      setList(ws.divisions);
      try { localStorage.setItem("circle_admin_divisions", JSON.stringify(ws.divisions)); } catch {}
    }
  }, [ws?.divisions]);

  const save = async (nextList, msg = "Daftar divisi, struktur organisasi & grup berhasil diselaraskan!") => {
    const cleaned = Array.from(
      new Set(nextList.map((d) => String(d || "").trim()).filter(Boolean))
    );
    // 0ms optimistic update
    DIVISIONS_CACHE = cleaned;
    setList(cleaned);
    try { localStorage.setItem("circle_admin_divisions", JSON.stringify(cleaned)); } catch {}
    setSaving(true);
    try {
      await api.patch("/workspace", { divisions: cleaned });
      const syncRes = await api.post("/org/sync-divisions", { divisions: cleaned }).catch(() => null);
      if (syncRes?.data) {
        if (Array.isArray(syncRes.data.units)) {
          try { localStorage.setItem("circle_org_units_cache", JSON.stringify(syncRes.data.units)); } catch {}
        }
        if (Array.isArray(syncRes.data.groups)) {
          try { localStorage.setItem("circle_groups_cache", JSON.stringify(syncRes.data.groups)); } catch {}
        }
      }
      await reloadWs();
      toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const clean = n.trim();
    if (!clean) return;
    if (list.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      return toast.error("Divisi tersebut sudah ada");
    }
    const next = [...list, clean];
    setN("");
    save(next, `Divisi "${clean}" ditambahkan & diselaraskan ke Struktur Organisasi dan Grup!`);
  };

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    setList(next);
  };

  const renameItem = (idx, val) => {
    const next = [...list];
    next[idx] = val;
    setList(next);
  };

  return (
    <Card title="Daftar Divisi & Penyelarasan Struktur Organisasi" testid="divisions-admin">
      <p className="mb-3 text-xs text-sub">
        Kelola daftar divisi resmi perusahaan. Setiap perubahan divisi di sini otomatis tersinkronisasi dengan halaman <b>Struktur Organisasi</b>, <b>Grup</b>, <b>Karyawan</b>, dan <b>Direktori Drive</b>.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={n}
          onChange={(e) => setN(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Tambah nama divisi baru..."
          className={`${inp} flex-1 min-w-0`}
          data-testid="division-name-input"
        />
        <button
          type="button"
          onClick={add}
          disabled={saving}
          className="btn-accent h-10 px-5 text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1.5 cursor-pointer"
          data-testid="division-add-btn"
        >
          <Plus size={14} className="shrink-0" />
          <span>Tambah</span>
        </button>
      </div>

      <div className="mt-3 space-y-2 max-h-80 overflow-y-auto pr-1">
        {list.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="flex items-center gap-2 rounded-xl border bg-surface2/60 px-3 py-1.5"
            data-testid={`division-item-${String(d).replace(/\s/g, "-")}`}
          >
            <span className="text-xs font-bold text-sub w-5">{i + 1}.</span>
            <input
              value={d}
              onChange={(e) => renameItem(i, e.target.value)}
              className="h-8 flex-1 rounded-lg border bg-surface px-2.5 text-xs font-semibold text-ink outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="text-sub hover:text-ink disabled:opacity-30 p-1 cursor-pointer"
              title="Geser ke atas"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              disabled={i === list.length - 1}
              onClick={() => move(i, 1)}
              className="text-sub hover:text-ink disabled:opacity-30 p-1 cursor-pointer"
              title="Geser ke bawah"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => save(list.filter((_, idx) => idx !== i), `Divisi "${d}" berhasil dihapus & diselaraskan`)}
              className="text-sub hover:text-rose-500 p-1 cursor-pointer"
              aria-label={`Hapus ${d}`}
              data-testid={`division-remove-${String(d).replace(/\s/g, "-")}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!list.length && <p className="text-sm text-sub py-2">Belum ada divisi.</p>}
      </div>

      <div className="mt-4 flex justify-end border-t pt-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => save(list)}
          className="btn-accent h-10 px-5 text-sm font-semibold whitespace-nowrap disabled:opacity-50 cursor-pointer"
          data-testid="divisions-save-btn"
        >
          {saving ? "Menyimpan..." : "Simpan & Selaraskan Divisi"}
        </button>
      </div>
    </Card>
  );
}

function ColorSwatch({ value, onSave, testid }) {
  const [c, setC] = useState(value);
  const timer = useRef(null);
  useEffect(() => { setC(value); }, [value]);
  const change = (v) => { setC(v); clearTimeout(timer.current); timer.current = setTimeout(() => v.toLowerCase() !== value.toLowerCase() && onSave(v), 200); };
  return <input type="color" value={c} onChange={(e) => change(e.target.value)} className="h-8 w-8" aria-label="Warna item" data-testid={testid} />;
}

export function ItemTypesAdmin() {
  const { ws, reloadWs } = useApp();
  const [n, setN] = useState("");
  const [color, setColor] = useState("#2563EB");
  const rawList = Array.isArray(ws?.item_types) && ws.item_types.length > 0 ? ws.item_types : DEFAULT_ITEM_TYPES;
  const combinedMap = new Map();
  rawList.forEach((i) => i?.name && combinedMap.set(i.name.toLowerCase(), i));
  const list = Array.from(combinedMap.values());

  const save = (l, msg) => run(() => api.patch("/workspace", { item_types: l }), msg).then(reloadWs);
  const add = () => {
    const trimmed = n.trim();
    if (!trimmed) return;
    const isDark = isDarkHex(color);
    return run(
      () => api.post("/item-types", {
        name: trimmed,
        color,
        text_color: isDark ? "#FFFFFF" : "#1E293B",
        border_color: color
      }),
      "Item ditambahkan"
    ).then(() => { setN(""); reloadWs(); });
  };
  return (
    <Card title="Jenis Item Tugas" testid="item-types-admin">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-sub">Daftar jenis item resmi dan kustom untuk tugas. Anda dapat menambah jenis item baru, mengatur warna, atau menghapusnya.</p>
        <button
          type="button"
          onClick={() => save(DEFAULT_ITEM_TYPES, "Daftar jenis item direset ke 13 standar")}
          className="rounded-full border px-3 py-1 text-[11px] font-semibold text-sub hover:border-brand hover:text-brand transition-colors cursor-pointer"
          data-testid="item-type-reset-btn"
        >
          Reset Default (13 Item)
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Nama item baru..." className={`${inp} flex-1 min-w-0`} data-testid="item-type-name-input" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border p-1" title="Pilih warna item" />
        <button type="button" onClick={add} className="btn-accent h-10 px-5 text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1.5 cursor-pointer" data-testid="item-type-add-btn"><Plus size={14} className="shrink-0" /><span>Tambah</span></button>
      </div>
      <div className="mt-3 divide-y max-h-96 overflow-y-auto pr-1">{list.map((it, i) => (
        <div key={it.name} className="flex items-center gap-3 py-2" data-testid={`item-type-row-${it.name.replace(/\s/g, "-")}`}>
          <ColorSwatch
            value={it.color}
            onSave={(c) => save(
              list.map((x, j) => (j === i ? { ...x, color: c, text_color: isDarkHex(c) ? "#FFFFFF" : "#1E293B", border_color: c } : x)),
              "Warna disimpan"
            )}
            testid={`item-type-color-${it.name.replace(/\s/g, "-")}`}
          />
          <span className="flex-1"><ItemChip name={it.name} /></span>
          <button onClick={() => save(list.filter((_, j) => j !== i), "Item dihapus")} className="text-sub hover:text-rose-500 cursor-pointer" aria-label={`Hapus ${it.name}`} data-testid={`item-type-remove-${it.name.replace(/\s/g, "-")}`}><Trash2 size={14} /></button>
        </div>))}</div>
    </Card>
  );
}

export function LabelsAdmin() {
  const { labels, reloadLabels, isManager } = useApp();
  const [n, setN] = useState({ name: "", color: "#2F7DE1", description: "" });
  return (
    <Card title="Brand & Label" testid="labels-admin">
      <div className="mb-4 flex flex-wrap gap-2"><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="Nama label" className={`${inp} flex-1`} data-testid="label-name-input" /><input type="color" value={n.color} onChange={(e) => setN({ ...n, color: e.target.value })} className="h-10 w-12" aria-label="Warna" /><input value={n.description} onChange={(e) => setN({ ...n, description: e.target.value })} placeholder="Deskripsi" className={`${inp} flex-1`} />
        <button onClick={() => run(() => api.post("/labels", n), "Label berhasil dibuat").then((ok) => { if (ok) { setN({ name: "", color: "#2F7DE1", description: "" }); reloadLabels(); } })} className="btn-accent h-10 px-4 text-sm font-semibold" data-testid="label-create-btn"><Plus size={14} /></button></div>
      <div className="divide-y">{labels.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 py-2" data-testid={`label-row-${l.id}`}>
          <input type="color" value={l.color} disabled={!isManager} onChange={(e) => run(() => api.patch(`/labels/${l.id}`, { color: e.target.value })).then(reloadLabels)} className="h-8 w-8" aria-label="Warna label" data-testid={`label-color-${l.id}`} />
          <input defaultValue={l.name} disabled={!isManager} onBlur={(e) => e.target.value !== l.name && run(() => api.patch(`/labels/${l.id}`, { name: e.target.value }), "Nama label diperbarui").then(reloadLabels)} className="h-9 w-40 rounded-lg border bg-surface2 px-2 text-sm" data-testid={`label-name-${l.id}`} />
          <LabelChip label={l} small /><span className="flex-1 truncate text-xs text-sub">{l.description}</span>
          {isManager && <><button onClick={() => run(() => api.patch(`/labels/${l.id}`, { archived: !l.archived }), l.archived ? "Label dipulihkan" : "Label diarsipkan").then(reloadLabels)} className="text-xs font-semibold text-sub" data-testid={`label-archive-${l.id}`}>{l.archived ? "Pulihkan" : "Arsipkan"}</button>
            <button onClick={() => run(() => api.delete(`/labels/${l.id}`), "Label dihapus").then(reloadLabels)} className="text-rose-500" aria-label="Hapus label" data-testid={`label-delete-${l.id}`}><Trash2 size={14} /></button></>}
        </div>))}</div>
    </Card>
  );
}

export function StatusesAdmin() {
  const { ws, reloadWs } = useApp();
  const normalizeStatuses = (arr) => (arr || []).map((s) => typeof s === "string" ? { key: s, name: s.replace(/_/g, " "), color: "#F0F4FA", is_done: s === "done" } : { key: s.key || `st_${Math.random()}`, name: s.name || "Status", color: s.color || "#F0F4FA", is_done: !!s.is_done });
  const [list, setList] = useState(() => normalizeStatuses(ws?.task_statuses));
  useEffect(() => {
    if (ws?.task_statuses) setList(normalizeStatuses(ws.task_statuses));
  }, [ws?.task_statuses]);
  const mv = (i, d) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; setList(l); };
  return (
    <Card title="Status Tugas" testid="statuses-admin">
      <div className="space-y-2">{list.map((s, i) => (
        <div key={s.key || i} className="flex flex-wrap items-center gap-2"><input type="color" value={s.color} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className="h-9 w-9" aria-label="Warna status" />
          <input value={s.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${inp} flex-1`} data-testid={`status-name-${s.key || i}`} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={s.is_done} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, is_done: e.target.checked } : x)))} className="accent-[var(--c-accent)]" />Selesai</label>
          <button type="button" disabled={!i} onClick={() => mv(i, -1)} className="text-sub disabled:opacity-30" aria-label="Geser ke atas"><ArrowUp size={14} /></button><button type="button" disabled={i === list.length - 1} onClick={() => mv(i, 1)} className="text-sub disabled:opacity-30" aria-label="Geser ke bawah"><ArrowDown size={14} /></button>
          <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} className="text-rose-500" aria-label="Hapus status"><Trash2 size={14} /></button></div>))}</div>
      <div className="mt-3 flex gap-2"><button type="button" onClick={() => setList([...list, { key: `st_${Date.now().toString(36)}`, name: "Status baru", color: "#EEE6FF", is_done: false }])} className="btn-ghost h-10 border px-4 text-sm font-semibold" data-testid="add-status-btn">Tambah Status</button>
        <button type="button" onClick={() => run(() => api.put("/settings/task-config", { task_statuses: list }), "Status tugas berhasil disimpan!").then(reloadWs)} className="btn-accent h-10 px-4 text-sm font-semibold" data-testid="save-statuses-btn">Simpan</button></div>
    </Card>
  );
}

const TYPES = ["short_text", "long_text", "email", "phone", "date", "dropdown", "multi_select", "url", "boolean", "location"];
const STD_FIELD_LABELS = { email: "Email", phone: "No. Telepon", employee_id: "ID Employee", employment_status: "Status Kepegawaian", join_date: "Tanggal Bergabung" };
export function ProfileFieldsAdmin() {
  const { ws, reloadWs } = useApp();
  const [fields, setFields] = useState(ws?.profile_fields || []);
  const [vis, setVis] = useState(ws?.field_visibility || {});
  useEffect(() => {
    setFields(ws?.profile_fields || []);
    setVis(ws?.field_visibility || {});
  }, [ws?.profile_fields, ws?.field_visibility]);
  const upd = (i, p) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const mv = (i, d) => { const l = [...fields]; [l[i], l[i + d]] = [l[i + d], l[i]]; setFields(l); };
  const V = ({ value, onChange, testid }) => <AppSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-xl border bg-surface2 px-3 text-xs font-medium" data-testid={testid}><option value="everyone">Semua Orang</option><option value="managers">Manajer</option><option value="admins">Hanya Admin</option></AppSelect>;
  return (
    <Card title="Kolom Profil Karyawan" testid="profile-fields-admin">
      <p className="mb-2 text-xs font-semibold text-sub">Visibilitas kolom standar</p>
      <div className="mb-5 grid gap-2 sm:grid-cols-2">{["email", "phone", "employee_id", "employment_status", "join_date"].map((k) => <div key={k} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-sm">{STD_FIELD_LABELS[k] || k}<V value={vis[k] || "everyone"} onChange={(v) => setVis({ ...vis, [k]: v })} testid={`vis-${k}`} /></div>)}</div>
      <p className="mb-2 text-xs font-semibold text-sub">Kolom kustom</p>
      <div className="space-y-2">{fields.map((f, i) => (
        <div key={f.key || i} className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
          <input value={f.name} onChange={(e) => upd(i, { name: e.target.value })} className="h-9 flex-1 rounded-lg border bg-surface2 px-2 text-sm" data-testid={`cf-name-${i}`} />
          <AppSelect value={f.type} onChange={(e) => upd(i, { type: e.target.value })} className="h-9 rounded-xl border bg-surface2 px-3 text-xs font-medium">{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</AppSelect>
          {["dropdown", "multi_select"].includes(f.type) && <input defaultValue={(f.options || []).join(", ")} onBlur={(e) => upd(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Opsi, pisahkan dengan koma" className="h-9 rounded-lg border bg-surface2 px-2 text-xs" />}
          <V value={f.visibility} onChange={(v) => upd(i, { visibility: v })} />
          <button type="button" disabled={!i} onClick={() => mv(i, -1)} className="text-sub disabled:opacity-30" aria-label="Geser ke atas"><ArrowUp size={14} /></button>
          <button type="button" onClick={() => setFields(fields.filter((_, j) => j !== i))} className="text-rose-500" aria-label="Hapus kolom"><Trash2 size={14} /></button>
        </div>))}</div>
      <div className="mt-3 flex gap-2"><button type="button" onClick={() => setFields([...fields, { key: `cf_${Date.now()}`, name: "Kolom baru", type: "short_text", visibility: "everyone", options: [] }])} className="btn-ghost h-10 border px-4 text-sm font-semibold" data-testid="add-profile-field-btn">Tambah Kolom</button>
        <button type="button" onClick={() => run(() => api.put("/settings/profile-fields", { fields, field_visibility: vis }), "Kolom profil berhasil disimpan!").then(reloadWs)} className="btn-accent h-10 px-4 text-sm font-semibold" data-testid="save-profile-fields-btn">Simpan</button></div>
    </Card>
  );
}

export function StickersAdmin() {
  const { subscribe } = useApp();
  const [name, setName] = useState("");
  const [data, setData] = useState(STICKERS_CACHE);
  const load = () => api.get("/stickers").then((r) => { 
    setData(r.data); 
    STICKERS_CACHE = r.data;
    try { localStorage.setItem("circle_admin_stickers_data", JSON.stringify(r.data)); } catch {}
  }).catch(() => {});
  useEffect(() => {
    load();
    return subscribe?.((e) => {
      if (e?.type === "stickers:changed") load();
    });
  }, [subscribe]);

  const handleCreatePack = async () => {
    if (!name.trim()) return toast.error("Ketik nama paket stiker");
    try {
      await api.post("/sticker-packs", { name: name.trim(), category: name.trim() });
      toast.success(`Paket stiker "${name.trim()}" berhasil dibuat`);
      setName("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleDeleteSticker = async (stkId) => {
    try {
      await api.delete(`/stickers/${stkId}`);
      toast.success("Stiker berhasil dihapus");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card title="Paket & Perpustakaan Stiker Workspace" testid="stickers-admin">
      <div className="space-y-4">
        <p className="text-xs text-sub leading-relaxed">
          Kelola paket stiker dan perpustakaan stiker workspace CIRCLE. Anggota tim juga dapat membuat stiker custom sendiri secara langsung dari sticker picker di obrolan chat.
        </p>

        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama paket stiker baru (mis. Marketing Memes, Squad Reactions)"
            className={`${inp} flex-1 text-xs`}
            data-testid="pack-name-input"
          />
          <button
            type="button"
            onClick={handleCreatePack}
            className="btn-accent h-10 px-4 text-xs font-bold shrink-0"
            data-testid="pack-create-btn"
          >
            Buat Paket
          </button>
        </div>

        <div>
          <h4 className="text-xs font-bold text-sub mb-2">Paket Stiker Aktif ({data?.packs?.length || 0}):</h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(data?.packs || []).map((p) => {
              const count = (data?.stickers || []).filter((s) => s.pack_id === p.id || s.category === p.category).length;
              return (
                <li key={p.id} className="rounded-xl border bg-surface2 px-3 py-2 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-ink">{p.name}</span>
                    <span className="ml-1.5 text-[11px] text-sub">({count} stiker)</span>
                  </div>
                  <span className="text-[10px] font-semibold text-sub rounded-full bg-surface px-2 py-0.5 border">
                    {p.workspace_id === "global" ? "Bawaan Sistem" : "Paket Custom"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Custom Stickers Section */}
        <div>
          <h4 className="text-xs font-bold text-sub mb-2">Total Stiker Tersedia ({(data?.stickers || []).length}):</h4>
          <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto p-2 rounded-xl border bg-surface2/30">
            {(data?.stickers || []).map((s) => (
              <div key={s.id} className="relative group flex items-center justify-center p-1.5 rounded-xl border bg-surface shadow-2xs">
                {s.file_id ? (
                  <img src={fileUrl(s.file_id)} alt={s.name} className="h-7 w-7 rounded-lg object-cover" />
                ) : (
                  <span className="text-2xl">{s.emoji || "✨"}</span>
                )}
                <span className="text-[9px] font-extrabold max-w-[70px] truncate ml-1 text-ink">{s.name}</span>
                {(s.category === "Custom" || s.category === "Kustom" || s.pack_id === "pk_custom") && (
                  <button
                    type="button"
                    onClick={() => handleDeleteSticker(s.id)}
                    className="ml-1 text-sub hover:text-rose-500 text-xs font-bold"
                    title="Hapus stiker"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AssistantBranding() {
  const { ws, reloadWs, isAdmin } = useApp();
  const [name, setName] = useState(ws.assistant_name || "Circle");
  const [avatar, setAvatar] = useState(ws.assistant_avatar || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setName(ws.assistant_name || "Circle");
    setAvatar(ws.assistant_avatar || "");
  }, [ws]);

  if (!isAdmin) return null;

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadFile(file);
      const fileId = res.id || res.file_id || res.data?.id;
      if (!fileId) throw new Error("ID file tidak ditemukan.");
      const uploadedUrl = fileUrl(fileId);
      setAvatar(uploadedUrl);
      await api.patch("/workspace", { assistant_avatar: uploadedUrl });
      toast.success("Foto profil chatbot berhasil diperbarui & disimpan!");
      reloadWs();
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengunggah foto"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleReset = async () => {
    setAvatar("");
    try {
      await api.patch("/workspace", { assistant_avatar: "" });
      toast.success("Foto profil dikembalikan ke default");
      reloadWs();
    } catch (e) {
      toast.error(errMsg(e, "Gagal mereset foto profil"));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/workspace", { assistant_name: name, assistant_avatar: avatar });
      toast.success("Pengaturan Circle Assistant berhasil disimpan!");
      reloadWs();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const defaultAvatar = "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364";
  const displayAvatar = avatar || defaultAvatar;

  return (
    <Card title="Pengaturan Circle Assistant" testid="assistant-branding-card">
      {/* Bot Avatar Section - Matches Workspace Identity & Branding card style */}
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border bg-surface2/50 p-4">
        <img
          src={displayAvatar}
          alt={name}
          className="h-14 w-14 rounded-2xl object-cover shadow-sm border bg-surface"
          onError={(e) => { e.currentTarget.src = defaultAvatar; }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Foto Profil / Avatar Assistant</p>
          <p className="text-xs text-sub">Foto profil asisten AI yang muncul pada obrolan pesan, notifikasi, dan tugas.</p>
          <div className="mt-2 flex items-center gap-3">
            <input type="file" ref={fileInputRef} onChange={handleUpload} accept="image/*" className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="cursor-pointer rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              data-testid="upload-bot-avatar-btn"
            >
              {uploading ? "Mengunggah..." : "Ubah Foto Profil Bot"}
            </button>
            {avatar && (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-sub hover:underline"
                data-testid="reset-bot-avatar-btn"
              >
                Pakai Default
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bot Name & Save Settings */}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-sub">Nama Circle Assistant</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mis. Circle, Assistant, Soni"
            className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none font-medium"
            data-testid="assistant-name-input"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || uploading}
          className="btn-accent h-10 px-5 rounded-xl text-xs font-bold disabled:opacity-50"
          data-testid="assistant-save-btn"
        >
          {saving ? "Menyimpan..." : "Simpan Perubahan Assistant"}
        </button>
      </div>
    </Card>
  );
}

export function MarketplaceSettingsCard({ compact = false }) {
  const { me, ws, setSession, reloadWs, subscribe } = useApp();
  const isSuperAdmin = me?.role === "super_admin";
  const enabled = ws?.marketplace_enabled !== false;

  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [simulatingWh, setSimulatingWh] = useState(false);
  const [copiedWhUrl, setCopiedWhUrl] = useState(false);
  const [copyTab, setCopyTab] = useState("header_nav");
  const bannerFileRef = useRef(null);
  const [stats, setStats] = useState(() => getCachedMarketplaceStats());
  const [gwInfo, setGwInfo] = useState(() => getCachedGatewayInfo());

  const buildMergedConfig = (rawCfg) => ({
    ...DEFAULT_MARKETPLACE_COPYWRITING,
    ...(rawCfg || {}),
    banner_enabled: rawCfg?.banner_enabled !== false,
    banner_image_url: rawCfg?.banner_image_url || "",
    banner_overlay_style: rawCfg?.banner_overlay_style || "dark_slate",
    allow_qris: rawCfg?.allow_qris !== false,
    allow_bank_transfer: rawCfg?.allow_bank_transfer !== false,
    allow_ewallet: rawCfg?.allow_ewallet !== false,
    allow_payroll: rawCfg?.allow_payroll !== false,
    allow_cod: rawCfg?.allow_cod !== false,
    platform_fee_pct: Number(rawCfg?.platform_fee_pct ?? 0),
    payment_gateway_enabled: rawCfg?.payment_gateway_enabled !== false,
    payment_gateway_provider: rawCfg?.payment_gateway_provider || "midtrans",
    payment_gateway_env: rawCfg?.payment_gateway_env || "sandbox",
    payment_gateway_mode: rawCfg?.payment_gateway_mode || "snap_popup",
    payment_gateway_auto_verify: rawCfg?.payment_gateway_auto_verify !== false,
    payment_expiry_minutes: Number(rawCfg?.payment_expiry_minutes ?? 60),
  });

  const [cfg, setCfg] = useState(() => buildMergedConfig(ws?.marketplace_config));

  useEffect(() => {
    setCfg(buildMergedConfig(ws?.marketplace_config));
  }, [ws?.marketplace_config]);

  const refreshStats = () => {
    if (!isSuperAdmin) return;
    api
      .get("/marketplace/config")
      .then((r) => {
        if (r.data?.stats) {
          setCachedMarketplaceStats(r.data.stats);
          setStats(r.data.stats);
        }
        if (r.data?.payment_gateway || r.data?.webhook_logs) {
          const nextGw = {
            payment_gateway: r.data.payment_gateway || gwInfo.payment_gateway,
            webhook_logs: r.data.webhook_logs || gwInfo.webhook_logs,
          };
          setCachedGatewayInfo(nextGw);
          setGwInfo(nextGw);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshStats();
  }, [isSuperAdmin, enabled]);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((evt) => {
      if (evt.type === "marketplace:changed") refreshStats();
    });
  }, [subscribe, isSuperAdmin]);

  if (!isSuperAdmin) return null;

  const applyOptimisticWs = (patch) => {
    setSession((s) => {
      if (!s) return s;
      const nextWs = { ...(s.workspace || {}), ...patch };
      return { ...s, workspace: nextWs };
    });
  };

  const handleToggleEnabled = async (nextVal) => {
    if (togglingEnabled) return;
    const boolVal = Boolean(nextVal);
    setTogglingEnabled(true);
    // 0ms optimistic update so UI + Sidebar respond immediately
    applyOptimisticWs({ marketplace_enabled: boolVal });
    reconcileMarketplaceEnabledCache(me?.user_id, boolVal);
    toast.success(
      boolVal
        ? "Fitur Marketplace Karyawan diaktifkan untuk seluruh tim!"
        : "Fitur Marketplace Karyawan dinonaktifkan sementara."
    );
    try {
      const { data } = await api.patch("/workspace", { marketplace_enabled: boolVal });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      }
      prefetchMarketplaceState(me?.user_id).catch(() => null);
      syncWorkspaceMirror(api, true).catch(() => {});
    } catch (e) {
      applyOptimisticWs({ marketplace_enabled: !boolVal });
      reconcileMarketplaceEnabledCache(me?.user_id, !boolVal);
      toast.error(errMsg(e, "Gagal mengubah status Marketplace"));
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleInstantConfigField = async (patch) => {
    const nextCfg = {
      ...cfg,
      ...patch,
      platform_fee_pct: Math.max(0, Math.min(15, Number((patch.platform_fee_pct ?? cfg.platform_fee_pct) || 0))),
      payment_expiry_minutes: Math.max(
        5,
        Math.min(1440, Number((patch.payment_expiry_minutes ?? cfg.payment_expiry_minutes) || 60))
      ),
    };
    setCfg(nextCfg);
    applyOptimisticWs({ marketplace_config: nextCfg });
    reconcileMarketplaceEnabledCache(me?.user_id, ws?.marketplace_enabled !== false, nextCfg);
    try {
      const { data } = await api.patch("/workspace", { marketplace_config: nextCfg });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
      }
      refreshStats();
      syncWorkspaceMirror(api, true).catch(() => {});
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui konfigurasi Marketplace"));
    }
  };

  const handleTogglePaymentKey = (key, nextVal) => {
    handleInstantConfigField({ [key]: Boolean(nextVal) });
  };

  const handleBannerImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pilih file gambar (JPG, PNG, atau WebP).");
      return;
    }
    setUploadingBanner(true);
    try {
      // Read instant data URL for 0ms preview & fallback
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (dataUrl) {
        setCfg((prev) => ({ ...prev, banner_image_url: dataUrl }));
        applyOptimisticWs({
          marketplace_config: { ...cfg, banner_image_url: dataUrl },
        });
      }
      try {
        const uploaded = await uploadFile(file);
        const finalRef = uploaded?.id ? fileUrl(uploaded.id) : dataUrl;
        await handleInstantConfigField({ banner_image_url: finalRef });
        toast.success("Gambar Hero Banner berhasil diperbarui!");
      } catch {
        // Fallback to dataUrl if upload endpoint fails
        await handleInstantConfigField({ banner_image_url: dataUrl });
        toast.success("Gambar Hero Banner berhasil diterapkan!");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah gambar banner"));
    } finally {
      setUploadingBanner(false);
      if (bannerFileRef.current) bannerFileRef.current.value = "";
    }
  };

  const handleResetBannerDefaults = () => {
    handleInstantConfigField({
      banner_enabled: true,
      banner_kicker: DEFAULT_MARKETPLACE_COPYWRITING.banner_kicker,
      banner_title: DEFAULT_MARKETPLACE_COPYWRITING.banner_title,
      banner_subtitle: DEFAULT_MARKETPLACE_COPYWRITING.banner_subtitle,
      banner_promo_prefix: DEFAULT_MARKETPLACE_COPYWRITING.banner_promo_prefix,
      banner_promo_code: DEFAULT_MARKETPLACE_COPYWRITING.banner_promo_code,
      banner_promo_text: DEFAULT_MARKETPLACE_COPYWRITING.banner_promo_text,
      banner_image_url: "",
      banner_overlay_style: "dark_slate",
    });
    toast.success("Hero Banner dikembalikan ke tampilan default.");
  };

  const handleResetAllMarketplaceCopywriting = async () => {
    const nextCfg = { ...cfg, ...DEFAULT_MARKETPLACE_COPYWRITING };
    const nextCustomCopy = { ...(ws?.custom_copywriting || {}) };
    Object.keys(DEFAULT_MARKETPLACE_COPYWRITING).forEach((k) => {
      delete nextCustomCopy[`mkt_${k}`];
    });
    setCfg(nextCfg);
    applyOptimisticWs({ marketplace_config: nextCfg, custom_copywriting: nextCustomCopy });
    reconcileMarketplaceEnabledCache(me?.user_id, ws?.marketplace_enabled !== false, nextCfg);
    try {
      const { data } = await api.patch("/workspace", {
        marketplace_config: nextCfg,
        custom_copywriting: nextCustomCopy,
      });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      }
      toast.success("Seluruh copywriting Marketplace dikembalikan ke default.");
      refreshStats();
      syncWorkspaceMirror(api, true).catch(() => {});
    } catch (err) {
      toast.error(errMsg(err, "Gagal mereset copywriting Marketplace"));
    }
  };

  const handleSaveConfig = async (e) => {
    e?.preventDefault();
    const nextCfg = {
      ...cfg,
      platform_fee_pct: Math.max(0, Math.min(15, Number(cfg.platform_fee_pct || 0))),
      payment_expiry_minutes: Math.max(5, Math.min(1440, Number(cfg.payment_expiry_minutes || 60))),
    };
    // Also sync mkt_* keys into workspace.custom_copywriting so both Settings tabs stay 100% synced
    const nextCustomCopy = { ...(ws?.custom_copywriting || {}) };
    Object.keys(DEFAULT_MARKETPLACE_COPYWRITING).forEach((k) => {
      const mktKey = `mkt_${k}`;
      if (nextCfg[k] !== undefined && nextCfg[k] !== DEFAULT_MARKETPLACE_COPYWRITING[k]) {
        nextCustomCopy[mktKey] = String(nextCfg[k]);
      } else {
        delete nextCustomCopy[mktKey];
      }
    });
    applyOptimisticWs({ marketplace_config: nextCfg, custom_copywriting: nextCustomCopy });
    setSaving(true);
    try {
      const { data } = await api.patch("/workspace", {
        marketplace_config: nextCfg,
        custom_copywriting: nextCustomCopy,
      });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      } else {
        reloadWs();
      }
      toast.success("Seluruh pengaturan & copywriting Marketplace berhasil disimpan!");
      refreshStats();
      syncWorkspaceMirror(api, true).catch(() => {});
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan pengaturan Marketplace"));
    } finally {
      setSaving(false);
    }
  };

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/marketplace/webhooks/${
          cfg.payment_gateway_provider === "midtrans" ? "midtrans" : "payment"
        }`
      : "/api/marketplace/webhooks/midtrans";

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWhUrl(true);
      toast.success("URL Webhook Payment Gateway berhasil disalin!");
      setTimeout(() => setCopiedWhUrl(false), 1800);
    } catch {}
  };

  const handleSimulateWebhook = async (statusType = "settlement") => {
    const provider = cfg.payment_gateway_provider || "midtrans";
    const now = new Date().toISOString();
    const optimisticLog = {
      id: `wh_opt_${Date.now()}`,
      provider,
      event_type: `payment.${statusType}`,
      order_number: `ORD-SIM-${Date.now().toString().slice(-4)}`,
      transaction_status: statusType,
      payment_type: "qris",
      gross_amount: 95000,
      status_code: "200",
      verified_signature: true,
      message: `Simulasi Webhook ${provider.toUpperCase()} (${statusType.toUpperCase()}) berhasil diterima (200 OK).`,
      created_at: now,
    };

    // 0ms optimistic log prepend
    const nextGw = {
      ...gwInfo,
      webhook_logs: [optimisticLog, ...(gwInfo?.webhook_logs || [])].slice(0, 15),
    };
    setGwInfo(nextGw);
    setCachedGatewayInfo(nextGw);
    toast.success(`Webhook ${provider.toUpperCase()} (${statusType.toUpperCase()}) berhasil disimulasikan!`);

    setSimulatingWh(true);
    try {
      const { data } = await api.post("/marketplace/payment-gateway/simulate-webhook", {
        transaction_status: statusType,
        provider,
      });
      if (data?.webhook_logs) {
        const synced = { ...gwInfo, webhook_logs: data.webhook_logs };
        setGwInfo(synced);
        setCachedGatewayInfo(synced);
      }
      refreshStats();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menjalankan simulasi webhook"));
    } finally {
      setSimulatingWh(false);
    }
  };

  const envDetected = gwInfo?.payment_gateway?.env_vars_detected || {};
  const isLiveKeyReady =
    cfg.payment_gateway_provider === "midtrans"
      ? Boolean(envDetected.MIDTRANS_SERVER_KEY)
      : cfg.payment_gateway_provider === "xendit"
      ? Boolean(envDetected.XENDIT_SECRET_KEY)
      : cfg.payment_gateway_provider === "doku"
      ? Boolean(envDetected.DOKU_SECRET_KEY)
      : false;

  return (
    <Card title="Marketplace Karyawan (Kontrol Super Admin)" testid="marketplace-settings-card">
      <div className="space-y-4">
        {/* Primary On/Off Control */}
        <div className="flex items-center justify-between gap-4 rounded-2xl border bg-surface2/60 p-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-ink">Status Fitur Marketplace</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                  enabled
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
                data-testid="marketplace-status-badge"
              >
                {enabled ? "Aktif (ON)" : "Nonaktif (OFF)"}
              </span>
            </div>
            <p className="text-xs text-sub leading-relaxed">
              {enabled
                ? "Menu Marketplace tampil di sidebar seluruh karyawan dan transaksi jual-beli diizinkan."
                : "Menu Marketplace disembunyikan dari sidebar karyawan dan akses transaksi ditutup sementara tanpa menghapus data."}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={togglingEnabled}
            onCheckedChange={handleToggleEnabled}
            data-testid="marketplace-enabled-switch"
          />
        </div>

        {/* Instant 0ms Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-2xl border bg-surface2/40 p-3">
            <p className="text-[11px] font-semibold text-sub">Produk Aktif</p>
            <p className="mt-1 text-xl font-extrabold text-ink tabular-nums">{stats?.active_listings ?? 4}</p>
          </div>
          <div className="rounded-2xl border bg-surface2/40 p-3">
            <p className="text-[11px] font-semibold text-sub">Total Pesanan</p>
            <p className="mt-1 text-xl font-extrabold text-ink tabular-nums">{stats?.total_orders ?? 0}</p>
          </div>
          <div className="rounded-2xl border bg-surface2/40 p-3">
            <p className="text-[11px] font-semibold text-sub">Perlu Verifikasi</p>
            <p className="mt-1 text-xl font-extrabold text-brand tabular-nums">{stats?.pending_verification ?? 0}</p>
          </div>
          <div className="rounded-2xl border bg-surface2/40 p-3">
            <p className="text-[11px] font-semibold text-sub">Total Transaksi</p>
            <p className="mt-1 text-lg font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
              Rp {Math.round(Number(stats?.gmv || 0)).toLocaleString("id-ID")}
            </p>
          </div>
        </div>

        {!compact && (
          <form onSubmit={handleSaveConfig} className="space-y-5 pt-2 border-t">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-sub">
                Nama Etalase Marketplace
                <input
                  value={cfg.store_name}
                  onChange={(e) => setCfg({ ...cfg, store_name: e.target.value })}
                  className={`${inp} mt-1 w-full`}
                  data-testid="marketplace-store-name-input"
                />
              </label>
              <label className="text-xs font-semibold text-sub">
                Biaya Admin / Platform (%)
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={cfg.platform_fee_pct}
                  onChange={(e) => setCfg({ ...cfg, platform_fee_pct: e.target.value })}
                  className={`${inp} mt-1 w-full tabular-nums`}
                />
              </label>
            </div>

            <label className="block text-xs font-semibold text-sub">
              Tagline Marketplace
              <input
                value={cfg.store_tagline}
                onChange={(e) => setCfg({ ...cfg, store_tagline: e.target.value })}
                className={`${inp} mt-1 w-full`}
              />
            </label>

            {/* Hero Banner Customization (Clean, Minimalist & Live Preview) */}
            <div
              className="rounded-2xl border bg-surface2/30 p-4 space-y-3.5"
              data-testid="marketplace-banner-customizer"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink">
                      Kustomisasi Hero Banner Marketplace
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                        cfg.banner_enabled !== false
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {cfg.banner_enabled !== false ? "Tampil di Beranda" : "Disembunyikan"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-sub">
                    Sesuaikan gambar latar, teks utama, dan kode promo pada banner utama halaman Jelajahi Marketplace.
                  </p>
                </div>
                <Switch
                  checked={cfg.banner_enabled !== false}
                  onCheckedChange={(v) => handleInstantConfigField({ banner_enabled: Boolean(v) })}
                  data-testid="marketplace-banner-enabled-switch"
                />
              </div>

              {cfg.banner_enabled !== false && (
                <div className="space-y-3.5 pt-3 border-t">
                  {/* Live Banner Preview */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sub">
                        Live Preview Banner
                      </span>
                      <button
                        type="button"
                        onClick={handleResetBannerDefaults}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sub hover:text-ink cursor-pointer"
                        data-testid="marketplace-banner-reset-btn"
                      >
                        <RefreshCw size={11} />
                        <span>Reset Default</span>
                      </button>
                    </div>

                    <div
                      className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-900"
                      data-testid="marketplace-banner-preview"
                    >
                      <img
                        src={resolveMarketplaceBannerImage(cfg.banner_image_url)}
                        alt="Preview Hero Banner Marketplace"
                        className="h-40 sm:h-48 w-full object-cover opacity-80"
                      />
                      <div
                        className={`absolute inset-0 bg-gradient-to-r ${
                          resolveMarketplaceBannerOverlay(cfg.banner_overlay_style).overlayClass
                        } flex items-center p-4 sm:p-6`}
                      >
                        <div className="max-w-lg space-y-1.5 text-white">
                          {cfg.banner_kicker && (
                            <p
                              className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-widest ${
                                resolveMarketplaceBannerOverlay(cfg.banner_overlay_style).kickerClass
                              }`}
                            >
                              {cfg.banner_kicker}
                            </p>
                          )}
                          <h4 className="text-lg sm:text-2xl font-extrabold leading-tight">
                            {cfg.banner_title || "Temukan Produk Pilihan & Jasa Rekan Kantor"}
                          </h4>
                          {(cfg.banner_subtitle || cfg.banner_promo_code || cfg.banner_promo_text) && (
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {cfg.banner_subtitle}
                              {cfg.banner_promo_code ? (
                                <>
                                  {cfg.banner_subtitle ? " " : ""}
                                  {cfg.banner_promo_prefix ? `${cfg.banner_promo_prefix} ` : ""}
                                  <strong className="font-mono text-white">
                                    {cfg.banner_promo_code}
                                  </strong>
                                  {cfg.banner_promo_text ? ` ${cfg.banner_promo_text}` : ""}
                                </>
                              ) : cfg.banner_promo_text ? (
                                <>
                                  {cfg.banner_subtitle ? " " : ""}
                                  {cfg.banner_promo_text}
                                </>
                              ) : null}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Image Picker & Theme Overlay */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-sub">
                      Preset Gambar Latar
                      <AppSelect
                        value={
                          BANNER_IMAGE_PRESETS.some((p) => p.key === cfg.banner_image_url)
                            ? cfg.banner_image_url
                            : cfg.banner_image_url
                            ? "custom"
                            : "preset_default"
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "custom") return;
                          handleInstantConfigField({
                            banner_image_url: val === "preset_default" ? "" : val,
                          });
                        }}
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                        data-testid="marketplace-banner-preset-select"
                      >
                        {BANNER_IMAGE_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                        {cfg.banner_image_url &&
                          !BANNER_IMAGE_PRESETS.some((p) => p.key === cfg.banner_image_url) && (
                            <option value="custom">Gambar Kustom (Diunggah)</option>
                          )}
                      </AppSelect>
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Tema Gradasi Overlay
                      <AppSelect
                        value={cfg.banner_overlay_style || "dark_slate"}
                        onChange={(e) =>
                          handleInstantConfigField({ banner_overlay_style: e.target.value })
                        }
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                        data-testid="marketplace-banner-overlay-select"
                      >
                        {BANNER_OVERLAY_STYLES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  </div>

                  {/* Upload Custom Image Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink">Unggah Foto Banner Kustom</p>
                      <p className="text-[11px] text-sub truncate">
                        Rekomendasi rasio landscape 16:5 (JPG, PNG, atau WebP).
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        ref={bannerFileRef}
                        type="file"
                        accept="image/*"
                        onChange={handleBannerImageUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={uploadingBanner}
                        onClick={() => bannerFileRef.current?.click()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-surface2 px-3 text-xs font-bold text-ink hover:bg-surface cursor-pointer disabled:opacity-50"
                        data-testid="marketplace-banner-upload-btn"
                      >
                        <Upload size={13} />
                        <span>{uploadingBanner ? "Mengunggah..." : "Upload Gambar"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Text Customization Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-sub">
                      Label Atas (Kicker)
                      <input
                        value={cfg.banner_kicker}
                        onChange={(e) => setCfg({ ...cfg, banner_kicker: e.target.value })}
                        placeholder="INTERNAL EMPLOYEE EXCHANGE"
                        className={`${inp} mt-1 w-full`}
                        data-testid="marketplace-banner-kicker-input"
                      />
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Judul Utama Banner (Headline)
                      <input
                        value={cfg.banner_title}
                        onChange={(e) => setCfg({ ...cfg, banner_title: e.target.value })}
                        placeholder="Temukan Produk Pilihan & Jasa Rekan Kantor"
                        className={`${inp} mt-1 w-full`}
                        data-testid="marketplace-banner-title-input"
                      />
                    </label>
                  </div>

                  <label className="block text-xs font-semibold text-sub">
                    Deskripsi / Subjudul Banner
                    <input
                      value={cfg.banner_subtitle}
                      onChange={(e) => setCfg({ ...cfg, banner_subtitle: e.target.value })}
                      placeholder="Dukung sesama tim lewat transaksi QRIS, Virtual Account, E-Wallet, atau COD antar-meja."
                      className={`${inp} mt-1 w-full`}
                      data-testid="marketplace-banner-subtitle-input"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="text-xs font-semibold text-sub">
                      Teks Pengantar Promo
                      <input
                        value={cfg.banner_promo_prefix}
                        onChange={(e) => setCfg({ ...cfg, banner_promo_prefix: e.target.value })}
                        placeholder="Kode"
                        className={`${inp} mt-1 w-full`}
                        data-testid="marketplace-banner-promo-prefix-input"
                      />
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Highlight Kode Voucher (Opsional)
                      <input
                        value={cfg.banner_promo_code}
                        onChange={(e) =>
                          setCfg({ ...cfg, banner_promo_code: e.target.value.toUpperCase() })
                        }
                        placeholder="TEMANKANTOR"
                        className={`${inp} mt-1 w-full font-mono`}
                        data-testid="marketplace-banner-promo-code-input"
                      />
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Keterangan Promo Voucher
                      <input
                        value={cfg.banner_promo_text}
                        onChange={(e) => setCfg({ ...cfg, banner_promo_text: e.target.value })}
                        placeholder="diskon 10%."
                        className={`${inp} mt-1 w-full`}
                        data-testid="marketplace-banner-promo-text-input"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Full Marketplace Copywriting Editor (Super Admin Only) */}
            <div
              className="rounded-2xl border bg-surface2/30 p-4 space-y-3.5"
              data-testid="marketplace-copywriting-customizer"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink">
                      Kustomisasi Seluruh Copywriting Marketplace
                    </span>
                    <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand whitespace-nowrap">
                      Khusus Super Admin
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-sub">
                    Ubah seluruh teks tombol, tab navigasi, placeholder pencarian, Toko Saya, keranjang, hingga pesan status kosong.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleResetAllMarketplaceCopywriting}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border bg-surface px-2.5 text-[11px] font-bold text-sub hover:text-ink cursor-pointer shrink-0"
                  data-testid="marketplace-copywriting-reset-btn"
                >
                  <RefreshCw size={11} />
                  <span>Reset Default Teks</span>
                </button>
              </div>

              {/* Copywriting Category Sub-Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
                {[
                  { id: "header_nav", label: "Header, Tab & Tombol" },
                  { id: "seller_cart", label: "Toko Saya & Keranjang" },
                  { id: "empty_disabled", label: "Status Kosong & Nonaktif" },
                ].map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => setCopyTab(ct.id)}
                    className={`h-8 shrink-0 rounded-xl px-3 text-xs font-bold transition-colors cursor-pointer ${
                      copyTab === ct.id
                        ? "bg-ink text-surface"
                        : "border bg-surface text-sub hover:text-ink"
                    }`}
                    data-testid={`marketplace-copy-tab-${ct.id}`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>

              {copyTab === "header_nav" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    ["cart_btn_label", "Tombol Keranjang (Header)"],
                    ["sell_btn_label", "Tombol Jual Barang / Jasa (Header)"],
                    ["tab_explore_label", "Label Tab 1 (Jelajahi)"],
                    ["tab_orders_label", "Label Tab 2 (Pesanan Saya)"],
                    ["tab_seller_label", "Label Tab 3 (Toko Saya)"],
                    ["tab_wishlist_label", "Label Tab 4 (Favorit)"],
                    ["add_to_cart_label", "Tombol Tambah ke Keranjang (Kartu Produk)"],
                    ["sold_out_label", "Badge Stok Habis (Kartu Produk)"],
                  ].map(([k, label]) => (
                    <label key={k} className="text-xs font-semibold text-sub">
                      {label}
                      <input
                        value={cfg[k] ?? ""}
                        onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                        placeholder={DEFAULT_MARKETPLACE_COPYWRITING[k]}
                        className={`${inp} mt-1 w-full`}
                        data-testid={`marketplace-copy-${k}`}
                      />
                    </label>
                  ))}
                  <label className="sm:col-span-2 text-xs font-semibold text-sub">
                    Placeholder Kolom Pencarian Produk
                    <input
                      value={cfg.search_placeholder ?? ""}
                      onChange={(e) => setCfg({ ...cfg, search_placeholder: e.target.value })}
                      placeholder={DEFAULT_MARKETPLACE_COPYWRITING.search_placeholder}
                      className={`${inp} mt-1 w-full`}
                      data-testid="marketplace-copy-search_placeholder"
                    />
                  </label>
                </div>
              )}

              {copyTab === "seller_cart" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    ["seller_kpi_products_label", "KPI 1 Toko Saya (Produk Saya)"],
                    ["seller_kpi_pending_label", "KPI 2 Toko Saya (Pesanan Perlu Diproses)"],
                    ["seller_kpi_revenue_label", "KPI 3 Toko Saya (Total Omzet Toko)"],
                    ["seller_incoming_title", "Judul Seksi Pesanan Masuk"],
                    ["seller_catalog_title", "Judul Seksi Etalase Produk Saya"],
                    ["seller_add_product_btn", "Tombol Tambah Produk (Toko Saya)"],
                    ["cart_drawer_title", "Judul Panel Keranjang Belanja"],
                    ["cart_checkout_btn", "Tombol Lanjut ke Pembayaran (Keranjang)"],
                  ].map(([k, label]) => (
                    <label key={k} className="text-xs font-semibold text-sub">
                      {label}
                      <input
                        value={cfg[k] ?? ""}
                        onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                        placeholder={DEFAULT_MARKETPLACE_COPYWRITING[k]}
                        className={`${inp} mt-1 w-full`}
                        data-testid={`marketplace-copy-${k}`}
                      />
                    </label>
                  ))}
                </div>
              )}

              {copyTab === "empty_disabled" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    ["empty_explore_title", "Judul Produk Tidak Ditemukan"],
                    ["empty_wishlist_title", "Judul Favorit Kosong"],
                    ["empty_explore_subtitle", "Subjudul Produk Tidak Ditemukan"],
                    ["empty_orders_title", "Judul Pesanan Pembelian Kosong"],
                    ["empty_orders_subtitle", "Subjudul Pesanan Pembelian Kosong"],
                    ["empty_orders_cta", "Tombol Aksi Saat Pesanan Kosong"],
                    ["seller_incoming_empty", "Teks Pesanan Masuk Kosong (Toko Saya)"],
                    ["seller_catalog_empty_title", "Judul Etalase Produk Saya Kosong"],
                    ["seller_catalog_empty_subtitle", "Subjudul Etalase Produk Saya Kosong"],
                    ["cart_empty_title", "Judul Keranjang Kosong"],
                    ["cart_empty_subtitle", "Subjudul Keranjang Kosong"],
                    ["disabled_title", "Judul Saat Marketplace Dinonaktifkan"],
                  ].map(([k, label]) => (
                    <label key={k} className="text-xs font-semibold text-sub">
                      {label}
                      <input
                        value={cfg[k] ?? ""}
                        onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                        placeholder={DEFAULT_MARKETPLACE_COPYWRITING[k]}
                        className={`${inp} mt-1 w-full`}
                        data-testid={`marketplace-copy-${k}`}
                      />
                    </label>
                  ))}
                  <label className="sm:col-span-2 text-xs font-semibold text-sub">
                    Deskripsi Saat Marketplace Dinonaktifkan
                    <input
                      value={cfg.disabled_subtitle ?? ""}
                      onChange={(e) => setCfg({ ...cfg, disabled_subtitle: e.target.value })}
                      placeholder={DEFAULT_MARKETPLACE_COPYWRITING.disabled_subtitle}
                      className={`${inp} mt-1 w-full`}
                      data-testid="marketplace-copy-disabled_subtitle"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Payment Gateway Integration (Clean & Minimalist) */}
            <div className="rounded-2xl border bg-surface2/30 p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck size={15} className="text-brand shrink-0" />
                    <span className="text-sm font-bold text-ink">Payment Gateway</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                        cfg.payment_gateway_enabled
                          ? isLiveKeyReady
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-slate-200/80 text-ink dark:bg-slate-800 dark:text-slate-200"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {cfg.payment_gateway_enabled
                        ? isLiveKeyReady
                          ? "Live API"
                          : "Sandbox Simulator"
                        : "Nonaktif"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-sub">
                    Otomatis buat Snap Token, Virtual Account, QRIS dinamis, dan verifikasi pembayaran via Webhook.
                  </p>
                </div>
                <Switch
                  checked={Boolean(cfg.payment_gateway_enabled)}
                  onCheckedChange={(v) => handleInstantConfigField({ payment_gateway_enabled: v })}
                  data-testid="payment-gateway-enabled-switch"
                />
              </div>

              {cfg.payment_gateway_enabled && (
                <div className="space-y-3 pt-3 border-t">
                  {/* 2x2 Grid so select labels never truncate */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-sub">
                      Provider Gateway
                      <AppSelect
                        value={cfg.payment_gateway_provider}
                        onChange={(e) =>
                          handleInstantConfigField({ payment_gateway_provider: e.target.value })
                        }
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                        data-testid="pg-provider-select"
                      >
                        <option value="midtrans">Midtrans (Snap & Core API)</option>
                        <option value="xendit">Xendit Checkout</option>
                        <option value="doku">DOKU Jokul</option>
                        <option value="manual">Internal Escrow / Manual</option>
                      </AppSelect>
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Environment
                      <AppSelect
                        value={cfg.payment_gateway_env}
                        onChange={(e) =>
                          handleInstantConfigField({ payment_gateway_env: e.target.value })
                        }
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                        data-testid="pg-env-select"
                      >
                        <option value="sandbox">Sandbox (Testing)</option>
                        <option value="production">Production (Live)</option>
                      </AppSelect>
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Mode Checkout
                      <AppSelect
                        value={cfg.payment_gateway_mode}
                        onChange={(e) =>
                          handleInstantConfigField({ payment_gateway_mode: e.target.value })
                        }
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                        data-testid="pg-mode-select"
                      >
                        <option value="snap_popup">Snap Popup In-App</option>
                        <option value="core_api">Core API (Direct VA & QRIS)</option>
                        <option value="redirect">Redirect Payment Page</option>
                      </AppSelect>
                    </label>

                    <label className="text-xs font-semibold text-sub">
                      Batas Waktu Bayar
                      <AppSelect
                        value={String(cfg.payment_expiry_minutes || 60)}
                        onChange={(e) =>
                          handleInstantConfigField({
                            payment_expiry_minutes: Number(e.target.value),
                          })
                        }
                        className={`${inp} mt-1 w-full text-xs font-semibold`}
                      >
                        <option value="15">15 Menit</option>
                        <option value="30">30 Menit</option>
                        <option value="60">60 Menit (1 Jam)</option>
                        <option value="1440">24 Jam</option>
                      </AppSelect>
                    </label>
                  </div>

                  {/* Auto-verify toggle (strictly single-row right-aligned switch) */}
                  <label className="flex items-center justify-between gap-4 rounded-xl border bg-surface px-3.5 py-2.5 cursor-pointer">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink">Auto-Verifikasi Lunas via Webhook</p>
                      <p className="text-[11px] text-sub truncate">
                        Otomatis proses pesanan saat status <code className="font-mono">settlement</code> diterima.
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(cfg.payment_gateway_auto_verify)}
                      onCheckedChange={(v) =>
                        handleInstantConfigField({ payment_gateway_auto_verify: v })
                      }
                      data-testid="pg-auto-verify-switch"
                    />
                  </label>

                  {/* Compact Webhook URL Copy Bar */}
                  <div className="flex items-center gap-2 rounded-xl border bg-surface px-3 py-2">
                    <Webhook size={14} className="text-sub shrink-0" />
                    <span className="text-[11px] font-semibold text-sub shrink-0">Webhook:</span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink select-all">
                      {webhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={copyWebhookUrl}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border bg-surface2 px-2.5 text-[11px] font-bold text-ink hover:bg-surface whitespace-nowrap shrink-0 cursor-pointer"
                      data-testid="copy-webhook-url-btn"
                    >
                      {copiedWhUrl ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copiedWhUrl ? "Disalin" : "Salin URL"}</span>
                    </button>
                  </div>

                  {/* Minimalist Env Status + Webhook Simulator Footer */}
                  <div className="rounded-xl border bg-surface p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                        <span
                          className="rounded-md bg-surface2 px-2 py-0.5 font-semibold text-ink border"
                          data-testid="env-midtrans-is-production"
                        >
                          MIDTRANS_IS_PRODUCTION={cfg.payment_gateway_env === "production" ? "true" : "false"}
                        </span>
                        <span className="rounded-md bg-surface2 px-2 py-0.5 text-sub border">
                          KEY: {envDetected.MIDTRANS_SERVER_KEY ? "LIVE" : "SANDBOX"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={simulatingWh}
                          onClick={() => handleSimulateWebhook("settlement")}
                          className="h-7 rounded-lg bg-ink text-surface hover:opacity-90 px-2.5 text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-50"
                          data-testid="simulate-webhook-settlement-btn"
                        >
                          <Zap size={11} />
                          <span>Tes Settlement</span>
                        </button>
                        <button
                          type="button"
                          disabled={simulatingWh}
                          onClick={() => handleSimulateWebhook("expire")}
                          className="h-7 rounded-lg border bg-surface2 hover:bg-surface px-2.5 text-[11px] font-semibold text-sub hover:text-ink whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          Tes Expire
                        </button>
                      </div>
                    </div>

                    {Array.isArray(gwInfo?.webhook_logs) && gwInfo.webhook_logs.length > 0 && (
                      <div className="divide-y rounded-lg border bg-surface2/30 px-2.5 text-[11px]">
                        {gwInfo.webhook_logs.slice(0, 2).map((log) => (
                          <div key={log.id} className="py-1.5 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 flex items-center gap-2">
                              <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
                                {log.status_code} · {log.transaction_status}
                              </span>
                              <span className="text-sub truncate">{log.message}</span>
                            </div>
                            <span className="text-[10px] text-sub font-mono whitespace-nowrap shrink-0">
                              {log.order_number}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <p className="text-xs font-bold text-ink">Metode Pembayaran yang Diizinkan</p>
              <div className="divide-y rounded-2xl border bg-surface2/30 px-3.5">
                {[
                  ["allow_qris", "QRIS Instan (Semua E-Wallet & Mobile Banking)"],
                  ["allow_bank_transfer", "Transfer Bank / Virtual Account (BCA, Mandiri, BNI, BRI)"],
                  ["allow_ewallet", "E-Wallet (GoPay, OVO, DANA, ShopeePay)"],
                  ["allow_payroll", "Potong Gaji / Kasbon Karyawan (Payroll)"],
                  ["allow_cod", "COD (Bayar di Tempat / Meja Kantor)"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 py-2.5 text-xs sm:text-sm cursor-pointer">
                    <span className="font-medium text-ink">{label}</span>
                    <Switch
                      checked={Boolean(cfg[key])}
                      onCheckedChange={(v) => handleTogglePaymentKey(key, v)}
                      data-testid={`marketplace-pm-${key}`}
                    />
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="btn-accent h-10 px-5 rounded-xl text-xs font-bold disabled:opacity-50 cursor-pointer"
              data-testid="marketplace-config-save-btn"
            >
              {saving ? "Menyimpan..." : "Simpan Pengaturan Marketplace"}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

