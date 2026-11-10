import { ListOrdered, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import {
  appointmentSchedulerToolbarGroupClassName,
  appointmentSchedulerToolbarIconButtonClassName,
  appointmentSchedulerToolbarQueueButtonClassName,
  appointmentSchedulerToolbarRowClassName,
  appointmentSchedulerToolbarSearchButtonClassName,
  appointmentSchedulerToolbarShellClassName,
} from "@/pages/appointments/appearance/scheduler-appearance";

type DesktopSchedulerToolbarProps = {
  filtersLabel: string;
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
  filtersLabel,
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
            aria-label={filtersLabel}
            title={filtersLabel}
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className={appointmentSchedulerToolbarSearchButtonClassName}
            onClick={onOpenSearch}
          >
            <Search aria-hidden="true" className="size-3.5" />
            {searchPlaceholder}
          </Button>
          <ToolbarField label={patientFilterLabel}>
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
            className="h-8 w-[220px] shrink-0 rounded-md border-border bg-field px-3 text-xs"
          >
            <option value="__all__">{patientFilterLabel}</option>
            {patientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeComboboxSelect>
          </ToolbarField>
          <Button
            variant="outline"
            size="sm"
            className={appointmentSchedulerToolbarQueueButtonClassName}
            onClick={onOpenQueue}
          >
            <ListOrdered aria-hidden="true" className="size-3.5" />
            {queueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
