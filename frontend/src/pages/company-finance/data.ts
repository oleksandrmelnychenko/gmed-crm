import { apiFetch } from "@/lib/api";

import type {
  CompanyFinancialFilters,
  CompanyFinancialPosition,
} from "./types";

export function buildCompanyFinancialPositionPath(filters: CompanyFinancialFilters) {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.movement !== "all") params.set("movement", filters.movement);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return `/company-financial-position?${params.toString()}`;
}

export function fetchCompanyFinancialPosition(
  filters: CompanyFinancialFilters,
  forceFresh = false,
) {
  return apiFetch<CompanyFinancialPosition>(buildCompanyFinancialPositionPath(filters), {
    forceFresh,
  });
}
