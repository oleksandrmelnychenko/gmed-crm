import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { payerPhoneAcceptable } from "@/lib/payer-phone";
import { MAX_UPLOAD_BYTES } from "@/pages/patient-lead/lead-request-model";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "@/pages/patient-lead/lead-request-autosave";

import { PayerLinkError, type PayerLinkClient, type PayerQuestionnaire, type PayerSignaturePackage } from "./payer-link-api";
import {
  answersPatch,
  changedOnServer,
  draftFromQuestionnaire,
  fieldValue,
  fundsSourceOptions,
  missingByStep,
  payerSteps,
  refusedField,
  industryRequired,
  occupationRequired,
  requiredFields,
  stillRejected,
  withRejectedField,
  type PatchContext,
  type PayerDraft,
  type PayerField,
  type PayerStep,
  type RejectedFields,
} from "./payer-link-model";
import { isFatalKind, payerErrorKind, payerErrorMessage, type PayerErrorKind } from "./payer-link-session";
import { Notice, SaveIndicator, useAutosave, useRequestQueue, type RequestQueue, type SaveState } from "./payer-link-parts";
import {
  DeclarationsStep,
  DetailsStep,
  FundsStep,
  IdentityStep,
  OwnersStep,
  PaymentStep,
  PrivacyStep,
  type AnswersForm,
  type StepContext,
  type UploadControl,
} from "./payer-link-steps";
import { SummaryStep, ThankYou } from "./payer-link-summary";
import { missingLabel, stepTitle, type PayerLinkText } from "./payer-link-text";

// The questionnaire behind the code (contract phase 3a, 5.1 steps 1–8): one
// draft for all steps, saved key by key as the payer types, the uploads, and
// "send". What the link or the session cannot do any more goes to the page.

type RefusedValues = { values: RejectedFields; codes: Partial<Record<PayerField, string>> };

/** The server's code for a phone that is no phone number; the form uses it for its own check too. */
const PAYER_PHONE_INVALID = "payer_phone_invalid";

/** Problems the page handles: a lost session (back to the code) or a link that no longer works. */
export type LinkProblem = Extract<PayerErrorKind, "session" | "link_incomplete" | "link_invalid" | "link_revoked" | "link_expired" | "link_locked">;

/**
 * Autosave of the answers, as in the lead cabinet: only what changed, after
 * the draft has rested; a refused value stays out until it is changed and
 * does not hold back the other fields. What the server stored otherwise
 * (trimmed, cleared) replaces the draft's value unless it was typed again.
 */
function useAnswersForm({
  questionnaire,
  client,
  enqueue,
  text,
  writable,
  closed,
  onQuestionnaire,
  onSaveState,
  onFailure,
}: {
  questionnaire: PayerQuestionnaire;
  client: PayerLinkClient;
  enqueue: RequestQueue;
  text: PayerLinkText;
  writable: boolean;
  /** Set once the questionnaire was sent or the session is gone: nothing is saved any more. */
  closed: RefObject<boolean>;
  onQuestionnaire: (questionnaire: PayerQuestionnaire) => void;
  onSaveState: (state: SaveState) => void;
  onFailure: (error: PayerLinkError | null) => void;
}): AnswersForm & { flush: () => Promise<boolean> } {
  const [draft, setDraft] = useState<PayerDraft>(() => draftFromQuestionnaire(questionnaire));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef<PayerDraft>(draftFromQuestionnaire(questionnaire));
  const queuedDraftRef = useRef(savedRef.current);
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  const failedRef = useRef(false);
  const context: PatchContext = { payerType: questionnaire.payer_type, routeAsked: Boolean(questionnaire.payment_route?.asked) };
  const contextRef = useRef(context);
  contextRef.current = context;
  const writableRef = useRef(writable);
  writableRef.current = writable;

  // Uploads and the consent answer with the questionnaire too: what the
  // server changed there replaces the draft's values; fields being typed stay.
  useEffect(() => {
    const incoming = draftFromQuestionnaire(questionnaire);
    const changed = changedOnServer(savedRef.current, incoming);
    if (changed.length === 0) return;
    const baseline = savedRef.current;
    savedRef.current = incoming;
    queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, baseline, incoming, baseline, changed);
    setDraft((current) => mergeSavedDraft(current, baseline, incoming, baseline, changed));
  }, [questionnaire]);

  const save = useCallback(
    (snapshot: PayerDraft) => {
      const fields = queuedDraftFields(answersPatch(savedRef.current, snapshot, contextRef.current), answersPatch(queuedDraftRef.current, snapshot, contextRef.current));
      queuedDraftRef.current = snapshot;
      return enqueue(async () => {
        if (!writableRef.current || closed.current) return false;
        let saved = false;
        let failed = false;
        let rejected = stillRejected(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = scopedDraftPatch(answersPatch(savedRef.current, snapshot, contextRef.current, rejected), fields);
          const keys = Object.keys(patch);
          if (keys.length === 0) break;
          // A new phone that is no phone number is not sent: the field says so at once (owner 2026-10-22).
          if (typeof patch.phone === "string" && !payerPhoneAcceptable(patch.phone, savedRef.current.phone)) {
            const next = withRejectedField(rejected, "phone", snapshot);
            if (next) {
              rejected = next;
              codes.phone = PAYER_PHONE_INVALID;
              continue;
            }
          }
          onSaveState("saving");
          try {
            const next = await client.saveAnswers(patch);
            const previous = savedRef.current;
            const stored = draftFromQuestionnaire(next);
            savedRef.current = stored;
            queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, stored, previous, keys, fields);
            setDraft((current) => mergeSavedDraft(current, snapshot, stored, previous, keys, fields));
            saved = true;
            onQuestionnaire(next);
            break;
          } catch (cause) {
            const error = cause instanceof PayerLinkError ? cause : null;
            const field = error ? refusedField(error.code, error.body) : "";
            if (error && error.status === 422 && field && field in patch) {
              const next = withRejectedField(rejected, field, snapshot);
              if (next) {
                rejected = next;
                codes[field as PayerField] = error.code;
                continue;
              }
            }
            onFailure(error);
            failed = true;
            break;
          }
        }
        refusedRef.current = { values: rejected, codes };
        setRefused(refusedRef.current);
        const wasFailed = failedRef.current;
        failedRef.current = failed || Object.keys(rejected).length > 0;
        if (failedRef.current) onSaveState("error");
        else if (saved || wasFailed) onSaveState("saved");
        return !failedRef.current;
      });
    },
    [client, closed, enqueue, onFailure, onQuestionnaire, onSaveState],
  );

  useAutosave(draft, save, writable && !closed.current);

  return {
    draft,
    set: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    update: (change) => setDraft(change),
    errorFor: (field) => {
      // The message belongs to the refused value: it goes as soon as the value changes.
      const value = refused.values[field];
      if (value === undefined || value !== fieldValue(field, draft)) return undefined;
      const code = refused.codes[field];
      if (code === "id_document_expired") return text.idDocumentExpired;
      if (code === PAYER_PHONE_INVALID) return text.invalidPhone;
      return (code ? text.idDocumentRules[code] : undefined) ?? text.invalidField;
    },
    flush: () => save(draftRef.current),
  };
}

type UploadKind = "identity" | "funds";

/** Uploads and withdrawals of one kind, one file after another. */
function useUploads({
  kind,
  documents,
  client,
  enqueue,
  text,
  onQuestionnaire,
  onFailure,
}: {
  kind: UploadKind;
  documents: UploadControl["documents"];
  client: PayerLinkClient;
  enqueue: RequestQueue;
  text: PayerLinkText;
  onQuestionnaire: (questionnaire: PayerQuestionnaire) => void;
  onFailure: (error: PayerLinkError | null) => void;
}): UploadControl {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  /** A refusal the page or the form deals with; null when it is this file's own. */
  const escalate = (error: PayerLinkError | null): boolean => {
    if (!error) return false;
    const errorKind = payerErrorKind(error.status, error.code);
    if (errorKind === "session" || isFatalKind(errorKind) || errorKind === "consent_required" || errorKind === "submitted") {
      onFailure(error);
      return true;
    }
    return false;
  };

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    const messages: string[] = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        messages.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        const next = await enqueue(() => (kind === "identity" ? client.uploadIdentityDocument(file) : client.uploadFundsProof(file)));
        onQuestionnaire(next);
      } catch (cause) {
        const error = cause instanceof PayerLinkError ? cause : null;
        if (escalate(error)) break;
        if (error?.code === "too_many_documents") {
          messages.push(text.tooManyDocuments);
          break;
        }
        if (error?.code === "duplicate_document") messages.push(text.duplicateDocument(file.name));
        else if (error?.code === "unsupported_file_type" && error.body.format === "heic") messages.push(text.heicNotSupported(file.name));
        else if (error?.status === 413) messages.push(text.fileTooLarge(file.name));
        else if (error && error.status === 0) messages.push(text.networkError);
        else messages.push(text.uploadFailed(file.name));
      }
    }
    setErrors(Array.from(new Set(messages)));
    setBusy(false);
  }

  async function remove(documentId: string) {
    setErrors([]);
    try {
      onQuestionnaire(await enqueue(() => client.withdrawDocument(documentId)));
    } catch (cause) {
      const error = cause instanceof PayerLinkError ? cause : null;
      if (escalate(error)) return;
      if (error?.code === "upload_reviewed") setErrors([text.uploadReviewed]);
      else if (error?.status === 404) {
        // Gone already: the list is loaded afresh.
        try {
          onQuestionnaire(await enqueue(() => client.questionnaire()));
        } catch {
          setErrors([text.removeFailed]);
        }
      } else setErrors([text.removeFailed]);
    }
  }

  return { documents, busy, errors, upload: (files) => void upload(files), remove: (id) => void remove(id) };
}

/** The first step with something missing (after the privacy step), else the summary. */
function startStep(questionnaire: PayerQuestionnaire, steps: readonly PayerStep[]): PayerStep {
  if (!questionnaire.privacy?.acknowledged_at) return "privacy";
  const groups = missingByStep(questionnaire.missing_for_submit ?? [], questionnaire.payer_type, steps);
  return groups.find((group) => group.step !== "privacy")?.step ?? "summary";
}

export function PayerLinkForm({
  questionnaire,
  client,
  text,
  lang,
  signature = null,
  onQuestionnaire,
  onLinkProblem,
}: {
  questionnaire: PayerQuestionnaire;
  client: PayerLinkClient;
  text: PayerLinkText;
  lang: string;
  /** Where the documents for the payer's signature stand (phase 3b); shown once the details were sent. */
  signature?: PayerSignaturePackage | null;
  onQuestionnaire: (questionnaire: PayerQuestionnaire) => void;
  onLinkProblem: (problem: LinkProblem) => void;
}) {
  const payerType = questionnaire.payer_type;
  const routeAsked = Boolean(questionnaire.payment_route?.asked);
  const steps = useMemo(() => payerSteps(payerType, routeAsked), [payerType, routeAsked]);
  if (questionnaire.state === "submitted") {
    return <ThankYou questionnaire={questionnaire} steps={steps} text={text} lang={lang} signature={signature} />;
  }
  return (
    <DraftForm
      questionnaire={questionnaire}
      steps={steps}
      client={client}
      text={text}
      lang={lang}
      onQuestionnaire={onQuestionnaire}
      onLinkProblem={onLinkProblem}
    />
  );
}

function DraftForm({
  questionnaire,
  steps,
  client,
  text,
  lang,
  onQuestionnaire,
  onLinkProblem,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  client: PayerLinkClient;
  text: PayerLinkText;
  lang: string;
  onQuestionnaire: (questionnaire: PayerQuestionnaire) => void;
  onLinkProblem: (problem: LinkProblem) => void;
}) {
  const payerType = questionnaire.payer_type;
  const consented = Boolean(questionnaire.privacy?.acknowledged_at);
  const [step, setStep] = useState<PayerStep>(() => startStep(questionnaire, steps));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingShownSteps, setMissingShownSteps] = useState<ReadonlySet<PayerStep>>(() => new Set());
  const enqueue = useRequestQueue();
  const topRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // The send waits for the last save: its refusal must amend that answer, not the one the click saw.
  const questionnaireRef = useRef(questionnaire);
  questionnaireRef.current = questionnaire;
  // Sent, or the session or the link is gone: the last autosave must not write any more.
  const closedRef = useRef(false);

  const linkProblem = useCallback(
    (problem: LinkProblem) => {
      closedRef.current = true;
      onLinkProblem(problem);
    },
    [onLinkProblem],
  );

  const reload = useCallback(async () => {
    try {
      const next = await client.questionnaire();
      if (next.state === "submitted") closedRef.current = true;
      onQuestionnaire(next);
    } catch (cause) {
      const error = cause instanceof PayerLinkError ? cause : null;
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (kind === "session" || isFatalKind(kind)) linkProblem(kind as LinkProblem);
      else setNotice(payerErrorMessage(kind, textRef.current));
    }
  }, [client, linkProblem, onQuestionnaire]);

  // One place decides what a refusal means: the page (code, dead link), the
  // privacy step, a fresh load after "already sent", or a message.
  const handleFailure = useCallback(
    (error: PayerLinkError | null) => {
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (kind === "session" || isFatalKind(kind)) {
        linkProblem(kind as LinkProblem);
        return;
      }
      if (kind === "consent_required") {
        setStep("privacy");
        setNotice(textRef.current.privacyFirst);
        void reload();
        return;
      }
      if (kind === "submitted") {
        closedRef.current = true;
        void reload();
        return;
      }
      setNotice(payerErrorMessage(kind, textRef.current));
    },
    [linkProblem, reload],
  );

  const form = useAnswersForm({
    questionnaire,
    client,
    enqueue,
    text,
    writable: consented,
    closed: closedRef,
    onQuestionnaire,
    onSaveState: setSaveState,
    onFailure: handleFailure,
  });

  const identityUploads = useUploads({
    kind: "identity",
    documents: questionnaire.identity_documents ?? [],
    client,
    enqueue,
    text,
    onQuestionnaire,
    onFailure: handleFailure,
  });
  const fundsUploads = useUploads({
    kind: "funds",
    documents: questionnaire.funds_proof_documents ?? [],
    client,
    enqueue,
    text,
    onQuestionnaire,
    onFailure: handleFailure,
  });

  const base = requiredFields(payerType);
  const required = (field: PayerField) => {
    if (!base.has(field)) return false;
    if (field === "funds_description") return form.draft.funds_sources.includes("other");
    // The profession and the industry only with the enhanced check (owner 2026-10-24); the relationship stays required.
    if (field === "occupation") return occupationRequired(questionnaire);
    if (field === "industry") return industryRequired(questionnaire);
    if (field === "bank_name") return form.draft.payment_method === "bank_transfer";
    return true;
  };
  const context: StepContext = {
    form,
    text,
    lang,
    payerType,
    required,
    fundsSources: fundsSourceOptions(questionnaire),
    organisationExtras: questionnaire.answers.legal_form !== undefined,
  };

  const goTo = (next: PayerStep) => {
    if (submitting) return;
    if (next !== "privacy" && !consented) {
      setNotice(text.privacyFirst);
      return;
    }
    setNotice(null);
    setSubmitError(null);
    setStep(next);
    // The new step starts at its top; on a phone the old one may have been scrolled far down.
    topRef.current?.scrollIntoView({ block: "start" });
  };

  async function consent(channels: string[]): Promise<boolean> {
    setConsentBusy(true);
    setConsentError(null);
    try {
      onQuestionnaire(await enqueue(() => client.consent(channels, lang)));
      setNotice(null);
      return true;
    } catch (cause) {
      const error = cause instanceof PayerLinkError ? cause : null;
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (kind === "session" || isFatalKind(kind)) linkProblem(kind as LinkProblem);
      else setConsentError(payerErrorMessage(kind, text));
      return false;
    } finally {
      setConsentBusy(false);
    }
  }

  async function submit() {
    if (submitting || identityUploads.busy || fundsUploads.busy) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // The last entry first: what was typed just before "send" belongs to it.
      if (!await form.flush()) {
        setSubmitError(text.notSaved);
        return;
      }
      const next = await enqueue(() => client.submit());
      closedRef.current = true;
      onQuestionnaire(next);
    } catch (cause) {
      const error = cause instanceof PayerLinkError ? cause : null;
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (error?.code === "questionnaire_incomplete") {
        // The server's list wins: the summary shows it.
        const missing = Array.isArray(error.body.missing) ? error.body.missing.filter((key): key is string => typeof key === "string") : null;
        if (missing) onQuestionnaire({ ...questionnaireRef.current, missing_for_submit: missing });
        setSubmitError(text.submitNeedsMissing);
      } else if (error?.code === "declaration_required") {
        setSubmitError(text.submitNeedsConfirm);
      } else if (kind === "session" || isFatalKind(kind) || kind === "submitted" || kind === "consent_required") {
        handleFailure(error);
      } else {
        setSubmitError(payerErrorMessage(kind, text));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const index = steps.indexOf(step);
  const position = index === -1 ? 0 : index;
  const previous = steps[position - 1];
  const following = steps[position + 1];
  const progress = Math.round(((position + 1) / steps.length) * 100);
  // What this step still misses, as the server names it. Like the lead cabinet (owner
  // 2026-10-09, QA 2026-10-10): the first "next" with something missing shows the list and
  // stays, the next press goes on; nothing is shown before.
  const stepMissing = missingByStep(questionnaire.missing_for_submit ?? [], payerType, steps).find((group) => group.step === step)?.keys ?? [];
  const missingShown = missingShownSteps.has(step);
  const next = () => {
    if (!following) return;
    if (consented && stepMissing.length > 0 && !missingShown) {
      setMissingShownSteps((current) => new Set(current).add(step));
      return;
    }
    goTo(following);
  };

  let content;
  switch (step) {
    case "privacy":
      content = <PrivacyStep questionnaire={questionnaire} text={text} lang={lang} busy={consentBusy} error={consentError} onConsent={consent} />;
      break;
    case "details":
      content = <DetailsStep context={context} email={questionnaire.email} />;
      break;
    case "identity":
      content = <IdentityStep context={context} uploads={identityUploads} />;
      break;
    case "owners":
      content = <OwnersStep context={context} />;
      break;
    case "funds":
      content = <FundsStep context={context} fundsAsked={questionnaire.funds_required !== false} proofRequired={questionnaire.funds_proof_required} uploads={fundsUploads} />;
      break;
    case "payment":
      content = <PaymentStep context={context} suggestion={questionnaire.payment_route?.account_holder_suggestion ?? null} />;
      break;
    case "declarations":
      content = <DeclarationsStep context={context} />;
      break;
    default:
      content = (
        <SummaryStep
          questionnaire={questionnaire}
          steps={steps}
          text={text}
          lang={lang}
          submitting={submitting}
          uploading={identityUploads.busy || fundsUploads.busy}
          error={submitError}
          onGoTo={goTo}
          onSubmit={() => void submit()}
        />
      );
  }

  return (
    <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0 space-y-5 border-0 p-0" data-testid="payer-link-form" data-step={step}>
      <div ref={topRef} className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="payer-link-step-of">{text.stepOf(position + 1, steps.length)}</span>
          <SaveIndicator state={saveState} text={text} />
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <h2 className="text-base font-semibold leading-snug" data-testid="payer-link-step-title">
          {stepTitle(text, step, payerType, questionnaire.funds_required !== false)}
        </h2>
      </div>

      {notice ? (
        <Notice tone="error" role="alert" testId="payer-link-notice">
          {notice}
        </Notice>
      ) : null}

      {missingShown && stepMissing.length > 0 ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
          data-testid="payer-link-step-missing"
        >
          <p className="font-medium">{text.missingTitle}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {/* Each item leads to its field (QA 2026-10-22): a long step no longer has to be searched. */}
            {Array.from(new Map(stepMissing.map((key) => [missingLabel(text, key, payerType), key] as const))).map(([label, key]) => (
              <li key={label} className="break-words">
                <button
                  type="button"
                  className="text-left align-top underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="payer-link-missing-item"
                  onClick={() => revealPayerField(key)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {content}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        {previous ? (
          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => goTo(previous)}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {text.back}
          </Button>
        ) : (
          <span />
        )}
        {following ? (
          // Before the privacy notice is confirmed "next" says so when pressed, not beforehand.
          <Button type="button" className="h-9 gap-1.5" onClick={next} data-testid="payer-link-next">
            {text.next}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

/** The element a missing key is answered in: the field, a group's label, or an upload's button. */
const UPLOAD_IDS: Record<string, string> = {
  id_document_upload: "payer-link-identity-files",
  funds_proof_upload: "payer-link-funds-files",
};

function revealPayerField(key: string) {
  const id = UPLOAD_IDS[key] ?? `payer-link-${key}`;
  const label = document.getElementById(`${id}-label`);
  const target = document.getElementById(id) ?? label;
  if (!target) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  (label ?? target).scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  // An upload's input is hidden: its button gets the focus; a group's label its first choice.
  const focusable = target instanceof HTMLInputElement && target.type === "file"
    ? target.parentElement?.querySelector<HTMLElement>("button")
    : target.matches("input, select, textarea, button, [tabindex]")
      ? target
      : target.parentElement?.querySelector<HTMLElement>("input, select, textarea, button");
  focusable?.focus({ preventScroll: true });
}
