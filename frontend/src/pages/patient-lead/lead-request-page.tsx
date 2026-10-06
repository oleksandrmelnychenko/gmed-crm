import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Clock,
  FileText,
  LoaderCircle,
  Send,
  Upload,
  UserRound,
} from "lucide-react";

import { Banner, Section } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { LANGUAGE_OPTIONS } from "@/components/ui/language-multi-select";
import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey, formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  HEALTH_CONSENT,
  INQUIRY_CONSENT,
  fetchMyLeadRequests,
  saveLeadPersonalData,
  uploadLeadDocument,
  withdrawLeadDocument,
  type LeadRequest,
} from "./lead-request-api";
import {
  ContactChannelsField,
  IdentificationCountrySelect,
  IdentificationFormField,
  IdentificationTextInput,
  IdentityDocumentSection,
  LegalQuestionsSection,
  useIdentificationForm,
} from "./lead-request-identification";
import {
  MAX_UPLOAD_BYTES,
  changedSinceSubmit,
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
} from "./lead-request-model";
import {
  ConsentCheckbox,
  FormField,
  SaveIndicator,
  StepFooter,
  UploadedFileList,
  errorBody,
  errorMessage,
  useAutosave,
  useRequestQueue,
  type RequestQueue,
  type Step,
} from "./lead-request-parts";
import { BillingSections } from "./lead-request-billing";
import { PayerSection } from "./lead-request-payer-section";
import { PayerQuestionnaireSection } from "./lead-request-payer-questionnaire";
import { RepresentationSection } from "./lead-request-representation";
import { SendStep } from "./lead-request-send-step";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  leadRequestText,
  resolveLeadCabinetLang,
  type LeadCabinetLang,
  type LeadRequestText,
} from "./lead-request-text";

/**
 * Lead cabinet (owner decision 2026-10-03): the prospective patient — or a
 * parent for a minor — enters the personal data, uploads documents and sends
 * the request to the manager. Nothing else of the patient portal is shown.
 */
const CABINET_LANG_STORAGE_KEY = "gmed_lead_cabinet_lang";

function storedCabinetLang(): LeadCabinetLang | null {
  try {
    return asLeadCabinetLang(window.localStorage.getItem(CABINET_LANG_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function LeadRequestPage() {
  const { lang: portalLang, setLang: setPortalLang } = useLang();
  const accountLang = useAuth().user?.preferred_language ?? null;
  // The cabinet also speaks UA and EN (owner request 2026-10-04): an explicit
  // choice is remembered, otherwise the language the person entered for the
  // request is used, then the portal language.
  const [chosenLang, setChosenLang] = useState<LeadCabinetLang | null>(storedCabinetLang);
  const [requestLang, setRequestLang] = useState<LeadCabinetLang | null>(null);
  const lang = resolveLeadCabinetLang(chosenLang, requestLang, portalLang);
  const text = leadRequestText(lang);
  const [requests, setRequests] = useState<LeadRequest[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  const chooseLang = useCallback(
    (next: LeadCabinetLang) => {
      setChosenLang(next);
      try {
        window.localStorage.setItem(CABINET_LANG_STORAGE_KEY, next);
      } catch {
        // The choice then lasts for this visit only.
      }
      // The rest of the portal (menu, account) speaks DE and RU.
      if (next === "de" || next === "ru") setPortalLang(next);
    },
    [setPortalLang],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const loaded = await fetchMyLeadRequests();
      setRequestLang(asLeadCabinetLang(loaded[0]?.personal_data.primary_language));
      setRequests(loaded);
      setSelected((current) =>
        current && loaded.some((request) => request.lead_id === current) ? current : loaded[0]?.lead_id ?? null,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // First visit of a request in German or Russian: the whole portal takes that
  // language once, unless the account already has a language of its own (a
  // patient with the full portal); afterwards the person's own choice counts.
  useEffect(() => {
    if (chosenLang || accountLang) return;
    if (requestLang === "de" || requestLang === "ru") chooseLang(requestLang);
  }, [accountLang, chosenLang, requestLang, chooseLang]);

  const replaceRequest = useCallback((next: LeadRequest) => {
    setRequests((current) =>
      current ? current.map((request) => (request.lead_id === next.lead_id ? next : request)) : current,
    );
  }, []);

  if (error) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <Banner tone="error">{text.loadFailed}</Banner>
        <Button type="button" variant="outline" onClick={() => void load()}>
          {text.retry}
        </Button>
      </LeadCabinetFrame>
    );
  }
  if (!requests) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        </div>
      </LeadCabinetFrame>
    );
  }
  const request = requests.find((item) => item.lead_id === selected) ?? null;
  if (!request) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <h1 className="text-xl font-semibold">{text.title}</h1>
        <p className="text-sm text-muted-foreground">{text.noRequest}</p>
      </LeadCabinetFrame>
    );
  }

  return (
    <LeadCabinetFrame lang={lang} onLang={chooseLang}>
      {requests.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={text.requestFor}>
          {requests.map((item) => (
            <button
              key={item.lead_id}
              type="button"
              role="tab"
              aria-selected={item.lead_id === request.lead_id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                item.lead_id === request.lead_id
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-border text-muted-foreground",
              )}
              onClick={() => setSelected(item.lead_id)}
            >
              {[item.personal_data.first_name, item.personal_data.last_name].filter(Boolean).join(" ")}
            </button>
          ))}
        </div>
      ) : null}
      <LeadRequestView key={request.lead_id} request={request} text={text} lang={lang} onChange={replaceRequest} />
    </LeadCabinetFrame>
  );
}

function LeadCabinetFrame({
  lang,
  onLang,
  children,
}: {
  lang: LeadCabinetLang;
  onLang: (lang: LeadCabinetLang) => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-16" data-testid="lead-cabinet">
      <div className="flex justify-end">
        <div
          role="radiogroup"
          aria-label={leadRequestText(lang).language}
          className="inline-flex rounded-lg border border-border bg-card p-0.5"
          data-testid="lead-cabinet-language"
        >
          {LEAD_CABINET_LANGS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={lang === option.value}
              title={option.name}
              lang={option.value}
              className={cn(
                "min-w-10 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                lang === option.value
                  ? "bg-[var(--brand)] text-white"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              onClick={() => onLang(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function LeadRequestView({
  request,
  text,
  lang,
  onChange,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  onChange: (request: LeadRequest) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const [step, setStep] = useState<Step>(request.submitted_at ? "send" : "data");
  // One queue for the writes of all steps: the last answer shown is the newest state.
  const enqueue = useRequestQueue();
  const deadline = request.retention_deadline_at ? formatAppDate(request.retention_deadline_at) : "";
  // The same step tabs as the staff lead wizard (design taken over 2026-10-04).
  const steps = [
    { id: "data", label: text.stepData, Icon: UserRound, done: request.progress.missing_for_submit.length === 0 && consentGiven(request, INQUIRY_CONSENT) },
    { id: "documents", label: text.stepDocuments, Icon: FileText, done: request.documents.length > 0 },
    { id: "send", label: text.stepSend, Icon: Send, done: Boolean(request.submitted_at) && !changedSinceSubmit(request) },
  ] as const;

  return (
    // `overflow-clip`, not `hidden`: a hidden box would be the scroll container of the sticky step footer.
    <article className="overflow-clip rounded-xl border border-border bg-card shadow-sm" data-testid="lead-request">
      <header className="space-y-2 border-b border-border px-4 py-4 sm:px-5">
        <h1 className="text-lg font-semibold leading-tight">
          {guardian
            ? `${text.titleGuardian}: ${[request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ")}`
            : text.title}
        </h1>
        <p className="text-sm text-muted-foreground">{guardian ? text.introGuardian : text.intro}</p>
        {deadline && !request.submitted_at ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="lead-request-deadline"
          >
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{text.deadline(deadline)}</p>
              <p className="mt-0.5 text-xs opacity-80">{text.deadlineNote}</p>
            </div>
          </div>
        ) : null}
      </header>

      <nav
        className="overflow-x-auto overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={text.title}
      >
        <div className="flex w-full justify-center px-3 py-2.5 sm:w-max sm:min-w-full sm:px-4">
          <div className="t-tabs lead-wizard-step-tabs lead-cabinet-step-tabs" role="tablist">
            {steps.map((item, index) => {
              const selected = item.id === step;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  data-step={item.id}
                  aria-selected={selected}
                  aria-current={selected ? "step" : undefined}
                  className="t-tab lead-wizard-step-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setStep(item.id)}
                >
                  <item.Icon aria-hidden="true" className={cn("size-4 shrink-0", item.done && !selected && "max-sm:hidden")} />
                  {item.done && !selected ? (
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-600 sm:hidden" />
                  ) : null}
                  <span className="whitespace-nowrap">{item.label}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none max-sm:hidden",
                      selected
                        ? "bg-white/20 text-white"
                        : item.done
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {item.done ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="px-4 pt-5 sm:px-5">
      {step === "data" ? (
        <PersonalDataStep
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onNext={() => setStep("documents")}
        />
      ) : null}
      {step === "documents" ? (
        <DocumentsStep
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onBack={() => setStep("data")}
          onNext={() => setStep("send")}
        />
      ) : null}
      {step === "send" ? (
        <SendStep
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onEdit={(target) => setStep(target)}
        />
      ) : null}
      </div>
    </article>
  );
}

/** The parts of step "data" that save on their own; the footer shows one state for all. */
type SavePart = "personal" | "payer" | "identification" | "representation" | "billing" | "payerQuestionnaire";

/**
 * Step "data" in the order of the GwG form (owner spec 2026-10-05): consent
 * and contact channels, person, address, contact, identity document, who acts
 * for the lead, insurance, who pays, invoice recipient and payment route,
 * legal questions.
 */
function PersonalDataStep({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onNext,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState<PersonalDraft>(() => draftFromPersonalData(request.personal_data));
  const savedRef = useRef<PersonalDraft>(draftFromPersonalData(request.personal_data));
  const rejectedRef = useRef<RejectedValue | null>(null);
  const failedRef = useRef(false);
  const [saveStates, setSaveStates] = useState<Record<SavePart, SaveState>>({
    personal: "idle",
    payer: "idle",
    identification: "idle",
    representation: "idle",
    billing: "idle",
    payerQuestionnaire: "idle",
  });
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const guardian = request.access_kind === "guardian";

  const setSaveState = useCallback((part: SavePart, state: SaveState) => {
    setSaveStates((current) => (current[part] === state ? current : { ...current, [part]: state }));
  }, []);
  const setPayerSaveState = useCallback((state: SaveState) => setSaveState("payer", state), [setSaveState]);
  const setIdentificationSaveState = useCallback(
    (state: SaveState) => setSaveState("identification", state),
    [setSaveState],
  );
  const setRepresentationSaveState = useCallback(
    (state: SaveState) => setSaveState("representation", state),
    [setSaveState],
  );
  const setBillingSaveState = useCallback((state: SaveState) => setSaveState("billing", state), [setSaveState]);
  const setPayerQuestionnaireSaveState = useCallback(
    (state: SaveState) => setSaveState("payerQuestionnaire", state),
    [setSaveState],
  );

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
            setSaveState("personal", "saved");
          }
          return;
        }
        setSaveState("personal", "saving");
        try {
          const next = await saveLeadPersonalData(request.lead_id, patch);
          savedRef.current = draftFromPersonalData(next.personal_data);
          rejectedRef.current = null;
          failedRef.current = false;
          setFieldError(null);
          setSaveState("personal", "saved");
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
          setSaveState("personal", "error");
        }
      });
    },
    [enqueue, onChange, request.lead_id, setSaveState, text],
  );

  useAutosave(draft, save);

  // The statements for the identification are one record, asked in several
  // sections below. An older server does not know them: the sections stay away.
  const identification = useIdentificationForm({
    request,
    text,
    enqueue,
    onChange,
    onSaveState: setIdentificationSaveState,
  });
  const withIdentification = request.identification !== undefined;

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

  return (
    <section className="space-y-6" data-testid="lead-request-data">
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
        {withIdentification ? <ContactChannelsField form={identification} text={text} /> : null}
      </Section>

      <Section title={text.sectionPerson}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
          className={withIdentification ? "sm:col-start-1" : undefined}
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
        <FormField field="citizenships" text={text} error={errorFor("citizenships")} required>
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
      <Section title={text.sectionAddress}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
      </Section>

      {withIdentification ? (
        <IdentityDocumentSection
          request={request}
          form={identification}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
        />
      ) : null}

      {/* An older server does not know who acts for the lead. Adult or minor: the block starts anew with the other questions. */}
      {request.representation ? (
        <RepresentationSection
          key={request.minor ? "minor" : "adult"}
          request={request}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={setRepresentationSaveState}
        />
      ) : null}

      <Section title={text.sectionInsurance}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2" data-testid="lead-request-insurance">
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

      {/* An older server does not know the question yet. */}
      {request.payer !== undefined ? (
        <PayerSection
          request={request}
          text={text}
          lang={lang}
          identification={withIdentification ? identification : undefined}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={setPayerSaveState}
        />
      ) : null}

      {/* Invoice recipient and payment route; an older server does not know them. */}
      {request.billing ? (
        <BillingSections
          request={request}
          billing={request.billing}
          text={text}
          lang={lang}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={setBillingSaveState}
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
          onSaveState={setPayerQuestionnaireSaveState}
        />
      ) : null}

      {withIdentification ? (
        <LegalQuestionsSection form={identification} text={text} lang={lang} guardian={guardian} />
      ) : null}

      <StepFooter
        index={1}
        text={text}
        status={<SaveIndicator state={combinedSaveState(Object.values(saveStates))} text={text} />}
      >
        <Button type="button" variant="outline" className="h-9" disabled>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {text.back}
        </Button>
        <Button type="button" className="h-9" onClick={onNext}>
          {text.next}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Button>
      </StepFooter>
    </section>
  );
}

function DocumentsStep({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onBack,
  onNext,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const consentReady = consentGiven(request, HEALTH_CONSENT);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const full = request.documents.length >= request.max_documents;

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    let latest = request;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        nextErrors.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        latest = await enqueue(() => uploadLeadDocument(request.lead_id, file));
        onChange(latest);
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
    <section className="space-y-6" data-testid="lead-request-documents">
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

      <StepFooter index={2} text={text}>
        <Button type="button" variant="outline" className="h-9" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {text.back}
        </Button>
        <Button type="button" className="h-9" onClick={onNext}>
          {text.next}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Button>
      </StepFooter>
    </section>
  );
}
