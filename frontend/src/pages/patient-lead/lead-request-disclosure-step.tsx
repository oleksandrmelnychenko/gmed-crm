import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Info, Share2, ShieldCheck, UsersRound } from "lucide-react";
import { cabinetStaffText, useCabinetStaffMode } from "./lead-request-staff-mode";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatPortalTimestamp } from "@/lib/portal-datetime";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CONSENT_RECIPIENTS_INVALID, LEAD_REQUEST_ACCESS_CHANGED, LEAD_REQUEST_GUARDIAN_ONLY, saveLeadTrustedPersons, type StaffConsentRecord } from "./lead-request-api";
import { StaffConsentRecordFields } from "./lead-request-staff-consent";
import { actsAsGuardian } from "./lead-request-access";
import { choiceOnlyByGuardian, choosesForChild } from "./lead-request-consent-form";
import { AutosaveFlushContext, CabinetSection, ConsentGivenChip, InfoNote, StepFooter, errorBody } from "./lead-request-parts";
import type { StepProps } from "./lead-request-step-forms";
import { asLeadCabinetLang } from "./lead-request-text";
import { TrustedPersonsEditor, TrustedPersonsList } from "./lead-trusted-persons-editor";
import { acceptedDefaultNo, disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, draftIndexOfSent, mergeDisclosureDraft, onlyWithdraws, recipientFieldOfServer, recipientsToSend, type DisclosureDraft, type RecipientField } from "./lead-trusted-persons-model";
import { disclosureConsentText, disclosureSubject, disclosureWording, trustedPersonsText } from "./lead-trusted-persons-text";

export function DisclosureStep({ request, text: common, lang, enqueue, onChange, nav }: StepProps) {
  const { user } = useAuth();
  // Staff record the client's decision with how the client gave it, also after the send (owner
  // 2026-10-29): nothing saves on its own, only «Record the consent». The client's saved consent
  // shows as given, whoever of the client's side saved it.
  const staffMode = useCabinetStaffMode();
  const viewerId = staffMode ? undefined : user?.id;
  const text = trustedPersonsText(lang);
  const wording = disclosureWording(text, request);
  const [draft, setDraft] = useState(() => disclosureDraft(request, viewerId));
  const serverKey = JSON.stringify([request.disclosure ?? null, request.trusted_persons ?? null, request.disclosure_company_name ?? null]);
  const [seenServerKey, setSeenServerKey] = useState(serverKey);
  // Only what this person changed here is theirs to save (QA 2026-10-31, B-2: the idle tab of the
  // other parent wrote its old copy back, with a new consent in that parent's name). Set by the
  // person's input alone, never read off the draft: a saved draft differs from the server's in
  // `answered` and the like, and then looked edited for good.
  const [editedHere, setEditedHere] = useState(false);
  const editedRef = useRef(false);
  const markEdited = (edited: boolean) => {
    editedRef.current = edited;
    setEditedHere(edited);
  };
  if (seenServerKey !== serverKey) {
    setSeenServerKey(serverKey);
    if (!editedHere) setDraft(disclosureDraft(request, viewerId));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef<Promise<boolean> | null>(null);
  // The last save only held the step (a missing entry, nothing sent).
  const held = useRef(false);
  const flushers = useContext(AutosaveFlushContext);
  const ownMinor = choiceOnlyByGuardian(request);
  const changed = disclosureChanged(draft, request, viewerId);
  const problem = disclosureProblem(draft);
  const companyName = request.disclosure_company_name?.trim() || request.disclosure?.company_name?.trim() || "GMED";
  const personName = [request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ");
  const [attempted, setAttempted] = useState(false);
  // The consent refers to the final list: a change of the list unticks it, and the step says so
  // once, until the box is ticked again (QA 2026-10-24, A-8).
  const [consentReset, setConsentReset] = useState(false);
  // The person and field the server refused (422 `consent_recipients_invalid` with `field`/`index`).
  const [serverProblem, setServerProblem] = useState<{ index: number; field: RecipientField } | null>(null);
  // Sent requests are read-only (owner 2026-10-26); only a withdrawal stays open: "no" for
  // everybody, or a saved person removed.
  const locked = Boolean(request.submitted_at) && !staffMode;
  // The «No» shown by default is saved nowhere yet: staff record it like any answer (DEV QA 2026-10-30).
  const defaultNoPending = staffMode && !request.disclosure && acceptedDefaultNo(draft, request) !== draft;
  // A blank row is there already: "add a person" would be wrong, what is missing in it is meant.
  const problemMessage = (current: NonNullable<typeof problem>) =>
    current === "consent" ? text.consentRequired
      : current === "required" && draft.persons.length > 0 ? text.invalid
        : text[current];

  // The draft and the request as they are now, also between renders: a save
  // started while another one runs judges what was typed meanwhile, not the
  // closure of an earlier render.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const requestRef = useRef(request);
  requestRef.current = request;
  // The save of the newest render, for the flusher, the timer and a save that waited for another.
  const latest = useRef<{ save: (recorded?: StaffConsentRecord | null) => Promise<boolean>; draft: DisclosureDraft }>({ save: () => Promise.resolve(true), draft });

  const save = useCallback(async (recorded: StaffConsentRecord | null = null): Promise<boolean> => {
    held.current = false;
    if (saving.current) {
      // Typed during the save: saved right after it, never dropped.
      const ok = await saving.current;
      return ok ? latest.current.save(recorded) : false;
    }
    // Nobody saves by passing by, also not on leaving the step (QA 2026-10-31, B-2): not answered
    // counts as «No» anyway (owner 2026-10-22), a click on the shown «No» is an answer.
    if (!editedRef.current && !recorded) return true;
    const base = requestRef.current;
    // Recorded by staff, the «No» shown by default is the client's answer too (DEV QA 2026-10-30).
    const current = recorded ? acceptedDefaultNo(draftRef.current, base) : draftRef.current;
    if (ownMinor) return true;
    if (!disclosureChanged(current, base, viewerId)) {
      // Back at the saved state: nothing of this person's is pending, the server's state follows again.
      markEdited(false);
      return true;
    }
    const problemNow = disclosureProblem(current);
    if (problemNow) {
      // The step stays: every missing entry is marked at its field. Nothing was sent, so no
      // save failed (the page shows no "could not be saved" notice, QA 2026-11-10, A-2).
      setAttempted(true);
      setError(problemMessage(problemNow));
      held.current = true;
      return false;
    }
    // Staff save only with how the client gave the decision (server: 422 `consent_recorded_how_required`).
    if (staffMode && !recorded) {
      setError(cabinetStaffText(lang).recordFirst);
      return false;
    }
    // After the send only a withdrawal is saved; the server refuses anything else too (not from staff).
    if (base.submitted_at && !staffMode && !onlyWithdraws(current, base)) {
      // The request was sent meanwhile (the other parent, another tab): what was typed here can
      // never be saved. It goes, the step shows what GMED has, and nobody is held on the step for
      // it (QA 2026-11-10, A-1: the locked view has no field left to correct).
      const stored = disclosureDraft(base, viewerId);
      draftRef.current = stored;
      markEdited(false);
      setDraft(stored);
      setError(common.sentChangeRefused);
      return true;
    }
    setBusy(true);
    setError("");
    const pending = (async () => {
      try {
        const baseline = disclosureDraft(base, viewerId);
        const saved = await enqueue(() => saveLeadTrustedPersons(base.lead_id, disclosureToSend(current, asLeadCabinetLang(lang) ?? "ru"), recorded));
        // The server's state for what stayed as sent; an edit made while the save ran stays and is saved next.
        const merged = mergeDisclosureDraft(draftRef.current, current, disclosureDraft(saved, viewerId), baseline);
        if (JSON.stringify(draftRef.current) === JSON.stringify(current)) markEdited(false);
        draftRef.current = merged;
        requestRef.current = saved;
        setDraft(merged);
        setServerProblem(null);
        onChange(saved);
        return true;
      } catch (cause) {
        const body = errorBody(cause);
        const code = body?.code;
        // The person and field the server named, marked at that field (owner 2026-10-26).
        const field = code === CONSENT_RECIPIENTS_INVALID ? recipientFieldOfServer(body?.field) : null;
        const index = field ? draftIndexOfSent(current.persons, body?.index) : null;
        setServerProblem(field && index !== null ? { index, field } : null);
        if (field && index !== null) setAttempted(true);
        setError(code === "request_already_sent" ? common.sentChangeRefused
          : code === CONSENT_RECIPIENTS_INVALID ? text.invalid
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
  }, [ownMinor, problemMessage, text, enqueue, lang, staffMode, viewerId, onChange, common.errors.request_failed, common.sentChangeRefused]);

  // Leaving via a tab, Next or another child's request saves a valid choice
  // in the shared queue. A failed/incomplete draft stays visible for correction.
  latest.current = { save, draft };
  useEffect(() => {
    const flush = { save: () => latest.current.save(), version: () => JSON.stringify(latest.current.draft), held: () => held.current };
    flushers?.add(flush);
    return () => { flushers?.delete(flush); };
  }, [flushers]);
  useEffect(() => {
    // Only an explicit, complete decision is saved; viewing another parent's
    // choice does not turn it into this parent's consent. Staff save by recording only.
    if (!changed || !editedHere || problem || ownMinor || staffMode) return;
    const timer = window.setTimeout(() => { void latest.current.save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, changed, editedHere, problem, ownMinor, staffMode]);
  useEffect(() => {
    if (!changed && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed, busy]);

  function update(patch: Partial<DisclosureDraft>) {
    // The ref first: a save that ends in this moment merges with what is typed now.
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    markEdited(true);
    setDraft(next);
    setError("");
    setServerProblem(null);
  }

  if (ownMinor) return <p className="text-sm text-muted-foreground" data-testid="lead-request-guardian-only">{common.guardianOnly}</p>;

  // Only a save state gets a chip: the chosen radio already shows the answer, also the default
  // "no" (owner decision 2026-10-22), so no "(default)" chip next to it (labels audit 2026-10-26, A4/B9).
  const state = busy || changed || request.disclosure ? <StatusChip tone={busy || changed ? "warning" : "success"} role="status" data-testid="trusted-persons-save-state">
    {!busy && !changed ? <Check aria-hidden="true" /> : null}
    {busy ? common.saving : changed ? text.unsaved : text.saved}
  </StatusChip> : null;
  // The other parent's saved choice is named once as a sentence; the own one needs no receipt (A2).
  // Staff see no such sentence: they record the client's own choice.
  const savedByOther = request.disclosure && viewerId && request.disclosure.chosen_by !== viewerId ? request.disclosure : null;
  // After the send: the decision read-only; changes and withdrawals via GMED (owner 2026-10-26).
  const lockedAllow = draft.allowDisclosure === true;

  if (locked) return <section className="flex flex-col gap-3" data-testid="lead-request-disclosure-step">
    <StatusChip tone="success" role="note" className="items-start gap-2 px-3 py-1.5" data-testid="disclosure-locked-hint">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{common.sentLockedHint}</span>
    </StatusChip>
    <CabinetSection compact icon={Share2} title={text.title} accessory={state}>
      <div className="space-y-3" data-testid="disclosure-locked">
        <div className="flex flex-wrap items-center gap-2" data-testid="disclosure-locked-decision">
          <span className="font-mono text-xs font-medium text-foreground/75">{text.lockedDecision}:</span>
          <StatusChip tone={lockedAllow ? "success" : "neutral"}>{lockedAllow ? text.yes : wording.no}</StatusChip>
        </div>
        {lockedAllow ? <>
          {/* Sent is sent (owner 2026-10-26): no removal or withdrawal here, only via GMED. */}
          <TrustedPersonsList persons={recipientsToSend(draft.persons)} lang={lang} disabled={busy} />
          <div data-testid="disclosure-locked-via-gmed">
            <InfoNote>{text.lockedWithdrawHint}</InfoNote>
          </div>
        </> : null}
      </div>
    </CabinetSection>
    {error ? <StatusChip tone="error" role="alert" className="rounded-lg px-3 py-2 text-sm"><CircleAlert aria-hidden="true" />{error}</StatusChip> : null}
    {savedByOther ? <p className="px-1 text-xs leading-5 text-muted-foreground" data-testid="disclosure-receipt">{text.savedByOther(savedByOther.chosen_by_name?.trim() || text.otherParent, formatPortalTimestamp(savedByOther.chosen_at))}</p> : null}
    <StepFooter>
      <Button type="button" variant="outline" className="h-9" disabled={busy || !nav.onBack} onClick={() => nav.onBack?.()}><ArrowLeft aria-hidden="true" className="size-3.5" />{common.back}</Button>
      <Button type="button" className="h-9" disabled={busy || !nav.onNext} onClick={() => nav.onNext?.()}>{common.next}<ArrowRight aria-hidden="true" className="size-3.5" /></Button>
    </StepFooter>
  </section>;

  return <section className="flex flex-col gap-3" data-testid="lead-request-disclosure-step">
    <CabinetSection icon={Share2} title={text.title} accessory={state}>
      <div className="space-y-3" data-testid="trusted-persons-form">
        {/* A child's parents read "your child … to you as parents" in the introduction already (B10). */}
        {actsAsGuardian(request) && !choosesForChild(request) ? <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm leading-6">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>{text.representativeContext(personName)}</p>
        </div> : null}
        <p className="text-sm leading-6 text-foreground/85">{wording.introduction}</p>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="mb-3 text-sm font-semibold">{text.question}</legend>
          <div className="grid gap-2 xl:grid-cols-2">
            {[false, true].map((allow) => <label key={String(allow)} className={cn(
              "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm leading-6 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              draft.allowDisclosure === allow ? "border-primary bg-primary font-medium text-primary-foreground" : "border-border bg-card hover:border-primary hover:bg-muted/40",
              busy && "cursor-wait",
            )}>
              <input type="radio" name={`disclosure-${request.lead_id}`} aria-label={allow ? text.yes : wording.no} className="mt-1 size-4 shrink-0 accent-current" checked={draft.allowDisclosure === allow} data-testid={allow ? "disclosure-yes" : "disclosure-no"} onChange={() => { setConsentReset(false); update({ allowDisclosure: allow, consentGiven: false, answered: true }); }}
                // The default "no" is shown as chosen already: a click on it changes nothing, yet
                // it is the person's own answer and is saved as such (QA 2026-10-25, E-13).
                onClick={() => { if (draftRef.current.allowDisclosure === allow && !draftRef.current.answered) update({ answered: true }); }} />
              <span>{allow ? text.yes : wording.no}</span>
            </label>)}
          </div>
        </fieldset>
      </div>
    </CabinetSection>

    {draft.allowDisclosure === true ? <>
      <CabinetSection icon={UsersRound} title={text.personsHeading}>
        <TrustedPersonsEditor persons={draft.persons} lang={lang} disabled={busy} showErrors={attempted} serverProblem={serverProblem} onChange={(persons) => {
          if (draftRef.current.consentGiven) setConsentReset(true);
          update({ persons, consentGiven: false });
        }} />
      </CabinetSection>
      <CabinetSection icon={ShieldCheck} title={text.consentHeading}>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/25 p-3.5 text-sm leading-6">
          <input type="checkbox" aria-label={disclosureConsentText(lang, companyName, disclosureSubject(request))} className={`${checkboxClass} mt-1 shrink-0`} checked={draft.consentGiven} disabled={busy} data-testid="disclosure-consent"
            // Marked once a step change was held for it: «Next» then leads to the box itself, not
            // to the message under the long text (QA 2026-11-10, A-2).
            aria-invalid={attempted && problem === "consent" ? true : undefined} onChange={(event) => { setConsentReset(false); update({ consentGiven: event.currentTarget.checked }); }} />
          <span>{disclosureConsentText(lang, companyName, disclosureSubject(request))}</span>
        </label>
        {/* The consent staff recorded says when it was given, as the single consents do (owner 2026-10-30). */}
        {staffMode && !changed && !busy && draft.consentGiven && request.disclosure?.consent_given ? <div data-testid="disclosure-consent-given">
          <ConsentGivenChip>{common.consentGivenAt(formatPortalTimestamp(request.disclosure.chosen_at))}</ConsentGivenChip>
        </div> : null}
        {consentReset && !draft.consentGiven ? <p role="status" className="px-1 text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="disclosure-consent-reset">{text.consentReset}</p> : null}
        <a className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand)] underline underline-offset-4" href={`/legal?notice=form&lang=${lang}#privacy`} target="_blank" rel="noreferrer"><ShieldCheck aria-hidden="true" className="size-3.5" />{text.privacy}</a>
      </CabinetSection>
    </> : null}

    {staffMode && (changed || defaultNoPending) && !problem ? (
      <StaffConsentRecordFields lang={lang} testId="disclosure" busy={busy}
        hint={changed ? cabinetStaffText(lang).recordChanges : cabinetStaffText(lang).recordDefaultNo}
        onRecord={(recorded) => void latest.current.save(recorded)} />
    ) : null}
    {error || (changed && problem) ? <StatusChip tone={error ? "error" : "warning"} role={error ? "alert" : "status"} className="rounded-lg px-3 py-2 text-sm">
      <CircleAlert aria-hidden="true" />{error || problemMessage(problem!)}
    </StatusChip> : null}
    {draft.allowDisclosure === true ? <p className="px-1 text-xs leading-5 text-muted-foreground">{text.footer}</p> : null}
    {savedByOther ? <p className="px-1 text-xs leading-5 text-muted-foreground" data-testid="disclosure-receipt">{text.savedByOther(savedByOther.chosen_by_name?.trim() || text.otherParent, formatPortalTimestamp(savedByOther.chosen_at))}</p> : null}
    <StepFooter>
      <Button type="button" variant="outline" className="h-9" disabled={busy || !nav.onBack} onClick={() => nav.onBack?.()}><ArrowLeft aria-hidden="true" className="size-3.5" />{common.back}</Button>
      <Button type="button" className="h-9" disabled={busy || !nav.onNext} onClick={() => nav.onNext?.()}>{common.next}<ArrowRight aria-hidden="true" className="size-3.5" /></Button>
    </StepFooter>
  </section>;
}
