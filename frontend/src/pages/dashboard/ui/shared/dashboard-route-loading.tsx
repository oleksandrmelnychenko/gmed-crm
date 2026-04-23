export function DashboardRouteLoading() {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-border bg-card">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-[var(--brand)]" />
    </div>
  );
}

export function DashboardSectionLoading() {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-border bg-card/60">
      <div className="size-7 animate-spin rounded-full border-2 border-border border-t-[var(--brand)]" />
    </div>
  );
}
