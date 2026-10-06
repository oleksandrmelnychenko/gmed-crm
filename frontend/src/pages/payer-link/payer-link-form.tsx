import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_UPLOAD_BYTES } from "@/pages/patient-lead/lead-request-model";

import { PayerLinkError, type PayerLinkClient, type PayerQuestionnaire } from "./payer-link-api";
import {
  answersPatch,
  changedOnServer,
  draftFromQuestionnaire,
  fieldValue,
  fundsSourceOptions,
  missingByStep,
  payerSteps,
  reconcileDraft,
  refusedField,
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
import { stepTitle, type PayerLinkText } from "./payer-link-text";

// The questionnaire behind the code (contract phase 3a, 5.1 steps 1–8): one
// draft for all steps, saved key by key as the payer types, the uploads, and
// "send". What the link or the session cannot do any more goes to the page.

type RefusedValues = { values: RejectedFields; codes: Partial<Record<PayerField, string>> };

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
}): AnswersForm & { flush: () => Promise<void> } {
  const [draft, setDraft] = useState<PayerDraft>(() => draftFromQuestionnaire(questionnaire));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef<PayerDraft>(draftFromQuestionnaire(questionnaire));
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
    savedRef.current = incoming;
    setDraft((current) => {
      const next = { ...current } as Record<string, unknown>;
      for (const field of changed) next[field] = incoming[field];
      return next as PayerDraft;
    });
  }, [questionnaire]);

  const save = useCallback(
    (snapshot: PayerDraft) =>
      enqueue(async () => {
        if (!writableRef.current || closed.current) return;
        let saved = false;
        let failed = false;
        let rejected = stillRejected(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = answersPatch(savedRef.current, snapshot, contextRef.current, rejected);
          const keys = Object.keys(patch);
          if (keys.length === 0) break;
          onSaveState("saving");
          try {
            const next = await client.saveAnswers(patch);
            const previous = savedRef.current;
            const stored = draftFromQuestionnaire(next);
            savedRef.current = stored;
            const still = rejected;
            setDraft((current) => reconcileDraft(current, snapshot, previous, stored, keys, still));
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
      }),
    [client, closed, enqueue, onFailure, onQuestionnaire, onSaveState],
  );

  useAutosave(draft, save);

  return {
    draft,
    set: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    update: (change) => setDraft(change),
    errorFor: (field) => {
      // The message belongs to the refused value: it goes as soon as the value changes.
      const value = refused.values[field];
      if (value === undefined || value !== fieldValue(field, draft)) return undefined;
      return refused.codes[field] === "id_document_expired" ? text.idDocumentExpired : text.invalidField;
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
        if (error?.status === 413) messages.push(text.fileTooLarge(file.name));
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
  onQuestionnaire,
  onLinkProblem,
}: {
  questionnaire: PayerQuestionnaire;
  client: PayerLinkClient;
  text: PayerLinkText;
  lang: string;
  onQuestionnaire: (questionnaire: PayerQuestionnaire) => void;
  onLinkProblem: (problem: LinkProblem) => void;
}) {
  const payerType = questionnaire.payer_type;
  const routeAsked = Boolean(questionnaire.payment_route?.asked);
  const steps = useMemo(() => payerSteps(payerType, routeAsked), [payerType, routeAsked]);
  if (questionnaire.state === "submitted") {
    return <ThankYou questionnaire={questionnaire} steps={steps} text={text} lang={lang} />;
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
  const enqueue = useRequestQueue();
  const topRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
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
    if (field === "bank_name") return form.draft.payment_method === "bank_transfer";
    return true;
  };
  const context: StepContext = { form, text, lang, payerType, required, fundsSources: fundsSourceOptions(questionnaire) };

  const goTo = (next: PayerStep) => {
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
    setSubmitting(true);
    setSubmitError(null);
    try {
      // The last entry first: what was typed just before "send" belongs to it.
      await form.flush();
      const next = await enqueue(() => client.submit());
      closedRef.current = true;
      onQuestionnaire(next);
    } catch (cause) {
      const error = cause instanceof PayerLinkError ? cause : null;
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (error?.code === "questionnaire_incomplete") {
        // The server's list wins: the summary shows it.
        const missing = Array.isArray(error.body.missing) ? error.body.missing.filter((key): key is string => typeof key === "string") : null;
        if (missing) onQuestionnaire({ ...questionnaire, missing_for_submit: missing });
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

  let content;
  switch (step) {
    case "privacy":
      content = <PrivacyStep questionnaire={questionnaire} text={text} busy={consentBusy} error={consentError} onConsent={consent} />;
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
      content = <FundsStep context={context} proofRequired={questionnaire.funds_proof_required} uploads={fundsUploads} />;
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
          error={submitError}
          onGoTo={goTo}
          onSubmit={() => void submit()}
        />
      );
  }

  return (
    <div className="space-y-5" data-testid="payer-link-form" data-step={step}>
      <div ref={topRef} className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="payer-link-step-of">{text.stepOf(position + 1, steps.length)}</span>
          <SaveIndicator state={saveState} text={text} />
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <h2 className="text-base font-semibold leading-snug" data-testid="payer-link-step-title">
          {stepTitle(text, step, payerType)}
        </h2>
      </div>

      {notice ? (
        <Notice tone="error" role="alert" testId="payer-link-notice">
          {notice}
        </Notice>
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
          <Button
            type="button"
            className="h-9 gap-1.5"
            disabled={!consented}
            aria-describedby={!consented ? "payer-link-next-hint" : undefined}
            onClick={() => goTo(following)}
            data-testid="payer-link-next"
          >
            {text.next}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>
      {!consented && step === "privacy" ? (
        <p id="payer-link-next-hint" className="text-xs text-muted-foreground">
          {text.privacyFirst}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{text.autosaveNote}</p>
      )}
    </div>
  );
}
