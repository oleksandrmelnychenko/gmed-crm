import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Plus } from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  EmptyCell,
  Field,
  TabLoader,
  inputClass as formInputClassName,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { localizeWorkflowItemText } from "@/lib/workflow-labels";

import type {
  WorkflowChecklistItem,
  WorkflowChecklistResponse,
} from "../../model/detail-tab-types";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";
import { FormSection } from "../shared/patient-form-primitives";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type RoleLabelFn = (value?: string | null) => string;
type PriorityLabelFn = (priority: string) => string;
type PriorityBadgeClassFn = (priority: string) => string;

type WorkflowGroup = {
  key: string;
  label: string;
  items: WorkflowChecklistItem[];
};

type WorkflowAssignee = {
  user_id: string;
  user_name: string;
  user_role: string;
};

type WorkflowFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

type PatientWorkflowTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  workflowChecklist: WorkflowChecklistResponse | null;
  workflowChecklistGroups: WorkflowGroup[];
  workflowItemCount: number;
  workflowBusy: boolean;
  workflowForm: WorkflowFormState;
  activeWorkflowAssignees: WorkflowAssignee[];
  canManageWorkflowChecklist: boolean;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDateTime: DateTimeFormatter;
  roleLabel: RoleLabelFn;
  priorityLabel: PriorityLabelFn;
  priorityBadgeClass: PriorityBadgeClassFn;
  onCompleteWorkflowItem: (itemId: string) => void | Promise<void>;
  onSubmitWorkflowItem: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onWorkflowItemTextChange: (value: string) => void;
  onWorkflowOwnerChange: (value: string) => void;
  onWorkflowPriorityChange: (value: string) => void;
  onWorkflowDueDateChange: (value: string) => void;
};

type WorkflowItemFormProps = {
  l: LocalizeFn;
  workflowForm: WorkflowFormState;
  workflowBusy: boolean;
  activeWorkflowAssignees: WorkflowAssignee[];
  roleLabel: RoleLabelFn;
  priorityLabel: PriorityLabelFn;
  onWorkflowItemTextChange: (value: string) => void;
  onWorkflowOwnerChange: (value: string) => void;
  onWorkflowPriorityChange: (value: string) => void;
  onWorkflowDueDateChange: (value: string) => void;
};

type WorkflowCreateFooterProps = {
  l: LocalizeFn;
  workflowBusy: boolean;
  itemText: string;
  onCancel: () => void;
};

type WorkflowCreateSheetProps = WorkflowItemFormProps & {
  createOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitWorkflowItem: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

type WorkflowChecklistRenderProps = {
  l: LocalizeFn;
  commonNotSet: string;
  workflowBusy: boolean;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDateTime: DateTimeFormatter;
  roleLabel: RoleLabelFn;
  priorityLabel: PriorityLabelFn;
  priorityBadgeClass: PriorityBadgeClassFn;
  onCompleteWorkflowItem: (itemId: string) => void | Promise<void>;
};

type WorkflowContentProps = WorkflowChecklistRenderProps & {
  workflowChecklist: WorkflowChecklistResponse | null;
  workflowChecklistGroups: WorkflowGroup[];
  workflowItemCount: number;
  canManageWorkflowChecklist: boolean;
  overdueCount: number;
  ownerCount: number;
  onCreateItemClick: () => void;
};

function isWorkflowItemOverdue(item: WorkflowChecklistItem) {
  if (item.is_completed || !item.due_date) return false;

  const dueAt = new Date(item.due_date).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
}

function workflowItemStatus(item: WorkflowChecklistItem) {
  return item.is_completed ? "completed" : item.linked_task_status ?? "open";
}

function WorkflowItemForm({
  l,
  workflowForm,
  workflowBusy,
  activeWorkflowAssignees,
  roleLabel,
  priorityLabel,
  onWorkflowItemTextChange,
  onWorkflowOwnerChange,
  onWorkflowPriorityChange,
  onWorkflowDueDateChange,
}: WorkflowItemFormProps) {
  return (
    <div className="space-y-4">
      <FormSection title={l("patients_task")}>
        <Field
          label={l("patients_checklist_item")}
          htmlFor="patient-workflow-item-text"
        >
          <Input
            id="patient-workflow-item-text"
            value={workflowForm.itemText}
            onChange={(event) => onWorkflowItemTextChange(event.target.value)}
            className={formInputClassName}
            placeholder={l("patients_follow_up_pm_call_concierge_handoff")}
            disabled={workflowBusy}
          />
        </Field>
      </FormSection>

      <FormSection title={l("patients_owner_and_due_date")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label={l("patients_owner")}
            htmlFor="patient-workflow-owner"
          >
            <NativeComboboxSelect
              id="patient-workflow-owner"
              value={workflowForm.ownerUserId}
              onChange={(event) => onWorkflowOwnerChange(event.target.value ?? "")}
              className={cn("w-full", formInputClassName)}
              disabled={workflowBusy}
            >
              <option value="">
                {l("patients_current_user")}
              </option>
              {activeWorkflowAssignees.map((item) => (
                <option key={item.user_id} value={item.user_id}>
                  {item.user_name} · {roleLabel(item.user_role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>

          <Field
            label={l("patients_priority")}
            htmlFor="patient-workflow-priority"
          >
            <NativeComboboxSelect
              id="patient-workflow-priority"
              value={workflowForm.priority}
              onChange={(event) => onWorkflowPriorityChange(event.target.value ?? workflowForm.priority)}
              className={cn("w-full", formInputClassName)}
              disabled={workflowBusy}
            >
              {["low", "normal", "high", "urgent"].map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabel(priority)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>

          <Field
            label={l("patients_due_at")}
            htmlFor="patient-workflow-due"
          >
            <Input
              id="patient-workflow-due"
              type="datetime-local"
              value={workflowForm.dueDate}
              onChange={(event) => onWorkflowDueDateChange(event.target.value)}
              className={formInputClassName}
              disabled={workflowBusy}
            />
          </Field>
        </div>
      </FormSection>
    </div>
  );
}


function WorkflowCreateFooter({ l, workflowBusy, itemText, onCancel }: WorkflowCreateFooterProps) {
  return (
    <>
      <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={onCancel} disabled={workflowBusy}>
        {l("patients_cancel")}
      </Button>
      <Button type="submit" className="h-9 rounded-lg gap-1.5" disabled={workflowBusy || !itemText.trim()}>
        <Plus className="size-3.5" />
        {l("patients_add")}
      </Button>
    </>
  );
}

function WorkflowCreateSheet({
  l,
  workflowForm,
  workflowBusy,
  activeWorkflowAssignees,
  roleLabel,
  priorityLabel,
  createOpen,
  onOpenChange,
  onSubmitWorkflowItem,
  onWorkflowItemTextChange,
  onWorkflowOwnerChange,
  onWorkflowPriorityChange,
  onWorkflowDueDateChange,
}: WorkflowCreateSheetProps) {
  return (
    <PatientSheetScaffold
      open={createOpen}
      onOpenChange={onOpenChange}
      title={l("patients_add_workflow_item")}
      width="form-heavy"
      onSubmit={onSubmitWorkflowItem}
      footer={
        <WorkflowCreateFooter
          l={l}
          workflowBusy={workflowBusy}
          itemText={workflowForm.itemText}
          onCancel={() => onOpenChange(false)}
        />
      }
    >
      <WorkflowItemForm
        l={l}
        workflowForm={workflowForm}
        workflowBusy={workflowBusy}
        activeWorkflowAssignees={activeWorkflowAssignees}
        roleLabel={roleLabel}
        priorityLabel={priorityLabel}
        onWorkflowItemTextChange={onWorkflowItemTextChange}
        onWorkflowOwnerChange={onWorkflowOwnerChange}
        onWorkflowPriorityChange={onWorkflowPriorityChange}
        onWorkflowDueDateChange={onWorkflowDueDateChange}
      />
    </PatientSheetScaffold>
  );
}

type WorkflowTaskRow = {
  item: WorkflowChecklistItem;
  groupLabel: string;
};

function WorkflowContent({
  l,
  commonNotSet,
  workflowChecklist,
  workflowChecklistGroups,
  canManageWorkflowChecklist,
  workflowBusy,
  statusColors,
  statusLabel,
  formatDateTime,
  roleLabel,
  priorityLabel,
  priorityBadgeClass,
  onCompleteWorkflowItem,
  onCreateItemClick,
}: WorkflowContentProps) {
  const { t } = useLang();
  const rows = useMemo<WorkflowTaskRow[]>(
    () =>
      workflowChecklistGroups.flatMap((group) =>
        group.items.map((item) => ({ item, groupLabel: group.label })),
      ),
    [workflowChecklistGroups],
  );
  const columns = useMemo<ColumnDef<WorkflowTaskRow>[]>(
    () => [
      {
        id: "task",
        label: l("patients_task"),
        accessor: (row) => localizeWorkflowItemText(row.item.item_key, row.item.item_text, l),
        sortable: true,
        searchable: true,
        required: true,
        width: 340,
        render: (row) => (
          <span
            className={cn(
              "block truncate text-xs font-medium text-foreground",
              row.item.is_completed && "text-muted-foreground line-through",
            )}
          >
            {localizeWorkflowItemText(row.item.item_key, row.item.item_text, l)}
          </span>
        ),
      },
      {
        id: "group",
        label: l("patients_groups"),
        accessor: (row) => row.groupLabel,
        sortable: true,
        width: 220,
        render: (row) => (
          <Badge variant="outline" className="rounded-full font-mono text-[10px]">
            {row.groupLabel}
          </Badge>
        ),
      },
      {
        id: "priority",
        label: l("patients_priority"),
        accessor: (row) => priorityLabel(row.item.priority),
        sortable: true,
        width: 130,
        render: (row) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              priorityBadgeClass(row.item.priority),
            )}
          >
            {priorityLabel(row.item.priority)}
          </Badge>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => statusLabel(workflowItemStatus(row.item)),
        sortable: true,
        width: 150,
        render: (row) => {
          const itemStatus = workflowItemStatus(row.item);
          return (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full font-mono text-[10px]",
                statusColors[itemStatus] ?? "border-border/60 bg-muted/25 text-muted-foreground",
              )}
            >
              {statusLabel(itemStatus)}
            </Badge>
          );
        },
      },
      {
        id: "owner",
        label: l("patients_owner"),
        accessor: (row) =>
          row.item.owner_name
            ? `${row.item.owner_name} · ${roleLabel(row.item.owner_user_role ?? row.item.owner_role)}`
            : roleLabel(row.item.owner_role),
        sortable: true,
        searchable: true,
        width: 230,
        render: (row) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {row.item.owner_name
              ? `${row.item.owner_name} · ${roleLabel(row.item.owner_user_role ?? row.item.owner_role)}`
              : roleLabel(row.item.owner_role)}
          </span>
        ),
      },
      {
        id: "due_date",
        label: l("patients_due_date"),
        accessor: (row) => row.item.due_date ?? "",
        sortable: true,
        filterType: "date",
        width: 170,
        render: (row) => (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              isWorkflowItemOverdue(row.item) ? "font-medium text-rose-600" : "text-foreground",
            )}
          >
            {formatDateTime(row.item.due_date, commonNotSet)}
          </span>
        ),
      },
    ],
    [commonNotSet, formatDateTime, l, priorityBadgeClass, priorityLabel, roleLabel, statusColors, statusLabel, t],
  );

  if (!workflowChecklist || workflowChecklist.items.length === 0) {
    return <EmptyCell>{l("patients_no_patient_workflow_checklist_yet")}</EmptyCell>;
  }

  return (
    <DataTableSurface
      rows={rows}
      columns={columns}
      rowId={(row) => row.item.id}
      dictionary={t as unknown as Record<string, string>}
      emptyState={<EmptyCell>{l("patients_no_patient_workflow_checklist_yet")}</EmptyCell>}
      toolbarStart={
        canManageWorkflowChecklist ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-lg gap-1.5"
              onClick={onCreateItemClick}
            >
              <Plus className="size-3.5" />
              {l("patients_add_item")}
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
          </>
        ) : undefined
      }
      rowActions={(row) =>
        !row.item.is_completed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-full text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700"
            disabled={workflowBusy}
            onClick={() => void onCompleteWorkflowItem(row.item.id)}
            aria-label={l("patients_complete")}
            title={l("patients_complete")}
          >
            <CheckCircle2 className="size-3.5" />
          </Button>
        ) : null
      }
      rowActionsWidth={70}
    />
  );
}

export function PatientWorkflowTab({
  l,
  commonNotSet,
  tabLoading,
  workflowChecklist,
  workflowChecklistGroups,
  workflowItemCount,
  workflowBusy,
  workflowForm,
  activeWorkflowAssignees,
  canManageWorkflowChecklist,
  statusColors,
  statusLabel,
  formatDateTime,
  roleLabel,
  priorityLabel,
  priorityBadgeClass,
  onCompleteWorkflowItem,
  onSubmitWorkflowItem,
  onWorkflowItemTextChange,
  onWorkflowOwnerChange,
  onWorkflowPriorityChange,
  onWorkflowDueDateChange,
}: PatientWorkflowTabProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const overdueCount = useMemo(
    () => workflowChecklist?.items.filter(isWorkflowItemOverdue).length ?? 0,
    [workflowChecklist],
  );
  const ownerCount = useMemo(() => {
    const owners = new Set<string>();

    for (const item of workflowChecklist?.items ?? []) {
      if (item.is_completed) continue;
      owners.add(item.owner_user_id ?? item.owner_role);
    }

    return owners.size;
  }, [workflowChecklist]);

  return (
    <TabsContent value="workflow" className="mt-4 min-h-[400px] space-y-4">
      {canManageWorkflowChecklist ? (
        <WorkflowCreateSheet
          l={l}
          workflowForm={workflowForm}
          workflowBusy={workflowBusy}
          activeWorkflowAssignees={activeWorkflowAssignees}
          roleLabel={roleLabel}
          priorityLabel={priorityLabel}
          createOpen={createOpen}
          onOpenChange={setCreateOpen}
          onSubmitWorkflowItem={onSubmitWorkflowItem}
          onWorkflowItemTextChange={onWorkflowItemTextChange}
          onWorkflowOwnerChange={onWorkflowOwnerChange}
          onWorkflowPriorityChange={onWorkflowPriorityChange}
          onWorkflowDueDateChange={onWorkflowDueDateChange}
        />
      ) : null}

      {tabLoading ? (
        <TabLoader />
      ) : (
        <WorkflowContent
          l={l}
          commonNotSet={commonNotSet}
          workflowChecklist={workflowChecklist}
          workflowChecklistGroups={workflowChecklistGroups}
          workflowItemCount={workflowItemCount}
          canManageWorkflowChecklist={canManageWorkflowChecklist}
          overdueCount={overdueCount}
          ownerCount={ownerCount}
          workflowBusy={workflowBusy}
          statusColors={statusColors}
          statusLabel={statusLabel}
          formatDateTime={formatDateTime}
          roleLabel={roleLabel}
          priorityLabel={priorityLabel}
          priorityBadgeClass={priorityBadgeClass}
          onCompleteWorkflowItem={onCompleteWorkflowItem}
          onCreateItemClick={() => setCreateOpen(true)}
        />
      )}
    </TabsContent>
  );
}
