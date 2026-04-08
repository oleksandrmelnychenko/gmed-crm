use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct SettingRow {
    key: String,
    value: String,
    description: Option<String>,
    updated_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct SessionRow {
    family_id: String,
    user_id: String,
    user_name: String,
    user_email: String,
    role: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    created_at: String,
    last_activity_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct PendingLogin {
    id: String,
    user_name: String,
    user_email: String,
    role: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    device_info: Option<serde_json::Value>,
    created_at: String,
}

#[derive(Serialize)]
struct UpdateReq {
    value: String,
}

fn setting_label(lang: Lang, key: &str) -> &'static str {
    let tr = i18n::t(lang);
    match key {
        "access_token_minutes" => tr.settings_access_token_min,
        "refresh_token_days" => tr.settings_refresh_token_days,
        "max_sessions_per_user" => tr.settings_max_sessions,
        "session_idle_days" => tr.settings_idle_days,
        _ => "—",
    }
}

fn compact_dt(value: &str) -> String {
    value.split('T').next().unwrap_or(value).to_string()
}

fn short_ua(ua: &Option<String>) -> String {
    match ua {
        Some(s) if s.len() > 60 => format!("{}…", &s[..60]),
        Some(s) => s.clone(),
        None => "—".into(),
    }
}

#[component]
pub fn AdminSettings() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();

    let (settings, set_settings) = signal(Vec::<SettingRow>::new());
    let (sessions, set_sessions) = signal(Vec::<SessionRow>::new());
    let (pending, set_pending) = signal(Vec::<PendingLogin>::new());
    let (loading, set_loading) = signal(true);
    let (reload, set_reload) = signal(0_u32);
    let (msg, set_msg) = signal(Option::<String>::None);

    // Editable values per setting key
    let (edit_values, set_edit_values) = signal(std::collections::HashMap::<String, String>::new());

    Effect::new(move |_| {
        let _ = reload.get();
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            let s = client::get::<Vec<SettingRow>>("/admin/settings")
                .await
                .unwrap_or_default();
            let mut map = std::collections::HashMap::new();
            for row in &s {
                map.insert(row.key.clone(), row.value.trim_matches('"').to_string());
            }
            set_edit_values.set(map);
            set_settings.set(s);

            let sess = client::get::<Vec<SessionRow>>("/admin/sessions")
                .await
                .unwrap_or_default();
            set_sessions.set(sess);

            set_pending.set(
                client::get::<Vec<PendingLogin>>("/admin/mfa/pending")
                    .await
                    .unwrap_or_default(),
            );
            set_loading.set(false);
        });
    });

    let approve_pending = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/mfa/pending/{id}/approve")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let reject_pending = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/mfa/pending/{id}/reject")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let save_setting = move |key: String| {
        let vals = edit_values.get();
        let Some(value) = vals.get(&key).cloned() else {
            return;
        };
        set_msg.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<UpdateReq, serde_json::Value>(
                &format!("/admin/settings/{key}"),
                &UpdateReq { value },
            )
            .await
            {
                Ok(_) => {
                    set_msg.set(Some(i18n::t(lang.get()).settings_updated.to_string()));
                    set_reload.update(|v| *v += 1);
                }
                Err(e) => set_msg.set(Some(e)),
            }
        });
    };

    let logout_user = move |user_id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/sessions/user/{user_id}/revoke")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let logout_all = move |_: web_sys::MouseEvent| {
        let confirmed = web_sys::window()
            .and_then(|w| {
                w.confirm_with_message(i18n::t(lang.get()).settings_logout_all_confirm)
                    .ok()
            })
            .unwrap_or(false);
        if !confirmed {
            return;
        }
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body("/admin/sessions/revoke-all").await;
            set_reload.update(|v| *v += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).settings_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).settings_subtitle}</p>
                </div>
            </div>

            {move || msg.get().map(|m| view! { <div class="form-error" style="background:var(--success-bg);border-color:var(--success-border);color:var(--success);margin-bottom:16px">{m}</div> })}

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }

                let settings_list = settings.get();
                let sessions_list = sessions.get();

                view! {
                    // ── Token configuration ──
                    <div class="card" style="margin-bottom:24px">
                        <div class="card-header"><h2>{tr.settings_token_config}</h2></div>
                        <div class="create-form">
                            {settings_list.into_iter().map(|row| {
                                let key = row.key.clone();
                                let key_save = key.clone();
                                let key_input = key.clone();
                                let label = setting_label(lang.get(), &key);
                                let desc = row.description.unwrap_or_default();
                                view! {
                                    <div class="form-row" style="align-items:flex-end">
                                        <div class="form-field" style="flex:2">
                                            <label>{label}</label>
                                            <div class="page-subtitle" style="margin-bottom:4px;margin-top:0">{desc}</div>
                                            <input type="number" min="1"
                                                prop:value=move || edit_values.get().get(&key_input).cloned().unwrap_or_default()
                                                on:input=move |ev| {
                                                    let val = event_target_value(&ev);
                                                    set_edit_values.update(|map| { map.insert(key.clone(), val); });
                                                }
                                            />
                                        </div>
                                        <div class="form-field" style="flex:0 0 auto">
                                            <button class="btn-primary" type="button" style="height:32px"
                                                on:click=move |_| save_setting(key_save.clone())>
                                                {tr.common_save}
                                            </button>
                                        </div>
                                    </div>
                                }
                            }).collect::<Vec<_>>()}
                        </div>
                    </div>

                    // ── MFA pending logins ──
                    {let pending_list = pending.get(); if !pending_list.is_empty() {
                        view! {
                            <div class="card" style="margin-bottom:24px">
                                <div class="card-header"><h2>{format!("{} ({})", tr.mfa_pending_logins, pending_list.len())}</h2></div>
                                <table class="data-table">
                                    <thead><tr>
                                        <th>{tr.field_name}</th><th>{tr.field_email}</th>
                                        <th>{tr.common_ip}</th><th>{tr.activity_time}</th><th>{tr.users_actions}</th>
                                    </tr></thead>
                                    <tbody>
                                        {pending_list.into_iter().map(|p| {
                                            let id_a = p.id.clone();
                                            let id_r = p.id.clone();
                                            let dt = compact_dt(&p.created_at);
                                            view! {
                                                <tr>
                                                    <td class="cell-primary">{p.user_name}</td>
                                                    <td class="cell-mono cell-dim">{p.user_email}</td>
                                                    <td class="cell-mono">{p.ip_address.unwrap_or_default()}</td>
                                                    <td class="cell-mono cell-dim">{dt}</td>
                                                    <td class="action-cell">
                                                        <button class="btn-small" style="color:var(--success)" on:click=move |_| approve_pending(id_a.clone())>{tr.mfa_approve}</button>
                                                        <button class="btn-small" style="color:var(--error)" on:click=move |_| reject_pending(id_r.clone())>{tr.mfa_reject}</button>
                                                    </td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            </div>
                        }.into_any()
                    } else { view! { <div></div> }.into_any() }}

                    // ── Active sessions ──
                    <div class="card">
                        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                            <h2>{format!("{} ({})", tr.settings_active_sessions, sessions_list.len())}</h2>
                            <button class="btn-primary" style="background:var(--error);border-color:var(--error)"
                                on:click=logout_all>
                                {tr.settings_logout_all}
                            </button>
                        </div>
                        {if sessions_list.is_empty() {
                            view! { <div class="empty-state">{tr.settings_no_sessions}</div> }.into_any()
                        } else {
                            view! {
                                <table class="data-table">
                                    <thead><tr>
                                        <th>{tr.field_name}</th>
                                        <th>{tr.field_email}</th>
                                        <th>{tr.users_role}</th>
                                        <th>{tr.common_ip}</th>
                                        <th>{tr.settings_last_active}</th>
                                        <th>{tr.users_actions}</th>
                                    </tr></thead>
                                    <tbody>
                                        {sessions_list.into_iter().map(|s| {
                                            let user_id = s.user_id.clone();
                                            let ua = short_ua(&s.user_agent);
                                            view! {
                                                <tr>
                                                    <td class="cell-primary">{s.user_name}</td>
                                                    <td class="cell-mono cell-dim">{s.user_email}</td>
                                                    <td><span class="tag tag--blue">{s.role}</span></td>
                                                    <td class="cell-mono cell-dim" title=ua>{s.ip_address.unwrap_or_default()}</td>
                                                    <td class="cell-mono">{compact_dt(&s.last_activity_at)}</td>
                                                    <td>
                                                        <button class="btn-small" style="color:var(--error)"
                                                            on:click=move |_| logout_user(user_id.clone())>
                                                            {tr.settings_logout_user}
                                                        </button>
                                                    </td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            }.into_any()
                        }}
                    </div>
                }.into_any()
            }}
        </div>
    }
}
