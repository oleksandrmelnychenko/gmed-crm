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
import { DatevActionButton } from "./action-button";
import { operationDescription } from "./operation-text";
import { DatevReadiness } from "./readiness";
import { DatevSetupSection } from "./setup-section";

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
      window.dispatchEvent(new Event("gmed-datev-profile-saved"));
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

  if (loading) return <DatevSetupSection title={text.connectionStatus}><p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{copy.loading}</p></DatevSetupSection>;
  if (!setup || !draft || error === "loadError") return <DatevSetupSection title={text.connectionStatus}><p role="alert" className="text-xs leading-5 text-destructive">{copy.loadError}</p><Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={reload}>{copy.reload}</Button></DatevSetupSection>;
  const valid = profileNumbersValid(draft);

  return <div className="min-w-0 space-y-3">
    <DatevSetupSection title={lang === "de" ? "Buchhaltungsprofil" : "Профиль бухгалтерии"} bodyClassName="p-0" action={<Badge variant="secondary"><Eye aria-hidden className="mr-1 size-3" />{lang === "de" ? "Eigene Angaben" : "Указанные сведения"}</Badge>}>
      <dl className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2">
        {[[text.company, setup.profile.company_name || text.notSelected], [copy.selectedModules, String(setup.profile.modules.length)]].map(([label, value]) =>
          <div key={label} className="min-w-0 bg-card px-3.5 py-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1.5 break-words text-sm font-medium">{value}</dd></div>)}
      </dl>
    </DatevSetupSection>
    <DatevReadiness profile={setup.profile} dirty={dirty} />
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
      <form className="min-w-0 space-y-3" onSubmit={(event) => { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(); }}>
        <DatevSetupSection title={copy.profile} description={copy.profileHint}>
          <fieldset disabled={saving} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2"><span>{copy.companyName}</span><Input className="h-9 bg-field font-normal text-foreground" value={draft.company_name} maxLength={160} onChange={(e) => edit({ company_name: e.target.value })} autoComplete="off" /></label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground"><span>{copy.consultant}</span><Input className="h-9 bg-field font-normal text-foreground" value={draft.consultant_number} inputMode="numeric" maxLength={7} aria-invalid={!valid} aria-describedby="datev-numbers-hint" onChange={(e) => edit({ consultant_number: e.target.value })} autoComplete="off" /></label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground"><span>{copy.client}</span><Input className="h-9 bg-field font-normal text-foreground" value={draft.client_number} inputMode="numeric" maxLength={5} aria-invalid={!valid} aria-describedby="datev-numbers-hint" onChange={(e) => edit({ client_number: e.target.value })} autoComplete="off" /></label>
            <p id="datev-numbers-hint" className={`text-xs leading-5 sm:col-span-2 ${valid ? "text-muted-foreground" : "text-destructive"}`}>{valid ? copy.numbersHint : copy.invalidNumbers}</p>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2"><span>{copy.version}</span><Input className="h-9 bg-field font-normal text-foreground" value={draft.belege_version} placeholder={copy.versionPlaceholder} maxLength={80} onChange={(e) => edit({ belege_version: e.target.value })} /></label>
          </fieldset>
        </DatevSetupSection>
        <DatevSetupSection title={copy.modules} description={copy.modulesHint} action={<Badge variant="secondary">{draft.modules.length} / {DATEV_MODULES.length}</Badge>}>
          <fieldset disabled={saving} className="min-w-0 divide-y divide-border/60">
            {DATEV_MODULES.map((id) => <div key={id} className="py-3 first:pt-0 last:pb-0" data-testid={`datev-module-${id}`}>
              <label className="flex cursor-pointer items-start gap-3 text-sm font-medium">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={draft.modules.includes(id)} onChange={(e) => edit({ modules: DATEV_MODULES.filter((module) => module === id ? e.target.checked : draft.modules.includes(module)) })} />
                <span className="min-w-0 break-words">{DATEV_MODULE_NAMES[id]}</span>
              </label>
              <p className="ml-7 mt-1.5 text-xs leading-5 text-muted-foreground">{copy[id]}</p>
              <p className="ml-7 mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"><LockKeyhole aria-hidden className="mt-1 size-3 shrink-0" />{copy.moduleUnavailable}</p>
            </div>)}
          </fieldset>
        </DatevSetupSection>
        <DatevSetupSection title={copy.exportService} description={copy.exportHint}>
          <NativeComboboxSelect id="datev-export-service" aria-label={copy.exportService} disabled={saving} className="h-9 w-full bg-field text-sm font-normal" value={draft.export_service} onChange={(e) => edit({ export_service: e.target.value as DatevProfile["export_service"] })}>
            <option value="unknown">{copy.unknown}</option><option value="not_ordered">{copy.notOrdered}</option><option value="ordered">{copy.ordered}</option>
          </NativeComboboxSelect>
          <p className="text-xs leading-5 text-muted-foreground">{copy.serviceUnverified}</p>
        </DatevSetupSection>
        {error ? <div role="alert" className="space-y-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"><p>{copy[error]}</p>{error === "conflict" ? <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={reload}>{copy.reload}</Button> : null}</div> : null}
        {saved ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{copy.saved}</p> : null}
        <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <span className="text-xs leading-5 text-muted-foreground sm:mr-auto">{dirty ? copy.unsaved : setup.updated_at ? `${copy.savedAt}: ${new Date(setup.updated_at).toLocaleString(lang === "de" ? "de-DE" : "ru-RU")}` : null}</span>
          {dirty ? <Button type="button" variant="outline" size="sm" className="h-9 rounded-md sm:h-8" disabled={saving} onClick={() => { setDraft(setup.profile); setSaved(false); setError(null); }}>{copy.reset}</Button> : null}
          <DatevActionButton type="submit" size="sm" title={`DATEV · ${copy.save}`} description={operationDescription("profile", lang === "de")} context={<><p>{draft.company_name}</p><p>Beraternummer: {draft.consultant_number || "—"} · Mandantennummer: {draft.client_number || "—"}</p></>} contextKey={JSON.stringify(draft)} onConfirm={save} disabled={saving || !valid || (!dirty && !!setup.revision)}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}DATEV · {saving ? copy.saving : copy.save}</DatevActionButton>
        </div>
      </form>
      <aside className="min-w-0 space-y-3">
        <DatevSetupSection title={text.systemName}>
          <DatevActionButton size="sm" className="w-full" title={copy.openPortal} description={operationDescription("portal", lang === "de")} onConfirm={() => { window.open(DATEV_PORTAL, "_blank", "noopener,noreferrer"); }}><ArrowUpRight className="size-4" />{copy.openPortal}</DatevActionButton>
          <p className="text-xs leading-5 text-muted-foreground">{copy.portalHint}</p>
          <p className="text-xs leading-5 text-muted-foreground">{lang === "de" ? "Zugangsdaten, Anmeldung und tatsächliche Zugriffsprüfung befinden sich im Abschnitt DATEV-Zugriff oben." : "Ключи, вход и фактическая проверка прав находятся в разделе «Доступ к DATEV» выше."}</p>
        </DatevSetupSection>
        <DatevSetupSection title={copy.next}>
          <ol className="divide-y divide-border/60">
            {[[copy.accessStep, copy.accessStepHint], [copy.authStep, copy.authStepHint], [copy.originalsStep, copy.originalsStepHint]].map(([title, hint], index) => <li key={title} className="flex gap-2.5 py-3 first:pt-0 last:pb-0"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 font-mono text-xs text-muted-foreground">{index + 1}</span><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p></div></li>)}
          </ol>
          <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={DATEV_EXPORT_DOCS} target="_blank" rel="noopener noreferrer">{copy.docs}<ArrowUpRight className="size-3" /></a>
        </DatevSetupSection>
        <section className="space-y-3 rounded-lg border border-border/70 bg-card p-3.5">
          <DatevActionButton size="sm" className="w-full" title={`DATEV · ${copy.brief}`} description={operationDescription("brief", lang === "de")} disabled={dirty || !setup.revision} contextKey={setup.revision ?? ""} onConfirm={downloadBrief}><Download className="size-4 shrink-0" />DATEV · {copy.brief}</DatevActionButton>
          <p className="text-xs leading-5 text-muted-foreground">{copy.briefHint}</p>
        </section>
      </aside>
    </div>
  </div>;
}
