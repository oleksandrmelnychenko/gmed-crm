#![allow(clippy::unit_arg)]

use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, can_access_admin, can_access_appointments};
use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn Sidebar() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    let on_logout = move |_| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body("/auth/logout").await;
            client::clear_tokens();
            let window = web_sys::window().unwrap();
            let _ = window.location().set_href("/login");
        });
    };

    view! {
        <nav class="sidebar">
            <div class="sidebar-brand">
                <div class="brand-logo">
                    <svg width="20" height="20" viewBox="0 0 76 65" fill="none">
                        <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor"/>
                    </svg>
                </div>
                <span class="brand-name">"GMED"</span>
                <span class="brand-separator">"/"</span>
                <span class="brand-sub">"CRM"</span>
            </div>

            <div class="sidebar-section">
                <span class="sidebar-section-title">{move || i18n::t(lang.get()).nav_overview}</span>
                <ul class="sidebar-nav">
                    <li><A href="/"><SvgIcon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>{move || i18n::t(lang.get()).nav_dashboard}</A></li>
                    <li><A href="/chat"><SvgIcon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>{move || i18n::t(lang.get()).nav_chat}</A></li>
                </ul>
            </div>

            <div class="sidebar-section">
                <span class="sidebar-section-title">{move || i18n::t(lang.get()).nav_crm}</span>
                <ul class="sidebar-nav">
                    <li><A href="/leads"><SvgIcon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>{move || i18n::t(lang.get()).leads_title}</A></li>
                    <li><A href="/patients"><SvgIcon d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>{move || i18n::t(lang.get()).patients_title}</A></li>
                    <li><A href="/providers"><SvgIcon d="M3 21V7a2 2 0 012-2h6v16M13 9h6a2 2 0 012 2v10M8 9h.01M8 13h.01M8 17h.01M16 13h.01M16 17h.01"/>{move || i18n::t(lang.get()).nav_providers}</A></li>
                    <li><A href="/orders"><SvgIcon d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>{move || i18n::t(lang.get()).orders_title}</A></li>
                </ul>
            </div>

            <div class="sidebar-section">
                <span class="sidebar-section-title">{move || i18n::t(lang.get()).nav_medicine}</span>
                <ul class="sidebar-nav">
                    <li><A href="/cases"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/>{move || i18n::t(lang.get()).cases_title}</A></li>
                    {move || {
                        let show_appointments = current_user
                            .user
                            .get()
                            .map(|user| can_access_appointments(&user.role))
                            .unwrap_or(false);
                        if show_appointments {
                            view! {
                                <li><A href="/appointments"><SvgIcon d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/>{move || i18n::t(lang.get()).appointments_title}</A></li>
                            }.into_any()
                        } else {
                            view! { <></> }.into_any()
                        }
                    }}
                </ul>
            </div>

            {move || {
                let show_admin = current_user
                    .user
                    .get()
                    .map(|user| can_access_admin(&user.role))
                    .unwrap_or(false);
                if show_admin {
                    view! {
                        <div class="sidebar-section">
                            <span class="sidebar-section-title">{move || i18n::t(lang.get()).nav_admin}</span>
                            <ul class="sidebar-nav">
                                <li><A href="/admin/users"><SvgIcon d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>{move || i18n::t(lang.get()).nav_users_roles}</A></li>
                                <li><A href="/admin/access"><SvgIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>{move || i18n::t(lang.get()).nav_access_matrix}</A></li>
                                <li><A href="/admin/settings"><SvgIcon d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>{move || i18n::t(lang.get()).settings_title}</A></li>
                                <li><A href="/admin/activity"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/>{move || i18n::t(lang.get()).nav_activity}</A></li>
                                <li><A href="/admin/security"><SvgIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>{move || i18n::t(lang.get()).nav_security}</A></li>
                                <li><A href="/admin/health"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/>{move || i18n::t(lang.get()).nav_health}</A></li>
                                <li><A href="/admin/compliance"><SvgIcon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>{move || i18n::t(lang.get()).nav_compliance}</A></li>
                                <li><A href="/admin/notifications"><SvgIcon d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>{move || i18n::t(lang.get()).nav_notifications}</A></li>
                                <li><A href="/admin/custom-fields"><SvgIcon d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>{move || i18n::t(lang.get()).nav_custom_fields}</A></li>
                                <li><A href="/admin/announcements"><SvgIcon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>{move || i18n::t(lang.get()).nav_announcements}</A></li>
                            </ul>
                        </div>
                    }.into_any()
                } else {
                    view! { <></> }.into_any()
                }
            }}

            <div class="sidebar-footer">
                <button class="sidebar-logout" on:click=on_logout>
                    <SvgIcon d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                    {move || i18n::t(lang.get()).nav_logout}
                </button>
            </div>
        </nav>
    }
}

#[component]
fn SvgIcon(d: &'static str) -> impl IntoView {
    view! {
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d=d/>
        </svg>
    }
}
