import { useCallback, useRef, useState, type ReactNode } from "react";
import { CircleAlert, FilePlus2, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { refreshSignatureSummaries } from "../data/use-signature-summary";
import {
  RegenerateDocumentError,
  extendEstimateValidity,
  regenerateOutdatedDocument,
  type RegeneratedDocument,
} from "../data/regenerate-document-version";
import { DocumentSignatureAction, SIGNING_ROLES } from "./document-signature-action";
import { DocumentPortalReleaseAction } from "./document-portal-release-action";

/**
 * Roles that make a new version (`POST /documents/generate`: CEO and Patient
 * Manager) and send it for signature (the same two). The server checks both
 * again; this only keeps the button away from everyone else.
 */
const RENEWING_ROLES = ["ceo", "patient_manager"];

export function useCanRenewOutdatedDocuments(): boolean {
  const { user } = useAuth();
  const role = user?.role ?? "";
  return RENEWING_ROLES.includes(role) && SIGNING_ROLES.includes(role);
}

type Tx = (ru: string, de: string) => string;

/** Why a new version could not be made, in the words of the screen. */
export function renewalErrorText(error: unknown, tx: Tx): string {
  if (error instanceof RegenerateDocumentError) {
    return error.code === "not_outdated"
      ? tx("Документ уже обновлён или больше не текущая версия. Обновите список.", "Das Dokument wurde bereits erneuert oder ist nicht mehr die aktuelle Version. Laden Sie die Liste neu.")
      : tx("Шаблон документа не найден: создайте новую версию на странице документа.", "Die Vorlage des Dokuments wurde nicht gefunden: Erstellen Sie die neue Version auf der Dokumentseite.");
  }
  const code = error instanceof ApiRequestError
    ? ((error.body as { error?: string; code?: string } | null | undefined)?.error ?? error.code ?? (error.body as { code?: string } | null | undefined)?.code)
    : undefined;
  if (code === "no_changes") {
    return tx("Нет изменений для новой версии", "Keine Änderungen für eine neue Version");
  }
  if (code === "document_locked_by_active_order") {
    return tx("Заказ открыт: новая версия этого документа создаётся только при изменении заказа.", "Der Auftrag ist offen: Eine neue Version dieses Dokuments entsteht nur durch eine Änderung des Auftrags.");
  }
  if (code === "quote_valid_until_past") {
    return tx("Срок действия сметы не может быть в прошлом.", "Das Gültigkeitsdatum des Kostenvoranschlags darf nicht in der Vergangenheit liegen.");
  }
  if (code === "quote_superseded" || code === "quote_rejected" || code === "estimate_without_quote") {
    return tx("Смета этого документа закрыта: создайте новую смету заказа.", "Der Kostenvoranschlag dieses Dokuments ist geschlossen: Erstellen Sie einen neuen Kostenvoranschlag zum Auftrag.");
  }
  if (code === "document_not_current") {
    return tx("У документа уже есть более новая версия. Обновите список.", "Das Dokument hat bereits eine neuere Version. Laden Sie die Liste neu.");
  }
  if (code === "signature_pending") {
    return tx("Документ ещё на подписи. Сначала отзовите запрос подписи.", "Das Dokument ist noch zur Unterschrift unterwegs. Ziehen Sie zuerst die Signaturanfrage zurück.");
  }
  if (code === "representative_details_incomplete") {
    return tx("Не хватает данных представителя для договора. Дополните их в карточке пациента.", "Für den Vertrag fehlen Angaben der Vertretung. Ergänzen Sie sie in der Patientenkarte.");
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("already has a newer version")) {
    return tx("У документа уже есть более новая версия. Обновите список.", "Das Dokument hat bereits eine neuere Version. Laden Sie die Liste neu.");
  }
  return message || tx("Не удалось создать новую версию.", "Die neue Version konnte nicht erstellt werden.");
}

/** The status of a document that needs a new version, as in the signature dialog. */
export function OutdatedDocumentChip({ className }: { className?: string }) {
  const { lang } = useLang();
  return (
    <StatusChip tone="warning" className={className} data-testid="document-outdated-chip">
      <CircleAlert aria-hidden="true" />
      {lang === "de" ? "Veraltet, neue Version nötig" : "Устарел, нужна новая версия"}
    </StatusChip>
  );
}

/** A document just made: a new version (`previousId`) or a new document from a template. */
type RenewedDocument = { id: string; title: string; previousId?: string };

/**
 * «Создать новую версию» for an outdated document: makes the new version from
 * the current records in one click (the server's replace path, the old version
 * stays in the history as superseded), then opens the signature dialog of the
 * new version with the previous recipients suggested. Sending stays a click
 * of staff in that dialog. A template that needs manual input goes to the
 * replacement form via `onNeedsForm`.
 */
export function useOutdatedDocumentRenewal({
  onRenewed,
  onNeedsForm,
}: {
  /** The list should reload: the old version is superseded now. */
  onRenewed?: (created: RenewedDocument) => void;
  onNeedsForm?: (previousId: string) => void;
} = {}) {
  const { lang } = useLang();
  const tx = useCallback<Tx>((ru, de) => (lang === "de" ? de : ru), [lang]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<RenewedDocument | null>(null);
  const running = useRef(false);

  const run = useCallback(async (documentId: string, make: () => Promise<RegeneratedDocument>): Promise<boolean> => {
    // One new version at a time: a second click must not race the first.
    if (running.current) return false;
    running.current = true;
    setBusyId(documentId);
    try {
      const result = await make();
      if (result.kind === "needs_form") {
        onNeedsForm?.(result.previousId);
        return true;
      }
      refreshSignatureSummaries();
      toast.success(tx("Новая версия создана. Проверьте получателей и отправьте её на подпись.", "Neue Version erstellt. Prüfen Sie die Empfänger und senden Sie sie zur Unterschrift."));
      setRenewed(result);
      onRenewed?.(result);
      return true;
    } catch (error) {
      toast.error(renewalErrorText(error, tx));
      return false;
    } finally {
      running.current = false;
      setBusyId(null);
    }
  }, [onNeedsForm, onRenewed, tx]);

  const renew = useCallback(
    (documentId: string, reason: "outdated" | "expired" | "consent_changed" = "outdated") =>
      run(documentId, () => regenerateOutdatedDocument(documentId, reason)),
    [run],
  );

  /** «Продлить срок до …» of a Kostenvoranschlag: the quote's date, then the new version. */
  const extend = useCallback(
    (documentId: string, validUntil: string) =>
      run(documentId, () => extendEstimateValidity(documentId, validUntil)),
    [run],
  );

  const dialog: ReactNode = renewed ? (
    <DocumentSignatureAction
      key={renewed.id}
      documentId={renewed.id}
      title={renewed.title}
      prefillSignersFrom={renewed.previousId}
      headerExtra={(
        <>
          <span className="text-xs text-muted-foreground">
            {renewed.previousId
              ? tx("Новая версия: отправьте её на подпись или передайте клиенту.", "Neue Version: Senden Sie sie zur Unterschrift oder übergeben Sie sie dem Kunden.")
              : tx("Документ создан: отправьте его на подпись или передайте клиенту.", "Dokument erstellt: Senden Sie es zur Unterschrift oder übergeben Sie es dem Kunden.")}
          </span>
          <DocumentPortalReleaseAction documentId={renewed.id} onReleased={() => onRenewed?.(renewed)} />
        </>
      )}
      hideTrigger
      open
      onOpenChange={(open) => { if (!open) setRenewed(null); }}
      onDone={() => onRenewed?.(renewed)}
    />
  ) : null;

  /** Opens the same next steps for a document made elsewhere, e.g. from a template in the patient card. */
  const offer = useCallback((created: RenewedDocument) => setRenewed(created), []);

  return { renew, extend, offer, busyId, dialog };
}

/** The button beside the «Устарел» status. */
export function RenewOutdatedDocumentButton({
  documentId,
  busyId,
  onRenew,
  iconOnly = false,
  title,
}: {
  documentId: string;
  busyId: string | null;
  onRenew: (documentId: string) => void;
  iconOnly?: boolean;
  /** The document's name, for the accessible label of the icon button. */
  title?: string;
}) {
  const { lang } = useLang();
  const label = lang === "de" ? "Neue Version erstellen" : "Создать новую версию";
  const busy = busyId === documentId;
  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-sm" : "sm"}
      className={iconOnly ? "text-amber-700 dark:text-amber-400" : "shrink-0 gap-1.5"}
      title={label}
      aria-label={title ? `${label}: ${title}` : label}
      aria-busy={busy}
      disabled={busyId !== null}
      data-testid={`renew-outdated-document-${documentId}`}
      onClick={(event) => { event.stopPropagation(); onRenew(documentId); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FilePlus2 aria-hidden="true" className="size-3.5" />}
      {iconOnly ? null : busy ? (lang === "de" ? "Wird erstellt…" : "Создаём…") : label}
    </Button>
  );
}
