import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CONSENT_RECIPIENTS_INVALID, LEAD_REQUEST_ACCESS_CHANGED, LEAD_REQUEST_GUARDIAN_ONLY, saveLeadTrustedPersons } from "./lead-request-api";
import { choiceOnlyByGuardian, choosesForChild } from "./lead-request-consent-form";
import { AutosaveFlushContext, CabinetSection, StepFooter, errorBody } from "./lead-request-parts";
import type { StepProps } from "./lead-request-step-forms";
import { asLeadCabinetLang } from "./lead-request-text";
import { TrustedPersonsEditor } from "./lead-trusted-persons-editor";
import { disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, type DisclosureDraft } from "./lead-trusted-persons-model";
import { disclosureConsentText, disclosureSubject, trustedPersonsText } from "./lead-trusted-persons-text";

export function DisclosureStep({ request, text: common, lang, enqueue, onChange, nav }: StepProps) {
  const { user } = useAuth();
  const text = trustedPersonsText(lang);
  const [draft, setDraft] = useState(() => disclosureDraft(request, user?.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef<Promise<boolean> | null>(null);
  const flushers = useContext(AutosaveFlushContext);
  const ownMinor = choiceOnlyByGuardian(request);
  const changed = disclosureChanged(draft, request, user?.id);
  const problem = disclosureProblem(draft);
  const companyName = request.disclosure_company_name?.trim() || request.disclosure?.company_name?.trim() || "GMED";
  const personName = [request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ");
  const [attempted, setAttempted] = useState(false);
  // A blank row is there already: "add a person" would be wrong, what is missing in it is meant.
  const problemMessage = (current: NonNullable<typeof problem>) =>
    current === "consent" ? text.consentRequired
      : current === "required" && draft.persons.length > 0 ? text.invalid
        : text[current];

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (!changed || ownMinor) return true;
    if (problem) {
      // The step stays: every missing entry is marked at its field.
      setAttempted(true);
      setError(problemMessage(problem));
      return false;
    }
    setBusy(true);
    setError("");
    const pending = (async () => {
      try {
        const saved = await enqueue(() => saveLeadTrustedPersons(request.lead_id, disclosureToSend(draft, asLeadCabinetLang(lang) ?? "ru")));
        setDraft(disclosureDraft(saved, user?.id));
        onChange(saved);
        return true;
      } catch (cause) {
        const code = errorBody(cause)?.code;
        setError(code === CONSENT_RECIPIENTS_INVALID ? text.invalid
          : code === "disclosure_consent_required" ? text.consentRequired
          : code === "disclosure_version_outdated" ? text.outdated
          : code === "consent_recipients_required" ? text.required
          : code === "disclosure_decision_invalid" ? text.decision : common.errors.request_failed);
        if (code === LEAD_REQUEST_GUARDIAN_ONLY || cause instanceof ApiRequestError && (cause.status === 403 || cause.status === 404)) {
          window.dispatchEvent(new Event(LEAD_REQUEST_ACCESS_CHANGED));
        }
        return false;
      } finally {
        saving.current = null;
        setBusy(false);
      }
    })();
    saving.current = pending;
    return pending;
  }, [changed, ownMinor, problem, text, enqueue, request.lead_id, draft, lang, user?.id, onChange, common.errors.request_failed]);

  // Leaving via a tab, Next or another child's request saves a valid choice
  // in the shared queue. A failed/incomplete draft stays visible for correction.
  const latest = useRef({ save, draft });
  latest.current = { save, draft };
  useEffect(() => {
    const flush = { save: () => latest.current.save(), version: () => JSON.stringify(latest.current.draft) };
    flushers?.add(flush);
    return () => { flushers?.delete(flush); };
  }, [flushers]);
  useEffect(() => {
    // Only an explicit, complete decision is saved; viewing another parent's
    // choice does not turn it into this parent's consent.
    if (!changed || problem || ownMinor) return;
    const timer = window.setTimeout(() => { void latest.current.save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, changed, problem, ownMinor]);
  useEffect(() => {
    if (!changed && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed, busy]);

  function update(patch: Partial<DisclosureDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  }

  if (ownMinor) return <p className="text-sm text-muted-foreground" data-testid="lead-request-guardian-only">{common.guardianOnly}</p>;

  const state = <StatusChip tone={changed ? "warning" : request.disclosure ? "success" : "neutral"} role="status" data-testid="trusted-persons-save-state">
    {!changed && request.disclosure ? <Check aria-hidden="true" /> : null}
    {busy ? common.saving : changed ? text.unsaved : request.disclosure ? text.saved : text.unanswered}
  </StatusChip>;

  return <section className="space-y-4" data-testid="lead-request-disclosure-step">
    <CabinetSection title={text.title} accessory={state}>
      <div className="space-y-4" data-testid="trusted-persons-form">
        {request.access_kind === "guardian" ? <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm leading-6">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>{choosesForChild(request) ? text.guardianContext(personName) : text.representativeContext(personName)}</p>
        </div> : null}
        <p className="text-sm leading-6 text-muted-foreground">{text.introduction}</p>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="mb-3 text-sm font-semibold">{text.question}</legend>
          <div className="grid gap-2.5 xl:grid-cols-2">
            {[false, true].map((allow) => <label key={String(allow)} className={cn(
              "flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm leading-6 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              draft.allowDisclosure === allow ? "border-[var(--brand)] bg-[var(--brand)] font-medium text-white" : "border-border bg-card hover:border-[var(--brand)]",
              busy && "cursor-wait",
            )}>
              <input type="radio" name={`disclosure-${request.lead_id}`} className="mt-1 size-4 shrink-0 accent-current" checked={draft.allowDisclosure === allow} data-testid={allow ? "disclosure-yes" : "disclosure-no"} onChange={() => update({ allowDisclosure: allow, consentGiven: false })} />
              <span>{allow ? text.yes : text.no}</span>
            </label>)}
          </div>
        </fieldset>
      </div>
    </CabinetSection>

    {draft.allowDisclosure === true ? <>
      <CabinetSection title={text.personsHeading}>
        <TrustedPersonsEditor persons={draft.persons} lang={lang} disabled={busy} showErrors={attempted} onChange={(persons) => update({ persons, consentGiven: false })} />
      </CabinetSection>
      <CabinetSection title={text.consentHeading}>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/25 p-3.5 text-sm leading-6">
          <input type="checkbox" className={`${checkboxClass} mt-1 shrink-0`} checked={draft.consentGiven} disabled={busy} data-testid="disclosure-consent" onChange={(event) => update({ consentGiven: event.currentTarget.checked })} />
          <span>{disclosureConsentText(lang, companyName, disclosureSubject(request))}</span>
        </label>
        <a className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand)] underline underline-offset-4" href={`/legal?notice=form&lang=${lang}#privacy`} target="_blank" rel="noreferrer"><ShieldCheck aria-hidden="true" className="size-3.5" />{text.privacy}</a>
      </CabinetSection>
    </> : null}

    {error || (changed && problem) ? <StatusChip tone={error ? "error" : "warning"} role={error ? "alert" : "status"} className="rounded-lg px-3 py-2 text-sm">
      <CircleAlert aria-hidden="true" />{error || problemMessage(problem!)}
    </StatusChip> : null}
    <p className="px-1 text-xs leading-5 text-muted-foreground">{text.footer}</p>
    {request.disclosure ? <p className="px-1 font-mono text-[11px] leading-5 text-muted-foreground" data-testid="disclosure-receipt">{text.saved} · {formatAppDateTime(request.disclosure.chosen_at)}{request.disclosure.chosen_by_name ? ` · ${request.disclosure.chosen_by_name}` : ""}</p> : null}
    <StepFooter index={nav.index} total={nav.total} text={common}>
      <Button type="button" variant="outline" className="h-9" disabled={busy || !nav.onBack} onClick={() => nav.onBack?.()}><ArrowLeft aria-hidden="true" className="size-3.5" />{common.back}</Button>
      <Button type="button" className="h-9" disabled={busy || !nav.onNext} onClick={() => nav.onNext?.()}>{common.next}<ArrowRight aria-hidden="true" className="size-3.5" /></Button>
    </StepFooter>
  </section>;
}
