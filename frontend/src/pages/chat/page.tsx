import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type SetStateAction } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  MessageSquarePlus,
  Search,
  Send,
  Paperclip,
  X,
  MessageSquare,
  Shield,
  ShieldCheck,
  ArrowLeft,
  Clock3,
  RotateCcw,
  Trash2,
  ArrowDown,
  Check,
  CheckCheck,
  LoaderCircle,
} from "lucide-react";
import {
  chatE2EPreviewText,
  chatE2EUnavailableText,
  decryptAttachmentFromPeer,
  decryptMessageFromPeer,
  fetchMessageKeyByFingerprint,
  getLocalMessageKey,
  importLegacyMessageKeys,
  type MessageKeyEnvelope,
} from "@/lib/chat-e2e";
import { useAuth } from "@/lib/auth";
import { formatAppDate } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { cn } from "@/lib/utils";
import { deNormalize } from "@/components/data-table/search";
import {
  convertAttachmentFromE2E,
  convertMessageFromE2E,
  downloadMessageAttachmentBytes,
  deletePeerMessage,
  fetchAllowedPeers,
  fetchConversations,
  fetchLatestPeerMessage,
  fetchPeerMessages,
  markPeerMessagesRead,
  openMessagesSocket,
  sendPeerMessage,
  uploadPeerAttachment,
  type SentMessageReceipt,
} from "./data/chat-api";
import {
  canAccessChat,
  canMarkLoadedMessagesRead,
  chatMessageDateKey,
  initials,
  isSameChatMessageGroup,
  mergeChatMessages,
  reconcileChatMessages,
  sortChatMessages,
  roleDisplay,
  timeAgo,
  truncate,
} from "./model/chat-model";
import type { ChatStreamEvent, Conversation, Message, UserItem } from "./model/types";
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_MAX_COUNT, chatAttachmentMime, chatAttachmentProblem, type PendingChatAttachment } from "./model/attachments";
import { createE2ERescueQueue, type E2ERescueJob } from "./model/e2e-rescue";
import { buildAttachmentFormData, buildTextMessagePayload } from "./model/outgoing";
import { ChatAttachment, PendingAttachment } from "./ui/chat-attachment";

type ChatConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

const CHAT_TIMER_OPTIONS = [0, 60, 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60] as const;

function formatChatDay(iso: string) {
  return formatAppDate(iso) || iso.slice(0, 10);
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
  pendingFiles: PendingChatAttachment[];
  secureStatus: string | null;
  messageTimerSeconds: number;
  deleteTarget: Message | null;
  deletingMessageId: string | null;
  expiryClock: number;
  usersLoading: boolean;
  showScrollToLatest: boolean;
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
      pendingFiles: [],
      secureStatus: null,
      messageTimerSeconds: 0,
      deleteTarget: null,
      deletingMessageId: null,
      expiryClock: Date.now(),
      usersLoading: false,
      showScrollToLatest: false,
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
    pendingFiles,
    secureStatus,
    messageTimerSeconds,
    deleteTarget,
    deletingMessageId,
    expiryClock,
    usersLoading,
    showScrollToLatest,
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
  const setPendingFiles = (value: SetStateAction<PendingChatAttachment[]>) =>
    setChatField("pendingFiles", value);
  const setSecureStatus = (value: SetStateAction<string | null>) =>
    setChatField("secureStatus", value);
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
  const peerMessageKeyRequestsRef = useRef(new Map<string, Promise<MessageKeyEnvelope | null>>());
  const conversationRequestIdRef = useRef(0);
  const userRequestIdRef = useRef(0);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef(true);
  const scrollContentRef = useRef<{ newestId?: string; fileCount: number } | null>(null);
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const outboxRef = useRef(new Map<string, Message>());
  const draftRef = useRef(new Map<string, { input: string; pendingFiles: PendingChatAttachment[]; messageTimerSeconds: number }>());
  const uploadAttemptRef = useRef(new Map<string, {
    caption: string; timer: number; id: string; formData?: FormData;
  }>());
  const [attachmentUpload, setAttachmentUpload] = useState<{ peerId: string; fileId: string; index: number; total: number; name: string } | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const sendLockRef = useRef(false);
  const afterRescueRef = useRef<(job: E2ERescueJob) => void>(() => undefined);
  // Hands old end-to-end history that this browser can still open back to the
  // server once, so it becomes readable on every device.
  const [rescueQueue] = useState(() => createE2ERescueQueue({
    convertText: convertMessageFromE2E,
    convertAttachment: convertAttachmentFromE2E,
    onConverted: (job) => afterRescueRef.current(job),
  }));

  useLayoutEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const newest = sortChatMessages(messages)[0];
    const newestId = newest?.client_message_id || newest?.id;
    const previous = scrollContentRef.current;
    const contentChanged = !previous || previous.newestId !== newestId || previous.fileCount !== pendingFiles.length;
    scrollContentRef.current = { newestId, fileCount: pendingFiles.length };
    const prepend = prependScrollRef.current;
    if (prepend) {
      container.scrollTop = prepend.top + container.scrollHeight - prepend.height;
      prependScrollRef.current = null;
    } else if (scrollToBottomRef.current && contentChanged) {
      container.scrollTop = container.scrollHeight;
    }
    dispatchChatState({ showScrollToLatest: container.scrollHeight - container.scrollTop - container.clientHeight > 100 });
  }, [messages, pendingFiles.length]);

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

  const loadPeerMessageKey = useCallback(
    async (peerId: string, fingerprint: string) => {
      const cacheId = `${peerId}:${fingerprint}`;
      const cached = peerMessageKeyCacheRef.current[cacheId];
      if (cached) return cached;
      const pending = peerMessageKeyRequestsRef.current.get(cacheId);
      if (pending) return pending;
      const request = fetchMessageKeyByFingerprint(peerId, fingerprint);
      peerMessageKeyRequestsRef.current.set(cacheId, request);
      try {
        const key = await request;
        // Device keys of old messages never change, so they can be cached.
        if (key) peerMessageKeyCacheRef.current[cacheId] = key;
        return key;
      } finally {
        peerMessageKeyRequestsRef.current.delete(cacheId);
      }
    },
    [],
  );

  // An old end-to-end message opens only where this browser still holds the
  // device key it used at the time; no key is ever created any more.
  const loadLegacyKeys = useCallback(async (message: Message) => {
    const mine = message.from_user === myId;
    const ownFingerprint = mine ? message.sender_key_fingerprint : message.recipient_key_fingerprint;
    const peerFingerprint = mine ? message.recipient_key_fingerprint : message.sender_key_fingerprint;
    if (!ownFingerprint || !peerFingerprint) return null;
    const localKey = await getLocalMessageKey(myId, ownFingerprint);
    if (!localKey) return null;
    const peerKey = await loadPeerMessageKey(mine ? message.to_user : message.from_user, peerFingerprint);
    return peerKey ? { localKey, peerKey } : null;
  }, [loadPeerMessageKey, myId]);

  const loadLegacyAttachmentBytes = useCallback(async (message: Message) => {
    if (!message.attachment_key) throw new Error(t.chat_attachment_load_failed);
    await importLegacyMessageKeys(myId).catch(() => undefined);
    const keys = await loadLegacyKeys(message).catch(() => null);
    if (!keys) throw new Error(t.chat_secure_attachment_unavailable);
    let ciphertext: ArrayBuffer;
    try { ciphertext = await downloadMessageAttachmentBytes(message.attachment_key); }
    catch { throw new Error(t.chat_attachment_load_failed); }
    try { return await decryptAttachmentFromPeer(message, new Uint8Array(ciphertext), keys.localKey, keys.peerKey); }
    catch { throw new Error(t.chat_secure_attachment_decrypt_failed); }
  }, [loadLegacyKeys, myId, t.chat_attachment_load_failed, t.chat_secure_attachment_unavailable, t.chat_secure_attachment_decrypt_failed]);

  // Queued once per message and page session: the caption or text first, the
  // attachment after it (the server requires that order).
  const queueLegacyRescue = useCallback((peerId: string, message: Message) => {
    if (message.id.startsWith("local-")) return;
    const text = message.message;
    if (message.is_e2e && !message.decryption_failed && text?.trim()) {
      rescueQueue.enqueue({ kind: "text", peerId, messageId: message.id, text });
    }
    if (message.attachment_is_e2e && message.attachment_key) {
      rescueQueue.enqueue({
        kind: "attachment", peerId, messageId: message.id,
        filename: message.attachment_filename || "attachment",
        load: () => loadLegacyAttachmentBytes(message),
      });
    }
  }, [loadLegacyAttachmentBytes, rescueQueue]);

  const hydrateMessages = useCallback(
    async (peerId: string, rawMessages: Message[]) => {
      if (!rawMessages.some((message) => message.is_e2e || message.attachment_is_e2e)) return rawMessages;
      // Device keys of the first chat version may still sit in local storage.
      await importLegacyMessageKeys(myId).catch(() => undefined);
      const unavailable = chatE2EUnavailableText(lang);
      const hydrated = await Promise.all(
        rawMessages.map(async (message) => {
          if (!message.is_e2e && !message.attachment_is_e2e) return { message, readable: false };
          const keys = await loadLegacyKeys(message).catch(() => null);
          if (!message.is_e2e) return { message, readable: Boolean(keys) };
          if (keys) {
            try {
              const text = await decryptMessageFromPeer(message, keys.localKey, keys.peerKey);
              return { message: { ...message, message: text, decryption_failed: false }, readable: true };
            } catch {
              // Falls through to the placeholder below.
            }
          }
          return { message: { ...message, message: unavailable, decryption_failed: true }, readable: false };
        }),
      );
      for (const { message, readable } of hydrated) {
        if (readable) queueLegacyRescue(peerId, message);
      }
      return hydrated.map(({ message }) => message);
    },
    [lang, loadLegacyKeys, myId, queueLegacyRescue],
  );

  // Previews of old end-to-end messages stay in memory and reuse the latest
  // envelope until the conversation changes; the server cannot read them.
  const conversationPreviewsRef = useRef(new Map<string, { source: string; text: string; decrypted: boolean }>());
  const previewRequestsRef = useRef(new Map<string, Promise<string>>());
  const loadConversations = useCallback(async () => {
    if (!canViewChat) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const requestId = ++conversationRequestIdRef.current;
    try {
      const data = await fetchConversations();
      if (requestId !== conversationRequestIdRef.current) return;
      const previewSource = (conversation: Conversation) =>
        JSON.stringify([myId, conversation.user_id, conversation.last_at, conversation.is_mine, conversation.last_message]);
      const encryptedPreview = chatE2EPreviewText(lang);
      setConversations(data.map((conversation) => {
        if (!conversation.is_e2e) return conversation;
        const cached = conversationPreviewsRef.current.get(conversation.user_id);
        return { ...conversation, last_message: cached?.source === previewSource(conversation) ? cached.text : encryptedPreview };
      }));
      setConversationError(false);
      setLoading(false);
      const peers = new Set(data.map((conversation) => conversation.user_id));
      for (const peer of conversationPreviewsRef.current.keys()) {
        if (!peers.has(peer)) conversationPreviewsRef.current.delete(peer);
      }
      // Preview lookups must not hold up foreground message/read reconciliation.
      void Promise.all(data.filter((conversation) => conversation.is_e2e).map(async (conversation) => {
        const source = previewSource(conversation);
        const cached = conversationPreviewsRef.current.get(conversation.user_id);
        if (cached?.source === source && cached.decrypted) return;
        let pending = previewRequestsRef.current.get(source);
        if (!pending) {
          pending = (async () => {
            // Only one message is needed; fetching it must never mark the chat read.
            const latest = await fetchLatestPeerMessage(conversation.user_id);
            if (!latest || Date.parse(latest.created_at) !== Date.parse(conversation.last_at) ||
                (latest.from_user === myId) !== conversation.is_mine) {
              return encryptedPreview;
            }
            const [hydrated] = await hydrateMessages(conversation.user_id, [latest]);
            const preview = hydrated.message || (hydrated.attachment_filename ? `[${hydrated.attachment_filename}]` : "");
            conversationPreviewsRef.current.set(conversation.user_id, {
              source, text: preview, decrypted: !hydrated.decryption_failed,
            });
            return preview;
          })();
          previewRequestsRef.current.set(source, pending);
        }
        try {
          const preview = await pending;
          if (requestId !== conversationRequestIdRef.current) return;
          setConversations((current) => current.map((row) =>
            row.user_id === conversation.user_id ? { ...row, last_message: preview } : row,
          ));
        } catch {
          // A failed preview lookup must not hide the conversation or its badge.
        } finally {
          previewRequestsRef.current.delete(source);
        }
      }));
    } catch {
      if (requestId === conversationRequestIdRef.current) setConversationError(true);
    } finally {
      if (requestId === conversationRequestIdRef.current) setLoading(false);
    }
  }, [canViewChat, hydrateMessages, lang, myId]);

  const loadMessagesForPeer = useCallback(
    async (peerId: string, markRead = false, preserveHistory = true) => {
      if (!canViewChat) {
        setMessages([]);
        return;
      }
      const requestId = ++messageRequestIdRef.current;
      // Background reconciliation keeps the loaded view, including empty
      // search results and any error notice, until a response arrives.
      if (!preserveHistory) setMessageLoading(true);
      try {
        const msgs = await fetchPeerMessages(peerId);
        const hydrated = await hydrateMessages(peerId, msgs);
        if (
          requestId !== messageRequestIdRef.current ||
          activePeerRef.current !== peerId
        ) {
          return;
        }
        setMessageError(false);
        for (const message of hydrated) {
          if (message.client_message_id) outboxRef.current.delete(message.client_message_id);
        }
        setMessages((current) => {
          const pending = [...outboxRef.current.values()].filter((message) => message.to_user === peerId);
          return reconcileChatMessages(mergeChatMessages(preserveHistory ? current : [], pending), hydrated);
        });
        setHasOlderMessages((current) => preserveHistory ? current || msgs.length === 100 : msgs.length === 100);
        if (markRead && document.visibilityState === "visible" &&
            canMarkLoadedMessagesRead(hydrated, myId)) {
          // A failed read receipt must not hide successfully loaded messages.
          await markPeerMessagesRead(peerId).then(() => {
            // Do not let an older list request restore the badge, or keep it
            // visible just because the follow-up list refresh fails.
            conversationRequestIdRef.current++;
            setConversations((current) => current.map((conversation) =>
              conversation.user_id === peerId ? { ...conversation, unread: 0 } : conversation,
            ));
            return loadConversations();
          }).catch(() => undefined);
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
    [canViewChat, hydrateMessages, loadConversations, myId],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!activePeer || olderMessagesLoading || !hasOlderMessages) return;
    const oldest = sortChatMessages(messages.filter((message) => !message.id.startsWith("local-"))).at(-1);
    if (!oldest || oldest.id.startsWith("local-")) return;

    setOlderMessagesLoading(true);
    try {
      const raw = await fetchPeerMessages(activePeer, oldest);
      const hydrated = await hydrateMessages(activePeer, raw);
      if (activePeerRef.current !== activePeer) return;
      const container = messagesScrollRef.current;
      if (container) prependScrollRef.current = { height: container.scrollHeight, top: container.scrollTop };
      setMessages((current) => mergeChatMessages(current, hydrated));
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
    activePeerRef.current = activePeer;
  }, [activePeer]);

  useEffect(() => {
    afterRescueRef.current = (job) => {
      // A converted attachment is stored under a new key: reload the history
      // so the next download uses it.
      if (job.kind === "attachment" && activePeerRef.current === job.peerId) {
        void loadMessagesForPeer(job.peerId).catch(() => undefined);
      }
    };
  }, [loadMessagesForPeer]);

  const openPeerFromRoute = useCallback((peer: string, name: string, role: string) => {
    scrollToBottomRef.current = true;
    scrollContentRef.current = null;
    prependScrollRef.current = null;
    messageRequestIdRef.current += 1;
    activePeerRef.current = peer;
    setActivePeer(peer);
    setActiveName(name);
    setActiveRole(role);
    setMessages([...outboxRef.current.values()].filter((message) => message.to_user === peer));
    setHasOlderMessages(false);
    setMessageLoading(true);
    setMessageError(false);
    setShowNewChat(false);
    dispatchChatState({
      ...(draftRef.current.get(peer) ?? { input: "", pendingFiles: [], messageTimerSeconds: 0 }),
      olderMessagesLoading: false,
      deleteTarget: null,
      showScrollToLatest: false,
      secureStatus: null,
    });
    setMessageSearch("");
  }, []);

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
      if (activePeer) draftRef.current.set(activePeer, { input, pendingFiles, messageTimerSeconds });
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

  // Push is an optimization; HTTP reconciliation also recovers missed events.
  useEffect(() => {
    if (!canViewChat) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let handshakeTimer: number | undefined;
    let disposed = false;
    let connecting = false;
    let reconnectAttempt = 0;
    let connected = false;
    let refreshing = false;
    let refreshQueued = false;
    let lastRefresh = 0;

    const refresh = async () => {
      if (disposed || !navigator.onLine || document.visibilityState !== "visible") return;
      if (refreshing) { refreshQueued = true; return; }
      refreshing = true;
      lastRefresh = Date.now();
      try {
        const peer = activePeerRef.current;
        await Promise.allSettled([
          loadConversations(),
          ...(peer ? [loadMessagesForPeer(peer, true)] : []),
        ]);
      } finally {
        refreshing = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void refresh();
        }
      }
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      connected = false;
      if (!navigator.onLine) { setConnectionStatus("offline"); return; }
      setConnectionStatus("reconnecting");
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt++, 5));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay + Math.floor(delay * 0.2 * Math.random()));
    };
    const connect = async () => {
      if (disposed || connecting || connected || socket) return;
      if (!navigator.onLine) { setConnectionStatus("offline"); return; }
      connecting = true;
      setConnectionStatus(reconnectAttempt ? "reconnecting" : "connecting");
      try {
        const next = await openMessagesSocket();
        if (disposed) { next?.close(); return; }
        if (!next) { scheduleReconnect(); return; }
        socket = next;
        handshakeTimer = window.setTimeout(() => next.close(), 10_000);
        next.onmessage = (event) => {
          if (disposed || socket !== next) return;
          let payload: ChatStreamEvent;
          try { payload = JSON.parse(event.data) as ChatStreamEvent; } catch { return; }
          if (!payload || payload.user_id !== myId) return;
          if (payload.type === "messages.connected") {
            window.clearTimeout(handshakeTimer);
            connected = true;
            reconnectAttempt = 0;
            setConnectionStatus("connected");
            void refresh();
            return;
          }
          if (!connected ||
              !["message_created", "message_updated", "message_deleted", "conversation_read"].includes(payload.type)) return;
          if (payload.type === "message_deleted" && payload.peer_id === activePeerRef.current) {
            setMessages((current) => current.filter((message) => message.id !== payload.message_id));
          }
          void refresh();
        };
        next.onerror = () => next.close();
        next.onclose = () => {
          if (socket !== next) return;
          window.clearTimeout(handshakeTimer);
          socket = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      if (!connected) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        void connect();
      }
    };
    const offline = () => {
      setConnectionStatus("offline");
      connected = false;
      socket?.close();
    };
    reconnectTimer = window.setTimeout(() => { reconnectTimer = undefined; void connect(); }, 0);
    const poll = window.setInterval(() => {
      if (!connected || Date.now() - lastRefresh >= 30_000) void refresh();
    }, 5_000);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(handshakeTimer);
      window.clearInterval(poll);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
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
        await loadMessagesForPeer(activePeer, true, false);
        void loadConversations();
      } catch {
        /* ignore */
      }
    })();
  }, [activePeer, loadConversations, loadMessagesForPeer]);

  const openConversation = (userId: string, name: string, role: string) => {
    if (userId === activePeerRef.current) {
      void loadMessagesForPeer(userId, true).catch(() => undefined);
      return;
    }
    if (activePeer) draftRef.current.set(activePeer, { input, pendingFiles, messageTimerSeconds });
    ignoredRoutePeerRef.current = null;
    openPeerFromRoute(userId, name, role);
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
    if (activePeer) draftRef.current.set(activePeer, { input, pendingFiles, messageTimerSeconds });
    setInput("");
    setMessageTimerSeconds(0);
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
    setPendingFiles([]);
    setMessageSearch("");
    setSecureStatus(null);
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
    const requestId = ++userRequestIdRef.current;
    dispatchChatState({ usersLoading: true });
    try {
      // The server search covers names/email only. Search localized roles here.
      const data = await fetchAllowedPeers("");
      if (requestId !== userRequestIdRef.current) return;
      setAllUsers(data);
    } catch {
      if (requestId === userRequestIdRef.current) setUserError(true);
    } finally {
      if (requestId === userRequestIdRef.current) dispatchChatState({ usersLoading: false });
    }
  }, [canViewChat]);

  useEffect(() => {
    if (!showNewChat) return;
    const timer = window.setTimeout(() => void loadUsers(), 250);
    return () => window.clearTimeout(timer);
  }, [loadUsers, showNewChat]);

  const loadAttachmentBlob = useCallback(async (message: Message) => {
    if (!message.attachment_key) throw new Error(t.chat_attachment_load_failed);
    let bytes: ArrayBuffer | Uint8Array<ArrayBuffer>;
    if (message.attachment_is_e2e) {
      // Old end-to-end attachment: opens only where the device key still is.
      bytes = await loadLegacyAttachmentBytes(message);
    } else {
      try { bytes = await downloadMessageAttachmentBytes(message.attachment_key); }
      catch { throw new Error(t.chat_attachment_load_failed); }
    }
    return new Blob([bytes], { type: chatAttachmentMime(message.attachment_filename ?? "") });
  }, [loadLegacyAttachmentBytes, t.chat_attachment_load_failed]);

  function addPendingFiles(files: File[]) {
    if (!activePeer || sendLockRef.current || !files.length) return;
    const additions: PendingChatAttachment[] = [];
    const errors: string[] = [];
    for (const file of files) {
      const problem = chatAttachmentProblem(file);
      if (problem) {
        errors.push(file.name + ": " + (problem === "size" ? t.chat_attachment_too_large : problem === "name" ? t.chat_attachment_name_invalid : t.chat_attachment_type_blocked));
        continue;
      }
      if ([...pendingFiles, ...additions].some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
      if (pendingFiles.length + additions.length >= CHAT_ATTACHMENT_MAX_COUNT) { errors.push(t.chat_attachments_limit); break; }
      additions.push({ id: crypto.randomUUID(), file });
    }
    setPendingFiles((current) => [...current, ...additions]);
    setSecureStatus(errors.length ? errors.join(" ") : null);
  }

  function finishAttachmentDraft(peerId: string, fileId: string, caption: string) {
    const update = (draft: { pendingFiles: PendingChatAttachment[]; input: string; messageTimerSeconds: number }) => {
      const remaining = draft.pendingFiles.filter((entry) => entry.id !== fileId);
      return {
        pendingFiles: remaining,
        input: caption && draft.input.trim() === caption ? "" : draft.input,
        messageTimerSeconds: remaining.length ? draft.messageTimerSeconds : 0,
      };
    };
    const savedDraft = draftRef.current.get(peerId);
    if (savedDraft) draftRef.current.set(peerId, update(savedDraft));
    if (activePeerRef.current === peerId) dispatchChatState((current) => update(current));
  }

  const applyDeliveryReceipt = (
    peerId: string,
    clientMessageId: string,
    receipt: SentMessageReceipt,
  ) => {
    const pending = outboxRef.current.get(clientMessageId);
    if (pending) outboxRef.current.set(clientMessageId, {
      ...pending, id: receipt.id, created_at: receipt.created_at,
      expires_at: receipt.expires_at ?? null, delivery_state: undefined,
    });
    if (activePeerRef.current !== peerId) return;
    messageRequestIdRef.current += 1;
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
      // Sent as text over TLS; the server seals it with its message keys.
      const receipt = await sendPeerMessage(
        peerId,
        buildTextMessagePayload(text, clientMessageId, message.retry_expires_in_seconds),
      );

      applyDeliveryReceipt(peerId, clientMessageId, receipt);
      if (activePeerRef.current === peerId) {
        setSecureStatus(null);
        void loadMessagesForPeer(peerId).catch(() => undefined);
      }
      void loadConversations();
    } catch {
      try {
        const serverMessages = await fetchPeerMessages(peerId);
        if (serverMessages.some((item) => item.client_message_id === clientMessageId)) {
          const hydrated = await hydrateMessages(peerId, serverMessages);
          outboxRef.current.delete(clientMessageId);
          if (activePeerRef.current === peerId) {
            setMessages((current) => reconcileChatMessages(current, hydrated));
            setSecureStatus(null);
          }
          void loadConversations();
          return;
        }
      } catch {
        // The retry control below keeps the idempotency key and can safely resend.
      }
      outboxRef.current.set(clientMessageId, { ...message, delivery_state: "failed" });
      if (activePeerRef.current === peerId) {
        setMessages((current) =>
          current.map((item) =>
            item.client_message_id === clientMessageId
              ? { ...item, delivery_state: "failed" }
              : item,
          ),
        );
        setSecureStatus(t.chat_message_send_failed);
      }
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const retryTextMessage = async (message: Message) => {
    if (sendLockRef.current || message.delivery_state !== "failed") return;
    sendLockRef.current = true;
    setSending(true);
    if (message.client_message_id) outboxRef.current.set(message.client_message_id, { ...message, delivery_state: "sending" });
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
      if (deleteTarget.client_message_id) outboxRef.current.delete(deleteTarget.client_message_id);
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
    if (!activePeer || sendLockRef.current || (!input.trim() && !pendingFiles.length)) return;

    // Upload sequentially: each accepted file leaves the draft immediately.
    if (pendingFiles.length) {
      const peerId = activePeer;
      const queued = pendingFiles;
      const caption = input.trim();
      setSending(true);
      sendLockRef.current = true;
      try {
        for (let index = 0; index < queued.length; index += 1) {
          const entry = queued[index];
          const entryCaption = index === 0 ? caption : "";
          setAttachmentUpload({ peerId, fileId: entry.id, index: index + 1, total: queued.length, name: entry.file.name });
          let attempt = uploadAttemptRef.current.get(entry.id);
          if (!attempt || attempt.caption !== entryCaption || attempt.timer !== messageTimerSeconds) {
            attempt = { id: crypto.randomUUID(), caption: entryCaption, timer: messageTimerSeconds };
            uploadAttemptRef.current.set(entry.id, attempt);
          }
          // The file and caption travel over TLS; the server checks the
          // content, scans it and seals it with its message keys. A retry
          // reuses the same form and idempotency key.
          attempt.formData ??= buildAttachmentFormData({
            file: entry.file,
            caption: entryCaption,
            clientMessageId: attempt.id,
            expiresInSeconds: messageTimerSeconds,
          });
          const receipt = await uploadPeerAttachment(peerId, attempt.formData);
          const delivered: Message = {
            id: receipt.id, client_message_id: attempt.id, created_at: receipt.created_at,
            expires_at: receipt.expires_at ?? null, from_user: myId, to_user: peerId,
            message: entryCaption || null, is_e2e: false, is_read: false, read_at: null,
            attachment_key: receipt.attachment_key, attachment_filename: entry.file.name,
            attachment_mime: chatAttachmentMime(entry.file.name), attachment_size: entry.file.size,
            attachment_is_e2e: false,
          };
          outboxRef.current.set(attempt.id, delivered);
          if (activePeerRef.current === peerId) {
            messageRequestIdRef.current += 1;
            scrollToBottomRef.current = true;
            setMessages((current) => mergeChatMessages(current, [delivered]));
            setSecureStatus(null);
          }
          uploadAttemptRef.current.delete(entry.id);
          finishAttachmentDraft(peerId, entry.id, entryCaption);
        }
      } catch {
        if (activePeerRef.current === peerId) setSecureStatus(t.chat_attachment_send_failed);
      } finally {
        sendLockRef.current = false;
        setSending(false);
        setAttachmentUpload(null);
        void loadConversations();
        if (activePeerRef.current === peerId) void loadMessagesForPeer(peerId).catch(() => undefined);
      }
      return;
    }

    // Text message
    if (!input.trim()) return;
    sendLockRef.current = true;
    setSending(true);
    const msg = input.trim();
    const clientMessageId = crypto.randomUUID();
    const peerId = activePeer;
    const createdAt = new Date().toISOString();
    const optimisticMessage: Message = {
      id: `local-${clientMessageId}`,
      from_user: myId,
      to_user: peerId,
      message: msg,
      is_e2e: false,
      is_read: false,
      read_at: null,
      created_at: createdAt,
      // Expiry begins when the server accepts the message, never while offline.
      expires_at: null,
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
    draftRef.current.delete(peerId);
    outboxRef.current.set(clientMessageId, optimisticMessage);
    scrollToBottomRef.current = true;
    dispatchChatState({ showScrollToLatest: false });
    setMessages((current) => [optimisticMessage, ...current]);
    await deliverTextMessage(optimisticMessage);
  };

  // Filtered conversations (German-aware fold)
  const normalizedConvoSearch = deNormalize(search);
  const filteredConvos = normalizedConvoSearch
    ? conversations.filter((c) => deNormalize(`${c.name} ${c.email} ${roleDisplay(c.role, t)}`).includes(normalizedConvoSearch))
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
  const visibleSecureStatus = secureStatus;
  const messageLoadError = messageError ? (
    <div role="alert" className="mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-3 shadow-sm">
      <p className="flex-1 text-sm text-destructive">{t.common_error}</p>
      <Button type="button" variant="outline" size="sm"
        onClick={() => activePeer && void loadMessagesForPeer(activePeer, true).catch(() => undefined)}>
        {t.common_refresh}
      </Button>
    </div>
  ) : null;
  const displayMsgs = sortChatMessages(messages)
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
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[320px] overflow-hidden rounded-xl border bg-card shadow-sm sm:h-[calc(100dvh-8rem)] sm:rounded-2xl" data-testid="chat-workspace">
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
              aria-label={t.common_search}
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
              aria-label={t.chat_search_users}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="h-8 rounded-lg text-sm"
            />
            <div
              className="max-h-40 overflow-y-auto space-y-0.5"
              role="listbox"
              aria-label={t.chat_search_users}
            >
              {usersLoading ? (
                <p role="status" className="py-4 text-center text-xs text-muted-foreground">{t.common_loading}</p>
              ) : userError ? (
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
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(c.last_at, lang)}</span>
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
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = activePeer && !sendLockRef.current ? "copy" : "none";
          if (activePeer && !sendLockRef.current) setDraggingFiles(true);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false); }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          setDraggingFiles(false);
          addPendingFiles(Array.from(event.dataTransfer.files));
        }}
        data-testid="chat-message-panel"
        className={cn(
          "relative min-w-0 flex-1 flex-col",
          activePeer ? "flex" : "hidden md:flex",
        )}
      >
        {draggingFiles && activePeer ? <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95 p-6 text-center font-medium"><Paperclip className="mr-2 size-5" />{t.chat_attachments_drop}</div> : null}
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
                  <p className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="truncate">{roleDisplay(activeRole, t)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex shrink-0 items-center gap-1" title={t.chat_server_encryption_hint}>
                      <ShieldCheck className="size-3" aria-hidden="true" />
                      {t.chat_server_encryption_label}
                    </span>
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground" aria-live="polite"
                    title={connectionStatus !== "connected" ? t.chat_connection_polling : undefined}>
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
            <div className="relative min-h-0 flex-1">
            <div
              ref={messagesScrollRef}
              data-testid="chat-message-history"
              onScroll={(event) => {
                const container = event.currentTarget;
                const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
                scrollToBottomRef.current = distance <= 2;
                dispatchChatState({ showScrollToLatest: distance > 100 });
              }}
              className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
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
              {messages.length === 0 ? messageLoadError : null}
              {!messageLoading && !messageError && !messageSearch && displayMsgs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                  <MessageSquare className="size-8 opacity-40" />
                  <p>{t.chat_empty_conversation}</p>
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
                const readReceipt =
                  mine && m.read_at ? `${t.chat_seen} ${timeAgo(m.read_at, lang)}` : null;
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
                        <span>{formatChatDay(m.created_at)}</span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "group/message flex flex-col",
                        mine ? "items-end" : "items-start",
                      )}
                    >
                    {hasAttachment ? <ChatAttachment message={m} mine={mine} loadBlob={loadAttachmentBlob} /> : null}
                    {/* Text bubble */}
                    {hasText && (
                      <div
                        data-testid={`chat-message-text-${m.id}`}
                        className={cn(
                          "max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl px-3.5 py-2 text-sm leading-5 sm:max-w-[70%]",
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
                        <span className="inline-flex items-center gap-1"><LoaderCircle className="size-3 animate-spin" />{t.chat_message_sending}</span>
                      ) : null}
                      {mine && !m.delivery_state ? (
                        <span className={cn("inline-flex items-center gap-1", m.is_read && "text-primary")} title={readReceipt ?? t.chat_message_sent}>
                          {m.is_read ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />}
                          {m.is_read ? t.chat_seen : t.chat_message_sent}
                        </span>
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
                          {timeAgo(m.created_at, lang)}
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
            {messageError && messages.length > 0 ? (
              <div className="absolute inset-x-3 top-3 z-10">{messageLoadError}</div>
            ) : null}
            {showScrollToLatest ? (
              <div className="absolute bottom-3 right-3 z-10">
                <Button type="button" variant="outline" size="sm" className="bg-card shadow-sm" onClick={() => {
                  const container = messagesScrollRef.current;
                  if (container) container.scrollTop = container.scrollHeight;
                  scrollToBottomRef.current = true;
                  dispatchChatState({ showScrollToLatest: false });
                }}><ArrowDown className="size-4" />{t.chat_scroll_latest}</Button>
              </div>
            ) : null}
            </div>

            {visibleSecureStatus && (
              <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground sm:px-5">
                <Shield className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{visibleSecureStatus}</span>
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

            {pendingFiles.length > 0 ? (
              <div data-testid="chat-attachment-queue" className="border-t bg-muted/30 px-3 py-2 sm:px-5">
                {attachmentUpload?.peerId === activePeer ? <p role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 shrink-0 animate-spin" />{t.chat_attachments_uploading.replace("{index}", String(attachmentUpload.index)).replace("{total}", String(attachmentUpload.total)).replace("{name}", attachmentUpload.name)}</p> : null}
                <div role="list" aria-label={t.chat_attachments_queue} className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
                  {pendingFiles.map((entry) => <div role="listitem" key={entry.id}><PendingAttachment file={entry.file} busy={sending} onRemove={() => {
                    uploadAttemptRef.current.delete(entry.id);
                    setPendingFiles((current) => current.filter((item) => item.id !== entry.id));
                  }} /></div>)}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{t.chat_attachments_limit}</p>
              </div>
            ) : null}

            {/* Input */}
            <form onSubmit={handleSend} onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) { event.preventDefault(); addPendingFiles(files); }
            }} className="flex flex-wrap items-center gap-1.5 border-t px-2 py-2.5 sm:gap-2 sm:px-4 sm:py-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                multiple
                onChange={(event) => {
                  addPendingFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title={t.chat_attachment_add}
                aria-label={t.chat_attachment_add}
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
                disabled={sending && pendingFiles.length > 0}
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
                disabled={sending || (!input.trim() && !pendingFiles.length)}
                aria-label={t.chat_send}
                title={t.chat_send}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
              <p
                id="chat-composer-keyboard-hint"
                className="basis-full pr-1 text-right text-[10px] text-muted-foreground"
              >
                {t.chat_composer_keyboard_hint}
              </p>
            </form>

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
