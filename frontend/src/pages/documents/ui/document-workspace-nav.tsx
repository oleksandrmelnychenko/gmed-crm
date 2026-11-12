import {
  FileText,
  Inbox,
  Languages,
  type LucideIcon,
} from "lucide-react";
import { matchPath, useLocation } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { buttonVariants } from "@/components/ui/button";
import { HeadingMarker } from "@/components/ui/section-heading";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type WorkspaceItem = {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
};

export function DocumentWorkspaceNav({
  showTranslationQueue = true,
  showIntakeQueue = true,
}: {
  showTranslationQueue?: boolean;
  /** Only for roles that work the intake queue (QA 2026-11-12 A-09). */
  showIntakeQueue?: boolean;
}) {
  const { pathname } = useLocation();
  const { t } = useLang();

  const items: WorkspaceItem[] = [
    ...(showIntakeQueue
      ? [
          {
            key: "intake",
            label: t.documents_intake_queue,
            to: "/documents/intake",
            icon: Inbox,
          },
        ]
      : []),
    {
      key: "documents",
      label: t.nav_documents,
      to: "/documents",
      icon: FileText,
    },
    ...(showTranslationQueue
      ? [
          {
            key: "translation-requests",
            label: t.documents_translation_requests,
            to: "/documents/translation-requests",
            icon: Languages,
          },
        ]
      : []),
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
      className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-border/60 bg-card p-1.5"
    >
      {items.map((item) => {
        const isActive = currentKey === item.key;
        const Icon = item.icon;

        return (
          <StaffLink
            key={item.key}
            to={item.to}
            data-workspace-tab
            aria-current={isActive ? "page" : undefined}
            className={cn(
              buttonVariants({
                size: "sm",
                variant: "ghost",
              }),
              "h-auto min-h-8 min-w-0 max-w-full rounded-lg px-2.5 py-1.5 text-[13px] font-medium",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
            <span className="min-w-0 whitespace-normal">{item.label}</span>
            {isActive && <HeadingMarker />}
          </StaffLink>
        );
      })}
    </nav>
  );
}
