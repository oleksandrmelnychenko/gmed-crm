import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const conciergeDialogContentClassName =
  "grid max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[90vh] sm:w-full sm:max-w-5xl";

type DialogTone = "amber" | "indigo" | "orange" | "slate";

const iconToneClass: Record<DialogTone, string> = {
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  slate: "bg-muted text-muted-foreground",
};

export function ConciergeDialogHeader({
  icon: Icon,
  tone = "slate",
  title,
  description,
  meta,
}: {
  icon: LucideIcon;
  tone?: DialogTone;
  title: string;
  description: string;
  meta?: ReactNode;
}) {
  return (
    <DialogHeader className="border-b border-border/70 px-5 py-4 pr-14 sm:px-6 sm:py-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconToneClass[tone])}>
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg leading-tight">{title}</DialogTitle>
            {meta}
          </div>
          <DialogDescription className="mt-1 max-w-3xl text-xs leading-5 sm:text-sm">
            {description}
          </DialogDescription>
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
    <div className={cn("min-h-0 overflow-y-auto p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

export function ConciergeDialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
      {children}
    </div>
  );
}

export function ConciergeDialogSection({
  title,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border/70 bg-card p-4", className)}>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3.5 text-primary" /> : null}
        {title}
      </h3>
      {children}
    </section>
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
    <label className={cn("grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}
