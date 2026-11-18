import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ShoppingBag,
  ShoppingCart,
  Search,
  Plus,
  Heart,
  Star,
  Package,
  Store,
  CheckCircle2,
  Clock,
  SlidersHorizontal,
  ShieldOff,
  Settings as Cog,
  ArrowLeft,
  Pencil,
  CreditCard,
  Truck,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl } from "../lib/api";
import { Avatar, PageHeader } from "../components/common";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select";
import {
  MARKETPLACE_CATEGORIES,
  ORDER_STATUS_META,
  formatIDR,
  resolveProductImage,
  resolveMarketplaceBannerImage,
  resolveMarketplaceBannerOverlay,
  RupiahReceiptIcon,
} from "./marketplace/catalogAssets";
import {
  getInitialMarketplaceState,
  prefetchMarketplaceState,
  setCachedMarketplaceState,
} from "./marketplace/marketplaceStore";
import { ProductDetailDialog, ListingFormDialog } from "./marketplace/ProductDialogs";
import {
  CartDrawer,
  CheckoutDialog,
  OrderPaymentModal,
  OrderReviewModal,
} from "./marketplace/CartAndCheckout";

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru" },
  { value: "popular", label: "Terlaris" },
  { value: "rating", label: "Rating Tertinggi" },
  { value: "price_asc", label: "Harga Termurah" },
  { value: "price_desc", label: "Harga Termahal" },
];

export default function Marketplace() {
  const { me, ws, setSession, subscribe, t } = useApp();
  const { itemId } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState("explore");
  // 0ms synchronous state hydration from memory/localStorage or seed catalog
  const [state, setState] = useState(() => getInitialMarketplaceState(me?.user_id, ws));

  const [searchQ, setSearchQ] = useState("");
  const [category, setCategory] = useState("Semua");
  const [sortBy, setSortBy] = useState("newest");

  const [selectedItem, setSelectedItem] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutPayload, setCheckoutPayload] = useState(null);
  const [payingOrder, setPayingOrder] = useState(null);
  const [reviewingOrder, setReviewingOrder] = useState(null);

  const commitState = useCallback(
    (updater) => {
      setState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setCachedMarketplaceState(me?.user_id, next);
        return next;
      });
    },
    [me?.user_id]
  );

  const loadState = useCallback(async (force = false) => {
    try {
      const data = await prefetchMarketplaceState(me?.user_id, force);
      if (data && typeof data === "object") {
        setState((prev) => {
          const authEnabled = typeof ws?.marketplace_enabled === "boolean" ? ws.marketplace_enabled : data.enabled;
          const next = { ...prev, ...data, enabled: authEnabled };
          setCachedMarketplaceState(me?.user_id, next);
          return next;
        });
        if (typeof data.enabled === "boolean" && typeof ws?.marketplace_enabled !== "boolean") {
          setSession((s) => {
            if (!s?.workspace || s.workspace.marketplace_enabled === data.enabled) return s;
            return {
              ...s,
              workspace: {
                ...s.workspace,
                marketplace_enabled: data.enabled,
                ...(data.config ? { marketplace_config: data.config } : {}),
              },
            };
          });
        }
      }
    } catch {}
  }, [me?.user_id, setSession, ws?.marketplace_enabled]);

  useEffect(() => {
    loadState(true);
  }, [me?.user_id, ws?.marketplace_enabled]);

  useEffect(() => {
    if (typeof ws?.marketplace_enabled !== "boolean") return;
    setState((prev) => {
      if (prev.enabled === ws.marketplace_enabled) return prev;
      const next = { ...prev, enabled: ws.marketplace_enabled };
      setCachedMarketplaceState(me?.user_id, next);
      return next;
    });
  }, [ws?.marketplace_enabled, me?.user_id]);

  useEffect(() => {
    return subscribe((evt) => {
      if (evt.type === "workspace:changed" || evt.type === "workspace:updated") {
        if (evt.data && typeof evt.data === "object") {
          commitState((prev) => ({
            ...prev,
            enabled: evt.data.marketplace_enabled !== false,
            ...(evt.data.marketplace_config ? { config: { ...(prev.config || {}), ...evt.data.marketplace_config } } : {}),
          }));
        }
        return;
      }
      if (evt.type === "marketplace:changed") {
        let handledIncremental = false;
        if (typeof evt.enabled === "boolean") {
          commitState((prev) => ({ ...prev, enabled: evt.enabled }));
          handledIncremental = true;
        }
        if (evt.listing?.id) {
          handledIncremental = true;
          commitState((prev) => {
            const cur = Array.isArray(prev.listings) ? prev.listings : [];
            const exists = cur.some((x) => x.id === evt.listing.id);
            return {
              ...prev,
              listings: exists ? cur.map((x) => (x.id === evt.listing.id ? evt.listing : x)) : [evt.listing, ...cur],
            };
          });
        }
        if (evt.deleted_listing_id) {
          handledIncremental = true;
          commitState((prev) => ({
            ...prev,
            listings: (prev.listings || []).filter((x) => x.id !== evt.deleted_listing_id),
          }));
        }
        if (Array.isArray(evt.updated_listings) && evt.updated_listings.length > 0) {
          handledIncremental = true;
          commitState((prev) => {
            const patchMap = Object.fromEntries(evt.updated_listings.map((l) => [l.id, l]));
            return {
              ...prev,
              listings: (prev.listings || []).map((l) => patchMap[l.id] || l),
            };
          });
        }
        if (evt.order?.id) {
          handledIncremental = true;
          commitState((prev) => {
            const cur = Array.isArray(prev.orders) ? prev.orders : [];
            const isMine = me?.role === "super_admin" || evt.order.buyer_id === me?.user_id || evt.order.seller_id === me?.user_id;
            if (!isMine) return prev;
            const exists = cur.some((o) => o.id === evt.order.id);
            return {
              ...prev,
              orders: exists ? cur.map((o) => (o.id === evt.order.id ? evt.order : o)) : [evt.order, ...cur],
            };
          });
        }
        if (Array.isArray(evt.orders) && evt.orders.length > 0) {
          handledIncremental = true;
          const mine = evt.orders.filter((o) => me?.role === "super_admin" || o.buyer_id === me?.user_id || o.seller_id === me?.user_id);
          if (mine.length > 0) {
            commitState((prev) => {
              const cur = Array.isArray(prev.orders) ? prev.orders : [];
              const existingIds = new Set(cur.map((o) => o.id));
              const fresh = mine.filter((o) => !existingIds.has(o.id));
              const updatedMap = Object.fromEntries(mine.map((o) => [o.id, o]));
              return {
                ...prev,
                orders: [...fresh, ...cur.map((o) => updatedMap[o.id] || o)],
              };
            });
          }
        }
        if (!handledIncremental) {
          loadState(true);
        }
      }
    });
  }, [subscribe, loadState, commitState, me?.user_id, me?.role]);

  useEffect(() => {
    if (itemId && Array.isArray(state.listings) && state.listings.length > 0) {
      const found = state.listings.find((l) => l.id === itemId);
      if (found) setSelectedItem(found);
    }
  }, [itemId, state.listings]);

  const isEnabled = typeof ws?.marketplace_enabled === "boolean" ? ws.marketplace_enabled : state.enabled !== false;

  const listingsMap = useMemo(() => {
    const map = {};
    (state.listings || []).forEach((l) => {
      map[l.id] = l;
    });
    return map;
  }, [state.listings]);

  const wishlistSet = useMemo(() => new Set(state.wishlist || []), [state.wishlist]);

  const filteredListings = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    let list = (state.listings || []).filter((item) => {
      if (tab === "wishlist" && !wishlistSet.has(item.id)) return false;
      if (category !== "Semua" && item.category !== category) return false;
      if (!q) return true;
      return `${item.title} ${item.description || ""} ${item.category || ""} ${item.seller_name || ""} ${item.seller_department || ""}`
        .toLowerCase()
        .includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "price_asc") return Number(a.price) - Number(b.price);
      if (sortBy === "price_desc") return Number(b.price) - Number(a.price);
      if (sortBy === "popular") return Number(b.sold_count || 0) - Number(a.sold_count || 0);
      if (sortBy === "rating") return Number(b.rating_avg || 0) - Number(a.rating_avg || 0);
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    return list;
  }, [state.listings, tab, wishlistSet, category, searchQ, sortBy]);

  const myListings = useMemo(
    () => (state.listings || []).filter((l) => l.seller_id === me?.user_id),
    [state.listings, me?.user_id]
  );

  const buyerOrders = useMemo(
    () => (state.orders || []).filter((o) => o.buyer_id === me?.user_id),
    [state.orders, me?.user_id]
  );

  const sellerOrders = useMemo(
    () => (state.orders || []).filter((o) => o.seller_id === me?.user_id),
    [state.orders, me?.user_id]
  );

  const sellerRevenue = useMemo(
    () =>
      sellerOrders
        .filter((o) => o.status !== "cancelled")
        .reduce((s, o) => s + Number(o.total_amount || 0), 0),
    [sellerOrders]
  );

  const sellerActionCount = useMemo(
    () =>
      sellerOrders.filter((o) =>
        ["awaiting_verification", "paid_processing"].includes(o.status)
      ).length,
    [sellerOrders]
  );

  const cartCount = useMemo(
    () => (state.cart || []).reduce((s, c) => s + Number(c.qty || 1), 0),
    [state.cart]
  );

  // 0ms optimistic wishlist toggle
  const toggleWishlist = async (id) => {
    const currentlyLiked = wishlistSet.has(id);
    commitState((prev) => {
      const cur = Array.isArray(prev.wishlist) ? prev.wishlist : [];
      const next = currentlyLiked ? cur.filter((x) => x !== id) : [id, ...cur];
      return { ...prev, wishlist: next };
    });
    toast.success(!currentlyLiked ? "Disimpan ke Favorit" : "Dihapus dari Favorit");
    try {
      const { data } = await api.post(`/marketplace/wishlist/${id}`);
      if (Array.isArray(data?.wishlist)) {
        commitState((prev) => ({ ...prev, wishlist: data.wishlist }));
      }
    } catch (err) {
      toast.error(errMsg(err));
      loadState();
    }
  };

  // 0ms optimistic Add to Cart
  const addToCart = async (item, variant, qty = 1) => {
    const chosenVariant = variant || item.variants?.[0] || "Standar";
    const addQty = Math.max(1, Math.round(Number(qty || 1)));
    commitState((prev) => {
      const cart = Array.isArray(prev.cart) ? [...prev.cart] : [];
      const idx = cart.findIndex(
        (c) => c.listing_id === item.id && String(c.variant || "") === chosenVariant
      );
      if (idx >= 0) {
        cart[idx] = {
          ...cart[idx],
          qty: Math.min(Number(item.stock || 99), Number(cart[idx].qty || 1) + addQty),
        };
      } else {
        cart.push({
          listing_id: item.id,
          variant: chosenVariant,
          qty: Math.min(Number(item.stock || 99), addQty),
        });
      }
      return { ...prev, cart };
    });
    toast.success(`"${item.title}" ditambahkan ke keranjang!`);
    try {
      const { data } = await api.post("/marketplace/cart/add", {
        listing_id: item.id,
        variant: chosenVariant,
        qty: addQty,
      });
      if (Array.isArray(data?.cart)) {
        commitState((prev) => ({ ...prev, cart: data.cart }));
      }
    } catch (err) {
      toast.error(errMsg(err));
      loadState();
    }
  };

  const syncCart = async (nextCart) => {
    commitState((prev) => ({ ...prev, cart: nextCart }));
    try {
      const { data } = await api.put("/marketplace/cart", { items: nextCart });
      if (Array.isArray(data?.cart)) {
        commitState((prev) => ({ ...prev, cart: data.cart }));
      }
    } catch (err) {
      toast.error(errMsg(err));
      loadState();
    }
  };

  const handleUpdateCartQty = (listingId, variant, nextQty) => {
    if (nextQty <= 0) {
      return handleRemoveCartItem(listingId, variant);
    }
    const next = (state.cart || []).map((c) =>
      c.listing_id === listingId && c.variant === variant ? { ...c, qty: nextQty } : c
    );
    syncCart(next);
  };

  const handleRemoveCartItem = (listingId, variant) => {
    const next = (state.cart || []).filter(
      (c) => !(c.listing_id === listingId && c.variant === variant)
    );
    syncCart(next);
  };

  // 0ms optimistic order status transitions
  const handleOrderAction = async (orderId, action, note = "") => {
    const now = new Date().toISOString();
    commitState((prev) => {
      const nextOrders = (prev.orders || []).map((ord) => {
        if (ord.id !== orderId) return ord;
        let nextStatus = ord.status;
        let nextPayStatus = ord.payment_status;
        let label = "Status pesanan diperbarui";
        if (action === "approve_payment") {
          nextStatus = "paid_processing";
          nextPayStatus = "paid";
          label = "Pembayaran diverifikasi penjual · Pesanan diproses";
        } else if (action === "reject_payment") {
          nextStatus = "pending_payment";
          nextPayStatus = "unpaid";
          label = note ? `Bukti pembayaran ditolak: ${note}` : "Bukti pembayaran ditolak";
        } else if (action === "mark_ready") {
          nextStatus = ord.delivery_method === "pickup_office" ? "ready_pickup" : "shipped";
          label =
            nextStatus === "ready_pickup"
              ? "Pesanan siap diambil di titik temu kantor"
              : "Pesanan sedang diantar ke lokasi tujuan";
        } else if (action === "complete") {
          nextStatus = "completed";
          nextPayStatus = "paid";
          label = "Pesanan selesai & diterima dengan baik";
        } else if (action === "cancel") {
          nextStatus = "cancelled";
          label = note ? `Pesanan dibatalkan: ${note}` : "Pesanan dibatalkan & stok dikembalikan";
        }
        return {
          ...ord,
          status: nextStatus,
          payment_status: nextPayStatus,
          updated_at: now,
          history: [
            { status: nextStatus, label, actor_name: me?.name || "Saya", at: now },
            ...(ord.history || []),
          ],
        };
      });
      return { ...prev, orders: nextOrders };
    });
    toast.success("Status pesanan berhasil diperbarui!");

    try {
      const { data } = await api.post(`/marketplace/orders/${orderId}/status`, { action, note });
      if (data?.id) {
        const { updated_listings: touched, ...cleanOrder } = data;
        commitState((prev) => {
          const patchMap = Array.isArray(touched) ? Object.fromEntries(touched.map((l) => [l.id, l])) : null;
          return {
            ...prev,
            orders: (prev.orders || []).map((o) => (o.id === cleanOrder.id ? cleanOrder : o)),
            ...(patchMap ? { listings: (prev.listings || []).map((l) => patchMap[l.id] || l) } : {}),
          };
        });
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui status pesanan"));
      loadState(true);
    }
  };

  const mktCfg = { ...(state.config || {}), ...(ws?.marketplace_config || {}) };
  const mc = (key, fallback) => {
    const fromCfg = mktCfg[key];
    if (fromCfg !== undefined && String(fromCfg).trim() !== "") return String(fromCfg);
    return t ? t(`mkt_${key}`, fallback) : fallback;
  };
  const mcAllowEmpty = (key, fallback) => {
    const fromCfg = mktCfg[key];
    if (fromCfg !== undefined) return String(fromCfg);
    return t ? t(`mkt_${key}`, fallback) : fallback;
  };

  // Disabled State Gate (Controlled by Super Admin in Settings)
  if (!isEnabled) {
    return (
      <div
        className="mx-auto flex min-h-[75vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-12 text-center animate-crossfade"
        data-testid="marketplace-disabled-state"
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-surface2 border text-sub">
          <ShieldOff size={30} />
        </div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-ink">
          {mc("disabled_title", "Fitur Marketplace Sedang Dinonaktifkan")}
        </h1>
        <p className="mt-2 max-w-md text-sm text-sub leading-relaxed">
          {mc(
            "disabled_subtitle",
            "Super Admin menonaktifkan sementara fitur Marketplace internal untuk workspace ini. Seluruh data produk dan riwayat transaksi tetap aman tersimpan."
          )}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-surface px-4 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
          >
            <ArrowLeft size={15} />
            <span>{mc("back_to_dashboard_btn", "Kembali ke Dashboard")}</span>
          </button>
          {me?.role === "super_admin" && (
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-sm hover:opacity-95 cursor-pointer"
              data-testid="marketplace-enable-shortcut-btn"
            >
              <Cog size={15} />
              <span>{mc("open_settings_btn", "Aktifkan di Pengaturan")}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const storeName = mc("store_name", "CIRCLE Market");
  const storeTagline = mc(
    "store_tagline",
    "Jual beli aman, preloved terkurasi & titip beli sesama rekan kerja."
  );
  const bannerEnabled = mktCfg.banner_enabled !== false;
  const bannerKicker = mcAllowEmpty("banner_kicker", "INTERNAL EMPLOYEE EXCHANGE");
  const bannerTitle = mc("banner_title", "Temukan Produk Pilihan & Jasa Rekan Kantor");
  const bannerSubtitle = mcAllowEmpty(
    "banner_subtitle",
    "Dukung sesama tim lewat transaksi QRIS, Virtual Account, E-Wallet, atau COD antar-meja."
  );
  const bannerPromoPrefix = mcAllowEmpty("banner_promo_prefix", "Kode");
  const bannerPromoCode = mcAllowEmpty("banner_promo_code", "TEMANKANTOR");
  const bannerPromoText = mcAllowEmpty("banner_promo_text", "diskon 10%.");
  const bannerImageSrc = resolveMarketplaceBannerImage(mktCfg.banner_image_url);
  const bannerOverlay = resolveMarketplaceBannerOverlay(mktCfg.banner_overlay_style);

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-5 lg:px-10 lg:py-8 space-y-5 animate-crossfade"
      data-testid="marketplace-page"
    >
      <PageHeader
        icon={ShoppingBag}
        title={storeName}
        subtitle={storeTagline}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative inline-flex h-10 items-center gap-2 rounded-xl border bg-surface px-3.5 text-xs sm:text-sm font-bold text-ink hover:bg-surface2 transition-colors cursor-pointer"
              data-testid="open-cart-btn"
            >
              <ShoppingCart size={16} className="text-brand" />
              <span>{mc("cart_btn_label", "Keranjang")}</span>
              {cartCount > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-extrabold text-white tabular-nums">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingItem(null);
                setFormOpen(true);
              }}
              className="btn-accent h-10 px-4 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
              data-testid="new-listing-btn"
            >
              <Plus size={16} />
              <span>{mc("sell_btn_label", "Jual Barang / Jasa")}</span>
            </button>
          </div>
        }
      />

      {/* Primary Section Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: "explore", label: mc("tab_explore_label", "Jelajahi"), icon: ShoppingBag },
          {
            id: "orders",
            label: `${mc("tab_orders_label", "Pesanan Saya")}${buyerOrders.length ? ` (${buyerOrders.length})` : ""}`,
            icon: RupiahReceiptIcon,
          },
          {
            id: "seller",
            label: `${mc("tab_seller_label", "Toko Saya")}${sellerActionCount > 0 ? ` · ${sellerActionCount} perlu aksi` : ""}`,
            icon: Store,
          },
          {
            id: "wishlist",
            label: `${mc("tab_wishlist_label", "Favorit")}${wishlistSet.size ? ` (${wishlistSet.size})` : ""}`,
            icon: Heart,
          },
        ].map((tabItem) => {
          const Icon = tabItem.icon;
          const active = tab === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                active
                  ? "bg-brand text-white shadow-xs"
                  : "border bg-surface text-sub hover:bg-surface2 hover:text-ink"
              }`}
              data-testid={`marketplace-tab-${tabItem.id}`}
            >
              <Icon size={15} />
              <span>{tabItem.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1 & 4: EXPLORE & WISHLIST */}
      {(tab === "explore" || tab === "wishlist") && (
        <div className="space-y-5">
          {tab === "explore" && bannerEnabled && (
            <section
              className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-slate-900"
              data-testid="marketplace-hero-banner"
            >
              <img
                src={bannerImageSrc}
                alt={storeName}
                className="h-44 sm:h-56 w-full object-cover opacity-80"
              />
              <div
                className={`absolute inset-0 bg-gradient-to-r ${bannerOverlay.overlayClass} flex items-center p-5 sm:p-8`}
              >
                <div className="max-w-lg space-y-2 text-white">
                  {bannerKicker && (
                    <p
                      className={`text-[11px] font-bold uppercase tracking-widest ${bannerOverlay.kickerClass}`}
                    >
                      {bannerKicker}
                    </p>
                  )}
                  <h2 className="text-xl sm:text-3xl font-extrabold leading-tight">
                    {bannerTitle}
                  </h2>
                  {(bannerSubtitle || bannerPromoCode || bannerPromoText) && (
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      {bannerSubtitle}
                      {bannerPromoCode ? (
                        <>
                          {bannerSubtitle ? " " : ""}
                          {bannerPromoPrefix ? `${bannerPromoPrefix} ` : ""}
                          <strong className="font-mono text-white">
                            {bannerPromoCode}
                          </strong>
                          {bannerPromoText ? ` ${bannerPromoText}` : ""}
                        </>
                      ) : bannerPromoText ? (
                        <>
                          {bannerSubtitle ? " " : ""}
                          {bannerPromoText}
                        </>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Filter & Search Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-3 text-sub" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder={mc("search_placeholder", "Cari barang, makanan, preloved, atau nama rekan...")}
                className="h-10 w-full rounded-xl border bg-surface pl-10 pr-3 text-sm outline-none focus:border-brand"
                data-testid="marketplace-search-input"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <SlidersHorizontal size={15} className="text-sub hidden sm:block" />
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-10 w-full sm:w-[175px] rounded-xl bg-surface text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {MARKETPLACE_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`h-9 shrink-0 rounded-xl px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? "bg-ink text-surface"
                      : "border bg-surface text-sub hover:text-ink hover:bg-surface2"
                  }`}
                  data-testid={`marketplace-cat-${cat}`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Product Grid */}
          {filteredListings.length === 0 ? (
            <div className="rounded-3xl border bg-surface p-10 text-center">
              <Package size={32} className="mx-auto mb-3 text-sub" />
              <p className="text-sm font-bold text-ink">
                {tab === "wishlist"
                  ? mc("empty_wishlist_title", "Belum ada produk di daftar Favorit")
                  : mc("empty_explore_title", "Produk tidak ditemukan")}
              </p>
              <p className="mt-1 text-xs text-sub">
                {mc(
                  "empty_explore_subtitle",
                  "Coba ubah kata kunci pencarian atau jadilah yang pertama menawarkan barang di kategori ini."
                )}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {filteredListings.map((item) => {
                const liked = wishlistSet.has(item.id);
                const soldOut = Number(item.stock || 0) <= 0;
                return (
                  <article
                    key={item.id}
                    className="group flex flex-col justify-between overflow-hidden rounded-2xl border bg-surface transition-all hover:shadow-md"
                    data-testid={`marketplace-card-${item.id}`}
                  >
                    <div>
                      <div
                        onClick={() => setSelectedItem(item)}
                        className="relative aspect-[4/3] w-full overflow-hidden bg-surface2 cursor-pointer"
                      >
                        <img
                          src={resolveProductImage(item)}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        {soldOut && (
                          <div className="absolute inset-0 bg-slate-950/55 flex items-center justify-center">
                            <span className="rounded-lg bg-slate-900/90 px-3 py-1 text-xs font-bold text-white">
                              {mc("sold_out_label", "Stok Habis")}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWishlist(item.id);
                          }}
                          className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/90 shadow-xs hover:scale-105 transition-transform cursor-pointer"
                          aria-label="Favoritkan"
                        >
                          <Heart
                            size={16}
                            className={liked ? "fill-rose-500 text-rose-500" : "text-sub"}
                          />
                        </button>
                      </div>

                      <div
                        onClick={() => setSelectedItem(item)}
                        className="p-4 pb-2 space-y-1.5 cursor-pointer"
                      >
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-sub truncate">
                          {item.category} · {item.condition} · {item.sold_count || 0} terjual
                        </p>
                        <h3 className="text-[15px] font-bold text-ink line-clamp-2 leading-snug pb-0.5">
                          {item.title}
                        </h3>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar
                              user={item.seller || { name: item.seller_name }}
                              size={22}
                              showStatus={false}
                            />
                            <span className="text-xs text-sub truncate leading-snug pb-0.5">
                              {item.seller?.name || item.seller_name}
                            </span>
                          </div>
                          {Number(item.rating_avg || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-ink tabular-nums shrink-0">
                              <Star size={12} className="fill-amber-400 text-amber-400" />
                              {item.rating_avg}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/70 mt-1">
                      <div className="min-w-0">
                        <p className="text-base font-extrabold text-ink tabular-nums">
                          {formatIDR(item.price)}
                        </p>
                        {item.compare_price && item.compare_price > item.price && (
                          <p className="text-[11px] text-sub line-through tabular-nums">
                            {formatIDR(item.compare_price)}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => addToCart(item)}
                        className="h-9 rounded-xl bg-brand/10 hover:bg-brand text-brand hover:text-white px-3 text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                        data-testid={`add-cart-${item.id}`}
                      >
                        {mc("add_to_cart_label", "+ Keranjang")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BUYER ORDERS */}
      {tab === "orders" && (
        <div className="space-y-4">
          {buyerOrders.length === 0 ? (
            <div className="rounded-3xl border bg-surface p-10 text-center">
              <RupiahReceiptIcon size={32} className="mx-auto mb-3 text-sub" />
              <p className="text-sm font-bold text-ink">
                {mc("empty_orders_title", "Belum ada pesanan pembelian")}
              </p>
              <p className="mt-1 text-xs text-sub">
                {mc(
                  "empty_orders_subtitle",
                  "Pesanan Anda dan status pembayarannya akan tercatat otomatis di sini."
                )}
              </p>
              <button
                type="button"
                onClick={() => setTab("explore")}
                className="btn-accent mt-4 h-10 px-5 text-xs font-bold cursor-pointer"
              >
                {mc("empty_orders_cta", "Jelajahi Katalog")}
              </button>
            </div>
          ) : (
            buyerOrders.map((ord) => {
              const meta = ORDER_STATUS_META[ord.status] || { label: ord.status, tone: "text-sub" };
              return (
                <div
                  key={ord.id}
                  className="rounded-2xl border bg-surface p-4 sm:p-5 space-y-4"
                  data-testid={`buyer-order-${ord.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-ink">
                          {ord.order_number}
                        </span>
                        <span className={`text-xs font-bold ${meta.tone}`}>
                          · {meta.label}
                        </span>
                      </div>
                      <p className="text-xs text-sub mt-0.5">
                        Penjual: <strong className="text-ink">{ord.seller_name}</strong> ({ord.seller_department}) · Pembayaran:{" "}
                        <strong className="text-ink">{ord.payment_info?.channel || ord.payment_channel}</strong>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-sub">Total Transaksi</p>
                      <p className="text-base font-extrabold text-ink tabular-nums">
                        {formatIDR(ord.total_amount)}
                      </p>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="space-y-2.5">
                    {(ord.items || []).map((it, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        <img
                          src={resolveProductImage(it)}
                          alt={it.title}
                          className="h-14 w-14 rounded-xl object-cover border shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-ink truncate leading-snug pb-0.5">
                            {it.title}
                          </p>
                          <p className="text-xs text-sub tabular-nums">
                            {it.variant} · {it.qty} × {formatIDR(it.price)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Latest History + Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
                    <div className="flex items-center gap-2 text-xs text-sub min-w-0">
                      <Clock size={14} className="shrink-0 text-brand" />
                      <span className="truncate">{ord.history?.[0]?.label || meta.label}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      {ord.status === "pending_payment" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOrderAction(ord.id, "cancel", "Dibatalkan pembeli")}
                            className="h-9 rounded-xl border px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          >
                            Batalkan
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayingOrder(ord)}
                            className="h-9 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 inline-flex items-center gap-1.5 cursor-pointer"
                            data-testid={`pay-order-btn-${ord.id}`}
                          >
                            <CreditCard size={14} />
                            <span>Bayar Sekarang</span>
                          </button>
                        </>
                      )}

                      {["paid_processing", "ready_pickup", "shipped"].includes(ord.status) && (
                        <button
                          type="button"
                          onClick={() => handleOrderAction(ord.id, "complete")}
                          className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                          data-testid={`complete-order-btn-${ord.id}`}
                        >
                          <CheckCircle2 size={14} />
                          <span>Pesanan Diterima</span>
                        </button>
                      )}

                      {ord.status === "completed" && !ord.reviewed && (
                        <button
                          type="button"
                          onClick={() => setReviewingOrder(ord)}
                          className="h-9 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 text-xs font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Star size={14} />
                          <span>Beri Ulasan</span>
                        </button>
                      )}

                      {ord.status === "completed" && ord.reviewed && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                          <CheckCircle2 size={14} /> Sudah Diulas
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: SELLER HUB */}
      {tab === "seller" && (
        <div className="space-y-6">
          {/* Seller KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border bg-surface p-4">
              <p className="text-xs font-semibold text-sub">
                {mc("seller_kpi_products_label", "Produk Saya")}
              </p>
              <p className="mt-1.5 text-2xl font-extrabold text-ink tabular-nums">{myListings.length}</p>
            </div>
            <div className="rounded-2xl border bg-surface p-4">
              <p className="text-xs font-semibold text-sub">
                {mc("seller_kpi_pending_label", "Pesanan Perlu Diproses")}
              </p>
              <p className="mt-1.5 text-2xl font-extrabold text-brand tabular-nums">{sellerActionCount}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-2xl border bg-surface p-4">
              <p className="text-xs font-semibold text-sub">
                {mc("seller_kpi_revenue_label", "Total Omzet Toko")}
              </p>
              <p className="mt-1.5 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatIDR(sellerRevenue)}
              </p>
            </div>
          </div>

          {/* Incoming Seller Orders */}
          <section className="space-y-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-sub">
              {mc("seller_incoming_title", "Pesanan Masuk")} ({sellerOrders.length})
            </h3>
            {sellerOrders.length === 0 ? (
              <div className="rounded-2xl border bg-surface p-6 text-center text-xs text-sub">
                {mc("seller_incoming_empty", "Belum ada pesanan masuk ke toko Anda.")}
              </div>
            ) : (
              sellerOrders.map((ord) => {
                const meta = ORDER_STATUS_META[ord.status] || { label: ord.status, tone: "text-sub" };
                return (
                  <div
                    key={ord.id}
                    className="rounded-2xl border bg-surface p-4 space-y-3"
                    data-testid={`seller-order-${ord.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs font-extrabold text-ink">
                          {ord.order_number}{" "}
                          <span className={`font-sans ${meta.tone}`}>· {meta.label}</span>
                        </p>
                        <p className="text-xs text-sub mt-0.5">
                          Pembeli: <strong className="text-ink">{ord.buyer_name}</strong> ({ord.buyer_location}) ·{" "}
                          {ord.payment_info?.channel || ord.payment_channel}
                        </p>
                      </div>
                      <span className="text-sm font-extrabold text-ink tabular-nums">
                        {formatIDR(ord.total_amount)}
                      </span>
                    </div>

                    <div className="text-xs text-sub space-y-1">
                      {(ord.items || []).map((it, idx) => (
                        <p key={idx}>
                          • <strong className="text-ink">{it.title}</strong> ({it.variant}) × {it.qty}
                        </p>
                      ))}
                      {ord.delivery_note && (
                        <p className="italic text-ink/80">Catatan: "{ord.delivery_note}"</p>
                      )}
                      {ord.payment_proof_file_id && (
                        <a
                          href={fileUrl(ord.payment_proof_file_id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-brand hover:underline pt-1"
                        >
                          <ExternalLink size={12} /> Lihat Bukti Transfer Pembeli
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
                      {ord.status === "awaiting_verification" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOrderAction(ord.id, "reject_payment", "Bukti transfer belum valid")}
                            className="h-9 rounded-xl border px-3 text-xs font-bold text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <XCircle size={14} /> Tolak Bukti
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOrderAction(ord.id, "approve_payment")}
                            className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 text-xs font-bold text-white inline-flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 size={14} /> Verifikasi Pembayaran
                          </button>
                        </>
                      )}

                      {ord.status === "paid_processing" && (
                        <button
                          type="button"
                          onClick={() => handleOrderAction(ord.id, "mark_ready")}
                          className="h-9 rounded-xl bg-brand px-4 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Truck size={14} />
                          <span>
                            {ord.delivery_method === "pickup_office"
                              ? "Tandai Siap Diambil"
                              : "Tandai Sedang Diantar"}
                          </span>
                        </button>
                      )}

                      {["ready_pickup", "shipped"].includes(ord.status) && (
                        <button
                          type="button"
                          onClick={() => handleOrderAction(ord.id, "complete")}
                          className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 size={14} /> Selesaikan Pesanan
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* My Products */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-sub">
                {mc("seller_catalog_title", "Etalase Produk Saya")} ({myListings.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setFormOpen(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-bold text-white cursor-pointer"
              >
                <Plus size={14} /> {mc("seller_add_product_btn", "Tambah Produk")}
              </button>
            </div>

            {myListings.length === 0 ? (
              <div className="rounded-2xl border bg-surface p-8 text-center">
                <p className="text-sm font-bold text-ink">
                  {mc("seller_catalog_empty_title", "Anda belum memiliki produk yang dijual")}
                </p>
                <p className="mt-1 text-xs text-sub">
                  {mc(
                    "seller_catalog_empty_subtitle",
                    "Jual barang preloved, camilan, gadget, atau jasa ke sesama rekan kerja."
                  )}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myListings.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-3 rounded-2xl border bg-surface p-3.5 items-center"
                  >
                    <img
                      src={resolveProductImage(item)}
                      alt={item.title}
                      className="h-16 w-16 rounded-xl object-cover border shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink truncate leading-snug pb-0.5">
                        {item.title}
                      </p>
                      <p className="text-xs font-extrabold text-brand tabular-nums">
                        {formatIDR(item.price)}
                      </p>
                      <p className="text-[11px] text-sub tabular-nums">
                        Stok: {item.stock} · Terjual: {item.sold_count || 0}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(item);
                        setFormOpen(true);
                      }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-surface2 text-sub hover:text-ink cursor-pointer"
                      aria-label="Edit produk"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Dialogs & Drawers */}
      <ProductDetailDialog
        item={selectedItem}
        reviews={state.reviews || []}
        liked={selectedItem ? wishlistSet.has(selectedItem.id) : false}
        me={me}
        onClose={() => {
          setSelectedItem(null);
          if (itemId) navigate("/marketplace", { replace: true });
        }}
        onToggleWishlist={toggleWishlist}
        onAddToCart={addToCart}
        onBuyNow={(item, variant, qty) => {
          setSelectedItem(null);
          setCheckoutPayload({
            items: [{ listing_id: item.id, variant, qty }],
            isBuyNow: true,
          });
        }}
        onEdit={(item) => {
          setEditingItem(item);
          setFormOpen(true);
        }}
      />

      <ListingFormDialog
        open={formOpen}
        editingItem={editingItem}
        me={me}
        onClose={() => setFormOpen(false)}
        onSaved={(savedItem, replaceOptimisticId) => {
          if (savedItem && savedItem.id) {
            commitState((prev) => {
              const cur = Array.isArray(prev.listings) ? prev.listings : [];
              const filtered = replaceOptimisticId
                ? cur.filter((x) => x.id !== replaceOptimisticId)
                : cur;
              const exists = filtered.some((x) => x.id === savedItem.id);
              const nextListings = exists
                ? filtered.map((x) => (x.id === savedItem.id ? savedItem : x))
                : [savedItem, ...filtered];
              return { ...prev, listings: nextListings };
            });
          } else {
            loadState();
          }
        }}
        onDeleted={(deletedId) => {
          if (deletedId) {
            commitState((prev) => ({
              ...prev,
              listings: (prev.listings || []).filter((x) => x.id !== deletedId),
            }));
          } else {
            loadState();
          }
        }}
      />

      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        cartItems={state.cart || []}
        listingsMap={listingsMap}
        config={mktCfg}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        onCheckout={(items) => {
          setCartOpen(false);
          setCheckoutPayload({ items, isBuyNow: false });
        }}
      />

      <CheckoutDialog
        open={Boolean(checkoutPayload)}
        items={checkoutPayload?.items || []}
        isBuyNow={Boolean(checkoutPayload?.isBuyNow)}
        listingsMap={listingsMap}
        config={mktCfg}
        me={me}
        onClose={() => setCheckoutPayload(null)}
        onSuccess={(createdOrders, nextCart, updatedListings) => {
          setCheckoutPayload(null);
          commitState((prev) => {
            const patchMap = Array.isArray(updatedListings)
              ? Object.fromEntries(updatedListings.map((l) => [l.id, l]))
              : null;
            const existingIds = new Set((prev.orders || []).map((o) => o.id));
            const newOrders = (createdOrders || []).filter((o) => !existingIds.has(o.id));
            return {
              ...prev,
              orders: [...newOrders, ...(prev.orders || [])],
              cart: Array.isArray(nextCart) ? nextCart : prev.cart,
              ...(patchMap ? { listings: (prev.listings || []).map((l) => patchMap[l.id] || l) } : {}),
            };
          });
          setTab("orders");
          const firstUnpaid = (createdOrders || []).find((o) => o.status === "pending_payment");
          if (firstUnpaid) {
            setPayingOrder(firstUnpaid);
          }
        }}
      />

      <OrderPaymentModal
        order={payingOrder}
        onClose={() => setPayingOrder(null)}
        onPaid={(updatedOrder) => {
          if (updatedOrder && updatedOrder.id) {
            commitState((prev) => ({
              ...prev,
              orders: (prev.orders || []).map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
            }));
          } else {
            loadState();
          }
        }}
      />

      <OrderReviewModal
        order={reviewingOrder}
        onClose={() => setReviewingOrder(null)}
        onSubmitted={(optimisticReview) => {
          if (optimisticReview?.orderId) {
            commitState((prev) => ({
              ...prev,
              orders: (prev.orders || []).map((o) =>
                o.id === optimisticReview.orderId ? { ...o, reviewed: true } : o
              ),
            }));
          } else {
            loadState();
          }
        }}
      />
    </div>
  );
}
