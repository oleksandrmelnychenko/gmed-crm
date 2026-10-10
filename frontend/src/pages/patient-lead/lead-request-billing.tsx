import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

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
import { cn } from "@/lib/utils";

import {
  fetchMyLeadRequests,
  saveLeadBilling,
  saveLeadBillingExtras,
  type LeadRequest,
  type LeadRequestBilling,
  type PaymentRouteBy,
} from "./lead-request-api";
import {
  BILLING_EXTRAS_FIELDS,
  PAYMENT_METHODS,
  VIA_THIRD_PARTY_KINDS,
  billingExtrasPatch,
  billingExtrasValue,
  draftFromBillingExtras,
  parseEuroAmount,
  type BillingExtrasDraft,
  type BillingExtrasField,
  asksAccount,
  asksBillingField,
  asksPaymentRoute,
  billingPatch,
  billingValue,
  changedOnServer,
  draftFromBilling,
  invoiceTargets,
  requiresBillingField,
  stillRejectedBilling,
  withInvoiceTo,
  withPaymentMethod,
  withRejectedBilling,
  withViaThirdParty,
  type BillingContext,
  type BillingDraft,
  type BillingField,
  type RejectedBilling,
} from "./lead-request-billing-model";
import type { SaveState } from "./lead-request-model";
import { CabinetSection as Section, LabeledField, RequiredMark, YesNoSelect, errorBody, useAutosave, type RequestQueue } from "./lead-request-parts";
import { invoiceToLabel, type LeadRequestText } from "./lead-request-text";

// Invoice recipient and payment route (owner spec "Patientenformular",
// sections 7 and 8; contract phase 2). Both are one record on the server,
// the payer declaration, next to "who pays": that answer may clear section 8
// or decide who answers it at all, so the form follows the request object.

/** The two sections as typed, with what the server refused. */
type BillingForm = {
  draft: BillingDraft;
  /** Who answers section 8, and whether "to the payer" is an answer. */
  context: BillingContext;
  set: <Field extends BillingField>(field: Field, value: BillingDraft[Field]) => void;
  update: (change: (draft: BillingDraft) => BillingDraft) => void;
  errorFor: (field: BillingField) => string | undefined;
};

type RefusedValues = { values: RejectedBilling; codes: Partial<Record<BillingField, string>> };

/**
 * Autosave of the two sections, like the statements for the identification:
 * only what changed, after the draft has rested; a refused value stays out
 * until it is changed and does not hold back the other fields. When the
 * server says the payer answers section 8 (409), the section is hidden and
 * the request is loaded afresh. Another save — "who pays" — may change the
 * sections on the server: the draft takes those fields over.
 */
function useBillingForm({
  request,
  billing,
  text,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  billing: LeadRequestBilling;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}): BillingForm {
  const [draft, setDraft] = useState<BillingDraft>(() => draftFromBilling(billing));
  const savedRef = useRef<BillingDraft>(draftFromBilling(billing));
  const refusedRef = useRef<RefusedValues>({ values: {}, codes: {} });
  const failedRef = useRef(false);
  const [refused, setRefused] = useState<RefusedValues>(refusedRef.current);
  // The server refused section 8 as the payer's: it stays hidden until the request object says otherwise.
  const [routeRefused, setRouteRefused] = useState(false);
  const routeBy: PaymentRouteBy = routeRefused && billing.payment_route_by !== "payer" ? "payer" : billing.payment_route_by;
  const routeByRef = useRef(routeBy);
  routeByRef.current = routeBy;

  // What "who pays" changed on the server (section 8 cleared, "to the payer"
  // taken back) replaces the draft's values; the fields being typed stay.
  useEffect(() => {
    const incoming = draftFromBilling(billing);
    const changed = changedOnServer(savedRef.current, incoming);
    if (changed.length === 0) return;
    savedRef.current = incoming;
    setDraft((current) => {
      const next = { ...current };
      for (const field of changed) next[field] = incoming[field];
      return next;
    });
  }, [billing]);

  const save = useCallback(
    (snapshot: BillingDraft) => {
      void enqueue(async () => {
        let saved = false;
        let failed = false;
        let routeTold = false;
        let rejected = stillRejectedBilling(refusedRef.current.values, snapshot);
        const codes = { ...refusedRef.current.codes };
        // Each round either saves or sets one more refused field aside.
        for (;;) {
          const patch = billingPatch(savedRef.current, snapshot, routeByRef.current, rejected);
          if (Object.keys(patch).length === 0) break;
          onSaveState("saving");
          try {
            const next = await saveLeadBilling(request.lead_id, patch);
            if (next.billing) savedRef.current = draftFromBilling(next.billing);
            saved = true;
            onChange(next);
            break;
          } catch (cause) {
            const body = errorBody(cause);
            if (body?.code === "payment_route_by_payer" && !routeTold) {
              // The payer answers section 8 now: it goes, and the request is
              // loaded afresh; section 7 is saved in the next round.
              routeTold = true;
              routeByRef.current = "payer";
              setRouteRefused(true);
              try {
                const fresh = (await fetchMyLeadRequests()).find((item) => item.lead_id === request.lead_id);
                if (fresh) onChange(fresh);
              } catch {
                // The next load of the page shows the state; nothing else to do here.
              }
              continue;
            }
            const field = typeof body?.field === "string" ? body.field : "";
            const next = field in patch ? withRejectedBilling(rejected, field, snapshot) : null;
            if (!next) {
              failed = true;
              break;
            }
            rejected = next;
            codes[field as BillingField] = typeof body?.code === "string" ? body.code : "";
          }
        }
        refusedRef.current = { values: rejected, codes };
        setRefused(refusedRef.current);
        const wasFailed = failedRef.current;
        failedRef.current = failed || Object.keys(rejected).length > 0;
        if (failedRef.current) onSaveState("error");
        // After the payer took section 8 over, the page shows the server's state: nothing is pending.
        else if (saved || wasFailed || routeTold) onSaveState("saved");
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id],
  );

  useAutosave(draft, save);

  return {
    draft,
    context: { routeBy, payerDeclared: billing.payer_declared },
    set: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    update: (change) => setDraft(change),
    errorFor: (field) => {
      // The message belongs to the refused value: it goes as soon as the patient changes it.
      const value = refused.values[field];
      if (value === undefined || value !== billingValue(field, draft)) return undefined;
      return text.invalidField;
    },
  };
}

/**
 * The sections "invoice recipient" (`part="invoice"`, step "Versicherung &
 * Rechnung") and "payment route" (`part="route"`, follow-up block C, trigger
 * flow 2026-10-07). Section 8 is asked of the patient or the paying parent;
 * when the payer answers it, a note says so.
 */
export function BillingSections({
  request,
  billing,
  text,
  lang,
  enqueue,
  onChange,
  onSaveState,
  part,
  bare = false,
}: {
  request: LeadRequest;
  billing: LeadRequestBilling;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  part: "invoice" | "route";
  /** Without the own heading: follow-up block C has the same title (QA 2026-10-10). */
  bare?: boolean;
}) {
  const guardian = request.access_kind === "guardian";
  const form = useBillingForm({ request, billing, text, enqueue, onChange, onSaveState });
  const { draft, context } = form;
  // The name of the person who pays is offered as account holder once, while the field is empty.
  const offeredRef = useRef(false);

  const asks = (field: BillingField) => asksBillingField(field, draft, context);
  const required = (field: BillingField) => requiresBillingField(field, draft, context);
  const fieldId = (field: BillingField) => `lead-request-${field}`;
  const control = (field: BillingField, describedBy?: string) => {
    const invalid = Boolean(form.errorFor(field));
    const ids = [describedBy, invalid ? `${fieldId(field)}-error` : ""].filter(Boolean).join(" ");
    return {
      id: fieldId(field),
      "aria-invalid": invalid || undefined,
      "aria-describedby": ids || undefined,
    };
  };
  const labeled = (field: BillingField, className?: string) => ({
    id: fieldId(field),
    label: text.billingFields[field],
    error: form.errorFor(field),
    required: required(field),
    className,
  });
  const textInput = (field: BillingField, maxLength: number, type: "text" | "email" = "text", describedBy?: string) => (
    <Input
      {...control(field, describedBy)}
      className={inputClass}
      type={type}
      autoComplete="off"
      maxLength={maxLength}
      value={draft[field]}
      onChange={(event) => form.set(field, event.target.value)}
    />
  );
  const countrySelect = (field: "invoice_country" | "account_country") => (
    <CountrySelect
      value={draft[field] || null}
      lang={lang}
      className={selectClass}
      aria-label={text.billingFields[field]}
      onChange={(code) => form.set(field, code ?? "")}
    />
  );

  const invoiceToError = form.errorFor("invoice_to");
  const accountAsked = asksAccount(draft.payment_method);
  const flagged = draft.payment_method === "cash" || draft.payment_method === "crypto";

  const paymentMethodField = (
    <LabeledField {...labeled("payment_method")}>
      <NativeComboboxSelect
        {...control("payment_method")}
        className={selectClass}
        value={draft.payment_method}
        onChange={(event) => {
          const method = event.target.value;
          const suggestion = offeredRef.current ? null : billing.account_holder_suggestion;
          if (suggestion?.trim() && asksAccount(method) && !draft.account_holder.trim()) offeredRef.current = true;
          form.update((current) => withPaymentMethod(current, method, suggestion));
        }}
      >
        <option value="">{text.choose}</option>
        {PAYMENT_METHODS.map((method) => (
          <option key={method} value={method}>
            {text.paymentMethodOptions[method]}
          </option>
        ))}
      </NativeComboboxSelect>
    </LabeledField>
  );

  return (
    <>
      {part === "invoice" ? (
      <Section title={text.sectionBilling}>
        <div className="space-y-3" data-testid="lead-request-billing">
          <div
            role="radiogroup"
            aria-labelledby="lead-request-invoice_to-label"
            aria-invalid={Boolean(invoiceToError) || undefined}
            aria-describedby={invoiceToError ? "lead-request-invoice_to-error" : undefined}
            className="space-y-1.5"
            data-testid="lead-request-invoice-to"
          >
            <p id="lead-request-invoice_to-label" className={cn(tokens.text.label, "block")}>
              {text.billingFields.invoice_to}
              <RequiredMark />
            </p>
            {/* Stacked: the answers are sentences, and the cabinet is used on phones. */}
            <div className="flex flex-col gap-2">
              {invoiceTargets(context).map((target) => {
                const checked = draft.invoice_to === target;
                return (
                  <label
                    key={target}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug",
                      checked ? "border-[var(--brand)] bg-muted/40" : "border-border",
                    )}
                  >
                    {/* Named by the visible answer, never by the raw value. */}
                    <input
                      type="radio"
                      id={`lead-request-invoice_to-${target}`}
                      name="lead-request-invoice_to"
                      value={target}
                      aria-labelledby={`lead-request-invoice_to-${target}-label`}
                      className={cn(checkboxClass, "mt-0.5 rounded-full")}
                      checked={checked}
                      onChange={() => form.update((current) => withInvoiceTo(current, target))}
                    />
                    <span id={`lead-request-invoice_to-${target}-label`} className="min-w-0">
                      {invoiceToLabel(text, target, guardian, context.routeBy)}
                    </span>
                  </label>
                );
              })}
            </div>
            {invoiceToError ? (
              <p id="lead-request-invoice_to-error" role="alert" className="text-xs text-destructive">
                {invoiceToError}
              </p>
            ) : null}
          </div>
          {/* Another address exists only for the answer "another address". */}
          {draft.invoice_to === "other" ? (
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="lead-request-invoice-address">
              <LabeledField {...labeled("invoice_name", "sm:col-span-2 lg:col-span-3")}>{textInput("invoice_name", 200)}</LabeledField>
              <LabeledField {...labeled("invoice_street", "sm:col-span-2 lg:col-span-3")}>{textInput("invoice_street", 200)}</LabeledField>
              <LabeledField {...labeled("invoice_zip")}>{textInput("invoice_zip", 20)}</LabeledField>
              <LabeledField {...labeled("invoice_city")}>{textInput("invoice_city", 200)}</LabeledField>
              <LabeledField {...labeled("invoice_country")}>{countrySelect("invoice_country")}</LabeledField>
            </div>
          ) : null}
          {asks("invoice_email") ? (
            <LabeledField {...labeled("invoice_email", "sm:max-w-[calc(50%-0.5rem)]")}>
              {textInput("invoice_email", 254, "email", "lead-request-invoice_email-hint")}
              <p id="lead-request-invoice_email-hint" className="text-xs leading-5 text-muted-foreground">
                {text.invoiceEmailHint}
              </p>
            </LabeledField>
          ) : null}
          {/* How the patient will pay, without the account (owner 2026-10-10): cash or
              crypto counts for the risk at once; the details are follow-up block C. */}
          {asksPaymentRoute(context.routeBy) && request.follow_up !== undefined ? (
            <div className="sm:max-w-[calc(50%-0.5rem)]" data-testid="lead-request-payment-method-base">
              {paymentMethodField}
            </div>
          ) : null}
        </div>
      </Section>
      ) : null}

      {part === "route" ? (
      <RouteFrame bare={bare} title={text.sectionPaymentRoute}>
        {asksPaymentRoute(context.routeBy) ? (
          <div className="space-y-4" data-testid="lead-request-payment-route">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {paymentMethodField}
              {/* "Other" says in words what the list does not offer. */}
              {asks("payment_method_details") ? (
                <LabeledField {...labeled("payment_method_details")}>{textInput("payment_method_details", 200)}</LabeledField>
              ) : null}
              {flagged ? (
                <p
                  role="note"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900 sm:col-span-2 lg:col-span-3 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                  data-testid="lead-request-payment-method-note"
                >
                  {text.cashCryptoNote}
                </p>
              ) : null}
              {/* The account the payment comes from: with a bank transfer or a card. */}
              {accountAsked ? (
                <>
                  <LabeledField {...labeled("account_country", "sm:col-start-1")}>{countrySelect("account_country")}</LabeledField>
                  <LabeledField {...labeled("account_holder")}>{textInput("account_holder", 200)}</LabeledField>
                  <LabeledField {...labeled("bank_name")}>{textInput("bank_name", 200)}</LabeledField>
                </>
              ) : null}
            </div>
            <div className="space-y-3">
              <LabeledField {...labeled("via_third_party")} question>
                <YesNoSelect
                  id={fieldId("via_third_party")}
                  className="sm:max-w-[calc(50%-0.5rem)]"
                  value={draft.via_third_party}
                  text={text}
                  invalid={Boolean(form.errorFor("via_third_party"))}
                  onChange={(answer) => form.update((current) => withViaThirdParty(current, answer))}
                />
              </LabeledField>
              {/* The details exist only for a "yes". */}
              {asks("via_third_party_details") ? (
                <LabeledField {...labeled("via_third_party_details")}>
                  <textarea
                    {...control("via_third_party_details")}
                    // 16 px on phones: a smaller text makes iOS zoom into the field.
                    className={cn(textareaClass, "text-base md:text-sm")}
                    rows={3}
                    maxLength={2000}
                    autoComplete="off"
                    value={draft.via_third_party_details}
                    onChange={(event) => form.set("via_third_party_details", event.target.value)}
                  />
                </LabeledField>
              ) : null}
            </div>
            {/* Block C asks through whom a payment via a third party goes, and the expected total. */}
            {billing.via_third_party_kind !== undefined || billing.expected_total_eur !== undefined ? (
              <BillingExtras
                request={request}
                billing={billing}
                viaThirdParty={draft.via_third_party === "yes"}
                text={text}
                enqueue={enqueue}
                onChange={onChange}
                onSaveState={onSaveState}
              />
            ) : (
              // A server without block C asks no amount: GMED enters it.
              <p className="text-xs leading-5 text-muted-foreground">{text.totalAmountHint}</p>
            )}
          </div>
        ) : (
          <p
            role="note"
            className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm leading-snug text-muted-foreground"
            data-testid="lead-request-payment-route-by-payer"
          >
            {text.paymentRouteByPayer}
          </p>
        )}
      </RouteFrame>
      ) : null}
    </>
  );
}

/**
 * Block C's extras (trigger flow 2026-10-07): through whom a payment via a
 * third party goes (a person or a payment service provider) and the expected
 * total in EUR. They save on the billing route on their own, only what
 * changed; an amount that is no number is not sent and is marked.
 */
function BillingExtras({
  request,
  billing,
  viaThirdParty,
  text,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  billing: LeadRequestBilling;
  /** The answer "through a third party?" as typed above. */
  viaThirdParty: boolean;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const [draft, setDraft] = useState<BillingExtrasDraft>(() => draftFromBillingExtras(billing));
  const savedRef = useRef<BillingExtrasDraft>(draftFromBillingExtras(billing));
  const refusedRef = useRef<Partial<Record<BillingExtrasField, string>>>({});
  const [refused, setRefused] = useState<Partial<Record<BillingExtrasField, string>>>({});

  // "Through a third party?" answered with no clears the kind on the server: the draft follows.
  useEffect(() => {
    const incoming = draftFromBillingExtras(billing);
    const saved = savedRef.current;
    const changed = BILLING_EXTRAS_FIELDS.filter((field) => billingExtrasValue(field, incoming) !== billingExtrasValue(field, saved));
    if (changed.length === 0) return;
    savedRef.current = incoming;
    setDraft((current) => {
      const next = { ...current };
      for (const field of changed) next[field] = incoming[field];
      return next;
    });
  }, [billing]);

  const save = useCallback(
    (snapshot: BillingExtrasDraft) => {
      void enqueue(async () => {
        const patch = billingExtrasPatch(savedRef.current, snapshot, refusedRef.current);
        if (Object.keys(patch).length === 0) return;
        onSaveState("saving");
        try {
          const next = await saveLeadBillingExtras(request.lead_id, patch);
          if (next.billing) savedRef.current = draftFromBillingExtras(next.billing);
          refusedRef.current = {};
          setRefused({});
          onSaveState("saved");
          onChange(next);
        } catch (cause) {
          const field = errorBody(cause)?.field;
          if (field === "via_third_party_kind" || field === "expected_total_eur") {
            refusedRef.current = { ...refusedRef.current, [field]: billingExtrasValue(field, snapshot) };
            setRefused(refusedRef.current);
          }
          onSaveState("error");
        }
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id],
  );

  useAutosave(draft, save);

  const amountInvalid = parseEuroAmount(draft.expected_total_eur) === undefined;
  const errorFor = (field: BillingExtrasField) => {
    if (field === "expected_total_eur" && amountInvalid) return text.invalidField;
    return refused[field] !== undefined && refused[field] === billingExtrasValue(field, draft) ? text.invalidField : undefined;
  };
  const control = (field: BillingExtrasField) => ({
    id: `lead-request-${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-${field}-error` : undefined,
  });

  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="lead-request-payment-route-extras">
      {viaThirdParty ? (
        <LabeledField
          id="lead-request-via_third_party_kind"
          label={text.billingExtrasFields.via_third_party_kind}
          error={errorFor("via_third_party_kind")}
          required
        >
          <NativeComboboxSelect
            {...control("via_third_party_kind")}
            className={selectClass}
            value={draft.via_third_party_kind}
            onChange={(event) => setDraft((current) => ({ ...current, via_third_party_kind: event.target.value }))}
          >
            <option value="">{text.choose}</option>
            {VIA_THIRD_PARTY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {text.viaThirdPartyKindOptions[kind]}
              </option>
            ))}
          </NativeComboboxSelect>
        </LabeledField>
      ) : null}
      <LabeledField
        id="lead-request-expected_total_eur"
        label={text.billingExtrasFields.expected_total_eur}
        error={errorFor("expected_total_eur")}
        required
        className="sm:col-start-1"
      >
        <Input
          {...control("expected_total_eur")}
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          value={draft.expected_total_eur}
          onChange={(event) => setDraft((current) => ({ ...current, expected_total_eur: event.target.value }))}
        />
        <p className="text-xs leading-5 text-muted-foreground">{text.expectedTotalHint}</p>
      </LabeledField>
    </div>
  );
}

/** The payment route's section, or only its content inside follow-up block C. */
function RouteFrame({ bare, title, children }: { bare: boolean; title: string; children: ReactNode }) {
  return bare ? <div>{children}</div> : <Section title={title}>{children}</Section>;
}
