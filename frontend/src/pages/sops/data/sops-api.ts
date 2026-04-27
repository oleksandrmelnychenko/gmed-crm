import { apiFetch } from "@/lib/api";

import type { EligibleUsersPayload, SopItem } from "../model/types";

type JsonPayload = Record<string, unknown>;

const SOP_ELIGIBLE_USERS_CACHE_TTL_MS = 60_000;

function postJson(path: string, payload: JsonPayload = {}) {
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchSopsWorkspace(canCreate: boolean, canReviewQueue: boolean) {
  const [library, eligible, queue] = await Promise.all([
    apiFetch<SopItem[]>("/sops").catch(() => []),
    canCreate
      ? apiFetch<EligibleUsersPayload>("/sops/eligible-users", {
          cacheTtlMs: SOP_ELIGIBLE_USERS_CACHE_TTL_MS,
        }).catch(() => null)
      : Promise.resolve(null),
    canReviewQueue
      ? apiFetch<SopItem[]>("/sops/review-queue").catch(() => [])
      : Promise.resolve([]),
  ]);

  return { library, eligible, queue };
}

export function saveSopContent(sopId: string | null, payload: JsonPayload) {
  return postJson(sopId ? `/sops/${sopId}/update` : "/sops", payload);
}

export function requestSopAcknowledgement(sopId: string) {
  return apiFetch(`/sops/${sopId}/request-acknowledgement`, { method: "POST" });
}

export function acknowledgeSop(sopId: string) {
  return apiFetch(`/sops/${sopId}/acknowledge`, { method: "POST" });
}

export function reviewSop(sopId: string, payload: JsonPayload) {
  return postJson(`/sops/${sopId}/review`, payload);
}
