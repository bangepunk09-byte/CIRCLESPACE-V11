import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, Loader2, X } from "lucide-react";

let counter = 1;
const subscribers = new Set();
let activeToasts = [];
let topQuickActionNotifActive = false;

function notify() {
  const snapshot = [...activeToasts];
  subscribers.forEach((fn) => fn(snapshot));
}

export function setTopQuickActionNotifActive(active) {
  topQuickActionNotifActive = Boolean(active);
  if (topQuickActionNotifActive && activeToasts.length > 0) {
    const filtered = activeToasts.filter((t) => t.type === "error" || t.type === "loading");
    if (filtered.length !== activeToasts.length) {
      activeToasts = filtered;
      notify();
    }
  }
}

function createToast(message, opts = {}) {
  const toastType = opts.type || "default";
  if (topQuickActionNotifActive && toastType !== "error" && toastType !== "loading") {
    return null;
  }
  const id = opts.id ?? counter++;
  const entry = {
    id,
    title: message,
    description: opts.description,
    type: toastType,
    duration: typeof opts.duration === "number" ? opts.duration : 3800,
    action: opts.action,
    cancel: opts.cancel,
    dismissible: opts.dismissible !== false,
    createdAt: Date.now(),
  };

  const existingIdx = activeToasts.findIndex((t) => t.id === id);
  if (existingIdx !== -1) {
    activeToasts = [
      ...activeToasts.slice(0, existingIdx),
      { ...activeToasts[existingIdx], ...entry },
      ...activeToasts.slice(existingIdx + 1),
    ];
  } else {
    activeToasts = [entry, ...activeToasts].slice(0, 5);
  }
  notify();
  return id;
}

function dismissToast(id) {
  if (id === undefined || id === null) {
    activeToasts = [];
  } else {
    activeToasts = activeToasts.filter((t) => t.id !== id);
  }
  notify();
  return id;
}

export const toast = Object.assign(
  (message, data) => createToast(message, { ...data, type: data?.type || "default" }),
  {
    success: (message, data) => createToast(message, { ...data, type: "success" }),
    error: (message, data) => createToast(message, { ...data, type: "error" }),
    info: (message, data) => createToast(message, { ...data, type: "info" }),
    warning: (message, data) => createToast(message, { ...data, type: "warning" }),
    loading: (message, data) => createToast(message, { ...data, type: "loading", duration: Infinity }),
    message: (message, data) => createToast(message, { ...data, type: "default" }),
    dismiss: dismissToast,
    getHistory: () => [...activeToasts],
    getToasts: () => [...activeToasts],
    promise: (promise, data = {}) => {
      const id = data.loading !== undefined ? createToast(data.loading, { type: "loading", duration: Infinity }) : undefined;
      const p = typeof promise === "function" ? promise() : promise;
      Promise.resolve(p)
        .then((res) => {
          if (data.success !== undefined) {
            const msg = typeof data.success === "function" ? data.success(res) : data.success;
            createToast(msg, { id, type: "success" });
          } else if (id !== undefined) {
            dismissToast(id);
          }
        })
        .catch((err) => {
          if (data.error !== undefined) {
            const msg = typeof data.error === "function" ? data.error(err) : data.error;
            createToast(msg, { id, type: "error" });
          } else if (id !== undefined) {
            dismissToast(id);
          }
        });
      return id;
    },
  }
);

export function useSonner() {
  const [toasts, setToasts] = useState(() => [...activeToasts]);
  useEffect(() => {
    subscribers.add(setToasts);
    setToasts([...activeToasts]);
    return () => subscribers.delete(setToasts);
  }, []);
  return { toasts };
}

const POS_CLASS = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
};

const TONE_CLASS = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/95 dark:text-emerald-100",
  error: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/70 dark:bg-rose-950/95 dark:text-rose-100",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/95 dark:text-amber-100",
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/95 dark:text-sky-100",
  loading: "border-slate-200 bg-surface text-ink dark:border-slate-800",
  default: "border-slate-200 bg-surface text-ink dark:border-slate-800",
};

function ToastIcon({ type }) {
  if (type === "success") return <CheckCircle2 size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (type === "error") return <AlertCircle size={16} className="shrink-0 text-rose-600 dark:text-rose-400" />;
  if (type === "warning") return <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />;
  if (type === "info") return <Info size={16} className="shrink-0 text-sky-600 dark:text-sky-400" />;
  if (type === "loading") return <Loader2 size={16} className="shrink-0 animate-spin text-brand" />;
  return null;
}

function ToastItem({ item, closeButton, richColors, onDismiss }) {
  useEffect(() => {
    if (!Number.isFinite(item.duration) || item.duration <= 0) return undefined;
    const timer = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, item.createdAt, onDismiss]);

  const tone = richColors ? (TONE_CLASS[item.type] || TONE_CLASS.default) : TONE_CLASS.default;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-all ${tone}`}
    >
      <ToastIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <div className="leading-snug break-words">{item.title}</div>
        {item.description && (
          <div className="mt-0.5 text-[11px] font-normal opacity-80 break-words">{item.description}</div>
        )}
      </div>
      {closeButton && item.dismissible && (
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="Close toast"
          className="ml-1 shrink-0 rounded-lg p-1 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Toaster({ position = "top-center", richColors = true, closeButton = true }) {
  const { toasts } = useSonner();
  const handleDismiss = useCallback((id) => dismissToast(id), []);

  if (!toasts.length) return null;

  const posCls = POS_CLASS[position] || POS_CLASS["top-center"];

  return (
    <div
      className={`pointer-events-none fixed z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 ${posCls}`}
      data-sonner-toaster="true"
    >
      {toasts.map((item) => (
        <ToastItem
          key={item.id}
          item={item}
          richColors={richColors}
          closeButton={closeButton}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
