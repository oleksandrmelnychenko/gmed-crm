import type { FormEvent, ReactNode } from "react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Opt-in form layout matching the clinical dialogs in the lead wizard. */
export function AdminDialogScaffold({
  title,
  description,
  children,
  footer,
  onSubmit,
  noValidate,
  maxWidthClassName = "sm:max-w-[720px]",
  bodyClassName,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  noValidate?: boolean;
  maxWidthClassName?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  const content = (
    <>
      <DialogHeader className="shrink-0 border-b border-border/50 bg-card px-4 py-3 pr-14 text-left">
        <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
        {description ? <DialogDescription className="text-xs">{description}</DialogDescription> : null}
      </DialogHeader>
      <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-muted px-3 py-3 sm:px-4", bodyClassName)}>
        {children}
      </div>
      {footer ? <div className="shrink-0 border-t border-border/50 bg-card pb-[env(safe-area-inset-bottom)]">{footer}</div> : null}
    </>
  );

  return (
    <DialogContent
      overlayClassName="bg-black/40"
      className={cn("flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:pb-0", maxWidthClassName)}
      data-testid={testId}
    >
      {onSubmit ? <form onSubmit={onSubmit} noValidate={noValidate} className="flex min-h-0 flex-1 flex-col">{content}</form> : content}
    </DialogContent>
  );
}

export function AdminFormSection({ title, children, className }: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5", className)}>
      <AdminSectionTitle>{title}</AdminSectionTitle>
      {children}
    </section>
  );
}
