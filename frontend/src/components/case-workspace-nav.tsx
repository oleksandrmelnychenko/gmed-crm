import { ArrowLeft } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CASE_WORKSPACE_SECTIONS,
  type CaseSectionGroup,
  caseSectionGroupLabel,
  caseSectionLabel,
  normalizeCaseSectionKey,
} from "@/pages/case-workspace/sections";

const GROUP_ORDER: readonly CaseSectionGroup[] = ["clinical", "specialty", "meta"];

export function CaseWorkspaceNav() {
  const { caseId } = useParams<{ caseId: string }>();
  const [searchParams] = useSearchParams();
  const { t, lang } = useLang();
  const currentSection = normalizeCaseSectionKey(searchParams.get("section"));

  if (!caseId) return null;

  const groupedSections = GROUP_ORDER.map((group) => ({
    group,
    items: CASE_WORKSPACE_SECTIONS.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <aside className="hidden lg:flex lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="px-4 pt-4">
        <StaffLink
          to="/cases"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.cases_title}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groupedSections.map(({ group, items }, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-5")}>
            <div className="flex items-center gap-2 px-3 pb-2">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-orange-500"
              />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {caseSectionGroupLabel(group, lang)}
              </span>
            </div>
            <div className="space-y-1">
              {items.map((item) => {
                const isActive = currentSection === item.key;
                const Icon = item.icon;
                const to =
                  item.key === "overview"
                    ? `/cases/${caseId}`
                    : `/cases/${caseId}?section=${item.key}`;
                return (
                  <StaffLink
                    key={item.key}
                    replace
                    to={to}
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
                      {caseSectionLabel(item, lang)}
                    </span>
                  </StaffLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
