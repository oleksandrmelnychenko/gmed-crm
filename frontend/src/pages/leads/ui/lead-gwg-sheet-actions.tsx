import { FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocumentItem } from "@/pages/documents/model/types";

import {
  currentGwgSheet,
  type GwgSheetButton,
  type GwgSheetPlan,
  type GwgSheetSubject,
} from "../model/gwg-identification";

type Tx = (ru: string, de: string) => string;

/** The wizard's busy key while the sheet of one person is being generated. */
export function gwgSheetBusyKey(subject: GwgSheetSubject): string {
  return `generate-gwg_identification-${subject}`;
}

/** "Сформировать для …" or, once that person has a sheet, "Обновить для …". */
function sheetButtonLabel(button: GwgSheetButton, exists: boolean, tx: Tx): string {
  if (button.subject === "contract_partner") {
    return exists
      ? tx("Обновить для пациента", "Für Patient/in aktualisieren")
      : tx("Сформировать для пациента", "Für Patient/in erstellen");
  }
  if (button.subject === "payer") {
    return exists
      ? tx("Обновить для плательщика", "Für Kostenübernehmer aktualisieren")
      : tx("Для плательщика", "Für Kostenübernehmer erstellen");
  }
  const name = button.personName || tx("представителя", "Vertreter/in");
  return exists
    ? tx(`Обновить для ${name}`, `Für ${name} aktualisieren`)
    : tx(`Сформировать для ${name}`, `Für ${name} erstellen`);
}

/**
 * The buttons that make a GwG identification sheet, in the head of the
 * wizard's sheet section. Adult: the patient's sheet, one for each
 * representative or legal guardian the adult named in the cabinet and, for a
 * third-party payer who is a natural person, the payer's. Minor: one sheet per legal
 * representative and none for the child; a payer who is one of the
 * representatives gets no second sheet. What cannot be made says why.
 */
export function LeadGwgSheetActions({
  plan,
  documents,
  busy,
  disabled,
  tx,
  onGenerate,
}: {
  plan: GwgSheetPlan;
  /** The lead's identification sheets: a person who has one gets "update". */
  documents: readonly DocumentItem[];
  /** The wizard's busy key. */
  busy: string | null;
  disabled: boolean;
  tx: Tx;
  onGenerate: (button: GwgSheetButton) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="gwg-identification-actions">
      {plan.lacksRepresentative ? (
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="gwg-identification-no-representative">
          {tx(
            "Добавьте родителя или законного представителя",
            "Bitte einen Elternteil oder eine gesetzliche Vertreterin / einen gesetzlichen Vertreter hinzufügen",
          )}
        </span>
      ) : null}
      {plan.buttons.map((button) => (
        <Button
          key={button.subject}
          type="button"
          variant={button.subject === "payer" ? "outline" : "default"}
          size="sm"
          className="h-8 max-w-full rounded-lg"
          disabled={disabled}
          data-testid={`gwg-identification-generate-${button.subject}`}
          onClick={() => onGenerate(button)}
        >
          {busy === gwgSheetBusyKey(button.subject)
            ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            : <FileText className="size-3.5 shrink-0" />}
          <span className="truncate">
            {sheetButtonLabel(button, Boolean(currentGwgSheet(documents, button.subject)), tx)}
          </span>
        </Button>
      ))}
      {plan.payerIsOrganisation ? (
        <span className="self-center text-xs text-muted-foreground" data-testid="gwg-identification-payer-organisation">
          {tx(
            "Для организации лист для физических лиц не формируется",
            "Für Organisationen wird der Bogen für natürliche Personen nicht erstellt",
          )}
        </span>
      ) : null}
      {plan.payerSamePersonName !== null ? (
        <span className="self-center text-xs text-muted-foreground" data-testid="gwg-identification-payer-same-person">
          {tx(
            `отдельный лист не нужен: плательщик — представитель ${plan.payerSamePersonName || "без имени"}`,
            `kein eigener Bogen nötig: Kostenträger ist Vertreter/in ${plan.payerSamePersonName || "ohne Namen"}`,
          )}
        </span>
      ) : null}
    </span>
  );
}
