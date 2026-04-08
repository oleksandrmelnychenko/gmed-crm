use leptos::prelude::*;

#[derive(Clone, Debug)]
struct Deal {
    title: String,
    contact: String,
    value: String,
    stage: String,
}

fn stage_tag_class(stage: &str) -> &'static str {
    match stage {
        "Переговори" => "tag tag--blue",
        "Пропозиція" => "tag tag--amber",
        "Закрито" => "tag tag--green",
        _ => "tag tag--gray",
    }
}

#[component]
pub fn Deals() -> impl IntoView {
    let (deals, _set_deals) = signal(vec![
        Deal {
            title: "Enterprise ліцензія".into(),
            contact: "Олексій Коваленко".into(),
            value: "$12,000".into(),
            stage: "Переговори".into(),
        },
        Deal {
            title: "Консалтинг Q2".into(),
            contact: "Марія Шевченко".into(),
            value: "$8,500".into(),
            stage: "Пропозиція".into(),
        },
        Deal {
            title: "Інтеграція API".into(),
            contact: "Андрій Бондаренко".into(),
            value: "$24,000".into(),
            stage: "Закрито".into(),
        },
    ]);

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>"Угоди"</h1>
                    <p class="page-subtitle">"Track and manage your deals"</p>
                </div>
                <button class="btn-primary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    "Нова угода"
                </button>
            </div>
            <div class="card">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>"Deal"</th>
                            <th>"Contact"</th>
                            <th>"Value"</th>
                            <th>"Stage"</th>
                        </tr>
                    </thead>
                    <tbody>
                        {move || deals.get().into_iter().map(|d| {
                            let cls = stage_tag_class(&d.stage);
                            view! {
                                <tr>
                                    <td class="cell-primary">{d.title}</td>
                                    <td>{d.contact}</td>
                                    <td class="cell-mono">{d.value}</td>
                                    <td><span class={cls}>{d.stage}</span></td>
                                </tr>
                            }
                        }).collect::<Vec<_>>()}
                    </tbody>
                </table>
            </div>
        </div>
    }
}
