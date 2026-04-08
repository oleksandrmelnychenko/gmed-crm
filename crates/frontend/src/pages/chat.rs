use crate::api::client;
use crate::i18n::{self, Lang};
use crate::session::CurrentUserContext;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsCast;

// ── API types ──

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug, Default)]
struct Conversation {
    user_id: String,
    name: String,
    email: String,
    role: String,
    last_message: String,
    last_at: String,
    is_read: bool,
    is_mine: bool,
    unread: i64,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct Message {
    id: String,
    from_user: String,
    to_user: String,
    message: Option<String>,
    is_read: bool,
    created_at: String,
    attachment_filename: Option<String>,
    attachment_mime: Option<String>,
    attachment_size: Option<i64>,
    attachment_key: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct UserItem {
    id: String,
    name: String,
    email: String,
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
    created_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
struct UploadResp {
    ok: bool,
    id: String,
    created_at: String,
    attachment_key: String,
    attachment_filename: String,
    attachment_mime: String,
    attachment_size: i64,
}

fn time_ago(iso: &str, _tr: &crate::i18n::Translations) -> String {
    if let Some(t_pos) = iso.find('T') {
        let time = &iso[t_pos + 1..];
        let hm = time.split(':').take(2).collect::<Vec<_>>().join(":");
        let date_part = &iso[..t_pos];
        if date_part.contains("2026-04-08") {
            hm
        } else {
            format!(
                "{} {}",
                date_part.split('-').skip(1).collect::<Vec<_>>().join("."),
                hm
            )
        }
    } else {
        iso.split('.').next().unwrap_or(iso).replace('T', " ")
    }
}

fn initial(name: &str) -> String {
    let mut chars = name.split_whitespace();
    let first = chars.next().and_then(|w| w.chars().next()).unwrap_or('?');
    let second = chars.next().and_then(|w| w.chars().next());
    match second {
        Some(c) => format!("{}{}", first.to_uppercase(), c.to_uppercase()),
        None => first.to_uppercase().to_string(),
    }
}

fn format_size(bytes: i64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn is_image_mime(mime: &str) -> bool {
    mime.starts_with("image/")
}

fn file_icon_class(mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "chat-file-icon image"
    } else if mime.contains("pdf") {
        "chat-file-icon pdf"
    } else if mime.contains("word") || mime.contains("document") {
        "chat-file-icon doc"
    } else if mime.contains("sheet") || mime.contains("excel") || mime.contains("csv") {
        "chat-file-icon sheet"
    } else {
        "chat-file-icon generic"
    }
}

const FILE_DOWNLOAD_BASE: &str = "http://localhost:3000/api/v1/messages/file/";

#[component]
pub fn Chat() -> impl IntoView {
    let lang = use_context::<ReadSignal<Lang>>().unwrap();
    let current_user = use_context::<CurrentUserContext>().unwrap();

    // State
    let (conversations, set_conversations) = signal(Vec::<Conversation>::new());
    let (messages, set_messages) = signal(Vec::<Message>::new());
    let (active_peer, set_active_peer) = signal(Option::<String>::None);
    let (active_name, set_active_name) = signal(String::new());
    let (active_role, set_active_role) = signal(String::new());
    let (input, set_input) = signal(String::new());
    let (loading, set_loading) = signal(true);
    let (sending, set_sending) = signal(false);
    let (search, set_search) = signal(String::new());
    let (show_new_chat, set_show_new_chat) = signal(false);
    let (all_users, set_all_users) = signal(Vec::<UserItem>::new());
    let (user_search, set_user_search) = signal(String::new());
    let (reload, set_reload) = signal(0u32);
    let (pending_file, set_pending_file) = signal(Option::<web_sys::File>::None);
    let (uploading, set_uploading) = signal(false);

    // Load conversations
    Effect::new(move |_| {
        let _ = reload.get();
        wasm_bindgen_futures::spawn_local(async move {
            let convos = client::get::<Vec<Conversation>>("/messages/conversations")
                .await
                .unwrap_or_default();
            set_conversations.set(convos);
            set_loading.set(false);
        });
    });

    // Load messages when active peer changes
    Effect::new(move |_| {
        let peer = active_peer.get();
        if let Some(peer_id) = peer {
            wasm_bindgen_futures::spawn_local(async move {
                let msgs = client::get::<Vec<Message>>(&format!("/messages/{peer_id}?limit=100"))
                    .await
                    .unwrap_or_default();
                set_messages.set(msgs);
                let _ = client::post_no_body(&format!("/messages/{peer_id}/read")).await;
                let convos = client::get::<Vec<Conversation>>("/messages/conversations")
                    .await
                    .unwrap_or_default();
                set_conversations.set(convos);
            });
        } else {
            set_messages.set(Vec::new());
        }
    });

    // Send text message
    let send_message = move |ev: web_sys::SubmitEvent| {
        ev.prevent_default();

        // If there's a pending file, upload it instead
        if let Some(file) = pending_file.get_untracked() {
            let msg = input.get_untracked().trim().to_string();
            let peer_id = match active_peer.get_untracked() {
                Some(id) => id,
                None => return,
            };
            set_uploading.set(true);
            set_sending.set(true);
            set_input.set(String::new());
            set_pending_file.set(None);
            wasm_bindgen_futures::spawn_local(async move {
                let msg_opt = if msg.is_empty() {
                    None
                } else {
                    Some(msg.as_str())
                };
                let _: Result<UploadResp, _> =
                    client::upload_file(&format!("/messages/{peer_id}/upload"), &file, msg_opt)
                        .await;
                // Refresh
                let msgs = client::get::<Vec<Message>>(&format!("/messages/{peer_id}?limit=100"))
                    .await
                    .unwrap_or_default();
                set_messages.set(msgs);
                set_reload.update(|n| *n += 1);
                set_uploading.set(false);
                set_sending.set(false);
            });
            return;
        }

        let msg = input.get().trim().to_string();
        if msg.is_empty() || sending.get() {
            return;
        }
        let peer_id = match active_peer.get() {
            Some(id) => id,
            None => return,
        };
        set_sending.set(true);
        set_input.set(String::new());
        wasm_bindgen_futures::spawn_local(async move {
            let body = SendReq { message: msg };
            if client::post::<SendReq, SendResp>(&format!("/messages/{peer_id}"), &body)
                .await
                .is_ok()
            {
                let msgs = client::get::<Vec<Message>>(&format!("/messages/{peer_id}?limit=100"))
                    .await
                    .unwrap_or_default();
                set_messages.set(msgs);
                set_reload.update(|n| *n += 1);
            }
            set_sending.set(false);
        });
    };

    // File input handler
    let on_file_change = move |ev: web_sys::Event| {
        let target = ev.target().unwrap();
        let input_el: web_sys::HtmlInputElement = target.unchecked_into();
        if let Some(files) = input_el.files()
            && let Some(file) = files.get(0)
        {
            set_pending_file.set(Some(file));
        }
        // Reset the input so same file can be re-selected
        input_el.set_value("");
    };

    // Open conversation with a user
    let open_conversation = move |user_id: String, name: String, role: String| {
        set_active_peer.set(Some(user_id));
        set_active_name.set(name);
        set_active_role.set(role);
        set_show_new_chat.set(false);
        set_pending_file.set(None);
    };

    // Load all users for new chat dialog
    let load_users = move || {
        wasm_bindgen_futures::spawn_local(async move {
            let users = client::get::<Vec<UserItem>>("/users")
                .await
                .unwrap_or_default();
            set_all_users.set(users);
        });
    };

    // Polling: refresh conversations every 10 seconds
    Effect::new(move |_| {
        let handle = gloo_timers::callback::Interval::new(10_000, move || {
            wasm_bindgen_futures::spawn_local(async move {
                let convos = client::get::<Vec<Conversation>>("/messages/conversations")
                    .await
                    .unwrap_or_default();
                set_conversations.set(convos);
                if let Some(peer_id) = active_peer.get_untracked() {
                    let msgs =
                        client::get::<Vec<Message>>(&format!("/messages/{peer_id}?limit=100"))
                            .await
                            .unwrap_or_default();
                    set_messages.set(msgs);
                }
            });
        });
        std::mem::forget(handle);
    });

    view! {
        <div class="chat-page">
            // ── Left panel: conversation list ──
            <div class="chat-sidebar">
                <div class="chat-sidebar-header">
                    <h2>{move || i18n::t(lang.get()).chat_title}</h2>
                    <button
                        class="chat-new-btn"
                        on:click=move |_| {
                            set_show_new_chat.set(!show_new_chat.get());
                            if !show_new_chat.get() {} else { load_users(); }
                        }
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                            <line x1="12" y1="8" x2="12" y2="16"/>
                            <line x1="8" y1="12" x2="16" y2="12"/>
                        </svg>
                    </button>
                </div>

                <div class="chat-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.3-4.3"/>
                    </svg>
                    <input
                        type="text"
                        placeholder=move || i18n::t(lang.get()).common_search
                        prop:value=search
                        on:input=move |ev| set_search.set(event_target_value(&ev))
                    />
                </div>

                // New chat user picker
                {move || {
                    if !show_new_chat.get() {
                        return view! { <div></div> }.into_any();
                    }
                    let users = all_users.get();
                    let my_id = current_user.user.get().map(|u| u.id.clone()).unwrap_or_default();
                    let q = user_search.get().to_lowercase();
                    let filtered: Vec<_> = users
                        .into_iter()
                        .filter(|u| u.is_active && u.id != my_id)
                        .filter(|u| q.is_empty() || u.name.to_lowercase().contains(&q) || u.email.to_lowercase().contains(&q))
                        .collect();
                    view! {
                        <div class="chat-new-panel">
                            <input
                                type="text"
                                class="chat-user-search"
                                placeholder=move || i18n::t(lang.get()).chat_search_users
                                prop:value=user_search
                                on:input=move |ev| set_user_search.set(event_target_value(&ev))
                            />
                            <div class="chat-user-list">
                                {filtered.into_iter().map(|u| {
                                    let uid = u.id.clone();
                                    let uname = u.name.clone();
                                    let urole = u.role.clone();
                                    let ini = initial(&u.name);
                                    view! {
                                        <div class="chat-user-item" on:click=move |_| {
                                            open_conversation(uid.clone(), uname.clone(), urole.clone());
                                        }>
                                            <div class="chat-avatar">{ini.clone()}</div>
                                            <div class="chat-user-item-info">
                                                <span class="chat-user-item-name">{u.name.clone()}</span>
                                                <span class="chat-user-item-role">{crate::session::role_display_name(&u.role)}</span>
                                            </div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        </div>
                    }.into_any()
                }}

                // Conversation list
                <div class="chat-conv-list">
                    {move || {
                        let tr = i18n::t(lang.get());
                        if loading.get() {
                            return view! { <div class="chat-empty">{tr.common_loading}</div> }.into_any();
                        }
                        let convos = conversations.get();
                        let q = search.get().to_lowercase();
                        let filtered: Vec<_> = convos
                            .into_iter()
                            .filter(|c| q.is_empty() || c.name.to_lowercase().contains(&q))
                            .collect();
                        if filtered.is_empty() {
                            return view! { <div class="chat-empty">{tr.chat_no_conversations}</div> }.into_any();
                        }
                        view! {
                            <div>
                                {filtered.into_iter().map(|c| {
                                    let uid = c.user_id.clone();
                                    let uname = c.name.clone();
                                    let urole = c.role.clone();
                                    let ini = initial(&c.name);
                                    let active = active_peer.get() == Some(c.user_id.clone());
                                    let cls = if active { "chat-conv-item active" } else { "chat-conv-item" };
                                    let unread = c.unread;
                                    let has_unread = unread > 0;
                                    let preview = if c.is_mine {
                                        format!("{}: {}", tr.chat_you, truncate(&c.last_message, 40))
                                    } else {
                                        truncate(&c.last_message, 50)
                                    };
                                    let time = time_ago(&c.last_at, tr);
                                    view! {
                                        <div class=cls on:click=move |_| {
                                            open_conversation(uid.clone(), uname.clone(), urole.clone());
                                        }>
                                            <div class="chat-avatar">{ini.clone()}</div>
                                            <div class="chat-conv-info">
                                                <div class="chat-conv-top">
                                                    <span class="chat-conv-name">{c.name.clone()}</span>
                                                    <span class="chat-conv-time">{time}</span>
                                                </div>
                                                <div class="chat-conv-bottom">
                                                    <span class={if has_unread { "chat-conv-preview unread" } else { "chat-conv-preview" }}>{preview}</span>
                                                    {if has_unread {
                                                        view! { <span class="chat-badge">{unread.to_string()}</span> }.into_any()
                                                    } else {
                                                        view! { <span></span> }.into_any()
                                                    }}
                                                </div>
                                            </div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        }.into_any()
                    }}
                </div>
            </div>

            // ── Right panel: message thread ──
            <div class="chat-main">
                {move || {
                    let tr = i18n::t(lang.get());
                    let peer = active_peer.get();
                    if peer.is_none() {
                        return view! {
                            <div class="chat-empty-state">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                                </svg>
                                <p>{tr.chat_select_conversation}</p>
                            </div>
                        }.into_any();
                    }

                    let peer_name = active_name.get();
                    let peer_role = active_role.get();
                    let peer_ini = initial(&peer_name);
                    let my_id = current_user.user.get().map(|u| u.id.clone()).unwrap_or_default();
                    let all_msgs = messages.get();
                    let mut display_msgs = all_msgs.clone();
                    display_msgs.reverse();

                    view! {
                        <div class="chat-main-inner">
                            // Chat header
                            <div class="chat-main-header">
                                <div class="chat-main-header-user">
                                    <div class="chat-avatar">{peer_ini}</div>
                                    <div>
                                        <div class="chat-main-header-name">{peer_name.clone()}</div>
                                        <div class="chat-main-header-role">{crate::session::role_display_name(&peer_role)}</div>
                                    </div>
                                </div>
                            </div>

                            // Messages area
                            <div class="chat-messages">
                                {display_msgs.into_iter().map(|m| {
                                    let is_mine = m.from_user == my_id;
                                    let cls = if is_mine { "chat-msg mine" } else { "chat-msg theirs" };
                                    let time = time_ago(&m.created_at, tr);
                                    let has_text = m.message.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
                                    let text = m.message.clone().unwrap_or_default();
                                    let has_attachment = m.attachment_key.is_some();
                                    let att_name = m.attachment_filename.clone().unwrap_or_default();
                                    let att_mime = m.attachment_mime.clone().unwrap_or_default();
                                    let att_size = m.attachment_size.unwrap_or(0);
                                    let att_key = m.attachment_key.clone().unwrap_or_default();
                                    let download_url = format!("{FILE_DOWNLOAD_BASE}{att_key}");
                                    let is_img = is_image_mime(&att_mime);
                                    let icon_cls = file_icon_class(&att_mime);
                                    let size_str = format_size(att_size);

                                    view! {
                                        <div class=cls>
                                            <div class="chat-msg-bubble">
                                                // Attachment
                                                {if has_attachment {
                                                    if is_img {
                                                        let img_url = download_url.clone();
                                                        view! {
                                                            <div class="chat-attachment chat-attachment-image">
                                                                <a href=download_url.clone() target="_blank" rel="noopener">
                                                                    <img src=img_url alt=att_name.clone() class="chat-img-preview"/>
                                                                </a>
                                                            </div>
                                                        }.into_any()
                                                    } else {
                                                        view! {
                                                            <a href=download_url class="chat-attachment chat-attachment-file" target="_blank" rel="noopener">
                                                                <span class=icon_cls>
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                                                        <polyline points="14 2 14 8 20 8"/>
                                                                    </svg>
                                                                </span>
                                                                <div class="chat-file-info">
                                                                    <span class="chat-file-name">{att_name}</span>
                                                                    <span class="chat-file-size">{size_str}</span>
                                                                </div>
                                                                <span class="chat-file-download">
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                                                        <polyline points="7 10 12 15 17 10"/>
                                                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                                                    </svg>
                                                                </span>
                                                            </a>
                                                        }.into_any()
                                                    }
                                                } else {
                                                    view! { <span></span> }.into_any()
                                                }}
                                                // Text
                                                {if has_text {
                                                    view! { <p class="chat-msg-text">{text}</p> }.into_any()
                                                } else {
                                                    view! { <span></span> }.into_any()
                                                }}
                                                <span class="chat-msg-time">{time}</span>
                                            </div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>

                            // Pending file preview
                            {move || {
                                match pending_file.get() {
                                    Some(file) => {
                                        let name = file.name();
                                        let size = format_size(file.size() as i64);
                                        view! {
                                            <div class="chat-pending-file">
                                                <div class="chat-pending-file-info">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                                        <polyline points="14 2 14 8 20 8"/>
                                                    </svg>
                                                    <span class="chat-pending-file-name">{name}</span>
                                                    <span class="chat-pending-file-size">{size}</span>
                                                </div>
                                                <button class="chat-pending-file-remove" on:click=move |_| set_pending_file.set(None)>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        }.into_any()
                                    }
                                    None => view! { <span></span> }.into_any(),
                                }
                            }}

                            // Input area
                            <form class="chat-input-area" on:submit=send_message>
                                // File picker button
                                <label class="chat-attach-btn">
                                    <input type="file" style="display:none" on:change=on_file_change />
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                                    </svg>
                                </label>
                                <input
                                    type="text"
                                    class="chat-input"
                                    placeholder=tr.chat_type_message
                                    prop:value=input
                                    on:input=move |ev| set_input.set(event_target_value(&ev))
                                    autocomplete="off"
                                />
                                <button type="submit" class="chat-send-btn" disabled=move || sending.get() || uploading.get()>
                                    {move || {
                                        if uploading.get() {
                                            view! { <span class="chat-uploading">"..."</span> }.into_any()
                                        } else {
                                            view! {
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <line x1="22" y1="2" x2="11" y2="13"/>
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                                </svg>
                                            }.into_any()
                                        }
                                    }}
                                </button>
                            </form>
                        </div>
                    }.into_any()
                }}
            </div>
        </div>
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..s.floor_char_boundary(max)])
    }
}
