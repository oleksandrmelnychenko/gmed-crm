use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde_json::Value;

#[component]
pub fn AdminHealth() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (data, set_data) = signal(Option::<Value>::None);
    let (loading, set_loading) = signal(true);

    Effect::new(move |_| {
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Value>("/admin/health").await {
                Ok(d) => set_data.set(Some(d)),
                Err(_) => set_data.set(None),
            }
            set_loading.set(false);
        });
    });

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).health_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).health_subtitle}</p>
                </div>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }
                let Some(d) = data.get() else { return view! { <div class="page-error">{tr.common_error}</div> }.into_any(); };

                let db = &d["database"];
                let users = &d["users"];
                let sessions = &d["sessions"];
                let data_sec = &d["data"];

                let db_size = db["size"].as_str().unwrap_or("?").to_string();
                let connections = db["active_connections"].as_i64().unwrap_or(0);
                let tables = db["tables"].as_array().cloned().unwrap_or_default();

                let u_total = users["total"].as_i64().unwrap_or(0);
                let u_active = users["active"].as_i64().unwrap_or(0);
                let u_locked = users["locked"].as_i64().unwrap_or(0);
                let s_active = sessions["active"].as_i64().unwrap_or(0);
                let s_pending = sessions["pending_mfa"].as_i64().unwrap_or(0);

                let patients = data_sec["patients"].as_i64().unwrap_or(0);
                let leads = data_sec["leads"].as_i64().unwrap_or(0);
                let orders = data_sec["orders"].as_i64().unwrap_or(0);
                let audit = data_sec["audit_entries"].as_i64().unwrap_or(0);

                view! {
                    <div class="stats-grid" style="margin-bottom:24px">
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.health_db_size}</span></div>
                            <span class="stat-value" style="font-size:24px">{db_size}</span>
                            <span class="stat-change neutral">{format!("{} {}", connections, tr.health_connections)}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.health_users_total}</span></div>
                            <span class="stat-value">{u_total}</span>
                            <span class="stat-change positive">{format!("{} {}", u_active, tr.health_users_active)}</span>
                            {if u_locked > 0 { view! { <span class="stat-change negative">{format!("{} {}", u_locked, tr.health_users_locked)}</span> }.into_any() } else { view! { <span></span> }.into_any() }}
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.health_sessions_active}</span></div>
                            <span class="stat-value">{s_active}</span>
                            {if s_pending > 0 { view! { <span class="stat-change neutral">{format!("{} {}", s_pending, tr.health_mfa_pending)}</span> }.into_any() } else { view! { <span></span> }.into_any() }}
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">"Data"</span></div>
                            <span class="stat-value" style="font-size:20px">{format!("P:{} L:{} O:{}", patients, leads, orders)}</span>
                            <span class="stat-change neutral">{format!("{} audit", audit)}</span>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h2>{tr.health_tables}</h2></div>
                        <table class="data-table">
                            <thead><tr><th>"Table"</th><th>"Size"</th></tr></thead>
                            <tbody>
                                {tables.into_iter().map(|t| {
                                    let name = t["table"].as_str().unwrap_or("?").to_string();
                                    let size = t["size"].as_str().unwrap_or("?").to_string();
                                    view! { <tr><td class="cell-primary">{name}</td><td class="cell-mono">{size}</td></tr> }
                                }).collect::<Vec<_>>()}
                            </tbody>
                        </table>
                    </div>
                }.into_any()
            }}
        </div>
    }
}
