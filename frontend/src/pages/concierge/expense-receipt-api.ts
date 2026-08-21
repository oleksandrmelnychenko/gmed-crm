import {
  ApiRequestError,
  apiFetch,
  buildApiUrl,
  downloadApiFile,
  getAccessToken,
  refreshAuthSession,
} from "@/lib/api";

import type {
  ConciergeExpenseContext,
  ConciergeExpenseListResponse,
  ConciergeExpenseMutationResponse,
  ConciergeExpenseSubmitInput,
} from "./expense-receipt-model";

function expenseFormData(input: ConciergeExpenseSubmitInput) {
  const form = new FormData();
  form.set("request_id", input.requestId);
  if (input.orderId) form.set("order_id", input.orderId);
  if (input.orderLeistungId) form.set("order_leistung_id", input.orderLeistungId);
  form.set("vendor", input.vendor);
  form.set("expense_date", input.expenseDate);
  form.set("amount_net", input.amountNet);
  form.set("amount_vat", input.amountVat);
  form.set("amount_gross", input.amountGross);
  form.set("currency", input.currency);
  form.set("paid_by", input.paidBy);
  form.set("service_delivered", String(input.serviceDelivered));
  if (input.note) form.set("note", input.note);
  form.set("file", input.file, input.file.name);
  return form;
}

function parseUploadError(xhr: XMLHttpRequest) {
  const body = xhr.response && typeof xhr.response === "object"
    ? xhr.response as { message?: string; error?: string }
    : null;
  return new ApiRequestError(
    body?.message || body?.error || `${xhr.status} ${xhr.statusText}`.trim(),
    {
      status: xhr.status,
      code: body?.error || "http_error",
      body,
    },
  );
}

function uploadExpenseAttempt(
  serviceId: string,
  input: ConciergeExpenseSubmitInput,
  token: string | null,
  onProgress: (progress: number) => void,
) {
  return new Promise<ConciergeExpenseMutationResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildApiUrl(`/concierge-services/${serviceId}/expenses`));
    xhr.timeout = 120_000;
    xhr.responseType = "json";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(95, Math.round((event.loaded / event.total) * 95)));
    };
    xhr.onerror = () => reject(new ApiRequestError("Network error while uploading receipt"));
    xhr.ontimeout = () => reject(new ApiRequestError("Receipt upload timed out", { code: "timeout" }));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(parseUploadError(xhr));
        return;
      }
      if (!xhr.response || typeof xhr.response !== "object") {
        reject(new ApiRequestError("Receipt upload returned an invalid response", {
          status: xhr.status,
          code: "invalid_response",
        }));
        return;
      }
      const payload = xhr.response as ConciergeExpenseMutationResponse;
      onProgress(100);
      resolve(payload);
    };
    onProgress(1);
    xhr.send(expenseFormData(input));
  });
}

export function getConciergeExpenseContext(serviceId: string) {
  return apiFetch<ConciergeExpenseContext>(
    `/concierge-services/${serviceId}/expense-context`,
    { forceFresh: true },
  );
}

export function getConciergeExpenses(serviceId: string) {
  return apiFetch<ConciergeExpenseListResponse>(
    `/concierge-services/${serviceId}/expenses`,
    { forceFresh: true },
  );
}

export async function uploadConciergeExpense(
  serviceId: string,
  input: ConciergeExpenseSubmitInput,
  onProgress: (progress: number) => void,
) {
  let token = getAccessToken();
  try {
    return await uploadExpenseAttempt(serviceId, input, token, onProgress);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || !token) throw error;
    token = await refreshAuthSession(20_000);
    if (!token) throw error;
    return uploadExpenseAttempt(serviceId, input, token, onProgress);
  }
}

export function downloadConciergeExpenseReceipt(
  serviceId: string,
  expenseId: string,
  fallbackFilename: string,
) {
  return downloadApiFile(
    `/concierge-services/${serviceId}/expenses/${expenseId}/receipt`,
    fallbackFilename,
  );
}
