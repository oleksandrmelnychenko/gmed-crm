import type { FormEvent, ReactNode } from "react";

import {
  AdminSheetScaffold,
  SheetActionsFooter,
} from "@/components/admin-page-patterns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PatientSheetWidthPreset = "narrow" | "default" | "form-heavy" | "detail-wide";

const SHEET_WIDTH_BY_PRESET: Record<PatientSheetWidthPreset, string> = {
  narrow: "sm:max-w-[560px]",
  default: "sm:max-w-[720px]",
  "form-heavy": "sm:max-w-[760px]",
  "detail-wide": "sm:max-w-[860px]",
};

export function PatientSheetScaffold({
  open,
  dirty,
  requireChanges,
  onOpenChange,
  title,
  description,
  width = "default",
  presentation = "sheet",
  maxWidthClassName,
  onSubmit,
  noValidate,
  children,
  footer,
  footerError,
  headerClassName,
  bodyClassName,
  bodyWrapperClassName,
}: {
  open: boolean;
  dirty?: boolean;
  requireChanges?: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  width?: PatientSheetWidthPreset;
  /** Clinical editors share the centered modal layout used in the lead wizard. */
  presentation?: "sheet" | "dialog";
  maxWidthClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** The form checks its fields itself and shows the app's messages, not the browser's. */
  noValidate?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  footerError?: ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  bodyWrapperClassName?: string;
}) {
  if (presentation === "dialog") {
    const dialogContent = (
      <>
        <DialogHeader className={cn("shrink-0 border-b border-border/50 bg-card px-4 py-3 pr-14 text-left", headerClassName)}>
          <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
          {description ? <DialogDescription className="text-xs">{description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted px-3 py-3 sm:px-4", bodyClassName)}>
          <div className={cn("min-w-0 space-y-3", bodyWrapperClassName)}>{children}</div>
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border/50 bg-card pb-[env(safe-area-inset-bottom)]">
            <SheetActionsFooter error={footerError}>{footer}</SheetActionsFooter>
          </div>
        ) : null}
      </>
    );
    return (
      <Dialog open={open} onOpenChange={onOpenChange} dirty={dirty} requireChanges={requireChanges}>
        <DialogContent
          overlayClassName="bg-black/40"
          className={cn(
            "flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:w-[calc(100vw-2rem)] sm:pb-0",
            maxWidthClassName ?? SHEET_WIDTH_BY_PRESET[width],
          )}
        >
          {onSubmit ? (
            <form onSubmit={onSubmit} noValidate={noValidate} className="flex min-h-0 flex-1 flex-col">{dialogContent}</form>
          ) : dialogContent}
        </DialogContent>
      </Dialog>
    );
  }

  const content = (
    <AdminSheetScaffold
      title={title}
      description={description}
      headerClassName={cn("px-4 py-3", headerClassName)}
      bodyClassName={cn(
        "min-h-0 overscroll-y-contain",
        bodyClassName,
        "space-y-4 px-5 py-4",
      )}
      bodyWrapperClassName={bodyWrapperClassName}
      footer={footer ? <SheetActionsFooter error={footerError}>{footer}</SheetActionsFooter> : undefined}
    >
      {children}
    </AdminSheetScaffold>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} dirty={dirty} requireChanges={requireChanges}>
      <SheetContent
        side="right"
        className={cn(
          "w-full border-l border-border p-0",
          maxWidthClassName ?? SHEET_WIDTH_BY_PRESET[width],
        )}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate={noValidate} className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          content
        )}
      </SheetContent>
    </Sheet>
  );
}
