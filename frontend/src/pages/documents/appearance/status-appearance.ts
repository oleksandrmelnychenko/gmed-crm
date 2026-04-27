export function statusBadge(status: string) {
  if (status === "active")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived")
    return "border-border/60 bg-muted/25 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function translationStatusBadge(status: string) {
  if (status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress")
    return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled")
    return "border-border/60 bg-muted/25 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function textExtractionStatusBadge(status: string) {
  if (status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "unsupported")
    return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border/60 bg-muted/25 text-muted-foreground";
}

export function visibilityBadge(visibility: string) {
  if (visibility === "released_internal")
    return "border-sky-200 bg-sky-50 text-sky-700";
  if (visibility === "released_external")
    return "border-violet-200 bg-violet-50 text-violet-700";
  if (visibility === "patient_visible")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-border/60 bg-muted/25 text-muted-foreground";
}

export function sensitivityBadge(value: string) {
  if (value.toLowerCase() === "medical")
    return "border-rose-200 bg-rose-50 text-rose-700";
  if (value.toLowerCase() === "financial")
    return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}
