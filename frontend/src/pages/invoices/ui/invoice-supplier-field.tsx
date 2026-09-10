import { useEffect, useState } from "react";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { useOverlayDirtyField } from "@/components/ui/dismissal-guard";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export type InvoiceSupplierProvider = {
  id: string;
  name: string;
  legal_name?: string | null;
  address_city?: string | null;
  address_street?: string | null;
  is_active?: boolean;
};

export function InvoiceSupplierField({ name, label, provider, system, disabled, required, onNameChange, onModeChange, onProviderChange }: {
  name: string;
  label: string;
  provider: InvoiceSupplierProvider | null;
  system: boolean;
  disabled: boolean;
  required: boolean;
  onNameChange: (name: string) => void;
  onModeChange: (system: boolean) => void;
  onProviderChange: (provider: InvoiceSupplierProvider | null) => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState<{ query: string; items: InvoiceSupplierProvider[]; error: boolean } | null>(null);
  const dirtyMode = useOverlayDirtyField(String(system));
  const query = search.trim();
  const ready = lookup?.query === query;
  const results = ready ? lookup.items : [];
  const options = provider && !results.some(item => item.id === provider.id) ? [provider, ...results] : results;

  useEffect(() => {
    if (!system || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ active_only: "true" });
      if (query) params.set("search", query);
      void apiFetch<InvoiceSupplierProvider[]>(`/providers?${params}`, { signal: controller.signal })
        .then(items => {
          if (!controller.signal.aborted) setLookup({ query, items: items.filter(item => item.is_active !== false), error: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLookup({ query, items: [], error: true });
        });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [system, disabled, query]);

  return <div className="space-y-2">
    {system ? <NativeComboboxSelect
      aria-label={label}
      value={provider?.id ?? ""}
      disabled={disabled}
      required
      hidePlaceholderOption
      onSearchChange={setSearch}
      emptyLabel={!ready ? tx("Поиск…", "Suche…") : lookup?.error
        ? tx("Поиск недоступен. Повторите ввод или снимите отметку и введите название вручную.", "Suche nicht verfügbar. Erneut suchen oder Markierung entfernen und Namen manuell eingeben.")
        : tx("Провайдер не найден. Для магазина или нового поставщика снимите отметку.", "Kein Anbieter gefunden. Für ein Geschäft oder einen neuen Lieferanten die Markierung entfernen.")}
      onChange={event => onProviderChange(options.find(item => item.id === event.target.value) ?? null)}
    >
      <option value="">{tx("Найти провайдера", "Anbieter suchen")}</option>
      {options.map(item => <option key={item.id} value={item.id} data-search-text={[item.name, item.legal_name, item.address_city, item.address_street].filter(Boolean).join(" ")}>
        {[item.name, item.address_city, item.address_street].filter(Boolean).join(" · ")}
      </option>)}
    </NativeComboboxSelect> : <Input aria-label={label} value={name} disabled={disabled} required={required} maxLength={500} onChange={event => onNameChange(event.target.value)} />}
    <label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground">
      <input type="checkbox" className="size-4 shrink-0 accent-orange-500" checked={system} disabled={disabled} onChange={event => { dirtyMode(String(event.target.checked)); setSearch(""); onModeChange(event.target.checked); }} />
      {tx("Поставщик из системы", "Anbieter aus dem System")}
    </label>
  </div>;
}
