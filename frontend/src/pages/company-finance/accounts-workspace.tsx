import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  Building2,
  CreditCard,
  Plus,
  RefreshCw,
  Undo2,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Banner as ShellBanner, selectClass as shellSelectClassName } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  createCompanyFinancialAccount,
  createCompanyFinancialAccountAdjustment,
  createCompanyFinancialAccountTransfer,
  reverseCompanyFinancialAccountAdjustment,
  reverseCompanyFinancialAccountTransfer,
  updateCompanyFinancialAccount,
} from "./data";
import type {
  CompanyFinancialAccount,
  CompanyFinancialAccountAdjustment,
  CompanyFinancialAccountTransfer,
  CompanyFinancialAccountsPayload,
} from "./types";

type Props = {
  payload: CompanyFinancialAccountsPayload;
  currency: string;
  locale: string;
  money: (value: string | null | undefined) => string;
  onChanged: () => void;
};

const copy = {
  ru: {
    create: "Добавить счет",
    createTitle: "Новый счет GMED",
    createDescription: "Банк, касса или карта в одной валюте.",
    name: "Название",
    type: "Тип",
    bank: "Банк",
    cash: "Касса",
    card: "Карта",
    other: "Другой",
    iban: "IBAN / реквизиты",
    openingBalance: "Начальный остаток",
    openingDate: "Остаток на начало дня",
    defaultAccount: "Счет по умолчанию",
    save: "Сохранить",
    cancel: "Отмена",
    currentBalance: "Фактический остаток",
    opening: "Начальный",
    movements: "Операции",
    corrections: "Сверка",
    internalTransfers: "Внутренние переводы",
    internalTransfer: "Перевести между счетами",
    transferTitle: "Внутренний перевод",
    transferDescription: "Перемещение денег между счетами GMED в одной валюте.",
    sourceAccount: "Со счета",
    targetAccount: "На счет",
    reference: "Назначение / референс",
    transferBalance: "Переводы",
    noTransfers: "Внутренних переводов пока нет",
    transferUnavailable: "Нужно минимум два активных счета в одной валюте",
    transferReversalTitle: "Сторно внутреннего перевода",
    transferReversalDescription: "Сумма вернется на исходный счет.",
    movementCount: "движений",
    default: "По умолчанию",
    inactive: "Неактивен",
    makeDefault: "Сделать основным",
    addAdjustment: "Операция сверки",
    adjustmentTitle: "Операция сверки счета",
    direction: "Направление",
    inflow: "Увеличить остаток",
    outflow: "Уменьшить остаток",
    amount: "Сумма",
    date: "Дата",
    reason: "Основание",
    note: "Внутренняя заметка",
    history: "История сверки",
    account: "Счет",
    operation: "Операция",
    author: "Автор",
    reverse: "Сторнировать",
    reversalTitle: "Сторно операции",
    reversalReason: "Причина сторно",
    noAdjustments: "Операций сверки пока нет",
    unassigned: (count: number, amount: string) =>
      `${count} денежных движений еще не привязаны к счету (${amount}).`,
  },
  de: {
    create: "Konto hinzufügen",
    createTitle: "Neues GMED-Konto",
    createDescription: "Bank, Kasse oder Karte in einer Währung.",
    name: "Bezeichnung",
    type: "Typ",
    bank: "Bank",
    cash: "Kasse",
    card: "Karte",
    other: "Sonstiges",
    iban: "IBAN / Kontodaten",
    openingBalance: "Anfangsbestand",
    openingDate: "Bestand zu Tagesbeginn",
    defaultAccount: "Standardkonto",
    save: "Speichern",
    cancel: "Abbrechen",
    currentBalance: "Tatsächlicher Bestand",
    opening: "Anfang",
    movements: "Bewegungen",
    corrections: "Abstimmung",
    internalTransfers: "Interne Umbuchungen",
    internalTransfer: "Zwischen Konten umbuchen",
    transferTitle: "Interne Umbuchung",
    transferDescription: "Geld zwischen GMED-Konten derselben Währung verschieben.",
    sourceAccount: "Vom Konto",
    targetAccount: "Auf Konto",
    reference: "Verwendungszweck / Referenz",
    transferBalance: "Umbuchungen",
    noTransfers: "Noch keine internen Umbuchungen",
    transferUnavailable: "Mindestens zwei aktive Konten derselben Währung sind erforderlich",
    transferReversalTitle: "Interne Umbuchung stornieren",
    transferReversalDescription: "Der Betrag wird auf das ursprüngliche Konto zurückgebucht.",
    movementCount: "Bewegungen",
    default: "Standard",
    inactive: "Inaktiv",
    makeDefault: "Als Standard setzen",
    addAdjustment: "Abstimmungsbuchung",
    adjustmentTitle: "Konto abstimmen",
    direction: "Richtung",
    inflow: "Bestand erhöhen",
    outflow: "Bestand verringern",
    amount: "Betrag",
    date: "Datum",
    reason: "Begründung",
    note: "Interne Notiz",
    history: "Abstimmungsverlauf",
    account: "Konto",
    operation: "Vorgang",
    author: "Erfasst von",
    reverse: "Stornieren",
    reversalTitle: "Buchung stornieren",
    reversalReason: "Stornogrund",
    noAdjustments: "Noch keine Abstimmungsbuchungen",
    unassigned: (count: number, amount: string) =>
      `${count} Geldbewegungen sind noch keinem Konto zugeordnet (${amount}).`,
  },
} as const;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function accountIcon(type: CompanyFinancialAccount["account_type"]) {
  if (type === "cash") return Banknote;
  if (type === "card") return CreditCard;
  if (type === "bank") return Building2;
  return WalletCards;
}

function formatDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

export function CompanyAccountsWorkspace({ payload, currency, locale, money, onChanged }: Props) {
  const { lang } = useLang();
  const text = copy[lang];
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    accountType: "bank",
    iban: "",
    openingBalance: "0.00",
    openingBalanceOn: todayIso(),
    isDefault: false,
  });
  const [adjustAccount, setAdjustAccount] = useState<CompanyFinancialAccount | null>(null);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    requestId: crypto.randomUUID(),
    direction: "inflow",
    amount: "",
    effectiveOn: todayIso(),
    reason: "",
    note: "",
  });
  const [reverseAdjustment, setReverseAdjustment] =
    useState<CompanyFinancialAccountAdjustment | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [reverseForm, setReverseForm] = useState({
    requestId: crypto.randomUUID(),
    effectiveOn: todayIso(),
    reason: "",
  });
  const [defaultBusyId, setDefaultBusyId] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState({
    requestId: crypto.randomUUID(),
    sourceAccountId: "",
    targetAccountId: "",
    amount: "",
    effectiveOn: todayIso(),
    reference: "",
    note: "",
  });
  const [reverseTransfer, setReverseTransfer] =
    useState<CompanyFinancialAccountTransfer | null>(null);
  const [reverseTransferBusy, setReverseTransferBusy] = useState(false);
  const [reverseTransferError, setReverseTransferError] = useState<string | null>(null);
  const [reverseTransferForm, setReverseTransferForm] = useState({
    requestId: crypto.randomUUID(),
    effectiveOn: todayIso(),
    reference: "",
    note: "",
  });
  const activeAccounts = payload.items.filter((account) => account.is_active);
  const transferRows = useMemo(() => payload.transfers ?? [], [payload.transfers]);

  function openTransferDialog() {
    const source = activeAccounts.find((account) => account.is_default) ?? activeAccounts[0];
    const target = activeAccounts.find((account) => account.id !== source?.id);
    setTransferError(null);
    setTransferForm({
      requestId: crypto.randomUUID(),
      sourceAccountId: source?.id ?? "",
      targetAccountId: target?.id ?? "",
      amount: "",
      effectiveOn: todayIso(),
      reference: "",
      note: "",
    });
    setTransferOpen(true);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createCompanyFinancialAccount({
        name: createForm.name.trim(),
        account_type: createForm.accountType,
        currency,
        iban: createForm.iban.trim() || null,
        opening_balance: createForm.openingBalance,
        opening_balance_on: createForm.openingBalanceOn,
        is_default: createForm.isDefault,
      });
      setCreateOpen(false);
      setCreateForm({
        name: "",
        accountType: "bank",
        iban: "",
        openingBalance: "0.00",
        openingBalanceOn: todayIso(),
        isDefault: false,
      });
      onChanged();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create account");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleMakeDefault(account: CompanyFinancialAccount) {
    setDefaultBusyId(account.id);
    setWorkspaceError(null);
    try {
      await updateCompanyFinancialAccount(account.id, { is_default: true, is_active: true });
      onChanged();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Failed to update account");
    } finally {
      setDefaultBusyId("");
    }
  }

  async function handleAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!adjustAccount) return;
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      await createCompanyFinancialAccountAdjustment(adjustAccount.id, {
        request_id: adjustForm.requestId,
        direction: adjustForm.direction,
        amount: adjustForm.amount,
        effective_on: adjustForm.effectiveOn,
        reason: adjustForm.reason.trim(),
        note: adjustForm.note.trim() || null,
      });
      setAdjustAccount(null);
      setAdjustForm({
        requestId: crypto.randomUUID(),
        direction: "inflow",
        amount: "",
        effectiveOn: todayIso(),
        reason: "",
        note: "",
      });
      onChanged();
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : "Failed to record adjustment");
    } finally {
      setAdjustBusy(false);
    }
  }

  async function handleReverse(event: FormEvent) {
    event.preventDefault();
    if (!reverseAdjustment) return;
    setReverseBusy(true);
    setReverseError(null);
    try {
      await reverseCompanyFinancialAccountAdjustment(
        reverseAdjustment.financial_account_id,
        reverseAdjustment.id,
        {
          request_id: reverseForm.requestId,
          effective_on: reverseForm.effectiveOn,
          reason: reverseForm.reason.trim(),
        },
      );
      setReverseAdjustment(null);
      setReverseForm({ requestId: crypto.randomUUID(), effectiveOn: todayIso(), reason: "" });
      onChanged();
    } catch (error) {
      setReverseError(error instanceof Error ? error.message : "Failed to reverse adjustment");
    } finally {
      setReverseBusy(false);
    }
  }

  async function handleTransfer(event: FormEvent) {
    event.preventDefault();
    setTransferBusy(true);
    setTransferError(null);
    try {
      await createCompanyFinancialAccountTransfer({
        request_id: transferForm.requestId,
        source_account_id: transferForm.sourceAccountId,
        target_account_id: transferForm.targetAccountId,
        amount: transferForm.amount,
        effective_on: transferForm.effectiveOn,
        reference: transferForm.reference.trim() || null,
        note: transferForm.note.trim() || null,
      });
      setTransferOpen(false);
      onChanged();
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Failed to record transfer");
    } finally {
      setTransferBusy(false);
    }
  }

  async function handleReverseTransfer(event: FormEvent) {
    event.preventDefault();
    if (!reverseTransfer) return;
    setReverseTransferBusy(true);
    setReverseTransferError(null);
    try {
      await reverseCompanyFinancialAccountTransfer(reverseTransfer.id, {
        request_id: reverseTransferForm.requestId,
        effective_on: reverseTransferForm.effectiveOn,
        reference: reverseTransferForm.reference.trim(),
        note: reverseTransferForm.note.trim() || null,
      });
      setReverseTransfer(null);
      setReverseTransferForm({
        requestId: crypto.randomUUID(),
        effectiveOn: todayIso(),
        reference: "",
        note: "",
      });
      onChanged();
    } catch (error) {
      setReverseTransferError(error instanceof Error ? error.message : "Failed to reverse transfer");
    } finally {
      setReverseTransferBusy(false);
    }
  }

  const transferColumns = useMemo<ColumnDef<CompanyFinancialAccountTransfer>[]>(() => [
    { id: "date", label: text.date, accessor: (row) => row.effective_on, filterType: "date", sortable: true, pinned: "left", width: 130, render: (row) => formatDate(row.effective_on, locale) },
    { id: "source", label: text.sourceAccount, accessor: (row) => row.source_account_name, filterType: "enum", sortable: true, searchable: true, width: 210 },
    { id: "target", label: text.targetAccount, accessor: (row) => row.target_account_name, filterType: "enum", sortable: true, searchable: true, width: 210, render: (row) => <span className="inline-flex items-center gap-2"><ArrowRight className="size-3.5 text-muted-foreground" />{row.target_account_name}</span> },
    {
      id: "reference",
      label: text.reference,
      accessor: (row) => `${row.reference ?? ""} ${row.note ?? ""}`,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      width: 280,
      render: (row) => <div className="truncate" title={row.reference ?? row.note ?? undefined}>{row.transaction_type === "reversal" ? <Badge className="mr-2 rounded-full text-[10px]" variant="outline">{text.reverse}</Badge> : null}{row.reference || row.note || "—"}</div>,
    },
    { id: "author", label: text.author, accessor: (row) => row.created_by_name, filterType: "text", searchable: true, sortable: true, width: 180, render: (row) => <span className="text-muted-foreground">{row.created_by_name}</span> },
    {
      id: "amount",
      label: text.amount,
      accessor: (row) => Number(row.amount),
      filterType: "number",
      sortable: true,
      width: 160,
      render: (row) => (
        <span className="inline-flex w-full items-center justify-end font-semibold">
          {money(row.amount)}
          {row.transaction_type === "transfer" && !transferRows.some((item) => item.reverses_transfer_id === row.id) ? (
            <Button type="button" size="icon-xs" variant="ghost" className="ml-2" aria-label={text.reverse} onClick={(event) => { event.stopPropagation(); setReverseTransferError(null); setReverseTransfer(row); }}><Undo2 /></Button>
          ) : null}
        </span>
      ),
    },
  ], [locale, money, text, transferRows]);

  const adjustmentColumns = useMemo<ColumnDef<CompanyFinancialAccountAdjustment>[]>(() => [
    { id: "date", label: text.date, accessor: (row) => row.effective_on, filterType: "date", sortable: true, pinned: "left", width: 130, render: (row) => formatDate(row.effective_on, locale) },
    { id: "account", label: text.account, accessor: (row) => row.account_name, filterType: "enum", sortable: true, searchable: true, width: 210 },
    { id: "operation", label: text.operation, accessor: (row) => row.transaction_type === "reversal" ? text.reverse : row.direction === "inflow" ? text.inflow : text.outflow, filterType: "enum", sortable: true, width: 180, render: (row) => <Badge variant="outline" className="rounded-full text-[10px]">{row.transaction_type === "reversal" ? text.reverse : row.direction === "inflow" ? text.inflow : text.outflow}</Badge> },
    { id: "reason", label: text.reason, accessor: (row) => row.reason, filterType: "text", searchable: true, sortable: true, required: true, width: 280, render: (row) => <div className="truncate" title={row.reason}>{row.reason}</div> },
    { id: "author", label: text.author, accessor: (row) => row.created_by_name, filterType: "text", searchable: true, sortable: true, width: 180, render: (row) => <span className="text-muted-foreground">{row.created_by_name}</span> },
    {
      id: "amount",
      label: text.amount,
      accessor: (row) => Number(row.amount),
      filterType: "number",
      sortable: true,
      width: 160,
      render: (row) => (
        <span className={cn("inline-flex w-full items-center justify-end font-semibold", row.direction === "inflow" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
          {row.direction === "inflow" ? "+" : "−"} {money(row.amount)}
          {row.transaction_type === "adjustment" && !payload.adjustments.some((item) => item.reverses_adjustment_id === row.id) ? (
            <Button type="button" size="icon-xs" variant="ghost" className="ml-2" aria-label={text.reverse} onClick={(event) => { event.stopPropagation(); setReverseError(null); setReverseAdjustment(row); }}><Undo2 /></Button>
          ) : null}
        </span>
      ),
    },
  ], [locale, money, payload.adjustments, text]);

  return (
    <div className="space-y-3">
      {workspaceError ? <ShellBanner tone="error">{workspaceError}</ShellBanner> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {payload.unassigned_movement_count > 0 ? (
            <ShellBanner tone="warning" withIcon>
              {text.unassigned(payload.unassigned_movement_count, money(payload.unassigned_signed_amount))}
            </ShellBanner>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={activeAccounts.length < 2}
            title={activeAccounts.length < 2 ? text.transferUnavailable : undefined}
            onClick={openTransferDialog}
          >
            <ArrowRightLeft className="size-4" />
            {text.internalTransfer}
          </Button>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {text.create}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {payload.items.map((account) => {
          const Icon = accountIcon(account.account_type);
          return (
            <article key={account.id} className={cn("rounded-lg border border-border/70 bg-card p-3 shadow-sm", !account.is_active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{account.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">{text[account.account_type]}</Badge>
                      {account.is_default ? <Badge variant="secondary">{text.default}</Badge> : null}
                      {!account.is_active ? <Badge variant="destructive">{text.inactive}</Badge> : null}
                    </div>
                    {account.iban ? <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{account.iban}</p> : null}
                  </div>
                </div>
                <span className="text-xs font-medium text-muted-foreground">{account.currency}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{text.currentBalance}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{money(account.current_balance)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{text.opening}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.opening_balance)}</dd></div>
                <div><dt className="text-muted-foreground">{text.movements}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.movement_balance)}</dd></div>
                <div><dt className="text-muted-foreground">{text.transferBalance}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.transfer_balance ?? "0")}</dd></div>
                <div><dt className="text-muted-foreground">{text.corrections}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.adjustment_balance)}</dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {formatDate(account.opening_balance_on, locale)} · {account.movement_count + (account.transfer_count ?? 0)} {text.movementCount}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="xs" variant="outline" disabled={!account.is_active} onClick={() => {
                  setAdjustError(null);
                  setAdjustAccount(account);
                }}>
                  {text.addAdjustment}
                </Button>
                {!account.is_default && account.is_active ? (
                  <Button type="button" size="xs" variant="ghost" disabled={defaultBusyId === account.id} onClick={() => void handleMakeDefault(account)}>
                    {defaultBusyId === account.id ? <RefreshCw className="animate-spin" /> : null}
                    {text.makeDefault}
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <DataTableSurface toolbarStart={<span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground"><span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />{text.internalTransfers}</span>} rows={transferRows} columns={transferColumns} rowId={(row) => row.id} storageKey="company-finance-transfers" defaultDensity="compact" defaultSort={[{ field: "date", dir: "desc" }]} emptyState={text.noTransfers} pagination={{ pageSize: 25 }} />

      <DataTableSurface toolbarStart={<span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground"><span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />{text.history}</span>} rows={payload.adjustments} columns={adjustmentColumns} rowId={(row) => row.id} storageKey="company-finance-adjustments" defaultDensity="compact" defaultSort={[{ field: "date", dir: "desc" }]} emptyState={text.noAdjustments} pagination={{ pageSize: 25 }} />

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.transferTitle}</DialogTitle>
            <DialogDescription>{text.transferDescription}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleTransfer}>
            {transferError ? <ShellBanner tone="error">{transferError}</ShellBanner> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span>{text.sourceAccount}</span>
                <select
                  className={shellSelectClassName}
                  required
                  value={transferForm.sourceAccountId}
                  onChange={(event) => {
                    const sourceAccountId = event.target.value;
                    setTransferForm((current) => ({
                      ...current,
                      sourceAccountId,
                      targetAccountId: current.targetAccountId === sourceAccountId
                        ? activeAccounts.find((account) => account.id !== sourceAccountId)?.id ?? ""
                        : current.targetAccountId,
                    }));
                  }}
                >
                  {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span>{text.targetAccount}</span>
                <select className={shellSelectClassName} required value={transferForm.targetAccountId} onChange={(event) => setTransferForm((current) => ({ ...current, targetAccountId: event.target.value }))}>
                  {activeAccounts.filter((account) => account.id !== transferForm.sourceAccountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm"><span>{text.amount}</span><Input required inputMode="decimal" value={transferForm.amount} onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" value={transferForm.effectiveOn} onChange={(event) => setTransferForm((current) => ({ ...current, effectiveOn: event.target.value }))} /></label>
            </div>
            <label className="block space-y-1.5 text-sm"><span>{text.reference}</span><Input maxLength={120} value={transferForm.reference} onChange={(event) => setTransferForm((current) => ({ ...current, reference: event.target.value }))} /></label>
            <label className="block space-y-1.5 text-sm"><span>{text.note}</span><Input maxLength={2000} value={transferForm.note} onChange={(event) => setTransferForm((current) => ({ ...current, note: event.target.value }))} /></label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>{text.cancel}</Button>
              <Button type="submit" disabled={transferBusy || Number(transferForm.amount) <= 0 || !transferForm.sourceAccountId || !transferForm.targetAccountId || transferForm.sourceAccountId === transferForm.targetAccountId}>{text.save}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reverseTransfer)} onOpenChange={(open) => { if (!open) setReverseTransfer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{text.transferReversalTitle}</DialogTitle>
            <DialogDescription>{text.transferReversalDescription}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleReverseTransfer}>
            {reverseTransferError ? <ShellBanner tone="error">{reverseTransferError}</ShellBanner> : null}
            {reverseTransfer ? (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {reverseTransfer.source_account_name}
                  <ArrowRight className="size-4 text-muted-foreground" />
                  {reverseTransfer.target_account_name}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{money(reverseTransfer.amount)}</div>
              </div>
            ) : null}
            <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" value={reverseTransferForm.effectiveOn} onChange={(event) => setReverseTransferForm((current) => ({ ...current, effectiveOn: event.target.value }))} /></label>
            <label className="block space-y-1.5 text-sm"><span>{text.reversalReason}</span><Input required maxLength={120} value={reverseTransferForm.reference} onChange={(event) => setReverseTransferForm((current) => ({ ...current, reference: event.target.value }))} /></label>
            <label className="block space-y-1.5 text-sm"><span>{text.note}</span><Input maxLength={2000} value={reverseTransferForm.note} onChange={(event) => setReverseTransferForm((current) => ({ ...current, note: event.target.value }))} /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setReverseTransfer(null)}>{text.cancel}</Button><Button type="submit" variant="destructive" disabled={reverseTransferBusy || !reverseTransferForm.reference.trim()}>{text.reverse}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{text.createTitle}</DialogTitle><DialogDescription>{text.createDescription}</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleCreate}>
            {createError ? <ShellBanner tone="error">{createError}</ShellBanner> : null}
            <label className="block space-y-1.5 text-sm"><span>{text.name}</span><Input required maxLength={120} value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm"><span>{text.type}</span><select className={shellSelectClassName} value={createForm.accountType} onChange={(event) => setCreateForm((current) => ({ ...current, accountType: event.target.value }))}><option value="bank">{text.bank}</option><option value="cash">{text.cash}</option><option value="card">{text.card}</option><option value="other">{text.other}</option></select></label>
              <label className="block space-y-1.5 text-sm"><span>{text.iban}</span><Input maxLength={64} value={createForm.iban} onChange={(event) => setCreateForm((current) => ({ ...current, iban: event.target.value }))} /></label>
              <label className="block space-y-1.5 text-sm"><span>{text.openingBalance}</span><Input required inputMode="decimal" value={createForm.openingBalance} onChange={(event) => setCreateForm((current) => ({ ...current, openingBalance: event.target.value }))} /></label>
              <label className="block space-y-1.5 text-sm"><span>{text.openingDate}</span><Input required type="date" value={createForm.openingBalanceOn} onChange={(event) => setCreateForm((current) => ({ ...current, openingBalanceOn: event.target.value }))} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createForm.isDefault} onChange={(event) => setCreateForm((current) => ({ ...current, isDefault: event.target.checked }))} />{text.defaultAccount}</label>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{text.cancel}</Button><Button type="submit" disabled={createBusy || !createForm.name.trim()}>{text.save}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(adjustAccount)} onOpenChange={(open) => { if (!open) setAdjustAccount(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{text.adjustmentTitle}</DialogTitle><DialogDescription>{adjustAccount?.name}</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleAdjustment}>
            {adjustError ? <ShellBanner tone="error">{adjustError}</ShellBanner> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm"><span>{text.direction}</span><select className={shellSelectClassName} value={adjustForm.direction} onChange={(event) => setAdjustForm((current) => ({ ...current, direction: event.target.value }))}><option value="inflow">{text.inflow}</option><option value="outflow">{text.outflow}</option></select></label>
              <label className="block space-y-1.5 text-sm"><span>{text.amount}</span><Input required inputMode="decimal" value={adjustForm.amount} onChange={(event) => setAdjustForm((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" value={adjustForm.effectiveOn} onChange={(event) => setAdjustForm((current) => ({ ...current, effectiveOn: event.target.value }))} /></label>
              <label className="block space-y-1.5 text-sm"><span>{text.reason}</span><Input required maxLength={500} value={adjustForm.reason} onChange={(event) => setAdjustForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            </div>
            <label className="block space-y-1.5 text-sm"><span>{text.note}</span><Input maxLength={2000} value={adjustForm.note} onChange={(event) => setAdjustForm((current) => ({ ...current, note: event.target.value }))} /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAdjustAccount(null)}>{text.cancel}</Button><Button type="submit" disabled={adjustBusy || Number(adjustForm.amount) <= 0 || !adjustForm.reason.trim()}>{text.save}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reverseAdjustment)} onOpenChange={(open) => { if (!open) setReverseAdjustment(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{text.reversalTitle}</DialogTitle><DialogDescription>{reverseAdjustment ? `${reverseAdjustment.account_name} · ${money(reverseAdjustment.amount)}` : ""}</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleReverse}>
            {reverseError ? <ShellBanner tone="error">{reverseError}</ShellBanner> : null}
            <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" value={reverseForm.effectiveOn} onChange={(event) => setReverseForm((current) => ({ ...current, effectiveOn: event.target.value }))} /></label>
            <label className="block space-y-1.5 text-sm"><span>{text.reversalReason}</span><Input required maxLength={500} value={reverseForm.reason} onChange={(event) => setReverseForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setReverseAdjustment(null)}>{text.cancel}</Button><Button type="submit" variant="destructive" disabled={reverseBusy || !reverseForm.reason.trim()}>{text.reverse}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
