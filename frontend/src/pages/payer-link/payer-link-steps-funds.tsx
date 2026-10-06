import { useRef, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

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
import { PAYMENT_METHODS, asksAccount, withPaymentMethod, withViaThirdParty } from "@/pages/patient-lead/lead-request-billing-model";
import { asLeadCabinetLang } from "@/pages/patient-lead/lead-request-text";

import {
  ChoiceInput,
  Field,
  TextArea,
  TextInput,
  controlProps,
  fieldId,
  type StepContext,
  type UploadControl,
} from "./payer-link-fields";
import {
  FUNDS_SOURCES,
  MAX_OWNERS,
  RELATIONSHIP_KINDS,
  emptyOwner,
  isOrganisation,
  ownerProblems,
  routeDraft,
  withFundsSource,
  withOwnersNone,
  withRelationshipKind,
  withRoute,
  type OwnerDraft,
  type OwnerField,
} from "./payer-link-model";
import { LabeledField, Notice, RequiredMark, UploadBlock, YesNoSelect } from "./payer-link-parts";

// Steps 4–6 of the payer page (contract phase 3a, 5.1): the beneficial
// owners of an organisation, the relationship and the source of funds, and
// the payment route of phase 2's section 8.

// ---------------------------------------------------------------------------
// 4 Beneficial owners
// ---------------------------------------------------------------------------

function OwnerCard({
  context,
  index,
  owner,
  problem,
  onChange,
  onRemove,
}: {
  context: StepContext;
  index: number;
  owner: OwnerDraft;
  problem: "incomplete" | "share" | null;
  onChange: (field: OwnerField, value: string) => void;
  onRemove: () => void;
}) {
  const { text, lang } = context;
  const id = (field: OwnerField) => `payer-link-owner-${index}-${field}`;
  const input = (field: OwnerField, maxLength: number, inputMode?: "decimal") => (
    <Input
      id={id(field)}
      className={inputClass}
      autoComplete="off"
      maxLength={maxLength}
      inputMode={inputMode}
      value={owner[field]}
      onChange={(event) => onChange(field, event.target.value)}
    />
  );
  const labeled = (field: OwnerField, control: ReactNode, className?: string) => (
    <LabeledField
      id={id(field)}
      label={text.ownerFields[field]}
      required={field === "first_name" || field === "last_name" || field === "share_percent"}
      className={className}
    >
      {control}
    </LabeledField>
  );
  return (
    <fieldset className="space-y-3 rounded-lg border border-border px-3 py-3" data-testid={`payer-link-owner-${index}`}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">{text.ownerHeading(index + 1)}</legend>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onRemove}>
          <Trash2 aria-hidden="true" className="size-3.5" />
          {text.removeOwner}
        </Button>
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {labeled("first_name", input("first_name", 100))}
        {labeled("last_name", input("last_name", 100))}
        {labeled(
          "date_of_birth",
          <Input
            key={`owner-${index}-dob-${lang}`}
            id={id("date_of_birth")}
            className={inputClass}
            type="date"
            autoComplete="off"
            pickerLang={asLeadCabinetLang(lang) ?? undefined}
            max={appDateKey()}
            value={owner.date_of_birth}
            onChange={(event) => onChange("date_of_birth", event.target.value)}
          />,
        )}
        {labeled("birth_place", input("birth_place", 200))}
        {labeled("street", input("street", 200), "sm:col-span-2")}
        {labeled("zip", input("zip", 20))}
        {labeled("city", input("city", 200))}
        {labeled(
          "country",
          <CountrySelect
            value={owner.country || null}
            lang={lang}
            className={selectClass}
            aria-label={text.ownerFields.country}
            onChange={(code) => onChange("country", code ?? "")}
          />,
        )}
        {labeled("share_percent", input("share_percent", 6, "decimal"))}
      </div>
      {problem ? (
        <p className="text-xs text-amber-800 dark:text-amber-200" data-testid={`payer-link-owner-${index}-problem`}>
          {problem === "incomplete" ? text.ownerIncomplete : text.ownerShare}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Every natural person above 25 % — or "nobody". A person goes to the server
 * only with both names and a share; the list only when the shares fit.
 */
export function OwnersStep({ context }: { context: StepContext }) {
  const { form, text } = context;
  const none = form.draft.beneficial_owners_none === "yes";
  const owners = form.draft.beneficial_owners;
  const problems = ownerProblems(owners);
  const error = form.errorFor("beneficial_owners");
  const setOwners = (next: OwnerDraft[]) => form.update((draft) => ({ ...draft, beneficial_owners: next }));

  return (
    <div className="space-y-4" data-testid="payer-link-step-owners">
      <p className="text-sm leading-6 text-muted-foreground">{text.ownersIntro}</p>
      {context.payerType !== "company" ? <p className="text-xs text-muted-foreground">{text.ownersOptional}</p> : null}
      <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/10 px-3 py-3 text-sm">
        <input
          type="checkbox"
          id={fieldId("beneficial_owners_none")}
          className={cn(checkboxClass, "mt-0.5")}
          checked={none}
          onChange={(event) => form.update((draft) => withOwnersNone(draft, event.target.checked))}
        />
        <span className="leading-snug">{text.fields.beneficial_owners_none}</span>
      </label>
      {none ? null : (
        <div className="space-y-3" data-testid="payer-link-owners">
          {owners.length === 0 ? <p className="text-sm text-muted-foreground">{text.noOwners}</p> : null}
          {owners.map((owner, index) => (
            <OwnerCard
              // Owners have no id of their own; the position is what the list is.
              key={index}
              context={context}
              index={index}
              owner={owner}
              problem={problems.rows[index] ?? null}
              onChange={(field, value) => setOwners(owners.map((item, position) => (position === index ? { ...item, [field]: value } : item)))}
              onRemove={() => setOwners(owners.filter((_, position) => position !== index))}
            />
          ))}
          {problems.total ? (
            <Notice tone="warning" testId="payer-link-owners-total">
              {text.ownersTotal}
            </Notice>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={owners.length >= MAX_OWNERS}
            onClick={() => setOwners([...owners, emptyOwner()])}
          >
            <Plus aria-hidden="true" className="size-4" />
            {text.addOwner}
          </Button>
          {owners.length >= MAX_OWNERS ? <p className="text-xs text-muted-foreground">{text.ownersLimit}</p> : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 Relationship and source of funds
// ---------------------------------------------------------------------------

export function FundsStep({
  context,
  proofRequired,
  uploads,
}: {
  context: StepContext;
  proofRequired: boolean;
  uploads: UploadControl;
}) {
  const { form, text, lang } = context;
  const organisation = isOrganisation(context.payerType);
  return (
    <div className="space-y-5" data-testid="payer-link-step-funds">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field context={context} field="relationship_kind">
          <ChoiceInput
            context={context}
            field="relationship_kind"
            options={RELATIONSHIP_KINDS}
            labels={text.relationshipKinds}
            onChange={(kind) => form.update((draft) => withRelationshipKind(draft, kind))}
          />
        </Field>
        {form.draft.relationship_kind === "other" ? (
          <Field context={context} field="relationship">
            <TextInput context={context} field="relationship" maxLength={200} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        {organisation ? (
          <Field context={context} field="industry">
            <TextInput context={context} field="industry" maxLength={200} />
          </Field>
        ) : (
          <Field context={context} field="occupation">
            <TextInput context={context} field="occupation" maxLength={200} />
          </Field>
        )}
      </div>

      <div role="group" aria-labelledby="payer-link-funds_sources-label" data-testid="payer-link-funds-sources">
        <p id="payer-link-funds_sources-label" className={tokens.text.label}>
          {text.fields.funds_sources}
          {context.required("funds_sources") ? <RequiredMark /> : null}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {FUNDS_SOURCES.map((source) => (
            <label key={source} className="flex items-start gap-2 text-sm leading-snug">
              <input
                type="checkbox"
                className={cn(checkboxClass, "mt-0.5")}
                checked={form.draft.funds_sources.includes(source)}
                onChange={(event) => form.update((draft) => withFundsSource(draft, source, event.target.checked))}
              />
              <span className="min-w-0">{text.fundsSources[source]}</span>
            </label>
          ))}
        </div>
        {form.errorFor("funds_sources") ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {form.errorFor("funds_sources")}
          </p>
        ) : null}
      </div>

      <Field context={context} field="funds_description">
        <TextArea context={context} field="funds_description" describedBy="payer-link-funds_description-hint" />
        <p id="payer-link-funds_description-hint" className="text-xs text-muted-foreground">
          {text.fundsDescriptionHint}
        </p>
      </Field>

      <UploadBlock
        id="payer-link-funds-files"
        label={text.fundsProof}
        required={proofRequired}
        badge={proofRequired ? text.fundsProofRequired : text.fundsProofOptional}
        hint={text.fundsProofHint}
        buttonLabel={text.fundsProofButton}
        emptyText={text.noFundsProof}
        documents={uploads.documents}
        busy={uploads.busy}
        errors={uploads.errors}
        disabled={false}
        text={text}
        lang={lang}
        testId="payer-link-funds-upload"
        onFiles={uploads.upload}
        onRemove={uploads.remove}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6 Payment route (phase 2's section 8)
// ---------------------------------------------------------------------------

export function PaymentStep({ context, suggestion }: { context: StepContext; suggestion: string | null }) {
  const { form, text, lang } = context;
  const { draft } = form;
  // The payer's name is offered as account holder once, while the field is empty.
  const offered = useRef(false);
  const flagged = draft.payment_method === "cash" || draft.payment_method === "crypto";
  return (
    <div className="space-y-4" data-testid="payer-link-step-payment">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field context={context} field="payment_method">
          <NativeComboboxSelect
            {...controlProps(form, "payment_method")}
            className={selectClass}
            value={draft.payment_method}
            onChange={(event) => {
              const method = event.target.value;
              const offer = offered.current ? null : suggestion;
              if (offer?.trim() && asksAccount(method) && !draft.account_holder.trim()) offered.current = true;
              form.update((current) => withRoute(current, withPaymentMethod(routeDraft(current), method, offer)));
            }}
          >
            <option value="">{text.choose}</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {text.paymentMethods[method]}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
        {draft.payment_method === "other" ? (
          <Field context={context} field="payment_method_details">
            <Input
              {...controlProps(form, "payment_method_details")}
              className={inputClass}
              autoComplete="off"
              maxLength={200}
              value={draft.payment_method_details}
              onChange={(event) => form.set("payment_method_details", event.target.value)}
            />
          </Field>
        ) : null}
        {flagged ? (
          <div className="sm:col-span-2">
            <Notice tone="warning" role="note" testId="payer-link-payment-method-note">
              {text.cashCryptoNote}
            </Notice>
          </div>
        ) : null}
        {asksAccount(draft.payment_method) ? (
          <>
            <Field context={context} field="account_country" className="sm:col-start-1">
              <CountrySelect
                value={draft.account_country || null}
                lang={lang}
                className={selectClass}
                aria-label={text.fields.account_country}
                onChange={(code) => form.set("account_country", code ?? "")}
              />
            </Field>
            <Field context={context} field="account_holder">
              <Input
                {...controlProps(form, "account_holder")}
                className={inputClass}
                autoComplete="off"
                maxLength={200}
                value={draft.account_holder}
                onChange={(event) => form.set("account_holder", event.target.value)}
              />
            </Field>
            <Field context={context} field="bank_name">
              <Input
                {...controlProps(form, "bank_name")}
                className={inputClass}
                autoComplete="off"
                maxLength={200}
                value={draft.bank_name}
                onChange={(event) => form.set("bank_name", event.target.value)}
              />
            </Field>
          </>
        ) : null}
      </div>
      <Field context={context} field="via_third_party" question>
        <YesNoSelect
          id={fieldId("via_third_party")}
          className="sm:max-w-[calc(50%-0.5rem)]"
          value={draft.via_third_party}
          text={text}
          invalid={Boolean(form.errorFor("via_third_party"))}
          onChange={(answer) => form.update((current) => withRoute(current, withViaThirdParty(routeDraft(current), answer)))}
        />
      </Field>
      {draft.via_third_party === "yes" ? (
        <Field context={context} field="via_third_party_details">
          <textarea
            {...controlProps(form, "via_third_party_details")}
            // 16 px on phones: a smaller text makes iOS zoom into the field.
            className={cn(textareaClass, "text-base md:text-sm")}
            rows={3}
            maxLength={2000}
            autoComplete="off"
            value={draft.via_third_party_details}
            onChange={(event) => form.set("via_third_party_details", event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}
