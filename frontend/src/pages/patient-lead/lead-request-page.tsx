import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, FileText, LoaderCircle, Send, Trash2, Upload } from "lucide-react";

import { Banner, SuccessBanner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { LANGUAGE_OPTIONS, languageLabel } from "@/components/ui/language-multi-select";
import { checkboxClass, inputClass, selectClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  HEALTH_CONSENT,
  INQUIRY_CONSENT,
  fetchMyLeadRequests,
  giveLeadConsent,
  revokeLeadConsent,
  saveLeadPersonalData,
  submitLeadRequest,
  uploadLeadDocument,
  withdrawLeadDocument,
  type LeadRequest,
} from "./lead-request-api";
import {
  MAX_UPLOAD_BYTES,
  canSubmit,
  consentGiven,
  consentText,
  draftFromPersonalData,
  formatFileSize,
  missingForSubmit,
  personalDataPatch,
  rejectedValue,
  type PersonalDraft,
  type PersonalField,
  type RejectedValue,
} from "./lead-request-model";
import { leadRequestText, type LeadRequestText } from "./lead-request-text";

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
export function LeadRequestPage() {
  const { lang } = useLang();
  const text = leadRequestText(lang);
  const [requests, setRequests] = useState<LeadRequest[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const loaded = await fetchMyLeadRequests();
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

  const replaceRequest = useCallback((next: LeadRequest) => {
    setRequests((current) =>
      current ? current.map((request) => (request.lead_id === next.lead_id ? next : request)) : current,
    );
  }, []);

  if (error) {
    return (
      <LeadCabinetFrame>
        <Banner tone="error">{text.loadFailed}</Banner>
        <Button type="button" variant="outline" onClick={() => void load()}>
          {text.retry}
        </Button>
      </LeadCabinetFrame>
    );
  }
  if (!requests) {
    return (
      <LeadCabinetFrame>
        <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        </div>
      </LeadCabinetFrame>
    );
  }
  const request = requests.find((item) => item.lead_id === selected) ?? null;
  if (!request) {
    return (
      <LeadCabinetFrame>
        <h1 className="text-xl font-semibold">{text.title}</h1>
        <p className="text-sm text-muted-foreground">{text.noRequest}</p>
      </LeadCabinetFrame>
    );
  }

  return (
    <LeadCabinetFrame>
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

function LeadCabinetFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-16" data-testid="lead-cabinet">
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

  return (
    <article className="space-y-5" data-testid="lead-request">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
          {guardian
            ? `${text.titleGuardian}: ${[request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ")}`
            : text.title}
        </h1>
        <p className="text-sm text-muted-foreground">{guardian ? text.introGuardian : text.intro}</p>
        {deadline && !request.submitted_at ? (
          <div
            className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"
            data-testid="lead-request-deadline"
          >
            <p className="font-medium">{text.deadline(deadline)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{text.deadlineNote}</p>
          </div>
        ) : null}
      </header>

      <ol className="grid grid-cols-3 gap-2" aria-label={text.title}>
        {(
          [
            ["data", text.stepData],
            ["documents", text.stepDocuments],
            ["send", text.stepSend],
          ] as const
        ).map(([id, label], index) => (
          <li key={id}>
            <button
              type="button"
              aria-current={step === id ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors",
                step === id
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] font-medium text-[var(--brand)]"
                  : "border-border text-muted-foreground hover:bg-muted/40",
              )}
              onClick={() => setStep(id)}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  step === id ? "bg-[var(--brand)] text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span className="truncate">{label}</span>
            </button>
          </li>
        ))}
      </ol>

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
    </article>
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
    <section className="space-y-4" data-testid="lead-request-data">
      <div className="flex justify-end">
        <SaveIndicator state={saveState} text={text} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
            {...fieldProps("date_of_birth")}
            className={inputClass}
            type="date"
            autoComplete="bday"
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
            placeholder={text.citizenshipsPlaceholder}
            invalid={Boolean(errorFor("citizenships"))}
            onChange={(next) => set("citizenships", next)}
          />
        </FormField>
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
                {languageLabel(option.value, lang === "de" ? "de" : "ru")}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
      </div>

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

      <div className="flex justify-end">
        <Button type="button" onClick={onNext}>
          {text.next}
        </Button>
      </div>
    </section>
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
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={`lead-request-${field}`} className={cn(tokens.text.label, "block")}>
        {text.fields[field]}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`lead-request-${field}-error`} role="alert" className="text-xs text-destructive">
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
        const result = await giveLeadConsent(request.lead_id, purpose, consent.version, lang === "de" ? "de" : "ru");
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
    <div className="rounded-xl border border-border bg-card px-3 py-3" data-testid={testId}>
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
            <a href="/legal" target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">
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
    <section className="space-y-4" data-testid="lead-request-documents">
      <p className="text-sm text-muted-foreground">{text.documentsIntro}</p>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{text.healthConsentTitle}</h2>
        <p className="whitespace-pre-line rounded-xl bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
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
      </div>

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

      <ul className="divide-y divide-border rounded-xl border border-border" data-testid="lead-request-document-list">
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

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {text.back}
        </Button>
        <Button type="button" onClick={onNext}>
          {text.next}
        </Button>
      </div>
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
    <section className="space-y-4" data-testid="lead-request-send">
      {request.submitted_at ? (
        <SuccessBanner>
          <p className="font-semibold">{text.sentTitle}</p>
          <p data-testid="lead-request-sent">{text.sentBody(formatAppDateTime(request.submitted_at))}</p>
          <p className="mt-1 text-xs">{text.sentAgainHint}</p>
        </SuccessBanner>
      ) : null}
      <h2 className="text-base font-semibold">{text.sendTitle}</h2>
      <ul className="space-y-1 text-sm">
        <li>{text.sendSummaryFields(request.progress.filled, request.progress.total)}</li>
        <li>{text.sendSummaryDocuments(request.documents.length)}</li>
      </ul>
      {missing.length > 0 || !inquiryConsent ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{text.missingTitle}</p>
          <ul className="mt-1 list-inside list-disc">
            {missing.map((field) => (
              <li key={field}>{text.fields[field]}</li>
            ))}
            {!inquiryConsent ? <li>{text.inquiryConsentMissing}</li> : null}
          </ul>
          <Button type="button" variant="link" className="h-auto px-0 text-amber-900" onClick={() => onEdit("data")}>
            {text.editData}
          </Button>
        </div>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={() => onEdit(request.submitted_at ? "data" : "documents")}>
          {request.submitted_at ? text.editData : text.back}
        </Button>
        <Button type="button" className="gap-2" disabled={!ready || busy} onClick={() => void send()} data-testid="lead-request-submit">
          {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
          {busy ? text.sending : request.submitted_at ? text.sendAgain : text.sendButton}
        </Button>
      </div>
    </section>
  );
}
