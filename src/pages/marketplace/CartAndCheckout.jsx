import { useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  QrCode,
  Landmark,
  Smartphone,
  Wallet,
  CheckCircle2,
  Copy,
  Check,
  Upload,
  Star,
  TicketPercent,
  ArrowRight,
  Clock,
  ShieldCheck,
  Zap,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, uploadFile, fileUrl } from "../../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  DELIVERY_OPTIONS,
  QrisCodeSvg,
  formatIDR,
  resolveProductImage,
  RupiahNoteIcon,
} from "./catalogAssets";
import { evaluateVoucherInstant } from "./marketplaceStore";

const BANK_CHANNELS = ["BCA", "Mandiri", "BNI", "BRI"];
const EWALLET_CHANNELS = ["GoPay", "OVO", "DANA", "ShopeePay"];

export function CartDrawer({
  open,
  onOpenChange,
  cartItems,
  listingsMap,
  config = {},
  onUpdateQty,
  onRemoveItem,
  onCheckout,
}) {
  const resolved = useMemo(() => {
    return (cartItems || [])
      .map((c) => {
        const listing = listingsMap[c.listing_id];
        if (!listing) return null;
        return { ...c, listing };
      })
      .filter(Boolean);
  }, [cartItems, listingsMap]);

  const subtotal = resolved.reduce((s, r) => s + Number(r.listing.price) * Number(r.qty), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-surface p-0 flex flex-col border-l border-slate-200 dark:border-slate-800"
      >
        <SheetHeader className="px-5 py-4 border-b text-left">
          <SheetTitle className="flex items-center gap-2 text-base font-extrabold text-ink">
            <ShoppingBag size={18} className="text-brand" />
            <span>
              {config?.cart_drawer_title || "Keranjang Belanja"} ({resolved.reduce((s, r) => s + Number(r.qty), 0)})
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3">
          {resolved.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center px-4">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface2 text-sub">
                <ShoppingBag size={22} />
              </div>
              <p className="text-sm font-bold text-ink">
                {config?.cart_empty_title || "Keranjang Anda masih kosong"}
              </p>
              <p className="mt-1 text-xs text-sub">
                {config?.cart_empty_subtitle ||
                  "Tambahkan barang atau jasa dari rekan kantor ke keranjang untuk checkout lebih cepat."}
              </p>
            </div>
          ) : (
            resolved.map((entry) => (
              <div
                key={`${entry.listing_id}::${entry.variant}`}
                className="flex gap-3 rounded-2xl border bg-surface2/40 p-3"
              >
                <img
                  src={resolveProductImage(entry.listing)}
                  alt={entry.listing.title}
                  className="h-20 w-20 rounded-xl object-cover shrink-0 border"
                />
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-bold text-ink line-clamp-2 leading-snug pb-0.5">
                      {entry.listing.title}
                    </p>
                    <p className="text-[11px] text-sub truncate">
                      {entry.variant} · {entry.listing.seller_name}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-ink tabular-nums">
                      {formatIDR(entry.listing.price)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex items-center rounded-lg border bg-surface p-0.5">
                        <button
                          type="button"
                          onClick={() => onUpdateQty(entry.listing_id, entry.variant, entry.qty - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink hover:bg-surface2 cursor-pointer"
                          aria-label="Kurangi"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-7 text-center text-xs font-bold tabular-nums">{entry.qty}</span>
                        <button
                          type="button"
                          disabled={entry.qty >= Number(entry.listing.stock || 1)}
                          onClick={() => onUpdateQty(entry.listing_id, entry.variant, entry.qty + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink hover:bg-surface2 disabled:opacity-40 cursor-pointer"
                          aria-label="Tambah"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(entry.listing_id, entry.variant)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-sub hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        aria-label="Hapus item"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {resolved.length > 0 && (
          <div className="border-t bg-surface p-4 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between text-sm">
              <span className="text-sub font-medium">Subtotal Produk</span>
              <span className="text-lg font-extrabold text-ink tabular-nums">{formatIDR(subtotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => onCheckout(resolved.map((r) => ({ listing_id: r.listing_id, variant: r.variant, qty: r.qty })))}
              className="w-full h-11 rounded-xl bg-brand text-white text-sm font-bold shadow-sm hover:opacity-95 flex items-center justify-center gap-2 cursor-pointer"
              data-testid="cart-checkout-btn"
            >
              <span>{config?.cart_checkout_btn || "Lanjut ke Pembayaran"}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function OrderPaymentModal({ order, onClose, onPaid }) {
  const [proofFileId, setProofFileId] = useState(null);
  const [senderName, setSenderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingSnap, setRefreshingSnap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(900);
  const [localSnapToken, setLocalSnapToken] = useState("");

  useEffect(() => {
    if (!order) return;
    setProofFileId(order.payment_proof_file_id || null);
    setSenderName(order.buyer_name || "");
    setLocalSnapToken(order.payment_info?.snap_token || "");
    const expMins = Number(order.payment_info?.expiry_minutes || 15);
    setSecondsLeft(Math.max(60, expMins * 60));
    const iv = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [order]);

  if (!order) return null;

  const info = order.payment_info || {};
  const isGatewayActive =
    info.gateway_enabled !== false &&
    order.payment_method !== "cod" &&
    order.payment_method !== "payroll";
  const providerLabel = info.provider_label || "Midtrans Snap";
  const gatewayEnv = (info.environment || "sandbox").toUpperCase();
  const snapToken = localSnapToken || info.snap_token || `SNAP-MIDTRANS-${order.order_number}`;

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const copyText = async (txt, label = "Nomor / kode") => {
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      toast.success(`${label} berhasil disalin!`);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleRefreshSnapToken = async () => {
    setRefreshingSnap(true);
    try {
      const { data } = await api.post(`/marketplace/orders/${order.id}/snap-token`);
      if (data?.payment_info?.snap_token) {
        setLocalSnapToken(data.payment_info.snap_token);
        toast.success(`Token ${providerLabel} berhasil diperbarui!`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui token pembayaran"));
    } finally {
      setRefreshingSnap(false);
    }
  };

  const handleUploadProof = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      const id = up?.id || up?.file_id || up?.data?.id;
      if (!id) throw new Error("Gagal unggah");
      setProofFileId(id);
      toast.success("Bukti transfer siap dikirim!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah bukti transfer"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const submitPayment = async (instantSimulate = true) => {
    // If window.snap is loaded on the page and live Midtrans token is used, trigger Snap popup first
    if (
      instantSimulate &&
      isGatewayActive &&
      info.live_api &&
      typeof window !== "undefined" &&
      window.snap &&
      typeof window.snap.pay === "function"
    ) {
      window.snap.pay(snapToken, {
        onSuccess: () => finalizePaymentRequest(true),
        onPending: () => toast.info("Menunggu penyelesaian pembayaran di Midtrans."),
        onError: () => toast.error("Pembayaran Midtrans gagal atau dibatalkan."),
      });
      return;
    }
    await finalizePaymentRequest(instantSimulate);
  };

  const finalizePaymentRequest = async (instantSimulate = true) => {
    const now = new Date().toISOString();
    const isManualUpload = order.payment_method === "bank_transfer" && proofFileId && !instantSimulate;
    const optimisticOrder = {
      ...order,
      payment_proof_file_id: proofFileId || order.payment_proof_file_id,
      payment_ref: snapToken || order.payment_info?.reference_code,
      payment_status: isManualUpload
        ? "awaiting_verification"
        : order.payment_method === "payroll"
        ? "payroll_scheduled"
        : "paid",
      status: isManualUpload ? "awaiting_verification" : "paid_processing",
      updated_at: now,
      history: [
        {
          status: isManualUpload ? "awaiting_verification" : "paid_processing",
          label: isManualUpload
            ? `Bukti transfer diunggah (${senderName || order.buyer_name}) · Menunggu verifikasi penjual`
            : isGatewayActive
            ? `Pembayaran ${order.payment_channel} terverifikasi otomatis via ${providerLabel} · Penjual menyiapkan pesanan`
            : `Pembayaran ${order.payment_channel} berhasil terverifikasi · Penjual menyiapkan pesanan`,
          actor_name: isGatewayActive && instantSimulate ? providerLabel : order.buyer_name,
          at: now,
        },
        ...(order.history || []),
      ],
    };

    // 0ms optimistic UI transition
    const prevOrder = { ...order };
    onPaid(optimisticOrder);
    onClose();
    toast.success(
      instantSimulate
        ? isGatewayActive
          ? `Pembayaran ${providerLabel} berhasil diverifikasi otomatis!`
          : "Pembayaran berhasil dikonfirmasi! Penjual akan menyiapkan pesanan Anda."
        : "Bukti transfer berhasil dikirim! Menunggu verifikasi penjual."
    );

    setSubmitting(true);
    try {
      const { data } = await api.post(`/marketplace/orders/${order.id}/pay`, {
        proof_file_id: proofFileId,
        sender_name: senderName || order.buyer_name,
        transaction_ref: snapToken,
        instant_simulate: instantSimulate,
        gateway_provider: providerLabel,
      });
      onPaid(data);
    } catch (err) {
      onPaid(prevOrder);
      toast.error(errMsg(err, "Gagal memproses pembayaran"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b text-left">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-base font-extrabold text-ink">
              Selesaikan Pembayaran
            </DialogTitle>
            {isGatewayActive && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-extrabold text-indigo-600 dark:text-indigo-300">
                <ShieldCheck size={11} />
                <span>{providerLabel} · {gatewayEnv}</span>
              </span>
            )}
          </div>
          <DialogDescription className="text-xs text-sub">
            Pesanan <strong className="text-ink">{order.order_number}</strong> · {info.channel || order.payment_channel}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[75dvh] overflow-y-auto scroll-thin">
          {/* Gateway Snap Token Bar */}
          {isGatewayActive && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/25 px-3 py-2 text-[11px]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sub">Token Transaksi ({providerLabel})</p>
                <p className="font-mono font-bold text-ink truncate" data-testid="snap-token-display">
                  {snapToken}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => copyText(snapToken, "Snap Token")}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border bg-surface px-2 text-[10px] font-bold text-ink hover:bg-surface2 cursor-pointer"
                >
                  <Copy size={11} />
                  <span>Salin</span>
                </button>
                <button
                  type="button"
                  disabled={refreshingSnap}
                  onClick={handleRefreshSnapToken}
                  title="Perbarui Snap Token"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border bg-surface text-sub hover:text-ink cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={11} className={refreshingSnap ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-2xl bg-surface2/70 border p-3.5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sub">Total Tagihan</p>
              <p className="text-xl font-extrabold text-ink tabular-nums">{formatIDR(order.total_amount)}</p>
            </div>
            <div className="text-right text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 tabular-nums">
              <Clock size={13} />
              <span>{mins}:{secs}</span>
            </div>
          </div>

          {order.payment_method === "qris" && (
            <div className="flex flex-col items-center rounded-2xl border bg-white p-4 text-slate-900">
              <div className="flex items-center justify-between w-full mb-2 px-1">
                <span className="text-[11px] font-extrabold tracking-wide uppercase">QRIS {providerLabel}</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  NMID · GPN
                </span>
              </div>
              <QrisCodeSvg seed={info.qris_payload || order.order_number} size={184} />
              <p className="mt-2 text-[11px] font-mono text-slate-500">{info.reference_code}</p>
            </div>
          )}

          {order.payment_method === "bank_transfer" && (
            <div className="space-y-3 rounded-2xl border bg-surface2/40 p-4">
              <div>
                <p className="text-[11px] font-semibold text-sub">Nomor Virtual Account ({info.channel})</p>
                <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border bg-surface px-3 py-2">
                  <span className="font-mono text-base font-extrabold tracking-wider text-ink tabular-nums">
                    {info.va_number}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(info.va_number, "Nomor VA")}
                    className="inline-flex items-center gap-1 rounded-lg bg-surface2 px-2.5 py-1 text-xs font-bold text-ink cursor-pointer"
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span>{copied ? "Disalin" : "Salin"}</span>
                  </button>
                </div>
              </div>
              <p className="text-xs text-sub">Atas Nama: <strong className="text-ink">{info.account_name}</strong></p>

              <div className="pt-2 border-t space-y-2">
                <p className="text-xs font-bold text-ink">Unggah Bukti Transfer (Opsional untuk verifikasi manual)</p>
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-surface px-3 text-xs font-semibold text-ink cursor-pointer hover:bg-surface2">
                    <Upload size={13} />
                    <span>{uploading ? "Mengunggah..." : proofFileId ? "Ganti Bukti Transfer" : "Pilih Foto Struk"}</span>
                    <input type="file" accept="image/*" hidden onChange={handleUploadProof} />
                  </label>
                  {proofFileId && (
                    <a
                      href={fileUrl(proofFileId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-bold text-brand hover:underline"
                    >
                      Lihat Foto
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {order.payment_method === "ewallet" && (
            <div className="rounded-2xl border bg-surface2/40 p-4 space-y-2">
              <p className="text-xs font-semibold text-sub">Kode / Deeplink Pembayaran {info.channel}</p>
              <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2">
                <span className="font-mono text-sm font-extrabold text-ink">{info.wallet_code || info.reference_code}</span>
                <button
                  type="button"
                  onClick={() => copyText(info.wallet_code || info.reference_code)}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface2 px-2.5 py-1 text-xs font-bold text-ink cursor-pointer"
                >
                  <Copy size={12} /> Salin
                </button>
              </div>
              <p className="text-xs text-sub">{info.instruction}</p>
            </div>
          )}

          {order.payment_method === "payroll" && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/20 p-4 text-xs text-ink space-y-1">
              <p className="font-bold">Konfirmasi Potong Gaji / Kasbon Karyawan</p>
              <p className="text-sub">
                Dengan menekan konfirmasi di bawah, Anda menyetujui pemotongan gaji bulan berjalan sebesar{" "}
                <strong className="text-ink tabular-nums">{formatIDR(order.total_amount)}</strong> untuk pesanan {order.order_number}.
              </p>
            </div>
          )}

          {info.instruction && order.payment_method === "qris" && (
            <p className="text-xs text-sub text-center">{info.instruction}</p>
          )}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border bg-surface px-4 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
          >
            Bayar Nanti
          </button>
          {order.payment_method === "bank_transfer" && proofFileId && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => submitPayment(false)}
              className="h-10 rounded-xl border border-brand/30 bg-brand/5 px-4 text-xs font-bold text-brand hover:bg-brand/10 cursor-pointer"
            >
              Kirim Bukti Manual
            </button>
          )}
          <button
            type="button"
            disabled={submitting || uploading}
            onClick={() => submitPayment(true)}
            className="flex-1 h-10 rounded-xl bg-brand px-4 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 cursor-pointer"
            data-testid="confirm-payment-btn"
          >
            <Zap size={14} />
            <span>
              {submitting
                ? "Memverifikasi..."
                : isGatewayActive
                ? `Bayar & Verifikasi Otomatis (${providerLabel})`
                : "Konfirmasi Pembayaran Sekarang"}
            </span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CheckoutDialog({
  open,
  items,
  listingsMap,
  config,
  me,
  isBuyNow = false,
  onClose,
  onSuccess,
}) {
  const [deliveryMethod, setDeliveryMethod] = useState("pickup_office");
  const [buyerLocation, setBuyerLocation] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("qris");
  const [paymentChannel, setPaymentChannel] = useState("QRIS");
  const [voucherInput, setVoucherInput] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [voucherDiscount, setVoucherDiscount] = useState(0);
  const [checkingVoucher, setCheckingVoucher] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const gwEnabled = config?.payment_gateway_enabled !== false;
  const gwProvider = config?.payment_gateway_provider || "midtrans";
  const gwProviderName =
    gwProvider === "midtrans"
      ? "Midtrans Snap"
      : gwProvider === "xendit"
      ? "Xendit Checkout"
      : gwProvider === "doku"
      ? "DOKU Jokul"
      : "Internal Escrow";

  const availablePayments = useMemo(() => {
    const c = config || {};
    return [
      c.allow_qris !== false && {
        id: "qris",
        label: gwEnabled ? `QRIS Instan (${gwProviderName})` : "QRIS Instan",
        desc: gwEnabled
          ? "Scan QRIS dinamis · Verifikasi otomatis via Webhook"
          : "Scan semua e-wallet & mobile banking",
        icon: QrCode,
      },
      c.allow_bank_transfer !== false && {
        id: "bank_transfer",
        label: gwEnabled ? `Virtual Account (${gwProviderName})` : "Transfer Bank / VA",
        desc: "BCA, Mandiri, BNI, BRI · Otomatis terverifikasi atau upload struk",
        icon: Landmark,
      },
      c.allow_ewallet !== false && {
        id: "ewallet",
        label: gwEnabled ? `E-Wallet (${gwProviderName})` : "E-Wallet",
        desc: "GoPay, OVO, DANA, ShopeePay",
        icon: Smartphone,
      },
      c.allow_payroll !== false && {
        id: "payroll",
        label: "Potong Gaji / Kasbon",
        desc: "Dipotong pada siklus payroll bulan berjalan",
        icon: Wallet,
      },
      c.allow_cod !== false && {
        id: "cod",
        label: "COD di Kantor",
        desc: "Bayar langsung saat serah terima barang",
        icon: RupiahNoteIcon,
      },
    ].filter(Boolean);
  }, [config, gwEnabled, gwProviderName]);

  const wasCheckoutOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasCheckoutOpenRef.current) {
      setBuyerLocation(`Meja ${me?.department || "Kantor"}`);
      setDeliveryMethod("pickup_office");
      setDeliveryNote("");
      setVoucherInput("");
      setAppliedVoucher(null);
      setVoucherDiscount(0);
      if (availablePayments.length > 0) {
        const first = availablePayments[0].id;
        setPaymentMethod(first);
        setPaymentChannel(first === "bank_transfer" ? "BCA" : first === "ewallet" ? "GoPay" : first.toUpperCase());
      }
    }
    wasCheckoutOpenRef.current = open;
  }, [open, me?.department, availablePayments]);

  const resolvedItems = useMemo(() => {
    return (items || [])
      .map((entry) => {
        const listing = listingsMap[entry.listing_id];
        if (!listing) return null;
        return { ...entry, listing };
      })
      .filter(Boolean);
  }, [items, listingsMap]);

  const subtotal = resolvedItems.reduce((s, r) => s + Number(r.listing.price) * Number(r.qty), 0);
  const deliveryFee = deliveryMethod === "courier" ? 10000 : 0;
  const feePct = Number(config?.platform_fee_pct || 0);
  const platformFee = Math.round((Math.max(0, subtotal - voucherDiscount) * feePct) / 100);
  const totalAmount = Math.max(0, subtotal - voucherDiscount + deliveryFee + platformFee);

  const handleApplyVoucher = (codeOverride) => {
    const code = (codeOverride ?? voucherInput).trim().toUpperCase();
    if (!code) return;
    const res = evaluateVoucherInstant(code, subtotal);
    if (res.error) {
      toast.error(res.error);
      setAppliedVoucher(null);
      setVoucherDiscount(0);
      return;
    }
    setAppliedVoucher(res.voucher);
    setVoucherDiscount(res.discount);
    setVoucherInput(res.voucher.code);
    toast.success(`Voucher ${res.voucher.code} dipakai: hemat ${formatIDR(res.discount)}!`);
  };

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (resolvedItems.length === 0) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/marketplace/checkout", {
        items: resolvedItems.map((r) => ({ listing_id: r.listing_id, variant: r.variant, qty: r.qty })),
        delivery_method: deliveryMethod,
        buyer_location: buyerLocation,
        buyer_phone: buyerPhone,
        delivery_note: deliveryNote,
        payment_method: paymentMethod,
        payment_channel: paymentChannel,
        voucher_code: appliedVoucher?.code || "",
        clear_cart: !isBuyNow,
      });
      toast.success("Pesanan berhasil dibuat!");
      onSuccess(data.orders || [], data.cart, data.updated_listings);
    } catch (err) {
      toast.error(errMsg(err, "Gagal membuat pesanan"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b text-left pr-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle className="text-lg font-extrabold text-ink">Checkout & Pembayaran</DialogTitle>
            {gwEnabled && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck size={12} />
                <span>Terhubung {gwProviderName} ({(config?.payment_gateway_env || "sandbox").toUpperCase()})</span>
              </span>
            )}
          </div>
          <DialogDescription className="text-xs text-sub">
            Pilih pengantaran di kantor, gunakan promo rekan kerja, dan selesaikan pembayaran.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmitOrder} className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 grid md:grid-cols-5 gap-5">
          {/* Left Form */}
          <div className="md:col-span-3 space-y-5">
            {/* 1. Delivery */}
            <section className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-sub">1. Pengiriman / Serah Terima</p>
              <div className="space-y-2">
                {DELIVERY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDeliveryMethod(opt.id)}
                    className={`w-full flex items-start justify-between gap-3 rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
                      deliveryMethod === opt.id
                        ? "border-brand bg-brand/5"
                        : "bg-surface2/40 hover:bg-surface2"
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-ink">{opt.label}</p>
                      <p className="text-[11px] text-sub mt-0.5">{opt.desc}</p>
                    </div>
                    <span className="text-xs font-bold tabular-nums text-ink shrink-0">
                      {opt.fee === 0 ? "Gratis" : formatIDR(opt.fee)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-sub">Lokasi Meja / Alamat *</label>
                  <input
                    required
                    value={buyerLocation}
                    onChange={(e) => setBuyerLocation(e.target.value)}
                    placeholder="Contoh: Meja Finance Lt. 3"
                    className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-sub">No. WhatsApp / Ekstensi</label>
                  <input
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="0812..."
                    className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
                  />
                </div>
              </div>
              <input
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                placeholder="Catatan untuk penjual (opsional, mis. jam istirahat siang)"
                className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:border-brand"
              />
            </section>

            {/* 2. Payment Method */}
            <section className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-sub">2. Metode Pembayaran</p>
              <div className="space-y-2">
                {availablePayments.map((pm) => {
                  const Icon = pm.icon;
                  const active = paymentMethod === pm.id;
                  return (
                    <div
                      key={pm.id}
                      className={`rounded-2xl border transition-colors ${
                        active ? "border-brand bg-brand/5" : "bg-surface2/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMethod(pm.id);
                          setPaymentChannel(
                            pm.id === "bank_transfer" ? "BCA" : pm.id === "ewallet" ? "GoPay" : pm.id.toUpperCase()
                          );
                        }}
                        className="w-full flex items-center gap-3 p-3 text-left cursor-pointer"
                        data-testid={`pay-method-${pm.id}`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-brand text-white" : "bg-surface text-sub border"}`}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-ink">{pm.label}</p>
                          <p className="text-[11px] text-sub">{pm.desc}</p>
                        </div>
                      </button>

                      {active && pm.id === "bank_transfer" && (
                        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                          {BANK_CHANNELS.map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => setPaymentChannel(b)}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                                paymentChannel === b ? "border-brand bg-brand text-white" : "bg-surface text-ink"
                              }`}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      )}

                      {active && pm.id === "ewallet" && (
                        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                          {EWALLET_CHANNELS.map((w) => (
                            <button
                              key={w}
                              type="button"
                              onClick={() => setPaymentChannel(w)}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                                paymentChannel === w ? "border-brand bg-brand text-white" : "bg-surface text-ink"
                              }`}
                            >
                              {w}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right Order Summary */}
          <div className="md:col-span-2 flex flex-col justify-between gap-4 rounded-2xl border bg-surface2/40 p-4 h-fit">
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-sub">Ringkasan Pesanan</p>
              <div className="space-y-2 max-h-40 overflow-y-auto scroll-thin pr-1">
                {resolvedItems.map((r) => (
                  <div key={`${r.listing_id}::${r.variant}`} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink truncate">{r.listing.title}</p>
                      <p className="text-[11px] text-sub tabular-nums">
                        {r.qty} × {formatIDR(r.listing.price)}
                      </p>
                    </div>
                    <span className="font-bold text-ink tabular-nums shrink-0">
                      {formatIDR(r.listing.price * r.qty)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Promo Voucher */}
              <div className="pt-2 border-t space-y-1.5">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <TicketPercent size={13} className="absolute left-2.5 top-2.5 text-sub" />
                    <input
                      value={voucherInput}
                      onChange={(e) => setVoucherInput(e.target.value)}
                      placeholder="Kode promo (TEMANKANTOR)"
                      className="h-8 w-full rounded-xl border bg-surface pl-8 pr-2 text-xs uppercase outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={checkingVoucher}
                    onClick={() => handleApplyVoucher()}
                    className="h-8 rounded-xl border bg-surface px-3 text-xs font-bold text-brand hover:bg-surface2 cursor-pointer"
                  >
                    Pakai
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {["TEMANKANTOR", "ASLIHEMAT"].map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => handleApplyVoucher(code)}
                      className="rounded-md bg-surface px-2 py-0.5 font-mono font-semibold text-sub hover:text-brand border cursor-pointer"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t text-xs">
                <div className="flex justify-between text-sub">
                  <span>Subtotal</span>
                  <span className="tabular-nums text-ink font-medium">{formatIDR(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sub">
                  <span>Ongkos Kirim</span>
                  <span className="tabular-nums text-ink font-medium">
                    {deliveryFee === 0 ? "Gratis" : formatIDR(deliveryFee)}
                  </span>
                </div>
                {voucherDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>Diskon ({appliedVoucher?.code})</span>
                    <span className="tabular-nums">-{formatIDR(voucherDiscount)}</span>
                  </div>
                )}
                {platformFee > 0 && (
                  <div className="flex justify-between text-sub">
                    <span>Biaya Layanan ({feePct}%)</span>
                    <span className="tabular-nums text-ink font-medium">{formatIDR(platformFee)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-sm font-extrabold text-ink">
                  <span>Total Bayar</span>
                  <span className="tabular-nums text-brand">{formatIDR(totalAmount)}</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || availablePayments.length === 0}
              className="w-full h-11 rounded-xl bg-brand text-white text-xs sm:text-sm font-bold shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
              data-testid="checkout-submit-btn"
            >
              {submitting ? "Membuat Pesanan..." : paymentMethod === "cod" ? "Buat Pesanan COD" : "Lanjut Bayar Sekarang"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrderReviewModal({ order, onClose, onSubmitted }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order) {
      setRating(5);
      setComment("");
    }
  }, [order]);

  if (!order) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanRating = Math.max(1, Math.min(5, Math.round(Number(rating || 5))));
    const cleanComment = String(comment || "").trim();
    // 0ms optimistic update
    onSubmitted?.({
      orderId: order.id,
      rating: cleanRating,
      comment: cleanComment,
    });
    onClose();
    toast.success("Terima kasih atas ulasan Anda!");

    setSaving(true);
    try {
      await api.post(`/marketplace/orders/${order.id}/review`, { rating: cleanRating, comment: cleanComment });
      onSubmitted?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengirim ulasan"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-5 bg-surface rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-extrabold text-ink">Beri Ulasan Pesanan</DialogTitle>
          <DialogDescription className="text-xs text-sub">
            {order.order_number} · {order.items?.[0]?.title}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className="p-1 cursor-pointer transition-transform hover:scale-110"
                aria-label={`${star} bintang`}
              >
                <Star
                  size={28}
                  className={star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-slate-600"}
                />
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Bagaimana kualitas barang atau pelayanan rekan Anda?"
            className="w-full rounded-xl border bg-surface2 p-3 text-xs outline-none focus:border-brand resize-none"
          />
          <DialogFooter className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border bg-surface px-4 text-xs font-semibold text-sub"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-xl bg-brand px-4 text-xs font-bold text-white cursor-pointer"
            >
              {saving ? "Mengirim..." : "Kirim Ulasan"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
