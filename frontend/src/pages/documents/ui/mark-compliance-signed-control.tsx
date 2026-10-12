import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { selectClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

import {
  markDocumentSigned,
  type DocumentComplianceKind,
} from "../data/document-api";
import { signatureGateErrorText } from "../data/document-signature-api";
import { signatureNeedsProof } from "../model/signature-proof";
import type { DocumentItem } from "../model/types";
import { PaperSignatureConfirmButton } from "./paper-signature-confirm";

type Bilingual = (ru: string, de: string) => string;

const KINDS: readonly DocumentComplianceKind[] = [
  "dsgvo",
  "confidentiality_release",
  "identity",
  "framework_contract",
  "enhanced_due_diligence",
  "cost_coverage_declaration",
  "other",
];

function kindLabel(kind: DocumentComplianceKind, tx: Bilingual): string {
  switch (kind) {
    case "dsgvo":
      return tx("Согласие на обработку ПДн (DSGVO)", "Datenverarbeitung (DSGVO)");
    case "confidentiality_release":
      return tx("Освобождение от врачебной тайны", "Schweigepflichtentbindung");
    case "identity":
      return tx("Подтверждение личности", "Identitätsnachweis");
    case "framework_contract":
      return tx("Рамочный договор", "Rahmenvertrag");
    case "enhanced_due_diligence":
      return tx("Усиленная AML-проверка", "Verstärkte AML-Sorgfaltsprüfung");
    case "cost_coverage_declaration":
      return tx("Согласие плательщика (Kostenübernahmeerklärung)", "Kostenübernahmeerklärung");
    case "other":
      return tx("Другое", "Sonstiges");
  }
}

/** Template / document type codes → the compliance item they fulfil. */
const KIND_BY_DOCUMENT_CODE: Record<string, DocumentComplianceKind> = {
  privacy_consents: "dsgvo",
  consent_data_release: "dsgvo",
  consent_data_release_child: "dsgvo",
  consent_data_release_single: "dsgvo",
  dsgvo: "dsgvo",
  confidentiality_release: "confidentiality_release",
  schweigepflicht_release: "confidentiality_release",
  framework_contract: "framework_contract",
  enhanced_due_diligence: "enhanced_due_diligence",
  cost_coverage_declaration: "cost_coverage_declaration",
  passport_scan: "identity",
  identity_document: "identity",
  id_card: "identity",
};

/**
 * The compliance item the picker starts with: the document's own (a document
 * already recorded), else the one its template or type fulfils, else DSGVO —
 * a Schweigepflichtentbindung starts with "Schweigepflichtentbindung", not
 * with DSGVO (QA 2026-10-12 B3-10).
 */
export function defaultComplianceKind(
  document?: Partial<Pick<DocumentItem, "compliance_kind" | "generated_template_id" | "art">> | null,
): DocumentComplianceKind {
  const candidates = [document?.compliance_kind, document?.generated_template_id, document?.art];
  for (const candidate of candidates) {
    const code = candidate?.trim().toLowerCase();
    if (!code) continue;
    if ((KINDS as readonly string[]).includes(code) && code !== "other") {
      return code as DocumentComplianceKind;
    }
    const kind = KIND_BY_DOCUMENT_CODE[code];
    if (kind) return kind;
  }
  return "dsgvo";
}

/**
 * Record a document as signed compliance evidence and, atomically on the
 * backend, flip the matching flag on the linked patient's legal_status (#13).
 * Replaces the old two-step "upload a scan" + "tick a checkbox" dance.
 *
 * A document GMED generated for a signature (consents, contract, enhanced
 * due diligence, cost coverage declaration, patient form) counts as signed
 * only with the scan of the signed copy or a QES (owner decisions
 * 2026-10-11): for it the control offers "Подписано на бумаге" instead of the
 * one-click confirmation.
 */
export function MarkComplianceSignedControl({
  documentId,
  patientId,
  document,
  onDone,
}: {
  documentId: string;
  patientId: string | null;
  /** The document's template, signature and name: decides whether proof is needed. */
  document?: Pick<DocumentItem, "generated_template_id" | "signed_at" | "auto_name" | "original_filename">
    & Partial<Pick<DocumentItem, "art" | "compliance_kind">>;
  onDone?: () => void;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [kind, setKind] = useState<DocumentComplianceKind>(() => defaultComplianceKind(document));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const needsProof = Boolean(document && signatureNeedsProof(document, kind));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await markDocumentSigned(documentId, kind);
      setDone(true);
      onDone?.();
    } catch (nextError) {
      setError(
        // A lead gate names its reason (risk assessment, sanctions, blocked country).
        signatureGateErrorText(nextError, tx)
          ?? (nextError instanceof Error
            ? nextError.message
            : tx("Не удалось отметить", "Konnte nicht erfassen")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <h4 className="text-sm font-semibold text-foreground">
        {tx("Подписанный документ (комплаенс)", "Unterzeichnetes Dokument (Compliance)")}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {tx(
          "Зафиксировать как подписанное подтверждение и закрыть требование комплаенса.",
          "Als unterzeichneten Nachweis erfassen und die Compliance-Anforderung erfüllen.",
        )}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <NativeComboboxSelect
          value={kind}
          className={selectClass}
          onChange={(event) => setKind(event.target.value as DocumentComplianceKind)}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {kindLabel(option, tx)}
            </option>
          ))}
        </NativeComboboxSelect>
        {needsProof && !done ? (
          <PaperSignatureConfirmButton
            documentId={documentId}
            title={document?.original_filename || document?.auto_name || ""}
            lang={lang === "de" ? "de" : "ru"}
            size="sm"
            onDone={() => {
              setDone(true);
              onDone?.();
            }}
          />
        ) : (
          <Button type="button" onClick={submit} disabled={busy || done}>
            {done
              ? tx("Отмечено ✓", "Erfasst ✓")
              : tx("Отметить подписанным", "Als unterzeichnet markieren")}
          </Button>
        )}
      </div>
      {needsProof && !done ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="mark-signed-proof-hint">
          {tx(
            "Созданный документ считается подписанным только с подтверждением: загрузите скан подписанного экземпляра или подпишите его электронно.",
            "Ein erstelltes Dokument gilt erst mit Nachweis als unterschrieben: Scan des unterschriebenen Exemplars hochladen oder elektronisch unterschreiben lassen.",
          )}
        </p>
      ) : null}
      {!patientId ? (
        <p className="mt-2 text-xs text-amber-600">
          {tx(
            "Документ не привязан к пациенту — флаг комплаенса не будет установлен.",
            "Nicht mit Patient verknüpft — kein Compliance-Flag wird gesetzt.",
          )}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
