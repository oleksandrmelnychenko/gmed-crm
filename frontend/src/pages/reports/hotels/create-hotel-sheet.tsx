import { useEffect, useState } from "react";
import { CircleAlert, Hotel, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { createProvider, fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import { blankProviderForm, toProviderPayload } from "@/pages/providers/model/list-model";
import type { ProviderFormState } from "@/pages/providers/model/types";
import type { HotelDirectoryItem } from "./model";
import { createHotelCopy } from "./copy";

export function CreateHotelSheet({ lang, onClose, onCreated }: { lang: Lang; onClose: () => void; onCreated: (hotel: HotelDirectoryItem) => void }) {
  const labels = createHotelCopy[lang];
  const [form, setForm] = useState(() => blankProviderForm("non_medical"));
  const [taxonomy, setTaxonomy] = useState<string | null>(null), [taxonomyError, setTaxonomyError] = useState(false), [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [createdHotel, setCreatedHotel] = useState<HotelDirectoryItem | null>(null);
  useEffect(() => {
    let active = true; setTaxonomyError(false);
    void fetchProviderTaxonomy("non_medical").then(result => {
      if (!active) return;
      const node = result.nodes.find(node => node.code === "nonmedical_hotels" && node.is_active && node.is_assignable);
      if (node) setTaxonomy(node.id); else setTaxonomyError(true);
    }).catch(() => { if (active) setTaxonomyError(true); });
    return () => { active = false; };
  }, [attempt]);
  const dirty = !createdHotel && (busy || JSON.stringify(form) !== JSON.stringify(blankProviderForm("non_medical")));
  function field(key: keyof ProviderFormState, value: string) { setForm(current => ({ ...current, [key]: value })); setError(""); }
  async function save() {
    if (busy || createdHotel || !taxonomy || !form.name.trim()) return;
    setBusy(true); setError("");
    try {
      const contacts = ([['phone', form.phone], ['email', form.email]] as const).filter(([, value]) => value.trim()).map(([kind, value]) => ({ id: crypto.randomUUID(), contactKind: kind, contactType: "work" as const, label: "", department: "", value: value.trim(), isPrimary: true, notes: "" }));
      const created = await createProvider(toProviderPayload({ ...form, taxonomyNodeId: taxonomy, contacts }, true));
      clearApiCache("/providers"); clearApiCache("/stats/reports/hotels/directory");
      setCreatedHotel({ id: created.id, name: form.name.trim(), city: form.addressCity.trim() || null, country: form.addressCountry.trim() || null });
    } catch { setError(labels.error); }
    finally { setBusy(false); }
  }
  const sections = [
    { title: lang === "ru" ? "Данные гостиницы" : "Hoteldaten", fields: [["name", labels.name, "text"], ["legalName", labels.legal, "text"]] },
    { title: lang === "ru" ? "Адрес" : "Adresse", fields: [["addressCity", labels.city, "text"], ["addressCountry", labels.country, "text"], ["addressStreet", labels.street, "text"], ["addressZip", labels.zip, "text"]] },
    { title: lang === "ru" ? "Контакты" : "Kontaktdaten", fields: [["phone", labels.phone, "tel"], ["email", labels.email, "email"], ["website", labels.website, "url"]] },
  ] as const;
  // Release the creation form's focus trap before opening the hotel details dialog.
  return <Dialog open={!createdHotel} dirty={dirty} onOpenChange={open => { if (!open && !busy && !createdHotel) onClose(); }} onOpenChangeComplete={open => { if (!open && createdHotel) onCreated(createdHotel); }}><DialogContent className="left-1/2 right-auto top-1/2 bottom-auto flex max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border-border/70 bg-card p-0 pb-0 shadow-2xl sm:max-h-[92dvh] sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:pb-0">
    <DialogHeader className="shrink-0 gap-2 border-b border-border/70 bg-muted/20 px-5 py-4 pr-14">
      <DialogTitle className="flex items-center gap-2.5"><span className="size-2 shrink-0 rounded-full bg-primary" />{labels.add}</DialogTitle>
      <DialogDescription className="flex items-center gap-1.5 text-xs"><Hotel className="size-3.5 text-primary" />{labels.type}</DialogDescription>
    </DialogHeader>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/10 p-4 sm:p-5">
        {sections.map(section => <section key={section.title} className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          <h3 className="flex items-center gap-2.5 border-b border-border/70 bg-muted/15 px-4 py-3 text-sm font-semibold"><span className="size-2 rounded-full bg-primary" />{section.title}</h3>
          <div className="grid gap-3 p-4 sm:grid-cols-2">{section.fields.map(([key, label, type]) => <label key={key} className={`block min-w-0 space-y-1.5 text-xs font-medium text-muted-foreground ${key === "website" ? "sm:col-span-2" : ""}`}><span>{label}{key === "name" ? <span className="ml-1 text-destructive">*</span> : null}</span><Input aria-label={label} value={form[key]} onChange={event => field(key, event.target.value)} type={type} maxLength={key === "name" ? 255 : 500} required={key === "name"} disabled={busy} /></label>)}</div>
        </section>)}
        <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm"><h3 className="flex items-center gap-2.5 border-b border-border/70 bg-muted/15 px-4 py-3 text-sm font-semibold"><span className="size-2 rounded-full bg-primary" />{labels.notes}</h3><div className="p-4"><textarea aria-label={labels.notes} className="min-h-24 w-full resize-y rounded-lg border border-input bg-field p-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/35 disabled:opacity-50" maxLength={4000} value={form.notes} disabled={busy} onChange={event => field("notes", event.target.value)} /><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{labels.hint}</p></div></section>
      </div>
      <footer className="shrink-0 space-y-3 border-t border-border/70 bg-muted/20 px-5 py-3">
        {error || taxonomyError ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><CircleAlert className="size-4 shrink-0" /><span className="min-w-0 flex-1">{error || labels.taxonomyError}</span>{taxonomyError ? <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="size-3.5" />{labels.retry}</Button> : null}</div> : null}
        <div className="flex justify-end gap-2"><DialogClose render={<Button type="button" variant="outline" disabled={busy || Boolean(createdHotel)} />}>{labels.cancel}</DialogClose><Button type="submit" disabled={busy || Boolean(createdHotel) || !taxonomy || !form.name.trim()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{busy ? labels.saving : labels.save}</Button></div>
      </footer>
    </form>
  </DialogContent></Dialog>;
}
