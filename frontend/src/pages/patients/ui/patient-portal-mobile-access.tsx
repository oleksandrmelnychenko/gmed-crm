import { useEffect, useState } from "react";
import { BellRing, Download, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountBadge, Section } from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { fetchNotificationPanelWorkspace } from "@/components/topbar-data";

const NOTIFICATION_PREFERENCE_KEY_PREFIX = "gmed:patient-portal:browser-notifications";
const PORTAL_NOTIFICATION_EVENTS = ["notification.created"] as const;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const COPY = {
  de: {
    title: "GMED auf dem Smartphone",
    description: "Portal wie eine App öffnen und neue Termine, Dokumente, Empfehlungen oder Rechnungen nicht verpassen.",
    install: "App installieren",
    installed: "App installiert",
    installHint: "Im Browser-Menü „Zum Startbildschirm“ wählen.",
    notifications: "Benachrichtigungen",
    enable: "Benachrichtigungen aktivieren",
    disable: "Benachrichtigungen pausieren",
    enabled: "Benachrichtigungen aktiv",
    blocked: "Benachrichtigungen sind im Browser blockiert. Bitte in den Website-Einstellungen freigeben.",
    testTitle: "GMED-Benachrichtigungen aktiviert",
    testBody: "Portal-Updates können jetzt auf diesem Gerät angezeigt werden.",
  },
  ru: {
    title: "GMED на смартфоне",
    description: "Открывайте портал как приложение и не пропускайте новые приёмы, документы, рекомендации или счета.",
    install: "Установить приложение",
    installed: "Приложение установлено",
    installHint: "Выберите «Добавить на главный экран» в меню браузера.",
    notifications: "Уведомления",
    enable: "Включить уведомления",
    disable: "Приостановить уведомления",
    enabled: "Уведомления включены",
    blocked: "Уведомления заблокированы в браузере. Разрешите их в настройках сайта.",
    testTitle: "Уведомления GMED включены",
    testBody: "Обновления портала теперь могут отображаться на этом устройстве.",
  },
} as const;

function isStandalonePortal() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function notificationPreferenceKey(userId: string) {
  return `${NOTIFICATION_PREFERENCE_KEY_PREFIX}:${userId || "anonymous"}`;
}

function readNotificationPreference(userId: string) {
  try {
    return window.localStorage.getItem(notificationPreferenceKey(userId)) === "enabled";
  } catch {
    return false;
  }
}

function writeNotificationPreference(userId: string, enabled: boolean) {
  try {
    window.localStorage.setItem(notificationPreferenceKey(userId), enabled ? "enabled" : "disabled");
  } catch {
    // Device-local preference is optional; permission state remains authoritative.
  }
}

async function showPortalNotification(title: string, body: string, tag: string) {
  const options: NotificationOptions = {
    body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag,
    data: { url: "/" },
  };
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  }
  new Notification(title, options);
}

export function PatientPortalMobileAccess() {
  const { user } = useAuth();
  const { lang } = useLang();
  const userId = user?.id ?? "";
  const copy = COPY[lang === "de" ? "de" : "ru"];
  const notificationSupported = "Notification" in window;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalonePortal);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => notificationSupported && Notification.permission === "granted" && readNotificationPreference(userId),
  );
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    () => notificationSupported ? Notification.permission : "denied",
  );

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useRealtimeSubscription(PORTAL_NOTIFICATION_EVENTS, (event) => {
    if (!notificationsEnabled || Notification.permission !== "granted" || document.visibilityState === "visible") {
      return;
    }

    void (async () => {
      try {
        clearApiCache("/notifications");
        const workspace = await fetchNotificationPanelWorkspace();
        const notification = workspace.notifications.find((item) => item.id === event.entity_id)
          ?? workspace.notifications[0];
        if (!notification) return;
        await showPortalNotification(
          notification.title || "GMED",
          notification.body || "",
          `gmed-notification-${notification.id}`,
        );
      } catch {
        // The in-app notification remains available when the device notification fails.
      }
    })();
  });

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  async function handleEnableNotifications() {
    if (!notificationSupported) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    const enabled = permission === "granted";
    setNotificationsEnabled(enabled);
    writeNotificationPreference(userId, enabled);
    if (enabled) {
      try {
        await showPortalNotification(copy.testTitle, copy.testBody, "gmed-notifications-enabled");
      } catch {
        // Permission is saved even when this browser cannot display a test notification immediately.
      }
    }
  }

  function handleDisableNotifications() {
    setNotificationsEnabled(false);
    writeNotificationPreference(userId, false);
  }

  return (
    <Section
      title={copy.title}
      accessory={<Smartphone className="size-4 text-muted-foreground" />}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm leading-6 text-muted-foreground">{copy.description}</p>
          {!installed && !installPrompt ? (
            <p className="mt-1 text-xs text-muted-foreground">{copy.installHint}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {installed ? (
            <CountBadge>{copy.installed}</CountBadge>
          ) : installPrompt ? (
            <Button type="button" variant="outline" onClick={() => void handleInstall()}>
              <Download className="size-4" />
              {copy.install}
            </Button>
          ) : null}

          {notificationsEnabled ? (
            <>
              <CountBadge>{copy.enabled}</CountBadge>
              <Button type="button" variant="outline" onClick={handleDisableNotifications}>
                <BellRing className="size-4" />
                {copy.disable}
              </Button>
            </>
          ) : notificationSupported && notificationPermission !== "denied" ? (
            <Button type="button" variant="outline" onClick={() => void handleEnableNotifications()}>
              <BellRing className="size-4" />
              {copy.enable}
            </Button>
          ) : null}
        </div>
      </div>
      {notificationSupported && notificationPermission === "denied" ? (
        <p className="text-xs leading-5 text-amber-700">{copy.blocked}</p>
      ) : null}
    </Section>
  );
}
