export function buildLinkedOrderWorkspaceHref(
  orderId: string | null | undefined,
  patientId: string | null | undefined,
) {
  const trimmedOrderId = (orderId ?? "").trim();
  if (!trimmedOrderId) return "";

  const params = new URLSearchParams();
  const trimmedPatientId = (patientId ?? "").trim();
  if (trimmedPatientId) params.set("patient", trimmedPatientId);

  const query = params.toString();
  return query
    ? `/orders/${encodeURIComponent(trimmedOrderId)}?${query}`
    : `/orders/${encodeURIComponent(trimmedOrderId)}`;
}
