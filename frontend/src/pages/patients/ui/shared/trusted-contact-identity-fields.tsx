import { useId } from "react";

import { CitizenshipMultiSelect, citizenshipFieldLabel } from "@/components/ui/citizenship-multi-select";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui-shell";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { PatientTrustedContactFormState } from "../../model/list-model";

/**
 * Date of birth and citizenships of a contact or representative who is not a patient record
 * (client decision 2026-11-02: several citizenships wherever a person has identity data). Saved on
 * the relation; a minor's parent or guardian is screened with them.
 */
export function TrustedContactIdentityFields({
  contact,
  lang,
  disabled = false,
  inputClassName,
  onChange,
}: {
  contact: PatientTrustedContactFormState;
  lang: string;
  disabled?: boolean;
  inputClassName?: string;
  onChange: (patch: Partial<PatientTrustedContactFormState>) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <Field label={tx("Дата рождения", "Geburtsdatum")} htmlFor={`trusted-birth-${id}`}>
        <Input
          id={`trusted-birth-${id}`}
          type="date"
          max={appDateKey()}
          value={contact.birthDate ?? ""}
          onChange={(event) => onChange({ birthDate: event.target.value })}
          className={inputClassName}
          disabled={disabled}
        />
      </Field>
      <div className="md:col-span-2">
        <Field label={citizenshipFieldLabel(lang)} htmlFor={`trusted-citizenships-${id}`}>
          <CitizenshipMultiSelect
            id={`trusted-citizenships-${id}`}
            value={contact.citizenships ?? []}
            onChange={(citizenships) => onChange({ citizenships })}
            lang={lang}
            disabled={disabled}
            className={cn("w-full", inputClassName)}
          />
        </Field>
      </div>
    </div>
  );
}
