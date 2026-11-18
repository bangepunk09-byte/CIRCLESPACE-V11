import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, AlertTriangle, X, Plus, CheckCircle2, RotateCcw, Flag, Layers, Sparkles, Bell, BookmarkPlus, AtSign } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar, rel, MentionText } from "../../components/common";
import { DatePicker } from "../../components/ui/date-picker";
import { UserSelect } from "./fields";
import { playSound } from "../../lib/sound";
import { syncWorkspaceMirror } from "../../lib/persistentMirror";

export function extractCommentMentions(text, explicitIds = [], users = []) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const humanUsers = (Array.isArray(users) ? users : []).filter(
    (u) => u && u.user_id && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
  const matched = new Set();

  for (const uid of Array.isArray(explicitIds) ? explicitIds : []) {
    const u = humanUsers.find((x) => x.user_id === uid);
    if (!u) continue;
    const fullName = String(u.name || "").trim().toLowerCase();
    const firstName = fullName.split(/\s+/)[0];
    if (
      (fullName && lower.includes(`@${fullName}`)) ||
      (firstName && lower.includes(`@${firstName}`))
    ) {
      matched.add(u.user_id);
    }
  }

  for (const u of humanUsers) {
    const fullName = String(u.name || "").trim();
    if (!fullName) continue;
    if (lower.includes(`@${fullName.toLowerCase()}`)) {
      matched.add(u.user_id);
      continue;
    }
    const firstName = fullName.split(/\s+/)[0];
    if (firstName && firstName.length >= 2) {
      const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`@${escaped}(?![\\w])`, "i").test(raw)) {
        matched.add(u.user_id);
      }
    }
  }

  return Array.from(matched);
}

export function CommentMentionInput({
  value,
  onChange,
  mentionIds = [],
  onMentionIdsChange,
  onSubmit,
  placeholder = "Tulis komentar… ketik @Nama untuk menyebut rekan",
  testid = "task-comment-input",
  rightSlot = null,
  textareaClassName = "min-h-[44px] flex-1 rounded-xl border bg-surface2 p-2.5 text-sm outline-none focus:ring-1 focus:ring-brand",
}) {
  const { users, userMap } = useApp();
  const textareaRef = useRef(null);
  const containerRef = useRef(null);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const humanUsers = (Array.isArray(users) ? users : []).filter(
    (u) => u && u.user_id && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );

  const queryStr = mentionQuery !== null ? mentionQuery : pickerOpen ? "" : null;
  const candidates =
    queryStr === null
      ? []
      : humanUsers
          .filter((u) => {
            if (!queryStr) return true;
            const q = queryStr.toLowerCase();
            return (
              String(u.name || "").toLowerCase().includes(q) ||
              String(u.department || u.division || "").toLowerCase().includes(q) ||
              String(u.job_title || "").toLowerCase().includes(q)
            );
          })
          .slice(0, 8);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setMentionQuery(null);
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const detectAtTrigger = (textVal, cursorPos) => {
    const uptoCursor = textVal.slice(0, cursorPos);
    const match = uptoCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      const q = match[1] || "";
      const atIdx = uptoCursor.lastIndexOf("@" + q);
      setMentionStart(atIdx);
      setMentionQuery(q);
      setActiveIndex(0);
    } else {
      setMentionQuery(null);
      setMentionStart(-1);
    }
  };

  const handleTextChange = (e) => {
    const nextVal = e.target.value;
    onChange(nextVal);
    detectAtTrigger(nextVal, e.target.selectionStart ?? nextVal.length);
  };

  const insertUserMention = (u) => {
    if (!u?.name) return;
    const el = textareaRef.current;
    const currentText = String(value || "");
    let nextText = "";
    let nextCursor = 0;

    if (mentionQuery !== null && mentionStart >= 0) {
      const cursor = el?.selectionStart ?? (mentionStart + 1 + mentionQuery.length);
      const before = currentText.slice(0, mentionStart);
      const after = currentText.slice(cursor);
      const insertion = `@${u.name} `;
      nextText = `${before}${insertion}${after}`;
      nextCursor = before.length + insertion.length;
    } else {
      const cursor = el?.selectionStart ?? currentText.length;
      const before = currentText.slice(0, cursor);
      const after = currentText.slice(cursor);
      const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const insertion = `${needLeadingSpace ? " " : ""}@${u.name} `;
      nextText = `${before}${insertion}${after}`;
      nextCursor = before.length + insertion.length;
    }

    onChange(nextText);
    const nextIds = Array.from(new Set([...(mentionIds || []), u.user_id]));
    onMentionIdsChange?.(nextIds);
    setMentionQuery(null);
    setMentionStart(-1);
    setPickerOpen(false);

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleKeyDown = (e) => {
    if (candidates.length > 0 && (mentionQuery !== null || pickerOpen)) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = candidates[activeIndex] || candidates[0];
        if (chosen) insertUserMention(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setPickerOpen(false);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const resolvedMentions = extractCommentMentions(value, mentionIds, humanUsers);

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      {/* Dropdown Autocomplete @Mention */}
      {candidates.length > 0 && (mentionQuery !== null || pickerOpen) && (
        <div
          className="mb-1.5 max-h-52 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-1.5 shadow-lg dark:border-slate-700 z-30"
          data-testid={`${testid}-mention-dropdown`}
        >
          <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold text-sub">
            <span>Pilih rekan untuk di-tag (otomatis kirim notifikasi)</span>
            <button
              type="button"
              onClick={() => {
                setMentionQuery(null);
                setPickerOpen(false);
              }}
              className="text-sub hover:text-ink cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
          {candidates.map((u, idx) => {
            const isSelected = idx === activeIndex;
            const isAlreadyTagged = resolvedMentions.includes(u.user_id);
            return (
              <button
                key={u.user_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertUserMention(u);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                  isSelected ? "bg-brand/10 text-brand font-semibold" : "hover:bg-surface2 text-ink"
                }`}
                data-testid={`${testid}-mention-option-${u.user_id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar user={u} size={22} showStatus={false} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{u.name}</p>
                    <p className="truncate text-[10px] text-sub">
                      {u.department || u.division || u.job_title || "Anggota Tim"}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
                  {isAlreadyTagged ? "Sudah di-tag" : `@${u.name.split(" ")[0]}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={textareaClassName}
          data-testid={testid}
        />
        {rightSlot}
      </div>

      {/* Helper bar: @ Tag Nama button + tagged users notification preview */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPickerOpen((prev) => !prev);
              setActiveIndex(0);
            }}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
              pickerOpen
                ? "border-brand bg-brand text-white"
                : "border-slate-200 bg-surface text-sub hover:border-brand hover:text-brand dark:border-slate-700"
            }`}
            title="Tag nama rekan agar menerima notifikasi"
            data-testid={`${testid}-tag-btn`}
          >
            <AtSign size={11} />
            <span>Tag Nama</span>
          </button>

          {resolvedMentions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" data-testid={`${testid}-tagged-list`}>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sub">
                <Bell size={11} className="text-brand" /> Notif ke:
              </span>
              {resolvedMentions.map((uid) => {
                const u = userMap?.[uid] || humanUsers.find((x) => x.user_id === uid);
                if (!u) return null;
                return (
                  <span
                    key={uid}
                    className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand"
                    data-testid={`${testid}-tagged-chip-${uid}`}
                  >
                    @{u.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const DEFAULT_CHECKPOINT_PRESETS = [
  {
    id: "builtin_video",
    label: "🎬 Video Content",
    items: ["Pembuatan Script / Naskah", "Persiapan Aset Visual", "Shooting / Recording", "Editing & Post-Production"],
    builtin: true,
  },
  {
    id: "builtin_design",
    label: "🎨 Graphic & Design",
    items: ["Brief & Riset Konsep", "Draft Desain Awal", "Review & Revisi", "Final Export Asset"],
    builtin: true,
  },
  {
    id: "builtin_web",
    label: "💻 Web & Tech",
    items: ["Requirement & Wireframe", "UI/UX Design", "Frontend / Backend Dev", "QA & Final Testing"],
    builtin: true,
  },
];

const CP_TEMPLATES_STORAGE_KEY = "circle_checkpoint_templates";

function readCachedTemplates() {
  try {
    const raw = localStorage.getItem(CP_TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function useCheckpointTemplates() {
  const { ws, prefs, savePrefs, setSession } = useApp();
  const [customTemplates, setCustomTemplates] = useState(() => {
    if (Array.isArray(ws?.checkpoint_templates) && ws.checkpoint_templates.length > 0) {
      return ws.checkpoint_templates;
    }
    if (Array.isArray(prefs?.checkpoint_templates) && prefs.checkpoint_templates.length > 0) {
      return prefs.checkpoint_templates;
    }
    return readCachedTemplates();
  });

  useEffect(() => {
    const fromWs = Array.isArray(ws?.checkpoint_templates) ? ws.checkpoint_templates : null;
    const fromPrefs = Array.isArray(prefs?.checkpoint_templates) ? prefs.checkpoint_templates : null;
    const resolved = fromWs ?? fromPrefs ?? readCachedTemplates();
    setCustomTemplates(resolved);
    try {
      localStorage.setItem(CP_TEMPLATES_STORAGE_KEY, JSON.stringify(resolved));
    } catch {}
  }, [ws?.checkpoint_templates, prefs?.checkpoint_templates]);

  const persistTemplates = async (nextList) => {
    setCustomTemplates(nextList);
    try {
      localStorage.setItem(CP_TEMPLATES_STORAGE_KEY, JSON.stringify(nextList));
    } catch {}
    try {
      await savePrefs?.({ checkpoint_templates: nextList });
    } catch {}
    try {
      const { data } = await api.patch("/workspace", { checkpoint_templates: nextList });
      if (data && typeof data === "object") {
        setSession?.((s) => (s ? { ...s, workspace: data } : s));
      }
      syncWorkspaceMirror(api, true).catch(() => {});
    } catch {}
  };

  const addTemplate = async (label, items) => {
    const cleanLabel = String(label || "").trim();
    const cleanItems = (Array.isArray(items) ? items : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!cleanLabel) {
      toast.error("Nama template wajib diisi");
      return false;
    }
    if (cleanItems.length === 0) {
      toast.error("Tambahkan minimal 1 tahap checkpoint untuk template");
      return false;
    }
    const newTpl = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: cleanLabel,
      items: cleanItems,
      builtin: false,
    };
    const next = [...customTemplates, newTpl];
    await persistTemplates(next);
    toast.success(`Template "${cleanLabel}" berhasil disimpan!`);
    return newTpl;
  };

  const removeTemplate = async (id) => {
    const target = customTemplates.find((t) => t.id === id);
    const next = customTemplates.filter((t) => t.id !== id);
    await persistTemplates(next);
    if (target) toast.success(`Template "${target.label}" dihapus`);
  };

  return {
    allPresets: [...DEFAULT_CHECKPOINT_PRESETS, ...customTemplates],
    customTemplates,
    addTemplate,
    removeTemplate,
  };
}

export function CheckpointPresetBar({ onApply, currentCheckpoints = [], testidPrefix = "preset-btn" }) {
  const { allPresets, addTemplate, removeTemplate } = useCheckpointTemplates();
  const [creating, setCreating] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplItems, setTplItems] = useState([""]);
  const [stageInput, setStageInput] = useState("");

  const openCreatorWithCurrent = () => {
    const existingTitles = (currentCheckpoints || [])
      .map((c) => (typeof c === "string" ? c : c?.title || "").trim())
      .filter(Boolean);
    setTplName("");
    setTplItems(existingTitles.length > 0 ? existingTitles : ["Tahap 1", "Tahap 2"]);
    setStageInput("");
    setCreating(true);
  };

  const addStageToDraft = () => {
    const val = stageInput.trim();
    if (!val) return;
    setTplItems((prev) => [...prev.filter((x) => x.trim()), val]);
    setStageInput("");
  };

  const handleSaveTemplate = async () => {
    const finalItems = [
      ...tplItems.map((x) => x.trim()).filter(Boolean),
      ...(stageInput.trim() ? [stageInput.trim()] : []),
    ];
    const created = await addTemplate(tplName, finalItems);
    if (created) {
      setCreating(false);
      setTplName("");
      setTplItems([""]);
      setStageInput("");
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-surface2/50 p-3 dark:border-slate-700" data-testid="checkpoint-preset-bar">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-sub">
          <Sparkles size={13} className="text-brand shrink-0" />
          <span>Tambah preset checkpoint instan:</span>
        </p>
        <div className="flex items-center gap-1.5">
          {currentCheckpoints.length > 0 && !creating && (
            <button
              type="button"
              onClick={openCreatorWithCurrent}
              className="inline-flex items-center gap-1 rounded-xl border border-brand/30 bg-brand/5 px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer"
              data-testid="save-current-as-template-btn"
            >
              <BookmarkPlus size={12} />
              <span>Simpan jadi Template</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (creating) {
                setCreating(false);
              } else {
                openCreatorWithCurrent();
              }
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-brand/30 bg-surface px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/5 transition-colors cursor-pointer shadow-2xs"
            data-testid="create-checkpoint-template-btn"
          >
            <Plus size={12} />
            <span>{creating ? "Tutup" : "Buat Template"}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 w-full min-w-0">
        {allPresets.map((p) => (
          <div
            key={p.id || p.label}
            className="inline-flex max-w-full items-center rounded-xl border border-slate-200 bg-surface hover:border-brand dark:border-slate-700 transition-colors shadow-2xs"
          >
            <button
              type="button"
              onClick={() => onApply(p.items)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold hover:text-brand transition-colors cursor-pointer"
              data-testid={`${testidPrefix}-${String(p.label).toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            >
              <span>{p.label}</span>
              <span className="text-[10px] text-sub font-normal">+{p.items.length} tahap</span>
            </button>
            {!p.builtin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTemplate(p.id);
                }}
                title="Hapus template"
                className="pr-2 pl-0.5 text-sub hover:text-rose-500 transition-colors cursor-pointer"
                data-testid={`delete-template-${p.id}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <div className="mt-3 space-y-2.5 rounded-xl border bg-surface p-3 shadow-xs" data-testid="checkpoint-template-builder">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ink">Buat Template Checkpoint Sendiri</span>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-sub hover:text-ink p-0.5 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder="Nama template, mis. 🚀 Kampanye Sosmed"
            className="h-8 w-full rounded-lg border bg-surface2 px-2.5 text-xs font-semibold text-ink outline-none focus:border-brand"
            data-testid="template-name-input"
          />
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
            {tplItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                  {idx + 1}
                </span>
                <input
                  value={item}
                  onChange={(e) =>
                    setTplItems((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))
                  }
                  placeholder={`Nama tahap ${idx + 1}…`}
                  className="h-7 flex-1 rounded-lg border bg-surface2 px-2 text-xs text-ink outline-none focus:border-brand"
                  data-testid={`template-stage-input-${idx}`}
                />
                {tplItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setTplItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-sub hover:text-rose-500 p-1 cursor-pointer"
                    title="Hapus tahap"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addStageToDraft();
                }
              }}
              placeholder="Ketik tahap baru lalu klik + Tahap…"
              className="h-8 flex-1 rounded-lg border bg-surface2 px-2.5 text-xs text-ink outline-none focus:border-brand"
              data-testid="template-new-stage-input"
            />
            <button
              type="button"
              onClick={() => {
                if (stageInput.trim()) addStageToDraft();
                else setTplItems((prev) => [...prev, ""]);
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border bg-surface2 px-2.5 text-xs font-semibold text-ink hover:bg-surface cursor-pointer"
              data-testid="template-add-stage-btn"
            >
              <Plus size={12} /> Tahap
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="h-8 rounded-lg border px-3 text-xs font-semibold text-sub hover:bg-surface2 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSaveTemplate}
              className="btn-accent h-8 rounded-lg px-3.5 text-xs font-semibold cursor-pointer"
              data-testid="template-save-btn"
            >
              Simpan Template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProgressBar({ value, small }) {
  const v = value ?? 0;
  const color = v === 100 ? "bg-emerald-500" : v >= 50 ? "bg-sky-500" : "bg-amber-500";
  return (
    <span className={`block w-full overflow-hidden rounded-full bg-surface2 ${small ? "h-1.5" : "h-2.5"}`}>
      <span
        className={`block h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${v}%` }}
      />
    </span>
  );
}

export function CommentItem({ c, t, reload, showCheckpoint }) {
  const { userMap } = useApp();
  const cp = showCheckpoint && c.checkpoint_id && (t.checkpoints || []).find((x) => x.id === c.checkpoint_id);
  const issue = c.kind === "issue";
  const toggle = () => api.patch(`/tasks/${t.id}/comments/${c.id}`, { resolved: !c.resolved }).then(reload).catch((e) => toast.error(errMsg(e)));
  return (
    <div className="mb-3 flex gap-2.5" data-testid={`comment-${c.id}`}>
      <Link to={`/people/${c.author_id}`} className="shrink-0 h-fit rounded-full">
        <Avatar user={userMap[c.author_id]} size={28} showStatus={false} />
      </Link>
      <div className={`min-w-0 flex-1 rounded-2xl px-3 py-2 ${issue && !c.resolved ? "border border-rose-300 bg-rose-50 dark:bg-rose-500/10" : "bg-surface2"}`}>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
          <Link to={`/people/${c.author_id}`} className="font-bold text-ink hover:underline">
            {userMap[c.author_id]?.name}
          </Link>
          <span className="text-sub">{rel(c.created_at)}</span>
          {cp && <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-sub">↳ {cp.title}</span>}
          {issue && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.resolved ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-rose-500 text-white"}`} data-testid={`comment-issue-badge-${c.id}`}>
              <AlertTriangle size={10} />{c.resolved ? "Kendala selesai" : "Kendala"}
            </span>
          )}
        </p>
        <p className="whitespace-pre-wrap text-sm"><MentionText text={c.text} mentionIds={c.mention_ids} /></p>
        {issue && (
          <button onClick={toggle} className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand hover:underline" data-testid={`comment-resolve-${c.id}`}>
            {c.resolved ? <><RotateCcw size={11} />Buka lagi</> : <><CheckCircle2 size={11} />Tandai selesai</>}
          </button>
        )}
      </div>
    </div>
  );
}

function Thread({ t, cp, reload }) {
  const { users, userMap, me } = useApp();
  const [text, setText] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [issue, setIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = (t.comments || []).filter((c) => c.checkpoint_id === cp.id);
  const send = async () => {
    if (!text.trim() || busy) return;
    const ids = extractCommentMentions(text, mentionIds, users);
    setBusy(true);
    try {
      await api.post(`/tasks/${t.id}/comments`, {
        text,
        checkpoint_id: cp.id,
        kind: issue ? "issue" : "update",
        mention_ids: ids,
      });
      const notifiedNames = ids
        .filter((uid) => uid !== me?.user_id)
        .map((uid) => userMap?.[uid]?.name)
        .filter(Boolean);
      if (notifiedNames.length > 0) {
        toast.success(`Komentar terkirim · Notifikasi dikirim ke ${notifiedNames.join(", ")}`);
      }
      setText("");
      setMentionIds([]);
      setIssue(false);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t bg-surface2/40 p-3" data-testid={`checkpoint-thread-${cp.id}`}>
      {list.map((c) => <CommentItem key={c.id} c={c} t={t} reload={reload} />)}
      {!list.length && <p className="mb-2 text-xs text-sub">Belum ada laporan untuk checkpoint ini.</p>}
      <CommentMentionInput
        value={text}
        onChange={setText}
        mentionIds={mentionIds}
        onMentionIdsChange={setMentionIds}
        onSubmit={send}
        placeholder={issue ? "Ceritakan kendalanya… ketik @Nama untuk tag rekan" : "Tulis progres atau diskusi… ketik @Nama untuk tag rekan"}
        testid={`checkpoint-comment-input-${cp.id}`}
        textareaClassName="min-h-[60px] w-full rounded-xl border bg-surface p-2.5 text-sm outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          onClick={() => setIssue(!issue)}
          className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${issue ? "border-rose-400 bg-rose-500 text-white" : "text-sub hover:text-ink"}`}
          data-testid={`checkpoint-issue-toggle-${cp.id}`}
        >
          <Flag size={12} />Laporkan kendala
        </button>
        <button
          onClick={send}
          disabled={busy || !text.trim()}
          className="btn-accent h-8 px-4 text-xs font-semibold disabled:opacity-40"
          data-testid={`checkpoint-comment-submit-${cp.id}`}
        >
          {busy ? "Mengirim…" : "Kirim"}
        </button>
      </div>
    </div>
  );
}

export default function Checkpoints({ t, ro, patch, reload, members, emptyMessage }) {
  const { userMap, me } = useApp();
  const defaultTaskPic = t.assignee_id || t.assignee_ids?.[0] || null;
  const rawCps = t.checkpoints || [];
  const cps = rawCps.map((c, i) => {
    if (typeof c === "string") return { id: `cp_${i}`, title: c, assignee_id: null, unassigned: false, deadline: "", done: false };
    return {
      id: c.id || `cp_${i}`,
      title: c.title || "",
      assignee_id: c.assignee_id || null,
      unassigned: !!c.unassigned,
      deadline: c.deadline || "",
      done: !!c.done,
      done_at: c.done_at,
      done_by: c.done_by,
      notified_ready_for: c.notified_ready_for || null
    };
  });

  const [title, setTitle] = useState("");
  const [pic, setPic] = useState(null);
  const [deadline, setDeadline] = useState("");
  const [open, setOpen] = useState(null);

  const save = (list, customToast) => {
    const doneTotal = list.filter((c) => c.done).length;
    const nextProgress = list.length > 0 ? Math.round((doneTotal / list.length) * 100) : (t.status === "done" ? 100 : 0);
    const taskHasAssignees = (Array.isArray(t.assignee_ids) && t.assignee_ids.length > 0) || Boolean(t.assignee_id);
    const cpPics = Array.from(new Set(list.map((c) => c?.assignee_id).filter(Boolean)));
    const payload = { checkpoints: list, progress: nextProgress };
    if (!taskHasAssignees && cpPics.length > 0) {
      payload.assignee_ids = cpPics;
      payload.assignee_id = cpPics[0];
    }
    patch(payload, customToast);
  };

  const edit = (id, ch) => {
    const prevActiveIdx = cps.findIndex((c) => !c.done);
    const nextList = cps.map((c) => (c.id === id ? { ...c, ...ch } : c));
    const nextActiveIdx = nextList.findIndex((c) => !c.done);
    const targetIdx = nextList.findIndex((c) => c.id === id);

    let notifToast = undefined;
    if (ch.done === true && nextActiveIdx !== -1 && nextActiveIdx !== prevActiveIdx) {
      const reachedCp = nextList[nextActiveIdx];
      if (reachedCp?.assignee_id) {
        const picName = userMap[reachedCp.assignee_id]?.name || "PIC";
        notifToast = `Notifikasi dikirim ke ${picName}: "Tugas "${t.title}" sudah siap dikerjakan, semangat ya!"`;
      }
    }
    if (ch.assignee_id && targetIdx === nextActiveIdx && !nextList[targetIdx]?.done) {
      const picName = userMap[ch.assignee_id]?.name || "PIC";
      notifToast = `Notifikasi dikirim ke ${picName}: "Tugas "${t.title}" sudah siap dikerjakan, semangat ya!"`;
    }

    save(nextList, notifToast);
  };

  const [pingingId, setPingingId] = useState(null);
  const pingPic = async (cp) => {
    if (!cp?.assignee_id || pingingId === cp.id) return;
    setPingingId(cp.id);
    try {
      await api.post(`/tasks/${t.id}/checkpoints/${cp.id}/notify`);
      const picName = userMap[cp.assignee_id]?.name || "PIC";
      toast.success(`Notifikasi dikirim ke ${picName}: "Tugas "${t.title}" sudah siap dikerjakan, semangat ya!"`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal mengirim notifikasi"));
    } finally {
      setPingingId(null);
    }
  };

  const add = () => {
    if (!title.trim()) return;
    const isFirstUncompleted = cps.every((c) => c.done);
    const effectivePic = pic || defaultTaskPic || null;
    const newCp = {
      id: `cp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      assignee_id: effectivePic,
      unassigned: false,
      deadline: deadline || "",
      done: false
    };
    const notifToast =
      isFirstUncompleted && effectivePic
        ? `Notifikasi dikirim ke ${userMap[effectivePic]?.name || "PIC"}: "Tugas "${t.title}" sudah siap dikerjakan, semangat ya!"`
        : undefined;
    save([...cps, newCp], notifToast);
    setTitle("");
    setPic(null);
    setDeadline("");
  };

  const applyPreset = (items) => {
    const newItems = items.map((itemTitle, idx) => ({
      id: `cp_preset_${Date.now()}_${idx}`,
      title: itemTitle,
      assignee_id: defaultTaskPic || null,
      unassigned: false,
      deadline: "",
      done: false
    }));
    save([...cps, ...newItems]);
  };

  const doneCount = cps.filter((c) => c.done).length;
  const activeIdx = cps.findIndex((c) => !c.done);
  const approvalCount = (t.approvals?.approved_by || t.approval?.approved_by || []).length;
  const approvalPct = t.status === "done" || approvalCount >= 2 ? 100 : approvalCount === 1 ? 50 : 0;
  const computedProgress = cps.length > 0 ? Math.round((doneCount / cps.length) * 100) : Math.max(t.progress ?? 0, approvalPct);

  return (
    <section className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-surface p-4 dark:border-slate-800" data-testid="task-checkpoints">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-brand" />
          <h4 className="text-sm font-bold">Checkpoints</h4>
        </div>
        <div className="flex items-center gap-2" data-testid="task-progress-label">
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand whitespace-nowrap shrink-0">
            {computedProgress}% Selesai
          </span>
          <span className="text-xs font-semibold text-sub whitespace-nowrap shrink-0">
            {doneCount}/{cps.length} Tahap
          </span>
        </div>
      </div>

      <ProgressBar value={computedProgress} />

      {/* Preset & Custom Template bar */}
      {!ro && (
        <div className="mt-3">
          <CheckpointPresetBar
            onApply={applyPreset}
            currentCheckpoints={cps}
            testidPrefix="preset-detail-btn"
          />
        </div>
      )}

      {/* List of Checkpoints — 1 clean line per checkpoint */}
      <div className="mt-3 space-y-1.5">
        {cps.map((c, i) => {
          const cm = (t.comments || []).filter((x) => x.checkpoint_id === c.id);
          const issues = cm.filter((x) => x.kind === "issue" && !x.resolved).length;
          const isCurrentTurn = !c.done && i === activeIdx;
          const effectivePicId = c.assignee_id || (!c.unassigned ? defaultTaskPic : null);
          const picUser = effectivePicId ? userMap[effectivePicId] : null;
          const isCpOverdue = !c.done && c.deadline && new Date(`${String(c.deadline).slice(0, 10)}T23:59:59`) < new Date();
          const doneTitle = c.done && c.done_at
            ? `Selesai ${rel(c.done_at)}${c.done_by && userMap[c.done_by] ? ` oleh ${userMap[c.done_by].name}` : ""}`
            : "Tandai selesai";

          return (
            <div
              key={c.id}
              className={`overflow-hidden rounded-xl border transition-all ${
                c.done
                  ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                  : issues
                  ? "border-rose-300 bg-rose-50/40 dark:border-rose-900/50 dark:bg-rose-950/20"
                  : isCurrentTurn
                  ? "border-sky-300 bg-sky-50/35 dark:border-sky-800/70 dark:bg-sky-950/20"
                  : "border-slate-200 bg-surface dark:border-slate-800"
              }`}
              data-testid={`checkpoint-${c.id}`}
            >
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 px-2.5 py-1.5 min-w-0">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-[10px] ${
                    c.done
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                      : isCurrentTurn
                      ? "bg-sky-500 text-white"
                      : "bg-surface2 text-sub"
                  }`}
                  title={isCurrentTurn ? "Tahap aktif saat ini" : `Tahap ${i + 1}`}
                >
                  {i + 1}
                </span>

                <button
                  type="button"
                  disabled={ro}
                  onClick={() => {
                    const isNowDone = !c.done;
                    if (isNowDone) playSound("task_done");
                    else playSound("click");
                    edit(c.id, {
                      done: isNowDone,
                      done_at: isNowDone ? new Date().toISOString() : null,
                      done_by: isNowDone ? me?.user_id : null
                    });
                  }}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all cursor-pointer ${
                    c.done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrentTurn
                      ? "border-sky-400 bg-surface hover:border-emerald-500 hover:bg-emerald-50 dark:border-sky-600"
                      : "border-slate-300 bg-surface hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-700"
                  }`}
                  title={doneTitle}
                  aria-label="Conteng selesai checkpoint"
                  data-testid={`checkpoint-done-${c.id}`}
                >
                  {c.done ? (
                    <CheckCircle2 size={13} className="stroke-[2.5]" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${isCurrentTurn ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                  )}
                </button>

                <input
                  defaultValue={c.title}
                  key={c.title}
                  disabled={ro}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== c.title && edit(c.id, { title: e.target.value })}
                  className={`min-w-0 w-full flex-1 bg-transparent text-xs sm:text-[13px] font-semibold outline-none truncate ${
                    c.done ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-800 dark:text-slate-100"
                  }`}
                  data-testid={`checkpoint-title-${c.id}`}
                />

                {/* Checkpoint Deadline */}
                <DatePicker
                  compact
                  value={c.deadline ? String(c.deadline).slice(0, 10) : ""}
                  disabled={ro}
                  onChange={(val) => edit(c.id, { deadline: val || "" })}
                  placeholder="Deadline"
                  title="Deadline checkpoint"
                  className={`h-7 w-[104px] shrink-0 rounded-lg border px-2 text-[11px] font-medium ${
                    isCpOverdue
                      ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
                      : "bg-surface2 text-ink"
                  }`}
                  data-testid={`checkpoint-deadline-${c.id}`}
                />

                {/* Checkpoint PIC */}
                <div className="w-[106px] sm:w-[116px] shrink-0">
                  {ro ? (
                    <span className="text-[11px] text-sub truncate block">{picUser?.name || "Tanpa PIC"}</span>
                  ) : (
                    <UserSelect
                      value={effectivePicId}
                      ids={members}
                      emptyMessage={emptyMessage}
                      onChange={(v) => edit(c.id, { assignee_id: v, unassigned: !v })}
                      placeholder="PIC"
                      className="h-7 w-full rounded-lg border bg-surface2 pl-2 pr-5 text-[11px] font-semibold outline-none truncate"
                      testid={`checkpoint-pic-${c.id}`}
                    />
                  )}
                </div>

                {isCurrentTurn && picUser && !ro && (
                  <button
                    type="button"
                    onClick={() => pingPic(c)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 transition-colors cursor-pointer"
                    title={`Kirim notif siap kerja ke ${picUser.name}`}
                    data-testid={`checkpoint-notify-${c.id}`}
                  >
                    <Bell size={12} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  className={`flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                    open === c.id ? "bg-ink text-[var(--c-surface)]" : "bg-surface text-sub hover:bg-surface2"
                  }`}
                  title="Komentar & kendala checkpoint"
                  data-testid={`checkpoint-discuss-${c.id}`}
                >
                  <MessageSquare size={11} />
                  {cm.length}
                  {issues > 0 && (
                    <span className="flex items-center gap-0.5 text-rose-500 font-bold">
                      <AlertTriangle size={11} />
                      {issues}
                    </span>
                  )}
                </button>

                {!ro && (
                  <button
                    type="button"
                    onClick={() => save(cps.filter((x) => x.id !== c.id))}
                    className="flex h-7 w-6 shrink-0 items-center justify-center rounded-lg text-sub hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                    aria-label="Hapus checkpoint"
                    title="Hapus checkpoint"
                    data-testid={`checkpoint-remove-${c.id}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {open === c.id && <Thread t={t} cp={c} reload={reload} />}
            </div>
          );
        })}
      </div>

      {/* Add new checkpoint — clean 1-line row */}
      {!ro && (
        <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center gap-1.5 min-w-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="Tambah checkpoint baru…"
            className="h-9 min-w-0 w-full flex-1 basis-full sm:basis-0 rounded-xl border bg-surface2 px-3 text-xs outline-none focus:ring-1 focus:ring-brand"
            data-testid="checkpoint-new-title"
          />
          <DatePicker
            compact
            value={deadline}
            onChange={setDeadline}
            placeholder="Deadline"
            title="Deadline checkpoint"
            className="h-9 flex-1 sm:flex-initial sm:w-[108px] shrink-0 rounded-xl border bg-surface2 px-2.5 text-[11px] font-medium"
            data-testid="checkpoint-new-deadline"
          />
          <div className="flex-1 sm:flex-initial sm:w-[112px] shrink-0">
            <UserSelect
              value={pic}
              ids={members}
              emptyMessage={emptyMessage}
              onChange={setPic}
              placeholder="PIC"
              className="h-9 w-full rounded-xl border bg-surface2 pl-2.5 pr-5 text-xs font-semibold outline-none truncate"
              testid="checkpoint-new-pic"
            />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!title.trim()}
            className="btn-accent flex h-9 items-center gap-1 px-3 text-xs font-semibold disabled:opacity-40 shrink-0 cursor-pointer"
            data-testid="checkpoint-add-btn"
          >
            <Plus size={14} />
            Tambah
          </button>
        </div>
      )}
    </section>
  );
}


