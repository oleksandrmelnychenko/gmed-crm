import { useCallback, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, Upload } from "lucide-react";

import { Section } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { LANGUAGE_OPTIONS } from "@/components/ui/language-multi-select";
import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey } from "@/lib/app-time-zone";

import {
  HEALTH_CONSENT,
  INQUIRY_CONSENT,
  saveLeadPersonalData,
  uploadLeadDocument,
  withdrawLeadDocument,
  type LeadRequest,
} from "./lead-request-api";
import { BillingSections } from "./lead-request-billing";
import {
  ContactChannelsField,
  IdentificationCountrySelect,
  IdentificationFormField,
  IdentificationTextArea,
  IdentificationTextInput,
  IdentityDocumentSection,
  LegalQuestionsSection,
  useIdentificationForm,
} from "./lead-request-identification";
import {
  MAX_UPLOAD_BYTES,
  combinedSaveState,
  consentGiven,
  consentText,
  draftFromPersonalData,
  languageName,
  personalDataPatch,
  rejectedValue,
  withInsuranceAnswer,
  type PersonalDraft,
  type PersonalField,
  type RejectedValue,
  type SaveState,
  type SubmitField,
} from "./lead-request-model";
import {
  ConsentCheckbox,
  FormField,
  MissingList,
  SaveIndicator,
  StepFooter,
  UploadedFileList,
  errorBody,
  errorMessage,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import { PayerSection } from "./lead-request-payer-section";
import { PayerQuestionnaireSection } from "./lead-request-payer-questionnaire";
import { RepresentationSection } from "./lead-request-representation";
import { asLeadCabinetLang, submitFieldLabel, type LeadRequestText } from "./lead-request-text";

// The steps of the lead cabinet that hold the base form (trigger flow
// 2026-10-07, contract 6): short steps of the wider layout, each with what it
// still misses at the top and the step bar at the bottom. Every part of a
// step saves on its own, as before; the bar shows one state for all.

/** Where a step stands among the steps and where "back" and "next" go. */
export type StepNav = {
  index: number;
  total: number;
  onBack: (() => void) | null;
  onNext: (() => void) | null;
};

export type StepProps = {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  /** The keys this step still misses (`missingByStep`). */
  missing: readonly string[];
  nav: StepNav;
};

/** One save state per part of a step, with a stable setter per part. */
function usePartStates() {
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [setters] = useState(() => new Map<string, (state: SaveState) => void>());
  const on = useCallback(
    (part: string) => {
      let setter = setters.get(part);
      if (!setter) {
        setter = (state: SaveState) =>
          setStates((current) => (current[part] === state ? current : { ...current, [part]: state }));
        setters.set(part, setter);
      }
      return setter;
    },
    [setters],
  );
  return { state: combinedSaveState(Object.values(states)), on };
}

/**
 * The frame of a step: what it still misses, its sections, and the bar with
 * the save state, "back" and "next". `extraMissing` adds words that are no
 * key of the list (the consent in the first step).
 */
function StepFrame({
  testId,
  request,
  text,
  missing,
  extraMissing = [],
  nav,
  saveState,
  children,
}: {
  testId: string;
  request: LeadRequest;
  text: LeadRequestText;
  missing: readonly string[];
  extraMissing?: readonly string[];
  nav: StepNav;
  saveState?: SaveState;
  children: ReactNode;
}) {
  const guardian = request.access_kind === "guardian";
  const labels = [
    ...extraMissing,
    ...missing.map((key) => submitFieldLabel(text, key as SubmitField, guardian, request.payer?.payer_type)),
  ];
  return (
    <section className="space-y-6" data-testid={testId}>
      <MissingList title={text.stepMissingTitle} labels={labels} testId="lead-request-step-missing" />
      {children}
      <StepFooter
        index={nav.index}
        total={nav.total}
        text={text}
        status={saveState ? <SaveIndicator state={saveState} text={text} /> : undefined}
      >
        <Button type="button" variant="outline" className="h-9" disabled={!nav.onBack} onClick={() => nav.onBack?.()}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {text.back}
        </Button>
        {nav.onNext ? (
          <Button type="button" className="h-9" onClick={() => nav.onNext?.()}>
            {text.next}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </StepFooter>
    </section>
  );
}

const GRID = "grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3";

/**
 * The personal data of the request as a form that saves on its own: only the
 * changed fields, a refused value not again until it changes. Each step that
 * shows some of the fields has its own (only one step is on screen).
 */
function usePersonalForm({
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
}) {
  const [draft, setDraft] = useState<PersonalDraft>(() => draftFromPersonalData(request.personal_data));
  const savedRef = useRef<PersonalDraft>(draftFromPersonalData(request.personal_data));
  const rejectedRef = useRef<RejectedValue | null>(null);
  const failedRef = useRef(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const save = useCallback(
    (snapshot: PersonalDraft) => {
      void enqueue(async () => {
        const patch = personalDataPatch(savedRef.current, snapshot, rejectedRef.current);
        if (Object.keys(patch).length === 0) {
          // Nothing to save. A failure is over once the refused value is gone from the form.
          const refused = rejectedRef.current;
          const stillRefused = refused !== null && rejectedValue(refused.field, snapshot)?.value === refused.value;
          if (failedRef.current && !stillRefused) {
            failedRef.current = false;
            rejectedRef.current = null;
            setFieldError(null);
            onSaveState("saved");
          }
          return;
        }
        onSaveState("saving");
        try {
          const next = await saveLeadPersonalData(request.lead_id, patch);
          savedRef.current = draftFromPersonalData(next.personal_data);
          rejectedRef.current = null;
          failedRef.current = false;
          setFieldError(null);
          onSaveState("saved");
          onChange(next);
        } catch (cause) {
          const body = errorBody(cause);
          const field = typeof body?.field === "string" ? body.field : null;
          if (field) {
            rejectedRef.current = rejectedValue(field, snapshot);
            setFieldError({
              field,
              message: body?.code === "minor_needs_guardian" ? text.minorNeedsGuardian : text.invalidField,
            });
          }
          failedRef.current = true;
          onSaveState("error");
        }
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id, text],
  );

  useAutosave(draft, save);

  const set = <K extends PersonalField>(field: K, value: PersonalDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const requiredMissing = (field: PersonalField) =>
    (field === "first_name" || field === "last_name") && !draft[field].trim();
  const errorFor = (field: PersonalField) =>
    requiredMissing(field) ? text.required : fieldError?.field === field ? fieldError.message : undefined;
  const fieldProps = (field: PersonalField) => ({
    id: `lead-request-${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-${field}-error` : undefined,
  });
  return { draft, set, setDraft, errorFor, fieldProps };
}

/**
 * Step 1 "Einwilligung & Person": the consent to process the request data
 * first (the uploads need it), the person as in the passport, and who acts
 * for the lead — an adult's two answers, or a minor's parents with names and
 * contacts.
 */
export function PersonStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  const personal = usePersonalForm({ request, text, enqueue, onChange, onSaveState: parts.on("personal") });
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  const withIdentification = request.identification !== undefined;
  const { draft, set, errorFor, fieldProps } = personal;
  const consentMissing = consentGiven(request, INQUIRY_CONSENT) ? [] : [text.sectionConsent];

  return (
    <StepFrame
      testId="lead-request-step-person"
      request={request}
      text={text}
      missing={missing}
      extraMissing={consentMissing}
      nav={nav}
      saveState={parts.state}
    >
      {/* Privacy first (spec section 0): the consent the request and the upload of the identity document need. */}
      <Section title={text.sectionConsent}>
        <ConsentCheckbox
          request={request}
          purpose={INQUIRY_CONSENT}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          label={consentText(request, INQUIRY_CONSENT, lang) || text.inquiryConsentLabel}
          testId="lead-request-inquiry-consent"
          privacyLink
        />
      </Section>

      <Section title={text.sectionPerson}>
        <div className={GRID}>
          {withIdentification ? (
            <IdentificationFormField form={identification} field="salutation" text={text}>
              <NativeComboboxSelect
                id="lead-request-salutation"
                className={selectClass}
                value={identification.draft.salutation}
                onChange={(event) => identification.set("salutation", event.target.value)}
              >
                <option value="">{text.choose}</option>
                {(Object.keys(text.salutationOptions) as Array<keyof LeadRequestText["salutationOptions"]>).map((value) => (
                  <option key={value} value={value}>
                    {text.salutationOptions[value]}
                  </option>
                ))}
              </NativeComboboxSelect>
            </IdentificationFormField>
          ) : null}
          <FormField
            field="first_name"
            text={text}
            error={errorFor("first_name")}
            required
            // The salutation takes the first cell: the two names stay side by side.
            className={withIdentification ? "sm:col-start-1 lg:col-start-auto" : undefined}
          >
            <Input
              {...fieldProps("first_name")}
              className={inputClass}
              autoComplete="given-name"
              value={draft.first_name}
              onChange={(event) => set("first_name", event.target.value)}
            />
          </FormField>
          <FormField field="last_name" text={text} error={errorFor("last_name")} required>
            <Input
              {...fieldProps("last_name")}
              className={inputClass}
              autoComplete="family-name"
              value={draft.last_name}
              onChange={(event) => set("last_name", event.target.value)}
            />
          </FormField>
          <FormField field="middle_name" text={text} error={errorFor("middle_name")}>
            <Input
              {...fieldProps("middle_name")}
              className={inputClass}
              autoComplete="additional-name"
              value={draft.middle_name}
              onChange={(event) => set("middle_name", event.target.value)}
            />
          </FormField>
          {withIdentification ? (
            <IdentificationFormField form={identification} field="former_names" text={text}>
              <IdentificationTextInput form={identification} field="former_names" maxLength={200} />
            </IdentificationFormField>
          ) : null}
          <FormField field="date_of_birth" text={text} error={errorFor("date_of_birth")} required>
            <Input
              key={`date_of_birth-${lang}`}
              {...fieldProps("date_of_birth")}
              className={inputClass}
              type="date"
              autoComplete="bday"
              pickerLang={asLeadCabinetLang(lang) ?? undefined}
              max={appDateKey()}
              value={draft.date_of_birth}
              onChange={(event) => set("date_of_birth", event.target.value)}
            />
          </FormField>
          {withIdentification ? (
            <>
              <IdentificationFormField form={identification} field="birth_place" text={text} required>
                <IdentificationTextInput form={identification} field="birth_place" maxLength={200} />
              </IdentificationFormField>
              <IdentificationFormField form={identification} field="birth_country" text={text} required>
                <IdentificationCountrySelect form={identification} field="birth_country" text={text} lang={lang} />
              </IdentificationFormField>
            </>
          ) : null}
          <FormField field="legal_sex" text={text} error={errorFor("legal_sex")} required>
            <NativeComboboxSelect
              {...fieldProps("legal_sex")}
              className={selectClass}
              value={draft.legal_sex}
              onChange={(event) => set("legal_sex", event.target.value)}
            >
              <option value="">{text.choose}</option>
              {(Object.keys(text.legalSexOptions) as Array<keyof LeadRequestText["legalSexOptions"]>).map((value) => (
                <option key={value} value={value}>
                  {text.legalSexOptions[value]}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
          <FormField field="citizenships" text={text} error={errorFor("citizenships")} required className="sm:col-span-2">
            <CitizenshipMultiSelect
              id="lead-request-citizenships"
              value={draft.citizenships}
              lang={lang}
              placeholder={text.citizenshipsPlaceholder}
              invalid={Boolean(errorFor("citizenships"))}
              onChange={(next) => set("citizenships", next)}
            />
          </FormField>
        </div>
      </Section>

      {/* An older server does not know who acts for the lead. Adult or minor: the block starts anew with the other questions. */}
      {request.representation ? (
        <RepresentationSection
          key={request.minor ? "minor" : "adult"}
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={parts.on("representation")}
          mode="base"
          stepMissing={missing}
        />
      ) : null}
    </StepFrame>
  );
}

/** Step 2 "Kontakt & Wohnsitz": the address and the country of residence, phone, language and contact channels. */
export function ContactStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  const { draft, set, errorFor, fieldProps } = usePersonalForm({
    request,
    text,
    enqueue,
    onChange,
    onSaveState: parts.on("personal"),
  });
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  const withIdentification = request.identification !== undefined;

  return (
    <StepFrame testId="lead-request-step-contact" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      <Section title={text.sectionAddress}>
        <div className={GRID}>
          <FormField field="street_address" text={text} error={errorFor("street_address")} required className="sm:col-span-2">
            <Input
              {...fieldProps("street_address")}
              className={inputClass}
              autoComplete="street-address"
              value={draft.street_address}
              onChange={(event) => set("street_address", event.target.value)}
            />
          </FormField>
          <FormField field="zip_code" text={text} error={errorFor("zip_code")} required>
            <Input
              {...fieldProps("zip_code")}
              className={inputClass}
              autoComplete="postal-code"
              value={draft.zip_code}
              onChange={(event) => set("zip_code", event.target.value)}
            />
          </FormField>
          <FormField field="city" text={text} error={errorFor("city")} required>
            <Input
              {...fieldProps("city")}
              className={inputClass}
              autoComplete="address-level2"
              value={draft.city}
              onChange={(event) => set("city", event.target.value)}
            />
          </FormField>
          <FormField field="country" text={text} error={errorFor("country")} required>
            <CountrySelect
              value={draft.country || null}
              lang={lang}
              className={selectClass}
              aria-label={text.fields.country}
              onChange={(code) => set("country", code ?? "")}
            />
          </FormField>
          {withIdentification ? (
            <IdentificationFormField form={identification} field="habitual_residence_country" text={text}>
              <IdentificationCountrySelect form={identification} field="habitual_residence_country" text={text} lang={lang} />
            </IdentificationFormField>
          ) : null}
        </div>
      </Section>
      <Section title={text.sectionContact}>
        <div className={GRID}>
          <FormField field="phone" text={text} error={errorFor("phone")}>
            <Input
              {...fieldProps("phone")}
              className={inputClass}
              type="tel"
              autoComplete="tel"
              value={draft.phone}
              onChange={(event) => set("phone", event.target.value)}
            />
          </FormField>
          <FormField field="primary_language" text={text} error={errorFor("primary_language")}>
            <NativeComboboxSelect
              {...fieldProps("primary_language")}
              className={selectClass}
              value={draft.primary_language}
              onChange={(event) => set("primary_language", event.target.value)}
            >
              <option value="">{text.choose}</option>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {languageName(option.value, lang)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
        </div>
        {withIdentification ? <ContactChannelsField form={identification} text={text} /> : null}
      </Section>
    </StepFrame>
  );
}

/** Step 3 "Ausweis": a photo or scan of the identity document only; GMED enters its data. */
export function IdentityStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  return (
    <StepFrame testId="lead-request-step-identity" request={request} text={text} missing={missing} nav={nav}>
      {request.identification !== undefined ? (
        <div data-testid="lead-request-identity">
          <IdentityDocumentSection
            request={request}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            intro={text.identityIntro}
          />
        </div>
      ) : null}
    </StepFrame>
  );
}

/** Step 4 "Wer zahlt": the patient, a person or an organisation, and the paying parent's own questions. */
export function PayerStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  // The own economic interest is asked with a server that knows the GwG statements.
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  const withIdentification = request.identification !== undefined;
  return (
    <StepFrame testId="lead-request-step-payer" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      {/* An older server does not know the question yet. */}
      {request.payer !== undefined ? (
        <PayerSection
          // Read-only once the payer answered on the own link; open again (staff changed the payer): a fresh form.
          key={request.payer?.answered_by_payer ? "payer-answered" : "payer"}
          request={request}
          text={text}
          lang={lang}
          identification={withIdentification ? identification : undefined}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={parts.on("payer")}
        />
      ) : null}
      {/* The parent who pays answers the payer-only questions (phase 3a); set for that login only. */}
      {request.payer_questionnaire ? (
        <PayerQuestionnaireSection
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={parts.on("payerQuestionnaire")}
        />
      ) : null}
    </StepFrame>
  );
}

/** Step 5 "Versicherung & Rechnung": the insurance and where the invoice goes (section 7). */
export function BillingStep({ request, text, enqueue, onChange, lang, missing, nav }: StepProps) {
  const parts = usePartStates();
  const { draft, set, setDraft, errorFor, fieldProps } = usePersonalForm({
    request,
    text,
    enqueue,
    onChange,
    onSaveState: parts.on("personal"),
  });
  return (
    <StepFrame testId="lead-request-step-billing" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      <Section title={text.sectionInsurance}>
        <div className={GRID} data-testid="lead-request-insurance">
          <FormField field="has_insurance" text={text} error={errorFor("has_insurance")}>
            <NativeComboboxSelect
              {...fieldProps("has_insurance")}
              className={selectClass}
              value={draft.has_insurance}
              onChange={(event) => setDraft((current) => withInsuranceAnswer(current, event.target.value))}
            >
              <option value="">{text.notStated}</option>
              <option value="yes">{text.insuranceAnswerOptions.yes}</option>
              <option value="no">{text.insuranceAnswerOptions.no}</option>
            </NativeComboboxSelect>
          </FormField>
          {/* The details exist only for an insured person. */}
          {draft.has_insurance === "yes" ? (
            <>
              <FormField field="insurance_type" text={text} error={errorFor("insurance_type")}>
                <NativeComboboxSelect
                  {...fieldProps("insurance_type")}
                  className={selectClass}
                  value={draft.insurance_type}
                  onChange={(event) => set("insurance_type", event.target.value)}
                >
                  <option value="">{text.choose}</option>
                  {(Object.keys(text.insuranceTypeOptions) as Array<keyof LeadRequestText["insuranceTypeOptions"]>).map((value) => (
                    <option key={value} value={value}>
                      {text.insuranceTypeOptions[value]}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </FormField>
              <FormField field="insurance_provider" text={text} error={errorFor("insurance_provider")}>
                <Input
                  {...fieldProps("insurance_provider")}
                  className={inputClass}
                  autoComplete="off"
                  value={draft.insurance_provider}
                  onChange={(event) => set("insurance_provider", event.target.value)}
                />
              </FormField>
              <FormField field="insurance_number" text={text} error={errorFor("insurance_number")}>
                <Input
                  {...fieldProps("insurance_number")}
                  className={inputClass}
                  autoComplete="off"
                  value={draft.insurance_number}
                  onChange={(event) => set("insurance_number", event.target.value)}
                />
              </FormField>
              <FormField field="insurance_covers_germany" text={text} error={errorFor("insurance_covers_germany")}>
                <NativeComboboxSelect
                  {...fieldProps("insurance_covers_germany")}
                  className={selectClass}
                  value={draft.insurance_covers_germany}
                  onChange={(event) => set("insurance_covers_germany", event.target.value)}
                >
                  <option value="">{text.notStated}</option>
                  {(Object.keys(text.insuranceCoverageOptions) as Array<keyof LeadRequestText["insuranceCoverageOptions"]>).map((value) => (
                    <option key={value} value={value}>
                      {text.insuranceCoverageOptions[value]}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </FormField>
            </>
          ) : null}
        </div>
      </Section>
      {/* The invoice recipient; an older server does not know it. The payment route is follow-up block C. */}
      {request.billing ? (
        <BillingSections
          request={request}
          billing={request.billing}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={parts.on("billing")}
          part="invoice"
        />
      ) : null}
      {/* An older server still asks the payment route with the base form. */}
      {request.billing && request.follow_up === undefined ? (
        <BillingSections
          request={request}
          billing={request.billing}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={parts.on("route")}
          part="route"
        />
      ) : null}
    </StepFrame>
  );
}

/** Step 6 "Erklärungen": the legal questions, yes or no only. */
export function DeclarationsStep({ request, text, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  return (
    <StepFrame testId="lead-request-step-declarations" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      {request.identification !== undefined ? (
        <LegalQuestionsSection form={identification} text={text} guardian={request.access_kind === "guardian"} />
      ) : null}
    </StepFrame>
  );
}

/**
 * Step "Anliegen & Unterlagen" (13.1): the reason of the request in the
 * lead's own words, and the medical documents under the Art. 9 consent.
 * Specialty and "already a patient?" are not asked.
 */
export function DocumentsStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  // A server that knows the reason sends its key (also as `null`) or lists it as missing.
  const asksReason =
    (request.identification !== undefined && "request_reason" in request.identification) ||
    request.progress.missing_for_submit.includes("request_reason");
  const consentReady = consentGiven(request, HEALTH_CONSENT);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const full = request.documents.length >= request.max_documents;

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
        onChange(await enqueue(() => uploadLeadDocument(request.lead_id, file)));
      } catch (cause) {
        nextErrors.push(`${file.name}: ${errorMessage(cause)}`);
      }
    }
    setErrors(nextErrors);
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
    <StepFrame testId="lead-request-documents" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      {asksReason ? (
        <Section title={text.sectionRequest}>
          <div data-testid="lead-request-reason">
            <IdentificationFormField form={identification} field="request_reason" text={text} required>
              <IdentificationTextArea form={identification} field="request_reason" maxLength={4000} rows={5} />
            </IdentificationFormField>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{text.requestReasonHint}</p>
          </div>
        </Section>
      ) : null}

      <Section title={text.healthConsentTitle}>
        <p className="whitespace-pre-line rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {consentText(request, HEALTH_CONSENT, lang)}
        </p>
        <ConsentCheckbox
          request={request}
          purpose={HEALTH_CONSENT}
          text={text}
          lang={lang}
          label={text.healthConsentLabel}
          enqueue={enqueue}
          onChange={onChange}
          testId="lead-request-health-consent"
        />
      </Section>

      <Section title={text.sectionUpload}>
        <p className="text-sm text-muted-foreground">{text.documentsIntro}</p>
        <div className="space-y-2">
          <input
            ref={fileInput}
            id="lead-request-files"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            className="sr-only"
            disabled={!consentReady || uploading || full}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void uploadFiles(files);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 sm:w-auto"
            disabled={!consentReady || uploading || full}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
            {uploading ? text.uploading : text.uploadButton}
          </Button>
          {!consentReady ? <p className="text-xs text-muted-foreground">{text.uploadNeedsConsent}</p> : null}
          {full ? <p className="text-xs text-muted-foreground">{text.maxDocuments(request.max_documents)}</p> : null}
          {errors.map((message) => (
            <p key={message} role="alert" className="text-xs text-destructive">
              {message}
            </p>
          ))}
        </div>
        <UploadedFileList
          documents={request.documents}
          text={text}
          lang={lang}
          emptyText={text.noDocuments}
          testId="lead-request-document-list"
          onRemove={(documentId) => void remove(documentId)}
        />
        <p className="text-xs text-muted-foreground">{text.documentsOptional}</p>
      </Section>
    </StepFrame>
  );
}
