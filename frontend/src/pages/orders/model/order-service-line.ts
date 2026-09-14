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
};
