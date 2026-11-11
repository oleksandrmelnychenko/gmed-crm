import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { payerPhoneAcceptable } from "@/lib/payer-phone";
import { MAX_UPLOAD_BYTES } from "@/pages/patient-lead/lead-request-model";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "@/pages/patient-lead/lead-request-autosave";
import { revealCabinetTarget } from "@/pages/patient-lead/lead-request-field-target";
import { nextHeldByMissing } from "@/pages/patient-lead/lead-request-steps";

import { PayerLinkError, type PayerLinkClient, type PayerQuestionnaire, type PayerSignaturePackage } from "./payer-link-api";
import {
  answersPatch,
  changedOnServer,
  draftFromQuestionnaire,
  fieldValue,
  fundsSourceOptions,
  isOrganisation,
  keptEmpty,
  missingByStep,
  ownersBlocker,
  PAYER_FIELDS,
  payerSteps,
  refilledFields,
  refusedField,
  industryRequired,
  occupationRequired,
  requiredFields,
  splitIdentityDocuments,
  stillRejected,
  withEmptiedKept,
  withRejectedField,
  type OwnerDraft,
  type OwnerField,
  type OwnersBlocker,
  type PatchContext,
  type PayerDraft,
  type PayerField,
  type PayerStep,
  type RejectedFields,
} from "./payer-link-model";
import { isFatalKind, payerErrorKind, payerErrorMessage, type PayerErrorKind } from "./payer-link-session";
import { Notice, SaveIndicator, useAutosave, useRequestQueue, type RequestQueue, type SaveState } from "./payer-link-parts";
import { ownerFieldId } from "./payer-link-fields";
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
}): AnswersForm & { flush: () => Promise<boolean>; hasUnsaved: () => boolean; /** The fields whose entry the server (or the form) refused and that still show it. */ refusedFields: () => string[] } {
  const [draft, setDraft] = useState<PayerDraft>(() => draftFromQuestionnaire(questionnaire));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef<PayerDraft>(draftFromQuestionnaire(questionnaire));
  const queuedDraftRef = useRef(savedRef.current);
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  // Fields the payer emptied that the server answered with a value (a default it offers again):
  // they stay empty on the page and are not sent again until typed (recheck 2026-11-11 N2).
  const emptiedRef = useRef<Set<PayerField>>(new Set());
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
          const held = { ...keptEmpty(emptiedRef.current, snapshot), ...rejected };
          const patch = scopedDraftPatch(answersPatch(savedRef.current, snapshot, contextRef.current, held), fields);
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
            // A value typed again and saved ends it; emptied again, it is sent again.
            for (const field of emptiedRef.current) if (keys.includes(field)) emptiedRef.current.delete(field);
            for (const field of refilledFields(keys, snapshot, stored)) emptiedRef.current.add(field);
            const emptied = [...emptiedRef.current];
            const merge = (current: PayerDraft) =>
              withEmptiedKept(mergeSavedDraft(current, snapshot, stored, previous, keys, fields), current, emptied);
            queuedDraftRef.current = merge(queuedDraftRef.current);
            setDraft(merge);
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
    refusedFields: () => Object.keys(stillRejected(refusedRef.current.values, draftRef.current)),
    hasUnsaved: () =>
      Object.keys(answersPatch(savedRef.current, draftRef.current, contextRef.current, keptEmpty(emptiedRef.current, draftRef.current))).length > 0,
  };
}

type UploadKind = "identity" | "extract" | "funds";

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
      // An empty file is not sent: the server would only answer "no file" (QA 2026-11-10).
      if (file.size === 0) {
        messages.push(text.fileEmpty(file.name));
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        messages.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        const next = await enqueue(() => (kind === "identity"
          ? client.uploadIdentityDocument(file)
          : kind === "extract"
            ? client.uploadRegisterExtract(file)
            : client.uploadFundsProof(file)));
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

  return {
    documents,
    busy,
    errors,
    upload: (files) => void upload(files),
    remove: (id) => void remove(id),
    // Reading a copy changes nothing on the server, so it runs beside the queue.
    recognize:
      kind === "identity" && typeof client.recognizeIdentityDocument === "function"
        ? (id) => client.recognizeIdentityDocument(id)
        : undefined,
  };
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
  softNext = false,
  onQuestionnaire,
  onLinkProblem,
}: {
  questionnaire: PayerQuestionnaire;
  client: PayerLinkClient;
  text: PayerLinkText;
  lang: string;
  /** Where the documents for the payer's signature stand (phase 3b); shown once the details were sent. */
  signature?: PayerSignaturePackage | null;
  /**
   * "Next" lets a step with a missing answer be left on the second press (the rule of
   * 2026-10-09): for staff who copy the payer's signed paper form. The payer's own link holds.
   */
  softNext?: boolean;
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
      softNext={softNext}
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
  softNext,
  onQuestionnaire,
  onLinkProblem,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  client: PayerLinkClient;
  text: PayerLinkText;
  lang: string;
  softNext: boolean;
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
  // "Next" was pressed on a list of beneficial owners that cannot be saved: the step says why, until the list is put right.
  const [ownersHeld, setOwnersHeld] = useState(false);
  const enqueue = useRequestQueue();
  const topRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // The send waits for the last save: its refusal must amend that answer, not the one the click saw.
  const questionnaireRef = useRef(questionnaire);
  questionnaireRef.current = questionnaire;
  // Sent, or the session or the link is gone: the last autosave must not write any more.
  const closedRef = useRef(false);
  const advancingRef = useRef(false);
  // What the last held press of "next" listed as missing, for the step on screen.
  const warnedRef = useRef<{ step: PayerStep; keys: ReadonlySet<string> } | null>(null);

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

  // "Next" reads what the save it waited for returned, before the page shows it.
  const questionnaireStored = useCallback(
    (next: PayerQuestionnaire) => {
      questionnaireRef.current = next;
      onQuestionnaire(next);
    },
    [onQuestionnaire],
  );

  const form = useAnswersForm({
    questionnaire,
    client,
    enqueue,
    text,
    writable: consented,
    closed: closedRef,
    onQuestionnaire: questionnaireStored,
    onSaveState: setSaveState,
    onFailure: handleFailure,
  });

  // The server files an organisation's register extract among the identity copies and marks it.
  // The page keeps the two apart: the extract is no scan of the representative's ID, and no
  // document data are read from it (QA 2026-11-10).
  const identityDocuments = questionnaire.identity_documents;
  const identityFiles = useMemo(() => splitIdentityDocuments(identityDocuments), [identityDocuments]);
  const identityUploads = useUploads({
    kind: "identity",
    documents: identityFiles.identity,
    client,
    enqueue,
    text,
    onQuestionnaire,
    onFailure: handleFailure,
  });
  const extractUploads = useUploads({
    kind: "extract",
    documents: identityFiles.extract,
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
    // The extract lifts the representative's ID, on this page too (QA 2026-10-31).
    if (questionnaire.register_extract_on_file && String(field).startsWith("id_")) return false;
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
      // The notice stands at the top, the box to tick at the end of the page: the press leads there.
      void afterRender(() => {
        const box = document.querySelector<HTMLElement>('[data-testid="payer-link-privacy-ack"]');
        if (box) revealCabinetTarget({ element: box, field: true });
      });
      return;
    }
    setNotice(null);
    setSubmitError(null);
    setOwnersHeld(false);
    warnedRef.current = null;
    setStep(next);
    // Staff may have filed the register extract while this page stayed open: the
    // step and the summary then ask less (QA 2026-11-01).
    if (isOrganisation(payerType) && consented && (next === "identity" || next === "summary")) void reload();
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
    if (submitting || identityUploads.busy || extractUploads.busy || fundsUploads.busy) return;
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
  // What this step still misses, as the server names it. Like the lead cabinet: nothing is shown
  // before "next" (owner 2026-10-09, QA 2026-10-10); "next" with something missing shows the list
  // and stays, on every press (owner 2026-11-11).
  const stepMissing = missingByStep(questionnaire.missing_for_submit ?? [], payerType, steps).find((group) => group.step === step)?.keys ?? [];
  const missingShown = missingShownSteps.has(step);
  // Why "next" stayed on the beneficial owners, read from the list as it is now: it goes once the list is right.
  const ownersHold = step === "owners" && ownersHeld ? ownersBlocker(form.draft) : null;
  const next = async () => {
    if (!following || advancingRef.current) return;
    advancingRef.current = true;
    try {
      // A list of beneficial owners the page holds back — a share that is none, a person without
      // both names, more than 100 % together — is never saved: the step stays until it is put
      // right. Going on would show, and later send, the list saved before (QA 2026-11-10: the
      // field said 150, the summary 10 %).
      const blocker = step === "owners" ? ownersBlocker(form.draft) : null;
      if (blocker) {
        setOwnersHeld(true);
        if (!revealOwnerProblem(blocker, form.draft.beneficial_owners)) topRef.current?.scrollIntoView({ block: "start" });
        return;
      }
      // The list counts what is saved: the answer typed just before the press is
      // saved first, or that press only saved it (QA 2026-11-01). Without one there is
      // nothing to wait for: uploads share the queue, and a batch must not freeze the button.
      if (consented && form.hasUnsaved() && !(await form.flush())) {
        // An entry of this step was not taken (an e-mail or a phone number the server refused):
        // the step stays and leads to it. Before, "next" went on and the entry stayed unsaved
        // until the summary (owner report 2026-11-11). An entry refused on another step does
        // not hold this one: there is nothing here to put right.
        // A save that failed without a refused field (the connection) holds nothing here: "send" retries it.
        const refused = form.refusedFields();
        if (await afterRender(() => refused.some((key) => revealPayerField(key)))) {
          setNotice(text.notSaved);
          return;
        }
      }
      const open = missingByStep(questionnaireRef.current.missing_for_submit ?? [], payerType, steps).find((group) => group.step === step)?.keys ?? [];
      // Like the lead cabinet (owner 2026-11-11): "next" does not leave a step while a required
      // answer of it is missing — every press shows the list, leads to the first field and stays.
      // Every key of the step holds, also one whose field has no id of its own (a country list,
      // the owners' choice: release QA 2026-11-11 — they let the second press pass, unfocused).
      if (consented && !softNext && open.length > 0) {
        setMissingShownSteps((current) => new Set(current).add(step));
        void afterRender(() => {
          if (!open.some((key) => revealPayerField(key))) topRef.current?.scrollIntoView({ block: "start" });
        });
        return;
      }
      // A required field of the step that was emptied is not sent, so the server keeps the old
      // answer and lists nothing: going on would bring the old value back unseen. It holds as well.
      const emptied = softNext ? [] : PAYER_FIELDS.filter(
        (field) => field !== "beneficial_owners" && required(field) && fieldValue(field, form.draft) === "" && payerFieldTarget(field) !== null,
      );
      if (consented && emptied.length > 0) {
        setNotice(`${text.missingTitle} ${emptied.map((field) => missingLabel(text, field, payerType)).join(", ")}`);
        void afterRender(() => emptied.some((key) => revealPayerField(key)));
        return;
      }
      // Staff who copy the payer's signed paper form keep the rule of 2026-10-09: the first press
      // shows the list and stays, the next goes on (the paper may leave an answer open).
      const warned = warnedRef.current?.step === step ? warnedRef.current.keys : null;
      if (consented && nextHeldByMissing(open, warned)) {
        warnedRef.current = { step, keys: new Set(open) };
        setMissingShownSteps((current) => new Set(current).add(step));
        void afterRender(() => open.some((key) => revealPayerField(key)));
        return;
      }
      goTo(following);
    } finally {
      advancingRef.current = false;
    }
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
      content = (
        <IdentityStep
          context={context}
          uploads={identityUploads}
          extractUploads={client.canUploadRegisterExtract ? extractUploads : undefined}
          extractDocuments={identityFiles.extract}
          extractOnFile={questionnaire.register_extract_on_file === true}
        />
      );
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
          uploading={identityUploads.busy || extractUploads.busy || fundsUploads.busy}
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
          {/* A list of beneficial owners the page holds back (a share of 25 % or less) is not saved:
              the step does not say "saved" while it is on screen (verification 2026-11-10). */}
          <SaveIndicator
            state={step === "owners" && saveState !== "saving" && ownersBlocker(form.draft) ? "error" : saveState}
            text={text}
          />
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

      {ownersHold ? (
        <Notice tone="error" role="alert" testId="payer-link-owners-hold">
          {ownersHold.index === null ? text.ownersTotal : `${text.ownerHeading(ownersHold.index + 1)}: ${ownersHold.problem === "incomplete" ? text.ownerIncomplete : ownersHold.problem === "low" ? text.ownerShareLow : text.ownerShare}`}
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
          <Button type="button" className="h-9 gap-1.5" onClick={() => void next()} data-testid="payer-link-next">
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

/**
 * Leads to what holds the list of beneficial owners: the share, or the missing name, of the
 * first person with a problem. False when the problem is the shares together (no single field).
 */
function revealOwnerProblem(blocker: OwnersBlocker, owners: readonly OwnerDraft[]): boolean {
  if (blocker.index === null) return false;
  const owner = owners[blocker.index];
  const field: OwnerField = blocker.problem === "share" || blocker.problem === "low" ? "share_percent" : owner?.first_name.trim() ? "last_name" : "first_name";
  const input = document.getElementById(ownerFieldId(blocker.index, field));
  if (!input) return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  input.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  input.focus({ preventScroll: true });
  return true;
}

/** Leads to the field of a missing key: scrolled into view, the cursor in it. False when the step does not show it. */
function payerFieldTarget(key: string): HTMLElement | null {
  // The owners are answered by a person or by "nobody holds more than 25 %": the box stands first.
  const id = UPLOAD_IDS[key] ?? `payer-link-${key === "beneficial_owners" ? "beneficial_owners_none" : key}`;
  // A country list has no id of its own: its label names the field, the box around both holds the list.
  const labelled = Array.from(document.querySelectorAll("label")).find((label) => label.htmlFor === id);
  // A group's label (an upload, a set of boxes): the group around it.
  return document.getElementById(id) ?? document.getElementById(`${id}-label`)?.parentElement ?? labelled?.parentElement ?? null;
}

/** Scrolls that element into view and puts the cursor into it. False when the step does not show it. */
function revealPayerField(key: string): boolean {
  const target = payerFieldTarget(key);
  if (!target) return false;
  // An upload's input is hidden: its button gets the focus; a group's label its first choice;
  // a date field its day (`revealCabinetTarget` knows them).
  const hiddenInput = target instanceof HTMLInputElement && target.type === "file";
  revealCabinetTarget({ element: hiddenInput ? target.parentElement ?? target : target, field: true });
  return true;
}

/** Runs once the press has rendered what it changed (the list, a field's objection). */
function afterRender<Result>(task: () => Result): Promise<Result> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve(task())));
  });
}
