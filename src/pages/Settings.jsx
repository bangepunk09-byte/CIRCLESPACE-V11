import { useState, useEffect } from "react";
import { Settings as Cog, Sun, Moon, Monitor, Upload, Download, RotateCcw, FileSpreadsheet, Search, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { PageHeader } from "../components/common";
import { Switch } from "../components/ui/switch";
import ThemeEditor from "./settings/ThemeEditor";
import BackgroundEditor from "./settings/BackgroundEditor";
import { UserProfileSettings } from "./settings/UserProfileSettings";
import { Card, AdminOverview, PeopleAccess, WorkspaceBranding, DivisionsAdmin, ItemTypesAdmin, WeeklyReportCard, LabelsAdmin, StatusesAdmin, ProfileFieldsAdmin, StickersAdmin, AssistantBranding, MarketplaceSettingsCard } from "./settings/AdminPanels";
import { DEFAULT_COPYWRITING, COPYWRITING_GROUPS, getEffectiveCopywriting, cleanCopywritingMap, generateCopywritingCsv, parseCopywritingCsv } from "../lib/i18n";
import { DEFAULT_MARKETPLACE_COPYWRITING, reconcileMarketplaceEnabledCache } from "./marketplace/marketplaceStore";
import { playSound } from "../lib/sound";
import { PWAInstallButton } from "../components/PWAInstallButton";
import BackupRestorePanel, { prefetchBackupSummary } from "./settings/BackupRestorePanel";
import {
  getNotificationPermission,
  isStandalonePWA,
  isInIframe,
  enableSystemAndPushNotifications,
  showSystemNotification,
} from "../lib/systemNotifications";
import { BellRing, Smartphone, ExternalLink, ShieldAlert, CheckCircle2 } from "lucide-react";

const CATS = [["messages", "Pesan langsung & grup"], ["mentions", "Mention & tag"], ["calls", "Panggilan & panggilan tak terjawab"], ["tasks", "Penugasan, review & penyelesaian tugas"], ["deadlines", "Deadline mendekati & overdue"], ["polls", "Polling baru"], ["groups", "Undangan grup"], ["org", "Perubahan struktur organisasi"], ["beranda", "Beranda: balasan, suka & mention"]];

function Appearance() {
  const { prefs, savePrefs, isAdmin } = useApp();
  const [scope, setScope] = useState("personal");
  return (
    <div className="space-y-5">
      <Card title="Mode Tampilan" testid="theme-mode-card">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">{[["light", "Terang", Sun], ["dark", "Gelap", Moon], ["system", "Sistem", Monitor]].map(([k, l, I]) => <button type="button" key={k} onClick={() => { savePrefs({ theme_mode: k }); toast.success(`Mode tampilan diubah ke ${l}`); }} className={`flex h-16 sm:h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-xs sm:text-sm font-semibold ${(prefs.theme_mode || "light") === k ? "border-[var(--c-accent)] bg-soft-red" : ""}`} data-testid={`theme-mode-${k}`}><I size={18} />{l}</button>)}</div>
      </Card>
      <Card title="Editor Tema" testid="theme-editor-card">
        {isAdmin && <div className="mb-4 flex rounded-full border p-1 text-sm font-semibold w-fit">{[["personal", "Tema Pribadi"], ["workspace", "Tema Workspace"]].map(([k, l]) => <button type="button" key={k} onClick={() => setScope(k)} className={`rounded-full px-4 py-1.5 transition-colors cursor-pointer ${scope === k ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink"}`} data-testid={`theme-scope-${k}`}>{l}</button>)}</div>}
        <ThemeEditor key={scope} scope={scope} />
      </Card>
    </div>
  );
}

function NotificationPrefs() {
  const { prefs, savePrefs, showTopNotif } = useApp();
  const n = prefs.notifications || {};
  const [testing, setTesting] = useState(false);
  const [perm, setPerm] = useState(() => getNotificationPermission());
  const [enablingSys, setEnablingSys] = useState(false);
  const standalone = isStandalonePWA();
  const inIframe = isInIframe();

  const handleEnableSystemNotif = async () => {
    setEnablingSys(true);
    try {
      const res = await enableSystemAndPushNotifications(api);
      setPerm(res.permission);
      if (res.permission === "granted") {
        await showSystemNotification(
          {
            id: `welcome_sys_${Date.now()}`,
            title: "Notifikasi Sistem CIRCLE Aktif!",
            body: standalone
              ? "Mode PWA siap menerima notifikasi langsung ke perangkat Anda."
              : "Notifikasi sistem perangkat berhasil diaktifkan.",
            type: "system",
          },
          { force: true }
        );
        toast.success(
          res.pushSubscribed
            ? "Notifikasi sistem & Push PWA berhasil diaktifkan!"
            : "Notifikasi sistem berhasil diaktifkan!"
        );
      } else if (res.permission === "denied") {
        toast.error("Izin notifikasi diblokir oleh browser. Buka pengaturan situs browser untuk mengizinkannya.");
      } else {
        toast.info("Izin notifikasi belum disetujui.");
      }
    } catch {
      toast.error("Gagal meminta izin notifikasi sistem.");
    } finally {
      setEnablingSys(false);
    }
  };

  const triggerTest = async (mode) => {
    setTesting(true);
    let payload;

    // 1. Instantly render the popup via AppContext with complete actionable data
    if (mode === "access_request") {
      const demoId = `req_test_${Date.now()}`;
      payload = {
        id: `test_notif_${Date.now()}`,
        title: "Permintaan Akses Masuk Baru",
        body: "Jessica Iskandar (Marketing) mengajukan permohonan akses masuk",
        type: "access_request",
        category: "system",
        access_request: {
          id: demoId,
          name: "Jessica Iskandar",
          email: "jessica@asliri.id",
          department: "Marketing",
          job_title: "Brand Specialist",
          status: "pending"
        }
      };
    } else if (mode === "message") {
      payload = {
        id: `test_notif_${Date.now()}`,
        title: "Pesan Baru dari Budi Santoso",
        body: "Halo! Apakah dokumen spesifikasi proyek sudah siap di-review?",
        type: "dm",
        category: "messages",
        conversation_id: "conv_circle_user_admin1"
      };
    } else {
      payload = {
        id: `test_notif_${Date.now()}`,
        title: "Tugas Baru Ditugaskan",
        body: "Budi Santoso menugaskan 'Review Dokumen Desain' kepadamu.",
        type: "task_assigned",
        category: "tasks",
        task_id: "tsk_init_1"
      };
    }

    showTopNotif(payload);

    // 2. Also fire real System/OS Notification (works in PWA Standalone & Desktop/Mobile)
    await showSystemNotification(payload, { force: true });

    // 3. Play sound feedback immediately
    playSound("notification");

    // 4. Persist to server in background
    try {
      await api.post("/notifications/test", { mode });
    } catch (err) {
      console.warn("Server test notification warning:", err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PWAInstallButton variant="card" />
      <Card title="Notifikasi Sistem & Mode PWA" testid="pwa-system-notif-card">
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface2/60 p-3.5">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                perm === "granted"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : perm === "denied"
                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  : "bg-brand/10 text-brand"
              }`}>
                <BellRing size={19} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-ink">Status Notifikasi Perangkat</p>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                    perm === "granted"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : perm === "denied"
                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  }`} data-testid="system-notif-perm-badge">
                    {perm === "granted" ? "Aktif" : perm === "denied" ? "Diblokir Browser" : perm === "unsupported" ? "Tidak Didukung" : "Belum Diaktifkan"}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[10px] font-semibold text-sub whitespace-nowrap">
                    <Smartphone size={10} />
                    {standalone ? "Mode PWA" : "Mode Browser"}
                  </span>
                </div>
                <p className="text-[11px] text-sub leading-relaxed">
                  {perm === "granted"
                    ? "Notifikasi masuk melalui Service Worker PWA sehingga tetap tampil di bar notifikasi HP/Desktop saat aplikasi diminimize atau berjalan di latar belakang."
                    : perm === "denied"
                    ? "Izin notifikasi sedang diblokir di browser. Klik ikon gembok di sebelah URL lalu ubah Notifikasi menjadi Izinkan."
                    : "Aktifkan izin agar pesan baru, approval, dan tugas tetap muncul sebagai notifikasi sistem perangkat."}
                </p>
              </div>
            </div>

            {perm !== "granted" && perm !== "unsupported" && (
              <button
                type="button"
                disabled={enablingSys}
                onClick={handleEnableSystemNotif}
                className="btn-accent h-9 rounded-xl px-4 text-xs font-bold shadow-xs shrink-0 cursor-pointer disabled:opacity-50"
                data-testid="enable-system-notif-btn"
              >
                {enablingSys ? "Meminta Izin..." : "Aktifkan Notifikasi Sistem"}
              </button>
            )}
            {perm === "granted" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 size={16} /> Terhubung
              </span>
            )}
          </div>

          {inIframe && perm !== "granted" && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-[11px] text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <ShieldAlert size={15} className="shrink-0 mt-0.5 text-amber-600" />
                <span>
                  Aplikasi sedang dibuka di mode pratinjau. Browser umumnya membatasi popup izin notifikasi dalam pratinjau—buka di tab penuh atau Mode PWA terpasang untuk mengaktifkan izin sistem.
                </span>
              </div>
              <a
                href={typeof window !== "undefined" ? window.location.href : "/"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-xl bg-amber-600 hover:bg-amber-700 px-3 text-[11px] font-bold text-white shrink-0"
              >
                <ExternalLink size={12} /> Buka Tab Penuh
              </a>
            </div>
          )}

          <label className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-xs sm:text-sm">
            <div>
              <span className="font-semibold text-ink block">Tampilkan notifikasi sistem meski aplikasi sedang dibuka</span>
              <span className="text-[11px] text-sub">Jika dimatikan, notifikasi sistem muncul saat jendela PWA/browser berada di latar belakang atau diminimize.</span>
            </div>
            <Switch
              checked={Boolean(n.system_always_in_pwa)}
              onCheckedChange={(v) => {
                savePrefs({ notifications: { ...n, system_always_in_pwa: v } });
                toast.success(v ? "Notifikasi sistem akan selalu tampil" : "Notifikasi sistem hanya tampil saat aplikasi di latar belakang");
              }}
              data-testid="notif-pref-system-always"
            />
          </label>
        </div>
      </Card>

      <Card title="Uji Coba Popup Notifikasi" testid="test-notification-card">
        <p className="text-xs text-sub mb-3.5">
          Klik tombol di bawah ini untuk menguji popup notifikasi dalam aplikasi sekaligus notifikasi sistem perangkat.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={testing}
            onClick={() => triggerTest("access_request")}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50"
            data-testid="test-notif-access-btn"
          >
            🔔 Uji Akses Masuk
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => triggerTest("message")}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:bg-brand/90 transition-colors disabled:opacity-50"
            data-testid="test-notif-msg-btn"
          >
            💬 Uji Pesan Baru
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => triggerTest("task")}
            className="flex h-10 items-center gap-1.5 rounded-xl border bg-surface2 px-4 text-xs font-bold text-ink hover:bg-surface transition-colors shadow-2xs disabled:opacity-50"
            data-testid="test-notif-task-btn"
          >
            📋 Uji Penugasan Tugas
          </button>
        </div>
      </Card>

      <Card title="Preferensi Notifikasi" testid="notification-prefs">
        <div className="divide-y">{CATS.map(([k, l]) => <label key={k} className="flex items-center justify-between py-3 text-sm">{l}<Switch checked={n[k] !== false} onCheckedChange={(v) => { savePrefs({ notifications: { ...n, [k]: v } }); toast.success("Preferensi notifikasi diperbarui"); }} data-testid={`notif-pref-${k}`} /></label>)}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t pt-3">
          <p className="text-xs text-sub">Senyapkan notifikasi grup tertentu langsung dari panel detail obrolan.</p>
          <button
            type="button"
            onClick={() => { savePrefs({ notifications: n }); toast.success("Preferensi notifikasi berhasil disimpan!"); }}
            className="btn-accent h-9 px-4 text-xs font-semibold ml-auto"
            data-testid="save-notif-prefs-btn"
          >
            Simpan Preferensi
          </button>
        </div>
      </Card>
    </div>
  );
}

function CopywritingSettings() {
  const { me, isAdmin, prefs, savePrefs, ws, setSession, reloadWs, t } = useApp();
  const custom = getEffectiveCopywriting(ws?.custom_copywriting, prefs?.custom_copywriting);
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("all");
  const [draft, setDraft] = useState({ ...custom });
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [showAddKey, setShowAddKey] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Sync draft if workspace or prefs change
  useEffect(() => {
    setDraft(getEffectiveCopywriting(ws?.custom_copywriting, prefs?.custom_copywriting));
  }, [ws?.custom_copywriting, prefs?.custom_copywriting]);

  if (!isAdmin) return null;

  const syncMarketplaceConfigFromCopywriting = (copyMap, isReset = false) => {
    const nextMktCfg = { ...(ws?.marketplace_config || {}) };
    Object.keys(DEFAULT_COPYWRITING).forEach((k) => {
      if (!k.startsWith("mkt_")) return;
      const cfgField = k.slice(4);
      if (!(cfgField in DEFAULT_MARKETPLACE_COPYWRITING)) return;
      if (isReset) {
        nextMktCfg[cfgField] = DEFAULT_MARKETPLACE_COPYWRITING[cfgField];
      } else if (copyMap[k] !== undefined && String(copyMap[k]).trim() !== "") {
        nextMktCfg[cfgField] = copyMap[k];
      } else {
        nextMktCfg[cfgField] = DEFAULT_MARKETPLACE_COPYWRITING[cfgField];
      }
    });
    return nextMktCfg;
  };

  const applyOptimisticCopywriting = (nextCopyMap, nextMktCfg) => {
    setSession((s) => {
      if (!s) return s;
      return {
        ...s,
        workspace: {
          ...(s.workspace || {}),
          custom_copywriting: nextCopyMap,
          marketplace_config: nextMktCfg,
        },
      };
    });
  };

  const handleDownloadCsv = () => {
    const csvContent = generateCopywritingCsv(draft);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "circle-copywriting-template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Template CSV berhasil diunduh!");
  };

  const handleUploadCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCopywritingCsv(text);
      const keysCount = Object.keys(parsed).length;
      if (keysCount === 0) {
        return toast.error("File CSV kosong atau format tidak sesuai.");
      }
      const updated = cleanCopywritingMap({ ...draft, ...parsed });
      const nextMktCfg = syncMarketplaceConfigFromCopywriting(updated, false);
      setDraft(updated);
      applyOptimisticCopywriting(updated, nextMktCfg);
      const { data } = await api.put("/workspace", {
        custom_copywriting: updated,
        marketplace_config: nextMktCfg,
      });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      } else {
        await reloadWs();
      }
      await savePrefs({ custom_copywriting: updated });
      toast.success(`Berhasil mengimpor ${keysCount} copywriting dari CSV!`);
    } catch {
      toast.error("Gagal membaca file CSV. Pastikan format kolom: Key, Default_Text, Custom_Text");
    } finally {
      e.target.value = "";
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const cleaned = cleanCopywritingMap(draft);
      const nextMktCfg = syncMarketplaceConfigFromCopywriting(cleaned, false);
      setDraft(cleaned);
      applyOptimisticCopywriting(cleaned, nextMktCfg);
      const { data } = await api.put("/workspace", {
        custom_copywriting: cleaned,
        marketplace_config: nextMktCfg,
      });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      } else {
        await reloadWs();
      }
      await savePrefs({ custom_copywriting: cleaned });
      toast.success("Copywriting berhasil disimpan ke seluruh workspace!");
    } catch {
      toast.error("Gagal menyimpan copywriting");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const nextMktCfg = syncMarketplaceConfigFromCopywriting({}, true);
      setDraft({});
      setConfirmReset(false);
      applyOptimisticCopywriting({}, nextMktCfg);
      const { data } = await api.put("/workspace", {
        custom_copywriting: {},
        marketplace_config: nextMktCfg,
      });
      if (data && typeof data === "object") {
        setSession((s) => (s ? { ...s, workspace: data } : s));
        reconcileMarketplaceEnabledCache(me?.user_id, data.marketplace_enabled !== false, data.marketplace_config);
      } else {
        await reloadWs();
      }
      await savePrefs({ custom_copywriting: {} });
      toast.success("Copywriting dikembalikan ke default!");
    } catch {
      toast.error("Gagal mereset copywriting");
    }
  };

  const handleAddNewKey = () => {
    const k = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!k) return toast.error("Key copywriting tidak boleh kosong");
    if (!newVal.trim()) return toast.error("Teks copywriting tidak boleh kosong");
    setDraft((prev) => ({ ...prev, [k]: newVal.trim() }));
    setNewKey("");
    setNewVal("");
    setShowAddKey(false);
    toast.success(`Key '${k}' ditambahkan ke draft. Klik Simpan Copywriting.`);
  };

  const allKeys = Array.from(new Set([...Object.keys(DEFAULT_COPYWRITING), ...Object.keys(draft)]));
  const activeGroup = COPYWRITING_GROUPS.find((g) => g.id === category);
  const filteredKeys = allKeys.filter((k) => {
    if (activeGroup?.match && !activeGroup.match(k)) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      k.toLowerCase().includes(q) ||
      (DEFAULT_COPYWRITING[k] || "").toLowerCase().includes(q) ||
      (draft[k] || "").toLowerCase().includes(q)
    );
  });

  const customCount = Object.keys(draft).filter((k) => String(draft[k] || "").trim()).length;

  return (
    <Card title={t("settings_copywriting_title", "Kustomisasi Teks & Copywriting")} testid="copywriting-card">
      <div className="mb-4 space-y-2">
        <p className="text-xs text-sub">
          {t("settings_copywriting_desc", "Sesuaikan seluruh label navigasi, dashboard, marketplace, tabel tugas, beranda, jadwal, pesan, masuk, dan teks aplikasi.")}
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-brand/10 border border-brand/20 px-3 py-2 text-xs font-medium text-brand">
          <span>🛡️</span>
          <span>Perubahan copywriting yang disimpan di sini otomatis berlaku untuk seluruh halaman dan anggota workspace.</span>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface2/60 border mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 items-center gap-1.5 cursor-pointer rounded-full bg-brand px-4 text-xs sm:text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
            <Upload size={14} /> Impor CSV
            <input type="file" accept=".csv,text/csv" hidden onChange={handleUploadCsv} data-testid="upload-copywriting-csv" />
          </label>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-surface px-4 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 transition-colors shadow-xs"
            data-testid="download-copywriting-template"
          >
            <Download size={14} /> Unduh Template CSV
          </button>
          <button
            type="button"
            onClick={() => setShowAddKey((prev) => !prev)}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-surface px-4 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 transition-colors shadow-xs"
          >
            <Plus size={14} /> Tambah Key Baru
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {customCount > 0 && !confirmReset && (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/30 px-3.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw size={12} /> Reset {customCount}
            </button>
          )}
          {confirmReset && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1">
              <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">Reset semua?</span>
              <button type="button" onClick={handleReset} className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer">Ya</button>
              <button type="button" onClick={() => setConfirmReset(false)} className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-sub cursor-pointer">Batal</button>
            </div>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveDraft}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand text-white px-4 text-xs sm:text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
            data-testid="save-copywriting-btn"
          >
            <Check size={14} /> {saving ? "Menyimpan..." : "Simpan Copywriting"}
          </button>
        </div>
      </div>

      {showAddKey && (
        <div className="p-3.5 mb-4 rounded-2xl border bg-surface2/40 flex flex-col sm:flex-row items-center gap-2">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Key baru, mis. col_brand"
            className="h-9 flex-1 w-full rounded-xl border bg-surface px-3 text-xs font-mono outline-none focus:ring-1 focus:ring-brand"
          />
          <input
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder="Teks copywriting baru"
            className="h-9 flex-1 w-full rounded-xl border bg-surface px-3 text-xs outline-none focus:ring-1 focus:ring-brand"
          />
          <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleAddNewKey}
              className="rounded-full bg-brand px-4 h-9 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Tambah
            </button>
            <button
              type="button"
              onClick={() => { setShowAddKey(false); setNewKey(""); setNewVal(""); }}
              className="rounded-full border bg-surface px-3.5 h-9 text-xs font-semibold text-sub hover:bg-surface2"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 scroll-thin">
        {COPYWRITING_GROUPS.map((g) => {
          const count = g.match ? allKeys.filter(g.match).length : allKeys.length;
          if (g.id === "custom" && count === 0) return null;
          const active = category === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setCategory(g.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer ${
                active ? "bg-brand text-white shadow-xs" : "border bg-surface text-sub hover:bg-surface2 hover:text-ink"
              }`}
              data-testid={`copywriting-cat-${g.id}`}
            >
              <span>{g.label}</span>
              <span className={`text-[10px] ${active ? "text-white/80" : "text-sub/70"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search Filter */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-3 text-sub" />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Cari kata kunci atau copywriting..."
          className="h-9 w-full rounded-xl border bg-surface2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Keys Table / Editor */}
      <div className="max-h-[420px] overflow-y-auto rounded-2xl border divide-y bg-surface text-xs">
        {filteredKeys.length === 0 ? (
          <div className="p-6 text-center text-sub">Tidak ditemukan kata kunci yang cocok</div>
        ) : (
          filteredKeys.map((key) => {
            const hasDefault = key in DEFAULT_COPYWRITING;
            const defVal = DEFAULT_COPYWRITING[key];
            const currentVal = draft[key] || "";
            const isCustomized = !!String(currentVal).trim();

            return (
              <div key={key} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-surface2/50 transition-colors">
                <div className="sm:w-1/3 min-w-0">
                  <span className="font-mono text-[10px] text-brand block truncate">{key}</span>
                  {hasDefault ? (
                    <span className="text-sub text-[11px] block mt-0.5 truncate" title={defVal}>Default: &ldquo;{defVal}&rdquo;</span>
                  ) : (
                    <span className="inline-block mt-0.5 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Key Kustom</span>
                  )}
                </div>
                <div className="sm:w-2/3 flex items-center gap-2">
                  <input
                    value={currentVal}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    placeholder={hasDefault ? defVal : "Masukkan teks kustom..."}
                    className={`h-8 w-full rounded-lg border px-2.5 text-xs outline-none transition-colors ${
                      isCustomized ? "border-brand bg-brand/5 text-ink font-semibold" : "bg-surface2 text-sub"
                    }`}
                  />
                  {isCustomized && (
                    <button
                      type="button"
                      title="Kembali ke default"
                      onClick={() => {
                        const next = { ...draft };
                        delete next[key];
                        setDraft(next);
                      }}
                      className="text-sub hover:text-rose-500 p-1 shrink-0"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export default function Settings() {
  const { me, isAdmin, isManager, t } = useApp();
  const isSuperAdmin = me?.role === "super_admin";
  const tabs = [
    ["profile", t("settings_tab_profile", "Profil & Keamanan")],
    ["notifications", t("settings_tab_notifications", "Notifikasi & PWA")],
    ["appearance", t("settings_tab_appearance", "Tema & Tampilan")],
    ...(isAdmin ? [["workspace", t("settings_tab_workspace", "Identitas Workspace")], ["copywriting", t("settings_tab_copywriting", "Kustomisasi Teks")], ["admin", t("settings_tab_admin", "Ringkasan Admin")], ["access", t("settings_tab_access", "Tim, Divisi & Akses")], ["backup", t("settings_tab_backup", "Backup & Restore")]] : []),
    ...(isSuperAdmin ? [["marketplace", t("settings_tab_marketplace", "Marketplace Karyawan")]] : []),
    ...(isManager ? [["labels", t("settings_tab_labels", "Brand & Label")], ["statuses", t("settings_tab_statuses", "Status Tugas")]] : []),
    ["background", t("settings_tab_background", "Latar Dashboard")],
    ...(isAdmin ? [["fields", t("settings_tab_fields", "Kolom Profil")], ["stickers", t("settings_tab_stickers", "Stiker Tim")]] : [])
  ];
  const [tab, setTab] = useState("profile");
  useEffect(() => {
    if (isAdmin) {
      prefetchBackupSummary();
    }
  }, [isAdmin]);
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-5 lg:px-10 lg:py-10 animate-crossfade" data-testid="settings-page">
      <PageHeader icon={Cog} title={t("settings_title", "Pengaturan")} subtitle={t("settings_subtitle", "Sesuaikan tampilan CIRCLE dan kelola workspace Anda.")} />
      <div className="flex w-full min-w-0 flex-col gap-4 sm:gap-6 lg:flex-row">
        <nav className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 lg:w-56 lg:shrink-0 lg:flex-col lg:pb-0">
          {tabs.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`h-10 shrink-0 whitespace-nowrap rounded-xl px-3.5 text-left text-xs sm:text-sm font-semibold transition-colors ${
                tab === k
                  ? "bg-brand text-white shadow-xs lg:bg-surface lg:text-ink lg:border"
                  : "border lg:border-0 bg-surface lg:bg-transparent text-sub hover:bg-surface2 hover:text-ink"
              }`}
              data-testid={`settings-tab-${k}`}
            >
              {l}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === "profile" && <UserProfileSettings />}
          {tab === "appearance" && <Appearance />}
          {tab === "copywriting" && isAdmin && <CopywritingSettings />}
          {tab === "background" && <Card title={t("settings_tab_background", "Latar Dashboard")} testid="background-card"><BackgroundEditor /></Card>}
          {tab === "notifications" && <NotificationPrefs />}

          {tab === "labels" && <LabelsAdmin />}
          {tab === "statuses" && <StatusesAdmin />}
          {tab === "admin" && <AdminOverview />}
          {tab === "access" && <PeopleAccess />}
          {tab === "workspace" && <div className="space-y-5"><WorkspaceBranding /><AssistantBranding /><WeeklyReportCard /><DivisionsAdmin /><ItemTypesAdmin /></div>}
          {tab === "marketplace" && isSuperAdmin && <MarketplaceSettingsCard />}
          {tab === "backup" && <BackupRestorePanel />}
          {tab === "fields" && <ProfileFieldsAdmin />}
          {tab === "stickers" && <StickersAdmin />}
        </div>
      </div>
    </div>
  );
}

