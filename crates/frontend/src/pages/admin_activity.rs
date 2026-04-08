use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Clone, Debug)]
struct ActivityRow {
    user_name: String,
    user_email: String,
    action: String,
    entity_type: Option<String>,
    entity_id: Option<Value>,
    context: Option<Value>,
    created_at: String,
}

fn action_tag(action: &str) -> &'static str {
    match action {
        "login" => "tag tag--green",
        "revoke_all_sessions" | "admin_force_logout_user" | "revoke_all_users_sessions" => {
            "tag tag--red"
        }
        "token_theft_detected" => "tag tag--red",
        "create_lead" | "create_patient" | "convert_lead" => "tag tag--blue",
        "qualify_lead" => "tag tag--amber",
        "update_setting" => "tag tag--purple",
        _ => "tag tag--gray",
    }
}

fn action_label(action: &str) -> String {
    action.replace('_', " ")
}

fn compact_dt(dt: &str) -> String {
    dt.replace('T', " ").chars().take(19).collect()
}

fn context_summary(ctx: &Option<Value>) -> String {
    match ctx {
        Some(Value::Object(map)) => {
            let parts: Vec<String> = map
                .iter()
                .take(3)
                .map(|(k, v)| {
                    let val = match v {
                        Value::String(s) => s.clone(),
                        Value::Null => "null".into(),
                        other => other.to_string(),
                    };
                    format!("{k}: {val}")
                })
                .collect();
            parts.join(", ")
        }
        Some(v) => v.to_string(),
        None => "—".into(),
    }
}

fn initials(name: &str) -> String {
    name.split_whitespace()
        .take(2)
        .filter_map(|w| w.chars().next())
        .map(|c| c.to_uppercase().to_string())
        .collect()
}

#[component]
pub fn AdminActivity() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (activities, set_activities) = signal(Vec::<ActivityRow>::new());
    let (loading, set_loading) = signal(true);
    let (filter_action, set_filter_action) = signal(String::new());
    let (search, set_search) = signal(String::new());

    Effect::new(move |_| {
        set_loading.set(true);
        let action = filter_action.get();
        let mut url = "/admin/activity?limit=300".to_string();
        if !action.is_empty() {
            url.push_str(&format!("&action={action}"));
        }
        wasm_bindgen_futures::spawn_local(async move {
            let data = client::get::<Vec<ActivityRow>>(&url)
                .await
                .unwrap_or_default();
            set_activities.set(data);
            set_loading.set(false);
        });
    });

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).activity_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).activity_subtitle}</p>
                </div>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() {
                    return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any();
                }

                let search_val = search.get().to_lowercase();
                let list: Vec<ActivityRow> = activities.get().into_iter().filter(|a| {
                    if search_val.is_empty() { return true; }
                    a.user_name.to_lowercase().contains(&search_val)
                        || a.user_email.to_lowercase().contains(&search_val)
                        || a.action.to_lowercase().contains(&search_val)
                        || a.entity_type.as_deref().unwrap_or("").to_lowercase().contains(&search_val)
                }).collect();

                // Unique actions for filter dropdown
                let all = activities.get();
                let mut actions: Vec<String> = all.iter().map(|a| a.action.clone()).collect();
                actions.sort();
                actions.dedup();

                view! {
                    <div class="card">
                        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                            <h2>{format!("{} ({})", tr.activity_title, list.len())}</h2>
                            <div style="display:flex;gap:8px;align-items:center">
                                <input
                                    class="search-input"
                                    type="text"
                                    placeholder=tr.search_placeholder
                                    prop:value=search
                                    on:input=move |ev| set_search.set(event_target_value(&ev))
                                    style="max-width:220px;height:32px"
                                />
                                <select
                                    class="search-input"
                                    style="max-width:200px;height:32px"
                                    prop:value=filter_action
                                    on:change=move |ev| set_filter_action.set(event_target_value(&ev))
                                >
                                    <option value="">{tr.providers_all}</option>
                                    {actions.into_iter().map(|a| {
                                        let label = action_label(&a);
                                        view! { <option value={a}>{label}</option> }
                                    }).collect::<Vec<_>>()}
                                </select>
                            </div>
                        </div>
                        <table class="data-table">
                            <thead><tr>
                                <th>{tr.activity_time}</th>
                                <th>{tr.activity_user}</th>
                                <th>{tr.activity_action}</th>
                                <th>{tr.activity_entity}</th>
                                <th>{tr.activity_details}</th>
                            </tr></thead>
                            <tbody>
                                {list.into_iter().map(|a| {
                                    let cls = action_tag(&a.action);
                                    let label = action_label(&a.action);
                                    let entity = a.entity_type.clone().unwrap_or_default();
                                    let entity_id_str = match &a.entity_id {
                                        Some(Value::String(s)) => s.chars().take(8).collect::<String>(),
                                        Some(v) if !v.is_null() => v.to_string().chars().take(8).collect(),
                                        _ => String::new(),
                                    };
                                    let entity_display = if entity_id_str.is_empty() {
                                        entity.clone()
                                    } else {
                                        format!("{entity} {entity_id_str}…")
                                    };
                                    let details = context_summary(&a.context);
                                    let avatar = initials(&a.user_name);
                                    let time = compact_dt(&a.created_at);
                                    view! {
                                        <tr>
                                            <td class="cell-mono cell-dim" style="white-space:nowrap">{time}</td>
                                            <td>
                                                <div style="display:flex;align-items:center;gap:8px">
                                                    <div class="avatar" style="width:24px;height:24px;font-size:10px">{avatar}</div>
                                                    <div>
                                                        <div class="cell-primary" style="font-size:13px">{a.user_name}</div>
                                                        <div class="cell-dim" style="font-size:11px">{a.user_email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td><span class=cls>{label}</span></td>
                                            <td class="cell-mono cell-dim">{entity_display}</td>
                                            <td class="cell-dim" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={details.clone()}>{details.clone()}</td>
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
