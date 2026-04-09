#![allow(clippy::unit_arg)]

use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, can_access_admin, can_access_appointments};
use gloo_storage::{LocalStorage, Storage};
use leptos::prelude::*;
use leptos_router::components::A;

const SIDEBAR_STORAGE_KEY: &str = "gmed_sidebar_open";

#[derive(Clone, Copy)]
pub struct SidebarState {
    pub is_open: ReadSignal<bool>,
}

pub fn provide_sidebar() -> SidebarState {
    let stored_open: bool = LocalStorage::get(SIDEBAR_STORAGE_KEY).unwrap_or(true);
    let (is_open, set_is_open) = signal(stored_open);
    provide_context(set_is_open);
    let state = SidebarState { is_open };
    provide_context(state);
    state
}

#[component]
pub fn Sidebar() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();
    let state = use_context::<SidebarState>().unwrap();
    let is_open = state.is_open;
    let set_is_open = use_context::<WriteSignal<bool>>().unwrap();

    let toggle = move |_| {
        let next = !is_open.get_untracked();
        set_is_open.set(next);
        let _ = LocalStorage::set(SIDEBAR_STORAGE_KEY, next);
    };

    let on_logout = move |_| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body("/auth/logout").await;
            client::clear_tokens();
            let window = web_sys::window().unwrap();
            let _ = window.location().set_href("/login");
        });
    };

    let nav_cls = move || {
        if is_open.get() {
            "sidebar sidebar-open"
        } else {
            "sidebar sidebar-collapsed"
        }
    };

    view! {
        <nav class=nav_cls>
            <div class="sidebar-toggle">
                <button class="sidebar-toggle-btn" on:click=toggle title="Toggle sidebar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                </button>
            </div>

            <div class="sidebar-group">
                <ul class="sidebar-nav">
                    <li><A href="/"><SvgIcon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_dashboard}</span></A></li>
                    <li><A href="/chat"><SvgIcon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_chat}</span></A></li>
                </ul>
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-group">
                <ul class="sidebar-nav">
                    <li><A href="/leads"><SvgIcon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><span class="nav-label">{move || i18n::t(lang.get()).leads_title}</span></A></li>
                    <li><A href="/patients"><SvgIcon d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><span class="nav-label">{move || i18n::t(lang.get()).patients_title}</span></A></li>
                    <li><A href="/providers"><SvgIcon d="M3 21V7a2 2 0 012-2h6v16M13 9h6a2 2 0 012 2v10M8 9h.01M8 13h.01M8 17h.01M16 13h.01M16 17h.01"/><span class="nav-label">{move || i18n::t(lang.get()).nav_providers}</span></A></li>
                    <li><A href="/orders"><SvgIcon d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><span class="nav-label">{move || i18n::t(lang.get()).orders_title}</span></A></li>
                </ul>
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-group">
                <ul class="sidebar-nav">
                    <li><A href="/cases"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/><span class="nav-label">{move || i18n::t(lang.get()).cases_title}</span></A></li>
                    {move || {
                        let show_appointments = current_user
                            .user
                            .get()
                            .map(|user| can_access_appointments(&user.role))
                            .unwrap_or(false);
                        if show_appointments {
                            view! {
                                <li><A href="/appointments"><SvgIcon d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/><span class="nav-label">{move || i18n::t(lang.get()).appointments_title}</span></A></li>
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
                        <div class="sidebar-divider"></div>
                        <div class="sidebar-group">
                            <ul class="sidebar-nav">
                                <li><A href="/admin/users"><SvgIcon d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><span class="nav-label">{move || i18n::t(lang.get()).nav_users_roles}</span></A></li>
                                <li><A href="/admin/access"><SvgIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_access_matrix}</span></A></li>
                                <li><A href="/admin/settings"><SvgIcon d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><span class="nav-label">{move || i18n::t(lang.get()).settings_title}</span></A></li>
                                <li><A href="/admin/activity"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/><span class="nav-label">{move || i18n::t(lang.get()).nav_activity}</span></A></li>
                                <li><A href="/admin/security"><SvgIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_security}</span></A></li>
                                <li><A href="/admin/health"><SvgIcon d="M22 12h-4l-3 9L9 3l-3 9H2"/><span class="nav-label">{move || i18n::t(lang.get()).nav_health}</span></A></li>
                                <li><A href="/admin/compliance"><SvgIcon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_compliance}</span></A></li>
                                <li><A href="/admin/notifications"><SvgIcon d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><span class="nav-label">{move || i18n::t(lang.get()).nav_notifications}</span></A></li>
                                <li><A href="/admin/custom-fields"><SvgIcon d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><span class="nav-label">{move || i18n::t(lang.get()).nav_custom_fields}</span></A></li>
                                <li><A href="/admin/announcements"><SvgIcon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><span class="nav-label">{move || i18n::t(lang.get()).nav_announcements}</span></A></li>
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
                    <span class="nav-label">{move || i18n::t(lang.get()).nav_logout}</span>
                </button>
            </div>
        </nav>
    }
}

#[component]
fn SvgIcon(d: &'static str) -> impl IntoView {
    view! {
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d=d/>
        </svg>
    }
}
