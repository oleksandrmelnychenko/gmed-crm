#![allow(clippy::unit_arg)]

use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, role_display_name};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;

fn debug_log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Appointment {
    id: String,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    #[serde(rename = "type")]
    apt_type: String,
    status: String,
    location: Option<String>,
    patient_name: String,
    patient_id: String,
    patient_pid: String,
    provider_id: Option<String>,
    provider_name: Option<String>,
    doctor_id: Option<String>,
    doctor_name: Option<String>,
    owner_user_id: Option<String>,
    owner_name: Option<String>,
    owner_role: Option<String>,
    interpreter_id: Option<String>,
    interpreter_name: Option<String>,
    interpreter_response: Option<String>,
    checklist_phase: String,
    #[serde(default)]
    is_blocked: bool,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct AppointmentDetail {
    id: String,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    #[serde(rename = "type")]
    apt_type: String,
    status: String,
    location: Option<String>,
    category: Option<String>,
    interpreter_id: Option<String>,
    interpreter_name: Option<String>,
    interpreter_response: Option<String>,
    checklist_phase: String,
    preparation_notes: Option<String>,
    followup_notes: Option<String>,
    notes: Option<String>,
    patient_id: String,
    patient_name: String,
    patient_pid: String,
    provider_id: Option<String>,
    provider_name: Option<String>,
    doctor_id: Option<String>,
    doctor_name: Option<String>,
    owner_user_id: Option<String>,
    owner_name: Option<String>,
    owner_role: Option<String>,
    order_id: Option<String>,
    created_at: String,
    #[serde(default)]
    is_blocked: bool,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ChecklistEntry {
    id: String,
    phase: String,
    item_text: String,
    is_completed: bool,
    completed_at: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ReportSummary {
    id: String,
    interpreter_id: String,
    interpreter_name: String,
    hours: String,
    report_text: Option<String>,
    approval_status: String,
    approved_by_name: Option<String>,
    approved_at: Option<String>,
    created_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ReminderEntry {
    id: String,
    user_id: String,
    user_name: String,
    remind_at: String,
    title: String,
    description: Option<String>,
    is_completed: bool,
    completed_at: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct TaskEntry {
    id: String,
    title: String,
    description: Option<String>,
    assigned_to: String,
    assigned_to_name: String,
    assigned_to_role: String,
    assigned_by: String,
    assigned_by_name: String,
    patient_id: Option<String>,
    order_id: Option<String>,
    appointment_id: Option<String>,
    due_date: Option<String>,
    priority: String,
    status: String,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ConciergeServiceEntry {
    id: String,
    patient_id: String,
    patient_name: String,
    patient_pid: String,
    appointment_id: Option<String>,
    appointment_title: Option<String>,
    provider_id: Option<String>,
    provider_name: Option<String>,
    assigned_concierge_id: Option<String>,
    assigned_concierge_name: Option<String>,
    service_kind: String,
    title: String,
    status: String,
    booking_reference: Option<String>,
    vendor_name: Option<String>,
    vendor_contact: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cost_estimate: Option<String>,
    actual_cost: Option<String>,
    currency: String,
    billing_status: String,
    service_notes: Option<String>,
    billing_notes: Option<String>,
    completed_at: Option<String>,
    billed_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ProviderOption {
    id: String,
    name: String,
    provider_type: String,
    address_city: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct ProviderDetail {
    doctors: Vec<DoctorOption>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct DoctorOption {
    id: String,
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct InterpreterOption {
    id: String,
    name: String,
    role: String,
}

#[derive(Deserialize, Clone, Debug)]
struct StaffOption {
    id: String,
    name: String,
    role: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ConflictItem {
    id: String,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    #[serde(rename = "type")]
    apt_type: String,
    status: String,
    patient_name: String,
    patient_pid: String,
    provider_name: Option<String>,
    doctor_name: Option<String>,
    interpreter_name: Option<String>,
    #[serde(default)]
    is_blocked: bool,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ConflictSummary {
    patient_conflict_count: usize,
    interpreter_conflict_count: usize,
    has_conflicts: bool,
    patient_conflicts: Vec<ConflictItem>,
    interpreter_conflicts: Vec<ConflictItem>,
}

#[derive(Serialize)]
struct CreateApt {
    patient_id: String,
    provider_id: Option<String>,
    doctor_id: Option<String>,
    owner_user_id: Option<String>,
    interpreter_id: Option<String>,
    appointment_type: String,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
}

#[derive(Serialize)]
struct UpdateApt {
    provider_id: Option<String>,
    doctor_id: Option<String>,
    owner_user_id: Option<String>,
    interpreter_id: Option<String>,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
}

#[derive(Serialize)]
struct StatusUpdateReq {
    status: String,
}

#[derive(Serialize)]
struct AssignInterpreterReq {
    interpreter_id: String,
}

#[derive(Serialize)]
struct InterpreterResponseReq {
    response: String,
}

#[derive(Serialize)]
struct ChecklistItemReq {
    phase: String,
    item_text: String,
}

#[derive(Serialize)]
struct SubmitReportReq {
    hours: f64,
    report_text: Option<String>,
}

#[derive(Serialize)]
struct CreateReminderReq {
    user_id: String,
    remind_at: String,
    title: String,
    description: Option<String>,
}

#[derive(Serialize)]
struct CreateTaskReq {
    title: String,
    description: Option<String>,
    assigned_to: String,
    appointment_id: String,
    due_date: Option<String>,
    priority: String,
}

#[derive(Serialize)]
struct UpdateTaskStatusReq {
    status: String,
}

#[derive(Serialize)]
struct CreateConciergeServiceReq {
    patient_id: String,
    appointment_id: String,
    provider_id: Option<String>,
    assigned_concierge_id: Option<String>,
    service_kind: String,
    title: String,
    booking_reference: Option<String>,
    vendor_name: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cost_estimate: Option<f64>,
    currency: String,
    service_notes: Option<String>,
}

#[derive(Serialize)]
struct UpdateConciergeServiceReq {
    assigned_concierge_id: Option<String>,
    service_kind: Option<String>,
    title: Option<String>,
    status: Option<String>,
    billing_status: Option<String>,
    booking_reference: Option<String>,
    vendor_name: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    actual_cost: Option<f64>,
    service_notes: Option<String>,
    billing_notes: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum ViewMode {
    Calendar,
    Table,
}

#[derive(Clone, Copy)]
struct AppointmentPermissions {
    can_view_page: bool,
    can_create: bool,
    can_edit_schedule: bool,
    can_manage_status: bool,
    can_assign_interpreter: bool,
    can_view_concierge_services: bool,
    can_create_concierge_services: bool,
    can_edit_concierge_services: bool,
    can_edit_concierge_billing: bool,
    can_manage_checklist: bool,
    can_view_reminders: bool,
    can_manage_reminders: bool,
    can_view_tasks: bool,
    can_manage_tasks: bool,
    can_respond_to_assignment: bool,
    can_submit_report: bool,
    can_view_report: bool,
    can_approve_report: bool,
    can_reject_report: bool,
    can_view_notes: bool,
}

fn appointment_permissions(role: Option<&str>) -> AppointmentPermissions {
    match role {
        Some("ceo") | Some("patient_manager") => AppointmentPermissions {
            can_view_page: true,
            can_create: true,
            can_edit_schedule: true,
            can_manage_status: true,
            can_assign_interpreter: true,
            can_view_concierge_services: true,
            can_create_concierge_services: true,
            can_edit_concierge_services: true,
            can_edit_concierge_billing: true,
            can_manage_checklist: true,
            can_view_reminders: true,
            can_manage_reminders: true,
            can_view_tasks: true,
            can_manage_tasks: true,
            can_respond_to_assignment: false,
            can_submit_report: false,
            can_view_report: true,
            can_approve_report: true,
            can_reject_report: true,
            can_view_notes: true,
        },
        Some("teamlead_interpreter") => AppointmentPermissions {
            can_view_page: true,
            can_create: true,
            can_edit_schedule: true,
            can_manage_status: false,
            can_assign_interpreter: true,
            can_view_concierge_services: false,
            can_create_concierge_services: false,
            can_edit_concierge_services: false,
            can_edit_concierge_billing: false,
            can_manage_checklist: false,
            can_view_reminders: true,
            can_manage_reminders: false,
            can_view_tasks: true,
            can_manage_tasks: false,
            can_respond_to_assignment: true,
            can_submit_report: false,
            can_view_report: true,
            can_approve_report: true,
            can_reject_report: true,
            can_view_notes: true,
        },
        Some("interpreter") => AppointmentPermissions {
            can_view_page: true,
            can_create: false,
            can_edit_schedule: false,
            can_manage_status: false,
            can_assign_interpreter: false,
            can_view_concierge_services: false,
            can_create_concierge_services: false,
            can_edit_concierge_services: false,
            can_edit_concierge_billing: false,
            can_manage_checklist: false,
            can_view_reminders: true,
            can_manage_reminders: false,
            can_view_tasks: true,
            can_manage_tasks: false,
            can_respond_to_assignment: true,
            can_submit_report: true,
            can_view_report: true,
            can_approve_report: false,
            can_reject_report: false,
            can_view_notes: true,
        },
        Some("concierge") => AppointmentPermissions {
            can_view_page: true,
            can_create: true,
            can_edit_schedule: true,
            can_manage_status: false,
            can_assign_interpreter: false,
            can_view_concierge_services: true,
            can_create_concierge_services: true,
            can_edit_concierge_services: true,
            can_edit_concierge_billing: false,
            can_manage_checklist: true,
            can_view_reminders: true,
            can_manage_reminders: false,
            can_view_tasks: true,
            can_manage_tasks: false,
            can_respond_to_assignment: false,
            can_submit_report: false,
            can_view_report: false,
            can_approve_report: false,
            can_reject_report: false,
            can_view_notes: false,
        },
        _ => AppointmentPermissions {
            can_view_page: false,
            can_create: false,
            can_edit_schedule: false,
            can_manage_status: false,
            can_assign_interpreter: false,
            can_view_concierge_services: false,
            can_create_concierge_services: false,
            can_edit_concierge_services: false,
            can_edit_concierge_billing: false,
            can_manage_checklist: false,
            can_view_reminders: false,
            can_manage_reminders: false,
            can_view_tasks: false,
            can_manage_tasks: false,
            can_respond_to_assignment: false,
            can_submit_report: false,
            can_view_report: false,
            can_approve_report: false,
            can_reject_report: false,
            can_view_notes: false,
        },
    }
}

fn type_class(t: &str) -> &'static str {
    match t {
        "medical" => "cal-event cal-medical",
        "non_medical" => "cal-event cal-nonmed",
        "internal" => "cal-event cal-internal",
        _ => "cal-event",
    }
}

fn status_class(s: &str) -> &'static str {
    match s {
        "planned" => "tag tag--gray",
        "confirmed" => "tag tag--blue",
        "in_progress" => "tag tag--amber",
        "completed" => "tag tag--green",
        "cancelled" => "tag tag--red",
        _ => "tag tag--gray",
    }
}

fn type_tag(t: &str) -> &'static str {
    match t {
        "medical" => "tag tag--blue",
        "non_medical" => "tag tag--teal",
        "internal" => "tag tag--gray",
        _ => "tag tag--gray",
    }
}

fn response_class(response: Option<&str>) -> &'static str {
    match response {
        Some("accepted") => "tag tag--green",
        Some("declined") => "tag tag--red",
        Some("discussion_requested") => "tag tag--purple",
        Some("pending") => "tag tag--amber",
        _ => "tag tag--gray",
    }
}

fn response_label(response: Option<&str>) -> &'static str {
    match response {
        Some("accepted") => "accepted",
        Some("declined") => "declined",
        Some("discussion_requested") => "discussion requested",
        Some("pending") => "pending",
        _ => "not assigned",
    }
}

fn concierge_service_status_class(status: &str) -> &'static str {
    match status {
        "planned" => "tag tag--gray",
        "booked" | "confirmed" => "tag tag--blue",
        "in_service" => "tag tag--amber",
        "completed" => "tag tag--green",
        "cancelled" => "tag tag--red",
        _ => "tag tag--gray",
    }
}

fn concierge_billing_status_class(status: &str) -> &'static str {
    match status {
        "draft" => "tag tag--gray",
        "ready" => "tag tag--amber",
        "billed" => "tag tag--blue",
        "settled" => "tag tag--green",
        "waived" => "tag tag--red",
        _ => "tag tag--gray",
    }
}

#[allow(clippy::too_many_arguments)]
fn appointments_query_url(
    search: &str,
    status: &str,
    appointment_type: &str,
    provider_id: &str,
    doctor_id: &str,
    owner_user_id: &str,
    interpreter_id: &str,
    date_from: &str,
    date_to: &str,
) -> String {
    let mut params = Vec::<String>::new();
    if !search.trim().is_empty() {
        params.push(format!("search={}", search.trim()));
    }
    if !status.trim().is_empty() {
        params.push(format!("status={status}"));
    }
    if !appointment_type.trim().is_empty() {
        params.push(format!("appointment_type={appointment_type}"));
    }
    if !provider_id.trim().is_empty() {
        params.push(format!("provider_id={provider_id}"));
    }
    if !doctor_id.trim().is_empty() {
        params.push(format!("doctor_id={doctor_id}"));
    }
    if !owner_user_id.trim().is_empty() {
        params.push(format!("owner_user_id={owner_user_id}"));
    }
    if !interpreter_id.trim().is_empty() {
        params.push(format!("interpreter_id={interpreter_id}"));
    }
    if !date_from.trim().is_empty() {
        params.push(format!("date_from={date_from}"));
    }
    if !date_to.trim().is_empty() {
        params.push(format!("date_to={date_to}"));
    }
    if params.is_empty() {
        "/appointments".to_string()
    } else {
        format!("/appointments?{}", params.join("&"))
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 => 31,
        2 => {
            if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                29
            } else {
                28
            }
        }
        3 => 31,
        4 => 30,
        5 => 31,
        6 => 30,
        7 => 31,
        8 => 31,
        9 => 30,
        10 => 31,
        11 => 30,
        12 => 31,
        _ => 30,
    }
}

fn weekday_of_first(year: i32, month: u32) -> u32 {
    let y: i32 = if month <= 2 { year - 1 } else { year };
    let m: i32 = if month <= 2 {
        month as i32 + 12
    } else {
        month as i32
    };
    let d: i32 = 1;
    let w = (d + (13 * (m + 1)) / 5 + y + y / 4 - y / 100 + y / 400) % 7;
    ((w + 5) % 7) as u32
}

fn format_time_range(start: Option<&str>, end: Option<&str>) -> String {
    match (start, end) {
        (Some(start), Some(end)) => format!("{start} - {end}"),
        (Some(start), None) => start.to_string(),
        _ => String::new(),
    }
}

fn provider_doctor_label(provider: Option<&str>, doctor: Option<&str>) -> String {
    match (provider, doctor) {
        (Some(provider), Some(doctor)) => format!("{provider} / {doctor}"),
        (Some(provider), None) => provider.to_string(),
        (None, Some(doctor)) => doctor.to_string(),
        (None, None) => String::new(),
    }
}

fn normalize_datetime_local(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.len() == 16 {
        format!("{trimmed}:00+00:00")
    } else if trimmed.ends_with('Z') || trimmed.contains('+') {
        trimmed.to_string()
    } else {
        format!("{trimmed}+00:00")
    }
}

const WEEKDAYS_DE: &[&str] = &["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_RU: &[&str] = &["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_DE: &[&str] = &[
    "",
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];
const MONTHS_RU: &[&str] = &[
    "",
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
];

#[component]
pub fn AppointmentsList() -> impl IntoView {
    debug_log("appointments:init");
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    let (apts, set_apts) = signal(Vec::<Appointment>::new());
    let (loading, set_loading) = signal(true);
    let (load_error, set_load_error) = signal(Option::<String>::None);
    let (view_mode, set_view_mode) = signal(ViewMode::Calendar);
    let (cal_year, set_cal_year) = signal(2026i32);
    let (cal_month, set_cal_month) = signal(4u32);
    let (show_create, set_show_create) = signal(false);
    let (show_edit, set_show_edit) = signal(false);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);
    let (metadata_loaded, set_metadata_loaded) = signal(false);

    let (f_patient, set_f_patient) = signal(String::new());
    let (f_type, set_f_type) = signal("medical".to_string());
    let (f_title, set_f_title) = signal(String::new());
    let (f_date, set_f_date) = signal(String::new());
    let (f_time_s, set_f_time_s) = signal(String::new());
    let (f_time_e, set_f_time_e) = signal(String::new());
    let (f_loc, set_f_loc) = signal(String::new());
    let (f_provider, set_f_provider) = signal(String::new());
    let (f_doctor, set_f_doctor) = signal(String::new());
    let (f_owner, set_f_owner) = signal(String::new());
    let (f_interpreter, set_f_interpreter) = signal(String::new());
    let (creating, set_creating) = signal(false);
    let (create_conflicts, set_create_conflicts) = signal(Option::<ConflictSummary>::None);
    let (create_conflicts_loading, set_create_conflicts_loading) = signal(false);

    let (edit_title, set_edit_title) = signal(String::new());
    let (edit_date, set_edit_date) = signal(String::new());
    let (edit_time_s, set_edit_time_s) = signal(String::new());
    let (edit_time_e, set_edit_time_e) = signal(String::new());
    let (edit_loc, set_edit_loc) = signal(String::new());
    let (edit_provider, set_edit_provider) = signal(String::new());
    let (edit_doctor, set_edit_doctor) = signal(String::new());
    let (edit_owner, set_edit_owner) = signal(String::new());
    let (edit_interpreter, set_edit_interpreter) = signal(String::new());
    let (editing, set_editing) = signal(false);
    let (edit_conflicts, set_edit_conflicts) = signal(Option::<ConflictSummary>::None);
    let (edit_conflicts_loading, set_edit_conflicts_loading) = signal(false);

    let (patients_list, set_patients_list) = signal(Vec::<(String, String)>::new());
    let (providers_list, set_providers_list) = signal(Vec::<ProviderOption>::new());
    let (doctors_list, set_doctors_list) = signal(Vec::<DoctorOption>::new());
    let (edit_doctors_list, set_edit_doctors_list) = signal(Vec::<DoctorOption>::new());
    let (filter_doctors, set_filter_doctors) = signal(Vec::<DoctorOption>::new());
    let (interpreter_options, set_interpreter_options) = signal(Vec::<InterpreterOption>::new());
    let (staff_options, set_staff_options) = signal(Vec::<StaffOption>::new());

    let (search, set_search) = signal(String::new());
    let (filter_status, set_filter_status) = signal(String::new());
    let (filter_type, set_filter_type) = signal(String::new());
    let (filter_provider, set_filter_provider) = signal(String::new());
    let (filter_doctor, set_filter_doctor) = signal(String::new());
    let (filter_owner, set_filter_owner) = signal(String::new());
    let (filter_interpreter, set_filter_interpreter) = signal(String::new());
    let (filter_date_from, set_filter_date_from) = signal(String::new());
    let (filter_date_to, set_filter_date_to) = signal(String::new());

    let (selected_appointment_id, set_selected_appointment_id) = signal(Option::<String>::None);
    let (selected_detail, set_selected_detail) = signal(Option::<AppointmentDetail>::None);
    let (detail_loading, set_detail_loading) = signal(false);
    let (detail_error, set_detail_error) = signal(Option::<String>::None);
    let (checklist, set_checklist) = signal(Vec::<ChecklistEntry>::new());
    let (concierge_services, set_concierge_services) = signal(Vec::<ConciergeServiceEntry>::new());
    let (reminders, set_reminders) = signal(Vec::<ReminderEntry>::new());
    let (tasks, set_tasks) = signal(Vec::<TaskEntry>::new());
    let (report_summary, set_report_summary) = signal(Option::<ReportSummary>::None);

    let (selected_interpreter, set_selected_interpreter) = signal(String::new());
    let (service_kind, set_service_kind) = signal("transfer".to_string());
    let (service_title, set_service_title) = signal(String::new());
    let (service_assignee_id, set_service_assignee_id) = signal(String::new());
    let (service_booking_reference, set_service_booking_reference) = signal(String::new());
    let (service_vendor_name, set_service_vendor_name) = signal(String::new());
    let (service_start_at, set_service_start_at) = signal(String::new());
    let (service_end_at, set_service_end_at) = signal(String::new());
    let (service_cost_estimate, set_service_cost_estimate) = signal(String::new());
    let (service_currency, set_service_currency) = signal("EUR".to_string());
    let (service_notes, set_service_notes) = signal(String::new());
    let (checklist_phase, set_checklist_phase) = signal("preparation".to_string());
    let (checklist_text, set_checklist_text) = signal(String::new());
    let (report_hours, set_report_hours) = signal(String::new());
    let (report_text, set_report_text) = signal(String::new());
    let (reminder_user_id, set_reminder_user_id) = signal(String::new());
    let (reminder_at, set_reminder_at) = signal(String::new());
    let (reminder_title, set_reminder_title) = signal(String::new());
    let (reminder_description, set_reminder_description) = signal(String::new());
    let (task_assignee_id, set_task_assignee_id) = signal(String::new());
    let (task_due_at, set_task_due_at) = signal(String::new());
    let (task_title, set_task_title) = signal(String::new());
    let (task_description, set_task_description) = signal(String::new());
    let (task_priority, set_task_priority) = signal("normal".to_string());
    let (action_busy, set_action_busy) = signal(false);
    let (action_notice, set_action_notice) = signal(Option::<String>::None);
    let (action_error, set_action_error) = signal(Option::<String>::None);

    let permissions = move || {
        appointment_permissions(
            current_user
                .user
                .get()
                .as_ref()
                .map(|user| user.role.as_str()),
        )
    };

    let load_patients = move || {
        wasm_bindgen_futures::spawn_local(async move {
            #[derive(Deserialize)]
            struct PatientOption {
                id: String,
                first_name: String,
                last_name: String,
            }

            if let Ok(items) = client::get::<Vec<PatientOption>>("/patients").await {
                let mut mapped = Vec::with_capacity(items.len());
                for item in items {
                    mapped.push((item.id, format!("{} {}", item.first_name, item.last_name)));
                }
                set_patients_list.set(mapped);
            }
        });
    };

    let load_providers = move || {
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<ProviderOption>>("/providers").await {
                Ok(items) => set_providers_list.set(items),
                Err(_) => set_providers_list.set(Vec::new()),
            }
        });
    };

    let load_interpreters = move || {
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<InterpreterOption>>("/appointments/meta/interpreters").await {
                Ok(items) => set_interpreter_options.set(items),
                Err(_) => set_interpreter_options.set(Vec::new()),
            }
        });
    };

    let load_staff = move || {
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<StaffOption>>("/appointments/meta/staff").await {
                Ok(items) => set_staff_options.set(items),
                Err(_) => set_staff_options.set(Vec::new()),
            }
        });
    };

    Effect::new(move |_| {
        debug_log("appointments:metadata-effect");
        if current_user.loading.get() || metadata_loaded.get() {
            return;
        }

        set_metadata_loaded.set(true);
        if !permissions().can_view_page {
            return;
        }

        load_providers();
        load_interpreters();
        load_staff();
    });

    Effect::new(move |_| {
        debug_log("appointments:list-effect");
        let _ = reload_nonce.get();
        if current_user.loading.get() {
            debug_log("appointments:list-effect loading-return");
            return;
        }
        if !permissions().can_view_page {
            debug_log("appointments:list-effect no-access");
            set_loading.set(false);
            set_load_error.set(None);
            set_apts.set(Vec::new());
            return;
        }

        debug_log("appointments:list-effect before-url");
        let url = appointments_query_url(
            &search.get(),
            &filter_status.get(),
            &filter_type.get(),
            &filter_provider.get(),
            &filter_doctor.get(),
            &filter_owner.get(),
            &filter_interpreter.get(),
            &filter_date_from.get(),
            &filter_date_to.get(),
        );
        debug_log("appointments:list-effect after-url");

        set_loading.set(true);
        set_load_error.set(None);
        debug_log("appointments:list-effect before-spawn");
        wasm_bindgen_futures::spawn_local(async move {
            debug_log("appointments:list-effect spawned");
            match client::get::<Vec<Appointment>>(&url).await {
                Ok(items) => {
                    debug_log("appointments:list-effect request-ok");
                    set_apts.set(items);
                    set_loading.set(false);
                }
                Err(err) => {
                    debug_log("appointments:list-effect request-err");
                    set_apts.set(Vec::new());
                    set_load_error.set(Some(err));
                    set_loading.set(false);
                }
            }
        });
    });

    Effect::new(move |_| {
        let items = apts.get();
        let selected = selected_appointment_id.get();

        if items.is_empty() {
            if selected.is_some() {
                set_selected_appointment_id.set(None);
            }
            return;
        }

        let has_selected = selected
            .as_ref()
            .map(|value| items.iter().any(|item| &item.id == value))
            .unwrap_or(false);

        if !has_selected {
            set_selected_appointment_id.set(Some(items[0].id.clone()));
        }
    });

    Effect::new(move |_| {
        let _ = selected_appointment_id.get();
        set_show_edit.set(false);
        set_edit_conflicts.set(None);
    });

    Effect::new(move |_| {
        let provider_id = filter_provider.get();
        set_filter_doctor.set(String::new());
        if provider_id.is_empty() {
            set_filter_doctors.set(Vec::new());
            return;
        }

        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ProviderDetail>(&format!("/providers/{provider_id}")).await {
                Ok(detail) => set_filter_doctors.set(detail.doctors),
                Err(_) => set_filter_doctors.set(Vec::new()),
            }
        });
    });

    Effect::new(move |_| {
        let provider_id = f_provider.get();
        set_f_doctor.set(String::new());
        if provider_id.is_empty() {
            set_doctors_list.set(Vec::new());
            return;
        }

        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ProviderDetail>(&format!("/providers/{provider_id}")).await {
                Ok(detail) => set_doctors_list.set(detail.doctors),
                Err(_) => set_doctors_list.set(Vec::new()),
            }
        });
    });

    Effect::new(move |_| {
        let provider_id = edit_provider.get();
        let current_doctor = edit_doctor.get();
        if provider_id.is_empty() {
            set_edit_doctor.set(String::new());
            set_edit_doctors_list.set(Vec::new());
            return;
        }

        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ProviderDetail>(&format!("/providers/{provider_id}")).await {
                Ok(detail) => {
                    let keep_current = detail
                        .doctors
                        .iter()
                        .any(|doctor| doctor.id == current_doctor);
                    if !keep_current {
                        set_edit_doctor.set(String::new());
                    }
                    set_edit_doctors_list.set(detail.doctors);
                }
                Err(_) => set_edit_doctors_list.set(Vec::new()),
            }
        });
    });

    Effect::new(move |_| {
        if !show_create.get() || current_user.loading.get() || !permissions().can_create {
            set_create_conflicts.set(None);
            set_create_conflicts_loading.set(false);
            return;
        }

        let patient_id = f_patient.get();
        let date = f_date.get();
        if patient_id.trim().is_empty() || date.trim().is_empty() {
            set_create_conflicts.set(None);
            set_create_conflicts_loading.set(false);
            return;
        }

        let mut url = format!("/appointments/meta/conflicts?patient_id={patient_id}&date={date}");
        let time_start = f_time_s.get();
        let time_end = f_time_e.get();
        let interpreter_id = f_interpreter.get();

        if !time_start.trim().is_empty() {
            url.push_str(&format!("&time_start={time_start}"));
        }
        if !time_end.trim().is_empty() {
            url.push_str(&format!("&time_end={time_end}"));
        }
        if !interpreter_id.trim().is_empty() {
            url.push_str(&format!("&interpreter_id={interpreter_id}"));
        }

        set_create_conflicts_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ConflictSummary>(&url).await {
                Ok(summary) => set_create_conflicts.set(Some(summary)),
                Err(_) => set_create_conflicts.set(None),
            }
            set_create_conflicts_loading.set(false);
        });
    });

    Effect::new(move |_| {
        let Some(detail) = selected_detail.get() else {
            set_edit_conflicts.set(None);
            set_edit_conflicts_loading.set(false);
            return;
        };
        if !show_edit.get()
            || current_user.loading.get()
            || !permissions().can_edit_schedule
            || detail.is_blocked
        {
            set_edit_conflicts.set(None);
            set_edit_conflicts_loading.set(false);
            return;
        }

        let date = edit_date.get();
        if detail.patient_id.trim().is_empty() || date.trim().is_empty() {
            set_edit_conflicts.set(None);
            set_edit_conflicts_loading.set(false);
            return;
        }

        let mut url = format!(
            "/appointments/meta/conflicts?patient_id={}&appointment_id={}&date={}",
            detail.patient_id, detail.id, date
        );
        let time_start = edit_time_s.get();
        let time_end = edit_time_e.get();
        let interpreter_id = edit_interpreter.get();

        if !time_start.trim().is_empty() {
            url.push_str(&format!("&time_start={time_start}"));
        }
        if !time_end.trim().is_empty() {
            url.push_str(&format!("&time_end={time_end}"));
        }
        if !interpreter_id.trim().is_empty() {
            url.push_str(&format!("&interpreter_id={interpreter_id}"));
        }

        set_edit_conflicts_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ConflictSummary>(&url).await {
                Ok(summary) => set_edit_conflicts.set(Some(summary)),
                Err(_) => set_edit_conflicts.set(None),
            }
            set_edit_conflicts_loading.set(false);
        });
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let Some(appointment_id) = selected_appointment_id.get() else {
            set_selected_detail.set(None);
            set_detail_error.set(None);
            set_checklist.set(Vec::new());
            set_concierge_services.set(Vec::new());
            set_reminders.set(Vec::new());
            set_tasks.set(Vec::new());
            set_report_summary.set(None);
            return;
        };

        let current_permissions = permissions();
        if current_user.loading.get() || !current_permissions.can_view_page {
            return;
        }
        let viewer_role = current_user.user.get().map(|user| user.role);
        let viewer_id = current_user.user.get().map(|user| user.id);

        set_detail_loading.set(true);
        set_detail_error.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<AppointmentDetail>(&format!("/appointments/{appointment_id}")).await
            {
                Ok(detail) => {
                    let should_load_concierge_services = current_permissions
                        .can_view_concierge_services
                        && detail.apt_type == "non_medical"
                        && !detail.is_blocked;
                    if should_load_concierge_services {
                        set_service_title.set(detail.title.clone());
                        set_service_assignee_id.set(String::new());
                        set_service_kind.set("transfer".to_string());
                        set_service_booking_reference.set(String::new());
                        set_service_vendor_name.set(String::new());
                        set_service_start_at.set(String::new());
                        set_service_end_at.set(String::new());
                        set_service_cost_estimate.set(String::new());
                        set_service_currency.set("EUR".to_string());
                        set_service_notes.set(String::new());
                    } else {
                        set_concierge_services.set(Vec::new());
                    }
                    set_selected_interpreter.set(detail.interpreter_id.clone().unwrap_or_default());
                    set_edit_title.set(detail.title.clone());
                    set_edit_date.set(detail.date.clone());
                    set_edit_time_s.set(detail.time_start.clone().unwrap_or_default());
                    set_edit_time_e.set(detail.time_end.clone().unwrap_or_default());
                    set_edit_loc.set(detail.location.clone().unwrap_or_default());
                    set_edit_provider.set(detail.provider_id.clone().unwrap_or_default());
                    set_edit_doctor.set(detail.doctor_id.clone().unwrap_or_default());
                    set_edit_owner.set(detail.owner_user_id.clone().unwrap_or_else(|| {
                        match viewer_role.as_deref() {
                            Some("teamlead_interpreter") | Some("concierge") => {
                                viewer_id.clone().unwrap_or_default()
                            }
                            _ => String::new(),
                        }
                    }));
                    set_edit_interpreter.set(detail.interpreter_id.clone().unwrap_or_default());
                    set_selected_detail.set(Some(detail));

                    if should_load_concierge_services {
                        match client::get::<Vec<ConciergeServiceEntry>>(&format!(
                            "/concierge-services?appointment_id={appointment_id}"
                        ))
                        .await
                        {
                            Ok(items) => set_concierge_services.set(items),
                            Err(_) => set_concierge_services.set(Vec::new()),
                        }
                    }

                    if current_permissions.can_manage_checklist {
                        match client::get::<Vec<ChecklistEntry>>(&format!(
                            "/appointments/{appointment_id}/checklist"
                        ))
                        .await
                        {
                            Ok(items) => set_checklist.set(items),
                            Err(_) => set_checklist.set(Vec::new()),
                        }
                    } else {
                        set_checklist.set(Vec::new());
                    }

                    if current_permissions.can_view_reminders {
                        match client::get::<Vec<ReminderEntry>>(&format!(
                            "/appointments/{appointment_id}/reminders"
                        ))
                        .await
                        {
                            Ok(items) => set_reminders.set(items),
                            Err(_) => set_reminders.set(Vec::new()),
                        }
                    } else {
                        set_reminders.set(Vec::new());
                    }

                    if current_permissions.can_view_tasks {
                        match client::get::<Vec<TaskEntry>>(&format!(
                            "/tasks?appointment_id={appointment_id}"
                        ))
                        .await
                        {
                            Ok(items) => set_tasks.set(items),
                            Err(_) => set_tasks.set(Vec::new()),
                        }
                    } else {
                        set_tasks.set(Vec::new());
                    }

                    if current_permissions.can_view_report {
                        match client::get::<Option<ReportSummary>>(&format!(
                            "/appointments/{appointment_id}/report"
                        ))
                        .await
                        {
                            Ok(report) => set_report_summary.set(report),
                            Err(_) => set_report_summary.set(None),
                        }
                    } else {
                        set_report_summary.set(None);
                    }

                    set_detail_loading.set(false);
                }
                Err(err) => {
                    set_selected_detail.set(None);
                    set_checklist.set(Vec::new());
                    set_concierge_services.set(Vec::new());
                    set_reminders.set(Vec::new());
                    set_tasks.set(Vec::new());
                    set_report_summary.set(None);
                    set_detail_error.set(Some(err));
                    set_detail_loading.set(false);
                }
            }
        });
    });

    let on_create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_action_error.set(None);
        set_action_notice.set(None);
        set_creating.set(true);

        let body = CreateApt {
            patient_id: f_patient.get(),
            provider_id: {
                let value = f_provider.get();
                if value.is_empty() { None } else { Some(value) }
            },
            doctor_id: {
                let value = f_doctor.get();
                if value.is_empty() { None } else { Some(value) }
            },
            owner_user_id: {
                let value = f_owner.get();
                if value.is_empty() { None } else { Some(value) }
            },
            interpreter_id: {
                let value = f_interpreter.get();
                if value.is_empty() { None } else { Some(value) }
            },
            appointment_type: f_type.get(),
            title: f_title.get(),
            date: f_date.get(),
            time_start: {
                let value = f_time_s.get();
                if value.is_empty() { None } else { Some(value) }
            },
            time_end: {
                let value = f_time_e.get();
                if value.is_empty() { None } else { Some(value) }
            },
            location: {
                let value = f_loc.get();
                if value.is_empty() { None } else { Some(value) }
            },
        };

        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateApt, serde_json::Value>("/appointments", &body).await {
                Ok(value) => {
                    if let Some(id) = value["id"].as_str() {
                        set_selected_appointment_id.set(Some(id.to_string()));
                    }
                    let has_conflicts = value["conflicts"]["has_conflicts"]
                        .as_bool()
                        .unwrap_or(false);
                    set_show_create.set(false);
                    set_f_patient.set(String::new());
                    set_f_provider.set(String::new());
                    set_f_doctor.set(String::new());
                    set_f_owner.set(String::new());
                    set_f_interpreter.set(String::new());
                    set_f_title.set(String::new());
                    set_f_date.set(String::new());
                    set_f_time_s.set(String::new());
                    set_f_time_e.set(String::new());
                    set_f_loc.set(String::new());
                    set_doctors_list.set(Vec::new());
                    set_create_conflicts.set(None);
                    set_action_notice.set(Some(if has_conflicts {
                        "Appointment created with overlap warnings".to_string()
                    } else {
                        "Appointment created".to_string()
                    }));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_creating.set(false);
        });
    };

    let on_update = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };

        set_action_error.set(None);
        set_action_notice.set(None);
        set_editing.set(true);

        let body = UpdateApt {
            provider_id: {
                let value = edit_provider.get();
                if value.is_empty() { None } else { Some(value) }
            },
            doctor_id: {
                let value = edit_doctor.get();
                if value.is_empty() { None } else { Some(value) }
            },
            owner_user_id: {
                let value = edit_owner.get();
                if value.is_empty() { None } else { Some(value) }
            },
            interpreter_id: {
                let value = edit_interpreter.get();
                if value.is_empty() { None } else { Some(value) }
            },
            title: edit_title.get(),
            date: edit_date.get(),
            time_start: {
                let value = edit_time_s.get();
                if value.is_empty() { None } else { Some(value) }
            },
            time_end: {
                let value = edit_time_e.get();
                if value.is_empty() { None } else { Some(value) }
            },
            location: {
                let value = edit_loc.get();
                if value.is_empty() { None } else { Some(value) }
            },
        };

        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<UpdateApt, serde_json::Value>(
                &format!("/appointments/{}/update", detail.id),
                &body,
            )
            .await
            {
                Ok(value) => {
                    let has_conflicts = value["conflicts"]["has_conflicts"]
                        .as_bool()
                        .unwrap_or(false);
                    set_show_edit.set(false);
                    set_action_notice.set(Some(if has_conflicts {
                        "Appointment updated with overlap warnings".to_string()
                    } else {
                        "Appointment updated".to_string()
                    }));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_editing.set(false);
        });
    };

    let on_add_checklist = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };
        let body = ChecklistItemReq {
            phase: checklist_phase.get(),
            item_text: checklist_text.get(),
        };

        set_action_busy.set(true);
        set_action_error.set(None);
        set_action_notice.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<ChecklistItemReq, serde_json::Value>(
                &format!("/appointments/{}/checklist", detail.id),
                &body,
            )
            .await
            {
                Ok(_) => {
                    set_checklist_text.set(String::new());
                    set_action_notice.set(Some("Checklist item added".to_string()));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_action_busy.set(false);
        });
    };

    let on_add_reminder = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };

        let body = CreateReminderReq {
            user_id: reminder_user_id.get(),
            remind_at: normalize_datetime_local(&reminder_at.get()),
            title: reminder_title.get(),
            description: {
                let value = reminder_description.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
        };

        set_action_busy.set(true);
        set_action_error.set(None);
        set_action_notice.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateReminderReq, serde_json::Value>(
                &format!("/appointments/{}/reminders", detail.id),
                &body,
            )
            .await
            {
                Ok(_) => {
                    set_reminder_user_id.set(String::new());
                    set_reminder_at.set(String::new());
                    set_reminder_title.set(String::new());
                    set_reminder_description.set(String::new());
                    set_action_notice.set(Some("Reminder created".to_string()));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_action_busy.set(false);
        });
    };

    let on_add_task = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };

        let body = CreateTaskReq {
            title: task_title.get(),
            description: {
                let value = task_description.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
            assigned_to: task_assignee_id.get(),
            appointment_id: detail.id.clone(),
            due_date: {
                let value = task_due_at.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(normalize_datetime_local(&value))
                }
            },
            priority: task_priority.get(),
        };

        set_action_busy.set(true);
        set_action_error.set(None);
        set_action_notice.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateTaskReq, serde_json::Value>("/tasks", &body).await {
                Ok(_) => {
                    set_task_title.set(String::new());
                    set_task_description.set(String::new());
                    set_task_due_at.set(String::new());
                    set_task_assignee_id.set(String::new());
                    set_task_priority.set("normal".to_string());
                    set_action_notice.set(Some("Task created".to_string()));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_action_busy.set(false);
        });
    };

    let on_add_concierge_service = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };

        let estimate = {
            let value = service_cost_estimate.get();
            if value.trim().is_empty() {
                None
            } else {
                value.parse::<f64>().ok()
            }
        };

        let body = CreateConciergeServiceReq {
            patient_id: detail.patient_id.clone(),
            appointment_id: detail.id.clone(),
            provider_id: detail.provider_id.clone(),
            assigned_concierge_id: {
                let value = service_assignee_id.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
            service_kind: service_kind.get(),
            title: service_title.get(),
            booking_reference: {
                let value = service_booking_reference.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
            vendor_name: {
                let value = service_vendor_name.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
            starts_at: {
                let value = service_start_at.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(normalize_datetime_local(&value))
                }
            },
            ends_at: {
                let value = service_end_at.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(normalize_datetime_local(&value))
                }
            },
            cost_estimate: estimate,
            currency: service_currency.get(),
            service_notes: {
                let value = service_notes.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
        };

        set_action_busy.set(true);
        set_action_error.set(None);
        set_action_notice.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateConciergeServiceReq, ConciergeServiceEntry>(
                "/concierge-services",
                &body,
            )
            .await
            {
                Ok(_) => {
                    set_service_kind.set("transfer".to_string());
                    set_service_title.set(detail.title.clone());
                    set_service_assignee_id.set(String::new());
                    set_service_booking_reference.set(String::new());
                    set_service_vendor_name.set(String::new());
                    set_service_start_at.set(String::new());
                    set_service_end_at.set(String::new());
                    set_service_cost_estimate.set(String::new());
                    set_service_currency.set("EUR".to_string());
                    set_service_notes.set(String::new());
                    set_action_notice.set(Some("Concierge service created".to_string()));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_action_busy.set(false);
        });
    };

    let on_submit_report = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let Some(detail) = selected_detail.get() else {
            return;
        };
        let hours = report_hours.get().parse::<f64>().unwrap_or(0.0);
        let body = SubmitReportReq {
            hours,
            report_text: {
                let value = report_text.get();
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
        };

        set_action_busy.set(true);
        set_action_error.set(None);
        set_action_notice.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<SubmitReportReq, serde_json::Value>(
                &format!("/appointments/{}/report", detail.id),
                &body,
            )
            .await
            {
                Ok(_) => {
                    set_report_hours.set(String::new());
                    set_report_text.set(String::new());
                    set_action_notice.set(Some("Interpreter report submitted".to_string()));
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(err) => set_action_error.set(Some(err)),
            }
            set_action_busy.set(false);
        });
    };

    let prev_month = move |_| {
        let month = cal_month.get();
        let year = cal_year.get();
        if month == 1 {
            set_cal_month.set(12);
            set_cal_year.set(year - 1);
        } else {
            set_cal_month.set(month - 1);
        }
    };

    let next_month = move |_| {
        let month = cal_month.get();
        let year = cal_year.get();
        if month == 12 {
            set_cal_month.set(1);
            set_cal_year.set(year + 1);
        } else {
            set_cal_month.set(month + 1);
        }
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).appointments_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).appointments_subtitle}</p>
                </div>
                <div class="provider-inline-actions">
                    {move || {
                        current_user.user.get().map(|user| {
                            view! { <span class="tag tag--gray">{format!("{} mode", role_display_name(&user.role))}</span> }
                        })
                    }}
                    <div class="entity-tabs">
                        <button
                            class=move || if view_mode.get() == ViewMode::Calendar { "entity-tab active" } else { "entity-tab" }
                            on:click=move |_| set_view_mode.set(ViewMode::Calendar)
                        >
                            "📅"
                        </button>
                        <button
                            class=move || if view_mode.get() == ViewMode::Table { "entity-tab active" } else { "entity-tab" }
                            on:click=move |_| set_view_mode.set(ViewMode::Table)
                        >
                            "📋"
                        </button>
                    </div>
                    {move || {
                        if permissions().can_create {
                            view! {
                                <button class="btn-primary" on:click=move |_| {
                                    set_show_create.set(!show_create.get());
                                    load_patients();
                                    load_providers();
                                }>
                                    "+ " {move || i18n::t(lang.get()).appointments_new}
                                </button>
                            }.into_any()
                        } else {
                            view! { <></> }.into_any()
                        }
                    }}
                </div>
            </div>

            {move || {
                debug_log("appointments:render-body");
                if current_user.loading.get() {
                    return view! { <div class="page-loading">"Loading appointments..."</div> }.into_any();
                }

                if !permissions().can_view_page {
                    return view! {
                        <div class="card">
                            <div class="empty-state">
                                "This role does not have access to appointments."
                            </div>
                        </div>
                    }
                    .into_any();
                }

                if loading.get() && apts.get().is_empty() && load_error.get().is_none() {
                    return view! { <div class="page-loading">"Loading appointments..."</div> }
                        .into_any();
                }

                view! {
                    <>
                        {move || {
                            if let Some(notice) = action_notice.get() {
                                view! { <div class="appointments-banner appointments-banner--ok">{notice}</div> }.into_any()
                            } else {
                                view! { <></> }.into_any()
                            }
                        }}
                        {move || {
                            if let Some(err) = action_error.get() {
                                view! { <div class="appointments-banner appointments-banner--error">{err}</div> }.into_any()
                            } else {
                                view! { <></> }.into_any()
                            }
                        }}
                        <div class="card" style="margin-bottom:16px">
                            <div class="provider-inline-actions">
                                <span class="tag tag--gray">{move || format!("Unified total: {}", apts.get().len())}</span>
                                <span class="tag tag--blue">{move || format!("Medical: {}", apts.get().iter().filter(|item| item.apt_type == "medical").count())}</span>
                                <span class="tag tag--teal">{move || format!("Non-medical: {}", apts.get().iter().filter(|item| item.apt_type == "non_medical").count())}</span>
                                <span class="tag tag--amber">{move || format!("Internal: {}", apts.get().iter().filter(|item| item.apt_type == "internal").count())}</span>
                                <span class="tag tag--red">{move || format!("Blocked: {}", apts.get().iter().filter(|item| item.is_blocked).count())}</span>
                            </div>
                        </div>
                        <div class="card" style="margin-bottom:16px">
                            <div class="create-form">
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{move || i18n::t(lang.get()).common_search}</label>
                                        <input
                                            type="text"
                                            class="search-input"
                                            placeholder=move || i18n::t(lang.get()).common_search
                                            prop:value=search
                                            on:input=move |ev| set_search.set(event_target_value(&ev))
                                        />
                                    </div>
                                    <div class="form-field">
                                        <label>{move || i18n::t(lang.get()).users_status}</label>
                                        <select prop:value=filter_status on:change=move |ev| set_filter_status.set(event_target_value(&ev))>
                                            <option value="">"All statuses"</option>
                                            <option value="planned">"planned"</option>
                                            <option value="confirmed">"confirmed"</option>
                                            <option value="in_progress">"in_progress"</option>
                                            <option value="completed">"completed"</option>
                                            <option value="cancelled">"cancelled"</option>
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>{move || i18n::t(lang.get()).appointments_type}</label>
                                        <select prop:value=filter_type on:change=move |ev| set_filter_type.set(event_target_value(&ev))>
                                            <option value="">"All types"</option>
                                            <option value="medical">{move || i18n::t(lang.get()).apt_type_medical}</option>
                                            <option value="non_medical">{move || i18n::t(lang.get()).apt_type_non_medical}</option>
                                            <option value="internal">{move || i18n::t(lang.get()).apt_type_internal}</option>
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>"Interpreter"</label>
                                        <select prop:value=filter_interpreter on:change=move |ev| set_filter_interpreter.set(event_target_value(&ev))>
                                            <option value="">"All interpreters"</option>
                                            {move || {
                                                interpreter_options
                                                    .get()
                                                    .into_iter()
                                                    .map(|item| {
                                                        view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                    })
                                                    .collect::<Vec<_>>()
                                            }}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>"Owner"</label>
                                        <select prop:value=filter_owner on:change=move |ev| set_filter_owner.set(event_target_value(&ev))>
                                            <option value="">"All owners"</option>
                                            {move || {
                                                staff_options
                                                    .get()
                                                    .into_iter()
                                                    .filter(|item| item.role != "ceo")
                                                    .map(|item| {
                                                        view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                    })
                                                    .collect::<Vec<_>>()
                                            }}
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>"Provider"</label>
                                        <select prop:value=filter_provider on:change=move |ev| set_filter_provider.set(event_target_value(&ev))>
                                            <option value="">"All providers"</option>
                                            {move || {
                                                providers_list
                                                    .get()
                                                    .into_iter()
                                                    .map(|provider| {
                                                        let label = match provider.address_city {
                                                            Some(city) if !city.is_empty() => format!("{} ({city})", provider.name),
                                                            _ => provider.name,
                                                        };
                                                        view! { <option value=provider.id>{label}</option> }
                                                    })
                                                    .collect::<Vec<_>>()
                                            }}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>"Doctor"</label>
                                        <select prop:value=filter_doctor on:change=move |ev| set_filter_doctor.set(event_target_value(&ev))>
                                            <option value="">"All doctors"</option>
                                            {move || {
                                                filter_doctors
                                                    .get()
                                                    .into_iter()
                                                    .map(|doctor| {
                                                        let label = match doctor.fachbereich {
                                                            Some(fach) if !fach.is_empty() => format!("{} ({fach})", doctor.name),
                                                            _ => doctor.name,
                                                        };
                                                        view! { <option value=doctor.id>{label}</option> }
                                                    })
                                                    .collect::<Vec<_>>()
                                            }}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>{move || i18n::t(lang.get()).appointments_date}" from"</label>
                                        <input type="date" prop:value=filter_date_from on:input=move |ev| set_filter_date_from.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field">
                                        <label>{move || i18n::t(lang.get()).appointments_date}" to"</label>
                                        <input type="date" prop:value=filter_date_to on:input=move |ev| set_filter_date_to.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {move || {
                            if show_create.get() && permissions().can_create {
                                view! {
                                    <div class="card" style="margin-bottom:24px">
                                        <div class="card-header"><h2>{move || i18n::t(lang.get()).appointments_new}</h2></div>
                                        <form class="create-form" on:submit=on_create>
                                            <div class="form-row">
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).orders_patient}" *"</label>
                                                    <select required prop:value=f_patient on:change=move |ev| set_f_patient.set(event_target_value(&ev))>
                                                        <option value="">""</option>
                                                        {move || {
                                                            patients_list
                                                                .get()
                                                                .into_iter()
                                                                .map(|(id, name)| view! { <option value=id>{name}</option> })
                                                                .collect::<Vec<_>>()
                                                        }}
                                                    </select>
                                                </div>
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).appointments_type}" *"</label>
                                                    <select prop:value=f_type on:change=move |ev| set_f_type.set(event_target_value(&ev))>
                                                        <option value="medical">{move || i18n::t(lang.get()).apt_type_medical}</option>
                                                        <option value="non_medical">{move || i18n::t(lang.get()).apt_type_non_medical}</option>
                                                        <option value="internal">{move || i18n::t(lang.get()).apt_type_internal}</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field">
                                                    <label>"Provider"</label>
                                                    <select prop:value=f_provider on:change=move |ev| set_f_provider.set(event_target_value(&ev))>
                                                        <option value="">""</option>
                                                        {move || {
                                                            providers_list
                                                                .get()
                                                                .into_iter()
                                                                .map(|provider| {
                                                                    let label = match provider.address_city {
                                                                        Some(city) if !city.is_empty() => format!("{} ({city})", provider.name),
                                                                        _ => provider.name,
                                                                    };
                                                                    view! { <option value=provider.id>{label}</option> }
                                                                })
                                                                .collect::<Vec<_>>()
                                                        }}
                                                    </select>
                                                </div>
                                                <div class="form-field">
                                                    <label>"Doctor"</label>
                                                    <select prop:value=f_doctor on:change=move |ev| set_f_doctor.set(event_target_value(&ev))>
                                                        <option value="">""</option>
                                                        {move || {
                                                            doctors_list
                                                                .get()
                                                                .into_iter()
                                                                .map(|doctor| {
                                                                    let label = match doctor.fachbereich {
                                                                        Some(fach) if !fach.is_empty() => format!("{} ({fach})", doctor.name),
                                                                        _ => doctor.name,
                                                                    };
                                                                    view! { <option value=doctor.id>{label}</option> }
                                                                })
                                                                .collect::<Vec<_>>()
                                                        }}
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).appointments_title_col}" *"</label>
                                                    <input type="text" required prop:value=f_title on:input=move |ev| set_f_title.set(event_target_value(&ev)) />
                                                </div>
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).appointments_date}" *"</label>
                                                    <input type="date" required prop:value=f_date on:input=move |ev| set_f_date.set(event_target_value(&ev)) />
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).apt_time_from}</label>
                                                    <input type="time" prop:value=f_time_s on:input=move |ev| set_f_time_s.set(event_target_value(&ev)) />
                                                </div>
                                                <div class="form-field">
                                                    <label>{move || i18n::t(lang.get()).apt_time_to}</label>
                                                    <input type="time" prop:value=f_time_e on:input=move |ev| set_f_time_e.set(event_target_value(&ev)) />
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field">
                                                    <label>"Owner"</label>
                                                    <select prop:value=f_owner on:change=move |ev| set_f_owner.set(event_target_value(&ev))>
                                                        <option value="">"Not assigned"</option>
                                                        {move || {
                                                            let current_role = current_user.user.get().map(|user| user.role).unwrap_or_default();
                                                            let current_user_id = current_user.user.get().map(|user| user.id).unwrap_or_default();
                                                            staff_options
                                                                .get()
                                                                .into_iter()
                                                                .filter(|item| item.role != "ceo")
                                                                .filter(|item| match current_role.as_str() {
                                                                    "teamlead_interpreter" => {
                                                                        item.id == current_user_id || item.role == "interpreter" || item.role == "teamlead_interpreter"
                                                                    }
                                                                    "concierge" => item.id == current_user_id && item.role == "concierge",
                                                                    _ => true,
                                                                })
                                                                .map(|item| {
                                                                    view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                })
                                                                .collect::<Vec<_>>()
                                                        }}
                                                    </select>
                                                </div>
                                                <div class="form-field">
                                                    <label>"Interpreter"</label>
                                                    <select prop:value=f_interpreter on:change=move |ev| set_f_interpreter.set(event_target_value(&ev))>
                                                        <option value="">"Not assigned"</option>
                                                        {move || {
                                                            interpreter_options
                                                                .get()
                                                                .into_iter()
                                                                .map(|item| {
                                                                    view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                })
                                                                .collect::<Vec<_>>()
                                                        }}
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="form-field">
                                                <label>{move || i18n::t(lang.get()).appointments_location}</label>
                                                <input type="text" prop:value=f_loc on:input=move |ev| set_f_loc.set(event_target_value(&ev)) />
                                            </div>
                                            {move || {
                                                if create_conflicts_loading.get() {
                                                    view! { <div class="provider-subline">"Checking overlap warnings..."</div> }.into_any()
                                                } else {
                                                    match create_conflicts.get() {
                                                        Some(summary) if summary.has_conflicts => {
                                                            let patient_conflicts = summary.patient_conflicts.clone();
                                                            let interpreter_conflicts = summary.interpreter_conflicts.clone();
                                                            view! {
                                                                <div class="appointments-banner appointments-banner--error">
                                                                    <strong>{format!("Overlap warnings: patient {} / interpreter {}", summary.patient_conflict_count, summary.interpreter_conflict_count)}</strong>
                                                                    {if !patient_conflicts.is_empty() {
                                                                        view! {
                                                                            <div style="margin-top:8px">
                                                                                <div><strong>"Patient conflicts"</strong></div>
                                                                                <ul>
                                                                                    {patient_conflicts.into_iter().map(|item| {
                                                                                        let context = provider_doctor_label(item.provider_name.as_deref(), item.doctor_name.as_deref());
                                                                                        let time = format_time_range(item.time_start.as_deref(), item.time_end.as_deref());
                                                                                        let suffix = if item.is_blocked { "blocked slot".to_string() } else { context };
                                                                                        view! { <li>{format!("{} {} | {} | {}", item.date, time, item.title, suffix)}</li> }
                                                                                    }).collect::<Vec<_>>()}
                                                                                </ul>
                                                                            </div>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }}
                                                                    {if !interpreter_conflicts.is_empty() {
                                                                        view! {
                                                                            <div style="margin-top:8px">
                                                                                <div><strong>"Interpreter conflicts"</strong></div>
                                                                                <ul>
                                                                                    {interpreter_conflicts.into_iter().map(|item| {
                                                                                        let time = format_time_range(item.time_start.as_deref(), item.time_end.as_deref());
                                                                                        let who = item.interpreter_name.unwrap_or_else(|| "Unassigned".to_string());
                                                                                        view! { <li>{format!("{} {} | {} | {} / {}", item.date, time, item.title, item.patient_pid, who)}</li> }
                                                                                    }).collect::<Vec<_>>()}
                                                                                </ul>
                                                                            </div>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }}
                                                                </div>
                                                            }.into_any()
                                                        }
                                                        Some(_) if !f_patient.get().trim().is_empty() && !f_date.get().trim().is_empty() => {
                                                            view! { <div class="appointments-banner appointments-banner--ok">"No overlaps detected for the selected patient/interpreter."</div> }.into_any()
                                                        }
                                                        _ => view! { <></> }.into_any(),
                                                    }
                                                }
                                            }}
                                            <div class="form-actions">
                                                <button type="submit" class="btn-primary" disabled=creating>
                                                    {move || if creating.get() { "..." } else { i18n::t(lang.get()).common_save }}
                                                </button>
                                                <button type="button" class="btn-secondary" on:click=move |_| {
                                                    set_show_create.set(false);
                                                    set_create_conflicts.set(None);
                                                }>
                                                    {move || i18n::t(lang.get()).common_cancel}
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                }
                                .into_any()
                            } else {
                                view! { <></> }.into_any()
                            }
                        }}

                        <div class="appointments-workspace">
                            <div class="appointments-main">
                                {move || {
                                    if loading.get() {
                                        return view! { <div class="page-loading">{move || i18n::t(lang.get()).common_loading}</div> }.into_any();
                                    }

                                    if let Some(err) = load_error.get() {
                                        return view! { <div class="page-error">{err}</div> }.into_any();
                                    }

                                    if apts.get().is_empty() {
                                        return view! {
                                            <div class="card">
                                                <div class="empty-state">
                                                    <strong>"No appointments available for this role right now."</strong>
                                                    <div class="provider-subline" style="margin-top:8px">
                                                        "Check active filters, patient assignments, and owner mappings for the current user."
                                                    </div>
                                                </div>
                                            </div>
                                        }.into_any();
                                    }

                                    match view_mode.get() {
                                        ViewMode::Calendar => {
                                            let year = cal_year.get();
                                            let month = cal_month.get();
                                            let days = days_in_month(year, month);
                                            let first_wd = weekday_of_first(year, month);
                                            let items = apts.get();
                                            let month_str = format!("{year:04}-{month:02}");
                                            let weekdays = match lang.get() {
                                                Lang::De => WEEKDAYS_DE,
                                                Lang::Ru => WEEKDAYS_RU,
                                            };
                                            let month_name = match lang.get() {
                                                Lang::De => MONTHS_DE[month as usize],
                                                Lang::Ru => MONTHS_RU[month as usize],
                                            };
                                            let selected = selected_appointment_id.get();

                                            let mut cells = Vec::<(Option<u32>, Vec<Appointment>)>::new();
                                            for _ in 0..first_wd {
                                                cells.push((None, vec![]));
                                            }
                                            for day in 1..=days {
                                                let day_str = format!("{month_str}-{day:02}");
                                                let mut day_items = Vec::new();
                                                for item in &items {
                                                    if item.date == day_str {
                                                        day_items.push(item.clone());
                                                    }
                                                }
                                                cells.push((Some(day), day_items));
                                            }
                                            while !cells.len().is_multiple_of(7) {
                                                cells.push((None, vec![]));
                                            }

                                            view! {
                                                <div class="card">
                                                    <div class="cal-header">
                                                        <button class="btn-secondary" on:click=prev_month>"◀"</button>
                                                        <h2>{format!("{month_name} {year}")}</h2>
                                                        <button class="btn-secondary" on:click=next_month>"▶"</button>
                                                    </div>
                                                    <div class="cal-grid">
                                                        {weekdays.iter().map(|weekday| view! { <div class="cal-weekday">{*weekday}</div> }).collect::<Vec<_>>()}
                                                        {cells.into_iter().map(|(day, events)| {
                                                            view! {
                                                                <div class=if day.is_some() { "cal-day" } else { "cal-day cal-empty" }>
                                                                    {day.map(|value| view! { <span class="cal-day-num">{value}</span> })}
                                                                    {events.into_iter().map(|event| {
                                                                        let appointment_id = event.id.clone();
                                                                        let is_selected = selected.as_ref() == Some(&appointment_id);
                                                                        let classes = if is_selected {
                                                                            format!("{} cal-event-selected", type_class(&event.apt_type))
                                                                        } else {
                                                                            type_class(&event.apt_type).to_string()
                                                                        };
                                                                        let time = event.time_start.clone().unwrap_or_default();
                                                                        let short_time = if time.len() > 5 { time[..5].to_string() } else { time };
                                                                        view! {
                                                                            <div
                                                                                class=classes
                                                                                title=format!("{} - {}", event.patient_name, event.title)
                                                                                on:click=move |_| set_selected_appointment_id.set(Some(appointment_id.clone()))
                                                                            >
                                                                                <span class="cal-event-time">{short_time}</span>
                                                                                <span class="cal-event-title">{event.title.chars().take(24).collect::<String>()}</span>
                                                                            </div>
                                                                        }
                                                                    }).collect::<Vec<_>>()}
                                                                </div>
                                                            }
                                                        }).collect::<Vec<_>>()}
                                                    </div>
                                                </div>
                                            }
                                            .into_any()
                                        }
                                        ViewMode::Table => {
                                            let items = apts.get();
                                            let selected = selected_appointment_id.get();

                                            view! {
                                                <div class="card">
                                                    <div class="card-header"><h2>{format!("{} {}", items.len(), i18n::t(lang.get()).appointments_title)}</h2></div>
                                                    <table class="data-table">
                                                        <thead>
                                                            <tr>
                                                                <th>{move || i18n::t(lang.get()).appointments_date}</th>
                                                                <th>{move || i18n::t(lang.get()).appointments_time}</th>
                                                                <th>{move || i18n::t(lang.get()).appointments_title_col}</th>
                                                                <th>{move || i18n::t(lang.get()).orders_patient}</th>
                                                                <th>"Provider / Doctor"</th>
                                                                <th>"Owner"</th>
                                                                <th>"Interpreter"</th>
                                                                <th>{move || i18n::t(lang.get()).appointments_type}</th>
                                                                <th>{move || i18n::t(lang.get()).users_status}</th>
                                                                <th>{move || i18n::t(lang.get()).appointments_location}</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {items.into_iter().map(|item| {
                                                                let is_selected = selected.as_ref() == Some(&item.id);
                                                                let row_class = if is_selected { "appointment-row-selected" } else { "" };
                                                                let appointment_id = item.id.clone();
                                                                let location = item.location.clone().or(item.provider_name.clone()).unwrap_or_default();
                                                                let apt_type = item.apt_type.clone();
                                                                let status = item.status.clone();
                                                                let apt_type_class = type_tag(&apt_type);
                                                                let status_badge = status_class(&status);
                                                                let provider_doctor = provider_doctor_label(
                                                                    item.provider_name.as_deref(),
                                                                    item.doctor_name.as_deref(),
                                                                );
                                                                let owner = item.owner_name.clone().unwrap_or_default();
                                                                let interpreter = item.interpreter_name.clone().unwrap_or_default();
                                                                view! {
                                                                    <tr class=row_class on:click=move |_| set_selected_appointment_id.set(Some(appointment_id.clone()))>
                                                                        <td class="cell-mono">{item.date}</td>
                                                                        <td class="cell-mono">{format_time_range(item.time_start.as_deref(), item.time_end.as_deref())}</td>
                                                                        <td class="cell-primary">{item.title}</td>
                                                                        <td>
                                                                            <div>{item.patient_name}</div>
                                                                            <div class="provider-subline">{item.patient_pid}</div>
                                                                        </td>
                                                                        <td>{provider_doctor}</td>
                                                                        <td>{owner}</td>
                                                                        <td>{interpreter}</td>
                                                                        <td><span class=apt_type_class>{apt_type}</span></td>
                                                                        <td><span class=status_badge>{status}</span></td>
                                                                        <td>{location}</td>
                                                                    </tr>
                                                                }
                                                            }).collect::<Vec<_>>()}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            }
                                            .into_any()
                                        }
                                    }
                                }}
                            </div>

                            <div class="appointments-side">
                                <div class="card">
                                    <div class="card-header">
                                        <h2>"Appointment workspace"</h2>
                                    </div>
                                    {move || {
                                        if detail_loading.get() {
                                            return view! { <div class="empty-state">"Loading appointment details..."</div> }.into_any();
                                        }

                                        if let Some(err) = detail_error.get() {
                                            return view! { <div class="empty-state">{err}</div> }.into_any();
                                        }

                                        let Some(detail) = selected_detail.get() else {
                                            return view! { <div class="empty-state">"Select an appointment to see role-based actions."</div> }.into_any();
                                        };

                                        let current_permissions = permissions();
                                        let current_user_id = current_user
                                            .user
                                            .get()
                                            .map(|user| user.id)
                                            .unwrap_or_default();
                                        let is_my_assignment = detail.interpreter_id.as_deref() == Some(current_user_id.as_str());
                                        let report = report_summary.get();
                                        let assign_appointment_id = detail.id.clone();
                                        let response_appointment_id = detail.id.clone();
                                        let checklist_appointment_id = detail.id.clone();
                                        let approve_appointment_id = detail.id.clone();
                                        let reminders_appointment_id = detail.id.clone();
                                        let report_snapshot = report.clone();
                                        let report_for_approve = report.clone();
                                        let current_user_id_for_reminders = current_user_id.clone();

                                        view! {
                                            <div class="appointments-detail">
                                                <div class="appointments-detail-head">
                                                    <div>
                                                        <div class="appointments-detail-title">{detail.title.clone()}</div>
                                                        <div class="provider-subline">{detail.patient_name.clone()} " • " {detail.patient_pid.clone()}</div>
                                                    </div>
                                                    <div class="provider-inline-actions">
                                                        <span class=status_class(&detail.status)>{detail.status.clone()}</span>
                                                        <span class=type_tag(&detail.apt_type)>{detail.apt_type.clone()}</span>
                                                        {move || {
                                                            if current_permissions.can_edit_schedule && !detail.is_blocked {
                                                                view! {
                                                                    <button
                                                                        type="button"
                                                                        class=if show_edit.get() { "btn-primary" } else { "btn-secondary" }
                                                                        on:click=move |_| set_show_edit.set(!show_edit.get())
                                                                    >
                                                                        {move || if show_edit.get() { "Close edit" } else { "Reschedule / reassign" }}
                                                                    </button>
                                                                }
                                                                .into_any()
                                                            } else {
                                                                view! { <></> }.into_any()
                                                            }
                                                        }}
                                                    </div>
                                                </div>

                                                <div class="appointments-detail-grid">
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">{move || i18n::t(lang.get()).appointments_date}</span>
                                                        <span>{detail.date.clone()}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">{move || i18n::t(lang.get()).appointments_time}</span>
                                                        <span>{format_time_range(detail.time_start.as_deref(), detail.time_end.as_deref())}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Provider / Doctor"</span>
                                                        <span>{provider_doctor_label(detail.provider_name.as_deref(), detail.doctor_name.as_deref())}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Owner"</span>
                                                        <span>{detail.owner_name.clone().unwrap_or_else(|| "Not assigned".to_string())}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Interpreter"</span>
                                                        <span>{detail.interpreter_name.clone().unwrap_or_else(|| "Not assigned".to_string())}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Interpreter response"</span>
                                                        <span class=response_class(detail.interpreter_response.as_deref())>{response_label(detail.interpreter_response.as_deref())}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Checklist phase"</span>
                                                        <span>{detail.checklist_phase.clone()}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">{move || i18n::t(lang.get()).appointments_location}</span>
                                                        <span>{detail.location.clone().unwrap_or_default()}</span>
                                                    </div>
                                                    <div class="appointments-detail-row">
                                                        <span class="appointments-detail-label">"Created"</span>
                                                        <span>{detail.created_at.clone()}</span>
                                                    </div>
                                                </div>
                                                {move || {
                                                    if detail.is_blocked {
                                                        view! {
                                                            <div class="appointments-banner appointments-banner--error">
                                                                "Medical appointment is shown as a blocked slot for concierge. Clinical/provider details stay hidden."
                                                            </div>
                                                        }
                                                        .into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}
                                                {move || {
                                                    if current_permissions.can_edit_schedule && show_edit.get() && !detail.is_blocked {
                                                        let allow_unassigned_owner = current_user
                                                            .user
                                                            .get()
                                                            .as_ref()
                                                            .map(|user| {
                                                                !matches!(user.role.as_str(), "teamlead_interpreter" | "concierge")
                                                            })
                                                            .unwrap_or(true);
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Reschedule and reassignment"</div>
                                                                <form class="appointments-nested-form" on:submit=on_update>
                                                                    <div class="form-row">
                                                                        <div class="form-field">
                                                                            <label>"Provider"</label>
                                                                            <select prop:value=edit_provider on:change=move |ev| set_edit_provider.set(event_target_value(&ev))>
                                                                                <option value="">""</option>
                                                                                {move || {
                                                                                    providers_list
                                                                                        .get()
                                                                                        .into_iter()
                                                                                        .map(|provider| {
                                                                                            let label = match provider.address_city {
                                                                                                Some(city) if !city.is_empty() => format!("{} ({city})", provider.name),
                                                                                                _ => provider.name,
                                                                                            };
                                                                                            view! { <option value=provider.id>{label}</option> }
                                                                                        })
                                                                                        .collect::<Vec<_>>()
                                                                                }}
                                                                            </select>
                                                                        </div>
                                                                        <div class="form-field">
                                                                            <label>"Doctor"</label>
                                                                            <select prop:value=edit_doctor on:change=move |ev| set_edit_doctor.set(event_target_value(&ev))>
                                                                                <option value="">""</option>
                                                                                {move || {
                                                                                    edit_doctors_list
                                                                                        .get()
                                                                                        .into_iter()
                                                                                        .map(|doctor| {
                                                                                            let label = match doctor.fachbereich {
                                                                                                Some(fach) if !fach.is_empty() => format!("{} ({fach})", doctor.name),
                                                                                                _ => doctor.name,
                                                                                            };
                                                                                            view! { <option value=doctor.id>{label}</option> }
                                                                                        })
                                                                                        .collect::<Vec<_>>()
                                                                                }}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                    <div class="form-row">
                                                                        <div class="form-field">
                                                                            <label>"Title"</label>
                                                                            <input type="text" required prop:value=edit_title on:input=move |ev| set_edit_title.set(event_target_value(&ev)) />
                                                                        </div>
                                                                        <div class="form-field">
                                                                            <label>{move || i18n::t(lang.get()).appointments_date}</label>
                                                                            <input type="date" required prop:value=edit_date on:input=move |ev| set_edit_date.set(event_target_value(&ev)) />
                                                                        </div>
                                                                    </div>
                                                                    <div class="form-row">
                                                                        <div class="form-field">
                                                                            <label>{move || i18n::t(lang.get()).apt_time_from}</label>
                                                                            <input type="time" prop:value=edit_time_s on:input=move |ev| set_edit_time_s.set(event_target_value(&ev)) />
                                                                        </div>
                                                                        <div class="form-field">
                                                                            <label>{move || i18n::t(lang.get()).apt_time_to}</label>
                                                                            <input type="time" prop:value=edit_time_e on:input=move |ev| set_edit_time_e.set(event_target_value(&ev)) />
                                                                        </div>
                                                                    </div>
                                                                    <div class="form-row">
                                                                        <div class="form-field">
                                                                            <label>"Owner"</label>
                                                                            <select prop:value=edit_owner on:change=move |ev| set_edit_owner.set(event_target_value(&ev))>
                                                                                {move || {
                                                                                    if allow_unassigned_owner {
                                                                                        view! { <option value="">"Not assigned"</option> }.into_any()
                                                                                    } else {
                                                                                        view! { <></> }.into_any()
                                                                                    }
                                                                                }}
                                                                                {move || {
                                                                                    let current_role = current_user.user.get().map(|user| user.role).unwrap_or_default();
                                                                                    let current_user_id = current_user.user.get().map(|user| user.id).unwrap_or_default();
                                                                                    staff_options
                                                                                        .get()
                                                                                        .into_iter()
                                                                                        .filter(|item| item.role != "ceo")
                                                                                        .filter(|item| match current_role.as_str() {
                                                                                            "teamlead_interpreter" => {
                                                                                                item.id == current_user_id || item.role == "interpreter" || item.role == "teamlead_interpreter"
                                                                                            }
                                                                                            "concierge" => item.id == current_user_id && item.role == "concierge",
                                                                                            _ => true,
                                                                                        })
                                                                                        .map(|item| {
                                                                                            view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                                        })
                                                                                        .collect::<Vec<_>>()
                                                                                }}
                                                                            </select>
                                                                        </div>
                                                                        {move || {
                                                                            if current_permissions.can_assign_interpreter {
                                                                                view! {
                                                                                    <div class="form-field">
                                                                                        <label>"Interpreter"</label>
                                                                                        <select prop:value=edit_interpreter on:change=move |ev| set_edit_interpreter.set(event_target_value(&ev))>
                                                                                            <option value="">"Not assigned"</option>
                                                                                            {move || {
                                                                                                interpreter_options
                                                                                                    .get()
                                                                                                    .into_iter()
                                                                                                    .map(|item| {
                                                                                                        view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                                                    })
                                                                                                    .collect::<Vec<_>>()
                                                                                            }}
                                                                                        </select>
                                                                                    </div>
                                                                                }
                                                                                .into_any()
                                                                            } else {
                                                                                view! { <></> }.into_any()
                                                                            }
                                                                        }}
                                                                    </div>
                                                                    <div class="form-field">
                                                                        <label>{move || i18n::t(lang.get()).appointments_location}</label>
                                                                        <input type="text" prop:value=edit_loc on:input=move |ev| set_edit_loc.set(event_target_value(&ev)) />
                                                                    </div>
                                                                    {move || {
                                                                        if edit_conflicts_loading.get() {
                                                                            view! { <div class="provider-subline">"Checking overlap warnings..."</div> }.into_any()
                                                                        } else {
                                                                            match edit_conflicts.get() {
                                                                                Some(summary) if summary.has_conflicts => {
                                                                                    let patient_conflicts = summary.patient_conflicts.clone();
                                                                                    let interpreter_conflicts = summary.interpreter_conflicts.clone();
                                                                                    view! {
                                                                                        <div class="appointments-banner appointments-banner--error">
                                                                                            <strong>{format!("Overlap warnings: patient {} / interpreter {}", summary.patient_conflict_count, summary.interpreter_conflict_count)}</strong>
                                                                                            {if !patient_conflicts.is_empty() {
                                                                                                view! {
                                                                                                    <div style="margin-top:8px">
                                                                                                        <div><strong>"Patient conflicts"</strong></div>
                                                                                                        <ul>
                                                                                                            {patient_conflicts.into_iter().map(|item| {
                                                                                                                let context = provider_doctor_label(item.provider_name.as_deref(), item.doctor_name.as_deref());
                                                                                                                let time = format_time_range(item.time_start.as_deref(), item.time_end.as_deref());
                                                                                                                let suffix = if item.is_blocked { "blocked slot".to_string() } else { context };
                                                                                                                view! { <li>{format!("{} {} | {} | {}", item.date, time, item.title, suffix)}</li> }
                                                                                                            }).collect::<Vec<_>>()}
                                                                                                        </ul>
                                                                                                    </div>
                                                                                                }.into_any()
                                                                                            } else {
                                                                                                view! { <></> }.into_any()
                                                                                            }}
                                                                                            {if !interpreter_conflicts.is_empty() {
                                                                                                view! {
                                                                                                    <div style="margin-top:8px">
                                                                                                        <div><strong>"Interpreter conflicts"</strong></div>
                                                                                                        <ul>
                                                                                                            {interpreter_conflicts.into_iter().map(|item| {
                                                                                                                let time = format_time_range(item.time_start.as_deref(), item.time_end.as_deref());
                                                                                                                let who = item.interpreter_name.unwrap_or_else(|| "Unassigned".to_string());
                                                                                                                view! { <li>{format!("{} {} | {} | {} / {}", item.date, time, item.title, item.patient_pid, who)}</li> }
                                                                                                            }).collect::<Vec<_>>()}
                                                                                                        </ul>
                                                                                                    </div>
                                                                                                }.into_any()
                                                                                            } else {
                                                                                                view! { <></> }.into_any()
                                                                                            }}
                                                                                        </div>
                                                                                    }.into_any()
                                                                                }
                                                                                Some(_) if !edit_date.get().trim().is_empty() => {
                                                                                    view! { <div class="appointments-banner appointments-banner--ok">"No overlaps detected for the updated slot."</div> }.into_any()
                                                                                }
                                                                                _ => view! { <></> }.into_any(),
                                                                            }
                                                                        }
                                                                    }}
                                                                    <div class="form-actions">
                                                                        <button type="submit" class="btn-primary" disabled=editing>
                                                                            {move || if editing.get() { "..." } else { "Save changes" }}
                                                                        </button>
                                                                        <button type="button" class="btn-secondary" on:click=move |_| {
                                                                            set_show_edit.set(false);
                                                                            set_edit_conflicts.set(None);
                                                                        }>
                                                                            "Cancel"
                                                                        </button>
                                                                    </div>
                                                                </form>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}
                                                {move || {
                                                    if current_permissions.can_manage_status {
                                                        let statuses = ["planned", "confirmed", "in_progress", "completed", "cancelled"];
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Status workflow"</div>
                                                                <div class="provider-inline-actions">
                                                                    {statuses.into_iter().map(|status| {
                                                                        let appointment_id = detail.id.clone();
                                                                        let status_value = status.to_string();
                                                                        view! {
                                                                            <button
                                                                                class=if detail.status == status_value { "btn-primary" } else { "btn-secondary" }
                                                                                disabled=action_busy
                                                                                on:click=move |_| {
                                                                                    let appointment_id = appointment_id.clone();
                                                                                    let body = StatusUpdateReq { status: status_value.clone() };
                                                                                    set_action_busy.set(true);
                                                                                    set_action_error.set(None);
                                                                                    set_action_notice.set(None);
                                                                                    wasm_bindgen_futures::spawn_local(async move {
                                                                                        match client::post::<StatusUpdateReq, serde_json::Value>(
                                                                                            &format!("/appointments/{appointment_id}/status"),
                                                                                            &body,
                                                                                        )
                                                                                        .await
                                                                                        {
                                                                                            Ok(_) => {
                                                                                                set_action_notice.set(Some("Appointment status updated".to_string()));
                                                                                                set_reload_nonce.update(|value| *value += 1);
                                                                                            }
                                                                                            Err(err) => set_action_error.set(Some(err)),
                                                                                        }
                                                                                        set_action_busy.set(false);
                                                                                    });
                                                                                }
                                                                            >
                                                                                {status}
                                                                            </button>
                                                                        }
                                                                    }).collect::<Vec<_>>()}
                                                                </div>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_assign_interpreter {
                                                        let panel_appointment_id = assign_appointment_id.clone();
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Assign interpreter"</div>
                                                                <div class="form-row appointments-inline-form">
                                                                    <div class="form-field">
                                                                        <label>"Interpreter"</label>
                                                                        <select prop:value=selected_interpreter on:change=move |ev| set_selected_interpreter.set(event_target_value(&ev))>
                                                                            <option value="">"Select interpreter"</option>
                                                                            {move || {
                                                                                interpreter_options
                                                                                    .get()
                                                                                    .into_iter()
                                                                                    .map(|item| {
                                                                                        view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                                    })
                                                                                    .collect::<Vec<_>>()
                                                                            }}
                                                                        </select>
                                                                    </div>
                                                                    <div class="appointments-inline-action">
                                                                        <button
                                                                            class="btn-primary"
                                                                            disabled=move || action_busy.get() || selected_interpreter.get().is_empty()
                                                                            on:click=move |_| {
                                                                                let appointment_id = panel_appointment_id.clone();
                                                                                let interpreter_id = selected_interpreter.get();
                                                                                let body = AssignInterpreterReq { interpreter_id };
                                                                                set_action_busy.set(true);
                                                                                set_action_error.set(None);
                                                                                set_action_notice.set(None);
                                                                                wasm_bindgen_futures::spawn_local(async move {
                                                                                    match client::post::<AssignInterpreterReq, serde_json::Value>(
                                                                                        &format!("/appointments/{appointment_id}/assign-interpreter"),
                                                                                        &body,
                                                                                    )
                                                                                    .await
                                                                                    {
                                                                                        Ok(_) => {
                                                                                            set_action_notice.set(Some("Interpreter assigned".to_string()));
                                                                                            set_reload_nonce.update(|value| *value += 1);
                                                                                        }
                                                                                        Err(err) => set_action_error.set(Some(err)),
                                                                                    }
                                                                                    set_action_busy.set(false);
                                                                                });
                                                                            }
                                                                        >
                                                                            "Assign"
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_respond_to_assignment && is_my_assignment {
                                                        let responses = [
                                                            ("accepted", "Accept"),
                                                            ("declined", "Decline"),
                                                            ("discussion_requested", "Ask discussion"),
                                                        ];
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Interpreter response"</div>
                                                                <div class="provider-inline-actions">
                                                                    {responses.into_iter().map(|(value, label)| {
                                                                        let appointment_id = response_appointment_id.clone();
                                                                        let response_value = value.to_string();
                                                                        view! {
                                                                            <button
                                                                                class="btn-secondary"
                                                                                disabled=action_busy
                                                                                on:click=move |_| {
                                                                                    let appointment_id = appointment_id.clone();
                                                                                    let request = InterpreterResponseReq { response: response_value.clone() };
                                                                                    set_action_busy.set(true);
                                                                                    set_action_error.set(None);
                                                                                    set_action_notice.set(None);
                                                                                    wasm_bindgen_futures::spawn_local(async move {
                                                                                        match client::post::<InterpreterResponseReq, serde_json::Value>(
                                                                                            &format!("/appointments/{appointment_id}/interpreter-response"),
                                                                                            &request,
                                                                                        )
                                                                                        .await
                                                                                        {
                                                                                            Ok(_) => {
                                                                                                set_action_notice.set(Some("Interpreter response saved".to_string()));
                                                                                                set_reload_nonce.update(|value| *value += 1);
                                                                                            }
                                                                                            Err(err) => set_action_error.set(Some(err)),
                                                                                        }
                                                                                        set_action_busy.set(false);
                                                                                    });
                                                                                }
                                                                            >
                                                                                {label}
                                                                            </button>
                                                                        }
                                                                    }).collect::<Vec<_>>()}
                                                                </div>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}
                                                {move || {
                                                    if current_permissions.can_manage_checklist {
                                                        let panel_appointment_id = checklist_appointment_id.clone();
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Checklist"</div>
                                                                <div class="appointments-checklist">
                                                                    {move || {
                                                                        let items = checklist.get();
                                                                        if items.is_empty() {
                                                                            view! { <div class="provider-subline">"No checklist items yet."</div> }.into_any()
                                                                        } else {
                                                                            view! {
                                                                                <div class="appointments-checklist-list">
                                                                                    {items.into_iter().map(|item| {
                                                                                        let appointment_id = panel_appointment_id.clone();
                                                                                        let item_id = item.id.clone();
                                                                                        view! {
                                                                                            <div class="appointments-checklist-item">
                                                                                                <div>
                                                                                                    <div>{item.item_text}</div>
                                                                                                    <div class="provider-subline">{format!("{} • {}", item.phase, if item.is_completed { "done" } else { "open" })}</div>
                                                                                                </div>
                                                                                                {if item.is_completed {
                                                                                                    view! { <span class="tag tag--green">"done"</span> }.into_any()
                                                                                                } else {
                                                                                                    view! {
                                                                                                        <button
                                                                                                            class="btn-small"
                                                                                                            disabled=action_busy
                                                                                                            on:click=move |_| {
                                                                                                                let appointment_id = appointment_id.clone();
                                                                                                                let item_id = item_id.clone();
                                                                                                                set_action_busy.set(true);
                                                                                                                set_action_error.set(None);
                                                                                                                set_action_notice.set(None);
                                                                                                                wasm_bindgen_futures::spawn_local(async move {
                                                                                                                    match client::post_no_body(
                                                                                                                        &format!("/appointments/{appointment_id}/checklist/{item_id}/complete"),
                                                                                                                    )
                                                                                                                    .await
                                                                                                                    {
                                                                                                                        Ok(_) => {
                                                                                                                            set_action_notice.set(Some("Checklist item completed".to_string()));
                                                                                                                            set_reload_nonce.update(|value| *value += 1);
                                                                                                                        }
                                                                                                                        Err(err) => set_action_error.set(Some(err)),
                                                                                                                    }
                                                                                                                    set_action_busy.set(false);
                                                                                                                });
                                                                                                            }
                                                                                                        >
                                                                                                            "Complete"
                                                                                                        </button>
                                                                                                    }.into_any()
                                                                                                }}
                                                                                            </div>
                                                                                        }
                                                                                    }).collect::<Vec<_>>()}
                                                                                </div>
                                                                            }.into_any()
                                                                        }
                                                                    }}
                                                                </div>
                                                                <form class="appointments-nested-form" on:submit=on_add_checklist>
                                                                    <div class="form-row">
                                                                        <div class="form-field">
                                                                            <label>"Phase"</label>
                                                                            <select prop:value=checklist_phase on:change=move |ev| set_checklist_phase.set(event_target_value(&ev))>
                                                                                <option value="preparation">"preparation"</option>
                                                                                <option value="execution">"execution"</option>
                                                                                <option value="followup">"followup"</option>
                                                                            </select>
                                                                        </div>
                                                                        <div class="form-field">
                                                                            <label>"Task"</label>
                                                                            <input type="text" prop:value=checklist_text on:input=move |ev| set_checklist_text.set(event_target_value(&ev)) />
                                                                        </div>
                                                                    </div>
                                                                    <div class="form-actions">
                                                                        <button type="submit" class="btn-primary" disabled=move || action_busy.get() || checklist_text.get().trim().is_empty()>
                                                                            "Add checklist item"
                                                                        </button>
                                                                    </div>
                                                                </form>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_view_concierge_services
                                                        && detail.apt_type == "non_medical"
                                                        && !detail.is_blocked
                                                    {
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Concierge / VIP services"</div>
                                                                {move || {
                                                                    let items = concierge_services.get();
                                                                    if items.is_empty() {
                                                                        view! { <div class="provider-subline">"No concierge services linked yet."</div> }.into_any()
                                                                    } else {
                                                                        view! {
                                                                            <div class="appointments-checklist-list">
                                                                                {items.into_iter().map(|service| {
                                                                                    let status_service_id = service.id.clone();
                                                                                    let billing_service_id = service.id.clone();
                                                                                    let current_status = service.status.clone();
                                                                                    let current_billing_status = service.billing_status.clone();
                                                                                    let operational_statuses = ["planned", "booked", "confirmed", "in_service", "completed"];
                                                                                    let billing_statuses = ["draft", "ready", "billed", "settled"];
                                                                                    view! {
                                                                                        <div class="appointments-checklist-item">
                                                                                            <div>
                                                                                                <div>{service.title.clone()}</div>
                                                                                                <div class="provider-subline">{format!(
                                                                                                    "{} • {} • {}",
                                                                                                    service.service_kind,
                                                                                                    service.assigned_concierge_name.clone().unwrap_or_else(|| "Unassigned".to_string()),
                                                                                                    service.provider_name.clone().unwrap_or_else(|| "No provider".to_string())
                                                                                                )}</div>
                                                                                                <div class="provider-subline">{format!(
                                                                                                    "Estimate: {} {} | Actual: {} {}",
                                                                                                    service.cost_estimate.clone().unwrap_or_else(|| "-".to_string()),
                                                                                                    service.currency,
                                                                                                    service.actual_cost.clone().unwrap_or_else(|| "-".to_string()),
                                                                                                    service.currency
                                                                                                )}</div>
                                                                                                {service.booking_reference.clone().map(|value| view! {
                                                                                                    <div class="provider-subline">{format!("Booking ref: {value}")}</div>
                                                                                                })}
                                                                                                {service.vendor_name.clone().map(|value| view! {
                                                                                                    <div class="provider-subline">{format!("Vendor: {value}")}</div>
                                                                                                })}
                                                                                                {service.service_notes.clone().map(|value| view! {
                                                                                                    <div class="provider-subline">{value}</div>
                                                                                                })}
                                                                                            </div>
                                                                                            <div class="provider-inline-actions">
                                                                                                <span class=concierge_service_status_class(&service.status)>{service.status.clone()}</span>
                                                                                                <span class=concierge_billing_status_class(&service.billing_status)>{service.billing_status.clone()}</span>
                                                                                            </div>
                                                                                            {move || {
                                                                                                if current_permissions.can_edit_concierge_services {
                                                                                                    view! {
                                                                                                        <div class="provider-inline-actions">
                                                                                                            {operational_statuses.into_iter().map(|status| {
                                                                                                                let service_id = status_service_id.clone();
                                                                                                                let current_status = current_status.clone();
                                                                                                                let next_status = status.to_string();
                                                                                                                let disabled_status = next_status.clone();
                                                                                                                view! {
                                                                                                                    <button
                                                                                                                        class="btn-small"
                                                                                                                        disabled=move || action_busy.get() || current_status == disabled_status
                                                                                                                        on:click=move |_| {
                                                                                                                            let service_id = service_id.clone();
                                                                                                                            let body = UpdateConciergeServiceReq {
                                                                                                                                assigned_concierge_id: None,
                                                                                                                                service_kind: None,
                                                                                                                                title: None,
                                                                                                                                status: Some(next_status.clone()),
                                                                                                                                billing_status: None,
                                                                                                                                booking_reference: None,
                                                                                                                                vendor_name: None,
                                                                                                                                starts_at: None,
                                                                                                                                ends_at: None,
                                                                                                                                actual_cost: None,
                                                                                                                                service_notes: None,
                                                                                                                                billing_notes: None,
                                                                                                                            };
                                                                                                                            set_action_busy.set(true);
                                                                                                                            set_action_error.set(None);
                                                                                                                            set_action_notice.set(None);
                                                                                                                            wasm_bindgen_futures::spawn_local(async move {
                                                                                                                                match client::post::<UpdateConciergeServiceReq, ConciergeServiceEntry>(&format!("/concierge-services/{service_id}/update"), &body).await {
                                                                                                                                    Ok(_) => {
                                                                                                                                        set_action_notice.set(Some("Concierge service status updated".to_string()));
                                                                                                                                        set_reload_nonce.update(|value| *value += 1);
                                                                                                                                    }
                                                                                                                                    Err(err) => set_action_error.set(Some(err)),
                                                                                                                                }
                                                                                                                                set_action_busy.set(false);
                                                                                                                            });
                                                                                                                        }
                                                                                                                    >
                                                                                                                        {status}
                                                                                                                    </button>
                                                                                                                }
                                                                                                            }).collect::<Vec<_>>()}
                                                                                                        </div>
                                                                                                    }.into_any()
                                                                                                } else {
                                                                                                    view! { <></> }.into_any()
                                                                                                }
                                                                                            }}
                                                                                            {move || {
                                                                                                if current_permissions.can_edit_concierge_billing {
                                                                                                    view! {
                                                                                                        <div class="provider-inline-actions">
                                                                                                            {billing_statuses.into_iter().map(|status| {
                                                                                                                let service_id = billing_service_id.clone();
                                                                                                                let current_billing_status = current_billing_status.clone();
                                                                                                                let next_status = status.to_string();
                                                                                                                let disabled_status = next_status.clone();
                                                                                                                view! {
                                                                                                                    <button
                                                                                                                        class="btn-small"
                                                                                                                        disabled=move || action_busy.get() || current_billing_status == disabled_status
                                                                                                                        on:click=move |_| {
                                                                                                                            let service_id = service_id.clone();
                                                                                                                            let body = UpdateConciergeServiceReq {
                                                                                                                                assigned_concierge_id: None,
                                                                                                                                service_kind: None,
                                                                                                                                title: None,
                                                                                                                                status: None,
                                                                                                                                billing_status: Some(next_status.clone()),
                                                                                                                                booking_reference: None,
                                                                                                                                vendor_name: None,
                                                                                                                                starts_at: None,
                                                                                                                                ends_at: None,
                                                                                                                                actual_cost: None,
                                                                                                                                service_notes: None,
                                                                                                                                billing_notes: None,
                                                                                                                            };
                                                                                                                            set_action_busy.set(true);
                                                                                                                            set_action_error.set(None);
                                                                                                                            set_action_notice.set(None);
                                                                                                                            wasm_bindgen_futures::spawn_local(async move {
                                                                                                                                match client::post::<UpdateConciergeServiceReq, ConciergeServiceEntry>(&format!("/concierge-services/{service_id}/update"), &body).await {
                                                                                                                                    Ok(_) => {
                                                                                                                                        set_action_notice.set(Some("Billing status updated".to_string()));
                                                                                                                                        set_reload_nonce.update(|value| *value += 1);
                                                                                                                                    }
                                                                                                                                    Err(err) => set_action_error.set(Some(err)),
                                                                                                                                }
                                                                                                                                set_action_busy.set(false);
                                                                                                                            });
                                                                                                                        }
                                                                                                                    >
                                                                                                                        {status}
                                                                                                                    </button>
                                                                                                                }
                                                                                                            }).collect::<Vec<_>>()}
                                                                                                        </div>
                                                                                                    }.into_any()
                                                                                                } else {
                                                                                                    view! { <></> }.into_any()
                                                                                                }
                                                                                            }}
                                                                                        </div>
                                                                                    }
                                                                                }).collect::<Vec<_>>()}
                                                                            </div>
                                                                        }.into_any()
                                                                    }
                                                                }}
                                                                {move || {
                                                                    if current_permissions.can_create_concierge_services {
                                                                        view! {
                                                                            <form class="appointments-nested-form" on:submit=on_add_concierge_service>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Title"</label>
                                                                                        <input type="text" prop:value=service_title on:input=move |ev| set_service_title.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Kind"</label>
                                                                                        <select prop:value=service_kind on:change=move |ev| set_service_kind.set(event_target_value(&ev))>
                                                                                            <option value="hotel">"hotel"</option>
                                                                                            <option value="transfer">"transfer"</option>
                                                                                            <option value="vip_terminal">"vip_terminal"</option>
                                                                                            <option value="flight">"flight"</option>
                                                                                            <option value="chauffeur">"chauffeur"</option>
                                                                                            <option value="translation_support">"translation_support"</option>
                                                                                            <option value="other">"other"</option>
                                                                                        </select>
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Assignee"</label>
                                                                                        <select prop:value=service_assignee_id on:change=move |ev| set_service_assignee_id.set(event_target_value(&ev))>
                                                                                            <option value="">"Auto / unassigned"</option>
                                                                                            {move || {
                                                                                                staff_options.get().into_iter().filter(|item| item.role == "concierge").map(|item| {
                                                                                                    view! { <option value=item.id>{item.name}</option> }
                                                                                                }).collect::<Vec<_>>()
                                                                                            }}
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Booking ref"</label>
                                                                                        <input type="text" prop:value=service_booking_reference on:input=move |ev| set_service_booking_reference.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Vendor"</label>
                                                                                        <input type="text" prop:value=service_vendor_name on:input=move |ev| set_service_vendor_name.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Estimate"</label>
                                                                                        <input type="number" min="0" step="0.01" prop:value=service_cost_estimate on:input=move |ev| set_service_cost_estimate.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Start"</label>
                                                                                        <input type="datetime-local" prop:value=service_start_at on:input=move |ev| set_service_start_at.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"End"</label>
                                                                                        <input type="datetime-local" prop:value=service_end_at on:input=move |ev| set_service_end_at.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Currency"</label>
                                                                                        <input type="text" prop:value=service_currency on:input=move |ev| set_service_currency.set(event_target_value(&ev).to_uppercase()) />
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Notes"</label>
                                                                                        <textarea prop:value=service_notes on:input=move |ev| set_service_notes.set(event_target_value(&ev))></textarea>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-actions">
                                                                                    <button type="submit" class="btn-primary" disabled=move || action_busy.get() || service_title.get().trim().is_empty()>
                                                                                        "Create concierge service"
                                                                                    </button>
                                                                                </div>
                                                                            </form>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_view_reminders && !detail.is_blocked {
                                                        let viewer_user_id = current_user_id_for_reminders.clone();
                                                        let reminders_panel_appointment_id =
                                                            reminders_appointment_id.clone();
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Reminders"</div>
                                                                {move || {
                                                                    let items = reminders.get();
                                                                    if items.is_empty() {
                                                                        view! { <div class="provider-subline">"No reminders yet."</div> }.into_any()
                                                                    } else {
                                                                        view! {
                                                                            <div class="appointments-checklist-list">
                                                                                {items.into_iter().map(|item| {
                                                                                    let reminder_id = item.id.clone();
                                                                                    let reminder_assignee = item.user_id.clone();
                                                                                    let can_complete = current_permissions.can_manage_reminders || reminder_assignee == viewer_user_id;
                                                                                    let reminder_appointment_id = reminders_panel_appointment_id.clone();
                                                                                    view! {
                                                                                        <div class="appointments-checklist-item">
                                                                                            <div>
                                                                                                <div>{item.title.clone()}</div>
                                                                                                <div class="provider-subline">{format!("{} • {}", item.user_name, item.remind_at)}</div>
                                                                                                {item.description.clone().map(|text| view! {
                                                                                                    <div class="provider-subline">{text}</div>
                                                                                                })}
                                                                                            </div>
                                                                                            <div class="provider-inline-actions">
                                                                                                <span class=if item.is_completed { "tag tag--green" } else { "tag tag--amber" }>
                                                                                                    {if item.is_completed { "completed" } else { "open" }}
                                                                                                </span>
                                                                                                {move || {
                                                                                                    if !item.is_completed && can_complete {
                                                                                                        let appointment_id = reminder_appointment_id.clone();
                                                                                                        let reminder_id = reminder_id.clone();
                                                                                                        view! {
                                                                                                            <button
                                                                                                                class="btn-small"
                                                                                                                disabled=action_busy
                                                                                                                on:click=move |_| {
                                                                                                                    let appointment_id = appointment_id.clone();
                                                                                                                    let reminder_id = reminder_id.clone();
                                                                                                                    set_action_busy.set(true);
                                                                                                                    set_action_error.set(None);
                                                                                                                    set_action_notice.set(None);
                                                                                                                    wasm_bindgen_futures::spawn_local(async move {
                                                                                                                        match client::post_no_body(
                                                                                                                            &format!("/appointments/{appointment_id}/reminders/{reminder_id}/complete"),
                                                                                                                        )
                                                                                                                        .await
                                                                                                                        {
                                                                                                                            Ok(_) => {
                                                                                                                                set_action_notice.set(Some("Reminder completed".to_string()));
                                                                                                                                set_reload_nonce.update(|value| *value += 1);
                                                                                                                            }
                                                                                                                            Err(err) => set_action_error.set(Some(err)),
                                                                                                                        }
                                                                                                                        set_action_busy.set(false);
                                                                                                                    });
                                                                                                                }
                                                                                                            >
                                                                                                                "Complete"
                                                                                                            </button>
                                                                                                        }.into_any()
                                                                                                    } else {
                                                                                                        view! { <></> }.into_any()
                                                                                                    }
                                                                                                }}
                                                                                            </div>
                                                                                        </div>
                                                                                    }
                                                                                }).collect::<Vec<_>>()}
                                                                            </div>
                                                                        }.into_any()
                                                                    }
                                                                }}

                                                                {move || {
                                                                    if current_permissions.can_manage_reminders {
                                                                        view! {
                                                                            <form class="appointments-nested-form" on:submit=on_add_reminder>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Assignee"</label>
                                                                                        <select prop:value=reminder_user_id on:change=move |ev| set_reminder_user_id.set(event_target_value(&ev))>
                                                                                            <option value="">"Select staff"</option>
                                                                                            {move || {
                                                                                                staff_options.get().into_iter().map(|item| {
                                                                                                    view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                                                }).collect::<Vec<_>>()
                                                                                            }}
                                                                                        </select>
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Remind at"</label>
                                                                                        <input type="datetime-local" prop:value=reminder_at on:input=move |ev| set_reminder_at.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Title"</label>
                                                                                        <input type="text" prop:value=reminder_title on:input=move |ev| set_reminder_title.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Description"</label>
                                                                                        <textarea prop:value=reminder_description on:input=move |ev| set_reminder_description.set(event_target_value(&ev))></textarea>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-actions">
                                                                                    <button
                                                                                        type="submit"
                                                                                        class="btn-primary"
                                                                                        disabled=move || action_busy.get() || reminder_user_id.get().trim().is_empty() || reminder_at.get().trim().is_empty() || reminder_title.get().trim().is_empty()
                                                                                    >
                                                                                        "Create reminder"
                                                                                    </button>
                                                                                </div>
                                                                            </form>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_view_tasks && !detail.is_blocked {
                                                        let viewer_user_id = current_user_id.clone();
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Tasks"</div>
                                                                {move || {
                                                                    let items = tasks.get();
                                                                    if items.is_empty() {
                                                                        view! { <div class="provider-subline">"No tasks yet."</div> }.into_any()
                                                                    } else {
                                                                        view! {
                                                                            <div class="appointments-checklist-list">
                                                                                {items.into_iter().map(|item| {
                                                                                    let can_update = current_permissions.can_manage_tasks || item.assigned_to == viewer_user_id;
                                                                                    let task_id = item.id.clone();
                                                                                    view! {
                                                                                        <div class="appointments-checklist-item">
                                                                                            <div>
                                                                                                <div>{item.title.clone()}</div>
                                                                                                <div class="provider-subline">{format!("{} ({})", item.assigned_to_name, role_display_name(&item.assigned_to_role))}</div>
                                                                                                {item.due_date.clone().map(|value| view! {
                                                                                                    <div class="provider-subline">{format!("Due {value}")}</div>
                                                                                                })}
                                                                                                {item.description.clone().map(|text| view! {
                                                                                                    <div class="provider-subline">{text}</div>
                                                                                                })}
                                                                                            </div>
                                                                                            <div class="provider-inline-actions">
                                                                                                <span class=match item.priority.as_str() {
                                                                                                    "urgent" => "tag tag--red",
                                                                                                    "high" => "tag tag--amber",
                                                                                                    "low" => "tag tag--gray",
                                                                                                    _ => "tag tag--blue",
                                                                                                }>{item.priority.clone()}</span>
                                                                                                <span class=match item.status.as_str() {
                                                                                                    "completed" => "tag tag--green",
                                                                                                    "in_progress" => "tag tag--amber",
                                                                                                    "cancelled" => "tag tag--red",
                                                                                                    _ => "tag tag--gray",
                                                                                                }>{item.status.clone()}</span>
                                                                                                {move || {
                                                                                                    if can_update && item.status != "completed" && item.status != "cancelled" {
                                                                                                        let task_id_start = task_id.clone();
                                                                                                        let task_id_complete = task_id.clone();
                                                                                                        view! {
                                                                                                            <>
                                                                                                                <button
                                                                                                                    class="btn-small"
                                                                                                                    disabled=action_busy
                                                                                                                    on:click=move |_| {
                                                                                                                        let body = UpdateTaskStatusReq { status: "in_progress".to_string() };
                                                                                                                        let task_id = task_id_start.clone();
                                                                                                                        set_action_busy.set(true);
                                                                                                                        set_action_error.set(None);
                                                                                                                        set_action_notice.set(None);
                                                                                                                        wasm_bindgen_futures::spawn_local(async move {
                                                                                                                            match client::post::<UpdateTaskStatusReq, serde_json::Value>(&format!("/tasks/{task_id}/status"), &body).await {
                                                                                                                                Ok(_) => {
                                                                                                                                    set_action_notice.set(Some("Task updated".to_string()));
                                                                                                                                    set_reload_nonce.update(|value| *value += 1);
                                                                                                                                }
                                                                                                                                Err(err) => set_action_error.set(Some(err)),
                                                                                                                            }
                                                                                                                            set_action_busy.set(false);
                                                                                                                        });
                                                                                                                    }
                                                                                                                >
                                                                                                                    "Start"
                                                                                                                </button>
                                                                                                                <button
                                                                                                                    class="btn-small"
                                                                                                                    disabled=action_busy
                                                                                                                    on:click=move |_| {
                                                                                                                        let body = UpdateTaskStatusReq { status: "completed".to_string() };
                                                                                                                        let task_id = task_id_complete.clone();
                                                                                                                        set_action_busy.set(true);
                                                                                                                        set_action_error.set(None);
                                                                                                                        set_action_notice.set(None);
                                                                                                                        wasm_bindgen_futures::spawn_local(async move {
                                                                                                                            match client::post::<UpdateTaskStatusReq, serde_json::Value>(&format!("/tasks/{task_id}/status"), &body).await {
                                                                                                                                Ok(_) => {
                                                                                                                                    set_action_notice.set(Some("Task completed".to_string()));
                                                                                                                                    set_reload_nonce.update(|value| *value += 1);
                                                                                                                                }
                                                                                                                                Err(err) => set_action_error.set(Some(err)),
                                                                                                                            }
                                                                                                                            set_action_busy.set(false);
                                                                                                                        });
                                                                                                                    }
                                                                                                                >
                                                                                                                    "Complete"
                                                                                                                </button>
                                                                                                            </>
                                                                                                        }.into_any()
                                                                                                    } else {
                                                                                                        view! { <></> }.into_any()
                                                                                                    }
                                                                                                }}
                                                                                            </div>
                                                                                        </div>
                                                                                    }
                                                                                }).collect::<Vec<_>>()}
                                                                            </div>
                                                                        }.into_any()
                                                                    }
                                                                }}

                                                                {move || {
                                                                    if current_permissions.can_manage_tasks {
                                                                        view! {
                                                                            <form class="appointments-nested-form" on:submit=on_add_task>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Assignee"</label>
                                                                                        <select prop:value=task_assignee_id on:change=move |ev| set_task_assignee_id.set(event_target_value(&ev))>
                                                                                            <option value="">"Select staff"</option>
                                                                                            {move || {
                                                                                                staff_options.get().into_iter().filter(|item| item.role != "ceo").map(|item| {
                                                                                                    view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                                                }).collect::<Vec<_>>()
                                                                                            }}
                                                                                        </select>
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Priority"</label>
                                                                                        <select prop:value=task_priority on:change=move |ev| set_task_priority.set(event_target_value(&ev))>
                                                                                            <option value="low">"low"</option>
                                                                                            <option value="normal">"normal"</option>
                                                                                            <option value="high">"high"</option>
                                                                                            <option value="urgent">"urgent"</option>
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Title"</label>
                                                                                        <input type="text" prop:value=task_title on:input=move |ev| set_task_title.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Due at"</label>
                                                                                        <input type="datetime-local" prop:value=task_due_at on:input=move |ev| set_task_due_at.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Description"</label>
                                                                                        <textarea prop:value=task_description on:input=move |ev| set_task_description.set(event_target_value(&ev))></textarea>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-actions">
                                                                                    <button
                                                                                        type="submit"
                                                                                        class="btn-primary"
                                                                                        disabled=move || action_busy.get() || task_assignee_id.get().trim().is_empty() || task_title.get().trim().is_empty()
                                                                                    >
                                                                                        "Create task"
                                                                                    </button>
                                                                                </div>
                                                                            </form>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_view_report {
                                                        let report_value = report_snapshot.clone();
                                                        let report_approval_state = report_for_approve.clone();
                                                        let report_approval_appointment_id = approve_appointment_id.clone();
                                                        let report_reject_state = report_for_approve.clone();
                                                        let report_reject_appointment_id = approve_appointment_id.clone();
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Interpreter report"</div>
                                                                {move || {
                                                                    if let Some(report) = report_value.clone() {
                                                                        view! {
                                                                            <div class="appointments-report-card">
                                                                                <div class="appointments-detail-row">
                                                                                    <span class="appointments-detail-label">"Interpreter"</span>
                                                                                    <span>{report.interpreter_name.clone()}</span>
                                                                                </div>
                                                                                <div class="appointments-detail-row">
                                                                                    <span class="appointments-detail-label">"Hours"</span>
                                                                                    <span>{report.hours.clone()}</span>
                                                                                </div>
                                                                                <div class="appointments-detail-row">
                                                                                    <span class="appointments-detail-label">"Approval"</span>
                                                                                    <span class=match report.approval_status.as_str() {
                                                                                        "approved" => "tag tag--green",
                                                                                        "rejected" => "tag tag--red",
                                                                                        _ => "tag tag--amber",
                                                                                    }>{report.approval_status.clone()}</span>
                                                                                </div>
                                                                                <div class="appointments-detail-row">
                                                                                    <span class="appointments-detail-label">"Submitted"</span>
                                                                                    <span>{report.created_at.clone()}</span>
                                                                                </div>
                                                                                {report.report_text.clone().map(|text| view! {
                                                                                    <div class="appointments-report-text">{text}</div>
                                                                                })}
                                                                                {report.approved_by_name.clone().map(|approver| view! {
                                                                                    <div class="provider-subline">{format!("Approved by {approver}")}</div>
                                                                                })}
                                                                            </div>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <div class="provider-subline">"No report submitted yet."</div> }.into_any()
                                                                    }
                                                                }}

                                                                {move || {
                                                                    if current_permissions.can_submit_report && is_my_assignment {
                                                                        view! {
                                                                            <form class="appointments-nested-form" on:submit=on_submit_report>
                                                                                <div class="form-row">
                                                                                    <div class="form-field">
                                                                                        <label>"Hours"</label>
                                                                                        <input type="number" min="0" step="0.5" prop:value=report_hours on:input=move |ev| set_report_hours.set(event_target_value(&ev)) />
                                                                                    </div>
                                                                                    <div class="form-field">
                                                                                        <label>"Report"</label>
                                                                                        <textarea prop:value=report_text on:input=move |ev| set_report_text.set(event_target_value(&ev))></textarea>
                                                                                    </div>
                                                                                </div>
                                                                                <div class="form-actions">
                                                                                    <button type="submit" class="btn-primary" disabled=move || action_busy.get() || report_hours.get().trim().is_empty()>
                                                                                        "Submit report"
                                                                                    </button>
                                                                                </div>
                                                                            </form>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}

                                                                {move || {
                                                                    if current_permissions.can_approve_report
                                                                        && report_approval_state.as_ref().map(|item| item.approval_status.as_str()) == Some("pending")
                                                                    {
                                                                        let appointment_id = report_approval_appointment_id.clone();
                                                                        view! {
                                                                            <div class="form-actions">
                                                                                <button
                                                                                    class="btn-primary"
                                                                                    disabled=action_busy
                                                                                    on:click=move |_| {
                                                                                        let appointment_id = appointment_id.clone();
                                                                                        set_action_busy.set(true);
                                                                                        set_action_error.set(None);
                                                                                        set_action_notice.set(None);
                                                                                        wasm_bindgen_futures::spawn_local(async move {
                                                                                            match client::post_no_body(
                                                                                                &format!("/appointments/{appointment_id}/report/approve"),
                                                                                            )
                                                                                            .await
                                                                                            {
                                                                                                Ok(_) => {
                                                                                                    set_action_notice.set(Some("Interpreter report approved".to_string()));
                                                                                                    set_reload_nonce.update(|value| *value += 1);
                                                                                                }
                                                                                                Err(err) => set_action_error.set(Some(err)),
                                                                                            }
                                                                                            set_action_busy.set(false);
                                                                                        });
                                                                                    }
                                                                                >
                                                                                    "Approve report"
                                                                                </button>
                                                                            </div>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}
                                                                {move || {
                                                                    if current_permissions.can_reject_report
                                                                        && report_reject_state.as_ref().map(|item| item.approval_status.as_str()) == Some("pending")
                                                                    {
                                                                        let appointment_id = report_reject_appointment_id.clone();
                                                                        view! {
                                                                            <div class="form-actions">
                                                                                <button
                                                                                    class="btn-secondary"
                                                                                    disabled=action_busy
                                                                                    on:click=move |_| {
                                                                                        let appointment_id = appointment_id.clone();
                                                                                        set_action_busy.set(true);
                                                                                        set_action_error.set(None);
                                                                                        set_action_notice.set(None);
                                                                                        wasm_bindgen_futures::spawn_local(async move {
                                                                                            match client::post::<serde_json::Value, serde_json::Value>(
                                                                                                &format!("/appointments/{appointment_id}/report/reject"),
                                                                                                &serde_json::json!({ "notes": "Returned for clarification" }),
                                                                                            )
                                                                                            .await
                                                                                            {
                                                                                                Ok(_) => {
                                                                                                    set_action_notice.set(Some("Interpreter report returned".to_string()));
                                                                                                    set_reload_nonce.update(|value| *value += 1);
                                                                                                }
                                                                                                Err(err) => set_action_error.set(Some(err)),
                                                                                            }
                                                                                            set_action_busy.set(false);
                                                                                        });
                                                                                    }
                                                                                >
                                                                                    "Return report"
                                                                                </button>
                                                                            </div>
                                                                        }.into_any()
                                                                    } else {
                                                                        view! { <></> }.into_any()
                                                                    }
                                                                }}
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}

                                                {move || {
                                                    if current_permissions.can_view_notes {
                                                        view! {
                                                            <div class="appointments-panel">
                                                                <div class="appointments-panel-title">"Internal notes"</div>
                                                                <div class="appointments-notes-stack">
                                                                    {detail.notes.clone().map(|text| view! {
                                                                        <div class="appointments-note-box">
                                                                            <div class="appointments-detail-label">"General notes"</div>
                                                                            <div>{text}</div>
                                                                        </div>
                                                                    })}
                                                                    {detail.preparation_notes.clone().map(|text| view! {
                                                                        <div class="appointments-note-box">
                                                                            <div class="appointments-detail-label">"Preparation"</div>
                                                                            <div>{text}</div>
                                                                        </div>
                                                                    })}
                                                                    {detail.followup_notes.clone().map(|text| view! {
                                                                        <div class="appointments-note-box">
                                                                            <div class="appointments-detail-label">"Follow-up"</div>
                                                                            <div>{text}</div>
                                                                        </div>
                                                                    })}
                                                                </div>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! { <></> }.into_any()
                                                    }
                                                }}
                                            </div>
                                        }.into_any()
                                    }}
                                </div>
                            </div>
                        </div>
                    </>
                }.into_any()
            }}
        </div>
    }
}
