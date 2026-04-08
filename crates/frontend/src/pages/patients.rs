use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, role_display_name};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Patient {
    id: String,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: String,
    gender: String,
    nationality: Option<String>,
    languages: Vec<String>,
    phone_primary: Option<String>,
    email: Option<String>,
    insurance_type: Option<String>,
    is_active: bool,
}

#[derive(Serialize)]
struct CreatePatient {
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: String,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Option<Vec<String>>,
    phone_primary: Option<String>,
    email: Option<String>,
    insurance_type: Option<String>,
}

#[derive(Serialize)]
struct UpdatePatient {
    first_name: Option<String>,
    last_name: Option<String>,
    phone_primary: Option<String>,
    email: Option<String>,
    nationality: Option<String>,
    languages: Option<Vec<String>>,
    insurance_type: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct PatientAssignment {
    user_id: String,
    user_name: String,
    user_role: String,
    user_active: bool,
    assigned_by_name: Option<String>,
    assigned_at: String,
    revoked_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct AssignableUser {
    id: String,
    name: String,
    role: String,
    is_active: bool,
}

#[derive(Serialize)]
struct AssignPatient {
    user_id: String,
}

fn gender_label(tr: &crate::i18n::Translations, g: &str) -> &'static str {
    match g {
        "male" => tr.gender_male,
        "female" => tr.gender_female,
        "diverse" => tr.gender_diverse,
        _ => "—",
    }
}

fn insurance_label(tr: &crate::i18n::Translations, t: &str) -> &'static str {
    match t {
        "private" => tr.insurance_private,
        "public" => tr.insurance_public,
        "self_pay" => tr.insurance_self_pay,
        "foreign" => tr.insurance_foreign,
        _ => "—",
    }
}

fn can_manage_patient_assignments(role: Option<&str>) -> bool {
    matches!(
        role,
        Some("ceo") | Some("patient_manager") | Some("teamlead_interpreter")
    )
}

fn can_assign_target(manager_role: Option<&str>, target_role: &str) -> bool {
    match manager_role {
        Some("ceo") => matches!(
            target_role,
            "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
        ),
        Some("patient_manager") => {
            matches!(
                target_role,
                "teamlead_interpreter" | "interpreter" | "concierge"
            )
        }
        Some("teamlead_interpreter") => target_role == "interpreter",
        _ => false,
    }
}

#[component]
pub fn Patients() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();
    let (patients, set_patients) = signal(Vec::<Patient>::new());
    let (loading, set_loading) = signal(true);
    let (search, set_search) = signal(String::new());
    let (show_create, set_show_create) = signal(false);
    let (reload_nonce, set_reload_nonce) = signal(0_u32);
    let (editing, set_editing) = signal(Option::<Patient>::None);
    let (edit_first, set_edit_first) = signal(String::new());
    let (edit_last, set_edit_last) = signal(String::new());
    let (edit_phone, set_edit_phone) = signal(String::new());
    let (edit_email, set_edit_email) = signal(String::new());
    let (edit_nat, set_edit_nat) = signal(String::new());
    let (edit_langs, set_edit_langs) = signal(String::new());
    let (edit_insurance, set_edit_insurance) = signal(String::new());
    let (saving, set_saving) = signal(false);
    let (assignments, set_assignments) = signal(Vec::<PatientAssignment>::new());
    let (assignable_users, set_assignable_users) = signal(Vec::<AssignableUser>::new());
    let (selected_assignee, set_selected_assignee) = signal(String::new());
    let (assign_busy, set_assign_busy) = signal(false);

    let open_edit = move |p: Patient| {
        set_edit_first.set(p.first_name.clone());
        set_edit_last.set(p.last_name.clone());
        set_edit_phone.set(p.phone_primary.clone().unwrap_or_default());
        set_edit_email.set(p.email.clone().unwrap_or_default());
        set_edit_nat.set(p.nationality.clone().unwrap_or_default());
        set_edit_langs.set(p.languages.join(", "));
        set_edit_insurance.set(p.insurance_type.clone().unwrap_or_default());
        let patient_id = p.id.clone();
        set_editing.set(Some(p));

        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<PatientAssignment>>(&format!(
                "/patients/{patient_id}/assignments"
            ))
            .await
            {
                Ok(items) => set_assignments.set(items),
                Err(_) => set_assignments.set(Vec::new()),
            }
        });

        if can_manage_patient_assignments(
            current_user
                .user
                .get()
                .as_ref()
                .map(|user| user.role.as_str()),
        ) {
            wasm_bindgen_futures::spawn_local(async move {
                match client::get::<Vec<AssignableUser>>(
                    "/users?assignable_only=true&active_only=true",
                )
                .await
                {
                    Ok(items) => set_assignable_users.set(items),
                    Err(_) => set_assignable_users.set(Vec::new()),
                }
            });
        }
    };

    let save_edit = move |id: String| {
        set_saving.set(true);
        let langs_str = edit_langs.get();
        let langs: Vec<String> = if langs_str.is_empty() {
            vec![]
        } else {
            langs_str.split(',').map(|s| s.trim().to_string()).collect()
        };
        let body = UpdatePatient {
            first_name: Some(edit_first.get()),
            last_name: Some(edit_last.get()),
            phone_primary: {
                let v = edit_phone.get();
                if v.is_empty() { None } else { Some(v) }
            },
            email: {
                let v = edit_email.get();
                if v.is_empty() { None } else { Some(v) }
            },
            nationality: {
                let v = edit_nat.get();
                if v.is_empty() { None } else { Some(v) }
            },
            languages: Some(langs),
            insurance_type: {
                let v = edit_insurance.get();
                if v.is_empty() { None } else { Some(v) }
            },
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<UpdatePatient, serde_json::Value>(
                &format!("/patients/{id}/update"),
                &body,
            )
            .await;
            set_editing.set(None);
            set_saving.set(false);
            set_reload_nonce.update(|v| *v += 1);
        });
    };

    let assign_patient = move |patient_id: String| {
        let user_id = selected_assignee.get();
        if user_id.trim().is_empty() {
            return;
        }

        set_assign_busy.set(true);
        let body = AssignPatient { user_id };
        wasm_bindgen_futures::spawn_local(async move {
            if client::post::<AssignPatient, serde_json::Value>(
                &format!("/patients/{patient_id}/assign"),
                &body,
            )
            .await
            .is_ok()
            {
                set_selected_assignee.set(String::new());
                match client::get::<Vec<PatientAssignment>>(&format!(
                    "/patients/{patient_id}/assignments"
                ))
                .await
                {
                    Ok(items) => set_assignments.set(items),
                    Err(_) => set_assignments.set(Vec::new()),
                }
            }
            set_assign_busy.set(false);
        });
    };

    let (f_title, set_f_title) = signal(String::new());
    let (f_first, set_f_first) = signal(String::new());
    let (f_last, set_f_last) = signal(String::new());
    let (f_birth, set_f_birth) = signal(String::new());
    let (f_gender, set_f_gender) = signal("male".to_string());
    let (f_nat, set_f_nat) = signal(String::new());
    let (f_phone, set_f_phone) = signal(String::new());
    let (f_email, set_f_email) = signal(String::new());
    let (f_insurance, set_f_insurance) = signal(String::new());
    let (f_langs, set_f_langs) = signal(String::new());
    let (creating, set_creating) = signal(false);
    let (create_error, set_create_error) = signal(Option::<String>::None);

    Effect::new(move |_| {
        let _ = reload_nonce.get();
        set_loading.set(true);
        let s = search.get();
        let url = if s.is_empty() {
            "/patients".to_string()
        } else {
            format!("/patients?search={s}")
        };
        wasm_bindgen_futures::spawn_local(async move {
            match client::get::<Vec<Patient>>(&url).await {
                Ok(p) => {
                    set_patients.set(p);
                    set_loading.set(false);
                }
                Err(_) => {
                    set_loading.set(false);
                }
            }
        });
    });

    let on_search = move |ev: web_sys::Event| {
        set_search.set(event_target_value(&ev));
    };

    let on_create = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_create_error.set(None);
        set_creating.set(true);

        let langs_str = f_langs.get();
        let langs: Vec<String> = if langs_str.is_empty() {
            vec![]
        } else {
            langs_str.split(',').map(|s| s.trim().to_string()).collect()
        };

        let body = CreatePatient {
            title: {
                let t = f_title.get();
                if t.is_empty() { None } else { Some(t) }
            },
            first_name: f_first.get(),
            last_name: f_last.get(),
            birth_date: f_birth.get(),
            gender: f_gender.get(),
            nationality: {
                let n = f_nat.get();
                if n.is_empty() { None } else { Some(n) }
            },
            residence_country: None,
            languages: Some(langs),
            phone_primary: {
                let p = f_phone.get();
                if p.is_empty() { None } else { Some(p) }
            },
            email: {
                let e = f_email.get();
                if e.is_empty() { None } else { Some(e) }
            },
            insurance_type: {
                let i = f_insurance.get();
                if i.is_empty() { None } else { Some(i) }
            },
        };

        wasm_bindgen_futures::spawn_local(async move {
            match client::post::<CreatePatient, serde_json::Value>("/patients", &body).await {
                Ok(_) => {
                    set_show_create.set(false);
                    set_f_first.set(String::new());
                    set_f_last.set(String::new());
                    set_f_birth.set(String::new());
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

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).patients_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).patients_subtitle}</p>
                </div>
                <button class="btn-primary" on:click=move |_| set_show_create.set(!show_create.get())>
                    "+"
                    {move || i18n::t(lang.get()).patients_new}
                </button>
            </div>

            <div class="search-bar" style="margin-bottom: 16px;">
                <input type="text" class="search-input" placeholder="Поиск по имени или ID..."
                    prop:value=search
                    on:input=on_search
                />
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if show_create.get() {
                    view! {
                        <div class="card" style="margin-bottom: 24px;">
                            <div class="card-header"><h2>{tr.patients_new}</h2></div>
                            <form class="create-form" on:submit=on_create>
                                {move || create_error.get().map(|e| view! { <div class="form-error">{e}</div> })}
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_name} " *"</label>
                                        <input type="text" required prop:value=f_first on:input=move |ev| set_f_first.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.patients_last_name} " *"</label>
                                        <input type="text" required prop:value=f_last on:input=move |ev| set_f_last.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_birth_date} " *"</label>
                                        <input type="date" required prop:value=f_birth on:input=move |ev| set_f_birth.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.patients_gender} " *"</label>
                                        <select prop:value=f_gender on:change=move |ev| set_f_gender.set(event_target_value(&ev))>
                                            <option value="male">{tr.gender_male}</option>
                                            <option value="female">{tr.gender_female}</option>
                                            <option value="diverse">{tr.gender_diverse}</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_nationality}</label>
                                        <input type="text" prop:value=f_nat on:input=move |ev| set_f_nat.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.field_languages} " (en, de, ru)"</label>
                                        <input type="text" prop:value=f_langs on:input=move |ev| set_f_langs.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_phone}</label>
                                        <input type="tel" prop:value=f_phone on:input=move |ev| set_f_phone.set(event_target_value(&ev)) />
                                    </div>
                                    <div class="form-field">
                                        <label>{tr.field_email}</label>
                                        <input type="email" prop:value=f_email on:input=move |ev| set_f_email.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_insurance}</label>
                                        <select prop:value=f_insurance on:change=move |ev| set_f_insurance.set(event_target_value(&ev))>
                                            <option value="">""</option>
                                            <option value="private">{tr.insurance_private}</option>
                                            <option value="public">{tr.insurance_public}</option>
                                            <option value="self_pay">{tr.insurance_self_pay}</option>
                                            <option value="foreign">{tr.insurance_foreign}</option>
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label>"Titel"</label>
                                        <input type="text" prop:value=f_title on:input=move |ev| set_f_title.set(event_target_value(&ev)) />
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-primary" disabled=creating>
                                        {move || if creating.get() { "..." } else { tr.patients_create }}
                                    </button>
                                    <button type="button" class="btn-secondary" on:click=move |_| set_show_create.set(false)>
                                        {tr.common_cancel}
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
                if let Some(p) = editing.get() {
                    let pid = p.id.clone();
                    let assign_pid = p.id.clone();
                    let _pid2 = p.id.clone();
                    view! {
                        <div class="card" style="margin-bottom:24px">
                            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                                <h2>{format!("{} — {}", tr.patients_edit, p.patient_id)}</h2>
                                <button class="btn-secondary" on:click=move |_| set_editing.set(None)>"✕"</button>
                            </div>
                            <div class="create-form">
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_name}</label><input type="text" prop:value=edit_first on:input=move |ev| set_edit_first.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.patients_last_name}</label><input type="text" prop:value=edit_last on:input=move |ev| set_edit_last.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_phone}</label><input type="tel" prop:value=edit_phone on:input=move |ev| set_edit_phone.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.field_email}</label><input type="email" prop:value=edit_email on:input=move |ev| set_edit_email.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field"><label>{tr.field_nationality}</label><input type="text" prop:value=edit_nat on:input=move |ev| set_edit_nat.set(event_target_value(&ev))/></div>
                                    <div class="form-field"><label>{tr.field_languages}</label><input type="text" prop:value=edit_langs on:input=move |ev| set_edit_langs.set(event_target_value(&ev))/></div>
                                </div>
                                <div class="form-row">
                                    <div class="form-field">
                                        <label>{tr.field_insurance}</label>
                                        <select prop:value=edit_insurance on:change=move |ev| set_edit_insurance.set(event_target_value(&ev))>
                                            <option value="">""</option>
                                            <option value="private">{tr.insurance_private}</option>
                                            <option value="public">{tr.insurance_public}</option>
                                            <option value="self_pay">{tr.insurance_self_pay}</option>
                                            <option value="foreign">{tr.insurance_foreign}</option>
                                        </select>
                                    </div>
                                    <div class="form-field"></div>
                                </div>
                                <div class="card" style="margin-top: 8px;">
                                    <div class="card-header">
                                        <h2>"Assignments"</h2>
                                    </div>
                                    <div class="appointments-checklist-list">
                                        {move || {
                                            let items = assignments.get();
                                            if items.is_empty() {
                                                view! { <div class="provider-subline">"No assignments yet."</div> }.into_any()
                                            } else {
                                                view! {
                                                    <>
                                                        {items.into_iter().map(|item| {
                                                            let assigned_by = item.assigned_by_name.unwrap_or_else(|| "System".to_string());
                                                            let status_class = if item.revoked_at.is_some() { "tag tag--gray" } else if item.user_active { "tag tag--green" } else { "tag tag--red" };
                                                            let status_text = if item.revoked_at.is_some() { "revoked" } else if item.user_active { "active" } else { "inactive" };
                                                            view! {
                                                                <div class="appointments-checklist-item">
                                                                    <div>
                                                                        <div>{item.user_name}</div>
                                                                        <div class="provider-subline">{role_display_name(&item.user_role)} " • " {item.assigned_at}</div>
                                                                        <div class="provider-subline">"Assigned by " {assigned_by}</div>
                                                                    </div>
                                                                    <div class="provider-inline-actions">
                                                                        <span class=status_class>{status_text}</span>
                                                                    </div>
                                                                </div>
                                                            }
                                                        }).collect::<Vec<_>>()}
                                                    </>
                                                }.into_any()
                                            }
                                        }}
                                    </div>

                                    {let assign_pid2 = assign_pid.clone(); move || {
                                        let current_role = current_user.user.get().map(|user| user.role).unwrap_or_default();
                                        if can_manage_patient_assignments(Some(current_role.as_str())) {
                                            let assign_target_patient_id = assign_pid2.clone();
                                            view! {
                                                <div class="appointments-nested-form" style="margin-top: 12px;">
                                                    <div class="form-row">
                                                        <div class="form-field">
                                                            <label>"Assign to"</label>
                                                            <select prop:value=selected_assignee on:change=move |ev| set_selected_assignee.set(event_target_value(&ev))>
                                                                <option value="">"Select user"</option>
                                                                {move || {
                                                                    let manager_role = current_user.user.get().map(|user| user.role).unwrap_or_default();
                                                                    assignable_users.get().into_iter().filter(|item| item.is_active && can_assign_target(Some(manager_role.as_str()), &item.role)).map(|item| {
                                                                        view! { <option value=item.id>{format!("{} ({})", item.name, role_display_name(&item.role))}</option> }
                                                                    }).collect::<Vec<_>>()
                                                                }}
                                                            </select>
                                                        </div>
                                                        <div class="form-field" style="align-self: end;">
                                                            <button
                                                                class="btn-primary"
                                                                disabled=move || assign_busy.get() || selected_assignee.get().trim().is_empty()
                                                                on:click=move |_| assign_patient(assign_target_patient_id.clone())
                                                            >
                                                                {move || if assign_busy.get() { "..." } else { "Assign" }}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            }.into_any()
                                        } else {
                                            view! { <div></div> }.into_any()
                                        }
                                    }}
                                </div>
                                <div class="form-actions">
                                    <button class="btn-primary" disabled=saving on:click=move |_| save_edit(pid.clone())>
                                        {move || if saving.get() { "..." } else { tr.common_save }}
                                    </button>
                                    <button class="btn-secondary" on:click=move |_| set_editing.set(None)>{tr.common_cancel}</button>
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
                if loading.get() {
                    return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any();
                }
                let list = patients.get();
                let count = list.len();
                view! {
                    <div class="card">
                        <div class="card-header"><h2>{format!("{count} {}", tr.patients_title)}</h2></div>
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>"ID"</th>
                                    <th>{tr.field_name}</th>
                                    <th>{tr.field_birth_date}</th>
                                    <th>{tr.patients_gender}</th>
                                    <th>{tr.field_nationality}</th>
                                    <th>{tr.field_languages}</th>
                                    <th>{tr.field_phone}</th>
                                    <th>{tr.field_insurance}</th>
                                    <th>{tr.users_actions}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.into_iter().map(|p| {
                                    let p_clone = p.clone();
                                    let Patient { patient_id, title, first_name, last_name, birth_date, gender, nationality, languages, phone_primary, insurance_type, .. } = p;
                                    let full_name = match title {
                                        Some(t) => format!("{t} {first_name} {last_name}"),
                                        None => format!("{first_name} {last_name}"),
                                    };
                                    let gender_text = gender_label(tr, &gender).to_string();
                                    let nat = nationality.unwrap_or_default();
                                    let langs = languages.join(", ");
                                    let phone = phone_primary.unwrap_or_default();
                                    let ins = insurance_type.map(|t| insurance_label(tr, &t).to_string()).unwrap_or_default();
                                    view! {
                                        <tr>
                                            <td class="cell-mono">{patient_id}</td>
                                            <td class="cell-primary">{full_name}</td>
                                            <td>{birth_date}</td>
                                            <td>{gender_text}</td>
                                            <td>{nat}</td>
                                            <td>{langs}</td>
                                            <td class="cell-mono">{phone}</td>
                                            <td>{ins}</td>
                                            <td><button class="btn-small" on:click=move |_| open_edit(p_clone.clone())>{tr.patients_edit}</button></td>
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
