import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import {
  createOrderAmendment,
  decideOrderAmendment,
  fetchOrderAmendments,
  type OrderAmendment,
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
 * Decision actions for one amendment. Only a pending amendment is decided, and
 * only by a role that may manage amendments. The server refuses approval by
 * the requester, so the requester only gets to withdraw (reject) it.
 */
export function amendmentDecisionActions(params: {
  status: string;
  requestedBy: string;
  currentUserId: string | null;
  canManage: boolean;
}) {
  const pending = params.status === "pending" && params.canManage;
  const ownRequest = Boolean(params.currentUserId) && params.requestedBy === params.currentUserId;
  return {
    ownRequest,
    canApprove: pending && !ownRequest,
    canReject: pending,
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
    case "agreed_note is required (what was agreed with the patient)":
      return tx(
        "Укажите, что согласовано с пациентом.",
        "Geben Sie an, was mit dem Patienten vereinbart wurde.",
      );
    case "delta_amount must be non-zero":
    case "Invalid delta_amount":
      return tx(
        "Укажите изменение суммы, отличное от нуля.",
        "Geben Sie eine Betragsänderung ungleich null an.",
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

/**
 * Order amount amendments under approval (#10): propose a delta to the order
 * total with the note of what was agreed with the patient; it stays pending —
 * not applied to the total — until a different user approves it. The
 * requester sees their own proposal without an approve action; read-only
 * roles only see the history.
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
  const [busy, setBusy] = useState(false);

  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");

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

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await action();
      await load();
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
  const normalizedDelta = delta.trim().replace(",", ".");
  const deltaValid = /^-?\d+(?:\.\d+)?$/.test(normalizedDelta)
    && Number.isFinite(Number(normalizedDelta)) && Number(normalizedDelta) !== 0;

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
            {tx("Предложить изменение суммы", "Betragsänderung vorschlagen")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              aria-label={tx("Изменение суммы", "Betragsänderung")}
              disabled={busy}
              value={delta}
              onChange={(event) => setDelta(event.target.value)}
              placeholder={tx("Дельта, напр. 150 или -50", "Delta, z. B. 150 oder -50")}
              className="h-9 w-40 max-w-full"
              inputMode="decimal"
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
              disabled={busy || !deltaValid || note.trim() === ""}
              onClick={() =>
                void run(async () => {
                  await createOrderAmendment(orderId, {
                    delta_amount: normalizedDelta,
                    agreed_note: note.trim(),
                  });
                  setDelta("");
                  setNote("");
                })
              }
            >
              {tx("Предложить", "Vorschlagen")}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {tx(
              "Сумма заказа изменится только после одобрения другим сотрудником.",
              "Die Auftragssumme ändert sich erst nach Genehmigung durch eine andere Person.",
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
            const { ownRequest, canApprove, canReject } = amendmentDecisionActions({
              status: item.status,
              requestedBy: item.requested_by,
              currentUserId,
              canManage,
            });
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatAmendmentDelta(item.delta_amount, item.currency)}
                  </span>
                  <Badge variant="outline" className={`rounded-full ${statusTone(item.status)}`}>
                    {statusLabel(item.status, tx)}
                  </Badge>
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
                {canReject ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!canApprove ? (
                      <span className="text-[11px] text-muted-foreground">
                        {tx(
                          "Ваше предложение: одобрить его может другой сотрудник.",
                          "Ihr Vorschlag: Genehmigen kann ihn eine andere Person.",
                        )}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-lg"
                        disabled={busy}
                        onClick={() =>
                          void run(() => decideOrderAmendment(orderId, item.id, "approve"))
                        }
                      >
                        {tx("Одобрить", "Genehmigen")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-lg"
                      disabled={busy}
                      onClick={() =>
                        void run(() => decideOrderAmendment(orderId, item.id, "reject"))
                      }
                    >
                      {ownRequest ? tx("Отозвать", "Zurückziehen") : tx("Отклонить", "Ablehnen")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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
