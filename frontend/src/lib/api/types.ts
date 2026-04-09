// ---------------------------------------------------------------------------
// Shared / reusable types across API modules
// ---------------------------------------------------------------------------

/** Generic response when creating a resource */
export interface CreateResponse {
  id: string;
}

/** Generic ok response */
export interface OkResponse {
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface PendingLoginResponse {
  status: "mfa_pending";
  pending_id: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserBody {
  email: string;
  name: string;
  password: string;
  role: string;
}

export interface UpdateUserBody {
  name?: string;
  email?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// Active sessions / online
// ---------------------------------------------------------------------------

export interface ActiveSession {
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Dashboard / Stats
// ---------------------------------------------------------------------------

export interface OverviewStats {
  patients: number;
  leads: number;
  orders: number;
  appointments: number;
  cases: number;
  users: number;
}

export interface LeadsStats {
  total_this_month: number;
  total_last_month: number;
  growth_pct: number;
  growth_abs: number;
  qualified_this_month: number;
  converted_this_month: number;
  total_all: number;
}

export interface MonthlyEntry {
  month: string;
  count: number;
}

export interface UpcomingAppointment {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  appointment_type: string | null;
  status: string;
  location: string | null;
  patient_name: string;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  country: string | null;
  qualification_status: string;
  created_at: string;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface CreateLeadBody {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  country?: string | null;
  needs_medical?: string | null;
}

export interface QualifyLeadBody {
  status: string;
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export interface Patient {
  id: string;
  patient_id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  nationality: string | null;
  languages: string[];
  phone_primary: string | null;
  email: string | null;
  insurance_type: string | null;
  is_active: boolean;
}

export interface CreatePatientBody {
  title?: string | null;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  nationality?: string | null;
  residence_country?: string | null;
  languages?: string[] | null;
  phone_primary?: string | null;
  email?: string | null;
  insurance_type?: string | null;
}

export interface UpdatePatientBody {
  first_name?: string;
  last_name?: string;
  phone_primary?: string | null;
  email?: string | null;
  nationality?: string | null;
  languages?: string[] | null;
  insurance_type?: string | null;
}

export interface PatientAssignment {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
}

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface ProviderListItem {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
  address_country: string | null;
  fachbereich: string | null;
  is_active: boolean;
  has_contract: boolean;
  doctor_count: number;
  patient_count: number;
  appointment_count: number;
}

export interface ProviderDetail {
  id: string;
  name: string;
  provider_type: string;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  fachbereich: string | null;
  kooperationsvertrag: unknown;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
  doctors: DoctorSummary[];
  services: ServiceItem[];
  linked_patients: LinkedPatient[];
  interactions: InteractionItem[];
}

export interface DoctorSummary {
  id: string;
  provider_id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  patient_count: number;
  appointment_count: number;
}

export interface DoctorDetail extends DoctorSummary {
  linked_patients: LinkedPatient[];
  interactions: InteractionItem[];
}

export interface ServiceItem {
  id: string;
  provider_id: string;
  service_name: string;
  description: string | null;
  price: unknown;
  currency: string;
  valid_from: string;
  valid_to: string | null;
}

export interface LinkedPatient {
  patient_id: string;
  first_name: string;
  last_name: string;
  appointment_count: number;
  leistung_count: number;
  last_interaction_at: string;
}

export interface InteractionItem {
  kind: string;
  id: string;
  patient_id: string;
  patient_name: string;
  doctor_id: string | null;
  doctor_name: string | null;
  order_id: string | null;
  order_number: string | null;
  status: string;
  title: string;
  appointment_type: string | null;
  location: string | null;
  notes: string | null;
  occurred_at: string;
  quantity: unknown;
  unit_price: unknown;
  currency: string | null;
}

export interface UpsertProviderBody {
  name: string;
  provider_type: string;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  fachbereich?: string | null;
  kooperationsvertrag?: unknown;
  notes?: string | null;
}

export interface UpsertDoctorBody {
  name: string;
  title?: string | null;
  fachbereich?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface UpsertServiceBody {
  service_name: string;
  description?: string | null;
  price: number;
  currency?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
}

/** Simplified provider info used in dropdowns */
export interface ProviderOption {
  id: string;
  name: string;
  provider_type?: string;
  address_city: string | null;
}

export interface DoctorOption {
  id: string;
  name: string;
  title?: string | null;
  fachbereich: string | null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface Order {
  id: string;
  order_number: string;
  patient_name: string;
  patient_pid: string;
  phase: string;
  status: string;
  created_at: string;
}

export interface Leistung {
  id: string;
  description: string;
  quantity: unknown;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_cost_passthrough: boolean;
  status: string;
  notes: string | null;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: string;
  status: string;
  needs_description: string | null;
  total_estimated: unknown;
  total_actual: unknown;
  leistungen: Leistung[];
  created_at: string;
  updated_at: string;
}

export interface CreateOrderBody {
  patient_id: string;
  contract_id?: string | null;
  needs_description?: string | null;
}

export interface AddLeistungBody {
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate?: number | null;
  is_cost_passthrough?: boolean | null;
  provider_id?: string | null;
  doctor_id?: string | null;
  notes?: string | null;
}

export interface PatientOption {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export interface CaseItem {
  case_id: string;
  patient_name: string;
  patient_pid: string;
  status: string;
  hauptanfragegrund: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export interface Appointment {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  apt_type: string;
  status: string;
  location: string | null;
  patient_name: string;
  patient_id: string;
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
  interpreter_response: string | null;
  checklist_phase: string;
  is_blocked: boolean;
}

export interface AppointmentDetail extends Appointment {
  category: string | null;
  preparation_notes: string | null;
  followup_notes: string | null;
  notes: string | null;
  order_id: string | null;
  created_at: string;
}

export interface ChecklistEntry {
  id: string;
  phase: string;
  item_text: string;
  is_completed: boolean;
  completed_at: string | null;
}

export interface ReportSummary {
  id: string;
  interpreter_id: string;
  interpreter_name: string;
  hours: string;
  report_text: string | null;
  approval_status: string;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface ReminderEntry {
  id: string;
  user_id: string;
  user_name: string;
  remind_at: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
}

export interface TaskEntry {
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
}

export interface ConciergeServiceEntry {
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
  updated_at: string;
}

export interface InterpreterOption {
  id: string;
  name: string;
  role: string;
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
}

export interface ConflictItem {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  apt_type: string;
  status: string;
  patient_name: string;
  patient_pid: string;
  provider_name: string | null;
  doctor_name: string | null;
  interpreter_name: string | null;
  is_blocked: boolean;
}

export interface ConflictSummary {
  patient_conflict_count: number;
  interpreter_conflict_count: number;
  has_conflicts: boolean;
  patient_conflicts: ConflictItem[];
  interpreter_conflicts: ConflictItem[];
}

export interface CreateAppointmentBody {
  patient_id: string;
  provider_id?: string | null;
  doctor_id?: string | null;
  owner_user_id?: string | null;
  interpreter_id?: string | null;
  appointment_type: string;
  title: string;
  date: string;
  time_start?: string | null;
  time_end?: string | null;
  location?: string | null;
}

export interface UpdateAppointmentBody {
  provider_id?: string | null;
  doctor_id?: string | null;
  owner_user_id?: string | null;
  interpreter_id?: string | null;
  title: string;
  date: string;
  time_start?: string | null;
  time_end?: string | null;
  location?: string | null;
}

export interface ChecklistItemBody {
  phase: string;
  item_text: string;
}

export interface SubmitReportBody {
  hours: number;
  report_text?: string | null;
}

export interface CreateReminderBody {
  user_id: string;
  remind_at: string;
  title: string;
  description?: string | null;
}

export interface CreateTaskBody {
  title: string;
  description?: string | null;
  assigned_to: string;
  patient_id?: string | null;
  order_id?: string | null;
  appointment_id?: string | null;
  due_date?: string | null;
  priority?: string;
}

export interface CreateConciergeServiceBody {
  patient_id: string;
  appointment_id?: string | null;
  provider_id?: string | null;
  service_kind: string;
  title: string;
  vendor_name?: string | null;
  vendor_contact?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  cost_estimate?: string | null;
  currency?: string;
  service_notes?: string | null;
}

export interface UpdateConciergeServiceBody {
  status?: string;
  booking_reference?: string | null;
  actual_cost?: string | null;
  billing_status?: string;
  billing_notes?: string | null;
  service_notes?: string | null;
  completed_at?: string | null;
  billed_at?: string | null;
}

// ---------------------------------------------------------------------------
// Messages / Chat
// ---------------------------------------------------------------------------

export interface Conversation {
  user_id: string;
  name: string;
  email?: string;
  role: string;
  last_message: string;
  last_at: string;
  is_read: boolean;
  is_mine: boolean;
  unread: number;
}

export interface ChatMessage {
  id: string;
  from_user: string;
  to_user: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
  attachment_filename: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_key: string | null;
}

export interface SendMessageResponse {
  ok: boolean;
  id: string;
  created_at: string;
}

export interface UploadResponse {
  ok: boolean;
  id: string;
  created_at: string;
  attachment_key: string;
  attachment_filename: string;
  attachment_mime: string;
  attachment_size: number;
}

export interface ChatUserItem {
  id: string;
  name: string;
  email?: string;
  role: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export interface ActiveAnnouncement {
  title: string;
  message: string;
  variant: string;
}

export interface AnnouncementFull {
  id: string;
  title: string;
  message: string;
  variant: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  creator: string;
}

export interface UpsertAnnouncementBody {
  title: string;
  message: string;
  variant?: string | null;
  is_active?: boolean | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

export interface Policy {
  role: string;
  field_name: string;
  access_level: string;
  condition_type: string | null;
  is_system_locked: boolean;
}

export interface UpdatePolicyBody {
  role: string;
  entity_type: string;
  field_name: string;
  access_level: string;
  condition_type: string | null;
}

// ---------------------------------------------------------------------------
// Admin — Settings
// ---------------------------------------------------------------------------

export interface SettingRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface SessionRow {
  family_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_activity_at: string;
}

export interface PendingLogin {
  id: string;
  user_name: string;
  user_email: string;
  role: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Admin — Security
// ---------------------------------------------------------------------------

export interface IpEntry {
  id: string;
  cidr: string;
  description: string | null;
  is_active: boolean;
}

export interface GeoLogin {
  user_name: string;
  user_email: string;
  ip_address: string | null;
  user_agent: string | null;
  geo_data: unknown;
  created_at: string;
  is_revoked: boolean;
}

// ---------------------------------------------------------------------------
// Admin — Activity
// ---------------------------------------------------------------------------

export interface ActivityRow {
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: unknown;
  context: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Admin — Compliance
// ---------------------------------------------------------------------------

export interface ConsentDashboard {
  total: number;
  granted_active: number;
  revoked: number;
  by_type: ConsentType[];
  recent_changes: ConsentChange[];
}

export interface ConsentType {
  consent_type: string;
  total: number;
  active: number;
}

export interface ConsentChange {
  user_name: string;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
}

export interface ExpiredConsent {
  user_name: string;
  consent_type: string;
  granted_at: string | null;
}

// ---------------------------------------------------------------------------
// Admin — Custom Fields
// ---------------------------------------------------------------------------

export interface CustomField {
  id: string;
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: unknown;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface UpsertCustomFieldBody {
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type?: string | null;
  options?: unknown;
  is_required?: boolean | null;
  sort_order?: number | null;
}

// ---------------------------------------------------------------------------
// Admin — Notification Channels
// ---------------------------------------------------------------------------

export interface NotificationChannel {
  id: string;
  channel_type: string;
  name: string;
  config: unknown;
  is_active: boolean;
}

export interface UpsertChannelBody {
  channel_type: string;
  name: string;
  config: unknown;
  is_active?: boolean | null;
}

// ---------------------------------------------------------------------------
// Admin — Health
// ---------------------------------------------------------------------------

export type HealthData = Record<string, unknown>;
