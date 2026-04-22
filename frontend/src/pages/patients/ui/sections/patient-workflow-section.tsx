import type { FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  StatCard,
  TabLoader,
  inputClass as formInputClassName,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { localizeWorkflowItemText } from "@/lib/workflow-labels";

import type {
  WorkflowChecklistItem,
  WorkflowChecklistResponse,
} from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
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
  return (
    <TabsContent value="workflow" className="space-y-6 mt-4 min-h-[400px]">
      {tabLoading ? (
        <TabLoader />
      ) : (
        <>
          <WorkspaceSectionIntro
            title={l("Workflow-Cockpit", "Панель workflow", "Workflow cockpit")}
            description={l(
              "Operative Nachverfolgung, Eigentümerschaft und patientenbezogene To-dos in einer eigenen Oberfläche.",
              "Операционное сопровождение, зоны ответственности и задачи по пациенту в отдельной рабочей зоне.",
              "Operational follow-through, ownership and patient-bound tasks in a dedicated workspace.",
            )}
            accessory={<CountBadge>{workflowItemCount}</CountBadge>}
          />

          {!workflowChecklist || workflowChecklist.items.length === 0 ? (
            <EmptyCell>
              {l("Noch keine Workflow-Checkliste für diesen Patienten.", "Чек-лист workflow для этого пациента ещё пуст.", "No patient workflow checklist yet.")}
            </EmptyCell>
          ) : (
            <>
              <FormSection
                title={l("Operativer Überblick", "Операционный обзор", "Operational overview")}
                accessory={<CountBadge>{workflowChecklistGroups.length} {l("Gruppen", "групп", "groups")}</CountBadge>}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <StatCard
                    label={l("Offene Punkte", "Открытые пункты", "Open items")}
                    value={workflowChecklist.open_count}
                    description={l("Aktive patientenbezogene Workflow-Aufgaben.", "Активные рабочие задачи по пациенту.", "Live patient-bound workflow tasks.")}
                  />
                  <StatCard
                    label={l("Abgeschlossen", "Завершено", "Completed")}
                    value={workflowChecklist.completed_count}
                    description={l("Bereits erledigte Checklistenpunkte.", "Уже закрытые пункты чек-листа.", "Checklist steps already closed.")}
                  />
                  <StatCard
                    label={l("Gruppen", "Группы", "Groups")}
                    value={workflowChecklistGroups.length}
                    description={l("Patientenaufnahme plus eigene Workstreams.", "Приём пациента плюс пользовательские workstreams.", "Patient intake plus custom workstreams.")}
                  />
                </div>
              </FormSection>

              <WorkspaceSectionIntro
                title={l("Live-Checkliste", "Живой чек-лист", "Live checklist")}
                description={l(
                  "Alle aktiven und erledigten Punkte, gruppiert nach Intake- und operativen Workstreams.",
                  "Все активные и завершённые пункты, сгруппированные по этапу intake и операционным потокам.",
                  "All active and completed items grouped by intake and operational streams.",
                )}
              />

              {workflowChecklistGroups.map((group) => (
                <FormSection
                  key={group.key}
                  title={
                    <span>
                      {group.label}
                      <span className="ml-2 text-muted-foreground font-normal">
                        · {group.items.filter((item) => !item.is_completed).length} {l("offen", "открыто", "open")} / {group.items.length} {l("gesamt", "всего", "total")}
                      </span>
                    </span>
                  }
                  accessory={<CountBadge>{group.items.length} {l("Einträge", "записей", "items")}</CountBadge>}
                >
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-xl border px-4 py-3",
                          item.is_completed
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-border/50 bg-card",
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {localizeWorkflowItemText(item.item_key, item.item_text, l)}
                              </p>
                              <Badge
                                variant="outline"
                                className={cn("rounded-full text-[10px]", priorityBadgeClass(item.priority))}
                              >
                                {priorityLabel(item.priority)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full text-[10px]",
                                  item.is_completed
                                    ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                                    : statusColors[item.linked_task_status ?? "open"] ??
                                        "border-border/60 bg-muted/25 text-muted-foreground",
                                )}
                              >
                                {item.is_completed
                                  ? statusLabel("completed")
                                  : statusLabel(item.linked_task_status ?? "open")}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span>
                                {l("Verantwortlich", "Ответственный", "Owner")}:{" "}
                                {item.owner_name
                                  ? `${item.owner_name} · ${roleLabel(item.owner_user_role ?? item.owner_role)}`
                                  : roleLabel(item.owner_role)}
                              </span>
                              <span>
                                {l("Fällig", "Срок", "Due")}: {formatDateTime(item.due_date, commonNotSet)}
                              </span>
                              <span>
                                {l("Erstellt", "Создано", "Created")}: {formatDateTime(item.created_at, commonNotSet)}
                              </span>
                              {item.completed_at ? (
                                <span>
                                  {l("Abgeschlossen", "Завершено", "Completed")}: {formatDateTime(item.completed_at, commonNotSet)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {!item.is_completed ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg"
                              disabled={workflowBusy}
                              onClick={() => void onCompleteWorkflowItem(item.id)}
                            >
                              {l("Abschließen", "Завершить", "Complete")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </FormSection>
              ))}
            </>
          )}

          {canManageWorkflowChecklist ? (
            <>
              <WorkspaceSectionIntro
                title={l("Manuelles Workflow-Element", "Ручной элемент workflow", "Manual workflow item")}
                description={l(
                  "Ergänze einen operativen Schritt, wenn der Standard-Workflow für diesen Patienten nicht ausreicht.",
                  "Добавь ручной операционный шаг, если стандартного workflow для этого пациента недостаточно.",
                  "Add an operational step when the default workflow is not enough for this patient.",
                )}
              />

              <form onSubmit={onSubmitWorkflowItem}>
                <FormSection
                  title={l("Workflow-Element hinzufügen", "Добавить элемент процесса", "Add workflow item")}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-item-text">
                        {l("Checklistenpunkt", "Пункт чеклиста", "Checklist item")}
                      </Label>
                      <Input
                        id="patient-workflow-item-text"
                        value={workflowForm.itemText}
                        onChange={(event) => onWorkflowItemTextChange(event.target.value)}
                        className={formInputClassName}
                        placeholder={l(
                          "Nachverfolgung, PM-Anruf, Concierge-Handoff dokumentieren...",
                          "Документируйте follow-up, звонок PM, передачу concierge...",
                          "Document follow-up, PM call, concierge handoff...",
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-owner">
                        {l("Verantwortlich", "Ответственный", "Owner")}
                      </Label>
                      <ShadSelect
                        value={workflowForm.ownerUserId}
                        onValueChange={(value) => onWorkflowOwnerChange(value ?? "")}
                      >
                        <SelectTrigger id="patient-workflow-owner" className={cn("w-full", formInputClassName)}>
                          <SelectValue>
                            {workflowForm.ownerUserId
                              ? (() => {
                                  const owner = activeWorkflowAssignees.find((item) => item.user_id === workflowForm.ownerUserId);
                                  return owner ? `${owner.user_name} · ${roleLabel(owner.user_role)}` : workflowForm.ownerUserId;
                                })()
                              : l("Aktueller Benutzer", "Текущий пользователь", "Current user")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{l("Aktueller Benutzer", "Текущий пользователь", "Current user")}</SelectItem>
                          {activeWorkflowAssignees.map((item) => (
                            <SelectItem key={item.user_id} value={item.user_id}>
                              {item.user_name} · {roleLabel(item.user_role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-priority">
                        {l("Priorität", "Приоритет", "Priority")}
                      </Label>
                      <ShadSelect
                        value={workflowForm.priority}
                        onValueChange={(value) => onWorkflowPriorityChange(value ?? workflowForm.priority)}
                      >
                        <SelectTrigger id="patient-workflow-priority" className={cn("w-full", formInputClassName)}>
                          <SelectValue>{priorityLabel(workflowForm.priority)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {["low", "normal", "high", "urgent"].map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {priorityLabel(priority)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-due">
                        {l("Fällig am", "Срок до", "Due at")}
                      </Label>
                      <Input
                        id="patient-workflow-due"
                        type="datetime-local"
                        value={workflowForm.dueDate}
                        onChange={(event) => onWorkflowDueDateChange(event.target.value)}
                        className={formInputClassName}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 rounded-lg gap-1.5"
                      disabled={workflowBusy || !workflowForm.itemText.trim()}
                    >
                      {l("Workflow-Element hinzufügen", "Добавить элемент процесса", "Add workflow item")}
                    </Button>
                  </div>
                </FormSection>
              </form>
            </>
          ) : null}
        </>
      )}
    </TabsContent>
  );
}
