import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
  patientFilterLabel: string;
  patientFilterValue: string;
  patientOptions: Array<{ id: string; label: string }>;
  onPatientChange: (patientId: string) => void;
  onOpenFilters: () => void;
  onOpenSearch: () => void;
  onOpenQueue: () => void;
};

export function DesktopSchedulerToolbar({
  searchAriaLabel,
  searchPlaceholder,
  queueLabel,
  patientFilterLabel,
  patientFilterValue,
  patientOptions,
  onPatientChange,
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
          <NativeComboboxSelect
            value={patientFilterValue || "__all__"}
            onChange={(event) =>
              onPatientChange(
                event.target.value && event.target.value !== "__all__"
                  ? event.target.value
                  : "",
              )
            }
            aria-label={patientFilterLabel}
            title={patientFilterLabel}
            className="h-8 w-[220px] shrink-0 rounded-lg border-border bg-background px-3 text-[13px]"
          >
            <option value="__all__">{patientFilterLabel}</option>
            {patientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeComboboxSelect>
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
