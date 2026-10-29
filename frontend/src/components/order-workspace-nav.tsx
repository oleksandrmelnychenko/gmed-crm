import { ArrowLeft, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ORDER_WORKSPACE_SECTIONS,
  type OrderSectionGroup,
  type OrderSectionKey,
  orderSectionGroupLabel,
  orderSectionLabel,
  normalizeOrderSectionKey,
} from "@/pages/orders/sections";

/** The orders page announces the order it holds; the rail renders from it. */
export const ORDER_LOADED_EVENT = "gmed:order-loaded";
/** The rail asks the page for the order it already holds (after a remount). */
export const ORDER_NAV_REQUEST_EVENT = "gmed:order-nav-request";
/** A phase change the page applied, before its reload lands. */
export const ORDER_PHASE_CHANGED_EVENT = "gmed:order-phase-changed";

export type OrderLoadedDetail = {
  orderId: string;
  phase: string;
  /** A partial projection (interpreter, concierge): one fixed view. */
  partialRead: boolean;
};

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

export type OrderWorkspaceNavContext = {
  patient?: string | null;
  provider?: string | null;
  doctor?: string | null;
  taxonomy?: string | null;
};

export function OrderWorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const currentSection = normalizeOrderSectionKey(searchParams.get("section"));
  const [orderPhase, setOrderPhase] = useState<string | null>(null);
  const [partialRead, setPartialRead] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setOrderPhase(null);
    setPartialRead(false);

    const handleLoaded = (event: Event) => {
      const detail = (event as CustomEvent<OrderLoadedDetail>).detail;
      if (detail?.orderId !== orderId) return;
      setOrderPhase(detail.phase);
      setPartialRead(detail.partialRead);
    };
    const handlePhaseChange = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: string; phase?: string }>).detail;
      if (detail?.orderId === orderId && detail.phase) {
        setOrderPhase(detail.phase);
      }
    };
    window.addEventListener(ORDER_LOADED_EVENT, handleLoaded);
    window.addEventListener(ORDER_PHASE_CHANGED_EVENT, handlePhaseChange);
    // The page may already hold this order (back/forward navigation); it
    // answers with another "loaded" event.
    window.dispatchEvent(
      new CustomEvent(ORDER_NAV_REQUEST_EVENT, { detail: { orderId } }),
    );

    return () => {
      window.removeEventListener(ORDER_LOADED_EVENT, handleLoaded);
      window.removeEventListener(ORDER_PHASE_CHANGED_EVENT, handlePhaseChange);
    };
  }, [orderId]);

  if (!orderId) return null;

  return (
    <OrderWorkspaceNavView
      orderId={orderId}
      mobile={mobile}
      currentSection={currentSection}
      context={{
        patient: searchParams.get("patient"),
        provider: searchParams.get("provider"),
        doctor: searchParams.get("doctor"),
        taxonomy: searchParams.get("taxonomy"),
      }}
      orderPhase={orderPhase}
      partialRead={partialRead}
    />
  );
}

export function OrderWorkspaceNavView({
  orderId,
  mobile = false,
  currentSection,
  context,
  orderPhase,
  partialRead,
}: {
  orderId: string;
  mobile?: boolean;
  currentSection: OrderSectionKey;
  context: OrderWorkspaceNavContext;
  orderPhase: string | null;
  partialRead: boolean;
}) {
  const { t, lang } = useLang();
  const mobileStripRef = useRef<HTMLDivElement>(null);

  // The mobile strip scrolls sideways; centre the active chip in it. Only the
  // strip scrolls (not the page, which scrollIntoView would also move). The
  // chips widen as the web fonts arrive and the strip narrows once the page
  // grows a scrollbar, so follow both sizes.
  useEffect(() => {
    if (!mobile) return;
    const strip = mobileStripRef.current;
    const chip = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!strip || !chip) return;
    const reveal = () => {
      const stripRect = strip.getBoundingClientRect();
      const chipRect = chip.getBoundingClientRect();
      strip.scrollLeft +=
        chipRect.left - stripRect.left - (strip.clientWidth - chipRect.width) / 2;
    };
    reveal();
    // Font subsets arrive one by one; a background tab delivers no resize
    // notifications, so also realign when the fonts settle and once later.
    let active = true;
    const revealIfActive = () => {
      if (active) reveal();
    };
    void document.fonts?.ready.then(revealIfActive);
    const timer = window.setTimeout(revealIfActive, 2000);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(revealIfActive);
    observer?.observe(strip);
    strip.querySelectorAll("a").forEach((item) => observer?.observe(item));
    return () => {
      active = false;
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [mobile, currentSection]);

  function buildSectionLink(sectionKey: string) {
    const params = new URLSearchParams();
    if (context.patient) params.set("patient", context.patient);
    if (context.provider) params.set("provider", context.provider);
    if (context.doctor) params.set("doctor", context.doctor);
    if (context.taxonomy) params.set("taxonomy", context.taxonomy);
    if (sectionKey !== "overview") params.set("section", sectionKey);
    const query = params.toString();
    return query ? `/orders/${orderId}?${query}` : `/orders/${orderId}`;
  }

  const backHref = context.patient
    ? `/patients/${context.patient}?tab=orders`
    : "/orders";
  const backLabel = context.patient ? t.patients_col_patient : t.orders_title;

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
        <div ref={mobileStripRef} className="flex gap-1 overflow-x-auto pb-1">
          {groupedSections.flatMap(group => group.items).map(item => {
            const isActive = currentSection === item.key;
            const lockedPhase = notReachedPhase(item.key);
            return (
              <StaffLink
                key={item.key}
                replace
                to={buildSectionLink(item.key)}
                aria-current={isActive ? "page" : undefined}
                title={lockedPhase ? notReachedTitle(lockedPhase) : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                  lockedPhase && !isActive && "opacity-60",
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
      className="hidden lg:my-4 lg:ml-4 lg:mr-2 lg:flex lg:w-56 xl:w-64 2xl:w-72 min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="px-5 pt-5">
        <StaffLink
          to={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </StaffLink>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
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
