import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DatevActionButton } from "./action-button";
import { downloadDatevResult, type ReadResult } from "./live-api";
import { operationDescription } from "./operation-text";
import { liveDe, liveRu } from "./live-text";

const labels: Record<string, [string, string]> = {
  id: ["Идентификатор", "Kennung"], name: ["Название", "Name"], caption: ["Наименование", "Bezeichnung"],
  accountNumber: ["Номер счёта", "Kontonummer"], balance: ["Остаток", "Saldo"],
  balanceDebitCreditIdentifier: ["Сторона остатка", "Soll-/Haben-Kennzeichen"],
  annualValueDebit: ["Оборот за год · дебет", "Jahresverkehrszahl Soll"], annualValueCredit: ["Оборот за год · кредит", "Jahresverkehrszahl Haben"],
  openingBalanceDebit: ["Начальный остаток · дебет", "Eröffnungsbilanzwert Soll"], openingBalanceCredit: ["Начальный остаток · кредит", "Eröffnungsbilanzwert Haben"],
  sumsAndBalancesMonthValues: ["Данные по месяцам", "Monatswerte"], month: ["Месяц", "Monat"],
  startDate: ["Начало периода", "Beginn"], endDate: ["Конец периода", "Ende"], currency: ["Валюта", "Währung"],
};
export function DatevReadResult({ result, disabled, de }: { result: ReadResult; disabled: boolean; de: boolean }) {
  const t = de ? liveDe : liveRu;
  const [page, setPage] = useState(0); const size = 20;
  const pages = Math.max(1, Math.ceil(result.records.length / size));
  const kind = { "fiscal-years": t.fiscal, "terms-of-payment": t.terms, "sums-and-balances": t.balances }[result.kind];
  const retrieved = new Date(result.retrieved_at).toLocaleString(de ? "de-DE" : "ru-RU");
  const field = (key: string) => labels[key]?.[de ? 1 : 0] ?? key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const value = (item: unknown): string => item == null ? "—" : typeof item === "boolean" ? item ? de ? "Ja" : "Да" : de ? "Nein" : "Нет" : typeof item === "object" ? JSON.stringify(item, null, 2) : String(item);
  return <div className="min-w-0 space-y-3" data-testid="datev-read-result">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><p className="break-words text-sm font-medium">{result.company} <Badge variant="outline">{result.mode === "production" ? "Production" : "Sandbox"}</Badge></p><p className="text-xs text-muted-foreground">Beraternummer: {result.consultant_number} · Mandantennummer: {result.client_number}</p><p className="text-xs text-muted-foreground">{kind} · {retrieved}{result.fiscal_year ? ` · ${result.fiscal_year}` : ""}</p></div>
      <DatevActionButton title={t.download} description={operationDescription("download", de)} size="sm" disabled={disabled} contextKey={result.retrieved_at} context={<><p>{result.company} · {result.mode}</p><p>{kind} · {result.records.length} · {retrieved}</p></>} onConfirm={() => downloadDatevResult(result)}><Download className="size-4" />{t.download}</DatevActionButton>
    </div>
    <p className="text-sm">{result.records.length ? `${t.count}: ${result.records.length}` : t.empty}</p>
    <div className="space-y-2">{result.records.slice(page * size, (page + 1) * size).map((record, index) => <details key={page * size + index} className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer break-words text-sm font-medium">{String(record.caption ?? record.name ?? record.accountNumber ?? record.id ?? `${t.details} ${page * size + index + 1}`)}</summary>
      <dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-2">{Object.entries(record).map(([key, item]) => <div key={key} className="min-w-0"><dt className="font-medium">{field(key)}</dt><dd className="mt-1 break-all whitespace-pre-wrap text-muted-foreground">{value(item)}</dd></div>)}</dl>
    </details>)}</div>
    {pages > 1 ? <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={de ? "Ergebnisseiten" : "Страницы результата"}><Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>{de ? "Zurück" : "Назад"}</Button><span className="text-xs">{page + 1} / {pages}</span><Button type="button" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((n) => n + 1)}>{de ? "Weiter" : "Далее"}</Button></nav> : null}
  </div>;
}
