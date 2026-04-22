import { Button } from "@/components/ui/button";
import {
  appointmentSchedulerToolbarGroupClassName,
  appointmentSchedulerToolbarIconButtonClassName,
  appointmentSchedulerToolbarQueueButtonClassName,
  appointmentSchedulerToolbarRowClassName,
  appointmentSchedulerToolbarSearchButtonClassName,
  appointmentSchedulerToolbarShellClassName,
} from "@/pages/appointments/appearance/scheduler-appearance";

type DesktopSchedulerToolbarProps = {
  searchAriaLabel: string;
  searchPlaceholder: string;
  queueLabel: string;
  onOpenFilters: () => void;
  onOpenSearch: () => void;
  onOpenQueue: () => void;
};

export function DesktopSchedulerToolbar({
  searchAriaLabel,
  searchPlaceholder,
  queueLabel,
  onOpenFilters,
  onOpenSearch,
  onOpenQueue,
}: DesktopSchedulerToolbarProps) {
  return (
    <div className={appointmentSchedulerToolbarShellClassName}>
      <div className={appointmentSchedulerToolbarRowClassName}>
        <div className={appointmentSchedulerToolbarGroupClassName}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={appointmentSchedulerToolbarIconButtonClassName}
            onClick={onOpenFilters}
            aria-label={searchAriaLabel}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227" />
            </svg>
          </Button>
          <Button
            type="button"
            variant="outline"
            className={appointmentSchedulerToolbarSearchButtonClassName}
            onClick={onOpenSearch}
          >
            {searchPlaceholder}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={appointmentSchedulerToolbarQueueButtonClassName}
            onClick={onOpenQueue}
          >
            {queueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
