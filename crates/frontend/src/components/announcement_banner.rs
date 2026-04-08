use crate::api::client;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
struct Announcement {
    title: String,
    message: String,
    variant: String,
}

fn variant_class(v: &str) -> &'static str {
    match v {
        "warning" => "ann-banner ann-warning",
        "error" => "ann-banner ann-error",
        "success" => "ann-banner ann-success",
        _ => "ann-banner ann-info",
    }
}

#[component]
pub fn AnnouncementBanner() -> impl IntoView {
    let (banners, set_banners) = signal(Vec::<Announcement>::new());

    Effect::new(move |_| {
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(list) = client::get::<Vec<Announcement>>("/announcements/active").await {
                set_banners.set(list);
            }
        });
    });

    view! {
        {move || {
            let list = banners.get();
            if list.is_empty() { return view! { <div></div> }.into_any(); }
            view! {
                <div class="ann-banner-stack">
                    {list.into_iter().map(|a| {
                        let cls = variant_class(&a.variant);
                        view! {
                            <div class=cls>
                                <strong>{a.title}</strong>
                                " — "
                                {a.message}
                            </div>
                        }
                    }).collect::<Vec<_>>()}
                </div>
            }.into_any()
        }}
    }
}
