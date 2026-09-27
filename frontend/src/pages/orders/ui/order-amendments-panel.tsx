import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import {
  billOrderAmendment,
  createOrderAmendment,
  decideOrderAmendment,
  fetchOrderAmendments,
  ORDER_AMENDMENT_VAT_TREATMENTS,
  type OrderAmendment,
  type OrderAmendmentVatTreatment,
} from "../data/order-api";
import { formatCurrency, formatDateOnly } from "../model/order-model";

type Bilingual = (ru: string, de: string) => string;

function statusTone(status: string): string {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function statusLabel(status: string, tx: Bilingual): string {
  switch (status) {
    case "approved":
      return tx("Одобрено", "Genehmigt");
    case "rejected":
      return tx("Отклонено", "Abgelehnt");
    default:
      return tx("На согласовании", "Ausstehend");
  }
}

/** Calendar date as DD.MM.YYYY, like every other date in the order workspace. */
function formatDate(value: string | null): string {
  if (!value) return "";
  return formatDateOnly(value, "de-DE", "");
}

/** "+150,00 €" / "-50,00 €": the sign stays visible for increases. */
export function formatAmendmentDelta(amount: string, currency: string): string {
  const formatted = formatCurrency(amount, currency || "EUR");
  return Number(amount) > 0 ? `+${formatted}` : formatted;
}

/**
 * The typed amount increase as the API value ("150.5"), or null when it is
 * not a positive amount with at most two decimals. A reduction is not an
 * amendment: the service line is changed or cancelled, or the invoice credited.
 */
export function parseAmendmentDelta(value: string): string | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? normalized : null;
}

/** How the amended amount is taxed, in the staff language. */
export function amendmentVatLabel(
  treatment: OrderAmendmentVatTreatment | null,
  tx: Bilingual,
  vatRate?: string | null,
): string {
  switch (treatment) {
    case "standard_vat": {
      const rate = vatRate && Number.isFinite(Number(vatRate)) ? Number(vatRate) : 19;
      return tx(
        `Услуга агентства · НДС ${String(rate).replace(".", ",")} %`,
        `Agenturleistung · ${String(rate).replace(".", ",")} % USt.`,
      );
    }
    case "termin_fee_0":
      return tx("Организация лечения · НДС 0 %", "Behandlungsorganisation · 0 % USt.");
    case "vat_exempt_0":
      return tx("Освобождено от НДС", "Umsatzsteuerfrei");
    case "cost_passthrough":
      return tx(
        "Перевыставляемые расходы · без НДС",
        "Durchlaufende Kosten · ohne USt.",
      );
    default:
      return tx("НДС не указан", "USt. nicht angegeben");
  }
}

/**
 * Decision actions for one amendment. Only a pending amendment is decided, and
 * only by a role that may manage amendments. The server refuses approval by
 * the requester, so the requester only gets to withdraw (reject) it. An
 * amendment approved before approvals created service lines can still be
 * billed.
 */
export function amendmentDecisionActions(params: {
  status: string;
  requestedBy: string;
  currentUserId: string | null;
  canManage: boolean;
  billable?: boolean;
}) {
  const pending = params.status === "pending" && params.canManage;
  const ownRequest = Boolean(params.currentUserId) && params.requestedBy === params.currentUserId;
  return {
    ownRequest,
    canApprove: pending && !ownRequest,
    canReject: pending,
    canBill: params.status === "approved" && params.canManage && Boolean(params.billable),
  };
}

/** The server's amendment errors in the staff language; unknown texts pass through. */
export function localizedAmendmentError(message: string, tx: Bilingual): string {
  switch (message) {
    case "An amendment must be approved by someone other than its requester":
      return tx(
        "Изменение должен одобрить другой сотрудник, не автор предложения.",
        "Die Änderung muss eine andere Person als der Antragsteller genehmigen.",
      );
    case "Amendment has already been decided":
      return tx(
        "По этому изменению уже принято решение.",
        "Über diese Änderung wurde bereits entschieden.",
      );
    case "Amendment has already been billed":
      return tx(
        "Это изменение уже добавлено в услуги заказа.",
        "Diese Änderung ist bereits in den Auftragsleistungen enthalten.",
      );
    case "Only an approved amendment can be billed":
      return tx(
        "Выставить можно только одобренное изменение.",
        "Abgerechnet werden kann nur eine genehmigte Änderung.",
      );
    case "agreed_note is required (what was agreed with the patient)":
      return tx(
        "Укажите, что согласовано с пациентом.",
        "Geben Sie an, was mit dem Patienten vereinbart wurde.",
      );
    case "vat_treatment is required (how the amended amount is taxed)":
    case "Invalid vat_treatment":
      return tx(
        "Выберите, как облагается НДС эта сумма.",
        "Wählen Sie, wie der Betrag umsatzsteuerlich behandelt wird.",
      );
    case "delta_amount must be non-zero":
    case "Invalid delta_amount":
    case "delta_amount must have at most two decimal places":
      return tx(
        "Укажите сумму увеличения больше нуля, не более двух знаков после запятой.",
        "Geben Sie einen Erhöhungsbetrag über null mit höchstens zwei Nachkommastellen an.",
      );
    case "An amendment raises the order amount; reduce or cancel the service line, or credit the invoice instead":
      return tx(
        "Изменение суммы только увеличивает заказ. Чтобы уменьшить сумму, измените или отмените услугу либо оформите кредит-ноту к счёту.",
        "Eine Betragsänderung erhöht den Auftrag. Zum Verringern ändern oder stornieren Sie die Leistung oder erstellen Sie eine Gutschrift zur Rechnung.",
      );
    case "Amendment currency must match the order currency":
      return tx(
        "Валюта изменения должна совпадать с валютой заказа.",
        "Die Währung der Änderung muss der Auftragswährung entsprechen.",
      );
    case "Amount amendments are closed for a cancelled or completed order":
      return tx(
        "Заказ отменён или завершён — изменения суммы больше не принимаются.",
        "Der Auftrag ist storniert oder abgeschlossen – Betragsänderungen sind nicht mehr möglich.",
      );
    case "Complete the order preparation before amending the order amount":
      return tx(
        "Сначала завершите оформление заказа.",
        "Schließen Sie zuerst die Auftragsvorbereitung ab.",
      );
    case "Order must be linked to a patient before an amendment is billed":
      return tx(
        "Заказ ещё не привязан к пациенту.",
        "Der Auftrag ist noch keinem Patienten zugeordnet.",
      );
    case "Insufficient permissions":
    case "Forbidden":
      return tx(
        "Недостаточно прав для этого действия.",
        "Für diese Aktion fehlen die Berechtigungen.",
      );
    default:
      return message;
  }
}

function VatTreatmentSelect({
  value,
  onChange,
  disabled,
  tx,
  className,
}: {
  value: OrderAmendmentVatTreatment | "";
  onChange: (value: OrderAmendmentVatTreatment | "") => void;
  disabled?: boolean;
  tx: Bilingual;
  className?: string;
}) {
  return (
    <NativeComboboxSelect
      aria-label={tx("НДС для этой суммы", "Umsatzsteuer für diesen Betrag")}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as OrderAmendmentVatTreatment | "")}
      className={className ?? "h-9 min-w-0 flex-[1_1_14rem]"}
    >
      <option value="">{tx("НДС: выберите…", "USt.: bitte wählen…")}</option>
      {ORDER_AMENDMENT_VAT_TREATMENTS.map((treatment) => (
        <option key={treatment} value={treatment}>
          {amendmentVatLabel(treatment, tx)}
        </option>
      ))}
    </NativeComboboxSelect>
  );
}

/**
 * Order amount amendments under approval (#10): propose an increase of the
 * order amount with the note of what was agreed with the patient and how the
 * amount is taxed. It stays pending until a different user approves it; the
 * approval adds a billable "Anpassung" service line, so the order total, the
 * next quote and its invoices include it. The requester sees their own
 * proposal without an approve action; read-only roles only see the history.
 */
export function OrderAmendmentsPanel({
  orderId,
  refreshKey,
  onChanged,
  currentUserId = null,
  canManage = true,
}: {
  orderId: string;
  refreshKey?: number;
  onChanged?: () => void;
  currentUserId?: string | null;
  canManage?: boolean;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [amendments, setAmendments] = useState<OrderAmendment[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [vatTreatment, setVatTreatment] = useState<OrderAmendmentVatTreatment | "">("");
  // VAT chosen at approval/billing for amendments proposed before it was recorded.
  const [decisionVat, setDecisionVat] = useState<Record<string, OrderAmendmentVatTreatment | "">>(
    {},
  );

  function load() {
    return fetchOrderAmendments(orderId)
      .then((rows) => {
        setAmendments(rows);
        setLoadError("");
      })
      .catch((nextError: unknown) => {
        setLoadError(
          nextError instanceof Error
            ? localizedAmendmentError(nextError.message, tx)
            : tx("Не удалось загрузить", "Konnte nicht laden"),
        );
      });
  }

  useEffect(() => {
    let active = true;
    fetchOrderAmendments(orderId)
      .then((rows) => {
        if (active) {
          setAmendments(rows);
          setLoadError("");
        }
      })
      .catch((nextError: unknown) => {
        if (active) {
          const effectTx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
          setAmendments((current) => current ?? []);
          setLoadError(
            nextError instanceof Error
              ? localizedAmendmentError(nextError.message, effectTx)
              : effectTx("Не удалось загрузить", "Konnte nicht laden"),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [orderId, refreshKey, lang]);

  async function run(action: () => Promise<unknown>, notice = "") {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      await action();
      await load();
      setActionNotice(notice);
      onChanged?.();
    } catch (nextError) {
      setActionError(
        nextError instanceof Error
          ? localizedAmendmentError(nextError.message, tx)
          : tx("Действие не удалось", "Aktion fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!amendments) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {loadError || tx("Загрузка…", "Wird geladen…")}
      </div>
    );
  }

  const pendingCount = amendments.filter((item) => item.status === "pending").length;
  const normalizedDelta = parseAmendmentDelta(delta);
  const billedNotice = tx(
    "Строка «Корректировка» добавлена в услуги заказа. Она войдёт в следующее предложение (смету) и счёт.",
    "Die Zeile „Anpassung“ wurde den Auftragsleistungen hinzugefügt. Sie erscheint im nächsten Angebot und in der Rechnung.",
  );

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">
          {tx("Изменения суммы", "Betragsänderungen")}
        </h4>
        {pendingCount > 0 ? (
          <Badge variant="outline" className={`rounded-full ${statusTone("pending")}`}>
            {pendingCount} {tx("на согласовании", "ausstehend")}
          </Badge>
        ) : null}
      </div>

      {canManage ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
          <p className="text-xs font-medium text-foreground">
            {tx("Предложить увеличение суммы", "Betragserhöhung vorschlagen")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              aria-label={tx("Сумма увеличения с НДС", "Erhöhung brutto")}
              disabled={busy}
              value={delta}
              onChange={(event) => setDelta(event.target.value)}
              placeholder={tx("Сумма с НДС, напр. 150", "Brutto, z. B. 150")}
              className="h-9 w-40 max-w-full"
              inputMode="decimal"
            />
            <VatTreatmentSelect
              value={vatTreatment}
              onChange={setVatTreatment}
              disabled={busy}
              tx={tx}
            />
            <Input
              aria-label={tx("Что согласовано с пациентом", "Mit dem Patienten Vereinbartes")}
              disabled={busy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tx("Что согласовано с пациентом", "Mit dem Patienten Vereinbartes")}
              className="h-9 min-w-0 flex-[1_1_16rem]"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !normalizedDelta || !vatTreatment || note.trim() === ""}
              onClick={() =>
                void run(async () => {
                  if (!normalizedDelta || !vatTreatment) return;
                  await createOrderAmendment(orderId, {
                    delta_amount: normalizedDelta,
                    agreed_note: note.trim(),
                    vat_treatment: vatTreatment,
                  });
                  setDelta("");
                  setNote("");
                  setVatTreatment("");
                }, tx(
                  "Предложение отправлено на согласование.",
                  "Der Vorschlag wurde zur Genehmigung eingereicht.",
                ))
              }
            >
              {tx("Предложить", "Vorschlagen")}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {tx(
              "Сумма указывается с НДС. После одобрения другим сотрудником в услуги заказа добавится строка «Корректировка»: она войдёт в сумму заказа, следующее предложение (смету) и счёт. Уменьшение суммы — через изменение или отмену услуги либо кредит-ноту к счёту.",
              "Betrag brutto angeben. Nach Genehmigung durch eine andere Person wird die Zeile „Anpassung“ den Auftragsleistungen hinzugefügt: Sie zählt zur Auftragssumme und erscheint im nächsten Angebot und in der Rechnung. Verringerungen über Änderung oder Storno der Leistung bzw. eine Gutschrift.",
            )}
          </p>
        </div>
      ) : null}

      {amendments.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground" hidden={Boolean(loadError)}>
          {tx("Изменений пока нет.", "Noch keine Änderungen.")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {amendments.map((item) => {
            const { ownRequest, canApprove, canReject, canBill } = amendmentDecisionActions({
              status: item.status,
              requestedBy: item.requested_by,
              currentUserId,
              canManage,
              billable: item.billable,
            });
            const needsVatChoice = !item.vat_treatment && (canApprove || canBill);
            const chosenVat = decisionVat[item.id] ?? "";
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatAmendmentDelta(item.delta_amount, item.currency)}
                    {item.vat_treatment ? (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {amendmentVatLabel(item.vat_treatment, tx, item.vat_rate)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {item.order_leistung_id ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-sky-200 bg-sky-50 text-sky-700"
                      >
                        {tx("В услугах заказа", "In den Auftragsleistungen")}
                      </Badge>
                    ) : item.billable ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                      >
                        {tx("Не выставлено", "Nicht abgerechnet")}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className={`rounded-full ${statusTone(item.status)}`}>
                      {statusLabel(item.status, tx)}
                    </Badge>
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{item.agreed_note}</p>
                {item.decision_note ? (
                  <p className="mt-1 text-muted-foreground">
                    {tx("Решение:", "Entscheidung:")} {item.decision_note}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {formatDate(item.created_at)}
                  {item.decided_at ? ` → ${formatDate(item.decided_at)}` : ""}
                </p>
                {canReject || canBill ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {needsVatChoice ? (
                      <VatTreatmentSelect
                        value={chosenVat}
                        onChange={(value) =>
                          setDecisionVat((current) => ({ ...current, [item.id]: value }))
                        }
                        disabled={busy}
                        tx={tx}
                        className="h-8 min-w-0 flex-[1_1_14rem]"
                      />
                    ) : null}
                    {canBill ? (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-lg"
                        disabled={busy || (needsVatChoice && !chosenVat)}
                        onClick={() =>
                          void run(
                            () =>
                              billOrderAmendment(
                                orderId,
                                item.id,
                                item.vat_treatment ?? (chosenVat || null),
                              ),
                            billedNotice,
                          )
                        }
                      >
                        {tx("Добавить в услуги заказа", "Zu den Auftragsleistungen hinzufügen")}
                      </Button>
                    ) : null}
                    {canReject && !canApprove ? (
                      <span className="text-[11px] text-muted-foreground">
                        {tx(
                          "Ваше предложение: одобрить его может другой сотрудник.",
                          "Ihr Vorschlag: Genehmigen kann ihn eine andere Person.",
                        )}
                      </span>
                    ) : null}
                    {canApprove ? (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-lg"
                        disabled={busy || (needsVatChoice && !chosenVat)}
                        onClick={() =>
                          void run(
                            () =>
                              decideOrderAmendment(orderId, item.id, "approve", {
                                vatTreatment: item.vat_treatment ?? (chosenVat || null),
                              }),
                            billedNotice,
                          )
                        }
                      >
                        {tx("Одобрить", "Genehmigen")}
                      </Button>
                    ) : null}
                    {canReject ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => decideOrderAmendment(orderId, item.id, "reject"),
                            ownRequest
                              ? tx("Предложение отозвано.", "Vorschlag zurückgezogen.")
                              : tx("Изменение отклонено.", "Änderung abgelehnt."),
                          )
                        }
                      >
                        {ownRequest ? tx("Отозвать", "Zurückziehen") : tx("Отклонить", "Ablehnen")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {actionNotice ? (
        <p role="status" className="mt-2 text-xs text-emerald-700">{actionNotice}</p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">{actionError}</p>
      ) : null}
      {loadError ? (
        <div className="mt-2 space-y-2">
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
            {tx("Повторить загрузку", "Erneut laden")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
