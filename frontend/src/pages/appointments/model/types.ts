export type AppointmentWorkspaceTab =
  | "overview"
  | "timeline"
  | "coordination"
  | "clinical"
  | "workflow"
  | "services"
  | "notes";

export type AppointmentTimelineKind =
  | "workflow"
  | "interpreter"
  | "clinical"
  | "followup"
  | "concierge"
  | "communication";

export type AppointmentTimelineTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type AppointmentTimelineEvent = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
  kind: AppointmentTimelineKind;
  tone: AppointmentTimelineTone;
};

export type AppointmentWorkflowSummary = {
  visibleSurfaceCount: number;
  transitionSurfaceCount: number;
  logisticsSurfaceCount: number;
  backlogSurfaceCount: number;
  openIssueCount: number;
  checklistCompletedCount: number;
  followUpQueueCount: number;
  interpreterGate: "not_required" | "ready" | "pending";
};

export type InterpreterMobileAgendaItem = {
  id: string;
  date: string;
  time_start: string | null;
  time_end?: string | null;
  status: string;
  interpreter_response?: string | null;
};

export type InterpreterMobileAgendaSection<
  T extends InterpreterMobileAgendaItem,
> = {
  date: string;
  label: string;
  itemCount: number;
  pendingResponseCount: number;
  items: T[];
};

export type AppointmentKind = "medical" | "non_medical" | "internal";

export type AppointmentCarePathKind =
  | "regular"
  | "preventive"
  | "control"
  | "followup";

export type AppointmentStatus =
  | "planned"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type InterpreterResponse =
  | "pending"
  | "accepted"
  | "declined"
  | "discussion";

export type AppointmentRecurrenceFrequency = "daily" | "weekly" | "monthly";

export type AppointmentRecurringActionScope =
  | "single"
  | "following"
  | "series";

export type AppointmentListItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  type: AppointmentKind;
  care_path_kind: AppointmentCarePathKind | null;
  status: AppointmentStatus;
  location: string | null;
  interpreter_response: InterpreterResponse | null;
  checklist_phase: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  interpreter_id: string | null;
  interpreter_name: string | null;
  recurrence_series_id: string | null;
  recurrence_frequency: AppointmentRecurrenceFrequency | null;
  recurrence_interval: number | null;
  recurrence_count: number | null;
  recurrence_until: string | null;
  recurrence_index: number;
  recurrence_series_size: number;
  is_blocked: boolean;
};

export type AppointmentRequestStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "converted"
  | "cancelled";

export type AppointmentRequestItem = {
  id: string;
  patient_id: string;
  patient_pid: string | null;
  patient_name: string | null;
  order_id: string | null;
  order_number: string | null;
  appointment_type: AppointmentKind;
  care_path_kind: AppointmentCarePathKind | null;
  preferred_date_from: string | null;
  preferred_date_to: string | null;
  preferred_time_of_day: string | null;
  requested_provider_id: string | null;
  requested_provider_name: string | null;
  requested_doctor_id: string | null;
  requested_doctor_name: string | null;
  specialty: string | null;
  location: string | null;
  reason: string | null;
  notes: string | null;
  status: AppointmentRequestStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  requested_at: string;
  converted_appointment_id: string | null;
  converted_appointment_title: string | null;
  converted_appointment_date: string | null;
};

type RecurringScopePreviewItem = {
  id: string;
  date: string;
  status: AppointmentStatus;
  recurrence_index: number;
  open_checklist_count: number;
};

export type RecurringLineageHistoryItem = {
  series_id: string;
  parent_series_id: string | null;
  split_from_appointment_id: string | null;
  split_from_index: number | null;
  first_date: string;
  last_date: string;
  total_occurrences: number;
  active_occurrences: number;
  completed_occurrences: number;
  cancelled_occurrences: number;
  relation: "ancestor" | "current" | "descendant" | string;
  depth: number;
};

export type AppointmentDetail = AppointmentListItem & {
  category: string | null;
  preparation_notes: string | null;
  followup_notes: string | null;
  notes: string | null;
  order_id: string | null;
  order_number: string | null;
  recurrence_parent_series_id: string | null;
  recurrence_split_from_appointment_id: string | null;
  recurrence_split_from_index: number | null;
  recurring_scope_preview: RecurringScopePreviewItem[];
  recurring_lineage_history: RecurringLineageHistoryItem[];
  created_at: string;
};

export type AppointmentAttentionReason = {
  key: string;
  fallback?: string | null;
  values?: Record<string, string | number | boolean | null | undefined> | null;
};

export type AppointmentAttentionItem = AppointmentListItem & {
  attention_score: number;
  reasons: string[];
  reason_details?: AppointmentAttentionReason[];
  next_due_at: string | null;
};

type ConflictItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  type: AppointmentKind;
  status: AppointmentStatus;
  patient_name: string;
  patient_pid: string;
  provider_name: string | null;
  doctor_name: string | null;
  interpreter_name: string | null;
  is_blocked: boolean;
};

export type ConflictSummary = {
  patient_conflict_count: number;
  interpreter_conflict_count: number;
  has_conflicts: boolean;
  patient_conflicts: ConflictItem[];
  interpreter_conflicts: ConflictItem[];
};

export type PatientSummary = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

export type ProviderSummary = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
  fachbereich: string | null;
};

export type DoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
};

export type StaffOption = {
  id: string;
  name: string;
  role: string;
};

export type InterpreterOption = {
  id: string;
  name: string;
  role: string;
};

export type ChecklistItem = {
  id: string;
  phase: string;
  item_text: string;
  is_completed: boolean;
  completed_at: string | null;
};

export type ReminderEntry = {
  id: string;
  user_id: string;
  user_name: string;
  remind_at: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
};

export type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by: string;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

export type ReportSummary = {
  id: string;
  interpreter_id: string;
  interpreter_name: string;
  hours: string;
  report_text: string | null;
  approval_status: string;
  notes?: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  billing_leistung_id?: string | null;
  billing_sync_status?: string | null;
  billing_service_key?: string | null;
};

export type TaskEntry = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_to_name: string;
  assigned_to_role: string;
  assigned_by: string;
  assigned_by_name: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConciergeServiceEntry = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_id: string | null;
  assigned_concierge_name: string | null;
  service_kind: string;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
  service_notes: string | null;
  billing_notes: string | null;
  completed_at: string | null;
  billed_at: string | null;
  created_at: string;
};

export type AppointmentCommunicationTarget =
  | "clinic"
  | "doctor"
  | "service_provider";

export type AppointmentCommunicationDirection = "outbound" | "inbound";

export type AppointmentCommunicationChannel =
  | "phone"
  | "email"
  | "portal"
  | "fax"
  | "whatsapp"
  | "other";

export type AppointmentCommunicationStatus =
  | "planned"
  | "sent"
  | "answered"
  | "closed"
  | "cancelled";

export type AppointmentCommunicationEntry = {
  id: string;
  appointment_id: string;
  patient_id: string;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  target_type: AppointmentCommunicationTarget;
  direction: AppointmentCommunicationDirection;
  channel: AppointmentCommunicationChannel;
  status: AppointmentCommunicationStatus;
  subject: string;
  message: string | null;
  contact_name: string | null;
  due_at: string | null;
  responded_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  created_by_role: string;
};

export type CalendarEventExtendedProps = {
  patientName: string;
  patientPid: string;
  providerName: string | null;
  doctorName: string | null;
  interpreterName: string | null;
  ownerName: string | null;
  location: string | null;
  appointmentType: AppointmentKind;
  appointmentStatus: AppointmentStatus;
  recurrenceFrequency: AppointmentRecurrenceFrequency | null;
  isBlocked: boolean;
};

export type CalendarQuickActionMenuState = {
  appointmentId: string;
  top: number;
  left: number;
};

export type LocalScheduleWarningScope = "owner" | "doctor" | "clinic";

export type LocalScheduleWarning = {
  scope: LocalScheduleWarningScope;
  label: string;
  items: AppointmentListItem[];
};

export type CalendarView =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridDay"
  | "listWeek";

export type OperationalScope =
  | "all"
  | "owned_by_me"
  | "needs_attention"
  | "pending_interpreter"
  | "my_interpreter_queue"
  | "concierge_flow"
  | "blocked_medical";

export type SchedulerQuickScope =
  | "all"
  | "today"
  | "week"
  | "mine"
  | "medical"
  | "non_medical"
  | "internal";

export type LinkedPreviewKind =
  | "patient"
  | "order"
  | "provider"
  | "documents"
  | "cases";

export type LinkedPreviewRecord = Record<string, unknown>;

export type LinkedPreviewPayload =
  | LinkedPreviewRecord
  | LinkedPreviewRecord[];

export type LinkedDocumentItem = {
  id: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  patient_pid: string | null;
  patient_name: string | null;
  order_number: string | null;
  appointment_title: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  mime_type: string | null;
  file_size: number | null;
  notes: string | null;
  uploaded_by_name: string | null;
  version_number: number;
  version_count: number;
  created_at: string;
  updated_at: string;
  share_count: number;
};

export type FiltersState = {
  search: string;
  appointmentType: string;
  carePathKind: string;
  status: string;
  patientId: string;
  providerId: string;
  doctorId: string;
  ownerUserId: string;
  interpreterId: string;
  dateFrom: string;
  dateTo: string;
};

export type AppointmentFormState = {
  patientId: string;
  providerId: string;
  doctorId: string;
  ownerUserId: string;
  interpreterId: string;
  appointmentType: AppointmentKind;
  carePathKind: AppointmentCarePathKind;
  status: AppointmentStatus;
  checklistPhase: string;
  title: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  category: string;
  notes: string;
  skipMedicalProviderBinding: boolean;
  repeatEnabled: boolean;
  repeatFrequency: AppointmentRecurrenceFrequency;
  repeatInterval: string;
  repeatCount: string;
  repeatUntil: string;
};

export type FollowUpVisitFormState = AppointmentFormState & {
  linkOrder: boolean;
  createReminder: boolean;
  reminderUserId: string;
  reminderAt: string;
};

export type ReminderFormState = {
  userId: string;
  remindAt: string;
  title: string;
  description: string;
};

export type DoctorFollowUpFormState = {
  title: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

export type PackageEndFollowUpFormState = {
  title: string;
  assigneeId: string;
  packageEndDate: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

export type ExternalHandoffFormState = {
  target: AppointmentCommunicationTarget;
  direction: AppointmentCommunicationDirection;
  channel: AppointmentCommunicationChannel;
  status: AppointmentCommunicationStatus;
  title: string;
  contactName: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

export type BillingHandoffKind =
  | "interpreter_hours"
  | "concierge_settlement"
  | "patient_invoice"
  | "provider_invoice"
  | "payment_confirmation"
  | "other";

export type BillingHandoffFormState = {
  kind: BillingHandoffKind;
  title: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

export type FindingsFollowUpArtifact =
  | "arztbrief"
  | "written_findings"
  | "both";

export type FindingsFollowUpFormState = {
  artifact: FindingsFollowUpArtifact;
  assigneeId: string;
  dueAt: string;
  notes: string;
  translationRequired: boolean;
  sendToPatient: boolean;
  createTask: boolean;
  taskPriority: string;
};

export type IncomingDataSource =
  | "patient"
  | "doctor"
  | "clinic"
  | "interpreter"
  | "external_lab"
  | "other";

export type IncomingDataCategory =
  | "medical_update"
  | "diagnosis"
  | "medication"
  | "symptom"
  | "lab_result"
  | "imaging"
  | "recommendation"
  | "risk_flag"
  | "other";

export type IncomingDataFormState = {
  source: IncomingDataSource;
  category: IncomingDataCategory;
  assigneeId: string;
  dueAt: string;
  notes: string;
  requiresCaseUpdate: boolean;
  requiresPatientFollowUp: boolean;
  createTask: boolean;
  taskPriority: string;
};

export type ReportFormState = {
  hours: string;
  reportText: string;
};

export type ChecklistFormState = {
  phase: string;
  itemText: string;
};

export type TaskFormState = {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: string;
};

export type ConciergeServiceFormState = {
  providerId: string;
  assignedConciergeId: string;
  serviceKind: string;
  title: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  costEstimate: string;
  currency: string;
  serviceNotes: string;
};

export type ConciergeServiceDraftState = {
  providerId: string;
  assignedConciergeId: string;
  title: string;
  status: string;
  billingStatus: string;
  bookingReference: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  actualCost: string;
  currency: string;
  serviceNotes: string;
  billingNotes: string;
};

export type AppointmentPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canEditSchedule: boolean;
  canManageStatus: boolean;
  canAssignInterpreter: boolean;
  canManageChecklist: boolean;
  canViewReminders: boolean;
  canManageReminders: boolean;
  canRespondToAssignment: boolean;
  canSubmitReport: boolean;
  canViewReport: boolean;
  canApproveReport: boolean;
  canRejectReport: boolean;
  canViewNotes: boolean;
  canViewTasks: boolean;
  canCreateTasks: boolean;
  canViewConciergeServices: boolean;
  canManageConciergeServices: boolean;
  canManageConciergeBilling: boolean;
  canViewCommunications: boolean;
  canManageCommunications: boolean;
};

export type LinkedPatientPermissions = {
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
};

export type OperationalScopeOption = {
  id: OperationalScope;
  label: string;
};

export type HandoffStakeholder = {
  id: string;
  name: string;
  role: string;
  badges: string[];
};
