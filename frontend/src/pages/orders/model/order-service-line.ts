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
  /** The position's tax profile (owner 2026-11-19); empty: the server takes the catalogue's. */
  taxProfileId?: string | null;
  /** Its name as the server stored it, for the pill. */
  taxProfileName?: string | null;
};
