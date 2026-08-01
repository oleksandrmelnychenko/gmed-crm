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
    <div>
      {filtersDialog}
      {searchSheet}
      {queueSheet}

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        {toolbar}
        {calendarSurface}
      </div>
    </div>
  );
}
