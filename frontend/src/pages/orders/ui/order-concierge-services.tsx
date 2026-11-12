import { useEffect, useState } from "react";

import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { PortalDateChip } from "@/components/ui/portal-date-chip";
import { apiFetch } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import {
  isSecuredConciergeService,
  orderConciergeServices,
  type OrderConciergeService,
} from "@/pages/orders/model/order-concierge-services";

const STATUS_LABELS: Record<string, { ru: string; de: string }> = {
  planned: { ru: "Запланировано", de: "Geplant" },
  booked: { ru: "Забронировано", de: "Gebucht" },
  confirmed: { ru: "Подтверждено", de: "Bestätigt" },
  in_service: { ru: "Выполняется", de: "In Durchführung" },
  completed: { ru: "Завершено", de: "Abgeschlossen" },
  cancelled: { ru: "Отменено", de: "Storniert" },
};

const COPY = {
  ru: {
    title: "Консьерж-сервисы заказа",
    empty: "К заказу не привязаны консьерж-сервисы.",
    confirmed: (done: number, total: number) => `${done} из ${total} подтверждено или выполнено`,
  },
  de: {
    title: "Concierge-Services des Auftrags",
    empty: "Mit dem Auftrag sind keine Concierge-Services verknüpft.",
    confirmed: (done: number, total: number) => `${done} von ${total} bestätigt oder erledigt`,
  },
} as const;

/**
 * The concierge bookings linked to an order (concierge QA 2026-11-12 D-13 /
 * B S3-1): the PM sees which transfer, hotel or table belongs to the order
 * and how far it is, next to «Немедицинское исполнение».
 */
export function OrderConciergeServicesList({
  orderId,
  patientId,
  lang,
}: {
  orderId: string;
  patientId: string | null;
  lang: Lang;
}) {
  const copy = COPY[lang === "de" ? "de" : "ru"];
  const [services, setServices] = useState<OrderConciergeService[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!patientId) {
      setServices([]);
      return () => {
        cancelled = true;
      };
    }
    setFailed(false);
    apiFetch<OrderConciergeService[]>(
      `/concierge-services?patient_id=${encodeURIComponent(patientId)}`,
    )
      .then((rows) => {
        if (!cancelled) setServices(orderConciergeServices(Array.isArray(rows) ? rows : [], orderId));
      })
      .catch(() => {
        if (!cancelled) {
          setServices([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, patientId]);

  // A role without the services page (the server refuses the list) sees nothing here.
  if (services === null || failed) return null;
  const active = services.filter((service) => service.status !== "cancelled");

  return (
    <div className="md:col-span-2" data-testid="order-concierge-services">
      <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
        <span className="text-sm text-muted-foreground">{copy.title}</span>
        {active.length > 0 ? (
          <span className="text-sm font-semibold text-foreground">
            {copy.confirmed(active.filter(isSecuredConciergeService).length, active.length)}
          </span>
        ) : null}
      </div>
      {services.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
          {services.map((service) => (
            <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <StaffLink
                to={`/services?service=${encodeURIComponent(service.id)}`}
                className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {service.title_redacted ? "—" : service.title}
              </StaffLink>
              <span className="flex flex-wrap items-center gap-2">
                {service.starts_at ? <PortalDateChip timestamp={service.starts_at} /> : null}
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {STATUS_LABELS[service.status]?.[lang === "de" ? "de" : "ru"] ?? service.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
