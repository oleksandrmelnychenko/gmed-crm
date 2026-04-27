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
  labels: { de: string; ru: string };
};

export const ORDER_WORKSPACE_SECTIONS: readonly OrderSectionDefinition[] = [
  {
    key: "overview",
    group: "context",
    icon: FileText,
    labels: { de: "Ubersicht", ru: "Обзор" },
  },
  {
    key: "gates",
    group: "workflow",
    icon: ShieldCheck,
    labels: { de: "Gates", ru: "Гейты" },
  },
  {
    key: "planning",
    group: "workflow",
    icon: CalendarClock,
    labels: { de: "Planung", ru: "Планирование" },
  },
  {
    key: "execution",
    group: "workflow",
    icon: Activity,
    labels: { de: "Durchfuhrung", ru: "Исполнение" },
  },
  {
    key: "followup",
    group: "workflow",
    icon: RefreshCw,
    labels: { de: "Nachsorge", ru: "Наблюдение" },
  },
  {
    key: "phase",
    group: "workflow",
    icon: CheckCircle2,
    labels: { de: "Phase", ru: "Фаза" },
  },
  {
    key: "workflow",
    group: "workflow",
    icon: ClipboardList,
    labels: { de: "Checkliste", ru: "Чеклист" },
  },
  {
    key: "services",
    group: "commercial",
    icon: Wallet,
    labels: { de: "Leistungen", ru: "Услуги" },
  },
  {
    key: "invoices",
    group: "commercial",
    icon: ReceiptText,
    labels: { de: "Rechnungen", ru: "Счета" },
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
  lang: string,
): string {
  return lang === "de" ? section.labels.de : section.labels.ru;
}

export function orderSectionGroupLabel(
  group: OrderSectionGroup,
  lang: string,
): string {
  if (group === "context") {
    return lang === "de" ? "Kontext" : "Контекст";
  }
  if (group === "workflow") {
    return lang === "de" ? "Workflow" : "Workflow";
  }
  return lang === "de" ? "Finanzen" : "Финансы";
}
