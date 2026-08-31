import { ClipboardList, ConciergeBell } from "lucide-react";
import { useLocation } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const copy = {
  de: {
    label: "Bereiche der Operationszentrale",
    services: "Anfragen und Services",
    tasks: "Aufgaben",
  },
  ru: {
    label: "Разделы операционного центра",
    services: "Запросы и услуги",
    tasks: "Задачи",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export function OperationsWorkspaceTabs({ lang }: { lang: Lang }) {
  const labels = copy[lang];
  const { pathname } = useLocation();
  const items = [
    { to: "/concierge", label: labels.services, icon: ConciergeBell },
    { to: "/task-manager", label: labels.tasks, icon: ClipboardList },
  ] as const;

  return (
    <nav aria-label={labels.label} className="mx-auto flex w-full justify-center overflow-x-auto pb-0.5">
      <div className="inline-flex min-w-max items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
        {items.map(({ to, label, icon: Icon }) => {
          const isActive = pathname === to;
          return (
            <StaffLink
              key={to}
              to={to}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2",
                isActive
                  ? "bg-orange-500 text-white shadow-sm hover:bg-orange-600"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" strokeWidth={1.7} />
              {label}
            </StaffLink>
          );
        })}
      </div>
    </nav>
  );
}
