import { Suspense, lazy, type ComponentProps } from "react";

import type { QueueSheetProps } from "@/pages/appointments/ui/sheets/queue-sheet";
import type { SearchSheetProps } from "@/pages/appointments/ui/sheets/search-sheet";
import { AppointmentPreviewSheetLoadingState } from "@/pages/appointments/ui/shared/workspace-primitives";
import { DesktopCalendarSurface } from "@/pages/appointments/ui/scheduler/desktop-calendar-surface";
import { DesktopSchedulerFiltersDialog } from "@/pages/appointments/ui/scheduler/desktop-scheduler-filters-dialog";
import { DesktopSchedulerShell } from "@/pages/appointments/ui/scheduler/desktop-scheduler-shell";
import { DesktopSchedulerToolbar } from "@/pages/appointments/ui/scheduler/desktop-scheduler-toolbar";
import { InterpreterMobileAgenda } from "@/pages/appointments/ui/scheduler/interpreter-mobile-agenda";

const loadSearchSheet = () =>
  import("@/pages/appointments/ui/sheets/search-sheet");
const loadQueueSheet = () =>
  import("@/pages/appointments/ui/sheets/queue-sheet");

const LazySearchSheet = lazy(async () => {
  const mod = await loadSearchSheet();
  return { default: mod.MemoizedSearchSheet };
});

const LazyQueueSheet = lazy(async () => {
  const mod = await loadQueueSheet();
  return { default: mod.MemoizedQueueSheet };
});

export function preloadSchedulerSearchSheet() {
  void loadSearchSheet();
}

export function preloadSchedulerQueueSheet() {
  void loadQueueSheet();
}

type SchedulerSearchLayerProps = SearchSheetProps & {
  shouldRender: boolean;
  loadingTitle: string;
  loadingLabel: string;
};

type SchedulerQueueLayerProps = QueueSheetProps & {
  shouldRender: boolean;
  loadingTitle: string;
  loadingLabel: string;
};

type AppointmentsSchedulerSurfaceProps = {
  useMobileAgenda: boolean;
  mobileAgenda: ComponentProps<typeof InterpreterMobileAgenda>;
  filtersDialog: ComponentProps<typeof DesktopSchedulerFiltersDialog>;
  searchSheet: SchedulerSearchLayerProps;
  queueSheet: SchedulerQueueLayerProps;
  toolbar: ComponentProps<typeof DesktopSchedulerToolbar>;
  calendarSurface: ComponentProps<typeof DesktopCalendarSurface>;
};

export function AppointmentsSchedulerSurface({
  useMobileAgenda,
  mobileAgenda,
  filtersDialog,
  searchSheet,
  queueSheet,
  toolbar,
  calendarSurface,
}: AppointmentsSchedulerSurfaceProps) {
  if (useMobileAgenda) {
    return <InterpreterMobileAgenda {...mobileAgenda} />;
  }

  return (
    <DesktopSchedulerShell
      filtersDialog={<DesktopSchedulerFiltersDialog {...filtersDialog} />}
      searchSheet={
        searchSheet.shouldRender ? (
          <Suspense
            fallback={
              <AppointmentPreviewSheetLoadingState
                open={searchSheet.open}
                onOpenChange={searchSheet.onOpenChange}
                title={searchSheet.loadingTitle}
                maxWidthClassName="sm:max-w-[460px]"
                loadingLabel={searchSheet.loadingLabel}
              />
            }
          >
            <LazySearchSheet {...searchSheet} />
          </Suspense>
        ) : null
      }
      queueSheet={
        queueSheet.shouldRender ? (
          <Suspense
            fallback={
              <AppointmentPreviewSheetLoadingState
                open={queueSheet.open}
                onOpenChange={queueSheet.onOpenChange}
                title={queueSheet.loadingTitle}
                maxWidthClassName="sm:max-w-[640px]"
                loadingLabel={queueSheet.loadingLabel}
              />
            }
          >
            <LazyQueueSheet {...queueSheet} />
          </Suspense>
        ) : null
      }
      toolbar={<DesktopSchedulerToolbar {...toolbar} />}
      calendarSurface={<DesktopCalendarSurface {...calendarSurface} />}
    />
  );
}
