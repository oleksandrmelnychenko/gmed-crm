import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { inputClass, selectClass, textareaClass, tokens } from "@/components/ui-shell";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

import { saveLeadPayerPaymentRoute } from "../data/lead-payer-payment-route-api";
import { normalizeLeadPortalBilling } from "../data/lead-portal-intake-api";
import { billingStatements, paymentMethodLabel } from "../model/lead-gwg-statements";
import type { PayerDeclaration, PayerDeclarationResponse, Tx } from "../model/lead-payer";
import {
  STAFF_PAYMENT_METHODS,
  paymentRouteDraft,
  paymentRouteErrors,
  paymentRouteFieldShown,
  paymentRoutePatch,
  paymentRouteServerError,
  paymentRouteSourceLabel,
  withRouteMethod,
  withRouteViaThirdParty,
  type PaymentRouteDraft,
  type PaymentRouteField,
} from "../model/lead-payer-payment-route";

function RouteField({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className={cn(tokens.text.label, "block font-mono")}>{label}</span>
      {children}
      {error ? <span className="block text-xs text-destructive" role="alert">{error}</span> : null}
    </label>
  );
}

/**
 * «Способ оплаты плательщика» in the wizard's payer section (owner
 * 2026-10-26): a third-party payer's payment route, prefilled with what is
 * stored and who gave it. Staff with leads.edit enter or correct it (counts
 * for the risk at once); everyone else reads it. The payer's later answer on
 * its link replaces staff's (last writer wins).
 */
export function LeadPayerPaymentRoute({
  leadId,
  declaration,
  canEdit,
  disabled,
  lang,
  tx,
  errorText,
  onSaved,
}: {
  leadId: string;
  declaration: PayerDeclaration;
  canEdit: boolean;
  disabled: boolean;
  lang: string;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** The saved declaration; the section reloads what depends on it. */
  onSaved?: (saved: PayerDeclarationResponse | null) => void;
}) {
  const stored = paymentRouteDraft(declaration);
  const storedKey = JSON.stringify(stored);
  const [saved, setSaved] = useState<PaymentRouteDraft>(stored);
  const [draft, setDraft] = useState<PaymentRouteDraft>(stored);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [serverError, setServerError] = useState<{ field: string; message: string } | null>(null);
  const loadedFor = useRef(`${leadId}:${storedKey}`);
  const activeLead = useRef(leadId);
  activeLead.current = leadId;

  const patch = paymentRoutePatch(draft, saved);
  const dirty = Object.keys(patch).length > 0;

  // Take the stored route unless staff are editing it (another lead always).
  useEffect(() => {
    const key = `${leadId}:${storedKey}`;
    if (loadedFor.current === key) return;
    const otherLead = !loadedFor.current.startsWith(`${leadId}:`);
    loadedFor.current = key;
    if (dirty && !otherLead) return;
    const next = JSON.parse(storedKey) as PaymentRouteDraft;
    setSaved(next);
    setDraft(next);
    setMessage(null);
    setServerError(null);
  }, [leadId, storedKey]);

  const source = paymentRouteSourceLabel(declaration.payment_route_source, tx);
  const errors = paymentRouteErrors(draft, tx);
  const errorOf = (field: PaymentRouteField) =>
    errors[field] ?? (serverError?.field === field ? serverError.message || tx("Проверьте значение", "Bitte den Wert prüfen") : undefined);
  const shown = (field: PaymentRouteField) => paymentRouteFieldShown(field, draft);
  const readOnly = !canEdit || disabled || saving;
  const change = (next: PaymentRouteDraft) => {
    setDraft(next);
    setMessage(null);
    setServerError(null);
  };

  const save = async () => {
    if (!dirty || Object.keys(errors).length > 0) return;
    const targetLead = leadId;
    setSaving(true);
    setMessage(null);
    setServerError(null);
    try {
      const response = await saveLeadPayerPaymentRoute(targetLead, patch);
      if (activeLead.current !== targetLead) return;
      const next = paymentRouteDraft(response?.declaration ?? null);
      loadedFor.current = `${targetLead}:${JSON.stringify(next)}`;
      setSaved(next);
      setDraft(next);
      setMessage({ tone: "success", text: tx("Способ оплаты сохранён", "Zahlungsweg gespeichert") });
      onSaved?.(response);
    } catch (error) {
      if (activeLead.current !== targetLead) return;
      const refused = paymentRouteServerError(error);
      if (refused) setServerError(refused);
      setMessage({ tone: "error", text: errorText(error) });
    } finally {
      if (activeLead.current === targetLead) setSaving(false);
    }
  };

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <AdminSectionTitle>{tx("Способ оплаты плательщика", "Zahlungsweg des Zahlers")}</AdminSectionTitle>
      {source ? (
        <StatusChip tone={declaration.payment_route_source === "staff" ? "neutral" : "info"} data-testid="lead-payer-route-source">
          {source}
        </StatusChip>
      ) : null}
    </div>
  );

  if (!canEdit) {
    const billing = normalizeLeadPortalBilling({ ...declaration, payment_route_by: "payer" });
    const rows = billing ? billingStatements(billing, tx, lang, true).payment.filter((row) => row.key !== "expected_total") : [];
    const answered = Boolean(declaration.payment_method) || declaration.via_third_party != null;
    return (
      <div className="space-y-2.5 border-t border-border/50 pt-3" data-testid="lead-payer-payment-route">
        {header}
        {answered ? (
          <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <div key={row.key} className="min-w-0" data-testid={`lead-payer-route-${row.key}`}>
                <dt className="text-[11.5px] font-medium leading-snug text-muted-foreground">{row.label}</dt>
                <dd className={cn("mt-0.5 break-words text-[13px] font-medium leading-5", row.warning ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>
                  {row.value || "—"}
                  {row.details ? <span className="block text-xs font-normal text-muted-foreground">{row.details}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{tx("Плательщик ещё не указал способ оплаты.", "Der Zahler hat noch keinen Zahlungsweg angegeben.")}</p>
        )}
      </div>
    );
  }

  const methods: string[] = [...STAFF_PAYMENT_METHODS];
  // An older answer (cryptocurrency) stays selectable until staff change it.
  if (saved.payment_method && !methods.includes(saved.payment_method)) methods.push(saved.payment_method);
  const invalid = Object.keys(errors).length > 0;

  return (
    <div className="space-y-3 border-t border-border/50 pt-3" data-testid="lead-payer-payment-route">
      {header}
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          "Учитывается в оценке риска сразу. Если плательщик позже ответит по своей ссылке, его ответ заменит этот.",
          "Zählt sofort für die Risikobewertung. Antwortet der Zahler später über seinen Link, ersetzt seine Angabe diese.",
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RouteField label={tx("Способ оплаты", "Zahlungsart")} error={errorOf("payment_method")}>
          <NativeComboboxSelect
            value={draft.payment_method}
            className={selectClass}
            disabled={readOnly}
            aria-label={tx("Способ оплаты", "Zahlungsart")}
            onChange={(event) => change(withRouteMethod(draft, event.target.value))}
          >
            <option value="">{tx("Не указан", "Nicht angegeben")}</option>
            {methods.map((method) => (
              <option key={method} value={method}>{paymentMethodLabel(method, tx)}</option>
            ))}
          </NativeComboboxSelect>
        </RouteField>
        {shown("payment_method_details") ? (
          <RouteField label={tx("Какой способ", "Welche Zahlungsart")} error={errorOf("payment_method_details")}>
            <Input
              className={inputClass}
              value={draft.payment_method_details}
              maxLength={200}
              disabled={readOnly}
              onChange={(event) => change({ ...draft, payment_method_details: event.target.value })}
            />
          </RouteField>
        ) : null}
        {shown("account_country") ? (
          <RouteField label={tx("Страна счёта", "Land des Kontos")} error={errorOf("account_country")}>
            <CountrySelect
              value={draft.account_country || null}
              lang={lang}
              className={selectClass}
              disabled={readOnly}
              aria-label={tx("Страна счёта", "Land des Kontos")}
              onChange={(code) => change({ ...draft, account_country: code ?? "" })}
            />
          </RouteField>
        ) : null}
        {shown("account_holder") ? (
          <RouteField label={tx("Владелец счёта", "Kontoinhaber/in")} error={errorOf("account_holder")}>
            <Input
              className={inputClass}
              value={draft.account_holder}
              maxLength={200}
              disabled={readOnly}
              autoComplete="off"
              onChange={(event) => change({ ...draft, account_holder: event.target.value })}
            />
          </RouteField>
        ) : null}
        {shown("bank_name") ? (
          <RouteField label={tx("Банк", "Bank")} error={errorOf("bank_name")}>
            <Input
              className={inputClass}
              value={draft.bank_name}
              maxLength={200}
              disabled={readOnly}
              autoComplete="off"
              onChange={(event) => change({ ...draft, bank_name: event.target.value })}
            />
          </RouteField>
        ) : null}
        <RouteField label={tx("Платёж через третье лицо / платёжного провайдера", "Zahlung über Dritte / Zahlungsdienstleister")} error={errorOf("via_third_party")}>
          <NativeComboboxSelect
            value={draft.via_third_party}
            className={selectClass}
            disabled={readOnly}
            aria-label={tx("Платёж через третье лицо", "Zahlung über Dritte")}
            onChange={(event) => change(withRouteViaThirdParty(draft, event.target.value))}
          >
            <option value="">{tx("Не указано", "Nicht angegeben")}</option>
            <option value="no">{tx("Нет", "Nein")}</option>
            <option value="yes">{tx("Да", "Ja")}</option>
          </NativeComboboxSelect>
        </RouteField>
        {shown("via_third_party_details") ? (
          <RouteField className="sm:col-span-2" label={tx("Кто / какой сервис", "Wer / welcher Dienst")} error={errorOf("via_third_party_details")}>
            <textarea
              className={textareaClass}
              rows={2}
              value={draft.via_third_party_details}
              maxLength={2000}
              disabled={readOnly}
              onChange={(event) => change({ ...draft, via_third_party_details: event.target.value })}
            />
          </RouteField>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg text-xs"
          disabled={readOnly || !dirty || invalid}
          onClick={() => void save()}
          data-testid="lead-payer-route-save"
        >
          {saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {tx("Сохранить способ оплаты", "Zahlungsweg speichern")}
        </Button>
        {dirty && !saving ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-xs" disabled={readOnly} onClick={() => change(saved)}>
            {tx("Отменить", "Verwerfen")}
          </Button>
        ) : null}
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn("text-xs", message.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
