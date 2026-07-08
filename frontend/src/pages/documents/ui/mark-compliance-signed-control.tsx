import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { selectClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

import {
  markDocumentSigned,
  type DocumentComplianceKind,
} from "../data/document-api";

type Bilingual = (ru: string, de: string) => string;

const KINDS: readonly DocumentComplianceKind[] = [
  "dsgvo",
  "confidentiality_release",
  "identity",
  "framework_contract",
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
    case "other":
      return tx("Другое", "Sonstiges");
  }
}

/**
 * Record a document as signed compliance evidence and, atomically on the
 * backend, flip the matching flag on the linked patient's legal_status (#13).
 * Replaces the old two-step "upload a scan" + "tick a checkbox" dance.
 */
export function MarkComplianceSignedControl({
  documentId,
  patientId,
  onDone,
}: {
  documentId: string;
  patientId: string | null;
  onDone?: () => void;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [kind, setKind] = useState<DocumentComplianceKind>("dsgvo");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await markDocumentSigned(documentId, kind);
      setDone(true);
      onDone?.();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось отметить", "Konnte nicht erfassen"),
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
        <Button type="button" onClick={submit} disabled={busy || done}>
          {done
            ? tx("Отмечено ✓", "Erfasst ✓")
            : tx("Отметить подписанным", "Als unterzeichnet markieren")}
        </Button>
      </div>
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
