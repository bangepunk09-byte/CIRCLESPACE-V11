import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { api, errMsg } from "../../lib/api";
import { DEFAULTS, TOKEN_LABELS, contrast, isHex, resolveMode } from "../../lib/theme";
import { Slider } from "../../components/ui/slider";

const SHAPE_OPTIONS = [
  ["pill", "Kapsul", "9999px", "Sudut kapsul penuh untuk semua tombol, input & badge"],
  ["rounded", "Membulat", "14px", "Sudut membulat selaras mengikuti slider kelengkungan"],
  ["sharp", "Tegas", "4px", "Sudut tegas & presisi untuk seluruh elemen"],
];

export default function ThemeEditor({ scope }) {
  const { prefs, ws, savePrefs, setThemeDraft, reloadWs } = useApp();
  const mode = resolveMode(prefs.theme_mode || "light");
  const source = scope === "workspace" ? (ws?.theme || {}) : (prefs?.theme || {});
  const [draft, setDraft] = useState(source);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(scope === "workspace" ? (ws?.theme || {}) : (prefs?.theme || {}));
  }, [scope, ws?.theme, prefs?.theme]);

  useEffect(() => () => setThemeDraft(null), [setThemeDraft]);
  const base = { ...DEFAULTS[mode], ...(scope === "personal" ? ws?.theme?.[mode] || {} : {}) };
  const tokens = { ...base, ...(draft[mode] || {}) };

  const update = (next) => {
    setDraft(next);
    setThemeDraft(next);
  };

  const setTok = (k, v) => {
    const curModeObj = { ...(draft[mode] || {}), [k]: v };
    update({ ...draft, [mode]: curModeObj });
  };

  const warnings = [["text", "surface"], ["text", "bg"], ["muted", "surface"]].filter(
    ([a, b]) => isHex(tokens[a]) && isHex(tokens[b]) && contrast(tokens[a], tokens[b]) < (a === "muted" ? 3 : 4.5)
  );

  const save = async () => {
    setSaving(true);
    try {
      const cleanDraft = { ...draft };
      if (cleanDraft[mode] && typeof cleanDraft[mode] === "object") {
        const validColors = {};
        Object.entries(cleanDraft[mode]).forEach(([k, v]) => {
          if (k === "btnBg" || k === "btnHover" || k === "btnText") return;
          if (isHex(v)) validColors[k] = v;
        });
        cleanDraft[mode] = validColors;
      }
      if (scope === "workspace") {
        await api.patch("/workspace", { theme: cleanDraft });
        await reloadWs();
      } else {
        await savePrefs({ theme: cleanDraft });
      }
      setThemeDraft(null);
      toast.success("Tema & bentuk shapes berhasil disimpan!");
    } catch (e) {
      toast.error(errMsg(e, "Gagal menyimpan tema"));
    } finally {
      setSaving(false);
    }
  };

  const activeShape = draft.button || source.button || ws?.theme?.button || "pill";
  const activeRadius = draft.radius ?? source.radius ?? ws?.theme?.radius ?? 14;

  return (
    <div className="space-y-5" data-testid={`theme-editor-${scope}`}>
      <p className="text-sm text-sub">
        Mengatur palet warna, bentuk elemen (Kapsul / Membulat / Tegas), dan mode{" "}
        <b className="text-ink">{mode === "dark" ? "Gelap" : "Terang"}</b>{" "}
        {scope === "workspace"
          ? "untuk seluruh anggota workspace"
          : "khusus untuk tampilan Anda"}
        . Perubahan langsung terlihat secara live dan tersimpan permanen saat klik Simpan.
      </p>

      {/* Bentuk Elemen & Tombol (Kapsul - Membulat - Tegas) */}
      <div className="rounded-2xl border bg-surface2/60 p-3.5 space-y-3">
        <div>
          <p className="text-xs font-bold text-ink">Bentuk Shapes & Gaya Tombol (Kapsul · Membulat · Tegas)</p>
          <p className="text-[11px] text-sub">
            Menyelaraskan seluruh tombol, kolom input, dropdown select, chip/badge, dan kartu di seluruh halaman aplikasi.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SHAPE_OPTIONS.map(([k, l, radPreview, desc]) => {
            const isSelected = activeShape === k;
            return (
              <button
                type="button"
                key={k}
                onClick={() => update({ ...draft, button: k })}
                data-shape-preview={k}
                style={{
                  borderRadius: k === "pill" ? "9999px" : k === "sharp" ? "4px" : `${activeRadius}px`,
                }}
                className={`flex flex-col items-center justify-center gap-1 border px-4 py-2.5 text-center transition-all cursor-pointer ${
                  isSelected
                    ? "btn-accent shadow-sm"
                    : "bg-surface text-ink hover:bg-surface2"
                }`}
                data-testid={`theme-button-${k}`}
              >
                <span className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                  {isSelected && <Check size={14} strokeWidth={3} />}
                  {l}
                </span>
                <span className={`text-[10px] line-clamp-1 ${isSelected ? "opacity-90" : "text-sub"}`}>{desc}</span>
              </button>
            );
          })}
        </div>

        <div>
          <p className="mb-2 flex justify-between text-xs font-semibold">
            <span>Kelengkungan Sudut (Radius Dasar & Kartu)</span>
            <span className="text-sub">{activeRadius}px</span>
          </p>
          <Slider
            min={4}
            max={24}
            step={1}
            value={[activeRadius]}
            onValueChange={([v]) => update({ ...draft, radius: v })}
            data-testid="theme-radius-slider"
          />
        </div>
      </div>

      {/* Palet Lengkap Editor Tema */}
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(TOKEN_LABELS).map(([k, l]) => (
          <label key={k} className="flex items-center gap-3 rounded-2xl border bg-surface2 p-2.5">
            <input
              type="color"
              value={isHex(tokens[k]) ? tokens[k] : "#000000"}
              onChange={(e) => setTok(k, e.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg"
              aria-label={l}
              data-testid={`theme-color-${k}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{l}</span>
              <input
                value={tokens[k]}
                onChange={(e) => setTok(k, e.target.value)}
                className={`mt-0.5 h-7 w-full border bg-surface px-2 font-mono text-xs ${
                  isHex(tokens[k]) ? "" : "border-rose-400"
                }`}
                data-testid={`theme-hex-${k}`}
              />
            </span>
          </label>
        ))}
      </div>

      {warnings.length > 0 && (
        <div
          className="flex gap-2 rounded-2xl bg-soft-yellow p-3 text-sm text-amber-900 dark:text-amber-100"
          data-testid="contrast-warning"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Kontras rendah:{" "}
          {warnings
            .map(([a, b]) => `${TOKEN_LABELS[a]} di atas ${TOKEN_LABELS[b]} (${contrast(tokens[a], tokens[b]).toFixed(1)}:1)`)
            .join(", ")}
          . Teks mungkin sulit terbaca.
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-accent h-10 px-5 text-sm font-semibold disabled:opacity-50 cursor-pointer"
          data-testid="theme-save-btn"
        >
          {saving ? "Menyimpan..." : "Simpan Tema"}
        </button>
        <button
          type="button"
          onClick={() => update(source)}
          className="btn-ghost h-10 border px-5 text-sm font-semibold cursor-pointer"
          data-testid="theme-cancel-btn"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={() => update({})}
          className="btn-ghost h-10 border px-5 text-sm font-semibold cursor-pointer"
          data-testid="theme-reset-btn"
        >
          Reset ke Default
        </button>
      </div>
    </div>
  );
}
