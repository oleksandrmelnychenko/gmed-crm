import { useState, type FormEvent } from "react";
import { Banknote, Building2, CreditCard, Plus, RefreshCw, Undo2, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  reverseCompanyFinancialAccountAdjustment,
  updateCompanyFinancialAccount,
} from "./data";
import type {
  CompanyFinancialAccount,
  CompanyFinancialAccountAdjustment,
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
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {text.create}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {payload.items.map((account) => {
          const Icon = accountIcon(account.account_type);
          return (
            <article key={account.id} className={cn("rounded-xl border border-border/70 bg-card p-4 shadow-sm", !account.is_active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" />
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
              <p className="mt-4 text-xs text-muted-foreground">{text.currentBalance}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{money(account.current_balance)}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-3 text-xs">
                <div><dt className="text-muted-foreground">{text.opening}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.opening_balance)}</dd></div>
                <div><dt className="text-muted-foreground">{text.movements}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.movement_balance)}</dd></div>
                <div><dt className="text-muted-foreground">{text.corrections}</dt><dd className="mt-1 font-medium tabular-nums">{money(account.adjustment_balance)}</dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {formatDate(account.opening_balance_on, locale)} · {account.movement_count} {text.movementCount}
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

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/70 px-4 py-3 text-sm font-semibold">{text.history}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{text.date}</th>
                <th className="px-3 py-3 font-medium">{text.account}</th>
                <th className="px-3 py-3 font-medium">{text.operation}</th>
                <th className="px-3 py-3 font-medium">{text.reason}</th>
                <th className="px-3 py-3 font-medium">{text.author}</th>
                <th className="px-4 py-3 text-right font-medium">{text.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {payload.adjustments.length ? payload.adjustments.map((adjustment) => (
                <tr key={adjustment.id}>
                  <td className="px-4 py-3 tabular-nums">{formatDate(adjustment.effective_on, locale)}</td>
                  <td className="px-3 py-3">{adjustment.account_name}</td>
                  <td className="px-3 py-3">
                    <Badge variant="outline">{adjustment.transaction_type === "reversal" ? text.reverse : adjustment.direction === "inflow" ? text.inflow : text.outflow}</Badge>
                  </td>
                  <td className="max-w-[320px] px-3 py-3"><div className="truncate" title={adjustment.reason}>{adjustment.reason}</div></td>
                  <td className="px-3 py-3 text-muted-foreground">{adjustment.created_by_name}</td>
                  <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", adjustment.direction === "inflow" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                    {adjustment.direction === "inflow" ? "+" : "−"} {money(adjustment.amount)}
                    {adjustment.transaction_type === "adjustment" && !payload.adjustments.some((row) => row.reverses_adjustment_id === adjustment.id) ? (
                      <Button type="button" size="icon-xs" variant="ghost" className="ml-2" aria-label={text.reverse} onClick={() => {
                        setReverseError(null);
                        setReverseAdjustment(adjustment);
                      }}><Undo2 /></Button>
                    ) : null}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{text.noAdjustments}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
