import { NativeComboboxSelect } from "@/components/ui/combobox-select";

import {
  ALLERGY_SEVERITIES,
  allergySeverityCode,
  allergySeverityLabel,
} from "../../model/allergy-severity";

/**
 * The severity of an allergy as a fixed choice (QA 2026-10-12 B3-03): the
 * code is stored, the label follows the UI language and every document prints
 * it in its own language. A free text of an older entry stays selectable as
 * it was entered until someone picks a value.
 */
export function AllergySeveritySelect({
  value,
  lang,
  className,
  onChange,
}: {
  value: string | null | undefined;
  lang: "ru" | "de";
  className?: string;
  onChange: (next: string | null) => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const code = allergySeverityCode(value);
  const legacy = !code && value?.trim() ? value.trim() : null;
  return (
    <NativeComboboxSelect
      value={code ?? legacy ?? ""}
      aria-label={tx("Тяжесть", "Schweregrad")}
      className={className}
      onChange={(event) => onChange(event.target.value ? event.target.value : null)}
    >
      <option value="">{tx("— не указана —", "— nicht angegeben —")}</option>
      {ALLERGY_SEVERITIES.map((severity) => (
        <option key={severity} value={severity}>
          {allergySeverityLabel(severity, lang)}
        </option>
      ))}
      {legacy ? (
        <option value={legacy}>
          {legacy} ({tx("прежняя запись", "bisheriger Eintrag")})
        </option>
      ) : null}
    </NativeComboboxSelect>
  );
}
