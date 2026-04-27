export function statusTone(value: string) {
  if (value === "approved") return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100";
  if (value === "pending_approval") return "bg-amber-100 text-amber-700 hover:bg-amber-100";
  if (value === "rejected") return "bg-rose-100 text-rose-700 hover:bg-rose-100";
  if (value === "archived") return "bg-slate-200 text-slate-700 hover:bg-slate-200";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
}
