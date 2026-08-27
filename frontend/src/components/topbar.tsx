import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  Globe,
  PanelLeft,
  X,
  Send,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { clearApiCache } from "@/lib/api";
import { useNavState } from "@/lib/nav-state";
import { staffHrefIfAllowed } from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import {
  useDebouncedRealtimeSubscription,
  useRealtimeConnectionStatus,
  useRealtimeSubscription,
  type RealtimeConnectionStatus,
} from "@/lib/realtime";
import {
  fetchNotificationPanelWorkspace,
  fetchTopbarChatMessages,
  fetchTopbarPresence,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  markTopbarChatRead,
  localizedNotificationCopy,
  notificationHrefForRole,
  sendTopbarChatMessage,
  type ActiveAnnouncement,
  type ActiveSession,
  type ChatMessage,
  type Notification,
  dismissActiveAnnouncement,
} from "@/components/topbar-data";
import { GmedWordmark } from "@/components/gmed-wordmark";
import { BuildReleaseWidget } from "@/components/build-release-widget";
import { AiMark } from "@/components/ui/ai-mark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TOPBAR_REALTIME_EVENTS = [
  "notification.created",
  "notification.read",
  "notifications.read_all",
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
] as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function compactDt(dt: string, lang: "ru" | "de") {
  const value = new Date(dt);
  if (Number.isNaN(value.getTime())) return "—";
  return cachedDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function compactTime(dt: string) {
  const idx = dt.indexOf("T");
  return idx >= 0 ? dt.slice(idx + 1, idx + 6) : dt.slice(0, 5);
}

function roleDisplay(role: string, translations: Translations) {
  const labels = translations as unknown as Record<string, string>;
  return labels[`role_${role}`] ?? formatUnknownValue(role, translations);
}

type RealtimeStatusTranslations = Pick<
  Translations,
  | "topbar_realtime_connected"
  | "topbar_realtime_connecting"
  | "topbar_realtime_reconnecting"
  | "topbar_realtime_disconnected"
>;

function realtimeStatusLabel(
  status: RealtimeConnectionStatus,
  attempt: number,
  translations: RealtimeStatusTranslations,
) {
  if (status === "connected") {
    return translations.topbar_realtime_connected;
  }
  if (status === "connecting") {
    return translations.topbar_realtime_connecting;
  }
  if (status === "reconnecting") {
    return translations.topbar_realtime_reconnecting.replace(
      "{attempt}",
      String(attempt),
    );
  }
  return translations.topbar_realtime_disconnected;
}

function RealtimeConnectionIndicator({
  status,
  attempt,
  translations,
}: {
  status: RealtimeConnectionStatus;
  attempt: number;
  translations: RealtimeStatusTranslations;
}) {
  const tone =
    status === "connected"
      ? "bg-emerald-500"
      : status === "disconnected"
        ? "bg-rose-500"
        : "bg-amber-500 animate-pulse motion-reduce:animate-none";
  const label = realtimeStatusLabel(status, attempt, translations);

  return (
    <div
      className="flex size-8 items-center justify-center rounded-lg"
      title={label}
      aria-label={label}
    >
      <span
        aria-hidden
        className={`size-2.5 rounded-full border border-background shadow-sm ${tone}`}
      />
    </div>
  );
}

export function Topbar() {
  const { user } = useAuth();
  const location = useLocation();
  const { lang, setLang, t } = useLang();
  const { toggle: toggleNav } = useNavState();
  const realtimeConnection = useRealtimeConnectionStatus();
  const [unread, setUnread] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<ActiveSession[]>([]);
  const isPatientPortal = user?.role === "patient";
  const onlineUsersWithSelf =
    !isPatientPortal && user
      ? [
          {
            user_id: user.id,
            user_name: user.name,
            user_email: user.email,
            role: user.role,
          },
          ...onlineUsers.filter((onlineUser) => onlineUser.user_id !== user.id),
        ]
      : onlineUsers;
  const showAppointmentsBadge =
    !isPatientPortal && location.pathname.startsWith("/appointments");

  const requestAppointmentsRefresh = () => {
    window.dispatchEvent(new CustomEvent("appointments:refresh-request"));
  };

  const requestAppointmentCreate = () => {
    window.dispatchEvent(new CustomEvent("appointments:create-request"));
  };
  void showAppointmentsBadge;
  void requestAppointmentsRefresh;
  void requestAppointmentCreate;

  // Panels
  const [notifOpen, setNotifOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  useEffect(() => {
    if (!notifOpen && !usersOpen) return;

    const closePanelsOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNotifOpen(false);
      setUsersOpen(false);
    };

    document.addEventListener("keydown", closePanelsOnEscape);
    return () => document.removeEventListener("keydown", closePanelsOnEscape);
  }, [notifOpen, usersOpen]);

  useEffect(() => {
    let cancelled = false;

    function load() {
      if (cancelled) return;
      if (isPatientPortal) {
        void fetchUnreadNotificationCount().then((count) => {
          if (!cancelled) setUnread(count);
        });
        return;
      }
      void fetchTopbarPresence().then((presence) => {
        if (cancelled) return;
        setUnread(presence.unreadCount);
        setOnlineUsers(presence.onlineUsers);
      });
    }

    load();
    const timer = window.setInterval(() => {
      load();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isPatientPortal]);

  useDebouncedRealtimeSubscription(TOPBAR_REALTIME_EVENTS, (_event, events) => {
    if (events.some((event) => event.type.startsWith("announcement."))) {
      clearApiCache("/announcements/active");
    }
    if (events.every((event) => event.type.startsWith("announcement."))) return;

    clearApiCache("/notifications");
    clearApiCache("/notifications/unread-count");
    if (isPatientPortal) {
      void fetchUnreadNotificationCount().then(setUnread);
      return;
    }
    void fetchTopbarPresence().then((presence) => {
      setUnread(presence.unreadCount);
      setOnlineUsers(presence.onlineUsers);
    });
  }, 150);

  const toggleLang = () => {
    setLang(lang === "de" ? "ru" : "de");
  };

  return (
    <>
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-1">
          <TopbarIconButton onClick={toggleNav} title={t.ui_toggle_sidebar}>
            <PanelLeft className="size-[17px]" />
          </TopbarIconButton>
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <div className="flex min-w-0 items-center gap-2 px-1.5 sm:px-2">
            <span className="sr-only">{t.app_name}</span>
            <GmedWordmark className="h-6 w-auto shrink-0 text-[#04060c]" />
            <span
              aria-hidden="true"
              className={cn(
                "self-end truncate text-[12px] font-semibold leading-none tracking-normal text-foreground",
                isPatientPortal && "hidden sm:inline",
              )}
            >
              CONSOLE
            </span>
          </div>
        </div>

        {/* Page title + primary actions portal here from PageHeader (lg+) */}
        <div
          id="topbar-page-slot"
          className="ml-8 mr-3 hidden min-w-0 flex-1 items-center lg:flex sm:ml-12 sm:mr-5"
        />

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {!isPatientPortal ? (
            <BuildReleaseWidget
              onOpen={() => {
                setNotifOpen(false);
                setUsersOpen(false);
              }}
            />
          ) : null}

          {!isPatientPortal ? (
            <RealtimeConnectionIndicator
              status={realtimeConnection.status}
              attempt={realtimeConnection.attempt}
              translations={t}
            />
          ) : null}

          {/* Online users avatars */}
          {!isPatientPortal && onlineUsersWithSelf.length > 0 && (
            <OnlineAvatars
              users={onlineUsersWithSelf}
              onToggle={() => {
                setUsersOpen(!usersOpen);
                setNotifOpen(false);
              }}
            />
          )}

          {/* Notifications */}
          <TopbarIconButton
            onClick={() => {
              setNotifOpen(!notifOpen);
              setUsersOpen(false);
            }}
            title={t.topbar_notifications}
          >
            <Bell aria-hidden="true" className="size-[17px]" />
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white px-1">
                {unread}
              </span>
            )}
          </TopbarIconButton>

          {/* Lang */}
          <button
            type="button"
            onClick={toggleLang}
            title={t.topbar_language_toggle}
            aria-label={t.topbar_language_toggle}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:px-2.5"
          >
            <Globe aria-hidden="true" className="size-3.5" />
            {t.common_lang_native}
          </button>
        </div>
      </header>

      {/* Notification panel */}
      {notifOpen && (
        <NotificationPanel
          onClose={() => setNotifOpen(false)}
          onUnreadChange={setUnread}
          staffRole={user?.role ?? ""}
        />
      )}

      {/* Users panel */}
      {usersOpen && (
        <UsersPanel
          users={onlineUsersWithSelf}
          currentUserId={user?.id}
          onClose={() => setUsersOpen(false)}
        />
      )}
    </>
  );
}

/* ── Shared icon button ── */

function TopbarIconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/* ── Online Avatars ── */

function OnlineAvatars({
  users,
  onToggle,
}: {
  users: ActiveSession[];
  onToggle: () => void;
}) {
  const { t } = useLang();
  const maxShow = 8;
  const show = users.slice(0, maxShow);
  const overflow = Math.max(0, users.length - maxShow);
  const rootRef = useRef<HTMLButtonElement>(null);

  const setAvatarShifts = (
    activeIndex: number | null,
    phase: "in" | "out",
  ) => {
    const elements = rootRef.current?.querySelectorAll<HTMLElement>(
      "[data-online-avatar]",
    );
    if (!elements) return;

    const easing =
      phase === "out"
        ? "cubic-bezier(0.34, 3.85, 0.64, 1)"
        : "cubic-bezier(0.22, 1, 0.36, 1)";

    elements.forEach((element, index) => {
      element.style.transitionTimingFunction = easing;
      if (activeIndex === null) {
        element.style.setProperty("--avatar-shift", "0px");
        element.style.setProperty("--avatar-scale-active", "1");
        return;
      }

      const distance = Math.abs(index - activeIndex);
      const shift = -4 * Math.pow(0.45, distance);
      element.style.setProperty("--avatar-shift", `${shift.toFixed(3)}px`);
      element.style.setProperty(
        "--avatar-scale-active",
        index === activeIndex ? "1.05" : "1",
      );
    });
  };

  return (
    <button
      ref={rootRef}
      type="button"
      className="flex cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>*+*]:-ml-1.5"
      onClick={onToggle}
      onMouseLeave={() => setAvatarShifts(null, "out")}
      aria-label={t.topbar_online_users}
    >
      {show.map((u, index) => (
        <span
          key={u.user_id}
          data-online-avatar
          aria-hidden="true"
          className="topbar-avatar-hover-item flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-foreground"
          onMouseEnter={() => setAvatarShifts(index, "in")}
        >
          {initials(u.user_name)}
        </span>
      ))}
      {overflow > 0 && (
        <span
          data-online-avatar
          aria-hidden="true"
          className="topbar-avatar-hover-item flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted-foreground text-[10px] font-medium text-background"
          onMouseEnter={() => setAvatarShifts(show.length, "in")}
        >
          +{overflow}
        </span>
      )}
    </button>
  );
}

/* ── Notification Panel ── */

function NotificationPanel({
  onClose,
  onUnreadChange,
  staffRole,
}: {
  onClose: () => void;
  onUnreadChange: (n: number) => void;
  staffRole: string;
}) {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [announcements, setAnnouncements] = useState<ActiveAnnouncement[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] =
    useState<ActiveAnnouncement | null>(null);
  const [dismissingAnnouncementId, setDismissingAnnouncementId] = useState<
    string | null
  >(null);
  const [announcementActionError, setAnnouncementActionError] = useState(false);

  const loadWorkspace = useCallback(() => {
    fetchNotificationPanelWorkspace()
      .then((workspace) => {
        setNotifs(workspace.notifications);
        setAnnouncements(workspace.announcements);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useDebouncedRealtimeSubscription(TOPBAR_REALTIME_EVENTS, (_event, events) => {
    if (events.some((event) => event.type.startsWith("announcement."))) {
      clearApiCache("/announcements/active");
    }
    if (events.some((event) => !event.type.startsWith("announcement."))) {
      clearApiCache("/notifications");
    }
    loadWorkspace();
  }, 150);

  const markAll = () => {
    void markAllNotificationsRead()
      .then(() => {
        clearApiCache("/notifications");
        clearApiCache("/notifications/unread-count");
        onUnreadChange(0);
        setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
      })
      .catch(() => {});
  };

  const markOne = (id: string) => {
    void markNotificationRead(id)
      .then(() => {
        clearApiCache("/notifications");
        clearApiCache("/notifications/unread-count");
        setNotifs((prev) => {
          const next = prev.map((n) => (n.id === id ? { ...n, is_read: true } : n));
          onUnreadChange(next.filter((n) => !n.is_read).length);
          return next;
        });
      })
      .catch(() => {});
  };

  const handleOpen = (item: Notification) => {
    if (!item.is_read) {
      markOne(item.id);
    }
    const href = notificationHrefForRole(item, staffRole);
    if (href) {
      navigate(staffHrefIfAllowed(staffRole, href));
      onClose();
    }
  };

  const dismissAnnouncement = (id: string) => {
    setAnnouncementActionError(false);
    setDismissingAnnouncementId(id);
    void dismissActiveAnnouncement(id)
      .then(() => {
        clearApiCache("/announcements/active");
        setAnnouncements((current) =>
          current.filter((announcement) => announcement.id !== id),
        );
        setSelectedAnnouncement((current) =>
          current?.id === id ? null : current,
        );
      })
      .catch(() => setAnnouncementActionError(true))
      .finally(() => setDismissingAnnouncementId(null));
  };

  return (
    <>
      <button
        type="button"
        aria-label={t.common_close}
        className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div role="dialog" aria-label={t.topbar_notifications} className="fixed inset-x-3 top-14 z-50 max-h-[calc(100dvh-4rem)] overflow-hidden rounded-lg border border-border bg-background shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none sm:inset-x-auto sm:right-4 sm:top-16 sm:w-96">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{t.topbar_notifications}</h3>
          <button
            type="button"
            onClick={markAll}
            className="rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.topbar_mark_all_read}
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {announcements.length > 0 && (
            <div className="border-b border-border">
              {announcements.map((a) => {
                const colors =
                  a.variant === "warning"
                    ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : a.variant === "error"
                      ? "bg-red-500/10 text-red-800 dark:text-red-300"
                      : a.variant === "success"
                        ? "bg-green-500/10 text-green-800 dark:text-green-300"
                        : "bg-blue-500/10 text-blue-800 dark:text-blue-300";
                return (
                  <div
                    key={a.id}
                    className={`flex items-start gap-2 px-4 py-2.5 text-xs ${colors}`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                      onClick={() => setSelectedAnnouncement(a)}
                      title={t.providers_open}
                    >
                      <span className="block truncate font-semibold">{a.title}</span>
                      <span className="mt-0.5 line-clamp-2 opacity-90">{a.message}</span>
                    </button>
                    <button
                      type="button"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50 motion-reduce:transition-none"
                      onClick={() => dismissAnnouncement(a.id)}
                      disabled={dismissingAnnouncementId === a.id}
                      title={t.common_dismiss}
                      aria-label={`${t.common_dismiss}: ${a.title}`}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {announcementActionError ? (
            <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
              {t.topbar_announcement_dismiss_failed}
            </p>
          ) : null}
          {notifs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t.topbar_no_notifications}
            </div>
          ) : (
            notifs.map((n) => {
              const copy = localizedNotificationCopy(n, lang);
              return (
                <button
                key={n.id}
                type="button"
                onClick={() => handleOpen(n)}
                className={`flex w-full cursor-pointer gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  n.is_read
                    ? "opacity-60"
                    : "bg-primary/5 hover:bg-primary/10"
                }`}
              >
                {n.kind.startsWith("medication_ai_") ? (
                  <AiMark className="mt-0.5 size-4 text-foreground" />
                ) : (
                  <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{copy.title}</p>
                  {copy.body && (
                    <p className="text-xs text-muted-foreground truncate">
                      {copy.body}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {compactDt(n.created_at, lang)}
                  </p>
                </div>
                </button>
              );
            })
          )}
        </div>
        {staffRole === "patient" ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-3 text-xs font-medium text-primary transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => {
              navigate("/notifications");
              onClose();
            }}
          >
            {t.nav_my_notifications}
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      <Dialog
        open={selectedAnnouncement !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAnnouncement(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedAnnouncement?.title}</DialogTitle>
            <DialogDescription className="sr-only">
              {t.topbar_notifications}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {selectedAnnouncement?.message}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              onClick={() => selectedAnnouncement && dismissAnnouncement(selectedAnnouncement.id)}
              disabled={dismissingAnnouncementId === selectedAnnouncement?.id}
            >
              <X aria-hidden="true" className="size-4" />
              {t.common_dismiss}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Users Panel + Chat ── */

function UsersPanel({
  users,
  currentUserId,
  onClose,
}: {
  users: ActiveSession[];
  currentUserId?: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [chatUser, setChatUser] = useState<ActiveSession | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const openChat = (u: ActiveSession) => {
    setChatUser(u);
    setChatInput("");
    fetchTopbarChatMessages(u.user_id)
      .then(setChatMsgs)
      .catch(() => {});
    markTopbarChatRead(u.user_id).catch(() => {});
  };

  const sendMsg = (e: FormEvent) => {
    e.preventDefault();
    if (!chatUser || !chatInput.trim()) return;
    const uid = chatUser.user_id;
    const msg = chatInput;
    setChatInput("");
    sendTopbarChatMessage(uid, msg)
      .then(() => fetchTopbarChatMessages(uid).then(setChatMsgs))
      .catch(() => {});
  };

  useRealtimeSubscription(TOPBAR_REALTIME_EVENTS, (event) => {
    if (!chatUser || event.type !== "notification.created") return;
    if (
      event.payload?.entity_type !== "message_peer" ||
      event.payload?.entity_id !== chatUser.user_id
    ) {
      return;
    }

    clearApiCache(`/messages/${chatUser.user_id}`);
    fetchTopbarChatMessages(chatUser.user_id)
      .then(setChatMsgs)
      .then(() => markTopbarChatRead(chatUser.user_id))
      .catch(() => {});
  });

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [chatMsgs]);

  if (chatUser) {
    return (
      <>
        <button
          type="button"
          aria-label={t.common_cancel}
          className="fixed inset-0 z-40 cursor-default"
          onClick={onClose}
        />
        <div role="dialog" aria-label={chatUser.user_name} className="fixed inset-x-3 top-14 z-50 flex max-h-[calc(100dvh-4rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none sm:inset-x-auto sm:right-4 sm:top-16 sm:w-96 sm:max-h-[480px]">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center size-8 rounded-full bg-muted text-xs font-medium">
                {initials(chatUser.user_name)}
              </div>
              <div>
                <p className="text-sm font-semibold">{chatUser.user_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {roleDisplay(chatUser.role, t)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setChatUser(null)}
              title={t.common_close}
              aria-label={t.common_close}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          {/* Chat messages */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {chatMsgs
              .slice()
              .reverse()
              .map((m) => {
                const mine = m.from_user === currentUserId;
                return (
                  <div
                    key={`${m.from_user}:${m.created_at}:${m.message}`}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? "bg-foreground text-background"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {m.message}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {compactTime(m.created_at)}
                    </span>
                  </div>
                );
              })}
          </div>

          {/* Chat input */}
          <form
            onSubmit={sendMsg}
            className="flex items-center gap-2 px-3 py-2 border-t border-border"
          >
            <input
              type="text"
              name="chat_message"
              autoComplete="off"
              aria-label={t.topbar_message_placeholder}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={t.topbar_message_placeholder}
              className="h-9 min-w-0 flex-1 rounded-full bg-muted px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              title={t.chat_send}
              aria-label={t.chat_send}
              className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Send aria-hidden="true" className="size-4" />
            </button>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={t.common_close}
        className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div role="dialog" aria-label={t.topbar_online_users} className="fixed inset-x-3 top-14 z-50 max-h-[calc(100dvh-4rem)] overflow-hidden rounded-lg border border-border bg-background shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none sm:inset-x-auto sm:right-4 sm:top-16 sm:w-80">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">
            {t.topbar_online} ({users.length})
          </h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {users.map((u) => {
            const isCurrentUser = u.user_id === currentUserId;
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => {
                  if (!isCurrentUser) openChat(u);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                  isCurrentUser ? "cursor-default bg-primary/5" : "cursor-pointer hover:bg-muted",
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {initials(u.user_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {u.user_name}
                    {isCurrentUser ? (
                      <span className="ml-1.5 font-normal text-primary">· {t.chat_you}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {roleDisplay(u.role, t)}
                  </p>
                </div>
                {!isCurrentUser ? (
                  <MessageSquare aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
