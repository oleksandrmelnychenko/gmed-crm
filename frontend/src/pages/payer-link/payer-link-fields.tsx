import type { ReactNode } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, textareaClass } from "@/components/record-workspace/primitives/design-tokens";
import { cn } from "@/lib/utils";
import { asLeadCabinetLang } from "@/pages/patient-lead/lead-request-text";

import type { PayerDocument, PayerType } from "./payer-link-api";
import type { FundsSource, PayerDraft, PayerField, PayerTextField } from "./payer-link-model";
import { LabeledField } from "./payer-link-parts";
import { fieldLabel, type PayerLinkText } from "./payer-link-text";

// The fields the steps of the payer page are built from: each reads one key
// of the draft, shows its label and the server's objection.

/** The draft with what the server refused, as the steps use it. */
export type AnswersForm = {
  draft: PayerDraft;
  set: <Field extends keyof PayerDraft>(field: Field, value: PayerDraft[Field]) => void;
  update: (change: (draft: PayerDraft) => PayerDraft) => void;
  errorFor: (field: PayerField) => string | undefined;
};

/** What every step needs. */
export type StepContext = {
  form: AnswersForm;
  text: PayerLinkText;
  lang: string;
  payerType: PayerType;
  required: (field: PayerField) => boolean;
  /** The sources of funds offered, in form order (the server's list for the payer type). */
  fundsSources: readonly FundsSource[];
  /**
   * The server knows block E of an organisation (legal form, VAT id, why it
   * pays; trigger flow 2026-10-07): it sends the keys. Absent on an older server.
   */
  organisationExtras?: boolean;
};

/** Uploads of one kind, as the form runs them. */
export type UploadControl = {
  documents: readonly PayerDocument[];
  busy: boolean;
  errors: readonly string[];
  upload: (files: File[]) => void;
  remove: (documentId: string) => void;
};

export const fieldId = (field: string) => `payer-link-${field}`;

export function controlProps(form: AnswersForm, field: PayerField) {
  const invalid = Boolean(form.errorFor(field));
  return {
    id: fieldId(field),
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? `${fieldId(field)}-error` : undefined,
  };
}

/** A field with its label and the server's objection. */
export function Field({
  context,
  field,
  className,
  question = false,
  label,
  children,
}: {
  context: StepContext;
  field: PayerField;
  className?: string;
  question?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <LabeledField
      id={fieldId(field)}
      label={label ?? fieldLabel(context.text, field, context.payerType)}
      error={context.form.errorFor(field)}
      required={context.required(field)}
      question={question}
      className={className}
    >
      {children}
    </LabeledField>
  );
}

export function TextInput({
  context,
  field,
  maxLength,
  autoComplete = "off",
  type = "text",
}: {
  context: StepContext;
  field: PayerTextField;
  maxLength: number;
  autoComplete?: string;
  type?: "text" | "tel";
}) {
  const { form } = context;
  return (
    <Input
      {...controlProps(form, field)}
      className={inputClass}
      type={type}
      autoComplete={autoComplete}
      maxLength={maxLength}
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
}

export function TextArea({ context, field, describedBy }: { context: StepContext; field: PayerTextField; describedBy?: string }) {
  const { form } = context;
  const props = controlProps(form, field);
  return (
    <textarea
      {...props}
      aria-describedby={[describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined}
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

export function DateInput({ context, field, max }: { context: StepContext; field: PayerTextField; max?: string }) {
  const { form, lang } = context;
  return (
    <Input
      key={`${field}-${lang}`}
      {...controlProps(form, field)}
      className={inputClass}
      type="date"
      autoComplete="off"
      pickerLang={asLeadCabinetLang(lang) ?? undefined}
      max={max}
      value={form.draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
}

export function CountryInput({ context, field }: { context: StepContext; field: PayerTextField }) {
  const { form, lang } = context;
  return (
    <CountrySelect
      value={form.draft[field] || null}
      lang={lang}
      className={selectClass}
      aria-label={fieldLabel(context.text, field, context.payerType)}
      onChange={(code) => form.set(field, code ?? "")}
    />
  );
}

export function ChoiceInput<Value extends string>({
  context,
  field,
  options,
  labels,
  onChange,
}: {
  context: StepContext;
  field: PayerTextField;
  options: readonly Value[];
  labels: Record<Value, string>;
  onChange?: (value: string) => void;
}) {
  const { form, text } = context;
  return (
    <NativeComboboxSelect
      {...controlProps(form, field)}
      className={selectClass}
      value={form.draft[field]}
      onChange={(event) => (onChange ? onChange(event.target.value) : form.set(field, event.target.value))}
    >
      <option value="">{text.choose}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option]}
        </option>
      ))}
    </NativeComboboxSelect>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:col-span-2 lg:col-span-3">{children}</p>;
}
