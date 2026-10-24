import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Eye, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { downloadDocumentFile, openDocumentPreview } from "@/pages/documents/data/document-api";

import { fetchLeadPayerLink, type StaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import { fetchLeadPortalIntake, type LeadPortalIntake, type LeadRepresentative } from "../data/lead-portal-intake-api";
import type { RepresentativeUploadKind } from "../data/lead-risk-api";
import {
  identityDocumentCount,
  identityDocumentGroups,
  identityDocumentOriginLabel,
  type IdentityDocumentFile,
  type IdentityDocumentGroup,
} from "../model/lead-identity-documents";
import type { Tx } from "../model/lead-payer";
import { leadErrorMessage } from "../model/leads-model";
import { LeadIdentityDocumentData } from "./lead-identity-document-data";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; intake: LeadPortalIntake | null; payer: StaffPayerQuestionnaire | null };

/** One identity copy with "open" and "download" (`GET /documents/{id}/download`). */
function FileRow({
  file,
  tx,
  busy,
  onOpen,
  onDownload,
}: {
  file: IdentityDocumentFile;
  tx: Tx;
  busy: string | null;
  onOpen: (file: IdentityDocumentFile) => void;
  onDownload: (file: IdentityDocumentFile) => void;
}) {
  const opening = busy === `open-${file.id}`;
  const downloading = busy === `download-${file.id}`;
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm"
      data-testid={`lead-identity-file-${file.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground [overflow-wrap:anywhere]">{file.file_name || "—"}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {file.uploaded_at ? <span>{formatAppDate(file.uploaded_at)}</span> : null}
          <span>{identityDocumentOriginLabel(file.origin, tx)}</span>
          {file.reviewed ? <StatusChip tone="success">{tx("Проверен", "Geprüft")}</StatusChip> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => onOpen(file)} data-testid={`lead-identity-file-${file.id}-open`}>
          {opening ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Eye aria-hidden="true" className="size-3.5" />}
          {tx("Открыть", "Öffnen")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={tx("Скачать", "Herunterladen")}
          aria-label={`${tx("Скачать", "Herunterladen")} ${file.file_name}`}
          disabled={Boolean(busy)}
          onClick={() => onDownload(file)}
        >
          {downloading ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Download aria-hidden="true" className="size-3.5" />}
        </Button>
      </div>
    </li>
  );
}

/**
 * The identity copies of the lead, of everyone who acts for the lead and of
 * the payer, in the lead detail's "Детали" tab, for every role the server
 * sends them to (`GET /leads/{id}/portal-intake` → `identity_documents`,
 * `representation`, and the payer's own link; owner decision 2026-10-24:
 * Sales opens the identity scans it uploads). A role with `leads.edit` but
 * without the wizard (`leads.convert`) also gets the identity document DATA
 * form here (`PUT /leads/{id}/identity-document-data`), with the uploads of a
 * representative's files. Medical attachments keep their own section.
 */
export function LeadIdentityDocumentsBlock({
  leadId,
  showDataForm,
  tx,
  lang,
  title,
}: {
  leadId: string;
  /** Render the identity document data form (a role with `leads.edit` and no wizard, on an open lead). */
  showDataForm: boolean;
  tx: Tx;
  lang: string;
  /** The section's heading, given the count of files. */
  title: (count: number) => ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // The payer's link is read by the roles that read the payer block; for
      // another role it is refused and the payer's group is left out.
      const [intake, payerLink] = await Promise.all([
        fetchLeadPortalIntake(leadId),
        fetchLeadPayerLink(leadId).catch(() => null),
      ]);
      setState({ kind: "ready", intake, payer: payerLink?.questionnaire ?? null });
    } catch (error) {
      setState({ kind: "error", message: leadErrorMessage(error, tx, tx("Не удалось загрузить документы", "Dokumente konnten nicht geladen werden")) });
    }
  }, [leadId, tx]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => (state.kind === "ready" ? identityDocumentGroups(state.intake, state.payer, tx) : []),
    [state, tx],
  );
  const count = identityDocumentCount(groups);

  const open = async (file: IdentityDocumentFile) => {
    // The tab is opened with the click, before the file arrives, so the
    // browser does not block it as a popup.
    const previewWindow = window.open("", "_blank", "noopener,noreferrer");
    setBusy(`open-${file.id}`);
    setActionError("");
    try {
      await openDocumentPreview(
        file.id,
        tx("Браузер заблокировал окно просмотра — разрешите всплывающие окна или скачайте файл", "Der Browser hat das Vorschaufenster blockiert – Pop-ups erlauben oder die Datei herunterladen"),
        previewWindow,
      );
    } catch (error) {
      previewWindow?.close();
      setActionError(leadErrorMessage(error, tx, tx("Не удалось открыть файл", "Datei konnte nicht geöffnet werden")));
    } finally {
      setBusy(null);
    }
  };
  const download = async (file: IdentityDocumentFile) => {
    setBusy(`download-${file.id}`);
    setActionError("");
    try {
      await downloadDocumentFile(file.id, file.file_name || "document");
    } catch (error) {
      setActionError(leadErrorMessage(error, tx, tx("Не удалось скачать файл", "Datei konnte nicht heruntergeladen werden")));
    } finally {
      setBusy(null);
    }
  };

  const rows = (files: readonly IdentityDocumentFile[]) => (
    <ul className="space-y-1.5">
      {files.map((file) => (
        <FileRow key={file.id} file={file} tx={tx} busy={busy} onOpen={(item) => void open(item)} onDownload={(item) => void download(item)} />
      ))}
    </ul>
  );
  const noFile = <p className="text-xs text-muted-foreground">{tx("Копия документа не загружена", "Keine Ausweiskopie hochgeladen")}</p>;
  const groupBlock = (group: IdentityDocumentGroup) => (
    <div key={group.key} className="space-y-1.5" data-testid={`lead-identity-group-${group.key}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold text-foreground">{group.title}</span>
        {group.subtitle ? <span className="text-xs text-muted-foreground">{group.subtitle}</span> : null}
      </div>
      {group.files.length > 0 ? rows(group.files) : noFile}
      {group.authority.length > 0 ? (
        <>
          <span className="block text-xs text-muted-foreground">{tx("Подтверждение полномочий", "Vertretungsnachweis")}</span>
          {rows(group.authority)}
        </>
      ) : null}
    </div>
  );
  // With the data form, the wrapper renders the lead's and each
  // representative's part itself (data fields and uploads), and lists the files
  // through these; the payer's group stays separate.
  const patientGroup = groups.find((group) => group.kind === "patient");
  const representativeFiles = (person: LeadRepresentative, kind: RepresentativeUploadKind) => {
    const group = groups.find((item) => item.key === `representative-${person.id}`);
    const files = kind === "authority" ? group?.authority : group?.files;
    return files && files.length > 0 ? rows(files) : null;
  };

  return (
    <>
      {title(count)}
      <div className="mt-4 space-y-4" data-testid="lead-identity-documents">
        {state.kind === "loading" ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            {tx("Загрузка документов…", "Dokumente werden geladen…")}
          </p>
        ) : state.kind === "error" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
            <span className="min-w-0 flex-1">{state.message}</span>
            <Button type="button" size="xs" variant="outline" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {tx("Повторить", "Erneut versuchen")}
            </Button>
          </div>
        ) : showDataForm && state.intake && !state.intake.identification_hidden ? (
          <>
            <LeadIdentityDocumentData
              leadId={leadId}
              intake={state.intake}
              tx={tx}
              lang={lang}
              patientScans={patientGroup && patientGroup.files.length > 0 ? rows(patientGroup.files) : noFile}
              patientScanIds={patientGroup?.files.map((file) => file.id) ?? []}
              representativeFiles={representativeFiles}
              onSaved={() => void load()}
            />
            {groups.filter((group) => group.kind === "payer").map(groupBlock)}
          </>
        ) : (
          groups.map(groupBlock)
        )}
        {actionError ? (
          <p role="alert" className={cn("text-xs font-medium text-destructive")}>{actionError}</p>
        ) : null}
      </div>
    </>
  );
}
