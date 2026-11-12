import { StaffLink } from "@/components/staff-link";
import type { Lang } from "@/lib/i18n";
import { conciergeSalesView } from "../model/order-concierge-sales";
import type { OrderEconomics } from "../model/types";

/**
 * Concierge sale prices of the order (owner 2026-11-12, decision 7): a short
 * line under «Ещё не выставлено счётом» and the services behind it. Only a
 * service billed by an issued invoice line is in the order totals (F-C8);
 * the note says which.
 */
export function OrderConciergeSales({ economics, lang, formatMoney }: {
  economics: OrderEconomics;
  lang: Lang;
  formatMoney: (value: unknown, currency: string) => string;
}) {
  const view = conciergeSalesView(economics.concierge_sales, formatMoney, economics.currency, lang);
  if (!view) return null;
  const de = lang === "de";
  return (
    <details className="group text-xs text-muted-foreground" data-testid="order-concierge-sales">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span>{view.summary}</span>{" "}
        <span className="underline decoration-dotted underline-offset-2 group-open:hidden">
          {de ? "Details" : "Подробнее"}
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <p>{view.note}</p>
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {view.rows.map((row) => (
            <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <StaffLink className="min-w-0 truncate font-medium text-foreground hover:text-primary hover:underline" title={row.title} to={row.href}>{row.title}</StaffLink>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{row.date}</span>
                <span>{row.state}{row.outsideTotals ? (de ? " · andere Währung" : " · другая валюта") : ""}</span>
                <span className="font-mono tabular-nums text-foreground">{row.salePrice}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
