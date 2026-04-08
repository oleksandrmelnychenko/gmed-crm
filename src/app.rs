use leptos::prelude::*;
use leptos_router::components::*;
use leptos_router::path;
use crate::pages::{dashboard::Dashboard, contacts::Contacts, deals::Deals};
use crate::components::sidebar::Sidebar;
use crate::components::topbar::Topbar;

#[component]
pub fn App() -> impl IntoView {
    view! {
        <Router>
            <div class="app-layout">
                <Sidebar />
                <div class="app-main">
                    <Topbar />
                    <main class="main-content">
                        <Routes fallback=|| view! { <p class="not-found">"404 — Сторінку не знайдено"</p> }>
                            <Route path=path!("/") view=Dashboard />
                            <Route path=path!("/contacts") view=Contacts />
                            <Route path=path!("/deals") view=Deals />
                        </Routes>
                    </main>
                </div>
            </div>
        </Router>
    }
}
