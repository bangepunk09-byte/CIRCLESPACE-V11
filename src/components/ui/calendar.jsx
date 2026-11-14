import * as React from "react";
import { startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { KVCalendarGrid } from "./date-picker";

function Calendar({ className, selected, onSelect, showQuickPresets = false, ...props }) {
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(selected || new Date()));

  React.useEffect(() => {
    if (selected) setViewMonth(startOfMonth(selected));
  }, [selected]);

  return (
    <div
      className={cn(
        "rounded-3xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm",
        className
      )}
      {...props}
    >
      <KVCalendarGrid
        selectedDate={selected || null}
        onSelectDate={(day) => onSelect?.(day)}
        viewMonth={viewMonth}
        onViewMonthChange={setViewMonth}
        showQuickPresets={showQuickPresets}
      />
    </div>
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
