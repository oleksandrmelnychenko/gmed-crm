import { AlertTriangle, CheckCircle2, Clock3, FilePlus2, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { uiText, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PaperSignatureConfirmButton } from "@/pages/documents/ui/paper-signature-confirm";

import {
  legalStatusDocumentStateText,
  type LegalStatusEvidenceItem,
  type LegalStatusEvidenceState,
} from "../../model/legal-status";

const STATUS_KEYS: Record<LegalStatusEvidenceState, string> = {
  signed: "patient_legal_doc_status_signed",
  manual: "patient_legal_doc_status_manual",
  revoked: "patient_legal_doc_status_revoked",
  missing: "patient_legal_doc_status_missing",
};

const TONES: Record<LegalStatusEvidenceState, { chip: StatusChipTone; icon: string; text: string }> = {
  signed: {
    chip: "success",
    icon: "bg-emerald-50 text-emerald-700",
    text: "text-muted-foreground",
  },
  manual: {
    chip: "warning",
    icon: "bg-amber-50 text-amber-700",
    text: "font-medium text-amber-700",
  },
  revoked: {
    chip: "error",
    icon: "bg-rose-50 text-rose-700",
    text: "font-medium text-rose-700",
  },
  missing: {
    chip: "warning",
    icon: "bg-amber-50 text-amber-700",
    text: "text-muted-foreground",
  },
};

const ICONS = {
  signed: CheckCircle2,
  manual: AlertTriangle,
  revoked: ShieldOff,
  missing: Clock3,
} satisfies Record<LegalStatusEvidenceState, unknown>;

/**
 * DSGVO consent or the confidentiality release in the "Правовой статус"
 * checklist of the patient card: read-only, its state comes from the signed
 * document (owner decision 2026-10-12). Staff who may edit the card get the
 * paper-signature flow for the newest unsigned document of the kind, or the
 * generator for its template when there is none. An item ticked by hand
 * before is flagged ("Отмечено вручную, подписанный документ отсутствует"); a
 * consent the patient revoked shows the day and that new orders wait for a
 * newly signed consent.
 */
export function LegalStatusDocumentItem({
  kind,
  label,
  evidence,
  lang,
  canAct,
  onCreateDocument,
  onSigned,
}: {
  kind: string;
  label: string;
  evidence: LegalStatusEvidenceItem;
  lang: Lang;
  /** CEO or Patient Manager with edit rights on the card. */
  canAct: boolean;
  onCreateDocument: (templateId: string) => void;
  onSigned: () => void;
}) {
  const text = (key: string, values?: Record<string, string>) => uiText(key, lang, values);
  const { state, pendingDocument } = evidence;
  const tone = TONES[state];
  const Icon = ICONS[state];
  const showActions = canAct && state !== "signed";
  const hintKey = state === "manual"
    ? "patient_legal_doc_manual_hint"
    : state === "revoked"
      ? "patient_legal_doc_revoked_hint"
      : null;

  return (
    <article
      data-testid={`legal-status-document-${kind}`}
      data-state={state}
      className="grid min-w-0 gap-2 border-b border-border/60 bg-card px-4 py-3 last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"
    >
      <div className={cn("hidden size-7 shrink-0 items-center justify-center rounded-md sm:flex", tone.icon)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="break-words text-sm font-medium leading-5 text-foreground">{label}</p>
        <p
          data-testid={`legal-status-document-${kind}-state`}
          className={cn("break-words text-xs leading-5", tone.text)}
        >
          {legalStatusDocumentStateText(evidence, lang)}
        </p>
        {hintKey ? (
          <p className="break-words text-xs leading-5 text-muted-foreground">{text(hintKey)}</p>
        ) : null}
        {showActions && pendingDocument ? (
          <p className="break-words text-xs leading-5 text-muted-foreground">
            {text("patient_legal_doc_to_sign", { name: pendingDocument.name })}
            {pendingDocument.signaturePending ? ` · ${text("patient_legal_doc_signature_pending")}` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
        <StatusChip tone={tone.chip}>
          {text(STATUS_KEYS[state])}
        </StatusChip>
        {showActions && pendingDocument && !pendingDocument.signaturePending ? (
          <PaperSignatureConfirmButton
            documentId={pendingDocument.id}
            title={pendingDocument.name}
            lang={lang}
            label={text("patient_legal_doc_paper_signed")}
            onDone={onSigned}
          />
        ) : null}
        {showActions && !pendingDocument ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid={`legal-status-document-${kind}-create`}
            onClick={() => onCreateDocument(evidence.templateId)}
          >
            <FilePlus2 aria-hidden="true" className="size-3.5" />
            {text("patient_legal_doc_create")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
