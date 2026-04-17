import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Plus,
  RefreshCw,
  Search,
  Globe,
  X,
  Send,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { staffHrefIfAllowed } from "@/lib/staff-route-access";
import { useLang } from "@/lib/i18n";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  created_at: string;
}

interface ActiveSession {
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
}

interface ActiveAnnouncement {
  title: string;
  message: string;
  variant: string;
}

interface ChatMessage {
  from_user: string;
  message: string;
  created_at: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function compactDt(dt: string) {
  return dt.replace("T", " ").slice(0, 16);
}

function compactTime(dt: string) {
  const idx = dt.indexOf("T");
  return idx >= 0 ? dt.slice(idx + 1, idx + 6) : dt.slice(0, 5);
}

function roleDisplay(role: string) {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function notificationHref(item: Notification) {
  if (!item.entity_id || !item.entity_type) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient") return `/patients?patient=${item.entity_id}`;
  if (item.entity_type === "provider") return `/providers?provider=${item.entity_id}`;
  if (item.entity_type === "order") return `/orders?order=${item.entity_id}`;
  if (item.entity_type === "appointment") return `/appointments?appointment=${item.entity_id}`;
  if (item.entity_type === "case") return `/cases?case=${item.entity_id}`;
  return null;
}

export function Topbar() {
  const { user } = useAuth();
  const location = useLocation();
  const { lang, setLang, t } = useLang();
  const [unread, setUnread] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<ActiveSession[]>([]);
  const isPatientPortal = user?.role === "patient";
  const showAppointmentsBadge =
    !isPatientPortal && location.pathname.startsWith("/appointments");

  const requestAppointmentsRefresh = () => {
    window.dispatchEvent(new CustomEvent("appointments:refresh-request"));
  };

  const requestAppointmentCreate = () => {
    window.dispatchEvent(new CustomEvent("appointments:create-request"));
  };

  // Panels
  const [notifOpen, setNotifOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  useEffect(() => {
    if (isPatientPortal) {
      return;
    }

    let cancelled = false;

    async function load() {
      const [countPayload, onlinePayload] = await Promise.all([
        apiFetch<{ count: number }>("/notifications/unread-count").catch(() => null),
        apiFetch<ActiveSession[]>("/users/online").catch(() => []),
      ]);
      if (cancelled) return;
      setUnread(countPayload?.count ?? 0);
      setOnlineUsers(onlinePayload);
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isPatientPortal]);

  const toggleLang = () => {
    setLang(lang === "de" ? "ru" : "de");
  };

  return (
    <>
      <header className="shrink-0 flex items-center justify-between h-14 border-b border-border/70 px-6">
        <div className="topbar-context-actions flex items-center gap-2">
          {showAppointmentsBadge ? (
            <>
              <button
                type="button"
                className="topbar-context-action-create inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                onClick={requestAppointmentCreate}
              >
                <Plus className="size-4" />
                New appointment
              </button>
              <button
                type="button"
                className="topbar-context-action-refresh inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-white px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                onClick={requestAppointmentsRefresh}
              >
                <RefreshCw className="size-4" />
                Refresh
              </button>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {/* Online users avatars */}
          {!isPatientPortal && onlineUsers.length > 0 && (
            <OnlineAvatars
              users={onlineUsers}
              onToggle={() => {
                setUsersOpen(!usersOpen);
                setNotifOpen(false);
              }}
            />
          )}

          {/* Current user */}
          {user && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">{user.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {roleDisplay(user.role)}
              </span>
            </div>
          )}

          {/* Notifications */}
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              setUsersOpen(false);
            }}
            className="relative flex items-center justify-center size-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-destructive text-[10px] font-semibold text-white px-1">
                {unread}
              </span>
            )}
          </button>

          {/* Search */}
          {!isPatientPortal ? (
            <div className="flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-muted/50 text-muted-foreground text-sm cursor-pointer hover:bg-muted transition-colors">
              <Search className="size-3.5" />
              <span>{t.topbar_search}</span>
              <kbd className="ml-2 text-[10px] font-mono bg-background border border-border rounded px-1.5 py-0.5">
                /
              </kbd>
            </div>
          ) : null}

          {/* Lang */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Globe className="size-3.5" />
            {lang === "de" ? "🇩🇪 DE" : "🇷🇺 RU"}
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
          users={onlineUsers}
          currentUserId={user?.id}
          onClose={() => setUsersOpen(false)}
        />
      )}
    </>
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
  const maxShow = 8;
  const show = users.slice(0, maxShow);
  const overflow = Math.max(0, users.length - maxShow);

  return (
    <div
      className="flex items-center cursor-pointer -space-x-1.5"
      onClick={onToggle}
    >
      {show.map((u) => (
        <div
          key={u.user_id}
          title={u.user_name}
          className="flex items-center justify-center size-7 rounded-full bg-muted text-[10px] font-medium text-foreground border-2 border-background"
        >
          {initials(u.user_name)}
        </div>
      ))}
      {overflow > 0 && (
        <div className="flex items-center justify-center size-7 rounded-full bg-muted-foreground text-[10px] font-medium text-background border-2 border-background">
          +{overflow}
        </div>
      )}
    </div>
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
  const { t } = useLang();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [announcements, setAnnouncements] = useState<ActiveAnnouncement[]>([]);

  useEffect(() => {
    apiFetch<Notification[]>("/notifications").then(setNotifs).catch(() => {});
    apiFetch<ActiveAnnouncement[]>("/announcements/active")
      .then(setAnnouncements)
      .catch(() => {});
  }, []);

  const markAll = () => {
    apiFetch("/notifications/read-all", { method: "POST" }).catch(() => {});
    onUnreadChange(0);
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const markOne = (id: string) => {
    apiFetch(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    onUnreadChange(
      notifs.filter((n) => !n.is_read && n.id !== id).length
    );
  };

  const handleOpen = (item: Notification) => {
    if (!item.is_read) {
      markOne(item.id);
    }
    const href = notificationHref(item);
    if (href) {
      navigate(staffHrefIfAllowed(staffRole, href));
      onClose();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-20 top-14 z-50 w-96 rounded-2xl border border-border bg-background shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{t.topbar_notifications}</h3>
          <button
            onClick={markAll}
            className="text-xs text-primary hover:underline"
          >
            {t.topbar_mark_all_read}
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {announcements.length > 0 && (
            <div className="border-b border-border">
              {announcements.map((a, i) => {
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
                    key={i}
                    className={`px-4 py-2 text-xs ${colors}`}
                  >
                    <strong>{a.title}</strong> — {a.message}
                  </div>
                );
              })}
            </div>
          )}
          {notifs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t.topbar_no_notifications}
            </div>
          ) : (
            notifs.map((n) => (
              <div
                key={n.id}
                onClick={() => handleOpen(n)}
                className={`flex gap-3 px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors ${
                  n.is_read
                    ? "opacity-60"
                    : "bg-primary/5 hover:bg-primary/10"
                }`}
              >
                <Bell className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-muted-foreground truncate">
                      {n.body}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {compactDt(n.created_at)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
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
    apiFetch<ChatMessage[]>(`/messages/${u.user_id}`)
      .then(setChatMsgs)
      .catch(() => {});
    apiFetch(`/messages/${u.user_id}/read`, { method: "POST" }).catch(
      () => {}
    );
  };

  const sendMsg = (e: FormEvent) => {
    e.preventDefault();
    if (!chatUser || !chatInput.trim()) return;
    const uid = chatUser.user_id;
    const msg = chatInput;
    setChatInput("");
    apiFetch(`/messages/${uid}`, {
      method: "POST",
      body: JSON.stringify({ message: msg }),
    })
      .then(() =>
        apiFetch<ChatMessage[]>(`/messages/${uid}`).then(setChatMsgs)
      )
      .catch(() => {});
  };

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [chatMsgs]);

  if (chatUser) {
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div className="fixed right-20 top-14 z-50 w-96 rounded-2xl border border-border bg-background shadow-xl flex flex-col max-h-[480px] animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center size-8 rounded-full bg-muted text-xs font-medium">
                {initials(chatUser.user_name)}
              </div>
              <div>
                <p className="text-sm font-semibold">{chatUser.user_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {roleDisplay(chatUser.role)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setChatUser(null)}
              className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Chat messages */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {chatMsgs
              .slice()
              .reverse()
              .map((m, i) => {
                const mine = m.from_user === currentUserId;
                return (
                  <div
                    key={i}
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
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={t.topbar_message_placeholder}
              className="flex-1 h-9 rounded-full bg-muted px-4 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              className="flex items-center justify-center size-9 rounded-full bg-foreground text-background hover:opacity-80 transition-opacity"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-20 top-14 z-50 w-80 rounded-2xl border border-border bg-background shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">
            {t.topbar_online} ({users.length})
          </h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {users.map((u) => (
            <div
              key={u.user_id}
              onClick={() => openChat(u)}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted transition-colors"
            >
              <div className="flex items-center justify-center size-8 rounded-full bg-muted text-xs font-medium shrink-0">
                {initials(u.user_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{u.user_name}</p>
                <p className="text-xs text-muted-foreground">
                  {roleDisplay(u.role)}
                </p>
              </div>
              <MessageSquare className="size-4 text-primary shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
