import type { FormEvent, ReactNode } from "react";

import {
  AdminSheetScaffold,
  SheetActionsFooter,
} from "@/components/admin-page-patterns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  onOpenChange,
  title,
  description,
  width = "default",
  maxWidthClassName,
  onSubmit,
  children,
  footer,
  headerClassName,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  width?: PatientSheetWidthPreset;
  maxWidthClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer?: ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
}) {
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
      footer={footer ? <SheetActionsFooter>{footer}</SheetActionsFooter> : undefined}
    >
      {children}
    </AdminSheetScaffold>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full border-l border-border p-0",
          maxWidthClassName ?? SHEET_WIDTH_BY_PRESET[width],
        )}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          content
        )}
      </SheetContent>
    </Sheet>
  );
}
