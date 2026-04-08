use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Clone, Debug)]
struct Channel {
    id: String,
    channel_type: String,
    name: String,
    config: Value,
    is_active: bool,
}

#[derive(Serialize)]
struct UpsertChannel {
    channel_type: String,
    name: String,
    config: Value,
    is_active: Option<bool>,
}

fn compact_config(cfg: &Value) -> String {
    match cfg {
        Value::Object(m) => m
            .iter()
            .take(3)
            .map(|(k, v)| {
                let val = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                format!("{k}: {val}")
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => cfg.to_string(),
    }
}

#[component]
pub fn AdminNotifications() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (channels, set_channels) = signal(Vec::<Channel>::new());
    let (loading, set_loading) = signal(true);
    let (reload, set_reload) = signal(0_u32);
    let (f_name, set_f_name) = signal(String::new());
    let (f_type, set_f_type) = signal("smtp".to_string());
    let (f_config, set_f_config) = signal(String::new());
    let (show_form, set_show_form) = signal(false);
    let (msg, set_msg) = signal(Option::<String>::None);

    Effect::new(move |_| {
        let _ = reload.get();
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            set_channels.set(
                client::get::<Vec<Channel>>("/admin/notifications")
                    .await
                    .unwrap_or_default(),
            );
            set_loading.set(false);
        });
    });

    let create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let config: Value =
            serde_json::from_str(&f_config.get()).unwrap_or(Value::Object(serde_json::Map::new()));
        let body = UpsertChannel {
            channel_type: f_type.get(),
            name: f_name.get(),
            config,
            is_active: Some(true),
        };
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<UpsertChannel, Value>("/admin/notifications", &body).await {
                Ok(_) => {
                    set_show_form.set(false);
                    set_f_name.set(String::new());
                    set_f_config.set(String::new());
                    set_reload.update(|v| *v += 1);
                }
                Err(e) => set_msg.set(Some(e)),
            }
        });
    };

    let delete = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/notifications/{id}/delete")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let test = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            match client::post_no_body(&format!("/admin/notifications/{id}/test")).await {
                Ok(_) => set_msg.set(Some("OK".into())),
                Err(e) => set_msg.set(Some(e)),
            }
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).notif_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).notif_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_form.set(!show_form.get())>
                    "+ " {move || i18n::t(lang.get()).notif_new}
                </button>
            </div>

            {move || msg.get().map(|m| view! { <div class="form-error" style="margin-bottom:16px">{m}</div> })}

            {move || {
                let tr = i18n::t(lang.get());
                if show_form.get() {
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header"><h2>{tr.notif_new}</h2></div>
                            <form class="create-form" on:submit=create>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.notif_name}" *"</label><input type="text" required prop:value=f_name on:input=move |ev| set_f_name.set(event_target_value(&ev)) /></div>
                                    <div class="form-field">
                                        <label>{tr.notif_type}</label>
                                        <select prop:value=f_type on:change=move |ev| set_f_type.set(event_target_value(&ev))>
                                            <option value="smtp">{tr.notif_smtp}</option>
                                            <option value="webhook">{tr.notif_webhook}</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-field">
                                    <label>{tr.notif_config}</label>
                                    <input type="text" prop:value=f_config on:input=move |ev| set_f_config.set(event_target_value(&ev))
                                        placeholder=r#"{"host":"smtp.example.com","port":587,"user":"..."}"# />
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-primary">{tr.common_save}</button>
                                    <button type="button" class="btn-secondary" on:click=move |_| set_show_form.set(false)>{tr.common_cancel}</button>
                                </div>
                            </form>
                        </div>
                    }.into_any()
                } else { view! { <div></div> }.into_any() }
            }}

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }
                let list = channels.get();
                if list.is_empty() { return view! { <div class="card"><div class="empty-state">{tr.notif_no_channels}</div></div> }.into_any(); }
                view! {
                    <div class="card">
                        <div class="card-header"><h2>{format!("{} ({})", tr.notif_title, list.len())}</h2></div>
                        <table class="data-table">
                            <thead><tr><th>{tr.notif_name}</th><th>{tr.notif_type}</th><th>{tr.notif_config}</th><th>{tr.users_status}</th><th>{tr.users_actions}</th></tr></thead>
                            <tbody>
                                {list.into_iter().map(|ch| {
                                    let id_d = ch.id.clone();
                                    let id_t = ch.id.clone();
                                    let cfg = compact_config(&ch.config);
                                    let status = if ch.is_active { "tag tag--green" } else { "tag tag--gray" };
                                    let status_txt = if ch.is_active { tr.providers_active } else { tr.providers_inactive };
                                    view! {
                                        <tr>
                                            <td class="cell-primary">{ch.name}</td>
                                            <td><span class="tag tag--blue">{ch.channel_type}</span></td>
                                            <td class="cell-mono cell-dim" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{cfg}</td>
                                            <td><span class=status>{status_txt}</span></td>
                                            <td class="action-cell">
                                                <button class="btn-small" on:click=move |_| test(id_t.clone())>{tr.notif_test}</button>
                                                <button class="btn-small" style="color:var(--error)" on:click=move |_| delete(id_d.clone())>{tr.common_delete}</button>
                                            </td>
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
