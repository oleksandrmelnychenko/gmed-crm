import { type ReactNode } from "react";

import { AlertCircle, ShieldAlert } from "lucide-react";

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
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        withIcon && "flex items-start gap-3",
        classes,
      )}
    >
      {withIcon ? (
        tone === "error" ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
        ) : (
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        )
      ) : null}
      <div>{children}</div>
    </div>
  );
}
