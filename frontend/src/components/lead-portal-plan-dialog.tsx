import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Info, LoaderCircle, LockKeyhole, PackageCheck, UserRound } from "lucide-react";

import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
import {
  fetchLeadPortalPlanCatalogue,
  requestLeadPortalPlan,
  type LeadPortalPlanCatalogue,
} from "@/lib/lead-portal-plan-requests";
import { cn } from "@/lib/utils";
import { fetchMyLeadRequests } from "@/pages/patient-lead/lead-request-api";
import type { LeadCabinetLang } from "@/pages/patient-lead/lead-request-text";
import { leadShellText } from "@/pages/patient-lead/lead-shell-text";

type RequestChoice = { id: string; name: string };

/** The dialog speaks the cabinet language (DE, EN, UA, RU), like the side bar that opens it. */
export function LeadPortalPlanDialog({ lang, moduleId, moduleLabel, features, onClose }: {
  lang: LeadCabinetLang;
  moduleId: string;
  moduleLabel: string;
  /** The portal's areas, listed when the one entry "what comes after your request" opens it (owner 2026-10-26, C1). */
  features?: readonly string[];
  onClose: () => void;
}) {
  const text = leadShellText(lang).planDialog;
  const generation = useRef(0);
  const [choices, setChoices] = useState<RequestChoice[]>([]);
  const [leadId, setLeadId] = useState("");
  const [catalogue, setCatalogue] = useState<LeadPortalPlanCatalogue | null>(null);
  const [packageId, setPackageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "submit" | null>(null);
  const [result, setResult] = useState<"sent" | "existing" | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    void fetchMyLeadRequests().then(async (requests) => {
      if (!active || generation.current !== version) return;
      const nextChoices = requests.map((request) => ({
        id: request.lead_id,
        name: [request.personal_data.first_name, request.personal_data.middle_name, request.personal_data.last_name]
          .filter(Boolean).join(" ") || text.unnamed,
      }));
      setChoices(nextChoices);
      // A parent may have several children's requests: never silently choose
      // the first child's request for this independent interest form.
      const selected = nextChoices.length === 1 ? nextChoices[0].id : "";
      setLeadId(selected);
      if (!selected) return;
      const next = await fetchLeadPortalPlanCatalogue(selected);
      if (active && generation.current === version) setCatalogue(next);
    }).catch(() => {
      if (active && generation.current === version) setError("load");
    }).finally(() => {
      if (active && generation.current === version) setLoading(false);
    });
    return () => { active = false; generation.current += 1; };
  }, [retryVersion, text.unnamed]);

  async function selectRequest(nextLeadId: string) {
    if (!choices.some((choice) => choice.id === nextLeadId)) return;
    const version = ++generation.current;
    setLeadId(nextLeadId);
    setPackageId("");
    setCatalogue(null);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const next = await fetchLeadPortalPlanCatalogue(nextLeadId);
      if (generation.current === version) setCatalogue(next);
    } catch {
      if (generation.current === version) setError("load");
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }

  const pending = catalogue?.requests.some((request) =>
    request.package_id === packageId && request.module_id === moduleId && request.status === "pending",
  ) ?? false;

  async function submit() {
    if (loading || saving || pending || !leadId || !catalogue?.packages.some((plan) => plan.id === packageId)) return;
    const version = generation.current;
    setSaving(true);
    setError(null);
    try {
      const response = await requestLeadPortalPlan(leadId, packageId, moduleId);
      if (generation.current !== version) return;
      setCatalogue((previous) => previous ? {
        ...previous,
        requests: [...previous.requests.filter((request) => request.id !== response.request.id), response.request],
      } : previous);
      setResult(response.created ? "sent" : "existing");
    } catch {
      if (generation.current === version) setError("submit");
    } finally {
      if (generation.current === version) setSaving(false);
    }
  }

  return (
    <Dialog open dirty={false} allowImplicitDismissal onOpenChange={(open) => { if (!open) onClose(); }}>
      <AdminDialogScaffold
        testId="lead-portal-plan-dialog"
        title={<span className="flex items-center gap-2.5"><PackageCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--brand)]" />{features ? moduleLabel : `${text.title}: ${moduleLabel}`}</span>}
        maxWidthClassName="sm:max-w-[760px]"
        bodyClassName="space-y-3 bg-muted"
        footer={<div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5">
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>{text.close}</Button>
          <Button type="button" className="h-9 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" data-testid="lead-portal-plan-submit" onClick={() => void submit()}
            disabled={loading || saving || !packageId || pending || !catalogue?.packages.length}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-4" aria-hidden="true" />}
            {pending ? text.pending : text.submit}
          </Button>
        </div>}
      >
        {features ? <AdminFormSection title={text.title} className="space-y-2 p-3">
          <p className="text-xs leading-5 text-foreground/75">{text.featuresIntro}</p>
          <ul className="grid gap-x-5 sm:grid-cols-2" data-testid="lead-portal-plan-features">
            {features.map((feature) => <li key={feature} className="flex min-h-8 min-w-0 items-center gap-2 border-b border-border/50 py-1.5 text-xs leading-5">
              <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0 text-foreground/60" />
              <span className="min-w-0 break-words">{feature}</span>
            </li>)}
          </ul>
        </AdminFormSection> : null}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1"><p>{text.explanation}</p><p className="font-semibold">{text.disclaimer}</p></div>
        </div>
        {choices.length ? <AdminFormSection title={text.forRequest} className={cn("p-3", choices.length === 1 && "flex flex-wrap items-center gap-x-3 gap-y-2 space-y-0")}>
          {choices.length > 1 ? <div className="space-y-1.5">
            <label htmlFor="lead-portal-plan-request" className="font-mono text-xs font-medium text-foreground/75">{text.request}</label>
            <NativeComboboxSelect id="lead-portal-plan-request" aria-label={text.request} value={leadId}
              hidePlaceholderOption disabled={saving} onChange={(event) => void selectRequest(event.target.value)}>
              <option value="">{text.request}</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
            </NativeComboboxSelect>
          </div> : <StatusChip tone="warning" className="max-w-full gap-1.5 px-2.5 text-xs" data-testid="lead-portal-plan-request-name"><UserRound aria-hidden="true" /><span className="min-w-0 break-words">{choices[0].name}</span></StatusChip>}
        </AdminFormSection> : null}
        {loading ? <p role="status" className="flex items-center gap-2 p-2 text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{text.loading}</p> : null}
        {error ? <div role="alert" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <p>{error === "load" ? text.error : text.submitError}</p>
          {error === "load" ? <Button type="button" variant="outline" onClick={() => {
            setCatalogue(null); setPackageId(""); setResult(null); setRetryVersion((value) => value + 1);
          }}>{text.retry}</Button> : null}
        </div> : null}
        {!loading && !error && !choices.length ? <p className="p-2 text-muted-foreground">{text.unavailable}</p> : null}
        {!loading && catalogue ? <AdminFormSection title={text.packages} className="space-y-2.5 p-3">
          {catalogue.packages.length ? <fieldset aria-label={text.packages} className="grid min-w-0 gap-2 sm:grid-cols-2">
            {catalogue.packages.map((plan) => <label key={plan.id} className={cn(
              "relative flex min-h-14 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs leading-5 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              packageId === plan.id ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-sm" : "border-border bg-card hover:border-[var(--brand)] hover:bg-muted/40",
              saving && "pointer-events-none",
            )}>
              <input type="radio" name="lead-portal-plan" value={plan.id} aria-label={plan.name} checked={packageId === plan.id}
                disabled={saving} className="peer sr-only"
                onChange={() => { setPackageId(plan.id); setResult(null); setError(null); }} />
              <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", packageId === plan.id ? "border-white bg-white text-[var(--brand)]" : "border-muted-foreground/50 bg-background")}>
                {packageId === plan.id ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 break-words font-medium">{plan.name}</span>
            </label>)}
          </fieldset> : <p className="text-muted-foreground">{text.empty}</p>}
        </AdminFormSection> : null}
        {result ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{result === "sent" ? text.sent : text.existing}
        </div> : null}
      </AdminDialogScaffold>
    </Dialog>
  );
}
