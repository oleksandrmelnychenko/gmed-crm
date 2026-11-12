/**
 * «Дополнительные поля» of the staff lead card and patient card (owner
 * decision 2026-11-12, screens QA item 3): the fields defined in
 * /admin/custom-fields for the entity type, with their values.
 * «Обязательное» is shown as a mark and never blocks saving.
 */
import { apiFetch, clearApiCache } from "@/lib/api";

export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

export interface CustomFieldWithValue {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: CustomFieldType | string;
  options: unknown;
  is_required: boolean;
  sort_order: number;
  value: string | null;
}

export interface CustomFieldValues {
  entity_type: "lead" | "patient" | string;
  can_edit: boolean;
  fields: CustomFieldWithValue[];
}

type Tx = (ru: string, de: string) => string;

function valuesPath(entityId: string) {
  return `/custom-fields/values/${encodeURIComponent(entityId)}`;
}

export function fetchCustomFieldValues(entityId: string) {
  return apiFetch<CustomFieldValues>(valuesPath(entityId), { forceFresh: true });
}

export async function saveCustomFieldValues(
  entityId: string,
  values: { field_id: string; value: string | null }[],
) {
  await apiFetch<{ ok: boolean }>(valuesPath(entityId), {
    method: "POST",
    body: JSON.stringify({ values }),
  });
  clearApiCache(valuesPath(entityId));
}

/** The options of a list field (texts only). */
export function customFieldOptions(field: Pick<CustomFieldWithValue, "options">): string[] {
  return Array.isArray(field.options)
    ? field.options.filter((option): option is string => typeof option === "string")
    : [];
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`; anything else stays as stored. */
export function formatCustomFieldDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

/** The shown value: dates DD.MM.YYYY, checkboxes yes/no, numbers with the language's decimal sign. */
export function formatCustomFieldValue(
  field: Pick<CustomFieldWithValue, "field_type" | "value">,
  tx: Tx,
): string {
  const value = field.value?.trim() ?? "";
  if (!value) return "—";
  switch (field.field_type) {
    case "date":
      return formatCustomFieldDate(value);
    case "boolean":
      return value === "true" ? tx("Да", "Ja") : value === "false" ? tx("Нет", "Nein") : value;
    case "number":
      // Russian and German both write a decimal comma.
      return value.replace(".", ",");
    default:
      return value;
  }
}

/** The values that differ from the loaded ones, in the server's form (empty clears). */
export function changedCustomFieldValues(
  fields: Pick<CustomFieldWithValue, "field_id" | "value">[],
  draft: Record<string, string>,
): { field_id: string; value: string | null }[] {
  return fields.flatMap((field) => {
    if (!(field.field_id in draft)) return [];
    const next = (draft[field.field_id] ?? "").trim();
    const current = (field.value ?? "").trim();
    if (next === current) return [];
    return [{ field_id: field.field_id, value: next === "" ? null : next }];
  });
}

/** The text of a refused save (codes of `routes/custom_fields.rs`). */
export function customFieldErrorText(code: string | undefined, tx: Tx): string {
  switch (code) {
    case "custom_field_value_number_invalid":
      return tx("Введите число, например 12,5.", "Bitte eine Zahl eingeben, z. B. 12,5.");
    case "custom_field_value_date_invalid":
      return tx("Введите дату в формате ДД.ММ.ГГГГ.", "Bitte ein Datum im Format TT.MM.JJJJ eingeben.");
    case "custom_field_value_option_invalid":
      return tx("Выберите значение из списка.", "Bitte einen Wert aus der Liste wählen.");
    case "custom_field_value_boolean_invalid":
      return tx("Недопустимое значение флажка.", "Ungültiger Wert des Kontrollkästchens.");
    case "custom_field_value_too_long":
      return tx("Не больше 2000 символов.", "Höchstens 2000 Zeichen.");
    case "custom_field_not_found":
      return tx(
        "Поле больше не существует. Обновите страницу.",
        "Das Feld existiert nicht mehr. Bitte die Seite neu laden.",
      );
    case "lead_converted":
      return tx(
        "Лид уже переведён в пациенты, его поля больше не меняются.",
        "Der Lead ist bereits Patient, seine Felder werden nicht mehr geändert.",
      );
    default:
      return tx("Не удалось сохранить поля.", "Die Felder konnten nicht gespeichert werden.");
  }
}
