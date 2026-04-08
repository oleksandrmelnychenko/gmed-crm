use crate::api::client;
use crate::i18n::{self, Lang};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct IpEntry {
    id: String,
    cidr: String,
    description: Option<String>,
    is_active: bool,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct GeoLogin {
    user_name: String,
    user_email: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    geo_data: Option<Value>,
    created_at: String,
    is_revoked: bool,
}

#[derive(Serialize)]
struct AddIpReq {
    cidr: String,
    description: Option<String>,
}
#[derive(Serialize)]
struct MaintenanceReq {
    enabled: bool,
    message: Option<String>,
}

fn compact_dt(dt: &str) -> String {
    dt.replace('T', " ").chars().take(19).collect()
}
fn short_ua(ua: &Option<String>) -> String {
    match ua {
        Some(s) if s.len() > 50 => format!("{}…", &s[..50]),
        Some(s) => s.clone(),
        None => "—".into(),
    }
}

#[component]
pub fn AdminSecurity() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let (ips, set_ips) = signal(Vec::<IpEntry>::new());
    let (geo, set_geo) = signal(Vec::<GeoLogin>::new());
    let (loading, set_loading) = signal(true);
    let (reload, set_reload) = signal(0_u32);
    let (new_cidr, set_new_cidr) = signal(String::new());
    let (new_desc, set_new_desc) = signal(String::new());
    let (maint_enabled, set_maint_enabled) = signal(false);
    let (maint_msg, set_maint_msg) = signal(String::new());

    Effect::new(move |_| {
        let _ = reload.get();
        set_loading.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            set_ips.set(
                client::get::<Vec<IpEntry>>("/admin/ip-whitelist")
                    .await
                    .unwrap_or_default(),
            );
            set_geo.set(
                client::get::<Vec<GeoLogin>>("/admin/login-geo")
                    .await
                    .unwrap_or_default(),
            );

            if let Ok(settings) = client::get::<Vec<Value>>("/admin/settings").await {
                for s in &settings {
                    if s["key"] == "maintenance_mode" {
                        set_maint_enabled.set(
                            s["value"].as_str().unwrap_or("false").trim_matches('"') == "true",
                        );
                    }
                    if s["key"] == "maintenance_message" {
                        set_maint_msg.set(
                            s["value"]
                                .as_str()
                                .unwrap_or("")
                                .trim_matches('"')
                                .to_string(),
                        );
                    }
                }
            }
            set_loading.set(false);
        });
    });

    let add_ip = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let cidr = new_cidr.get();
        if cidr.trim().is_empty() {
            return;
        }
        let desc = {
            let d = new_desc.get();
            if d.trim().is_empty() { None } else { Some(d) }
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<AddIpReq, Value>(
                "/admin/ip-whitelist",
                &AddIpReq {
                    cidr,
                    description: desc,
                },
            )
            .await;
            set_new_cidr.set(String::new());
            set_new_desc.set(String::new());
            set_reload.update(|v| *v += 1);
        });
    };

    let delete_ip = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/admin/ip-whitelist/{id}/delete")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let toggle_maintenance = move |enable: bool| {
        let msg = if maint_msg.get().trim().is_empty() {
            None
        } else {
            Some(maint_msg.get())
        };
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<MaintenanceReq, Value>(
                "/admin/maintenance",
                &MaintenanceReq {
                    enabled: enable,
                    message: msg,
                },
            )
            .await;
            set_reload.update(|v| *v += 1);
        });
    };

    view! {
        <div class="page">
            <div class="page-header">
                <div>
                    <h1>{move || i18n::t(lang.get()).security_title}</h1>
                    <p class="page-subtitle">{move || i18n::t(lang.get()).security_subtitle}</p>
                </div>
            </div>

            {move || {
                let tr = i18n::t(lang.get());
                if loading.get() { return view! { <div class="page-loading">{tr.common_loading}</div> }.into_any(); }

                let ip_list = ips.get();
                let geo_list = geo.get();
                let maint = maint_enabled.get();

                view! {
                    <div class="card" style="margin-bottom:24px">
                        <div class="card-header"><h2>{tr.security_maintenance}</h2></div>
                        <div class="create-form">
                            <div class="form-row">
                                <div class="form-field" style="flex:2">
                                    <label>{tr.security_maintenance_msg}</label>
                                    <input type="text" prop:value=maint_msg on:input=move |ev| set_maint_msg.set(event_target_value(&ev)) />
                                </div>
                                <div class="form-field" style="flex:0 0 auto;align-self:end">
                                    {if maint {
                                        view! { <button class="btn-primary" style="background:var(--success);border-color:var(--success)" on:click=move |_| toggle_maintenance(false)>{tr.security_maintenance_off}</button> }.into_any()
                                    } else {
                                        view! { <button class="btn-primary" style="background:var(--error);border-color:var(--error)" on:click=move |_| toggle_maintenance(true)>{tr.security_maintenance_on}</button> }.into_any()
                                    }}
                                </div>
                            </div>
                            {if maint { view! { <div class="tag tag--red" style="margin-top:8px">{tr.security_maintenance}" ON"</div> }.into_any() } else { view! { <span></span> }.into_any() }}
                        </div>
                    </div>

                    <div class="card" style="margin-bottom:24px">
                        <div class="card-header"><h2>{tr.security_ip_whitelist}</h2></div>
                        <form class="create-form" on:submit=add_ip>
                            <div class="form-row">
                                <div class="form-field"><label>{tr.security_ip_cidr}</label><input type="text" required placeholder="10.0.0.0/8" prop:value=new_cidr on:input=move |ev| set_new_cidr.set(event_target_value(&ev)) /></div>
                                <div class="form-field"><label>{tr.security_ip_desc}</label><input type="text" prop:value=new_desc on:input=move |ev| set_new_desc.set(event_target_value(&ev)) /></div>
                                <div class="form-field" style="flex:0 0 auto;align-self:end"><button type="submit" class="btn-primary">{tr.security_ip_add}</button></div>
                            </div>
                        </form>
                        {if ip_list.is_empty() {
                            view! { <div class="empty-state">{tr.security_ip_none}</div> }.into_any()
                        } else {
                            view! {
                                <table class="data-table">
                                    <thead><tr><th>"CIDR"</th><th>{tr.security_ip_desc}</th><th>{tr.users_actions}</th></tr></thead>
                                    <tbody>
                                        {ip_list.into_iter().map(|ip| {
                                            let id = ip.id.clone();
                                            view! {
                                                <tr>
                                                    <td class="cell-mono">{ip.cidr}</td>
                                                    <td>{ip.description.unwrap_or_default()}</td>
                                                    <td><button class="btn-small" style="color:var(--error)" on:click=move |_| delete_ip(id.clone())>{tr.common_delete}</button></td>
                                                </tr>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </tbody>
                                </table>
                            }.into_any()
                        }}
                    </div>

                    <div class="card">
                        <div class="card-header"><h2>{format!("{} ({})", tr.security_login_history, geo_list.len())}</h2></div>
                        <table class="data-table">
                            <thead><tr>
                                <th>{tr.activity_time}</th>
                                <th>{tr.activity_user}</th>
                                <th>{tr.common_ip}</th>
                                <th>{tr.common_device}</th>
                                <th>{tr.users_status}</th>
                            </tr></thead>
                            <tbody>
                                {geo_list.into_iter().map(|g| {
                                    let time = compact_dt(&g.created_at);
                                    let ua = short_ua(&g.user_agent);
                                    let status_cls = if g.is_revoked { "tag tag--red" } else { "tag tag--green" };
                                    let status_txt = if g.is_revoked { tr.compliance_revoked } else { tr.providers_active };
                                    view! {
                                        <tr>
                                            <td class="cell-mono cell-dim" style="white-space:nowrap">{time}</td>
                                            <td>
                                                <div class="cell-primary" style="font-size:13px">{g.user_name}</div>
                                                <div class="cell-dim" style="font-size:11px">{g.user_email}</div>
                                            </td>
                                            <td class="cell-mono">{g.ip_address.unwrap_or_default()}</td>
                                            <td class="cell-dim" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={ua.clone()}>{ua.clone()}</td>
                                            <td><span class=status_cls>{status_txt}</span></td>
                                        </tr>
                                    }
                                }).collect::<Vec<_>>()}
                            </tbody>
                        </table>
                    </div>
                }.into_any()
            }}
        </div>
    }
}
