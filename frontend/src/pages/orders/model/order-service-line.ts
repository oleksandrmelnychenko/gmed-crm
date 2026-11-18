import type { ServiceDescriptionItem } from "@/lib/service-description";
export type ServiceLine = {
  id: string;
  agencyServiceId: string | null;
  agencyServicePriceVersionId: string | null;
  clientReference: string | null;
  managedByWizard?: boolean;
  isCostPassthrough?: boolean;
  description: string;
  catalogDescription: string;
  catalogDescriptionItems?: ServiceDescriptionItem[];
  catalogUnitLabel: string;
  currency: string;
  quantity: string;
  price: string;
  vat: string;
  /** Discount in percent as typed ("" or "0" is none; owner 2026-11-18). */
  discount?: string;
};
