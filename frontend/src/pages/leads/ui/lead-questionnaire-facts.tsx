import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type LeadQuestionnaireFact = {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
};

export function LeadQuestionnaireFacts({
  items,
  topBorder = true,
}: {
  items: LeadQuestionnaireFact[];
  topBorder?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <dl className={cn("grid gap-x-6 border-b border-border sm:grid-cols-2", topBorder && "border-t")}>
      {items.map((item, index) => (
        <div
          key={`${String(item.label)}-${index}`}
          className={item.wide ? "border-b border-border/70 py-3 sm:col-span-2" : "border-b border-border/70 py-3"}
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
