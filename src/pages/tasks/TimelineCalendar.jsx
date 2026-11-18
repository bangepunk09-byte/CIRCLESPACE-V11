import { useMemo, useState, useEffect } from "react";
import { addDays, differenceInCalendarDays, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Avatar, AvatarStack } from "../../components/common";
import { listEvents } from "../../lib/calendar";
import { hasAccessToken } from "../../lib/auth";

const colorOf = (t, labelMap) => t.card_color || labelMap[t.label_ids?.[0]]?.color || "var(--c-accent2)";

export function Timeline({ tasks, onOpen }) {
  const { labelMap, userMap } = useApp();
  const [start, setStart] = useState(() => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), -7));
  const days = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const W = 36;
  const rows = tasks.filter((t) => t.deadline || t.start_date);
  return (
    <div className="card w-full min-w-0 overflow-hidden animate-subpage-enter" data-testid="task-timeline">
      <div className="flex items-center justify-between border-b p-3"><p className="text-xs sm:text-sm font-semibold truncate">{format(start, "d MMM", { locale: localeId })} – {format(days[34], "d MMM yyyy", { locale: localeId })}</p>
        <div className="flex gap-1 shrink-0"><button onClick={() => setStart(addDays(start, -14))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label="Sebelumnya" data-testid="timeline-prev"><ChevronLeft size={16} /></button><button onClick={() => setStart(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), -7))} className="btn-ghost h-9 px-2.5 sm:px-3 text-xs font-semibold">Hari Ini</button><button onClick={() => setStart(addDays(start, 14))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label="Berikutnya" data-testid="timeline-next"><ChevronRight size={16} /></button></div></div>
      <div className="overflow-x-auto scroll-thin">
        <div className="min-w-[1400px] sm:min-w-[1480px]">
          <div className="flex border-b text-[10px] text-sub"><div className="sticky left-0 z-10 w-[140px] sm:w-[220px] shrink-0 border-r bg-surface p-2 font-semibold">Tugas</div>{days.map((d, i) => <div key={`${format(d, "yyyy-MM-dd")}-${i}`} style={{ width: W }} className={`shrink-0 py-2 text-center ${isToday(d) ? "font-bold text-brand" : ""}`}>{format(d, "d")}<br />{format(d, "EEEEE", { locale: localeId })}</div>)}</div>
          {rows.map((t) => {
            const s = new Date(t.start_date || t.deadline);
            const e = new Date(t.deadline || t.start_date);
            const off = differenceInCalendarDays(s, start);
            const len = Math.max(1, differenceInCalendarDays(e, s) + 1);
            return (
              <div key={t.id} className="group flex items-center border-b last:border-0 hover:bg-surface2">
                <button onClick={() => onOpen(t.id)} className="sticky left-0 z-10 flex w-[140px] sm:w-[220px] shrink-0 items-center gap-2 truncate border-r bg-surface group-hover:bg-surface2 p-2 text-left text-xs sm:text-sm">
                  {t.assignee_ids && t.assignee_ids.length > 1 ? (
                    <AvatarStack ids={t.assignee_ids} max={2} size={20} />
                  ) : (
                    <Avatar user={userMap[t.assignee_id || t.assignee_ids?.[0]]} size={20} showStatus={false} />
                  )}
                  <span className="truncate">{t.title}</span>
                </button>
                <div className="relative h-10" style={{ width: W * 35 }}>
                  {off + len > 0 && off < 35 && <button onClick={() => onOpen(t.id)} className="absolute top-2 h-6 rounded-full px-2 text-left text-[10px] font-semibold text-white truncate" style={{ left: Math.max(0, off) * W + 2, width: Math.min(len, 35 - Math.max(0, off)) * W - 4, background: colorOf(t, labelMap) }} data-testid={`timeline-bar-${t.id}`}>{t.number_str}</button>}
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="p-6 text-sm text-sub">Tugas yang memiliki tanggal akan tampil di Timeline.</p>}
        </div>
      </div>
    </div>
  );
}

export function Calendar({ tasks, onOpen }) {
  const { labelMap } = useApp();
  const [events, setEvents] = useState([]);
  const [month, setMonth] = useState(startOfMonth(new Date()));
  
  useEffect(() => {
    if (!hasAccessToken()) {
      setEvents([]);
      return;
    }
    let active = true;
    listEvents().then(res => {
      if (active) setEvents(res.items || []);
    }).catch(() => {
      if (active) setEvents([]);
    });
    return () => { active = false; };
  }, [month]);

  const days = useMemo(() => { const s = startOfWeek(month, { weekStartsOn: 1 }); const e = endOfWeek(endOfMonth(month), { weekStartsOn: 1 }); return Array.from({ length: differenceInCalendarDays(e, s) + 1 }, (_, i) => addDays(s, i)); }, [month]);
  const byDay = useMemo(() => { 
    const m = {}; 
    tasks.forEach((t) => { if (t.deadline) (m[format(new Date(t.deadline), "yyyy-MM-dd")] ||= []).push({ type: 'task', ...t }); });
    events.forEach((e) => { if (e.start?.dateTime) (m[format(new Date(e.start.dateTime), "yyyy-MM-dd")] ||= []).push({ type: 'event', ...e, id: e.id, title: e.summary }); });
    return m; 
  }, [tasks, events]);

  return (
    <div className="card w-full min-w-0 overflow-hidden animate-subpage-enter" data-testid="task-calendar">
      <div className="flex items-center justify-between border-b p-3"><p className="text-sm sm:text-base font-semibold capitalize">{format(month, "MMMM yyyy", { locale: localeId })}</p>
        <div className="flex gap-1"><button onClick={() => setMonth(startOfMonth(addDays(month, -1)))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label="Bulan sebelumnya" data-testid="calendar-prev"><ChevronLeft size={16} /></button><button onClick={() => setMonth(startOfMonth(new Date()))} className="btn-ghost h-9 px-2.5 sm:px-3 text-xs font-semibold">Hari Ini</button><button onClick={() => setMonth(startOfMonth(addDays(endOfMonth(month), 1)))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label="Bulan berikutnya" data-testid="calendar-next"><ChevronRight size={16} /></button></div></div>
      <div className="grid grid-cols-7 border-b text-center text-[11px] font-semibold text-sub">{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => <div key={d} className="min-w-0 py-2">{d}</div>)}</div>
      <div className="grid grid-cols-7 min-w-0">
        {days.map((d, i) => { const list = byDay[format(d, "yyyy-MM-dd")] || []; return (
          <div key={`${format(d, "yyyy-MM-dd")}-${i}`} className={`min-h-[62px] min-w-0 overflow-hidden border-b border-r p-0.5 sm:p-1 sm:min-h-[104px] ${isSameMonth(d, month) ? "" : "bg-surface2 opacity-60"}`}>
            <p className={`mb-1 text-[11px] font-semibold ${isToday(d) ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white" : "text-sub"}`}>{format(d, "d")}</p>
            {list.slice(0, 3).map((item) => (
              item.type === 'task' ? (
                <button
                  key={item.id}
                  onClick={() => onOpen(item.id)}
                  className="mb-0.5 block w-full truncate rounded-md px-1 py-0.5 text-left text-[10px] font-semibold"
                  style={{ background: `color-mix(in srgb, ${colorOf(item, labelMap)} 18%, transparent)`, color: "var(--c-text)" }}
                  data-testid={`calendar-item-${item.id}`}
                >
                  {item.title}
                </button>
              ) : (
                <a
                  key={item.id}
                  href={item.htmlLink || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-0.5 block w-full truncate rounded-md px-1 py-0.5 text-left text-[10px] font-semibold"
                  style={{ background: 'var(--c-accent1)', color: "var(--c-text)" }}
                  data-testid={`calendar-item-${item.id}`}
                >
                  📅 {item.title}
                </a>
              )
            ))}
            {list.length > 3 && <p className="text-[10px] text-sub">+{list.length - 3} lainnya</p>}
          </div>); })}
      </div>
    </div>
  );
}
