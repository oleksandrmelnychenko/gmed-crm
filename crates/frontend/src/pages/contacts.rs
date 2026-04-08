use leptos::prelude::*;

#[derive(Clone, Debug)]
struct Contact {
    name: String,
    email: String,
    company: String,
    status: String,
}

fn status_tag_class(status: &str) -> &'static str {
    match status {
        "Активний" => "tag tag--green",
        "Новий" => "tag tag--blue",
        _ => "tag tag--gray",
    }
}

#[component]
pub fn Contacts() -> impl IntoView {
    let (contacts, _set_contacts) = signal(vec![
        Contact {
            name: "Олексій Коваленко".into(),
            email: "oleksiy@example.com".into(),
            company: "TechCorp".into(),
            status: "Активний".into(),
        },
        Contact {
            name: "Марія Шевченко".into(),
            email: "maria@example.com".into(),
            company: "DataFlow".into(),
            status: "Новий".into(),
        },
        Contact {
            name: "Андрій Бондаренко".into(),
            email: "andriy@example.com".into(),
            company: "CloudSys".into(),
            status: "Активний".into(),
        },
    ]);

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>"Контакти"</h1>
                    <p class="page-subtitle">"Manage your contacts and leads"</p>
                </div>
                <button class="btn-primary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    "Додати контакт"
                </button>
            </div>
            <div class="card">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>"Name"</th>
                            <th>"Email"</th>
                            <th>"Company"</th>
                            <th>"Status"</th>
                        </tr>
                    </thead>
                    <tbody>
                        {move || contacts.get().into_iter().map(|c| {
                            let cls = status_tag_class(&c.status);
                            view! {
                                <tr>
                                    <td class="cell-primary">{c.name}</td>
                                    <td class="cell-mono cell-dim">{c.email}</td>
                                    <td>{c.company}</td>
                                    <td><span class={cls}>{c.status}</span></td>
                                </tr>
                            }
                        }).collect::<Vec<_>>()}
                    </tbody>
                </table>
            </div>
        </div>
    }
}
