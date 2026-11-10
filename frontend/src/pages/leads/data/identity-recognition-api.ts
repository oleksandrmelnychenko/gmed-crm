import { apiFetch } from "@/lib/api";

import { normalizeIdentityRecognition } from "../model/identity-recognition-result";

/**
 * `POST /documents/{id}/identity-recognition`: the server reads the machine
 * readable zone of an identity scan (it never leaves the server) and answers
 * with a proposal; nothing is stored. Whoever may open the scan may have it
 * read. Null for an answer that is none (an older server).
 */
export async function recognizeIdentityDocument(documentId: string) {
  return normalizeIdentityRecognition(
    await apiFetch<unknown>(`/documents/${encodeURIComponent(documentId)}/identity-recognition`, { method: "POST" }),
  );
}
