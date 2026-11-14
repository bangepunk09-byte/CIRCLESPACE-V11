import * as React from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, X, ChevronDown, Minus, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const QUICK_TIME_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "13:00", "13:30", "14:00",
  "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
  "17:30", "18:00", "19:00", "20:00", "21:00", "23:59",
];

function safeParseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isValid(val) ? val : null;
  const s = String(val).trim();
  if (!s) return null;
  // Support YYYY-MM-DD or YYYY-MM-DDTHH:mm or full ISO
  const datePart = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split("-").map(Number);
    const local = new Date(y, m - 1, d, 0, 0, 0, 0);
    return isValid(local) ? local : null;
  }
  const parsed = parseISO(s);
  return isValid(parsed) ? parsed : null;
}

function formatTriggerDate(date, compact = false) {
  if (!date) return "";
  try {
    return format(date, compact ? "d MMM yy" : "d MMM yyyy", { locale: localeId });
  } catch {
    return "";
  }
}

export function KVCalendarGrid({
  selectedDate,
  onSelectDate,
  viewMonth,
  onViewMonthChange,
  onClear,
  showQuickPresets = true,
  footerSlot = null,
}) {
  const [pickerMode, setPickerMode] = React.useState("days"); // "days" | "months"
  const [yearCursor, setYearCursor] = React.useState(() => viewMonth.getFullYear());

  React.useEffect(() => {
    setYearCursor(viewMonth.getFullYear());
  }, [viewMonth]);

  const calendarDays = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    const days = [];
    let cur = start;
    while (cur <= end) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    return days;
  }, [viewMonth]);

  const today = new Date();
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  return (
    <div className="select-none">
      {/* Header Navigation */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPickerMode((m) => (m === "days" ? "months" : "days"))}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--c-surface2)] px-3 py-1.5 text-sm font-extrabold text-[var(--c-text)] transition-colors hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
          title="Pilih bulan atau tahun"
        >
          <span>
            {pickerMode === "months"
              ? `Tahun ${yearCursor}`
              : format(viewMonth, "MMMM yyyy", { locale: localeId })}
          </span>
          <ChevronDown
            size={14}
            className={cn("text-[var(--c-muted)] transition-transform", pickerMode === "months" && "rotate-180")}
          />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              pickerMode === "months"
                ? setYearCursor((y) => y - 1)
                : onViewMonthChange(subMonths(viewMonth, 1))
            }
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-muted)] transition-all hover:border-[var(--c-accent)]/40 hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] active:scale-95 cursor-pointer"
            aria-label="Sebelumnya"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() =>
              pickerMode === "months"
                ? setYearCursor((y) => y + 1)
                : onViewMonthChange(addMonths(viewMonth, 1))
            }
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-muted)] transition-all hover:border-[var(--c-accent)]/40 hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] active:scale-95 cursor-pointer"
            aria-label="Berikutnya"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {pickerMode === "months" ? (
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS_SHORT.map((mLabel, mIdx) => {
              const isCurrent = viewMonth.getMonth() === mIdx && viewMonth.getFullYear() === yearCursor;
              return (
                <button
                  key={mLabel}
                  type="button"
                  onClick={() => {
                    onViewMonthChange(new Date(yearCursor, mIdx, 1));
                    setPickerMode("days");
                  }}
                  className={cn(
                    "h-9 rounded-xl text-xs font-bold transition-all cursor-pointer",
                    isCurrent
                      ? "bg-[var(--c-accent)] text-white shadow-sm"
                      : "bg-[var(--c-surface2)] text-[var(--c-text)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)]"
                  )}
                >
                  {mLabel}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-1 pt-1">
            {[-5, -1, 0, 1].map((offset) => {
              const yr = offset === 0 ? today.getFullYear() : yearCursor + offset;
              return (
                <button
                  key={offset}
                  type="button"
                  onClick={() => setYearCursor(yr)}
                  className={cn(
                    "flex-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                    yearCursor === yr
                      ? "border-[var(--c-accent)] bg-[var(--s-red)] text-[var(--c-accent)]"
                      : "border-[var(--c-border)] bg-[var(--c-surface2)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
                  )}
                >
                  {offset === 0 ? `Skrg (${yr})` : yr}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Weekday Headers */}
          <div className="mb-1.5 grid grid-cols-7 text-center">
            {WEEKDAYS.map((wd, idx) => (
              <div
                key={wd}
                className={cn(
                  "py-1 text-[10px] font-bold uppercase tracking-wider",
                  idx >= 5 ? "text-[var(--c-accent)]/75" : "text-[var(--c-muted)]"
                )}
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Day Cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const selected = selectedDate ? isSameDay(day, selectedDate) : false;
              const todayCell = isToday(day);
              const dayOfWeek = day.getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

              return (
                <button
                  key={format(day, "yyyy-MM-dd")}
                  type="button"
                  onClick={() => onSelectDate(day)}
                  className={cn(
                    "relative flex h-9 w-full items-center justify-center rounded-xl text-xs tabular-nums transition-all cursor-pointer active:scale-95",
                    selected
                      ? "bg-[var(--c-accent)] font-extrabold text-white shadow-md shadow-[#FF5364]/25"
                      : todayCell
                      ? "bg-[var(--s-red)] font-extrabold text-[var(--c-accent)] ring-1 ring-[var(--c-accent)]/35 hover:bg-[var(--c-accent)] hover:text-white"
                      : inMonth
                      ? cn(
                          "font-semibold hover:bg-[var(--c-surface2)]",
                          isWeekend ? "text-[var(--c-muted)]" : "text-[var(--c-text)]"
                        )
                      : "font-medium text-[var(--c-muted)]/40 hover:bg-[var(--c-surface2)]/60 hover:text-[var(--c-muted)]"
                  )}
                >
                  <span>{format(day, "d")}</span>
                  {todayCell && !selected && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--c-accent)]" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {footerSlot}

      {/* Quick Action Presets & Clear */}
      {(showQuickPresets || onClear) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-[var(--c-border)] pt-2.5">
          {showQuickPresets ? (
            <div className="flex flex-wrap items-center gap-1">
              {[
                { label: "Hari Ini", date: today },
                { label: "Besok", date: tomorrow },
                { label: "+7 Hari", date: nextWeek },
              ].map((preset) => {
                const active = selectedDate && isSameDay(selectedDate, preset.date);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      onViewMonthChange(startOfMonth(preset.date));
                      onSelectDate(preset.date);
                    }}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer",
                      active
                        ? "bg-[var(--c-accent)] text-white"
                        : "bg-[var(--c-surface2)] text-[var(--c-text)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)]"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                onViewMonthChange(startOfMonth(today));
                onSelectDate(today);
              }}
              className="rounded-full bg-[var(--c-surface2)] px-2.5 py-1 text-[11px] font-bold text-[var(--c-text)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] transition-colors cursor-pointer"
            >
              Hari Ini
            </button>
          )}

          {onClear && selectedDate && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--c-muted)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
            >
              Hapus
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pilih tanggal",
  disabled = false,
  clearable = true,
  compact = false,
  showQuickPresets = true,
  align = "start",
  className,
  title,
  "data-testid": testId,
}) {
  const [open, setOpen] = React.useState(false);
  const parsed = React.useMemo(() => safeParseDate(value), [value]);
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(parsed || new Date()));

  React.useEffect(() => {
    if (open) {
      setViewMonth(startOfMonth(parsed || new Date()));
    }
  }, [open, parsed]);

  const handleSelect = (day) => {
    const formatted = format(day, "yyyy-MM-dd");
    onChange?.(formatted);
    setOpen(false);
  };

  const handleClear = (e) => {
    e?.stopPropagation?.();
    onChange?.("");
    setOpen(false);
  };

  const displayLabel = parsed ? formatTriggerDate(parsed, compact) : placeholder;

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title || (parsed ? format(parsed, "EEEE, d MMMM yyyy", { locale: localeId }) : placeholder)}
          data-testid={testId}
          className={cn(
            "group inline-flex items-center justify-between gap-1.5 text-left transition-all outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
            compact
              ? "h-7 rounded-lg border bg-surface2 px-2 text-[11px] font-medium"
              : "h-10 w-full rounded-xl border bg-surface2 px-3 text-sm font-medium",
            open && "border-[var(--c-accent)] bg-[var(--c-surface)] ring-2 ring-[var(--c-accent)]/15",
            !parsed && "text-[var(--c-muted)]",
            parsed && "text-[var(--c-text)]",
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <CalendarIcon
              size={compact ? 12 : 14}
              className={cn(
                "shrink-0 transition-colors",
                parsed ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] group-hover:text-[var(--c-accent)]"
              )}
            />
            <span className="truncate tabular-nums">{displayLabel}</span>
          </span>
          {clearable && parsed && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="shrink-0 rounded-full p-0.5 text-[var(--c-muted)] opacity-70 hover:bg-rose-100 hover:text-rose-600 hover:opacity-100 dark:hover:bg-rose-950/40"
              title="Hapus tanggal"
              aria-label="Hapus tanggal"
            >
              <X size={compact ? 11 : 13} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[304px] rounded-3xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-2xl"
      >
        <KVCalendarGrid
          selectedDate={parsed}
          onSelectDate={handleSelect}
          viewMonth={viewMonth}
          onViewMonthChange={setViewMonth}
          onClear={clearable ? handleClear : null}
          showQuickPresets={showQuickPresets}
        />
      </PopoverContent>
    </Popover>
  );
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pilih tanggal & jam",
  disabled = false,
  clearable = true,
  align = "start",
  className,
  "data-testid": testId,
}) {
  const [open, setOpen] = React.useState(false);

  const { dateObj, timeStr } = React.useMemo(() => {
    if (!value) return { dateObj: null, timeStr: "18:00" };
    const s = String(value).trim();
    const d = safeParseDate(s);
    const tMatch = s.match(/T(\d{2}:\d{2})/);
    let hhmm = tMatch ? tMatch[1] : null;
    if (!hhmm && d && s.includes("Z")) {
      const full = new Date(s);
      if (isValid(full)) {
        hhmm = format(full, "HH:mm");
      }
    }
    return { dateObj: d, timeStr: hhmm || "18:00" };
  }, [value]);

  const [draftDate, setDraftDate] = React.useState(dateObj);
  const [draftTime, setDraftTime] = React.useState(timeStr);
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(dateObj || new Date()));

  React.useEffect(() => {
    if (open) {
      setDraftDate(dateObj);
      setDraftTime(timeStr);
      setViewMonth(startOfMonth(dateObj || new Date()));
    }
  }, [open, dateObj, timeStr]);

  const commit = (nextDate, nextTime) => {
    if (!nextDate) {
      onChange?.("");
      return;
    }
    const ymd = format(nextDate, "yyyy-MM-dd");
    const safeTime = /^\d{2}:\d{2}$/.test(nextTime) ? nextTime : "18:00";
    onChange?.(`${ymd}T${safeTime}`);
  };

  const [hh, mm] = (draftTime || "18:00").split(":");
  const displayLabel = dateObj
    ? `${format(dateObj, "d MMM yyyy", { locale: localeId })} · ${timeStr}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "group inline-flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-surface2 px-3 text-left text-sm font-medium transition-all outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
            open && "border-[var(--c-accent)] bg-[var(--c-surface)] ring-2 ring-[var(--c-accent)]/15",
            !dateObj ? "text-[var(--c-muted)]" : "text-[var(--c-text)]",
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <CalendarIcon
              size={14}
              className={cn(
                "shrink-0 transition-colors",
                dateObj ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] group-hover:text-[var(--c-accent)]"
              )}
            />
            <span className="truncate tabular-nums">{displayLabel}</span>
          </span>
          {clearable && dateObj && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange?.("");
                setOpen(false);
              }}
              className="shrink-0 rounded-full p-0.5 text-[var(--c-muted)] opacity-70 hover:bg-rose-100 hover:text-rose-600 hover:opacity-100 dark:hover:bg-rose-950/40"
              title="Hapus deadline"
              aria-label="Hapus deadline"
            >
              <X size={13} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[316px] rounded-3xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-2xl"
      >
        <KVCalendarGrid
          selectedDate={draftDate}
          onSelectDate={(day) => {
            setDraftDate(day);
            commit(day, draftTime);
          }}
          viewMonth={viewMonth}
          onViewMonthChange={setViewMonth}
          showQuickPresets={true}
          onClear={
            clearable
              ? () => {
                  setDraftDate(null);
                  onChange?.("");
                  setOpen(false);
                }
              : null
          }
          footerSlot={
            <div className="mt-3 rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface2)] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--c-text)]">
                  <Clock size={12} className="text-[var(--c-accent)]" />
                  Waktu (WIB)
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="inline-flex items-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const nextH = String((Number(hh || 18) + 23) % 24).padStart(2, "0");
                        const nextT = `${nextH}:${mm || "00"}`;
                        setDraftTime(nextT);
                        if (draftDate) commit(draftDate, nextT);
                      }}
                      className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                      aria-label="Kurangi jam"
                    >
                      <Minus size={11} />
                    </button>
                    <span className="w-6 text-center text-xs font-extrabold tabular-nums text-[var(--c-text)]">{hh || "18"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextH = String((Number(hh || 18) + 1) % 24).padStart(2, "0");
                        const nextT = `${nextH}:${mm || "00"}`;
                        setDraftTime(nextT);
                        if (draftDate) commit(draftDate, nextT);
                      }}
                      className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                      aria-label="Tambah jam"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  <span className="text-xs font-extrabold text-[var(--c-muted)]">:</span>
                  <div className="inline-flex items-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const nextM = String((Number(mm || 0) + 45) % 60).padStart(2, "0");
                        const nextT = `${hh || "18"}:${nextM}`;
                        setDraftTime(nextT);
                        if (draftDate) commit(draftDate, nextT);
                      }}
                      className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                      aria-label="Kurangi menit"
                    >
                      <Minus size={11} />
                    </button>
                    <span className="w-6 text-center text-xs font-extrabold tabular-nums text-[var(--c-text)]">{mm || "00"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextM = String((Number(mm || 0) + 15) % 60).padStart(2, "0");
                        const nextT = `${hh || "18"}:${nextM}`;
                        setDraftTime(nextT);
                        if (draftDate) commit(draftDate, nextT);
                      }}
                      className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                      aria-label="Tambah menit"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex flex-wrap gap-1">
                  {["09:00", "12:00", "15:00", "18:00", "23:59"].map((presetT) => (
                    <button
                      key={presetT}
                      type="button"
                      onClick={() => {
                        const targetDay = draftDate || new Date();
                        setDraftDate(targetDay);
                        setDraftTime(presetT);
                        commit(targetDay, presetT);
                      }}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums transition-colors cursor-pointer",
                        draftTime === presetT
                          ? "bg-[var(--c-accent)] text-white"
                          : "bg-[var(--c-surface)] text-[var(--c-muted)] hover:text-[var(--c-accent)]"
                      )}
                    >
                      {presetT}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--c-accent)] px-2.5 py-1 text-[10px] font-bold text-white shadow-xs hover:opacity-95 cursor-pointer"
                >
                  <Check size={10} />
                  Oke
                </button>
              </div>
            </div>
          }
        />
      </PopoverContent>
    </Popover>
  );
}

export function TimePicker({
  value,
  onChange,
  placeholder = "Pilih jam",
  disabled = false,
  align = "start",
  className,
  "data-testid": testId,
}) {
  const [open, setOpen] = React.useState(false);
  const safeVal = /^\d{2}:\d{2}/.test(String(value || "")) ? String(value).slice(0, 5) : "";
  const [hh, mm] = (safeVal || "09:00").split(":");

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "group inline-flex h-10 w-full items-center justify-between gap-1.5 rounded-xl border bg-surface2 px-3 text-left text-sm font-medium transition-all outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
            open && "border-[var(--c-accent)] bg-[var(--c-surface)] ring-2 ring-[var(--c-accent)]/15",
            !safeVal ? "text-[var(--c-muted)]" : "text-[var(--c-text)]",
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <Clock
              size={14}
              className={cn(
                "shrink-0 transition-colors",
                safeVal ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] group-hover:text-[var(--c-accent)]"
              )}
            />
            <span className="truncate tabular-nums">{safeVal || placeholder}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[264px] rounded-3xl border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 shadow-2xl"
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[var(--c-text)]">
            <Clock size={13} className="text-[var(--c-accent)]" />
            Waktu
          </span>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface2)] px-1 py-0.5">
              <button
                type="button"
                onClick={() => onChange?.(`${String((Number(hh) + 23) % 24).padStart(2, "0")}:${mm}`)}
                className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                aria-label="Kurangi jam"
              >
                <Minus size={11} />
              </button>
              <span className="w-6 text-center text-xs font-extrabold tabular-nums text-[var(--c-text)]">{hh}</span>
              <button
                type="button"
                onClick={() => onChange?.(`${String((Number(hh) + 1) % 24).padStart(2, "0")}:${mm}`)}
                className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                aria-label="Tambah jam"
              >
                <Plus size={11} />
              </button>
            </div>
            <span className="text-xs font-extrabold text-[var(--c-muted)]">:</span>
            <div className="inline-flex items-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface2)] px-1 py-0.5">
              <button
                type="button"
                onClick={() => onChange?.(`${hh}:${String((Number(mm) + 55) % 60).padStart(2, "0")}`)}
                className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                aria-label="Kurangi menit"
              >
                <Minus size={11} />
              </button>
              <span className="w-6 text-center text-xs font-extrabold tabular-nums text-[var(--c-text)]">{mm}</span>
              <button
                type="button"
                onClick={() => onChange?.(`${hh}:${String((Number(mm) + 5) % 60).padStart(2, "0")}`)}
                className="flex h-6 w-5 items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)] cursor-pointer"
                aria-label="Tambah menit"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>
        <div className="grid max-h-48 grid-cols-3 gap-1 overflow-y-auto pr-0.5">
          {QUICK_TIME_SLOTS.map((slot) => {
            const active = safeVal === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  onChange?.(slot);
                  setOpen(false);
                }}
                className={cn(
                  "h-8 rounded-xl text-xs font-bold tabular-nums transition-all cursor-pointer",
                  active
                    ? "bg-[var(--c-accent)] text-white shadow-sm"
                    : "bg-[var(--c-surface2)] text-[var(--c-text)] hover:bg-[var(--s-red)] hover:text-[var(--c-accent)]"
                )}
              >
                {slot}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
