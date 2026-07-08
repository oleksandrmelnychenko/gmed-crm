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

function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/**
 * Order amount amendments under approval (#10): propose a delta to the order
 * total with the note of what was agreed with the patient; it stays pending —
 * not applied to the total — until a different user approves it.
 */
export function OrderAmendmentsPanel({ orderId }: { orderId: string }) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [amendments, setAmendments] = useState<OrderAmendment[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");

  function load() {
    return fetchOrderAmendments(orderId)
      .then(setAmendments)
      .catch((nextError: unknown) => {
        setError(
          nextError instanceof Error
            ? nextError.message
            : tx("Не удалось загрузить", "Konnte nicht laden"),
        );
      });
  }

  useEffect(() => {
    let active = true;
    fetchOrderAmendments(orderId)
      .then((rows) => {
        if (active) setAmendments(rows);
      })
      .catch(() => {
        if (active) setAmendments([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Действие не удалось", "Aktion fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!amendments) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {error || tx("Загрузка…", "Wird geladen…")}
      </div>
    );
  }

  const pendingCount = amendments.filter((item) => item.status === "pending").length;
  const deltaValid = delta.trim() !== "" && Number.isFinite(Number(delta.trim()));

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

      <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
        <p className="text-xs font-medium text-foreground">
          {tx("Предложить изменение суммы", "Betragsänderung vorschlagen")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder={tx("Дельта, напр. 150 или -50", "Delta, z. B. 150 oder -50")}
            className="h-9 w-40"
            inputMode="decimal"
          />
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={tx("Что согласовано с пациентом", "Mit dem Patienten Vereinbartes")}
            className="h-9 flex-1 min-w-[16rem]"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !deltaValid || note.trim() === ""}
            onClick={() =>
              void run(async () => {
                await createOrderAmendment(orderId, {
                  delta_amount: delta.trim(),
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

      {amendments.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {tx("Изменений пока нет.", "Noch keine Änderungen.")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {amendments.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {Number(item.delta_amount) > 0 ? "+" : ""}
                  {item.delta_amount} {item.currency}
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
              {item.status === "pending" ? (
                <div className="mt-2 flex gap-2">
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
                    {tx("Отклонить", "Ablehnen")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
