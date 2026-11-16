import { useState } from "react";
import { CalendarClock, CalendarPlus, CalendarX2, LoaderCircle, Upload } from "lucide-react";

import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDaysToDateKey, appDateKey, formatAppDate } from "@/lib/app-time-zone";
import { StatusChip } from "@/components/ui/status-chip";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  validityRenewalKind,
  validUntilText,
  validityStatusText,
  type DocumentValidity,
  type DocumentValidityFilter,
} from "../model/document-validity";
import { RenewOutdatedDocumentButton } from "./outdated-document-renewal";

/**
 * The validity of a document (owner 2026-11-15): «Просрочен» (red),
 * «Истекает через N дн.» (amber) or «Действует до DD.MM.YYYY» (neutral).
 * Nothing for a document without a date. `compact`: the short status only,
 * the date in the tooltip (lists).
 */
export function DocumentValidityChip({
  document,
  compact = false,
  className,
}: {
  document: DocumentValidity;
  compact?: boolean;
  className?: string;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const status = validityStatusText(document, tx);
  const until = validUntilText(document, tx);
  if (!status || !until) return null;
  const tone = document.validity_status === "expired"
    ? "error"
    : document.validity_status === "expiring" ? "warning" : "neutral";
  const Icon = document.validity_status === "expired" ? CalendarX2 : CalendarClock;
  const date = formatAppDate(document.valid_until ?? "");
  const label = document.validity_status === "valid"
    ? compact ? tx(`до ${date}`, `bis ${date}`) : until
    : compact ? status : `${status} · ${until}`;
  return (
    <StatusChip
      tone={tone}
      className={cn(compact && "text-[11px] leading-4", className)}
      title={`${status} · ${until}`}
      data-testid="document-validity-chip"
      data-validity={document.validity_status ?? undefined}
    >
      <Icon aria-hidden="true" />
      <span className="truncate">{label}</span>
    </StatusChip>
  );
}

/**
 * «Продлить срок до …» of a Kostenvoranschlag: a date (today + the usual
 * offer validity), then the quote and the estimate's new version take it.
 */
function ExtendValidityButton({
  documentId,
  busyId,
  onExtend,
  iconOnly,
  title,
}: {
  documentId: string;
  busyId: string | null;
  onExtend: (documentId: string, validUntil: string) => Promise<boolean> | void;
  iconOnly: boolean;
  title?: string;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const today = appDateKey();
  const busy = busyId === documentId;
  const label = tx("Продлить срок до …", "Gültigkeit verlängern bis …");
  const valid = Boolean(date) && date >= today;
  return (
    // The dialog sits in clickable rows: its clicks must not open the row.
    <span className="contents" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Button
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
        size={iconOnly ? "icon-sm" : "sm"}
        className={iconOnly ? "text-amber-700 dark:text-amber-400" : "shrink-0 gap-1.5"}
        title={label}
        aria-label={title ? `${label}: ${title}` : label}
        aria-busy={busy}
        disabled={busyId !== null}
        data-testid={`extend-document-validity-${documentId}`}
        onClick={(event) => {
          event.stopPropagation();
          setDate(addDaysToDateKey(today, DEFAULT_QUOTE_VALIDITY_DAYS));
          setOpen(true);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <CalendarPlus aria-hidden="true" className="size-3.5" />}
        {iconOnly ? null : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <AdminDialogScaffold
          icon={CalendarPlus}
          title={tx("Продлить срок", "Gültigkeit verlängern")}
          description={title}
          maxWidthClassName="sm:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy) return;
            void Promise.resolve(onExtend(documentId, date)).then((done) => {
              if (done !== false) setOpen(false);
            });
          }}
          footer={(
            <div className="flex justify-end gap-2 px-4 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button type="submit" size="sm" disabled={!valid || busyId !== null} data-testid="extend-document-validity-submit">
                {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
                {tx("Продлить", "Verlängern")}
              </Button>
            </div>
          )}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{tx("Действует до", "Gültig bis")}</span>
            <Input
              type="date"
              value={date}
              min={today}
              required
              data-testid="extend-document-validity-date"
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </AdminDialogScaffold>
      </Dialog>
    </span>
  );
}

/**
 * What staff do with an expiring or expired document (`validityRenewalKind`):
 * a Kostenvoranschlag «Продлить срок до …» (its quote's date), another
 * document made from a template «Создать новую версию» (the fix-65 path), an
 * uploaded scan «Загрузить новый» (its next version by upload).
 */
export function DocumentValidityAction({
  document,
  busyId,
  onRenew,
  onExtend,
  onUploadNew,
  iconOnly = false,
  title,
}: {
  document: DocumentValidity & { id: string; generated_template_id?: string | null; order_id?: string | null };
  busyId: string | null;
  onRenew?: (documentId: string) => void;
  onExtend?: (documentId: string, validUntil: string) => Promise<boolean> | void;
  onUploadNew?: () => void;
  iconOnly?: boolean;
  title?: string;
}) {
  const { lang } = useLang();
  const kind = validityRenewalKind(document);
  if (!kind) return null;
  if (kind === "extend_quote") {
    if (!onExtend) return null;
    return (
      <ExtendValidityButton
        documentId={document.id}
        busyId={busyId}
        onExtend={onExtend}
        iconOnly={iconOnly}
        title={title}
      />
    );
  }
  if (kind === "new_version") {
    // The new version is made for a patient's document only (the server's
    // replace path); the caller passes `onRenew` where that holds.
    if (!onRenew) return null;
    return (
      <RenewOutdatedDocumentButton
        documentId={document.id}
        busyId={busyId}
        onRenew={onRenew}
        iconOnly={iconOnly}
        title={title}
      />
    );
  }
  if (!onUploadNew) return null;
  const label = lang === "de" ? "Neues hochladen" : "Загрузить новый";
  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-sm" : "sm"}
      className={iconOnly ? "text-amber-700 dark:text-amber-400" : "shrink-0 gap-1.5"}
      title={label}
      aria-label={title ? `${label}: ${title}` : label}
      data-testid={`upload-new-document-${document.id}`}
      onClick={(event) => { event.stopPropagation(); onUploadNew(); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Upload aria-hidden="true" className="size-3.5" />
      {iconOnly ? null : label}
    </Button>
  );
}

/** Options of the validity filter, in list order. */
export function validityFilterOptions(lang: string): Array<{ value: DocumentValidityFilter; label: string }> {
  const de = lang === "de";
  return [
    { value: "", label: de ? "Alle Gültigkeiten" : "Любой срок действия" },
    { value: "attention", label: de ? "Abgelaufen oder läuft ab" : "Просроченные и истекающие" },
    { value: "expired", label: de ? "Abgelaufen" : "Просроченные" },
    { value: "expiring", label: de ? "Läuft in 30 Tagen ab" : "Истекают в течение 30 дн." },
  ];
}
