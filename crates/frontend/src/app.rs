use crate::api::client;
use crate::components::announcement_banner::AnnouncementBanner;
use crate::components::chat_panel::ChatPanel;
use crate::components::sidebar::Sidebar;
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

    view! {
        {move || {
            if current_user.loading.get() {
                return view! { <div class="page-loading">"Loading profile..."</div> }.into_any();
            }

            let cfg = ws.config.get();
            let has_panel = cfg.side_panel != SidePanel::None;
            let layout = cfg.layout;
            let panel_w = cfg.panel_width;
            let panel_h = cfg.panel_height;

            let workspace_cls = match (has_panel, layout) {
                (false, _) => "ws-content".to_string(),
                (true, Layout::Right) => "ws-content ws-split-right".to_string(),
                (true, Layout::Left) => "ws-content ws-split-left".to_string(),
                (true, Layout::Bottom) => "ws-content ws-split-bottom".to_string(),
            };

            let panel_style = if has_panel {
                match layout {
                    Layout::Right | Layout::Left => format!("width:{panel_w}px;min-width:{panel_w}px"),
                    Layout::Bottom => format!("height:{panel_h}px;min-height:{panel_h}px"),
                }
            } else {
                String::new()
            };

            let side_panel_view = if has_panel {
                view! {
                    <div class="ws-side-panel" style=panel_style>
                        {match cfg.side_panel {
                            SidePanel::Chat => view! { <ChatPanel /> }.into_any(),
                            SidePanel::None => view! { <span></span> }.into_any(),
                        }}
                    </div>
                }.into_any()
            } else {
                view! { <span></span> }.into_any()
            };

            // Build the content area with panel placement
            let main_area = if has_panel && layout == Layout::Left {
                view! {
                    <div class=workspace_cls>
                        {side_panel_view}
                        <div class="ws-main-outlet">
                            <Outlet />
                        </div>
                    </div>
                }.into_any()
            } else if has_panel && layout == Layout::Bottom {
                view! {
                    <div class=workspace_cls>
                        <div class="ws-main-outlet">
                            <Outlet />
                        </div>
                        {side_panel_view}
                    </div>
                }.into_any()
            } else {
                // Right (default) or no panel
                view! {
                    <div class=workspace_cls>
                        <div class="ws-main-outlet">
                            <Outlet />
                        </div>
                        {side_panel_view}
                    </div>
                }.into_any()
            };

            view! {
                <div class="app-layout">
                    <Sidebar />
                    <div class="app-main">
                        <AnnouncementBanner />
                        <Topbar />
                        <main class="main-content">
                            {main_area}
                        </main>
                    </div>
                </div>
            }.into_any()
        }}
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
            // Toggle chat panel
            <button
                class=move || if ws.config.get().side_panel == SidePanel::Chat { "ws-tool-btn active" } else { "ws-tool-btn" }
                title=move || i18n::t(lang.get()).nav_chat
                on:click=move |_| ws.toggle_chat()
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
            </button>

            // Layout config dropdown
            <button class="ws-tool-btn" on:click=move |_| set_menu_open.set(!menu_open.get())>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
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
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>
                                </svg>
                                " Panel right"
                            </button>
                            <button class=move || if cfg.layout == Layout::Left { "ws-menu-item active" } else { "ws-menu-item" }
                                on:click=move |_| { ws.set_layout(Layout::Left); set_menu_open.set(false); }>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
                                </svg>
                                " Panel left"
                            </button>
                            <button class=move || if cfg.layout == Layout::Bottom { "ws-menu-item active" } else { "ws-menu-item" }
                                on:click=move |_| { ws.set_layout(Layout::Bottom); set_menu_open.set(false); }>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="15" x2="21" y2="15"/>
                                </svg>
                                " Panel bottom"
                            </button>
                        </div>
                        <div class="ws-menu-section">
                            <span class="ws-menu-label">"Size"</span>
                            <div class="ws-size-row">
                                <button class="ws-size-btn" on:click=move |_| ws.set_panel_width(300)>"S"</button>
                                <button class="ws-size-btn" on:click=move |_| ws.set_panel_width(380)>"M"</button>
                                <button class="ws-size-btn" on:click=move |_| ws.set_panel_width(480)>"L"</button>
                                <button class="ws-size-btn" on:click=move |_| ws.set_panel_width(580)>"XL"</button>
                            </div>
                        </div>
                    </div>
                }.into_any()
            }}
        </div>
    }.into_any()
}
