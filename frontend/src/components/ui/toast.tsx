import { useEffect, useState } from "react";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
  duration: number;
};

type Listener = (items: ToastItem[]) => void;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function publish() {
  listeners.forEach((l) => l(items));
}

function scheduleAutoDismiss(id: number, duration: number) {
  if (duration <= 0) return;
  const previous = timers.get(id);
  if (previous !== undefined) window.clearTimeout(previous);
  timers.set(id, window.setTimeout(() => remove(id), duration));
}

function add(message: string, kind: ToastKind, duration = 3500) {
  // Collapse rapid duplicates (e.g. clicking Save repeatedly): if an identical
  // toast is already visible, just refresh its dismiss timer instead of
  // stacking another copy.
  const existing = items.find((i) => i.message === message && i.kind === kind);
  if (existing) {
    scheduleAutoDismiss(existing.id, duration);
    return;
  }
  const id = ++seq;
  items = [...items, { id, message, kind, duration }];
  publish();
  scheduleAutoDismiss(id, duration);
}

function remove(id: number) {
  const timerId = timers.get(id);
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
    timers.delete(id);
  }
  items = items.filter((i) => i.id !== id);
  publish();
}

export const toast = {
  success: (message: string, duration?: number) => add(message, "success", duration),
  error: (message: string, duration?: number) => add(message, "error", duration),
  warning: (message: string, duration?: number) => add(message, "warning", duration),
  info: (message: string, duration?: number) => add(message, "info", duration),
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {list.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const { kind, message } = item;
  const { t } = useLang();
  const palette = {
    success: {
      Icon: Check,
      ring: "border-emerald-200 bg-white",
      iconBg: "bg-emerald-100 text-emerald-700",
    },
    error: {
      Icon: CircleAlert,
      ring: "border-rose-200 bg-white",
      iconBg: "bg-rose-100 text-rose-700",
    },
    warning: {
      Icon: TriangleAlert,
      ring: "border-amber-200 bg-white",
      iconBg: "bg-amber-100 text-amber-700",
    },
    info: {
      Icon: Info,
      ring: "border-sky-200 bg-white",
      iconBg: "bg-sky-100 text-sky-700",
    },
  }[kind];
  const { Icon } = palette;

  return (
    <div
      className={cn(
        "pointer-events-auto min-w-[260px] max-w-[360px] flex items-start gap-3 rounded-xl border px-3.5 py-2.5 shadow-[0_10px_32px_rgba(15,23,42,0.08)] animate-in slide-in-from-right-4 fade-in duration-200",
        palette.ring
      )}
      role="status"
    >
      <div className={cn("flex items-center justify-center size-7 rounded-full shrink-0", palette.iconBg)}>
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <p className="flex-1 text-[13px] text-foreground leading-[1.35] pt-0.5">{message}</p>
      <button
        type="button"
        aria-label={t.common_dismiss}
        onClick={() => remove(item.id)}
        className="shrink-0 size-6 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
