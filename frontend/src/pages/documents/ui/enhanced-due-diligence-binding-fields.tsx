import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect, countryLabel } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { checkboxClass } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import {
  parseEnhancedDueDiligenceCountries,
  type DocumentBindingForm,
} from "@/pages/documents/model/document-bindings";

const inputClassName =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const textareaClassName = cn(
  inputClassName,
  "min-h-24 resize-y bg-white py-2 text-slate-900",
);

type EnhancedDueDiligenceBindingFieldsProps = {
  bindings: DocumentBindingForm;
  lang: "de" | "ru";
  onChange: (key: string, value: string) => void;
};

function AmlField({
  children,
  label,
  required = false,
  className,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
        {label}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function AmlToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={checkboxClass}
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

export function EnhancedDueDiligenceBindingFields({
  bindings,
  lang,
  onChange,
}: EnhancedDueDiligenceBindingFieldsProps) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [countryDraft, setCountryDraft] = useState<string | null>(null);
  const riskTier = bindings.riskTier ?? "";
  const triggeredCountries = parseEnhancedDueDiligenceCountries(
    bindings.triggeredCountries,
  );
  const countryRisk =
    riskTier === "high_risk" ||
    riskTier === "blacklist" ||
    triggeredCountries.length > 0;
  const pepRisk =
    bindings.pepContractPartner === "true" ||
    bindings.pepBeneficialOwner === "true";
  const checked = (key: string) => bindings[key] === "true";
  const patchBoolean = (key: string, value: boolean) =>
    onChange(key, String(value));

  function addTriggeredCountry(country: string | null) {
    setCountryDraft(null);
    if (!country || triggeredCountries.includes(country)) return;
    const nextCountries = [...triggeredCountries, country];
    onChange("triggeredCountries", nextCountries.join(","));
    if (!bindings.affectedThirdCountry?.trim()) {
      onChange(
        "affectedThirdCountry",
        nextCountries.map((code) => countryLabel(code, "de")).join(", "),
      );
    }
  }

  function removeTriggeredCountry(country: string) {
    onChange(
      "triggeredCountries",
      triggeredCountries.filter((code) => code !== country).join(","),
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          {tx(
            "1. Установление повышенного риска",
            "1. Feststellung eines erhöhten Geldwäscherisikos",
          )}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <AmlField required label={tx("Уровень риска", "Risikostufe")}>
            <NativeComboboxSelect
              value={riskTier}
              onChange={(event) => onChange("riskTier", event.target.value)}
              className={inputClassName}
              aria-required="true"
            >
              <option value="">{tx("Выберите уровень риска", "Risikostufe auswählen")}</option>
              <option value="high_risk">
                {tx("Страна повышенного риска", "Drittstaat mit hohem Risiko")}
              </option>
              <option value="blacklist">
                {tx("Страна из чёрного списка", "Blacklist / besonders hohes Risiko")}
              </option>
              <option value="pep">
                {tx("Политически значимое лицо (PEP)", "Politisch exponierte Person (PeP)")}
              </option>
            </NativeComboboxSelect>
          </AmlField>
          <AmlField label={tx("Добавить страну риска", "Auslösendes Land hinzufügen")}>
            <CountrySelect
              value={countryDraft}
              onChange={addTriggeredCountry}
              lang={lang}
              className={inputClassName}
              aria-label={tx("Добавить страну риска", "Auslösendes Land hinzufügen")}
            />
          </AmlField>
        </div>
        {triggeredCountries.length > 0 ? (
          <div className="border-y border-border/70">
            {triggeredCountries.map((country) => (
              <div
                key={country}
                className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 py-2 last:border-b-0"
              >
                <span className="text-sm text-foreground">
                  {countryLabel(country, lang)}
                </span>
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={tx("Удалить страну", "Land entfernen")}
                  aria-label={`${tx("Удалить", "Entfernen")}: ${countryLabel(country, lang)}`}
                  onClick={() => removeTriggeredCountry(country)}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="border-y border-border/70">
          <AmlToggle
            checked={checked("internalRiskAnalysis")}
            onChange={(value) => patchBoolean("internalRiskAnalysis", value)}
            label={tx("Внутренний анализ рисков", "Interne Risikoanalyse")}
          />
          <AmlToggle
            checked={checked("individualReview")}
            onChange={(value) => patchBoolean("individualReview", value)}
            label={tx(
              "Индивидуальная оценка конкретного случая",
              "Individuelle Prüfung des konkreten Einzelfalls",
            )}
          />
        </div>
        <AmlField
          required
          label={tx("Обоснование повышенного риска", "Begründung des erhöhten Risikos")}
        >
          <textarea
            value={bindings.riskReason ?? ""}
            onChange={(event) => onChange("riskReason", event.target.value)}
            className={textareaClassName}
            aria-required="true"
          />
        </AmlField>
        <AmlField
          label={tx(
            "Происхождение задействованных активов",
            "Herkunft der eingesetzten Vermögenswerte",
          )}
        >
          <textarea
            value={bindings.assetOrigin ?? ""}
            onChange={(event) => onChange("assetOrigin", event.target.value)}
            className={textareaClassName}
          />
        </AmlField>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">
          {tx("Политически значимое лицо (PEP)", "Politisch exponierte Person (PeP)")}
        </h3>
        <div className="border-y border-border/70">
          <AmlToggle
            checked={checked("pepContractPartner")}
            onChange={(value) => patchBoolean("pepContractPartner", value)}
            label={tx("Контрагент является PEP", "Vertragspartner ist eine PeP")}
          />
          <AmlToggle
            checked={checked("pepBeneficialOwner")}
            onChange={(value) => patchBoolean("pepBeneficialOwner", value)}
            label={tx(
              "Бенефициарный владелец является PEP",
              "Wirtschaftlich Berechtigter ist eine PeP",
            )}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <AmlField required={pepRisk} label={tx("Должность / функция", "Amt / Funktion")}>
            <Input
              value={bindings.pepOfficeFunction ?? ""}
              onChange={(event) => onChange("pepOfficeFunction", event.target.value)}
              className={inputClassName}
              aria-required={pepRisk}
            />
          </AmlField>
          <AmlField
            required={pepRisk}
            label={tx("Происхождение активов PEP", "Herkunft der Vermögenswerte der PeP")}
          >
            <Input
              value={bindings.pepAssetOrigin ?? ""}
              onChange={(event) => onChange("pepAssetOrigin", event.target.value)}
              className={inputClassName}
              aria-required={pepRisk}
            />
          </AmlField>
        </div>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">
          {tx("Третья страна с высоким риском", "Drittstaat mit hohem Risiko")}
        </h3>
        <div className="border-y border-border/70">
          <AmlToggle
            checked={checked("highRiskCountryTransaction")}
            onChange={(value) => patchBoolean("highRiskCountryTransaction", value)}
            label={tx(
              "Операция связана с третьей страной высокого риска",
              "Transaktion steht im Zusammenhang mit einem Drittstaat mit hohem Risiko",
            )}
          />
          <AmlToggle
            checked={checked("highRiskCountryResident")}
            onChange={(value) => patchBoolean("highRiskCountryResident", value)}
            label={tx(
              "Контрагент проживает или зарегистрирован в такой стране",
              "Vertragspartner ist dort niedergelassen oder wohnhaft",
            )}
          />
        </div>
        <AmlField
          required={countryRisk}
          label={tx("Затронутая третья страна", "Betroffener Drittstaat")}
        >
          <Input
            value={bindings.affectedThirdCountry ?? ""}
            onChange={(event) => onChange("affectedThirdCountry", event.target.value)}
            className={inputClassName}
            aria-required={countryRisk}
          />
        </AmlField>
        <div className="grid gap-4 md:grid-cols-2">
          <AmlField
            required={countryRisk}
            label={tx(
              "Дополнительная информация о контрагенте",
              "Zusätzliche Informationen zum Vertragspartner",
            )}
          >
            <textarea
              value={bindings.additionalContractPartnerInfo ?? ""}
              onChange={(event) => onChange("additionalContractPartnerInfo", event.target.value)}
              className={textareaClassName}
              aria-required={countryRisk}
            />
          </AmlField>
          <AmlField
            label={tx(
              "Дополнительная информация о бенефициаре",
              "Zusätzliche Informationen zum wirtschaftlich Berechtigten",
            )}
          >
            <textarea
              value={bindings.additionalBeneficialOwnerInfo ?? ""}
              onChange={(event) => onChange("additionalBeneficialOwnerInfo", event.target.value)}
              className={textareaClassName}
            />
          </AmlField>
          <AmlField
            required={countryRisk}
            label={tx(
              "Планируемый характер деловых отношений",
              "Angestrebte Art der Geschäftsbeziehung",
            )}
          >
            <textarea
              value={bindings.intendedBusinessRelationshipInfo ?? ""}
              onChange={(event) => onChange("intendedBusinessRelationshipInfo", event.target.value)}
              className={textareaClassName}
              aria-required={countryRisk}
            />
          </AmlField>
          <AmlField
            required={countryRisk}
            label={tx("Активы контрагента", "Vermögenswerte des Vertragspartners")}
          >
            <textarea
              value={bindings.contractPartnerAssetInfo ?? ""}
              onChange={(event) => onChange("contractPartnerAssetInfo", event.target.value)}
              className={textareaClassName}
              aria-required={countryRisk}
            />
          </AmlField>
          <AmlField
            label={tx(
              "Активы бенефициарного владельца",
              "Vermögenswerte des wirtschaftlich Berechtigten",
            )}
          >
            <textarea
              value={bindings.beneficialOwnerAssetInfo ?? ""}
              onChange={(event) => onChange("beneficialOwnerAssetInfo", event.target.value)}
              className={textareaClassName}
            />
          </AmlField>
          <AmlField
            required={countryRisk}
            label={tx("Причины конкретной операции", "Gründe der konkreten Transaktion")}
          >
            <textarea
              value={bindings.transactionReasons ?? ""}
              onChange={(event) => onChange("transactionReasons", event.target.value)}
              className={textareaClassName}
              aria-required={countryRisk}
            />
          </AmlField>
          <AmlField
            required={countryRisk}
            label={tx(
              "Планируемое использование активов",
              "Geplante Verwendung der eingesetzten Vermögenswerte",
            )}
          >
            <textarea
              value={bindings.plannedAssetUse ?? ""}
              onChange={(event) => onChange("plannedAssetUse", event.target.value)}
              className={textareaClassName}
              aria-required={countryRisk}
            />
          </AmlField>
          <AmlField
            required
            label={tx("Согласовавший руководитель", "Zustimmende Führungskraft")}
          >
            <Input
              value={bindings.managerApprovalName ?? ""}
              onChange={(event) => onChange("managerApprovalName", event.target.value)}
              className={inputClassName}
              aria-required="true"
            />
          </AmlField>
        </div>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">
          {tx("Необычная операция", "Ungewöhnliche Transaktion")}
        </h3>
        <div className="border-y border-border/70">
          <AmlToggle
            checked={checked("unusualComplexOrLarge")}
            onChange={(value) => patchBoolean("unusualComplexOrLarge", value)}
            label={tx(
              "Сложная или необычно крупная операция",
              "Komplexe oder ungewöhnlich große Transaktion",
            )}
          />
          <AmlToggle
            checked={checked("unusualPattern")}
            onChange={(value) => patchBoolean("unusualPattern", value)}
            label={tx("Необычная схема операции", "Ungewöhnliches Transaktionsmuster")}
          />
          <AmlToggle
            checked={checked("noLawfulPurpose")}
            onChange={(value) => patchBoolean("noLawfulPurpose", value)}
            label={tx(
              "Нет очевидной законной цели",
              "Kein offensichtlicher rechtmäßiger Zweck",
            )}
          />
        </div>
        <AmlField label={tx("Результаты проверки", "Ergebnisse der Untersuchung")}>
          <textarea
            value={bindings.investigationResults ?? ""}
            onChange={(event) => onChange("investigationResults", event.target.value)}
            className={textareaClassName}
          />
        </AmlField>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">
          {tx("2. Усиленный мониторинг", "2. Verstärkte kontinuierliche Überwachung")}
        </h3>
        <AmlField
          required
          label={tx(
            "Меры постоянного мониторинга",
            "Maßnahmen der kontinuierlichen Überwachung",
          )}
        >
          <textarea
            value={bindings.continuousMonitoring ?? ""}
            onChange={(event) => onChange("continuousMonitoring", event.target.value)}
            className={textareaClassName}
            aria-required="true"
          />
        </AmlField>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">
          {tx("3. Дополнительные меры", "3. Weitere verstärkte Sorgfaltspflichten")}
        </h3>
        <AmlField
          label={tx("Принятые дополнительные меры", "Zusätzlich getroffene Maßnahmen")}
        >
          <textarea
            value={bindings.additionalMeasures ?? ""}
            onChange={(event) => onChange("additionalMeasures", event.target.value)}
            className={textareaClassName}
          />
        </AmlField>
        <div className="grid gap-4 md:grid-cols-2">
          <AmlField required label={tx("Проверил", "Bearbeiter/in")}>
            <Input
              value={bindings.reviewerName ?? ""}
              onChange={(event) => onChange("reviewerName", event.target.value)}
              className={inputClassName}
              aria-required="true"
            />
          </AmlField>
          <AmlField required label={tx("Дата проверки", "Prüfdatum")}>
            <Input
              type="date"
              value={bindings.reviewDate ?? ""}
              onChange={(event) => onChange("reviewDate", event.target.value)}
              className={inputClassName}
              aria-required="true"
            />
          </AmlField>
        </div>
      </section>
    </div>
  );
}
