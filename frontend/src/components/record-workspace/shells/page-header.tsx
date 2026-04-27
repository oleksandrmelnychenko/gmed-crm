import { type ReactNode } from "react";

export function PageHeader({
  title,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
