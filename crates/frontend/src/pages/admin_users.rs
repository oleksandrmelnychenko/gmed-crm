use crate::api::client;
use crate::i18n::{self, Lang, Translations};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
struct User {
    id: String,
    email: String,
    name: String,
    role: String,
    is_active: bool,
    created_at: String,
}

#[derive(Serialize)]
struct CreateUserBody {
    email: String,
    name: String,
    password: String,
    role: String,
}

fn role_label<'a>(tr: &'a Translations, role: &'a str) -> &'a str {
    match role {
        "ceo" => tr.role_ceo,
        "ceo_assistant" => tr.role_ceo_assistant,
        "patient_manager" => tr.role_patient_manager,
        "teamlead_interpreter" => tr.role_teamlead_interpreter,
        "interpreter" => tr.role_interpreter,
        "concierge" => tr.role_concierge,
        "billing" => tr.role_billing,
        "sales" => tr.role_sales,
        "it_admin" => tr.role_it_admin,
        "patient" => tr.role_patient,
        _ => role,
    }
}

fn role_tag_class(role: &str) -> &'static str {
    match role {
        "ceo" => "tag tag--purple",
        "ceo_assistant" => "tag tag--purple",
        "patient_manager" => "tag tag--blue",
        "teamlead_interpreter" => "tag tag--cyan",
        "interpreter" => "tag tag--cyan",
        "concierge" => "tag tag--teal",
        "billing" => "tag tag--amber",
        "sales" => "tag tag--amber",
        "it_admin" => "tag tag--gray",
        "patient" => "tag tag--green",
        _ => "tag tag--gray",
    }
}

const ROLE_KEYS: &[&str] = &[
    "ceo",
    "ceo_assistant",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
    "sales",
    "it_admin",
    "patient",
];

#[component]
pub fn AdminUsers() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (users, set_users) = signal(Vec::<User>::new());
    let (loading, set_loading) = signal(true);
    let (error, set_error) = signal(Option::<String>::None);
    let (show_create, set_show_create) = signal(false);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);

    let (new_email, set_new_email) = signal(String::new());
    let (new_name, set_new_name) = signal(String::new());
    let (new_password, set_new_password) = signal(String::new());
    let (new_role, set_new_role) = signal("patient_manager".to_string());
    let (create_error, set_create_error) = signal(Option::<String>::None);
    let (creating, set_creating) = signal(false);

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        set_loading.set(true);
        set_error.set(None);
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<User>>("/users").await {
                Ok(u) => {
                    set_users.set(u);
                    set_loading.set(false);
                }
                Err(e) => {
                    set_error.set(Some(e));
                    set_loading.set(false);
                }
            }
        });
    });

    let on_create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_create_error.set(None);
        set_creating.set(true);

        let body = CreateUserBody {
            email: new_email.get(),
            name: new_name.get(),
            password: new_password.get(),
            role: new_role.get(),
        };

        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreateUserBody, User>("/users", &body).await {
                Ok(_) => {
                    set_show_create.set(false);
                    set_new_email.set(String::new());
                    set_new_name.set(String::new());
                    set_new_password.set(String::new());
                    set_new_role.set("patient_manager".to_string());
                    set_creating.set(false);
                    set_reload_nonce.update(|value| *value += 1);
                }
                Err(e) => {
                    set_create_error.set(Some(e));
                    set_creating.set(false);
                }
            }
        });
    };

    let (editing_user, set_editing_user) = signal(Option::<User>::None);
    let (eu_name, set_eu_name) = signal(String::new());
    let (eu_email, set_eu_email) = signal(String::new());
    let (eu_role, set_eu_role) = signal(String::new());
    let (eu_password, set_eu_password) = signal(String::new());
    let (eu_saving, set_eu_saving) = signal(false);

    let open_edit_user = move |u: User| {
        set_eu_name.set(u.name.clone());
        set_eu_email.set(u.email.clone());
        set_eu_role.set(u.role.clone());
        set_eu_password.set(String::new());
        set_editing_user.set(Some(u));
    };

    let save_user = move |id: String| {
        set_eu_saving.set(true);
        #[derive(Serialize)]
        struct UpdateUser {
            name: Option<String>,
            email: Option<String>,
            role: Option<String>,
        }
        let body = UpdateUser {
            name: Some(eu_name.get()),
            email: Some(eu_email.get()),
            role: Some(eu_role.get()),
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<UpdateUser, serde_json::Value>(
                &format!("/users/{id}/update"),
                &body,
            )
            .await;
            set_editing_user.set(None);
            set_eu_saving.set(false);
            set_reload_nonce.update(|v| *v += 1);
        });
    };

    let reset_pw = move |id: String| {
        let pw = eu_password.get();
        if pw.len() < 8 {
            return;
        }
        #[derive(Serialize)]
        struct ResetPw {
            new_password: String,
        }
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<ResetPw, serde_json::Value>(
                &format!("/users/{id}/reset-password"),
                &ResetPw { new_password: pw },
            )
            .await;
            set_eu_password.set(String::new());
        });
    };

    let toggle_active = move |user_id: String, currently_active: bool| {
        let path = if currently_active {
            format!("/users/{user_id}/deactivate")
        } else {
            format!("/users/{user_id}/activate")
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&path).await;
            set_reload_nonce.update(|value| *value += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).users_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).users_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_create.set(!show_create.get())>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    {move || i18n::t(lang.get()).users_new}
                </button>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if show_create.get() {
                    view! {
                        <div class="card" style="margin-bottom: 24px;">
                            <div class="card-header"><h2>{tr.users_create_title}</h2></div>
                            <form class="create-form" on:submit=on_create>
                                {move || {
                                    if let Some(err) = create_error.get() {
                                        view! { <div class="form-error">{err}</div> }.into_any()
                                    } else {
                                        view! { <div></div> }.into_any()
                                    }
                                }}
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.users_name}</label>
                                        <input type="text" placeholder="Max Müller" required
                                            prop:value=new_name
                                            on:input=move |ev| set_new_name.set(event_target_value(&ev))
                                        />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.users_email}</label>
                                        <input type="email" placeholder="max@gmed.de" required
                                            prop:value=new_email
                                            on:input=move |ev| set_new_email.set(event_target_value(&ev))
                                        />
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.users_password}</label>
                                        <input type="password" placeholder=tr.users_password_hint required minlength="8"
                                            prop:value=new_password
                                            on:input=move |ev| set_new_password.set(event_target_value(&ev))
                                        />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.users_role}</label>
                                        <select
                                            prop:value=new_role
                                            on:change=move |ev| set_new_role.set(event_target_value(&ev))
                                        >
                                            {ROLE_KEYS.iter().map(|key| {
                                                let label = role_label(tr, key);
                                                view! { <option value=*key>{label}</option> }
                                            }).collect::<Vec<_>>()}
                                        </select>
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-primary" disabled=creating>
                                        {move || if creating.get() { i18n::t(lang.get()).users_creating } else { i18n::t(lang.get()).users_create_btn }}
                                    </button>
                                    <button type="button" class="btn-secondary" on:click=move |_| set_show_create.set(false)>
                                        {tr.users_cancel}
                                    </button>
                                </div>
                            </form>
                        </div>
                    }.into_any()
                } else {
                    view! { <div></div> }.into_any()
                }
            }}

            {move || {
                let tr = i18n::t(lang.get());
                if let Some(u) = editing_user.get() {
                    let uid = u.id.clone();
                    let uid3 = u.id.clone();
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                                <h2>{format!("{} — {}", tr.patients_edit, u.email)}</h2>
                                <button class="btn-secondary" on:click=move |_| set_editing_user.set(None)>"✕"</button>
                            </div>
                            <div class="create-form">
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.users_name}</label><input type="text" prop:value=eu_name on:input=move |ev| set_eu_name.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.users_email}</label><input type="email" prop:value=eu_email on:input=move |ev| set_eu_email.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.users_role}</label>
                                        <select prop:value=eu_role on:change=move |ev| set_eu_role.set(event_target_value(&ev))>
                                            {ROLE_KEYS.iter().map(|key| {
                                                let label = role_label(tr, key);
                                                view! { <option value=*key>{label}</option> }
                                            }).collect::<Vec<_>>()}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.users_password}" (reset)"</label>
                                        <div style="display:flex;gap:8px">
                                            <input type="password" placeholder=tr.users_password_hint prop:value=eu_password on:input=move |ev| set_eu_password.set(event_target_value(&ev))/>
                                            <button type="button" class="btn-small" on:click=move |_| reset_pw(uid3.clone())>"Reset"</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button class="btn-primary" disabled=eu_saving on:click=move |_| save_user(uid.clone())>
                                        {move || if eu_saving.get() { "..." } else { tr.common_save }}
                                    </button>
                                    <button class="btn-secondary" on:click=move |_| set_editing_user.set(None)>{tr.common_cancel}</button>
                                </div>
                            </div>
                        </div>
                    }.into_any()
                } else {
                    view! { <div></div> }.into_any()
                }
            }}

            {move || {
                let tr = i18n::t(lang.get());
                if let Some(err) = error.get() {
                    view! { <div class="page-error">{err}</div> }.into_any()
                } else if loading.get() {
                    view! { <div class="page-loading">{tr.common_loading}</div> }.into_any()
                } else {
                    let user_list = users.get();
                    let count = user_list.len();
                    view! {
                        <div class="card">
                            <div class="card-header">
                                <h2>{format!("{count} {}", tr.users_count)}</h2>
                            </div>
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>{tr.users_name}</th>
                                        <th>{tr.users_email}</th>
                                        <th>{tr.users_role}</th>
                                        <th>{tr.users_status}</th>
                                        <th>{tr.users_created}</th>
                                        <th>{tr.users_actions}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {user_list.into_iter().map(|user| {
                                        let u_clone = user.clone();
                                        let User { id, email, name, role, is_active, created_at, .. } = user;
                                        let tag_class = role_tag_class(&role);
                                        let label = role_label(tr, &role).to_string();
                                        let status_class = if is_active { "tag tag--green" } else { "tag tag--red" };
                                        let status_text = if is_active { tr.users_active } else { tr.users_inactive };
                                        let date = created_at.split('T').next().unwrap_or(&created_at).to_string();
                                        let action_text = if is_active { tr.users_deactivate } else { tr.users_activate };
                                        let id_toggle = id.clone();
                                        view! {
                                            <tr>
                                                <td class="cell-primary">{name}</td>
                                                <td class="cell-mono cell-dim">{email}</td>
                                                <td><span class=tag_class>{label}</span></td>
                                                <td><span class=status_class>{status_text}</span></td>
                                                <td class="cell-dim">{date}</td>
                                                <td class="action-cell">
                                                    <button class="btn-small" on:click=move |_| open_edit_user(u_clone.clone())>{tr.patients_edit}</button>
                                                    <button class="btn-small" on:click=move |_| toggle_active(id_toggle.clone(), is_active)>{action_text}</button>
                                                </td>
                                            </tr>
                                        }
                                    }).collect::<Vec<_>>()}
                                </tbody>
                            </table>
                        </div>
                    }.into_any()
                }
            }}
        </div>
    }
}
