import { type ReactNode } from "react";

import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export function Banner({
  tone,
  children,
  withIcon = false,
}: {
  tone: "error" | "warning";
  children: ReactNode;
  withIcon?: boolean;
}) {
  const classes =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200";
  const showIcon = withIcon || tone === "warning";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        tone === "warning"
          ? "flex w-fit max-w-full items-start gap-2 rounded-2xl border px-3 py-2 text-xs font-medium leading-5"
          : "rounded-lg border px-4 py-3 text-sm",
        tone === "error" && "animate-shake",
        showIcon && "flex items-start gap-2",
        classes,
      )}
    >
      {showIcon ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
