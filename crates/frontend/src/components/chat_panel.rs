//! Compact chat panel that lives inside the workspace side panel.
//! Reuses the same /messages API as the full chat page.

use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::CurrentUserContext;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsCast;

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct Conversation {
    user_id: String,
    name: String,
    role: String,
    last_message: String,
    last_at: String,
    is_read: bool,
    is_mine: bool,
    unread: i64,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Msg {
    id: String,
    from_user: String,
    to_user: String,
    message: Option<String>,
    is_read: bool,
    created_at: String,
    attachment_filename: Option<String>,
    attachment_key: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct UserItem {
    id: String,
    name: String,
    role: String,
    #[serde(default)]
    is_active: bool,
}

#[derive(Serialize)]
struct SendReq {
    message: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct SendResp {
    ok: bool,
    id: String,
}

fn ini(name: &str) -> String {
    name.split_whitespace()
        .take(2)
        .filter_map(|w| w.chars().next())
        .map(|c| c.to_uppercase().to_string())
        .collect()
}

fn short_time(iso: &str) -> String {
    if let Some(t) = iso.find('T') {
        iso[t + 1..].chars().take(5).collect()
    } else {
        iso.chars().take(5).collect()
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..s.floor_char_boundary(max)])
    }
}

/// Compact chat panel — shows conversation list or message thread.
#[component]
pub fn ChatPanel() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    let (convos, set_convos) = signal(Vec::<Conversation>::new());
    let (msgs, set_msgs) = signal(Vec::<Msg>::new());
    let (peer_id, set_peer_id) = signal(Option::<String>::None);
    let (peer_name, set_peer_name) = signal(String::new());
    let (peer_role, set_peer_role) = signal(String::new());
    let (input, set_input) = signal(String::new());
    let (sending, set_sending) = signal(false);
    let (search, set_search) = signal(String::new());
    let (show_users, set_show_users) = signal(false);
    let (all_users, set_all_users) = signal(Vec::<UserItem>::new());
    let (reload, set_reload) = signal(0u32);

    // Load conversations
    Effect::new(move |_| {
        let _ = reload.get();
        wasm_bindgen_futures::spawn_local(async move {
            let c = client::get::<Vec<Conversation>>("/messages/conversations")
                .await
                .unwrap_or_default();
            set_convos.set(c);
        });
    });

    // Load messages on peer change
    Effect::new(move |_| {
        if let Some(pid) = peer_id.get() {
            wasm_bindgen_futures::spawn_local(async move {
                let m = client::get::<Vec<Msg>>(&format!("/messages/{pid}?limit=50"))
                    .await
                    .unwrap_or_default();
                set_msgs.set(m);
                let _ = client::post_no_body(&format!("/messages/{pid}/read")).await;
                set_reload.update(|n| *n += 1);
            });
        }
    });

    // Poll every 8 seconds
    Effect::new(move |_| {
        let handle = gloo_timers::callback::Interval::new(8_000, move || {
            wasm_bindgen_futures::spawn_local(async move {
                let c = client::get::<Vec<Conversation>>("/messages/conversations")
                    .await
                    .unwrap_or_default();
                set_convos.set(c);
                if let Some(pid) = peer_id.get_untracked() {
                    let m = client::get::<Vec<Msg>>(&format!("/messages/{pid}?limit=50"))
                        .await
                        .unwrap_or_default();
                    set_msgs.set(m);
                }
            });
        });
        std::mem::forget(handle);
    });

    let open_peer = move |uid: String, name: String, role: String| {
        set_peer_id.set(Some(uid));
        set_peer_name.set(name);
        set_peer_role.set(role);
        set_show_users.set(false);
    };

    let go_back = move |_| {
        set_peer_id.set(None);
        set_msgs.set(Vec::new());
    };

    let send = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();
        let txt = input.get().trim().to_string();
        if txt.is_empty() || sending.get() {
            return;
        }
        let pid = match peer_id.get() {
            Some(id) => id,
            None => return,
        };
        set_sending.set(true);
        set_input.set(String::new());
        wasm_bindgen_futures::spawn_local(async move {
            let _ = client::post::<SendReq, SendResp>(
                &format!("/messages/{pid}"),
                &SendReq { message: txt },
            )
            .await;
            let m = client::get::<Vec<Msg>>(&format!("/messages/{pid}?limit=50"))
                .await
                .unwrap_or_default();
            set_msgs.set(m);
            set_reload.update(|n| *n += 1);
            set_sending.set(false);
        });
    };

    // File upload
    let on_file = move |ev: web_sys::Event| {
        let el: web_sys::HtmlInputElement = ev.target().unwrap().unchecked_into();
        let file = match el.files().and_then(|f| f.get(0)) {
            Some(f) => f,
            None => return,
        };
        el.set_value("");
        let pid = match peer_id.get_untracked() {
            Some(id) => id,
            None => return,
        };
        set_sending.set(true);
        wasm_bindgen_futures::spawn_local(async move {
            let _: Result<serde_json::Value, _> =
                client::upload_file(&format!("/messages/{pid}/upload"), &file, None).await;
            let m = client::get::<Vec<Msg>>(&format!("/messages/{pid}?limit=50"))
                .await
                .unwrap_or_default();
            set_msgs.set(m);
            set_reload.update(|n| *n += 1);
            set_sending.set(false);
        });
    };

    let load_users = move || {
        wasm_bindgen_futures::spawn_local(async move {
            let u = client::get::<Vec<UserItem>>("/users")
                .await
                .unwrap_or_default();
            set_all_users.set(u);
        });
    };

    view! {
        <div class="cpanel">
            {move || {
                let tr = i18n::t(lang.get());

                // ── Thread view ──
                if peer_id.get().is_some() {
                    let pname = peer_name.get();
                    let prole = peer_role.get();
                    let pini = ini(&pname);
                    let my_id = current_user.user.get().map(|u| u.id.clone()).unwrap_or_default();
                    let mut display = msgs.get();
                    display.reverse();

                    return view! {
                        <div class="cpanel-header">
                            <button class="cpanel-back" on:click=go_back>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="15 18 9 12 15 6"/>
                                </svg>
                            </button>
                            <div class="chat-avatar cpanel-av">{pini}</div>
                            <div class="cpanel-peer-info">
                                <span class="cpanel-peer-name">{pname}</span>
                                <span class="cpanel-peer-role">{crate::session::role_display_name(&prole)}</span>
                            </div>
                        </div>
                        <div class="cpanel-msgs">
                            {display.into_iter().map(|m| {
                                let mine = m.from_user == my_id;
                                let cls = if mine { "cpanel-msg mine" } else { "cpanel-msg theirs" };
                                let txt = m.message.unwrap_or_default();
                                let time = short_time(&m.created_at);
                                let has_file = m.attachment_filename.is_some();
                                let fname = m.attachment_filename.unwrap_or_default();
                                let fkey = m.attachment_key.unwrap_or_default();
                                view! {
                                    <div class=cls>
                                        {if has_file {
                                            let url = format!("http://localhost:3000/api/v1/messages/file/{fkey}");
                                            view! {
                                                <a href=url target="_blank" class="cpanel-file-link">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                                        <polyline points="14 2 14 8 20 8"/>
                                                    </svg>
                                                    {fname}
                                                </a>
                                            }.into_any()
                                        } else {
                                            view! { <span></span> }.into_any()
                                        }}
                                        {if !txt.is_empty() {
                                            view! { <span class="cpanel-msg-text">{txt}</span> }.into_any()
                                        } else {
                                            view! { <span></span> }.into_any()
                                        }}
                                        <span class="cpanel-msg-time">{time}</span>
                                    </div>
                                }
                            }).collect::<Vec<_>>()}
                        </div>
                        <form class="cpanel-input" on:submit=send>
                            <label class="cpanel-attach">
                                <input type="file" style="display:none" on:change=on_file />
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                                </svg>
                            </label>
                            <input type="text" placeholder=tr.chat_type_message
                                prop:value=input on:input=move |ev| set_input.set(event_target_value(&ev)) autocomplete="off" />
                            <button type="submit" disabled=sending>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                </svg>
                            </button>
                        </form>
                    }.into_any();
                }

                // ── Conversation list ──
                let all = convos.get();
                let q = search.get().to_lowercase();
                let filtered: Vec<_> = all.into_iter()
                    .filter(|c| q.is_empty() || c.name.to_lowercase().contains(&q))
                    .collect();

                view! {
                    <div class="cpanel-header">
                        <span class="cpanel-title">{tr.chat_title}</span>
                        <button class="cpanel-new-btn" on:click=move |_| {
                            set_show_users.set(!show_users.get());
                            if show_users.get() { load_users(); }
                        }>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                        </button>
                    </div>
                    <div class="cpanel-search">
                        <input type="text" placeholder=tr.common_search
                            prop:value=search on:input=move |ev| set_search.set(event_target_value(&ev)) />
                    </div>
                    // User picker
                    {move || {
                        if !show_users.get() { return view! { <span></span> }.into_any(); }
                        let my_id = current_user.user.get().map(|u| u.id.clone()).unwrap_or_default();
                        let users: Vec<_> = all_users.get().into_iter().filter(|u| u.is_active && u.id != my_id).collect();
                        view! {
                            <div class="cpanel-user-picker">
                                {users.into_iter().map(|u| {
                                    let uid = u.id.clone();
                                    let uname = u.name.clone();
                                    let urole = u.role.clone();
                                    view! {
                                        <div class="cpanel-user-row" on:click=move |_| open_peer(uid.clone(), uname.clone(), urole.clone())>
                                            <div class="chat-avatar cpanel-av">{ini(&u.name)}</div>
                                            <span class="cpanel-user-name">{u.name}</span>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        }.into_any()
                    }}
                    <div class="cpanel-list">
                        {if filtered.is_empty() {
                            view! { <div class="cpanel-empty">{tr.chat_no_conversations}</div> }.into_any()
                        } else {
                            view! {
                                <div>
                                    {filtered.into_iter().map(|c| {
                                        let uid = c.user_id.clone();
                                        let uname = c.name.clone();
                                        let urole = c.role.clone();
                                        let has_unread = c.unread > 0;
                                        let preview = if c.is_mine { format!("{}: {}", tr.chat_you, truncate(&c.last_message, 30)) } else { truncate(&c.last_message, 40) };
                                        view! {
                                            <div class="cpanel-conv" on:click=move |_| open_peer(uid.clone(), uname.clone(), urole.clone())>
                                                <div class="chat-avatar cpanel-av">{ini(&c.name)}</div>
                                                <div class="cpanel-conv-info">
                                                    <div class="cpanel-conv-top">
                                                        <span class="cpanel-conv-name">{c.name}</span>
                                                        <span class="cpanel-conv-time">{short_time(&c.last_at)}</span>
                                                    </div>
                                                    <div class={if has_unread { "cpanel-conv-preview unread" } else { "cpanel-conv-preview" }}>{preview}</div>
                                                </div>
                                                {if has_unread {
                                                    view! { <span class="chat-badge" style="font-size:10px;min-width:16px;height:16px;padding:0 4px">{c.unread.to_string()}</span> }.into_any()
                                                } else {
                                                    view! { <span></span> }.into_any()
                                                }}
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            }.into_any()
                        }}
                    </div>
                }.into_any()
            }}
        </div>
    }
}
