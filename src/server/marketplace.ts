import type { Express } from "express";
import crypto from "crypto";

export type PaymentGatewayProvider = "midtrans" | "xendit" | "doku" | "manual";
export type PaymentGatewayEnv = "sandbox" | "production";
export type PaymentGatewayMode = "snap_popup" | "core_api" | "redirect";

export interface MarketplaceConfig {
  store_name: string;
  store_tagline: string;
  cart_btn_label: string;
  sell_btn_label: string;
  banner_enabled: boolean;
  banner_kicker: string;
  banner_title: string;
  banner_subtitle: string;
  banner_promo_prefix: string;
  banner_promo_code: string;
  banner_promo_text: string;
  banner_image_url: string;
  banner_overlay_style: string;
  tab_explore_label: string;
  tab_orders_label: string;
  tab_seller_label: string;
  tab_wishlist_label: string;
  search_placeholder: string;
  add_to_cart_label: string;
  sold_out_label: string;
  empty_explore_title: string;
  empty_wishlist_title: string;
  empty_explore_subtitle: string;
  empty_orders_title: string;
  empty_orders_subtitle: string;
  empty_orders_cta: string;
  seller_kpi_products_label: string;
  seller_kpi_pending_label: string;
  seller_kpi_revenue_label: string;
  seller_incoming_title: string;
  seller_incoming_empty: string;
  seller_catalog_title: string;
  seller_add_product_btn: string;
  seller_catalog_empty_title: string;
  seller_catalog_empty_subtitle: string;
  cart_drawer_title: string;
  cart_empty_title: string;
  cart_empty_subtitle: string;
  cart_checkout_btn: string;
  disabled_title: string;
  disabled_subtitle: string;
  allow_qris: boolean;
  allow_bank_transfer: boolean;
  allow_ewallet: boolean;
  allow_cod: boolean;
  allow_payroll: boolean;
  platform_fee_pct: number;
  payment_gateway_enabled: boolean;
  payment_gateway_provider: PaymentGatewayProvider;
  payment_gateway_env: PaymentGatewayEnv;
  payment_gateway_mode: PaymentGatewayMode;
  payment_gateway_auto_verify: boolean;
  payment_expiry_minutes: number;
}

export const DEFAULT_MARKETPLACE_CONFIG: MarketplaceConfig = {
  store_name: "CIRCLE Market",
  store_tagline: "Jual beli aman, preloved terkurasi & titip beli sesama rekan kerja.",
  cart_btn_label: "Keranjang",
  sell_btn_label: "Jual Barang / Jasa",
  banner_enabled: true,
  banner_kicker: "INTERNAL EMPLOYEE EXCHANGE",
  banner_title: "Temukan Produk Pilihan & Jasa Rekan Kantor",
  banner_subtitle: "Dukung sesama tim lewat transaksi QRIS, Virtual Account, E-Wallet, atau COD antar-meja.",
  banner_promo_prefix: "Kode",
  banner_promo_code: "TEMANKANTOR",
  banner_promo_text: "diskon 10%.",
  banner_image_url: "",
  banner_overlay_style: "dark_slate",
  tab_explore_label: "Jelajahi",
  tab_orders_label: "Pesanan Saya",
  tab_seller_label: "Toko Saya",
  tab_wishlist_label: "Favorit",
  search_placeholder: "Cari barang, makanan, preloved, atau nama rekan...",
  add_to_cart_label: "+ Keranjang",
  sold_out_label: "Stok Habis",
  empty_explore_title: "Produk tidak ditemukan",
  empty_wishlist_title: "Belum ada produk di daftar Favorit",
  empty_explore_subtitle: "Coba ubah kata kunci pencarian atau jadilah yang pertama menawarkan barang di kategori ini.",
  empty_orders_title: "Belum ada pesanan pembelian",
  empty_orders_subtitle: "Pesanan Anda dan status pembayarannya akan tercatat otomatis di sini.",
  empty_orders_cta: "Jelajahi Katalog",
  seller_kpi_products_label: "Produk Saya",
  seller_kpi_pending_label: "Pesanan Perlu Diproses",
  seller_kpi_revenue_label: "Total Omzet Toko",
  seller_incoming_title: "Pesanan Masuk",
  seller_incoming_empty: "Belum ada pesanan masuk ke toko Anda.",
  seller_catalog_title: "Etalase Produk Saya",
  seller_add_product_btn: "Tambah Produk",
  seller_catalog_empty_title: "Anda belum memiliki produk yang dijual",
  seller_catalog_empty_subtitle: "Jual barang preloved, camilan, gadget, atau jasa ke sesama rekan kerja.",
  cart_drawer_title: "Keranjang Belanja",
  cart_empty_title: "Keranjang Anda masih kosong",
  cart_empty_subtitle: "Tambahkan barang atau jasa dari rekan kantor ke keranjang untuk checkout lebih cepat.",
  cart_checkout_btn: "Lanjut ke Pembayaran",
  disabled_title: "Fitur Marketplace Sedang Dinonaktifkan",
  disabled_subtitle: "Super Admin menonaktifkan sementara fitur Marketplace internal untuk workspace ini. Seluruh data produk dan riwayat transaksi tetap aman tersimpan.",
  allow_qris: true,
  allow_bank_transfer: true,
  allow_ewallet: true,
  allow_cod: true,
  allow_payroll: true,
  platform_fee_pct: 0,
  payment_gateway_enabled: true,
  payment_gateway_provider: (process.env.PAYMENT_GATEWAY_PROVIDER as PaymentGatewayProvider) || "midtrans",
  payment_gateway_env: process.env.MIDTRANS_IS_PRODUCTION === "true" ? "production" : "sandbox",
  payment_gateway_mode: "snap_popup",
  payment_gateway_auto_verify: true,
  payment_expiry_minutes: 60,
};

export const SEED_MARKETPLACE_VOUCHERS = [
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

export function getMarketplaceConfig(db: Record<string, any>): MarketplaceConfig {
  const raw = (db.workspace && db.workspace.marketplace_config) || {};
  const validProviders: PaymentGatewayProvider[] = ["midtrans", "xendit", "doku", "manual"];
  const validEnvs: PaymentGatewayEnv[] = ["sandbox", "production"];
  const validModes: PaymentGatewayMode[] = ["snap_popup", "core_api", "redirect"];

  const provider = validProviders.includes(raw.payment_gateway_provider)
    ? raw.payment_gateway_provider
    : DEFAULT_MARKETPLACE_CONFIG.payment_gateway_provider;
  const envFromVar =
    process.env.MIDTRANS_IS_PRODUCTION === "true"
      ? "production"
      : process.env.MIDTRANS_IS_PRODUCTION === "false"
      ? "sandbox"
      : null;
  const env = validEnvs.includes(raw.payment_gateway_env)
    ? raw.payment_gateway_env
    : envFromVar || DEFAULT_MARKETPLACE_CONFIG.payment_gateway_env;
  const mode = validModes.includes(raw.payment_gateway_mode)
    ? raw.payment_gateway_mode
    : DEFAULT_MARKETPLACE_CONFIG.payment_gateway_mode;

  const str = (key: keyof MarketplaceConfig) =>
    raw[key] !== undefined ? String(raw[key]) : String(DEFAULT_MARKETPLACE_CONFIG[key]);

  return {
    store_name: str("store_name") || DEFAULT_MARKETPLACE_CONFIG.store_name,
    store_tagline: str("store_tagline"),
    cart_btn_label: str("cart_btn_label") || DEFAULT_MARKETPLACE_CONFIG.cart_btn_label,
    sell_btn_label: str("sell_btn_label") || DEFAULT_MARKETPLACE_CONFIG.sell_btn_label,
    banner_enabled: raw.banner_enabled !== false,
    banner_kicker: str("banner_kicker"),
    banner_title: str("banner_title") || DEFAULT_MARKETPLACE_CONFIG.banner_title,
    banner_subtitle: str("banner_subtitle"),
    banner_promo_prefix: str("banner_promo_prefix"),
    banner_promo_code: str("banner_promo_code"),
    banner_promo_text: str("banner_promo_text"),
    banner_image_url: str("banner_image_url"),
    banner_overlay_style: str("banner_overlay_style") || DEFAULT_MARKETPLACE_CONFIG.banner_overlay_style,
    tab_explore_label: str("tab_explore_label") || DEFAULT_MARKETPLACE_CONFIG.tab_explore_label,
    tab_orders_label: str("tab_orders_label") || DEFAULT_MARKETPLACE_CONFIG.tab_orders_label,
    tab_seller_label: str("tab_seller_label") || DEFAULT_MARKETPLACE_CONFIG.tab_seller_label,
    tab_wishlist_label: str("tab_wishlist_label") || DEFAULT_MARKETPLACE_CONFIG.tab_wishlist_label,
    search_placeholder: str("search_placeholder"),
    add_to_cart_label: str("add_to_cart_label") || DEFAULT_MARKETPLACE_CONFIG.add_to_cart_label,
    sold_out_label: str("sold_out_label") || DEFAULT_MARKETPLACE_CONFIG.sold_out_label,
    empty_explore_title: str("empty_explore_title"),
    empty_wishlist_title: str("empty_wishlist_title"),
    empty_explore_subtitle: str("empty_explore_subtitle"),
    empty_orders_title: str("empty_orders_title"),
    empty_orders_subtitle: str("empty_orders_subtitle"),
    empty_orders_cta: str("empty_orders_cta") || DEFAULT_MARKETPLACE_CONFIG.empty_orders_cta,
    seller_kpi_products_label: str("seller_kpi_products_label"),
    seller_kpi_pending_label: str("seller_kpi_pending_label"),
    seller_kpi_revenue_label: str("seller_kpi_revenue_label"),
    seller_incoming_title: str("seller_incoming_title"),
    seller_incoming_empty: str("seller_incoming_empty"),
    seller_catalog_title: str("seller_catalog_title"),
    seller_add_product_btn: str("seller_add_product_btn") || DEFAULT_MARKETPLACE_CONFIG.seller_add_product_btn,
    seller_catalog_empty_title: str("seller_catalog_empty_title"),
    seller_catalog_empty_subtitle: str("seller_catalog_empty_subtitle"),
    cart_drawer_title: str("cart_drawer_title"),
    cart_empty_title: str("cart_empty_title"),
    cart_empty_subtitle: str("cart_empty_subtitle"),
    cart_checkout_btn: str("cart_checkout_btn") || DEFAULT_MARKETPLACE_CONFIG.cart_checkout_btn,
    disabled_title: str("disabled_title"),
    disabled_subtitle: str("disabled_subtitle"),
    allow_qris: raw.allow_qris !== false,
    allow_bank_transfer: raw.allow_bank_transfer !== false,
    allow_ewallet: raw.allow_ewallet !== false,
    allow_cod: raw.allow_cod !== false,
    allow_payroll: raw.allow_payroll !== false,
    platform_fee_pct: Math.max(0, Math.min(15, Number(raw.platform_fee_pct ?? DEFAULT_MARKETPLACE_CONFIG.platform_fee_pct) || 0)),
    payment_gateway_enabled: raw.payment_gateway_enabled !== false,
    payment_gateway_provider: provider,
    payment_gateway_env: env,
    payment_gateway_mode: mode,
    payment_gateway_auto_verify: raw.payment_gateway_auto_verify !== false,
    payment_expiry_minutes: Math.max(5, Math.min(1440, Number(raw.payment_expiry_minutes ?? DEFAULT_MARKETPLACE_CONFIG.payment_expiry_minutes) || 60)),
  };
}

export function getPaymentGatewayEnvStatus(cfg: MarketplaceConfig) {
  const hasMidtransServerKey = Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_SERVER_KEY.trim());
  const hasMidtransClientKey = Boolean(process.env.MIDTRANS_CLIENT_KEY && process.env.MIDTRANS_CLIENT_KEY.trim());
  const hasMidtransMerchantId = Boolean(process.env.MIDTRANS_MERCHANT_ID && process.env.MIDTRANS_MERCHANT_ID.trim());
  const rawIsProd = process.env.MIDTRANS_IS_PRODUCTION;
  const isProductionFlag =
    rawIsProd !== undefined && rawIsProd !== ""
      ? String(rawIsProd).toLowerCase() === "true"
      : cfg.payment_gateway_env === "production";
  const hasXenditKey = Boolean(process.env.XENDIT_SECRET_KEY && process.env.XENDIT_SECRET_KEY.trim());
  const hasDokuKey = Boolean(process.env.DOKU_SECRET_KEY && process.env.DOKU_SECRET_KEY.trim());

  const activeProvider = cfg.payment_gateway_enabled ? cfg.payment_gateway_provider : "manual";
  const liveCredentialsConfigured =
    activeProvider === "midtrans"
      ? hasMidtransServerKey
      : activeProvider === "xendit"
      ? hasXenditKey
      : activeProvider === "doku"
      ? hasDokuKey
      : false;

  const effectiveEnv: PaymentGatewayEnv = cfg.payment_gateway_env || (isProductionFlag ? "production" : "sandbox");

  return {
    enabled: cfg.payment_gateway_enabled,
    provider: activeProvider,
    provider_label:
      activeProvider === "midtrans"
        ? "Midtrans (Snap & Core API)"
        : activeProvider === "xendit"
        ? "Xendit Checkout"
        : activeProvider === "doku"
        ? "DOKU Jokul"
        : "Internal Escrow / Manual",
    environment: effectiveEnv,
    midtrans_is_production: effectiveEnv === "production",
    mode: cfg.payment_gateway_mode,
    auto_verify: cfg.payment_gateway_auto_verify,
    expiry_minutes: cfg.payment_expiry_minutes,
    live_credentials_configured: liveCredentialsConfigured,
    runtime_mode: liveCredentialsConfigured ? "live_api" : "sandbox_simulator",
    midtrans_client_key: hasMidtransClientKey ? process.env.MIDTRANS_CLIENT_KEY : "",
    midtrans_snap_js_url:
      effectiveEnv === "production"
        ? "https://app.midtrans.com/snap/snap.js"
        : "https://app.sandbox.midtrans.com/snap/snap.js",
    midtrans_api_base_url:
      effectiveEnv === "production"
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions",
    webhook_paths: {
      midtrans: "/api/marketplace/webhooks/midtrans",
      unified: "/api/marketplace/webhooks/payment",
    },
    env_vars_detected: {
      MIDTRANS_IS_PRODUCTION: effectiveEnv === "production",
      MIDTRANS_MERCHANT_ID: hasMidtransMerchantId,
      MIDTRANS_SERVER_KEY: hasMidtransServerKey,
      MIDTRANS_CLIENT_KEY: hasMidtransClientKey,
      XENDIT_SECRET_KEY: hasXenditKey,
      DOKU_SECRET_KEY: hasDokuKey,
    },
  };
}

export function isMarketplaceEnabled(db: Record<string, any>): boolean {
  return db.workspace?.marketplace_enabled !== false;
}

export function ensureMarketplaceData(db: Record<string, any>) {
  if (!db.workspace || typeof db.workspace !== "object") db.workspace = {};
  if (typeof db.workspace.marketplace_enabled !== "boolean") {
    db.workspace.marketplace_enabled = true;
  }
  if (!db.workspace.marketplace_config || typeof db.workspace.marketplace_config !== "object") {
    db.workspace.marketplace_config = { ...DEFAULT_MARKETPLACE_CONFIG };
  } else {
    db.workspace.marketplace_config = {
      ...DEFAULT_MARKETPLACE_CONFIG,
      ...db.workspace.marketplace_config,
    };
  }

  if (!Array.isArray(db.marketplace_vouchers) || db.marketplace_vouchers.length === 0) {
    db.marketplace_vouchers = SEED_MARKETPLACE_VOUCHERS.map((v) => ({ ...v }));
  }
  if (!Array.isArray(db.marketplace_orders)) {
    db.marketplace_orders = [];
  }
  if (!Array.isArray(db.marketplace_reviews)) {
    db.marketplace_reviews = [];
  }
  if (!Array.isArray(db.marketplace_webhook_logs)) {
    db.marketplace_webhook_logs = [
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
    ];
  }
  if (!db.marketplace_carts || typeof db.marketplace_carts !== "object") {
    db.marketplace_carts = {};
  }
  if (!db.marketplace_wishlists || typeof db.marketplace_wishlists !== "object") {
    db.marketplace_wishlists = {};
  }

  if (!Array.isArray(db.marketplace_listings) || db.marketplace_listings.length === 0) {
    const humanUsers = (Array.isArray(db.users) ? db.users : []).filter(
      (u: any) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
    );
    const pickSeller = (idx: number, fallbackName: string, fallbackDept: string) => {
      const u = humanUsers[idx % Math.max(1, humanUsers.length)];
      if (u) return u;
      return {
        user_id: "user_admin1",
        name: fallbackName,
        department: fallbackDept,
        job_title: "Karyawan",
      };
    };

    const s0 = pickSeller(1, "Budi Santoso", "Engineering");
    const s1 = pickSeller(2, "Siti Rahma", "Product");
    const s2 = pickSeller(3, "Dian Pratama", "Design");
    const s3 = pickSeller(0, "Admin ASLI RI", "Management");
    const now = new Date().toISOString();

    db.marketplace_listings = [
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
        seller_id: s0.user_id,
        seller_name: s0.name,
        seller_department: s0.department || "Engineering",
        status: "active",
        created_at: now,
        updated_at: now,
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
        seller_id: s1.user_id,
        seller_name: s1.name,
        seller_department: s1.department || "Product",
        status: "active",
        created_at: now,
        updated_at: now,
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
        seller_id: s2.user_id,
        seller_name: s2.name,
        seller_department: s2.department || "Design",
        status: "active",
        created_at: now,
        updated_at: now,
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
        seller_id: s3.user_id,
        seller_name: s3.name,
        seller_department: s3.department || "Management",
        status: "active",
        created_at: now,
        updated_at: now,
      },
    ];

    if (db.marketplace_reviews.length === 0) {
      db.marketplace_reviews = [
        {
          id: "mkt_rev_seed_1",
          listing_id: "mkt_seed_keyboard",
          order_id: "seed_order_1",
          buyer_id: s1.user_id,
          buyer_name: s1.name,
          rating: 5,
          comment: "Switch-nya empuk banget dan senyap buat di open office. Kondisi mulus seperti baru!",
          created_at: now,
        },
        {
          id: "mkt_rev_seed_2",
          listing_id: "mkt_seed_coffee",
          order_id: "seed_order_2",
          buyer_id: s0.user_id,
          buyer_name: s0.name,
          rating: 5,
          comment: "Cold brew-nya segar banget buat nemenin sprint sore. Bakal repeat order tiap Senin.",
          created_at: now,
        },
      ];
    }
  }
}

interface MarketplaceDeps {
  db: Record<string, any>;
  getReqUser: (req: any) => any;
  saveDbToFile: (immediate?: boolean) => void;
  broadcast: (data: any) => void;
  createNotification: (params: any) => any;
}

export function registerMarketplaceRoutes(app: Express, deps: MarketplaceDeps) {
  const { db, getReqUser, saveDbToFile, broadcast, createNotification } = deps;

  const findUser = (uid: string) =>
    (Array.isArray(db.users) ? db.users : []).find((u: any) => u?.user_id === uid);

  const enrichListing = (item: any) => {
    const seller = findUser(item.seller_id);
    const reviews = (db.marketplace_reviews || []).filter((r: any) => r.listing_id === item.id);
    const ratingAvg =
      reviews.length > 0
        ? Number((reviews.reduce((sum: number, r: any) => sum + Number(r.rating || 5), 0) / reviews.length).toFixed(1))
        : Number(item.rating_avg || 0);
    return {
      ...item,
      rating_avg: ratingAvg,
      rating_count: reviews.length > 0 ? reviews.length : Number(item.rating_count || 0),
      seller: seller
        ? {
            user_id: seller.user_id,
            name: seller.name,
            avatar: seller.avatar || seller.picture || "",
            department: seller.department || item.seller_department || "Workspace",
            job_title: seller.job_title || "Karyawan",
            online: Boolean(seller.online),
          }
        : {
            user_id: item.seller_id,
            name: item.seller_name || "Rekan Kerja",
            avatar: "",
            department: item.seller_department || "Workspace",
            job_title: "Karyawan",
            online: false,
          },
    };
  };

  const buildStats = () => {
    const listings = Array.isArray(db.marketplace_listings) ? db.marketplace_listings : [];
    const orders = Array.isArray(db.marketplace_orders) ? db.marketplace_orders : [];
    const validOrders = orders.filter((o: any) => o.status !== "cancelled");
    const completedOrders = orders.filter((o: any) => o.status === "completed");
    const gmv = validOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);
    return {
      total_listings: listings.length,
      active_listings: listings.filter((l: any) => l.status !== "archived" && Number(l.stock || 0) > 0).length,
      total_orders: orders.length,
      completed_orders: completedOrders.length,
      pending_verification: orders.filter((o: any) => o.status === "awaiting_verification").length,
      gmv,
    };
  };

  const isPaymentMethodAllowed = (method: string, cfg: MarketplaceConfig) => {
    switch (method) {
      case "qris":
        return cfg.allow_qris;
      case "bank_transfer":
        return cfg.allow_bank_transfer;
      case "ewallet":
        return cfg.allow_ewallet;
      case "cod":
        return cfg.allow_cod;
      case "payroll":
        return cfg.allow_payroll;
      default:
        return false;
    }
  };

  const buildPaymentInstruction = (
    method: string,
    channel: string,
    orderNumber: string,
    amount: number,
    cfg: MarketplaceConfig
  ) => {
    const digits = String(Date.now()).slice(-8);
    const expiryMinutes = Math.max(5, Number(cfg.payment_expiry_minutes || 60));
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    const gwEnabled = cfg.payment_gateway_enabled && method !== "cod" && method !== "payroll";
    const provider = gwEnabled ? cfg.payment_gateway_provider : "manual";
    const providerUpper = provider.toUpperCase();
    const snapToken = gwEnabled
      ? `SNAP-${providerUpper}-${orderNumber.replace(/[^A-Z0-9]/g, "")}-${digits.slice(-4)}`
      : null;
    const transactionId = gwEnabled
      ? `${provider}-tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      : `internal-tx-${digits}`;

    const gatewayMeta = {
      gateway_enabled: gwEnabled,
      provider,
      provider_label:
        provider === "midtrans"
          ? "Midtrans Snap"
          : provider === "xendit"
          ? "Xendit Checkout"
          : provider === "doku"
          ? "DOKU Jokul"
          : "Internal Escrow",
      environment: cfg.payment_gateway_env,
      mode: cfg.payment_gateway_mode,
      auto_verify: cfg.payment_gateway_auto_verify,
      snap_token: snapToken,
      transaction_id: transactionId,
      expiry_minutes: expiryMinutes,
      redirect_url: gwEnabled
        ? `https://app.${cfg.payment_gateway_env === "production" ? "" : "sandbox."}midtrans.com/snap/v3/redirection/${snapToken}`
        : null,
    };

    if (method === "qris") {
      return {
        ...gatewayMeta,
        method,
        channel: gwEnabled ? `QRIS (${gatewayMeta.provider_label})` : "QRIS CIRCLE",
        reference_code: `QRIS-${orderNumber}`,
        qris_payload: `00020101021226620014ID.CO.QRIS.WWW011893600914000${digits}520459995303360540${amount}5802ID5913CIRCLE MARKET6007JAKARTA62180514${orderNumber}`,
        expires_at: expiresAt,
        instruction: gwEnabled
          ? `Pindai QRIS dinamis ${gatewayMeta.provider_label} dengan mobile banking / e-wallet. Status pembayaran otomatis terverifikasi via Webhook.`
          : "Pindai kode QRIS dengan aplikasi mobile banking atau e-wallet Anda lalu konfirmasi pembayaran.",
      };
    }
    if (method === "bank_transfer") {
      const bankPrefixes: Record<string, string> = {
        BCA: "39010",
        Mandiri: "88708",
        BNI: "82770",
        BRI: "26215",
      };
      const cleanChannel = bankPrefixes[channel] ? channel : "BCA";
      return {
        ...gatewayMeta,
        method,
        channel: `VA ${cleanChannel}`,
        va_number: `${bankPrefixes[cleanChannel]}${digits}`,
        account_name: gwEnabled ? `${gatewayMeta.provider_label.toUpperCase()} · CIRCLE MARKET` : "CIRCLE INTERNAL ESCROW",
        reference_code: `VA-${cleanChannel}-${digits}`,
        expires_at: expiresAt,
        instruction: gwEnabled
          ? `Transfer tepat sesuai nominal ke Virtual Account ${cleanChannel} (${gatewayMeta.provider_label}). Pembayaran diverifikasi otomatis tanpa perlu upload bukti manual.`
          : `Transfer sesuai nominal ke nomor Virtual Account ${cleanChannel} di atas atau unggah bukti transfer manual.`,
      };
    }
    if (method === "ewallet") {
      const cleanWallet = ["GoPay", "OVO", "DANA", "ShopeePay"].includes(channel) ? channel : "GoPay";
      return {
        ...gatewayMeta,
        method,
        channel: cleanWallet,
        reference_code: `${cleanWallet.toUpperCase()}-${digits}`,
        wallet_code: `0812-8800-${digits.slice(-4)}`,
        expires_at: expiresAt,
        instruction: gwEnabled
          ? `Buka aplikasi ${cleanWallet} atau selesaikan lewat popup ${gatewayMeta.provider_label} untuk verifikasi instan.`
          : `Selesaikan pembayaran instan melalui aplikasi ${cleanWallet} dengan nominal tepat.`,
      };
    }
    if (method === "payroll") {
      return {
        ...gatewayMeta,
        gateway_enabled: false,
        method,
        channel: "Potong Gaji / Kasbon Karyawan",
        reference_code: `PAYROLL-${orderNumber}`,
        expires_at: expiresAt,
        instruction: "Tagihan akan dijadwalkan otomatis ke pemotongan payroll siklus bulan berjalan setelah konfirmasi.",
      };
    }
    return {
      ...gatewayMeta,
      gateway_enabled: false,
      method: "cod",
      channel: "COD (Bayar di Tempat / Meja Kantor)",
      reference_code: `COD-${orderNumber}`,
      expires_at: expiresAt,
      instruction: "Bayar langsung secara tunai atau QRIS pribadi saat barang diterima di kantor.",
    };
  };

  // Helper to request real Midtrans Snap Token when MIDTRANS_SERVER_KEY is configured
  const requestLiveMidtransSnap = async (order: any, buyer: any, cfg: MarketplaceConfig) => {
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
    if (!serverKey || cfg.payment_gateway_provider !== "midtrans" || !cfg.payment_gateway_enabled) {
      return null;
    }
    try {
      const endpoint =
        cfg.payment_gateway_env === "production"
          ? "https://app.midtrans.com/snap/v1/transactions"
          : "https://app.sandbox.midtrans.com/snap/v1/transactions";
      const authHeader = `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
      const payload = {
        transaction_details: {
          order_id: order.order_number,
          gross_amount: Math.round(Number(order.total_amount || 0)),
        },
        customer_details: {
          first_name: buyer?.name || order.buyer_name || "Karyawan",
          email: buyer?.email || "karyawan@workspace.local",
          phone: order.buyer_phone || "",
        },
        item_details: (order.items || []).map((it: any) => ({
          id: it.listing_id,
          price: Math.round(Number(it.price || 0)),
          quantity: Math.round(Number(it.qty || 1)),
          name: String(it.title || "Produk").slice(0, 50),
        })),
        expiry: {
          unit: "minutes",
          duration: Math.max(5, Number(cfg.payment_expiry_minutes || 60)),
        },
      };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return null;
      const data: any = await resp.json();
      if (data?.token) {
        return {
          snap_token: data.token,
          redirect_url: data.redirect_url || null,
          live_api: true,
        };
      }
    } catch {
      // Fallback to sandbox simulator token if network or key fails
    }
    return null;
  };

  // Config & status endpoint (always readable by authenticated users)
  app.get("/api/marketplace/config", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Autentikasi diperlukan." });
    ensureMarketplaceData(db);
    const config = getMarketplaceConfig(db);
    res.json({
      enabled: isMarketplaceEnabled(db),
      config,
      payment_gateway: getPaymentGatewayEnvStatus(config),
      stats: reqUser.role === "super_admin" ? buildStats() : undefined,
      webhook_logs: reqUser.role === "super_admin" ? (db.marketplace_webhook_logs || []).slice(0, 15) : undefined,
    });
  });

  // Payment Gateway Status & Readiness endpoint
  app.get("/api/marketplace/payment-gateway/status", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Autentikasi diperlukan." });
    ensureMarketplaceData(db);
    const config = getMarketplaceConfig(db);
    res.json({
      payment_gateway: getPaymentGatewayEnvStatus(config),
      webhook_logs: (db.marketplace_webhook_logs || []).slice(0, 20),
    });
  });

  // Main Marketplace hydrated state
  app.get("/api/marketplace/state", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Autentikasi diperlukan." });
    ensureMarketplaceData(db);

    const enabled = isMarketplaceEnabled(db);
    const config = getMarketplaceConfig(db);
    if (!enabled) {
      return res.json({
        enabled: false,
        config,
        payment_gateway: getPaymentGatewayEnvStatus(config),
        listings: [],
        orders: [],
        cart: [],
        wishlist: [],
        reviews: [],
        vouchers: [],
        stats: reqUser.role === "super_admin" ? buildStats() : undefined,
      });
    }

    const listings = (db.marketplace_listings || []).map(enrichListing);
    const allOrders = Array.isArray(db.marketplace_orders) ? db.marketplace_orders : [];
    const myOrders =
      reqUser.role === "super_admin"
        ? allOrders
        : allOrders.filter(
            (o: any) => o.buyer_id === reqUser.user_id || o.seller_id === reqUser.user_id
          );

    const rawCart = Array.isArray(db.marketplace_carts?.[reqUser.user_id])
      ? db.marketplace_carts[reqUser.user_id]
      : [];
    const wishlist = Array.isArray(db.marketplace_wishlists?.[reqUser.user_id])
      ? db.marketplace_wishlists[reqUser.user_id]
      : [];

    res.json({
      enabled: true,
      config,
      payment_gateway: getPaymentGatewayEnvStatus(config),
      listings,
      orders: myOrders,
      cart: rawCart,
      wishlist,
      reviews: db.marketplace_reviews || [],
      vouchers: (db.marketplace_vouchers || []).filter((v: any) => v.active !== false),
      stats: buildStats(),
    });
  });

  // Guard helper for mutating endpoints
  const checkEnabled = (req: any, res: any): any => {
    const reqUser = getReqUser(req);
    if (!reqUser) {
      res.status(401).json({ detail: "Autentikasi diperlukan." });
      return null;
    }
    ensureMarketplaceData(db);
    if (!isMarketplaceEnabled(db)) {
      res.status(403).json({
        detail: "Fitur Marketplace sedang dinonaktifkan oleh Super Admin.",
        disabled: true,
      });
      return null;
    }
    return reqUser;
  };

  // Create listing
  app.post("/api/marketplace/listings", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const b = req.body || {};
    const title = String(b.title || "").trim();
    const price = Math.max(0, Math.round(Number(b.price || 0)));
    if (!title) return res.status(400).json({ detail: "Judul produk/jasa wajib diisi." });
    if (!price || price < 1000) return res.status(400).json({ detail: "Harga minimal Rp 1.000." });

    const now = new Date().toISOString();
    const listing = {
      id: `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: String(b.description || "").trim(),
      price,
      compare_price: b.compare_price ? Math.max(price, Math.round(Number(b.compare_price))) : null,
      category: String(b.category || "Barang"),
      condition: String(b.condition || "Baru"),
      stock: Math.max(1, Math.min(999, Math.round(Number(b.stock ?? 1)))),
      sold_count: 0,
      rating_avg: 0,
      rating_count: 0,
      variants: Array.isArray(b.variants)
        ? b.variants.map((v: any) => String(v || "").trim()).filter(Boolean)
        : [],
      delivery_options:
        Array.isArray(b.delivery_options) && b.delivery_options.length > 0
          ? b.delivery_options
          : ["pickup_office", "desk_delivery"],
      pickup_location: String(b.pickup_location || `Meja ${reqUser.department || "Kantor"}`).trim(),
      image_file_id: b.image_file_id || null,
      image_key: b.image_key || (!b.image_file_id ? "seed_charger" : null),
      seller_id: reqUser.user_id,
      seller_name: reqUser.name,
      seller_department: reqUser.department || "Workspace",
      status: "active",
      created_at: now,
      updated_at: now,
    };

    db.marketplace_listings.unshift(listing);
    db.activity = db.activity || [];
    db.activity.unshift({
      id: `act_mkt_${Date.now()}`,
      user_id: reqUser.user_id,
      action: `menambahkan produk "${listing.title}" di Marketplace Karyawan`,
      created_at: now,
    });
    saveDbToFile();
    const enriched = enrichListing(listing);
    broadcast({ type: "marketplace:changed", listing: enriched });
    res.json(enriched);
  });

  // Update listing
  const handleUpdateListing = (req: any, res: any) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const idx = db.marketplace_listings.findIndex((l: any) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ detail: "Produk tidak ditemukan." });
    const prev = db.marketplace_listings[idx];
    if (prev.seller_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Anda tidak memiliki izin mengubah produk ini." });
    }

    const b = req.body || {};
    const nextPrice = b.price !== undefined ? Math.max(1000, Math.round(Number(b.price))) : prev.price;
    const updated = {
      ...prev,
      title: b.title !== undefined ? String(b.title).trim() || prev.title : prev.title,
      description: b.description !== undefined ? String(b.description).trim() : prev.description,
      price: nextPrice,
      compare_price:
        b.compare_price !== undefined
          ? b.compare_price
            ? Math.max(nextPrice, Math.round(Number(b.compare_price)))
            : null
          : prev.compare_price,
      category: b.category !== undefined ? String(b.category) : prev.category,
      condition: b.condition !== undefined ? String(b.condition) : prev.condition,
      stock: b.stock !== undefined ? Math.max(0, Math.min(999, Math.round(Number(b.stock)))) : prev.stock,
      variants: Array.isArray(b.variants)
        ? b.variants.map((v: any) => String(v || "").trim()).filter(Boolean)
        : prev.variants,
      delivery_options:
        Array.isArray(b.delivery_options) && b.delivery_options.length > 0
          ? b.delivery_options
          : prev.delivery_options,
      pickup_location: b.pickup_location !== undefined ? String(b.pickup_location).trim() : prev.pickup_location,
      image_file_id: b.image_file_id !== undefined ? b.image_file_id : prev.image_file_id,
      image_key: b.image_key !== undefined ? b.image_key : prev.image_key,
      status: b.status !== undefined ? String(b.status) : prev.status,
      updated_at: new Date().toISOString(),
    };

    db.marketplace_listings[idx] = updated;
    saveDbToFile();
    const enriched = enrichListing(updated);
    broadcast({ type: "marketplace:changed", listing: enriched });
    res.json(enriched);
  };
  app.put("/api/marketplace/listings/:id", handleUpdateListing);
  app.patch("/api/marketplace/listings/:id", handleUpdateListing);

  // Delete listing
  app.delete("/api/marketplace/listings/:id", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const target = db.marketplace_listings.find((l: any) => l.id === req.params.id);
    if (!target) return res.status(404).json({ detail: "Produk tidak ditemukan." });
    if (target.seller_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Hanya pemilik toko atau Super Admin yang dapat menghapus produk." });
    }

    db.marketplace_listings = db.marketplace_listings.filter((l: any) => l.id !== req.params.id);
    saveDbToFile();
    broadcast({ type: "marketplace:changed", deleted_listing_id: req.params.id });
    res.json({ success: true });
  });

  // Toggle wishlist
  app.post("/api/marketplace/wishlist/:id", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const itemId = req.params.id;
    const current: string[] = Array.isArray(db.marketplace_wishlists[reqUser.user_id])
      ? [...db.marketplace_wishlists[reqUser.user_id]]
      : [];
    const exists = current.includes(itemId);
    const next = exists ? current.filter((id) => id !== itemId) : [itemId, ...current];
    db.marketplace_wishlists[reqUser.user_id] = next;
    saveDbToFile();
    res.json({ wishlist: next, liked: !exists });
  });

  // Update full cart
  app.put("/api/marketplace/cart", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const cleaned = items
      .map((entry: any) => {
        const listing = db.marketplace_listings.find((l: any) => l.id === entry.listing_id);
        if (!listing || listing.stock <= 0) return null;
        return {
          listing_id: listing.id,
          variant: String(entry.variant || listing.variants?.[0] || "Standar"),
          qty: Math.max(1, Math.min(Number(listing.stock || 1), Math.round(Number(entry.qty || 1)))),
        };
      })
      .filter(Boolean);

    db.marketplace_carts[reqUser.user_id] = cleaned;
    saveDbToFile();
    res.json({ cart: cleaned });
  });

  // Add item to cart
  app.post("/api/marketplace/cart/add", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const { listing_id, variant, qty = 1 } = req.body || {};
    const listing = db.marketplace_listings.find((l: any) => l.id === listing_id);
    if (!listing) return res.status(404).json({ detail: "Produk tidak ditemukan." });
    if (Number(listing.stock || 0) <= 0) return res.status(400).json({ detail: "Stok produk sedang habis." });

    const chosenVariant = String(variant || listing.variants?.[0] || "Standar");
    const addQty = Math.max(1, Math.round(Number(qty || 1)));
    const cart: any[] = Array.isArray(db.marketplace_carts[reqUser.user_id])
      ? [...db.marketplace_carts[reqUser.user_id]]
      : [];

    const existingIdx = cart.findIndex(
      (c) => c.listing_id === listing.id && String(c.variant || "") === chosenVariant
    );
    if (existingIdx >= 0) {
      cart[existingIdx] = {
        ...cart[existingIdx],
        qty: Math.min(Number(listing.stock), Number(cart[existingIdx].qty || 1) + addQty),
      };
    } else {
      cart.push({
        listing_id: listing.id,
        variant: chosenVariant,
        qty: Math.min(Number(listing.stock), addQty),
      });
    }

    db.marketplace_carts[reqUser.user_id] = cart;
    saveDbToFile();
    res.json({ cart });
  });

  // Validate voucher
  app.post("/api/marketplace/vouchers/validate", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const code = String(req.body?.code || "").trim().toUpperCase();
    const subtotal = Math.max(0, Number(req.body?.subtotal || 0));
    const voucher = (db.marketplace_vouchers || []).find(
      (v: any) => v.active !== false && String(v.code || "").toUpperCase() === code
    );
    if (!voucher) {
      return res.status(404).json({ detail: "Kode voucher tidak ditemukan atau sudah tidak berlaku." });
    }
    if (subtotal < Number(voucher.min_spend || 0)) {
      return res.status(400).json({
        detail: `Minimal belanja Rp ${Number(voucher.min_spend).toLocaleString("id-ID")} untuk voucher ${voucher.code}.`,
      });
    }

    const discount =
      voucher.discount_type === "percent"
        ? Math.min(
            Number(voucher.max_discount || 99999999),
            Math.round((subtotal * Number(voucher.discount_value || 0)) / 100)
          )
        : Math.min(subtotal, Number(voucher.discount_value || 0));

    res.json({ voucher, discount });
  });

  // Atomic Checkout -> creates order(s) + payment instructions + Midtrans Snap token
  app.post("/api/marketplace/checkout", async (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const cfg = getMarketplaceConfig(db);
    const {
      items = [],
      delivery_method = "pickup_office",
      buyer_location = "",
      buyer_phone = "",
      delivery_note = "",
      payment_method = "qris",
      payment_channel = "QRIS",
      voucher_code = "",
      clear_cart = true,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "Keranjang belanja kosong." });
    }
    if (!isPaymentMethodAllowed(payment_method, cfg)) {
      return res.status(400).json({ detail: "Metode pembayaran ini sedang dinonaktifkan oleh Super Admin." });
    }

    // Validate stock & collect resolved line items
    const resolvedItems: any[] = [];
    for (const rawItem of items) {
      const listing = db.marketplace_listings.find((l: any) => l.id === rawItem.listing_id);
      if (!listing) return res.status(404).json({ detail: "Salah satu produk tidak lagi tersedia." });
      const qty = Math.max(1, Math.round(Number(rawItem.qty || 1)));
      if (Number(listing.stock || 0) < qty) {
        return res.status(400).json({
          detail: `Stok "${listing.title}" tersisa ${listing.stock} unit.`,
        });
      }
      resolvedItems.push({
        listing,
        qty,
        variant: String(rawItem.variant || listing.variants?.[0] || "Standar"),
      });
    }

    const grandSubtotal = resolvedItems.reduce(
      (sum, r) => sum + Number(r.listing.price) * Number(r.qty),
      0
    );

    // Optional voucher discount
    let totalDiscount = 0;
    let appliedVoucher: any = null;
    const cleanCode = String(voucher_code || "").trim().toUpperCase();
    if (cleanCode) {
      const voucher = (db.marketplace_vouchers || []).find(
        (v: any) => v.active !== false && String(v.code || "").toUpperCase() === cleanCode
      );
      if (voucher && grandSubtotal >= Number(voucher.min_spend || 0)) {
        appliedVoucher = voucher;
        totalDiscount =
          voucher.discount_type === "percent"
            ? Math.min(
                Number(voucher.max_discount || 99999999),
                Math.round((grandSubtotal * Number(voucher.discount_value || 0)) / 100)
              )
            : Math.min(grandSubtotal, Number(voucher.discount_value || 0));
      }
    }

    // Group by seller
    const groupsBySeller = new Map<string, any[]>();
    resolvedItems.forEach((entry) => {
      const sid = entry.listing.seller_id;
      if (!groupsBySeller.has(sid)) groupsBySeller.set(sid, []);
      groupsBySeller.get(sid)!.push(entry);
    });

    const now = new Date().toISOString();
    const dateStamp = now.slice(0, 10).replace(/-/g, "");
    const createdOrders: any[] = [];
    let allocatedDiscount = 0;
    const sellerIds = Array.from(groupsBySeller.keys());

    // Decrement stock first (validated above)
    resolvedItems.forEach(({ listing, qty }) => {
      listing.stock = Math.max(0, Number(listing.stock || 0) - qty);
      listing.updated_at = now;
    });

    for (let idx = 0; idx < sellerIds.length; idx++) {
      const sellerId = sellerIds[idx];
      const groupItems = groupsBySeller.get(sellerId)!;
      const sellerUser = findUser(sellerId);
      const subtotal = groupItems.reduce(
        (sum, r) => sum + Number(r.listing.price) * Number(r.qty),
        0
      );
      const deliveryFee = delivery_method === "courier" ? 10000 : 0;
      const isLast = idx === sellerIds.length - 1;
      const orderDiscount =
        totalDiscount > 0
          ? isLast
            ? totalDiscount - allocatedDiscount
            : Math.round((subtotal / Math.max(1, grandSubtotal)) * totalDiscount)
          : 0;
      allocatedDiscount += orderDiscount;

      const platformFee = Math.round((Math.max(0, subtotal - orderDiscount) * cfg.platform_fee_pct) / 100);
      const totalAmount = Math.max(0, subtotal - orderDiscount + deliveryFee + platformFee);
      const seq = String(Math.floor(1000 + Math.random() * 9000));
      const orderNumber = `ORD-${dateStamp}-${seq}`;
      const isCod = payment_method === "cod";

      const paymentInfo = buildPaymentInstruction(
        payment_method,
        payment_channel,
        orderNumber,
        totalAmount,
        cfg
      );

      const order: any = {
        id: `mkt_ord_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        order_number: orderNumber,
        buyer_id: reqUser.user_id,
        buyer_name: reqUser.name,
        buyer_department: reqUser.department || "Workspace",
        buyer_location: String(buyer_location || `Meja ${reqUser.department || "Kantor"}`).trim(),
        buyer_phone: String(buyer_phone || "").trim(),
        seller_id: sellerId,
        seller_name: sellerUser?.name || groupItems[0].listing.seller_name || "Penjual",
        seller_department: sellerUser?.department || groupItems[0].listing.seller_department || "Workspace",
        items: groupItems.map((g) => ({
          listing_id: g.listing.id,
          title: g.listing.title,
          price: g.listing.price,
          qty: g.qty,
          variant: g.variant,
          image_file_id: g.listing.image_file_id || null,
          image_key: g.listing.image_key || null,
        })),
        subtotal,
        discount: orderDiscount,
        voucher_code: appliedVoucher ? appliedVoucher.code : null,
        delivery_method,
        delivery_fee: deliveryFee,
        delivery_note: String(delivery_note || "").trim(),
        platform_fee: platformFee,
        total_amount: totalAmount,
        payment_method,
        payment_channel: payment_channel || payment_method.toUpperCase(),
        payment_info: paymentInfo,
        payment_status: isCod ? "cod_pending" : "unpaid",
        payment_proof_file_id: null,
        payment_ref: null,
        status: isCod ? "paid_processing" : "pending_payment",
        reviewed: false,
        history: [
          {
            status: isCod ? "paid_processing" : "pending_payment",
            label: isCod
              ? "Pesanan COD dibuat · Menunggu disiapkan penjual"
              : paymentInfo.gateway_enabled
              ? `Tagihan ${paymentInfo.provider_label} (${paymentInfo.snap_token}) dibuat · Menunggu pembayaran`
              : "Pesanan dibuat · Menunggu pembayaran",
            actor_name: reqUser.name,
            at: now,
          },
        ],
        created_at: now,
        updated_at: now,
      };

      // If live MIDTRANS_SERVER_KEY is present, fetch official Snap token
      const liveSnap = await requestLiveMidtransSnap(order, reqUser, cfg);
      if (liveSnap) {
        order.payment_info.snap_token = liveSnap.snap_token;
        order.payment_info.redirect_url = liveSnap.redirect_url;
        order.payment_info.live_api = true;
      }

      db.marketplace_orders.unshift(order);
      createdOrders.push(order);

      if (sellerId !== reqUser.user_id) {
        createNotification({
          user_id: sellerId,
          title: "Pesanan Baru di Marketplace",
          body: `${reqUser.name} memesan ${groupItems.length} item (${orderNumber}) senilai Rp ${totalAmount.toLocaleString("id-ID")}`,
          type: "marketplace_order",
          category: "general",
          actor_id: reqUser.user_id,
          link: "/marketplace",
        });
      }
    }

    if (clear_cart) {
      const checkedKeys = new Set(items.map((x: any) => `${x.listing_id}::${x.variant || ""}`));
      const existingCart = Array.isArray(db.marketplace_carts[reqUser.user_id])
        ? db.marketplace_carts[reqUser.user_id]
        : [];
      db.marketplace_carts[reqUser.user_id] = existingCart.filter(
        (c: any) => !checkedKeys.has(`${c.listing_id}::${c.variant || ""}`) && !items.some((x: any) => x.listing_id === c.listing_id)
      );
    }

    const updatedListings = Array.from(new Set(resolvedItems.map((r) => r.listing))).map(enrichListing);
    saveDbToFile(true);
    broadcast({ type: "marketplace:changed", orders: createdOrders, updated_listings: updatedListings });
    res.json({
      orders: createdOrders,
      cart: db.marketplace_carts[reqUser.user_id] || [],
      updated_listings: updatedListings,
    });
  });

  // Create or refresh Midtrans Snap / Gateway Token for an existing order
  app.post("/api/marketplace/orders/:id/snap-token", async (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const order = db.marketplace_orders.find((o: any) => o.id === req.params.id || o.order_number === req.params.id);
    if (!order) return res.status(404).json({ detail: "Pesanan tidak ditemukan." });

    const cfg = getMarketplaceConfig(db);
    const refreshedInfo = buildPaymentInstruction(
      order.payment_method,
      order.payment_channel,
      order.order_number,
      order.total_amount,
      cfg
    );
    const liveSnap = await requestLiveMidtransSnap(order, reqUser, cfg);
    if (liveSnap) {
      refreshedInfo.snap_token = liveSnap.snap_token;
      refreshedInfo.redirect_url = liveSnap.redirect_url;
    }
    order.payment_info = { ...(order.payment_info || {}), ...refreshedInfo };
    order.updated_at = new Date().toISOString();
    saveDbToFile();

    res.json({
      order_id: order.id,
      order_number: order.order_number,
      payment_info: order.payment_info,
      payment_gateway: getPaymentGatewayEnvStatus(cfg),
    });
  });

  // Shared Webhook Processor for Midtrans HTTP Notification & Unified Gateway Callbacks
  const processGatewayWebhook = (payload: any, sourceLabel = "midtrans", skipSignatureCheck = false) => {
    ensureMarketplaceData(db);
    const cfg = getMarketplaceConfig(db);
    const orderIdOrNumber = String(payload?.order_id || payload?.external_id || payload?.order_number || "").trim();
    const transactionStatus = String(payload?.transaction_status || payload?.status || "settlement").toLowerCase();
    const fraudStatus = String(payload?.fraud_status || "accept").toLowerCase();
    const paymentType = String(payload?.payment_type || payload?.payment_channel || "qris").toLowerCase();
    const statusCode = String(payload?.status_code || "200");
    const grossAmountRaw = String(payload?.gross_amount ?? "0");
    const transactionId = String(
      payload?.transaction_id || `${sourceLabel}-wh-${Date.now().toString().slice(-6)}`
    );

    // Optional SHA-512 signature verification for Midtrans when MIDTRANS_SERVER_KEY is present
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
    let signatureVerified = true;
    if (serverKey && !skipSignatureCheck && payload?.signature_key) {
      const expectedSig = crypto
        .createHash("sha512")
        .update(`${orderIdOrNumber}${statusCode}${grossAmountRaw}${serverKey}`)
        .digest("hex");
      signatureVerified = expectedSig === String(payload.signature_key).toLowerCase();
    }

    const order = (db.marketplace_orders || []).find(
      (o: any) => o.order_number === orderIdOrNumber || o.id === orderIdOrNumber
    );

    const now = new Date().toISOString();
    let actionSummary = `Webhook ${sourceLabel.toUpperCase()} diterima (${transactionStatus})`;

    if (order && signatureVerified) {
      if (
        (transactionStatus === "capture" && fraudStatus === "accept") ||
        transactionStatus === "settlement" ||
        transactionStatus === "paid" ||
        transactionStatus === "completed"
      ) {
        if (order.status !== "completed" && order.status !== "cancelled") {
          order.payment_status = "paid";
          order.payment_ref = transactionId;
          order.paid_at = now;
          order.updated_at = now;
          if (cfg.payment_gateway_auto_verify) {
            order.status = "paid_processing";
            order.history.unshift({
              status: "paid_processing",
              label: `Webhook ${sourceLabel.toUpperCase()} (${transactionStatus.toUpperCase()} · ${transactionId}) terverifikasi otomatis · Penjual menyiapkan pesanan`,
              actor_name: `Payment Gateway (${sourceLabel.toUpperCase()})`,
              at: now,
            });
            actionSummary = `Pesanan ${order.order_number} otomatis LUNAS (paid_processing) via Webhook ${sourceLabel.toUpperCase()}.`;
          } else {
            order.status = "awaiting_verification";
            order.history.unshift({
              status: "awaiting_verification",
              label: `Notifikasi pembayaran ${sourceLabel.toUpperCase()} diterima · Menunggu persetujuan manual`,
              actor_name: `Payment Gateway (${sourceLabel.toUpperCase()})`,
              at: now,
            });
            actionSummary = `Pesanan ${order.order_number} masuk antrean verifikasi via Webhook.`;
          }

          createNotification({
            user_id: order.seller_id,
            title: `Pembayaran Gateway Lunas (${order.order_number})`,
            body: `Webhook ${sourceLabel.toUpperCase()} mengonfirmasi pembayaran Rp ${Number(order.total_amount).toLocaleString("id-ID")} dari ${order.buyer_name}.`,
            type: "marketplace_payment",
            category: "general",
            actor_id: order.buyer_id,
            link: "/marketplace",
          });
        }
      } else if (transactionStatus === "pending") {
        order.payment_status = "unpaid";
        order.updated_at = now;
        actionSummary = `Pesanan ${order.order_number} berstatus PENDING di ${sourceLabel.toUpperCase()}.`;
      } else if (["deny", "cancel", "expire", "expired", "failed"].includes(transactionStatus)) {
        if (order.status !== "completed" && order.status !== "cancelled") {
          order.status = "cancelled";
          order.payment_status = "unpaid";
          order.updated_at = now;
          (order.items || []).forEach((it: any) => {
            const listing = db.marketplace_listings.find((l: any) => l.id === it.listing_id);
            if (listing) {
              listing.stock = Number(listing.stock || 0) + Number(it.qty || 1);
            }
          });
          order.history.unshift({
            status: "cancelled",
            label: `Transaksi ${transactionStatus.toUpperCase()} dari ${sourceLabel.toUpperCase()} · Stok dikembalikan otomatis`,
            actor_name: `Payment Gateway (${sourceLabel.toUpperCase()})`,
            at: now,
          });
          actionSummary = `Pesanan ${order.order_number} dibatalkan otomatis (${transactionStatus}) & stok dikembalikan.`;
        }
      }
    }

    const logEntry = {
      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      provider: sourceLabel,
      event_type: `payment.${transactionStatus}`,
      order_number: order?.order_number || orderIdOrNumber || "TEST-WEBHOOK",
      transaction_id: transactionId,
      transaction_status: transactionStatus,
      payment_type: paymentType,
      gross_amount: Number(order?.total_amount || payload?.gross_amount || 0),
      status_code: signatureVerified ? "200" : "403",
      verified_signature: signatureVerified,
      message: signatureVerified ? actionSummary : "Signature key SHA-512 tidak cocok.",
      created_at: now,
    };

    db.marketplace_webhook_logs = [logEntry, ...(db.marketplace_webhook_logs || [])].slice(0, 30);
    saveDbToFile(true);
    broadcast({ type: "marketplace:changed", order, webhook_log: logEntry });
    return { signatureVerified, order, logEntry };
  };

  // Official Midtrans HTTP Notification Webhook Endpoint (no user session cookie required, uses signature verification)
  app.post("/api/marketplace/webhooks/midtrans", (req, res) => {
    const result = processGatewayWebhook(req.body || {}, "midtrans", false);
    if (!result.signatureVerified) {
      return res.status(403).json({ status_code: "403", status_message: "Invalid Midtrans signature_key" });
    }
    res.status(200).json({
      status_code: "200",
      status_message: "OK",
      order_number: result.logEntry.order_number,
      transaction_status: result.logEntry.transaction_status,
    });
  });

  // Unified Payment Gateway Webhook Endpoint (Midtrans / Xendit / DOKU)
  app.post("/api/marketplace/webhooks/payment", (req, res) => {
    const provider = String(req.body?.provider || req.query?.provider || "midtrans").toLowerCase();
    const result = processGatewayWebhook(req.body || {}, provider, false);
    res.status(200).json({
      status_code: "200",
      status_message: "OK",
      log: result.logEntry,
    });
  });

  // Simulate Payment Gateway Webhook (for Super Admin testing & in-app Sandbox instant settlement)
  app.post("/api/marketplace/payment-gateway/simulate-webhook", (req, res) => {
    const reqUser = getReqUser(req);
    if (!reqUser) return res.status(401).json({ detail: "Autentikasi diperlukan." });
    ensureMarketplaceData(db);

    const cfg = getMarketplaceConfig(db);
    const {
      order_id = "",
      transaction_status = "settlement",
      payment_type = "qris",
      gross_amount = 95000,
      provider = cfg.payment_gateway_provider || "midtrans",
    } = req.body || {};

    const targetOrder = order_id
      ? (db.marketplace_orders || []).find((o: any) => o.id === order_id || o.order_number === order_id)
      : (db.marketplace_orders || []).find((o: any) => o.status === "pending_payment");

    const orderNum = targetOrder?.order_number || order_id || `ORD-SIM-${Date.now().toString().slice(-4)}`;
    const amount = targetOrder?.total_amount || gross_amount;

    const result = processGatewayWebhook(
      {
        order_id: orderNum,
        transaction_status,
        payment_type,
        gross_amount: `${amount}.00`,
        status_code: "200",
        fraud_status: "accept",
        transaction_id: `${provider}-sim-${Date.now().toString().slice(-6)}`,
      },
      provider,
      true
    );

    res.json({
      ok: true,
      order: result.order || null,
      log: result.logEntry,
      webhook_logs: (db.marketplace_webhook_logs || []).slice(0, 15),
    });
  });

  // Buyer submits/confirms payment
  app.post("/api/marketplace/orders/:id/pay", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const order = db.marketplace_orders.find((o: any) => o.id === req.params.id);
    if (!order) return res.status(404).json({ detail: "Pesanan tidak ditemukan." });
    if (order.buyer_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Hanya pembeli yang dapat mengonfirmasi pembayaran." });
    }
    if (order.status === "cancelled" || order.status === "completed") {
      return res.status(400).json({ detail: "Status pesanan tidak dapat dibayar lagi." });
    }

    const {
      proof_file_id = null,
      sender_name = reqUser.name,
      transaction_ref = "",
      instant_simulate = true,
      gateway_provider = "",
    } = req.body || {};

    const cfg = getMarketplaceConfig(db);
    const now = new Date().toISOString();
    const isManualUpload = order.payment_method === "bank_transfer" && proof_file_id && !instant_simulate;
    const activeGatewayLabel =
      gateway_provider ||
      order.payment_info?.provider_label ||
      (cfg.payment_gateway_enabled ? `Gateway (${cfg.payment_gateway_provider.toUpperCase()})` : order.payment_channel);

    order.payment_proof_file_id = proof_file_id || order.payment_proof_file_id;
    order.payment_ref =
      transaction_ref ||
      order.payment_info?.snap_token ||
      order.payment_info?.reference_code ||
      `PAY-${Date.now().toString().slice(-6)}`;
    order.paid_at = now;
    order.updated_at = now;

    if (isManualUpload) {
      order.payment_status = "awaiting_verification";
      order.status = "awaiting_verification";
      order.history.unshift({
        status: "awaiting_verification",
        label: `Bukti transfer diunggah (${sender_name}) · Menunggu verifikasi penjual`,
        actor_name: reqUser.name,
        at: now,
      });
    } else {
      order.payment_status = order.payment_method === "payroll" ? "payroll_scheduled" : "paid";
      order.status = "paid_processing";
      order.history.unshift({
        status: "paid_processing",
        label:
          order.payment_method === "payroll"
            ? "Otorisasi potong gaji karyawan dikonfirmasi · Penjual menyiapkan pesanan"
            : order.payment_info?.gateway_enabled
            ? `Pembayaran ${order.payment_channel} terverifikasi otomatis via ${activeGatewayLabel} · Penjual menyiapkan pesanan`
            : `Pembayaran ${order.payment_channel} berhasil terverifikasi · Penjual menyiapkan pesanan`,
        actor_name: reqUser.name,
        at: now,
      });

      // Record in webhook log if gateway is active
      if (order.payment_info?.gateway_enabled) {
        const logEntry = {
          id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          provider: order.payment_info?.provider || cfg.payment_gateway_provider || "midtrans",
          event_type: "payment.settlement",
          order_number: order.order_number,
          transaction_id: order.payment_info?.transaction_id || order.payment_ref,
          transaction_status: "settlement",
          payment_type: order.payment_method,
          gross_amount: Number(order.total_amount || 0),
          status_code: "200",
          verified_signature: true,
          message: `Settlement otomatis pesanan ${order.order_number} (${order.payment_channel}) berhasil.`,
          created_at: now,
        };
        db.marketplace_webhook_logs = [logEntry, ...(db.marketplace_webhook_logs || [])].slice(0, 30);
      }
    }

    if (order.seller_id !== reqUser.user_id) {
      createNotification({
        user_id: order.seller_id,
        title: isManualUpload ? "Verifikasi Bukti Transfer Marketplace" : "Pembayaran Marketplace Diterima",
        body: `${reqUser.name} telah membayar pesanan ${order.order_number} (Rp ${Number(order.total_amount).toLocaleString("id-ID")})`,
        type: "marketplace_payment",
        category: "general",
        actor_id: reqUser.user_id,
        link: "/marketplace",
      });
    }

    saveDbToFile(true);
    broadcast({ type: "marketplace:changed", order });
    res.json(order);
  });

  // Update order fulfillment/cancellation status
  app.post("/api/marketplace/orders/:id/status", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const order = db.marketplace_orders.find((o: any) => o.id === req.params.id);
    if (!order) return res.status(404).json({ detail: "Pesanan tidak ditemukan." });

    const isSeller = order.seller_id === reqUser.user_id;
    const isBuyer = order.buyer_id === reqUser.user_id;
    const isSuperAdmin = reqUser.role === "super_admin";
    if (!isSeller && !isBuyer && !isSuperAdmin) {
      return res.status(403).json({ detail: "Anda tidak berhak mengubah pesanan ini." });
    }

    const { action, note = "" } = req.body || {};
    const now = new Date().toISOString();

    if (action === "approve_payment") {
      if (!isSeller && !isSuperAdmin) return res.status(403).json({ detail: "Hanya penjual yang dapat memverifikasi pembayaran." });
      order.payment_status = "paid";
      order.status = "paid_processing";
      order.history.unshift({
        status: "paid_processing",
        label: "Pembayaran diverifikasi penjual · Pesanan diproses",
        actor_name: reqUser.name,
        at: now,
      });
    } else if (action === "reject_payment") {
      if (!isSeller && !isSuperAdmin) return res.status(403).json({ detail: "Hanya penjual yang dapat menolak bukti transfer." });
      order.payment_status = "unpaid";
      order.status = "pending_payment";
      order.history.unshift({
        status: "pending_payment",
        label: note ? `Bukti pembayaran ditolak: ${note}` : "Bukti pembayaran ditolak · Silakan unggah ulang",
        actor_name: reqUser.name,
        at: now,
      });
    } else if (action === "mark_ready") {
      if (!isSeller && !isSuperAdmin) return res.status(403).json({ detail: "Hanya penjual yang dapat memproses pengiriman." });
      const nextStatus = order.delivery_method === "pickup_office" ? "ready_pickup" : "shipped";
      order.status = nextStatus;
      order.history.unshift({
        status: nextStatus,
        label:
          nextStatus === "ready_pickup"
            ? "Pesanan siap diambil di titik temu kantor"
            : "Pesanan sedang diantar ke lokasi tujuan",
        actor_name: reqUser.name,
        at: now,
      });
    } else if (action === "complete") {
      if (order.status === "cancelled") return res.status(400).json({ detail: "Pesanan sudah dibatalkan." });
      if (order.status !== "completed") {
        order.status = "completed";
        if (order.payment_status === "cod_pending" || order.payment_status === "unpaid") {
          order.payment_status = "paid";
        }
        order.completed_at = now;
        (order.items || []).forEach((it: any) => {
          const listing = db.marketplace_listings.find((l: any) => l.id === it.listing_id);
          if (listing) {
            listing.sold_count = Number(listing.sold_count || 0) + Number(it.qty || 1);
          }
        });
        order.history.unshift({
          status: "completed",
          label: "Pesanan selesai & diterima dengan baik",
          actor_name: reqUser.name,
          at: now,
        });
      }
    } else if (action === "cancel") {
      if (order.status === "completed") return res.status(400).json({ detail: "Pesanan selesai tidak dapat dibatalkan." });
      if (order.status !== "cancelled") {
        order.status = "cancelled";
        // Restore stock
        (order.items || []).forEach((it: any) => {
          const listing = db.marketplace_listings.find((l: any) => l.id === it.listing_id);
          if (listing) {
            listing.stock = Number(listing.stock || 0) + Number(it.qty || 1);
          }
        });
        order.history.unshift({
          status: "cancelled",
          label: note ? `Pesanan dibatalkan: ${note}` : "Pesanan dibatalkan & stok dikembalikan",
          actor_name: reqUser.name,
          at: now,
        });
      }
    } else {
      return res.status(400).json({ detail: "Aksi status pesanan tidak dikenali." });
    }

    order.updated_at = now;
    const notifyTarget = isSeller ? order.buyer_id : order.seller_id;
    if (notifyTarget && notifyTarget !== reqUser.user_id) {
      createNotification({
        user_id: notifyTarget,
        title: `Update Pesanan ${order.order_number}`,
        body: order.history[0]?.label || "Status pesanan Anda telah diperbarui.",
        type: "marketplace_order",
        category: "general",
        actor_id: reqUser.user_id,
        link: "/marketplace",
      });
    }

    const touchedListings: any[] = [];
    if (action === "complete" || action === "cancel") {
      (order.items || []).forEach((it: any) => {
        const listing = db.marketplace_listings.find((l: any) => l.id === it.listing_id);
        if (listing) touchedListings.push(enrichListing(listing));
      });
    }

    saveDbToFile(true);
    broadcast({
      type: "marketplace:changed",
      order,
      ...(touchedListings.length > 0 ? { updated_listings: touchedListings } : {}),
    });
    res.json({
      ...order,
      ...(touchedListings.length > 0 ? { updated_listings: touchedListings } : {}),
    });
  });

  // Buyer reviews an item in a completed order
  app.post("/api/marketplace/orders/:id/review", (req, res) => {
    const reqUser = checkEnabled(req, res);
    if (!reqUser) return;

    const order = db.marketplace_orders.find((o: any) => o.id === req.params.id);
    if (!order) return res.status(404).json({ detail: "Pesanan tidak ditemukan." });
    if (order.buyer_id !== reqUser.user_id && reqUser.role !== "super_admin") {
      return res.status(403).json({ detail: "Hanya pembeli yang dapat memberikan ulasan." });
    }

    const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating || 5))));
    const comment = String(req.body?.comment || "").trim();
    const now = new Date().toISOString();
    const createdReviews: any[] = [];

    (order.items || []).forEach((it: any) => {
      const existing = db.marketplace_reviews.find(
        (r: any) => r.order_id === order.id && r.listing_id === it.listing_id && r.buyer_id === reqUser.user_id
      );
      if (existing) {
        existing.rating = rating;
        existing.comment = comment;
        existing.created_at = now;
        createdReviews.push(existing);
      } else {
        const rev = {
          id: `mkt_rev_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          listing_id: it.listing_id,
          order_id: order.id,
          buyer_id: reqUser.user_id,
          buyer_name: reqUser.name,
          rating,
          comment,
          created_at: now,
        };
        db.marketplace_reviews.unshift(rev);
        createdReviews.push(rev);
      }

      const listing = db.marketplace_listings.find((l: any) => l.id === it.listing_id);
      if (listing) {
        const itemReviews = db.marketplace_reviews.filter((r: any) => r.listing_id === listing.id);
        listing.rating_count = itemReviews.length;
        listing.rating_avg = Number(
          (itemReviews.reduce((s: number, r: any) => s + Number(r.rating || 5), 0) / Math.max(1, itemReviews.length)).toFixed(1)
        );
      }
    });

    order.reviewed = true;
    order.updated_at = now;

    const updatedListings = (order.items || [])
      .map((it: any) => db.marketplace_listings.find((l: any) => l.id === it.listing_id))
      .filter(Boolean)
      .map(enrichListing);

    saveDbToFile(true);
    broadcast({ type: "marketplace:changed", order, updated_listings: updatedListings, reviews: createdReviews });
    res.json({ reviews: createdReviews, order, updated_listings: updatedListings });
  });
}
