use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Clone, Debug, Default)]
struct ConsentDashboard {
    total: i64,
    granted_active: i64,
    revoked: i64,
    by_type: Vec<ConsentType>,
    recent_changes: Vec<ConsentChange>,
}

#[derive(Deserialize, Clone, Debug)]
struct ConsentType {
    consent_type: String,
    total: i64,
    active: i64,
}

#[derive(Deserialize, Clone, Debug)]
struct ConsentChange {
    user_name: String,
    consent_type: String,
    granted: bool,
    granted_at: Option<String>,
    revoked_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct ExpiredConsent {
    user_name: String,
    consent_type: String,
    granted_at: Option<String>,
}

fn compact_dt(dt: &Option<String>) -> String {
    match dt {
        Some(s) => s.split('T').next().unwrap_or(s).to_string(),
        None => "—".into(),
    }
}

#[component]
pub fn AdminCompliance() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (dashboard, set_dashboard) = signal(ConsentDashboard::default());
    let (expired, set_expired) = signal(Vec::<ExpiredConsent>::new());
    let (loading, set_loading) = signal(true);
    let (export_id, set_export_id) = signal(String::new());
    let (export_result, set_export_result) = signal(Option::<String>::None);
    let (anon_id, set_anon_id) = signal(String::new());

    Effect::new(move |_| {
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            set_dashboard.set(
                client::get::<ConsentDashboard>("/admin/compliance/consents")
                    .await
                    .unwrap_or_default(),
            );
            set_expired.set(
                client::get::<Vec<ExpiredConsent>>("/admin/compliance/consents/expired")
                    .await
                    .unwrap_or_default(),
            );
            set_loading.set(false);
        });
    });

    let do_export = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let pid = export_id.get();
        if pid.trim().is_empty() {
            return;
        }
        set_export_result.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Value>(&format!("/admin/compliance/patient/{pid}/export")).await {
                Ok(data) => {
                    let json = serde_json::to_string_pretty(&data).unwrap_or_default();
                    set_export_result.set(Some(json));
                }
                Err(e) => set_export_result.set(Some(format!("Error: {e}"))),
            }
        });
    };

    let do_anonymize = move |_: web_sys::MouseEvent| {
        let pid = anon_id.get();
        if pid.trim().is_empty() {
            return;
        }
        let confirmed = web_sys::window()
            .and_then(|w| {
                w.confirm_with_message(i18n::t(lang.get()).compliance_anonymize_confirm)
                    .ok()
            })
            .unwrap_or(false);
        if !confirmed {
            return;
        }
        wasm_bindgen_futures::spawn_local(async move {
            match client::post_no_body(&format!("/admin/compliance/patient/{pid}/anonymize")).await
            {
                Ok(_) => set_export_result.set(Some("OK".to_string())),
                Err(e) => set_export_result.set(Some(format!("Error: {e}"))),
            }
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).compliance_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).compliance_subtitle}</p>
                </div>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }

                let d = dashboard.get();
                let exp = expired.get();

                view! {
                    <div class="stats-grid" style="margin-bottom:24px">
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.compliance_consents}</span></div>
                            <span class="stat-value">{d.total}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.compliance_granted}</span></div>
                            <span class="stat-value">{d.granted_active}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.compliance_revoked}</span></div>
                            <span class="stat-value">{d.revoked}</span>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header"><span class="stat-label">{tr.compliance_expired}</span></div>
                            <span class="stat-value">{exp.len()}</span>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
                        <div class="card">
                            <div class="card-header"><h2>{tr.compliance_export}</h2></div>
                            <form class="create-form" on:submit=do_export>
                                <div class="form-row" style="align-items:flex-end">
                                    <div class="form-field" style="flex:2">
                                        <label>{tr.compliance_patient_id}" (UUID)"</label>
                                        <input type="text" required placeholder="xxxxxxxx-xxxx-..." prop:value=export_id on:input=move |ev| set_export_id.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field" style="flex:0 0 auto">
                                        <button type="submit" class="btn-primary">{tr.compliance_export}</button>
                                    </div>
                                </div>
                            </form>
                            {move || export_result.get().map(|r| view! {
                                <pre style="padding:12px 24px;font-size:12px;max-height:300px;overflow:auto;background:var(--bg-layout);margin:0">{r}</pre>
                            })}
                        </div>
                        <div class="card">
                            <div class="card-header"><h2>{tr.compliance_anonymize}</h2></div>
                            <div class="create-form">
                                <div class="form-row" style="align-items:flex-end">
                                    <div class="form-field" style="flex:2">
                                        <label>{tr.compliance_patient_id}" (UUID)"</label>
                                        <input type="text" required placeholder="xxxxxxxx-xxxx-..." prop:value=anon_id on:input=move |ev| set_anon_id.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field" style="flex:0 0 auto">
                                        <button type="button" class="btn-primary" style="background:var(--error);border-color:var(--error)" on:click=do_anonymize>{tr.compliance_anonymize}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {if !d.by_type.is_empty() {
                        view! {
                            <div class="card" style="margin-bottom:24px">
                                <div class="card-header"><h2>{tr.compliance_consents}</h2></div>
                                <table class="data-table">
                                    <thead><tr><th>"Type"</th><th>"Total"</th><th>{tr.compliance_granted}</th></tr></thead>
                                    <tbody>
                                        {d.by_type.into_iter().map(|ct| view! {
                                            <tr>
                                                <td class="cell-primary">{ct.consent_type}</td>
                                                <td class="cell-mono">{ct.total}</td>
                                                <td><span class="tag tag--green">{ct.active}</span></td>
                                            </tr>
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            </div>
                        }.into_any()
                    } else { view! { <div></div> }.into_any() }}

                    <div class="card" style="margin-bottom:24px">
                        <div class="card-header"><h2>{format!("{} ({})", tr.compliance_expired_consents, exp.len())}</h2></div>
                        {if exp.is_empty() {
                            view! { <div class="empty-state">{tr.compliance_no_expired}</div> }.into_any()
                        } else {
                            view! {
                                <table class="data-table">
                                    <thead><tr><th>{tr.activity_user}</th><th>"Type"</th><th>{tr.activity_time}</th></tr></thead>
                                    <tbody>
                                        {exp.into_iter().map(|e| view! {
                                            <tr>
                                                <td class="cell-primary">{e.user_name}</td>
                                                <td>{e.consent_type}</td>
                                                <td class="cell-mono cell-dim">{compact_dt(&e.granted_at)}</td>
                                            </tr>
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            }.into_any()
                        }}
                    </div>

                    {if !d.recent_changes.is_empty() {
                        view! {
                            <div class="card">
                                <div class="card-header"><h2>{tr.compliance_recent}</h2></div>
                                <table class="data-table">
                                    <thead><tr><th>{tr.activity_user}</th><th>"Type"</th><th>{tr.users_status}</th><th>{tr.activity_time}</th></tr></thead>
                                    <tbody>
                                        {d.recent_changes.into_iter().map(|c| {
                                            let (cls, lbl) = if c.revoked_at.is_some() { ("tag tag--red", tr.compliance_revoked) } else if c.granted { ("tag tag--green", tr.compliance_granted) } else { ("tag tag--gray", "—") };
                                            let dt = if c.revoked_at.is_some() { compact_dt(&c.revoked_at) } else { compact_dt(&c.granted_at) };
                                            view! {
                                                <tr>
                                                    <td class="cell-primary">{c.user_name}</td>
                                                    <td>{c.consent_type}</td>
                                                    <td><span class=cls>{lbl}</span></td>
                                                    <td class="cell-mono cell-dim">{dt}</td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            </div>
                        }.into_any()
                    } else { view! { <div></div> }.into_any() }}
                }.into_any()
            }}
        </div>
    }
}
