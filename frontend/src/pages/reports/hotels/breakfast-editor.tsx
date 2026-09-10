import { useEffect, useState } from "react";
import { Check, Coffee, LoaderCircle } from "lucide-react";
import { Field } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { breakfastCopy } from "./breakfast-copy";
import { breakfastModes, moneyCents, type BreakfastDetails, type BreakfastMode, type HotelStay } from "./model";

const breakfastTones: Record<BreakfastMode, string> = {
  unknown: "border-border bg-muted/40 text-muted-foreground",
  included: "border-emerald-200 bg-emerald-50 text-emerald-700",
  hotel_extra: "border-amber-200 bg-amber-50 text-amber-800",
  self: "border-orange-200 bg-orange-50 text-orange-800",
  none: "border-border bg-muted/40 text-muted-foreground",
};
function draftOf(stay: HotelStay) {
  return { mode: stay.breakfast_mode ?? "unknown", count: stay.breakfast_count?.toString() ?? "", amount: stay.breakfast_total ?? "", currency: stay.breakfast_currency ?? stay.currency, payer: stay.breakfast_payer ?? "unknown", notes: stay.breakfast_notes ?? "" };
}

export function BreakfastEditor({ stay, lang, editable, onSaved, onDirty }: { stay: HotelStay; lang: Lang; editable: boolean; onSaved: () => void; onDirty: (id: string, dirty: boolean) => void }) {
  const labels = breakfastCopy[lang];
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(() => draftOf(stay));
  const [persistedDraft, setPersistedDraft] = useState(() => draftOf(stay));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const original = JSON.stringify(draftOf(stay));
  useEffect(() => { const next = JSON.parse(original) as ReturnType<typeof draftOf>; setDraft(next); setPersistedDraft(next); }, [original]);
  const changed = JSON.stringify(draft) !== JSON.stringify(persistedDraft);
  const dirtyKey = `breakfast:${stay.source}:${stay.id}`;
  useEffect(() => { onDirty(dirtyKey, changed || busy); return () => onDirty(dirtyKey, false); }, [dirtyKey, changed, busy, onDirty]);
  const paid = draft.mode === "hotel_extra" || draft.mode === "self";
  function changeMode(mode: BreakfastMode) {
    const isPaid = mode === "hotel_extra" || mode === "self";
    setDraft(current => ({ ...current, mode, count: mode === "none" || mode === "unknown" ? "" : current.count, amount: isPaid ? current.amount : "", currency: isPaid ? current.currency : stay.currency, payer: isPaid ? mode === "self" && current.payer === "unknown" ? "patient" : current.payer : "unknown" }));
    setError("");
  }
  async function save() {
    if (!changed || busy) return;
    const amount = draft.amount.trim().replace(",", ".");
    if ((draft.count && (!/^\d+$/.test(draft.count) || Number(draft.count) < 1 || Number(draft.count) > 100000))
      || (paid && amount && (moneyCents(amount) === null || moneyCents(amount)! > 999999999999n))) { setError(labels.invalid); return; }
    if (paid && amount && draft.currency !== stay.currency) { setError(labels.currencyChanged); return; }
    const body: BreakfastDetails = { breakfast_mode: draft.mode, breakfast_count: draft.count ? Number(draft.count) : null, breakfast_total: paid && amount ? amount : null, breakfast_currency: paid && amount ? stay.currency : null, breakfast_payer: paid ? draft.payer : "unknown", breakfast_notes: draft.notes.trim() || null };
    setBusy(true); setError("");
    try {
      await apiFetch(`/stats/reports/hotels/${stay.source}/${stay.id}/breakfast`, { method: "PUT", body: JSON.stringify(body) });
      const savedDraft = { mode: body.breakfast_mode, count: body.breakfast_count?.toString() ?? "", amount: body.breakfast_total ?? "", currency: body.breakfast_currency ?? stay.currency, payer: body.breakfast_payer, notes: body.breakfast_notes ?? "" };
      setDraft(savedDraft); setPersistedDraft(savedDraft); setOpen(false);
      clearApiCache("/stats/reports/hotels"); onSaved();
    } catch { setError(labels.error); }
    finally { setBusy(false); }
  }
  return <>
    <div className="space-y-1.5" data-testid={`breakfast-${stay.id}`}>
      <button type="button" className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs font-medium leading-4 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring ${breakfastTones[stay.breakfast_mode ?? "unknown"]}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Coffee className="size-3.5 shrink-0" />{labels[stay.breakfast_mode ?? "unknown"]}</button>
      {stay.breakfast_total !== null && stay.breakfast_currency ? <p className="text-xs text-muted-foreground"><span className="font-mono whitespace-nowrap">{formatMoneyAmount(stay.breakfast_total, stay.breakfast_currency)}</span> · {labels[stay.breakfast_payer]}</p> : null}
    </div>
    <Dialog open={open} dirty={changed || busy} onOpenChange={next => { if (busy) return; setOpen(next); if (!next) { setDraft(persistedDraft); setError(""); } }}>
      <DialogContent data-testid={`breakfast-editor-${stay.id}`} className="left-1/2 right-auto top-1/2 bottom-auto flex max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border-border/70 bg-card p-0 pb-0 shadow-2xl sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:pb-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border/70 bg-muted/20 px-5 py-4 pr-14">
          <DialogTitle className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-orange-500" />{labels.edit}</DialogTitle>
          <DialogDescription>{[stay.patient_name || stay.patient_number, [stay.check_in, stay.check_out].filter(Boolean).map(date => date!.split("-").reverse().join(".")).join(" — ")].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.edit}><NativeComboboxSelect aria-label={labels.edit} value={draft.mode} disabled={!editable || busy} onChange={event => changeMode(event.target.value as BreakfastMode)}>{breakfastModes.map(mode => <option key={mode} value={mode}>{labels[mode]}</option>)}</NativeComboboxSelect></Field>
            {draft.mode !== "unknown" && draft.mode !== "none" ? <Field label={labels.count}><Input aria-label={labels.count} type="number" min={1} max={100000} value={draft.count} disabled={!editable || busy} onChange={event => setDraft(current => ({ ...current, count: event.target.value }))} /><p className="text-xs leading-5 text-muted-foreground">{labels.countHint}</p></Field> : null}
            {paid ? <>
              <Field label={labels.payer}><NativeComboboxSelect aria-label={labels.payer} value={draft.payer} disabled={!editable || busy} onChange={event => setDraft(current => ({ ...current, payer: event.target.value as BreakfastDetails["breakfast_payer"] }))}>{(["unknown", "patient", "company", "split"] as const).map(payer => <option key={payer} value={payer}>{labels[payer]}</option>)}</NativeComboboxSelect></Field>
              <Field label={`${labels.amount} · ${stay.currency}`}><Input aria-label={labels.amount} className="font-mono" inputMode="decimal" value={draft.amount} disabled={!editable || busy} onChange={event => setDraft(current => ({ ...current, amount: event.target.value, currency: stay.currency }))} /><p className="text-xs leading-5 text-muted-foreground">{labels.amountHint}</p></Field>
            </> : null}
          </div>
          {draft.mode === "included" ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{labels.noExtra}</p> : null}
          <Field label={labels.notes}><textarea aria-label={labels.notes} className="min-h-24 w-full rounded-lg border border-input bg-field px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:opacity-50" maxLength={2000} disabled={!editable || busy} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} /></Field>
        </div>
        <footer className="shrink-0 space-y-3 border-t border-border/70 bg-muted/20 px-5 py-3">
          {error || paid && draft.amount && draft.currency !== stay.currency ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{error || labels.currencyChanged}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose render={<Button variant="outline" disabled={busy} />}>{changed ? labels.cancel : lang === "ru" ? "Закрыть" : "Schließen"}</DialogClose>
            {editable ? <Button disabled={busy || !changed} onClick={() => void save()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{busy ? labels.saving : labels.save}</Button> : null}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  </>;
}
