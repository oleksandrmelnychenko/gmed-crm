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
      className="mx-auto grid w-full grid-cols-3 gap-1 sm:flex sm:w-fit"
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
                variant: isActive ? "default" : "ghost",
              }),
              "h-9 min-w-0 rounded-md px-2 text-xs sm:h-8 sm:px-3",
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.7} />
            <span className="min-w-0 truncate">{item.label}</span>
          </StaffLink>
        );
      })}
    </nav>
  );
}
