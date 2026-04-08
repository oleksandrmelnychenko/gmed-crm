use crate::api::client;
use crate::app::WorkspaceToolbar;
use crate::i18n::{self, Lang};
use crate::session::{CurrentUserContext, role_display_name};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Clone, Debug)]
struct Notification {
    id: String,
    kind: String,
    title: String,
    body: Option<String>,
    is_read: bool,
    created_at: String,
}

#[derive(Deserialize, Clone, Debug)]
struct ActiveAnnouncement {
    title: String,
    message: String,
    variant: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct ActiveSession {
    user_id: String,
    user_name: String,
    user_email: String,
    role: String,
}

#[derive(Deserialize, Clone, Debug)]
struct ChatMessage {
    from_user: String,
    message: String,
    created_at: String,
}

#[derive(Serialize)]
struct SendReq {
    message: String,
}

fn compact_dt(dt: &str) -> String {
    dt.replace('T', " ").chars().take(16).collect()
}

fn compact_time(dt: &str) -> String {
    if let Some(t_pos) = dt.find('T') {
        dt[t_pos + 1..].chars().take(5).collect()
    } else {
        dt.chars().take(5).collect()
    }
}

fn kind_icon(kind: &str) -> &'static str {
    match kind {
        "new_lead" => "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2",
        _ => "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9",
    }
}

fn initials(name: &str) -> String {
    name.split_whitespace()
        .take(2)
        .filter_map(|w| w.chars().next())
        .map(|c| c.to_uppercase().to_string())
        .collect()
}

#[component]
pub fn Topbar() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let set_lang = use_context::<WriteSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    let (notifs, set_notifs) = signal(Vec::<Notification>::new());
    let (announcements, set_announcements) = signal(Vec::<ActiveAnnouncement>::new());
    let (unread, set_unread) = signal(0_i64);
    let (notif_open, set_notif_open) = signal(false);
    let (online_users, set_online_users) = signal(Vec::<ActiveSession>::new());
    let (users_open, set_users_open) = signal(false);
    let (chat_user, set_chat_user) = signal(Option::<ActiveSession>::None);
    let (chat_msgs, set_chat_msgs) = signal(Vec::<ChatMessage>::new());
    let (chat_input, set_chat_input) = signal(String::new());
    let (reload, set_reload) = signal(0_u32);

    Effect::new(move |_| {
        let _ = reload.get();
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(r) = client::get::<Value>("/notifications/unread-count").await {
                set_unread.set(r["count"].as_i64().unwrap_or(0));
            }
            if let Ok(users) = client::get::<Vec<ActiveSession>>("/users/online").await {
                set_online_users.set(users);
            }
        });
    });

    let open_notif = move |_| {
        set_notif_open.set(!notif_open.get());
        set_users_open.set(false);
        if !notif_open.get() {
            return;
        }
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(list) = client::get::<Vec<Notification>>("/notifications").await {
                set_notifs.set(list);
            }
            if let Ok(ann) = client::get::<Vec<ActiveAnnouncement>>("/announcements/active").await {
                set_announcements.set(ann);
            }
        });
    };

    let open_users = move |_: web_sys::MouseEvent| {
        set_users_open.set(!users_open.get());
        set_notif_open.set(false);
    };

    let open_chat = move |user: ActiveSession| {
        let uid = user.user_id.clone();
        set_chat_user.set(Some(user));
        set_users_open.set(false);
        set_chat_input.set(String::new());
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(msgs) = client::get::<Vec<ChatMessage>>(&format!("/messages/{uid}")).await {
                set_chat_msgs.set(msgs);
            }
            let _ = client::post_no_body(&format!("/messages/{uid}/read")).await;
        });
    };

    let send_msg = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let msg = chat_input.get();
        if msg.trim().is_empty() {
            return;
        }
        let Some(user) = chat_user.get() else {
            return;
        };
        let uid = user.user_id.clone();
        set_chat_input.set(String::new());
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<SendReq, Value>(
                &format!("/messages/{uid}"),
                &SendReq { message: msg },
            )
            .await;
            if let Ok(msgs) = client::get::<Vec<ChatMessage>>(&format!("/messages/{uid}")).await {
                set_chat_msgs.set(msgs);
            }
        });
    };

    let close_chat = move |_| {
        set_chat_user.set(None);
    };

    let mark_all = move |_| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body("/notifications/read-all").await;
            set_unread.set(0);
            set_notifs.update(|list| {
                for n in list.iter_mut() {
                    n.is_read = true;
                }
            });
        });
    };

    let mark_one = move |id: String| {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post_no_body(&format!("/notifications/{id}/read")).await;
            set_reload.update(|v| *v += 1);
        });
    };

    let toggle_lang = move |_| {
        let new_lang = match lang.get() {
            Lang::De => Lang::Ru,
            Lang::Ru => Lang::De,
        };
        i18n::switch_lang(set_lang, new_lang);
    };

    let my_user_id = move || current_user.user.get().map(|u| u.id).unwrap_or_default();

    view! {
        <header class="topbar">
            <div class="topbar-left">
                <span class="breadcrumb-item">"GMED CRM"</span>
            </div>
            <div class="topbar-right">
                // Online users avatars
                {move || {
                    let users = online_users.get();
                    let count = users.len();
                    if count == 0 { return view! { <div></div> }.into_any(); }
                    let max_show = 8_usize;
                    let show: Vec<ActiveSession> = if count > max_show { users[..max_show].to_vec() } else { users.clone() };
                    let overflow = count.saturating_sub(max_show);
                    let size = if count <= 5 { 28 } else if count <= 10 { 24 } else if count <= 15 { 20 } else { 18 };
                    let overlap = if count <= 5 { -6 } else if count <= 10 { -8 } else { -10 };

                    view! {
                        <div class="online-avatars" style="cursor:pointer" on:click=open_users>
                            {show.into_iter().enumerate().map(|(i, u)| {
                                let ini = initials(&u.user_name);
                                let ml = if i == 0 { 0 } else { overlap };
                                view! {
                                    <div class="avatar" title={u.user_name.clone()}
                                        style={format!("width:{}px;height:{}px;font-size:{}px;margin-left:{}px;border:2px solid var(--bg);z-index:{}", size, size, size/2 - 1, ml, 20-i)}>
                                        {ini}
                                    </div>
                                }
                            }).collect::<Vec<_>>()}
                            {if overflow > 0 {
                                view! {
                                    <div class="avatar" style={format!("width:{}px;height:{}px;font-size:{}px;margin-left:{}px;background:var(--text-tertiary)", size, size, size/2 - 1, overlap)}>
                                        {format!("+{}", overflow)}
                                    </div>
                                }.into_any()
                            } else { view! { <span></span> }.into_any() }}
                        </div>
                    }.into_any()
                }}

                {move || current_user.user.get().map(|user| view! {
                    <div class="topbar-user">
                        <div class="topbar-user-name">{user.name}</div>
                        <span class="tag tag--gray">{role_display_name(&user.role)}</span>
                    </div>
                })}

                <button class="notif-bell" on:click=open_notif>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
                    </svg>
                    {move || { let c = unread.get(); if c > 0 { view! { <span class="notif-badge">{c}</span> }.into_any() } else { view! { <span></span> }.into_any() }}}
                </button>

                <WorkspaceToolbar />

                <div class="search-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>{move || i18n::t(lang.get()).common_search}</span>
                    <kbd>"/"</kbd>
                </div>
                <button class="lang-switch" on:click=toggle_lang>
                    {move || { let l = lang.get(); format!("{} {}", l.flag(), l.code().to_uppercase()) }}
                </button>
            </div>
        </header>

        // Users dropdown
        {move || {
            if !users_open.get() { return view! { <div></div> }.into_any(); }
            let users = online_users.get();
            view! {
                <div class="notif-overlay" on:click=move |_| set_users_open.set(false)></div>
                <div class="notif-panel" style="width:320px">
                    <div class="notif-panel-header">
                        <h3 style="font-size:15px;font-weight:600">{format!("Online ({})", users.len())}</h3>
                    </div>
                    <div class="notif-panel-body">
                        <div class="notif-list">
                            {users.into_iter().map(|u| {
                                let ini = initials(&u.user_name);
                                let u2 = u.clone();
                                view! {
                                    <div class="notif-item" on:click=move |_| open_chat(u2.clone())>
                                        <div class="avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0">{ini}</div>
                                        <div class="notif-item-content">
                                            <div class="notif-item-title">{u.user_name}</div>
                                            <div class="notif-item-body">{role_display_name(&u.role)}</div>
                                        </div>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--primary)">
                                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                                        </svg>
                                    </div>
                                }
                            }).collect::<Vec<_>>()}
                        </div>
                    </div>
                </div>
            }.into_any()
        }}

        // Notification panel
        {move || {
            if !notif_open.get() { return view! { <div></div> }.into_any(); }
            let list = notifs.get();
            view! {
                <div class="notif-overlay" on:click=move |_| set_notif_open.set(false)></div>
                <div class="notif-panel">
                    <div class="notif-panel-header">
                        <h3 style="font-size:15px;font-weight:600">"Notifications"</h3>
                        <button class="btn-small" on:click=mark_all>"✓ All"</button>
                    </div>
                    <div class="notif-panel-body">
                        {let anns = announcements.get(); if !anns.is_empty() {
                            view! {
                                <div class="notif-announcements">
                                    {anns.into_iter().map(|a| {
                                        let cls = match a.variant.as_str() {
                                            "warning" => "ann-banner ann-warning",
                                            "error" => "ann-banner ann-error",
                                            "success" => "ann-banner ann-success",
                                            _ => "ann-banner ann-info",
                                        };
                                        view! {
                                            <div class=cls style="font-size:12px;padding:8px 14px">
                                                <strong>{a.title}</strong>" — "{a.message}
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            }.into_any()
                        } else { view! { <div></div> }.into_any() }}
                        {if list.is_empty() {
                            view! { <div class="empty-state" style="padding:32px;text-align:center">"—"</div> }.into_any()
                        } else {
                            view! {
                                <div class="notif-list">
                                    {list.into_iter().map(|n| {
                                        let id = n.id.clone();
                                        let cls = if n.is_read { "notif-item read" } else { "notif-item unread" };
                                        let icon_d = kind_icon(&n.kind);
                                        let time = compact_dt(&n.created_at);
                                        view! {
                                            <div class=cls on:click=move |_| mark_one(id.clone())>
                                                <div class="notif-item-icon">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d=icon_d/></svg>
                                                </div>
                                                <div class="notif-item-content">
                                                    <div class="notif-item-title">{n.title}</div>
                                                    {n.body.map(|b| view! { <div class="notif-item-body">{b}</div> })}
                                                    <div class="notif-item-time">{time}</div>
                                                </div>
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            }.into_any()
                        }}
                    </div>
                </div>
            }.into_any()
        }}

        // Chat window
        {move || {
            let Some(user) = chat_user.get() else { return view! { <div></div> }.into_any(); };
            let msgs = chat_msgs.get();
            let my_id = my_user_id();
            let ini = initials(&user.user_name);
            view! {
                <div class="chat-window">
                    <div class="chat-header">
                        <div style="display:flex;align-items:center;gap:8px">
                            <div class="avatar" style="width:28px;height:28px;font-size:11px">{ini}</div>
                            <div>
                                <div style="font-size:13px;font-weight:600">{user.user_name.clone()}</div>
                                <div style="font-size:11px;color:var(--text-tertiary)">{role_display_name(&user.role)}</div>
                            </div>
                        </div>
                        <button class="chat-close" on:click=close_chat>"×"</button>
                    </div>
                    <div class="chat-body">
                        {msgs.into_iter().rev().map(|m| {
                            let is_mine = m.from_user == my_id;
                            let cls = if is_mine { "chat-msg mine" } else { "chat-msg theirs" };
                            let time = compact_time(&m.created_at);
                            view! {
                                <div class=cls>
                                    <div class="chat-msg-text">{m.message}</div>
                                    <div class="chat-msg-time">{time}</div>
                                </div>
                            }
                        }).collect::<Vec<_>>()}
                    </div>
                    <form class="chat-input-bar" on:submit=send_msg>
                        <input type="text" class="chat-input" placeholder="..."
                            prop:value=chat_input on:input=move |ev| set_chat_input.set(event_target_value(&ev)) />
                        <button type="submit" class="chat-send">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                    </form>
                </div>
            }.into_any()
        }}
    }
}
