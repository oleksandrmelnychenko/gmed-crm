use crate::api;
use crate::i18n::{self, Lang};
use leptos::prelude::*;

#[component]
pub fn Login() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let set_lang = use_context::<WriteSignal<Lang>>().unwrap();
    let (email, set_email) = signal("admin@gmed.de".to_string());
    let (password, set_password) = signal("admin123".to_string());
    let (error, set_error) = signal(Option::<String>::None);
    let (loading, set_loading) = signal(false);

    let on_submit = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        set_error.set(None);
        set_loading.set(true);

        let email = email.get();
        let password = password.get();

        wasm_bindgen_futures::spawn_local(async move {
            match api::auth::login(&email, &password).await {
                Ok(_) => {
                    let window = web_sys::window().unwrap();
                    let _ = window.location().set_href("/");
                }
                Err(e) => {
                    set_error.set(Some(e));
                    set_loading.set(false);
                }
            }
        });
    };

    let toggle_lang = move |_| {
        let new = match lang.get() {
            Lang::De => Lang::Ru,
            Lang::Ru => Lang::De,
        };
        i18n::switch_lang(set_lang, new);
    };

    view! {
        <div class="login-page">
            <div class="login-card">
                <div class="login-header">
                    <div class="login-logo">
                        <svg width="24" height="24" viewBox="0 0 76 65" fill="none">
                            <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor"/>
                        </svg>
                    </div>
                    <h1>{move || i18n::t(lang.get()).app_name}</h1>
                    <p class="login-subtitle">{move || i18n::t(lang.get()).app_subtitle}</p>
                </div>

                <form on:submit=on_submit>
                    {move || {
                        if let Some(err) = error.get() {
                            view! { <div class="login-error">{err}</div> }.into_any()
                        } else {
                            view! { <div></div> }.into_any()
                        }
                    }}

                    <div class="form-field">
                        <label for="email">{move || i18n::t(lang.get()).login_email}</label>
                        <input
                            id="email"
                            type="email"
                            placeholder="admin@gmed.de"
                            required
                            prop:value=email
                            on:input=move |ev| set_email.set(event_target_value(&ev))
                        />
                    </div>

                    <div class="form-field">
                        <label for="password">{move || i18n::t(lang.get()).login_password}</label>
                        <input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            required
                            prop:value=password
                            on:input=move |ev| set_password.set(event_target_value(&ev))
                        />
                    </div>

                    <button type="submit" class="btn-primary btn-full" disabled=loading>
                        {move || if loading.get() {
                            i18n::t(lang.get()).login_loading
                        } else {
                            i18n::t(lang.get()).login_submit
                        }}
                    </button>
                </form>

                <div class="login-lang">
                    <button class="lang-switch-small" on:click=toggle_lang>
                        {move || {
                            let l = lang.get();
                            format!("{} {}", l.flag(), l.label())
                        }}
                    </button>
                </div>
            </div>
        </div>
    }
}
