import { Suspense, lazy } from "react";
import { LoaderCircle } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
            <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[860px]">
              <AdminSheetScaffold
                title={title}
                headerClassName="px-4 py-3"
                bodyClassName="flex min-h-0 flex-1 items-center justify-center space-y-4 px-5 py-4 text-muted-foreground"
              >
                <div className="flex items-center justify-center">
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  {loadingLabel}
                </div>
              </AdminSheetScaffold>
            </SheetContent>
          }
        >
          <LazyMobileDetailSheetContent {...contentProps} />
        </Suspense>
      ) : null}
    </Sheet>
  );
}
