import { apiFetch } from "@/lib/api";

import type { GwgOwnTrainings, GwgTrainingOverview, GwgTrainingRecord } from "../model/gwg-training";

const fresh = { forceFresh: true } as const;
// The signed scan may be up to 25 MB.
const UPLOAD_TIMEOUT_MS = 180_000;

export const gwgTrainingApi = {
  overview: () => apiFetch<GwgTrainingOverview>("/sops/gwg-training", fresh),
  mine: () => apiFetch<GwgOwnTrainings>("/sops/gwg-training/mine", fresh),
  create: (payload: Record<string, unknown>) =>
    apiFetch<GwgTrainingRecord>("/sops/gwg-training", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
  uploadSigned: (recordId: string, file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    return apiFetch<GwgTrainingRecord>(`/sops/gwg-training/${recordId}/signed-copy`, {
      method: "POST",
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
};
