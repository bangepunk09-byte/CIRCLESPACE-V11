import { api } from "../../lib/api";

const STATS_KEY = "circle_marketplace_stats_cache";
const LISTINGS_KEY = "circle_marketplace_listings_cache";
const GW_STATUS_KEY = "circle_marketplace_gw_cache";
const stateKey = (uid) => `circle_marketplace_state_${uid || "anon"}`;

export const INSTANT_SEED_VOUCHERS = [
  {
    id: "vch_teman_kantor",
    code: "TEMANKANTOR",
    title: "Diskon Rekan Kerja 10%",
    description: "Potongan 10% hingga Rp 50.000 untuk transaksi minimal Rp 50.000",
    discount_type: "percent",
    discount_value: 10,
    max_discount: 50000,
    min_spend: 50000,
    active: true,
  },
  {
    id: "vch_asli_hemat",
    code: "ASLIHEMAT",
    title: "Potongan Langsung Rp 15.000",
    description: "Hemat langsung Rp 15.000 untuk transaksi minimal Rp 100.000",
    discount_type: "fixed",
    discount_value: 15000,
    max_discount: 15000,
    min_spend: 100000,
    active: true,
  },
];

export const INSTANT_SEED_LISTINGS = [
  {
    id: "mkt_seed_keyboard",
    title: "Mechanical Keyboard Wireless 75% CNC Aluminum",
    description:
      "Keyboard mechanical compact 75% gasket mount, hot-swappable, switch tactile linear senyap cocok untuk kerja di kantor maupun WFH. Lengkap dengan box, keycap cadangan, dan kabel braided USB-C.",
    price: 1250000,
    compare_price: 1550000,
    category: "Elektronik",
    condition: "Bekas Mulus",
    stock: 2,
    sold_count: 3,
    rating_avg: 4.9,
    rating_count: 2,
    variants: ["Silver Frost · Tactile", "Slate Grey · Linear"],
    delivery_options: ["pickup_office", "desk_delivery", "courier"],
    pickup_location: "Meja Engineering Lt. 4",
    image_key: "seed_keyboard",
    seller_id: "user_admin1",
    seller_name: "Budi Santoso",
    seller_department: "Engineering",
    seller: {
      user_id: "user_admin1",
      name: "Budi Santoso",
      department: "Engineering",
      job_title: "Karyawan",
    },
    status: "active",
  },
  {
    id: "mkt_seed_coffee",
    title: "Paket Kopi Arabika Gayo & Cold Brew Botol 500ml",
    description:
      "Roasting fresh setiap akhir pekan khusus untuk rekan kantor. Notes cokelat, karamel, dan clean finish. Tersedia pilihan whole bean atau giling medium untuk V60/AeroPress + bonus 1 botol cold brew siap minum.",
    price: 95000,
    compare_price: 125000,
    category: "Makanan & Minuman",
    condition: "Baru",
    stock: 14,
    sold_count: 19,
    rating_avg: 5.0,
    rating_count: 4,
    variants: ["Biji Utuh 250g + Cold Brew", "Giling V60 250g + Cold Brew"],
    delivery_options: ["pickup_office", "desk_delivery"],
    pickup_location: "Pantry Lt. 3 / Meja Product",
    image_key: "seed_coffee",
    seller_id: "user_admin1",
    seller_name: "Siti Rahma",
    seller_department: "Product",
    seller: {
      user_id: "user_admin1",
      name: "Siti Rahma",
      department: "Product",
      job_title: "Karyawan",
    },
    status: "active",
  },
  {
    id: "mkt_seed_tote",
    title: "Tas Kerja Kanvas & Kulit Minimalist Work Tote 14\"",
    description:
      "Tas kerja harian muat laptop hingga 14 inch, kompartemen botol minum internal, saku resleting untuk charger & kartu akses kantor. Kondisi baru masih berlabel, hadiah doorprize yang belum terpakai.",
    price: 385000,
    compare_price: 490000,
    category: "Preloved",
    condition: "Baru",
    stock: 1,
    sold_count: 2,
    rating_avg: 4.8,
    rating_count: 1,
    variants: ["Warm Sand / Cognac"],
    delivery_options: ["pickup_office", "desk_delivery", "courier"],
    pickup_location: "Studio Design Lt. 2",
    image_key: "seed_tote",
    seller_id: "user_admin1",
    seller_name: "Dian Pratama",
    seller_department: "Design",
    seller: {
      user_id: "user_admin1",
      name: "Dian Pratama",
      department: "Design",
      job_title: "Karyawan",
    },
    status: "active",
  },
  {
    id: "mkt_seed_charger",
    title: "Stand MagSafe & Pen Tray Meja Aluminium + Kayu Oak",
    description:
      "Desk organizer premium dengan wireless fast charging 15W terintegrasi untuk ponsel & earbuds serta baki kayu oak alami. Membuat meja kerja tetap rapi tanpa kabel berantakan.",
    price: 420000,
    compare_price: 520000,
    category: "Barang",
    condition: "Baru",
    stock: 5,
    sold_count: 7,
    rating_avg: 4.9,
    rating_count: 3,
    variants: ["Natural Oak + Silver", "Walnut Dark + Space Grey"],
    delivery_options: ["pickup_office", "desk_delivery", "courier"],
    pickup_location: "Area Management Lt. 5",
    image_key: "seed_charger",
    seller_id: "user_admin1",
    seller_name: "Admin ASLI RI",
    seller_department: "Management",
    seller: {
      user_id: "user_admin1",
      name: "Admin ASLI RI",
      department: "Management",
      job_title: "Super Admin",
    },
    status: "active",
  },
];

const DEFAULT_STATS = {
  total_listings: 4,
  active_listings: 4,
  total_orders: 0,
  completed_orders: 0,
  pending_verification: 0,
  gmv: 0,
};

const DEFAULT_GW_INFO = {
  payment_gateway: {
    enabled: true,
    provider: "midtrans",
    provider_label: "Midtrans (Snap & Core API)",
    environment: "sandbox",
    midtrans_is_production: false,
    mode: "snap_popup",
    auto_verify: true,
    expiry_minutes: 60,
    live_credentials_configured: false,
    runtime_mode: "sandbox_simulator",
    midtrans_snap_js_url: "https://app.sandbox.midtrans.com/snap/snap.js",
    midtrans_api_base_url: "https://app.sandbox.midtrans.com/snap/v1/transactions",
    webhook_paths: {
      midtrans: "/api/marketplace/webhooks/midtrans",
      unified: "/api/marketplace/webhooks/payment",
    },
    env_vars_detected: {
      MIDTRANS_IS_PRODUCTION: false,
      MIDTRANS_MERCHANT_ID: false,
      MIDTRANS_SERVER_KEY: false,
      MIDTRANS_CLIENT_KEY: false,
      XENDIT_SECRET_KEY: false,
      DOKU_SECRET_KEY: false,
    },
  },
  webhook_logs: [
    {
      id: "wh_seed_init",
      provider: "midtrans",
      event_type: "gateway.ready",
      order_number: "SYSTEM-CHECK",
      transaction_status: "ready",
      payment_type: "snap_qris_va",
      gross_amount: 0,
      status_code: "200",
      verified_signature: true,
      message: "Endpoint Webhook Payment Gateway (/api/marketplace/webhooks/midtrans) siap menerima HTTP Notification.",
      created_at: new Date().toISOString(),
    },
  ],
};

let MEMORY_STATS = null;
let MEMORY_GW = null;
const MEMORY_STATE = new Map();

try {
  const s = localStorage.getItem(STATS_KEY);
  if (s) MEMORY_STATS = JSON.parse(s);
  const g = localStorage.getItem(GW_STATUS_KEY);
  if (g) MEMORY_GW = JSON.parse(g);
} catch {}

export function getCachedMarketplaceStats() {
  if (MEMORY_STATS) return MEMORY_STATS;
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      MEMORY_STATS = JSON.parse(raw);
      return MEMORY_STATS;
    }
  } catch {}
  return DEFAULT_STATS;
}

export function setCachedMarketplaceStats(stats) {
  if (!stats || typeof stats !== "object") return;
  MEMORY_STATS = { ...DEFAULT_STATS, ...stats };
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(MEMORY_STATS));
  } catch {}
}

export function getCachedGatewayInfo() {
  if (MEMORY_GW) return MEMORY_GW;
  try {
    const raw = localStorage.getItem(GW_STATUS_KEY);
    if (raw) {
      MEMORY_GW = JSON.parse(raw);
      return MEMORY_GW;
    }
  } catch {}
  return DEFAULT_GW_INFO;
}

export function setCachedGatewayInfo(info) {
  if (!info || typeof info !== "object") return;
  MEMORY_GW = {
    payment_gateway: info.payment_gateway || MEMORY_GW?.payment_gateway || DEFAULT_GW_INFO.payment_gateway,
    webhook_logs: Array.isArray(info.webhook_logs)
      ? info.webhook_logs
      : MEMORY_GW?.webhook_logs || DEFAULT_GW_INFO.webhook_logs,
  };
  try {
    localStorage.setItem(GW_STATUS_KEY, JSON.stringify(MEMORY_GW));
  } catch {}
}

export function getCachedMarketplaceListings() {
  try {
    const raw = localStorage.getItem(LISTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return INSTANT_SEED_LISTINGS;
}

export const DEFAULT_MARKETPLACE_COPYWRITING = {
  store_name: "CIRCLE Market",
  store_tagline: "Jual beli aman, preloved terkurasi & titip beli sesama rekan kerja.",
  cart_btn_label: "Keranjang",
  sell_btn_label: "Jual Barang / Jasa",
  banner_kicker: "INTERNAL EMPLOYEE EXCHANGE",
  banner_title: "Temukan Produk Pilihan & Jasa Rekan Kantor",
  banner_subtitle:
    "Dukung sesama tim lewat transaksi QRIS, Virtual Account, E-Wallet, atau COD antar-meja.",
  banner_promo_prefix: "Kode",
  banner_promo_code: "TEMANKANTOR",
  banner_promo_text: "diskon 10%.",
  tab_explore_label: "Jelajahi",
  tab_orders_label: "Pesanan Saya",
  tab_seller_label: "Toko Saya",
  tab_wishlist_label: "Favorit",
  search_placeholder: "Cari barang, makanan, preloved, atau nama rekan...",
  add_to_cart_label: "+ Keranjang",
  sold_out_label: "Stok Habis",
  empty_explore_title: "Produk tidak ditemukan",
  empty_wishlist_title: "Belum ada produk di daftar Favorit",
  empty_explore_subtitle:
    "Coba ubah kata kunci pencarian atau jadilah yang pertama menawarkan barang di kategori ini.",
  empty_orders_title: "Belum ada pesanan pembelian",
  empty_orders_subtitle:
    "Pesanan Anda dan status pembayarannya akan tercatat otomatis di sini.",
  empty_orders_cta: "Jelajahi Katalog",
  seller_kpi_products_label: "Produk Saya",
  seller_kpi_pending_label: "Pesanan Perlu Diproses",
  seller_kpi_revenue_label: "Total Omzet Toko",
  seller_incoming_title: "Pesanan Masuk",
  seller_incoming_empty: "Belum ada pesanan masuk ke toko Anda.",
  seller_catalog_title: "Etalase Produk Saya",
  seller_add_product_btn: "Tambah Produk",
  seller_catalog_empty_title: "Anda belum memiliki produk yang dijual",
  seller_catalog_empty_subtitle:
    "Jual barang preloved, camilan, gadget, atau jasa ke sesama rekan kerja.",
  cart_drawer_title: "Keranjang Belanja",
  cart_empty_title: "Keranjang Anda masih kosong",
  cart_empty_subtitle:
    "Tambahkan barang atau jasa dari rekan kantor ke keranjang untuk checkout lebih cepat.",
  cart_checkout_btn: "Lanjut ke Pembayaran",
  disabled_title: "Fitur Marketplace Sedang Dinonaktifkan",
  disabled_subtitle:
    "Super Admin menonaktifkan sementara fitur Marketplace internal untuk workspace ini. Seluruh data produk dan riwayat transaksi tetap aman tersimpan.",
  back_to_dashboard_btn: "Kembali ke Dashboard",
  open_settings_btn: "Aktifkan di Pengaturan",
};

export function reconcileMarketplaceEnabledCache(uid, enabledBool, marketplaceConfig = null) {
  if (typeof enabledBool !== "boolean") return;
  const keys = [stateKey(uid), stateKey("anon")];
  keys.forEach((k) => {
    const existing = MEMORY_STATE.get(k);
    if (existing && typeof existing === "object") {
      const updated = {
        ...existing,
        enabled: enabledBool,
        ...(marketplaceConfig && typeof marketplaceConfig === "object"
          ? { config: { ...(existing.config || {}), ...marketplaceConfig } }
          : {}),
        ...(enabledBool && (!Array.isArray(existing.listings) || existing.listings.length === 0)
          ? { listings: getCachedMarketplaceListings() }
          : {}),
      };
      MEMORY_STATE.set(k, updated);
    }
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const updated = {
            ...parsed,
            enabled: enabledBool,
            ...(marketplaceConfig && typeof marketplaceConfig === "object"
              ? { config: { ...(parsed.config || {}), ...marketplaceConfig } }
              : {}),
            ...(enabledBool && (!Array.isArray(parsed.listings) || parsed.listings.length === 0)
              ? { listings: getCachedMarketplaceListings() }
              : {}),
          };
          localStorage.setItem(k, JSON.stringify(updated));
        }
      }
    } catch {}
  });
}

export function getInitialMarketplaceState(uid, ws) {
  const k = stateKey(uid);
  const wsEnabledKnown = typeof ws?.marketplace_enabled === "boolean";
  const reconcileWithWs = (candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const resolvedEnabled = wsEnabledKnown ? ws.marketplace_enabled : candidate.enabled !== false;
    const resolvedListings =
      resolvedEnabled && (!Array.isArray(candidate.listings) || candidate.listings.length === 0)
        ? getCachedMarketplaceListings()
        : candidate.listings || [];
    const merged = {
      ...candidate,
      enabled: resolvedEnabled,
      listings: resolvedListings,
      config: {
        ...DEFAULT_MARKETPLACE_COPYWRITING,
        ...(candidate.config || {}),
        ...(ws?.marketplace_config || {}),
      },
    };
    MEMORY_STATE.set(k, merged);
    return merged;
  };

  if (MEMORY_STATE.has(k)) {
    return reconcileWithWs(MEMORY_STATE.get(k));
  }
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.listings)) {
        return reconcileWithWs(parsed);
      }
    }
  } catch {}
  return {
    enabled: ws?.marketplace_enabled !== false,
    config: {
      ...DEFAULT_MARKETPLACE_COPYWRITING,
      ...(ws?.marketplace_config || {}),
      banner_enabled: ws?.marketplace_config?.banner_enabled !== false,
      banner_image_url: ws?.marketplace_config?.banner_image_url || "",
      banner_overlay_style:
        ws?.marketplace_config?.banner_overlay_style || "dark_slate",
      allow_qris: ws?.marketplace_config?.allow_qris !== false,
      allow_bank_transfer: ws?.marketplace_config?.allow_bank_transfer !== false,
      allow_ewallet: ws?.marketplace_config?.allow_ewallet !== false,
      allow_cod: ws?.marketplace_config?.allow_cod !== false,
      allow_payroll: ws?.marketplace_config?.allow_payroll !== false,
      platform_fee_pct: Number(ws?.marketplace_config?.platform_fee_pct ?? 0),
      payment_gateway_enabled: ws?.marketplace_config?.payment_gateway_enabled !== false,
      payment_gateway_provider: ws?.marketplace_config?.payment_gateway_provider || "midtrans",
      payment_gateway_env: ws?.marketplace_config?.payment_gateway_env || "sandbox",
      payment_gateway_mode: ws?.marketplace_config?.payment_gateway_mode || "snap_popup",
      payment_gateway_auto_verify: ws?.marketplace_config?.payment_gateway_auto_verify !== false,
      payment_expiry_minutes: Number(ws?.marketplace_config?.payment_expiry_minutes ?? 60),
    },
    payment_gateway: getCachedGatewayInfo().payment_gateway,
    listings: getCachedMarketplaceListings(),
    orders: [],
    cart: [],
    wishlist: [],
    reviews: [],
    vouchers: INSTANT_SEED_VOUCHERS,
    stats: getCachedMarketplaceStats(),
  };
}

export function setCachedMarketplaceState(uid, nextState) {
  if (!nextState || typeof nextState !== "object") return;
  const k = stateKey(uid);
  MEMORY_STATE.set(k, nextState);
  try {
    localStorage.setItem(k, JSON.stringify(nextState));
    if (Array.isArray(nextState.listings) && nextState.listings.length > 0) {
      localStorage.setItem(LISTINGS_KEY, JSON.stringify(nextState.listings));
    }
  } catch {}
  if (nextState.stats && typeof nextState.stats === "object") {
    setCachedMarketplaceStats(nextState.stats);
  }
  if (nextState.payment_gateway) {
    setCachedGatewayInfo({ payment_gateway: nextState.payment_gateway });
  }
}

let inFlightPrefetch = null;
let inFlightPrefetchUid = null;
let lastPrefetchAt = 0;

export async function prefetchMarketplaceState(uid, force = false) {
  const now = Date.now();
  if (!force && inFlightPrefetch && inFlightPrefetchUid === (uid || "anon")) {
    return inFlightPrefetch;
  }
  if (!force && now - lastPrefetchAt < 1200 && MEMORY_STATE.has(stateKey(uid))) {
    return MEMORY_STATE.get(stateKey(uid));
  }
  inFlightPrefetchUid = uid || "anon";
  inFlightPrefetch = (async () => {
    try {
      const { data } = await api.get("/marketplace/state");
      if (data && typeof data === "object") {
        lastPrefetchAt = Date.now();
        setCachedMarketplaceState(uid, data);
        return data;
      }
    } catch {}
    finally {
      inFlightPrefetch = null;
    }
    return null;
  })();
  return inFlightPrefetch;
}

export function evaluateVoucherInstant(code, subtotal, vouchers = INSTANT_SEED_VOUCHERS) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return { error: "Masukkan kode voucher." };
  const list = Array.isArray(vouchers) && vouchers.length > 0 ? vouchers : INSTANT_SEED_VOUCHERS;
  const voucher = list.find(
    (v) => v.active !== false && String(v.code || "").toUpperCase() === clean
  );
  if (!voucher) {
    return { error: "Kode voucher tidak ditemukan atau sudah tidak berlaku." };
  }
  if (subtotal < Number(voucher.min_spend || 0)) {
    return {
      error: `Minimal belanja Rp ${Number(voucher.min_spend).toLocaleString("id-ID")} untuk voucher ${voucher.code}.`,
    };
  }
  const discount =
    voucher.discount_type === "percent"
      ? Math.min(
          Number(voucher.max_discount || 99999999),
          Math.round((subtotal * Number(voucher.discount_value || 0)) / 100)
        )
      : Math.min(subtotal, Number(voucher.discount_value || 0));
  return { voucher, discount };
}
