import { cn } from "@/lib/utils";

export function ContextCard({
  label,
  value,
  meta,
  variant = "default",
}: {
  label: string;
  value: string;
  meta: string;
  variant?: "default" | "snapshot";
}) {
  const isSnapshot = variant === "snapshot";
  return (
    <div
      className={cn(
        isSnapshot ? "min-w-0" : "rounded-xl border border-border/50 bg-card px-4 py-3",
      )}
    >
      <p
        className={cn(
          "font-medium text-muted-foreground",
          isSnapshot ? "text-[11.5px] leading-tight" : "text-[11.5px] leading-tight",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "break-words",
          isSnapshot
            ? "mt-0.5 text-sm font-semibold text-slate-900 leading-tight"
            : "mt-2 text-sm font-semibold text-foreground",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          isSnapshot
            ? "mt-0.5 text-sm text-slate-600 leading-tight"
            : "mt-1 text-xs text-muted-foreground",
        )}
      >
        {meta}
      </p>
    </div>
  );
}
