import type { ReactNode } from "react";

type DesktopSchedulerShellProps = {
  filtersDialog: ReactNode;
  searchSheet: ReactNode;
  queueSheet: ReactNode;
  toolbar: ReactNode;
  calendarSurface: ReactNode;
};

export function DesktopSchedulerShell({
  filtersDialog,
  searchSheet,
  queueSheet,
  toolbar,
  calendarSurface,
}: DesktopSchedulerShellProps) {
  return (
    <div className="grid gap-1">
      {filtersDialog}
      {searchSheet}
      {queueSheet}

      {toolbar}
      {calendarSurface}
    </div>
  );
}
