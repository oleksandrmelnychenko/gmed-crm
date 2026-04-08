use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Lead {
    id: String,
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
    source: Option<String>,
    country: Option<String>,
    qualification_status: String,
    created_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct LeadStats {
    total_this_month: i64,
    total_last_month: i64,
    growth_pct: i64,
    growth_abs: i64,
    qualified_this_month: i64,
    converted_this_month: i64,
    total_all: i64,
}

#[derive(Deserialize, Clone, Debug)]
struct MonthlyPoint {
    month: String,
    count: i32,
}

#[derive(Deserialize, Clone, Debug)]
struct StatusCount {
    status: String,
    count: i32,
}

#[derive(Serialize)]
struct CreateLead {
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
    source: Option<String>,
    country: Option<String>,
    needs_medical: Option<String>,
}

#[derive(Serialize)]
struct QualifyReq {
    status: String,
}

fn status_class(s: &str) -> &'static str {
    match s {
        "new" => "tag tag--blue",
        "in_progress" => "tag tag--amber",
        "qualified" => "tag tag--green",
        "not_qualified" => "tag tag--red",
        "converted" => "tag tag--purple",
        "archived" => "tag tag--gray",
        _ => "tag tag--gray",
    }
}

fn status_bar_color(s: &str) -> &'static str {
    match s {
        "new" => "#1677ff",
        "in_progress" => "#faad14",
        "qualified" => "#52c41a",
        "not_qualified" => "#ff4d4f",
        "converted" => "#722ed1",
        "archived" => "#d9d9d9",
        _ => "#d9d9d9",
    }
}

fn nonempty(s: String) -> Option<String> {
    if s.is_empty() { None } else { Some(s) }
}

fn leads_query_url(search: &str, status: &str) -> String {
    let mut params = Vec::<String>::new();
    if !search.trim().is_empty() {
        params.push(format!("search={}", search.trim()));
    }
    if !status.trim().is_empty() {
        params.push(format!("status={status}"));
    }
    if params.is_empty() {
        "/leads".to_string()
    } else {
        format!("/leads?{}", params.join("&"))
    }
}

#[component]
pub fn Leads() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (leads, set_leads) = signal(Vec::<Lead>::new());
    let (stats, set_stats) = signal(LeadStats::default());
    let (monthly, set_monthly) = signal(Vec::<MonthlyPoint>::new());
    let (by_status, set_by_status) = signal(Vec::<StatusCount>::new());
    let (_, set_loading) = signal(true);
    let (show_create, set_show_create) = signal(false);
    let (reload_nonce, set_reload_nonce) = signal(0u32);
    let (f_first, set_f_first) = signal(String::new());
    let (f_last, set_f_last) = signal(String::new());
    let (f_phone, set_f_phone) = signal(String::new());
    let (f_email, set_f_email) = signal(String::new());
    let (f_country, set_f_country) = signal(String::new());
    let (f_source, set_f_source) = signal(String::new());
    let (f_needs, _set_f_needs) = signal(String::new());
    let (creating, set_creating) = signal(false);
    let (search, set_search) = signal(String::new());
    let (filter_status, set_filter_status) = signal(String::new());

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        let url = leads_query_url(&search.get(), &filter_status.get());
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            let l = client::get::<Vec<Lead>>(&url).await.unwrap_or_default();
            set_leads.set(l);
            set_loading.set(false);
        });
    });

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        wasm_bindgen_futures::spawn_local(async move {
            let s = client::get::<LeadStats>("/stats/leads")
                .await
                .unwrap_or_default();
            let m = client::get::<Vec<MonthlyPoint>>("/stats/leads/monthly")
                .await
                .unwrap_or_default();
            let b = client::get::<Vec<StatusCount>>("/stats/leads/by-status")
                .await
                .unwrap_or_default();
            set_stats.set(s);
            set_monthly.set(m);
            set_by_status.set(b);
        });
    });

    let on_create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_creating.set(true);
        let body = CreateLead {
            first_name: f_first.get(),
            last_name: f_last.get(),
            email: nonempty(f_email.get()),
            phone: nonempty(f_phone.get()),
            source: nonempty(f_source.get()),
            country: nonempty(f_country.get()),
            needs_medical: nonempty(f_needs.get()),
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<CreateLead, serde_json::Value>("/leads", &body).await;
            set_show_create.set(false);
            set_creating.set(false);
            set_f_first.set(String::new());
            set_f_last.set(String::new());
            set_reload_nonce.update(|v| *v += 1);
        });
    };

    let qualify = move |id: String, status: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<QualifyReq, serde_json::Value>(
                &format!("/leads/{id}/qualify"),
                &QualifyReq { status },
            )
            .await;
            set_reload_nonce.update(|v| *v += 1);
        });
    };
    let convert = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/leads/{id}/convert")).await;
            set_reload_nonce.update(|v| *v += 1);
        });
    };
    let archive = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<QualifyReq, serde_json::Value>(
                &format!("/leads/{id}/qualify"),
                &QualifyReq {
                    status: "archived".into(),
                },
            )
            .await;
            set_reload_nonce.update(|v| *v += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).leads_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).leads_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_create.set(!show_create.get())>
                    "+ " {move || i18n::t(lang.get()).leads_new}
                </button>
            </div>

            // Stats cards
            {move || {
                let tr = i18n::t(lang.get());
                let s = stats.get();
                let gcls = if s.growth_pct >= 0 { "stat-change positive" } else { "stat-change negative" };
                let gsign = if s.growth_pct >= 0 { "+" } else { "" };

                view! {
                    <div class="stats-grid" style="margin-bottom:24px">
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.leads_total_month}</span></div>
                            <span class="stat-value">{s.total_this_month}</span>
                            <span class=gcls>{format!("{gsign}{}% ({gsign}{})", s.growth_pct, s.growth_abs)}" vs last"</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.leads_qualified_month}</span></div>
                            <span class="stat-value">{s.qualified_this_month}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.leads_converted_month}</span></div>
                            <span class="stat-value">{s.converted_this_month}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.leads_total_all}</span></div>
                            <span class="stat-value">{s.total_all}</span>
                        </div>
                    </div>
                }
            }}

            // Charts row
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px">
                {move || {
                    let tr = i18n::t(lang.get());
                    let points = monthly.get();
                    let max_val = { let mut m = 1i32; for p in &points { if p.count > m { m = p.count; } } m };
                    view! {
                        <div class="card">
                            <div class="card-header"><h2>{tr.leads_monthly_growth}</h2></div>
                            <div class="chart-area">
                                <div class="chart-bars">
                                    {points.into_iter().map(|p| {
                                        let pct = (p.count as f64 / max_val as f64 * 100.0) as u32;
                                        let label = p.month.split('-').next_back().unwrap_or("").to_string();
                                        view! {
                                            <div class="chart-bar-col">
                                                <div class="chart-bar" style=format!("height:{pct}%")><span class="chart-bar-val">{p.count}</span></div>
                                                <span class="chart-bar-label">{label}</span>
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            </div>
                        </div>
                    }
                }}
                {move || {
                    let tr = i18n::t(lang.get());
                    let statuses = by_status.get();
                    let total: i32 = { let mut s = 0; for st in &statuses { s += st.count; } s };
                    view! {
                        <div class="card">
                            <div class="card-header"><h2>{tr.leads_by_status}</h2></div>
                            <div style="padding:20px">
                                <div style="font-size:28px;font-weight:700;margin-bottom:16px">{total}</div>
                                {statuses.into_iter().map(|st| {
                                    let pct = if total > 0 { (st.count as f64 / total as f64 * 100.0) as u32 } else { 0 };
                                    let color = status_bar_color(&st.status);
                                    view! {
                                        <div class="status-bar-row">
                                            <span class="status-bar-label">{st.status.clone()}</span>
                                            <div class="status-bar-track"><div class="status-bar-fill" style=format!("width:{pct}%;background:{color}")></div></div>
                                            <span class="status-bar-count">{st.count}</span>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        </div>
                    }
                }}
            </div>

            // Create form
            {move || {
                let tr = i18n::t(lang.get());
                if show_create.get() {
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header"><h2>{tr.leads_new}</h2></div>
                            <form class="create-form" on:submit=on_create>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_name}" *"</label><input type="text" required prop:value=f_first on:input=move |ev| set_f_first.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.patients_last_name}" *"</label><input type="text" required prop:value=f_last on:input=move |ev| set_f_last.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_phone}</label><input type="tel" prop:value=f_phone on:input=move |ev| set_f_phone.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.field_email}</label><input type="email" prop:value=f_email on:input=move |ev| set_f_email.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.leads_source}</label><input type="text" prop:value=f_source on:input=move |ev| set_f_source.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.field_nationality}</label><input type="text" prop:value=f_country on:input=move |ev| set_f_country.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-primary" disabled=creating>{move || if creating.get() {"..."} else {tr.common_save}}</button>
                                    <button type="button" class="btn-secondary" on:click=move |_| set_show_create.set(false)>{tr.common_cancel}</button>
                                </div>
                            </form>
                        </div>
                    }.into_any()
                } else { view! {<div></div>}.into_any() }
            }}

            // Table
            {move || {
                let tr = i18n::t(lang.get());
                let list = leads.get();
                view! {
                    <div class="card">
                        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                            <h2>{format!("{} {}", list.len(), tr.leads_title)}</h2>
                            <div style="display:flex;gap:8px;align-items:center">
                                <input type="text" class="search-input" style="max-width:300px"
                                    placeholder=tr.search_placeholder
                                    prop:value=search on:input=move |ev| set_search.set(event_target_value(&ev))/>
                                <select prop:value=filter_status on:change=move |ev| set_filter_status.set(event_target_value(&ev))>
                                    <option value="">"All statuses"</option>
                                    <option value="new">"new"</option>
                                    <option value="in_progress">"in_progress"</option>
                                    <option value="qualified">"qualified"</option>
                                    <option value="not_qualified">"not_qualified"</option>
                                    <option value="converted">"converted"</option>
                                    <option value="archived">"archived"</option>
                                </select>
                            </div>
                        </div>
                        <table class="data-table">
                            <thead><tr>
                                <th>"ID"</th><th>{tr.field_name}</th><th>{tr.field_email}</th>
                                <th>{tr.users_status}</th><th>{tr.leads_source}</th>
                                <th>{tr.users_created}</th><th>{tr.users_actions}</th>
                            </tr></thead>
                            <tbody>
                                {list.into_iter().enumerate().map(|(i, l)| {
                                    let Lead { id, first_name, last_name, email, qualification_status, source, created_at, .. } = l;
                                    let cls = status_class(&qualification_status);
                                    let id_q = id.clone(); let id_c = id.clone(); let id_a = id.clone();
                                    let is_qualified = qualification_status == "qualified";
                                    let is_new = qualification_status == "new" || qualification_status == "in_progress";
                                    let is_active = qualification_status != "archived" && qualification_status != "converted";
                                    let lid = format!("LD{:05}", i + 1);
                                    let date = created_at.split('T').next().unwrap_or(&created_at).to_string();
                                    view! {
                                        <tr>
                                            <td class="cell-mono cell-dim">{lid}</td>
                                            <td class="cell-primary">{format!("{first_name} {last_name}")}</td>
                                            <td class="cell-mono cell-dim">{email.unwrap_or_default()}</td>
                                            <td><span class=cls>{qualification_status.clone()}</span></td>
                                            <td>{source.unwrap_or_default()}</td>
                                            <td class="cell-dim">{date}</td>
                                            <td class="action-cell">
                                                {if is_new { view! {<button class="btn-small" on:click=move |_| qualify(id_q.clone(), "qualified".into())>{tr.leads_qualify}</button>}.into_any() } else { view! {<span></span>}.into_any() }}
                                                {if is_qualified { view! {<button class="btn-small" on:click=move |_| convert(id_c.clone())>{tr.leads_convert}</button>}.into_any() } else { view! {<span></span>}.into_any() }}
                                                {if is_active { view! {<button class="btn-small" style="color:var(--error)" on:click=move |_| archive(id_a.clone())>{tr.common_delete}</button>}.into_any() } else { view! {<span></span>}.into_any() }}
                                            </td>
                                        </tr>
                                    }
                                }).collect::<Vec<_>>()}
                            </tbody>
                        </table>
                    </div>
                }
            }}
        </div>
    }
}
