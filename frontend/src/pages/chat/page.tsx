import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
  Shield,
} from "lucide-react";
import {
  CHAT_E2E_PREVIEW,
  CHAT_E2E_UNAVAILABLE,
  decryptAttachmentFromPeer,
  decryptMessageFromPeer,
  encryptAttachmentForPeer,
  encryptMessageForPeer,
  ensureServerMessageKey,
  exportKeyRingBackup,
  fetchPeerMessageKey,
  getLocalMessageKey,
  importKeyRingBackup,
  type MessageKeyEnvelope,
} from "@/lib/chat-e2e";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  downloadMessageAttachmentBytes,
  fetchAllowedPeers,
  fetchConversations,
  fetchPeerMessages,
  getMessageAttachmentUrl,
  markPeerMessagesRead,
  openMessagesSocket,
  sendPeerMessage,
  uploadPeerAttachment,
} from "./data/chat-api";
import {
  canAccessChat,
  formatSize,
  initials,
  roleDisplay,
  timeAgo,
  truncate,
} from "./model/chat-model";
import type { ChatStreamEvent, Conversation, Message, UserItem } from "./model/types";

// ── Component ──

export function ChatPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const myId = user?.id ?? "";
  const canViewChat = canAccessChat(user?.role);

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
  const [activePeerMessageKey, setActivePeerMessageKey] =
    useState<MessageKeyEnvelope | null>(null);
  const [secureStatus, setSecureStatus] = useState<string | null>(null);
  const [attachmentBusyId, setAttachmentBusyId] = useState<string | null>(null);
  const [keyDialogMode, setKeyDialogMode] = useState<"export" | "import" | null>(null);
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [keyDialogBusy, setKeyDialogBusy] = useState(false);
  const [keyDialogStatus, setKeyDialogStatus] = useState<string | null>(null);
  const [importedKeyBackup, setImportedKeyBackup] = useState<{
    name: string;
    content: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyBackupInputRef = useRef<HTMLInputElement>(null);
  const hydratedDraftRef = useRef("");
  const activePeerRef = useRef<string | null>(null);
  const peerMessageKeyCacheRef = useRef<Record<string, MessageKeyEnvelope>>({});

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!canViewChat) {
      setConversations([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [canViewChat]);

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
      if (!canViewChat) {
        setMessages([]);
        return;
      }
      const msgs = await fetchPeerMessages(peerId);
      const hydrated = await hydrateMessages(peerId, msgs);
      setMessages(hydrated);
      if (markRead) {
        await markPeerMessagesRead(peerId);
      }
    },
    [canViewChat, hydrateMessages],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    let cancelled = false;
    if (!canViewChat) {
      setSecureStatus(null);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        await ensureServerMessageKey();
      } catch {
        if (!cancelled) {
          setSecureStatus(t.chat_secure_setup_failed_device);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canViewChat, t.chat_secure_setup_failed_device]);

  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  useEffect(() => {
    if (!canViewChat) {
      setActivePeerMessageKey(null);
      return;
    }
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
            : t.chat_secure_setup_pending,
        );
      } catch {
        if (!cancelled) {
          setActivePeerMessageKey(null);
          setSecureStatus(t.chat_secure_key_failed);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activePeer,
    canViewChat,
    loadPeerMessageKey,
    t.chat_secure_key_failed,
    t.chat_secure_setup_pending,
  ]);

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
    if (!canViewChat) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      const nextSocket = openMessagesSocket();
      if (!nextSocket) return;
      socket = nextSocket;
      socket.onmessage = (event) => {
        const payload = (() => {
          try {
            return JSON.parse(event.data) as ChatStreamEvent;
          } catch {
            return null;
          }
        })();
        if (!payload) return;

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
  }, [canViewChat, loadConversations, loadMessagesForPeer, myId]);

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
    if (!canViewChat) {
      setAllUsers([]);
      return;
    }
    try {
      const data = await fetchAllowedPeers(userSearch);
      setAllUsers(data);
    } catch {
      /* ignore */
    }
  }, [canViewChat, userSearch]);

  useEffect(() => {
    if (!showNewChat) return;
    void loadUsers();
  }, [loadUsers, showNewChat]);

  const resetKeyDialog = useCallback(() => {
    setKeyDialogMode(null);
    setKeyPassphrase("");
    setKeyDialogBusy(false);
    setKeyDialogStatus(null);
    setImportedKeyBackup(null);
    if (keyBackupInputRef.current) {
      keyBackupInputRef.current.value = "";
    }
  }, []);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const handleSecureAttachmentDownload = useCallback(
    async (message: Message) => {
      if (!message.attachment_key) return;

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
        setSecureStatus(t.chat_secure_attachment_unavailable);
        return;
      }

      const peerId = message.from_user === myId ? message.to_user : message.from_user;
      const peerKey = await loadPeerMessageKey(peerId, peerFingerprint);
      if (!peerKey) {
        setSecureStatus(t.chat_secure_attachment_peer_key_failed);
        return;
      }

      setAttachmentBusyId(message.id);
      try {
        const ciphertext = new Uint8Array(
          await downloadMessageAttachmentBytes(message.attachment_key),
        );
        const decrypted = await decryptAttachmentFromPeer(
          message,
          ciphertext,
          localKey,
          peerKey,
        );
        downloadBlob(
          new Blob([decrypted], {
            type: message.attachment_mime ?? "application/octet-stream",
          }),
          message.attachment_filename ?? "secure-attachment",
        );
        setSecureStatus(null);
      } catch {
        setSecureStatus(t.chat_secure_attachment_decrypt_failed);
      } finally {
        setAttachmentBusyId(null);
      }
    },
    [
      downloadBlob,
      loadPeerMessageKey,
      myId,
      t.chat_secure_attachment_decrypt_failed,
      t.chat_secure_attachment_peer_key_failed,
      t.chat_secure_attachment_unavailable,
    ],
  );

  const handleKeyBackupFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const content = await file.text();
      setImportedKeyBackup({ name: file.name, content });
      setKeyDialogMode("import");
      setKeyDialogStatus(null);
    },
    [],
  );

  const handleKeyDialogSubmit = useCallback(async () => {
    if (!keyPassphrase.trim()) {
      setKeyDialogStatus(t.chat_secure_passphrase_required);
      return;
    }

    setKeyDialogBusy(true);
    try {
      if (keyDialogMode === "export") {
        const payload = await exportKeyRingBackup(keyPassphrase);
        downloadBlob(
          new Blob([payload], { type: "application/json" }),
          `gmed-secure-chat-keys-${new Date().toISOString().slice(0, 10)}.json`,
        );
        setKeyDialogStatus(t.chat_secure_backup_downloaded);
      } else if (keyDialogMode === "import" && importedKeyBackup) {
        const result = await importKeyRingBackup(importedKeyBackup.content, keyPassphrase);
        setKeyDialogStatus(
          t.chat_secure_keys_imported.replace("{count}", String(result.importedKeys)),
        );
      }
    } catch (error) {
      setKeyDialogStatus(
        error instanceof Error ? error.message : t.chat_secure_operation_failed,
      );
    } finally {
      setKeyDialogBusy(false);
    }
  }, [
    downloadBlob,
    importedKeyBackup,
    keyDialogMode,
    keyPassphrase,
    t.chat_secure_backup_downloaded,
    t.chat_secure_keys_imported,
    t.chat_secure_operation_failed,
    t.chat_secure_passphrase_required,
  ]);

  // Send message
  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!activePeer || sending) return;

    // File upload
    if (pendingFile) {
      setSending(true);
      const formData = new FormData();
      const caption = input.trim();
      try {
        if (activePeerMessageKey) {
          const senderKey = await ensureServerMessageKey();
          const encryptedAttachment = await encryptAttachmentForPeer(
            new Uint8Array(await pendingFile.arrayBuffer()),
            senderKey,
            activePeerMessageKey,
          );
          formData.append(
            "file",
            new Blob([encryptedAttachment.ciphertext], {
              type: "application/octet-stream",
            }),
            pendingFile.name,
          );
          formData.append("attachment_plaintext_size", String(pendingFile.size));
          formData.append(
            "attachment_e2e_algorithm",
            encryptedAttachment.attachment_e2e_algorithm,
          );
          formData.append(
            "attachment_e2e_nonce",
            encryptedAttachment.attachment_e2e_nonce,
          );
          formData.append(
            "attachment_e2e_salt",
            encryptedAttachment.attachment_e2e_salt,
          );
          formData.append(
            "sender_key_fingerprint",
            encryptedAttachment.sender_key_fingerprint,
          );
          formData.append(
            "recipient_key_fingerprint",
            encryptedAttachment.recipient_key_fingerprint,
          );
          if (caption) {
            const payload = await encryptMessageForPeer(
              caption,
              senderKey,
              activePeerMessageKey,
            );
            formData.append("e2e_algorithm", payload.e2e_algorithm);
            formData.append("e2e_ciphertext", payload.e2e_ciphertext);
            formData.append("e2e_nonce", payload.e2e_nonce);
            formData.append("e2e_salt", payload.e2e_salt);
          }
        } else {
          formData.append("file", pendingFile);
          if (caption) formData.append("message", caption);
        }

        await uploadPeerAttachment(activePeer, formData);
        await loadMessagesForPeer(activePeer);
        void loadConversations();
        if (activePeerMessageKey) {
          setSecureStatus(null);
        }
      } catch {
        setSecureStatus(
          activePeerMessageKey
            ? t.chat_secure_attachment_send_failed
            : t.chat_attachment_send_failed,
        );
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
      setSecureStatus(t.chat_secure_setup_pending);
      return;
    }
    setSending(true);
    const msg = input.trim();
    setInput("");
    try {
      const senderKey = await ensureServerMessageKey();
      const payload = await encryptMessageForPeer(
        msg,
        senderKey,
        activePeerMessageKey,
      );
      await sendPeerMessage(activePeer, payload);
      await loadMessagesForPeer(activePeer);
      void loadConversations();
      setSecureStatus(null);
    } catch {
      setInput(msg);
      setSecureStatus(t.chat_secure_message_send_failed);
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

  if (!canViewChat) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground shadow-sm">
        {t.chat_access_denied}
      </div>
    );
  }

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
            aria-label={t.chat_new}
            title={t.chat_new}
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
          <div
            data-testid="chat-new-picker"
            className="border-b px-4 py-2 space-y-2 bg-muted/30 animate-in fade-in slide-in-from-top-1 duration-200"
          >
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
                    <p className="text-[10px] text-muted-foreground">{roleDisplay(u.role, t)}</p>
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
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {initials(activeName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{activeName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {roleDisplay(activeRole, t)}
                    {activePeerMessageKey ? ` - ${t.chat_secure_encrypted_label}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={keyBackupInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => void handleKeyBackupFileChange(event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    setKeyDialogMode("export");
                    setKeyDialogStatus(null);
                  }}
                >
                  {t.chat_export_keys}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => keyBackupInputRef.current?.click()}
                >
                  {t.chat_import_keys}
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {displayMsgs.map((m) => {
                const mine = m.from_user === myId;
                const hasText = !!m.message?.trim();
                const hasAttachment = !!m.attachment_key;
                const isSecureAttachment = m.attachment_is_e2e ?? false;
                const downloadUrl = m.attachment_key
                  ? getMessageAttachmentUrl(m.attachment_key)
                  : "";
                const isImage =
                  !isSecureAttachment && (m.attachment_mime?.startsWith("image/") ?? false);
                const readReceipt =
                  mine && m.read_at ? `${t.chat_seen} ${timeAgo(m.read_at)}` : null;

                return (
                  <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                    {/* Attachment */}
                    {hasAttachment &&
                      (isSecureAttachment ? (
                        <button
                          type="button"
                          onClick={() => void handleSecureAttachmentDownload(m)}
                          disabled={attachmentBusyId === m.id}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-xl mb-1 max-w-[320px] transition-colors text-left disabled:opacity-60",
                            mine ? "bg-foreground/90 text-background" : "bg-muted",
                          )}
                        >
                          <Shield className="size-4 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">
                              {m.attachment_filename}
                            </p>
                            <p className="text-[10px] opacity-70">
                              {t.chat_secure_attachment_label} - {formatSize(m.attachment_size ?? 0)}
                            </p>
                          </div>
                          <Download className="size-3.5 shrink-0 opacity-60" />
                        </button>
                      ) : isImage ? (
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
                      ))}
                    {/* Text bubble */}
                    {hasText && (
                      <div
                        data-testid={`chat-message-text-${m.id}`}
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
                      {readReceipt ? ` - ${readReceipt}` : ""}
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

            <Dialog open={keyDialogMode !== null} onOpenChange={(open) => !open && resetKeyDialog()}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {keyDialogMode === "export"
                      ? t.chat_export_secure_keys_title
                      : t.chat_import_secure_keys_title}
                  </DialogTitle>
                  <DialogDescription>
                    {keyDialogMode === "export"
                      ? t.chat_export_secure_keys_description
                      : t.chat_import_secure_keys_description}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  {keyDialogMode === "import" && (
                    <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {importedKeyBackup
                        ? t.chat_backup_selected.replace("{name}", importedKeyBackup.name)
                        : t.chat_backup_choose_first}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="chat-key-passphrase">{t.chat_key_passphrase}</Label>
                    <Input
                      id="chat-key-passphrase"
                      type="password"
                      value={keyPassphrase}
                      onChange={(event) => setKeyPassphrase(event.target.value)}
                      placeholder={t.chat_key_passphrase_placeholder}
                    />
                  </div>
                  {keyDialogStatus && (
                    <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {keyDialogStatus}
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={resetKeyDialog}>
                    {t.chat_close}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleKeyDialogSubmit()}
                    disabled={
                      keyDialogBusy ||
                      !keyPassphrase.trim() ||
                      (keyDialogMode === "import" && !importedKeyBackup)
                    }
                  >
                    {keyDialogBusy
                      ? t.chat_working
                      : keyDialogMode === "export"
                        ? t.chat_export_backup
                        : t.chat_import_backup}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
