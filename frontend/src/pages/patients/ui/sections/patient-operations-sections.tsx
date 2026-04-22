import { LoaderCircle, Plus, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  TabLoader,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type {
  AppointmentItem,
  CaseItem,
  OrderItem,
  RelationItem,
} from "../../model/detail-tab-types";
import type {
  PatientAssignment,
  StaffOption,
} from "../../model/list-model";
import { PatientAppointmentSheet } from "../sheets/patient-appointment-sheet";

type Localize = (de: string, ru: string, en: string) => string;

type PatientCuratorsDictionary = {
  common_active: string;
  common_unknown: string;
  patients_assign_owner: string;
  patients_assigned_by: string;
  patients_no_assignments: string;
  patients_records: string;
  patients_revoked: string;
};

type PatientCasesDictionary = {
  cases_title?: string;
  common_not_set: string;
};

type PatientOrdersDictionary = {
  orders_title?: string;
};

type PatientAppointmentsDictionary = {
  appointments_new: string;
  appointments_title?: string;
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
                      aria-label={l(
                        "Zuordnung widerrufen",
                        "Отозвать назначение",
                        "Revoke assignment",
                      )}
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
                {l("Verantwortliche Person", "Ответственный сотрудник", "Assigned staff member")}
              </Label>
              <ShadSelect
                value={selectedAssignee}
                onValueChange={(value) => onSelectedAssigneeChange(value ?? "")}
              >
                <SelectTrigger id="patient-curator-assign" className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {selectedAssignee
                      ? (() => {
                          const selectedStaff = assignableStaff.find((item) => item.id === selectedAssignee);
                          return selectedStaff
                            ? `${selectedStaff.name} · ${roleLabel(selectedStaff.role, tr)}`
                            : selectedAssignee;
                        })()
                      : t.patients_assign_owner}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assignableStaff.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.name} · {roleLabel(staff.role, tr)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
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

type PatientRelationsTabProps = {
  canManageRelations: boolean;
  formatDateTime: (value?: string | null, fallback?: string) => string;
  l: Localize;
  onCreateRelation: () => void;
  onDeleteRelation: (relationId: string) => void;
  onEditRelation: (relation: RelationItem) => void;
  onOpenPatient: (patientId: string) => void;
  relationTypeLabel: (value: string) => string;
  relations: RelationItem[];
  tabLoading: boolean;
};

export function PatientRelationsTab({
  canManageRelations,
  formatDateTime,
  l,
  onCreateRelation,
  onDeleteRelation,
  onEditRelation,
  onOpenPatient,
  relationTypeLabel,
  relations,
  tabLoading,
}: PatientRelationsTabProps) {
  return (
    <TabsContent value="relations" className="mt-4 min-h-[400px]">
      <FormSection
        title={l(
          "Beziehungen und Notfallkontakte",
          "Связи и экстренные контакты",
          "Relations and emergency contacts",
        )}
        accessory={
          canManageRelations ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={onCreateRelation}
            >
              <Plus className="size-3.5" />
              {l("Neue Beziehung", "Новая связь", "New relation")}
            </Button>
          ) : null
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : relations.length === 0 ? (
          <EmptyCell>{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {relations.map((relation) => (
              <div
                key={relation.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    {relation.related_display_name || relation.related_name}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {relationTypeLabel(relation.relation_type)}
                    </Badge>
                    {relation.is_emergency_contact ? (
                      <Badge
                        variant="outline"
                        className="rounded-full bg-rose-50 border-rose-200 text-rose-700 text-[10px]"
                      >
                        {l("Notfall", "Экстренно", "Emergency")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-0.5 text-sm text-muted-foreground">
                  {relation.related_patient_pid ? (
                    <p className="font-mono text-xs text-muted-foreground/80">
                      {relation.related_patient_pid}
                    </p>
                  ) : null}
                  {relation.phone ? <p>{relation.phone}</p> : null}
                  {relation.notes ? <p className="text-foreground">{relation.notes}</p> : null}
                  <p className="text-xs text-muted-foreground/80">
                    {formatDateTime(relation.created_at)}
                  </p>
                </div>
                {canManageRelations || relation.related_patient_id ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {relation.related_patient_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => onOpenPatient(relation.related_patient_id as string)}
                      >
                        {l("Patient öffnen", "Открыть пациента", "Open patient")}
                      </Button>
                    ) : null}
                    {canManageRelations ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => onEditRelation(relation)}
                        >
                          {l("Bearbeiten", "Редактировать", "Edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => onDeleteRelation(relation.id)}
                        >
                          {l("Löschen", "Удалить", "Delete")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}

type PatientCasesTabProps = {
  cases: CaseItem[];
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenCase: (caseId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientCasesDictionary;
  tabLoading: boolean;
};

export function PatientCasesTab({
  cases,
  emptyLabel,
  formatDate,
  onOpenCase,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientCasesTabProps) {
  return (
    <TabsContent value="cases" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.cases_title ?? "Cases"}
        accessory={<CountBadge>{cases.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : cases.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {cases.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenCase(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{item.case_id}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {item.hauptanfragegrund || t.common_not_set}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
              </button>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}

type PatientOrdersTabProps = {
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenOrder: (orderId: string) => void;
  orderPhaseLabel: (value: string) => string;
  orders: OrderItem[];
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientOrdersDictionary;
  tabLoading: boolean;
};

export function PatientOrdersTab({
  emptyLabel,
  formatDate,
  onOpenOrder,
  orderPhaseLabel,
  orders,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientOrdersTabProps) {
  return (
    <TabsContent value="orders" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.orders_title ?? "Orders"}
        accessory={<CountBadge>{orders.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : orders.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {orders.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenOrder(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{item.order_number}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {item.needs_description || item.order_number}
                </p>
                <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                  <span>{orderPhaseLabel(item.phase)}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}

type PatientAppointmentsTabProps = {
  appointmentCarePathKindLabel: (value?: string | null) => string;
  appointmentSheetOpen: boolean;
  appointmentTypeLabel: (value: string) => string;
  appointments: AppointmentItem[];
  canManage: boolean;
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onAppointmentSheetOpenChange: (open: boolean) => void;
  onOpenAppointment: (appointmentId: string) => void;
  patientId?: string;
  reload: () => void;
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientAppointmentsDictionary;
  tabLoading: boolean;
};

export function PatientAppointmentsTab({
  appointmentCarePathKindLabel,
  appointmentSheetOpen,
  appointmentTypeLabel,
  appointments,
  canManage,
  emptyLabel,
  formatDate,
  onAppointmentSheetOpenChange,
  onOpenAppointment,
  patientId,
  reload,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientAppointmentsTabProps) {
  return (
    <TabsContent value="appointments" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.appointments_title ?? "Appointments"}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{appointments.length}</CountBadge>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => onAppointmentSheetOpenChange(true)}
              >
                <Plus className="size-3.5" />
                {t.appointments_new}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : appointments.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {appointments.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenAppointment(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {appointmentTypeLabel(item.apt_type)}
                    </span>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] border-violet-200 bg-violet-50 text-violet-700"
                    >
                      {appointmentCarePathKindLabel(item.care_path_kind)}
                    </Badge>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(item.date)}</span>
                  {item.time_start ? <span>{item.time_start}</span> : null}
                  {item.provider_name ? <span>· {item.provider_name}</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </FormSection>
      {patientId && canManage ? (
        <PatientAppointmentSheet
          patientId={patientId}
          open={appointmentSheetOpen}
          onOpenChange={onAppointmentSheetOpenChange}
          onSaved={reload}
        />
      ) : null}
    </TabsContent>
  );
}
