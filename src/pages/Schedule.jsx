import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Calendar as CalendarIcon, Clock, Video, Plus, MapPin, CheckCircle2, Trash2, ExternalLink, RefreshCw, Upload, Link2, Check } from "lucide-react";
import { format, parseISO, addDays, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { toast } from "sonner";
import { api, errMsg } from "../lib/api";
import { useApp } from "../context/AppContext";
import { Avatar, AccentButton, GhostButton, PageHeader } from "../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { DatePicker, TimePicker } from "../components/ui/date-picker";
import { playSound } from "../lib/sound";
import { initAuth, googleCalendarOAuthSignIn, getAccessToken, getConnectedCalendarEmail, clearCalendarAuth } from "../lib/auth";
import { listEvents, createEvent, deleteEvent } from "../lib/calendar";

const DELETED_MEETING_IDS = new Set();
const DELETED_MEETING_KEYS = new Set();

try {
  const savedDelIds = localStorage.getItem("circle_deleted_meeting_ids");
  if (savedDelIds) {
    JSON.parse(savedDelIds).forEach((x) => x && DELETED_MEETING_IDS.add(String(x)));
  }
  const savedDelKeys = localStorage.getItem("circle_deleted_meeting_keys");
  if (savedDelKeys) {
    JSON.parse(savedDelKeys).forEach((x) => x && DELETED_MEETING_KEYS.add(String(x)));
  }
} catch {}

function persistDeletedMeetings() {
  try {
    localStorage.setItem("circle_deleted_meeting_ids", JSON.stringify(Array.from(DELETED_MEETING_IDS)));
    localStorage.setItem("circle_deleted_meeting_keys", JSON.stringify(Array.from(DELETED_MEETING_KEYS)));
  } catch {}
}

function makeMeetingKey(m) {
  if (!m) return "";
  return `${String(m.title || "").trim().toLowerCase()}__${String(m.date || "")}__${String(m.start_time || "")}`;
}

function isMeetingDeleted(m) {
  if (!m) return true;
  const gcalId = String(m.gcal_event_id || (String(m.id || "").startsWith("gcal_") ? String(m.id).replace(/^gcal_/, "") : ""));
  const key = makeMeetingKey(m);
  return (
    (m.id && DELETED_MEETING_IDS.has(String(m.id))) ||
    (gcalId && (DELETED_MEETING_IDS.has(gcalId) || DELETED_MEETING_IDS.has(`gcal_${gcalId}`))) ||
    (key && DELETED_MEETING_KEYS.has(key))
  );
}

function filterAndDedupeMeetings(list = []) {
  if (!Array.isArray(list)) return [];
  const byKey = new Map();
  for (const m of list) {
    if (!m || isMeetingDeleted(m)) continue;
    const key = makeMeetingKey(m) || m.id;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        ...m,
        id: existing.id && !String(existing.id).startsWith("gcal_") ? existing.id : (m.id || existing.id),
        gcal_event_id: m.gcal_event_id || existing.gcal_event_id || null,
        gcal_synced: Boolean(m.gcal_synced || existing.gcal_synced),
      });
    } else {
      byKey.set(key, m);
    }
  }
  const result = Array.from(byKey.values());
  result.sort((a, b) => {
    const ta = new Date(`${a.date}T${a.start_time || "00:00"}`).getTime();
    const tb = new Date(`${b.date}T${b.start_time || "00:00"}`).getTime();
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });
  return result;
}

let MEETINGS_CACHE = [];
try {
  const cached = localStorage.getItem("circle_meetings_cache");
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) MEETINGS_CACHE = filterAndDedupeMeetings(parsed);
  }
} catch {}

function normalizeGCalItems(items = []) {
  return items
    .filter((ev) => ev && ev.status !== "cancelled")
    .map((ev) => {
      const rawStart = ev.start?.dateTime || ev.start?.date || "";
      let startDateStr = format(new Date(), "yyyy-MM-dd");
      if (ev.start?.dateTime) {
        try { startDateStr = format(new Date(ev.start.dateTime), "yyyy-MM-dd"); } catch { startDateStr = rawStart.slice(0, 10); }
      } else if (ev.start?.date) {
        startDateStr = String(ev.start.date).slice(0, 10);
      }
      let startT = "09:00";
      let endT = "10:00";
      if (ev.start?.dateTime) {
        try { startT = format(new Date(ev.start.dateTime), "HH:mm"); } catch {}
      } else if (ev.start?.date) {
        startT = "00:00";
      }
      if (ev.end?.dateTime) {
        try { endT = format(new Date(ev.end.dateTime), "HH:mm"); } catch {}
      } else if (ev.end?.date) {
        endT = "23:59";
      }
      const hangout =
        ev.hangoutLink ||
        ev.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ||
        "";
      const attendeeEmails = Array.isArray(ev.attendees)
        ? ev.attendees.map((a) => a?.email).filter(Boolean)
        : [];
      return {
        id: `gcal_${ev.id}`,
        gcal_event_id: ev.id,
        title: ev.summary || "Agenda Google Calendar",
        description: ev.description || "",
        date: startDateStr,
        start_time: startT,
        end_time: endT,
        location: ev.location || (hangout ? "Google Meet" : "Google Calendar"),
        meet_link: hangout,
        html_link: ev.htmlLink || "",
        attendee_emails: attendeeEmails,
        attendee_ids: [],
        is_gcal: true,
        gcal_synced: true,
      };
    })
    .filter((ev) => !isMeetingDeleted(ev));
}

function buildGoogleCalendarTemplateUrl(m, userMap = {}) {
  if (!m) return "https://calendar.google.com";
  const datePart = String(m.date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const startPart = String(m.start_time || "09:00").replace(/:/g, "").slice(0, 4) + "00";
  const endPart = String(m.end_time || "10:00").replace(/:/g, "").slice(0, 4) + "00";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title || "Agenda Rapat CIRCLE",
    dates: `${datePart}T${startPart}/${datePart}T${endPart}`,
    ctz: "Asia/Jakarta",
    details: `${m.description || ""}${m.meet_link ? `\n\nLink Meeting: ${m.meet_link}` : ""}`.trim(),
    location: m.location || "Google Meet",
  });
  const emails = (m.attendee_ids || [])
    .map((uid) => userMap[uid]?.email)
    .filter(Boolean);
  if (emails.length > 0) {
    params.set("add", emails.join(","));
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function Schedule() {
  const { me, users, userMap, t, subscribe } = useApp();
  const [meetings, setMeetings] = useState(MEETINGS_CACHE);
  const [syncingGCal, setSyncingGCal] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [connectedEmail, setConnectedEmail] = useState(() => getConnectedCalendarEmail());
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [createOpen, setCreateOpen] = useState(false);
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [viewMode, setViewMode] = useState("all"); // "all", "today", "upcoming", "date"
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmMeeting, setDeleteConfirmMeeting] = useState(null);

  // Google Calendar Import (.ics / iCal URL / OAuth) state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [icsUrlInput, setIcsUrlInput] = useState("");
  const [savedIcsUrl, setSavedIcsUrl] = useState("");
  const [importingIcs, setImportingIcs] = useState(false);
  const icsFileInputRef = useRef(null);

  // Form state
  const [form, setForm] = useState({
    title: "",
    description: "",
    date: format(new Date(), "yyyy-MM-dd"),
    start_time: "10:00",
    end_time: "11:00",
    location_type: "online", // "online" or "offline"
    location: "Google Meet",
    meet_link: "",
    attendee_ids: [],
    sync_gcal: true,
  });

  const updateMeetingsList = useCallback((nextList) => {
    if (!Array.isArray(nextList)) return;
    const cleaned = filterAndDedupeMeetings(nextList);
    MEETINGS_CACHE = cleaned;
    setMeetings(cleaned);
    try { localStorage.setItem("circle_meetings_cache", JSON.stringify(cleaned)); } catch {}
  }, []);

  const savedIcsUrlRef = useRef("");
  savedIcsUrlRef.current = savedIcsUrl;

  const syncFromGoogleCalendar = useCallback(async ({ silent = true, overrideIcsUrl = null } = {}) => {
    const token = await getAccessToken();
    const activeIcsUrl = overrideIcsUrl !== null ? overrideIcsUrl : savedIcsUrlRef.current;

    if (!token && !activeIcsUrl) {
      setNeedsAuth(true);
      if (!silent) {
        toast.info("Silakan klik Hubungkan Google Calendar terlebih dahulu.");
      }
      return;
    }

    setSyncingGCal(true);
    let syncedSuccess = false;

    try {
      // 1. Try real Google OAuth Calendar API if token is present
      if (token) {
        try {
          const gcalRes = await listEvents();
          if (gcalRes?.items && Array.isArray(gcalRes.items)) {
            const normalized = normalizeGCalItems(gcalRes.items);
            setMeetings((prev) => {
              const merged = filterAndDedupeMeetings([...prev, ...normalized]);
              MEETINGS_CACHE = merged;
              try { localStorage.setItem("circle_meetings_cache", JSON.stringify(merged)); } catch {}
              return merged;
            });

            const { data: syncedServerList } = await api.post("/meetings/sync-gcal", { events: normalized });
            if (Array.isArray(syncedServerList)) {
              updateMeetingsList(syncedServerList);
            }
            setConnectedEmail(getConnectedCalendarEmail());
            setNeedsAuth(false);
            setLastSyncedAt(new Date());
            syncedSuccess = true;
            if (!silent) {
              toast.success(`${normalized.length} jadwal Google Calendar berhasil disinkronkan!`);
            }
          }
        } catch (innerErr) {
          console.warn("Direct GCal API error:", innerErr);
          if (!activeIcsUrl) {
            clearCalendarAuth();
            setConnectedEmail("");
            setNeedsAuth(true);
            if (!silent) {
              toast.error(innerErr?.message || "Sesi Google Calendar berakhir. Klik Hubungkan Google Calendar untuk menyinkronkan ulang.");
            }
            return;
          }
        }
      }

      // 2. Sync via saved iCal URL if configured
      if (activeIcsUrl) {
        const { data } = await api.post("/meetings/import-ics", { ics_url: activeIcsUrl });
        if (Array.isArray(data?.meetings)) {
          updateMeetingsList(data.meetings);
        }
        setNeedsAuth(false);
        setLastSyncedAt(new Date());
        syncedSuccess = true;
        if (!silent && !token) {
          toast.success(`${data?.imported_count ?? 0} jadwal Google Calendar berhasil disinkronkan!`);
        }
      }
    } catch (e) {
      console.warn("GCal sync error:", e);
      if (!silent && !syncedSuccess) {
        toast.error(errMsg(e, "Gagal menyinkronkan Google Calendar."));
      }
    } finally {
      setSyncingGCal(false);
    }
  }, [updateMeetingsList]);

  const loadMeetings = useCallback(() => {
    api.get("/meetings").then((res) => {
      if (Array.isArray(res.data)) {
        updateMeetingsList(res.data);
      }
    }).catch(() => {});

    api.get("/meetings/ics-config").then((res) => {
      const url = res.data?.ics_url || "";
      if (url) {
        savedIcsUrlRef.current = url;
        setSavedIcsUrl(url);
        setIcsUrlInput(url);
        setNeedsAuth(false);
        syncFromGoogleCalendar({ silent: true, overrideIcsUrl: url });
      } else {
        syncFromGoogleCalendar({ silent: true });
      }
    }).catch(() => {
      syncFromGoogleCalendar({ silent: true });
    });
  }, [updateMeetingsList, syncFromGoogleCalendar]);

  useEffect(() => {
    const unsub = initAuth(
      (u) => {
        setConnectedEmail(u?.email || getConnectedCalendarEmail());
        setNeedsAuth(false);
        syncFromGoogleCalendar({ silent: true });
      },
      () => {
        setConnectedEmail(getConnectedCalendarEmail());
        // Keep connected if savedIcsUrl is present
        setNeedsAuth(savedIcsUrlRef.current ? false : true);
      }
    );
    loadMeetings();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [loadMeetings, syncFromGoogleCalendar]);

  // Automatic periodic & window-focus Google Calendar sync so new calendar events appear automatically
  useEffect(() => {
    let lastFocusSyncAt = 0;
    const interval = setInterval(() => {
      getAccessToken().then((tok) => {
        if (tok || savedIcsUrl) syncFromGoogleCalendar({ silent: true });
      });
    }, 45000);
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusSyncAt < 30000) return;
      lastFocusSyncAt = now;
      getAccessToken().then((tok) => {
        if (tok || savedIcsUrl) syncFromGoogleCalendar({ silent: true });
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [syncFromGoogleCalendar, savedIcsUrl]);

  useEffect(() => {
    return subscribe?.((evt) => {
      if (evt.type === "meetings:synced" && Array.isArray(evt.data)) {
        updateMeetingsList(evt.data);
      }
      if (evt.type === "meeting:new" && evt.data) {
        if (isMeetingDeleted(evt.data)) return;
        setMeetings((prev) => {
          const next = filterAndDedupeMeetings([...prev, evt.data]);
          MEETINGS_CACHE = next;
          try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
          return next;
        });
      }
      if (evt.type === "meeting:delete" && evt.id) {
        DELETED_MEETING_IDS.add(String(evt.id));
        if (Array.isArray(evt.deleted_ids)) evt.deleted_ids.forEach((x) => x && DELETED_MEETING_IDS.add(String(x)));
        if (Array.isArray(evt.deleted_keys)) evt.deleted_keys.forEach((k) => k && DELETED_MEETING_KEYS.add(String(k)));
        persistDeletedMeetings();
        setMeetings((prev) => {
          const next = filterAndDedupeMeetings(prev.filter((m) => m.id !== evt.id));
          MEETINGS_CACHE = next;
          try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
          return next;
        });
      }
      if (evt.type === "meeting:update" && evt.data) {
        if (isMeetingDeleted(evt.data)) return;
        setMeetings((prev) => {
          const next = filterAndDedupeMeetings(prev.map((m) => (m.id === evt.data.id ? { ...m, ...evt.data } : m)));
          MEETINGS_CACHE = next;
          try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
          return next;
        });
      }
    });
  }, [subscribe, updateMeetingsList]);

  const handleConnectGoogleCalendar = async () => {
    setIsLoggingIn(true);
    setSyncingGCal(true);
    try {
      const result = await googleCalendarOAuthSignIn();
      const email = result?.user?.email || getConnectedCalendarEmail() || me?.email || "";
      const gcalRes = await listEvents();
      const items = Array.isArray(gcalRes?.items) ? gcalRes.items : [];
      const normalized = normalizeGCalItems(items);

      setMeetings((prev) => {
        const merged = filterAndDedupeMeetings([...prev, ...normalized]);
        MEETINGS_CACHE = merged;
        try { localStorage.setItem("circle_meetings_cache", JSON.stringify(merged)); } catch {}
        return merged;
      });

      const { data: syncedServerList } = await api.post("/meetings/sync-gcal", { events: normalized });
      if (Array.isArray(syncedServerList)) {
        updateMeetingsList(syncedServerList);
      }

      setConnectedEmail(email);
      setNeedsAuth(false);
      setLastSyncedAt(new Date());
      setImportModalOpen(false);
      playSound("meeting");
      toast.success(
        normalized.length > 0
          ? `Google Calendar (${email || "Terhubung"}) tersinkron! ${normalized.length} jadwal dimuat.`
          : `Google Calendar (${email || "Terhubung"}) berhasil dihubungkan & siap disinkronkan!`
      );
    } catch (err) {
      const code = err?.code || "";
      const rawMsg = String(err?.message || "");
      if (code === "auth/popup-closed-by-user") {
        toast.info("Popup login Google ditutup sebelum selesai.");
      } else if (code === "auth/popup-blocked") {
        toast.error("Popup Google diblokir browser. Izinkan pop-up untuk situs ini atau gunakan tombol Import .ics.");
      } else if (code === "auth/unauthorized-domain") {
        toast.error(`Domain "${window.location.hostname}" belum terdaftar di Authorized Domains Firebase Authentication.`);
      } else if (code === "auth/cancelled-popup-request") {
        // Ignore duplicate click
      } else if (rawMsg.includes("403") || rawMsg.toLowerCase().includes("insufficient") || rawMsg.toLowerCase().includes("access")) {
        toast.error(rawMsg || "Akses Google Calendar belum diizinkan (Error 403 / Testing Mode). Pastikan izin kalender dicentang atau gunakan Import .ics.");
      } else {
        toast.error(rawMsg || "Gagal menghubungkan & menyinkronkan Google Calendar.");
      }
    } finally {
      setIsLoggingIn(false);
      setSyncingGCal(false);
    }
  };

  const handleImportIcsUrl = async (e) => {
    e?.preventDefault?.();
    const trimmed = icsUrlInput.trim();
    if (!trimmed) {
      return toast.error("Masukkan URL Secret address in iCal format dari Google Calendar Anda");
    }
    setImportingIcs(true);
    try {
      const { data } = await api.post("/meetings/import-ics", { ics_url: trimmed });
      if (Array.isArray(data?.meetings)) {
        updateMeetingsList(data.meetings);
      }
      setSavedIcsUrl(trimmed);
      setNeedsAuth(false);
      setLastSyncedAt(new Date());
      setImportModalOpen(false);
      playSound("meeting");
      toast.success(`Berhasil mengimpor ${data?.imported_count ?? 0} jadwal dari Google Calendar!`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengimpor dari URL iCal Google Calendar"));
    } finally {
      setImportingIcs(false);
    }
  };

  const handleUploadIcsFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportingIcs(true);
    try {
      const text = await file.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        toast.error("File yang dipilih bukan format kalender .ics yang valid.");
        return;
      }
      const { data } = await api.post("/meetings/import-ics", { ics_text: text });
      if (Array.isArray(data?.meetings)) {
        updateMeetingsList(data.meetings);
      }
      setNeedsAuth(false);
      setLastSyncedAt(new Date());
      setImportModalOpen(false);
      playSound("meeting");
      toast.success(`Berhasil mengimpor ${data?.imported_count ?? 0} jadwal dari file ${file.name}!`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal membaca atau mengimpor file .ics"));
    } finally {
      setImportingIcs(false);
    }
  };

  const openCreateDialog = (prefillDate) => {
    const d = prefillDate || format(new Date(), "yyyy-MM-dd");
    setForm({
      title: "",
      description: "",
      date: d,
      start_time: "10:00",
      end_time: "11:00",
      location_type: "online",
      location: "Google Meet",
      meet_link: `https://meet.google.com/asli-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`,
      attendee_ids: [me?.user_id].filter(Boolean),
      sync_gcal: true,
    });
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      return toast.error("Judul meeting wajib diisi");
    }
    const token = await getAccessToken();
    if (form.sync_gcal && token) {
      // Show explicit confirmation dialog before mutating user's Google Calendar
      setCreateConfirmOpen(true);
      return;
    }
    executeCreateMeeting();
  };

  const executeCreateMeeting = () => {
    setCreateConfirmOpen(false);
    const tempId = `mtg_${Date.now()}`;
    const newMeeting = {
      id: tempId,
      title: form.title,
      description: form.description,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      location: form.location,
      meet_link: form.meet_link,
      attendee_ids: form.attendee_ids,
      gcal_synced: false,
      gcal_event_id: null,
      created_by: me?.user_id || "user_admin1",
      created_at: new Date().toISOString()
    };

    // Unmark if previously deleted with the same key
    DELETED_MEETING_IDS.delete(tempId);
    DELETED_MEETING_KEYS.delete(makeMeetingKey(newMeeting));
    persistDeletedMeetings();

    // 100% Optimistic UI update (0ms delay)
    setMeetings((prev) => {
      const next = filterAndDedupeMeetings([...prev, newMeeting]);
      MEETINGS_CACHE = next;
      try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
      return next;
    });

    playSound("meeting");
    toast.success("Jadwal meeting berhasil disimpan!");
    setCreateOpen(false);

    // Background sync with API and GCal without blocking UI
    (async () => {
      let gcalSynced = false;
      let gcalEventId = null;
      let finalMeetLink = form.meet_link;

      if (form.sync_gcal) {
        try {
          const startIso = new Date(`${form.date}T${form.start_time}:00`).toISOString();
          const endIso = new Date(`${form.date}T${form.end_time}:00`).toISOString();
          const attendeesList = (form.attendee_ids || [])
            .map((uid) => userMap[uid]?.email)
            .filter(Boolean)
            .map((email) => ({ email }));

          const gcalRes = await createEvent({
            summary: form.title,
            description: `${form.description || ""}\n\nCIRCLE Workspace Scheduled Meeting`,
            location: form.location || "Google Meet",
            start: { dateTime: startIso, timeZone: "Asia/Jakarta" },
            end: { dateTime: endIso, timeZone: "Asia/Jakarta" },
            attendees: attendeesList,
          });

          if (gcalRes && gcalRes.id) {
            gcalSynced = true;
            gcalEventId = gcalRes.id;
            if (gcalRes.hangoutLink) {
              finalMeetLink = gcalRes.hangoutLink;
            }
          }
        } catch (err) {
          console.warn("Direct Google Calendar sync note:", err);
        }
      }

      // If user already deleted this meeting while it was being created, abort saving it!
      if (isMeetingDeleted(newMeeting)) {
        if (gcalEventId) deleteEvent(gcalEventId).catch(() => {});
        return;
      }

      try {
        const payload = {
          id: tempId,
          title: form.title,
          description: form.description,
          date: form.date,
          start_time: form.start_time,
          end_time: form.end_time,
          location: form.location,
          meet_link: finalMeetLink,
          attendee_ids: form.attendee_ids,
          gcal_synced: gcalSynced,
          gcal_event_id: gcalEventId,
        };

        const res = await api.post("/meetings", payload);
        if (res.data && !isMeetingDeleted(res.data)) {
          setMeetings((prev) => {
            const next = filterAndDedupeMeetings(prev.map((m) => (m.id === tempId ? res.data : m)));
            MEETINGS_CACHE = next;
            try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
            return next;
          });
        }
      } catch (err) {
        toast.error(errMsg(err, "Gagal sinkronisasi meeting ke server"));
      }
    })();
  };

  const promptDeleteMeeting = (meeting, e) => {
    e?.stopPropagation?.();
    setDeleteConfirmMeeting(meeting);
  };

  const confirmDeleteMeeting = () => {
    if (!deleteConfirmMeeting) return;
    const { id, gcal_event_id, is_gcal, title, date, start_time } = deleteConfirmMeeting;
    const gcalId = gcal_event_id || (is_gcal || String(id).startsWith("gcal_") ? String(id).replace(/^gcal_/, "") : null);
    const mKey = makeMeetingKey(deleteConfirmMeeting);

    // Record permanent deletion locally so in-flight requests or GCal sync can never resurrect it
    if (id) DELETED_MEETING_IDS.add(String(id));
    if (gcalId) {
      DELETED_MEETING_IDS.add(String(gcalId));
      DELETED_MEETING_IDS.add(`gcal_${gcalId}`);
    }
    if (mKey) DELETED_MEETING_KEYS.add(mKey);
    persistDeletedMeetings();

    // 100% Optimistic deletion (0ms delay)
    setMeetings((prev) => {
      const next = filterAndDedupeMeetings(
        prev.filter((m) => m.id !== id && (!mKey || makeMeetingKey(m) !== mKey))
      );
      MEETINGS_CACHE = next;
      try { localStorage.setItem("circle_meetings_cache", JSON.stringify(next)); } catch {}
      return next;
    });
    setDeleteConfirmMeeting(null);
    playSound("click");
    toast.success("Jadwal meeting berhasil dihapus");

    if (gcalId) {
      deleteEvent(gcalId).catch((err) => console.warn("GCal delete note:", err));
    }

    const qs = new URLSearchParams({
      title: title || "",
      date: date || "",
      start_time: start_time || "",
      gcal_event_id: gcalId || "",
    }).toString();

    api.delete(`/meetings/${encodeURIComponent(id)}?${qs}`).catch((err) => {
      console.warn("Server meeting delete note:", err);
    });
  };

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (viewMode === "date" && selectedDate) return m.date === selectedDate;
      if (viewMode === "today") return m.date === todayStr;
      if (viewMode === "upcoming") return m.date >= todayStr;
      return true;
    });
  }, [meetings, viewMode, selectedDate, todayStr]);

  // Generate 7-day mini calendar strip
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-10" data-testid="schedule-page">
      <PageHeader
        icon={CalendarIcon}
        title={t("schedule_title")}
        subtitle={t("schedule_subtitle")}
        actions={
          <AccentButton onClick={() => openCreateDialog(selectedDate)} data-testid="new-meeting-btn">
            <Plus size={16} />
            {t("schedule_new_meeting")}
          </AccentButton>
        }
      />

      {/* Google Calendar Automatic Sync Status Banner */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl sm:rounded-3xl border bg-surface p-3.5 sm:px-5 sm:py-3.5 shadow-xs" data-testid="gcal-sync-banner">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl ${needsAuth ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
            {needsAuth ? <CalendarIcon size={18} /> : <CheckCircle2 size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xs sm:text-sm font-bold text-ink truncate">
                {needsAuth
                  ? "Sinkronisasi Otomatis Google Calendar"
                  : "Google Calendar Terhubung · Auto-Sync Aktif"}
              </p>
              {!needsAuth && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Otomatis
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-sub truncate">
              {needsAuth
                ? "Klik Hubungkan Google Calendar untuk langsung sinkron jadwal meeting dari akun Google Anda."
                : `Jadwal dari Google Calendar${connectedEmail ? ` (${connectedEmail})` : ""} otomatis masuk ke halaman Jadwal${lastSyncedAt ? ` · Diperbarui ${format(lastSyncedAt, "HH:mm")}` : ""}.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          {needsAuth ? (
            <>
              <button
                type="button"
                onClick={handleConnectGoogleCalendar}
                disabled={isLoggingIn}
                className="gsi-material-button inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold text-slate-800 shadow-xs hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                data-testid="connect-gcal-btn"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper flex items-center gap-2">
                  <div className="gsi-material-button-icon h-4 w-4 shrink-0">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: "block" }}>
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents whitespace-nowrap">
                    {isLoggingIn ? "Menyinkronkan..." : "Hubungkan Google Calendar"}
                  </span>
                </div>
              </button>
              <GhostButton
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="cursor-pointer text-sub hover:text-ink shrink-0 whitespace-nowrap"
                title="Alternatif impor manual via Link iCal atau file .ics"
                data-testid="open-import-ics-btn"
              >
                <Upload size={14} className="text-brand" />
                Import .ics
              </GhostButton>
            </>
          ) : (
            <>
              <GhostButton
                type="button"
                onClick={() => syncFromGoogleCalendar({ silent: false })}
                disabled={syncingGCal}
                className="bg-surface2 text-ink font-semibold hover:bg-border/60 cursor-pointer shrink-0 whitespace-nowrap"
                data-testid="sync-gcal-now-btn"
              >
                <RefreshCw size={15} className={syncingGCal ? "animate-spin text-brand" : "text-brand"} />
                {syncingGCal ? "Menyinkronkan..." : "Sync Sekarang"}
              </GhostButton>
              <GhostButton
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="cursor-pointer text-sub hover:text-ink shrink-0 whitespace-nowrap"
                data-testid="open-import-ics-connected-btn"
              >
                <Upload size={14} className="text-brand" />
                Pengaturan iCal
              </GhostButton>
            </>
          )}
        </div>
      </div>

      {/* Mini Calendar Strip */}
      <div className="mb-5 sm:mb-6 rounded-2xl sm:rounded-3xl border bg-surface p-2 sm:p-3 shadow-sm">
        <div className="mb-2.5 sm:mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs sm:text-sm font-bold text-ink">{t("schedule_this_week", "Minggu Ini")}</p>
          <div className="inline-flex h-9 sm:h-10 items-center gap-0.5 rounded-full border bg-surface2/80 p-0.5 sm:p-1 max-w-full overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => { setViewMode("all"); setSelectedDate(null); }}
              className={`inline-flex h-7 sm:h-8 shrink-0 items-center justify-center rounded-full px-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${viewMode === "all" ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink hover:bg-surface"}`}
            >
              {t("schedule_filter_all", "Semua")}
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("today"); setSelectedDate(todayStr); }}
              className={`inline-flex h-7 sm:h-8 shrink-0 items-center justify-center rounded-full px-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${viewMode === "today" ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink hover:bg-surface"}`}
            >
              {t("schedule_filter_today", "Hari Ini")}
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("upcoming"); setSelectedDate(null); }}
              className={`inline-flex h-7 sm:h-8 shrink-0 items-center justify-center rounded-full px-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${viewMode === "upcoming" ? "bg-brand text-white shadow-xs" : "text-sub hover:text-ink hover:bg-surface"}`}
            >
              {t("schedule_filter_upcoming", "Mendatang")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {weekDays.map((d) => {
            const dateStr = format(d, "yyyy-MM-dd");
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const count = meetings.filter((m) => m.date === dateStr).length;

            return (
              <button
                type="button"
                key={dateStr}
                onClick={() => {
                  if (isSelected && viewMode === "date") {
                    setViewMode("all");
                    setSelectedDate(null);
                  } else {
                    setSelectedDate(dateStr);
                    setViewMode("date");
                  }
                }}
                className={`flex flex-col items-center justify-center rounded-xl p-2 sm:py-2.5 sm:px-3 min-h-[58px] cursor-pointer active:scale-95 select-none transition-colors ${
                  isSelected
                    ? "bg-brand text-white shadow-md font-bold"
                    : isToday
                    ? "bg-soft-blue text-blue-900 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200"
                    : "bg-surface2 text-sub hover:text-ink hover:bg-surface2/80"
                }`}
                data-testid={`calendar-day-${dateStr}`}
              >
                <span className="text-[10px] sm:text-[11px] font-semibold">{format(d, "EEE", { locale: localeId })}</span>
                <span className="mt-0.5 sm:mt-1 text-sm sm:text-lg font-extrabold tabular-nums">{format(d, "d")}</span>
                {count > 0 && (
                  <span
                    className={`mt-1 flex h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${isSelected ? "bg-white" : "bg-brand"}`}
                    title={`${count} meeting`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Meetings List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-bold text-ink flex items-center gap-2 min-w-0">
            <span className="truncate">
              {viewMode === "date" && selectedDate
                ? `Pertemuan: ${selectedDate === todayStr ? t("schedule_filter_today", "Hari Ini") : selectedDate}`
                : viewMode === "today"
                ? t("schedule_today_meetings", "Pertemuan Hari Ini")
                : viewMode === "upcoming"
                ? t("schedule_upcoming_meetings", "Pertemuan Mendatang")
                : t("schedule_all_meetings", "Semua Pertemuan")}
            </span>
            <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs text-sub font-semibold shrink-0">
              {filteredMeetings.length}
            </span>
          </h2>
          <GhostButton
            type="button"
            onClick={() => openCreateDialog(selectedDate || todayStr)}
            className="font-semibold text-brand cursor-pointer shrink-0 px-3 sm:px-4 text-xs sm:text-sm"
          >
            <Plus size={15} /> <span className="sm:hidden">Tambah</span><span className="hidden sm:inline">Tambah untuk {selectedDate || t("schedule_filter_today", "Hari Ini")}</span>
          </GhostButton>
        </div>

        {filteredMeetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed bg-surface p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface2 text-sub">
              <CalendarIcon size={28} />
            </div>
            <h3 className="mt-4 text-sm font-bold">{t("schedule_empty_title", "Tidak ada meeting yang dijadwalkan")}</h3>
            <p className="mt-1 max-w-sm text-xs text-sub">
              {t("schedule_empty_desc", "Jadwalkan rapat bersama tim sekarang. Langsung terintegrasi otomatis dengan Google Calendar.")}
            </p>
            <AccentButton
              type="button"
              onClick={() => openCreateDialog(selectedDate || todayStr)}
              className="mt-4"
            >
              <Plus size={16} /> {t("schedule_create_btn", "Buat Jadwal Rapat")}
            </AccentButton>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
            {filteredMeetings.map((m) => {
              const isToday = m.date === todayStr;
              let dateFormatted = m.date;
              try {
                dateFormatted = format(parseISO(`${m.date}T${m.start_time}`), "EEEE, d MMMM yyyy", { locale: localeId });
              } catch (e) {}

              return (
                <div
                  key={m.id}
                  className="flex min-w-0 w-full flex-col justify-between rounded-2xl sm:rounded-3xl border bg-surface p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                  data-testid={`meeting-card-${m.id}`}
                >
                  {/* Status header */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            isToday ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-surface2 text-sub"
                          }`}
                        >
                          {isToday ? "Hari Ini" : m.date}
                        </span>
                        {m.gcal_synced && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                            Google Calendar
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => promptDeleteMeeting(m, e)}
                        className="text-sub hover:text-rose-500 transition-colors p-1.5 rounded-lg hover:bg-surface2"
                        aria-label="Hapus meeting"
                        data-testid={`delete-meeting-${m.id}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <h3 className="mt-3 text-sm font-bold text-ink leading-normal line-clamp-2">{m.title}</h3>
                    {m.description && (
                      <p className="mt-1 text-xs text-sub leading-normal line-clamp-2">{m.description}</p>
                    )}

                    {/* Time & Location */}
                    <div className="mt-4 space-y-1.5 text-xs text-sub">
                      <div className="flex items-center gap-2">
                        <Clock size={13} className="text-sub" />
                        <span>
                          {m.start_time} - {m.end_time} WIB · {dateFormatted}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={13} className="text-sub" />
                        <span className="truncate">{m.location || "Google Meet"}</span>
                      </div>
                    </div>

                    {/* Attendees Stack */}
                    {m.attendee_ids?.length > 0 && (
                      <div className="mt-4 flex items-center gap-2">
                        <span className="text-[11px] text-sub font-semibold">Peserta:</span>
                        <div className="flex -space-x-1.5">
                          {[...m.attendee_ids.slice(0, 4)].reverse().map((uid, idx) => (
                            <Avatar key={uid} user={userMap[uid]} size={24} showStatus={false} className="border-2 border-surface rounded-full relative" style={{ zIndex: idx }} />
                          ))}
                          {m.attendee_ids.length > 4 && (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-[9px] font-bold text-sub border-2 border-surface relative" style={{ zIndex: 0 }}>
                              +{m.attendee_ids.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 border-t pt-4 flex items-center gap-2">
                    {m.meet_link ? (
                      <a
                        href={m.meet_link}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-accent flex-1 flex items-center justify-center gap-2 h-10 rounded-full px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                        data-testid={`join-meet-${m.id}`}
                      >
                        <Video size={16} /> Gabung Google Meet
                      </a>
                    ) : m.html_link ? (
                      <a
                        href={m.html_link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full border bg-surface2 px-4 text-sm font-semibold text-ink hover:bg-border/60 transition-colors"
                      >
                        <ExternalLink size={16} /> Buka di Google Calendar
                      </a>
                    ) : (
                      <div className="flex-1 text-center py-2 text-xs font-medium text-sub">
                        Pertemuan Tatap Muka
                      </div>
                    )}
                    <a
                      href={m.html_link || buildGoogleCalendarTemplateUrl(m, userMap)}
                      target="_blank"
                      rel="noreferrer"
                      title="Buka atau Tambahkan ke Google Calendar Anda"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-surface2 text-sub hover:text-brand hover:border-brand/40 transition-colors"
                      data-testid={`add-to-gcal-${m.id}`}
                    >
                      <CalendarIcon size={15} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Create Meeting */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[94vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-surface p-5 sm:p-6 rounded-3xl">
          <DialogHeader className="pb-3 border-b">
            <DialogTitle className="text-lg font-bold">Buat Jadwal Meeting Baru</DialogTitle>
            <DialogDescription className="text-xs text-sub">
              Atur agenda dan waktu rapat. Jadwal disinkronkan langsung ke Google Calendar tim.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Kolom Kiri: Detail & Platform */}
              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-sub">Judul Meeting *</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Contoh: Sprint Planning & Sync Progress"
                    className="mt-1 h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none focus:ring-2 focus:ring-brand"
                    data-testid="meeting-title-input"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-sub">Deskripsi & Agenda</label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Tuliskan poin pembahasan atau agenda rapat..."
                    className="mt-1 w-full rounded-xl border bg-surface2 p-2.5 text-xs outline-none focus:ring-2 focus:ring-brand resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-sub">Lokasi & Platform</label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, location_type: "online", location: "Google Meet" })}
                      className={`flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
                        form.location_type === "online" ? "border-brand bg-brand/10 text-brand" : "bg-surface2 text-sub"
                      }`}
                    >
                      <Video size={15} /> Google Meet
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, location_type: "offline", location: "Ruang Rapat Utama" })}
                      className={`flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
                        form.location_type === "offline" ? "border-brand bg-brand/10 text-brand" : "bg-surface2 text-sub"
                      }`}
                    >
                      <MapPin size={15} /> Tatap Muka
                    </button>
                  </div>
                </div>

                {form.location_type === "online" && (
                  <div>
                    <label className="text-xs font-semibold text-sub">Link Google Meet</label>
                    <input
                      value={form.meet_link}
                      onChange={(e) => setForm({ ...form, meet_link: e.target.value })}
                      placeholder="https://meet.google.com/..."
                      className="mt-1 h-9 w-full rounded-xl border bg-surface2 px-3 text-xs outline-none font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Kolom Kanan: Waktu, Peserta & Sync Google Calendar */}
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.35fr_1fr_1fr]">
                  <div>
                    <label className="text-xs font-semibold text-sub">Tanggal</label>
                    <DatePicker
                      clearable={false}
                      value={form.date}
                      onChange={(val) => setForm({ ...form, date: val })}
                      placeholder="Tanggal"
                      className="mt-1 h-9 w-full rounded-xl border bg-surface2 px-2.5 text-xs"
                      data-testid="meeting-date-input"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-sub">Mulai</label>
                    <TimePicker
                      value={form.start_time}
                      onChange={(val) => setForm({ ...form, start_time: val })}
                      className="mt-1 h-9 w-full rounded-xl border bg-surface2 px-2.5 text-xs"
                      data-testid="meeting-start-input"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-sub">Selesai</label>
                    <TimePicker
                      value={form.end_time}
                      onChange={(val) => setForm({ ...form, end_time: val })}
                      className="mt-1 h-9 w-full rounded-xl border bg-surface2 px-2.5 text-xs"
                      data-testid="meeting-end-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-sub">Undang Anggota Tim</label>
                  <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-xl border bg-surface2 p-2">
                    {users.map((u) => {
                      const isChecked = form.attendee_ids.includes(u.user_id);
                      return (
                        <label key={u.user_id} className="flex items-center gap-2 p-1 text-xs hover:bg-surface rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const next = isChecked
                                ? form.attendee_ids.filter((id) => id !== u.user_id)
                                : [...form.attendee_ids, u.user_id];
                              setForm({ ...form, attendee_ids: next });
                            }}
                            className="rounded accent-brand"
                          />
                          <Avatar user={u} size={20} showStatus={false} />
                          <span className="font-medium text-ink truncate">{u.name}</span>
                          <span className="text-[10px] text-sub ml-auto truncate">{u.job_title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border bg-brand/5 p-3 dark:bg-brand/10">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sync_gcal}
                      onChange={(e) => setForm({ ...form, sync_gcal: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded accent-brand"
                      data-testid="sync-gcal-checkbox"
                    />
                    <div>
                      <p className="text-xs font-bold text-ink">Sinkronkan ke Google Calendar</p>
                      <p className="text-[11px] text-sub leading-tight mt-0.5">
                        Otomatis tersimpan ke kalender Google Workspace Anda.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 border-t gap-2 sm:gap-0">
              <GhostButton type="button" onClick={() => setCreateOpen(false)}>
                Batal
              </GhostButton>
              <AccentButton type="submit" disabled={submitting} data-testid="submit-meeting-btn">
                {submitting ? "Menyimpan..." : "Simpan Jadwal"}
              </AccentButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm Adding Event to Google Calendar Dialog */}
      <Dialog open={createConfirmOpen} onOpenChange={setCreateConfirmOpen}>
        <DialogContent className="max-w-md p-6 bg-surface rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ink">Tambahkan ke Google Calendar?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-sub mt-2 leading-relaxed">
            Jadwal <span className="font-bold text-ink">&ldquo;{form.title}&rdquo;</span> pada{" "}
            <span className="font-semibold text-ink">{form.date} ({form.start_time} - {form.end_time})</span> akan dibuat di Jadwal dan ditambahkan ke Google Calendar Anda.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setCreateConfirmOpen(false)}>
              Batal
            </GhostButton>
            <AccentButton type="button" onClick={executeCreateMeeting} data-testid="confirm-create-gcal-btn">
              Konfirmasi & Simpan
            </AccentButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Meeting Confirmation Dialog */}
      <Dialog open={!!deleteConfirmMeeting} onOpenChange={(v) => !v && setDeleteConfirmMeeting(null)}>
        <DialogContent className="max-w-md p-6 bg-surface rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ink">Hapus Jadwal Pertemuan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-sub mt-2 leading-relaxed">
            Apakah Anda yakin ingin menghapus jadwal rapat{" "}
            <span className="font-bold text-ink">&ldquo;{deleteConfirmMeeting?.title}&rdquo;</span>?
            {deleteConfirmMeeting?.gcal_synced && " Pertemuan ini juga akan dihapus dari Google Calendar dan tampilan jadwal Anda."}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setDeleteConfirmMeeting(null)}>
              Batal
            </GhostButton>
            <AccentButton
              type="button"
              onClick={confirmDeleteMeeting}
              className="bg-rose-500 hover:bg-rose-600 text-white"
              data-testid="confirm-delete-meeting-btn"
            >
              <Trash2 size={14} /> Hapus Jadwal
            </AccentButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Google Calendar Import (.ics / Link iCal / OAuth) Dialog */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="w-[94vw] sm:max-w-xl max-h-[90vh] overflow-y-auto bg-surface p-5 sm:p-6 rounded-3xl">
          <DialogHeader className="pb-3 border-b">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <CalendarIcon size={18} className="text-brand" />
              Hubungkan & Sinkronkan Google Calendar
            </DialogTitle>
            <DialogDescription className="text-xs text-sub">
              Gunakan <b>Link iCal</b> atau <b>File .ics</b> agar langsung terhubung untuk akun email mana pun.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Metode 1: Link Secret Address in iCal format */}
            <form onSubmit={handleImportIcsUrl} className="rounded-2xl border-2 border-brand/30 bg-brand/5 p-4 space-y-3 dark:bg-brand/10">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 whitespace-nowrap">
                    <Check size={11} /> Bebas Error 403 · Auto-Sync Semua Email
                  </span>
                  <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <Link2 size={15} className="text-brand" />
                    1. Sinkronisasi Otomatis via Link iCal Google Calendar
                  </h4>
                </div>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1.5 text-[11px] font-bold text-brand shadow-2xs hover:bg-surface2 transition-colors whitespace-nowrap"
                >
                  Buka Google Calendar Settings <ExternalLink size={12} />
                </a>
              </div>

              <ol className="list-decimal pl-4 text-xs text-sub space-y-1 leading-relaxed">
                <li>
                  Klik tombol <b>Buka Google Calendar Settings</b> di atas, lalu di menu kiri bawah <i>&ldquo;Settings for my calendars&rdquo;</i> klik nama akun Anda.
                </li>
                <li>
                  Gulir ke paling bawah ke bagian <b>Integrate calendar</b>.
                </li>
                <li>
                  Salin link pada kotak <b>Secret address in iCal format</b>, lalu tempelkan di bawah ini:
                </li>
              </ol>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={icsUrlInput}
                  onChange={(e) => setIcsUrlInput(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics"
                  className="h-10 flex-1 rounded-xl border bg-surface px-3 text-xs outline-none focus:ring-2 focus:ring-brand font-mono"
                  data-testid="ics-url-input"
                />
                <AccentButton
                  type="submit"
                  disabled={importingIcs}
                  className="shrink-0"
                  data-testid="submit-ics-url-btn"
                >
                  <RefreshCw size={14} className={importingIcs ? "animate-spin" : ""} />
                  {importingIcs ? "Mengimpor..." : "Impor & Hubungkan"}
                </AccentButton>
              </div>
              {savedIcsUrl && (
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ Link iCal sudah tersimpan dan disinkronkan otomatis setiap ada jadwal baru.
                </p>
              )}
            </form>

            {/* Metode 2: Upload File .ics dari Google Calendar */}
            <div className="rounded-2xl border bg-surface2/60 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <Upload size={15} className="text-brand" />
                  2. Upload File Kalender .ics
                </h4>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings/export"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border bg-surface px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-surface2 transition-colors whitespace-nowrap"
                >
                  Buka Export Google Calendar <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-xs text-sub leading-relaxed">
                Klik <b>Buka Export Google Calendar</b> &rarr; klik tombol <b>Export</b>, ekstrak file <code>.zip</code> hasil unduhan, lalu unggah file <code>.ics</code> Anda di sini:
              </p>
              <div>
                <input
                  ref={icsFileInputRef}
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={handleUploadIcsFile}
                  className="hidden"
                  data-testid="ics-file-input"
                />
                <GhostButton
                  type="button"
                  disabled={importingIcs}
                  onClick={() => icsFileInputRef.current?.click()}
                  className="bg-surface border font-semibold text-ink hover:bg-surface2 cursor-pointer"
                  data-testid="trigger-ics-file-btn"
                >
                  <Upload size={14} className="text-brand" />
                  {importingIcs ? "Memproses File..." : "Pilih File .ics dari Perangkat"}
                </GhostButton>
              </div>
            </div>

            <div className="rounded-2xl border bg-surface2/50 p-3.5 text-xs text-sub leading-relaxed">
              <p className="font-bold text-ink">💡 Info Sinkronisasi Kalender</p>
              <p className="mt-1">
                Gunakan <b>Link iCal Google Calendar</b> atau <b>Upload File .ics</b> di atas agar jadwal langsung terhubung dari <b>calendar.google.com</b> tanpa memerlukan konfigurasi Google Cloud Console.
              </p>
            </div>
          </div>

          <DialogFooter className="pt-3 mt-2 border-t">
            <GhostButton type="button" onClick={() => setImportModalOpen(false)}>
              Tutup
            </GhostButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

