import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClinicalDocumentImportTarget } from "../../data/clinical-document-import";
import {
  constructorFieldSpecs,
  missingConstructorFields,
  type ConstructorFields,
} from "../../data/clinical-import-constructor";

const controlClass =
  "w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 aria-[invalid=true]:border-destructive";

export function ClinicalImportConstructorForm({
  target,
  targetLabel,
  initialFields,
  sourceText,
  sourcePage,
  lang,
  onSubmit,
  onCancel,
}: {
  target: ClinicalDocumentImportTarget;
  targetLabel: string;
  initialFields: ConstructorFields;
  sourceText: string;
  sourcePage: number | null;
  lang: string;
  onSubmit: (fields: ConstructorFields) => void;
  onCancel: () => void;
}) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [fields, setFields] = useState<ConstructorFields>(initialFields);
  const [showMissing, setShowMissing] = useState(false);
  const missing = missingConstructorFields(target, fields);
  const specs = constructorFieldSpecs[target];
  const wide = (kind: string) => kind === "textarea";

  function submit() {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    onSubmit(fields);
  }

  return (
    <form
      data-clinical-import-constructor-form={target}
      className="space-y-4 rounded-xl border border-orange-200 bg-orange-50/30 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h5 className="text-sm font-semibold">{tx(`Новый блок: ${targetLabel}`, `Neuer Block: ${targetLabel}`)}</h5>
          {sourceText.trim() ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {sourcePage ? tx(`Из страницы ${sourcePage}: `, `Aus Seite ${sourcePage}: `) : tx("Из документа: ", "Aus dem Dokument: ")}
              «{sourceText.trim()}»
            </p>
          ) : null}
        </div>
        <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" onClick={onCancel} aria-label={tx("Отмена", "Abbrechen")}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {specs.map((spec, index) => {
          const value = fields[spec.key] ?? "";
          const invalid = showMissing && missing.includes(spec.key);
          const label = spec.label[de ? "de" : "ru"];
          const placeholder = spec.placeholder?.[de ? "de" : "ru"];
          const update = (next: string) => setFields((current) => ({ ...current, [spec.key]: next }));
          return (
            <label key={spec.key} className={cn("space-y-1", wide(spec.kind) && "sm:col-span-2")}>
              <span className="text-xs font-medium">
                {label}
                {spec.required ? <span className="text-destructive"> *</span> : null}
              </span>
              {spec.kind === "textarea" ? (
                <textarea
                  autoFocus={index === 0}
                  value={value}
                  aria-invalid={invalid}
                  placeholder={placeholder}
                  className={cn(controlClass, "min-h-24 resize-y py-2 leading-6")}
                  onChange={(event) => update(event.target.value)}
                />
              ) : spec.kind === "select" ? (
                <select value={value} aria-invalid={invalid} className={cn(controlClass, "h-10")} onChange={(event) => update(event.target.value)}>
                  {spec.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label[de ? "de" : "ru"]}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  autoFocus={index === 0}
                  type={spec.kind === "date" ? "date" : "text"}
                  inputMode={spec.kind === "number" ? "decimal" : undefined}
                  value={value}
                  aria-invalid={invalid}
                  placeholder={placeholder}
                  className={cn(controlClass, "h-10")}
                  onChange={(event) => update(event.target.value)}
                />
              )}
            </label>
          );
        })}
      </div>

      {showMissing && missing.length > 0 ? (
        <p role="alert" className="text-xs text-destructive">
          {target === "vital" && missing.includes("bp_systolic")
            ? tx("Укажите дату и хотя бы один показатель.", "Datum und mindestens einen Messwert angeben.")
            : tx("Заполните обязательные поля.", "Pflichtfelder ausfüllen.")}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-9" onClick={onCancel}>
          {tx("Отмена", "Abbrechen")}
        </Button>
        <Button type="submit" className="h-9 gap-1.5">
          <Plus className="size-4" />
          {tx("Добавить в черновик", "Zum Entwurf hinzufügen")}
        </Button>
      </div>
    </form>
  );
}
