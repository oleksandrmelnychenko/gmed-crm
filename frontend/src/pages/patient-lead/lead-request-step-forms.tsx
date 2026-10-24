import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
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
import { nameNeedsLatinSpelling, suggestPassportSpelling } from "./name-transliteration";
import { ConsentFormChoicesSection } from "./lead-request-consent-form";
import {
  ContactChannelsField,
  IdentificationFormField,
  IdentificationTextArea,
  IdentityDocumentSection,
  LegalQuestionsSection,
  useIdentificationForm,
} from "./lead-request-identification";
import {
  LEAD_UPLOAD_ACCEPT,
  MAX_UPLOAD_BYTES,
  combinedSaveState,
  consentGiven,
  consentText,
  draftFromPersonalData,
  payerAnswer,
  languageName,
  personalDataPatch,
  rejectedValue,
  uploadLimitReached,
  withInsuranceAnswer,
  type PersonalDraft,
  type PersonalField,
  type RejectedPersonal,
  type SaveState,
  type SubmitField,
} from "./lead-request-model";
import {
  CabinetSection as Section,
  ConsentNeededNote,
  ConsentCheckbox,
  FormField,
  GoToSectionButton,
  LabeledField,
  MissingList,
  MissingShownContext,
  SECTION_ANCHORS,
  SaveIndicator,
  StepMissingContext,
  StepFooter,
  UploadedFileList,
  errorBody,
  errorMessage,
  useAutosave,
  runDraftSave,
  type RequestQueue,
} from "./lead-request-parts";
import { InvoiceRecipientSection } from "./lead-request-invoice-recipient";
import { PayerSection } from "./lead-request-payer-section";
import { PayerQuestionnaireSection } from "./lead-request-payer-questionnaire";
import { draftFromRecipient, flowOf, knowsRecipient, payerChoices, payerFitsFlow } from "./lead-request-recipient-model";
import { RepresentationSection, RepresentativeUpload } from "./lead-request-representation";
import { useServerDraftSync } from "./lead-request-server-sync";
import type { StepId } from "./lead-request-steps";
import { asLeadCabinetLang, childSectionTitle, submitFieldLabel, type LeadRequestText } from "./lead-request-text";

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
  /** Whether "next" of this step was pressed with something missing (or a sending was tried). */
  missingShown: boolean;
  /** The first press of "next" with something missing: the list shows and the step stays. */
  onShowMissing: () => void;
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
  step,
  request,
  text,
  missing,
  extraMissing = [],
  nav,
  saveState,
  children,
}: {
  testId: string;
  step: StepId;
  request: LeadRequest;
  text: LeadRequestText;
  missing: readonly string[];
  extraMissing?: readonly { label: string; field: string | null }[];
  nav: StepNav;
  saveState?: SaveState;
  children: ReactNode;
}) {
  const guardian = request.access_kind === "guardian";
  // "1st representative – you": a parent sees which of the two persons is meant.
  const who = {
    mineSlot: request.representation?.representatives.find((person) => person.mine)?.slot ?? null,
    custody: request.representation?.custody ?? null,
  };
  const labels = [
    ...extraMissing.map((item) => item.label),
    ...missing.map((key) => submitFieldLabel(text, key as SubmitField, guardian, request.payer?.payer_type, request.minor, who)),
  ];
  // Every item leads to its field (owner report 2026-10-21).
  const fields = [...extraMissing.map((item) => item.field), ...missing];
  // The yellow list of what is missing appears only after "Next" (owner 2026-10-09): the first
  // press with something missing shows it and stays, the next press goes on. The page keeps
  // which steps showed it, for the badges of the step bar.
  const showMissing = nav.missingShown;
  // The empty required fields say so below themselves too, once "Next" was pressed.
  const missingKey = fields.filter(Boolean).join("|");
  const stepMissing = useMemo(
    () => (showMissing ? { keys: new Set(missingKey.split("|").filter(Boolean)), message: text.required } : null),
    [showMissing, missingKey, text.required],
  );
  const next = () => {
    // The page validates the fresh server response after flushing this step.
    nav.onNext?.();
  };
  return (
    <section className="space-y-6" data-testid={testId}>
      {showMissing ? <MissingList title={text.stepMissingTitle} labels={labels} fields={fields} step={step} testId="lead-request-step-missing" /> : null}
      <MissingShownContext.Provider value={showMissing}>
        <StepMissingContext.Provider value={stepMissing}>{children}</StepMissingContext.Provider>
      </MissingShownContext.Provider>
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
          <Button type="button" className="h-9" onClick={next}>
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
  const queuedDraftRef = useRef<PersonalDraft>(draftFromPersonalData(request.personal_data));
  const rejectedRef = useRef<RejectedPersonal>({});
  const failedRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PersonalField, string>>>({});

  const save = useCallback(
    (snapshot: PersonalDraft) => {
      const fields = queuedDraftFields(
        personalDataPatch(savedRef.current, snapshot),
        personalDataPatch(queuedDraftRef.current, snapshot),
      );
      queuedDraftRef.current = snapshot;
      return runDraftSave(enqueue, fields, async () => {
        const rejected: RejectedPersonal = {};
        for (const [field, value] of Object.entries(rejectedRef.current)) {
          if (rejectedValue(field, snapshot)?.value === value) rejected[field as PersonalField] = value;
        }
        let failed = false;
        let saved = false;
        for (;;) {
          const patch = scopedDraftPatch(personalDataPatch(savedRef.current, snapshot, rejected), fields);
          if (Object.keys(patch).length === 0) break;
          onSaveState("saving");
          try {
            const baseline = savedRef.current;
            const next = await saveLeadPersonalData(request.lead_id, patch);
            const fresh = draftFromPersonalData(next.personal_data);
            savedRef.current = fresh;
            queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, fresh, baseline, Object.keys(patch), fields);
            setDraft((current) => mergeSavedDraft(current, snapshot, fresh, baseline, Object.keys(patch), fields));
            saved = true;
            onChange(next);
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const field = typeof body?.field === "string" ? body.field : "";
            const refused = field in patch ? rejectedValue(field, snapshot) : null;
            if (!refused) { failed = true; break; }
            rejected[refused.field] = refused.value;
            setFieldErrors((current) => ({ ...current, [field]:
              body?.code === "minor_needs_guardian" ? text.minorNeedsGuardian :
              body?.code === "dob_staff_only" ? text.dobStaffOnly : text.invalidField,
            }));
          }
        }
        rejectedRef.current = rejected;
        const wasFailed = failedRef.current;
        // Empty required names are deliberately excluded from the PATCH; that
        // must not allow navigation to silently restore a previously saved name.
        const clearedName = (["first_name", "last_name"] as const).some(
          (field) => Boolean(savedRef.current[field].trim()) && !snapshot[field].trim(),
        );
        failedRef.current = failed || Object.keys(rejected).length > 0 || clearedName;
        if (failedRef.current) onSaveState("error");
        else if (saved || wasFailed) onSaveState("saved");
        return !failedRef.current;
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id, text],
  );

  useAutosave(draft, save);
  // The other parent saved meanwhile (the request was re-read): untouched fields follow.
  useServerDraftSync({
    incoming: draftFromPersonalData(request.personal_data),
    draft,
    savedRef,
    queuedDraftRef,
    setDraft,
    idOf: (field) => `lead-request-${field}`,
  });

  const set = <K extends PersonalField>(field: K, value: PersonalDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: field === "date_of_birth" && !value
      ? savedRef.current.date_of_birth : value }));
  };
  const requiredMissing = (field: PersonalField) =>
    (field === "first_name" || field === "last_name") && !draft[field].trim();
  const errorFor = (field: PersonalField) =>
    requiredMissing(field) ? text.required : rejectedRef.current[field] === rejectedValue(field, draft)?.value
      ? fieldErrors[field] : undefined;
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
  const consentMissing = consentGiven(request, INQUIRY_CONSENT) ? [] : [{ label: text.sectionConsent, field: "inquiry_consent" }];

  const showLatinNameHint = /\p{Script=Cyrillic}/u.test([draft.first_name, draft.last_name, draft.middle_name].join(" "));
  const cabinetLang = asLeadCabinetLang(lang);
  const showNamePassportHint = showLatinNameHint || cabinetLang === "ru" || cabinetLang === "uk";
  // A passport name has Latin letters only (accents such as ü or é are fine),
  // spaces, hyphens, apostrophes and dots; a Cyrillic name gets the passport
  // spelling as a suggestion the lead confirms with one click.
  const nameNeedsLatin = (field: "first_name" | "last_name" | "middle_name") =>
    Boolean(draft[field].trim()) && nameNeedsLatinSpelling(draft[field]);
  const nameCorrection = (field: "first_name" | "last_name" | "middle_name") => {
    if (!nameNeedsLatin(field)) return null;
    const suggestion = suggestPassportSpelling(draft[field], cabinetLang);
    return (
      <span
        id={`lead-request-${field}-latin-hint`}
        role="status"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-amber-800 dark:text-amber-300"
      >
        <span>{text.namePassportCorrection}</span>
        {suggestion ? (
          <>
            <span>{text.namePassportSuggestion.replace("{name}", suggestion)}</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid={`lead-request-${field}-latin-apply`}
              onClick={() => set(field, suggestion)}
            >
              {text.namePassportApply}
            </Button>
          </>
        ) : null}
      </span>
    );
  };
  const nameFieldProps = (field: "first_name" | "last_name" | "middle_name") => {
    const props = fieldProps(field);
    return {
      ...props,
      "aria-describedby": [props["aria-describedby"], showNamePassportHint ? "lead-request-name-passport-hint" : null, nameNeedsLatin(field) ? `lead-request-${field}-latin-hint` : null].filter(Boolean).join(" "),
    };
  };
  return (
    <StepFrame
      testId="lead-request-step-person"
      step="person"
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

      <Section title={childSectionTitle(text, "person", request.minor)}>
        {showNamePassportHint ? (
          <StatusChip id="lead-request-name-passport-hint" tone="warning" className="items-start rounded-lg px-2.5 py-1.5">
            <CircleAlert aria-hidden="true" className="mt-[3px]" />
            <span>{text.namePassportHint}</span>
          </StatusChip>
        ) : null}
        <div className={GRID}>
          {withIdentification && !request.minor ? (
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
              {...nameFieldProps("first_name")}
              className={inputClass}
              autoComplete="given-name"
              maxLength={100}
              value={draft.first_name}
              onChange={(event) => set("first_name", event.target.value)}
            />
            {nameCorrection("first_name")}
          </FormField>
          <FormField field="last_name" text={text} error={errorFor("last_name")} required>
            <Input
              {...nameFieldProps("last_name")}
              className={inputClass}
              autoComplete="family-name"
              maxLength={100}
              value={draft.last_name}
              onChange={(event) => set("last_name", event.target.value)}
            />
            {nameCorrection("last_name")}
          </FormField>
          <FormField field="middle_name" text={text} error={errorFor("middle_name")}>
            <Input
              {...nameFieldProps("middle_name")}
              className={inputClass}
              autoComplete="additional-name"
              maxLength={100}
              value={draft.middle_name}
              onChange={(event) => set("middle_name", event.target.value)}
            />
            {nameCorrection("middle_name")}
          </FormField>
          <FormField field="date_of_birth" text={text} error={errorFor("date_of_birth")} required>
            <Input
              key={`date_of_birth-${lang}`}
              {...fieldProps("date_of_birth")}
              className={inputClass}
              type="date"
              autoComplete="bday"
              pickerLang={asLeadCabinetLang(lang) ?? undefined}
              max={appDateKey()}
              min="1900-01-01"
              value={draft.date_of_birth}
              onChange={(event) => set("date_of_birth", event.target.value)}
            />
          </FormField>
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
              maxItems={5}
              value={draft.citizenships}
              lang={lang}
              placeholder={text.citizenshipsPlaceholder}
              invalid={Boolean(errorFor("citizenships"))}
              onChange={(next) => set("citizenships", next)}
            />
          </FormField>
        </div>
      </Section>

      {/* Address and contact (owner 2026-10-09: one tab with the consent and the person). */}
      <Section title={childSectionTitle(text, "address", request.minor)}>
        <div className={GRID}>
          <FormField field="street_address" text={text} error={errorFor("street_address")} required className="sm:col-span-2">
            <Input
              {...fieldProps("street_address")}
              className={inputClass}
              autoComplete="street-address"
              maxLength={200}
              value={draft.street_address}
              onChange={(event) => set("street_address", event.target.value)}
            />
          </FormField>
          <FormField field="zip_code" text={text} error={errorFor("zip_code")} required>
            <Input
              {...fieldProps("zip_code")}
              className={inputClass}
              autoComplete="postal-code"
              maxLength={20}
              value={draft.zip_code}
              onChange={(event) => set("zip_code", event.target.value)}
            />
          </FormField>
          <FormField field="city" text={text} error={errorFor("city")} required>
            <Input
              {...fieldProps("city")}
              className={inputClass}
              autoComplete="address-level2"
              maxLength={120}
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
        </div>
      </Section>
      <Section title={childSectionTitle(text, "contact", request.minor)}>
        <div className={GRID}>
          <FormField
            field="phone"
            text={text}
            error={errorFor("phone")}
            required={!request.minor}
            label={request.minor ? text.childPhone : undefined}
          >
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
              {cabinetLanguageOptions(lang, draft.primary_language).map((option) => (
                <option key={option.value} value={option.value}>
                  {languageName(option.value, lang)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
        </div>
        {withIdentification ? <ContactChannelsField form={identification} text={text} /> : null}
      </Section>

      {/* An older server does not know who acts for the lead. Adult or minor: the block starts anew with the other questions. */}
      {request.representation ? (
        <div id={SECTION_ANCHORS.representatives} className="scroll-mt-4 space-y-6">
          <RepresentationSection
            childAddress={draft}
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
        </div>
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
    <StepFrame testId="lead-request-step-contact" step="contact" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      <Section title={childSectionTitle(text, "address", request.minor)}>
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
        </div>
      </Section>
      <Section title={childSectionTitle(text, "contact", request.minor)}>
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
              {cabinetLanguageOptions(lang, draft.primary_language).map((option) => (
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
  // A parent's login for a minor uploads two documents here: the child's and the own one
  // (owner report 2026-10-21: "I uploaded my passport and my child's" — only the child's arrived).
  const parentOfMinor = request.access_kind === "guardian" && request.minor && Boolean(request.representation);
  return (
    <StepFrame testId="lead-request-step-identity" step="identity" request={request} text={text} missing={missing} nav={nav}>
      {request.identification !== undefined ? (
        <div data-testid="lead-request-identity">
          <IdentityDocumentSection
            request={request}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            title={parentOfMinor ? text.childDocumentTitle : undefined}
          />
        </div>
      ) : null}
      {parentOfMinor ? (
        <OwnRepresentativeDocumentSection request={request} text={text} lang={lang} enqueue={enqueue} onChange={onChange} />
      ) : null}
      {parentOfMinor ? (
        <OtherParentDocumentSection request={request} text={text} lang={lang} enqueue={enqueue} onChange={onChange} />
      ) : null}
    </StepFrame>
  );
}

/**
 * The parent's own identity copy on step "Document": the same upload as in
 * the parent's block of "Legal representatives" (both show the same files).
 * Until the login is one of the request's representatives there is nobody
 * to upload for: a pointer to that section instead.
 */
export function OwnRepresentativeDocumentSection({
  request,
  text,
  lang,
  enqueue,
  onChange,
}: Pick<StepProps, "request" | "text" | "lang" | "enqueue" | "onChange">) {
  const me = request.representation?.representatives.find((person) => person.mine && person.slot !== null) ?? null;
  const slot = me?.slot ?? null;
  const required = slot !== null && (
    request.representation?.document_stage === true || request.progress.missing_for_submit.includes(`${slot}_id_upload`)
  );
  return (
    <div id={SECTION_ANCHORS.ownDocument} className="scroll-mt-4" data-testid="lead-request-own-document">
      <Section title={text.ownRepresentativeDocumentTitle}>
        {me && slot ? (
          <div className="space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">{text.ownRepresentativeDocumentHint}</p>
            <RepresentativeUpload
              request={request}
              slot={slot}
              kind="identity"
              label={text.identityFiles}
              required={required}
              person={me}
              documents={me.identity_documents}
              text={text}
              lang={lang}
              enqueue={enqueue}
              onChange={onChange}
            />
          </div>
        ) : (
          <div
            role="note"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="lead-request-own-document-needs-person"
          >
            <p>{text.ownRepresentativeDocumentNeedsPerson(text.sectionLegalRepresentatives)}</p>
            <GoToSectionButton
              step="person"
              anchor={SECTION_ANCHORS.representatives}
              label={text.goToSection(text.sectionLegalRepresentatives)}
              testId="lead-request-own-document-go"
            />
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * The other parent's identity copy on step "Document" (QA 2026-10-22): with
 * joint custody both parents' copies are uploaded here, where the missing
 * list of this step points (`rep1_id_upload` / `rep2_id_upload`), not in the
 * persons' forms of step 1. Until that parent is named there, a pointer.
 */
export function OtherParentDocumentSection({
  request,
  text,
  lang,
  enqueue,
  onChange,
}: Pick<StepProps, "request" | "text" | "lang" | "enqueue" | "onChange">) {
  const representation = request.representation;
  const mine = representation?.representatives.find((person) => person.mine && person.slot !== null)?.slot ?? null;
  const slot = mine === "rep2" ? "rep1" : mine === "rep1" && representation?.custody === "joint" ? "rep2" : null;
  if (!slot) return null;
  const person = representation?.representatives.find((item) => item.slot === slot) ?? null;
  const required = representation?.document_stage === true || request.progress.missing_for_submit.includes(`${slot}_id_upload`);
  const name = person ? [person.first_name, person.last_name].filter(Boolean).join(" ") : "";
  return (
    <div className="scroll-mt-4" data-testid="lead-request-other-parent-document">
      <Section title={text.otherParentDocumentTitle(name)}>
        {person ? (
          <div className="space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">{text.otherParentDocumentHint}</p>
            <RepresentativeUpload
              request={request}
              slot={slot}
              kind="identity"
              label={text.identityFiles}
              required={required}
              person={person}
              documents={person.identity_documents}
              text={text}
              lang={lang}
              enqueue={enqueue}
              onChange={onChange}
            />
          </div>
        ) : (
          <div
            role="note"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="lead-request-other-parent-document-needs-person"
          >
            <p>{text.otherParentDocumentNeedsPerson(text.sectionLegalRepresentatives)}</p>
            <GoToSectionButton
              step="person"
              anchor={SECTION_ANCHORS.representatives}
              label={text.goToSection(text.sectionLegalRepresentatives)}
              testId="lead-request-other-parent-document-go"
            />
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * Step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the insurance,
 * then who receives the invoice and whether that recipient pays — "who pays"
 * is part of it —, the bare payment method, and the paying parent's own
 * questions.
 */
export function BillingStep({ request, text, enqueue, onChange, lang, missing, nav }: StepProps) {
  const parts = usePartStates();
  const { draft, set, setDraft, errorFor, fieldProps } = usePersonalForm({
    request,
    text,
    enqueue,
    onChange,
    onSaveState: parts.on("personal"),
  });
  // The reason an organisation pays is a GwG statement; an older server does not know them.
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  const withIdentification = request.identification !== undefined;
  const guardian = request.access_kind === "guardian";
  const flowKnown = knowsRecipient(request);
  // The payment method belongs to the payer named: asked once somebody is.
  const recipient = draftFromRecipient(request.billing);
  const payerNamed = Boolean(request.payer) && (!flowKnown || payerFitsFlow(flowOf(recipient), request.payer, recipient,
    payerAnswer(request.payer, request.payer_self_template) === "guardian" || request.billing?.payment_route_by === "guardian", request.representation?.representatives));
  return (
    <StepFrame testId="lead-request-step-billing" step="billing" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
      <Section title={childSectionTitle(text, "insurance", request.minor)}>
        <div className={GRID} data-testid="lead-request-insurance">
          <LabeledField
            id="lead-request-has_insurance"
            label={guardian ? text.hasInsuranceGuardian : text.fields.has_insurance}
            error={errorFor("has_insurance")}
            question
            className="sm:col-span-2 lg:col-span-3"
          >
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
          </LabeledField>
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
      {/* The invoice recipient first, who pays with it (owner spec 2026-10-11). */}
      {request.billing && flowKnown && request.payer !== undefined ? (
        <div id={SECTION_ANCHORS.payer} className="scroll-mt-4 space-y-6">
          <InvoiceRecipientSection
            request={request}
            text={text}
            lang={lang}
            identification={withIdentification ? identification : undefined}
            enqueue={enqueue}
            onChange={onChange}
            partState={parts.on}
          />
        </div>
      ) : null}
      {/* An older server: who pays, then section 7 as it was asked. */}
      {!flowKnown && request.payer !== undefined ? (
        <div id={SECTION_ANCHORS.payer} className="scroll-mt-4 space-y-6">
          <PayerSection
            key={request.payer?.answered_by_payer ? "payer-answered" : "payer"}
            request={request}
            text={text}
            lang={lang}
            identification={withIdentification ? identification : undefined}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={parts.on("payer")}
            // Every answer of "who pays", as before the recipient came first.
            choices={payerChoices(
              { recipient: "third_party", isPayer: "no" },
              request,
              guardian ? (request.payer_self_template ?? null) : null,
            )}
          />
        </div>
      ) : null}
      {request.billing && !flowKnown ? (
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
      {/* How the patient side will pay: once the payer is named. The details are follow-up block C. */}
      {request.billing && flowKnown && payerNamed && request.follow_up !== undefined ? (
        <div id={SECTION_ANCHORS.paymentRoute} className="scroll-mt-4 space-y-6">
          <BillingSections
            request={request}
            billing={request.billing}
            text={text}
            lang={lang}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={parts.on("billing")}
            part="method"
          />
        </div>
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
      {/* An older server still asks the payment route with the base form. */}
      {request.billing && request.follow_up === undefined ? (
        <div id={SECTION_ANCHORS.paymentRoute} className="scroll-mt-4 space-y-6">
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
        </div>
      ) : null}
    </StepFrame>
  );
}

/** Step 6 "Erklärungen": the legal questions, yes or no only. */
export function DeclarationsStep({ request, text, enqueue, onChange, missing, nav }: StepProps) {
  const parts = usePartStates();
  const identification = useIdentificationForm({ request, text, enqueue, onChange, onSaveState: parts.on("identification") });
  return (
    <StepFrame testId="lead-request-step-declarations" step="declarations" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
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
  const full = uploadLimitReached(request);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    // Sending from the next step must wait for every selected document.
    await enqueue(async () => {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          nextErrors.push(text.fileTooLarge(file.name));
          continue;
        }
        try {
          onChange(await uploadLeadDocument(request.lead_id, file));
        } catch (cause) {
          nextErrors.push(`${file.name}: ${errorMessage(cause, text)}`);
        }
      }
    });
    setErrors(nextErrors);
    setUploading(false);
  }

  async function remove(documentId: string) {
    setErrors([]);
    try {
      onChange(await enqueue(() => withdrawLeadDocument(request.lead_id, documentId)));
    } catch (cause) {
      setErrors([errorMessage(cause, text)]);
    }
  }

  return (
    <StepFrame testId="lead-request-documents" step="documents" request={request} text={text} missing={missing} nav={nav} saveState={parts.state}>
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

      {asksReason ? (
        <Section title={childSectionTitle(text, "request", request.minor)}>
          <div data-testid="lead-request-reason">
            <IdentificationFormField form={identification} field="request_reason" text={text}>
              <IdentificationTextArea form={identification} field="request_reason" maxLength={4000} rows={5} disabled={!consentReady} />
            </IdentificationFormField>
            {!consentReady ? <p className="text-xs text-muted-foreground">{text.healthConsentRequired}</p> : null}
          </div>
        </Section>
      ) : null}

      <Section title={childSectionTitle(text, "upload", request.minor)}>
        <p className="text-sm text-muted-foreground">{text.documentsIntro}</p>
        <div className="space-y-2">
          <input
            ref={fileInput}
            id="lead-request-files"
            type="file"
            multiple
            accept={LEAD_UPLOAD_ACCEPT}
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
          {!consentReady ? <ConsentNeededNote>{text.uploadNeedsConsent}</ConsentNeededNote> : null}
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
      </Section>

      {/* The person's own choice of the consent form options (2026-10-12). */}
      <ConsentFormChoicesSection request={request} lang={lang} enqueue={enqueue} onChange={onChange} onSaveState={parts.on("consentForm")} />
    </StepFrame>
  );
}

/**
 * The languages the cabinet offers: only those the browser can name in the
 * cabinet language (no raw codes such as "Aa"), each name once (QA 2026-10-11
 * N-02: Akan and Twi are both «Акан» in Russian; the first code stays, the
 * chosen one always), sorted by that name.
 */
function cabinetLanguageOptions(lang: string, current = "") {
  const seen = new Set<string>();
  return LANGUAGE_OPTIONS.filter((option) => {
    const name = languageName(option.value, lang).toLowerCase();
    if (name === option.value.toLowerCase()) return false;
    if (seen.has(name) && option.value !== current) return false;
    seen.add(name);
    return true;
  }).sort((left, right) => languageName(left.value, lang).localeCompare(languageName(right.value, lang), lang));
}
