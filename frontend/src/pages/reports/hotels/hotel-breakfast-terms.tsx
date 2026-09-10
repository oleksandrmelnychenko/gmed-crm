import { useCallback, useEffect, useState } from "react";
import { Check, Coffee, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { apiFetch, clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { moneyCents } from "./model";

export type HotelBreakfastTerms = { mode: "unknown" | "included" | "extra" | "unavailable"; price_per_person: string | null; currency: string | null; notes: string | null; updated_at?: string | null };
const empty: HotelBreakfastTerms = { mode: "unknown", price_per_person: null, currency: null, notes: null };
const copy = {
  ru: { title: "Завтраки в гостинице", mode: "Условия гостиницы", unknown: "Условия не указаны", included: "Включён в стоимость проживания", extra: "Гостиница предлагает за доплату", unavailable: "Гостиница не предоставляет", price: "Цена за человека / завтрак", currency: "Валюта", notes: "Условия и примечания", edit: "Изменить условия", save: "Сохранить условия", cancel: "Сбросить изменения", hint: "Общие условия гостиницы. Фактические завтраки и расходы указываются отдельно в каждом проживании.", failed: "Не удалось загрузить условия завтраков", saveFailed: "Не удалось сохранить условия. Введённые данные сохранены в форме.", invalid: "Укажите корректную цену и валюту", retry: "Повторить", link: "Для общих условий выберите гостиницу из провайдеров в бронировании.", saved: "Условия сохранены", loading: "Загрузка…" },
  de: { title: "Frühstück im Hotel", mode: "Hotelkonditionen", unknown: "Konditionen nicht erfasst", included: "Im Übernachtungspreis enthalten", extra: "Hotel bietet Frühstück gegen Aufpreis", unavailable: "Hotel bietet kein Frühstück", price: "Preis pro Person / Frühstück", currency: "Währung", notes: "Konditionen und Hinweise", edit: "Konditionen bearbeiten", save: "Konditionen speichern", cancel: "Änderungen verwerfen", hint: "Allgemeine Hotelkonditionen. Tatsächliches Frühstück und Kosten werden je Aufenthalt separat erfasst.", failed: "Frühstückskonditionen konnten nicht geladen werden", saveFailed: "Konditionen konnten nicht gespeichert werden. Eingaben bleiben erhalten.", invalid: "Gültigen Preis und gültige Währung angeben", retry: "Erneut versuchen", link: "Für allgemeine Konditionen ein Hotel aus den Anbietern in der Buchung wählen.", saved: "Konditionen gespeichert", loading: "Wird geladen…" },
} as const;
const draftOf = (terms: HotelBreakfastTerms) => ({ mode: terms.mode, price: terms.price_per_person ?? "", currency: terms.currency ?? "EUR", notes: terms.notes ?? "" });

export function HotelBreakfastTermsEditor({ providerId, role, lang, onDirty }: { providerId: string | null; role: string; lang: Lang; onDirty: (id: string, dirty: boolean) => void }) {
  const labels = copy[lang], editable = ["ceo", "patient_manager", "concierge"].includes(role);
  const [terms, setTerms] = useState(empty), [draft, setDraft] = useState(() => draftOf(empty));
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saveError, setSaveError] = useState(""), [saved, setSaved] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(draftOf(terms));
  useEffect(() => { const key = `hotel-breakfast-terms:${providerId}`; onDirty(key, editing && changed || busy); return () => onDirty(key, false); }, [providerId, editing, changed, busy, onDirty]);
  const load = useCallback(async () => {
    if (!providerId) return;
    setLoading(true); setError("");
    try { const data = { ...empty, ...await apiFetch<Partial<HotelBreakfastTerms>>(`/stats/reports/hotels/${providerId}/breakfast-terms`, { forceFresh: true }) }; setTerms(data); setDraft(draftOf(data)); }
    catch { setError(labels.failed); }
    finally { setLoading(false); }
  }, [providerId, labels.failed]);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (!providerId || !changed || busy || !editable) return;
    const price = draft.price.trim().replace(",", "."), currency = draft.currency.trim().toUpperCase();
    if (draft.mode === "extra" && price && (moneyCents(price) === null || moneyCents(price)! > 999999999999n || !/^[A-Z]{3}$/.test(currency))) { setSaveError(labels.invalid); return; }
    setBusy(true); setSaveError("");
    const body: HotelBreakfastTerms = { mode: draft.mode, price_per_person: draft.mode === "extra" && price ? price : null, currency: draft.mode === "extra" && price ? currency : null, notes: draft.notes.trim() || null };
    try { const result = await apiFetch<HotelBreakfastTerms>(`/stats/reports/hotels/${providerId}/breakfast-terms`, { method: "PUT", body: JSON.stringify(body) }); setTerms(result); setDraft(draftOf(result)); setEditing(false); setSaved(true); clearApiCache(`/providers/${providerId}`); }
    catch { setSaveError(labels.saveFailed); }
    finally { setBusy(false); }
  }
  return <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm" data-testid="hotel-breakfast-terms">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/15 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Coffee className="size-4 text-primary" />{labels.title}</h3>{providerId && editable && !loading && !error && !editing ? <Button size="sm" variant="outline" onClick={() => { setEditing(true); setSaved(false); }}><Pencil className="size-3.5" />{labels.edit}</Button> : null}</header>
    <div className="space-y-3 p-4">
      {!providerId ? <p className="text-xs text-muted-foreground">{labels.link}</p> : loading ? <p role="status" className="text-xs text-muted-foreground">{labels.loading}</p> : error ? <div role="alert" className="text-xs text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => void load()}>{labels.retry}</Button></div> : editing ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="block space-y-1 text-xs text-muted-foreground">{labels.mode}<NativeComboboxSelect aria-label={labels.mode} disabled={busy} value={draft.mode} onChange={event => { const mode = event.target.value as HotelBreakfastTerms["mode"]; setDraft(current => ({ ...current, mode, price: mode === "extra" ? current.price : "" })); setSaveError(""); }}>{(["unknown", "included", "extra", "unavailable"] as const).map(mode => <option key={mode} value={mode}>{labels[mode]}</option>)}</NativeComboboxSelect></label>
        {draft.mode === "extra" ? <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3"><label className="space-y-1 text-xs text-muted-foreground">{labels.price}<Input aria-label={labels.price} inputMode="decimal" disabled={busy} placeholder="—" value={draft.price} onChange={event => setDraft(current => ({ ...current, price: event.target.value }))} /></label><label className="space-y-1 text-xs text-muted-foreground">{labels.currency}<Input aria-label={labels.currency} maxLength={3} disabled={busy} value={draft.currency} onChange={event => setDraft(current => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label></div> : null}
        <label className="block space-y-1 text-xs text-muted-foreground">{labels.notes}<textarea aria-label={labels.notes} className="min-h-20 w-full rounded-lg border border-input bg-field p-2 text-sm text-foreground" maxLength={2000} disabled={busy} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} /></label>
        {saveError ? <p role="alert" className="text-xs text-destructive">{saveError}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(draftOf(terms)); setEditing(false); setSaveError(""); }}>{labels.cancel}</Button><Button type="submit" size="sm" disabled={busy || !changed}><Check className="size-3.5" />{labels.save}</Button></div>
      </form> : <div><p className="text-sm font-medium">{labels[terms.mode] ?? labels.unknown}</p>{terms.price_per_person && terms.currency ? <p className="mt-1 text-sm tabular-nums">{formatMoneyAmount(terms.price_per_person, terms.currency)} <span className="text-xs text-muted-foreground">· {labels.price}</span></p> : null}{terms.notes ? <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{terms.notes}</p> : null}{saved ? <p role="status" className="mt-2 text-xs text-emerald-700">{labels.saved}</p> : null}</div>}
      <p className="text-xs leading-5 text-muted-foreground">{labels.hint}</p>
    </div>
  </section>;
}
