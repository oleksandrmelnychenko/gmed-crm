import { useCallback, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Upload } from "lucide-react";

import { Section } from "@/components/ui-shell";
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
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  INQUIRY_CONSENT,
  saveLeadIdentification,
  uploadLeadIdentityDocument,
  withdrawLeadDocument,
  type LeadRequest,
} from "./lead-request-api";
import {
  CONTACT_CHANNELS,
  LEGAL_DETAILS,
  LEGAL_QUESTIONS,
  MAX_UPLOAD_BYTES,
  consentGiven,
  draftFromIdentification,
  identificationPatch,
  identificationValue,
  stillRejectedIdentification,
  withContactChannel,
  withLegalAnswer,
  withRejectedIdentification,
  type IdentificationDraft,
  type IdentificationField,
  type RejectedIdentification,
  type SaveState,
} from "./lead-request-model";
import {
  LabeledField,
  RequiredMark,
  UploadedFileList,
  YesNoSelect,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import { asLeadCabinetLang, identificationFieldLabel, type LeadRequestText } from "./lead-request-text";

// The lead's own statements for the GwG identification sheet (owner spec
// "Patientenformular", 2026-10-05). They are one record on the server and are
// asked in several sections of the step "data".

/** The statements as typed, with what the server refused. */
export type IdentificationForm = {
  draft: IdentificationDraft;
  set: <Field extends IdentificationField>(field: Field, value: IdentificationDraft[Field]) => void;
  update: (change: (draft: IdentificationDraft) => IdentificationDraft) => void;
  errorFor: (field: IdentificationField) => string | undefined;
};

type RefusedValues = { values: RejectedIdentification; codes: Partial<Record<IdentificationField, string>> };

/**
 * Autosave of the statements: only what changed, after the draft has rested.
 * A refused value (an expired document) stays out until the patient changes
 * it, and it does not hold back the other statements.
 */
export function useIdentificationForm({
  request,
  text,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}): IdentificationForm {
  const [draft, setDraft] = useState<IdentificationDraft>(() => draftFromIdentification(request.identification));
  const savedRef = useRef<IdentificationDraft>(draftFromIdentification(request.identification));
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const failedRef = useRef(false);
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);

  const save = useCallback(
    (snapshot: IdentificationDraft) => {
      void enqueue(async () => {
        let saved = false;
        let failed = false;
        let rejected = stillRejectedIdentification(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = identificationPatch(savedRef.current, snapshot, rejected);
          if (Object.keys(patch).length === 0) break;
          onSaveState("saving");
          try {
            const next = await saveLeadIdentification(request.lead_id, patch);
            savedRef.current = draftFromIdentification(next.identification);
            saved = true;
            onChange(next);
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const field = typeof body?.field === "string" ? body.field : "";
            const next = field in patch ? withRejectedIdentification(rejected, field, snapshot) : null;
            if (!next) {
              failed = true;
              break;
            }
            rejected = next;
            codes[field as IdentificationField] = typeof body?.code === "string" ? body.code : "";
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
    [enqueue, onChange, onSaveState, request.lead_id],
  );

  useAutosave(draft, save);

  return {
    draft,
    set: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    update: (change) => setDraft(change),
    errorFor: (field) => {
      // The message belongs to the refused value: it goes as soon as the patient changes it.
      const value = refused.values[field];
      if (value === undefined || value !== identificationValue(field, draft)) return undefined;
      return refused.codes[field] === "id_document_expired" ? text.idDocumentExpired : text.invalidField;
    },
  };
}

function controlProps(form: IdentificationForm, field: IdentificationField) {
  const invalid = Boolean(form.errorFor(field));
  return {
    id: `lead-request-${field}`,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? `lead-request-${field}-error` : undefined,
  };
}

/** A statement with its label and the server's objection, if any. */
export function IdentificationFormField({
  form,
  field,
  text,
  guardian = false,
  required = false,
  question = false,
  className,
  children,
}: {
  form: IdentificationForm;
  field: IdentificationField;
  text: LeadRequestText;
  guardian?: boolean;
  required?: boolean;
  question?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LabeledField
      id={`lead-request-${field}`}
      label={identificationFieldLabel(text, field, guardian)}
      error={form.errorFor(field)}
      required={required}
      question={question}
      className={className}
    >
      {children}
    </LabeledField>
  );
}

/** A one-line statement. */
export function IdentificationTextInput({
  form,
  field,
  maxLength,
  autoComplete = "off",
}: {
  form: IdentificationForm;
  field: Exclude<IdentificationField, "contact_channels">;
  maxLength: number;
  autoComplete?: string;
}) {
  return (
    <Input
      {...controlProps(form, field)}
      className={inputClass}
      autoComplete={autoComplete}
      maxLength={maxLength}
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
}

/** A statement that needs a few sentences. */
export function IdentificationTextArea({
  form,
  field,
}: {
  form: IdentificationForm;
  field: Exclude<IdentificationField, "contact_channels">;
}) {
  return (
    <textarea
      {...controlProps(form, field)}
      // 16 px on phones: a smaller text makes iOS zoom into the field.
      className={cn(textareaClass, "text-base md:text-sm")}
      rows={3}
      maxLength={2000}
      autoComplete="off"
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
}

/** A country as a statement; the select carries the label itself. */
export function IdentificationCountrySelect({
  form,
  field,
  text,
  lang,
  guardian = false,
}: {
  form: IdentificationForm;
  field: "birth_country" | "habitual_residence_country" | "id_issuing_country" | "high_risk_country_code";
  text: LeadRequestText;
  lang: string;
  guardian?: boolean;
}) {
  return (
    <CountrySelect
      value={form.draft[field] || null}
      lang={lang}
      className={selectClass}
      aria-label={identificationFieldLabel(text, field, guardian)}
      onChange={(code) => form.set(field, code ?? "")}
    />
  );
}

/** How the team may get in touch: any of e-mail, phone and messenger. */
export function ContactChannelsField({ form, text }: { form: IdentificationForm; text: LeadRequestText }) {
  return (
    <div role="group" aria-labelledby="lead-request-contact_channels-label" data-testid="lead-request-contact-channels">
      <p id="lead-request-contact_channels-label" className={tokens.text.label}>
        {text.identificationFields.contact_channels}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {CONTACT_CHANNELS.map((channel) => (
          <label key={channel} className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={form.draft.contact_channels.includes(channel)}
              onChange={(event) => form.update((current) => withContactChannel(current, channel, event.target.checked))}
            />
            {text.contactChannelOptions[channel]}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The identity document: what it says, and a photo or scan of it. The upload
 * needs the request consent first (the server refuses it otherwise).
 */
export function IdentityDocumentSection({
  request,
  form,
  text,
  lang,
  enqueue,
  onChange,
}: {
  request: LeadRequest;
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const consentReady = consentGiven(request, INQUIRY_CONSENT);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pickerLang = asLeadCabinetLang(lang) ?? undefined;

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
        onChange(await enqueue(() => uploadLeadIdentityDocument(request.lead_id, file)));
      } catch (cause) {
        nextErrors.push(
          errorBody(cause)?.code === "inquiry_consent_required"
            ? text.identityUploadNeedsConsent
            : `${file.name}: ${errorMessage(cause)}`,
        );
      }
    }
    setErrors(Array.from(new Set(nextErrors)));
    setUploading(false);
  }

  async function remove(documentId: string) {
    setErrors([]);
    try {
      onChange(await enqueue(() => withdrawLeadDocument(request.lead_id, documentId)));
    } catch (cause) {
      setErrors([errorMessage(cause)]);
    }
  }

  return (
    <Section title={text.sectionIdentity}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2" data-testid="lead-request-identity">
        <IdentificationFormField form={form} field="id_document_type" text={text} required>
          <NativeComboboxSelect
            {...controlProps(form, "id_document_type")}
            className={selectClass}
            value={form.draft.id_document_type}
            onChange={(event) => form.set("id_document_type", event.target.value)}
          >
            <option value="">{text.choose}</option>
            {(Object.keys(text.idDocumentTypeOptions) as Array<keyof LeadRequestText["idDocumentTypeOptions"]>).map((value) => (
              <option key={value} value={value}>
                {text.idDocumentTypeOptions[value]}
              </option>
            ))}
          </NativeComboboxSelect>
        </IdentificationFormField>
        <IdentificationFormField form={form} field="id_document_number" text={text} required>
          <IdentificationTextInput form={form} field="id_document_number" maxLength={60} />
        </IdentificationFormField>
        <IdentificationFormField form={form} field="id_issuing_authority" text={text} required>
          <IdentificationTextInput form={form} field="id_issuing_authority" maxLength={200} />
        </IdentificationFormField>
        <IdentificationFormField form={form} field="id_issuing_country" text={text} required>
          <IdentificationCountrySelect form={form} field="id_issuing_country" text={text} lang={lang} />
        </IdentificationFormField>
        <IdentificationFormField form={form} field="id_issued_on" text={text}>
          <Input
            key={`id_issued_on-${lang}`}
            {...controlProps(form, "id_issued_on")}
            className={inputClass}
            type="date"
            autoComplete="off"
            pickerLang={pickerLang}
            max={appDateKey()}
            value={form.draft.id_issued_on}
            onChange={(event) => form.set("id_issued_on", event.target.value)}
          />
        </IdentificationFormField>
        {/* No lower bound here: the server says when a document has expired, and the message says what to do. */}
        <IdentificationFormField form={form} field="id_valid_until" text={text} required>
          <Input
            key={`id_valid_until-${lang}`}
            {...controlProps(form, "id_valid_until")}
            className={inputClass}
            type="date"
            autoComplete="off"
            pickerLang={pickerLang}
            value={form.draft.id_valid_until}
            onChange={(event) => form.set("id_valid_until", event.target.value)}
          />
        </IdentificationFormField>
      </div>

      <div className="space-y-2" data-testid="lead-request-identity-upload">
        <p className={tokens.text.label}>
          {text.identityFiles}
          <RequiredMark />
        </p>
        <input
          ref={fileInput}
          id="lead-request-identity-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="sr-only"
          disabled={!consentReady || uploading}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void uploadFiles(files);
          }}
        />
        <Button
          type="button"
          variant="outline"
          // The label is a sentence: on a phone it may wrap instead of widening the page.
          className="h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
          disabled={!consentReady || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
          {uploading ? text.uploading : text.identityUploadButton}
        </Button>
        <p className="text-xs text-muted-foreground">
          {consentReady ? text.identityUploadHint : text.identityUploadNeedsConsent}
        </p>
        {errors.map((message) => (
          <p key={message} role="alert" className="text-xs text-destructive">
            {message}
          </p>
        ))}
        <UploadedFileList
          documents={request.identity_documents ?? []}
          text={text}
          lang={lang}
          emptyText={text.noIdentityDocuments}
          testId="lead-request-identity-list"
          onRemove={(documentId) => void remove(documentId)}
        />
        <p className="text-xs leading-5 text-muted-foreground">{text.identityNote}</p>
      </div>
    </Section>
  );
}

/**
 * The legal questions of the money laundering act (spec section 9): each is
 * answered with yes or no, and a "yes" asks for the details.
 */
export function LegalQuestionsSection({
  form,
  text,
  lang,
  guardian,
}: {
  form: IdentificationForm;
  text: LeadRequestText;
  lang: string;
  guardian: boolean;
}) {
  return (
    <Section title={text.sectionLegal}>
      <p className="text-xs leading-5 text-muted-foreground">{text.legalIntro}</p>
      <div className="space-y-5" data-testid="lead-request-legal">
        {LEGAL_QUESTIONS.map((question) => {
          const details = LEGAL_DETAILS[question];
          return (
            <div key={question} className="space-y-3" data-testid={`lead-request-legal-${question}`}>
              <IdentificationFormField form={form} field={question} text={text} guardian={guardian} required question>
                <YesNoSelect
                  id={`lead-request-${question}`}
                  className="sm:max-w-[calc(50%-0.5rem)]"
                  value={form.draft[question]}
                  text={text}
                  invalid={Boolean(form.errorFor(question))}
                  onChange={(answer) => form.update((current) => withLegalAnswer(current, question, answer))}
                />
              </IdentificationFormField>
              {/* The details exist only for a "yes". */}
              {form.draft[question] === "yes" ? (
                <IdentificationFormField form={form} field={details} text={text} guardian={guardian} required>
                  {details === "high_risk_country_code" ? (
                    <div className="sm:max-w-[calc(50%-0.5rem)]">
                      <IdentificationCountrySelect form={form} field={details} text={text} lang={lang} guardian={guardian} />
                    </div>
                  ) : (
                    <IdentificationTextArea form={form} field={details} />
                  )}
                </IdentificationFormField>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
