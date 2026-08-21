import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";

import {
  fetchUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHrefForRole,
  type Notification,
} from "@/components/topbar-data";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Banner,
  CountBadge,
  EmptyCell,
  PageHeader,
  TabLoader,
  TabShell,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { formatPortalDateTime } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

const PORTAL_NOTIFICATION_EVENTS = [
  "notification.created",
  "notification.read",
  "notifications.read_all",
] as const;

type ReadFilter = "all" | "unread" | "read";

const COPY = {
  de: {
    title: "Meine Benachrichtigungen",
    description: "Termine, Dokumente, Empfehlungen, Services und Rechnungen an einem Ort.",
    unread: "Ungelesen",
    refresh: "Aktualisieren",
    markAll: "Alle als gelesen markieren",
    all: "Alle",
    onlyUnread: "Nur ungelesen",
    onlyRead: "Nur gelesen",
    filterLabel: "Benachrichtigungen filtern",
    empty: "Für diesen Filter gibt es keine Benachrichtigungen.",
    open: "Öffnen",
    markRead: "Als gelesen markieren",
    read: "Gelesen",
    new: "Neu",
    loadError: "Benachrichtigungen konnten nicht geladen werden.",
    actionError: "Die Benachrichtigung konnte nicht aktualisiert werden.",
    unavailable: "Diese Benachrichtigung hat kein freigegebenes Portalziel.",
  },
  ru: {
    title: "Мои уведомления",
    description: "Визиты, документы, рекомендации, сервисы и счета в одном месте.",
    unread: "Непрочитанные",
    refresh: "Обновить",
    markAll: "Отметить все прочитанными",
    all: "Все",
    onlyUnread: "Только непрочитанные",
    onlyRead: "Только прочитанные",
    filterLabel: "Фильтр уведомлений",
    empty: "Для этого фильтра уведомлений нет.",
    open: "Открыть",
    markRead: "Отметить прочитанным",
    read: "Прочитано",
    new: "Новое",
    loadError: "Не удалось загрузить уведомления.",
    actionError: "Не удалось обновить уведомление.",
    unavailable: "У этого уведомления нет доступного раздела портала.",
  },
} as const;

function notificationCategory(item: Notification, lang: "de" | "ru") {
  const labels: Record<string, [string, string]> = {
    appointment: ["Termin", "Визит"],
    appointment_request: ["Terminanfrage", "Запрос визита"],
    concierge_service: ["Concierge-Service", "Консьерж-сервис"],
    document: ["Dokument", "Документ"],
    translation_request: ["Übersetzung", "Перевод"],
    invoice: ["Rechnung", "Счёт"],
    recommendation: ["Empfehlung", "Рекомендация"],
    service_package: ["Abonnement", "Подписка"],
    patient_service_package: ["Abonnement", "Подписка"],
    privacy_request: ["Datenschutz", "Конфиденциальность"],
    feedback: ["Feedback", "Отзыв"],
    message_peer: ["Nachricht", "Сообщение"],
  };
  const label = labels[item.entity_type ?? ""];
  return label ? label[lang === "de" ? 0 : 1] : lang === "de" ? "Portal" : "Портал";
}

export function PatientNotificationsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const copy = COPY[lang === "de" ? "de" : "ru"];
  const portalLang = lang === "de" ? "de" : "ru";
  const isPatient = user?.role === "patient";
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<ReadFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useRealtimeSubscription(PORTAL_NOTIFICATION_EVENTS, () => {
    clearApiCache("/notifications");
    clearApiCache("/notifications/unread-count");
    setVersion((current) => current + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPatient) {
        setNotifications([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setRefreshing(!loading);
      setError("");
      try {
        const rows = await fetchUserNotifications({ forceFresh: true });
        if (!cancelled) setNotifications(rows);
      } catch {
        if (!cancelled) setError(copy.loadError);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [copy.loadError, isPatient, version]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );
  const visibleNotifications = useMemo(
    () => notifications.filter((item) => (
      filter === "all" || (filter === "unread" ? !item.is_read : item.is_read)
    )),
    [filter, notifications],
  );

  async function markOneRead(item: Notification) {
    if (item.is_read) return true;
    setBusyId(item.id);
    setError("");
    try {
      await markNotificationRead(item.id);
      clearApiCache("/notifications");
      clearApiCache("/notifications/unread-count");
      setNotifications((current) => current.map((candidate) => (
        candidate.id === item.id ? { ...candidate, is_read: true } : candidate
      )));
      return true;
    } catch {
      setError(copy.actionError);
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function openNotification(item: Notification) {
    const href = notificationHrefForRole(item, "patient");
    const marked = await markOneRead(item);
    if (marked && href) staffGo(href);
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    setBusyId("all");
    setError("");
    try {
      await markAllNotificationsRead();
      clearApiCache("/notifications");
      clearApiCache("/notifications/unread-count");
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <TabLoader />;

  return (
    <TabShell className="mt-0 min-h-0">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <CountBadge>{copy.unread}: {unreadCount}</CountBadge>
            <Button
              type="button"
              variant="outline"
              className={tokens.control.primaryButton}
              disabled={refreshing}
              onClick={() => setVersion((current) => current + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {copy.refresh}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={tokens.control.primaryButton}
              disabled={unreadCount === 0 || busyId === "all"}
              onClick={() => void markAllRead()}
            >
              {busyId === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
              {copy.markAll}
            </Button>
          </>
        }
      />

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      <section className="space-y-4">
        <div className="flex justify-end">
          <NativeComboboxSelect
            value={filter}
            aria-label={copy.filterLabel}
            className="w-full sm:w-56"
            onChange={(event) => setFilter(event.target.value as ReadFilter)}
          >
            <option value="all">{copy.all}</option>
            <option value="unread">{copy.onlyUnread}</option>
            <option value="read">{copy.onlyRead}</option>
          </NativeComboboxSelect>
        </div>

        {visibleNotifications.length === 0 ? (
          <EmptyCell>{copy.empty}</EmptyCell>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {visibleNotifications.map((item) => {
              const href = notificationHrefForRole(item, "patient");
              return (
                <article
                  key={item.id}
                  className={cn(
                    "rounded-2xl border p-4 shadow-sm",
                    item.is_read ? "border-border/70 bg-card" : "border-primary/25 bg-primary/[0.035]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      item.is_read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                    )}>
                      <Bell className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {notificationCategory(item, portalLang)}
                        </span>
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          item.is_read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                        )}>
                          {item.is_read ? copy.read : copy.new}
                        </span>
                      </div>
                      {item.body ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p> : null}
                      <p className="mt-2 text-xs text-muted-foreground">{formatPortalDateTime(item.created_at)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {!item.is_read ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === item.id}
                        onClick={() => void markOneRead(item)}
                      >
                        {busyId === item.id ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
                        {copy.markRead}
                      </Button>
                    ) : null}
                    {href ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === item.id}
                        onClick={() => void openNotification(item)}
                      >
                        <ExternalLink className="size-4" />
                        {copy.open}
                      </Button>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">{copy.unavailable}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </TabShell>
  );
}
