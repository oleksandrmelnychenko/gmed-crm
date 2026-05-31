export type InterpreterListFilters = {
  search?: string;
  status?: string;
  contractType?: string;
};

export function buildInterpreterListPath(filters: InterpreterListFilters = {}) {
  const params = new URLSearchParams();
  const search = filters.search?.trim();
  if (search) params.set("search", search);
  if (filters.status) params.set("status", filters.status);
  if (filters.contractType) {
    params.set("contract_type", filters.contractType);
  }

  const query = params.toString();
  return `/interpreters${query ? `?${query}` : ""}`;
}
