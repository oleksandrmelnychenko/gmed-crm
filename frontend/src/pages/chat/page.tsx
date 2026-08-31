import { useCallback, useEffect, useReducer, useRef, type FormEvent, type SetStateAction } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
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
  ShieldCheck,
  ArrowLeft,
  Clock3,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  CHAT_E2E_PREVIEW,
  CHAT_E2E_UNAVAILABLE,
  PeerMessageKeyChangedError,
  decryptAttachmentFromPeer,
  decryptMessageFromPeer,
  encryptAttachmentForPeer,
  encryptMessageForPeer,
  ensureServerMessageKey,
  fetchPeerMessageKey,
  getLocalMessageKey,
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
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { cn } from "@/lib/utils";
import { deNormalize } from "@/components/data-table/search";
import {
  downloadMessageAttachmentBytes,
  deletePeerMessage,
  fetchAllowedPeers,
  fetchConversations,
  fetchPeerMessages,
  markPeerMessagesRead,
  openMessagesSocket,
  sendPeerMessage,
  uploadPeerAttachment,
  type SentMessageReceipt,
} from "./data/chat-api";
import {
  canAccessChat,
  chatMessageDateKey,
  formatSize,
  initials,
  isSameChatMessageGroup,
  roleDisplay,
  timeAgo,
  truncate,
} from "./model/chat-model";
import type { ChatStreamEvent, Conversation, Message, UserItem } from "./model/types";

type KeyDialogMode = "manage" | null;
type ChatConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const CHAT_ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.txt,.csv,.doc,.docx,.xls,.xlsx,.dcm";
const CHAT_ATTACHMENT_EXTENSIONS = new Set(
  CHAT_ATTACHMENT_ACCEPT.split(",").map((value) => value.slice(1)),
);
const CHAT_TIMER_OPTIONS = [0, 60, 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60] as const;

function isAllowedChatAttachment(file: File) {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  return Boolean(extension && CHAT_ATTACHMENT_EXTENSIONS.has(extension));
}

function formatChatDay(iso: string, lang: "de" | "ru") {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: value.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(value);
}

function formatMessageExpiry(iso: string, lang: "de" | "ru", now: number) {
  const remainingSeconds = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
  const formatter = new Intl.RelativeTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    numeric: "always",
  });
  if (remainingSeconds < 60) return formatter.format(remainingSeconds, "second");
  if (remainingSeconds < 3600) return formatter.format(Math.ceil(remainingSeconds / 60), "minute");
  if (remainingSeconds < 86400) return formatter.format(Math.ceil(remainingSeconds / 3600), "hour");
  return formatter.format(Math.ceil(remainingSeconds / 86400), "day");
}

type ChatPageState = {
  conversations: Conversation[];
  messages: Message[];
  activePeer: string | null;
  activeName: string;
  activeRole: string;
  input: string;
  loading: boolean;
  messageLoading: boolean;
  olderMessagesLoading: boolean;
  hasOlderMessages: boolean;
  connectionStatus: ChatConnectionStatus;
  sending: boolean;
  conversationError: boolean;
  messageError: boolean;
  userError: boolean;
  search: string;
  messageSearch: string;
  showNewChat: boolean;
  allUsers: UserItem[];
  userSearch: string;
  pendingFile: File | null;
  activePeerMessageKey: MessageKeyEnvelope | null;
  pendingPeerMessageKey: MessageKeyEnvelope | null;
  deviceKeyFingerprint: string | null;
  secureStatus: string | null;
  attachmentBusyId: string | null;
  keyDialogMode: KeyDialogMode;
  messageTimerSeconds: number;
  deleteTarget: Message | null;
  deletingMessageId: string | null;
  expiryClock: number;
};

type ChatPagePatch =
  | Partial<ChatPageState>
  | ((current: ChatPageState) => Partial<ChatPageState>);

function chatPageReducer(state: ChatPageState, patch: ChatPagePatch): ChatPageState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createChatPageFieldPatch<K extends keyof ChatPageState>(
  field: K,
  value: SetStateAction<ChatPageState[K]>,
): ChatPagePatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: ChatPageState[K]) => ChatPageState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<ChatPageState>;
  };
}

// ── Component ──

function useChatPageContent() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const secureChannelPendingStatus = t.chat_attachment_pending;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const myId = user?.id ?? "";
  const canViewChat = canAccessChat(user?.role);

  const [chatState, dispatchChatState] = useReducer(
    chatPageReducer,
    undefined,
    (): ChatPageState => ({
      conversations: [],
      messages: [],
      activePeer: null,
      activeName: "",
      activeRole: "",
      input: "",
      loading: true,
      messageLoading: false,
      olderMessagesLoading: false,
      hasOlderMessages: false,
      connectionStatus: "connecting",
      sending: false,
      conversationError: false,
      messageError: false,
      userError: false,
      search: "",
      messageSearch: "",
      showNewChat: false,
      allUsers: [],
      userSearch: "",
      pendingFile: null,
      activePeerMessageKey: null,
      pendingPeerMessageKey: null,
      deviceKeyFingerprint: null,
      secureStatus: null,
      attachmentBusyId: null,
      keyDialogMode: null,
      messageTimerSeconds: 0,
      deleteTarget: null,
      deletingMessageId: null,
      expiryClock: Date.now(),
    }),
  );
  const {
    conversations,
    messages,
    activePeer,
    activeName,
    activeRole,
    input,
    loading,
    messageLoading,
    olderMessagesLoading,
    hasOlderMessages,
    connectionStatus,
    sending,
    conversationError,
    messageError,
    userError,
    search,
    messageSearch,
    showNewChat,
    allUsers,
    userSearch,
    pendingFile,
    activePeerMessageKey,
    pendingPeerMessageKey,
    deviceKeyFingerprint,
    secureStatus,
    attachmentBusyId,
    keyDialogMode,
    messageTimerSeconds,
    deleteTarget,
    deletingMessageId,
    expiryClock,
  } = chatState;
  const setChatField = <K extends keyof ChatPageState>(
    field: K,
    value: SetStateAction<ChatPageState[K]>,
  ) => dispatchChatState(createChatPageFieldPatch(field, value));
  const setConversations = (value: SetStateAction<Conversation[]>) =>
    setChatField("conversations", value);
  const setMessages = (value: SetStateAction<Message[]>) =>
    setChatField("messages", value);
  const setActivePeer = (value: SetStateAction<string | null>) =>
    setChatField("activePeer", value);
  const setActiveName = (value: SetStateAction<string>) =>
    setChatField("activeName", value);
  const setActiveRole = (value: SetStateAction<string>) =>
    setChatField("activeRole", value);
  const setInput = (value: SetStateAction<string>) =>
    setChatField("input", value);
  const setLoading = (value: SetStateAction<boolean>) =>
    setChatField("loading", value);
  const setMessageLoading = (value: SetStateAction<boolean>) =>
    setChatField("messageLoading", value);
  const setOlderMessagesLoading = (value: SetStateAction<boolean>) =>
    setChatField("olderMessagesLoading", value);
  const setHasOlderMessages = (value: SetStateAction<boolean>) =>
    setChatField("hasOlderMessages", value);
  const setConnectionStatus = (value: SetStateAction<ChatConnectionStatus>) =>
    setChatField("connectionStatus", value);
  const setSending = (value: SetStateAction<boolean>) =>
    setChatField("sending", value);
  const setConversationError = (value: SetStateAction<boolean>) =>
    setChatField("conversationError", value);
  const setMessageError = (value: SetStateAction<boolean>) =>
    setChatField("messageError", value);
  const setUserError = (value: SetStateAction<boolean>) =>
    setChatField("userError", value);
  const setSearch = (value: SetStateAction<string>) =>
    setChatField("search", value);
  const setMessageSearch = (value: SetStateAction<string>) =>
    setChatField("messageSearch", value);
  const setShowNewChat = (value: SetStateAction<boolean>) =>
    setChatField("showNewChat", value);
  const setAllUsers = (value: SetStateAction<UserItem[]>) =>
    setChatField("allUsers", value);
  const setUserSearch = (value: SetStateAction<string>) =>
    setChatField("userSearch", value);
  const setPendingFile = (value: SetStateAction<File | null>) =>
    setChatField("pendingFile", value);
  const setActivePeerMessageKey = (value: SetStateAction<MessageKeyEnvelope | null>) =>
    setChatField("activePeerMessageKey", value);
  const setPendingPeerMessageKey = (value: SetStateAction<MessageKeyEnvelope | null>) =>
    setChatField("pendingPeerMessageKey", value);
  const setDeviceKeyFingerprint = (value: SetStateAction<string | null>) =>
    setChatField("deviceKeyFingerprint", value);
  const setSecureStatus = (value: SetStateAction<string | null>) =>
    setChatField("secureStatus", value);
  const setAttachmentBusyId = (value: SetStateAction<string | null>) =>
    setChatField("attachmentBusyId", value);
  const setKeyDialogMode = (value: SetStateAction<KeyDialogMode>) =>
    setChatField("keyDialogMode", value);
  const setMessageTimerSeconds = (value: SetStateAction<number>) =>
    setChatField("messageTimerSeconds", value);
  const setDeleteTarget = (value: SetStateAction<Message | null>) =>
    setChatField("deleteTarget", value);
  const setDeletingMessageId = (value: SetStateAction<string | null>) =>
    setChatField("deletingMessageId", value);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activePeerRef = useRef<string | null>(null);
  const ignoredRoutePeerRef = useRef<string | null>(null);
  const messageRequestIdRef = useRef(0);
  const peerMessageKeyCacheRef = useRef<Record<string, MessageKeyEnvelope>>({});

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 112)}px`;
  }, [input]);

  useEffect(() => {
    if (!messages.some((message) => message.expires_at)) return;
    const interval = window.setInterval(() => {
      dispatchChatState({ expiryClock: Date.now() });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [messages]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!canViewChat) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setConversationError(false);
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch {
      setConversationError(true);
    } finally {
      setLoading(false);
    }
  }, [canViewChat]);

  const loadPeerMessageKey = useCallback(
    async (peerId: string, fingerprint?: string | null) => {
      if (fingerprint) {
        const cached = peerMessageKeyCacheRef.current[`${peerId}:${fingerprint}`];
        if (cached) return cached;
      }

      const key = await fetchPeerMessageKey(myId, peerId, fingerprint);
      if (key) {
        // Fingerprint-addressed historical keys are immutable and safe to
        // cache. The active key is deliberately fetched on every send so a
        // rotation cannot be hidden by a stale in-memory entry.
        peerMessageKeyCacheRef.current[`${peerId}:${key.fingerprint}`] = key;
      }
      return key;
    },
    [myId],
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
          const localKey = await getLocalMessageKey(myId, myFingerprint);
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
    async (peerId: string, markRead = false, preserveHistory = false) => {
      if (!canViewChat) {
        setMessages([]);
        return;
      }
      const requestId = ++messageRequestIdRef.current;
      setMessageLoading(true);
      setMessageError(false);
      try {
        const msgs = await fetchPeerMessages(peerId);
        const hydrated = await hydrateMessages(peerId, msgs);
        if (
          requestId !== messageRequestIdRef.current ||
          activePeerRef.current !== peerId
        ) {
          return;
        }
        setMessages((current) => {
          if (!preserveHistory) return hydrated;
          const incomingIds = new Set(hydrated.map((message) => message.id));
          return [...hydrated, ...current.filter((message) => !incomingIds.has(message.id))];
        });
        setHasOlderMessages((current) => (preserveHistory ? current : msgs.length === 100));
        if (markRead) {
          await markPeerMessagesRead(peerId);
        }
      } catch (error) {
        if (
          requestId === messageRequestIdRef.current &&
          activePeerRef.current === peerId
        ) {
          setMessageError(true);
        }
        throw error;
      } finally {
        if (
          requestId === messageRequestIdRef.current &&
          activePeerRef.current === peerId
        ) {
          setMessageLoading(false);
        }
      }
    },
    [canViewChat, hydrateMessages],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!activePeer || olderMessagesLoading || !hasOlderMessages) return;
    const oldest = messages[messages.length - 1];
    if (!oldest || oldest.id.startsWith("local-")) return;

    setOlderMessagesLoading(true);
    try {
      const raw = await fetchPeerMessages(activePeer, oldest);
      const hydrated = await hydrateMessages(activePeer, raw);
      if (activePeerRef.current !== activePeer) return;
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...current, ...hydrated.filter((message) => !currentIds.has(message.id))];
      });
      setHasOlderMessages(raw.length === 100);
    } catch {
      setMessageError(true);
    } finally {
      if (activePeerRef.current === activePeer) setOlderMessagesLoading(false);
    }
  }, [activePeer, hasOlderMessages, hydrateMessages, messages, olderMessagesLoading]);

  useEffect(() => {
    if (!canViewChat) {
      void loadConversations();
      return;
    }
    void loadConversations();
  }, [canViewChat, loadConversations]);

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
        const key = await ensureServerMessageKey(myId);
        if (!cancelled) setDeviceKeyFingerprint(key.fingerprint);
      } catch {
        if (!cancelled) {
          setSecureStatus(t.chat_secure_setup_failed_device);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canViewChat, myId, t.chat_secure_setup_failed_device]);

  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  const clearActivePeerMessageKey = useCallback(() => {
    setActivePeerMessageKey(null);
  }, []);

  const resetActivePeerSecurity = useCallback(() => {
    setActivePeerMessageKey(null);
    setPendingPeerMessageKey(null);
    setSecureStatus(null);
  }, []);

  const applyActivePeerMessageKey = useCallback((key: MessageKeyEnvelope | null) => {
    setActivePeerMessageKey(key);
    setPendingPeerMessageKey(null);
    setSecureStatus(null);
  }, []);

  const failActivePeerMessageKey = useCallback(() => {
    setActivePeerMessageKey(null);
    setSecureStatus(t.chat_secure_key_failed);
  }, [t.chat_secure_key_failed]);

  const openPeerFromRoute = useCallback((peer: string, name: string, role: string) => {
    messageRequestIdRef.current += 1;
    activePeerRef.current = peer;
    setActivePeer(peer);
    setActiveName(name);
    setActiveRole(role);
    setMessages([]);
    setHasOlderMessages(false);
    setMessageLoading(true);
    setMessageError(false);
    setShowNewChat(false);
    setPendingFile(null);
    setMessageSearch("");
  }, []);

  useEffect(() => {
    if (!canViewChat) {
      clearActivePeerMessageKey();
      return;
    }
    if (!activePeer) {
      resetActivePeerSecurity();
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const key = await loadPeerMessageKey(activePeer);
        if (cancelled) return;
        applyActivePeerMessageKey(key);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof PeerMessageKeyChangedError) {
          setActivePeerMessageKey(null);
          setPendingPeerMessageKey(error.candidate);
          setSecureStatus(t.chat_secure_identity_changed);
        } else {
          failActivePeerMessageKey();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activePeer,
    applyActivePeerMessageKey,
    canViewChat,
    clearActivePeerMessageKey,
    failActivePeerMessageKey,
    loadPeerMessageKey,
    resetActivePeerSecurity,
    t.chat_secure_identity_changed,
  ]);

  useEffect(() => {
    const peer = searchParams.get("peer");
    if (!peer) {
      ignoredRoutePeerRef.current = null;
      return;
    }
    if (ignoredRoutePeerRef.current === peer) return;

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
      openPeerFromRoute(peer, name, role);
    }

  }, [
    activeName,
    activePeer,
    activeRole,
    allUsers,
    conversations,
    openPeerFromRoute,
    searchParams,
  ]);

  useEffect(() => {
    const state = location.state as
      | {
          __gmedNavigationUserId?: unknown;
          chatDraft?: unknown;
          chatDraftPeerId?: unknown;
        }
      | null;
    if (!state) return;

    const peer = searchParams.get("peer");
    const isOwnedDraft =
      state.__gmedNavigationUserId === myId &&
      state.chatDraftPeerId === peer &&
      typeof state.chatDraft === "string" &&
      state.chatDraft.length <= 10_000;
    if (isOwnedDraft) {
      setInput(state.chatDraft as string);
    }

    // History state is not an appropriate store for patient/free-text data.
    // Consume it once and immediately replace the current entry without it.
    setSearchParams(
      (current) => new URLSearchParams(current),
      { replace: true, state: null },
    );
  }, [location.state, myId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!searchParams.has("draft")) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("draft");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Keep chat live via WebSocket push.
  useEffect(() => {
    if (!canViewChat) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let connectTimer: number | null = null;
    let disposed = false;
    let reconnectAttempt = 0;

    const scheduleReconnect = () => {
      if (disposed) return;
      setConnectionStatus("reconnecting");
      const baseDelay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      const jitter = Math.floor(baseDelay * 0.25 * Math.random());
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, baseDelay + jitter);
    };

    const connect = () => {
      setConnectionStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
      const nextSocket = openMessagesSocket();
      if (!nextSocket) {
        setConnectionStatus("offline");
        scheduleReconnect();
        return;
      }
      socket = nextSocket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        setConnectionStatus("connected");
      };
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
          payload.type === "message_created" && payload.user_id === myId,
          true,
        ).catch(() => undefined);
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        scheduleReconnect();
      };
    };

    connectTimer = window.setTimeout(connect, 0);

    return () => {
      disposed = true;
      setConnectionStatus("offline");
      if (connectTimer !== null) window.clearTimeout(connectTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [canViewChat, loadConversations, loadMessagesForPeer, myId]);

  // Load messages when peer changes
  useEffect(() => {
    if (!activePeer) {
      setMessages([]);
      setHasOlderMessages(false);
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
    ignoredRoutePeerRef.current = null;
    messageRequestIdRef.current += 1;
    activePeerRef.current = userId;
    setActivePeer(userId);
    setActiveName(name);
    setActiveRole(role);
    setMessages([]);
    setHasOlderMessages(false);
    setMessageLoading(true);
    setMessageError(false);
    setShowNewChat(false);
    setPendingFile(null);
    setMessageSearch("");
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

  const closeConversation = () => {
    ignoredRoutePeerRef.current = activePeerRef.current;
    messageRequestIdRef.current += 1;
    activePeerRef.current = null;
    setActivePeer(null);
    setActiveName("");
    setActiveRole("");
    setMessages([]);
    setHasOlderMessages(false);
    setMessageLoading(false);
    setMessageError(false);
    setPendingFile(null);
    setMessageSearch("");
    resetActivePeerSecurity();
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("peer");
        next.delete("name");
        next.delete("role");
        next.delete("draft");
        return next;
      },
      { replace: true },
    );
  };

  const loadUsers = useCallback(async () => {
    if (!canViewChat) {
      setAllUsers([]);
      return;
    }
    setUserError(false);
    try {
      const data = await fetchAllowedPeers(userSearch);
      setAllUsers(data);
    } catch {
      setUserError(true);
    }
  }, [canViewChat, userSearch]);

  useEffect(() => {
    if (!showNewChat) return;
    const timer = window.setTimeout(() => void loadUsers(), 250);
    return () => window.clearTimeout(timer);
  }, [loadUsers, showNewChat]);

  const resetKeyDialog = useCallback(() => {
    setKeyDialogMode(null);
  }, []);

  const trustPendingPeerIdentity = useCallback(async () => {
    if (!activePeer || !pendingPeerMessageKey) return;
    try {
      const trusted = await fetchPeerMessageKey(
        myId,
        activePeer,
        null,
        pendingPeerMessageKey.fingerprint,
      );
      if (!trusted) throw new Error("Peer key is unavailable");
      peerMessageKeyCacheRef.current[`${activePeer}:${trusted.fingerprint}`] = trusted;
      setActivePeerMessageKey(trusted);
      setPendingPeerMessageKey(null);
      setSecureStatus(null);
    } catch (error) {
      if (error instanceof PeerMessageKeyChangedError) {
        setPendingPeerMessageKey(error.candidate);
        setSecureStatus(t.chat_secure_identity_changed);
        return;
      }
      setSecureStatus(t.chat_secure_key_failed);
    }
  }, [
    activePeer,
    myId,
    pendingPeerMessageKey,
    t.chat_secure_identity_changed,
    t.chat_secure_key_failed,
  ]);

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
      const localKey = await getLocalMessageKey(myId, myFingerprint);
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

  const handleAttachmentDownload = useCallback(
    async (message: Message) => {
      if (!message.attachment_key) return;

      setAttachmentBusyId(message.id);
      try {
        const bytes = await downloadMessageAttachmentBytes(message.attachment_key);
        downloadBlob(
          new Blob([bytes], {
            type: message.attachment_mime ?? "application/octet-stream",
          }),
          message.attachment_filename ?? "attachment",
        );
        setSecureStatus(null);
      } catch (error) {
        setSecureStatus(
          error instanceof Error ? error.message : t.chat_secure_operation_failed,
        );
      } finally {
        setAttachmentBusyId(null);
      }
    },
    [downloadBlob, t.chat_secure_operation_failed],
  );

  const applyDeliveryReceipt = (
    peerId: string,
    clientMessageId: string,
    receipt: SentMessageReceipt,
  ) => {
    if (activePeerRef.current !== peerId) return;
    setMessages((current) =>
      current.map((message) =>
        message.client_message_id === clientMessageId
          ? {
              ...message,
              id: receipt.id,
              created_at: receipt.created_at,
              expires_at: receipt.expires_at ?? message.expires_at,
              delivery_state: undefined,
            }
          : message,
      ),
    );
  };

  const deliverTextMessage = async (message: Message) => {
    const peerId = message.to_user;
    const clientMessageId = message.client_message_id;
    const text = message.message?.trim();
    if (!clientMessageId || !text) return;

    try {
      const lifecycle = {
        client_message_id: clientMessageId,
        ...(message.retry_expires_in_seconds
          ? { expires_in_seconds: message.retry_expires_in_seconds }
          : {}),
      };
      const currentPeerKey = await loadPeerMessageKey(peerId);
      if (!currentPeerKey) throw new Error("Secure peer identity is unavailable");
      applyActivePeerMessageKey(currentPeerKey);
      const receipt = await (async () => {
            const senderKey = await ensureServerMessageKey(myId);
            const payload = await encryptMessageForPeer(
              text,
              senderKey,
              currentPeerKey,
            );
            return sendPeerMessage(peerId, { ...payload, ...lifecycle });
          })();

      applyDeliveryReceipt(peerId, clientMessageId, receipt);
      setSecureStatus(null);
      void loadMessagesForPeer(peerId).catch(() => undefined);
      void loadConversations();
    } catch (error) {
      if (error instanceof PeerMessageKeyChangedError) {
        setActivePeerMessageKey(null);
        setPendingPeerMessageKey(error.candidate);
        if (activePeerRef.current === peerId) {
          setMessages((current) =>
            current.map((item) =>
              item.client_message_id === clientMessageId
                ? { ...item, delivery_state: "failed" }
                : item,
            ),
          );
          setSecureStatus(t.chat_secure_identity_changed);
        }
        return;
      }
      try {
        const serverMessages = await fetchPeerMessages(peerId);
        if (serverMessages.some((item) => item.client_message_id === clientMessageId)) {
          const hydrated = await hydrateMessages(peerId, serverMessages);
          if (activePeerRef.current === peerId) setMessages(hydrated);
          setSecureStatus(null);
          void loadConversations();
          return;
        }
      } catch {
        // The retry control below keeps the idempotency key and can safely resend.
      }
      if (activePeerRef.current === peerId) {
        setMessages((current) =>
          current.map((item) =>
            item.client_message_id === clientMessageId
              ? { ...item, delivery_state: "failed" }
              : item,
          ),
        );
        setSecureStatus(t.chat_secure_message_send_failed);
      }
    } finally {
      if (activePeerRef.current === peerId) setSending(false);
    }
  };

  const retryTextMessage = async (message: Message) => {
    if (sending || message.delivery_state !== "failed") return;
    setSending(true);
    setMessages((current) =>
      current.map((item) =>
        item.client_message_id === message.client_message_id
          ? { ...item, delivery_state: "sending" }
          : item,
      ),
    );
    await deliverTextMessage({ ...message, delivery_state: "sending" });
  };

  const confirmDeleteMessage = async () => {
    if (!deleteTarget || !activePeer || deletingMessageId) return;
    if (deleteTarget.id.startsWith("local-")) {
      setMessages((current) => current.filter((message) => message.id !== deleteTarget.id));
      setDeleteTarget(null);
      return;
    }

    setDeletingMessageId(deleteTarget.id);
    try {
      await deletePeerMessage(activePeer, deleteTarget.id);
      setMessages((current) => current.filter((message) => message.id !== deleteTarget.id));
      setDeleteTarget(null);
      setSecureStatus(null);
      void loadConversations();
    } catch {
      setSecureStatus(t.chat_message_delete_failed);
    } finally {
      setDeletingMessageId(null);
    }
  };

  // Send message
  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!activePeer || sending) return;

    // File upload
    if (pendingFile) {
      if (!activePeerMessageKey) {
        setSecureStatus(secureChannelPendingStatus);
        return;
      }
      setSending(true);
      const formData = new FormData();
      const caption = input.trim();
      const clientMessageId = crypto.randomUUID();
      formData.append("client_message_id", clientMessageId);
      if (messageTimerSeconds) {
        formData.append("expires_in_seconds", String(messageTimerSeconds));
      }
      try {
        const currentPeerKey = await loadPeerMessageKey(activePeer);
        if (!currentPeerKey) throw new Error("Secure peer identity is unavailable");
        applyActivePeerMessageKey(currentPeerKey);
        const senderKey = await ensureServerMessageKey(myId);
        const encryptedAttachment = await encryptAttachmentForPeer(
          new Uint8Array(await pendingFile.arrayBuffer()),
          senderKey,
          currentPeerKey,
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
            currentPeerKey,
          );
          formData.append("e2e_algorithm", payload.e2e_algorithm);
          formData.append("e2e_ciphertext", payload.e2e_ciphertext);
          formData.append("e2e_nonce", payload.e2e_nonce);
          formData.append("e2e_salt", payload.e2e_salt);
        }

        await uploadPeerAttachment(activePeer, formData);
        await loadMessagesForPeer(activePeer);
        void loadConversations();
        setSecureStatus(null);
        setInput("");
        setPendingFile(null);
        setMessageTimerSeconds(0);
      } catch (error) {
        if (error instanceof PeerMessageKeyChangedError) {
          setActivePeerMessageKey(null);
          setPendingPeerMessageKey(error.candidate);
          setSecureStatus(t.chat_secure_identity_changed);
        } else {
          setSecureStatus(t.chat_secure_attachment_send_failed);
        }
      } finally {
        setSending(false);
      }
      return;
    }

    // Text message
    if (!input.trim()) return;
    setSending(true);
    const msg = input.trim();
    const clientMessageId = crypto.randomUUID();
    const peerId = activePeer;
    const createdAt = new Date().toISOString();
    const expiresAt = messageTimerSeconds
      ? new Date(Date.now() + messageTimerSeconds * 1_000).toISOString()
      : null;
    const optimisticMessage: Message = {
      id: `local-${clientMessageId}`,
      from_user: myId,
      to_user: peerId,
      message: msg,
      is_e2e: !!activePeerMessageKey,
      is_read: false,
      read_at: null,
      created_at: createdAt,
      expires_at: expiresAt,
      client_message_id: clientMessageId,
      delivery_state: "sending",
      retry_expires_in_seconds: messageTimerSeconds || undefined,
      attachment_filename: null,
      attachment_mime: null,
      attachment_size: null,
      attachment_key: null,
    };
    setInput("");
    setMessageTimerSeconds(0);
    setMessages((current) => [optimisticMessage, ...current]);
    await deliverTextMessage(optimisticMessage);
  };

  // Filtered conversations (German-aware fold)
  const normalizedConvoSearch = deNormalize(search);
  const filteredConvos = normalizedConvoSearch
    ? conversations.filter((c) => deNormalize(c.name).includes(normalizedConvoSearch))
    : conversations;

  // Filtered users for new chat. Matches name, email, the role enum AND its localized
  // label (so typing "Dolmetscher" finds an interpreter), all German-folded.
  const normalizedUserSearch = deNormalize(userSearch);
  const filteredUsers = allUsers.filter(
    (u) =>
      u.is_active &&
      u.id !== myId &&
      (!normalizedUserSearch ||
        deNormalize(u.name).includes(normalizedUserSearch) ||
        deNormalize(u.email).includes(normalizedUserSearch) ||
        deNormalize(u.role).includes(normalizedUserSearch) ||
        deNormalize(roleDisplay(u.role, t)).includes(normalizedUserSearch)),
  );

  const messageTimerLabel =
    messageTimerSeconds === 60
      ? t.chat_message_timer_minute
      : messageTimerSeconds === 60 * 60
        ? t.chat_message_timer_hour
        : messageTimerSeconds === 24 * 60 * 60
          ? t.chat_message_timer_day
          : messageTimerSeconds === 7 * 24 * 60 * 60
            ? t.chat_message_timer_week
            : t.chat_message_timer_off;

  const normalizedMessageSearch = deNormalize(messageSearch);
  const displayMsgs = [...messages]
    .filter(
      (message) =>
        !message.expires_at || new Date(message.expires_at).getTime() > expiryClock,
    )
    .filter(
      (message) =>
        !normalizedMessageSearch ||
        deNormalize(message.message ?? "").includes(normalizedMessageSearch) ||
        deNormalize(message.attachment_filename ?? "").includes(normalizedMessageSearch),
    )
    .reverse();

  if (!canViewChat) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground shadow-sm">
        {t.chat_access_denied}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[420px] overflow-hidden rounded-xl border bg-card shadow-sm sm:h-[calc(100vh-8rem)] sm:rounded-2xl">
      {/* ── Left: Conversations ── */}
      <div
        className={cn(
          "w-full min-w-0 flex-col md:w-80 md:min-w-[280px] md:border-r",
          activePeer ? "hidden md:flex" : "flex",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">{t.chat_title}</h2>
          <button
            onClick={() => {
              setShowNewChat(!showNewChat);
            }}
            aria-label={t.chat_new}
            aria-expanded={showNewChat}
            aria-controls="chat-new-peer-picker"
            title={t.chat_new}
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            id="chat-new-peer-picker"
            data-testid="chat-new-picker"
            className="border-b px-4 py-2 space-y-2 bg-muted/30 animate-in fade-in slide-in-from-top-1 duration-200"
          >
            <Input
              placeholder={t.chat_search_users}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="h-8 rounded-lg text-sm"
            />
            <div
              className="max-h-40 overflow-y-auto space-y-0.5"
              role="listbox"
              aria-label={t.chat_search_users}
            >
              {userError ? (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <p className="text-xs text-destructive">{t.common_error}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadUsers()}>
                    {t.common_refresh}
                  </Button>
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t.chat_no_users_found}
                </p>
              ) : filteredUsers.map((u) => (
                <button
                  key={u.id}
                  role="option"
                  aria-selected={activePeer === u.id}
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
            <div className="space-y-3 p-4" aria-label={t.common_loading} aria-busy="true">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="flex animate-pulse items-center gap-3">
                  <div className="size-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 rounded bg-muted" />
                    <div className="h-2.5 w-4/5 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversationError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm text-destructive">{t.chat_load_failed}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadConversations()}>
                {t.common_refresh}
              </Button>
            </div>
          ) : filteredConvos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t.chat_no_conversations}</p>
              <Button type="button" size="sm" onClick={() => setShowNewChat(true)}>
                <MessageSquarePlus className="size-4" />
                {t.chat_start_conversation}
              </Button>
            </div>
          ) : (
            filteredConvos.map((c) => (
              <button
                key={c.user_id}
                aria-current={activePeer === c.user_id ? "page" : undefined}
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
      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          activePeer ? "flex" : "hidden md:flex",
        )}
      >
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="size-12 opacity-30" />
            <p className="text-sm">{t.chat_select_conversation}</p>
            <Button type="button" variant="outline" onClick={() => setShowNewChat(true)}>
              <MessageSquarePlus className="size-4" />
              {t.chat_start_conversation}
            </Button>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between gap-3 border-b px-3 py-3 sm:px-5 sm:py-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  aria-label={t.chat_title}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                  onClick={closeConversation}
                >
                  <ArrowLeft className="size-4" />
                </button>
                <div className="flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {initials(activeName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{activeName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {roleDisplay(activeRole, t)}
                    {` - ${
                      activePeerMessageKey
                        ? t.chat_secure_encrypted_label
                        : t.chat_secure_server_channel_label
                    }`}
                  </p>
                  <p className="text-[10px] text-muted-foreground" aria-live="polite">
                    {connectionStatus === "connected"
                      ? t.chat_connection_connected
                      : connectionStatus === "reconnecting"
                        ? t.chat_connection_reconnecting
                        : connectionStatus === "offline"
                          ? t.chat_connection_offline
                          : t.chat_connection_connecting}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activePeerMessageKey
                    ? "border-emerald-200 text-emerald-700"
                    : "border-border text-muted-foreground",
                )}
                onClick={() => setKeyDialogMode("manage")}
                title={t.chat_security_settings}
                aria-label={t.chat_security_settings}
              >
                <ShieldCheck className="size-4" />
              </button>
            </div>

            <div className="border-b px-3 py-2 sm:px-5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder={t.chat_search_messages}
                  aria-label={t.chat_search_messages}
                  className="h-9 rounded-lg pl-9"
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t.chat_search_loaded_history}
              </p>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label={t.chat_message_history}
            >
              {messageLoading && displayMsgs.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t.common_loading}
                </div>
              ) : null}
              {messageError ? (
                <div className="mx-auto my-4 flex max-w-sm flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-center">
                  <p className="text-sm text-destructive">{t.common_error}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => activePeer && void loadMessagesForPeer(activePeer, true)}
                  >
                    {t.common_refresh}
                  </Button>
                </div>
              ) : null}
              {!messageLoading && !messageError && messageSearch && displayMsgs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t.chat_no_message_matches}
                </p>
              ) : null}
              {hasOlderMessages ? (
                <div className="mb-4 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={olderMessagesLoading}
                    onClick={() => void loadOlderMessages()}
                  >
                    {olderMessagesLoading ? t.common_loading : t.chat_load_older}
                  </Button>
                </div>
              ) : null}
              {displayMsgs.map((m, index) => {
                const mine = m.from_user === myId;
                const previousMessage = displayMsgs[index - 1];
                const nextMessage = displayMsgs[index + 1];
                const groupedWithPrevious = isSameChatMessageGroup(previousMessage, m);
                const groupedWithNext = isSameChatMessageGroup(m, nextMessage);
                const startsNewDay =
                  !previousMessage ||
                  chatMessageDateKey(previousMessage.created_at) !==
                    chatMessageDateKey(m.created_at);
                const hasText = !!m.message?.trim();
                const hasAttachment = !!m.attachment_key;
                const isSecureAttachment = m.attachment_is_e2e ?? false;
                const isImage =
                  !isSecureAttachment && (m.attachment_mime?.startsWith("image/") ?? false);
                const readReceipt =
                  mine && m.read_at ? `${t.chat_seen} ${timeAgo(m.read_at)}` : null;
                const expiryLabel = m.expires_at
                  ? t.chat_message_expires.replace(
                      "{time}",
                      formatMessageExpiry(m.expires_at, lang, expiryClock),
                    )
                  : null;

                return (
                  <div
                    key={m.id}
                    className={groupedWithPrevious ? "mt-1" : "mt-3"}
                  >
                    {startsNewDay ? (
                      <div
                        role="separator"
                        className="my-4 flex items-center gap-3 text-[10px] text-muted-foreground"
                      >
                        <span className="h-px flex-1 bg-border" />
                        <span>{formatChatDay(m.created_at, lang)}</span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "group/message flex flex-col",
                        mine ? "items-end" : "items-start",
                      )}
                    >
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
                            <p className="text-xs font-medium break-words">
                              {m.attachment_filename}
                            </p>
                            <p className="text-[10px] opacity-70">
                              {t.chat_secure_attachment_label} - {formatSize(m.attachment_size ?? 0)}
                            </p>
                            <p className="text-[10px] opacity-80">
                              {t.chat_secure_attachment_unscanned}
                            </p>
                          </div>
                          <Download className="size-3.5 shrink-0 opacity-60" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleAttachmentDownload(m)}
                          disabled={attachmentBusyId === m.id}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-xl mb-1 max-w-[280px] transition-colors text-left disabled:opacity-60",
                            mine ? "bg-foreground/90 text-background" : "bg-muted"
                          )}
                        >
                          <FileText className="size-4 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium break-words">{m.attachment_filename}</p>
                            <p className="text-[10px] opacity-70">
                              {isImage ? t.uiText.chat_attachment_image : t.uiText.chat_attachment_file} - {formatSize(m.attachment_size ?? 0)}
                            </p>
                          </div>
                          <Download className="size-3.5 shrink-0 opacity-60" />
                        </button>
                      ))}
                    {/* Text bubble */}
                    {hasText && (
                      <div
                        data-testid={`chat-message-text-${m.id}`}
                        className={cn(
                          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-5 sm:max-w-[70%]",
                          mine
                            ? cn(
                                "bg-foreground text-background",
                                groupedWithPrevious && "rounded-tr-md",
                                groupedWithNext && "rounded-br-md",
                              )
                            : cn(
                                "bg-muted text-foreground",
                                groupedWithPrevious && "rounded-tl-md",
                                groupedWithNext && "rounded-bl-md",
                              ),
                        )}
                      >
                        {m.message}
                      </div>
                    )}
                    <div className="mt-0.5 flex min-h-5 items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                      {m.delivery_state === "sending" ? (
                        <span>{t.chat_message_sending}</span>
                      ) : null}
                      {m.delivery_state === "failed" ? (
                        <>
                          <span className="text-destructive">{t.chat_message_failed}</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-foreground hover:bg-muted"
                            onClick={() => void retryTextMessage(m)}
                            disabled={sending}
                          >
                            <RotateCcw className="size-3" />
                            {t.chat_message_retry}
                          </button>
                        </>
                      ) : null}
                      {expiryLabel ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3" />
                          {expiryLabel}
                        </span>
                      ) : null}
                      {!groupedWithNext && m.delivery_state !== "sending" ? (
                        <span>
                          {timeAgo(m.created_at)}
                          {readReceipt ? ` - ${readReceipt}` : ""}
                        </span>
                      ) : null}
                      {mine && m.delivery_state !== "sending" ? (
                        <button
                          type="button"
                          className="inline-flex size-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:size-7"
                          onClick={() => setDeleteTarget(m)}
                          disabled={deletingMessageId === m.id}
                          aria-label={t.chat_message_delete}
                          title={t.chat_message_delete}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {secureStatus && (
              <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground sm:px-5">
                <Shield className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{secureStatus}</span>
                <button
                  type="button"
                  className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                  onClick={() => setSecureStatus(null)}
                  aria-label={t.common_close}
                  title={t.common_close}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {/* Pending file preview */}
            {pendingFile && (
              <div className="flex items-center gap-3 px-5 py-2 border-t bg-muted/30 animate-in fade-in duration-150">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 min-w-0 break-words">{pendingFile.name}</span>
                <span className="text-xs text-muted-foreground">{formatSize(pendingFile.size)}</span>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t.common_remove}
                  title={t.common_remove}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSend} className="flex flex-wrap items-center gap-1.5 border-t px-2 py-2.5 sm:gap-2 sm:px-4 sm:py-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (!activePeerMessageKey) {
                    setSecureStatus(secureChannelPendingStatus);
                    e.target.value = "";
                    return;
                  }
                  const file = e.target.files?.[0];
                  if (file && !isAllowedChatAttachment(file)) {
                    setSecureStatus(t.chat_attachment_type_blocked);
                    setPendingFile(null);
                  } else if (file && file.size > CHAT_ATTACHMENT_MAX_BYTES) {
                    setSecureStatus(t.chat_attachment_too_large);
                    setPendingFile(null);
                  } else if (file) {
                    setSecureStatus(null);
                    setPendingFile(file);
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!activePeerMessageKey) {
                    setSecureStatus(secureChannelPendingStatus);
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={sending}
                title={
                  activePeerMessageKey
                    ? t.chat_secure_attachment_label
                    : secureChannelPendingStatus
                }
                aria-label={t.chat_secure_attachment_label}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Paperclip className="size-[18px]" />
              </button>
              <label
                className={cn(
                  "relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  messageTimerSeconds > 0 && "bg-amber-50 text-amber-700",
                )}
                title={`${t.chat_message_timer}: ${messageTimerLabel}`}
              >
                <Clock3 className="size-[18px]" />
                {messageTimerSeconds > 0 ? (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" />
                ) : null}
                <select
                  value={messageTimerSeconds}
                  onChange={(event) => setMessageTimerSeconds(Number(event.target.value))}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={t.chat_message_timer}
                  disabled={sending}
                >
                  {CHAT_TIMER_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds === 60
                        ? t.chat_message_timer_minute
                        : seconds === 60 * 60
                          ? t.chat_message_timer_hour
                          : seconds === 24 * 60 * 60
                            ? t.chat_message_timer_day
                            : seconds === 7 * 24 * 60 * 60
                              ? t.chat_message_timer_week
                              : t.chat_message_timer_off}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={t.chat_type_message}
                autoComplete="off"
                rows={1}
                maxLength={10_000}
                aria-label={t.chat_type_message}
                aria-describedby="chat-composer-keyboard-hint"
                className="min-h-10 max-h-28 flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <button
                type="submit"
                disabled={
                  sending ||
                  !activePeerMessageKey ||
                  (!input.trim() && !pendingFile)
                }
                aria-label={t.chat_send}
                title={t.chat_send}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
              <p
                id="chat-composer-keyboard-hint"
                className="basis-full pr-1 text-right text-[10px] text-muted-foreground"
              >
                {t.chat_composer_keyboard_hint}
              </p>
            </form>

            <Dialog open={keyDialogMode !== null} onOpenChange={(open) => !open && resetKeyDialog()}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t.chat_security_settings}</DialogTitle>
                  <DialogDescription>
                    {t.chat_security_device_bound_description}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-3 py-3">
                    <ShieldCheck
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        activePeerMessageKey
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0 space-y-2">
                      <p className="text-sm font-medium">
                        {activePeerMessageKey
                          ? t.chat_secure_encrypted_label
                          : t.chat_secure_identity_unverified}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.chat_security_e2e_description}
                      </p>
                      <dl className="space-y-1 font-mono text-[10px] text-muted-foreground">
                        <div>
                          <dt className="font-sans font-medium">{t.chat_security_this_device}</dt>
                          <dd className="break-all">{deviceKeyFingerprint ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="font-sans font-medium">{t.chat_security_peer_device}</dt>
                          <dd className="break-all">
                            {activePeerMessageKey?.fingerprint ?? pendingPeerMessageKey?.fingerprint ?? "-"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  {pendingPeerMessageKey ? (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-950">
                      <p>{t.chat_secure_identity_changed}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void trustPendingPeerIdentity()}
                      >
                        {t.chat_secure_trust_new_identity}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={resetKeyDialog}>
                    {t.chat_close}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <DirtyDismissConfirmDialog
              open={deleteTarget !== null}
              title={t.chat_message_delete_title}
              message={t.chat_message_delete_description}
              cancelLabel={t.common_cancel}
              confirmLabel={t.common_delete}
              destructive
              confirmDisabled={deletingMessageId !== null}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={() => void confirmDeleteMessage()}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ChatPage(...args: Parameters<typeof useChatPageContent>) {
  return useChatPageContent(...args);
}
