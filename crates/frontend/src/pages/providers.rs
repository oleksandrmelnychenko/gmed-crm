use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, role_display_name};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ProviderListItem {
    id: String,
    name: String,
    provider_type: String,
    address_city: Option<String>,
    address_country: Option<String>,
    fachbereich: Option<String>,
    is_active: bool,
    has_contract: bool,
    doctor_count: i64,
    patient_count: i64,
    appointment_count: i64,
}

#[derive(Deserialize, Clone, Debug)]
struct LinkedPatient {
    patient_id: String,
    first_name: String,
    last_name: String,
    appointment_count: i64,
    leistung_count: i64,
    last_interaction_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct InteractionItem {
    kind: String,
    id: String,
    patient_id: String,
    patient_name: String,
    doctor_id: Option<String>,
    doctor_name: Option<String>,
    order_id: Option<String>,
    order_number: Option<String>,
    status: String,
    title: String,
    appointment_type: Option<String>,
    location: Option<String>,
    notes: Option<String>,
    occurred_at: String,
    quantity: Option<Value>,
    unit_price: Option<Value>,
    currency: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct DoctorSummary {
    id: String,
    provider_id: String,
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    notes: Option<String>,
    patient_count: i64,
    appointment_count: i64,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct DoctorDetail {
    id: String,
    provider_id: String,
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    notes: Option<String>,
    patient_count: i64,
    appointment_count: i64,
    linked_patients: Vec<LinkedPatient>,
    interactions: Vec<InteractionItem>,
}

#[derive(Deserialize, Clone, Debug)]
struct ServiceItem {
    id: String,
    provider_id: String,
    service_name: String,
    description: Option<String>,
    price: Value,
    currency: String,
    valid_from: String,
    valid_to: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ProviderDetail {
    id: String,
    name: String,
    provider_type: String,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    website: Option<String>,
    fachbereich: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
    is_active: bool,
    updated_at: String,
    doctors: Vec<DoctorSummary>,
    services: Vec<ServiceItem>,
    linked_patients: Vec<LinkedPatient>,
    interactions: Vec<InteractionItem>,
}

#[derive(Deserialize, Clone, Debug)]
struct CreateResponse {
    id: String,
}

#[derive(Serialize)]
struct UpsertProviderRequest {
    name: String,
    provider_type: String,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    website: Option<String>,
    fachbereich: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
}

#[derive(Serialize)]
struct UpsertDoctorRequest {
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    notes: Option<String>,
}

#[derive(Serialize)]
struct UpsertServiceRequest {
    service_name: String,
    description: Option<String>,
    price: f64,
    currency: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
}

fn provider_type_label(lang: Lang, value: &str) -> &'static str {
    let tr = i18n::t(lang);
    match value {
        "medical" => tr.providers_type_medical,
        "non_medical" => tr.providers_type_non_medical,
        _ => "—",
    }
}

fn provider_type_tag(value: &str) -> &'static str {
    match value {
        "medical" => "tag tag--blue",
        "non_medical" => "tag tag--teal",
        _ => "tag tag--gray",
    }
}

fn bool_tag(value: bool) -> &'static str {
    if value {
        "tag tag--green"
    } else {
        "tag tag--gray"
    }
}

fn opt_text(value: &Option<String>) -> String {
    value
        .clone()
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| "—".to_string())
}

fn to_optional(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn compact_dt(value: &str) -> String {
    value.split('T').next().unwrap_or(value).to_string()
}

fn json_value_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(v) => v.clone(),
        Value::Number(v) => v.to_string(),
        Value::Bool(v) => v.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn humanize_code(value: &str) -> String {
    value.replace('_', " ")
}

#[derive(Clone, Copy)]
struct ProviderPermissions {
    can_view_page: bool,
    can_manage_registry: bool,
    force_non_medical: bool,
}

fn provider_permissions(role: Option<&str>) -> ProviderPermissions {
    match role {
        Some("ceo") | Some("patient_manager") => ProviderPermissions {
            can_view_page: true,
            can_manage_registry: true,
            force_non_medical: false,
        },
        Some("concierge") => ProviderPermissions {
            can_view_page: true,
            can_manage_registry: false,
            force_non_medical: true,
        },
        Some("billing") | Some("sales") => ProviderPermissions {
            can_view_page: true,
            can_manage_registry: false,
            force_non_medical: false,
        },
        _ => ProviderPermissions {
            can_view_page: false,
            can_manage_registry: false,
            force_non_medical: false,
        },
    }
}

fn interaction_kind_label(lang: Lang, value: &str) -> &'static str {
    let tr = i18n::t(lang);
    match value {
        "appointment" => tr.interaction_appointment,
        "leistung" => tr.interaction_service,
        _ => tr.interaction_activity,
    }
}

fn interaction_kind_tag(value: &str) -> &'static str {
    match value {
        "appointment" => "tag tag--blue",
        "leistung" => "tag tag--teal",
        _ => "tag tag--gray",
    }
}

fn interaction_status_tag(value: &str) -> &'static str {
    match value {
        "planned" => "tag tag--gray",
        "confirmed" => "tag tag--blue",
        "in_progress" => "tag tag--amber",
        "completed" | "approved" | "invoiced" => "tag tag--green",
        "delivered" => "tag tag--teal",
        "cancelled" => "tag tag--red",
        _ => "tag tag--gray",
    }
}

fn interaction_context(item: &InteractionItem) -> String {
    let mut parts = Vec::<String>::new();

    if let Some(order_number) = &item.order_number
        && !order_number.trim().is_empty()
    {
        parts.push(format!("Order {order_number}"));
    }
    if let Some(doctor_name) = &item.doctor_name
        && !doctor_name.trim().is_empty()
    {
        parts.push(doctor_name.clone());
    }

    if item.kind == "appointment" {
        if let Some(appointment_type) = &item.appointment_type
            && !appointment_type.trim().is_empty()
        {
            parts.push(humanize_code(appointment_type));
        }
        if let Some(location) = &item.location
            && !location.trim().is_empty()
        {
            parts.push(location.clone());
        }
    } else if let Some(notes) = &item.notes
        && !notes.trim().is_empty()
    {
        parts.push(notes.clone());
    }

    if parts.is_empty() {
        "—".to_string()
    } else {
        parts.join(" · ")
    }
}

fn interaction_amount(item: &InteractionItem) -> String {
    if item.kind != "leistung" {
        return "—".to_string();
    }

    match (&item.quantity, &item.unit_price, &item.currency) {
        (Some(quantity), Some(unit_price), Some(currency)) => {
            format!(
                "{} × {} {}",
                json_value_text(quantity),
                json_value_text(unit_price),
                currency
            )
        }
        (Some(quantity), Some(unit_price), None) => {
            format!(
                "{} × {}",
                json_value_text(quantity),
                json_value_text(unit_price)
            )
        }
        _ => "—".to_string(),
    }
}

fn render_interactions_table(lang: Lang, items: Vec<InteractionItem>) -> impl IntoView {
    let tr = i18n::t(lang);
    if items.is_empty() {
        return view! { <div class="empty-state">{tr.providers_no_activity}</div> }.into_any();
    }

    view! {
        <table class="data-table compact-table">
            <thead><tr><th>{tr.providers_type}</th><th>{tr.providers_patient}</th><th>{tr.providers_context}</th><th>{tr.providers_date}</th><th>{tr.providers_amount}</th><th>{tr.users_status}</th></tr></thead>
            <tbody>
                {items.into_iter().map(|item| {
                    let patient = format!("{} ({})", item.patient_name, item.patient_id);
                    let context = interaction_context(&item);
                    let amount = interaction_amount(&item);
                    let kind_class = interaction_kind_tag(&item.kind);
                    let kind_label = interaction_kind_label(lang, &item.kind);
                    let status_class = interaction_status_tag(&item.status);
                    let status_label = humanize_code(&item.status);
                    let occurred_at = compact_dt(&item.occurred_at);
                    view! {
                        <tr>
                            <td><span class=kind_class>{kind_label}</span></td>
                            <td>
                                <div class="provider-name-cell">
                                    <strong>{patient}</strong>
                                    <span class="provider-subline">{item.title}</span>
                                </div>
                            </td>
                            <td>{context}</td>
                            <td class="cell-mono">{occurred_at}</td>
                            <td class="cell-mono">{amount}</td>
                            <td><span class=status_class>{status_label}</span></td>
                        </tr>
                    }
                }).collect::<Vec<_>>()}
            </tbody>
        </table>
    }
    .into_any()
}

fn contract_to_text(value: &Option<Value>) -> String {
    match value {
        Some(Value::Object(map)) => match map.get("summary") {
            Some(Value::String(summary)) => summary.clone(),
            _ => serde_json::to_string_pretty(&Value::Object(map.clone())).unwrap_or_default(),
        },
        Some(Value::String(text)) => text.clone(),
        Some(other) => serde_json::to_string_pretty(other).unwrap_or_default(),
        None => String::new(),
    }
}

fn contract_to_value(raw: &str) -> Result<Option<Value>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        serde_json::from_str(trimmed)
            .map(Some)
            .map_err(|e| format!("Invalid JSON: {e}"))
    } else {
        Ok(Some(json!({ "summary": trimmed })))
    }
}

#[allow(clippy::too_many_arguments)]
fn provider_query_url(
    search: &str,
    provider_type: &str,
    city: &str,
    country: &str,
    fachbereich: &str,
    doctor_name: &str,
    doctor_fachbereich: &str,
    service_name: &str,
    has_contract: &str,
) -> String {
    let mut params = Vec::<String>::new();
    if !search.trim().is_empty() {
        params.push(format!("search={}", search.trim()));
    }
    if !provider_type.trim().is_empty() {
        params.push(format!("provider_type={provider_type}"));
    }
    if !city.trim().is_empty() {
        params.push(format!("city={}", city.trim()));
    }
    if !country.trim().is_empty() {
        params.push(format!("country={}", country.trim()));
    }
    if !fachbereich.trim().is_empty() {
        params.push(format!("fachbereich={}", fachbereich.trim()));
    }
    if !doctor_name.trim().is_empty() {
        params.push(format!("doctor_name={}", doctor_name.trim()));
    }
    if !doctor_fachbereich.trim().is_empty() {
        params.push(format!("doctor_fachbereich={}", doctor_fachbereich.trim()));
    }
    if !service_name.trim().is_empty() {
        params.push(format!("service_name={}", service_name.trim()));
    }
    if !has_contract.trim().is_empty() {
        params.push(format!("has_contract={has_contract}"));
    }

    if params.is_empty() {
        "/providers".to_string()
    } else {
        format!("/providers?{}", params.join("&"))
    }
}

#[component]
pub fn Providers() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    let (providers, set_providers) = signal(Vec::<ProviderListItem>::new());
    let (loading, set_loading) = signal(true);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);
    let (selected_provider_id, set_selected_provider_id) = signal(Option::<String>::None);
    let (provider_detail, set_provider_detail) = signal(Option::<ProviderDetail>::None);
    let (provider_error, set_provider_error) = signal(Option::<String>::None);
    let (provider_loading, set_provider_loading) = signal(false);

    let (search, set_search) = signal(String::new());
    let (filter_type, set_filter_type) = signal(String::new());
    let (filter_city, set_filter_city) = signal(String::new());
    let (filter_country, set_filter_country) = signal(String::new());
    let (filter_fach, set_filter_fach) = signal(String::new());
    let (filter_doctor_name, set_filter_doctor_name) = signal(String::new());
    let (filter_doctor_fach, set_filter_doctor_fach) = signal(String::new());
    let (filter_service_name, set_filter_service_name) = signal(String::new());
    let (filter_contract, set_filter_contract) = signal(String::new());

    let (provider_name, set_provider_name) = signal(String::new());
    let (provider_type, set_provider_type) = signal("medical".to_string());
    let (provider_street, set_provider_street) = signal(String::new());
    let (provider_city, set_provider_city) = signal(String::new());
    let (provider_zip, set_provider_zip) = signal(String::new());
    let (provider_country, set_provider_country) = signal(String::new());
    let (provider_phone, set_provider_phone) = signal(String::new());
    let (provider_email, set_provider_email) = signal(String::new());
    let (provider_website, set_provider_website) = signal(String::new());
    let (provider_fach, set_provider_fach) = signal(String::new());
    let (provider_contract, set_provider_contract) = signal(String::new());
    let (provider_notes, set_provider_notes) = signal(String::new());
    let (provider_saving, set_provider_saving) = signal(false);
    let (provider_form_error, set_provider_form_error) = signal(Option::<String>::None);

    let (selected_doctor_id, set_selected_doctor_id) = signal(Option::<String>::None);
    let (doctor_detail, set_doctor_detail) = signal(Option::<DoctorDetail>::None);
    let (doctor_loading, set_doctor_loading) = signal(false);
    let (doctor_name, set_doctor_name) = signal(String::new());
    let (doctor_title, set_doctor_title) = signal(String::new());
    let (doctor_fach, set_doctor_fach) = signal(String::new());
    let (doctor_phone, set_doctor_phone) = signal(String::new());
    let (doctor_email, set_doctor_email) = signal(String::new());
    let (doctor_notes, set_doctor_notes) = signal(String::new());
    let (doctor_saving, set_doctor_saving) = signal(false);
    let (doctor_error, set_doctor_error) = signal(Option::<String>::None);

    let (selected_service_id, set_selected_service_id) = signal(Option::<String>::None);
    let (service_name, set_service_name) = signal(String::new());
    let (service_description, set_service_description) = signal(String::new());
    let (service_price, set_service_price) = signal(String::new());
    let (service_currency, set_service_currency) = signal("EUR".to_string());
    let (service_valid_from, set_service_valid_from) = signal(String::new());
    let (service_valid_to, set_service_valid_to) = signal(String::new());
    let (service_saving, set_service_saving) = signal(false);
    let (service_error, set_service_error) = signal(Option::<String>::None);

    let permissions = move || {
        provider_permissions(
            current_user
                .user
                .get()
                .as_ref()
                .map(|user| user.role.as_str()),
        )
    };

    Effect::new(move |_| {
        if current_user.loading.get() {
            return;
        }
        if permissions().force_non_medical && filter_type.get() != "non_medical" {
            set_filter_type.set("non_medical".to_string());
        }
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        if current_user.loading.get() {
            return;
        }
        let current_permissions = permissions();
        if !current_permissions.can_view_page {
            set_loading.set(false);
            set_providers.set(Vec::new());
            return;
        }
        let effective_provider_type = if current_permissions.force_non_medical {
            "non_medical".to_string()
        } else {
            filter_type.get()
        };
        let url = provider_query_url(
            &search.get(),
            &effective_provider_type,
            &filter_city.get(),
            &filter_country.get(),
            &filter_fach.get(),
            &filter_doctor_name.get(),
            &filter_doctor_fach.get(),
            &filter_service_name.get(),
            &filter_contract.get(),
        );
        set_loading.set(true);
        set_provider_error.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<ProviderListItem>>(&url).await {
                Ok(items) => {
                    set_providers.set(items);
                    set_loading.set(false);
                }
                Err(error) => {
                    set_provider_error.set(Some(error));
                    set_loading.set(false);
                }
            }
        });
    });

    Effect::new(move |_| {
        let _ = selected_provider_id.get();
        set_selected_doctor_id.set(None);
        set_doctor_detail.set(None);
        set_doctor_name.set(String::new());
        set_doctor_title.set(String::new());
        set_doctor_fach.set(String::new());
        set_doctor_phone.set(String::new());
        set_doctor_email.set(String::new());
        set_doctor_notes.set(String::new());
        set_selected_service_id.set(None);
        set_service_name.set(String::new());
        set_service_description.set(String::new());
        set_service_price.set(String::new());
        set_service_currency.set("EUR".to_string());
        set_service_valid_from.set(String::new());
        set_service_valid_to.set(String::new());
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let selected = selected_provider_id.get();
        let Some(provider_id) = selected else {
            set_provider_detail.set(None);
            set_provider_loading.set(false);
            return;
        };
        set_provider_loading.set(true);
        set_provider_error.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ProviderDetail>(&format!("/providers/{provider_id}")).await {
                Ok(detail) => {
                    set_provider_name.set(detail.name.clone());
                    set_provider_type.set(detail.provider_type.clone());
                    set_provider_street.set(detail.address_street.clone().unwrap_or_default());
                    set_provider_city.set(detail.address_city.clone().unwrap_or_default());
                    set_provider_zip.set(detail.address_zip.clone().unwrap_or_default());
                    set_provider_country.set(detail.address_country.clone().unwrap_or_default());
                    set_provider_phone.set(detail.phone.clone().unwrap_or_default());
                    set_provider_email.set(detail.email.clone().unwrap_or_default());
                    set_provider_website.set(detail.website.clone().unwrap_or_default());
                    set_provider_fach.set(detail.fachbereich.clone().unwrap_or_default());
                    set_provider_contract.set(contract_to_text(&detail.kooperationsvertrag));
                    set_provider_notes.set(detail.notes.clone().unwrap_or_default());
                    set_provider_detail.set(Some(detail));
                    set_provider_loading.set(false);
                }
                Err(error) => {
                    set_provider_error.set(Some(error));
                    set_provider_detail.set(None);
                    set_provider_loading.set(false);
                }
            }
        });
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let provider_id = selected_provider_id.get();
        let doctor_id = selected_doctor_id.get();
        let (Some(provider_id), Some(doctor_id)) = (provider_id, doctor_id) else {
            set_doctor_detail.set(None);
            set_doctor_loading.set(false);
            return;
        };
        set_doctor_loading.set(true);
        set_doctor_error.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<DoctorDetail>(&format!(
                "/providers/{provider_id}/doctors/{doctor_id}"
            ))
            .await
            {
                Ok(detail) => {
                    set_doctor_name.set(detail.name.clone());
                    set_doctor_title.set(detail.title.clone().unwrap_or_default());
                    set_doctor_fach.set(detail.fachbereich.clone().unwrap_or_default());
                    set_doctor_phone.set(detail.phone.clone().unwrap_or_default());
                    set_doctor_email.set(detail.email.clone().unwrap_or_default());
                    set_doctor_notes.set(detail.notes.clone().unwrap_or_default());
                    set_doctor_detail.set(Some(detail));
                    set_doctor_loading.set(false);
                }
                Err(error) => {
                    set_doctor_error.set(Some(error));
                    set_doctor_detail.set(None);
                    set_doctor_loading.set(false);
                }
            }
        });
    });

    Effect::new(move |_| {
        let selected_id = selected_service_id.get();
        let detail = provider_detail.get();
        let Some(service_id) = selected_id else {
            return;
        };
        let Some(provider) = detail else {
            return;
        };
        if let Some(service) = provider
            .services
            .into_iter()
            .find(|item| item.id == service_id)
        {
            set_service_name.set(service.service_name);
            set_service_description.set(service.description.unwrap_or_default());
            set_service_price.set(json_value_text(&service.price));
            set_service_currency.set(service.currency);
            set_service_valid_from.set(service.valid_from);
            set_service_valid_to.set(service.valid_to.unwrap_or_default());
        }
    });

    let save_provider = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_provider_form_error.set(None);
        set_provider_saving.set(true);
        let contract_value = match contract_to_value(&provider_contract.get()) {
            Ok(value) => value,
            Err(error) => {
                set_provider_form_error.set(Some(error));
                set_provider_saving.set(false);
                return;
            }
        };
        let body = UpsertProviderRequest {
            name: provider_name.get(),
            provider_type: provider_type.get(),
            address_street: to_optional(provider_street.get()),
            address_city: to_optional(provider_city.get()),
            address_zip: to_optional(provider_zip.get()),
            address_country: to_optional(provider_country.get()),
            phone: to_optional(provider_phone.get()),
            email: to_optional(provider_email.get()),
            website: to_optional(provider_website.get()),
            fachbereich: to_optional(provider_fach.get()),
            kooperationsvertrag: contract_value,
            notes: to_optional(provider_notes.get()),
        };
        let selected = selected_provider_id.get();
        wasm_bindgen_futures::spawn_local(async move {
            let response = if let Some(provider_id) = selected {
                client::post::<UpsertProviderRequest, Value>(
                    &format!("/providers/{provider_id}/update"),
                    &body,
                )
                .await
                .map(|_| provider_id)
            } else {
                client::post::<UpsertProviderRequest, CreateResponse>("/providers", &body)
                    .await
                    .map(|created| created.id)
            };
            match response {
                Ok(provider_id) => {
                    set_selected_provider_id.set(Some(provider_id));
                    set_provider_saving.set(false);
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => {
                    set_provider_form_error.set(Some(error));
                    set_provider_saving.set(false);
                }
            }
        });
    };

    let toggle_provider_active = move |provider_id: String, is_active: bool| {
        wasm_bindgen_futures::spawn_local(async move {
            let path = if is_active {
                format!("/providers/{provider_id}/deactivate")
            } else {
                format!("/providers/{provider_id}/activate")
            };
            let _ = client::post_no_body(&path).await;
            set_reload_nonce.update(|value| *value += 1);
        });
    };

    let delete_provider = move |provider_id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            match client::post_no_body(&format!("/providers/{provider_id}/delete")).await {
                Ok(_) => {
                    set_selected_provider_id.set(None);
                    set_provider_detail.set(None);
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => set_provider_form_error.set(Some(error)),
            }
        });
    };

    let save_doctor = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_doctor_error.set(None);
        let Some(provider_id) = selected_provider_id.get() else {
            set_doctor_error.set(Some(i18n::t(lang.get()).providers_select_first.to_string()));
            return;
        };
        set_doctor_saving.set(true);
        let body = UpsertDoctorRequest {
            name: doctor_name.get(),
            title: to_optional(doctor_title.get()),
            fachbereich: to_optional(doctor_fach.get()),
            phone: to_optional(doctor_phone.get()),
            email: to_optional(doctor_email.get()),
            notes: to_optional(doctor_notes.get()),
        };
        let selected = selected_doctor_id.get();
        wasm_bindgen_futures::spawn_local(async move {
            let response = if let Some(doctor_id) = selected {
                client::post::<UpsertDoctorRequest, Value>(
                    &format!("/providers/{provider_id}/doctors/{doctor_id}/update"),
                    &body,
                )
                .await
                .map(|_| doctor_id)
            } else {
                client::post::<UpsertDoctorRequest, CreateResponse>(
                    &format!("/providers/{provider_id}/doctors"),
                    &body,
                )
                .await
                .map(|created| created.id)
            };
            match response {
                Ok(doctor_id) => {
                    set_selected_doctor_id.set(Some(doctor_id));
                    set_doctor_saving.set(false);
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => {
                    set_doctor_error.set(Some(error));
                    set_doctor_saving.set(false);
                }
            }
        });
    };

    let delete_doctor = move |provider_id: String, doctor_id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            match client::post_no_body(&format!(
                "/providers/{provider_id}/doctors/{doctor_id}/delete"
            ))
            .await
            {
                Ok(_) => {
                    set_selected_doctor_id.set(None);
                    set_doctor_detail.set(None);
                    set_doctor_name.set(String::new());
                    set_doctor_title.set(String::new());
                    set_doctor_fach.set(String::new());
                    set_doctor_phone.set(String::new());
                    set_doctor_email.set(String::new());
                    set_doctor_notes.set(String::new());
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => set_doctor_error.set(Some(error)),
            }
        });
    };

    let save_service = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_service_error.set(None);
        let Some(provider_id) = selected_provider_id.get() else {
            set_service_error.set(Some(i18n::t(lang.get()).providers_select_first.to_string()));
            return;
        };
        let parsed_price = match service_price.get().trim().replace(',', ".").parse::<f64>() {
            Ok(value) => value,
            Err(_) => {
                set_service_error.set(Some(
                    i18n::t(lang.get()).providers_price_numeric.to_string(),
                ));
                return;
            }
        };
        set_service_saving.set(true);
        let body = UpsertServiceRequest {
            service_name: service_name.get(),
            description: to_optional(service_description.get()),
            price: parsed_price,
            currency: to_optional(service_currency.get()),
            valid_from: to_optional(service_valid_from.get()),
            valid_to: to_optional(service_valid_to.get()),
        };
        let selected = selected_service_id.get();
        wasm_bindgen_futures::spawn_local(async move {
            let response = if let Some(service_id) = selected {
                client::post::<UpsertServiceRequest, Value>(
                    &format!("/providers/{provider_id}/services/{service_id}/update"),
                    &body,
                )
                .await
                .map(|_| service_id)
            } else {
                client::post::<UpsertServiceRequest, CreateResponse>(
                    &format!("/providers/{provider_id}/services"),
                    &body,
                )
                .await
                .map(|created| created.id)
            };
            match response {
                Ok(service_id) => {
                    set_selected_service_id.set(Some(service_id));
                    set_service_saving.set(false);
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => {
                    set_service_error.set(Some(error));
                    set_service_saving.set(false);
                }
            }
        });
    };

    let delete_service = move |provider_id: String, service_id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            match client::post_no_body(&format!(
                "/providers/{provider_id}/services/{service_id}/delete"
            ))
            .await
            {
                Ok(_) => {
                    set_selected_service_id.set(None);
                    set_service_name.set(String::new());
                    set_service_description.set(String::new());
                    set_service_price.set(String::new());
                    set_service_currency.set("EUR".to_string());
                    set_service_valid_from.set(String::new());
                    set_service_valid_to.set(String::new());
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(error) => set_service_error.set(Some(error)),
            }
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).providers_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).providers_subtitle}</p>
                </div>
                <div class="provider-inline-actions">
                    {move || {
                        current_user.user.get().map(|user| {
                            view! { <span class="tag tag--gray">{format!("{} mode", role_display_name(&user.role))}</span> }
                        })
                    }}
                    {move || {
                        if permissions().can_manage_registry {
                            view! {
                                <button class="btn-primary" on:click=move |_| {
                                    set_selected_provider_id.set(None);
                                    set_provider_detail.set(None);
                                    set_provider_name.set(String::new());
                                    set_provider_type.set("medical".to_string());
                                    set_provider_street.set(String::new());
                                    set_provider_city.set(String::new());
                                    set_provider_zip.set(String::new());
                                    set_provider_country.set(String::new());
                                    set_provider_phone.set(String::new());
                                    set_provider_email.set(String::new());
                                    set_provider_website.set(String::new());
                                    set_provider_fach.set(String::new());
                                    set_provider_contract.set(String::new());
                                    set_provider_notes.set(String::new());
                                }>
                                    "+ " {move || i18n::t(lang.get()).providers_new}
                                </button>
                            }.into_any()
                        } else {
                            view! { <span class="tag tag--teal">"Read-only registry"</span> }.into_any()
                        }
                    }}
                </div>
            </div>

            {move || {
                if current_user.loading.get() {
                    return view! { <div class="page-loading">{i18n::t(lang.get()).common_loading}</div> }.into_any();
                }

                if !permissions().can_view_page {
                    return view! {
                        <div class="card">
                            <div class="empty-state">"This role does not have access to providers."</div>
                        </div>
                    }.into_any();
                }

                view! {
                    <>
                        <div class="card" style="margin-bottom:16px">
                            <div class="provider-inline-actions">
                                <span class="tag tag--gray">{move || format!("Providers: {}", providers.get().len())}</span>
                                <span class="tag tag--blue">{move || format!("Doctors: {}", providers.get().iter().map(|item| item.doctor_count).sum::<i64>())}</span>
                                <span class="tag tag--green">{move || format!("Patients: {}", providers.get().iter().map(|item| item.patient_count).sum::<i64>())}</span>
                                <span class="tag tag--amber">{move || format!("Appointments: {}", providers.get().iter().map(|item| item.appointment_count).sum::<i64>())}</span>
                            </div>
                        </div>

                        <div class="provider-layout">
                <div class="provider-panel-stack">
                    <div class="card">
                        <div class="card-header">
                            <h2>{move || format!("{} {}", providers.get().len(), i18n::t(lang.get()).providers_title)}</h2>
                        </div>
                        <div class="create-form">
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).common_search}</label>
                                    <input
                                        type="text"
                                        placeholder=move || i18n::t(lang.get()).search_placeholder
                                        prop:value=search
                                        on:input=move |ev| set_search.set(event_target_value(&ev))
                                    />
                                </div>
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_type}</label>
                                    <select prop:value=filter_type on:change=move |ev| set_filter_type.set(event_target_value(&ev)) disabled=move || permissions().force_non_medical>
                                        <option value="">{move || i18n::t(lang.get()).providers_all}</option>
                                        {move || {
                                            if permissions().force_non_medical {
                                                view! { <div></div> }.into_any()
                                            } else {
                                                view! { <option value="medical">{provider_type_label(lang.get(), "medical")}</option> }.into_any()
                                            }
                                        }}
                                        <option value="non_medical">{move || provider_type_label(lang.get(), "non_medical")}</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_city}</label>
                                    <input type="text" prop:value=filter_city on:input=move |ev| set_filter_city.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_country}</label>
                                    <input type="text" prop:value=filter_country on:input=move |ev| set_filter_country.set(event_target_value(&ev)) />
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_fachbereich}</label>
                                    <input type="text" prop:value=filter_fach on:input=move |ev| set_filter_fach.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field">
                                    <label>"Doctor"</label>
                                    <input type="text" prop:value=filter_doctor_name on:input=move |ev| set_filter_doctor_name.set(event_target_value(&ev)) />
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field">
                                    <label>"Doctor specialty"</label>
                                    <input type="text" prop:value=filter_doctor_fach on:input=move |ev| set_filter_doctor_fach.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field">
                                    <label>"Service"</label>
                                    <input type="text" prop:value=filter_service_name on:input=move |ev| set_filter_service_name.set(event_target_value(&ev)) />
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_contract}</label>
                                    <select prop:value=filter_contract on:change=move |ev| set_filter_contract.set(event_target_value(&ev))>
                                        <option value="">{move || i18n::t(lang.get()).providers_all}</option>
                                        <option value="true">{move || i18n::t(lang.get()).providers_contract_with}</option>
                                        <option value="false">{move || i18n::t(lang.get()).providers_contract_without}</option>
                                    </select>
                                </div>
                                <div class="form-field"></div>
                            </div>
                        </div>
                        {move || {
                            if loading.get() {
                                return view! { <div class="empty-state">{i18n::t(lang.get()).common_loading}</div> }.into_any();
                            }
                            let items = providers.get();
                            view! {
                                <table class="data-table compact-table">
                                    <thead>
                                        <tr>
                                            <th>{move || i18n::t(lang.get()).providers_title}</th>
                                            <th>{move || i18n::t(lang.get()).providers_city}</th>
                                            <th>{move || i18n::t(lang.get()).providers_state}</th>
                                            <th>{move || i18n::t(lang.get()).providers_stats}</th>
                                            <th>{move || i18n::t(lang.get()).users_actions}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.into_iter().map(|item| {
                                            let provider_id = item.id.clone();
                                            let selected = selected_provider_id.get() == Some(item.id.clone());
                                            let row_class = if selected { "provider-row-selected" } else { "" };
                                            let stats = format!("D:{} P:{} A:{}", item.doctor_count, item.patient_count, item.appointment_count);
                                            view! {
                                                <tr class=row_class>
                                                    <td>
                                                        <div class="provider-name-cell">
                                                            <strong>{item.name.clone()}</strong>
                                                            <span class=provider_type_tag(&item.provider_type)>{provider_type_label(lang.get(), &item.provider_type)}</span>
                                                        </div>
                                                        <div class="provider-subline">{opt_text(&item.fachbereich)}</div>
                                                    </td>
                                                    <td>{format!("{}, {}", opt_text(&item.address_city), opt_text(&item.address_country))}</td>
                                                    <td>
                                                        <span class=bool_tag(item.is_active)>{if item.is_active { i18n::t(lang.get()).providers_active } else { i18n::t(lang.get()).providers_inactive }}</span>
                                                    </td>
                                                    <td class="cell-mono">{stats}</td>
                                                    <td><button class="btn-small" on:click=move |_| set_selected_provider_id.set(Some(provider_id.clone()))>{i18n::t(lang.get()).providers_open}</button></td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            }.into_any()
                        }}
                    </div>
                </div>

                <div class="provider-panel-stack">
                    <div class="card">
                        <div class="card-header provider-card-header">
                            <div>
                                <h2>{move || if selected_provider_id.get().is_some() { i18n::t(lang.get()).providers_detail } else { i18n::t(lang.get()).providers_new }}</h2>
                                {move || provider_detail.get().map(|detail| view! {
                                    <div class="provider-inline-actions">
                                        <span class=provider_type_tag(&detail.provider_type)>{provider_type_label(lang.get(), &detail.provider_type)}</span>
                                        <span class=bool_tag(detail.is_active)>{if detail.is_active { i18n::t(lang.get()).providers_active } else { i18n::t(lang.get()).providers_inactive }}</span>
                                    </div>
                                })}
                            </div>
                            {move || {
                                if let Some(detail) = provider_detail.get() {
                                    let provider_id = detail.id.clone();
                                    let provider_id2 = provider_id.clone();
                                    let is_active = detail.is_active;
                                    if permissions().can_manage_registry {
                                        view! {
                                            <div class="provider-inline-actions">
                                                <button class="btn-secondary" on:click=move |_| toggle_provider_active(provider_id.clone(), is_active)>{if is_active { i18n::t(lang.get()).providers_deactivate } else { i18n::t(lang.get()).providers_activate }}</button>
                                                <button class="btn-secondary" on:click=move |_| delete_provider(provider_id2.clone())>{move || i18n::t(lang.get()).common_delete}</button>
                                            </div>
                                        }.into_any()
                                    } else {
                                        view! { <div></div> }.into_any()
                                    }
                                } else {
                                    view! { <div></div> }.into_any()
                                }
                            }}
                        </div>
                        <form class="create-form" on:submit=save_provider>
                            {move || provider_form_error.get().map(|error| view! { <div class="form-error">{error}</div> })}
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_name}" *"</label><input type="text" required prop:value=provider_name on:input=move |ev| set_provider_name.set(event_target_value(&ev)) /></div>
                                <div class="form-field">
                                    <label>{move || i18n::t(lang.get()).providers_type}" *"</label>
                                    <select prop:value=provider_type on:change=move |ev| set_provider_type.set(event_target_value(&ev))>
                                        <option value="medical">{move || provider_type_label(lang.get(), "medical")}</option>
                                        <option value="non_medical">{move || provider_type_label(lang.get(), "non_medical")}</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_street}</label><input type="text" prop:value=provider_street on:input=move |ev| set_provider_street.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_zip}</label><input type="text" prop:value=provider_zip on:input=move |ev| set_provider_zip.set(event_target_value(&ev)) /></div>
                            </div>
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_city}</label><input type="text" prop:value=provider_city on:input=move |ev| set_provider_city.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_country}</label><input type="text" prop:value=provider_country on:input=move |ev| set_provider_country.set(event_target_value(&ev)) /></div>
                            </div>
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_fachbereich}</label><input type="text" prop:value=provider_fach on:input=move |ev| set_provider_fach.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_phone}</label><input type="text" prop:value=provider_phone on:input=move |ev| set_provider_phone.set(event_target_value(&ev)) /></div>
                            </div>
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_email}</label><input type="email" prop:value=provider_email on:input=move |ev| set_provider_email.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_website}</label><input type="text" prop:value=provider_website on:input=move |ev| set_provider_website.set(event_target_value(&ev)) /></div>
                            </div>
                            <div class="form-row">
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_contract}</label><input type="text" prop:value=provider_contract on:input=move |ev| set_provider_contract.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_notes}</label><input type="text" prop:value=provider_notes on:input=move |ev| set_provider_notes.set(event_target_value(&ev)) /></div>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="btn-primary" disabled=move || provider_saving.get() || !permissions().can_manage_registry>{move || if provider_saving.get() { "..." } else { i18n::t(lang.get()).common_save }}</button>
                                <button type="button" class="btn-secondary" on:click=move |_| {
                                    if let Some(detail) = provider_detail.get() {
                                        set_provider_name.set(detail.name);
                                        set_provider_type.set(detail.provider_type);
                                        set_provider_street.set(detail.address_street.unwrap_or_default());
                                        set_provider_city.set(detail.address_city.unwrap_or_default());
                                        set_provider_zip.set(detail.address_zip.unwrap_or_default());
                                        set_provider_country.set(detail.address_country.unwrap_or_default());
                                        set_provider_phone.set(detail.phone.unwrap_or_default());
                                        set_provider_email.set(detail.email.unwrap_or_default());
                                        set_provider_website.set(detail.website.unwrap_or_default());
                                        set_provider_fach.set(detail.fachbereich.unwrap_or_default());
                                        set_provider_contract.set(contract_to_text(&detail.kooperationsvertrag));
                                        set_provider_notes.set(detail.notes.unwrap_or_default());
                                    } else {
                                        set_provider_name.set(String::new());
                                        set_provider_type.set("medical".to_string());
                                        set_provider_street.set(String::new());
                                        set_provider_city.set(String::new());
                                        set_provider_zip.set(String::new());
                                        set_provider_country.set(String::new());
                                        set_provider_phone.set(String::new());
                                        set_provider_email.set(String::new());
                                        set_provider_website.set(String::new());
                                        set_provider_fach.set(String::new());
                                        set_provider_contract.set(String::new());
                                        set_provider_notes.set(String::new());
                                        set_provider_form_error.set(None);
                                    }
                                }>{move || i18n::t(lang.get()).common_cancel}</button>
                            </div>
                        </form>
                    </div>
                    {move || {
                        if provider_loading.get() {
                            return view! { <div class="card"><div class="empty-state">{i18n::t(lang.get()).common_loading}</div></div> }.into_any();
                        }
                        let Some(detail) = provider_detail.get() else {
                            return view! { <div class="card"><div class="empty-state">{i18n::t(lang.get()).providers_select_hint}</div></div> }.into_any();
                        };
                        let doctors = detail.doctors.clone();
                        let services = detail.services.clone();
                        let patients = detail.linked_patients.clone();
                        let interactions = detail.interactions.clone();
                        let total_doctor_patients = detail.doctors.iter().map(|doctor| doctor.patient_count).sum::<i64>();
                        let total_doctor_appointments = detail.doctors.iter().map(|doctor| doctor.appointment_count).sum::<i64>();
                        let top_doctor = detail
                            .doctors
                            .iter()
                            .max_by_key(|doctor| (doctor.appointment_count, doctor.patient_count))
                            .map(|doctor| format!("{} (A:{} / P:{})", doctor.name, doctor.appointment_count, doctor.patient_count))
                            .unwrap_or_else(|| "—".to_string());
                        view! {
                            <div class="provider-subgrid">
                                <div class="provider-panel-stack">
                                    <div class="card">
                                        <div class="card-header"><h2>"Provider productivity"</h2></div>
                                        <div class="provider-inline-actions">
                                            <span class="tag tag--gray">{format!("Doctors: {}", detail.doctors.len())}</span>
                                            <span class="tag tag--green">{format!("Patients: {}", total_doctor_patients)}</span>
                                            <span class="tag tag--amber">{format!("Appointments: {}", total_doctor_appointments)}</span>
                                            <span class="tag tag--blue">{format!("Activity: {}", detail.interactions.len())}</span>
                                        </div>
                                        <div class="provider-subline" style="margin-top:8px">{format!("Top doctor: {top_doctor}")}</div>
                                    </div>

                                    <div class="card">
                                        <div class="card-header provider-card-header">
                                            <h2>{i18n::t(lang.get()).providers_doctors}</h2>
                                            {move || {
                                                if permissions().can_manage_registry {
                                                    view! {
                                                        <button class="btn-small" on:click=move |_| {
                                                            set_selected_doctor_id.set(None);
                                                            set_doctor_detail.set(None);
                                                            set_doctor_name.set(String::new());
                                                            set_doctor_title.set(String::new());
                                                            set_doctor_fach.set(String::new());
                                                            set_doctor_phone.set(String::new());
                                                            set_doctor_email.set(String::new());
                                                            set_doctor_notes.set(String::new());
                                                        }>
                                                            "+ " {i18n::t(lang.get()).providers_doctor_new}
                                                        </button>
                                                    }.into_any()
                                                } else {
                                                    view! { <div></div> }.into_any()
                                                }
                                            }}
                                        </div>
                                        <table class="data-table compact-table">
                                            <thead><tr><th>{i18n::t(lang.get()).providers_doctors}</th><th>{i18n::t(lang.get()).providers_stats}</th><th>{move || i18n::t(lang.get()).users_actions}</th></tr></thead>
                                            <tbody>
                                                {doctors.into_iter().map(|doctor| {
                                                    let doctor_id = doctor.id.clone();
                                                    let doctor_id_open = doctor.id.clone();
                                                    let provider_id = doctor.provider_id.clone();
                                                    let provider_id_delete = provider_id.clone();
                                                    let doctor_id_delete = doctor_id.clone();
                                                    let can_manage_registry = permissions().can_manage_registry;
                                                    let delete_button = if can_manage_registry {
                                                        view! {
                                                            <button class="btn-small" on:click=move |_| delete_doctor(provider_id_delete.clone(), doctor_id_delete.clone())>{i18n::t(lang.get()).common_delete}</button>
                                                        }.into_any()
                                                    } else {
                                                        view! { <div></div> }.into_any()
                                                    };
                                                    let selected = selected_doctor_id.get() == Some(doctor.id.clone());
                                                    let row_class = if selected { "provider-row-selected" } else { "" };
                                                    let stats = format!("P:{} A:{}", doctor.patient_count, doctor.appointment_count);
                                                    view! {
                                                        <tr class=row_class>
                                                            <td><div class="provider-name-cell"><strong>{doctor.name}</strong><span class="provider-subline">{opt_text(&doctor.fachbereich)}</span></div></td>
                                                            <td class="cell-mono">{stats}</td>
                                                            <td>
                                                                <div class="provider-inline-actions">
                                                                    <button class="btn-small" on:click=move |_| set_selected_doctor_id.set(Some(doctor_id_open.clone()))>{i18n::t(lang.get()).providers_open}</button>
                                                                    {delete_button}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    }
                                                }).collect::<Vec<_>>()}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div class="card">
                                        <div class="card-header"><h2>{move || if selected_doctor_id.get().is_some() { i18n::t(lang.get()).providers_doctor_detail } else { i18n::t(lang.get()).providers_doctor_new }}</h2></div>
                                        <form class="create-form" on:submit=save_doctor>
                                            {move || doctor_error.get().map(|error| view! { <div class="form-error">{error}</div> })}
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_name}" *"</label><input type="text" required prop:value=doctor_name on:input=move |ev| set_doctor_name.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_doctor_title}</label><input type="text" prop:value=doctor_title on:input=move |ev| set_doctor_title.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_fachbereich}</label><input type="text" prop:value=doctor_fach on:input=move |ev| set_doctor_fach.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_phone}</label><input type="text" prop:value=doctor_phone on:input=move |ev| set_doctor_phone.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).field_email}</label><input type="email" prop:value=doctor_email on:input=move |ev| set_doctor_email.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_notes}</label><input type="text" prop:value=doctor_notes on:input=move |ev| set_doctor_notes.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-actions">
                                                <button type="submit" class="btn-primary" disabled=move || doctor_saving.get() || !permissions().can_manage_registry>{move || if doctor_saving.get() { "..." } else { i18n::t(lang.get()).common_save }}</button>
                                                <button type="button" class="btn-secondary" on:click=move |_| {
                                                    set_selected_doctor_id.set(None);
                                                    set_doctor_detail.set(None);
                                                    set_doctor_name.set(String::new());
                                                    set_doctor_title.set(String::new());
                                                    set_doctor_fach.set(String::new());
                                                    set_doctor_phone.set(String::new());
                                                    set_doctor_email.set(String::new());
                                                    set_doctor_notes.set(String::new());
                                                }>{move || i18n::t(lang.get()).common_cancel}</button>
                                            </div>
                                        </form>
                                        {move || if doctor_loading.get() {
                                            view! { <div class="empty-state">{i18n::t(lang.get()).common_loading}</div> }.into_any()
                                        } else { match doctor_detail.get() {
                                            Some(detail) => view! {
                                                <div class="provider-linked-patients">
                                                    <div class="provider-inline-actions" style="margin-bottom:8px">
                                                        <span class="tag tag--gray">{format!("Patients: {}", detail.patient_count)}</span>
                                                        <span class="tag tag--amber">{format!("Appointments: {}", detail.appointment_count)}</span>
                                                        <span class="tag tag--blue">{format!("Activity: {}", detail.interactions.len())}</span>
                                                    </div>
                                                    <div class="provider-section-title">{format!("{}: {}", i18n::t(lang.get()).providers_linked_patients, detail.linked_patients.len())}</div>
                                                    {if detail.linked_patients.is_empty() {
                                                        view! { <div class="empty-state">{i18n::t(lang.get()).providers_no_patients}</div> }.into_any()
                                                    } else {
                                                        view! {
                                                            <table class="data-table compact-table">
                                                                <thead><tr><th>{i18n::t(lang.get()).providers_patient}</th><th>{i18n::t(lang.get()).providers_stats}</th><th>{i18n::t(lang.get()).providers_last_activity}</th></tr></thead>
                                                                <tbody>{detail.linked_patients.into_iter().map(|patient| view! { <tr><td>{format!("{} {} ({})", patient.first_name, patient.last_name, patient.patient_id)}</td><td class="cell-mono">{format!("A:{} L:{}", patient.appointment_count, patient.leistung_count)}</td><td class="cell-mono">{compact_dt(&patient.last_interaction_at)}</td></tr> }).collect::<Vec<_>>()}</tbody>
                                                            </table>
                                                        }.into_any()
                                                    }}
                                                    <div class="provider-section-title" style="margin-top:16px">{format!("Activity: {}", detail.interactions.len())}</div>
                                                    {render_interactions_table(lang.get(), detail.interactions)}
                                                </div>
                                            }.into_any(),
                                            None => view! { <div></div> }.into_any(),
                                        }}}
                                    </div>
                                </div>

                                <div class="provider-panel-stack">
                                    <div class="card">
                                        <div class="card-header provider-card-header">
                                            <h2>{i18n::t(lang.get()).providers_services}</h2>
                                            {move || {
                                                if permissions().can_manage_registry {
                                                    view! {
                                                        <button class="btn-small" on:click=move |_| {
                                                            set_selected_service_id.set(None);
                                                            set_service_name.set(String::new());
                                                            set_service_description.set(String::new());
                                                            set_service_price.set(String::new());
                                                            set_service_currency.set("EUR".to_string());
                                                            set_service_valid_from.set(String::new());
                                                            set_service_valid_to.set(String::new());
                                                        }>
                                                            "+ " {i18n::t(lang.get()).providers_service_new}
                                                        </button>
                                                    }.into_any()
                                                } else {
                                                    view! { <div></div> }.into_any()
                                                }
                                            }}
                                        </div>
                                        <table class="data-table compact-table">
                                            <thead><tr><th>{i18n::t(lang.get()).providers_services}</th><th>{i18n::t(lang.get()).providers_service_price}</th><th>{i18n::t(lang.get()).providers_service_period}</th><th>{move || i18n::t(lang.get()).users_actions}</th></tr></thead>
                                            <tbody>
                                                {services.into_iter().map(|service| {
                                                    let service_id = service.id.clone();
                                                    let service_id_open = service.id.clone();
                                                    let provider_id = service.provider_id.clone();
                                                    let provider_id_delete = provider_id.clone();
                                                    let service_id_delete = service_id.clone();
                                                    let can_manage_registry = permissions().can_manage_registry;
                                                    let delete_button = if can_manage_registry {
                                                        view! {
                                                            <button class="btn-small" on:click=move |_| delete_service(provider_id_delete.clone(), service_id_delete.clone())>{i18n::t(lang.get()).common_delete}</button>
                                                        }.into_any()
                                                    } else {
                                                        view! { <div></div> }.into_any()
                                                    };
                                                    let selected = selected_service_id.get() == Some(service.id.clone());
                                                    let row_class = if selected { "provider-row-selected" } else { "" };
                                                    let price = format!("{} {}", json_value_text(&service.price), service.currency);
                                                    let period = match service.valid_to.clone() { Some(valid_to) => format!("{} - {}", service.valid_from, valid_to), None => service.valid_from.clone() };
                                                    view! {
                                                        <tr class=row_class>
                                                            <td><div class="provider-name-cell"><strong>{service.service_name}</strong><span class="provider-subline">{opt_text(&service.description)}</span></div></td>
                                                            <td class="cell-mono">{price}</td>
                                                            <td class="cell-mono">{period}</td>
                                                            <td>
                                                                <div class="provider-inline-actions">
                                                                    <button class="btn-small" on:click=move |_| set_selected_service_id.set(Some(service_id_open.clone()))>{i18n::t(lang.get()).providers_open}</button>
                                                                    {delete_button}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    }
                                                }).collect::<Vec<_>>()}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div class="card">
                                        <div class="card-header"><h2>{move || if selected_service_id.get().is_some() { i18n::t(lang.get()).providers_service_detail } else { i18n::t(lang.get()).providers_service_new }}</h2></div>
                                        <form class="create-form" on:submit=save_service>
                                            {move || service_error.get().map(|error| view! { <div class="form-error">{error}</div> })}
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_name}" *"</label><input type="text" required prop:value=service_name on:input=move |ev| set_service_name.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_price}" *"</label><input type="text" required prop:value=service_price on:input=move |ev| set_service_price.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_currency}</label><input type="text" prop:value=service_currency on:input=move |ev| set_service_currency.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_desc}</label><input type="text" prop:value=service_description on:input=move |ev| set_service_description.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_valid_from}</label><input type="date" prop:value=service_valid_from on:input=move |ev| set_service_valid_from.set(event_target_value(&ev)) /></div>
                                                <div class="form-field"><label>{move || i18n::t(lang.get()).providers_service_valid_to}</label><input type="date" prop:value=service_valid_to on:input=move |ev| set_service_valid_to.set(event_target_value(&ev)) /></div>
                                            </div>
                                            <div class="form-actions">
                                                <button type="submit" class="btn-primary" disabled=move || service_saving.get() || !permissions().can_manage_registry>{move || if service_saving.get() { "..." } else { i18n::t(lang.get()).common_save }}</button>
                                                <button type="button" class="btn-secondary" on:click=move |_| {
                                                    set_selected_service_id.set(None);
                                                    set_service_name.set(String::new());
                                                    set_service_description.set(String::new());
                                                    set_service_price.set(String::new());
                                                    set_service_currency.set("EUR".to_string());
                                                    set_service_valid_from.set(String::new());
                                                    set_service_valid_to.set(String::new());
                                                }>{move || i18n::t(lang.get()).common_cancel}</button>
                                            </div>
                                        </form>
                                    </div>

                                    <div class="card">
                                        <div class="card-header"><h2>{i18n::t(lang.get()).providers_linked_patients}</h2></div>
                                        {if patients.is_empty() {
                                            view! { <div class="empty-state">{i18n::t(lang.get()).providers_no_patients}</div> }.into_any()
                                        } else {
                                            view! {
                                                <table class="data-table compact-table">
                                                    <thead><tr><th>{i18n::t(lang.get()).providers_patient}</th><th>{i18n::t(lang.get()).providers_appointments}</th><th>{i18n::t(lang.get()).providers_leistungen}</th><th>{i18n::t(lang.get()).providers_last_activity}</th></tr></thead>
                                                    <tbody>{patients.into_iter().map(|patient| view! { <tr><td>{format!("{} {} ({})", patient.first_name, patient.last_name, patient.patient_id)}</td><td class="cell-mono">{patient.appointment_count}</td><td class="cell-mono">{patient.leistung_count}</td><td class="cell-mono">{compact_dt(&patient.last_interaction_at)}</td></tr> }).collect::<Vec<_>>()}</tbody>
                                                </table>
                                            }.into_any()
                                        }}
                                    </div>

                                    <div class="card">
                                        <div class="card-header"><h2>{i18n::t(lang.get()).providers_interactions}</h2></div>
                                        {render_interactions_table(lang.get(), interactions)}
                                    </div>
                                </div>
                            </div>
                        }.into_any()
                    }}
                </div>
                </div>
                        {move || provider_error.get().map(|error| view! { <div class="page-error">{error}</div> })}
                    </>
                }.into_any()
            }}
        </div>
    }
}
