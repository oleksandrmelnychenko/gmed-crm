import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import {
  checkboxClass,
  inputClass,
  selectClass,
  textareaClass,
  tokens,
} from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  acknowledgeLeadPayerNotice,
  fetchLeadPayerQuestionnaire,
  saveLeadPayerQuestionnaire,
  submitLeadPayerQuestionnaire,
  uploadLeadPayerFundsProof,
  withdrawLeadDocument,
  type LeadPayerQuestionnaire,
  type LeadPayerSignaturePackage,
  type LeadRequest,
  type LeadRequestDocument,
} from "./lead-request-api";
import { CONTACT_CHANNELS, LEAD_UPLOAD_ACCEPT, MAX_UPLOAD_BYTES, languageName, type SaveState } from "./lead-request-model";
import {
  FUNDS_SOURCES,
  PAYER_LANGUAGES,
  PAYER_LEGAL_DETAILS,
  PAYER_LEGAL_QUESTIONS,
  draftFromPayerQuestionnaire,
  fundsDescriptionRequired,
  normalizeLeadPayerQuestionnaire,
  payerAdditionalIdentityNeeded,
  payerElsewhereTarget,
  payerMissingParts,
  payerNoticeAcknowledged,
  payerQuestionnairePatch,
  payerQuestionnaireSubmitted,
  payerQuestionnaireSummary,
  payerQuestionnaireValue,
  payerSignaturePackageOf,
  stillRejectedPayerFields,
  withFundsSource,
  withPayerLegalAnswer,
  withRejectedPayerField,
  type PayerLegalQuestion,
  type PayerQuestionnaireDraft,
  type PayerQuestionnaireField,
  type RejectedPayerFields,
} from "./lead-request-payer-questionnaire-model";
import {
  CabinetGoToContext,
  CabinetSection as Section,
  GoToSectionButton,
  LabeledField,
  MissingItemLink,
  RequiredMark,
  UploadedFileList,
  YesNoSelect,
  errorBody,
  errorMessage,
  useAutosave,
  runDraftSave,
  enqueueUploadBatch,
  readAfterWrites,
  useRequestPatch,
  type RequestQueue,
} from "./lead-request-parts";
import { payerQuestionnaireFieldLabel, payerSendNeeds, type LeadRequestText } from "./lead-request-text";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";

/**
 * "Your details as the paying person" (contract phase 3a, 5.2): the parent
 * who pays for the child answers here what only a payer is asked — the payer
 * notice first, then salutation, former names, habitual residence, language,
 * occupation, the source of funds with its proof and the legal questions —
 * and sends these answers on their own. Name, address and identity document
 * are the parent's data in the representatives' block, the payment route is
 * the section above; what is missing there is named with the section. Not
 * part of what the request itself needs before it is sent.
 */
export function PayerQuestionnaireSection({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const [questionnaire, setQuestionnaire] = useState<LeadPayerQuestionnaire | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // An answer changes only the request's short form of the questionnaire, in the newest request.
  const patch = useRequestPatch(onChange, request);

  const apply = useCallback(
    (next: LeadPayerQuestionnaire) => {
      setQuestionnaire(next);
      patch((current) => ({ ...current, payer_questionnaire: payerQuestionnaireSummary(next, current.payer_questionnaire) }));
    },
    [patch],
  );

  const load = useCallback(async () => {
    try {
      // The read never overtakes a save of the cabinet still in flight, but it does not wait
      // for a proof upload batch: billing opened again during one shows its form at once
      // (a send then queues behind the batch).
      const { result, uploadsPending } = await readAfterWrites(enqueue, () => fetchLeadPayerQuestionnaire(request.lead_id));
      const next = normalizeLeadPayerQuestionnaire(result);
      if (!next) throw new Error("not a questionnaire");
      setLoadFailed(false);
      apply(next);
      // The files the batch still uploads: read once more after it.
      if (uploadsPending) {
        void enqueue(() => fetchLeadPayerQuestionnaire(request.lead_id))
          .then((later) => {
            const refreshed = normalizeLeadPayerQuestionnaire(later);
            if (refreshed) apply(refreshed);
          })
          .catch(() => undefined);
      }
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, [apply, enqueue, request.lead_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section title={text.payerQuestionnaireTitle}>
      <div className="space-y-4" data-testid="lead-request-payer-questionnaire">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {text.payerQuestionnaireIntro(text.sectionLegalRepresentatives)}
        </p>
        {questionnaire ? (
          <PayerQuestionnaireForm
            request={request}
            questionnaire={questionnaire}
            text={text}
            lang={lang}
            enqueue={enqueue}
            apply={apply}
            reload={load}
            onSaveState={onSaveState}
          />
        ) : loadFailed ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {text.payerQuestionnaireLoadFailed}
            </p>
            <Button type="button" variant="outline" className="h-8" onClick={() => void load()}>
              {text.retry}
            </Button>
          </div>
        ) : (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          </div>
        )}
      </div>
    </Section>
  );
}

type RefusedValues = { values: RejectedPayerFields; codes: Partial<Record<PayerQuestionnaireField, string>> };

/** The legal questions and their details: labelled as in the cabinet's own legal questions. */
type LegalField = PayerLegalQuestion | (typeof PAYER_LEGAL_DETAILS)[PayerLegalQuestion];

const LEGAL_FIELDS: ReadonlySet<string> = new Set<LegalField>([
  ...PAYER_LEGAL_QUESTIONS,
  ...PAYER_LEGAL_QUESTIONS.map((question) => PAYER_LEGAL_DETAILS[question]),
]);

function PayerQuestionnaireForm({
  request,
  questionnaire,
  text,
  lang,
  enqueue,
  apply,
  reload,
  onSaveState,
}: {
  request: LeadRequest;
  questionnaire: LeadPayerQuestionnaire;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  apply: (questionnaire: LeadPayerQuestionnaire) => void;
  reload: () => Promise<LeadPayerQuestionnaire | null>;
  onSaveState: (state: SaveState) => void;
}) {
  const leadId = request.lead_id;
  const acknowledged = payerNoticeAcknowledged(questionnaire);
  const submitted = payerQuestionnaireSubmitted(questionnaire);
  const [draft, setDraft] = useState<PayerQuestionnaireDraft>(() => draftFromPayerQuestionnaire(questionnaire));
  const showAdditionalIdentity = payerAdditionalIdentityNeeded(
    questionnaire,
    request.follow_up,
    request.representation?.representatives.find((person) => person.mine)?.id,
  );
  const savedRef = useRef<PayerQuestionnaireDraft>(draftFromPayerQuestionnaire(questionnaire));
  const queuedDraftRef = useRef(savedRef.current);
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const failedRef = useRef(false);
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  // Nothing is writable before the notice nor after the questionnaire was sent (403 / 409 on the server).
  const writableRef = useRef(acknowledged && !submitted);
  writableRef.current = acknowledged && !submitted;
  // What the server last answered, also before the next render: "send" checks it after the last save.
  const questionnaireRef = useRef(questionnaire);
  questionnaireRef.current = questionnaire;
  const [channels, setChannels] = useState<string[]>(() => questionnaire.privacy.contact_channels);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  /** What the server said about a write, in the parent's language. */
  const messageOf = useCallback(
    (cause: unknown): string => {
      const code = errorBody(cause)?.code;
      if (code === "payer_consent_required") return text.payerNoticeFirst;
      if (code === "payer_submitted") return text.payerQuestionnaireLocked;
      if (code === "declaration_required") return text.payerDeclarationRequired;
      if (code === "inquiry_consent_required") return text.identityUploadNeedsConsent;
      return errorMessage(cause, text);
    },
    [text],
  );

  const save = useCallback(
    (snapshot: PayerQuestionnaireDraft) => {
      if (!writableRef.current) return Promise.resolve(false);
      const fields = queuedDraftFields(payerQuestionnairePatch(savedRef.current, snapshot), payerQuestionnairePatch(queuedDraftRef.current, snapshot));
      queuedDraftRef.current = snapshot;
      return runDraftSave(enqueue, fields, async () => {
        if (!writableRef.current) return false;
        let saved = false;
        let failed = false;
        let rejected = stillRejectedPayerFields(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = scopedDraftPatch(payerQuestionnairePatch(savedRef.current, snapshot, rejected), fields);
          if (Object.keys(patch).length === 0) break;
          onSaveState("saving");
          try {
            const baseline = savedRef.current;
            const next = normalizeLeadPayerQuestionnaire(await saveLeadPayerQuestionnaire(leadId, patch));
            const stored = next ? draftFromPayerQuestionnaire(next) : { ...savedRef.current, ...snapshot };
            savedRef.current = stored;
            queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, stored, baseline, Object.keys(patch), fields);
            setDraft((current) => mergeSavedDraft(current, snapshot, stored, baseline, Object.keys(patch), fields));
            if (next) {
              questionnaireRef.current = next;
              apply(next);
            }
            saved = true;
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const field = typeof body?.field === "string" ? body.field : "";
            const next = cause instanceof ApiRequestError && cause.status === 422 && field in patch
              ? withRejectedPayerField(rejected, field, snapshot) : null;
            if (!next) {
              failed = true;
              setErrors([messageOf(cause)]);
              break;
            }
            rejected = next;
            codes[field as PayerQuestionnaireField] = typeof body?.code === "string" ? body.code : "";
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
    [apply, enqueue, leadId, messageOf, onSaveState],
  );

  useAutosave(draft, useCallback((snapshot: PayerQuestionnaireDraft) => !writableRef.current || save(snapshot), [save]));

  const errorFor = (field: PayerQuestionnaireField) => {
    // The message belongs to the refused value: it goes as soon as the parent changes it.
    const value = refused.values[field];
    if (value === undefined || value !== payerQuestionnaireValue(field, draft)) return undefined;
    return text.invalidField;
  };
  const set = <Field extends PayerQuestionnaireField>(field: Field, value: PayerQuestionnaireDraft[Field]) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const fieldId = (field: string) => `lead-request-payer-${field}`;
  const control = (field: PayerQuestionnaireField) => {
    const invalid = Boolean(errorFor(field));
    return {
      id: fieldId(field),
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? `${fieldId(field)}-error` : undefined,
    };
  };
  // The legal questions ask the parent about themself: the cabinet's wording with "Sie".
  const labelOf = (field: PayerQuestionnaireField) =>
    LEGAL_FIELDS.has(field) ? text.payerLegalFields[field as LegalField] : payerQuestionnaireFieldLabel(text, field);

  /** Acknowledges the notice, or sends the changed contact channels with it once it is acknowledged. */
  async function acknowledge(nextChannels: string[]) {
    setNoticeBusy(true);
    setErrors([]);
    try {
      const next = normalizeLeadPayerQuestionnaire(
        await enqueue(() => acknowledgeLeadPayerNotice(leadId, nextChannels)),
      );
      if (next) apply(next);
      else await reload();
    } catch (cause) {
      setErrors([messageOf(cause)]);
    } finally {
      setNoticeBusy(false);
    }
  }

  function toggleChannel(channel: string, chosen: boolean) {
    const next = CONTACT_CHANNELS.filter((item) => (item === channel ? chosen : channels.includes(item)));
    setChannels(next);
    if (acknowledged && !submitted) void acknowledge(next);
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    await enqueueUploadBatch(enqueue, async () => {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          nextErrors.push(text.fileTooLarge(file.name));
          continue;
        }
        try {
          const next = normalizeLeadPayerQuestionnaire(await uploadLeadPayerFundsProof(leadId, file));
          if (next) apply(next);
          else await reload();
        } catch (cause) {
          nextErrors.push(`${file.name}: ${messageOf(cause)}`);
        }
      }
    });
    setErrors(Array.from(new Set(nextErrors)));
    setUploading(false);
  }

  async function remove(documentId: string) {
    setErrors([]);
    try {
      await enqueue(() => withdrawLeadDocument(leadId, documentId));
      await reload();
    } catch (cause) {
      setErrors([messageOf(cause)]);
    }
  }

  // The yellow lists only after the first send (owner 2026-10-09: "only after Далее").
  const [showMissing, setShowMissing] = useState(false);

  async function submit() {
    if (submitting || uploading) return;
    setShowMissing(true);
    // Nothing can be saved yet (the notice first): what is missing is all there is to show.
    if (!writableRef.current) return;
    setSubmitting(true);
    setErrors([]);
    try {
      // The last entries go first: the queue sends the submit after them.
      if (!await save(draft)) {
        setErrors([text.notSaved]);
        return;
      }
      // Something is still missing after that save: the press shows what (QA 2026-10-10: a
      // disabled button left the parent without a hint). The server's list from before the
      // save would still name the answer typed just before the press.
      if (questionnaireRef.current.missing_for_submit.length > 0) return;
      if (!declared) {
        setErrors([text.payerDeclarationRequired]);
        return;
      }
      const next = normalizeLeadPayerQuestionnaire(await enqueue(() => submitLeadPayerQuestionnaire(leadId)));
      if (next) apply(next);
      else await reload();
    } catch (cause) {
      setErrors([messageOf(cause)]);
      // `questionnaire_incomplete` names what is missing: the questionnaire shows it.
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  const missing = payerMissingParts(questionnaire.missing_for_submit);
  const proofRequired = questionnaire.funds_proof_required;
  const proofDocuments: LeadRequestDocument[] = questionnaire.funds_proof_documents.map((document) => ({
    ...document,
    uploaded_at: document.uploaded_at ?? "",
    uploaded_by_me: true,
    can_delete: document.can_delete && !submitted && !submitting,
  }));
  const readOnly = !acknowledged || submitted || submitting;
  // What the send still waits for, next to the button: the notice, the server's list, the confirmation.
  const sendNeeds = payerSendNeeds(text, { acknowledged, declared, missing: questionnaire.missing_for_submit });
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="lead-request-payer-notice">
        <p className="text-sm font-medium">{text.payerNoticeTitle}</p>
        <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{text.payerNotice}</p>
        <a href={`/legal?notice=form&lang=${lang}#privacy`} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">
          {text.privacyLink}
        </a>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            aria-label={text.payerNoticeAck}
            className={cn(checkboxClass, "mt-0.5")}
            // Ticked at once while the acknowledgement is on its way.
            checked={acknowledged || noticeBusy}
            // An acknowledgement is not taken back: the first one stays on record.
            disabled={acknowledged || noticeBusy}
            onChange={(event) => {
              if (event.target.checked) void acknowledge(channels);
            }}
          />
          <span className="space-y-1">
            <span className="block leading-snug">{text.payerNoticeAck}</span>
            {questionnaire.privacy.acknowledged_at ? (
              <span className="block text-xs text-muted-foreground">
                {text.payerNoticeAckAt(formatAppDateTime(questionnaire.privacy.acknowledged_at))}
              </span>
            ) : null}
          </span>
        </label>
        <div role="group" aria-labelledby="lead-request-payer-channels-label">
          <p id="lead-request-payer-channels-label" className={tokens.text.label}>
            {text.payerContactChannels}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {CONTACT_CHANNELS.map((channel) => (
              <label key={channel} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={text.contactChannelOptions[channel]}
                  className={checkboxClass}
                  checked={channels.includes(channel)}
                  disabled={noticeBusy || submitted || submitting}
                  onChange={(event) => toggleChannel(channel, event.target.checked)}
                />
                {text.contactChannelOptions[channel]}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* The fields are visible from the start, locked until the notice is confirmed, so that the
          parent sees what is asked before the first click (QA 2026-10-25, R-1). */}
      {!acknowledged ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-request-payer-notice-first">
          {text.payerNoticeFirst}
        </p>
      ) : null}
        <fieldset disabled={readOnly} className="min-w-0 space-y-5" data-testid="lead-request-payer-fields">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {showAdditionalIdentity ? <>
            <LabeledField id={fieldId("salutation")} label={labelOf("salutation")} error={errorFor("salutation")}>
              <NativeComboboxSelect
                {...control("salutation")}
                className={selectClass}
                value={draft.salutation}
                onChange={(event) => set("salutation", event.target.value)}
              >
                <option value="">{text.choose}</option>
                {(Object.keys(text.salutationOptions) as Array<keyof LeadRequestText["salutationOptions"]>).map((value) => (
                  <option key={value} value={value}>
                    {text.salutationOptions[value]}
                  </option>
                ))}
              </NativeComboboxSelect>
            </LabeledField>
            <LabeledField id={fieldId("former_names")} label={labelOf("former_names")} error={errorFor("former_names")}>
              <Input
                {...control("former_names")}
                className={inputClass}
                autoComplete="off"
                maxLength={200}
                value={draft.former_names}
                onChange={(event) => set("former_names", event.target.value)}
              />
            </LabeledField>
            </> : null}
            <LabeledField
              id={fieldId("habitual_residence_country")}
              label={labelOf("habitual_residence_country")}
              error={errorFor("habitual_residence_country")}
            >
              <CountrySelect
                value={draft.habitual_residence_country || null}
                lang={lang}
                className={selectClass}
                disabled={readOnly}
                aria-label={labelOf("habitual_residence_country")}
                onChange={(code) => set("habitual_residence_country", code ?? "")}
              />
            </LabeledField>
            <LabeledField id={fieldId("language")} label={labelOf("language")} error={errorFor("language")}>
              <NativeComboboxSelect
                {...control("language")}
                className={selectClass}
                value={draft.language}
                onChange={(event) => set("language", event.target.value)}
              >
                <option value="">{text.choose}</option>
                {PAYER_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, lang)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </LabeledField>
            <LabeledField
              id={fieldId("occupation")}
              label={labelOf("occupation")}
              error={errorFor("occupation")}
              required
              className="sm:col-span-2 lg:col-span-3"
            >
              <Input
                {...control("occupation")}
                className={inputClass}
                autoComplete="off"
                maxLength={200}
                value={draft.occupation}
                onChange={(event) => set("occupation", event.target.value)}
              />
            </LabeledField>
          </div>

          {questionnaire.funds_required ? (
          <div className="space-y-3" data-testid="lead-request-payer-funds">
            <div
              role="group"
              aria-labelledby="lead-request-payer-funds_sources-label"
              aria-invalid={Boolean(errorFor("funds_sources")) || undefined}
            >
              <p id="lead-request-payer-funds_sources-label" className={tokens.text.label}>
                {labelOf("funds_sources")}
                <RequiredMark />
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FUNDS_SOURCES.map((source) => (
                  <label key={source} className="inline-flex items-start gap-2 text-sm leading-snug">
                    <input
                      type="checkbox"
                      aria-label={text.fundsSourceOptions[source]}
                      className={cn(checkboxClass, "mt-0.5")}
                      checked={draft.funds_sources.includes(source)}
                      onChange={(event) => setDraft((current) => withFundsSource(current, source, event.target.checked))}
                    />
                    {text.fundsSourceOptions[source]}
                  </label>
                ))}
              </div>
              {errorFor("funds_sources") ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {errorFor("funds_sources")}
                </p>
              ) : null}
            </div>
            <LabeledField
              id={fieldId("funds_description")}
              label={labelOf("funds_description")}
              error={errorFor("funds_description")}
              required={fundsDescriptionRequired(draft)}
            >
              <textarea
                {...control("funds_description")}
                // 16 px on phones: a smaller text makes iOS zoom into the field.
                className={cn(textareaClass, "text-base md:text-sm")}
                rows={3}
                maxLength={2000}
                autoComplete="off"
                value={draft.funds_description}
                onChange={(event) => set("funds_description", event.target.value)}
              />
            </LabeledField>
            <div className="space-y-2" data-testid="lead-request-payer-funds-proof" data-required={proofRequired ? "true" : undefined}>
              <p className={tokens.text.label}>
                {text.payerFundsProofTitle}
                {" · "}
                <span className={proofRequired ? "text-destructive" : undefined}>
                  {proofRequired ? text.payerFundsProofRequired : text.payerFundsProofOptional}
                </span>
              </p>
              {/* "Required" alone: why the proof is required this time is never said (no tipping-off). */}
              <input
                ref={fileInput}
                id="lead-request-payer-funds-proof-files"
                type="file"
                multiple
                accept={LEAD_UPLOAD_ACCEPT}
                className="sr-only"
                disabled={readOnly || uploading}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void uploadFiles(files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
                disabled={readOnly || uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
                {uploading ? text.uploading : text.payerFundsProofUpload}
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">{text.payerFundsProofHint}</p>
              <UploadedFileList
                documents={proofDocuments}
                text={text}
                emptyText={text.noPayerFundsProof}
                testId="lead-request-payer-funds-proof-list"
                onRemove={(documentId) => void remove(documentId)}
              />
            </div>
          </div>
          ) : null}

          <div className="space-y-5" data-testid="lead-request-payer-legal">
            {PAYER_LEGAL_QUESTIONS.map((question) => {
              const details = PAYER_LEGAL_DETAILS[question];
              return (
                <div key={question} className="space-y-3" data-testid={`lead-request-payer-legal-${question}`}>
                  <LabeledField id={fieldId(question)} label={labelOf(question)} error={errorFor(question)} required question>
                    <YesNoSelect
                      id={fieldId(question)}
                      className="sm:max-w-[calc(50%-0.5rem)]"
                      value={draft[question]}
                      text={text}
                      invalid={Boolean(errorFor(question))}
                      onChange={(answer) => setDraft((current) => withPayerLegalAnswer(current, question, answer))}
                    />
                  </LabeledField>
                  {draft[question] === "yes" ? (
                    <LabeledField id={fieldId(details)} label={labelOf(details)} error={errorFor(details)} required>
                      <textarea
                        {...control(details)}
                        className={cn(textareaClass, "text-base md:text-sm")}
                        rows={3}
                        maxLength={2000}
                        autoComplete="off"
                        value={draft[details]}
                        onChange={(event) => set(details, event.target.value)}
                      />
                    </LabeledField>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>

      {showMissing ? <PayerMissingLists request={request} text={text} parts={missing} /> : null}

      {errors.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}

      {submitted ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          data-testid="lead-request-payer-sent"
        >
          <p className="font-medium">{text.payerSubmittedAt(formatAppDateTime(questionnaire.submitted_at))}</p>
          <p className="mt-0.5 text-xs opacity-80">{text.payerSubmittedNote}</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="lead-request-payer-declaration">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              aria-label={text.payerDeclarationLabel}
              className={cn(checkboxClass, "mt-0.5")}
              checked={declared}
              disabled={!acknowledged || submitting}
              onChange={(event) => setDeclared(event.target.checked)}
            />
            <span className="leading-snug">{text.payerDeclarationLabel}</span>
          </label>
          <Button
            type="button"
            className="h-auto min-h-9 w-full gap-2 whitespace-normal py-1.5 sm:w-auto"
            // Pressable while something is missing: the press lists it (QA 2026-10-25, R-1: a disabled
            // button said nothing, and the statement seemed sent).
            disabled={submitting || uploading}
            aria-describedby={sendNeeds.length > 0 ? "lead-request-payer-send-needs" : undefined}
            data-testid="lead-request-payer-submit"
            onClick={() => void submit()}
          >
            {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
            {submitting ? text.sending : text.payerSubmitButton}
          </Button>
          {sendNeeds.length > 0 ? (
            <div id="lead-request-payer-send-needs" className="text-xs leading-5 text-muted-foreground" data-testid="lead-request-payer-send-needs">
              <p>{text.payerSendNeeds}</p>
              <ul className="list-disc pl-5">
                {sendNeeds.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <PayerSignatureStatus signature={payerSignaturePackageOf(questionnaire, request.payer_questionnaire)} text={text} />
    </div>
  );
}

/**
 * Where the documents for the payer's signature stand (contract phase 3b,
 * 6.3): sent through Skribble, or signed and back at GMED. Nothing without a
 * package, nor on a server that does not say.
 */
function PayerSignatureStatus({ signature, text }: { signature: LeadPayerSignaturePackage | null; text: LeadRequestText }) {
  if (!signature) return null;
  const signed = signature.status === "signed";
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-snug",
        signed
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "border-border bg-muted/10 text-foreground",
      )}
      data-testid="lead-request-payer-signature"
      data-status={signature.status}
    >
      {signed
        ? text.payerSignatureSigned(formatAppDate(signature.signed_at))
        : text.payerSignatureSent(formatAppDate(signature.sent_at))}
    </p>
  );
}

/** What is still missing: here, and — with the section's name — what is answered elsewhere. */
export function PayerMissingLists({
  request,
  text,
  parts,
}: {
  request: Pick<LeadRequest, "follow_up" | "submitted_at"> & Partial<Pick<LeadRequest, "identification">>;
  text: LeadRequestText;
  parts: ReturnType<typeof payerMissingParts>;
}) {
  const goTo = useContext(CabinetGoToContext);
  // A box that names another section carries the way there (owner report 2026-10-21).
  const lists = [
    { key: "own", title: text.payerOwnMissingTitle, fields: parts.own, section: null },
    { key: "representatives", title: text.payerElsewhere(text.sectionLegalRepresentatives), fields: parts.representative, section: { name: text.sectionLegalRepresentatives, target: payerElsewhereTarget("representative", request) } },
    { key: "payer", title: text.payerElsewhere(text.sectionPayer), fields: parts.payer, section: { name: text.sectionPayer, target: payerElsewhereTarget("payer", request) } },
    { key: "payment-route", title: text.payerElsewhere(text.sectionPaymentRoute), fields: parts.paymentRoute, section: { name: text.sectionPaymentRoute, target: payerElsewhereTarget("paymentRoute", request) } },
  ].filter((list) => list.fields.length > 0);
  if (lists.length === 0) return null;
  return (
    <div className="space-y-3">
      {lists.map((list) => (
        <div
          key={list.key}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid={`lead-request-payer-missing-${list.key}`}
        >
          <p className="font-medium">{list.title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {list.fields.map((field) => (
              <li key={field}>
                {/* Each item answered elsewhere leads to its field in that section (owner report 2026-10-21). */}
                {goTo && list.section ? (
                  <MissingItemLink
                    field={field}
                    onClick={() => goTo(list.section.target.step, { anchor: list.section.target.anchor, field })}
                  >
                    {payerQuestionnaireFieldLabel(text, field)}
                  </MissingItemLink>
                ) : (
                  payerQuestionnaireFieldLabel(text, field)
                )}
              </li>
            ))}
          </ul>
          {list.section ? (
            <GoToSectionButton
              step={list.section.target.step}
              anchor={list.section.target.anchor}
              field={list.fields[0]}
              label={text.goToSection(list.section.name)}
              testId={`lead-request-payer-missing-${list.key}-go`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
