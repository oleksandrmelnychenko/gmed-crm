import { LoaderCircle, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type { PatientAssignment, StaffOption } from "../../model/list-model";

type Localize = (key: string) => string;

type PatientCuratorsDictionary = {
  common_active: string;
  common_unknown: string;
  patients_assign_owner: string;
  patients_assigned_by: string;
  patients_no_assignments: string;
  patients_records: string;
  patients_revoked: string;
};

type PatientCuratorsTabProps = {
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  assignBusy: boolean;
  canManage: boolean;
  formInputClassName: string;
  l: Localize;
  onAssign: () => void;
  onRevoke: (item: PatientAssignment) => void;
  onSelectedAssigneeChange: (value: string) => void;
  roleColors: Record<string, string>;
  roleLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  selectedAssignee: string;
  formatDateTime: (value?: string | null, fallback?: string) => string;
  t: PatientCuratorsDictionary;
  tr: Record<string, string>;
};

export function PatientCuratorsTab({
  assignments,
  assignableStaff,
  assignBusy,
  canManage,
  formInputClassName,
  l,
  onAssign,
  onRevoke,
  onSelectedAssigneeChange,
  roleColors,
  roleLabel,
  selectedAssignee,
  formatDateTime,
  t,
  tr,
}: PatientCuratorsTabProps) {
  return (
    <TabsContent value="curators" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.patients_assign_owner}
        accessory={<CountBadge>{assignments.length} {t.patients_records}</CountBadge>}
      >
        {assignments.length === 0 ? (
          <EmptyCell>{t.patients_no_assignments}</EmptyCell>
        ) : (
          <div className="space-y-2">
            {assignments.map((item) => (
              <div
                key={`${item.user_id}-${item.assigned_at}`}
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                  {item.user_name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word[0]?.toUpperCase())
                    .join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{item.user_name}</span>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        roleColors[item.user_role] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {roleLabel(item.user_role, tr)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{formatDateTime(item.assigned_at)}</span>
                    <span>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full",
                      item.revoked_at
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {item.revoked_at ? t.patients_revoked : t.common_active}
                  </Badge>
                  {canManage && !item.revoked_at ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={l("patients_revoke_assignment")}
                      className="rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                      onClick={() => onRevoke(item)}
                    >
                      <UserX className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {canManage ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label
                htmlFor="patient-curator-assign"
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
              >
                {l("patients_assigned_staff_member")}
              </Label>
              <NativeComboboxSelect
                value={selectedAssignee}


                onChange={(event) => onSelectedAssigneeChange(event.target.value ?? "")} id="patient-curator-assign" className={cn("w-full", formInputClassName)}>
                  {assignableStaff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} · {roleLabel(staff.role, tr)}
                    </option>
                  ))}
                </NativeComboboxSelect>
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                className="h-9 rounded-lg gap-1.5"
                disabled={assignBusy || !selectedAssignee}
                onClick={onAssign}
              >
                {assignBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t.patients_assign_owner}
              </Button>
            </div>
          </div>
        ) : null}
      </FormSection>
    </TabsContent>
  );
}
