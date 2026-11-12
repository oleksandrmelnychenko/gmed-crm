import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  changedCustomFieldValues,
  customFieldErrorText,
  customFieldOptions,
  fetchCustomFieldValues,
  formatCustomFieldValue,
  saveCustomFieldValues,
  type CustomFieldValues,
  type CustomFieldWithValue,
} from "./custom-fields-model";

type LoadState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error" }
  | { kind: "ready"; data: CustomFieldValues };

type SaveError = { message: string; fieldId: string | null };

interface CustomFieldsSectionProps {
  /** Lead id or patient id; the server resolves which. */
  entityId: string;
  /** A card that is frozen here (converted, out of work, restricted): read only. */
  locked?: boolean;
  className?: string;
  /** The heading in the card's own style. */
  renderTitle?: (title: string) => ReactNode;
}

/**
 * «Дополнительные поля» of the staff lead card and patient card (owner
 * decision 2026-11-12, screens QA item 3). Shows every field defined in
 * /admin/custom-fields for the entity type with its value; a role the server
 * lets edit the card (`can_edit`) edits them here. «Обязательное» is a mark,
 * saving is never blocked by it. Nothing is shown when no field is defined
 * or the server refuses the values. Never used in client cabinets.
 */
export function CustomFieldsSection({ entityId, locked = false, className, renderTitle }: CustomFieldsSectionProps) {
  const { lang } = useLang();
  const tx = useCallback((ru: string, de: string) => (lang === "de" ? de : ru), [lang]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCustomFieldValues(entityId);
      // An older server answered with a bare list: nothing to show.
      setState(data && Array.isArray(data.fields) ? { kind: "ready", data } : { kind: "hidden" });
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : undefined;
      setState({ kind: status === 403 || status === 404 ? "hidden" : "error" });
    }
  }, [entityId]);

  useEffect(() => {
    setState({ kind: "loading" });
    setEditing(false);
    setSaveError(null);
    void load();
  }, [load]);

  if (state.kind === "hidden" || state.kind === "loading") return null;

  const title = tx("Дополнительные поля", "Zusätzliche Felder");
  const heading = renderTitle ? renderTitle(title) : (
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
  );

  if (state.kind === "error") {
    return (
      <section className={className} data-testid="custom-fields-section">
        {heading}
        <p className="mt-3 text-sm text-muted-foreground">
          {tx("Не удалось загрузить дополнительные поля.", "Die zusätzlichen Felder konnten nicht geladen werden.")}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            {tx("Повторить", "Erneut versuchen")}
          </button>
        </p>
      </section>
    );
  }

  const { fields } = state.data;
  if (fields.length === 0) return null;
  const mayEdit = state.data.can_edit && !locked;
  const hasRequired = fields.some((field) => field.is_required);

  const startEditing = () => {
    setDraft(
      Object.fromEntries(
        fields.map((field) => [
          field.field_id,
          field.field_type === "number" ? (field.value ?? "").replace(".", ",") : field.value ?? "",
        ]),
      ),
    );
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    // A number shown with a comma is the same value as the stored one with a dot.
    const comparable = Object.fromEntries(
      fields.map((field) => {
        const raw = draft[field.field_id] ?? "";
        return [field.field_id, field.field_type === "number" ? raw.trim().replace(",", ".") : raw];
      }),
    );
    const changes = changedCustomFieldValues(fields, comparable);
    if (changes.length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveCustomFieldValues(entityId, changes);
      setEditing(false);
      await load();
    } catch (error) {
      const apiError = error instanceof ApiRequestError ? error : null;
      const fieldId = typeof apiError?.body?.field_id === "string" ? apiError.body.field_id : null;
      const message = apiError?.status === 423
        ? tx(
          "Обработка данных пациента ограничена: поля сейчас не меняются.",
          "Die Verarbeitung der Patientendaten ist eingeschränkt: die Felder können jetzt nicht geändert werden.",
        )
        : apiError?.status === 403
          ? tx("Нет прав на изменение этих полей.", "Keine Berechtigung, diese Felder zu ändern.")
          : customFieldErrorText(apiError?.code, tx);
      setSaveError({ message, fieldId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={className} data-testid="custom-fields-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        {mayEdit && !editing ? (
          <Button type="button" size="sm" variant="outline" onClick={startEditing} data-testid="custom-fields-edit">
            <SquarePen aria-hidden="true" className="size-3.5" />
            {tx("Изменить", "Bearbeiten")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {fields.map((field) => (
              <CustomFieldInput
                key={field.field_id}
                field={field}
                value={draft[field.field_id] ?? ""}
                invalid={saveError?.fieldId === field.field_id}
                disabled={saving}
                tx={tx}
                onChange={(value) => setDraft((current) => ({ ...current, [field.field_id]: value }))}
              />
            ))}
          </div>
          {hasRequired ? (
            <p className="text-xs text-muted-foreground">
              {tx(
                "* — обязательное поле; сохранить можно и без него.",
                "* — Pflichtfeld; speichern geht auch ohne.",
              )}
            </p>
          ) : null}
          {saveError ? (
            <p role="alert" className="text-sm text-rose-700">{saveError.message}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving} data-testid="custom-fields-save">
              {saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              {tx("Сохранить", "Speichern")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setSaveError(null);
              }}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid gap-x-8 gap-y-2 md:grid-cols-2">
          {fields.map((field) => (
            <div key={field.field_id} className="min-w-0" data-testid={`custom-field-${field.field_key}`}>
              <dt className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {field.field_label}
                <RequiredMark field={field} tx={tx} />
              </dt>
              <dd className="text-sm text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
                {formatCustomFieldValue(field, tx)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function RequiredMark({ field, tx }: { field: CustomFieldWithValue; tx: (ru: string, de: string) => string }) {
  if (!field.is_required) return null;
  const label = tx("Обязательное", "Pflichtfeld");
  return (
    <span className="ml-0.5 text-rose-600" title={label} aria-label={label}>
      *
    </span>
  );
}

function CustomFieldInput({
  field,
  value,
  invalid,
  disabled,
  tx,
  onChange,
}: {
  field: CustomFieldWithValue;
  value: string;
  invalid: boolean;
  disabled: boolean;
  tx: (ru: string, de: string) => string;
  onChange: (value: string) => void;
}) {
  const id = `custom-field-input-${field.field_id}`;
  const label = (
    <label htmlFor={id} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
      {field.field_label}
      <RequiredMark field={field} tx={tx} />
    </label>
  );

  if (field.field_type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-foreground" data-testid={`custom-field-input-${field.field_key}`}>
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-primary"
          checked={value === "true"}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.checked ? "true" : "false")}
        />
        <span className="[overflow-wrap:anywhere]">
          {field.field_label}
          <RequiredMark field={field} tx={tx} />
        </span>
      </label>
    );
  }

  if (field.field_type === "select") {
    const options = customFieldOptions(field);
    // A value whose option was removed later stays selectable as it is.
    const shown = value && !options.includes(value) ? [value, ...options] : options;
    return (
      <div className="space-y-1" data-testid={`custom-field-input-${field.field_key}`}>
        {label}
        <NativeComboboxSelect
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value ?? "")}
          className="h-9 w-full rounded-lg bg-field"
        >
          <option value="">—</option>
          {shown.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </NativeComboboxSelect>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid={`custom-field-input-${field.field_key}`}>
      {label}
      <Input
        id={id}
        type={field.field_type === "date" ? "date" : "text"}
        inputMode={field.field_type === "number" ? "decimal" : undefined}
        maxLength={field.field_type === "text" ? 2000 : undefined}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn("h-9 rounded-lg bg-field", invalid && "border-rose-500")}
      />
    </div>
  );
}
