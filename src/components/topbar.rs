use leptos::prelude::*;

#[component]
pub fn Topbar() -> impl IntoView {
    view! {
        <header class="topbar">
            <div class="topbar-left">
                <div class="breadcrumb">
                    <span class="breadcrumb-item">"GMED CRM"</span>
                </div>
            </div>
            <div class="topbar-right">
                <div class="search-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>"Search..."</span>
                    <kbd>"/"</kbd>
                </div>
                <button class="topbar-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </button>
            </div>
        </header>
    }
}
