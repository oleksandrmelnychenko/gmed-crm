import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import {
  fetchOrderGroup,
  mergeOrdersIntoHead,
  orderGroupCandidates,
  searchOrders,
  setOrderPayer,
  ungroupOrder,
  type OrderGroup,
} from "../data/order-api";
import type { OrderSummary } from "../model/types";

type Bilingual = (ru: string, de: string) => string;

function roleLabel(role: string, tx: Bilingual): string {
  switch (role) {
    case "main":
      return tx("Главный (MAIN)", "Hauptauftrag (MAIN)");
    case "sub":
      return tx("Подчинённый", "Unterauftrag");
    default:
      return tx("Отдельный", "Einzelauftrag");
  }
}

function money(value: string | null, currency: string): string {
  return value ? `${value} ${currency}` : "—";
}

/**
 * Head / multi-patient order group (#1/#3/#4/#7): shows the group rollup and the
 * covered patients, lets a manager fold more orders in (attach one or merge many),
 * detach subs, and designate who pays for the whole group.
 */
export function OrderGroupPanel({ orderId }: { orderId: string }) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [group, setGroup] = useState<OrderGroup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [candidates, setCandidates] = useState<OrderSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerRelationship, setPayerRelationship] = useState("");
  const [payerNotes, setPayerNotes] = useState("");

  function applyGroup(next: OrderGroup) {
    setGroup(next);
    setPayerName(next.head.payer_contact_name ?? "");
  }

  useEffect(() => {
    let active = true;
    fetchOrderGroup(orderId)
      .then((value) => {
        if (active) applyGroup(value);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : tx("Не удалось загрузить группу", "Gruppe konnte nicht geladen werden"),
          );
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function run(action: () => Promise<unknown>, reloadOnly = false) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (reloadOnly || !result || typeof result !== "object") {
        applyGroup(await fetchOrderGroup(orderId));
      } else {
        applyGroup(result as OrderGroup);
      }
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

  async function runSearch() {
    if (!group) return;
    setSearching(true);
    setError("");
    try {
      const results = await searchOrders(searchQuery);
      const subIds = group.subs.map((sub) => sub.id);
      setCandidates(orderGroupCandidates(results, group.head.id, subIds));
    } catch {
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  if (!group) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {error || tx("Загрузка группы…", "Gruppe wird geladen…")}
      </div>
    );
  }

  const viewingHead = group.head.id === orderId;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">
          {tx("Групповой заказ", "Auftragsgruppe")}
        </h4>
        <Badge variant="outline" className="rounded-full bg-background">
          {roleLabel(group.head.order_role, tx)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SummaryTile
          label={tx("Итог по группе", "Gruppensumme")}
          value={money(group.rollup_total_estimated, group.head.currency)}
        />
        <SummaryTile
          label={tx("Пациентов покрыто", "Abgedeckte Patienten")}
          value={String(group.covered_patient_ids.length)}
        />
        <SummaryTile
          label={tx("Подчинённых заказов", "Unteraufträge")}
          value={String(group.subs.length)}
        />
      </div>

      {!viewingHead ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-background p-3 text-xs">
          <p className="text-muted-foreground">
            {tx("Этот заказ входит в группу", "Dieser Auftrag gehört zur Gruppe")}{" "}
            <span className="font-mono text-foreground">{group.head.order_number}</span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 rounded-lg"
            disabled={busy}
            onClick={() => void run(() => ungroupOrder(orderId), true)}
          >
            {tx("Вывести из группы", "Aus Gruppe lösen")}
          </Button>
        </div>
      ) : null}

      {group.subs.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {group.subs.map((sub) => (
            <li
              key={sub.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs"
            >
              <span className="font-mono text-foreground">{sub.order_number}</span>
              <span className="text-muted-foreground">{sub.status}</span>
              <span className="font-semibold text-foreground">
                {money(sub.total_estimated, group.head.currency)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                disabled={busy}
                onClick={() => void run(() => ungroupOrder(sub.id), true)}
              >
                {tx("Отвязать", "Lösen")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {viewingHead ? (
        <div className="mt-4 space-y-3 border-t border-border/60 pt-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {tx("Добавить заказы в группу", "Aufträge zur Gruppe hinzufügen")}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={tx("Поиск по номеру или пациенту…", "Nach Nummer oder Patient suchen…")}
                className="h-9 flex-1 min-w-[14rem]"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={searching}
                onClick={() => void runSearch()}
              >
                {searching ? tx("Поиск…", "Suche…") : tx("Найти", "Suchen")}
              </Button>
            </div>

            {candidates.length > 0 ? (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {candidates.map((candidate) => {
                  const checked = selectedIds.includes(candidate.id);
                  return (
                    <li key={candidate.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(candidate.id)}
                        />
                        <span className="font-mono text-foreground">{candidate.order_number}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {candidate.patient_name}
                        </span>
                        <span className="text-muted-foreground">{candidate.status}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : searchQuery.trim() && !searching ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {tx("Ничего не найдено.", "Nichts gefunden.")}
              </p>
            ) : null}

            {selectedIds.length > 0 ? (
              <Button
                type="button"
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await mergeOrdersIntoHead(group.head.id, selectedIds);
                    setSelectedIds([]);
                    setCandidates([]);
                    setSearchQuery("");
                    return next;
                  })
                }
              >
                {tx(
                  `Добавить выбранные (${selectedIds.length})`,
                  `Ausgewählte hinzufügen (${selectedIds.length})`,
                )}
              </Button>
            ) : null}
          </div>

          <div className="rounded-lg border border-border/60 bg-background p-3">
            <p className="text-xs font-medium text-foreground">
              {tx("Плательщик группы", "Zahler der Gruppe")}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
                placeholder={tx("Имя плательщика (напр. отец)", "Name des Zahlers (z. B. Vater)")}
                className="h-9"
              />
              <Input
                value={payerRelationship}
                onChange={(event) => setPayerRelationship(event.target.value)}
                placeholder={tx("Кем приходится", "Beziehung")}
                className="h-9"
              />
              <Input
                value={payerEmail}
                onChange={(event) => setPayerEmail(event.target.value)}
                placeholder={tx("E-mail", "E-Mail")}
                className="h-9"
              />
              <Input
                value={payerPhone}
                onChange={(event) => setPayerPhone(event.target.value)}
                placeholder={tx("Телефон", "Telefon")}
                className="h-9"
              />
              <Input
                value={payerNotes}
                onChange={(event) => setPayerNotes(event.target.value)}
                placeholder={tx("Заметки", "Notizen")}
                className="h-9 sm:col-span-2"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-2 rounded-lg"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    setOrderPayer(group.head.id, {
                      payer_contact_name: payerName.trim() || null,
                      payer_contact_email: payerEmail.trim() || null,
                      payer_contact_phone: payerPhone.trim() || null,
                      payer_contact_relationship: payerRelationship.trim() || null,
                      payer_notes: payerNotes.trim() || null,
                    }),
                  true,
                )
              }
            >
              {tx("Сохранить плательщика", "Zahler speichern")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
