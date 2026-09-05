import { useEffect, useState } from "react";
import { ArrowUpRight, Download, Eye, LoaderCircle, LockKeyhole, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { ApiRequestError } from "@/lib/api";
import { useDatevText } from "./text";
import { DATEV_MODULES, fetchDatevSetup, saveDatevSetup, type DatevProfile, type DatevSetup } from "./setup-api";
import { DATEV_EXPORT_DOCS, DATEV_MODULE_NAMES, DATEV_PORTAL, datevSetupBrief, profileNumbersValid } from "./setup-model";
import { useDatevSetupText } from "./setup-text";

export function DatevConnectionDetails() {
  const { text, lang } = useDatevText();
  const copy = useDatevSetupText();
  const [setup, setSetup] = useState<DatevSetup | null>(null);
  const [draft, setDraft] = useState<DatevProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [error, setError] = useState<"loadError" | "saveError" | "conflict" | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = !!setup && !!draft && JSON.stringify(setup.profile) !== JSON.stringify(draft);

  useEffect(() => {
    let active = true;
    fetchDatevSetup().then((value) => {
      if (active) { setSetup(value); setDraft(value.profile); setError(null); }
    }).catch(() => { if (active) setError("loadError"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadKey]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  function reload() { setLoading(true); setSaved(false); setError(null); setLoadKey((key) => key + 1); }
  function edit(patch: Partial<DatevProfile>) { setDraft((current) => current ? { ...current, ...patch } : null); setSaved(false); }
  async function save() {
    if (!draft || !setup || saving || !profileNumbersValid(draft)) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      const value = await saveDatevSetup(draft, setup.revision);
      setSetup(value); setDraft(value.profile); setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiRequestError && cause.status === 409 ? "conflict" : "saveError");
    } finally { setSaving(false); }
  }
  function downloadBrief() {
    if (!setup) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", datevSetupBrief(setup.profile)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "GMED-DATEV-Checkliste.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (loading) return <p role="status" className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{copy.loading}</p>;
  if (!setup || !draft || error === "loadError") return <section role="alert" className="space-y-3 rounded-xl border p-5"><p>{copy.loadError}</p><Button type="button" variant="outline" onClick={reload}>{copy.reload}</Button></section>;
  const valid = profileNumbersValid(draft);

  return <div className="space-y-4">
    <section aria-label={text.connectionStatus} className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{text.connectionStatus}</h2>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{text.notConnected}</Badge><Badge variant="secondary"><Eye className="mr-1 size-3" />{text.readOnly}</Badge></div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-5 xl:grid-cols-4">
        {[[text.company, setup.profile.company_name || text.notSelected], [copy.selectedModules, String(setup.profile.modules.length)], [text.lastSync, text.never], [text.sending, text.disabled]].map(([label, value]) =>
          <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1.5 break-words text-sm font-medium">{value}</dd></div>)}
      </dl>
    </section>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
      <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">{copy.profile}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.profileHint}</p>
          <fieldset disabled={saving} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm sm:col-span-2"><span>{copy.companyName}</span><Input value={draft.company_name} maxLength={160} onChange={(e) => edit({ company_name: e.target.value })} autoComplete="off" /></label>
            <label className="min-w-0 space-y-2 text-sm"><span>{copy.consultant}</span><Input value={draft.consultant_number} inputMode="numeric" maxLength={7} aria-invalid={!valid} aria-describedby="datev-numbers-hint" onChange={(e) => edit({ consultant_number: e.target.value })} autoComplete="off" /></label>
            <label className="min-w-0 space-y-2 text-sm"><span>{copy.client}</span><Input value={draft.client_number} inputMode="numeric" maxLength={5} aria-invalid={!valid} aria-describedby="datev-numbers-hint" onChange={(e) => edit({ client_number: e.target.value })} autoComplete="off" /></label>
            <p id="datev-numbers-hint" className={`text-xs leading-5 sm:col-span-2 ${valid ? "text-muted-foreground" : "text-destructive"}`}>{valid ? copy.numbersHint : copy.invalidNumbers}</p>
            <label className="space-y-2 text-sm sm:col-span-2"><span>{copy.version}</span><Input value={draft.belege_version} placeholder={copy.versionPlaceholder} maxLength={80} onChange={(e) => edit({ belege_version: e.target.value })} /></label>
          </fieldset>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">{copy.modules}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.modulesHint}</p>
          <fieldset disabled={saving} className="mt-4 min-w-0 divide-y">
            {DATEV_MODULES.map((id) => <div key={id} className="py-4 first:pt-0 last:pb-0" data-testid={`datev-module-${id}`}>
              <label className="flex cursor-pointer items-start gap-3 text-sm font-medium">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={draft.modules.includes(id)} onChange={(e) => edit({ modules: DATEV_MODULES.filter((module) => module === id ? e.target.checked : draft.modules.includes(module)) })} />
                <span className="min-w-0 break-words">{DATEV_MODULE_NAMES[id]}</span>
              </label>
              <p className="ml-7 mt-2 text-sm leading-6 text-muted-foreground">{copy[id]}</p>
              {draft.modules.includes(id) ? <p className="ml-7 mt-2 text-xs text-muted-foreground">{copy.accessPending}</p> : null}
            </div>)}
          </fieldset>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <label className="block text-sm font-semibold" htmlFor="datev-export-service">{copy.exportService}</label>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.exportHint}</p>
          <NativeComboboxSelect id="datev-export-service" aria-label={copy.exportService} disabled={saving} className="mt-3 w-full" value={draft.export_service} onChange={(e) => edit({ export_service: e.target.value as DatevProfile["export_service"] })}>
            <option value="unknown">{copy.unknown}</option><option value="not_ordered">{copy.notOrdered}</option><option value="ordered">{copy.ordered}</option>
          </NativeComboboxSelect>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.serviceUnverified}</p>
        </section>
        {error ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{copy[error]}</p>{error === "conflict" ? <Button type="button" variant="outline" size="sm" onClick={reload}>{copy.reload}</Button> : null}</div> : null}
        {saved ? <p role="status" className="rounded-lg border p-3 text-sm">{copy.saved}</p> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <Button type="submit" disabled={saving || !valid || (!dirty && !!setup.revision)}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? copy.saving : copy.save}</Button>
          {dirty ? <Button type="button" variant="outline" disabled={saving} onClick={() => { setDraft(setup.profile); setSaved(false); setError(null); }}>{copy.reset}</Button> : null}
          <span className="text-xs text-muted-foreground">{dirty ? copy.unsaved : setup.updated_at ? `${copy.savedAt}: ${new Date(setup.updated_at).toLocaleString(lang === "de" ? "de-DE" : "ru-RU")}` : null}</span>
        </div>
      </form>
      <aside className="min-w-0 space-y-4">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{text.systemName}</h2>
          <Button variant="outline" className="w-full" render={<a href={DATEV_PORTAL} target="_blank" rel="noopener noreferrer" />}><ArrowUpRight className="size-4" />{copy.openPortal}</Button>
          <p className="text-xs leading-5 text-muted-foreground">{copy.portalHint}</p>
          <Button type="button" disabled className="w-full"><LockKeyhole className="size-4" />{text.connect}</Button>
          <p className="text-xs leading-5 text-muted-foreground">{text.setupNeeded}</p>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">{copy.next}</h2>
          <ol className="mt-4 space-y-5">
            {[[copy.accessStep, copy.accessStepHint], [copy.authStep, copy.authStepHint], [copy.originalsStep, copy.originalsStepHint]].map(([title, hint], index) => <li key={title} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{index + 1}</span><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{hint}</p></div></li>)}
          </ol>
          <a className="mt-5 inline-flex items-center gap-1 text-xs underline underline-offset-4" href={DATEV_EXPORT_DOCS} target="_blank" rel="noopener noreferrer">{copy.docs}<ArrowUpRight className="size-3" /></a>
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <Button type="button" variant="outline" className="h-auto min-h-9 w-full whitespace-normal py-2 text-left" disabled={dirty || !setup.revision} onClick={downloadBrief}><Download className="size-4 shrink-0" />{copy.brief}</Button>
          <p className="text-xs leading-5 text-muted-foreground">{copy.briefHint}</p>
        </section>
      </aside>
    </div>
  </div>;
}
