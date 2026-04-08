use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
struct CaseItem {
    case_id: String,
    patient_name: String,
    patient_pid: String,
    status: String,
    hauptanfragegrund: Option<String>,
    created_at: String,
}

fn status_class(s: &str) -> &'static str {
    match s {
        "open" => "tag tag--blue",
        "in_progress" => "tag tag--amber",
        "closed" => "tag tag--green",
        _ => "tag tag--gray",
    }
}

fn cases_query_url(search: &str, status: &str) -> String {
    let mut params = Vec::<String>::new();
    if !search.trim().is_empty() {
        params.push(format!("search={}", search.trim()));
    }
    if !status.trim().is_empty() {
        params.push(format!("status={status}"));
    }
    if params.is_empty() {
        "/cases".to_string()
    } else {
        format!("/cases?{}", params.join("&"))
    }
}

#[component]
pub fn CasesList() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (cases, set_cases) = signal(Vec::<CaseItem>::new());
    let (loading, set_loading) = signal(true);
    let (search, set_search) = signal(String::new());
    let (filter_status, set_filter_status) = signal(String::new());

    Effect::new(move |_| {
        let url = cases_query_url(&search.get(), &filter_status.get());
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<CaseItem>>(&url).await {
                Ok(c) => {
                    set_cases.set(c);
                    set_loading.set(false);
                }
                Err(_) => {
                    set_loading.set(false);
                }
            }
        });
    });

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).cases_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).cases_subtitle}</p>
                </div>
            </div>
            {move || {
                let tr = i18n::t(lang.get());
                view! {
                    <div class="card" style="margin-bottom:16px">
                        <div class="create-form">
                            <div class="form-row">
                                <div class="form-field">
                                    <label>{tr.common_search}</label>
                                    <input type="text" class="search-input" placeholder=tr.search_placeholder prop:value=search on:input=move |ev| set_search.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field">
                                    <label>{tr.users_status}</label>
                                    <select prop:value=filter_status on:change=move |ev| set_filter_status.set(event_target_value(&ev))>
                                        <option value="">"All statuses"</option>
                                        <option value="open">"open"</option>
                                        <option value="in_progress">"in_progress"</option>
                                        <option value="closed">"closed"</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                }.into_any()
            }}
            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! {<div class="page-loading">{tr.common_loading}</div>}.into_any(); }
                let list = cases.get();
                view! {
                    <div class="card">
                        <div class="card-header"><h2>{format!("{} {}", list.len(), tr.cases_title)}</h2></div>
                        <table class="data-table">
                            <thead><tr>
                                <th>"Case ID"</th><th>{tr.orders_patient}</th>
                                <th>{tr.cases_reason}</th><th>{tr.users_status}</th><th>{tr.users_created}</th>
                            </tr></thead>
                            <tbody>
                                {list.into_iter().map(|c| {
                                    let CaseItem { case_id, patient_name, patient_pid, status, hauptanfragegrund, created_at, .. } = c;
                                    let cls = status_class(&status);
                                    let date = created_at.split('T').next().unwrap_or(&created_at).to_string();
                                    let reason = hauptanfragegrund.unwrap_or_default();
                                    view! {
                                        <tr>
                                            <td class="cell-mono cell-primary">{case_id}</td>
                                            <td>{format!("{patient_name} ({patient_pid})")}</td>
                                            <td>{reason}</td>
                                            <td><span class=cls>{status}</span></td>
                                            <td class="cell-dim">{date}</td>
                                        </tr>
                                    }
                                }).collect::<Vec<_>>()}
                            </tbody>
                        </table>
                    </div>
                }.into_any()
            }}
        </div>
    }
}
