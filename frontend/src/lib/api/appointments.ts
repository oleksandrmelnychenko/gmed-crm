import { get, post, postNoBody } from "./client";
import type {
  Appointment,
  AppointmentDetail,
  ChecklistEntry,
  ReportSummary,
  ReminderEntry,
  TaskEntry,
  ConciergeServiceEntry,
  ConflictSummary,
  InterpreterOption,
  StaffOption,
  CreateAppointmentBody,
  UpdateAppointmentBody,
  ChecklistItemBody,
  SubmitReportBody,
  CreateReminderBody,
  CreateTaskBody,
  CreateConciergeServiceBody,
  UpdateConciergeServiceBody,
  CreateResponse,
  OkResponse,
} from "./types";

// ---------------------------------------------------------------------------
// List & meta
// ---------------------------------------------------------------------------

export interface AppointmentSearchParams {
  search?: string;
  type?: string;
  status?: string;
  provider_id?: string;
  doctor_id?: string;
  date_start?: string;
  date_end?: string;
  interpreter_id?: string;
}

export function fetchAppointments(params?: AppointmentSearchParams): Promise<Appointment[]> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
  }
  const qs = q.toString();
  return get<Appointment[]>(`/appointments${qs ? `?${qs}` : ""}`);
}

export function fetchAppointmentDetail(id: string): Promise<AppointmentDetail> {
  return get<AppointmentDetail>(`/appointments/${id}`);
}

export function fetchInterpreters(): Promise<InterpreterOption[]> {
  return get<InterpreterOption[]>("/appointments/meta/interpreters");
}

export function fetchStaff(): Promise<StaffOption[]> {
  return get<StaffOption[]>("/appointments/meta/staff");
}

export function fetchConflict(params: {
  date_start: string;
  date_end: string;
  provider_id?: string;
  interpreter_id?: string;
}): Promise<ConflictSummary> {
  const q = new URLSearchParams();
  q.set("date_start", params.date_start);
  q.set("date_end", params.date_end);
  if (params.provider_id) q.set("provider_id", params.provider_id);
  if (params.interpreter_id) q.set("interpreter_id", params.interpreter_id);
  return get<ConflictSummary>(`/appointments/conflict?${q}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createAppointment(body: CreateAppointmentBody): Promise<CreateResponse> {
  return post<CreateResponse>("/appointments", body);
}

export function updateAppointment(id: string, body: UpdateAppointmentBody): Promise<OkResponse> {
  return post<OkResponse>(`/appointments/${id}`, body);
}

export function updateAppointmentStatus(id: string, status: string): Promise<OkResponse> {
  return post<OkResponse>(`/appointments/${id}/status`, { status });
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

export function assignInterpreter(id: string, interpreterId: string): Promise<OkResponse> {
  return post<OkResponse>(`/appointments/${id}/assign-interpreter`, {
    interpreter_id: interpreterId,
  });
}

export function interpreterResponse(id: string, response: string): Promise<OkResponse> {
  return post<OkResponse>(`/appointments/${id}/interpreter-response`, { response });
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export function fetchChecklist(appointmentId: string): Promise<ChecklistEntry[]> {
  return get<ChecklistEntry[]>(`/appointments/${appointmentId}/checklist`);
}

export function addChecklistItem(
  appointmentId: string,
  body: ChecklistItemBody
): Promise<CreateResponse> {
  return post<CreateResponse>(`/appointments/${appointmentId}/checklist`, body);
}

export function completeChecklistItem(
  appointmentId: string,
  itemId: string
): Promise<OkResponse> {
  return post<OkResponse>(`/appointments/${appointmentId}/checklist/${itemId}/complete`, {});
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export function fetchReminders(appointmentId: string): Promise<ReminderEntry[]> {
  return get<ReminderEntry[]>(`/appointments/${appointmentId}/reminders`);
}

export function createReminder(body: CreateReminderBody): Promise<CreateResponse> {
  return post<CreateResponse>("/reminders", body);
}

export function deleteReminder(reminderId: string): Promise<void> {
  return postNoBody(`/reminders/${reminderId}/delete`);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function fetchTasks(appointmentId: string): Promise<TaskEntry[]> {
  return get<TaskEntry[]>(`/appointments/${appointmentId}/tasks`);
}

export function createTask(body: CreateTaskBody): Promise<CreateResponse> {
  return post<CreateResponse>("/tasks", body);
}

export function updateTaskStatus(taskId: string, status: string): Promise<unknown> {
  return post(`/tasks/${taskId}/status`, { status });
}

export function deleteTask(taskId: string): Promise<void> {
  return postNoBody(`/tasks/${taskId}/delete`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function fetchReport(appointmentId: string): Promise<ReportSummary | null> {
  return get<ReportSummary | null>(`/appointments/${appointmentId}/report`);
}

export function submitReport(
  appointmentId: string,
  body: SubmitReportBody
): Promise<CreateResponse> {
  return post<CreateResponse>(`/appointments/${appointmentId}/report`, body);
}

export function approveReport(appointmentId: string): Promise<void> {
  return postNoBody(`/appointments/${appointmentId}/report/approve`);
}

export function rejectReport(appointmentId: string): Promise<void> {
  return postNoBody(`/appointments/${appointmentId}/report/reject`);
}

// ---------------------------------------------------------------------------
// Concierge services
// ---------------------------------------------------------------------------

export function fetchConciergeServices(
  appointmentId: string
): Promise<ConciergeServiceEntry[]> {
  return get<ConciergeServiceEntry[]>(`/appointments/${appointmentId}/concierge-services`);
}

export function createConciergeService(
  body: CreateConciergeServiceBody
): Promise<ConciergeServiceEntry> {
  return post<ConciergeServiceEntry>("/concierge-services", body);
}

export function updateConciergeService(
  serviceId: string,
  body: UpdateConciergeServiceBody
): Promise<ConciergeServiceEntry> {
  return post<ConciergeServiceEntry>(`/concierge-services/${serviceId}/update`, body);
}
