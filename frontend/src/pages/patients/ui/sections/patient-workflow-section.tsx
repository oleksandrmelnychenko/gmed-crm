import { useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  ListChecks,
  Plus,
  UserRound,
} from "lucide-react";

import { AdminInlineMetric } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Field,
  TabLoader,
  inputClass as formInputClassName,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { localizeWorkflowItemText } from "@/lib/workflow-labels";

import type {
  WorkflowChecklistItem,
  WorkflowChecklistResponse,
} from "../../model/detail-tab-types";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";
import { FormSection } from "../shared/patient-form-primitives";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

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

type WorkflowIntroProps = {
  l: LocalizeFn;
  workflowItemCount: number;
  canManageWorkflowChecklist: boolean;
  onCreateItemClick: () => void;
};

type WorkflowEmptyStateProps = {
  l: LocalizeFn;
  workflowItemCount: number;
};

type WorkflowOverviewProps = {
  l: LocalizeFn;
  workflowChecklist: WorkflowChecklistResponse;
  workflowChecklistGroups: WorkflowGroup[];
  overdueCount: number;
  ownerCount: number;
};

type WorkflowChecklistSectionProps = WorkflowChecklistRenderProps & {
  workflowChecklistGroups: WorkflowGroup[];
};

type WorkflowChecklistGroupProps = WorkflowChecklistRenderProps & {
  group: WorkflowGroup;
};

type WorkflowGroupSummaryProps = {
  l: LocalizeFn;
  group: WorkflowGroup;
  openItems: number;
  completedItems: number;
  groupIsActive: boolean;
};

type WorkflowChecklistItemsProps = WorkflowChecklistRenderProps & {
  items: WorkflowChecklistItem[];
};

type WorkflowChecklistItemCardProps = WorkflowChecklistRenderProps & {
  item: WorkflowChecklistItem;
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

function WorkflowContent({
  l,
  commonNotSet,
  workflowChecklist,
  workflowChecklistGroups,
  workflowItemCount,
  canManageWorkflowChecklist,
  overdueCount,
  ownerCount,
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
  return (
    <>
      <WorkflowIntro
        l={l}
        workflowItemCount={workflowItemCount}
        canManageWorkflowChecklist={canManageWorkflowChecklist}
        onCreateItemClick={onCreateItemClick}
      />

      {!workflowChecklist || workflowChecklist.items.length === 0 ? (
        <WorkflowEmptyState l={l} workflowItemCount={workflowItemCount} />
      ) : (
        <>
          <WorkflowOverview
            l={l}
            workflowChecklist={workflowChecklist}
            workflowChecklistGroups={workflowChecklistGroups}
            overdueCount={overdueCount}
            ownerCount={ownerCount}
          />

          <WorkflowChecklistSection
            l={l}
            commonNotSet={commonNotSet}
            workflowChecklistGroups={workflowChecklistGroups}
            workflowBusy={workflowBusy}
            statusColors={statusColors}
            statusLabel={statusLabel}
            formatDateTime={formatDateTime}
            roleLabel={roleLabel}
            priorityLabel={priorityLabel}
            priorityBadgeClass={priorityBadgeClass}
            onCompleteWorkflowItem={onCompleteWorkflowItem}
          />
        </>
      )}
    </>
  );
}

function WorkflowIntro({
  l,
  workflowItemCount,
  canManageWorkflowChecklist,
  onCreateItemClick,
}: WorkflowIntroProps) {
  return (
    <WorkspaceSectionIntro
      title={l("patients_workflow_cockpit")}
      description={l("patients_operational_follow_through_ownership_and_patient_bound_t")}
      accessory={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CountBadge>{workflowItemCount}</CountBadge>
          {canManageWorkflowChecklist ? (
            <Button type="button" size="sm" className="h-8 rounded-lg gap-1.5" onClick={onCreateItemClick}>
              <Plus className="size-3.5" />
              {l("patients_add_item")}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

function WorkflowEmptyState({ l, workflowItemCount }: WorkflowEmptyStateProps) {
  return (
    <FormSection
      title={l("patients_live_checklist")}
      accessory={<CountBadge>{workflowItemCount}</CountBadge>}
    >
      <EmptyCell>
        {l("patients_no_patient_workflow_checklist_yet")}
      </EmptyCell>
    </FormSection>
  );
}

function WorkflowOverview({
  l,
  workflowChecklist,
  workflowChecklistGroups,
  overdueCount,
  ownerCount,
}: WorkflowOverviewProps) {
  return (
    <FormSection
      title={l("patients_operational_overview")}
      accessory={
        <CountBadge>
          {workflowChecklistGroups.length} {l("patients_groups")}
        </CountBadge>
      }
    >
      <div className="grid gap-y-4 overflow-hidden rounded-xl border border-border px-3 pb-4 pt-4 md:grid-cols-2 xl:grid-cols-4 [&>article:not(:last-child):not(:nth-child(4n))_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={ListChecks}
          label={l("patients_open_items")}
          value={workflowChecklist.open_count}
          description={l("patients_active_tasks")}
          tone="sky"
        />
        <AdminInlineMetric
          icon={CheckCircle2}
          label={l("patients_completed")}
          value={workflowChecklist.completed_count}
          description={l("patients_closed_items")}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={Clock3}
          label={l("patients_overdue")}
          value={overdueCount}
          description={l("patients_due_open_tasks")}
          tone="amber"
        />
        <AdminInlineMetric
          icon={UserRound}
          label={l("patients_owners")}
          value={ownerCount}
          description={l("patients_active_roles_or_users")}
          tone="slate"
        />
      </div>
    </FormSection>
  );
}

function WorkflowChecklistSection({
  l,
  workflowChecklistGroups,
  ...checklistProps
}: WorkflowChecklistSectionProps) {
  return (
    <FormSection
      title={l("patients_live_checklist")}
      accessory={
        <CountBadge>
          {workflowChecklistGroups.length} {l("patients_groups")}
        </CountBadge>
      }
    >
      <div className="space-y-0">
        {workflowChecklistGroups.map((group) => (
          <WorkflowChecklistGroup key={group.key} l={l} group={group} {...checklistProps} />
        ))}
      </div>
    </FormSection>
  );
}

function WorkflowChecklistGroup({ l, group, ...checklistProps }: WorkflowChecklistGroupProps) {
  const openItems = group.items.filter((item) => !item.is_completed).length;
  const completedItems = group.items.length - openItems;
  const groupIsActive = openItems > 0;

  return (
    <details className="group relative pl-9">
      <WorkflowGroupSummary
        l={l}
        group={group}
        openItems={openItems}
        completedItems={completedItems}
        groupIsActive={groupIsActive}
      />
      <WorkflowGroupConnector />
      <WorkflowChecklistItems items={group.items} l={l} {...checklistProps} />
    </details>
  );
}

function WorkflowGroupSummary({
  l,
  group,
  openItems,
  completedItems,
  groupIsActive,
}: WorkflowGroupSummaryProps) {
  return (
    <summary className="relative grid cursor-pointer list-none gap-2 rounded-lg p-3 transition hover:bg-[#f9fdff] group-open:bg-[#f9fdff] group-open:ring-1 group-open:ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <div className="absolute -left-9 bottom-0 top-0 flex w-8 items-start justify-center pt-3">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
            groupIsActive
              ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
          )}
        >
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </span>
      </div>

      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="max-w-full truncate text-[15px] font-semibold leading-5 text-foreground">{group.label}</p>
            <span className="size-1 rounded-full bg-muted-foreground/35" />
            <span className="text-xs tabular-nums text-muted-foreground">
              {openItems} {l("patients_open_2")} / {group.items.length}{" "}
              {l("patients_total")}
            </span>
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ClipboardList className="size-3.5 shrink-0 text-muted-foreground/65" />
              {group.items.length} {l("patients_items")}
            </span>
            {completedItems > 0 ? (
              <>
                <span className="size-1 rounded-full bg-muted-foreground/35" />
                <span>
                  {completedItems} {l("patients_completed_2")}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:justify-end">
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px]",
              groupIsActive
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {groupIsActive ? l("patients_in_progress") : l("patients_done")}
          </Badge>
          <Badge
            variant="outline"
            className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
          >
            {l("patients_open_3")}:{" "}
            <span className="ml-1 font-semibold text-foreground">{openItems}</span>
          </Badge>
        </div>
      </div>
    </summary>
  );
}

function WorkflowGroupConnector() {
  return (
    <div aria-hidden="true" className="ml-20 flex h-3 items-center px-3">
      <span className="h-px w-12 bg-gradient-to-r from-transparent via-border/70 to-border/70" />
      <span className="size-1.5 rounded-full bg-border" />
      <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
    </div>
  );
}

function WorkflowChecklistItems({ items, ...checklistProps }: WorkflowChecklistItemsProps) {
  return (
    <div className="mb-2 ml-20 overflow-hidden rounded-lg bg-[#fbfdff] p-2 shadow-sm">
      <div className="grid gap-2">
        {items.map((item) => (
          <WorkflowChecklistItemCard key={item.id} item={item} {...checklistProps} />
        ))}
      </div>
    </div>
  );
}

function WorkflowChecklistItemCard({
  l,
  commonNotSet,
  workflowBusy,
  statusColors,
  statusLabel,
  formatDateTime,
  roleLabel,
  priorityLabel,
  priorityBadgeClass,
  onCompleteWorkflowItem,
  item,
}: WorkflowChecklistItemCardProps) {
  const itemStatus = workflowItemStatus(item);
  const itemStatusClass = statusColors[itemStatus] ?? "border-border/60 bg-muted/25 text-muted-foreground";

  return (
    <article
      className={cn(
        "rounded-md bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-border/40",
        item.is_completed && "opacity-75",
      )}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {localizeWorkflowItemText(item.item_key, item.item_text, l)}
            </p>
            <Badge variant="outline" className={cn("rounded-full text-[10px]", priorityBadgeClass(item.priority))}>
              {priorityLabel(item.priority)}
            </Badge>
            <Badge variant="outline" className={cn("rounded-full text-[10px]", itemStatusClass)}>
              {statusLabel(itemStatus)}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5 shrink-0 text-muted-foreground/65" />
              {item.owner_name
                ? `${item.owner_name} · ${roleLabel(item.owner_user_role ?? item.owner_role)}`
                : roleLabel(item.owner_role)}
            </span>
            <span className="size-1 rounded-full bg-muted-foreground/35" />
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5 shrink-0 text-muted-foreground/65" />
              {formatDateTime(item.due_date, commonNotSet)}
            </span>
            <span className="size-1 rounded-full bg-muted-foreground/35" />
            <span>
              {l("patients_created")}: {formatDateTime(item.created_at, commonNotSet)}
            </span>
            {item.completed_at ? (
              <>
                <span className="size-1 rounded-full bg-muted-foreground/35" />
                <span>
                  {l("patients_completed")}:{" "}
                  {formatDateTime(item.completed_at, commonNotSet)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        {!item.is_completed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 rounded-lg gap-1.5 px-2 text-xs"
            disabled={workflowBusy}
            onClick={() => void onCompleteWorkflowItem(item.id)}
          >
            <CheckCircle2 className="size-3.5" />
            {l("patients_complete")}
          </Button>
        ) : null}
      </div>
    </article>
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
