import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Newspaper,
  MessageCircle,
  SmilePlus,
  ImagePlus,
  X,
  Trash2,
  ArrowLeft,
  BarChart3,
  TrendingUp,
  Hash,
  Pencil,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Loader2,
  Plus,
  Pin,
  Sparkles,
  Search
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, uploadFile } from "../lib/api";
import { Avatar, PageHeader, rel, ImageLightbox, VerifiedBadge, buildMentionMatcher } from "../components/common";
import PollCard from "./chat/PollCard";
import CreatePollDialog from "./chat/CreatePollDialog";
import {
  getPostsCache,
  setPostsCache,
  getTrendingCache,
  setTrendingCache,
  hydratePostsCache,
  seedPollCache,
} from "../lib/workspaceCaches";

export { hydratePostsCache };

const EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];

export const DEFAULT_WORKSPACE_TOPICS = [];

const DEFAULT_PINNED_TOPICS = [];

function loadPinnedTopics(uid) {
  try {
    const key = `circle_user_pinned_topics_${uid || "default"}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return DEFAULT_PINNED_TOPICS;
}

function savePinnedTopics(uid, list) {
  try {
    const key = `circle_user_pinned_topics_${uid || "default"}`;
    localStorage.setItem(key, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("circle:pinned-topics-changed", { detail: list }));
  } catch {}
}

export function postMatchesTopic(p, rawFilter) {
  if (!rawFilter) return true;
  if (!p) return false;
  const qRaw = String(rawFilter).replace(/^#+/, "").trim().toLowerCase();
  if (!qRaw) return true;
  const qCompact = qRaw.replace(/\s+/g, "");
  const postTopic = String(p.topic || "").replace(/^#+/, "").trim().toLowerCase();
  if (postTopic && (postTopic === qRaw || postTopic.replace(/\s+/g, "") === qCompact)) {
    return true;
  }
  const txt = String(p.text || "").toLowerCase();
  return txt.includes(`#${qRaw}`) || (qCompact.length > 0 && txt.includes(`#${qCompact}`));
}

function RichText({ text, mentionIds }) {
  const { userMap } = useApp();
  const { pattern: mentionPattern, resolve } = buildMentionMatcher(userMap, mentionIds);
  const tag = "(?<![\\p{L}\\p{N}_#])#[\\p{L}\\p{N}_]{1,40}";
  const urlPattern = "https?://[^\\s]+";
  const rx = new RegExp(mentionPattern ? `(${mentionPattern}|${tag}|${urlPattern})` : `(${tag}|${urlPattern})`, "giu");
  return String(text || "").split(rx).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("#")) return <Link key={i} to={`/beranda?tag=${encodeURIComponent(part.slice(1).toLowerCase())}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-sky-600 hover:underline dark:text-sky-400" data-testid={`hashtag-${part.slice(1).toLowerCase()}`}>{part}</Link>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand underline hover:opacity-80 break-all">{part}</a>;
    if (part.startsWith("@")) {
      const mentionedUser = resolve(part);
      if (mentionedUser?.user_id) {
        return (
          <Link
            key={i}
            to={`/people/${mentionedUser.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-brand hover:underline cursor-pointer"
            title={`Lihat profil ${mentionedUser.name}`}
            data-testid={`mention-link-${mentionedUser.user_id}`}
          >
            {part}
          </Link>
        );
      }
      return <span key={i} className="font-semibold text-brand">{part}</span>;
    }
    return part;
  });
}

function TopicPickerPopover({ value, onSelect, onClose, trendingItems = [] }) {
  const { t } = useApp();
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const cleanedQuery = query.replace(/^#+/, "").trim().slice(0, 50);

  const mergedTopics = useMemo(() => {
    const map = new Map();
    (trendingItems || []).forEach((item) => {
      const label = String(item.label || item.tag || "").replace(/^#+/, "").trim();
      if (!label) return;
      const key = label.toLowerCase();
      map.set(key, {
        label,
        count: item.count || 0,
        is_topic: Boolean(item.is_topic),
        desc: item.is_topic ? "Topik aktif di Beranda" : "Tagar aktif di Beranda"
      });
    });
    DEFAULT_WORKSPACE_TOPICS.forEach((wt) => {
      const key = wt.label.toLowerCase();
      if (map.has(key)) {
        const existing = map.get(key);
        map.set(key, { ...existing, label: wt.label, desc: wt.desc, is_topic: true });
      } else {
        map.set(key, { label: wt.label, count: 0, is_topic: true, desc: wt.desc });
      }
    });
    return Array.from(map.values());
  }, [trendingItems]);

  const filteredTopics = useMemo(() => {
    if (!cleanedQuery) return mergedTopics;
    const q = cleanedQuery.toLowerCase();
    return mergedTopics.filter(
      (item) => item.label.toLowerCase().includes(q) || (item.desc || "").toLowerCase().includes(q)
    );
  }, [mergedTopics, cleanedQuery]);

  const exactMatchExists = useMemo(() => {
    if (!cleanedQuery) return true;
    return mergedTopics.some((item) => item.label.toLowerCase() === cleanedQuery.toLowerCase());
  }, [mergedTopics, cleanedQuery]);

  return (
    <div
      ref={popRef}
      className="absolute left-0 top-full mt-1.5 z-30 w-72 sm:w-80 rounded-2xl border bg-surface p-2.5 shadow-xl animate-in fade-in zoom-in-95 duration-150"
      data-testid="topic-picker-popover"
    >
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-sub pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          maxLength={50}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && cleanedQuery) {
              e.preventDefault();
              onSelect(cleanedQuery);
              onClose?.();
            } else if (e.key === "Escape") {
              onClose?.();
            }
          }}
          placeholder={t("beranda_topic_placeholder", "Cari atau tulis topik baru…")}
          className="h-9 w-full rounded-xl border bg-surface2/80 pl-8 pr-7 text-xs text-ink outline-none focus:border-brand"
          data-testid="topic-picker-input"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 text-sub hover:text-ink"
            aria-label="Bersihkan"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="mt-2 max-h-60 overflow-y-auto space-y-1 pr-0.5">
        {value && (
          <button
            type="button"
            onClick={() => {
              onSelect("");
              onClose?.();
            }}
            className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            data-testid="topic-picker-clear"
          >
            <span>Hapus topik "{value}"</span>
            <X size={13} />
          </button>
        )}

        {cleanedQuery && !exactMatchExists && (
          <button
            type="button"
            onClick={() => {
              onSelect(cleanedQuery);
              onClose?.();
            }}
            className="flex w-full items-center gap-2.5 rounded-xl bg-brand/10 hover:bg-brand/15 px-2.5 py-2 text-left transition-colors"
            data-testid="topic-picker-create-custom"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
              <Plus size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-brand">
                {t("beranda_topic_create_prefix", "Buat topik baru")} "{cleanedQuery}"
              </p>
              <p className="text-[11px] text-sub">Tekan Enter atau klik untuk menyematkan topik ini</p>
            </div>
          </button>
        )}

        {filteredTopics.length > 0 ? (
          <>
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-sub/80 flex items-center gap-1">
              <Sparkles size={11} className="text-brand" />
              <span>{t("beranda_topic_recommended", "Topik yang Dibuat Pengguna")}</span>
            </div>

            {filteredTopics.map((item) => {
              const isSelected = value && value.toLowerCase() === item.label.toLowerCase();
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    onSelect(item.label);
                    onClose?.();
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    isSelected ? "bg-brand/10 text-brand" : "hover:bg-surface2 text-ink"
                  }`}
                  data-testid={`topic-option-${item.label}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">{item.label}</span>
                      {item.count > 0 && (
                        <span className="shrink-0 rounded-full bg-surface2 px-1.5 py-0.2 text-[10px] font-medium text-sub">
                          {item.count} utas
                        </span>
                      )}
                    </div>
                    {item.desc && <p className="truncate text-[11px] text-sub">{item.desc}</p>}
                  </div>
                  {isSelected && <Check size={14} className="text-brand shrink-0" />}
                </button>
              );
            })}
          </>
        ) : (
          !cleanedQuery && (
            <div className="px-3 py-4 text-center" data-testid="topic-picker-empty">
              <p className="text-xs font-semibold text-ink">Belum ada pilihan topik</p>
              <p className="mt-0.5 text-[11px] text-sub leading-relaxed">
                Ketik nama topik di kolom atas lalu tekan <b>Enter</b> untuk membuat topik baru.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Composer({ parentId, onPosted, placeholder, compact = false, defaultTopic = "" }) {
  const { me, users, userMap, t } = useApp();
  const [text, setText] = useState("");
  const [topic, setTopic] = useState(defaultTopic ? String(defaultTopic).replace(/^#+/, "").trim() : "");
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [mq, setMq] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!parentId) {
      setTopic(defaultTopic ? String(defaultTopic).replace(/^#+/, "").trim() : "");
    }
  }, [defaultTopic, parentId]);

  const sugg = mq === null ? [] : (users || []).filter((u) => u.user_id !== me?.user_id && (u.name || "").toLowerCase().includes(mq)).slice(0, 6);
  const onChange = (e) => {
    setText(e.target.value);
    const m = e.target.value.slice(0, e.target.selectionStart).match(/@([\w]*)$/);
    setMq(m ? m[1].toLowerCase() : null);
  };
  const pick = (u) => {
    const pos = ta.current.selectionStart;
    setText(text.slice(0, pos).replace(/@[\w]*$/, `@${u.name} `) + text.slice(pos));
    setMentions([...mentions, u.user_id]);
    setMq(null);
    ta.current.focus();
  };
  const addFiles = async (list) => {
    for (const f of Array.from(list).slice(0, 6 - files.length)) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} bukan gambar`);
        continue;
      }
      try {
        const up = await uploadFile(f);
        setFiles((x) => [...x, up]);
      } catch (er) {
        toast.error(errMsg(er));
      }
    }
  };

  // Detect first inline hashtag in text if user hasn't picked a header topic yet
  const detectedInlineHashtag = useMemo(() => {
    if (parentId || topic) return null;
    const match = text.match(/#([\p{L}\p{N}_]{2,35})/u);
    return match ? match[1] : null;
  }, [text, topic, parentId]);

  const submit = async (poll) => {
    if (busy || (!poll && !text.trim() && !files.length)) return;
    setBusy(true);
    const currentText = text;
    const currentTopic = !parentId && topic ? topic.replace(/^#+/, "").trim().slice(0, 50) : null;
    const currentFiles = [...files];
    const currentMentions = [...mentions];
    const tempId = `pst_opt_${Date.now()}`;
    let optimisticPoll = null;
    if (poll && poll.question) {
      const opts = (poll.options || [])
        .filter((x) => String(x || "").trim())
        .map((opt, idx) => (typeof opt === "string" ? { id: `opt_${idx + 1}`, text: opt } : opt));
      optimisticPoll = {
        id: `poll_opt_${Date.now()}`,
        question: poll.question,
        multiple: !!poll.multiple,
        anonymous: !!poll.anonymous,
        allow_change: poll.allow_change !== false,
        expires_at: poll.expires_at || null,
        status: "open",
        options: opts,
        counts: Object.fromEntries(opts.map((o) => [o.id, 0])),
        voters: Object.fromEntries(opts.map((o) => [o.id, []])),
        my_vote: [],
        total_votes: 0
      };
      seedPollCache(optimisticPoll);
    }
    const optimisticPost = {
      id: tempId,
      author_id: me?.user_id || "user_admin1",
      topic: currentTopic,
      text: currentText,
      poll_id: optimisticPoll?.id || poll?.id || null,
      poll: optimisticPoll || null,
      parent_id: parentId || null,
      attachments: currentFiles.map((f) => ({ id: f.id, name: f.name })),
      mention_ids: currentMentions.filter((m) => currentText.includes(`@${userMap[m]?.name}`)),
      likes: [],
      like_count: 0,
      liked: false,
      reactions: {},
      reply_count: 0,
      replies_preview: [],
      created_at: new Date().toISOString()
    };

    // Optimistically update UI immediately (0ms delay)
    setText("");
    if (!defaultTopic) setTopic("");
    setFiles([]);
    setMentions([]);
    onPosted?.(optimisticPost);

    try {
      const { data } = await api.post("/posts", {
        text: currentText,
        topic: currentTopic,
        poll: poll || undefined,
        parent_id: parentId || null,
        attachments: currentFiles.map((f) => ({ id: f.id })),
        mention_ids: currentMentions.filter((m) => currentText.includes(`@${userMap[m]?.name}`))
      });
      if (data) {
        if (data.poll) seedPollCache(data.poll);
        onPosted?.(data, tempId);
      }
    } catch (er) {
      toast.error(errMsg(er));
    } finally {
      setBusy(false);
    }
  };
  const send = () => submit().catch((er) => toast.error(errMsg(er)));
  const ta = useRef(null);
  const activePlaceholder = placeholder || (parentId ? t("beranda_reply_btn") : t("beranda_composer_placeholder"));
  return (
    <div
      className={compact ? "relative rounded-2xl border bg-surface p-3 shadow-xs" : "card relative p-4"}
      data-testid={parentId ? "reply-composer" : "post-composer"}
    >
      <div className="flex gap-2.5 sm:gap-3">
        <Avatar user={me} size={compact ? 32 : 38} showStatus={false} />
        <div className="min-w-0 flex-1">
          {/* Threads-style Author › Topic Header */}
          {!parentId && (
            <div className="relative mb-1.5 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="font-bold text-ink leading-snug">{me?.name || "Anda"}</span>
              <ChevronRight size={14} className="text-sub/70 shrink-0" />
              {topic ? (
                <div className="inline-flex items-center gap-1 rounded-full bg-brand/10 dark:bg-brand/20 pl-2.5 pr-1.5 py-0.5 text-xs font-semibold text-brand">
                  <button
                    type="button"
                    onClick={() => setTopicPickerOpen((v) => !v)}
                    className="hover:underline cursor-pointer"
                    data-testid="composer-active-topic-btn"
                  >
                    {topic}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopic("")}
                    className="rounded-full p-0.5 hover:bg-brand/20 text-brand cursor-pointer"
                    title="Hapus topik"
                    data-testid="composer-clear-topic-btn"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setTopicPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-sub hover:bg-surface2 hover:text-brand transition-colors cursor-pointer"
                  data-testid="composer-add-topic-trigger"
                >
                  <span>{t("beranda_add_topic", "Tambahkan topik")}</span>
                </button>
              )}

              {topicPickerOpen && (
                <TopicPickerPopover
                  value={topic}
                  onSelect={(nextTopic) => setTopic(nextTopic)}
                  onClose={() => setTopicPickerOpen(false)}
                  trendingItems={getTrendingCache()}
                />
              )}
            </div>
          )}

          <textarea
            ref={ta}
            value={text}
            onChange={onChange}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
            rows={parentId ? 2 : 3}
            placeholder={activePlaceholder}
            className={`w-full resize-none bg-transparent outline-none placeholder:text-sub ${compact ? "text-[14px]" : "text-[15px]"}`}
            data-testid="post-text-input"
          />

          {detectedInlineHashtag && !topic && (
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTopic(detectedInlineHashtag)}
                className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-2.5 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer"
                data-testid="composer-promote-hashtag-topic"
              >
                <Hash size={11} />
                <span>Sematkan "{detectedInlineHashtag}" sebagai Topik Utas</span>
              </button>
            </div>
          )}

          {sugg.length > 0 && (
            <div className="absolute left-14 z-20 w-64 rounded-xl border bg-surface p-1 shadow-lg" data-testid="post-mention-suggestions">
              {sugg.map((u) => (
                <button
                  key={u.user_id}
                  onClick={() => pick(u)}
                  className="flex w-full items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-surface2"
                  data-testid={`post-mention-${u.user_id}`}
                >
                  <Avatar user={u} size={22} showStatus={false} />{u.name}
                </button>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {files.map((f) => (
                <div key={f.id} className="relative">
                  <img src={fileUrl(f.id)} alt={f.name} className={`${compact ? "h-16 w-16" : "h-20 w-20"} rounded-xl object-cover`} />
                  <button
                    onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-[var(--c-surface)]"
                    aria-label="Hapus foto"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`btn-ghost flex items-center gap-1.5 px-2 text-sub ${compact ? "h-8 text-xs font-semibold" : "h-9 text-sm"}`}
                data-testid="post-add-photo-btn"
              >
                <ImagePlus size={compact ? 15 : 17} />Foto
              </button>
              {!parentId && (
                <>
                  <button
                    type="button"
                    onClick={() => setPollOpen(true)}
                    className="btn-ghost flex h-9 items-center gap-1.5 px-2 text-sm text-sub"
                    data-testid="post-add-poll-btn"
                  >
                    <BarChart3 size={17} />Polling
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopicPickerOpen((v) => !v)}
                    className={`btn-ghost flex h-9 items-center gap-1.5 px-2 text-sm ${
                      topic ? "text-brand font-semibold" : "text-sub"
                    }`}
                    data-testid="post-add-topic-btn"
                  >
                    <Hash size={16} />
                    <span>{topic ? topic : "Topik"}</span>
                  </button>
                </>
              )}
            </div>
            {!parentId && (
              <CreatePollDialog
                open={pollOpen}
                onOpenChange={setPollOpen}
                onSubmitPoll={(poll) => submit(poll).then(() => toast.success("Polling diposting"))}
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              data-testid="post-photo-input"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || (!text.trim() && !files.length)}
              className={`btn-accent rounded-full font-semibold disabled:opacity-40 ${compact ? "h-8 px-4 text-xs" : "h-9 px-5 text-sm"}`}
              data-testid="post-submit-btn"
            >
              {parentId ? t("beranda_reply_btn", "Balas") : t("beranda_post_btn", "Posting")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReactionPicker({ p, onChange }) {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTimer();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setOpen(false);
    }, 250);
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const react = (emoji) => {
    setOpen(false);
    clearTimer();
    // 100% Optimistic reaction toggle (0ms latency)
    const currentList = p.reactions?.[emoji] || [];
    const uid = me?.user_id;
    const hasReacted = uid ? currentList.includes(uid) : false;
    const nextList = uid ? (hasReacted ? currentList.filter((id) => id !== uid) : [...currentList, uid]) : currentList;
    const nextReactions = { ...(p.reactions || {}) };
    if (nextList.length) {
      nextReactions[emoji] = nextList;
    } else {
      delete nextReactions[emoji];
    }
    const nextP = { ...p, reactions: nextReactions };
    onChange(nextP);

    if (String(p.id).startsWith("pst_opt_")) return;
    api.post(`/posts/${p.id}/react`, { emoji }).then((r) => {
      if (r.data) onChange(r.data);
    }).catch((e) => {
      onChange(p);
      toast.error(errMsg(e));
    });
  };

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-sub hover:bg-surface2/60 hover:text-ink transition-colors"
        aria-label="Beri reaksi"
        data-testid={`post-react-btn-${p.id}`}
      >
        <SmilePlus size={16} />
        <span className="font-medium">Reaksi</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Pilihan reaksi emoji"
          className="absolute bottom-full left-0 mb-1.5 z-30 flex items-center gap-1 rounded-full border border-subtle bg-surface/95 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {EMOJIS.map((e) => {
            const isSelected = Boolean(me?.user_id && (p.reactions?.[e] || []).includes(me.user_id));
            return (
              <button
                key={e}
                type="button"
                onClick={() => react(e)}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform duration-150 hover:scale-125 hover:bg-surface2 active:scale-95 ${
                  isSelected ? "bg-accent/15 scale-110" : ""
                }`}
                title={`Reaksi ${e}`}
                data-testid={`post-react-option-${e}`}
              >
                {e}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReactionBadges({ p, onChange }) {
  const { me } = useApp();
  const react = (emoji) => {
    const currentList = p.reactions?.[emoji] || [];
    const uid = me?.user_id;
    const hasReacted = uid ? currentList.includes(uid) : false;
    const nextList = uid ? (hasReacted ? currentList.filter((id) => id !== uid) : [...currentList, uid]) : currentList;
    const nextReactions = { ...(p.reactions || {}) };
    if (nextList.length) {
      nextReactions[emoji] = nextList;
    } else {
      delete nextReactions[emoji];
    }
    const nextP = { ...p, reactions: nextReactions };
    onChange(nextP);

    if (String(p.id).startsWith("pst_opt_")) return;
    api.post(`/posts/${p.id}/react`, { emoji }).then((r) => {
      if (r.data) onChange(r.data);
    }).catch((e) => {
      onChange(p);
      toast.error(errMsg(e));
    });
  };

  const list = Object.entries(p.reactions || {}).filter(([, ids]) => ids.length);
  if (!list.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map(([e, ids]) => (
        <button
          key={e}
          type="button"
          onClick={() => react(e)}
          className={`flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
            me?.user_id && ids.includes(me.user_id) ? "border-[var(--c-accent)] tint-accent" : "text-sub hover:bg-surface2/60"
          }`}
          data-testid={`post-reaction-${p.id}-${e}`}
        >
          <span>{e}</span>
          <span>{ids.length}</span>
        </button>
      ))}
    </div>
  );
}

function PostCard({ p, onChange, onDelete, reply }) {
  const { me, userMap, isAdmin, t } = useApp();
  const author = userMap[p.author_id];
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(p.text || "");
  const [editTopic, setEditTopic] = useState(p.topic || "");
  const [editTopicPickerOpen, setEditTopicPickerOpen] = useState(false);
  const [editFiles, setEditFiles] = useState(p.attachments || []);
  const [savingEdit, setSavingEdit] = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);
  const editFileRef = useRef(null);

  // Inline comment dropdown state
  const [showComments, setShowComments] = useState(false);
  const [replies, setReplies] = useState(p.replies_preview || []);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [hasLoadedFull, setHasLoadedFull] = useState(false);

  useEffect(() => {
    if (!editing) {
      setEditText(p.text || "");
      setEditTopic(p.topic || "");
      setEditFiles(p.attachments || []);
    }
  }, [p.text, p.topic, p.attachments, editing]);

  useEffect(() => {
    if (!hasLoadedFull && Array.isArray(p.replies_preview)) {
      setReplies((prev) => {
        if (!prev.length) return p.replies_preview;
        const prevIds = new Set(prev.map((r) => r.id));
        const missing = p.replies_preview.filter((r) => !prevIds.has(r.id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    }
  }, [p.replies_preview, hasLoadedFull]);

  const toggleComments = async (e) => {
    e?.stopPropagation?.();
    const nextState = !showComments;
    setShowComments(nextState);

    if (nextState && !hasLoadedFull && !String(p.id).startsWith("pst_opt_")) {
      setLoadingReplies(true);
      try {
        const { data } = await api.get(`/posts/${p.id}`);
        if (data && Array.isArray(data.replies)) {
          setReplies(data.replies);
          setHasLoadedFull(true);
        }
      } catch (err) {
        setReplies(p.replies_preview || []);
      } finally {
        setLoadingReplies(false);
      }
    }
  };

  const handleReplyPosted = useCallback((newReply, replaceId) => {
    setReplies((prevReplies) => {
      let nextReplies;
      if (replaceId) {
        const idx = prevReplies.findIndex((r) => r.id === replaceId || r.id === newReply.id);
        if (idx !== -1) {
          nextReplies = prevReplies.map((r, i) => (i === idx ? newReply : r));
        } else {
          nextReplies = [...prevReplies.filter((r) => r.id !== newReply.id && r.id !== replaceId), newReply];
        }
      } else {
        const exists = prevReplies.some((r) => r.id === newReply.id);
        nextReplies = exists
          ? prevReplies.map((r) => (r.id === newReply.id ? newReply : r))
          : [...prevReplies.filter((r) => r.id !== newReply.id), newReply];
      }

      if (!reply && onChange) {
        const nextCount = Math.max(p.reply_count || 0, nextReplies.length);
        const nextPreview = nextReplies.slice(-3);
        setTimeout(() => {
          onChange({
            ...p,
            reply_count: nextCount,
            replies_preview: nextPreview,
          });
        }, 0);
      }

      return nextReplies;
    });
    setHasLoadedFull(true);
  }, [reply, onChange, p]);

  const handleReplyChange = useCallback((updatedReply) => {
    setReplies((prev) => {
      const nextReplies = prev.map((r) => (r.id === updatedReply.id ? { ...r, ...updatedReply } : r));
      if (!reply && onChange) {
        setTimeout(() => {
          onChange({
            ...p,
            replies_preview: nextReplies.slice(-3),
          });
        }, 0);
      }
      return nextReplies;
    });
  }, [reply, onChange, p]);

  const handleReplyDelete = useCallback((deletedId) => {
    setReplies((prev) => {
      const nextReplies = prev.filter((r) => r.id !== deletedId);
      if (!reply && onChange) {
        setTimeout(() => {
          onChange({
            ...p,
            reply_count: Math.max(0, (p.reply_count || 1) - 1),
            replies_preview: nextReplies.slice(-3),
          });
        }, 0);
      }
      return nextReplies;
    });
  }, [reply, onChange, p]);

  const del = (e) => {
    e?.stopPropagation?.();
    onDelete(p.id);
    toast.success("Postingan dihapus");
    if (!String(p.id).startsWith("pst_opt_")) {
      api.delete(`/posts/${p.id}`).catch((err) => toast.error(errMsg(err)));
    }
  };

  const startEdit = (e) => {
    e?.stopPropagation?.();
    setEditText(p.text || "");
    setEditTopic(p.topic || "");
    setEditFiles(p.attachments || []);
    setEditing(true);
  };

  const addEditFiles = async (list) => {
    for (const f of Array.from(list).slice(0, 6 - editFiles.length)) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} bukan gambar`);
        continue;
      }
      try {
        const up = await uploadFile(f);
        setEditFiles((prev) => [...prev, up]);
      } catch (er) {
        toast.error(errMsg(er));
      }
    }
  };

  const saveEdit = async () => {
    if (!editText.trim() && editFiles.length === 0 && !p.poll_id && !p.poll) {
      toast.error("Postingan tidak boleh kosong");
      return;
    }
    const cleanedTopic = !reply && editTopic ? editTopic.replace(/^#+/, "").trim().slice(0, 50) : null;
    const prevPost = p;
    const nextPost = {
      ...p,
      text: editText,
      topic: cleanedTopic,
      attachments: editFiles,
      edited: true,
      updated_at: new Date().toISOString()
    };
    onChange(nextPost);
    setEditing(false);
    toast.success("Postingan berhasil diperbarui");

    if (String(p.id).startsWith("pst_opt_")) return;
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/posts/${p.id}`, {
        text: editText,
        topic: cleanedTopic,
        attachments: editFiles.map((f) => ({ id: f.id, name: f.name }))
      });
      if (data) onChange(data);
    } catch (er) {
      onChange(prevPost);
      toast.error(errMsg(er, "Gagal menyimpan perubahan"));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <article className={`flex gap-2.5 sm:gap-3 ${reply ? "py-3.5 sm:py-4" : "card p-3.5 sm:p-4"}`} data-testid={`post-${p.id}`}>
      <Link to={`/people/${p.author_id}`} className="shrink-0"><Avatar user={author} size={reply ? 32 : 40} /></Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <Link to={`/people/${p.author_id}`} className="inline-flex items-center gap-1 truncate font-bold text-ink hover:underline max-w-full leading-snug py-0.5">
                <span className="truncate">{author?.name || "—"}</span>
                <VerifiedBadge user={author} size={14} />
              </Link>
              {!reply && p.topic && (
                <>
                  <ChevronRight size={13} className="text-sub/70 shrink-0" />
                  <Link
                    to={`/beranda?tag=${encodeURIComponent(p.topic)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-brand/10 hover:bg-brand/15 dark:bg-brand/20 dark:hover:bg-brand/30 px-2.5 py-0.5 text-xs font-semibold text-brand transition-colors"
                    data-testid={`post-topic-badge-${p.id}`}
                  >
                    <span>{p.topic}</span>
                  </Link>
                </>
              )}
              <span className="text-xs text-sub leading-snug">
                {author?.job_title ? `${author.job_title} · ` : ""}{rel(p.created_at)}
                {p.edited && <span className="ml-1 italic text-sub/80" data-testid={`post-edited-badge-${p.id}`}>· diedit</span>}
              </span>
            </div>
          </div>
          {(p.author_id === me?.user_id || isAdmin) && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={startEdit}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink transition-colors"
                title="Ubah postingan"
                aria-label="Ubah postingan"
                data-testid={`post-edit-${p.id}`}
              >
                <Pencil size={13.5} />
              </button>
              <button
                type="button"
                onClick={del}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 transition-colors"
                title="Hapus postingan"
                aria-label="Hapus"
                data-testid={`post-delete-${p.id}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="mt-2 rounded-2xl border bg-surface2/70 p-3 space-y-2.5" data-testid={`post-edit-form-${p.id}`}>
            {!reply && (
              <div className="relative flex items-center gap-1.5 text-xs">
                <span className="font-semibold text-sub">Topik Utas:</span>
                {editTopic ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 font-semibold text-brand">
                    <button type="button" onClick={() => setEditTopicPickerOpen((v) => !v)} className="hover:underline">
                      {editTopic}
                    </button>
                    <button type="button" onClick={() => setEditTopic("")} className="hover:text-rose-600">
                      <X size={11} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditTopicPickerOpen((v) => !v)}
                    className="rounded-full border bg-surface px-2.5 py-0.5 font-semibold text-sub hover:text-brand"
                  >
                    + {t("beranda_add_topic", "Tambahkan topik")}
                  </button>
                )}
                {editTopicPickerOpen && (
                  <TopicPickerPopover
                    value={editTopic}
                    onSelect={(nextT) => setEditTopic(nextT)}
                    onClose={() => setEditTopicPickerOpen(false)}
                    trendingItems={getTrendingCache()}
                  />
                )}
              </div>
            )}
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={reply ? 2 : 3}
              placeholder="Ubah isi postingan..."
              className="w-full resize-none rounded-xl border bg-surface p-2.5 text-[14.5px] text-ink outline-none focus:border-brand"
              data-testid={`post-edit-input-${p.id}`}
            />
            {editFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editFiles.map((f) => (
                  <div key={f.id} className="relative">
                    <img src={fileUrl(f.id)} alt={f.name} className="h-16 w-16 rounded-xl object-cover border" />
                    <button
                      type="button"
                      onClick={() => setEditFiles(editFiles.filter((x) => x.id !== f.id))}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-[var(--c-surface)]"
                      aria-label="Hapus lampiran"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                <button
                  type="button"
                  onClick={() => editFileRef.current?.click()}
                  className="btn-ghost inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold text-sub hover:text-ink"
                >
                  <ImagePlus size={14} /> Tambah Foto
                </button>
                <input
                  ref={editFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addEditFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-8 rounded-full border bg-surface px-3.5 text-xs font-semibold text-sub hover:text-ink"
                  data-testid={`post-edit-cancel-${p.id}`}
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={saveEdit}
                  className="btn-accent inline-flex h-8 items-center gap-1 rounded-full px-4 text-xs font-semibold text-white disabled:opacity-50"
                  data-testid={`post-edit-save-${p.id}`}
                >
                  <Check size={13} /> Simpan Perubahan
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {p.text && <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed" data-testid={`post-text-${p.id}`}><RichText text={p.text} mentionIds={p.mention_ids} /></p>}
            {p.attachments?.length > 0 && (
              <div className={`mt-2.5 grid w-full min-w-0 gap-1.5 ${p.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                {p.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setLightboxImg(a)}
                    className={`group relative overflow-hidden rounded-2xl border text-left focus:outline-none cursor-zoom-in ${p.attachments.length > 1 ? "w-full min-w-0" : "w-fit max-w-full"}`}
                    data-testid={`post-image-${a.id}`}
                  >
                    <img
                      src={fileUrl(a.id)}
                      alt={a.name}
                      className={`object-cover transition-transform duration-200 group-hover:scale-[1.01] ${p.attachments.length > 1 ? "aspect-square w-full" : "max-h-[420px] w-auto max-w-full"}`}
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {(p.poll_id || p.poll) && <div className="mt-2.5"><PollCard pollId={p.poll_id || p.poll?.id} poll={p.poll} compact /></div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ReactionPicker p={p} onChange={onChange} />
          {!reply && (
            <button
              type="button"
              onClick={toggleComments}
              className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm transition-all duration-150 ${
                showComments
                  ? "bg-brand/10 text-brand font-semibold ring-1 ring-brand/25"
                  : "text-sub hover:bg-surface2/60 hover:text-ink"
              }`}
              data-testid={`post-reply-btn-${p.id}`}
              title={showComments ? "Tutup kolom balasan" : "Balas postingan"}
            >
              <MessageCircle size={16} />
              <span>{p.reply_count > 0 ? `${p.reply_count} Balas` : "Balas"}</span>
              {showComments && <ChevronUp size={13} className="ml-0.5 opacity-70" />}
            </button>
          )}
          <ReactionBadges p={p} onChange={onChange} />
        </div>

        {/* Collapsed comments indicator */}
        {!reply && !showComments && p.reply_count > 0 && (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={toggleComments}
              className="group inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
              data-testid={`post-expand-comments-${p.id}`}
            >
              <MessageCircle size={13} />
              <span>Lihat {p.reply_count} balasan</span>
              <ChevronDown size={13} className="transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>
        )}

        {/* Inline comments & reply dropdown */}
        {!reply && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
              showComments
                ? "grid-rows-[1fr] opacity-100 mt-3"
                : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
            }`}
            data-testid={`post-comments-dropdown-${p.id}`}
          >
            <div className="overflow-hidden">
              <div className="space-y-3 rounded-2xl bg-surface2/35 p-3 sm:p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold text-sub px-0.5">
                  <span>{replies.length > 0 ? `${replies.length} balasan` : "0 balasan"}</span>
                  <button
                    type="button"
                    onClick={() => setShowComments(false)}
                    className="flex items-center gap-1 text-xs text-sub hover:text-ink rounded-lg px-2 py-0.5 hover:bg-surface2 transition-colors"
                    title="Tutup kolom balasan"
                  >
                    <span>Tutup</span>
                    <ChevronUp size={13} />
                  </button>
                </div>

                {loadingReplies ? (
                  <div className="flex items-center justify-center py-6 text-xs text-sub gap-2">
                    <Loader2 size={16} className="animate-spin text-brand" />
                    <span>Memuat balasan...</span>
                  </div>
                ) : replies.length > 0 ? (
                  <div className="divide-y divide-subtle/60 rounded-xl bg-surface px-3 border border-subtle/50">
                    {replies.map((r) => (
                      <PostCard
                        key={r.id}
                        p={r}
                        reply
                        onChange={handleReplyChange}
                        onDelete={handleReplyDelete}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-2.5 text-center text-xs text-sub">
                    Belum ada balasan. Tulis balasan pertama di bawah!
                  </div>
                )}

                <Composer
                  parentId={p.id}
                  compact
                  placeholder="Balas postingan ini..."
                  onPosted={handleReplyPosted}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <ImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
    </article>
  );
}

const THREAD_CACHE = {};

function Trending({ compact }) {
  const { me, subscribe, t } = useApp();
  const [items, setItems] = useState(() => getTrendingCache());
  const [pinnedTopics, setPinnedTopics] = useState(() => loadPinnedTopics(me?.user_id));
  const [params] = useSearchParams();
  const active = params.get("tag") || "";

  useEffect(() => {
    setPinnedTopics(loadPinnedTopics(me?.user_id));
    const onPinnedChanged = (ev) => {
      if (Array.isArray(ev.detail)) setPinnedTopics(ev.detail);
    };
    window.addEventListener("circle:pinned-topics-changed", onPinnedChanged);
    return () => window.removeEventListener("circle:pinned-topics-changed", onPinnedChanged);
  }, [me?.user_id]);

  const load = useCallback(() => {
    api.get("/posts/trending")
      .then((r) => {
        if (Array.isArray(r.data)) {
          setItems(r.data);
          setTrendingCache(r.data);
          try { localStorage.setItem("circle_cache_trending", JSON.stringify(r.data)); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe((e) => {
    if (Array.isArray(e.trending)) {
      setTrendingCache(e.trending);
      setItems(e.trending);
      try { localStorage.setItem("circle_cache_trending", JSON.stringify(e.trending)); } catch {}
    } else if (e.type === "posts:changed") {
      load();
    }
  }), [subscribe, load]);

  const togglePin = (e, topicLabel) => {
    e.preventDefault();
    e.stopPropagation();
    const cleaned = String(topicLabel || "").replace(/^#+/, "").trim();
    if (!cleaned) return;
    const isPinned = pinnedTopics.some((x) => x.toLowerCase() === cleaned.toLowerCase());
    const next = isPinned
      ? pinnedTopics.filter((x) => x.toLowerCase() !== cleaned.toLowerCase())
      : [...pinnedTopics, cleaned];
    setPinnedTopics(next);
    savePinnedTopics(me?.user_id, next);
    toast.success(isPinned ? `Topik "${cleaned}" dilepas dari Beranda` : `Topik "${cleaned}" disematkan ke Beranda`);
  };

  const displayItems = useMemo(() => {
    return (items || []).slice(0, 10);
  }, [items]);

  if (compact) {
    if (!displayItems.length) return null;
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5" data-testid="trending-compact">
        <TrendingUp size={15} className="text-brand shrink-0" />
        {displayItems.slice(0, 7).map((item) => {
          const label = item.label || item.tag;
          const isActive = active.toLowerCase() === String(item.tag).toLowerCase();
          return (
            <Link
              key={item.tag}
              to={`/beranda?tag=${encodeURIComponent(item.tag)}`}
              className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                isActive ? "border-brand bg-brand text-white shadow-xs" : "bg-surface hover:bg-surface2"
              }`}
            >
              {item.is_topic ? label : `#${item.tag}`}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="card p-4" data-testid="trending-panel">
      <h3 className="flex items-center gap-2 font-bold text-ink">
        <TrendingUp size={17} className="text-brand" />
        {t("beranda_trending_title", "Topik & Diskusi Hangat")}
      </h3>
      <p className="mb-3 text-xs text-sub">{t("beranda_trending_subtitle", "Topik dan tagar paling aktif di workspace")}</p>

      {!displayItems.length ? (
        <p className="text-xs text-sub leading-relaxed" data-testid="trending-empty">
          Belum ada topik aktif. Klik <b>Tambahkan topik</b> saat menulis postingan untuk membuat topik pertamamu.
        </p>
      ) : (
        <ol className="space-y-1">
          {displayItems.map((item, i) => {
            const label = item.label || item.tag;
            const isActive = active.toLowerCase() === String(item.tag).toLowerCase();
            const isPinned = pinnedTopics.some((x) => x.toLowerCase() === String(label).toLowerCase());
            return (
              <li key={item.tag}>
                <div
                  className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface2 ${
                    isActive ? "bg-brand/10 ring-1 ring-brand/20" : ""
                  }`}
                >
                  <span className="w-4 text-xs font-bold text-sub">{i + 1}</span>
                  <Link
                    to={`/beranda?tag=${encodeURIComponent(item.tag)}`}
                    className="min-w-0 flex-1"
                    data-testid={`trending-tag-${item.tag}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-ink group-hover:text-brand transition-colors">
                        {item.is_topic ? label : `#${item.tag}`}
                      </span>
                    </div>
                    <span className="text-[11px] text-sub">
                      {item.count > 0 ? `${item.count} utas diskusi` : "Topik baru"}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => togglePin(e, label)}
                    title={isPinned ? "Lepas sematan dari Beranda" : "Sematkan ke tab Beranda"}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                      isPinned
                        ? "text-brand bg-brand/10 hover:bg-brand/20"
                        : "text-sub/60 opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink"
                    }`}
                    data-testid={`pin-topic-sidebar-${item.tag}`}
                  >
                    <Pin size={13} className={isPinned ? "fill-current" : ""} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Feed() {
  const { me, userMap, subscribe, t } = useApp();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") || "";
  const [pinnedTopics, setPinnedTopics] = useState(() => loadPinnedTopics(me?.user_id));
  const [posts, setPosts] = useState(() => {
    const cached = getPostsCache();
    return tag ? cached.filter((p) => postMatchesTopic(p, tag)) : cached;
  });
  const [more, setMore] = useState(() => getPostsCache().length >= 30);

  useEffect(() => {
    setPinnedTopics(loadPinnedTopics(me?.user_id));
    const onPinnedChanged = (ev) => {
      if (Array.isArray(ev.detail)) setPinnedTopics(ev.detail);
    };
    window.addEventListener("circle:pinned-topics-changed", onPinnedChanged);
    return () => window.removeEventListener("circle:pinned-topics-changed", onPinnedChanged);
  }, [me?.user_id]);

  const togglePinActiveTopic = (topicName) => {
    const cleaned = String(topicName || "").replace(/^#+/, "").trim();
    if (!cleaned) return;
    const isPinned = pinnedTopics.some((x) => x.toLowerCase() === cleaned.toLowerCase());
    const next = isPinned
      ? pinnedTopics.filter((x) => x.toLowerCase() !== cleaned.toLowerCase())
      : [...pinnedTopics, cleaned];
    setPinnedTopics(next);
    savePinnedTopics(me?.user_id, next);
    toast.success(isPinned ? `Topik "${cleaned}" dilepas dari Beranda` : `Topik "${cleaned}" disematkan ke Beranda`);
  };

  const load = useCallback(() => {
    api.get("/posts", { params: tag ? { tag } : {} })
      .then((r) => {
        if (Array.isArray(r.data)) {
          r.data.forEach((p) => { if (p?.poll) seedPollCache(p.poll); });
          setPosts(r.data);
          setMore(r.data.length === 30);
          if (!tag) {
            setPostsCache(r.data);
            try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(r.data)); } catch {}
          }
        }
      })
      .catch(() => {});
  }, [tag]);

  useEffect(() => {
    const cached = getPostsCache();
    if (tag) {
      setPosts(cached.filter((p) => postMatchesTopic(p, tag)));
    } else {
      setPosts(cached);
    }
    load();
  }, [tag, load]);

  useEffect(() => subscribe((e) => {
    if (e.type === "post:new" && e.data) {
      const d = e.data;
      if (d.poll) seedPollCache(d.poll);
      if (!d.parent_id) {
        if (tag && !postMatchesTopic(d, tag)) return;
        setPosts((ps) => {
          const existing = Array.isArray(ps) ? ps : [];
          if (existing.some((x) => x.id === d.id)) return existing;
          // Replace optimistic post by same author if present
          const optIdx = existing.findIndex((x) => String(x.id).startsWith("pst_opt_") && x.author_id === d.author_id && x.text === d.text);
          const next = optIdx !== -1
            ? existing.map((x, idx) => (idx === optIdx ? d : x))
            : [d, ...existing];
          if (!tag) {
            setPostsCache(next);
            try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
          }
          return next;
        });
      } else if (d.parent_id) {
        setPosts((ps) => {
          const next = (Array.isArray(ps) ? ps : []).map((x) => {
            if (x.id === d.parent_id) {
              const prevReplies = x.replies_preview || [];
              const exists = prevReplies.some((r) => r.id === d.id);
              const nextReplies = exists ? prevReplies.map((r) => (r.id === d.id ? d : r)) : [...prevReplies, d];
              return {
                ...x,
                reply_count: Math.max(x.reply_count || 0, nextReplies.length),
                replies_preview: nextReplies.slice(-3)
              };
            }
            return x;
          });
          if (!tag) {
            setPostsCache(next);
            try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
          }
          return next;
        });
      } else if (e.parent) {
        setPosts((ps) => {
          const next = (Array.isArray(ps) ? ps : []).map((x) => (x.id === e.parent.id ? { ...x, ...e.parent } : x));
          if (!tag) {
            setPostsCache(next);
            try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
          }
          return next;
        });
      }
    } else if (e.type === "post:updated" && e.data) {
      const d = e.data;
      const withMyLike = {
        ...d,
        liked: Boolean(me?.user_id && Array.isArray(d.likes) && d.likes.includes(me.user_id))
      };
      setPosts((ps) => {
        const next = (Array.isArray(ps) ? ps : []).map((x) => {
          if (x.id === withMyLike.id) return { ...x, ...withMyLike };
          if (Array.isArray(x.replies_preview) && x.replies_preview.some((r) => r.id === withMyLike.id)) {
            return {
              ...x,
              replies_preview: x.replies_preview.map((r) => (r.id === withMyLike.id ? { ...r, ...withMyLike } : r))
            };
          }
          return x;
        });
        if (!tag) {
          setPostsCache(next);
          try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
        }
        return next;
      });
    } else if (e.type === "post:deleted" && e.id) {
      setPosts((ps) => {
        let next = (Array.isArray(ps) ? ps : []).filter((x) => x.id !== e.id);
        if (e.parent) {
          next = next.map((x) => (x.id === e.parent.id ? { ...x, ...e.parent } : x));
        }
        if (!tag) {
          setPostsCache(next);
          try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
        }
        return next;
      });
    } else if (e.type === "posts:changed") {
      load();
    }
  }), [subscribe, load, tag, me?.user_id]);

  const older = () =>
    api.get("/posts", { params: { before: posts[posts.length - 1]?.created_at, ...(tag ? { tag } : {}) } })
      .then((r) => {
        setPosts([...posts, ...r.data]);
        setMore(r.data.length === 30);
      });

  const upd = (np) => {
    setPosts((ps) => {
      const next = ps.map((x) => (x.id === np.id ? { ...x, ...np } : x));
      if (!tag) {
        setPostsCache(next);
        try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
      }
      return next;
    });
  };

  const handlePosted = (newPost, replaceId) => {
    setPosts((ps) => {
      const existing = ps || [];
      let next;
      if (replaceId) {
        next = existing.map((x) => (x.id === replaceId ? newPost : x));
      } else {
        next = [newPost, ...existing.filter((x) => x.id !== newPost.id)];
      }
      if (!tag) {
        setPostsCache(next);
        try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
      }
      return next;
    });
  };

  // Unique contributor avatars for the active topic stream
  const topicContributors = useMemo(() => {
    const ids = [];
    (posts || []).forEach((p) => {
      if (p?.author_id && !ids.includes(p.author_id) && ids.length < 5) {
        ids.push(p.author_id);
      }
    });
    return ids.map((id) => userMap[id]).filter(Boolean);
  }, [posts, userMap]);

  const isCurrentTopicPinned = useMemo(() => {
    if (!tag) return false;
    const clean = String(tag).replace(/^#+/, "").trim().toLowerCase();
    return pinnedTopics.some((x) => x.toLowerCase() === clean);
  }, [tag, pinnedTopics]);

  // Combined feed switcher tabs: "Untuk Anda" + user-pinned topics + active user-created topics
  const feedTabs = useMemo(() => {
    const list = [...pinnedTopics];
    if (tag) {
      const cleanTag = String(tag).replace(/^#+/, "").trim();
      if (cleanTag && !list.some((x) => x.toLowerCase() === cleanTag.toLowerCase())) {
        list.unshift(cleanTag);
      }
    }
    (getTrendingCache() || []).forEach((item) => {
      const label = String(item.label || item.tag || "").replace(/^#+/, "").trim();
      if (label && !list.some((x) => x.toLowerCase() === label.toLowerCase()) && list.length < 7) {
        list.push(label);
      }
    });
    return list;
  }, [pinnedTopics, tag, posts]);

  return (
    <>
      <PageHeader icon={Newspaper} title={t("beranda_title", "Beranda")} subtitle={t("beranda_subtitle", "Tempat berbagi kabar, ide, dan obrolan santai bareng semua orang di Internal.")} />
      <div className="space-y-4">
        {/* Threads-Style Custom Topic Feeds Bar */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b pb-2.5"
          data-testid="beranda-topic-feeds-bar"
        >
          <button
            type="button"
            onClick={() => {
              params.delete("tag");
              setParams(params);
            }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              !tag
                ? "bg-ink text-[var(--c-surface)] shadow-xs"
                : "bg-surface text-sub hover:bg-surface2 hover:text-ink border"
            }`}
            data-testid="feed-tab-all"
          >
            {t("beranda_all_threads", "Untuk Anda")}
          </button>

          {feedTabs.map((topicLabel) => {
            const isActive = tag && String(tag).replace(/^#+/, "").trim().toLowerCase() === topicLabel.toLowerCase();
            const isPinned = pinnedTopics.some((x) => x.toLowerCase() === topicLabel.toLowerCase());
            return (
              <button
                key={topicLabel}
                type="button"
                onClick={() => {
                  if (isActive) {
                    params.delete("tag");
                    setParams(params);
                  } else {
                    setParams({ tag: topicLabel });
                  }
                }}
                className={`group shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-brand text-white shadow-xs"
                    : "bg-surface text-sub hover:bg-surface2 hover:text-ink border"
                }`}
                data-testid={`feed-tab-topic-${topicLabel}`}
              >
                {isPinned && <Pin size={11} className={isActive ? "text-white fill-current" : "text-brand fill-current"} />}
                <span>{topicLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Active Topic Stream Header (Threads Style) */}
        {tag && (
          <div
            className="card relative overflow-hidden border-brand/20 bg-gradient-to-br from-brand/8 via-surface to-surface p-4 sm:p-5"
            data-testid="active-tag-filter"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-brand">
                  <Hash size={13} />
                  <span>{t("beranda_topic_stream_kicker", "TOPIK DISKUSI")}</span>
                  <span>·</span>
                  <span>{posts.length} utas</span>
                </div>
                <h2 className="mt-0.5 text-lg sm:text-xl font-extrabold text-ink tracking-tight truncate">
                  {String(tag).replace(/^#+/, "")}
                </h2>
                <p className="mt-1 text-xs text-sub leading-relaxed">
                  {t(
                    "beranda_topic_stream_subtitle",
                    "Menampilkan seluruh utas dan diskusi tim dalam topik ini. Utas baru yang Anda tulis otomatis ditandai dengan topik ini."
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {topicContributors.length > 0 && (
                  <div className="hidden sm:flex -space-x-2 mr-1">
                    {topicContributors.map((u) => (
                      <div key={u.user_id} className="rounded-full ring-2 ring-surface">
                        <Avatar user={u} size={26} showStatus={false} />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => togglePinActiveTopic(tag)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    isCurrentTopicPinned
                      ? "bg-brand/15 text-brand border border-brand/30"
                      : "bg-surface hover:bg-surface2 text-ink border"
                  }`}
                  data-testid="toggle-pin-topic-btn"
                >
                  <Pin size={12} className={isCurrentTopicPinned ? "fill-current" : ""} />
                  <span>
                    {isCurrentTopicPinned
                      ? t("beranda_unpin_topic", "Tersemat di Beranda")
                      : t("beranda_pin_topic", "Sematkan ke Beranda")}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    params.delete("tag");
                    setParams(params);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-full border bg-surface px-3 text-xs font-semibold text-sub hover:text-ink hover:bg-surface2 cursor-pointer"
                  data-testid="clear-tag-filter"
                >
                  <X size={13} />
                  <span>Semua Utas</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <Composer onPosted={handlePosted} defaultTopic={tag} />

        {!posts.length ? (
          <div className="card py-12 px-4 text-center" data-testid="feed-empty">
            <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Hash size={20} />
            </div>
            <p className="text-sm font-bold text-ink">
              {tag
                ? t("beranda_topic_empty_title", "Belum ada utas di topik ini")
                : "Belum ada postingan. Jadilah yang pertama!"}
            </p>
            {tag && (
              <p className="mt-1 text-xs text-sub max-w-md mx-auto">
                {t("beranda_topic_empty_subtitle", "Mulai percakapan pertama untuk topik ini menggunakan kotak tulis di atas.")}
              </p>
            )}
          </div>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              p={p}
              onChange={upd}
              onDelete={(id) => {
                setPosts((ps) => {
                  const next = ps.filter((x) => x.id !== id);
                  if (!tag) {
                    setPostsCache(next);
                    try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(next)); } catch {}
                  }
                  return next;
                });
              }}
            />
          ))
        )}
        {posts?.length > 0 && more && (
          <button onClick={older} className="w-full py-3 text-sm font-semibold text-brand hover:underline" data-testid="feed-load-more">
            {t("beranda_load_more", "Muat lebih banyak")}
          </button>
        )}
      </div>
    </>
  );
}

function Thread({ pid }) {
  const { me, subscribe } = useApp();
  const navigate = useNavigate();
  const getInitialThread = (id) => {
    if (THREAD_CACHE[id]) return THREAD_CACHE[id];
    const cached = getPostsCache().find((x) => x.id === id);
    if (cached) {
      return {
        ...cached,
        replies: Array.isArray(cached.replies) ? cached.replies : (cached.replies_preview || [])
      };
    }
    return null;
  };
  const [t, setT] = useState(() => getInitialThread(pid));
  const load = useCallback(() =>
    api.get(`/posts/${pid}`).then((r) => {
      if (r.data) {
        if (r.data.poll) seedPollCache(r.data.poll);
        THREAD_CACHE[pid] = r.data;
        setT(r.data);
      }
    }).catch(() => setT((prev) => prev || false)),
  [pid]);

  useEffect(() => {
    const cached = getInitialThread(pid);
    if (cached) setT(cached);
    load();
  }, [pid, load]);

  useEffect(() => subscribe((e) => {
    if (e.type === "post:new" && e.data?.parent_id === pid) {
      setT((prev) => {
        if (!prev) return prev;
        const existing = Array.isArray(prev.replies) ? prev.replies : [];
        if (existing.some((r) => r.id === e.data.id)) return prev;
        const optIdx = existing.findIndex((r) => String(r.id).startsWith("pst_opt_") && r.author_id === e.data.author_id && r.text === e.data.text);
        const nextReplies = optIdx !== -1
          ? existing.map((r, i) => (i === optIdx ? e.data : r))
          : [...existing, e.data];
        const next = { ...prev, reply_count: nextReplies.length, replies: nextReplies };
        THREAD_CACHE[pid] = next;
        return next;
      });
    } else if (e.type === "post:updated" && e.data) {
      const d = {
        ...e.data,
        liked: Boolean(me?.user_id && Array.isArray(e.data.likes) && e.data.likes.includes(me.user_id))
      };
      setT((prev) => {
        if (!prev) return prev;
        if (prev.id === d.id) {
          const next = { ...prev, ...d };
          THREAD_CACHE[pid] = next;
          return next;
        }
        const nextReplies = (prev.replies || []).map((r) => (r.id === d.id ? { ...r, ...d } : r));
        const next = { ...prev, replies: nextReplies };
        THREAD_CACHE[pid] = next;
        return next;
      });
    } else if (e.type === "post:deleted") {
      if (e.id === pid) {
        navigate("/beranda");
      } else if (e.parent_id === pid) {
        setT((prev) => {
          if (!prev) return prev;
          const nextReplies = (prev.replies || []).filter((r) => r.id !== e.id);
          const next = { ...prev, reply_count: nextReplies.length, replies: nextReplies };
          THREAD_CACHE[pid] = next;
          return next;
        });
      }
    } else if (e.type === "posts:changed") {
      load();
    }
  }), [subscribe, load, pid, me?.user_id, navigate]);

  if (!t) return <p className="py-10 text-center text-sm text-sub">Postingan tidak ditemukan.</p>;
  const replies = t.replies || [];
  const updReply = (np) => setT((prev) => {
    const next = { ...prev, replies: (prev.replies || []).map((r) => (r.id === np.id ? { ...r, ...np } : r)) };
    THREAD_CACHE[pid] = next;
    return next;
  });
  return (
    <div className="space-y-4" data-testid="post-thread">
      <button onClick={() => navigate("/beranda")} className="flex items-center gap-1.5 text-sm font-semibold text-sub hover:text-ink" data-testid="thread-back-btn"><ArrowLeft size={16} />Beranda</button>
      <PostCard p={t} onChange={(np) => setT((prev) => { const next = { ...prev, ...np }; THREAD_CACHE[pid] = next; return next; })} onDelete={() => navigate("/beranda")} />
      <div className="card px-4" data-testid="thread-replies">
        <p className="border-b py-3 text-sm font-bold">{replies.length} balasan</p>
        <div className="divide-y">{replies.map((r) => <PostCard key={r.id} p={r} reply onChange={updReply} onDelete={(id) => setT((prev) => { const nextReplies = (prev.replies || []).filter((x) => x.id !== id); const next = { ...prev, reply_count: nextReplies.length, replies: nextReplies }; THREAD_CACHE[pid] = next; return next; })} />)}</div>
        {!replies.length && <p className="py-6 text-center text-sm text-sub">Belum ada balasan.</p>}
      </div>
      <Composer
        parentId={t.id}
        placeholder="Balas postingan ini…"
        onPosted={(r, replaceId) => {
          setT((x) => {
            const existing = x.replies || [];
            const nextReplies = replaceId
              ? existing.map((y) => (y.id === replaceId ? r : y))
              : [...existing.filter((y) => y.id !== r.id), r];
            const next = { ...x, reply_count: nextReplies.length, replies: nextReplies, replies_preview: nextReplies.slice(-3) };
            THREAD_CACHE[pid] = next;
            const updatedPosts = getPostsCache().map((p) => (p.id === pid ? { ...p, reply_count: nextReplies.length, replies_preview: nextReplies.slice(-3) } : p));
            setPostsCache(updatedPosts);
            try { localStorage.setItem("circle_cache_posts_feed", JSON.stringify(updatedPosts)); } catch {}
            return next;
          });
        }}
      />
    </div>
  );
}

export default function Beranda() {
  const { pid } = useParams();
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:py-10 animate-crossfade" data-testid="beranda-page">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] min-w-0">
        <div className="min-w-0">{pid ? <Thread pid={pid} /> : <Feed />}</div>
        <aside className="hidden lg:block"><div className="sticky top-6"><Trending /></div></aside>
      </div>
    </div>
  );
}
