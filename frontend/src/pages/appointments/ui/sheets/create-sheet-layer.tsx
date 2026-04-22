import { Suspense, lazy } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CreateAppointmentSheetProps } from "@/pages/appointments/ui/sheets/create-appointment-sheet";
import { AppointmentPreviewSheetLoadingState } from "@/pages/appointments/ui/shared/workspace-primitives";

const loadCreateAppointmentSheet = () =>
  import("@/pages/appointments/ui/sheets/create-appointment-sheet");

const LazyCreateAppointmentSheet = lazy(async () => {
  const mod = await loadCreateAppointmentSheet();
  return { default: mod.MemoizedCreateAppointmentSheet };
});

export function preloadCreateSheetLayer() {
  void loadCreateAppointmentSheet();
}

type CreateSheetLayerProps = Omit<CreateAppointmentSheetProps, "open"> & {
  open: boolean;
  title: string;
  loadingLabel: string;
};

export function CreateSheetLayer({
  open,
  title,
  loadingLabel,
  ...sheetProps
}: CreateSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={sheetProps.onOpenChange}
          title={title}
          maxWidthClassName="sm:max-w-[760px]"
          loadingLabel={loadingLabel}
        />
      }
    >
      <Sheet open={open} onOpenChange={sheetProps.onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-[760px]">
          <SheetHeader className="px-4 py-3">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <LazyCreateAppointmentSheet open={open} {...sheetProps} />
        </SheetContent>
      </Sheet>
    </Suspense>
  );
}
