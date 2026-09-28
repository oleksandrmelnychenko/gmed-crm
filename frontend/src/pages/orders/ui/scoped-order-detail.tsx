import { CheckCircle2, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui-shell";
import { t as translationsFor, type Lang } from "@/lib/i18n";

import { orderPhaseTone, orderStatusTone } from "../appearance/status-appearance";
import {
  canDeliverScopedLine,
  scopedLineName,
  scopedLineQuantity,
} from "../model/scoped-order-lines";
import type { OrderDetail } from "../model/types";

type ScopedOrderDetailProps = {
  detail: OrderDetail;
  lang: Lang;
  subjectName: string;
  phaseLabel: (value: string) => string;
  statusLabel: (value: string) => string;
  lineStatusLabel: (value: string) => string;
  formatDate: (value: string | null | undefined) => string;
  /** Role of the viewer; only a concierge records its service lines as delivered. */
  viewerRole?: string | null;
  /** Records a service line as delivered; the page reloads the order afterwards. */
  onDeliverLine?: (lineId: string) => void;
  deliveringLineId?: string | null;
  error?: string | null;
};

const copy = {
  de: {
    order: "Auftrag",
    period: "Zeitraum",
    phase: "Phase",
    services: "Leistungen",
    provider: "Anbieter",
    quantity: "Menge",
    status: "Status",
    delivered: "Erbracht",
    markDelivered: "Als erbracht markieren",
    empty: "In diesem Auftrag gibt es keine Leistungen aus Ihrem Bereich.",
    concierge_services:
      "Nur Ansicht: Sie sehen den Zeitraum, den Status und die Service- und Logistikleistungen dieses Auftrags. Medizinische Leistungen, Preise, Notizen und Finanzdaten sind ausgeblendet.",
    interpreter_team:
      "Nur Ansicht: Sie sehen den Zeitraum, den Status und die Dolmetscherleistungen dieses Auftrags. Medizinische Leistungen, Preise, Notizen und Finanzdaten sind ausgeblendet.",
  },
  ru: {
    order: "Заказ",
    period: "Период",
    phase: "Фаза",
    services: "Услуги",
    provider: "Провайдер",
    quantity: "Кол-во",
    status: "Статус",
    delivered: "Оказано",
    markDelivered: "Отметить как оказанную",
    empty: "В этом заказе нет услуг из вашей зоны ответственности.",
    concierge_services:
      "Только просмотр: вы видите период, статус и сервисные и логистические услуги заказа. Медицинские услуги, цены, заметки и финансы скрыты.",
    interpreter_team:
      "Только просмотр: вы видите период, статус и услуги переводчиков по заказу. Медицинские услуги, цены, заметки и финансы скрыты.",
  },
} as const;

/**
 * Read-only order view for the roles that see only their part of an order
 * (concierge: service lines, interpreter team lead: interpreter lines). The
 * server already reduced the payload; this view renders nothing else. The
 * only action is the concierge recording a service line as delivered.
 */
export function ScopedOrderDetail({
  detail,
  lang,
  subjectName,
  phaseLabel,
  statusLabel,
  lineStatusLabel,
  formatDate,
  viewerRole,
  onDeliverLine,
  deliveringLineId,
  error,
}: ScopedOrderDetailProps) {
  const labels = copy[lang];
  const translations = translationsFor(lang);
  const scopeHint =
    detail.read_scope === "interpreter_team" ? labels.interpreter_team : labels.concierge_services;

  return (
    <div className="min-w-0 space-y-4 rounded-xl" data-testid="scoped-order-detail">
      <p
        role="note"
        className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        {scopeHint}
      </p>
      <section className="rounded-xl border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {labels.order}
          </span>
          <span className="font-mono text-xs font-medium text-foreground">{detail.order_number}</span>
          <StatusBadge tone={orderStatusTone(detail.status)}>{statusLabel(detail.status)}</StatusBadge>
        </div>
        <h1 className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {subjectName}
        </h1>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
            <dt className="text-[11px] font-medium text-muted-foreground">{labels.period}</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {formatDate(detail.date_from)} – {formatDate(detail.date_to)}
            </dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
            <dt className="text-[11px] font-medium text-muted-foreground">{labels.phase}</dt>
            <dd className="mt-1">
              <StatusBadge tone={orderPhaseTone(detail.phase)}>{phaseLabel(detail.phase)}</StatusBadge>
            </dd>
          </div>
        </dl>
      </section>
      <section className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <h2 className="border-b border-border/70 bg-muted/20 px-4 py-2.5 text-[13px] font-semibold tracking-tight">
          {labels.services}
        </h2>
        {detail.leistungen.length === 0 ? (
          <p className="p-5 text-center text-xs text-muted-foreground">{labels.empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{labels.services}</th>
                <th className="px-4 py-2 font-medium">{labels.provider}</th>
                <th className="px-4 py-2 font-medium">{labels.quantity}</th>
                <th className="px-4 py-2 font-medium">{labels.status}</th>
                <th className="px-4 py-2 font-medium">{labels.delivered}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {detail.leistungen.map((line) => {
                const deliverable =
                  Boolean(onDeliverLine) && canDeliverScopedLine(detail, line, viewerRole);
                const delivering = deliveringLineId === line.id;
                return (
                  <tr key={line.id}>
                    <td className="px-4 py-2">{scopedLineName(line, translations)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{line.provider_name ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">
                      {scopedLineQuantity(line, translations)}
                    </td>
                    <td className="px-4 py-2">{lineStatusLabel(line.status)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {deliverable ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-md px-2 text-xs"
                          disabled={Boolean(deliveringLineId)}
                          onClick={() => onDeliverLine?.(line.id)}
                        >
                          {delivering ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          {labels.markDelivered}
                        </Button>
                      ) : (
                        formatDate(line.delivered_at)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
