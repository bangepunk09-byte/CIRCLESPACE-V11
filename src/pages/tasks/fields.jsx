import { useRef, useState } from "react";
import { Plus, X, FileText, Check, ChevronDown, Palette } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl, uploadFile } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { LabelChip, PRIORITY, Avatar } from "../../components/common";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, AppSelect } from "../../components/ui/select";

export const CARD_COLORS = ["#FF5364", "#F59E0B", "#EAB308", "#22C55E", "#0EA5A4", "#2F7DE1", "#8B5CF6", "#EC4899", "#64748B"];
export const inp = "h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none";

export function UserSelect({ value, onChange, placeholder = "Belum Ditugaskan", testid, ids, emptyMessage = "Belum ada anggota divisi", className }) {
  const { users } = useApp();
  const humanUsers = (users || []).filter(
    (u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
  const hasScopedArray = Array.isArray(ids);
  const list = hasScopedArray
    ? humanUsers.filter((u) => ids.includes(u.user_id))
    : humanUsers;
  const legacySelectedUser =
    hasScopedArray && value && !ids.includes(value)
      ? humanUsers.find((u) => u.user_id === value)
      : null;

  return (
    <AppSelect
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={className || inp}
      data-testid={testid}
    >
      <option value="">{placeholder}</option>
      {legacySelectedUser && (
        <option value={legacySelectedUser.user_id}>
          {legacySelectedUser.name} · Luar Divisi
        </option>
      )}
      {list.length === 0 ? (
        <option value="" disabled>
          {emptyMessage}
        </option>
      ) : (
        list.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.name}
          </option>
        ))
      )}
    </AppSelect>
  );
}

export function MultiUserSelect({
  value = [],
  onChange,
  placeholder = "Pilih penanggung jawab / PIC...",
  ids,
  scopeLabel,
  emptyMessage = "Belum ada akun aktif di divisi ini.",
  testid
}) {
  const { users, userMap } = useApp();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const humanUsers = (users || []).filter(
    (u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
  const hasScopedArray = Array.isArray(ids);
  const safeList = hasScopedArray
    ? humanUsers.filter((u) => ids.includes(u.user_id))
    : humanUsers;

  const selectedIds = Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);

  const filteredList = safeList.filter((u) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (u.name || "").toLowerCase().includes(q) ||
      (u.department || "").toLowerCase().includes(q) ||
      (u.job_title || "").toLowerCase().includes(q)
    );
  });

  const toggleUser = (uid) => {
    const next = selectedIds.includes(uid)
      ? selectedIds.filter((id) => id !== uid)
      : [...selectedIds, uid];
    onChange(next);
  };

  const removeUser = (e, uid) => {
    e.stopPropagation();
    onChange(selectedIds.filter((id) => id !== uid));
  };

  return (
    <div className="relative space-y-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-xl border bg-surface2 px-2.5 py-1.5 text-left text-sm transition-colors hover:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/20 cursor-pointer"
        data-testid={testid}
      >
        {selectedIds.length > 0 ? (
          selectedIds.map((uid) => {
            const u = userMap?.[uid] || humanUsers.find((x) => x.user_id === uid);
            if (!u) return null;
            return (
              <span
                key={uid}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 dark:bg-brand/20 px-2.5 py-1 text-xs font-semibold text-brand transition-all hover:bg-brand/15"
              >
                <Avatar user={u} size={18} showStatus={false} />
                <span className="truncate max-w-[180px] leading-normal">{u.name}</span>
                <span
                  onClick={(e) => removeUser(e, uid)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-brand/30 text-brand cursor-pointer"
                  title={`Hapus ${u.name}`}
                >
                  <X size={12} />
                </span>
              </span>
            );
          })
        ) : (
          <span className="text-sub text-xs">{placeholder}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-brand px-2 py-0.5 rounded-md hover:bg-brand/10">
          <Plus size={13} /> {selectedIds.length > 0 ? "Tambah orang" : "Pilih PIC"}
        </span>
      </button>

      {scopeLabel && (
        <p className="text-[11px] font-medium text-sub px-0.5" data-testid={`${testid || "assignee"}-scope-label`}>
          {scopeLabel}
        </p>
      )}

      {/* Quick one-click colleague pills for instant assignment */}
      {safeList.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {safeList.map((u) => {
            const isSelected = selectedIds.includes(u.user_id);
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => toggleUser(u.user_id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  isSelected
                    ? "border-brand bg-brand text-white shadow-xs"
                    : "border-slate-200 dark:border-slate-700 bg-surface hover:border-brand/50 hover:bg-surface2 text-ink"
                }`}
                data-testid={`quick-assign-${u.user_id}`}
              >
                <Avatar user={u} size={16} showStatus={false} />
                <span>{u.name?.split(" ")[0] || u.name}</span>
                {isSelected && <Check size={11} strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-surface2/50 px-3 py-2 text-xs text-sub" data-testid={`${testid || "assignee"}-empty`}>
          {emptyMessage}
        </p>
      )}

      {open && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-surface p-2.5 shadow-xl space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-bold text-sub uppercase tracking-wider">
              Pilih Penanggung Jawab · {selectedIds.length} terpilih
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-0.5 text-xs font-semibold text-brand hover:bg-brand/10 cursor-pointer"
            >
              Selesai
            </button>
          </div>
          {safeList.length > 4 && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau divisi..."
              className="h-8 w-full rounded-xl border bg-surface2 px-2.5 text-xs outline-none focus:border-brand"
            />
          )}
          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
            {filteredList.map((u) => {
              const on = selectedIds.includes(u.user_id);
              return (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => toggleUser(u.user_id)}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                    on ? "bg-brand/10 font-bold text-brand" : "hover:bg-surface2 text-ink"
                  }`}
                  data-testid={`user-option-${u.user_id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar user={u} size={22} showStatus={false} />
                    <div className="truncate text-left">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="block text-[10px] text-sub">
                        {u.job_title || "Anggota"}{u.department ? ` · ${u.department}` : ""}
                      </span>
                    </div>
                  </div>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-slate-300 dark:border-slate-600"}`}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
            {filteredList.length === 0 && (
              <p className="py-3 text-center text-xs text-sub">
                {safeList.length === 0 ? emptyMessage : "Tidak ada anggota yang cocok."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PrioritySelect({ value, onChange, testid }) {
  const current = PRIORITY[value || "medium"] || PRIORITY.medium;
  return (
    <Select value={value || "medium"} onValueChange={onChange}>
      <SelectTrigger className="w-full bg-surface2 border-slate-200 dark:border-slate-800 rounded-xl" data-testid={testid}>
        <SelectValue>{current.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(PRIORITY).map(([k, p]) => (
          <SelectItem key={k} value={k} data-testid={`priority-option-${k}`}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StatusSelect({ value, onChange, testid }) {
  const { statuses } = useApp();
  const list = statuses && statuses.length ? statuses : [{ key: "todo", name: "To Do" }];
  const current = list.find((s) => s.key === value) || list[0];
  return (
    <Select value={value || list[0]?.key || "todo"} onValueChange={onChange}>
      <SelectTrigger className="w-full bg-surface2 border-slate-200 dark:border-slate-800 rounded-xl" data-testid={testid}>
        <SelectValue>{current?.name || value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {list.map((s) => (
          <SelectItem key={s.key} value={s.key} data-testid={`status-option-${s.key}`}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LabelPicker({ value = [], onChange, testid = "label-picker" }) {
  const { labels, reloadLabels } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState(CARD_COLORS[5]);
  const create = async () => {
    try { const { data } = await api.post("/labels", { name, color }); await reloadLabels(); onChange([...value, data.id]); setName(""); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded-xl border bg-surface2 px-2 py-1.5 text-left text-sm" data-testid={testid}>
          {value.length ? value.map((id) => <LabelChip key={id} label={labels.find((l) => l.id === id)} small />) : <span className="text-sub">Tambah label IP / Brand</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 bg-surface p-2" align="start">
        <div className="max-h-56 overflow-y-auto">
          {labels.filter((l) => !l.archived).map((l) => { const on = value.includes(l.id); return (
            <button key={l.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])} className="flex w-full items-center gap-2 rounded-lg p-1.5 hover:bg-surface2" data-testid={`label-option-${l.id}`}>
              <span className="flex h-4 w-4 items-center justify-center rounded border">{on && <Check size={12} />}</span><LabelChip label={l} small />
            </button>); })}
        </div>
        <div className="mt-2 flex items-center gap-1 border-t pt-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label baru" className="h-8 min-w-0 flex-1 rounded-lg border bg-surface2 px-2 text-xs" data-testid="new-label-input" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-8 rounded" aria-label="Warna label" />
          <button type="button" onClick={create} disabled={!name.trim()} className="btn-accent h-8 px-2 text-xs disabled:opacity-40" data-testid="create-label-btn">Tambah</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const DEFAULT_ITEM_TYPES = [
  { name: "Feed Post", color: "#FFE4E6", text_color: "#BE123C", border_color: "#FECDD3" },
  { name: "Reels", color: "#FFEDD5", text_color: "#C2410C", border_color: "#FED7AA" },
  { name: "Story", color: "#FEF08A", text_color: "#854D0E", border_color: "#FDE047" },
  { name: "Ads", color: "#DC2626", text_color: "#FFFFFF", border_color: "#B91C1C" },
  { name: "Youtube", color: "#FEE2E2", text_color: "#991B1B", border_color: "#FCA5A5" },
  { name: "Deck", color: "#2563EB", text_color: "#FFFFFF", border_color: "#1D4ED8" },
  { name: "Proposal", color: "#DDD6FE", text_color: "#4C1D95", border_color: "#C4B5FD" },
  { name: "Poster", color: "#F3E8FF", text_color: "#7E22CE", border_color: "#E9D5FF" },
  { name: "Campaign", color: "#DCFCE7", text_color: "#15803D", border_color: "#BBF7D0" },
  { name: "Research", color: "#BAE6FD", text_color: "#0369A1", border_color: "#7DD3FC" },
  { name: "Documentation", color: "#F1F5F9", text_color: "#334155", border_color: "#CBD5E1" },
  { name: "Photo Editing", color: "#CCFBF1", text_color: "#0F766E", border_color: "#99F6E4" },
  { name: "Printing", color: "#1E293B", text_color: "#FFFFFF", border_color: "#0F172A" }
];

export const isDarkHex = (hex) => {
  if (!hex || typeof hex !== "string") return false;
  const c = hex.replace("#", "");
  if (c.length !== 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55;
};

export function getItemMeta(name, customList = []) {
  if (!name) return null;
  const nameNorm = String(name).trim().toLowerCase();
  const fromWs = (customList || []).find((i) => i.name?.toLowerCase() === nameNorm);
  if (fromWs) {
    const bg = fromWs.color || "#E2E8F0";
    const isDark = isDarkHex(bg);
    return {
      name: fromWs.name,
      color: bg,
      text_color: fromWs.text_color || (isDark ? "#FFFFFF" : "#1E293B"),
      border_color: fromWs.border_color || (isDark ? bg : `${bg}`)
    };
  }
  const fromDefault = DEFAULT_ITEM_TYPES.find((i) => i.name.toLowerCase() === nameNorm);
  if (fromDefault) return fromDefault;
  return { name, color: "#E2E8F0", text_color: "#1E293B", border_color: "#CBD5E1" };
}

export const itemStyle = (c) => {
  if (!c) return { backgroundColor: "#E2E8F0", color: "#1E293B", borderColor: "#CBD5E1" };
  if (typeof c === "object") {
    const bg = c.color || "#E2E8F0";
    const isDark = isDarkHex(bg);
    const text = c.text_color || (isDark ? "#FFFFFF" : "#1E293B");
    const border = c.border_color || (isDark ? bg : `${bg}`);
    return { backgroundColor: bg, color: text, borderColor: border };
  }
  const isDark = isDarkHex(c);
  return {
    backgroundColor: c,
    color: isDark ? "#FFFFFF" : "#1E293B",
    borderColor: isDark ? c : `${c}90`
  };
};

export function ItemChip({ name, small, className = "" }) {
  const { ws } = useApp();
  if (!name) return null;
  const meta = getItemMeta(name, ws?.item_types);
  const style = itemStyle(meta);
  return (
    <span
      className={`inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full font-semibold border transition-all leading-normal ${
        small ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
      } ${className}`}
      style={style}
      data-testid="item-chip"
    >
      {meta?.name || name}
    </span>
  );
}

export function ItemPicker({ value, onChange, testid = "item-picker", trigger }) {
  const { ws, reloadWs } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState("#2563EB");

  // Authoritative workspace item_types when configured, fallback to DEFAULT_ITEM_TYPES
  const sourceList = Array.isArray(ws?.item_types) && ws.item_types.length > 0 ? ws.item_types : DEFAULT_ITEM_TYPES;
  const combinedMap = new Map();
  sourceList.forEach((item) => item?.name && combinedMap.set(item.name.toLowerCase(), item));
  const all = Array.from(combinedMap.values());

  const list = all.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = all.find((i) => i.name.toLowerCase() === q.trim().toLowerCase());

  const pick = (n) => {
    onChange(n);
    setOpen(false);
    setQ("");
    setShowAddForm(false);
  };

  const createItem = async (nameToCreate, colorToUse) => {
    const finalName = (nameToCreate || "").trim();
    if (!finalName) return;
    const finalColor = colorToUse || customColor || "#2563EB";
    const isDark = isDarkHex(finalColor);
    const payload = {
      name: finalName,
      color: finalColor,
      text_color: isDark ? "#FFFFFF" : "#1E293B",
      border_color: isDark ? finalColor : undefined
    };
    try {
      await api.post("/item-types", payload);
      await reloadWs();
      toast.success(`Item "${finalName}" berhasil ditambahkan!`);
      pick(finalName);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const onKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (exact) {
      pick(exact.name);
    } else if (q.trim()) {
      createItem(q.trim(), customColor);
    } else if (list[0]) {
      pick(list[0].name);
    }
  };

  const PRESET_NEW_COLORS = [
    { bg: "#FFE4E6", name: "Rose" },
    { bg: "#FFEDD5", name: "Orange" },
    { bg: "#FEF08A", name: "Yellow" },
    { bg: "#DCFCE7", name: "Green" },
    { bg: "#BAE6FD", name: "Sky" },
    { bg: "#CCFBF1", name: "Teal" },
    { bg: "#F3E8FF", name: "Purple" },
    { bg: "#2563EB", name: "Blue" },
    { bg: "#DDD6FE", name: "Lavender" },
    { bg: "#581C87", name: "Dark Purple" },
    { bg: "#047857", name: "Emerald" },
    { bg: "#78350F", name: "Brown" },
    { bg: "#6B21A8", name: "Plum" },
    { bg: "#E2E8F0", name: "Gray" }
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <button
            type="button"
            className={`${inp} flex items-center justify-between text-left cursor-pointer transition-colors hover:border-brand/40`}
            data-testid={testid}
          >
            {value ? <ItemChip name={value} /> : <span className="text-sub text-xs">Pilih jenis item...</span>}
            <ChevronDown size={14} className="text-sub shrink-0 ml-1.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-surface p-3 shadow-xl rounded-2xl border border-slate-200 dark:border-slate-800" align="start">
        {/* Search header */}
        <div className="relative">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Cari atau ketik item baru..."
            className="h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/20"
            data-testid={`${testid}-search`}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sub hover:text-ink cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* List of items */}
        <div className="mt-2.5 max-h-56 space-y-1 overflow-y-auto pr-1">
          {list.length > 0 ? (
            list.map((i) => {
              const isSelected = value === i.name;
              return (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => pick(i.name)}
                  className={`flex w-full items-center justify-between rounded-xl p-1.5 text-left transition-colors cursor-pointer ${
                    isSelected ? "bg-brand/10 font-bold" : "hover:bg-surface2"
                  }`}
                  data-testid={`${testid}-option-${i.name.replace(/\s/g, "-")}`}
                >
                  <ItemChip name={i.name} />
                  {isSelected && <Check size={14} className="text-brand shrink-0 mr-1" strokeWidth={2.5} />}
                </button>
              );
            })
          ) : (
            <p className="py-2 text-center text-xs text-sub">Tidak ada item yang cocok.</p>
          )}
        </div>

        {/* Quick add if search text doesn't match */}
        {q.trim() && !exact && (
          <button
            type="button"
            onClick={() => createItem(q.trim(), customColor)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand/50 bg-brand/5 p-2 text-xs font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer"
            data-testid={`${testid}-create-quick`}
          >
            <Plus size={13} /> Tambah "{q.trim()}"
          </button>
        )}

        {/* Collapsible custom item creator */}
        <div className="mt-2.5 border-t border-slate-100 dark:border-slate-800 pt-2">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => {
                setShowAddForm(true);
                if (q.trim() && !exact) setCustomName(q.trim());
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-sub hover:bg-surface2 hover:text-brand transition-colors cursor-pointer"
              data-testid={`${testid}-toggle-add-form`}
            >
              <span className="flex items-center gap-1.5">
                <Palette size={13} /> Buat Item Baru Kustom
              </span>
              <Plus size={13} />
            </button>
          ) : (
            <div className="space-y-2 rounded-xl bg-surface2/60 p-2.5 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-sub uppercase tracking-wider">Tambah Item Baru</span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-sub hover:text-ink text-xs cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>

              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nama item baru, mis. Newsletter"
                className="h-8 w-full rounded-lg border bg-surface px-2.5 text-xs outline-none focus:border-brand"
                data-testid={`${testid}-custom-name`}
              />

              {/* Color swatches */}
              <div>
                <p className="mb-1 text-[10px] font-semibold text-sub">Pilih Warna:</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_NEW_COLORS.map((p) => {
                    const isSelected = customColor.toLowerCase() === p.bg.toLowerCase();
                    return (
                      <button
                        key={p.bg}
                        type="button"
                        onClick={() => setCustomColor(p.bg)}
                        className={`h-5 w-5 rounded-full border border-black/10 transition-transform cursor-pointer ${
                          isSelected ? "scale-115 ring-2 ring-brand ring-offset-1" : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: p.bg }}
                        title={p.name}
                      />
                    );
                  })}
                  <label className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-400 bg-white dark:bg-slate-800 text-[10px] text-sub" title="Pilih warna kustom">
                    +
                    <input
                      type="color"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Live Preview */}
              {customName.trim() && (
                <div className="pt-1">
                  <span className="text-[10px] text-sub block mb-1">Preview:</span>
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border shadow-xs"
                    style={{
                      backgroundColor: customColor,
                      color: isDarkHex(customColor) ? "#FFFFFF" : "#1E293B",
                      borderColor: isDarkHex(customColor) ? customColor : `${customColor}`
                    }}
                  >
                    {customName.trim()}
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={!customName.trim()}
                onClick={() => createItem(customName.trim(), customColor)}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
                data-testid={`${testid}-submit-custom`}
              >
                <Plus size={13} /> Tambah & Pilih
              </button>
            </div>
          )}
        </div>

        {/* Clear selection */}
        {value && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="mt-2 w-full rounded-xl py-1.5 text-center text-xs font-medium text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
            data-testid={`${testid}-clear`}
          >
            Kosongkan Pilihan Item
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ColorPicker({ value, onChange, style, onStyle }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="card-color-picker">
      {CARD_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full transition-transform cursor-pointer ${
            value === c ? "ring-2 ring-offset-2 ring-[var(--c-text)] scale-110" : "hover:scale-105"
          }`}
          style={{ background: c }}
          aria-label={`Warna ${c}`}
          data-testid={`card-color-${c.slice(1)}`}
        />
      ))}
      <input
        type="color"
        value={value || "#FF5364"}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 rounded cursor-pointer border-0 p-0 bg-transparent"
        aria-label="Warna kustom"
      />
      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-xs font-semibold text-sub hover:text-ink px-1 cursor-pointer"
        data-testid="card-color-reset"
      >
        Reset
      </button>

      {onStyle && (
        <div className="w-36 ml-1">
          <Select value={style || "accent"} onValueChange={onStyle}>
            <SelectTrigger className="h-9 w-full bg-surface2 border-slate-200 dark:border-slate-800 rounded-xl text-xs" data-testid="card-style-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accent">Garis aksen</SelectItem>
              <SelectItem value="tint">Latar lembut</SelectItem>
              <SelectItem value="badge">Badge saja</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function AttachmentList({ items, onRemove }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a, idx) => (
        <div key={a.id || a.key || idx} className="relative">
          <a href={a.id ? fileUrl(a.id) : undefined} target="_blank" rel="noreferrer" className="flex h-16 items-center gap-2 rounded-xl border bg-surface2 p-1.5 pr-3 text-xs" data-testid={`attachment-${a.id || idx}`}>
            {a.content_type?.startsWith("image/") && a.id ? <img src={fileUrl(a.id)} alt={a.name} className="h-12 w-12 rounded-lg object-cover" /> : <FileText size={18} className="ml-1 text-brand" />}
            <span className="max-w-[120px] truncate">{a.uploading ? "Mengunggah…" : a.name}</span>
          </a>
          {onRemove && <button type="button" onClick={() => onRemove(a)} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-[var(--c-surface)]" aria-label="Hapus lampiran" data-testid={`remove-attachment-${a.id || idx}`}><X size={11} /></button>}
        </div>
      ))}
    </div>
  );
}

export function useUploader(setList) {
  const ref = useRef(null);
  const pick = () => ref.current.click();
  const input = <input ref={ref} type="file" multiple hidden onChange={async (e) => {
    const files = Array.from(e.target.files); e.target.value = "";
    for (const f of files) {
      if (f.size > 15 * 1024 * 1024) { toast.error(`Ukuran ${f.name} melebihi 15 MB`); continue; }
      try { const up = await uploadFile(f); setList((x) => [...x, up]); } catch (er) { toast.error(errMsg(er)); }
    }
  }} data-testid="task-attachment-input" />;
  return { pick, input };
}

export function ListEditor({ items, onChange, placeholder, field = "text", testid }) {
  const [t, setT] = useState("");
  return (
    <div data-testid={testid}>
      {items.map((it, idx) => (
        <div key={it.id || idx} className="flex items-center gap-2 py-1">
          <input type="checkbox" checked={!!it.done} onChange={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} className="h-4 w-4 accent-[var(--c-accent)]" />
          <span className={`flex-1 text-sm ${it.done ? "line-through text-sub" : ""}`}>{it[field]}</span>
          <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} className="text-sub" aria-label="Remove"><X size={13} /></button>
        </div>
      ))}
      <div className="mt-1 flex gap-1"><input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (t.trim()) { onChange([...items, { id: `i${Date.now()}`, [field]: t.trim(), done: false }]); setT(""); } } }} placeholder={placeholder} className="h-9 flex-1 rounded-lg border bg-surface2 px-2 text-sm" />
        <button type="button" onClick={() => { if (t.trim()) { onChange([...items, { id: `i${Date.now()}`, [field]: t.trim(), done: false }]); setT(""); } }} className="flex h-9 w-9 items-center justify-center rounded-lg border" aria-label="Add"><Plus size={14} /></button></div>
    </div>
  );
}
