import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIntakeDate } from "@/pages/orders/model/order-intake";
import type { PreviousRequest } from "../model/use-previous-requests";

const COLLAPSED_COUNT = 3;

/**
 * Earlier reasons of a returning patient above the reason field. "Take" copies
 * the text into the field; the manager still confirms or edits it, so every
 * request keeps its own documented reason.
 */
export function PreviousRequestsPanel({ requests, currentConcern, tx, specialtyLabel, onUse }: {
  requests: PreviousRequest[];
  currentConcern: string;
  tx: (ru: string, de: string) => string;
  specialtyLabel: (value: string) => string;
  onUse: (concern: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!requests.length) return null;
  const visible = expanded ? requests : requests.slice(0, COLLAPSED_COUNT);
  const current = currentConcern.trim();
  return (
    <div role="region" aria-label={tx("Предыдущие обращения", "Frühere Anfragen")} data-testid="previous-requests" className="mb-3 rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <History aria-hidden="true" className="size-3.5" />
        {tx("Предыдущие обращения", "Frühere Anfragen")}
      </div>
      <ul className="divide-y">
        {visible.map((request) => {
          const concern = request.concern?.trim() ?? "";
          const period = request.date_from || request.date_to
            ? `${formatIntakeDate(request.date_from)} – ${formatIntakeDate(request.date_to)}`
            : null;
          const meta = [
            formatIntakeDate(request.created_at),
            request.order_number,
            period,
            request.specialties.map(specialtyLabel).join(", ") || null,
          ].filter(Boolean).join(" · ");
          const inUse = concern === current;
          return (
            <li key={request.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] text-muted-foreground">{meta}</p>
                <p className="whitespace-pre-line break-words text-sm">{concern}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={inUse}
                aria-label={`${tx("Взять причину обращения от", "Anliegen übernehmen vom")} ${formatIntakeDate(request.created_at)}`}
                onClick={() => onUse(concern)}
              >
                {inUse ? tx("Уже в поле", "Übernommen") : tx("Взять", "Übernehmen")}
              </Button>
            </li>
          );
        })}
      </ul>
      {requests.length > COLLAPSED_COUNT ? (
        <div className="border-t px-3 py-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? tx("Свернуть", "Weniger anzeigen") : tx(`Показать все (${requests.length})`, `Alle anzeigen (${requests.length})`)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
