use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Announcement {
    id: String,
    title: String,
    message: String,
    variant: String,
    is_active: bool,
    starts_at: String,
    ends_at: Option<String>,
    created_at: String,
    creator: String,
}

#[derive(Serialize)]
struct UpsertAnn {
    title: String,
    message: String,
    variant: Option<String>,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
}

fn variant_tag(v: &str) -> &'static str {
    match v {
        "info" => "tag tag--blue",
        "warning" => "tag tag--amber",
        "error" => "tag tag--red",
        "success" => "tag tag--green",
        _ => "tag tag--gray",
    }
}

fn compact_dt(dt: &str) -> String {
    dt.split('T').next().unwrap_or(dt).to_string()
}

#[component]
pub fn AdminAnnouncements() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (items, set_items) = signal(Vec::<Announcement>::new());
    let (loading, set_loading) = signal(true);
    let (reload, set_reload) = signal(0_u32);
    let (show_form, set_show_form) = signal(false);

    let (f_title, set_f_title) = signal(String::new());
    let (f_msg, set_f_msg) = signal(String::new());
    let (f_variant, set_f_variant) = signal("info".to_string());
    let (f_ends, set_f_ends) = signal(String::new());

    Effect::new(move |_| {
        let _ = reload.get();
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            set_items.set(
                client::get::<Vec<Announcement>>("/admin/announcements")
                    .await
                    .unwrap_or_default(),
            );
            set_loading.set(false);
        });
    });

    let create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let ends = {
            let e = f_ends.get();
            if e.trim().is_empty() { None } else { Some(e) }
        };
        let body = UpsertAnn {
            title: f_title.get(),
            message: f_msg.get(),
            variant: Some(f_variant.get()),
            is_active: Some(true),
            starts_at: None,
            ends_at: ends,
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<UpsertAnn, Value>("/admin/announcements", &body).await;
            set_show_form.set(false);
            set_f_title.set(String::new());
            set_f_msg.set(String::new());
            set_reload.update(|v| *v += 1);
        });
    };

    let delete = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/announcements/{id}/delete")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).ann_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).ann_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_form.set(!show_form.get())>
                    "+ " {move || i18n::t(lang.get()).ann_new}
                </button>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if show_form.get() {
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header"><h2>{tr.ann_new}</h2></div>
                            <form class="create-form" on:submit=create>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_name}" *"</label><input type="text" required prop:value=f_title on:input=move |ev| set_f_title.set(event_target_value(&ev)) /></div>
                                    <div class="form-field">
                                        <label>{tr.ann_variant}</label>
                                        <select prop:value=f_variant on:change=move |ev| set_f_variant.set(event_target_value(&ev))>
                                            <option value="info">{tr.ann_info}</option>
                                            <option value="warning">{tr.ann_warning}</option>
                                            <option value="error">{tr.common_error}</option>
                                            <option value="success">"Success"</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-field"><label>{tr.ann_message}" *"</label><input type="text" required prop:value=f_msg on:input=move |ev| set_f_msg.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{tr.ann_ends}</label><input type="datetime-local" prop:value=f_ends on:input=move |ev| set_f_ends.set(event_target_value(&ev)) /></div>
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
                let list = items.get();
                if list.is_empty() { return view! { <div class="card"><div class="empty-state">{tr.ann_no_announcements}</div></div> }.into_any(); }
                view! {
                    <div class="card">
                        <div class="card-header"><h2>{format!("{} ({})", tr.ann_title, list.len())}</h2></div>
                        <table class="data-table">
                            <thead><tr><th>{tr.field_name}</th><th>{tr.ann_message}</th><th>{tr.ann_variant}</th><th>{tr.users_status}</th><th>{tr.ann_starts}</th><th>{tr.ann_ends}</th><th>{tr.users_actions}</th></tr></thead>
                            <tbody>
                                {list.into_iter().map(|a| {
                                    let id = a.id.clone();
                                    let vcls = variant_tag(&a.variant);
                                    let status = if a.is_active { "tag tag--green" } else { "tag tag--gray" };
                                    let stxt = if a.is_active { tr.ann_active } else { tr.providers_inactive };
                                    let starts = compact_dt(&a.starts_at);
                                    let ends = a.ends_at.as_deref().map(compact_dt).unwrap_or_else(|| "—".into());
                                    view! {
                                        <tr>
                                            <td class="cell-primary">{a.title}</td>
                                            <td class="cell-dim" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{a.message}</td>
                                            <td><span class=vcls>{a.variant}</span></td>
                                            <td><span class=status>{stxt}</span></td>
                                            <td class="cell-mono cell-dim">{starts}</td>
                                            <td class="cell-mono cell-dim">{ends}</td>
                                            <td><button class="btn-small" style="color:var(--error)" on:click=move |_| delete(id.clone())>{tr.common_delete}</button></td>
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
