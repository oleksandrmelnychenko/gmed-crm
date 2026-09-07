import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/ui-shell";
import {
  checkMedicationPair,
  type MedicationNameField,
  type MedicationPairConfirmation,
  type MedicationPairReview,
} from "../../data/medication-names";

const clean = (name: string) => name.trim().replace(/\s+/gu, " ");
const pairKey = (pair: MedicationPairConfirmation) => JSON.stringify([clean(pair.handelsname).toLowerCase(), clean(pair.wirkstoff).toLowerCase()]);

export function MedicationNameReview({ names, confirmation, onConfirm, onChoose, lang }: {
  names: MedicationPairConfirmation;
  confirmation?: MedicationPairConfirmation | null;
  onConfirm: (confirmation: MedicationPairConfirmation | null) => void;
  onChoose: (field: MedicationNameField, name: string) => void;
  lang: string;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const handelsname = clean(names.handelsname);
  const wirkstoff = clean(names.wirkstoff);
  const key = pairKey(names);
  const valid = Boolean(wirkstoff) && [handelsname, wirkstoff].every(name => [...name].length <= 500);
  const [lookup, setLookup] = useState<{ key: string; review: MedicationPairReview | null } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void checkMedicationPair({ handelsname, wirkstoff }, controller.signal).then(review => {
        if (!controller.signal.aborted) setLookup({ key, review });
      }).catch(() => {
        if (!controller.signal.aborted) setLookup({ key, review: null });
      });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [handelsname, wirkstoff, key, valid, retry]);

  if (!valid) return null;
  if (lookup?.key !== key) return <p className="md:col-span-2 text-xs text-muted-foreground" role="status">{tx("Проверяем названия в справочнике…", "Namen werden im Verzeichnis geprüft…")}</p>;
  const review = lookup.review;
  if (!review) return <div className="md:col-span-2 space-y-1 rounded-lg border p-3 text-xs text-muted-foreground" role="status">
    <p>{tx("Справочник недоступен. Медикамент можно сохранить у пациента; новые названия пока не будут запомнены.", "Das Verzeichnis ist nicht verfügbar. Das Medikament kann beim Patienten gespeichert werden; neue Namen werden vorerst nicht übernommen.")}</p>
    <Button type="button" size="sm" variant="outline" onClick={() => { setLookup(null); setRetry(value => value + 1); }}>{tx("Проверить ещё раз", "Erneut prüfen")}</Button>
  </div>;
  if (review.known_pair) return <p className="md:col-span-2 text-xs text-muted-foreground" role="status">{tx("Эта пара названий уже есть в справочнике.", "Diese Namenskombination ist bereits im Verzeichnis vorhanden.")}</p>;

  const checked = Boolean(confirmation && pairKey(confirmation) === key);
  const hasSuggestions = review.handelsname.similar.length > 0 || review.wirkstoff.similar.length > 0;
  return <div className="md:col-span-2 min-w-0 space-y-3 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-950/15">
    <p className="text-xs font-medium">{hasSuggestions
      ? tx("Есть похожие названия. Проверьте написание перед добавлением.", "Ähnliche Namen gefunden. Bitte vor dem Hinzufügen die Schreibweise prüfen.")
      : tx("Новая пара названий для справочника", "Neue Namenskombination für das Verzeichnis")}</p>
    {(["handelsname", "wirkstoff"] as const).map(field => review[field].similar.length ? <div key={field} className="min-w-0 space-y-1">
      <p className="text-[11px] text-muted-foreground">{field === "handelsname" ? tx("Похожие торговые названия", "Ähnliche Handelsnamen") : tx("Похожие действующие вещества", "Ähnliche Wirkstoffe")}</p>
      <div className="flex flex-wrap gap-1.5">{review[field].similar.map(name => <Button key={name} type="button" variant="outline" size="sm" className="h-auto max-w-full whitespace-normal break-words text-left" onClick={() => onChoose(field, name)}>{name}</Button>)}</div>
    </div> : null)}
    <label className="flex items-start gap-2 text-xs leading-relaxed">
      <input type="checkbox" className={`${checkboxClass} mt-0.5 shrink-0`} checked={checked} onChange={event => onConfirm(event.target.checked ? { handelsname, wirkstoff } : null)} />
      <span>{tx("Названия проверены. Запомнить эту пару в справочнике при сохранении.", "Namen geprüft. Diese Kombination beim Speichern ins Verzeichnis übernehmen.")}</span>
    </label>
    <p className="text-[11px] text-muted-foreground">{tx("Без подтверждения названия сохранятся только у пациента.", "Ohne Bestätigung werden die Namen nur beim Patienten gespeichert.")}</p>
  </div>;
}
