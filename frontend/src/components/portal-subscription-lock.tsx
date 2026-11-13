import { useEffect, useState } from "react";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { LockKeyhole, MessageSquare, PauseCircle } from "lucide-react";

import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

type AgencyContact = { agency_phone?: string | null; agency_email?: string | null };
type ChatPeer = { id: string; name: string; role: string };

const TEXT = {
  ru: {
    lockedTitle: "Нужен тариф заказа.",
    lockedBody: "Чат с командой и новые запросы на сервисы доступны с тарифом в заказе этого пациента (GMED One, Reserve или Behandlung). Обратитесь в GMED.",
    lockedOpen: "Визиты, уже заказанные сервисы, уведомления, документы, счета и аккаунт остаются доступными.",
    lockedDescription: "Нужен тариф заказа",
    pausedTitle: "Ваша подписка приостановлена.",
    pausedBody: "Пока она приостановлена, новые запросы на визиты и сервисы закрыты.",
    pausedOpen: "Уже согласованные визиты, ваши запросы на сервисы (открытый можно отменить), рекомендации, уведомления, подписки, документы, счета, чат и аккаунт остаются доступными.",
    pausedDescription: "Подписка приостановлена",
    manager: "Ваш менеджер",
    contact: "GMED",
    phone: "тел.",
    writeManager: "Написать менеджеру",
    close: "Закрыть",
  },
  de: {
    lockedTitle: "Ein Tarif im Auftrag ist erforderlich.",
    lockedBody: "Der Chat mit dem Team und neue Serviceanfragen sind mit einem Tarif im Auftrag dieses Patienten möglich (GMED One, Reserve oder Behandlung). Bitte wenden Sie sich an GMED.",
    lockedOpen: "Termine, bereits gebuchte Services, Benachrichtigungen, Dokumente, Rechnungen und Ihr Konto bleiben verfügbar.",
    lockedDescription: "Tarif im Auftrag erforderlich",
    pausedTitle: "Ihr Abonnement ist pausiert.",
    pausedBody: "Solange es pausiert ist, sind neue Termin- und Serviceanfragen geschlossen.",
    pausedOpen: "Bereits vereinbarte Termine, Ihre Serviceanfragen (eine offene können Sie stornieren), Empfehlungen, Benachrichtigungen, Abonnements, Dokumente, Rechnungen, der Chat und Ihr Konto bleiben verfügbar.",
    pausedDescription: "Abonnement pausiert",
    manager: "Ihr Patientenmanager",
    contact: "GMED",
    phone: "Tel.",
    writeManager: "Dem Manager schreiben",
    close: "Schließen",
  },
} as const;

/**
 * The notice in place of a closed portal module. Without a subscription it
 * says so; with a paused one (owner decision 2026-11-10) it says in plain
 * words that the subscription is paused, names the patient's manager, gives
 * the agency's phone and e-mail from the settings (the values of the legal
 * page) and opens the chat, which stays open during a pause.
 */
export function PortalSubscriptionLock({
  label,
  onClose,
  paused = false,
}: {
  label?: string;
  onClose?: () => void;
  /** The subscription is paused, not missing. */
  paused?: boolean;
}) {
  const { lang } = useLang();
  // Portal routes are checked against the patient whitelist.
  const { staffGo } = useStaffNavigate();
  const text = TEXT[lang === "de" ? "de" : "ru"];
  const [agency, setAgency] = useState<AgencyContact | null>(null);
  const [manager, setManager] = useState<ChatPeer | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AgencyContact>("/public/legal", { cacheTtlMs: 300_000 })
      .then((notice) => {
        if (!cancelled) setAgency(notice);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!paused) return;
    let cancelled = false;
    // The chat peers of a patient are the assigned team; the manager first.
    apiFetch<ChatPeer[]>("/messages/allowed-peers", { cacheTtlMs: 60_000 })
      .then((peers) => {
        if (cancelled || !Array.isArray(peers)) return;
        setManager(peers.find((peer) => peer.role === "patient_manager") ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [paused]);

  const contacts = [
    agency?.agency_phone ? `${text.phone} ${agency.agency_phone}` : null,
    agency?.agency_email || null,
  ].filter(Boolean);
  const Icon = paused ? PauseCircle : LockKeyhole;

  const content = (
    <div
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"
      role="status"
      data-testid={paused ? "portal-subscription-paused" : "portal-subscription-lock"}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-2">
        <p className="font-medium">{paused ? text.pausedTitle : text.lockedTitle}</p>
        <p>{paused ? text.pausedBody : text.lockedBody}</p>
        <p className="text-sm">{paused ? text.pausedOpen : text.lockedOpen}</p>
        {paused && manager ? (
          <p className="text-sm" data-testid="portal-subscription-manager">
            {text.manager}: <span className="font-medium">{manager.name}</span>
          </p>
        ) : null}
        {contacts.length > 0 ? (
          <p className="text-sm [overflow-wrap:anywhere]" data-testid="portal-subscription-contact">
            {text.contact}: {contacts.join(" · ")}
          </p>
        ) : null}
        {paused ? (
          <Button
            type="button"
            className="h-auto min-h-9 max-w-full whitespace-normal"
            onClick={() => {
              onClose?.();
              staffGo(manager ? `/chat?peer=${manager.id}` : "/chat");
            }}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            {text.writeManager}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (!onClose) return <div className="mx-auto w-full max-w-3xl py-2">{content}</div>;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AdminDialogScaffold
        title={<span className="inline-flex items-center gap-2"><Icon className="size-5 text-[var(--brand)]" aria-hidden="true" />{label}</span>}
        description={paused ? text.pausedDescription : text.lockedDescription}
        maxWidthClassName="sm:max-w-xl"
        footer={<div className="flex justify-end p-3"><Button variant="outline" onClick={onClose}>{text.close}</Button></div>}
      >
        {content}
      </AdminDialogScaffold>
    </Dialog>
  );
}
