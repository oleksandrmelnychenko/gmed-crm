import type { ReactNode } from "react";

import { tokens } from "@/components/ui-shell";
import { cn } from "@/lib/utils";

type PanelProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: boolean;
};

export function Panel({
  title,
  description,
  action,
  children,
  className,
  accent = true,
}: PanelProps) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl p-3.5",
        tokens.surface.softCard,
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {accent ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-[var(--brand)]"
              />
            ) : null}
            <h3 className={cn(tokens.text.sectionTitle, "truncate")}>
              {title}
            </h3>
          </div>
          {description ? (
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

type FieldProps = {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
};

export function Field({ label, children, hint }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-snug text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

type BannerProps = {
  tone: "error" | "success";
  children: ReactNode;
};

export function Banner({ tone, children }: BannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </div>
  );
}

export const inputBaseClassName =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const textareaBaseClassName =
  "min-h-[80px] w-full rounded-lg border border-input px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const nativeSelectClassName =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
