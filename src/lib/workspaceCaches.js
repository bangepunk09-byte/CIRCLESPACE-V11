import { hasCompletedInitialHydrate } from "./persistentMirror";

// ---- Poll Cache ----
export const POLL_CACHE = {};

export function seedPollCache(poll) {
  if (poll && poll.id) {
    POLL_CACHE[poll.id] = poll;
  }
}

// ---- Chat / Conversations Cache ----
export const CHAT_CACHE = {};

export function clearChatCache() {
  Object.keys(CHAT_CACHE).forEach((k) => delete CHAT_CACHE[k]);
}

export function getInitialMsgs(cid) {
  if (CHAT_CACHE[`msgs_${cid}`]) return CHAT_CACHE[`msgs_${cid}`];
  try {
    const saved = localStorage.getItem(`circle_msgs_cache_${cid}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        CHAT_CACHE[`msgs_${cid}`] = parsed;
        return parsed;
      }
    }
    const savedConvs = localStorage.getItem("circle_convs_cache");
    if (savedConvs) {
      const arr = JSON.parse(savedConvs);
      const found = Array.isArray(arr) ? arr.find((x) => x && x.id === cid) : null;
      if (found && Array.isArray(found.messages)) {
        CHAT_CACHE[`msgs_${cid}`] = found.messages;
        return found.messages;
      }
    }
  } catch {}
  return [];
}

export function hydrateConversationsCache(convs, userId) {
  if (!Array.isArray(convs)) return;
  try {
    if (convs.length > 0 || hasCompletedInitialHydrate()) {
      const serialized = JSON.stringify(convs);
      if (userId) {
        localStorage.setItem(`circle_convs_cache_${userId}`, serialized);
      }
      localStorage.setItem("circle_convs_cache", serialized);
    }
  } catch {}
  convs.forEach((c) => {
    if (!c || !c.id) return;
    CHAT_CACHE[`conv_${c.id}`] = c;
    if (Array.isArray(c.messages)) {
      if (c.messages.length === 0 && !hasCompletedInitialHydrate()) {
        const existing = getInitialMsgs(c.id);
        if (existing.length > 0) return;
      }
      CHAT_CACHE[`msgs_${c.id}`] = c.messages;
      try {
        localStorage.setItem(`circle_msgs_cache_${c.id}`, JSON.stringify(c.messages));
      } catch {}
    }
  });
}

export function upsertConversationInCache(conv, userId) {
  if (!conv || !conv.id) return;
  const merged = { ...(CHAT_CACHE[`conv_${conv.id}`] || {}), ...conv };
  CHAT_CACHE[`conv_${conv.id}`] = merged;
  try {
    const key = userId ? `circle_convs_cache_${userId}` : "circle_convs_cache";
    const raw = localStorage.getItem(key) || localStorage.getItem("circle_convs_cache");
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      const idx = list.findIndex((c) => c && c.id === conv.id);
      const next = idx !== -1
        ? list.map((c, i) => (i === idx ? { ...c, ...merged } : c))
        : [merged, ...list];
      const serialized = JSON.stringify(next);
      if (userId) localStorage.setItem(`circle_convs_cache_${userId}`, serialized);
      localStorage.setItem("circle_convs_cache", serialized);
    }
  } catch {}
}

export function appendMessageToCache(msg) {
  if (!msg || !msg.conversation_id) return;
  const cid = msg.conversation_id;
  const existing = getInitialMsgs(cid);
  const idx = existing.findIndex((m) => m.id === msg.id);
  const next = idx !== -1
    ? existing.map((m, i) => (i === idx ? msg : m))
    : [...existing, msg];
  CHAT_CACHE[`msgs_${cid}`] = next;
  try {
    localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(next));
  } catch {}
}

export function updateMessageInCache(msg) {
  if (!msg || !msg.conversation_id) return;
  const cid = msg.conversation_id;
  const existing = getInitialMsgs(cid);
  const next = existing.map((m) => (m.id === msg.id ? msg : m));
  CHAT_CACHE[`msgs_${cid}`] = next;
  try {
    localStorage.setItem(`circle_msgs_cache_${cid}`, JSON.stringify(next));
  } catch {}
}

// ---- Posts / Beranda Feed Cache ----
const DEFAULT_POSTS = [
  {
    id: "pst_init_1",
    author_id: "user_admin1",
    topic: null,
    text: "Selamat datang di workspace internal ASLI RI! 🎉 Silakan gunakan Beranda ini untuk update info, obrolan santai, atau diskusi lintas divisi.",
    attachments: [],
    likes: [],
    like_count: 0,
    liked: false,
    reactions: { "👍": ["user_admin1"] },
    reply_count: 0,
    replies_preview: [],
    created_at: new Date(Date.now() - 3600000 * 24).toISOString()
  }
];

let trendingCache = [];
try {
  localStorage.removeItem("circle_cache_trending");
} catch {}

let postsCache = DEFAULT_POSTS;
try {
  const saved = localStorage.getItem("circle_cache_posts_feed");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) postsCache = parsed;
  }
} catch {}

export function getPostsCache() {
  return postsCache;
}

export function setPostsCache(next) {
  if (Array.isArray(next)) postsCache = next;
  return postsCache;
}

export function getTrendingCache() {
  return trendingCache;
}

export function setTrendingCache(next) {
  if (Array.isArray(next)) trendingCache = next;
  return trendingCache;
}

export function hydratePostsCache(posts, trending) {
  if (Array.isArray(posts)) {
    postsCache = posts;
    posts.forEach((p) => {
      if (p?.poll) seedPollCache(p.poll);
    });
    try {
      localStorage.setItem("circle_cache_posts_feed", JSON.stringify(posts));
    } catch {}
  }
  if (Array.isArray(trending)) {
    trendingCache = trending;
    try {
      localStorage.setItem("circle_cache_trending", JSON.stringify(trending));
    } catch {}
  }
}

// ---- Groups Cache ----
let groupsCache = [];

function getGroupsCacheKey(userId) {
  return userId ? `circle_groups_cache_${userId}` : "circle_groups_cache";
}

export function getGroupsCache() {
  return groupsCache;
}

export function setGroupsCache(next) {
  if (Array.isArray(next)) groupsCache = next;
  return groupsCache;
}

export function readGroupsCacheForUser(userId) {
  try {
    const saved = localStorage.getItem(getGroupsCacheKey(userId));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((g) => {
          if (!g || !g.id) return false;
          const mems = Array.isArray(g.member_ids) ? g.member_ids : [];
          const isMem = userId ? mems.includes(userId) : Boolean(g.is_member);
          return isMem || Boolean(g.has_invitation);
        });
      }
    }
  } catch {}
  return [];
}

export function hydrateGroupsCache(arr, userId) {
  if (!Array.isArray(arr)) return;
  const filtered = arr.filter((g) => g && g.id && (g.is_member || g.has_invitation));
  groupsCache = filtered;
  try {
    localStorage.setItem(getGroupsCacheKey(userId), JSON.stringify(filtered));
  } catch {}
}

export function upsertGroupInCache(group, userId) {
  if (!group || !group.id) return groupsCache;
  const mems = Array.isArray(group.member_ids) ? group.member_ids : null;
  const isMember = mems && userId ? mems.includes(userId) : Boolean(group.is_member);
  const hasInvite = Boolean(group.has_invitation);
  let next;
  if (!isMember && !hasInvite) {
    next = groupsCache.filter((g) => g.id !== group.id);
  } else {
    const idx = groupsCache.findIndex((g) => g.id === group.id);
    next = idx !== -1
      ? groupsCache.map((g, i) => (i === idx ? { ...g, ...group, is_member: isMember } : g))
      : [{ ...group, is_member: isMember }, ...groupsCache];
  }
  groupsCache = next;
  try {
    localStorage.setItem(getGroupsCacheKey(userId), JSON.stringify(next));
  } catch {}
  return next;
}
