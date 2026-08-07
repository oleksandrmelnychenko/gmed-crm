import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { specializationLabelForItem } from "@/pages/providers/model/specialization-labels";
import type { SpecializationItem } from "@/pages/providers/model/types";
import { X } from "lucide-react";

type Bilingual = (ru: string, de: string) => string;

export function ClinicalSpecializationsField({
  ids,
  selected,
  options,
  lang,
  tx,
  onChange,
}: {
  ids: string[];
  selected: SpecializationItem[];
  options: SpecializationItem[];
  lang: string;
  tx: Bilingual;
  onChange: (ids: string[], selected: SpecializationItem[]) => void;
}) {
  const labelLang = lang === "de" ? "de" : "ru";
  const availableItems = useMemo(() => {
    const byId = new Map<string, SpecializationItem>();
    for (const item of [...options, ...selected]) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [options, selected]);

  function add(id: string) {
    if (!id || ids.includes(id)) return;
    const item = availableItems.find((candidate) => candidate.id === id);
    if (item) onChange([...ids, id], [...selected, item]);
  }

  function remove(id: string) {
    onChange(
      ids.filter((value) => value !== id),
      selected.filter((item) => item.id !== id),
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-2.5">
      <NativeComboboxSelect
        value=""
        aria-label={tx("Добавить специализацию", "Spezialisierung hinzufügen")}
        className="h-9 w-full rounded-lg border border-border bg-field px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        onChange={(event) => add(event.target.value)}
      >
        <option value="">
          {tx("Добавить специализацию…", "Spezialisierung hinzufügen…")}
        </option>
        {availableItems.map((item) => (
          <option key={item.id} value={item.id} disabled={ids.includes(item.id)}>
            {specializationLabelForItem(item, labelLang)}
          </option>
        ))}
      </NativeComboboxSelect>
      {ids.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const item = availableItems.find((candidate) => candidate.id === id);
            if (!item) return null;
            const label = specializationLabelForItem(item, labelLang);
            return (
              <Badge
                key={id}
                variant="outline"
                className="gap-1 border-amber-300 bg-amber-50 py-1 pr-1 font-semibold text-amber-700"
              >
                {label}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-foreground/10"
                  aria-label={`${tx("Удалить", "Entfernen")}: ${label}`}
                  onClick={() => remove(id)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">
          {tx("Специализации не выбраны", "Keine Spezialisierungen ausgewählt")}
        </p>
      )}
    </div>
  );
}
