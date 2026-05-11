import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ORDER_WORKSPACE_SECTIONS,
  type OrderSectionGroup,
  orderSectionGroupLabel,
  orderSectionLabel,
  normalizeOrderSectionKey,
} from "@/pages/orders/sections";

const GROUP_ORDER: readonly OrderSectionGroup[] = [
  "context",
  "workflow",
  "commercial",
];

export function OrderWorkspaceNav() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const { t, lang } = useLang();
  const currentSection = normalizeOrderSectionKey(searchParams.get("section"));
  const patientContext = searchParams.get("patient");
  const providerContext = searchParams.get("provider");
  const doctorContext = searchParams.get("doctor");

  if (!orderId) return null;

  function buildSectionLink(sectionKey: string) {
    const params = new URLSearchParams();
    if (patientContext) params.set("patient", patientContext);
    if (providerContext) params.set("provider", providerContext);
    if (doctorContext) params.set("doctor", doctorContext);
    if (sectionKey !== "overview") params.set("section", sectionKey);
    const query = params.toString();
    return query ? `/orders/${orderId}?${query}` : `/orders/${orderId}`;
  }

  const backHref = patientContext ? `/patients/${patientContext}?tab=orders` : "/orders";
  const backLabel = patientContext ? t.patients_col_patient : t.orders_title;

  const groupedSections = GROUP_ORDER.reduce<Array<{
    group: OrderSectionGroup;
    items: Array<(typeof ORDER_WORKSPACE_SECTIONS)[number]>;
  }>>((acc, group) => {
    const items = ORDER_WORKSPACE_SECTIONS.filter((item) => item.group === group);
    if (items.length > 0) {
      acc.push({ group, items });
    }
    return acc;
  }, []);

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
                const Icon = item.icon;
                const to = buildSectionLink(item.key);
                return (
                  <StaffLink
                    key={item.key}
                    replace
                    to={to}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 h-10 text-sm transition-colors",
                      isActive
                        ? "bg-muted/60 text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
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
                    <span className="truncate font-medium leading-5">
                      {orderSectionLabel(item, lang)}
                    </span>
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
