import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { uiText, type Lang } from "@/lib/i18n";

export type OrderSectionKey =
  | "overview"
  | "gates"
  | "planning"
  | "execution"
  | "followup"
  | "phase"
  | "workflow"
  | "services"
  | "invoices";

export type OrderSectionGroup = "context" | "workflow" | "commercial";

export type OrderSectionDefinition = {
  key: OrderSectionKey;
  group: OrderSectionGroup;
  icon: LucideIcon;
  labelKey: string;
};

export const ORDER_WORKSPACE_SECTIONS: readonly OrderSectionDefinition[] = [
  {
    key: "overview",
    group: "context",
    icon: FileText,
    labelKey: "orders_section_overview",
  },
  {
    key: "gates",
    group: "workflow",
    icon: ShieldCheck,
    labelKey: "orders_section_gates",
  },
  {
    key: "planning",
    group: "workflow",
    icon: CalendarClock,
    labelKey: "orders_section_planning",
  },
  {
    key: "execution",
    group: "workflow",
    icon: Activity,
    labelKey: "orders_section_execution",
  },
  {
    key: "followup",
    group: "workflow",
    icon: RefreshCw,
    labelKey: "orders_section_followup",
  },
  {
    key: "phase",
    group: "workflow",
    icon: CheckCircle2,
    labelKey: "orders_section_phase",
  },
  {
    key: "workflow",
    group: "workflow",
    icon: ClipboardList,
    labelKey: "orders_section_workflow",
  },
  {
    key: "services",
    group: "commercial",
    icon: Wallet,
    labelKey: "orders_section_services",
  },
  {
    key: "invoices",
    group: "commercial",
    icon: ReceiptText,
    labelKey: "orders_section_invoices",
  },
];

const ORDER_SECTION_KEYS = new Set<OrderSectionKey>(
  ORDER_WORKSPACE_SECTIONS.map((item) => item.key),
);

export const DEFAULT_ORDER_SECTION: OrderSectionKey = "overview";

export function normalizeOrderSectionKey(
  value: string | null | undefined,
): OrderSectionKey {
  if (value && ORDER_SECTION_KEYS.has(value as OrderSectionKey)) {
    return value as OrderSectionKey;
  }
  return DEFAULT_ORDER_SECTION;
}

export function orderSectionLabel(
  section: OrderSectionDefinition,
  lang: Lang,
): string {
  return uiText(section.labelKey, lang);
}

export function orderSectionGroupLabel(
  group: OrderSectionGroup,
  lang: Lang,
): string {
  if (group === "context") {
    return uiText("orders_section_group_context", lang);
  }
  if (group === "workflow") {
    return uiText("orders_section_group_workflow", lang);
  }
  return uiText("orders_section_group_commercial", lang);
}
