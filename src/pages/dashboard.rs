use leptos::prelude::*;

#[component]
pub fn Dashboard() -> impl IntoView {
    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>"Dashboard"</h1>
                    <p class="page-subtitle">"Overview of your sales pipeline"</p>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-label">"Контакти"</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stat-icon">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                    </div>
                    <span class="stat-value">"128"</span>
                    <span class="stat-change positive">"+14% від мін. місяця"</span>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-label">"Активні угоди"</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stat-icon">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                    </div>
                    <span class="stat-value">"34"</span>
                    <span class="stat-change positive">"+8% від мін. місяця"</span>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-label">"Pipeline"</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stat-icon">
                            <line x1="12" y1="1" x2="12" y2="23"/>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                    </div>
                    <span class="stat-value">"$52,400"</span>
                    <span class="stat-change positive">"+23% від мін. місяця"</span>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-label">"Закриті цього місяця"</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stat-icon">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </div>
                    <span class="stat-value">"12"</span>
                    <span class="stat-change neutral">"= як мін. місяця"</span>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2>"Останні угоди"</h2>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>"Назва"</th>
                            <th>"Контакт"</th>
                            <th>"Сума"</th>
                            <th>"Статус"</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="cell-primary">"Enterprise ліцензія"</td>
                            <td>"Олексій Коваленко"</td>
                            <td class="cell-mono">"$12,000"</td>
                            <td><span class="tag tag--blue">"Переговори"</span></td>
                        </tr>
                        <tr>
                            <td class="cell-primary">"Консалтинг Q2"</td>
                            <td>"Марія Шевченко"</td>
                            <td class="cell-mono">"$8,500"</td>
                            <td><span class="tag tag--amber">"Пропозиція"</span></td>
                        </tr>
                        <tr>
                            <td class="cell-primary">"Інтеграція API"</td>
                            <td>"Андрій Бондаренко"</td>
                            <td class="cell-mono">"$24,000"</td>
                            <td><span class="tag tag--green">"Закрито"</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    }
}
