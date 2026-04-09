import { get } from "./client";
import type { CaseItem } from "./types";

export function fetchCases(params?: {
  search?: string;
  status?: string;
}): Promise<CaseItem[]> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return get<CaseItem[]>(`/cases${qs ? `?${qs}` : ""}`);
}
