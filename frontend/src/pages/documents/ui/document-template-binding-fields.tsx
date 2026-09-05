import { Check, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { ServiceDescriptionEditor } from "@/components/service-description-editor";
import { serviceDescriptionText, type ServiceDescriptionItem } from "@/lib/service-description";
import { cn } from "@/lib/utils";
import {
  documentBindingFieldLabel,
  parseBindingServiceLines,
  type BindingFieldDef,
  type DocumentBindingForm,
} from "@/pages/documents/model/document-bindings";
import { EnhancedDueDiligenceBindingFields } from "@/pages/documents/ui/enhanced-due-diligence-binding-fields";

type BindingGroup =
  | "document"
  | "consents"
  | "patient"
  | "payer"
  | "bank"
  | "signatures";

let serviceLineKeySequence = 0;

/** Stable client-side key: index keys lose input state when a middle row is removed. */
function nextServiceLineKey(): string {
  serviceLineKeySequence += 1;
  return `line-${serviceLineKeySequence}`;
}

function emptyServiceLine(): ServiceLineDraft {
  return { formKey: nextServiceLineKey(), description: "", fee: "", quantity: "", lineTotal: "", note: "" };
}

type ServiceLineDraft = {
  formKey: string;
  description: string;
  fee: string;
  quantity: string;
  lineTotal: string;
  note: string;
  descriptionItems?: ServiceDescriptionItem[];
  vatRate?: string;
};

const inputClassName =
  "h-9 w-full rounded-md border border-border bg-field px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const labelClassName =
  "mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground";

function bindingGroup(field: BindingFieldDef): BindingGroup {
  if (field.key.startsWith("bank_")) return "bank";
  if (field.key.includes("_sign_") || field.key === "sign_place" || field.key === "sign_date") {
    return "signatures";
  }
  if (field.key.startsWith("payer_")) return "payer";
  if (field.key.startsWith("party_")) return "patient";
  if (field.key.startsWith("consent_") || field.key === "extra_release_recipients") {
    return "consents";
  }
  return "document";
}

function groupLabel(group: BindingGroup, lang: "de" | "ru") {
  const labels: Record<BindingGroup, [string, string]> = {
    document: ["Данные документа", "Dokumentdaten"],
    consents: ["Согласия и получатели данных", "Einwilligungen und Datenempfänger"],
    patient: ["Данные клиента", "Kundendaten"],
    payer: ["Плательщик", "Kostenübernehmer"],
    bank: ["Банковские реквизиты", "Bankverbindung"],
    signatures: ["Подписи", "Unterschriften"],
  };
  return labels[group][lang === "de" ? 1 : 0];
}

function parseServiceLines(value: string, templateId: string): ServiceLineDraft[] {
  return parseBindingServiceLines(value, templateId).map((line) => ({
    formKey: nextServiceLineKey(), description: line.description,
    fee: (templateId === "cost_estimate" ? line.line_total : line.fee) ?? "",
    quantity: line.quantity ?? "", lineTotal: line.line_total ?? "", note: line.note ?? "",
    descriptionItems: line.description_items, vatRate: line.vat_rate,
  }));
}

function serializeServiceLines(lines: ServiceLineDraft[], templateId: string) {
  return JSON.stringify(lines.map((line) => ({
    description: line.description,
    fee: templateId === "cost_estimate" ? undefined : line.fee,
    quantity: line.quantity,
    line_total: templateId === "cost_estimate" ? line.fee : line.lineTotal,
    note: line.note, description_items: line.descriptionItems, vat_rate: line.vatRate,
  })));
}

function ServiceLinesEditor({
  lang,
  templateId,
  value,
  onChange,
}: {
  lang: "de" | "ru";
  templateId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const compact = templateId === "cost_estimate";
  const [lines, setLines] = useState<ServiceLineDraft[]>(() => {
    const parsedLines = parseServiceLines(value, templateId);
    return parsedLines.length > 0
      ? parsedLines
      : [emptyServiceLine()];
  });

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLines((current) => {
        if (serializeServiceLines(current, templateId) === value.trim()) return current;
        const parsedLines = parseServiceLines(value, templateId);
        return parsedLines.length > 0
          ? parsedLines
          : [emptyServiceLine()];
      });
    });
    return () => {
      active = false;
    };
  }, [value, templateId]);

  function updateLine(index: number, patch: Partial<ServiceLineDraft>) {
    const nextLines = lines.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...patch } : line,
    );
    setLines(nextLines);
    onChange(serializeServiceLines(nextLines, templateId));
  }

  function addLine() {
    setLines((current) => [...current, emptyServiceLine()]);
  }

  function removeLine(index: number) {
    const nextLines = lines.filter((_, lineIndex) => lineIndex !== index);
    const normalizedLines = nextLines.length > 0 ? nextLines : [emptyServiceLine()];
    setLines(normalizedLines);
    onChange(serializeServiceLines(normalizedLines, templateId));
  }

  return (
    <div className="space-y-2 md:col-span-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className={cn("w-full border-collapse text-sm", compact ? "min-w-[520px]" : "min-w-[880px]")}>
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                {lang === "de" ? "Leistung" : "Услуга"}
              </th>
              <th className="w-40 px-3 py-2 text-left font-medium">
                {lang === "de" ? (compact ? "Preis / Spanne" : "Honorar") : (compact ? "Цена / диапазон" : "Стоимость")}
              </th>
              {!compact ? (
                <>
                  <th className="w-24 px-3 py-2 text-left font-medium">
                    {lang === "de" ? "Menge" : "Кол-во"}
                  </th>
                  <th className="w-36 px-3 py-2 text-left font-medium">
                    {lang === "de" ? "Summe" : "Сумма"}
                  </th>
                  <th className="w-48 px-3 py-2 text-left font-medium">
                    {lang === "de" ? "Anmerkung" : "Комментарий"}
                  </th>
                </>
              ) : null}
              <th className="w-10 px-1 py-2">
                <span className="sr-only">{lang === "de" ? "Aktionen" : "Действия"}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {lines.map((line, index) => (
              <Fragment key={line.formKey}>
              <tr>
                <td className="p-2">
                  <Input
                    aria-label={lang === "de" ? "Leistung" : "Услуга"}
                    value={line.description}
                    onChange={(event) => updateLine(index, { description: event.target.value })}
                    className={inputClassName}
                  />
                </td>
                <td className="p-2">
                  <Input
                    aria-label={lang === "de" ? "Preis" : "Цена"}
                    value={line.fee}
                    onChange={(event) => updateLine(index, { fee: event.target.value })}
                    className={cn(inputClassName, "font-mono tabular-nums")}
                  />
                </td>
                {!compact ? (
                  <>
                    <td className="p-2">
                      <Input
                        aria-label={lang === "de" ? "Menge" : "Количество"}
                        value={line.quantity}
                        onChange={(event) => updateLine(index, { quantity: event.target.value })}
                        className={cn(inputClassName, "font-mono tabular-nums")}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        aria-label={lang === "de" ? "Summe" : "Сумма"}
                        value={line.lineTotal}
                        onChange={(event) => updateLine(index, { lineTotal: event.target.value })}
                        className={cn(inputClassName, "font-mono tabular-nums")}
                      />
                    </td>
                    <td className="p-2">
                      {line.descriptionItems ? (
                        <span className="text-xs text-muted-foreground">
                          {line.descriptionItems.length} {lang === "de" ? "Beschreibungspunkte" : "пунктов описания"}
                        </span>
                      ) : <Input
                        aria-label={lang === "de" ? "Anmerkung" : "Комментарий"}
                        value={line.note}
                        onChange={(event) => updateLine(index, { note: event.target.value })}
                        className={inputClassName}
                      />}
                    </td>
                  </>
                ) : null}
                <td className="p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    title={lang === "de" ? "Zeile löschen" : "Удалить строку"}
                    aria-label={lang === "de" ? "Zeile löschen" : "Удалить строку"}
                    onClick={() => removeLine(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
              {line.descriptionItems ? (
                <tr><td colSpan={compact ? 3 : 6} className="p-3">
                  <ServiceDescriptionEditor items={line.descriptionItems} lang={lang}
                    onChange={(descriptionItems) => updateLine(index, {
                      descriptionItems, note: serviceDescriptionText(descriptionItems),
                    })} />
                </td></tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addLine}>
        <Plus className="size-3.5" />
        {lang === "de" ? "Leistung hinzufügen" : "Добавить услугу"}
      </Button>
    </div>
  );
}

function BindingControl({
  field,
  lang,
  templateId,
  value,
  onChange,
}: {
  field: BindingFieldDef;
  lang: "de" | "ru";
  templateId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = documentBindingFieldLabel(field, lang);

  if (field.key === "service_lines_text") {
    return (
      <ServiceLinesEditor
        lang={lang}
        templateId={templateId}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.kind === "boolean") {
    return (
      <label className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-border py-3 last:border-b-0 md:col-span-2">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(event) => onChange(String(event.target.checked))}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        />
        <span className="min-w-0 text-sm leading-5 text-foreground">{label}</span>
      </label>
    );
  }

  const moneyField = ["cost_threshold", "estimate_total"].includes(field.key);

  return (
    <label className={cn("block min-w-0", field.kind === "textarea" && "md:col-span-2")}>
      <span className={labelClassName}>{label}</span>
      {field.kind === "country" ? (
        <CountrySelect
          value={value || null}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          lang="de"
          className={inputClassName}
          aria-label={label}
        />
      ) : field.kind === "textarea" ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClassName, "min-h-24 resize-y py-2 text-slate-900")}
        />
      ) : (
        <Input
          type={
            field.kind === "date"
              ? "date"
              : field.kind === "number"
                ? "number"
                : "text"
          }
          min={field.kind === "number" ? 1 : undefined}
          step={field.kind === "number" ? 1 : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClassName, moneyField && "font-mono tabular-nums")}
        />
      )}
    </label>
  );
}

export function DocumentTemplateBindingFields({
  fields,
  bindings,
  lang,
  templateId,
  useOrderServices = false,
  onChange,
}: {
  fields: BindingFieldDef[];
  bindings: DocumentBindingForm;
  lang: "de" | "ru";
  templateId: string;
  useOrderServices?: boolean;
  onChange: (key: string, value: string) => void;
}) {
  if (templateId === "enhanced_due_diligence") {
    return (
      <EnhancedDueDiligenceBindingFields
        bindings={bindings}
        lang={lang}
        onChange={onChange}
      />
    );
  }

  const groupedFields = fields.reduce(
    (groups, field) => {
      const group = bindingGroup(field);
      groups[group].push(field);
      return groups;
    },
    {
      document: [],
      consents: [],
      patient: [],
      payer: [],
      bank: [],
      signatures: [],
    } as Record<BindingGroup, BindingFieldDef[]>,
  );

  return (
    <div>
      {(Object.keys(groupedFields) as BindingGroup[]).map((group) => {
        const groupFields = groupedFields[group];
        if (groupFields.length === 0) return null;
        return (
          <section key={group} className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
            <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
              {groupLabel(group, lang)}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {groupFields.map((field) => {
                if (
                  templateId === "privacy_consents" &&
                  field.kind === "boolean"
                ) {
                  return null;
                }
                if (
                  useOrderServices &&
                  field.key === "estimate_total"
                ) {
                  return null;
                }
                if (field.key === "service_lines_text" && useOrderServices) {
                  return (
                    <div
                      key={field.key}
                      className="flex items-start gap-2 border-y border-border bg-muted/30 px-3 py-3 text-sm md:col-span-2"
                    >
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                      <span>
                        {lang === "de"
                          ? "Leistungen, Mengen, Preise und MwSt. werden aus dem ausgewählten Auftrag und Kostenvoranschlag übernommen."
                          : "Услуги, количество, цены и НДС будут взяты из выбранного заказа и сметы."}
                      </span>
                    </div>
                  );
                }
                return (
                  <BindingControl
                    key={field.key}
                    field={field}
                    lang={lang}
                    templateId={templateId}
                    value={bindings[field.key] ?? ""}
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
