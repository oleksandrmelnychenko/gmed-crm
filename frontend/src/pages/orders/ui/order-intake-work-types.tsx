import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Field, checkboxClass, Section } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { fetchSpecializations } from "@/pages/providers/data/provider-api";
import type { SpecializationItem } from "@/pages/providers/model/types";
import { fetchSpecializationWorkTypes, type SpecializationWorkType } from "@/pages/specializations/data/specialization-work-types-api";
import type { IntakeDraft } from "../model/order-intake";
import { SelectedWorkTypesSummary, specializationChipClass } from "./order-work-types-summary";

export const intakeSpecializationName = (item: SpecializationItem, lang: Lang) => lang === "de"
  ? item.name_de || item.name_en || item.name_ru || item.code
  : item.name_ru || item.name_de || item.name_en || item.code;

export function useIntakeWorkTypes(ids: string[], lang: Lang) {
  const [specializations, setSpecializations] = useState<SpecializationItem[]>([]);
  const [workTypes, setWorkTypes] = useState<SpecializationWorkType[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const key = [...ids].sort().join(",");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const selectedIds = key ? key.split(",") : [];
    void Promise.all([fetchSpecializations(), Promise.all(selectedIds.map(id => fetchSpecializationWorkTypes(id)))])
      .then(([specialties, groups]) => {
        if (cancelled) return;
        setSpecializations(specialties);
        setWorkTypes([...new Map(groups.flat().filter(item => item.is_active).map(item => [item.id, item])).values()]);
      }).catch(() => { if (!cancelled) setError(lang === "de" ? "Leistungsarten konnten nicht geladen werden." : "Не удалось загрузить виды работ."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, retry, lang]);
  return { specializations, workTypes, loading, error, reload: () => setRetry(value => value + 1) };
}

export function OrderIntakeWorkTypes({ data, specializations, workTypes, loading, error, reload, lang, disabled, onChange }: {
  data: IntakeDraft; specializations: SpecializationItem[]; workTypes: SpecializationWorkType[];
  loading: boolean; error: string; reload: () => void; lang: Lang; disabled: boolean;
  onChange: (patch: Partial<IntakeDraft>) => void;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const ids = data.specialization_ids ?? [];
  const selected = data.selected_work_type_ids ?? [];
  const labels = new Map([...(data.catalog_snapshot?.specializations ?? []), ...specializations].map(item => [item.id, intakeSpecializationName(item, lang)]));
  const knownWorkTypes = new Map([...(data.catalog_snapshot?.work_types ?? []), ...workTypes].map(item => [item.id, item]));
  const unavailable = selected.filter(id => !workTypes.some(item => item.id === id));
  return <Section title={tx("Специализации и виды работ", "Fachrichtungen und Leistungsarten")} className="rounded-xl border border-border/70 bg-card p-4">
    <Field label={tx("Специализации", "Fachrichtungen")}>
      <NativeComboboxSelect aria-label={tx("Добавить специализацию", "Fachrichtung hinzufügen")} className="w-full sm:max-w-xl" disabled={disabled || loading} value="" onChange={event => {
        if (event.target.value && !ids.includes(event.target.value)) onChange({ specialization_ids: [...ids, event.target.value] });
      }}>
        <option value="">{tx("Добавить специализацию", "Fachrichtung hinzufügen")}</option>
        {specializations.map(item => <option key={item.id} disabled={ids.includes(item.id)} value={item.id}>{intakeSpecializationName(item, lang)}</option>)}
      </NativeComboboxSelect>
    </Field>
    {ids.length ? <div className="flex flex-wrap gap-1.5">{ids.map(id => <Badge key={id} variant="outline" className={`h-7 max-w-full gap-1.5 ${specializationChipClass(labels.get(id) ?? id)}`}>
      <span className="truncate">{labels.get(id) ?? data.catalog_snapshot?.specializations.find(item => item.id === id)?.name_de ?? id}</span>
      <button type="button" disabled={disabled || loading} aria-label={`${tx("Удалить специализацию", "Fachrichtung entfernen")}: ${labels.get(id) ?? id}`} onClick={() => {
        const remaining = ids.filter(value => value !== id);
        onChange({ specialization_ids: remaining, selected_work_type_ids: selected.filter(value => {
          const item = knownWorkTypes.get(value);
          return remaining.length > 0 && (!item || item.specialization_ids.some(id => remaining.includes(id)));
        }) });
      }}><X className="size-3.5" /></button>
    </Badge>)}</div> : null}
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border/60 py-2.5">
      <span className="text-xs font-semibold">{tx("Языки документа", "Dokumentsprachen")}</span>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" className={checkboxClass} checked disabled />Deutsch</label>
      {([['ru', 'Русский'], ['en', 'English'], ['es', 'Español']] as const).map(([code, label]) => <label key={code} className="flex items-center gap-2 text-xs"><input type="checkbox" className={checkboxClass} disabled={disabled} checked={data.cost_estimate_additional_language === code} onChange={event => onChange({ cost_estimate_additional_language: event.target.checked ? code : "" })} />{label}</label>)}
    </div>
    {!loading && !error && unavailable.length ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <span>{tx("Некоторые выбранные виды работ больше недоступны. Удалите их и выберите актуальные.", "Einige gewählte Leistungsarten sind nicht mehr verfügbar. Entfernen Sie diese und wählen Sie aktuelle Leistungen.")}</span>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ selected_work_type_ids: selected.filter(id => !unavailable.includes(id)) })}>{tx("Убрать недоступные", "Nicht verfügbare entfernen")}</Button>
    </div> : null}
    {loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{tx("Загрузка видов работ…", "Leistungsarten werden geladen…")}</p> : error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">{error}<Button type="button" variant="outline" size="sm" onClick={reload}><RefreshCw className="size-3.5" />{tx("Повторить", "Erneut versuchen")}</Button></div> : workTypes.length ?
      <SelectedWorkTypesSummary workTypes={workTypes} specializationLabels={labels} lang={lang} tx={tx} selection={{ ids: selected, onChange: next => { if (!disabled) onChange({ selected_work_type_ids: next }); } }} /> :
      <p className="py-3 text-xs text-muted-foreground">{ids.length ? tx("Нет активных видов работ", "Keine aktiven Leistungsarten") : tx("Выберите специализацию, чтобы добавить виды работ.", "Wählen Sie eine Fachrichtung, um Leistungsarten hinzuzufügen.")}</p>}
  </Section>;
}
