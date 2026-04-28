import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { cn } from "@/lib/utils";
import type {
  OperationalScope,
  SchedulerQuickScope,
} from "@/pages/appointments/model/types";
import { Field } from "@/pages/appointments/ui/shared/workspace-primitives";

type DesktopSchedulerFiltersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  operationalScopeLabel: string;
  quickScopeLabel: string;
  activeOperationalScope: OperationalScope;
  onApplyOperationalScope: (scope: OperationalScope) => void;
  selectedOperationalScopeLabel: string;
  schedulerQuickScopeValue: SchedulerQuickScope;
  onApplySchedulerQuickScope: (scope: SchedulerQuickScope) => void;
  selectedSchedulerQuickScopeLabel: string;
  scopeOptions: Array<{ id: OperationalScope; label: string }>;
  schedulerQuickScopeOptions: Array<{
    id: SchedulerQuickScope;
    label: string;
  }>;
  controlClassName: string;
};

export function DesktopSchedulerFiltersDialog({
  open,
  onOpenChange,
  title,
  operationalScopeLabel,
  quickScopeLabel,
  activeOperationalScope,
  onApplyOperationalScope,
  selectedOperationalScopeLabel,
  schedulerQuickScopeValue,
  onApplySchedulerQuickScope,
  selectedSchedulerQuickScopeLabel,
  scopeOptions,
  schedulerQuickScopeOptions,
  controlClassName,
}: DesktopSchedulerFiltersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-sm font-semibold text-foreground">
              {title}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 pt-1">
            <Field compact label={operationalScopeLabel}>
              <NativeComboboxSelect
                value={activeOperationalScope}
                onChange={(event) =>
                  onApplyOperationalScope(
                    (event.target.value as OperationalScope) || "all",
                  )
                }
                title={selectedOperationalScopeLabel}
                className={cn("w-full", controlClassName)}
              >
                {scopeOptions.map((option) => (
                  <option
                    key={`scheduler-sheet-${option.id}`}
                    value={option.id}
                  >
                    {option.label}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field compact label={quickScopeLabel}>
              <NativeComboboxSelect
                value={schedulerQuickScopeValue}
                onChange={(event) =>
                  onApplySchedulerQuickScope(
                    (event.target.value as SchedulerQuickScope) || "all",
                  )
                }
                title={selectedSchedulerQuickScopeLabel}
                className={cn("w-full", controlClassName)}
              >
                {schedulerQuickScopeOptions.map((option) => (
                  <option
                    key={`scheduler-quick-${option.id}`}
                    value={option.id}
                  >
                    {option.label}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
