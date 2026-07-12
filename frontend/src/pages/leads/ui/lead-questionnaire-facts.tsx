import type { ReactNode } from "react";

export type LeadQuestionnaireFact = {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
};

export function LeadQuestionnaireFacts({
  items,
}: {
  items: LeadQuestionnaireFact[];
}) {
  if (items.length === 0) return null;

  return (
    <dl className="grid gap-x-6 border-y border-border sm:grid-cols-2">
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
