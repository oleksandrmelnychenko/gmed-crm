import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MessageSquarePlus,
  Search,
  Send,
  Paperclip,
  X,
  FileText,
  Download,
  MessageSquare,
} from "lucide-react";
import { apiFetch, getAccessToken } from "@/lib/api";
import {
  CHAT_E2E_PREVIEW,
  CHAT_E2E_UNAVAILABLE,
  decryptMessageFromPeer,
  encryptMessageForPeer,
  ensureServerMessageKey,
  fetchPeerMessageKey,
  getLocalMessageKey,
  type MessageKeyEnvelope,
  type MessageKeyRecord,
} from "@/lib/chat-e2e";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ──

interface Conversation {
  user_id: string;
  name: string;
  email: string;
  role: string;
  last_message: string;
  last_at: string;
  is_read: boolean;
  last_read_at?: string | null;
  is_mine: boolean;
  unread: number;
  is_e2e?: boolean;
}

interface Message {
  id: string;
  from_user: string;
  to_user: string;
  message: string | null;
  is_e2e?: boolean;
  e2e_algorithm?: string | null;
  e2e_ciphertext?: string | null;
  e2e_nonce?: string | null;
  e2e_salt?: string | null;
  sender_key_fingerprint?: string | null;
  recipient_key_fingerprint?: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  attachment_filename: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_key: string | null;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

interface ChatStreamEvent {
  type: "message_created" | "conversation_read";
  user_id: string;
  peer_id: string;
  message_id?: string | null;
}

// ── Helpers ──

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function roleDisplay(role: string) {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(iso: string) {
  const idx = iso.indexOf("T");
  if (idx < 0) return iso.slice(0, 16);
  const hm = iso.slice(idx + 1, idx + 6);
  const datePart = iso.slice(0, idx);
  const today = new Date().toISOString().slice(0, 10);
  if (datePart === today) return hm;
  return `${datePart.slice(5).replace("-", ".")} ${hm}`;
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max) + "...";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_BASE = "/api/v1/messages/file/";

// ── Component ──

export function ChatPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const myId = user?.id ?? "";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activePeer, setActivePeer] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [activeRole, setActiveRole] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [myMessageKey, setMyMessageKey] = useState<MessageKeyRecord | null>(null);
  const [activePeerMessageKey, setActivePeerMessageKey] =
    useState<MessageKeyEnvelope | null>(null);
  const [secureStatus, setSecureStatus] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedDraftRef = useRef("");
  const activePeerRef = useRef<string | null>(null);
  const peerMessageKeyCacheRef = useRef<Record<string, MessageKeyEnvelope>>({});

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>("/messages/conversations");
      setConversations(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPeerMessageKey = useCallback(
    async (peerId: string, fingerprint?: string | null) => {
      const cacheKey = `${peerId}:${fingerprint ?? "active"}`;
      const cached = peerMessageKeyCacheRef.current[cacheKey];
      if (cached) return cached;

      const key = await fetchPeerMessageKey(peerId, fingerprint);
      if (key) {
        peerMessageKeyCacheRef.current[cacheKey] = key;
        peerMessageKeyCacheRef.current[`${peerId}:${key.fingerprint}`] = key;
      }
      return key;
    },
    [],
  );

  const hydrateMessages = useCallback(
    async (peerId: string, rawMessages: Message[]) => {
      return Promise.all(
        rawMessages.map(async (message) => {
          if (!message.is_e2e) return message;

          const myFingerprint =
            message.from_user === myId
              ? message.sender_key_fingerprint
              : message.recipient_key_fingerprint;
          const peerFingerprint =
            message.from_user === myId
              ? message.recipient_key_fingerprint
              : message.sender_key_fingerprint;
          const localKey = getLocalMessageKey(myFingerprint);
          if (!localKey || !peerFingerprint) {
            return {
              ...message,
              message: CHAT_E2E_UNAVAILABLE,
            };
          }

          const peerKey = await loadPeerMessageKey(peerId, peerFingerprint);
          if (!peerKey) {
            return {
              ...message,
              message: CHAT_E2E_PREVIEW,
            };
          }

          try {
            const decrypted = await decryptMessageFromPeer(message, localKey, peerKey);
            return {
              ...message,
              message: decrypted,
            };
          } catch {
            return {
              ...message,
              message: CHAT_E2E_UNAVAILABLE,
            };
          }
        }),
      );
    },
    [loadPeerMessageKey, myId],
  );

  const loadMessagesForPeer = useCallback(
    async (peerId: string, markRead = false) => {
      const msgs = await apiFetch<Message[]>(`/messages/${peerId}?limit=100`);
      const hydrated = await hydrateMessages(peerId, msgs);
      setMessages(hydrated);
      if (markRead) {
        await apiFetch(`/messages/${peerId}/read`, { method: "POST" });
      }
    },
    [hydrateMessages],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const key = await ensureServerMessageKey();
        if (!cancelled) {
          setMyMessageKey(key);
        }
      } catch {
        if (!cancelled) {
          setSecureStatus("Secure chat setup failed on this device.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  useEffect(() => {
    if (!activePeer) {
      setActivePeerMessageKey(null);
      setSecureStatus(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const key = await loadPeerMessageKey(activePeer);
        if (cancelled) return;
        setActivePeerMessageKey(key);
        setSecureStatus(
          key
            ? null
            : "Secure setup is still pending for this conversation. Text messages stay paused until the other side opens chat once.",
        );
      } catch {
        if (!cancelled) {
          setActivePeerMessageKey(null);
          setSecureStatus("Failed to load secure chat key.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePeer, loadPeerMessageKey]);

  useEffect(() => {
    const peer = searchParams.get("peer");
    if (!peer) return;

    const fromConversation = conversations.find((item) => item.user_id === peer);
    const fromUserList = allUsers.find((item) => item.id === peer);
    const name =
      searchParams.get("name") ||
      fromConversation?.name ||
      fromUserList?.name ||
      activeName;
    const role =
      searchParams.get("role") ||
      fromConversation?.role ||
      fromUserList?.role ||
      activeRole;

    if (activePeer !== peer && name) {
      setActivePeer(peer);
      setActiveName(name);
      setActiveRole(role);
      setShowNewChat(false);
      setPendingFile(null);
    }

    const draft = searchParams.get("draft");
    if (draft && hydratedDraftRef.current !== `${peer}:${draft}`) {
      hydratedDraftRef.current = `${peer}:${draft}`;
      setInput(draft);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("draft");
          return next;
        },
        { replace: true }
      );
    }
  }, [
    activeName,
    activePeer,
    activeRole,
    allUsers,
    conversations,
    searchParams,
    setSearchParams,
  ]);

  // Keep chat live via WebSocket push.
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/messages/ws?token=${encodeURIComponent(token)}`;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        let payload: ChatStreamEvent | null = null;
        try {
          payload = JSON.parse(event.data) as ChatStreamEvent;
        } catch {
          return;
        }

        void loadConversations();
        const currentPeer = activePeerRef.current;
        if (!currentPeer || payload.peer_id !== currentPeer) return;

        void loadMessagesForPeer(
          currentPeer,
          payload.type === "message_created" && payload.user_id !== myId,
        ).catch(() => undefined);
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        if (disposed) return;
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [loadConversations, loadMessagesForPeer, myId]);

  // Load messages when peer changes
  useEffect(() => {
    if (!activePeer) {
      setMessages([]);
      return;
    }
    void (async () => {
      try {
        await loadMessagesForPeer(activePeer, true);
        void loadConversations();
      } catch {
        /* ignore */
      }
    })();
  }, [activePeer, loadConversations, loadMessagesForPeer]);

  const openConversation = (userId: string, name: string, role: string) => {
    setActivePeer(userId);
    setActiveName(name);
    setActiveRole(role);
    setShowNewChat(false);
    setPendingFile(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("peer", userId);
        next.set("name", name);
        next.set("role", role);
        next.delete("draft");
        return next;
      },
      { replace: true }
    );
  };

  const loadUsers = useCallback(async () => {
    try {
      const query = userSearch.trim()
        ? `/messages/allowed-peers?search=${encodeURIComponent(userSearch.trim())}`
        : "/messages/allowed-peers";
      const data = await apiFetch<UserItem[]>(query);
      setAllUsers(data);
    } catch {
      /* ignore */
    }
  }, [userSearch]);

  useEffect(() => {
    if (!showNewChat) return;
    void loadUsers();
  }, [loadUsers, showNewChat]);

  // Send message
  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!activePeer || sending) return;

    // File upload
    if (pendingFile) {
      setSending(true);
      const formData = new FormData();
      formData.append("file", pendingFile);
      if (input.trim()) formData.append("message", input.trim());
      try {
        const token = getAccessToken();
        await fetch(`/api/v1/messages/${activePeer}/upload`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        await loadMessagesForPeer(activePeer);
        void loadConversations();
      } catch {
        /* ignore */
      } finally {
        setInput("");
        setPendingFile(null);
        setSending(false);
      }
      return;
    }

    // Text message
    if (!input.trim()) return;
    if (!activePeerMessageKey) {
      setSecureStatus(
        "Secure setup is still pending for this conversation. Text messages stay paused until the other side opens chat once.",
      );
      return;
    }
    setSending(true);
    const msg = input.trim();
    setInput("");
    try {
      const senderKey = myMessageKey ?? (await ensureServerMessageKey());
      setMyMessageKey(senderKey);
      const payload = await encryptMessageForPeer(
        msg,
        senderKey,
        activePeerMessageKey,
      );
      await apiFetch(`/messages/${activePeer}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadMessagesForPeer(activePeer);
      void loadConversations();
      setSecureStatus(null);
    } catch {
      setInput(msg);
      setSecureStatus("Failed to send encrypted message.");
    } finally {
      setSending(false);
    }
  };

  // Filtered conversations
  const filteredConvos = search
    ? conversations.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Filtered users for new chat
  const filteredUsers = allUsers
    .filter((u) => u.is_active && u.id !== myId)
    .filter(
      (u) =>
        !userSearch ||
        u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase())
    );

  const displayMsgs = [...messages].reverse();

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-2xl border bg-card shadow-sm overflow-hidden">
      {/* ── Left: Conversations ── */}
      <div className="flex flex-col w-80 min-w-[280px] border-r">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">{t.chat_title}</h2>
          <button
            onClick={() => {
              setShowNewChat(!showNewChat);
            }}
            className="flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <MessageSquarePlus className="size-[18px]" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder={t.common_search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 rounded-lg"
            />
          </div>
        </div>

        {/* New chat picker */}
        {showNewChat && (
          <div className="border-b px-4 py-2 space-y-2 bg-muted/30 animate-in fade-in slide-in-from-top-1 duration-200">
            <Input
              placeholder={t.chat_search_users}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="h-8 rounded-lg text-sm"
            />
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => openConversation(u.id, u.name, u.role)}
                  className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-left hover:bg-muted transition-colors"
                >
                  <div className="flex items-center justify-center size-7 rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0">
                    {initials(u.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-[10px] text-muted-foreground">{roleDisplay(u.role)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t.common_loading}</p>
          ) : filteredConvos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t.chat_no_conversations}</p>
          ) : (
            filteredConvos.map((c) => (
              <button
                key={c.user_id}
                onClick={() => openConversation(c.user_id, c.name, c.role)}
                className={cn(
                  "flex items-center gap-3 w-full px-5 py-3 text-left transition-colors border-b border-border/30",
                  activePeer === c.user_id ? "bg-primary/5" : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-center size-10 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(c.last_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className={cn("text-xs truncate", c.unread > 0 ? "text-foreground font-medium" : "text-muted-foreground")}>
                      {c.is_mine ? `${t.chat_you}: ` : ""}
                      {truncate(c.last_message, 40)}
                    </span>
                    {c.unread > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-[10px] font-semibold text-primary-foreground px-1 shrink-0">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Messages ── */}
      <div className="flex-1 flex flex-col">
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="size-12 opacity-30" />
            <p className="text-sm">{t.chat_select_conversation}</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b">
              <div className="flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                {initials(activeName)}
              </div>
              <div>
                <p className="text-sm font-semibold">{activeName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {roleDisplay(activeRole)}
                  {activePeerMessageKey ? " · End-to-end encrypted text chat" : ""}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {displayMsgs.map((m) => {
                const mine = m.from_user === myId;
                const hasText = !!m.message?.trim();
                const hasAttachment = !!m.attachment_key;
                const downloadUrl = `${FILE_BASE}${m.attachment_key ?? ""}`;
                const isImage = m.attachment_mime?.startsWith("image/") ?? false;
                const readReceipt =
                  mine && m.read_at ? `Seen ${timeAgo(m.read_at)}` : null;

                return (
                  <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                    {/* Attachment */}
                    {hasAttachment && (
                      isImage ? (
                        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="mb-1">
                          <img
                            src={downloadUrl}
                            alt={m.attachment_filename ?? ""}
                            className="max-w-[240px] max-h-[200px] rounded-xl object-cover shadow-sm"
                          />
                        </a>
                      ) : (
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-xl mb-1 max-w-[280px] transition-colors",
                            mine ? "bg-foreground/90 text-background" : "bg-muted"
                          )}
                        >
                          <FileText className="size-4 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{m.attachment_filename}</p>
                            <p className="text-[10px] opacity-70">{formatSize(m.attachment_size ?? 0)}</p>
                          </div>
                          <Download className="size-3.5 shrink-0 opacity-60" />
                        </a>
                      )
                    )}
                    {/* Text bubble */}
                    {hasText && (
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-4 py-2 text-sm",
                          mine
                            ? "bg-foreground text-background rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        )}
                      >
                        {m.message}
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      {timeAgo(m.created_at)}
                      {readReceipt ? ` · ${readReceipt}` : ""}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {secureStatus && (
              <div className="px-5 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground">
                {secureStatus}
              </div>
            )}

            {/* Pending file preview */}
            {pendingFile && (
              <div className="flex items-center gap-3 px-5 py-2 border-t bg-muted/30 animate-in fade-in duration-150">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate flex-1">{pendingFile.name}</span>
                <span className="text-xs text-muted-foreground">{formatSize(pendingFile.size)}</span>
                <button onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSend} className="flex items-center gap-2 px-4 py-3 border-t">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setPendingFile(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center size-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <Paperclip className="size-[18px]" />
              </button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.chat_type_message}
                autoComplete="off"
                className="flex-1 h-10 rounded-xl"
              />
              <button
                type="submit"
                disabled={sending}
                className="flex items-center justify-center size-9 rounded-lg bg-foreground text-background hover:opacity-80 transition-opacity shrink-0 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
