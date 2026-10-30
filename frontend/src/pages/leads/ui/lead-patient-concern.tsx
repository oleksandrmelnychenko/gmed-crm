import { useState } from "react";
import { ArrowDownToLine, CalendarDays, Download, Eye, FileText, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import type { DocumentItem } from "@/pages/documents/model/types";

import type { LeadPortalRequestReason } from "../model/lead-risk-intake";
import type { Tx } from "../model/lead-payer";
import { useMarkerKind, usePortalStaffUploadIds } from "./lead-wizard-portal-intake";

/** Whether the transfer replaces text staff already have in "Причина обращения". */
export function patientConcernTransferMode(
  reason: LeadPortalRequestReason | null | undefined,
  currentConcern: string,
): "none" | "fill" | "replace" | "same" {
  const text = reason?.text.trim();
  if (!text) return "none";
  const current = currentConcern.trim();
  if (!current) return "fill";
  return current === text ? "same" : "replace";
}

/**
 * "Со слов пациента" above "Причина обращения" in the medical step (trigger
 * flow 13.2): the reason the lead wrote in the cabinet with its date, a
 * button that takes it into staff's `concern` (at once while that is empty,
 * after a confirmation when it would replace staff's text), and the medical
 * files the lead uploaded (the same as "Загружено пациентом" in the documents
 * step). Nothing when the lead entered nothing. The lead's text itself is
 * never changed. What staff entered in the client's form says «внёс
 * сотрудник» instead, a file they uploaded «загружено сотрудником» (owner
 * 2026-10-30).
 */
export function LeadPatientConcern({
  reason,
  documents,
  currentConcern,
  onTransfer,
  onOpen,
  onDownload,
  tx,
  disabled = false,
}: {
  reason: LeadPortalRequestReason | null | undefined;
  documents: readonly DocumentItem[];
  currentConcern: string;
  onTransfer: (text: string) => void;
  onOpen: (document: DocumentItem) => void;
  onDownload: (document: DocumentItem) => void;
  tx: Tx;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const mode = patientConcernTransferMode(reason, currentConcern);
  const reasonKind = useMarkerKind("request_reason");
  const staffUploads = usePortalStaffUploadIds();
  if (!reason && documents.length === 0) return null;
  // Staff's own entry in the client's form is no word of the patient (owner 2026-10-30).
  const byStaff = reason
    ? reasonKind === "staff"
    : documents.every((document) => staffUploads.has(document.id));

  const transfer = () => {
    if (!reason) return;
    if (mode === "replace" && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onTransfer(reason.text.trim());
  };

  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-border/70 bg-card p-2.5" data-testid="lead-patient-concern">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" data-testid="lead-patient-concern-source">
            <UserRound aria-hidden className="size-3.5" />
            {byStaff
              ? tx("Внёс сотрудник в анкете клиента", "Von Mitarbeitenden im Kundenformular eingetragen")
              : tx("Со слов пациента", "Angaben der Patientin / des Patienten")}
          </span>
          {reason?.updated_at ? (
            <span className="text-xs tabular-nums text-muted-foreground" data-testid="lead-patient-concern-date">
              {formatAppDateTime(reason.updated_at)}
            </span>
          ) : null}
        </div>
        {reason ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 rounded-lg text-xs"
            disabled={disabled || mode === "same"}
            onClick={transfer}
            data-testid="lead-patient-concern-transfer"
          >
            <ArrowDownToLine aria-hidden className="size-3.5" />
            {mode === "same"
              ? tx("Уже в причине обращения", "Bereits im Anliegen")
              : tx("Перенести в причину обращения", "In das Anliegen übernehmen")}
          </Button>
        ) : null}
      </div>
      {reason ? (
        <p className="whitespace-pre-line break-words text-sm" data-testid="lead-patient-concern-text">
          {reason.text}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="alert" data-testid="lead-patient-concern-confirm">
          <span className="min-w-0 flex-1">
            {byStaff
              ? tx(
                "В причине обращения уже есть текст. Заменить его текстом из анкеты клиента?",
                "Im Anliegen steht bereits ein Text. Durch den Text aus dem Kundenformular ersetzen?",
              )
              : tx(
                "В причине обращения уже есть текст сотрудника. Заменить его текстом пациента?",
                "Im Anliegen steht bereits ein Text. Durch die Angaben der Patientin / des Patienten ersetzen?",
              )}
          </span>
          <Button type="button" size="xs" variant="destructive" onClick={transfer} data-testid="lead-patient-concern-replace">
            {tx("Заменить", "Ersetzen")}
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            {tx("Отмена", "Abbrechen")}
          </Button>
        </div>
      ) : null}
      {documents.length > 0 ? (
        <div className="space-y-1" data-testid="lead-patient-concern-files">
          <div className="sr-only">
            {tx("Файлы пациента", "Dateien der Patientin / des Patienten")}
          </div>
          <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-background/60">
            {documents.map((document) => {
              const name = document.original_filename || document.auto_name || tx("Документ", "Dokument");
              return (
                <li key={document.id} className="flex items-center gap-1.5 px-2 py-1 text-[13px]">
                  <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                  {staffUploads.has(document.id) ? (
                    <StatusChip tone="info" className="shrink-0 whitespace-nowrap" data-testid="lead-patient-concern-file-by-staff">
                      {tx("Загружено сотрудником", "Von GMED hochgeladen")}
                    </StatusChip>
                  ) : null}
                  <StatusChip tone="info" className="shrink-0 whitespace-nowrap tabular-nums">
                    <CalendarDays aria-hidden="true" />
                    {formatAppDate(document.created_at)}
                  </StatusChip>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`${tx("Открыть", "Öffnen")}: ${name}`}
                    title={tx("Открыть", "Öffnen")}
                    onClick={() => onOpen(document)}
                  >
                    <Eye aria-hidden className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`${tx("Скачать", "Herunterladen")}: ${name}`}
                    title={tx("Скачать", "Herunterladen")}
                    onClick={() => onDownload(document)}
                  >
                    <Download aria-hidden className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
