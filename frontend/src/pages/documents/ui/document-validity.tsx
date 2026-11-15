import { CalendarClock, CalendarX2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatAppDate } from "@/lib/app-time-zone";
import { StatusChip } from "@/components/ui/status-chip";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  needsValidityAttention,
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
 * What staff do with an expiring or expired document: a document made from a
 * template gets «Создать новую версию» (the fix-65 path), an uploaded scan
 * «Загрузить новый» (the existing upload). Nothing for other documents.
 */
export function DocumentValidityAction({
  document,
  busyId,
  onRenew,
  onUploadNew,
  iconOnly = false,
  title,
}: {
  document: DocumentValidity & { id: string; generated_template_id?: string | null };
  busyId: string | null;
  onRenew?: (documentId: string) => void;
  onUploadNew?: () => void;
  iconOnly?: boolean;
  title?: string;
}) {
  const { lang } = useLang();
  if (!needsValidityAttention(document)) return null;
  if (document.generated_template_id) {
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
