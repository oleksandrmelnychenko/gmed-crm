use crate::api::client;
use crate::components::announcement_banner::AnnouncementBanner;
use crate::components::chat_panel::ChatPanel;
use crate::components::sidebar::{Sidebar, provide_sidebar};
use crate::components::topbar::Topbar;
use crate::components::workspace::{self, Layout, SidePanel, WorkspaceCtx};
use crate::i18n::{self, Lang};
use crate::pages::{
    admin_access::AdminAccess, admin_activity::AdminActivity,
    admin_announcements::AdminAnnouncements, admin_compliance::AdminCompliance,
    admin_custom_fields::AdminCustomFields, admin_health::AdminHealth,
    admin_notifications::AdminNotifications, admin_security::AdminSecurity,
    admin_settings::AdminSettings, admin_users::AdminUsers, appointments_list::AppointmentsList,
    cases_list::CasesList, chat::Chat, dashboard::Dashboard, leads::Leads, login::Login,
    orders::Orders, patients::Patients, providers::Providers,
};
use crate::session::provide_current_user;
use leptos::prelude::*;
use leptos_router::components::*;
use leptos_router::path;

#[component]
pub fn App() -> impl IntoView {
    let (lang, set_lang) = i18n::provide_i18n();
    provide_context(lang);
    provide_context(set_lang);

    view! {
        <Router>
            <Routes fallback=|| view! { <p class="not-found">"404"</p> }>
                <Route path=path!("/login") view=LoginPage />
                <ParentRoute path=path!("/") view=AuthenticatedLayout>
                    <Route path=path!("") view=Dashboard />
                    <Route path=path!("patients") view=Patients />
                    <Route path=path!("providers") view=Providers />
                    <Route path=path!("leads") view=Leads />
                    <Route path=path!("orders") view=Orders />
                    <Route path=path!("cases") view=CasesList />
                    <Route path=path!("appointments") view=AppointmentsList />
                    <Route path=path!("chat") view=Chat />
                    <Route path=path!("admin/users") view=AdminUsers />
                    <Route path=path!("admin/access") view=AdminAccess />
                    <Route path=path!("admin/settings") view=AdminSettings />
                    <Route path=path!("admin/activity") view=AdminActivity />
                    <Route path=path!("admin/security") view=AdminSecurity />
                    <Route path=path!("admin/health") view=AdminHealth />
                    <Route path=path!("admin/compliance") view=AdminCompliance />
                    <Route path=path!("admin/notifications") view=AdminNotifications />
                    <Route path=path!("admin/custom-fields") view=AdminCustomFields />
                    <Route path=path!("admin/announcements") view=AdminAnnouncements />
                </ParentRoute>
            </Routes>
        </Router>
    }
}

#[component]
fn LoginPage() -> impl IntoView {
    view! { <Login /> }
}

#[component]
fn AuthenticatedLayout() -> impl IntoView {
    if !client::is_logged_in() {
        let window = web_sys::window().unwrap();
        let _ = window.location().set_href("/login");
    }

    let current_user = provide_current_user();
    let ws = workspace::provide_workspace();
    let sb = provide_sidebar();

    let main_cls = move || {
        if sb.is_open.get() {
            "app-main app-main-expanded"
        } else {
            "app-main app-main-collapsed"
        }
    };

    view! {
        {move || {
            if current_user.loading.get() {
                return view! { <div class="page-loading">"Loading profile..."</div> }.into_any();
            }

            view! {
                <div class="app-layout">
                    <Sidebar />
                    <div class=main_cls>
                        <AnnouncementBanner />
                        <Topbar />
                        <main class="main-content">
                            {move || {
                                let cfg = ws.config.get();
                                let is_open = cfg.side_panel != SidePanel::None;
                                let layout = cfg.layout;
                                let pw = cfg.panel_width;
                                let ph = cfg.panel_height;

                                let ws_cls = match layout {
                                    Layout::Right => "ws-content ws-split-right",
                                    Layout::Left => "ws-content ws-split-left",
                                    Layout::Bottom => "ws-content ws-split-bottom",
                                };

                                let panel_cls = if is_open { "ws-side-panel" } else { "ws-side-panel ws-closed" };

                                let panel_style = if is_open {
                                    match layout {
                                        Layout::Right | Layout::Left => format!("width:{pw}px;min-width:{pw}px"),
                                        Layout::Bottom => format!("height:{ph}px;min-height:{ph}px"),
                                    }
                                } else {
                                    match layout {
                                        Layout::Right | Layout::Left => "width:0;min-width:0".to_string(),
                                        Layout::Bottom => "height:0;min-height:0".to_string(),
                                    }
                                };

                                let panel = view! {
                                    <div class=panel_cls style=panel_style>
                                        <ChatPanel />
                                    </div>
                                };

                                if layout == Layout::Left {
                                    view! {
                                        <div class=ws_cls>
                                            {panel}
                                            <div class="ws-main-outlet"><Outlet /></div>
                                        </div>
                                    }.into_any()
                                } else {
                                    view! {
                                        <div class=ws_cls>
                                            <div class="ws-main-outlet"><Outlet /></div>
                                            {panel}
                                        </div>
                                    }.into_any()
                                }
                            }}
                        </main>
                    </div>
                </div>
            }.into_any()
        }}
    }
}

fn size_btn(
    current: u32,
    target: u32,
    label: &'static str,
    on_click: impl Fn() + 'static,
) -> impl IntoView {
    // Use ranges: S=0..340, M=341..430, L=431..530, XL=531+
    let is_active = match target {
        300 => current <= 340,
        380 => current > 340 && current <= 430,
        480 => current > 430 && current <= 530,
        _ => current > 530,
    };
    let cls = if is_active {
        "ws-size-btn active"
    } else {
        "ws-size-btn"
    };
    view! {
        <button class=cls on:click=move |_| on_click()>{label}</button>
    }
}

/// Workspace toolbar — rendered inside the Topbar.
#[component]
pub fn WorkspaceToolbar() -> impl IntoView {
    let ws = use_context::<WorkspaceCtx>();
    let lang = use_context::<ReadSignal<Lang>>().unwrap();

    let Some(ws) = ws else {
        return view! { <span></span> }.into_any();
    };

    let (menu_open, set_menu_open) = signal(false);

    view! {
        <div class="ws-toolbar">
            // Toggle chat panel — Copilot-style sparkle chat icon
            <button
                class=move || if ws.config.get().side_panel == SidePanel::Chat { "ws-tool-btn active" } else { "ws-tool-btn" }
                title=move || i18n::t(lang.get()).nav_chat
                on:click=move |_| ws.toggle_chat()
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    // Chat bubble with sparkle
                    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
                    <path d="M15 4l1 2.5L18.5 8 16 9l-1 2.5L14 9l-2.5-1L14 7z" fill="currentColor" stroke="none" opacity="0.5"/>
                </svg>
            </button>

            // Layout config — grid/layout icon
            <button
                class=move || if menu_open.get() { "ws-tool-btn active" } else { "ws-tool-btn" }
                on:click=move |_| set_menu_open.set(!menu_open.get())
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="9" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="5" rx="1.5"/>
                    <rect x="14" y="12" width="7" height="9" rx="1.5"/>
                    <rect x="3" y="16" width="7" height="5" rx="1.5"/>
                </svg>
            </button>

            // Dropdown menu
            {move || {
                if !menu_open.get() { return view! { <span></span> }.into_any(); }
                let cfg = ws.config.get();
                view! {
                    <div class="ws-menu-overlay" on:click=move |_| set_menu_open.set(false)></div>
                    <div class="ws-menu">
                        <div class="ws-menu-section">
                            <span class="ws-menu-label">"Layout"</span>
                            <button class=move || if cfg.layout == Layout::Right { "ws-menu-item active" } else { "ws-menu-item" }
                                on:click=move |_| { ws.set_layout(Layout::Right); set_menu_open.set(false); }>
                                // Panel right icon
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <rect x="14" y="5" width="5" height="14" rx="1" fill="currentColor" opacity="0.15"/>
                                    <line x1="14" y1="3" x2="14" y2="21"/>
                                </svg>
                                " Panel right"
                            </button>
                            <button class=move || if cfg.layout == Layout::Left { "ws-menu-item active" } else { "ws-menu-item" }
                                on:click=move |_| { ws.set_layout(Layout::Left); set_menu_open.set(false); }>
                                // Panel left icon
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <rect x="5" y="5" width="5" height="14" rx="1" fill="currentColor" opacity="0.15"/>
                                    <line x1="10" y1="3" x2="10" y2="21"/>
                                </svg>
                                " Panel left"
                            </button>
                            <button class=move || if cfg.layout == Layout::Bottom { "ws-menu-item active" } else { "ws-menu-item" }
                                on:click=move |_| { ws.set_layout(Layout::Bottom); set_menu_open.set(false); }>
                                // Panel bottom icon
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <rect x="5" y="14" width="14" height="5" rx="1" fill="currentColor" opacity="0.15"/>
                                    <line x1="3" y1="14" x2="21" y2="14"/>
                                </svg>
                                " Panel bottom"
                            </button>
                        </div>
                        <div class="ws-menu-section">
                            <span class="ws-menu-label">"Size"</span>
                            <div class="ws-size-row">
                                {size_btn(cfg.panel_width, 300, "S", move || { ws.set_panel_width(300); ws.set_panel_height(220); })}
                                {size_btn(cfg.panel_width, 380, "M", move || { ws.set_panel_width(380); ws.set_panel_height(300); })}
                                {size_btn(cfg.panel_width, 480, "L", move || { ws.set_panel_width(480); ws.set_panel_height(380); })}
                                {size_btn(cfg.panel_width, 580, "XL", move || { ws.set_panel_width(580); ws.set_panel_height(440); })}
                            </div>
                        </div>
                    </div>
                }.into_any()
            }}
        </div>
    }.into_any()
}
