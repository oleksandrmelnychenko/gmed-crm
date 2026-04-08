use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
struct Policy {
    role: String,
    field_name: String,
    access_level: String,
    condition_type: Option<String>,
    is_system_locked: bool,
}

#[derive(Serialize)]
struct UpdatePolicy {
    role: String,
    entity_type: String,
    field_name: String,
    access_level: String,
    condition_type: Option<String>,
}

const ENTITIES: &[&str] = &["patient"];

const ROLE_KEYS: &[&str] = &[
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
    "sales",
    "patient",
];

fn role_col_label(tr: &crate::i18n::Translations, role: &str) -> &'static str {
    match role {
        "patient_manager" => tr.role_patient_manager,
        "teamlead_interpreter" => tr.role_teamlead_interpreter,
        "interpreter" => tr.role_interpreter,
        "concierge" => tr.role_concierge,
        "billing" => tr.role_billing,
        "sales" => tr.role_sales,
        "patient" => tr.role_patient,
        _ => "—",
    }
}

const ACCESS_CYCLE: &[&str] = &["full", "masked", "hidden", "conditional"];

fn access_icon(level: &str) -> &'static str {
    match level {
        "full" => "✅",
        "masked" => "👁",
        "hidden" => "❌",
        "conditional" => "⚡",
        _ => "?",
    }
}

fn access_css(level: &str, locked: bool) -> &'static str {
    if locked {
        return "access-cell access-locked";
    }
    match level {
        "full" => "access-cell access-full",
        "masked" => "access-cell access-masked",
        "hidden" => "access-cell access-hidden",
        "conditional" => "access-cell access-conditional",
        _ => "access-cell",
    }
}

fn next_access_level(current: &str) -> &'static str {
    let mut idx = 0;
    for (i, level) in ACCESS_CYCLE.iter().enumerate() {
        if *level == current {
            idx = i;
            break;
        }
    }
    ACCESS_CYCLE[(idx + 1) % ACCESS_CYCLE.len()]
}

#[component]
pub fn AdminAccess() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (selected_entity, set_selected_entity) = signal("patient".to_string());
    let (policies, set_policies) = signal(Vec::<Policy>::new());
    let (loading, set_loading) = signal(true);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        set_loading.set(true);
        let entity = selected_entity.get();
        wasm_bindgen_futures::spawn_local(async move {
            let url = format!("/access-policies?entity_type={entity}");
            match client::get::<Vec<Policy>>(&url).await {
                Ok(p) => {
                    set_policies.set(p);
                    set_loading.set(false);
                }
                Err(e) => {
                    let _ = format!("Failed to load policies: {e}");
                    set_loading.set(false);
                }
            }
        });
    });

    let on_cell_click = move |role: String, field: String| {
        let current_policies = policies.get();
        let mut found_idx = None;
        for (i, p) in current_policies.iter().enumerate() {
            if p.role == role && p.field_name == field {
                if p.is_system_locked {
                    return;
                }
                found_idx = Some(i);
                break;
            }
        }

        let Some(idx) = found_idx else {
            return;
        };
        let old_level = current_policies[idx].access_level.clone();
        let new_level = next_access_level(&old_level).to_string();
        let entity = selected_entity.get();
        let condition = if new_level == "conditional" {
            Some("freigegeben".to_string())
        } else {
            None
        };

        let mut updated = current_policies.clone();
        updated[idx].access_level = new_level.clone();
        updated[idx].condition_type = condition.clone();
        set_policies.set(updated);

        let update = UpdatePolicy {
            role: role.clone(),
            entity_type: entity,
            field_name: field.clone(),
            access_level: new_level,
            condition_type: condition,
        };

        wasm_bindgen_futures::spawn_local(async move {
            if client::post::<UpdatePolicy, serde_json::Value>("/access-policies/update", &update)
                .await
                .is_err()
            {
                set_reload_nonce.update(|value| *value += 1);
            }
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).access_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).access_subtitle}</p>
                </div>
            </div>

            <div class="card" style="margin-bottom: 24px;">
                <div class="card-header" style="display: flex; align-items: center; gap: 16px;">
                    <h2>{move || i18n::t(lang.get()).access_entity}</h2>
                    <div class="entity-tabs">
                        {ENTITIES.iter().map(|entity| {
                            let e = entity.to_string();
                            let e2 = entity.to_string();
                            view! {
                                <button
                                    class=move || if selected_entity.get() == e { "entity-tab active" } else { "entity-tab" }
                                    on:click=move |_| set_selected_entity.set(e2.clone())
                                >{*entity}</button>
                            }
                        }).collect::<Vec<_>>()}
                    </div>
                </div>
            </div>

            {move || {
                let tr = i18n::t(lang.get());

                if loading.get() {
                    return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any();
                }

                let all_policies = policies.get();

                let mut fields = Vec::<String>::new();
                for p in &all_policies {
                    if !fields.contains(&p.field_name) {
                        fields.push(p.field_name.clone());
                    }
                }
                fields.sort();

                view! {
                    <div class="card">
                        <div class="access-matrix-wrapper">
                            <table class="access-matrix">
                                <thead>
                                    <tr>
                                        <th class="field-col">{tr.access_field}</th>
                                        {ROLE_KEYS.iter().map(|role_key| {
                                            let label = role_col_label(tr, role_key);
                                            view! { <th class="role-col">{label}</th> }
                                        }).collect::<Vec<_>>()}
                                    </tr>
                                </thead>
                                <tbody>
                                    {fields.iter().map(|field| {
                                        let field_clone = field.clone();
                                        let field_label = tr.field_label(field).to_string();
                                        view! {
                                            <tr>
                                                <td class="field-name">{field_label}</td>
                                                {ROLE_KEYS.iter().map(|role_key| {
                                                    let mut level = "hidden";
                                                    let mut locked = false;
                                                    for p in &all_policies {
                                                        if p.role == *role_key && p.field_name == field_clone {
                                                            level = match p.access_level.as_str() {
                                                                "full" => "full",
                                                                "masked" => "masked",
                                                                "hidden" => "hidden",
                                                                "conditional" => "conditional",
                                                                _ => "hidden",
                                                            };
                                                            locked = p.is_system_locked;
                                                            break;
                                                        }
                                                    }
                                                    let css = access_css(level, locked);
                                                    let icon = if locked { "🔒" } else { access_icon(level) };
                                                    let role_str = role_key.to_string();
                                                    let field_str = field_clone.clone();
                                                    view! {
                                                        <td class=css
                                                            on:click=move |_| {
                                                                if !locked {
                                                                    on_cell_click(role_str.clone(), field_str.clone());
                                                                }
                                                            }
                                                        >{icon}</td>
                                                    }
                                                }).collect::<Vec<_>>()}
                                            </tr>
                                        }
                                    }).collect::<Vec<_>>()}
                                </tbody>
                            </table>
                        </div>

                        <div class="access-legend">
                            <span class="legend-item"><span class="access-full">"✅"</span>{format!(" {}", tr.access_full)}</span>
                            <span class="legend-item"><span class="access-masked">"👁"</span>{format!(" {}", tr.access_masked)}</span>
                            <span class="legend-item"><span class="access-hidden">"❌"</span>{format!(" {}", tr.access_hidden)}</span>
                            <span class="legend-item"><span class="access-conditional">"⚡"</span>{format!(" {}", tr.access_conditional)}</span>
                            <span class="legend-item"><span class="access-locked">"🔒"</span>{format!(" {}", tr.access_system_locked)}</span>
                        </div>
                    </div>
                }.into_any()
            }}
        </div>
    }
}
