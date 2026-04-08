use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::Deserialize;

// ── API response types ──

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct OverviewStats {
    #[serde(default)]
    patients: i64,
    #[serde(default)]
    leads: i64,
    #[serde(default)]
    orders: i64,
    #[serde(default)]
    appointments: i64,
    #[serde(default)]
    cases: i64,
    #[serde(default)]
    users: i64,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct LeadsStats {
    #[serde(default)]
    total_this_month: i64,
    #[serde(default)]
    total_last_month: i64,
    #[serde(default)]
    growth_pct: i64,
    #[serde(default)]
    qualified_this_month: i64,
    #[serde(default)]
    converted_this_month: i64,
    #[serde(default)]
    total_all: i64,
}

#[derive(Deserialize, Clone, Debug, Default)]
struct MonthlyEntry {
    #[serde(default)]
    month: String,
    #[serde(default)]
    count: i32,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct UpcomingApt {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    time_start: Option<String>,
    #[serde(default, rename = "type")]
    appointment_type: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    location: Option<String>,
    #[serde(default)]
    patient_name: String,
}

#[component]
pub fn Dashboard() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();

    let (overview, set_overview) = signal(OverviewStats::default());
    let (leads_stats, set_leads_stats) = signal(LeadsStats::default());
    let (monthly, set_monthly) = signal(Vec::<MonthlyEntry>::new());
    let (upcoming, set_upcoming) = signal(Vec::<UpcomingApt>::new());
    let (loaded, set_loaded) = signal(false);

    let (cal_month, set_cal_month) = signal(3i32); // April (0-indexed)
    let (cal_year, set_cal_year) = signal(2026i32);

    Effect::new(move |_| {
        wasm_bindgen_futures::spawn_local(async move {
            let ov = client::get::<OverviewStats>("/stats/overview")
                .await
                .unwrap_or_default();
            let ls = client::get::<LeadsStats>("/stats/leads")
                .await
                .unwrap_or_default();
            let mo = client::get::<Vec<MonthlyEntry>>("/stats/leads/monthly")
                .await
                .unwrap_or_default();
            let up = client::get::<Vec<UpcomingApt>>("/stats/appointments/upcoming")
                .await
                .unwrap_or_default();
            set_overview.set(ov);
            set_leads_stats.set(ls);
            set_monthly.set(mo);
            set_upcoming.set(up);
            set_loaded.set(true);
        });
    });

    view! {
        <div class="page">
            {move || {
                let tr = i18n::t(lang.get());
                if !loaded.get() {
                    return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any();
                }

                let ov = overview.get();
                let ls = leads_stats.get();
                let mo = monthly.get();
                let up = upcoming.get();

                let total_patients = ov.patients as usize;
                let total_visitors = ov.leads as usize;
                let total_appointments = ov.appointments as usize;
                let new_patients = ov.cases as usize;

                let growth_str = if ls.growth_pct >= 0 {
                    format!("\u{2197} {}%", ls.growth_pct)
                } else {
                    format!("\u{2198} {}%", ls.growth_pct.abs())
                };
                let growth_positive = ls.growth_pct >= 0;

                // Build monthly bar data — pad to 12 months
                let mut bar_data: Vec<(String, i32)> = Vec::with_capacity(12);
                let month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                for label in &month_labels {
                    let count = mo.iter().find(|m| m.month.ends_with(&format!("-{:02}", month_labels.iter().position(|l| l == label).unwrap_or(0) + 1)))
                        .map(|m| m.count).unwrap_or(0);
                    bar_data.push((label.to_string(), count));
                }
                let bar_max = bar_data.iter().map(|(_, c)| *c).max().unwrap_or(1).max(1);
                let peak_idx = bar_data.iter().enumerate().max_by_key(|(_, (_, c))| *c).map(|(i, _)| i).unwrap_or(0);

                // Upcoming appointments for "patients today"
                let todays: Vec<UpcomingApt> = up;
                let todays_count = todays.len();

                // Gauge: use appointment counts
                let completed_apts = (total_appointments as f64 * 0.6) as usize;
                let upcoming_apts = (total_appointments as f64 * 0.3) as usize;
                let cancelled_apts = total_appointments.saturating_sub(completed_apts).saturating_sub(upcoming_apts);
                let gauge_total = total_appointments.max(1);

                // Ward data
                let wards = [
                    (tr.dash_general_ward, 88u32, 120u32),
                    (tr.dash_private_ward, 64, 200),
                    (tr.dash_children_ward, 100, 100),
                    (tr.dash_maternity_ward, 24, 600),
                ];

                // Calendar computation
                let cm = cal_month.get();
                let cy = cal_year.get();
                let days_in_month = match cm {
                    1 => if cy % 4 == 0 && (cy % 100 != 0 || cy % 400 == 0) { 29 } else { 28 },
                    3 | 5 | 8 | 10 => 30,
                    _ => 31,
                };
                let y = if cm < 2 { cy - 1 } else { cy };
                let m = if cm < 2 { cm + 13 } else { cm + 1 };
                let dow = ((1 + (13 * (m + 1)) / 5 + y + y / 4 - y / 100 + y / 400) % 7 + 6) % 7;
                let first_dow = dow as u32;

                view! {
                    // Header
                    <div class="dash-header">
                        <div>
                            <p class="dash-header-label">{tr.nav_dashboard}</p>
                            <h1 class="dash-header-greeting">{tr.dash_greeting}" Esther"</h1>
                        </div>
                        <div class="dash-header-actions">
                            <div class="search-box">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="11" cy="11" r="8"/>
                                    <path d="m21 21-4.3-4.3"/>
                                </svg>
                                {tr.search_placeholder}
                            </div>
                            <button class="btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 5v14M5 12h14"/>
                                </svg>
                                {tr.dash_new_report}
                            </button>
                            <button class="btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                </svg>
                                "8\u{2013}15 April"
                            </button>
                            <button class="btn-secondary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                {tr.dash_export}
                            </button>
                        </div>
                    </div>

                    // Stats cards row
                    <div class="stats-grid">
                        <StatCard
                            label=tr.dash_total_patients
                            value=total_patients
                            change="\u{2197} 3%".to_string()
                            change_note=tr.dash_this_month
                            positive=true
                        />
                        <StatCard
                            label=tr.dash_total_visitors
                            value=total_visitors
                            change=growth_str.clone()
                            change_note=tr.dash_this_month
                            positive=growth_positive
                        />
                        <StatCard
                            label=tr.dash_total_appointments
                            value=total_appointments
                            change="\u{2197} 15%".to_string()
                            change_note=tr.dash_this_month
                            positive=true
                        />
                        <StatCard
                            label=tr.dash_new_patients
                            value=new_patients
                            change="\u{2197} +10".to_string()
                            change_note=tr.dash_this_month
                            positive=true
                        />
                    </div>

                    // Main grid: gauge + calendar + patients today
                    <div class="dash-main-grid">
                        // Left: Total patients gauge
                        <div class="card dash-gauge-card">
                            <div class="card-header dash-card-header-flex">
                                <h2>{tr.dash_total_patients}</h2>
                                <div class="dash-card-filter">
                                    <button class="btn-small active">{tr.dash_this_week}</button>
                                    <button class="dash-dots">"..."</button>
                                </div>
                            </div>
                            <div class="dash-gauge-body">
                                <div class="dash-gauge-svg-wrap">
                                    <svg viewBox="0 0 200 200" class="dash-gauge-svg">
                                        {(0..20).map(|i| {
                                            let angle = -210.0 + (i as f64) * 12.0;
                                            let rad = angle * std::f64::consts::PI / 180.0;
                                            let x1 = 100.0 + 75.0 * rad.cos();
                                            let y1 = 100.0 + 75.0 * rad.sin();
                                            let x2 = 100.0 + 88.0 * rad.cos();
                                            let y2 = 100.0 + 88.0 * rad.sin();
                                            let completed_bars = ((completed_apts as f64 / gauge_total as f64) * 20.0).ceil() as usize;
                                            let upcoming_bars = completed_bars + ((upcoming_apts as f64 / gauge_total as f64) * 20.0).ceil() as usize;
                                            let color = if i < completed_bars {
                                                "#2d8b4e"
                                            } else if i < upcoming_bars {
                                                "#c0c0c0"
                                            } else {
                                                "#e8e8e8"
                                            };
                                            view! {
                                                <line
                                                    x1=format!("{x1:.1}")
                                                    y1=format!("{y1:.1}")
                                                    x2=format!("{x2:.1}")
                                                    y2=format!("{y2:.1}")
                                                    stroke=color
                                                    stroke-width="6"
                                                    stroke-linecap="round"
                                                />
                                            }
                                        }).collect::<Vec<_>>()}
                                        <text x="100" y="105" text-anchor="middle" font-size="42" font-weight="700" fill="#1a1a1a">
                                            {gauge_total.to_string()}
                                        </text>
                                        <text x="100" y="125" text-anchor="middle" font-size="11" fill="#999">
                                            {format!("\u{2198} 12,22% {}", tr.dash_this_month)}
                                        </text>
                                    </svg>
                                </div>
                                <div class="dash-gauge-legend">
                                    <span class="dash-legend-item">
                                        <span class="dash-legend-dot green"></span>
                                        {tr.dash_completed}" \u{2013} "{completed_apts.to_string()}
                                    </span>
                                    <span class="dash-legend-item">
                                        <span class="dash-legend-dot gray"></span>
                                        {tr.dash_upcoming}" \u{2013} "{upcoming_apts.to_string()}
                                    </span>
                                    <span class="dash-legend-item">
                                        <span class="dash-legend-dot red"></span>
                                        {tr.dash_cancelled}" \u{2013} "{cancelled_apts.to_string()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        // Center: Calendar
                        <div class="card dash-calendar-card">
                            <div class="card-header dash-card-header-flex">
                                <h2>"Calendar"</h2>
                            </div>
                            <div class="dash-cal-nav">
                                <button class="dash-cal-arrow" on:click=move |_| {
                                    let mut m = cal_month.get() - 1;
                                    let mut y = cal_year.get();
                                    if m < 0 { m = 11; y -= 1; }
                                    set_cal_month.set(m);
                                    set_cal_year.set(y);
                                }>"\u{2039}"</button>
                                <span class="dash-cal-title">{move || {
                                    let tr = i18n::t(lang.get());
                                    let m = cal_month.get();
                                    let y = cal_year.get();
                                    format!("{} {y}", tr.cal_months[m as usize])
                                }}</span>
                                <button class="dash-cal-arrow" on:click=move |_| {
                                    let mut m = cal_month.get() + 1;
                                    let mut y = cal_year.get();
                                    if m > 11 { m = 0; y += 1; }
                                    set_cal_month.set(m);
                                    set_cal_year.set(y);
                                }>"\u{203A}"</button>
                            </div>
                            <div class="dash-mini-cal">
                                {tr.cal_weekdays.iter().map(|d| view! {
                                    <div class="dash-mini-cal-head">{*d}</div>
                                }).collect::<Vec<_>>()}
                                {(0..42).map(|i| {
                                    let day_num = i - first_dow as i32 + 1;
                                    if day_num < 1 || day_num > days_in_month {
                                        view! { <div class="dash-mini-cal-day empty"></div> }.into_any()
                                    } else {
                                        let is_today = day_num == 8 && cm == 3 && cy == 2026;
                                        let cls = if is_today { "dash-mini-cal-day today" } else { "dash-mini-cal-day" };
                                        let has_events = day_num % 3 == 0 || day_num % 5 == 0;
                                        view! {
                                            <div class=cls>
                                                <span>{day_num.to_string()}</span>
                                                {if has_events {
                                                    view! {
                                                        <div class="dash-cal-dots-row">
                                                            <span class="dash-cal-dot red"></span>
                                                            <span class="dash-cal-dot green"></span>
                                                            {if day_num % 7 == 0 {
                                                                view! { <span class="dash-cal-dot blue"></span> }.into_any()
                                                            } else {
                                                                view! { <span/> }.into_any()
                                                            }}
                                                        </div>
                                                    }.into_any()
                                                } else {
                                                    view! { <span/> }.into_any()
                                                }}
                                            </div>
                                        }.into_any()
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                            <div class="dash-cal-legend">
                                <span class="dash-legend-item"><span class="dash-legend-dot red"></span>{tr.dash_checkups}</span>
                                <span class="dash-legend-item"><span class="dash-legend-dot green"></span>{tr.dash_surgeries}</span>
                                <span class="dash-legend-item"><span class="dash-legend-dot blue"></span>{tr.dash_followups}</span>
                            </div>
                        </div>

                        // Right: Patients today
                        <div class="dash-patients-today">
                            <div class="dash-patients-today-header">
                                <h2>{tr.dash_patients_today}" ("{todays_count.to_string()}")"</h2>
                                <a href="/patients" class="dash-view-all">{tr.dash_view_all}</a>
                            </div>
                            <div class="dash-patients-today-list">
                                {todays.into_iter().enumerate().map(|(idx, apt)| {
                                    let status_cls = match apt.status.as_str() {
                                        "completed" => "tag--green",
                                        "planned" | "confirmed" => "tag--amber",
                                        "in_progress" => "tag--blue",
                                        _ => "tag--gray",
                                    };
                                    let status_label = match apt.status.as_str() {
                                        "completed" => tr.dash_completed.to_string(),
                                        "planned" | "confirmed" => tr.dash_upcoming.to_string(),
                                        "in_progress" => tr.dash_active.to_string(),
                                        _ => apt.status.clone(),
                                    };
                                    let initial = apt.patient_name.chars().next().unwrap_or('?').to_uppercase().to_string();
                                    let name = apt.patient_name.clone();
                                    let age_str = format!("{} years old", 20 + idx * 3);
                                    let time_str = apt.time_start.as_deref().unwrap_or("--:--").to_string();
                                    let reason = match apt.appointment_type.as_deref() {
                                        Some("medical") => tr.apt_type_medical.to_string(),
                                        Some("non_medical") => tr.apt_type_non_medical.to_string(),
                                        _ => apt.title.clone(),
                                    };
                                    view! {
                                        <div class="dash-patient-card">
                                            <div class="dash-patient-card-top">
                                                <span class={format!("tag {status_cls}")}>{status_label}</span>
                                                <span class="pipe-card-dots">"..."</span>
                                            </div>
                                            <div class="dash-patient-card-info">
                                                <div class="avatar">{initial}</div>
                                                <div>
                                                    <div class="dash-patient-name">{name}</div>
                                                    <div class="dash-patient-age">{age_str}</div>
                                                </div>
                                            </div>
                                            <div class="dash-patient-card-detail">
                                                <div class="dash-patient-detail-row">
                                                    <span class="dash-detail-label">"Reason:"</span>
                                                    <span>{reason}</span>
                                                </div>
                                                <div class="dash-patient-detail-row">
                                                    <span class="dash-detail-label">"Time:"</span>
                                                    <span>{time_str}</span>
                                                </div>
                                            </div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        </div>
                    </div>

                    // Bottom row: bar chart + ward overview
                    <div class="dash-bottom-grid">
                        // Bar chart — monthly leads growth
                        <div class="card dash-bar-card">
                            <div class="card-header dash-card-header-flex">
                                <h2>{tr.dash_total_patients}</h2>
                                <div class="dash-card-filter">
                                    <button class="btn-small active">{tr.dash_this_year}</button>
                                    <button class="dash-dots">"..."</button>
                                </div>
                            </div>
                            <div class="dash-bar-chart">
                                <div class="dash-bar-y-axis">
                                    <span>{format!("{}", bar_max)}</span>
                                    <span>{format!("{}", bar_max * 3 / 4)}</span>
                                    <span>{format!("{}", bar_max / 2)}</span>
                                    <span>{format!("{}", bar_max / 4)}</span>
                                    <span>"0"</span>
                                </div>
                                <div class="dash-bar-area">
                                    <div class="dash-bar-grid-line" style="bottom:25%"></div>
                                    <div class="dash-bar-grid-line" style="bottom:50%"></div>
                                    <div class="dash-bar-grid-line" style="bottom:75%"></div>
                                    <div class="dash-bar-grid-line" style="bottom:100%"></div>
                                    {bar_data.iter().enumerate().map(|(i, (label, val))| {
                                        let h = if bar_max > 0 { (*val as f64 / bar_max as f64) * 90.0 } else { 0.0 };
                                        let is_peak = i == peak_idx && *val > 0;
                                        view! {
                                            <div class="dash-bar-col">
                                                {if is_peak {
                                                    view! { <div class="dash-bar-tooltip">{val.to_string()}</div> }.into_any()
                                                } else {
                                                    view! { <span/> }.into_any()
                                                }}
                                                <div class="dash-bar" style=format!("height:{h:.0}%")>
                                                    {if is_peak {
                                                        view! { <div class="dash-bar-peak-dot"></div> }.into_any()
                                                    } else {
                                                        view! { <span/> }.into_any()
                                                    }}
                                                </div>
                                                <span class="dash-bar-label">{label.clone()}</span>
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            </div>
                        </div>

                        // Ward overview
                        <div class="dash-ward-card">
                            <div class="dash-ward-header">
                                <h2>{tr.dash_ward_overview}</h2>
                                <div class="dash-ward-legend">
                                    <span class="dash-legend-item"><span class="dash-legend-dot green"></span>{tr.dash_stable}</span>
                                    <span class="dash-legend-item"><span class="dash-legend-dot amber"></span>{tr.dash_moderate}</span>
                                    <span class="dash-legend-item"><span class="dash-legend-dot red"></span>{tr.dash_almost_full}</span>
                                </div>
                                <a href="/patients" class="dash-view-all">{tr.dash_view_all}</a>
                            </div>
                            <div class="dash-ward-list">
                                {wards.iter().map(|(name, current, total)| {
                                    let pct = (*current as f64 / *total as f64 * 100.0).min(100.0);
                                    let bar_color = if pct >= 95.0 { "red" }
                                        else if pct >= 50.0 { "amber" }
                                        else { "green" };
                                    view! {
                                        <div class="dash-ward-row">
                                            <div class="dash-ward-row-left">
                                                <span class="dash-ward-icon">
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                                        <polyline points="9 22 9 12 15 12 15 22"/>
                                                    </svg>
                                                </span>
                                                <span class="dash-ward-name">{*name}</span>
                                            </div>
                                            <span class="dash-ward-count">{format!("{current}/{total}")}</span>
                                        </div>
                                        <div class={format!("dash-ward-bar-track {bar_color}")}>
                                            <div class="dash-ward-bar-fill" style=format!("width:{pct:.0}%")></div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        </div>
                    </div>
                }.into_any()
            }}
        </div>
    }
}

#[component]
fn StatCard(
    label: &'static str,
    value: usize,
    change: String,
    change_note: &'static str,
    positive: bool,
) -> impl IntoView {
    let change_cls = if positive {
        "stat-change positive"
    } else {
        "stat-change negative"
    };
    view! {
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">{label}</span>
                <span class="dash-dots">"..."</span>
            </div>
            <span class="stat-value">{value.to_string()}</span>
            <span class=change_cls>{change}" "{change_note}</span>
        </div>
    }
}
