use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn Sidebar() -> impl IntoView {
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
                <span class="sidebar-section-title">"Overview"</span>
                <ul class="sidebar-nav">
                    <li>
                        <A href="/">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="7" height="7" rx="1"/>
                                <rect x="14" y="3" width="7" height="7" rx="1"/>
                                <rect x="3" y="14" width="7" height="7" rx="1"/>
                                <rect x="14" y="14" width="7" height="7" rx="1"/>
                            </svg>
                            "Dashboard"
                        </A>
                    </li>
                </ul>
            </div>

            <div class="sidebar-section">
                <span class="sidebar-section-title">"Sales"</span>
                <ul class="sidebar-nav">
                    <li>
                        <A href="/contacts">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                            "Контакти"
                        </A>
                    </li>
                    <li>
                        <A href="/deals">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"/>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                            </svg>
                            "Угоди"
                        </A>
                    </li>
                </ul>
            </div>

            <div class="sidebar-footer">
                <div class="sidebar-user">
                    <div class="avatar">"O"</div>
                    <span class="user-name">"Oleksandr"</span>
                </div>
            </div>
        </nav>
    }
}
