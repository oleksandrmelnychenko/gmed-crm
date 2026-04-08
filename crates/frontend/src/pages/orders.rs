use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Clone, Debug)]
struct Order {
    id: String,
    order_number: String,
    patient_name: String,
    patient_pid: String,
    phase: String,
    status: String,
    created_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Leistung {
    id: String,
    description: String,
    quantity: Value,
    unit_price: Value,
    currency: String,
    vat_rate: Value,
    is_cost_passthrough: bool,
    status: String,
    notes: Option<String>,
    provider_id: Option<String>,
    provider_name: Option<String>,
    doctor_id: Option<String>,
    doctor_name: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct OrderDetail {
    id: String,
    order_number: String,
    patient_id: String,
    patient_name: String,
    patient_pid: String,
    phase: String,
    status: String,
    needs_description: Option<String>,
    total_estimated: Option<Value>,
    total_actual: Option<Value>,
    leistungen: Vec<Leistung>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, Clone, Debug)]
struct PatientOption {
    id: String,
    patient_id: String,
    first_name: String,
    last_name: String,
}

#[derive(Deserialize, Clone, Debug)]
struct ProviderOption {
    id: String,
    name: String,
    address_city: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct ProviderDetail {
    doctors: Vec<DoctorOption>,
}

#[derive(Deserialize, Clone, Debug)]
struct DoctorOption {
    id: String,
    name: String,
    fachbereich: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct CreateResponse {
    id: String,
}

#[derive(Serialize)]
struct PhaseUpdate {
    phase: String,
}

#[derive(Serialize)]
struct CreateOrderRequest {
    patient_id: String,
    contract_id: Option<String>,
    needs_description: Option<String>,
}

#[derive(Serialize)]
struct AddLeistungRequest {
    description: String,
    quantity: f64,
    unit_price: f64,
    vat_rate: Option<f64>,
    is_cost_passthrough: Option<bool>,
    provider_id: Option<String>,
    doctor_id: Option<String>,
    notes: Option<String>,
}

fn phase_class(p: &str) -> &'static str {
    match p {
        "discovery" => "tag tag--gray",
        "intake" => "tag tag--blue",
        "execution" => "tag tag--amber",
        "closure" => "tag tag--green",
        "followup" => "tag tag--purple",
        _ => "tag tag--gray",
    }
}

fn order_status_class(status: &str) -> &'static str {
    match status {
        "active" => "tag tag--green",
        "paused" => "tag tag--amber",
        "completed" => "tag tag--blue",
        "cancelled" => "tag tag--red",
        _ => "tag tag--gray",
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(v) => v.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn opt_string(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn orders_query_url(
    search: &str,
    phase: &str,
    status: &str,
    provider_id: &str,
    doctor_id: &str,
) -> String {
    let mut params = Vec::<String>::new();
    if !search.trim().is_empty() {
        params.push(format!("search={}", search.trim()));
    }
    if !phase.trim().is_empty() {
        params.push(format!("phase={phase}"));
    }
    if !status.trim().is_empty() {
        params.push(format!("status={status}"));
    }
    if !provider_id.trim().is_empty() {
        params.push(format!("provider_id={provider_id}"));
    }
    if !doctor_id.trim().is_empty() {
        params.push(format!("doctor_id={doctor_id}"));
    }
    if params.is_empty() {
        "/orders".to_string()
    } else {
        format!("/orders?{}", params.join("&"))
    }
}

#[component]
pub fn Orders() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (orders, set_orders) = signal(Vec::<Order>::new());
    let (loading, set_loading) = signal(true);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);
    let (selected_order_id, set_selected_order_id) = signal(Option::<String>::None);
    let (order_detail, set_order_detail) = signal(Option::<OrderDetail>::None);
    let (detail_loading, set_detail_loading) = signal(false);
    let (show_create, set_show_create) = signal(false);
    let (creating, set_creating) = signal(false);
    let (create_error, set_create_error) = signal(Option::<String>::None);
    let (leistung_saving, set_leistung_saving) = signal(false);
    let (leistung_error, set_leistung_error) = signal(Option::<String>::None);

    let (patients, set_patients) = signal(Vec::<PatientOption>::new());
    let (providers, set_providers) = signal(Vec::<ProviderOption>::new());
    let (doctors, set_doctors) = signal(Vec::<DoctorOption>::new());
    let (filter_doctors, set_filter_doctors) = signal(Vec::<DoctorOption>::new());

    let (f_patient, set_f_patient) = signal(String::new());
    let (f_needs, set_f_needs) = signal(String::new());

    let (l_desc, set_l_desc) = signal(String::new());
    let (l_qty, set_l_qty) = signal("1".to_string());
    let (l_price, set_l_price) = signal(String::new());
    let (l_vat, set_l_vat) = signal("19".to_string());
    let (l_provider, set_l_provider) = signal(String::new());
    let (l_doctor, set_l_doctor) = signal(String::new());
    let (l_notes, set_l_notes) = signal(String::new());
    let (l_passthrough, set_l_passthrough) = signal(false);
    let (search, set_search) = signal(String::new());
    let (filter_phase, set_filter_phase) = signal(String::new());
    let (filter_status, set_filter_status) = signal(String::new());
    let (filter_provider, set_filter_provider) = signal(String::new());
    let (filter_doctor, set_filter_doctor) = signal(String::new());

    let advance_phase = move |id: String, current: String| {
        let next = match current.as_str() {
            "discovery" => "intake",
            "intake" => "execution",
            "execution" => "closure",
            "closure" => "followup",
            _ => return,
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<PhaseUpdate, Value>(
                &format!("/orders/{id}/phase"),
                &PhaseUpdate { phase: next.into() },
            )
            .await;
            set_reload_nonce.update(|v| *v += 1);
        });
    };

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let url = orders_query_url(
            &search.get(),
            &filter_phase.get(),
            &filter_status.get(),
            &filter_provider.get(),
            &filter_doctor.get(),
        );
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<Order>>(&url).await {
                Ok(list) => {
                    set_orders.set(list);
                    set_loading.set(false);
                }
                Err(_) => set_loading.set(false),
            }
        });
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(list) = client::get::<Vec<PatientOption>>("/patients").await {
                set_patients.set(list);
            }
            if let Ok(list) = client::get::<Vec<ProviderOption>>("/providers").await {
                set_providers.set(list);
            }
        });
    });

    Effect::new(move |_| {
        let provider_id = filter_provider.get();
        if provider_id.is_empty() {
            set_filter_doctor.set(String::new());
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
        let provider_id = l_provider.get();
        if provider_id.is_empty() {
            set_l_doctor.set(String::new());
            set_doctors.set(Vec::new());
            return;
        }
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<ProviderDetail>(&format!("/providers/{provider_id}")).await {
                Ok(detail) => set_doctors.set(detail.doctors),
                Err(_) => set_doctors.set(Vec::new()),
            }
        });
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let Some(order_id) = selected_order_id.get() else {
            set_order_detail.set(None);
            set_detail_loading.set(false);
            return;
        };
        set_detail_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<OrderDetail>(&format!("/orders/{order_id}")).await {
                Ok(detail) => {
                    set_order_detail.set(Some(detail));
                    set_detail_loading.set(false);
                }
                Err(_) => set_detail_loading.set(false),
            }
        });
    });

    let create_order = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_create_error.set(None);
        set_creating.set(true);
        let body = CreateOrderRequest {
            patient_id: f_patient.get(),
            contract_id: None,
            needs_description: opt_string(f_needs.get()),
        };
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateOrderRequest, CreateResponse>("/orders", &body).await {
                Ok(created) => {
                    set_show_create.set(false);
                    set_selected_order_id.set(Some(created.id));
                    set_creating.set(false);
                    set_f_patient.set(String::new());
                    set_f_needs.set(String::new());
                    set_reload_nonce.update(|v| *v += 1);
                }
                Err(error) => {
                    set_create_error.set(Some(error));
                    set_creating.set(false);
                }
            }
        });
    };

    let add_leistung = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_leistung_error.set(None);
        let Some(order_id) = selected_order_id.get() else {
            set_leistung_error.set(Some("Select order first".to_string()));
            return;
        };
        let quantity = l_qty.get().trim().replace(',', ".").parse::<f64>();
        let price = l_price.get().trim().replace(',', ".").parse::<f64>();
        let vat = l_vat.get().trim().replace(',', ".").parse::<f64>();
        let (Ok(quantity), Ok(price), Ok(vat)) = (quantity, price, vat) else {
            set_leistung_error.set(Some("Quantity, price and VAT must be numeric".to_string()));
            return;
        };
        set_leistung_saving.set(true);
        let body = AddLeistungRequest {
            description: l_desc.get(),
            quantity,
            unit_price: price,
            vat_rate: Some(vat),
            is_cost_passthrough: Some(l_passthrough.get()),
            provider_id: opt_string(l_provider.get()),
            doctor_id: opt_string(l_doctor.get()),
            notes: opt_string(l_notes.get()),
        };
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<AddLeistungRequest, Value>(
                &format!("/orders/{order_id}/leistungen"),
                &body,
            )
            .await
            {
                Ok(_) => {
                    set_l_desc.set(String::new());
                    set_l_qty.set("1".to_string());
                    set_l_price.set(String::new());
                    set_l_vat.set("19".to_string());
                    set_l_provider.set(String::new());
                    set_l_doctor.set(String::new());
                    set_l_notes.set(String::new());
                    set_l_passthrough.set(false);
                    set_leistung_saving.set(false);
                    set_reload_nonce.update(|v| *v += 1);
                }
                Err(error) => {
                    set_leistung_error.set(Some(error));
                    set_leistung_saving.set(false);
                }
            }
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).orders_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).orders_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_create.set(!show_create.get())>"+ Order"</button>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                let provider_options = providers.get();
                let doctor_options = filter_doctors.get();
                view! {
                    <div class="card" style="margin-bottom:16px">
                        <div class="create-form">
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{tr.common_search}</label>
                                    <input type="text" class="search-input" placeholder=tr.search_placeholder prop:value=search on:input=move |ev| set_search.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field">
                                    <label>{tr.orders_phase}</label>
                                    <select prop:value=filter_phase on:change=move |ev| set_filter_phase.set(event_target_value(&ev))>
                                        <option value="">"All phases"</option>
                                        <option value="discovery">"discovery"</option>
                                        <option value="intake">"intake"</option>
                                        <option value="execution">"execution"</option>
                                        <option value="closure">"closure"</option>
                                        <option value="followup">"followup"</option>
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label>{tr.users_status}</label>
                                    <select prop:value=filter_status on:change=move |ev| set_filter_status.set(event_target_value(&ev))>
                                        <option value="">"All statuses"</option>
                                        <option value="active">"active"</option>
                                        <option value="paused">"paused"</option>
                                        <option value="completed">"completed"</option>
                                        <option value="cancelled">"cancelled"</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-field">
                                    <label>"Provider"</label>
                                    <select prop:value=filter_provider on:change=move |ev| set_filter_provider.set(event_target_value(&ev))>
                                        <option value="">"All providers"</option>
                                        {provider_options.into_iter().map(|provider| {
                                            let label = match provider.address_city {
                                                Some(city) if !city.is_empty() => format!("{} ({city})", provider.name),
                                                _ => provider.name,
                                            };
                                            view! { <option value=provider.id>{label}</option> }
                                        }).collect::<Vec<_>>()}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label>"Doctor"</label>
                                    <select prop:value=filter_doctor on:change=move |ev| set_filter_doctor.set(event_target_value(&ev))>
                                        <option value="">"All doctors"</option>
                                        {doctor_options.into_iter().map(|doctor| {
                                            let label = match doctor.fachbereich {
                                                Some(fach) if !fach.is_empty() => format!("{} ({fach})", doctor.name),
                                                _ => doctor.name,
                                            };
                                            view! { <option value=doctor.id>{label}</option> }
                                        }).collect::<Vec<_>>()}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label>"Reset"</label>
                                    <button type="button" class="btn-secondary" on:click=move |_| {
                                        set_search.set(String::new());
                                        set_filter_phase.set(String::new());
                                        set_filter_status.set(String::new());
                                        set_filter_provider.set(String::new());
                                        set_filter_doctor.set(String::new());
                                        set_filter_doctors.set(Vec::new());
                                    }>"Clear filters"</button>
                                </div>
                            </div>
                        </div>
                    </div>
                }.into_any()
            }}

            {move || {
                let tr = i18n::t(lang.get());
                if show_create.get() {
                    let patient_options = patients.get();
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header"><h2>"New order"</h2></div>
                            <form class="create-form" on:submit=create_order>
                                {move || create_error.get().map(|error| view! { <div class="form-error">{error}</div> })}
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.orders_patient}" *"</label>
                                        <select required prop:value=f_patient on:change=move |ev| set_f_patient.set(event_target_value(&ev))>
                                            <option value="">""</option>
                                            {patient_options.into_iter().map(|patient| view! { <option value=patient.id>{format!("{} {} ({})", patient.first_name, patient.last_name, patient.patient_id)}</option> }).collect::<Vec<_>>()}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>"Needs / intake note"</label>
                                        <input type="text" prop:value=f_needs on:input=move |ev| set_f_needs.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-primary" disabled=creating>{move || if creating.get() { "..." } else { tr.common_save }}</button>
                                    <button type="button" class="btn-secondary" on:click=move |_| set_show_create.set(false)>{tr.common_cancel}</button>
                                </div>
                            </form>
                        </div>
                    }.into_any()
                } else { view! { <div></div> }.into_any() }
            }}

            <div style="display:grid;grid-template-columns:1fr 1.1fr;gap:16px;align-items:start;">
                <div class="card">
                    <div class="card-header"><h2>{move || format!("{} {}", orders.get().len(), i18n::t(lang.get()).orders_title)}</h2></div>
                    {move || {
                        let tr = i18n::t(lang.get());
                        if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }
                        let list = orders.get();
                        view! {
                            <table class="data-table">
                                <thead><tr><th>"#"</th><th>{tr.orders_patient}</th><th>{tr.orders_phase}</th><th>{tr.users_status}</th><th>{tr.users_created}</th><th>{tr.users_actions}</th></tr></thead>
                                <tbody>
                                    {list.into_iter().map(|order| {
                                        let Order { id, order_number, patient_name, patient_pid, phase, status, created_at } = order;
                                        let id_open = id.clone();
                                        let id_adv = id.clone();
                                        let phase_adv = phase.clone();
                                        let selected = selected_order_id.get() == Some(id.clone());
                                        let row_class = if selected { "provider-row-selected" } else { "" };
                                        view! {
                                            <tr class=row_class>
                                                <td class="cell-mono cell-primary">{order_number}</td>
                                                <td>{format!("{patient_name} ({patient_pid})")}</td>
                                                <td><span class=phase_class(&phase)>{phase.clone()}</span></td>
                                                <td><span class=order_status_class(&status)>{status.clone()}</span></td>
                                                <td class="cell-dim">{created_at.split('T').next().unwrap_or(&created_at).to_string()}</td>
                                                <td><div class="provider-inline-actions"><button class="btn-small" on:click=move |_| set_selected_order_id.set(Some(id_open.clone()))>"Open"</button>{if phase != "followup" { view! { <button class="btn-small" on:click=move |_| advance_phase(id_adv.clone(), phase_adv.clone())>"Next"</button> }.into_any() } else { view! { <span class="tag tag--green">"Done"</span> }.into_any() }}</div></td>
                                            </tr>
                                        }
                                    }).collect::<Vec<_>>()}
                                </tbody>
                            </table>
                        }.into_any()
                    }}
                </div>

                {move || {
                    let tr = i18n::t(lang.get());
                    if detail_loading.get() {
                        return view! { <div class="card"><div class="page-loading">{tr.common_loading}</div></div> }.into_any();
                    }
                    let Some(detail) = order_detail.get() else {
                        return view! { <div class="card"><div class="empty-state">"Select an order to see details and add Leistungen."</div></div> }.into_any();
                    };
                    let provider_options = providers.get();
                    let doctor_options = doctors.get();
                    view! {
                        <div class="provider-panel-stack">
                            <div class="card">
                                <div class="card-header"><h2>{format!("{} / {}", detail.order_number, detail.patient_name)}</h2></div>
                                <div class="create-form">
                                    <div class="form-row">
                                        <div class="form-field"><label>"Phase"</label><div><span class=phase_class(&detail.phase)>{detail.phase.clone()}</span></div></div>
                                        <div class="form-field"><label>"Status"</label><div><span class="tag tag--green">{detail.status.clone()}</span></div></div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-field"><label>"Needs"</label><div>{detail.needs_description.clone().unwrap_or_default()}</div></div>
                                        <div class="form-field"><label>"Totals"</label><div>{format!("{} / {}", detail.total_estimated.as_ref().map(value_text).unwrap_or_default(), detail.total_actual.as_ref().map(value_text).unwrap_or_default())}</div></div>
                                    </div>
                                </div>
                            </div>

                            <div class="card">
                                <div class="card-header"><h2>"Add Leistung"</h2></div>
                                <form class="create-form" on:submit=add_leistung>
                                    {move || leistung_error.get().map(|error| view! { <div class="form-error">{error}</div> })}
                                    <div class="form-row">
                                        <div class="form-field"><label>"Description *"</label><input type="text" required prop:value=l_desc on:input=move |ev| set_l_desc.set(event_target_value(&ev)) /></div>
                                        <div class="form-field"><label>"Notes"</label><input type="text" prop:value=l_notes on:input=move |ev| set_l_notes.set(event_target_value(&ev)) /></div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-field"><label>"Quantity *"</label><input type="text" prop:value=l_qty on:input=move |ev| set_l_qty.set(event_target_value(&ev)) /></div>
                                        <div class="form-field"><label>"Unit price *"</label><input type="text" prop:value=l_price on:input=move |ev| set_l_price.set(event_target_value(&ev)) /></div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-field"><label>"VAT *"</label><input type="text" prop:value=l_vat on:input=move |ev| set_l_vat.set(event_target_value(&ev)) /></div>
                                        <div class="form-field"><label>"Provider"</label><select prop:value=l_provider on:change=move |ev| set_l_provider.set(event_target_value(&ev))><option value="">""</option>{provider_options.into_iter().map(|provider| { let label = match provider.address_city { Some(city) if !city.is_empty() => format!("{} ({city})", provider.name), _ => provider.name, }; view! { <option value=provider.id>{label}</option> } }).collect::<Vec<_>>()}</select></div>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-field"><label>"Doctor"</label><select prop:value=l_doctor on:change=move |ev| set_l_doctor.set(event_target_value(&ev))><option value="">""</option>{doctor_options.into_iter().map(|doctor| { let label = match doctor.fachbereich { Some(fach) if !fach.is_empty() => format!("{} ({fach})", doctor.name), _ => doctor.name, }; view! { <option value=doctor.id>{label}</option> } }).collect::<Vec<_>>()}</select></div>
                                        <div class="form-field"><label>"Passthrough"</label><div class="checkbox-row"><input type="checkbox" prop:checked=l_passthrough on:change=move |ev| set_l_passthrough.set(event_target_checked(&ev)) /><span>"Treat as cost pass-through"</span></div></div>
                                    </div>
                                    <div class="form-actions">
                                        <button type="submit" class="btn-primary" disabled=leistung_saving>{move || if leistung_saving.get() { "..." } else { tr.common_save }}</button>
                                    </div>
                                </form>
                            </div>

                            <div class="card">
                                <div class="card-header"><h2>{format!("Leistungen ({})", detail.leistungen.len())}</h2></div>
                                <table class="data-table">
                                    <thead><tr><th>"Description"</th><th>"Provider / Doctor"</th><th>"Qty"</th><th>"Price"</th><th>"Status"</th></tr></thead>
                                    <tbody>
                                        {detail.leistungen.into_iter().map(|leistung| {
                                            let doctor = match (leistung.provider_name, leistung.doctor_name) {
                                                (Some(provider), Some(doctor)) => format!("{provider} / {doctor}"),
                                                (Some(provider), None) => provider,
                                                (None, Some(doctor)) => doctor,
                                                (None, None) => String::new(),
                                            };
                                            view! {
                                                <tr>
                                                    <td><div class="provider-name-cell"><strong>{leistung.description}</strong><span class="provider-subline">{leistung.notes.unwrap_or_default()}</span></div></td>
                                                    <td>{doctor}</td>
                                                    <td class="cell-mono">{value_text(&leistung.quantity)}</td>
                                                    <td class="cell-mono">{format!("{} {}", value_text(&leistung.unit_price), leistung.currency)}</td>
                                                    <td><span class="tag tag--gray">{leistung.status}</span></td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    }.into_any()
                }}
            </div>
        </div>
    }
}
