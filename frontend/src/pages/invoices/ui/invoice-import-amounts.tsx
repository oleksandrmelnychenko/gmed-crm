import { Field } from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import { applyInvoiceVatCalculation, invoiceVatRate, validInvoiceVatRate, type InvoiceVatCalculation } from "../model/import-amounts";
import { importMoneyCents, type InvoiceImportFields, type InvoiceImportPreview } from "../model/import-model";

export function InvoiceImportAmounts({ fields, labels, calculation, preview, disabled, onChange }: {
  fields: InvoiceImportFields;
  labels: Record<keyof InvoiceImportFields, string>;
  calculation: InvoiceVatCalculation;
  preview: InvoiceImportPreview | null;
  disabled: boolean;
  onChange: (fields: InvoiceImportFields, calculation: InvoiceVatCalculation) => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const automatic = calculation.selection !== "manual";
  const rateValid = !automatic || validInvoiceVatRate(invoiceVatRate(calculation));

  function changeCalculation(next: InvoiceVatCalculation) {
    onChange(applyInvoiceVatCalculation(fields, next), next);
  }

  function changeAmount(key: "amount_net" | "amount_vat" | "amount_gross", value: string) {
    const next = { ...calculation, base: key === "amount_vat" ? calculation.base : key };
    onChange(applyInvoiceVatCalculation({ ...fields, [key]: value }, next), next);
  }

  return <fieldset disabled={disabled} className="space-y-3 border-t border-border/70 pt-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={labels.currency}>
        <Input aria-label={labels.currency} required value={fields.currency} maxLength={3}
          onChange={event => onChange({ ...fields, currency: event.target.value.toUpperCase() }, calculation)} />
      </Field>
      <Field label={tx("Ставка НДС", "Umsatzsteuersatz")}>
        <NativeComboboxSelect aria-label={tx("Ставка НДС", "Umsatzsteuersatz")} disabled={disabled} value={calculation.selection}
          onChange={event => {
            const base = importMoneyCents(fields[calculation.base]) !== null ? calculation.base
              : importMoneyCents(fields.amount_net) !== null ? "amount_net" : "amount_gross";
            changeCalculation({ ...calculation, base, selection: event.target.value as InvoiceVatCalculation["selection"] });
          }}>
          <option value="manual">{tx("По документу / вручную", "Laut Dokument / manuell")}</option>
          <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option>
          <option value="custom">{tx("Другая ставка", "Anderer Steuersatz")}</option>
        </NativeComboboxSelect>
        {calculation.selection === "custom" ? <Input aria-label={tx("Другая ставка НДС, %", "Anderer Umsatzsteuersatz, %")} inputMode="decimal" required
          aria-invalid={!rateValid} value={calculation.customRate} maxLength={8} placeholder="%"
          onChange={event => changeCalculation({ ...calculation, customRate: event.target.value })} /> : null}
      </Field>
    </div>
    <p className={`text-xs leading-5 ${rateValid ? "text-muted-foreground" : "text-destructive"}`}>
      {!rateValid ? tx("Укажите ставку НДС от 0 до 100 %.", "Umsatzsteuersatz von 0 bis 100 % angeben.")
        : automatic ? tx("Введите сумму без НДС или итог с НДС — остальные суммы рассчитаются автоматически.", "Netto- oder Bruttobetrag eingeben — die übrigen Beträge werden automatisch berechnet.")
          : tx("Суммы из документа, в том числе с разными ставками НДС. Для автоматического расчёта выберите ставку.", "Beträge laut Dokument, auch bei mehreren Steuersätzen. Für die automatische Berechnung einen Steuersatz wählen.")}
    </p>
    <div className="grid gap-3 sm:grid-cols-2">
      {(["amount_net", "amount_vat", "amount_gross"] as const).map(key => <Field key={key} label={labels[key]} className={key === "amount_gross" ? "sm:col-span-2" : undefined}>
        <Input aria-label={labels[key]} value={fields[key]} required inputMode="decimal" readOnly={automatic && key === "amount_vat"}
          className={key === "amount_gross" ? "font-mono font-semibold" : "font-mono"}
          onChange={event => changeAmount(key, event.target.value)} />
        {preview?.field_sources?.[key]?.method === "document_without_vat" && fields[key] === preview.fields[key] ? <p className="text-xs leading-4 text-muted-foreground" title={preview.field_sources[key].text}>
          {tx("По фразе в счёте: «без НДС».", "Laut Rechnung: ohne Umsatzsteuer.")}
        </p> : null}
      </Field>)}
    </div>
  </fieldset>;
}
