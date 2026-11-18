import heroBannerImg from "../../assets/images/marketplace_hero_banner_1794723581887.jpg";
import mechKeyboardImg from "../../assets/images/product_mech_keyboard_1794723582034.jpg";
import artisanCoffeeImg from "../../assets/images/product_artisan_coffee_1794723582222.jpg";
import workToteImg from "../../assets/images/product_work_tote_1794723583193.jpg";
import deskChargerImg from "../../assets/images/product_desk_charger_1794723583667.jpg";
import { fileUrl } from "../../lib/api";

export const MARKETPLACE_HERO_IMAGE = heroBannerImg;

export const BANNER_IMAGE_PRESETS = [
  { key: "preset_default", label: "Studio Kopi & Audio (Default)", src: heroBannerImg },
  { key: "preset_keyboard", label: "Setup Meja & Keyboard", src: mechKeyboardImg },
  { key: "preset_coffee", label: "Roastery & Cold Brew", src: artisanCoffeeImg },
  { key: "preset_tote", label: "Work Tote & Lifestyle", src: workToteImg },
  { key: "preset_charger", label: "Desk Organizer Oak", src: deskChargerImg },
];

export const BANNER_OVERLAY_STYLES = [
  {
    id: "dark_slate",
    label: "Slate Dark (Default)",
    overlayClass: "from-slate-950/90 via-slate-950/60 to-transparent",
    kickerClass: "text-rose-300",
  },
  {
    id: "brand_gradient",
    label: "Crimson Brand",
    overlayClass: "from-rose-950/95 via-slate-950/70 to-transparent",
    kickerClass: "text-amber-300",
  },
  {
    id: "emerald_dark",
    label: "Emerald Executive",
    overlayClass: "from-emerald-950/95 via-slate-950/65 to-transparent",
    kickerClass: "text-emerald-300",
  },
  {
    id: "indigo_dark",
    label: "Midnight Indigo",
    overlayClass: "from-indigo-950/95 via-slate-950/65 to-transparent",
    kickerClass: "text-sky-300",
  },
];

export function resolveMarketplaceBannerImage(rawUrl) {
  const val = String(rawUrl || "").trim();
  if (!val || val === "preset_default") return heroBannerImg;
  const preset = BANNER_IMAGE_PRESETS.find((p) => p.key === val);
  if (preset) return preset.src;
  if (
    val.startsWith("data:") ||
    val.startsWith("http://") ||
    val.startsWith("https://") ||
    val.startsWith("/") ||
    val.startsWith("blob:")
  ) {
    return val;
  }
  return fileUrl(val);
}

export function resolveMarketplaceBannerOverlay(styleId) {
  return (
    BANNER_OVERLAY_STYLES.find((s) => s.id === styleId) || BANNER_OVERLAY_STYLES[0]
  );
}

export const STUDIO_PRODUCT_PRESETS = [
  { key: "seed_keyboard", label: "Keyboard Mekanikal", src: mechKeyboardImg },
  { key: "seed_coffee", label: "Kopi & Minuman", src: artisanCoffeeImg },
  { key: "seed_tote", label: "Tas & Aksesoris", src: workToteImg },
  { key: "seed_charger", label: "Meja & Gadget", src: deskChargerImg },
];

export const MARKETPLACE_CATEGORIES = [
  "Semua",
  "Barang",
  "Makanan & Minuman",
  "Elektronik",
  "Preloved",
  "Jasa & Keahlian",
  "Titip Beli",
];

export const PRODUCT_CONDITIONS = ["Baru", "Bekas Mulus", "Pre-Order", "Jasa"];

export const DELIVERY_OPTIONS = [
  { id: "pickup_office", label: "Ambil di Meja / Kantor", fee: 0, desc: "Ambil langsung di meja penjual atau pantry kantor (Gratis)" },
  { id: "desk_delivery", label: "Antar Antar-Divisi", fee: 0, desc: "Penjual mengantar langsung ke meja kerja Anda (Gratis)" },
  { id: "courier", label: "Kurir / Ojol", fee: 10000, desc: "Pengiriman via kurir instan / reguler (+Rp 10.000)" },
];

export const ORDER_STATUS_META = {
  pending_payment: { label: "Menunggu Pembayaran", tone: "text-amber-600 dark:text-amber-400" },
  awaiting_verification: { label: "Menunggu Verifikasi", tone: "text-blue-600 dark:text-blue-400" },
  paid_processing: { label: "Diproses Penjual", tone: "text-indigo-600 dark:text-indigo-400" },
  ready_pickup: { label: "Siap Diambil", tone: "text-emerald-600 dark:text-emerald-400" },
  shipped: { label: "Dalam Pengiriman", tone: "text-emerald-600 dark:text-emerald-400" },
  completed: { label: "Selesai", tone: "text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Dibatalkan", tone: "text-rose-600 dark:text-rose-400" },
};

export function resolveProductImage(item) {
  if (!item) return deskChargerImg;
  if (item.image_file_id) return fileUrl(item.image_file_id);
  const preset = STUDIO_PRODUCT_PRESETS.find((p) => p.key === item.image_key);
  if (preset) return preset.src;
  return deskChargerImg;
}

export function formatIDR(n) {
  return `Rp ${Math.round(Number(n || 0)).toLocaleString("id-ID")}`;
}

export function QrisCodeSvg({ seed = "CIRCLE-QRIS", size = 180 }) {
  const grid = 21;
  let h = 2166136261;
  const s = String(seed || "CIRCLE");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const isFinder = (r, c) => {
    const inTopLeft = r < 7 && c < 7;
    const inTopRight = r < 7 && c >= grid - 7;
    const inBottomLeft = r >= grid - 7 && c < 7;
    if (!inTopLeft && !inTopRight && !inBottomLeft) return null;
    const lr = r >= grid - 7 ? r - (grid - 7) : r;
    const lc = c >= grid - 7 ? c - (grid - 7) : c;
    if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
    if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
    return false;
  };

  const rects = [];
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const finder = isFinder(r, c);
      let dark = false;
      if (finder !== null) {
        dark = finder;
      } else if (r === 6 || c === 6) {
        dark = (r + c) % 2 === 0;
      } else {
        const bit = ((h ^ (r * 31 + c * 17)) >>> ((r + c) % 16)) & 1;
        dark = Boolean(bit || ((r * c + s.length) % 5 === 0));
      }
      if (dark) {
        rects.push(<rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1} height={1} fill="currentColor" />);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${grid + 2} ${grid + 2}`}
      width={size}
      height={size}
      className="text-slate-900 dark:text-slate-950"
      role="img"
      aria-label="Kode QRIS Pembayaran"
    >
      <rect x="0" y="0" width={grid + 2} height={grid + 2} fill="#FFFFFF" rx="1" />
      {rects}
    </svg>
  );
}

export function RupiahReceiptIcon({ size = 24, className = "", ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="9"
        fontWeight="800"
        letterSpacing="-0.3"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        Rp
      </text>
    </svg>
  );
}

export function RupiahNoteIcon({ size = 24, className = "", ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <text
        x="12"
        y="14.6"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="7.8"
        fontWeight="800"
        letterSpacing="-0.3"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        Rp
      </text>
    </svg>
  );
}

