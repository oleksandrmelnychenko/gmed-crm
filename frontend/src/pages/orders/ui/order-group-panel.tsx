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
  fetchPayerRelationChoices,
  setOrderPayer,
  ungroupOrder,
  type OrderGroup,
  type PayerRelationChoice,
} from "../data/order-api";
import { formatCurrency } from "../model/order-model";
import {
  EMPTY_ORDER_PAYER,
  isPlausiblePayerEmail,
  orderPayerPayload,
  orderPayerToForm,
  type OrderPayerForm,
} from "../model/order-payer";
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
  return value ? formatCurrency(value, currency || "EUR") : "—";
}

export function orderGroupStatusLabel(status: string, tx: Bilingual): string {
  switch (status) {
    case "active":
      return tx("Активен", "Aktiv");
    case "paused":
      return tx("Приостановлен", "Pausiert");
    case "completed":
      return tx("Завершён", "Abgeschlossen");
    case "cancelled":
      return tx("Отменён", "Storniert");
    default:
      return status;
  }
}

/** The server's grouping errors in the staff language; unknown texts pass through. */
export function localizedOrderGroupError(message: string, tx: Bilingual): string {
  switch (message) {
    case "Only a standalone order can be grouped under a head":
      return tx(
        "В группу можно добавить только отдельный заказ.",
        "Nur ein Einzelauftrag kann einer Gruppe hinzugefügt werden.",
      );
    case "Cannot group under a sub-order (one level only)":
    case "Target cannot be a sub-order (one level only)":
      return tx(
        "Подчинённый заказ не может быть главным (только один уровень).",
        "Ein Unterauftrag kann kein Hauptauftrag sein (nur eine Ebene).",
      );
    case "An order cannot be grouped under itself":
      return tx("Заказ нельзя добавить в собственную группу.", "Ein Auftrag kann nicht sich selbst untergeordnet werden.");
    case "Order is not grouped":
      return tx("Заказ не входит в группу.", "Der Auftrag gehört zu keiner Gruppe.");
    case "No orders to merge":
      return tx("Выберите заказы для объединения.", "Wählen Sie Aufträge zum Zusammenführen.");
    case "Insufficient permissions":
    case "Forbidden":
      return tx("Недостаточно прав для этого действия.", "Für diese Aktion fehlen die Berechtigungen.");
    default:
      return message;
  }
}

/**
 * Head / multi-patient order group (#1/#3/#4/#7): shows the group rollup and the
 * covered patients, lets a manager fold more orders in (attach one or merge many),
 * detach subs, and designate who pays for the whole group. Read-only roles only
 * see the group.
 */
export function OrderGroupPanel({
  orderId,
  canManage = true,
}: {
  orderId: string;
  canManage?: boolean;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [group, setGroup] = useState<OrderGroup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [candidates, setCandidates] = useState<OrderSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [payer, setPayer] = useState<OrderPayerForm>(EMPTY_ORDER_PAYER);
  const [relationChoices, setRelationChoices] = useState<PayerRelationChoice[]>([]);
  const updatePayer = (patch: Partial<OrderPayerForm>) =>
    setPayer((current) => ({ ...current, ...patch }));

  function applyGroup(next: OrderGroup) {
    setGroup(next);
    setPayer(orderPayerToForm(next.head));
  }

  const headPatientId = group?.head.patient_id ?? null;
  useEffect(() => {
    if (!headPatientId) {
      setRelationChoices([]);
      return;
    }
    let active = true;
    fetchPayerRelationChoices(headPatientId)
      .then((choices) => {
        if (active) setRelationChoices(choices);
      })
      .catch(() => {
        if (active) setRelationChoices([]);
      });
    return () => {
      active = false;
    };
  }, [headPatientId]);

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
              ? localizedOrderGroupError(nextError.message, tx)
              : tx("Не удалось загрузить группу", "Gruppe konnte nicht geladen werden"),
          );
        }
      });
    return () => {
      active = false;
    };
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
          ? localizedOrderGroupError(nextError.message, tx)
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
          {canManage ? (
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
          ) : null}
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
              <span className="text-muted-foreground">{orderGroupStatusLabel(sub.status, tx)}</span>
              <span
                className={
                  sub.status === "cancelled"
                    ? "font-semibold text-muted-foreground line-through"
                    : "font-semibold text-foreground"
                }
                title={
                  sub.status === "cancelled"
                    ? tx("Отменённый заказ не входит в итог группы.", "Stornierte Aufträge zählen nicht zur Gruppensumme.")
                    : undefined
                }
              >
                {money(sub.total_estimated, group.head.currency)}
              </span>
              {canManage ? (
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
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {viewingHead && canManage ? (
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
                        <span className="text-muted-foreground">
                          {orderGroupStatusLabel(candidate.status, tx)}
                        </span>
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
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {tx(
                "Счета заказа и подзаказов семьи выставляются плательщику целиком: имя, e-mail и почтовый адрес для счёта.",
                "Rechnungen des Auftrags und der Familien-Unteraufträge gehen an diesen Zahler – mit Name, E-Mail und Rechnungsanschrift.",
              )}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={payer.relationId}
                onChange={(event) => updatePayer({ relationId: event.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label={tx("Родственник-плательщик", "Angehöriger als Zahler")}
              >
                <option value="">{tx("Родственник не выбран", "Kein Angehöriger gewählt")}</option>
                {relationChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.isDefaultPayer
                      ? `${choice.name} · ${tx("платит по умолчанию", "zahlt standardmäßig")}`
                      : choice.name}
                  </option>
                ))}
              </select>
              <Input
                value={payer.patientPid}
                onChange={(event) => updatePayer({ patientPid: event.target.value })}
                placeholder={tx("Или пациент-плательщик (номер P-…)", "Oder Zahler ist Patient (Nr. P-…)")}
                className="h-9"
                disabled={Boolean(payer.relationId)}
              />
              <Input
                value={payer.name}
                onChange={(event) => updatePayer({ name: event.target.value })}
                placeholder={tx("Имя плательщика (напр. отец)", "Name des Zahlers (z. B. Vater)")}
                className="h-9"
              />
              <Input
                value={payer.relationship}
                onChange={(event) => updatePayer({ relationship: event.target.value })}
                placeholder={tx("Кем приходится", "Beziehung")}
                className="h-9"
              />
              <Input
                value={payer.email}
                onChange={(event) => updatePayer({ email: event.target.value })}
                placeholder={tx("E-mail для счетов", "E-Mail für Rechnungen")}
                className="h-9"
                aria-invalid={!isPlausiblePayerEmail(payer.email)}
              />
              <Input
                value={payer.phone}
                onChange={(event) => updatePayer({ phone: event.target.value })}
                placeholder={tx("Телефон", "Telefon")}
                className="h-9"
              />
              <Input
                value={payer.street}
                onChange={(event) => updatePayer({ street: event.target.value })}
                placeholder={tx("Улица и дом", "Straße und Hausnummer")}
                className="h-9 sm:col-span-2"
              />
              <Input
                value={payer.zip}
                onChange={(event) => updatePayer({ zip: event.target.value })}
                placeholder={tx("Индекс", "PLZ")}
                className="h-9"
              />
              <Input
                value={payer.city}
                onChange={(event) => updatePayer({ city: event.target.value })}
                placeholder={tx("Город", "Ort")}
                className="h-9"
              />
              <Input
                value={payer.country}
                onChange={(event) => updatePayer({ country: event.target.value })}
                placeholder={tx("Страна", "Land")}
                className="h-9"
              />
              <select
                value={payer.role}
                onChange={(event) =>
                  updatePayer({ role: event.target.value as OrderPayerForm["role"] })
                }
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label={tx("Получатель счёта", "Rechnungsempfänger")}
              >
                <option value="">{tx("Проверить при выпуске счёта", "Bei Ausstellung prüfen")}</option>
                <option value="contracting_party">
                  {tx("Получатель счёта — сторона договора", "Rechnungsempfänger ist Vertragspartner")}
                </option>
                <option value="cost_bearer">
                  {tx("Другой получатель счёта (сторонний плательщик)", "Abweichender Rechnungsempfänger (Kostenübernehmer)")}
                </option>
              </select>
              <Input
                value={payer.notes}
                onChange={(event) => updatePayer({ notes: event.target.value })}
                placeholder={tx("Заметки", "Notizen")}
                className="h-9 sm:col-span-2"
              />
            </div>
            {!isPlausiblePayerEmail(payer.email) ? (
              <p className="mt-1 text-xs text-rose-600">
                {tx("Проверьте e-mail плательщика", "E-Mail-Adresse des Zahlers prüfen")}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="mt-2 rounded-lg"
              disabled={busy || !isPlausiblePayerEmail(payer.email)}
              onClick={() =>
                void run(() => setOrderPayer(group.head.id, orderPayerPayload(payer)), true)
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
