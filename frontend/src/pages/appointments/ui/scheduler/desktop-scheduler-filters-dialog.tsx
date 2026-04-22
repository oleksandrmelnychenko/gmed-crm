import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
            <DialogTitle className="text-sm font-semibold text-slate-950">
              {title}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 pt-1">
            <Field compact label={operationalScopeLabel}>
              <Select
                value={activeOperationalScope}
                onValueChange={(value) =>
                  onApplyOperationalScope((value as OperationalScope) ?? "all")
                }
              >
                <SelectTrigger className={cn("w-full", controlClassName)}>
                  <SelectValue>{selectedOperationalScopeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((option) => (
                    <SelectItem
                      key={`scheduler-sheet-${option.id}`}
                      value={option.id}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field compact label={quickScopeLabel}>
              <Select
                value={schedulerQuickScopeValue}
                onValueChange={(value) =>
                  onApplySchedulerQuickScope(
                    (value as SchedulerQuickScope) ?? "all",
                  )
                }
              >
                <SelectTrigger className={cn("w-full", controlClassName)}>
                  <SelectValue>{selectedSchedulerQuickScopeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {schedulerQuickScopeOptions.map((option) => (
                    <SelectItem
                      key={`scheduler-quick-${option.id}`}
                      value={option.id}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
