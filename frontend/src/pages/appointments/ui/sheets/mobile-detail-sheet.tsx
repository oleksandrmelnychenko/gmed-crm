import { Suspense, lazy } from "react";
import { LoaderCircle } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AppointmentMobileDetailSheetContentProps } from "@/pages/appointments/ui/sheets/mobile-detail-sheet-content";

const loadMobileDetailSheetContent = () =>
  import("@/pages/appointments/ui/sheets/mobile-detail-sheet-content");

const LazyMobileDetailSheetContent = lazy(async () => {
  const mod = await loadMobileDetailSheetContent();
  return { default: mod.MemoizedAppointmentMobileDetailSheetContent };
});

export function preloadMobileDetailSheet() {
  void loadMobileDetailSheetContent();
}

type MobileDetailSheetProps = AppointmentMobileDetailSheetContentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shouldRenderContent: boolean;
  title: string;
  loadingLabel: string;
};

export function MobileDetailSheet({
  open,
  onOpenChange,
  shouldRenderContent,
  title,
  loadingLabel,
  ...contentProps
}: MobileDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {shouldRenderContent ? (
        <Suspense
          fallback={
            <SheetContent side="right" className="w-full gap-0 sm:max-w-[860px]">
              <div className="flex min-h-0 flex-1 flex-col">
                <SheetHeader className="px-4 py-3">
                  <SheetTitle>{title}</SheetTitle>
                </SheetHeader>
                <div className="flex flex-1 items-center justify-center px-4 pb-6 pt-4 text-muted-foreground">
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  {loadingLabel}
                </div>
              </div>
            </SheetContent>
          }
        >
          <LazyMobileDetailSheetContent {...contentProps} />
        </Suspense>
      ) : null}
    </Sheet>
  );
}
