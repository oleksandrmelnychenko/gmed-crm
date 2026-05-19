"use client";

import { X } from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type LanguageOption = {
  value: string;
  labelDe: string;
  labelRu: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "de", labelDe: "Deutsch", labelRu: "Немецкий" },
  { value: "uk", labelDe: "Ukrainisch", labelRu: "Украинский" },
  { value: "ru", labelDe: "Russisch", labelRu: "Русский" },
  { value: "en", labelDe: "Englisch", labelRu: "Английский" },
  { value: "ar", labelDe: "Arabisch", labelRu: "Арабский" },
  { value: "pt", labelDe: "Portugiesisch", labelRu: "Португальский" },
  { value: "fr", labelDe: "Französisch", labelRu: "Французский" },
  { value: "es", labelDe: "Spanisch", labelRu: "Испанский" },
  { value: "it", labelDe: "Italienisch", labelRu: "Итальянский" },
  { value: "tr", labelDe: "Türkisch", labelRu: "Турецкий" },
  { value: "pl", labelDe: "Polnisch", labelRu: "Польский" },
  { value: "cs", labelDe: "Tschechisch", labelRu: "Чешский" },
  { value: "da", labelDe: "Dänisch", labelRu: "Датский" },
  { value: "el", labelDe: "Griechisch", labelRu: "Греческий" },
  { value: "lv", labelDe: "Lettisch", labelRu: "Латышский" },
  { value: "zh", labelDe: "Chinesisch", labelRu: "Китайский" },
  { value: "ur", labelDe: "Urdu", labelRu: "Урду" },
];

function normalizeLanguageKey(value: string) {
  return value.trim().toLowerCase();
}

function splitLanguageValue(value: string) {
  const seen = new Set<string>();

  return value.split(",").flatMap((item) => {
    const normalized = item.trim();
    const key = normalizeLanguageKey(normalized);
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function languageOptionLabel(option: LanguageOption, lang: "de" | "ru") {
  return lang === "de" ? option.labelDe : option.labelRu;
}

function hasBaseLanguageOption(value: string) {
  const key = normalizeLanguageKey(value);
  for (const option of LANGUAGE_OPTIONS) {
    if (normalizeLanguageKey(option.value) === key) return true;
  }

  return false;
}

function selectedOptionValues(
  options: Array<{ value: string; label: string }>,
  selectedKeys: Set<string>,
) {
  const values: string[] = [];
  for (const option of options) {
    if (selectedKeys.has(normalizeLanguageKey(option.value))) {
      values.push(option.value);
    }
  }

  return values;
}

export function languageLabel(value: string, lang: "de" | "ru") {
  const key = normalizeLanguageKey(value);
  const option = LANGUAGE_OPTIONS.find((item) => normalizeLanguageKey(item.value) === key);
  if (!option) return value;

  return `${languageOptionLabel(option, lang)} (${option.value})`;
}

export function LanguageMultiSelect({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t, lang } = useLang();
  const selected = splitLanguageValue(value);
  const selectedKeys = new Set(selected.map(normalizeLanguageKey));
  const customOptions: Array<{ value: string; label: string }> = [];
  for (const item of selected) {
    if (!hasBaseLanguageOption(item)) {
      customOptions.push({ value: item, label: item });
    }
  }
  const options = [
    ...customOptions,
    ...LANGUAGE_OPTIONS.map((option) => ({
      value: option.value,
      label: languageLabel(option.value, lang),
    })),
  ];
  const triggerLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? languageLabel(selected[0] ?? "", lang)
        : `${placeholder}: ${selected.length}`;

  const commit = (next: string[]) => onChange(next.join(", "));
  const toggleLanguage = (nextValue: string) => {
    const normalized = nextValue.trim();
    if (!normalized) return;

    const key = normalizeLanguageKey(normalized);
    if (selectedKeys.has(key)) {
      commit(selected.filter((item) => normalizeLanguageKey(item) !== key));
      return;
    }

    commit([...selected, normalized]);
  };
  const removeLanguage = (target: string) => {
    const targetKey = normalizeLanguageKey(target);
    commit(selected.filter((item) => normalizeLanguageKey(item) !== targetKey));
  };

  return (
    <div className="space-y-2">
      <NativeComboboxSelect
        value=""
        onChange={(event) => toggleLanguage(event.target.value)}
        className={className}
        disabled={disabled || options.length === 0}
        selectedValues={selectedOptionValues(options, selectedKeys)}
        showValueIndicator={false}
        hidePlaceholderOption
        title={selected.map((item) => languageLabel(item, lang)).join(", ") || placeholder}
      >
        <option value="">{triggerLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeComboboxSelect>
      {selected.length > 0 ? (
        <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {selected.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => removeLanguage(item)}
              disabled={disabled}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40",
                disabled && "cursor-default opacity-80 hover:border-border hover:bg-card",
              )}
              title={languageLabel(item, lang)}
              aria-label={`${t.common_remove}: ${languageLabel(item, lang)}`}
            >
              <span className="min-w-0 truncate">{languageLabel(item, lang)}</span>
              {!disabled ? <X className="size-3 shrink-0" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
