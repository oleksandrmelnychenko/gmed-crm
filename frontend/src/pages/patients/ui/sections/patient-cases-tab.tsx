import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  TabLoader,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type { CaseItem } from "../../model/detail-tab-types";

type PatientCasesDictionary = {
  cases_title: string;
  common_not_set: string;
};

type PatientCasesTabProps = {
  cases: CaseItem[];
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenCase: (caseId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientCasesDictionary;
  tabLoading: boolean;
};

export function PatientCasesTab({
  cases,
  emptyLabel,
  formatDate,
  onOpenCase,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientCasesTabProps) {
  return (
    <TabsContent value="cases" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.cases_title}
        accessory={<CountBadge>{cases.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : cases.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {cases.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenCase(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{item.case_id}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {item.hauptanfragegrund || t.common_not_set}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
              </button>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
