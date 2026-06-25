import { cn } from "@/lib/utils";

type ProviderStatusPillProps = {
  active: boolean;
  className?: string;
  labels: Record<string, string>;
};

export function ProviderStatusPill({
  active,
  className,
  labels,
}: ProviderStatusPillProps) {
  const status = active ? "active" : "inactive";

  return (
    <span
      data-provider-status-pill={status}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4",
        active
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-rose-500")} />
      {active ? (labels.common_active ?? "active") : (labels.common_inactive ?? "inactive")}
    </span>
  );
}
