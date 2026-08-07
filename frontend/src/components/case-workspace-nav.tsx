import { ArrowLeft, Stethoscope } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CASE_WORKSPACE_NAV_SECTIONS,
  type CaseSectionGroup,
  caseSectionGroupLabel,
  caseSectionLabel,
  normalizeCaseSectionKey,
} from "@/pages/case-workspace/sections";
import {
  selectCaseSpecialization,
  useCaseSpecializations,
  useSelectedCaseSpecialization,
} from "@/pages/case-workspace/subject-store";
import { specializationLabelForItem } from "@/pages/providers/model/specialization-labels";

const GROUP_ORDER: readonly CaseSectionGroup[] = ["episode", "meta"];

const SPECIALIZATION_GROUP_LABEL = {
  de: "Spezialisierungen",
  ru: "Специализации",
} as const;

export function CaseWorkspaceNav() {
  const { caseId } = useParams<{ caseId: string }>();
  const [searchParams] = useSearchParams();
  const { t, lang } = useLang();
  const currentSection = normalizeCaseSectionKey(searchParams.get("section"));
  const patientContext = searchParams.get("patient");
  const specializations = useCaseSpecializations(caseId);
  const selectedSpecializationId = useSelectedCaseSpecialization(caseId);
  const labelLang = lang === "de" ? "de" : "ru";

  if (!caseId) return null;

  function buildSectionLink(sectionKey: string) {
    const params = new URLSearchParams();
    if (patientContext) params.set("patient", patientContext);
    if (sectionKey !== "overview") params.set("section", sectionKey);
    const query = params.toString();
    return query ? `/cases/${caseId}?${query}` : `/cases/${caseId}`;
  }

  const backHref = patientContext ? `/patients/${patientContext}?tab=cases` : "/cases";
  const backLabel = patientContext ? t.patients_col_patient : t.cases_title;

  const groupedSections: Array<{
    group: CaseSectionGroup;
    items: Array<(typeof CASE_WORKSPACE_NAV_SECTIONS)[number]>;
  }> = [];
  for (const group of GROUP_ORDER) {
    const items = CASE_WORKSPACE_NAV_SECTIONS.filter((item) => item.group === group);
    if (items.length > 0) {
      groupedSections.push({ group, items });
    }
  }

  return (
    <aside
      data-workspace-rail="case"
      className="hidden lg:flex lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="px-4 pt-4">
        <StaffLink
          to={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groupedSections.map(({ group, items }, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-4")}>
            {groupIndex > 0 ? (
              <div className="mx-3 mb-2 h-px bg-border/60" aria-hidden />
            ) : null}
            <div className="px-3 pb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {caseSectionGroupLabel(group, lang)}
              </span>
            </div>
            <div className="space-y-1">
              {items.map((item) => {
                const isActive =
                  selectedSpecializationId === null && currentSection === item.key;
                const Icon = item.icon;
                const to = buildSectionLink(item.key);
                return (
                  <StaffLink
                    key={item.key}
                    replace
                    to={to}
                    onClick={() => selectCaseSpecialization(caseId, null)}
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
            {group === "episode" && specializations.length > 0 ? (
              <div className="mt-4">
                <div className="mx-3 mb-2 h-px bg-border/60" aria-hidden />
                <div className="px-3 pb-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {SPECIALIZATION_GROUP_LABEL[labelLang]}
                  </span>
                </div>
                <div className="space-y-1">
                  {specializations.map((specialization) => {
                    const isActive = selectedSpecializationId === specialization.id;
                    return (
                      <button
                        key={specialization.id}
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
                          isActive
                            ? "bg-muted/60 font-semibold text-foreground before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                        onClick={() =>
                          selectCaseSpecialization(caseId, specialization.id)
                        }
                      >
                        <Stethoscope
                          className={cn(
                            "size-[18px] shrink-0 transition-colors",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                          strokeWidth={isActive ? 1.85 : 1.7}
                        />
                        <span className="truncate font-medium leading-5">
                          {specializationLabelForItem(specialization, labelLang)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
