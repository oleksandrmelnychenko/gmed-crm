import type { ReactNode } from "react";

export function WorkspaceSectionIntro({
  title,
  description,
  accessory,
}: {
  title: ReactNode;
  description: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {accessory ? <div className="shrink-0">{accessory}</div> : null}
    </div>
  );
}
