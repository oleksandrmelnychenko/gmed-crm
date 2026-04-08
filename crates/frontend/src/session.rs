use crate::api::auth::UserInfo;
use crate::api::{auth, client};
use leptos::prelude::*;

#[derive(Clone, Copy)]
pub struct CurrentUserContext {
    pub user: ReadSignal<Option<UserInfo>>,
    pub loading: ReadSignal<bool>,
}

pub fn provide_current_user() -> CurrentUserContext {
    let (user, set_user) = signal::<Option<UserInfo>>(None);
    let (loading, set_loading) = signal(true);
    let (bootstrapped, set_bootstrapped) = signal(false);

    Effect::new(move |_| {
        if bootstrapped.get() {
            return;
        }
        set_bootstrapped.set(true);

        if !client::is_logged_in() {
            set_loading.set(false);
            return;
        }

        wasm_bindgen_futures::spawn_local(async move {
            match auth::get_me().await {
                Ok(me) => set_user.set(Some(me)),
                Err(_) => {
                    client::clear_tokens();
                    if let Some(window) = web_sys::window() {
                        let _ = window.location().set_href("/login");
                    }
                }
            }
            set_loading.set(false);
        });
    });

    let ctx = CurrentUserContext { user, loading };
    provide_context(ctx);
    ctx
}

pub fn role_display_name(role: &str) -> &'static str {
    match role {
        "ceo" => "CEO",
        "ceo_assistant" => "CEO Assistant",
        "patient_manager" => "Patient Manager",
        "teamlead_interpreter" => "Teamlead Interpreter",
        "interpreter" => "Interpreter",
        "concierge" => "Concierge",
        "billing" => "Billing",
        "sales" => "Sales",
        "it_admin" => "IT Admin",
        "patient" => "Patient",
        _ => "Unknown",
    }
}

pub fn can_access_admin(role: &str) -> bool {
    matches!(role, "ceo" | "it_admin")
}

pub fn can_access_appointments(role: &str) -> bool {
    matches!(
        role,
        "ceo" | "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
    )
}
