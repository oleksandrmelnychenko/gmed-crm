import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import type { ServiceDescriptionItem } from "@/lib/service-description";

export function ServiceDescriptionEditor({ items, onChange, lang, disabled = false }: {
  items: ServiceDescriptionItem[];
  onChange: (items: ServiceDescriptionItem[]) => void;
  lang: "de" | "ru";
  disabled?: boolean;
}) {
  const editorId = useId();
  const label = (ru: string, de: string) => lang === "de" ? de : ru;
  function move(index: number, offset: number) {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {label("Каждый пункт станет отдельным пунктом в документе. Enter переносит текст внутри пункта.", "Jeder Eintrag wird zu einem eigenen Punkt im Dokument. Enter erzeugt einen Zeilenumbruch innerhalb des Punktes.")}
      </p>
      {items.map((item, index) => (
        <div key={item.id} className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor={`${editorId}-${item.id}`} className="text-sm font-medium">
              {label("Пункт", "Punkt")} {index + 1}
            </label>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || index === 0}
                aria-label={`${label("Переместить вверх пункт", "Punkt nach oben verschieben")} ${index + 1}`} onClick={() => move(index, -1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || index === items.length - 1}
                aria-label={`${label("Переместить вниз пункт", "Punkt nach unten verschieben")} ${index + 1}`} onClick={() => move(index, 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} className="text-destructive"
                aria-label={`${label("Удалить пункт", "Punkt löschen")} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <textarea id={`${editorId}-${item.id}`} value={item.text} disabled={disabled} rows={3}
            onChange={(event) => onChange(items.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry))}
            className="min-h-24 w-full resize-y rounded-md border border-border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50" />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={disabled}
        onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])}>
        <Plus className="size-4" />{label("Добавить пункт", "Punkt hinzufügen")}
      </Button>
    </div>
  );
}
