import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Section } from "@/components/ui-shell";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const conciergeDialogContentClassName =
  "grid max-h-[calc(100dvh-1rem)] w-auto max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 motion-reduce:animate-none! [&_input]:!text-foreground [&_select]:!text-foreground [&_textarea]:!text-foreground [&_input:disabled]:!opacity-100 [&_select:disabled]:!opacity-100 [&_textarea:disabled]:!opacity-100 sm:max-h-[90vh] sm:w-full sm:max-w-5xl";

type DialogTone = "amber" | "dot" | "indigo" | "plain" | "slate";

const iconToneClass: Record<DialogTone, string> = {
  amber: "text-amber-700 dark:text-amber-300",
  dot: "bg-[var(--dot,var(--heading-marker))]",
  indigo: "text-indigo-700 dark:text-indigo-300",
  plain: "text-foreground",
  slate: "text-muted-foreground",
};

export function ConciergeDialogHeader({
  icon: Icon,
  tone = "slate",
  title,
  description,
  meta,
}: {
  icon?: LucideIcon;
  tone?: DialogTone;
  title: string;
  description?: string;
  meta?: ReactNode;
}) {
  return (
    <DialogHeader className="border-b border-border/70 px-4 py-3 pr-12 sm:pr-14">
      <div className="flex min-w-0 items-start gap-2">
        {Icon || tone === "dot" ? <span className={cn("flex shrink-0 items-center justify-center", tone === "dot" ? "mt-2 size-2 rounded-full" : "mt-0.5 size-5", iconToneClass[tone])}>
          {Icon && tone !== "dot" ? <Icon className="size-4.5" /> : null}
        </span> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-base leading-tight">{title}</DialogTitle>
            {meta}
          </div>
          {description ? (
            <DialogDescription className="mt-1 max-w-3xl text-xs leading-5">
              {description}
            </DialogDescription>
          ) : null}
        </div>
      </div>
    </DialogHeader>
  );
}

export function ConciergeDialogBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-h-0 overflow-y-auto p-3", className)}>
      {children}
    </div>
  );
}

export function ConciergeDialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-end">
      {children}
    </div>
  );
}

export function ConciergeDialogSection({
  title,
  icon: Icon,
  dot = false,
  className,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg bg-card", className)}>
      <div className="border-b border-border/60 px-3 py-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
          {dot ? <span className="size-2 shrink-0 rounded-full bg-[var(--dot,var(--heading-marker))]" /> : Icon ? <Icon className="size-3.5 text-primary" /> : null}
          {title}
        </h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function ConciergeProfileDialogSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Section
      title={title}
      className={cn(
        "!space-y-0 overflow-hidden rounded-lg bg-card [&_[data-slot=section-marker]]:bg-[var(--dot,var(--heading-marker))]",
        "[&>div:first-child]:border-b [&>div:first-child]:border-border/60 [&>div:first-child]:px-3 [&>div:first-child]:py-2",
        "[&>div:last-child]:space-y-2 [&>div:last-child]:p-3",
        className,
      )}
    >
      {children}
    </Section>
  );
}

export function ConciergeField({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid min-w-0 gap-1 text-xs font-normal text-muted-foreground", className)}>
      <span className="font-mono font-medium">{label}</span>
      {children}
    </label>
  );
}
