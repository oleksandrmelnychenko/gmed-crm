import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  LoaderCircle,
  Pencil,
  Send,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";

import { Banner, Section, SuccessBanner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { LANGUAGE_OPTIONS } from "@/components/ui/language-multi-select";
import { checkboxClass, inputClass, selectClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  HEALTH_CONSENT,
  INQUIRY_CONSENT,
  fetchMyLeadRequests,
  giveLeadConsent,
  revokeLeadConsent,
  saveLeadPayer,
  saveLeadPersonalData,
  submitLeadRequest,
  uploadLeadDocument,
  withdrawLeadDocument,
  type LeadRequest,
} from "./lead-request-api";
import {
  MAX_UPLOAD_BYTES,
  canSubmit,
  changedSinceSubmit,
  consentGiven,
  consentText,
  draftFromPayer,
  draftFromPersonalData,
  formatFileSize,
  languageName,
  missingForSubmit,
  payerInput,
  personalDataPatch,
  rejectedValue,
  withInsuranceAnswer,
  type PayerDraft,
  type PayerField,
  type PersonalDraft,
  type PersonalField,
  type RejectedValue,
} from "./lead-request-model";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  leadRequestText,
  payerFieldLabel,
  resolveLeadCabinetLang,
  submitFieldLabel,
  type LeadCabinetLang,
  type LeadRequestText,
} from "./lead-request-text";

type Step = "data" | "documents" | "send";

function errorBody(error: unknown): Record<string, unknown> | null {
  return error instanceof ApiRequestError && error.body ? (error.body as Record<string, unknown>) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
        <PersonalDataStep request={request} text={text} lang={lang} onChange={onChange} onNext={() => setStep("documents")} />
      ) : null}
      {step === "documents" ? (
        <DocumentsStep
          request={request}
          text={text}
          lang={lang}
          onChange={onChange}
          onBack={() => setStep("data")}
          onNext={() => setStep("send")}
        />
      ) : null}
      {step === "send" ? (
        <SendStep request={request} text={text} onChange={onChange} onEdit={(target) => setStep(target)} />
      ) : null}
      </div>
    </article>
  );
}

const STEP_COUNT = 3;

/** The bottom bar of a step, as in the staff lead wizard: progress and save state above the buttons. */
function StepFooter({
  index,
  text,
  status,
  children,
}: {
  index: number;
  text: LeadRequestText;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The page scrolls with a bottom padding; the `after` strip covers the form that would show through it.
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-card px-4 py-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-card sm:-mx-5 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{text.stepOf(index, STEP_COUNT)}</span>
        {status}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function PersonalDataStep({
  request,
  text,
  lang,
  onChange,
  onNext,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  onChange: (request: LeadRequest) => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState<PersonalDraft>(() => draftFromPersonalData(request.personal_data));
  const savedRef = useRef<PersonalDraft>(draftFromPersonalData(request.personal_data));
  const rejectedRef = useRef<RejectedValue | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const save = useCallback(
    (snapshot: PersonalDraft) => {
      queueRef.current = queueRef.current.then(async () => {
        const patch = personalDataPatch(savedRef.current, snapshot, rejectedRef.current);
        if (Object.keys(patch).length === 0) return;
        setSaveState("saving");
        try {
          const next = await saveLeadPersonalData(request.lead_id, patch);
          savedRef.current = draftFromPersonalData(next.personal_data);
          rejectedRef.current = null;
          setFieldError(null);
          setSaveState("saved");
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
          setSaveState("error");
        }
      });
    },
    [onChange, request.lead_id, text],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => save(draft), 700);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

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
      <Section title={text.sectionPerson}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <FormField field="first_name" text={text} error={errorFor("first_name")} required>
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
        <PayerSection request={request} text={text} lang={lang} onChange={onChange} onSaveState={setSaveState} />
      ) : null}

      <Section title={text.sectionConsent}>
        <ConsentCheckbox
          request={request}
          purpose={INQUIRY_CONSENT}
          text={text}
          lang={lang}
          onChange={onChange}
          label={consentText(request, INQUIRY_CONSENT, lang) || text.inquiryConsentLabel}
          testId="lead-request-inquiry-consent"
          privacyLink
        />
      </Section>

      <StepFooter index={1} text={text} status={<SaveIndicator state={saveState} text={text} />}>
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

/**
 * "Who pays" (owner request 2026-10-05): the patient, or another person who
 * is then named. The answer is saved as a whole; the server keeps it in the
 * lead's payer declaration, where the sanctions screening picks it up.
 */
function PayerSection({
  request,
  text,
  lang,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const [draft, setDraft] = useState<PayerDraft>(() => draftFromPayer(request.payer));
  const savedRef = useRef<PayerDraft>(draftFromPayer(request.payer));
  const rejectedRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [fieldError, setFieldError] = useState<string | null>(null);
  const options = request.access_kind === "guardian" ? text.payerOptionsGuardian : text.payerOptions;

  const save = useCallback(
    (snapshot: PayerDraft) => {
      queueRef.current = queueRef.current.then(async () => {
        const input = payerInput(snapshot);
        if (!input) return;
        const key = JSON.stringify(input);
        if (key === JSON.stringify(payerInput(savedRef.current)) || key === rejectedRef.current) return;
        onSaveState("saving");
        try {
          const next = await saveLeadPayer(request.lead_id, input);
          savedRef.current = draftFromPayer(next.payer);
          rejectedRef.current = null;
          setFieldError(null);
          onSaveState("saved");
          onChange(next);
        } catch (cause) {
          // The refused answer is not repeated until the patient changes it.
          rejectedRef.current = key;
          const field = errorBody(cause)?.field;
          setFieldError(typeof field === "string" ? field : "payer");
          onSaveState("error");
        }
      });
    },
    [onChange, onSaveState, request.lead_id],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => save(draft), 700);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  const set = <K extends keyof PayerDraft>(field: K, value: PayerDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const errorFor = (field: PayerField) => (fieldError === field ? text.invalidField : undefined);
  const fieldProps = (field: PayerField) => ({
    id: `lead-request-${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-${field}-error` : undefined,
  });
  const field = (name: PayerField, required = false, className?: string) => ({
    id: `lead-request-${name}`,
    label: payerFieldLabel(text, name),
    error: errorFor(name),
    required,
    className,
  });

  return (
    <Section title={text.sectionPayer}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2" data-testid="lead-request-payer">
        <LabeledField {...field("payer_kind", true, "sm:col-span-2")}>
          <NativeComboboxSelect
            {...fieldProps("payer_kind")}
            className={selectClass}
            value={draft.payer_kind}
            onChange={(event) => set("payer_kind", event.target.value)}
          >
            <option value="">{text.choose}</option>
            <option value="self">{options.self}</option>
            <option value="third_party">{options.third_party}</option>
          </NativeComboboxSelect>
        </LabeledField>
        {/* Another person's data exist only when another person pays. */}
        {draft.payer_kind === "third_party" ? (
          <>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{text.payerIntro}</p>
            <LabeledField {...field("payer_first_name", true)}>
              <Input
                {...fieldProps("payer_first_name")}
                className={inputClass}
                autoComplete="off"
                value={draft.first_name}
                onChange={(event) => set("first_name", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_last_name", true)}>
              <Input
                {...fieldProps("payer_last_name")}
                className={inputClass}
                autoComplete="off"
                value={draft.last_name}
                onChange={(event) => set("last_name", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_citizenships", true)}>
              <CitizenshipMultiSelect
                id="lead-request-payer_citizenships"
                value={draft.citizenships}
                lang={lang}
                placeholder={text.citizenshipsPlaceholder}
                invalid={Boolean(errorFor("payer_citizenships"))}
                onChange={(next) => set("citizenships", next)}
              />
            </LabeledField>
            <LabeledField {...field("payer_date_of_birth")}>
              <Input
                key={`payer_date_of_birth-${lang}`}
                {...fieldProps("payer_date_of_birth")}
                className={inputClass}
                type="date"
                autoComplete="off"
                pickerLang={asLeadCabinetLang(lang) ?? undefined}
                max={appDateKey()}
                value={draft.date_of_birth}
                onChange={(event) => set("date_of_birth", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_relationship", false, "sm:col-span-2")}>
              <Input
                {...fieldProps("payer_relationship")}
                className={inputClass}
                autoComplete="off"
                value={draft.relationship}
                onChange={(event) => set("relationship", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_street", false, "sm:col-span-2")}>
              <Input
                {...fieldProps("payer_street")}
                className={inputClass}
                autoComplete="off"
                value={draft.street}
                onChange={(event) => set("street", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_zip")}>
              <Input
                {...fieldProps("payer_zip")}
                className={inputClass}
                autoComplete="off"
                value={draft.zip}
                onChange={(event) => set("zip", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_city")}>
              <Input
                {...fieldProps("payer_city")}
                className={inputClass}
                autoComplete="off"
                value={draft.city}
                onChange={(event) => set("city", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_country")}>
              <CountrySelect
                value={draft.country || null}
                lang={lang}
                className={selectClass}
                aria-label={payerFieldLabel(text, "payer_country")}
                onChange={(code) => set("country", code ?? "")}
              />
            </LabeledField>
            <LabeledField {...field("payer_phone")}>
              <Input
                {...fieldProps("payer_phone")}
                className={inputClass}
                type="tel"
                autoComplete="off"
                value={draft.phone}
                onChange={(event) => set("phone", event.target.value)}
              />
            </LabeledField>
            <LabeledField {...field("payer_email", false, "sm:col-span-2")}>
              <Input
                {...fieldProps("payer_email")}
                className={inputClass}
                type="email"
                autoComplete="off"
                value={draft.email}
                onChange={(event) => set("email", event.target.value)}
              />
            </LabeledField>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{text.payerInformHint}</p>
          </>
        ) : null}
        {fieldError === "payer" ? (
          <p role="alert" className="text-xs text-destructive sm:col-span-2">
            {text.notSaved}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function FormField({
  field,
  text,
  error,
  required = false,
  className,
  children,
}: {
  field: PersonalField;
  text: LeadRequestText;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LabeledField
      id={`lead-request-${field}`}
      label={text.fields[field]}
      error={error}
      required={required}
      className={className}
    >
      {children}
    </LabeledField>
  );
}

/** A label, its control and the error below it. */
function LabeledField({
  id,
  label,
  error,
  required = false,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className={cn(tokens.text.label, "block")}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state, text }: { state: SaveState; text: LeadRequestText }) {
  if (state === "idle") return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="lead-request-save-state"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saving" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {state === "saved" ? <Check aria-hidden="true" className="size-3.5 text-emerald-600" /> : null}
      {state === "error" ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
      {state === "saving" ? text.saving : state === "saved" ? text.saved : text.notSaved}
    </span>
  );
}

/** A consent checkbox: checking gives the consent with the shown text, unchecking withdraws it. */
function ConsentCheckbox({
  request,
  purpose,
  text,
  lang,
  label,
  onChange,
  testId,
  privacyLink = false,
}: {
  request: LeadRequest;
  purpose: string;
  text: LeadRequestText;
  lang: string;
  label: string;
  onChange: (request: LeadRequest) => void;
  testId: string;
  privacyLink?: boolean;
}) {
  const consent = request.consents[purpose];
  const given = consentGiven(request, purpose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle(checked: boolean) {
    if (!consent) return;
    if (!checked && !window.confirm(text.consentWithdrawConfirm)) return;
    setBusy(true);
    setError("");
    try {
      if (checked) {
        const result = await giveLeadConsent(request.lead_id, purpose, consent.version, lang);
        onChange({
          ...request,
          consents: { ...request.consents, [purpose]: { ...consent, given_at: result.given_at } },
        });
      } else {
        await revokeLeadConsent(request.lead_id, purpose);
        onChange({ ...request, consents: { ...request.consents, [purpose]: { ...consent, given_at: null } } });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid={testId}>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className={cn(checkboxClass, "mt-0.5")}
          checked={given}
          disabled={busy || !consent}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="space-y-1">
          <span className="block leading-snug">{label}</span>
          {privacyLink ? (
            <a href="/legal#privacy" target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">
              {text.privacyLink}
            </a>
          ) : null}
          {given && consent?.given_at ? (
            <span className="block text-xs text-muted-foreground">{text.consentGivenAt(formatAppDateTime(consent.given_at))}</span>
          ) : null}
        </span>
      </label>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function DocumentsStep({
  request,
  text,
  lang,
  onChange,
  onBack,
  onNext,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
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
        latest = await uploadLeadDocument(request.lead_id, file);
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
      onChange(await withdrawLeadDocument(request.lead_id, documentId));
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

      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="lead-request-document-list">
        {request.documents.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">{text.noDocuments}</li>
        ) : (
          request.documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{document.file_name ?? "—"}</span>
                <span className="block text-xs text-muted-foreground">
                  {[formatAppDateTime(document.uploaded_at), formatFileSize(document.size_bytes, lang)].filter(Boolean).join(" · ")}
                  {document.reviewed ? ` · ${text.documentTakenOver}` : ""}
                </span>
              </span>
              {document.can_delete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => void remove(document.id)}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  {text.removeDocument}
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>
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

function SendStep({
  request,
  text,
  onChange,
  onEdit,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  onChange: (request: LeadRequest) => void;
  onEdit: (step: Step) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missing = missingForSubmit(request);
  const inquiryConsent = consentGiven(request, INQUIRY_CONSENT);
  const ready = canSubmit(request, INQUIRY_CONSENT);
  const sent = Boolean(request.submitted_at);
  // Sent and unchanged: there is nothing to send. Sent and changed: send again.
  const changed = changedSinceSubmit(request);

  async function send() {
    setBusy(true);
    setError("");
    try {
      onChange(await submitLeadRequest(request.lead_id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" data-testid="lead-request-send">
      {request.submitted_at ? (
        <>
          <SuccessBanner>
            <p className="font-semibold">{text.sentTitle}</p>
            <p data-testid="lead-request-sent">{text.sentBody(formatAppDateTime(request.submitted_at))}</p>
          </SuccessBanner>
          {changed ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              data-testid="lead-request-changed"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{text.changedAfterSend}</p>
            </div>
          ) : null}
          <Section title={text.nextTitle}>
            <ol className="space-y-2.5 text-sm" data-testid="lead-request-next-steps">
              {text.nextSteps.map((item, index) => (
                <li key={item} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] font-mono text-[11px] font-medium text-[var(--brand)]"
                  >
                    {index + 1}
                  </span>
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      ) : null}
      <Section title={request.submitted_at ? text.sentSummaryTitle : text.sendTitle}>
      <ul className="space-y-1 text-sm">
        <li>{text.sendSummaryFields(request.progress.filled, request.progress.total)}</li>
        <li>{text.sendSummaryDocuments(request.documents.length)}</li>
      </ul>
      {missing.length > 0 || !inquiryConsent ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{text.missingTitle}</p>
          <ul className="mt-1 list-inside list-disc">
            {missing.map((field) => (
              <li key={field}>{submitFieldLabel(text, field)}</li>
            ))}
            {!inquiryConsent ? <li>{text.inquiryConsentMissing}</li> : null}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            onClick={() => onEdit("data")}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {text.editData}
          </Button>
        </div>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      </Section>
      <StepFooter index={3} text={text}>
        {request.submitted_at ? (
          // Sent already: changing the request is the secondary path, not the next step.
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit("data")}>
              <Pencil aria-hidden="true" className="size-3.5" />
              {text.editData}
            </Button>
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit("documents")}>
              <Upload aria-hidden="true" className="size-3.5" />
              {text.addDocuments}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-9" onClick={() => onEdit("documents")}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {text.back}
          </Button>
        )}
        {sent && !changed ? null : (
          <Button
            type="button"
            className="h-9 gap-2"
            disabled={!ready || busy}
            onClick={() => void send()}
            data-testid="lead-request-submit"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
            {busy ? text.sending : sent ? text.sendAgain : text.sendButton}
          </Button>
        )}
      </StepFooter>
    </section>
  );
}
