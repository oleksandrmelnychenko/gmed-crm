import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type LeadQuestionnaireFact = {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
};

export function LeadQuestionnaireFacts({
  items,
  className,
}: {
  items: LeadQuestionnaireFact[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <dl className={cn("grid gap-x-6 gap-y-1 sm:grid-cols-2", className)}>
      {items.map((item, index) =>
        item.wide ? (
          <div key={`${String(item.label)}-${index}`} className="min-w-0 py-1 sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-snug text-foreground">
              {item.value}
            </dd>
          </div>
        ) : (
          <div key={`${String(item.label)}-${index}`} className="flex min-w-0 items-center gap-2 py-1">
            <dt className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="min-w-0 break-words">{item.label}</span>
              <span aria-hidden className="h-px min-w-5 flex-1 self-center bg-border/70" />
            </dt>
            <dd className="min-w-0 max-w-[58%] break-words text-right text-sm font-semibold leading-snug text-foreground">
              {item.value}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
