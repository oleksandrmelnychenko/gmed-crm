import { FileText, Inbox, Languages, type LucideIcon } from "lucide-react";
import { matchPath, useLocation } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type WorkspaceItem = {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
};

export function DocumentWorkspaceNav() {
  const { pathname } = useLocation();
  const { t } = useLang();

  const items: WorkspaceItem[] = [
    {
      key: "intake",
      label: t.documents_intake_queue,
      to: "/documents/intake",
      icon: Inbox,
    },
    {
      key: "documents",
      label: t.nav_documents,
      to: "/documents",
      icon: FileText,
    },
    {
      key: "translation-requests",
      label: t.documents_translation_requests,
      to: "/documents/translation-requests",
      icon: Languages,
    },
  ];

  const currentKey = matchPath("/documents/intake", pathname)
    ? "intake"
    : matchPath("/documents/translation-requests", pathname)
      ? "translation-requests"
      : "documents";

  return (
    <aside
      data-workspace-rail="documents"
      className="hidden md:flex md:w-60 lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {items.map((item) => {
            const isActive = currentKey === item.key;
            const Icon = item.icon;

            return (
              <StaffLink
                key={item.key}
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 h-10 text-sm transition-colors",
                  isActive
                    ? "bg-muted/60 text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "shrink-0 size-[18px] transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                  strokeWidth={isActive ? 1.85 : 1.7}
                />
                <span className="truncate font-medium leading-5">
                  {item.label}
                </span>
              </StaffLink>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
