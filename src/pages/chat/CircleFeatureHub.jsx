import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, Play, CornerDownLeft, Zap, Terminal } from "lucide-react";
import { api } from "../../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";

let CATALOG_CACHE = null;

export async function fetchCircleCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  try {
    const { data } = await api.get("/assistant/catalog");
    if (data && Array.isArray(data.commands)) {
      CATALOG_CACHE = data;
      return data;
    }
  } catch {}
  return { categories: ["Semua"], total_features: 0, commands: [] };
}

export default function CircleFeatureHub({ open, onOpenChange, onRunCommand, onFillTemplate }) {
  const [catalog, setCatalog] = useState(CATALOG_CACHE || { categories: ["Semua"], total_features: 0, commands: [] });
  const [category, setCategory] = useState("Semua");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!CATALOG_CACHE);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchCircleCatalog().then((res) => {
      if (active) {
        setCatalog(res);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [open]);

  const categories = useMemo(() => {
    if (Array.isArray(catalog.categories) && catalog.categories.length) return catalog.categories;
    return ["Semua"];
  }, [catalog.categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog.commands || []).filter((item) => {
      if (category !== "Semua" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.command.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [catalog.commands, category, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] sm:w-[95vw] max-w-4xl flex-col overflow-hidden rounded-3xl bg-surface p-0">
        <DialogHeader className="border-b px-4 pt-4 pb-3 sm:px-5 sm:pt-5 sm:pb-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Sparkles size={20} />
              </div>
              <div>
                <DialogTitle className="text-base font-extrabold text-ink">
                  Pusat Perintah & {catalog.total_features || "60+"} Fitur Circle AI
                </DialogTitle>
                <DialogDescription className="text-xs text-sub">
                  Pilih fitur untuk langsung dijalankan atau isi otomatis ke kolom chat.
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-2xl border bg-surface2 px-3">
            <Search size={15} className="text-sub" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari fitur atau perintah..."
              className="h-10 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-sub"
              data-testid="circle-hub-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-xs font-semibold text-sub hover:text-ink"
              >
                Reset
              </button>
            )}
          </div>

          <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  category === cat
                    ? "bg-brand text-white shadow-xs"
                    : "border border-subtle bg-surface2/70 text-sub hover:text-ink"
                }`}
                data-testid={`circle-hub-cat-${cat.replace(/\s+/g, "-")}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 scroll-thin">
          {loading ? (
            <div className="py-12 text-center text-sm text-sub">Memuat katalog fitur Circle AI...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-sub">
              Tidak ada fitur yang cocok dengan pencarian <b className="text-ink">"{query}"</b>.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-2xl border border-subtle bg-surface2/40 p-3.5 transition-colors hover:border-brand/50 hover:bg-surface2/80"
                  data-testid={`circle-feature-card-${item.id}`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-0.5 font-mono text-[11px] font-bold text-brand">
                          <Terminal size={11} />
                          {item.command}
                        </span>
                        {item.mutates && (
                          <span className="inline-flex items-center gap-0.5 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            <Zap size={10} /> Aksi Nyata
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold text-sub">{item.category}</span>
                    </div>

                    <h4 className="mt-2 text-sm font-bold text-ink">{item.title}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-sub">{item.description}</p>
                    <p className="mt-2 truncate rounded-lg bg-surface px-2 py-1 font-mono text-[11px] text-sub border border-subtle/60">
                      Contoh: {item.example}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center gap-2 pt-2 border-t border-subtle/60">
                    {item.instant ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onRunCommand?.(item.command)}
                          className="btn-accent flex h-9 sm:h-8 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold"
                          data-testid={`circle-run-${item.id}`}
                        >
                          <Play size={12} /> Jalankan
                        </button>
                        <button
                          type="button"
                          onClick={() => onFillTemplate?.(item.template)}
                          className="btn-ghost flex h-9 sm:h-8 items-center justify-center gap-1 rounded-xl border px-3 text-xs font-semibold text-ink"
                        >
                          <CornerDownLeft size={12} /> Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onFillTemplate?.(item.template)}
                          className="btn-accent flex h-9 sm:h-8 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold"
                          data-testid={`circle-fill-${item.id}`}
                        >
                          <CornerDownLeft size={12} /> Gunakan Template
                        </button>
                        <button
                          type="button"
                          onClick={() => onFillTemplate?.(item.example)}
                          className="btn-ghost flex h-9 sm:h-8 items-center justify-center rounded-xl border px-3 text-xs font-semibold text-ink"
                        >
                          Coba Contoh
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
