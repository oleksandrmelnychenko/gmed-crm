export function linkedDocumentStatusBadge(status: string): string {
  if (status === "active")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived")
    return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function linkedDocumentVisibilityBadge(visibility: string): string {
  if (visibility === "patient_visible")
    return "border-blue-200 bg-blue-50 text-blue-700";
  if (visibility === "released_external")
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (visibility === "released_internal")
    return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function linkedDocumentSensitivityBadge(value: string): string {
  void value;
  return "border-slate-200 bg-slate-50 text-slate-700";
}
