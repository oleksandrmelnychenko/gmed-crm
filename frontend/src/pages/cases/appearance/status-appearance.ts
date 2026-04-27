export function statusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "in_progress":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "closed":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    default:
      return "border-border bg-muted text-foreground";
  }
}
