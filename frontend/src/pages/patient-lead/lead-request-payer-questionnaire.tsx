import { useCallback, useEffect, useRef, useState } from "react";
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
import { CONTACT_CHANNELS, MAX_UPLOAD_BYTES, languageName, type SaveState } from "./lead-request-model";
import {
  FUNDS_SOURCES,
  PAYER_LANGUAGES,
  PAYER_LEGAL_DETAILS,
  PAYER_LEGAL_QUESTIONS,
  canSubmitPayerQuestionnaire,
  draftFromPayerQuestionnaire,
  fundsDescriptionRequired,
  normalizeLeadPayerQuestionnaire,
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
  CabinetSection as Section,
  LabeledField,
  RequiredMark,
  UploadedFileList,
  YesNoSelect,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import { payerQuestionnaireFieldLabel, type LeadRequestText } from "./lead-request-text";

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
  // The request as it is by the time an answer arrives: only its short form of the questionnaire changes.
  const latest = useRef(request);
  latest.current = request;

  const apply = useCallback(
    (next: LeadPayerQuestionnaire) => {
      setQuestionnaire(next);
      onChange({ ...latest.current, payer_questionnaire: payerQuestionnaireSummary(next, latest.current.payer_questionnaire) });
    },
    [onChange],
  );

  const load = useCallback(async () => {
    try {
      const next = normalizeLeadPayerQuestionnaire(await fetchLeadPayerQuestionnaire(request.lead_id));
      if (!next) throw new Error("not a questionnaire");
      setLoadFailed(false);
      apply(next);
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, [apply, request.lead_id]);

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
  const savedRef = useRef<PayerQuestionnaireDraft>(draftFromPayerQuestionnaire(questionnaire));
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const failedRef = useRef(false);
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  // Nothing is writable before the notice nor after the questionnaire was sent (403 / 409 on the server).
  const writableRef = useRef(acknowledged && !submitted);
  writableRef.current = acknowledged && !submitted;
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
      return errorMessage(cause);
    },
    [text],
  );

  const save = useCallback(
    (snapshot: PayerQuestionnaireDraft) => {
      if (!writableRef.current) return;
      void enqueue(async () => {
        let saved = false;
        let failed = false;
        let rejected = stillRejectedPayerFields(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = payerQuestionnairePatch(savedRef.current, snapshot, rejected);
          if (Object.keys(patch).length === 0) break;
          onSaveState("saving");
          try {
            const next = normalizeLeadPayerQuestionnaire(await saveLeadPayerQuestionnaire(leadId, patch));
            const stored = next ? draftFromPayerQuestionnaire(next) : { ...savedRef.current, ...snapshot };
            savedRef.current = stored;
            if (next) apply(next);
            // What the server cleared or changed of the sent keys (a residence equal to the address
            // country, details without a "yes") replaces the entry, unless it was typed on since.
            const adjusted = (Object.keys(patch) as PayerQuestionnaireField[]).filter(
              (field) => payerQuestionnaireValue(field, stored) !== payerQuestionnaireValue(field, snapshot),
            );
            if (adjusted.length > 0) {
              setDraft((current) => {
                const merged = { ...current };
                for (const field of adjusted) {
                  if (payerQuestionnaireValue(field, current) === payerQuestionnaireValue(field, snapshot)) {
                    Object.assign(merged, { [field]: stored[field] });
                  }
                }
                return merged;
              });
            }
            saved = true;
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const field = typeof body?.field === "string" ? body.field : "";
            const next = field in patch ? withRejectedPayerField(rejected, field, snapshot) : null;
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
      });
    },
    [apply, enqueue, leadId, messageOf, onSaveState],
  );

  useAutosave(draft, save);

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
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        nextErrors.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        const next = normalizeLeadPayerQuestionnaire(await enqueue(() => uploadLeadPayerFundsProof(leadId, file)));
        if (next) apply(next);
        else await reload();
      } catch (cause) {
        nextErrors.push(`${file.name}: ${messageOf(cause)}`);
      }
    }
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
    setShowMissing(true);
    // Something is still missing: the press shows what (QA 2026-10-10: a disabled
    // button left the parent without a hint).
    if (questionnaire.missing_for_submit.length > 0) return;
    setSubmitting(true);
    setErrors([]);
    try {
      // The last entries go first: the queue sends the submit after them.
      save(draft);
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
    can_delete: document.can_delete && !submitted,
  }));
  const readOnly = !acknowledged || submitted;
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="lead-request-payer-notice">
        <p className="text-sm font-medium">{text.payerNoticeTitle}</p>
        <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{text.payerNotice}</p>
        <a href="/legal#privacy" target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">
          {text.privacyLink}
        </a>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
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
                  className={checkboxClass}
                  checked={channels.includes(channel)}
                  disabled={noticeBusy || submitted}
                  onChange={(event) => toggleChannel(channel, event.target.checked)}
                />
                {text.contactChannelOptions[channel]}
              </label>
            ))}
          </div>
        </div>
      </div>

      {!acknowledged ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-request-payer-notice-first">
          {text.payerNoticeFirst}
        </p>
      ) : (
        <fieldset disabled={readOnly} className="min-w-0 space-y-5" data-testid="lead-request-payer-fields">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
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
              {proofRequired ? (
                <p
                  role="note"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  {text.payerFundsProofRequiredNote}
                </p>
              ) : null}
              <input
                ref={fileInput}
                id="lead-request-payer-funds-proof-files"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
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
                lang={lang}
                emptyText={text.noPayerFundsProof}
                testId="lead-request-payer-funds-proof-list"
                onRemove={(documentId) => void remove(documentId)}
              />
            </div>
          </div>

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
                      {details === "high_risk_country_code" ? (
                        <div className="sm:max-w-[calc(50%-0.5rem)]">
                          <CountrySelect
                            value={draft.high_risk_country_code || null}
                            lang={lang}
                            className={selectClass}
                            disabled={readOnly}
                            aria-label={labelOf(details)}
                            onChange={(code) => set("high_risk_country_code", code ?? "")}
                          />
                        </div>
                      ) : (
                        <textarea
                          {...control(details)}
                          className={cn(textareaClass, "text-base md:text-sm")}
                          rows={3}
                          maxLength={2000}
                          autoComplete="off"
                          value={draft[details]}
                          onChange={(event) => set(details, event.target.value)}
                        />
                      )}
                    </LabeledField>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {showMissing ? <PayerMissingLists text={text} parts={missing} /> : null}

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
            disabled={submitting || !canSubmitPayerQuestionnaire({ ...questionnaire, missing_for_submit: [] }, declared)}
            data-testid="lead-request-payer-submit"
            onClick={() => void submit()}
          >
            {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
            {submitting ? text.sending : text.payerSubmitButton}
          </Button>
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
function PayerMissingLists({ text, parts }: { text: LeadRequestText; parts: ReturnType<typeof payerMissingParts> }) {
  const lists = [
    { key: "own", title: text.payerOwnMissingTitle, fields: parts.own },
    { key: "representatives", title: text.payerElsewhere(text.sectionLegalRepresentatives), fields: parts.representative },
    { key: "payer", title: text.payerElsewhere(text.sectionPayer), fields: parts.payer },
    { key: "payment-route", title: text.payerElsewhere(text.sectionPaymentRoute), fields: parts.paymentRoute },
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
              <li key={field}>{payerQuestionnaireFieldLabel(text, field)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
