import { ArrowLeft, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { isPartialOrderRead } from "@/pages/orders/model/order-model";
import type { OrderDetail } from "@/pages/orders/model/types";
import {
  ORDER_WORKSPACE_SECTIONS,
  type OrderSectionGroup,
  type OrderSectionKey,
  orderSectionGroupLabel,
  orderSectionLabel,
  normalizeOrderSectionKey,
} from "@/pages/orders/sections";

const GROUP_ORDER: readonly OrderSectionGroup[] = [
  "context",
  "workflow",
  "commercial",
];

const ORDER_PHASE_ORDER = [
  "discovery",
  "intake",
  "execution",
  "closure",
  "followup",
] as const;

type OrderPhase = (typeof ORDER_PHASE_ORDER)[number];

const PHASE_LABEL_KEY: Record<OrderPhase, string> = {
  discovery: "orders_bedarfsklarung",
  intake: "orders_aufnahme",
  execution: "orders_durchfuhrung",
  closure: "orders_abschluss",
  followup: "orders_nachsorge",
};

// Sections whose work starts in a later phase. They stay in the rail so the
// menu keeps its shape, marked as not reached until the order gets there.
const SECTION_PHASE: Partial<Record<OrderSectionKey, OrderPhase>> = {
  planning: "intake",
  execution: "execution",
  followup: "closure",
};

export function OrderWorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const { t, lang } = useLang();
  const currentSection = normalizeOrderSectionKey(searchParams.get("section"));
  const patientContext = searchParams.get("patient");
  const providerContext = searchParams.get("provider");
  const doctorContext = searchParams.get("doctor");
  const taxonomyContext = searchParams.get("taxonomy");
  const [orderPhase, setOrderPhase] = useState<string | null>(null);
  const [partialRead, setPartialRead] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    let active = true;

    void apiFetch<OrderDetail>(`/orders/${orderId}`)
      .then((order) => {
        if (!active) return;
        setOrderPhase(order.phase);
        setPartialRead(isPartialOrderRead(order));
      })
      .catch(() => {
        if (!active) return;
        setOrderPhase(null);
        setPartialRead(false);
      });

    const handlePhaseChange = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: string; phase?: string }>).detail;
      if (detail?.orderId === orderId && detail.phase) {
        setOrderPhase(detail.phase);
      }
    };
    window.addEventListener("gmed:order-phase-changed", handlePhaseChange);

    return () => {
      active = false;
      window.removeEventListener("gmed:order-phase-changed", handlePhaseChange);
    };
  }, [orderId]);

  if (!orderId) return null;

  function buildSectionLink(sectionKey: string) {
    const params = new URLSearchParams();
    if (patientContext) params.set("patient", patientContext);
    if (providerContext) params.set("provider", providerContext);
    if (doctorContext) params.set("doctor", doctorContext);
    if (taxonomyContext) params.set("taxonomy", taxonomyContext);
    if (sectionKey !== "overview") params.set("section", sectionKey);
    const query = params.toString();
    return query ? `/orders/${orderId}?${query}` : `/orders/${orderId}`;
  }

  const backHref = patientContext ? `/patients/${patientContext}?tab=orders` : "/orders";
  const backLabel = patientContext ? t.patients_col_patient : t.orders_title;

  const phaseIndex = orderPhase
    ? ORDER_PHASE_ORDER.indexOf(orderPhase as OrderPhase)
    : -1;
  const phaseTitle = (phase: OrderPhase) => t.uiText[PHASE_LABEL_KEY[phase]] ?? phase;
  // A section is reached once the order is in its phase or past it; an
  // unknown phase keeps every section open.
  const notReachedPhase = (sectionKey: OrderSectionKey): OrderPhase | null => {
    const phase = SECTION_PHASE[sectionKey];
    if (!phase || phaseIndex < 0) return null;
    return phaseIndex >= ORDER_PHASE_ORDER.indexOf(phase) ? null : phase;
  };
  const notReachedTitle = (phase: OrderPhase) =>
    lang === "de"
      ? `Öffnet sich in der Phase „${phaseTitle(phase)}“`
      : `Откроется на этапе «${phaseTitle(phase)}»`;

  // A partial projection (interpreter, concierge) is one fixed view; the
  // other sections would all show the same thing.
  const sections = partialRead
    ? ORDER_WORKSPACE_SECTIONS.filter((item) => item.key === "overview")
    : ORDER_WORKSPACE_SECTIONS;

  const groupedSections = GROUP_ORDER.reduce<Array<{
    group: OrderSectionGroup;
    items: Array<(typeof ORDER_WORKSPACE_SECTIONS)[number]>;
  }>>((acc, group) => {
    const items = sections.filter((item) => item.group === group);
    if (items.length > 0) {
      acc.push({ group, items });
    }
    return acc;
  }, []);

  if (mobile) {
    return (
      <nav aria-label={t.orders_title} data-workspace-rail="order-mobile" className="mb-3 min-w-0 rounded-lg border border-border/70 bg-card p-2 lg:hidden">
        <StaffLink to={backHref} className="mb-2 inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <ArrowLeft aria-hidden className="size-3.5" />{backLabel}
        </StaffLink>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {groupedSections.flatMap(group => group.items).map(item => {
            const lockedPhase = notReachedPhase(item.key);
            return (
              <StaffLink
                key={item.key}
                replace
                to={buildSectionLink(item.key)}
                aria-current={currentSection === item.key ? "page" : undefined}
                title={lockedPhase ? notReachedTitle(lockedPhase) : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium",
                  currentSection === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                  lockedPhase && currentSection !== item.key && "opacity-60",
                )}
              >
                {orderSectionLabel(item, lang)}
                {lockedPhase ? <Lock aria-hidden className="size-3" /> : null}
              </StaffLink>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <aside
      data-workspace-rail="order"
      className="hidden lg:flex lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="px-4 pt-4">
        <StaffLink
          to={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groupedSections.map(({ group, items }, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-4")}>
            {groupIndex > 0 ? (
              <div className="mx-3 mb-2 h-px bg-border/60" aria-hidden />
            ) : null}
            <div className="px-3 pb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {orderSectionGroupLabel(group, lang)}
              </span>
            </div>
            <div className="space-y-1">
              {items.map((item) => {
                const isActive = currentSection === item.key;
                const lockedPhase = notReachedPhase(item.key);
                const Icon = item.icon;
                const to = buildSectionLink(item.key);
                return (
                  <StaffLink
                    key={item.key}
                    replace
                    to={to}
                    aria-current={isActive ? "page" : undefined}
                    title={lockedPhase ? notReachedTitle(lockedPhase) : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 h-10 text-sm transition-colors",
                      isActive
                        ? "bg-muted/60 text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      lockedPhase && !isActive && "opacity-60",
                    )}
                  >
                    <Icon
                      className={cn(
                        "shrink-0 size-[18px] transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      strokeWidth={isActive ? 1.85 : 1.7}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium leading-5">
                      {orderSectionLabel(item, lang)}
                    </span>
                    {lockedPhase ? (
                      <Lock aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
                    ) : null}
                  </StaffLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
