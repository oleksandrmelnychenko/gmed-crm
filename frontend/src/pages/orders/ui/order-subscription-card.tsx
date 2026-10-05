import { useEffect, useState } from "react";
import { BadgeCheck, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { formatAppDate } from "@/lib/app-time-zone";
import { subscriptionKindLabel } from "@/pages/patients/model/list-model";

import {
  fetchOrderSubscription,
  setOrderSubscription,
  type OrderSubscription,
} from "../data/order-subscription-api";

/**
 * The tariff of an order — GMED One, GMED Reserve or the organisation of a
 * treatment (owner decision 2026-10-05). The chosen tariff becomes the
 * patient's subscription and shows as the account type in the patients table.
 */
export function OrderSubscriptionCard({ orderId, lang }: { orderId: string; lang: string }) {
  const de = lang === "de";
  const [data, setData] = useState<OrderSubscription | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchOrderSubscription(orderId)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setChoice(value.current?.package_id ?? "");
      })
      .catch(() => {
        // An order without a patient yet has no tariff to choose.
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (unavailable || !data) return null;

  const current = data.current;
  const dirty = choice !== (current?.package_id ?? "");

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await setOrderSubscription(orderId, { package_id: choice || null });
      setData(next);
      setChoice(next.current?.package_id ?? "");
      setNotice(
        next.current
          ? de
            ? "Tarif gespeichert: Er ist jetzt der Kontotyp des Patienten."
            : "Тариф сохранён: теперь это тип аккаунта пациента."
          : de
            ? "Tarif entfernt."
            : "Тариф снят.",
      );
    } catch {
      setError(de ? "Der Tarif konnte nicht gespeichert werden." : "Не удалось сохранить тариф.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="min-w-0 rounded-xl border border-border/70 bg-card"
      data-testid="order-subscription"
      aria-label={de ? "Tarif" : "Тариф"}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-3">
        <BadgeCheck className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground">
          {de ? "Tarif · Kontotyp des Patienten" : "Тариф · тип аккаунта пациента"}
        </p>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <p data-testid="order-subscription-current">
          {current ? (
            <>
              <span className="font-medium text-foreground">{subscriptionKindLabel(current, lang)}</span>
              <span className="text-muted-foreground">
                {" · "}
                {[
                  current.name,
                  current.ends_on
                    ? `${de ? "bis" : "до"} ${formatAppDate(current.ends_on)}`
                    : current.starts_on
                      ? `${de ? "seit" : "с"} ${formatAppDate(current.starts_on)}`
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{de ? "Kein Tarif gewählt" : "Тариф не выбран"}</span>
          )}
        </p>
        {data.can_edit ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <NativeComboboxSelect
              className="h-9 min-w-0 flex-1 bg-field text-sm"
              value={choice}
              aria-label={de ? "Tarif wählen" : "Выбрать тариф"}
              onChange={(event) => setChoice(event.target.value)}
              data-testid="order-subscription-select"
            >
              <option value="">{de ? "Kein Tarif" : "Без тарифа"}</option>
              {data.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${subscriptionKindLabel(option, lang)} · ${option.name ?? option.package_key}`}
                </option>
              ))}
            </NativeComboboxSelect>
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 rounded-md"
              disabled={busy || !dirty}
              onClick={() => void save()}
              data-testid="order-subscription-save"
            >
              {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
              {de ? "Tarif speichern" : "Сохранить тариф"}
            </Button>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-emerald-700">{notice}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-rose-700">{error}</p>
        ) : null}
      </div>
    </section>
  );
}
