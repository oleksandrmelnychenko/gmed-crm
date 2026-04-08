use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct CustomField {
    id: String,
    entity_type: String,
    field_key: String,
    field_label: String,
    field_type: String,
    options: Option<Value>,
    is_required: bool,
    sort_order: i32,
    is_active: bool,
}

#[derive(Serialize)]
struct UpsertField {
    entity_type: String,
    field_key: String,
    field_label: String,
    field_type: Option<String>,
    options: Option<Value>,
    is_required: Option<bool>,
    sort_order: Option<i32>,
}

#[component]
pub fn AdminCustomFields() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (fields, set_fields) = signal(Vec::<CustomField>::new());
    let (loading, set_loading) = signal(true);
    let (reload, set_reload) = signal(0_u32);
    let (show_form, set_show_form) = signal(false);
    let (filter_entity, set_filter_entity) = signal(String::new());

    let (f_entity, set_f_entity) = signal("lead".to_string());
    let (f_key, set_f_key) = signal(String::new());
    let (f_label, set_f_label) = signal(String::new());
    let (f_type, set_f_type) = signal("text".to_string());
    let (f_required, _set_f_required) = signal(false);
    let (f_sort, set_f_sort) = signal("0".to_string());
    let (f_options, set_f_options) = signal(String::new());
    let (msg, set_msg) = signal(Option::<String>::None);

    Effect::new(move |_| {
        let _ = reload.get();
        set_loading.set(true);
        let entity = filter_entity.get();
        let url = if entity.is_empty() {
            "/admin/custom-fields".to_string()
        } else {
            format!("/admin/custom-fields?entity_type={entity}")
        };
        wasm_bindgen_futures::spawn_local(async move {
            set_fields.set(
                client::get::<Vec<CustomField>>(&url)
                    .await
                    .unwrap_or_default(),
            );
            set_loading.set(false);
        });
    });

    let create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_msg.set(None);
        let opts: Option<Value> = if f_options.get().trim().is_empty() {
            None
        } else {
            serde_json::from_str(&f_options.get()).ok()
        };
        let body = UpsertField {
            entity_type: f_entity.get(),
            field_key: f_key.get(),
            field_label: f_label.get(),
            field_type: Some(f_type.get()),
            options: opts,
            is_required: Some(f_required.get()),
            sort_order: f_sort.get().parse().ok(),
        };
        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<UpsertField, Value>("/admin/custom-fields", &body).await {
                Ok(_) => {
                    set_show_form.set(false);
                    set_f_key.set(String::new());
                    set_f_label.set(String::new());
                    set_reload.update(|v| *v += 1);
                }
                Err(e) => set_msg.set(Some(e)),
            }
        });
    };

    let delete = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/custom-fields/{id}/delete")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).cf_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).cf_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_form.set(!show_form.get())>
                    "+ " {move || i18n::t(lang.get()).cf_new}
                </button>
            </div>

            {move || msg.get().map(|m| view! { <div class="form-error" style="margin-bottom:16px">{m}</div> })}

            {move || {
                let tr = i18n::t(lang.get());
                if show_form.get() {
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header"><h2>{tr.cf_new}</h2></div>
                            <form class="create-form" on:submit=create>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.cf_entity_type}</label>
                                        <select prop:value=f_entity on:change=move |ev| set_f_entity.set(event_target_value(&ev))>
                                            <option value="lead">"Lead"</option>
                                            <option value="patient">"Patient"</option>
                                            <option value="order">"Order"</option>
                                            <option value="provider">"Provider"</option>
                                        </select>
                                    </div>
                                    <div class="form-field"><label>{tr.cf_field_key}" *"</label><input type="text" required placeholder="my_field" prop:value=f_key on:input=move |ev| set_f_key.set(event_target_value(&ev)) /></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.cf_field_label}" *"</label><input type="text" required prop:value=f_label on:input=move |ev| set_f_label.set(event_target_value(&ev)) /></div>
                                    <div class="form-field">
                                        <label>{tr.cf_field_type}</label>
                                        <select prop:value=f_type on:change=move |ev| set_f_type.set(event_target_value(&ev))>
                                            <option value="text">"Text"</option>
                                            <option value="number">"Number"</option>
                                            <option value="date">"Date"</option>
                                            <option value="boolean">"Boolean"</option>
                                            <option value="select">"Select"</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.cf_sort}</label><input type="number" prop:value=f_sort on:input=move |ev| set_f_sort.set(event_target_value(&ev)) /></div>
                                    <div class="form-field"><label>{tr.cf_options}</label><input type="text" placeholder=r#"["opt1","opt2"]"# prop:value=f_options on:input=move |ev| set_f_options.set(event_target_value(&ev)) /></div>
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
                let list = fields.get();
                view! {
                    <div class="card">
                        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                            <h2>{format!("{} ({})", tr.cf_title, list.len())}</h2>
                            <select class="search-input" style="max-width:160px;height:32px"
                                prop:value=filter_entity on:change=move |ev| set_filter_entity.set(event_target_value(&ev))>
                                <option value="">{tr.providers_all}</option>
                                <option value="lead">"Lead"</option>
                                <option value="patient">"Patient"</option>
                                <option value="order">"Order"</option>
                                <option value="provider">"Provider"</option>
                            </select>
                        </div>
                        {if list.is_empty() {
                            view! { <div class="empty-state">{tr.cf_no_fields}</div> }.into_any()
                        } else {
                            view! {
                                <table class="data-table">
                                    <thead><tr><th>{tr.cf_entity_type}</th><th>{tr.cf_field_key}</th><th>{tr.cf_field_label}</th><th>{tr.cf_field_type}</th><th>{tr.cf_required}</th><th>{tr.users_actions}</th></tr></thead>
                                    <tbody>
                                        {list.into_iter().filter(|f| f.is_active).map(|f| {
                                            let id = f.id.clone();
                                            view! {
                                                <tr>
                                                    <td><span class="tag tag--blue">{f.entity_type}</span></td>
                                                    <td class="cell-mono">{f.field_key}</td>
                                                    <td class="cell-primary">{f.field_label}</td>
                                                    <td><span class="tag tag--gray">{f.field_type}</span></td>
                                                    <td>{if f.is_required { "✓" } else { "" }}</td>
                                                    <td><button class="btn-small" style="color:var(--error)" on:click=move |_| delete(id.clone())>{tr.common_delete}</button></td>
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
