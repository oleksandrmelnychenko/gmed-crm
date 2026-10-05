import { useCallback, useRef, useState } from "react";

import { Section } from "@/components/ui-shell";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, textareaClass } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import { saveLeadPayer, type LeadRequest } from "./lead-request-api";
import {
  IdentificationFormField,
  IdentificationTextArea,
  type IdentificationForm,
} from "./lead-request-identification";
import {
  PAYER_FIELDS,
  draftFromPayer,
  payerInput,
  type PayerDraft,
  type PayerField,
  type SaveState,
} from "./lead-request-model";
import { LabeledField, YesNoSelect, errorBody, useAutosave, type RequestQueue } from "./lead-request-parts";
import { asLeadCabinetLang, payerFieldLabel, type LeadRequestText } from "./lead-request-text";

/**
 * "Who pays" (owner request 2026-10-05): the patient, or another person who
 * is then named. The answer is saved as a whole; the server keeps it in the
 * lead's payer declaration, where the sanctions screening picks it up. With
 * the GwG statements (`identification`) the block also asks for the own
 * economic interest and, for another person, why that person pays.
 */
export function PayerSection({
  request,
  text,
  lang,
  identification,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  /** The GwG statements; absent on a server that does not know them yet. */
  identification?: IdentificationForm;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const [draft, setDraft] = useState<PayerDraft>(() => draftFromPayer(request.payer));
  const savedRef = useRef<PayerDraft>(draftFromPayer(request.payer));
  const rejectedRef = useRef<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const guardian = request.access_kind === "guardian";
  const options = guardian ? text.payerOptionsGuardian : text.payerOptions;

  const save = useCallback(
    (snapshot: PayerDraft) => {
      void enqueue(async () => {
        const input = payerInput(snapshot);
        const key = JSON.stringify(input);
        if (key === JSON.stringify(payerInput(savedRef.current))) {
          // Back at the saved answer: an answer the server refused in between is no error any more.
          if (rejectedRef.current !== null) {
            rejectedRef.current = null;
            setFieldError(null);
            onSaveState("saved");
          }
          return;
        }
        if (!input || key === rejectedRef.current) return;
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
          setFieldError(PAYER_FIELDS.includes(field as PayerField) ? (field as PayerField) : "payer");
          onSaveState("error");
        }
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id],
  );

  useAutosave(draft, save);

  const set = <K extends keyof PayerDraft>(field: K, value: PayerDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const setPayerKind = (kind: string) => {
    set("payer_kind", kind);
    // Why another person pays is a question about that person only.
    if (kind !== "third_party" && identification?.draft.payment_background) identification.set("payment_background", "");
  };
  const errorFor = (field: PayerField) => (fieldError === field ? text.invalidField : undefined);
  const fieldProps = (field: PayerField) => ({
    id: `lead-request-${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-${field}-error` : undefined,
  });
  const field = (name: PayerField, required = false, className?: string) => ({
    id: `lead-request-${name}`,
    label: payerFieldLabel(text, name, guardian),
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
            onChange={(event) => setPayerKind(event.target.value)}
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
            {identification ? (
              <IdentificationFormField
                form={identification}
                field="payment_background"
                text={text}
                required
                className="sm:col-span-2"
              >
                <IdentificationTextArea form={identification} field="payment_background" />
              </IdentificationFormField>
            ) : null}
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
        {/* The own economic interest is part of the answer "who pays": it is saved with it. */}
        {identification && draft.payer_kind ? (
          <>
            <LabeledField {...field("payer_own_account", true, "sm:col-span-2")}>
              <YesNoSelect
                id="lead-request-payer_own_account"
                className="sm:max-w-[calc(50%-0.5rem)]"
                value={draft.acts_on_own_account}
                text={text}
                // The server keeps an answer once given; it can be changed, not taken back.
                keepAnswer
                invalid={Boolean(errorFor("payer_own_account"))}
                onChange={(answer) => set("acts_on_own_account", answer)}
              />
            </LabeledField>
            {draft.acts_on_own_account === "no" ? (
              <LabeledField {...field("payer_beneficial_owner", true, "sm:col-span-2")}>
                <textarea
                  {...fieldProps("payer_beneficial_owner")}
                  className={cn(textareaClass, "text-base md:text-sm")}
                  rows={3}
                  maxLength={2000}
                  autoComplete="off"
                  value={draft.beneficial_owner}
                  onChange={(event) => set("beneficial_owner", event.target.value)}
                />
              </LabeledField>
            ) : null}
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
