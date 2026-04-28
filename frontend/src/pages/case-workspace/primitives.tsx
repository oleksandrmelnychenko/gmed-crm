import type { ReactNode } from "react";

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
        "rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {accent ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_3px_rgba(249,115,22,0.15)]"
              />
            ) : null}
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-950">
              {title}
            </h3>
          </div>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </header>
      <div className="mt-5 border-t border-slate-100 pt-5">{children}</div>
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
      <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-snug text-slate-500">{hint}</span>
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
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const textareaBaseClassName =
  "min-h-[128px] w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const nativeSelectClassName =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
