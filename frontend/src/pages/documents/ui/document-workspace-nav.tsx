import {
  FileText,
  Inbox,
  Languages,
  type LucideIcon,
} from "lucide-react";
import { matchPath, useLocation } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { buttonVariants } from "@/components/ui/button";
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
    <nav
      data-workspace-tabs="documents"
      aria-label={t.nav_documents}
      className="mx-auto flex w-fit max-w-full items-center justify-center gap-2 overflow-x-auto px-2 py-1"
    >
      {items.map((item) => {
        const isActive = currentKey === item.key;
        const Icon = item.icon;

        return (
          <StaffLink
            key={item.key}
            to={item.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              buttonVariants({
                size: "sm",
                variant: "ghost",
              }),
              "h-11 min-w-fit rounded-xl px-4 text-sm font-medium",
              isActive
                ? "bg-orange-500 text-white shadow-sm hover:bg-orange-600 hover:text-white"
                : "text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.8} />
            <span className="whitespace-nowrap">{item.label}</span>
          </StaffLink>
        );
      })}
    </nav>
  );
}
