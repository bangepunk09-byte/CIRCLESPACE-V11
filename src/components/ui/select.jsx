import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const EMPTY_SENTINEL = "__CIRCLE_EMPTY__"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "group inline-flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-4 py-0 text-xs sm:text-sm font-semibold leading-normal text-ink shadow-xs transition-all hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:cursor-not-allowed disabled:opacity-50 [&>span]:inline-flex [&>span]:items-center [&>span]:truncate [&>span]:leading-normal cursor-pointer",
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 text-sub opacity-75 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-sub", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-sub", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef(({ className, children, position = "popper", sideOffset = 6, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "relative z-[250] max-h-72 min-w-[10rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-surface text-ink shadow-2xl shadow-slate-900/12 dark:shadow-black/50 duration-150 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}>
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn("p-1.5 space-y-0.5", position === "popper" &&
          "w-full min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sub", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-xl py-2 pl-3 pr-8 text-xs sm:text-sm font-medium outline-none border border-transparent transition-all duration-120 text-ink",
      "hover:bg-surface2 focus:bg-surface2 focus:text-ink",
      "data-[highlighted]:bg-surface2 data-[highlighted]:text-ink",
      "data-[state=checked]:bg-brand/10 data-[state=checked]:text-brand data-[state=checked]:font-bold",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2.5 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-brand" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

function extractText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) return extractText(node.props?.children);
  return "";
}

function normalizeOptionItem(item) {
  if (item == null) return null;
  if (typeof item === "string" || typeof item === "number") {
    const s = String(item);
    return { value: s, label: s };
  }
  if (Array.isArray(item)) {
    return { value: String(item[0] ?? ""), label: String(item[1] ?? item[0] ?? "") };
  }
  return {
    value: item.value !== undefined && item.value !== null ? String(item.value) : "",
    label: item.label !== undefined ? String(item.label) : String(item.value ?? ""),
    disabled: Boolean(item.disabled),
    color: item.color,
  };
}

function parseChildrenToEntries(children) {
  const entries = [];
  React.Children.forEach(children, (child) => {
    if (!child) return;
    if (Array.isArray(child)) {
      entries.push(...parseChildrenToEntries(child));
      return;
    }
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      entries.push(...parseChildrenToEntries(child.props?.children));
      return;
    }
    if (child.type === "optgroup") {
      const groupItems = parseChildrenToEntries(child.props?.children).filter((e) => e.kind === "item");
      entries.push({
        kind: "group",
        label: child.props?.label || "",
        items: groupItems,
      });
      return;
    }
    if (child.type === "option") {
      const text = extractText(child.props?.children);
      const val = child.props?.value !== undefined ? String(child.props.value) : text;
      entries.push({
        kind: "item",
        value: val,
        label: text || val,
        disabled: Boolean(child.props?.disabled),
      });
    }
  });
  return entries;
}

const AppSelect = React.forwardRef(
  (
    {
      value,
      defaultValue,
      onChange,
      onValueChange,
      options,
      groups,
      children,
      className,
      contentClassName,
      placeholder,
      disabled,
      style,
      align = "start",
      sideOffset = 6,
      id,
      name,
      "data-testid": testId,
      title,
      "aria-label": ariaLabel,
    },
    ref
  ) => {
    const rawEntries = React.useMemo(() => {
      if (Array.isArray(groups) && groups.length > 0) {
        return groups.map((g) => ({
          kind: "group",
          label: g.label || "",
          items: (g.options || []).map(normalizeOptionItem).filter(Boolean).map((it) => ({ kind: "item", ...it })),
        }));
      }
      if (Array.isArray(options) && options.length > 0) {
        return options.map(normalizeOptionItem).filter(Boolean).map((it) => ({ kind: "item", ...it }));
      }
      return parseChildrenToEntries(children);
    }, [groups, options, children]);

    const encode = (v) => (v === "" || v === undefined || v === null ? EMPTY_SENTINEL : String(v));
    const decode = (v) => (v === EMPTY_SENTINEL ? "" : v);

    const entries = React.useMemo(() => {
      const seen = new Set();
      const deduped = [];
      for (const entry of rawEntries) {
        if (entry.kind === "group") {
          const items = [];
          for (const it of entry.items || []) {
            const code = encode(it.value);
            if (seen.has(code)) continue;
            seen.add(code);
            items.push(it);
          }
          if (items.length > 0) {
            deduped.push({ ...entry, items });
          }
        } else {
          const code = encode(entry.value);
          if (seen.has(code)) continue;
          seen.add(code);
          deduped.push(entry);
        }
      }
      return deduped;
    }, [rawEntries]);

    const isControlled = value !== undefined;
    const mappedValue = isControlled ? encode(value === null ? "" : value) : undefined;
    const mappedDefault = defaultValue !== undefined ? encode(defaultValue === null ? "" : defaultValue) : undefined;

    const handleValChange = (rawNext) => {
      const actual = decode(rawNext);
      if (onValueChange) onValueChange(actual);
      if (onChange) onChange({ target: { value: actual, name, id } });
    };

    const renderItem = (item, idx) => {
      const encoded = encode(item.value);
      return (
        <SelectItem key={`${encoded}_${idx}`} value={encoded} disabled={item.disabled}>
          <span className="inline-flex items-center gap-2 min-w-0 leading-normal">
            {item.color && (
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span className="truncate leading-normal">{item.label}</span>
          </span>
        </SelectItem>
      );
    };

    const cleanClassName = (className || "").replace(/\btruncate\b/g, "").trim();

    return (
      <Select
        value={mappedValue}
        defaultValue={mappedDefault}
        onValueChange={handleValChange}
        disabled={disabled}
        name={name}
      >
        <SelectTrigger
          ref={ref}
          id={id}
          title={title}
          aria-label={ariaLabel}
          data-testid={testId}
          style={style}
          className={cn(!/(?:^|[\s:])w-/.test(cleanClassName) && "w-auto", cleanClassName)}
        >
          <SelectValue placeholder={placeholder || "Pilih..."} />
        </SelectTrigger>
        <SelectContent align={align} sideOffset={sideOffset} className={contentClassName}>
          {entries.map((entry, idx) => {
            if (entry.kind === "group") {
              return (
                <React.Fragment key={`grp_${entry.label}_${idx}`}>
                  {idx > 0 && <SelectSeparator />}
                  <SelectGroup>
                    {entry.label && <SelectLabel>{entry.label}</SelectLabel>}
                    {entry.items.map((it, i2) => renderItem(it, `${idx}_${i2}`))}
                  </SelectGroup>
                </React.Fragment>
              );
            }
            return renderItem(entry, idx);
          })}
        </SelectContent>
      </Select>
    );
  }
)
AppSelect.displayName = "AppSelect"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  AppSelect,
}
