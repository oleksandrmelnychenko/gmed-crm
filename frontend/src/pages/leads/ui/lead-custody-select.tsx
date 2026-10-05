import { useState } from "react";

import { selectClass, tokens } from "@/components/ui-shell";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  LEAD_CUSTODY_VALUES,
  type LeadCustody,
  type LeadRepresentation,
} from "../data/lead-portal-intake-api";
import { setLeadCustody } from "../data/lead-representation-api";
import { custodyLabel, type Tx } from "../model/lead-gwg-statements";

/**
 * "Кто представляет ребёнка" in the wizard section of a minor's parents: both
 * parents, one parent alone, or a guardian. The parent states it in the
 * cabinet and staff may state it here; the last change stands. It is saved at
 * once (it is not part of the wizard draft) and removes nobody: how many
 * representatives the cabinet asks for follows from it.
 */
export function LeadCustodySelect({
  leadId,
  representation,
  disabled,
  tx,
  errorText,
  beforeSave,
  onSaved,
}: {
  leadId: string;
  /** Who represents the lead as the server last answered it. */
  representation: Pick<LeadRepresentation, "custody" | "custody_stated">;
  disabled: boolean;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** Runs before the custody is sent (the wizard saves the date of birth first); false cancels. */
  beforeSave?: () => Promise<boolean>;
  /** The representation the server answered with; null when the answer was not one. */
  onSaved: (representation: LeadRepresentation | null) => void;
}) {
  const [saving, setSaving] = useState<LeadCustody | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const stated = representation.custody_stated && representation.custody !== null;
  const value = saving ?? (stated ? representation.custody ?? "" : "");
  const label = tx("Кто представляет ребёнка", "Wer vertritt das Kind");

  async function change(next: LeadCustody) {
    setSaving(next);
    setErrorMessage("");
    try {
      if (beforeSave && !(await beforeSave())) return;
      onSaved(await setLeadCustody(leadId, next));
    } catch (error) {
      // The only thing the server refuses here is a lead who is not a minor.
      setErrorMessage(
        error instanceof ApiRequestError && error.status === 422
          ? tx(
              "Кто представляет ребёнка, указывается только для несовершеннолетнего. Проверьте дату рождения",
              "Wer das Kind vertritt, wird nur für Minderjährige angegeben. Bitte das Geburtsdatum prüfen",
            )
          : errorText(error),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-md space-y-1.5" data-testid="lead-custody">
      <label className="block space-y-1.5">
        <span className={cn(tokens.text.label, "block")}>{label}</span>
        <NativeComboboxSelect
          value={value}
          className={selectClass}
          disabled={disabled || saving !== null}
          aria-label={label}
          onChange={(event) => {
            const next = LEAD_CUSTODY_VALUES.find((item) => item === event.target.value);
            if (next && next !== value) void change(next);
          }}
        >
          {/* Without an answer both parents represent the child. */}
          {stated ? null : <option value="">{tx("Не указано — оба родителя", "Nicht angegeben – beide Eltern")}</option>}
          {LEAD_CUSTODY_VALUES.map((item) => (
            <option key={item} value={item}>{custodyLabel(item, tx)}</option>
          ))}
        </NativeComboboxSelect>
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          "Указывает родитель в кабинете или сотрудник здесь — действует последнее изменение. От ответа зависит, данные скольких представителей запрашивает кабинет.",
          "Gibt der Elternteil im Portal oder GMED hier an – es gilt die letzte Änderung. Davon hängt ab, für wie viele Vertreter das Portal die Angaben abfragt.",
        )}
      </p>
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive" data-testid="lead-custody-error">{errorMessage}</p>
      ) : null}
    </div>
  );
}
