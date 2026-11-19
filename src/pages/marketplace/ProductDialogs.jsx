import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Star,
  Heart,
  ShoppingCart,
  MessageCircle,
  MapPin,
  PackageCheck,
  Upload,
  Plus,
  Minus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, uploadFile } from "../../lib/api";
import { Avatar } from "../../components/common";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../components/ui/select";
import {
  MARKETPLACE_CATEGORIES,
  PRODUCT_CONDITIONS,
  DELIVERY_OPTIONS,
  STUDIO_PRODUCT_PRESETS,
  resolveProductImage,
  formatIDR,
} from "./catalogAssets";

export function ProductDetailDialog({
  item,
  reviews = [],
  liked = false,
  me,
  onClose,
  onToggleWishlist,
  onAddToCart,
  onBuyNow,
  onEdit,
}) {
  const navigate = useNavigate();
  const [variant, setVariant] = useState("");
  const [qty, setQty] = useState(1);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    if (item) {
      setVariant(item.variants?.[0] || "Standar");
      setQty(1);
    }
  }, [item]);

  if (!item) return null;
  const itemReviews = reviews.filter((r) => r.listing_id === item.id);
  const isOwner = item.seller_id === me?.user_id;
  const canEdit = isOwner || me?.role === "super_admin";
  const imgSrc = resolveProductImage(item);
  const outOfStock = Number(item.stock || 0) <= 0;

  const handleChatSeller = async () => {
    if (!item.seller_id) return;
    // Check 0ms local conversation cache first
    try {
      const cachedConvs = JSON.parse(localStorage.getItem(`circle_convs_cache_${me?.user_id}`) || "[]");
      const existing = cachedConvs.find((c) => {
        if (!c || c.type !== "dm" || String(c.id || "").startsWith("conv_circle_")) return false;
        const mems = c.member_ids || c.members || [];
        return mems.includes(me?.user_id) && mems.includes(item.seller_id);
      });
      if (existing?.id) {
        onClose();
        navigate(`/messages/${existing.id}`);
        return;
      }
    } catch {}

    setChatBusy(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: item.seller_id });
      onClose();
      navigate(`/messages/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka chat dengan penjual"));
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col gap-0">
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Left Product Photography & Seller Summary */}
          <div className="bg-surface2/70 flex flex-col gap-3.5 p-4 sm:p-6 border-b md:border-b-0 md:border-r">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/60 shrink-0">
              <img
                src={imgSrc}
                alt={item.title}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onToggleWishlist(item.id)}
                className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/90 text-ink shadow-sm hover:scale-105 transition-transform cursor-pointer"
                aria-label="Simpan ke Favorit"
                data-testid="pdp-wishlist-btn"
              >
                <Heart size={18} className={liked ? "fill-rose-500 text-rose-500" : "text-sub"} />
              </button>
            </div>

            {/* Seller Info & Direct Chat */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border bg-surface p-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar user={item.seller || { name: item.seller_name }} size={40} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink truncate leading-snug pb-0.5">
                    {item.seller?.name || item.seller_name}
                  </p>
                  <p className="text-[11px] text-sub truncate leading-snug">
                    {item.seller?.department || item.seller_department || "Workspace"} · {item.pickup_location || "Kantor Pusat"}
                  </p>
                </div>
              </div>
              {!isOwner && (
                <button
                  type="button"
                  disabled={chatBusy}
                  onClick={handleChatSeller}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border bg-surface2 px-3 text-xs font-semibold text-ink hover:bg-surface transition-colors cursor-pointer"
                  data-testid="pdp-chat-seller-btn"
                >
                  <MessageCircle size={14} className="text-brand" />
                  <span>{chatBusy ? "Membuka..." : "Chat Penjual"}</span>
                </button>
              )}
            </div>

            {/* Delivery & Payment Summary */}
            <div className="rounded-2xl border bg-surface p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-ink">Opsi Serah Terima</span>
                <span className="text-[11px] text-sub">{item.pickup_location || "Kantor Pusat"}</span>
              </div>
              <p className="text-[11px] text-sub leading-relaxed">
                {(Array.isArray(item.delivery_options) && item.delivery_options.length > 0
                  ? item.delivery_options
                  : ["pickup_office", "desk_delivery"]
                )
                  .map((id) => DELIVERY_OPTIONS.find((d) => d.id === id)?.label || id)
                  .join(" · ")}
              </p>
              <p className="text-[11px] text-sub border-t pt-2">
                Mendukung: <span className="font-semibold text-ink">QRIS · Transfer Bank / VA · E-Wallet · Potong Gaji · COD</span>
              </p>
            </div>
          </div>

          {/* Right Purchase Details & Controls */}
          <div className="p-5 sm:p-6 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <DialogHeader className="text-left space-y-1.5 pr-9">
                <p className="text-[11px] font-bold uppercase tracking-wider text-sub">
                  {item.category} · {item.condition} · Terjual {item.sold_count || 0}
                </p>
                <DialogTitle className="text-xl sm:text-2xl font-extrabold text-ink leading-snug">
                  {item.title}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Detail produk marketplace karyawan dan opsi pembelian.
                </DialogDescription>
              </DialogHeader>

              {/* Price + Rating Row */}
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-2xl font-extrabold text-ink tabular-nums">
                    {formatIDR(item.price)}
                  </span>
                  {item.compare_price && item.compare_price > item.price && (
                    <span className="text-sm text-sub line-through tabular-nums">
                      {formatIDR(item.compare_price)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <Star size={14} className="fill-amber-400 text-amber-400" />
                  <span className="tabular-nums">{Number(item.rating_avg || 0) > 0 ? item.rating_avg : "Baru"}</span>
                  {item.rating_count > 0 && (
                    <span className="text-sub">({item.rating_count} ulasan)</span>
                  )}
                </div>
              </div>

              <p className="text-sm text-sub leading-relaxed whitespace-pre-line">
                {item.description || "Tidak ada deskripsi tambahan."}
              </p>

              {/* Variants Selector */}
              {Array.isArray(item.variants) && item.variants.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-sub">Pilih Varian</p>
                  <div className="flex flex-wrap gap-2">
                    {item.variants.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setVariant(v)}
                        className={`min-h-[38px] rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          variant === v
                            ? "border-brand bg-brand text-white"
                            : "bg-surface2 text-ink hover:bg-surface"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity & Stock */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-sub mb-1.5">Jumlah</p>
                  <div className="inline-flex items-center rounded-xl border bg-surface2 p-0.5">
                    <button
                      type="button"
                      disabled={qty <= 1}
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-surface disabled:opacity-40 cursor-pointer"
                      aria-label="Kurangi jumlah"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-10 text-center text-sm font-bold tabular-nums text-ink">{qty}</span>
                    <button
                      type="button"
                      disabled={qty >= Number(item.stock || 1)}
                      onClick={() => setQty((q) => Math.min(Number(item.stock || 1), q + 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-surface disabled:opacity-40 cursor-pointer"
                      aria-label="Tambah jumlah"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xs text-sub flex items-center justify-end gap-1">
                    <PackageCheck size={14} className="text-emerald-600" />
                    <span>
                      Stok tersedia:{" "}
                      <strong className="text-ink tabular-nums">{item.stock}</strong>
                    </span>
                  </p>
                  <p className="text-[11px] text-sub mt-0.5 flex items-center justify-end gap-1">
                    <MapPin size={12} />
                    <span>{item.pickup_location || "Kantor Pusat"}</span>
                  </p>
                </div>
              </div>

              {/* Reviews Preview */}
              {itemReviews.length > 0 && (
                <div className="rounded-2xl border bg-surface2/40 p-3.5 space-y-2.5">
                  <p className="text-xs font-bold text-ink">Ulasan Pembeli ({itemReviews.length})</p>
                  <div className="space-y-2 max-h-36 overflow-y-auto scroll-thin pr-1">
                    {itemReviews.map((rev) => (
                      <div key={rev.id} className="text-xs border-b border-slate-200/60 dark:border-slate-800 pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-ink">{rev.buyer_name}</span>
                          <span className="inline-flex items-center gap-0.5 text-amber-500 font-bold tabular-nums">
                            <Star size={11} className="fill-amber-400 text-amber-400" /> {rev.rating}
                          </span>
                        </div>
                        {rev.comment && <p className="text-sub mt-0.5">{rev.comment}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Purchase CTAs */}
            <div className="pt-3 border-t flex flex-wrap items-center gap-2.5">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(item);
                  }}
                  className="h-11 rounded-xl border bg-surface2 px-4 text-xs font-bold text-ink hover:bg-surface transition-colors cursor-pointer"
                >
                  Edit Produk
                </button>
              )}
              <button
                type="button"
                disabled={outOfStock}
                onClick={() => {
                  onAddToCart(item, variant || item.variants?.[0] || "Standar", qty);
                  onClose();
                }}
                className="flex-1 min-w-[140px] h-11 rounded-xl border border-brand/30 bg-brand/5 text-brand text-xs sm:text-sm font-bold hover:bg-brand/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
                data-testid="pdp-add-cart-btn"
              >
                <ShoppingCart size={16} />
                <span>+ Keranjang</span>
              </button>
              <button
                type="button"
                disabled={outOfStock}
                onClick={() => onBuyNow(item, variant || item.variants?.[0] || "Standar", qty)}
                className="flex-1 min-w-[140px] h-11 rounded-xl bg-brand text-white text-xs sm:text-sm font-bold shadow-sm hover:opacity-95 transition-opacity disabled:opacity-40 cursor-pointer"
                data-testid="pdp-buy-now-btn"
              >
                {outOfStock ? "Stok Habis" : "Beli Sekarang"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ListingFormDialog({ open, editingItem, me, onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [comparePrice, setComparePrice] = useState("");
  const [category, setCategory] = useState("Barang");
  const [condition, setCondition] = useState("Baru");
  const [stock, setStock] = useState("1");
  const [variantsText, setVariantsText] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryOpts, setDeliveryOpts] = useState(["pickup_office", "desk_delivery"]);
  const [imageFileId, setImageFileId] = useState(null);
  const [imageKey, setImageKey] = useState("seed_charger");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingItem) {
      setTitle(editingItem.title || "");
      setPrice(String(editingItem.price || ""));
      setComparePrice(editingItem.compare_price ? String(editingItem.compare_price) : "");
      setCategory(editingItem.category || "Barang");
      setCondition(editingItem.condition || "Baru");
      setStock(String(editingItem.stock ?? 1));
      setVariantsText(Array.isArray(editingItem.variants) ? editingItem.variants.join(", ") : "");
      setPickupLocation(editingItem.pickup_location || "");
      setDescription(editingItem.description || "");
      setDeliveryOpts(
        Array.isArray(editingItem.delivery_options) && editingItem.delivery_options.length > 0
          ? editingItem.delivery_options
          : ["pickup_office", "desk_delivery"]
      );
      setImageFileId(editingItem.image_file_id || null);
      setImageKey(editingItem.image_key || "seed_charger");
    } else {
      setTitle("");
      setPrice("");
      setComparePrice("");
      setCategory("Barang");
      setCondition("Baru");
      setStock("1");
      setVariantsText("");
      setPickupLocation("");
      setDescription("");
      setDeliveryOpts(["pickup_office", "desk_delivery"]);
      setImageFileId(null);
      setImageKey("seed_charger");
    }
  }, [open, editingItem]);

  const handleUploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      const id = up?.id || up?.file_id || up?.data?.id;
      if (!id) throw new Error("Gagal mendapatkan ID foto");
      setImageFileId(id);
      toast.success("Foto produk berhasil diunggah!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah foto produk"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const toggleDelivery = (id) => {
    setDeliveryOpts((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev) : [...prev, id]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Judul produk atau jasa wajib diisi.");
    if (Number(price) < 1000) return toast.error("Harga minimal Rp 1.000.");

    const payload = {
      title: title.trim(),
      price: Number(price),
      compare_price: comparePrice ? Number(comparePrice) : null,
      category,
      condition,
      stock: Math.max(0, Number(stock || 1)),
      variants: variantsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      pickup_location: pickupLocation.trim() || `Meja ${me?.department || "Kantor"}`,
      description: description.trim(),
      delivery_options: deliveryOpts,
      image_file_id: imageFileId,
      image_key: imageKey,
    };

    const now = new Date().toISOString();
    const optimisticListing = editingItem
      ? { ...editingItem, ...payload, updated_at: now }
      : {
          id: `mkt_${Date.now()}_opt`,
          ...payload,
          sold_count: 0,
          rating_avg: 0,
          rating_count: 0,
          seller_id: me?.user_id,
          seller_name: me?.name || "Saya",
          seller_department: me?.department || "Workspace",
          seller: {
            user_id: me?.user_id,
            name: me?.name || "Saya",
            avatar: me?.avatar || me?.picture || "",
            department: me?.department || "Workspace",
          },
          status: "active",
          created_at: now,
          updated_at: now,
        };

    // 0ms optimistic update + close dialog immediately
    onSaved?.(optimisticListing);
    onClose();
    toast.success(editingItem ? "Produk berhasil diperbarui!" : "Produk berhasil ditayangkan ke Marketplace!");

    setSaving(true);
    try {
      if (editingItem) {
        const { data } = await api.put(`/marketplace/listings/${editingItem.id}`, payload);
        onSaved?.(data);
      } else {
        const { data } = await api.post("/marketplace/listings", payload);
        onSaved?.(data, optimisticListing.id);
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan produk"));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingItem) return;
    const targetId = editingItem.id;
    onDeleted?.(targetId);
    onClose();
    toast.success("Produk dihapus dari Marketplace.");
    setDeleting(true);
    try {
      await api.delete(`/marketplace/listings/${targetId}`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus produk"));
      onSaved?.();
    } finally {
      setDeleting(false);
    }
  };

  const previewUrl = resolveProductImage({ image_file_id: imageFileId, image_key: imageKey });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b text-left pr-10">
          <DialogTitle className="text-lg font-extrabold text-ink">
            {editingItem ? "Edit Produk / Jasa" : "Jual Barang atau Jasa"}
          </DialogTitle>
          <DialogDescription className="text-xs text-sub">
            Tawarkan produk preloved, makanan, elektronik, atau keahlian ke sesama rekan kantor.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 space-y-4">
          {/* Image Picker */}
          <div className="flex flex-col sm:flex-row gap-4 rounded-2xl border bg-surface2/50 p-3.5">
            <img
              src={previewUrl}
              alt="Preview"
              className="h-32 w-full sm:w-44 rounded-xl object-cover border bg-surface shrink-0"
            />
            <div className="flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-bold text-white cursor-pointer hover:opacity-90">
                  <Upload size={14} />
                  <span>{uploading ? "Mengunggah..." : "Unggah Foto Produk"}</span>
                  <input type="file" accept="image/*" hidden onChange={handleUploadPhoto} />
                </label>
                {imageFileId && (
                  <button
                    type="button"
                    onClick={() => setImageFileId(null)}
                    className="h-9 rounded-xl border bg-surface px-3 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
                  >
                    Pakai Template
                  </button>
                )}
              </div>
              <p className="text-[11px] font-semibold text-sub">Atau pilih ilustrasi cepat:</p>
              <div className="flex flex-wrap gap-1.5">
                {STUDIO_PRODUCT_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setImageFileId(null);
                      setImageKey(p.key);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                      !imageFileId && imageKey === p.key
                        ? "border-brand bg-brand/10 text-brand"
                        : "bg-surface text-sub hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-sub">Nama Produk / Jasa *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Tumbler Corkcicle 16oz Matte Black"
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none focus:border-brand"
              data-testid="listing-title-input"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-1 sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-sub">Harga Jual (Rp) *</label>
              <input
                type="number"
                required
                min={1000}
                step={500}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="150000"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm tabular-nums outline-none focus:border-brand"
                data-testid="listing-price-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Harga Coret</label>
              <input
                type="number"
                min={0}
                step={500}
                value={comparePrice}
                onChange={(e) => setComparePrice(e.target.value)}
                placeholder="220000"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm tabular-nums outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Stok *</label>
              <input
                type="number"
                required
                min={0}
                max={999}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm tabular-nums outline-none focus:border-brand"
                data-testid="listing-stock-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Kategori</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-surface2 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_CATEGORIES.filter((c) => c !== "Semua").map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Kondisi / Tipe</label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-surface2 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Varian (pisahkan dengan koma)</label>
              <input
                value={variantsText}
                onChange={(e) => setVariantsText(e.target.value)}
                placeholder="Mis. Hitam, Putih, Ukuran M"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-sub">Lokasi Pengambilan / Meja</label>
              <input
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                placeholder="Mis. Meja Engineering Lt. 4"
                className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none focus:border-brand"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-sub">Opsi Pengiriman / Serah Terima</label>
            <div className="flex flex-wrap gap-2">
              {DELIVERY_OPTIONS.map((opt) => {
                const active = deliveryOpts.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleDelivery(opt.id)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                      active ? "border-brand bg-brand/10 text-brand" : "bg-surface2 text-sub hover:text-ink"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-sub">Deskripsi Lengkap</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan detail kondisi, kelengkapan, atau jadwal ketersediaan..."
              className="w-full rounded-xl border bg-surface2 p-3 text-sm outline-none focus:border-brand resize-none"
            />
          </div>

          <DialogFooter className="pt-3 border-t flex flex-wrap items-center justify-between gap-2">
            {editingItem ? (
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="h-10 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 px-3.5 text-xs font-bold text-rose-600 hover:bg-rose-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={14} />
                <span>{deleting ? "Menghapus..." : "Hapus Produk"}</span>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-xl border bg-surface px-4 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || uploading}
                className="h-10 rounded-xl bg-brand px-5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
                data-testid="listing-submit-btn"
              >
                {saving ? "Menyimpan..." : editingItem ? "Simpan Perubahan" : "Terbitkan Sekarang"}
              </button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
