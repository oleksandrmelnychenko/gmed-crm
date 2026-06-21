import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type { ContractItem } from "../../model/detail-tab-types";
import { FormSection } from "../shared/patient-form-primitives";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;

type PatientContractsTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  contracts: ContractItem[];
  contractSignedCount: number;
  contractPendingCount: number;
  contractExpiringSoonCount: number;
  canManageContracts: boolean;
  onCreateContract: () => void;
  onEditContractStatus: (contract: ContractItem) => void;
  onOpenContract: (contractId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  isContractExpiringSoon: (contract: ContractItem) => boolean;
};

function ContractOverviewTile({
  label,
  value,
  description,
  groupedLast,
}: {
  label: string;
  value: string | number;
  description: string;
  groupedLast?: boolean;
}) {
  return (
    <article className="relative min-h-[68px] min-w-[190px] px-3 py-1">
      {!groupedLast ? (
        <span className="absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-1 md:block">
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
        </span>
      ) : null}
      <p className="text-2xl font-semibold leading-[0.85] text-foreground">
        {value}
      </p>
      <p className="mt-[5px] break-words text-[11px] leading-tight text-muted-foreground/75">
        {description}
      </p>
      <p className={cn("mt-0.5 break-words text-xs font-medium leading-tight", tokens.text.muted)}>
        {label}
      </p>
    </article>
  );
}

function contractAccentClass(status: string) {
  if (status === "signed" || status === "active") return "bg-emerald-500";
  if (status === "sent") return "bg-sky-500";
  if (status === "expired" || status === "terminated" || status === "cancelled") return "bg-rose-500";
  if (status === "draft") return "bg-zinc-400";
  return "bg-sky-500";
}

export function PatientContractsTab({
  l,
  commonNotSet,
  tabLoading,
  contracts,
  contractSignedCount,
  contractPendingCount,
  contractExpiringSoonCount,
  canManageContracts,
  onCreateContract,
  onEditContractStatus,
  onOpenContract,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  isContractExpiringSoon,
}: PatientContractsTabProps) {
  return (
    <TabsContent value="contracts" className="space-y-4 mt-4 min-h-[400px]">
      <WorkspaceSectionIntro
        title={l("patients_contracts_cockpit")}
        description={l("patients_lifecycle_validity_and_direct_contract_management_withou")}
        accessory={<CountBadge>{contracts.length}</CountBadge>}
      />

      <FormSection
        title={l("patients_portfolio_overview")}
        accessory={<CountBadge>{contracts.length} {l("patients_contracts")}</CountBadge>}
      >
        <div className="grid overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 md:grid-cols-3">
          <ContractOverviewTile
            label={l("patients_active_or_signed")}
            value={contractSignedCount}
            description={l("patients_effective_or_signed_contracts")}
          />
          <ContractOverviewTile
            label={l("patients_in_preparation")}
            value={contractPendingCount}
            description={l("patients_draft_and_sent_contracts")}
          />
          <ContractOverviewTile
            label={l("patients_expiring_soon")}
            value={contractExpiringSoonCount}
            description={l("patients_ending_in_the_next_30_days")}
            groupedLast
          />
        </div>
      </FormSection>

      <FormSection
        title={l("patients_contracts_for_this_patient")}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{contracts.length}</CountBadge>
            {canManageContracts ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={onCreateContract}
              >
                {l("patients_new_contract")}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : contracts.length === 0 ? (
          <EmptyCell>
            {l("patients_no_contract_has_been_created_for_this_patient_yet")}
          </EmptyCell>
        ) : (
          <div className="space-y-2.5">
            {contracts.map((contract) => (
              <article
                key={contract.id}
                className="rounded-xl border border-border bg-card"
              >
                <div className="relative overflow-hidden p-3.5">
                  <span
                    className={cn(
                      "absolute left-0 top-4 h-12 w-1 rounded-r-full",
                      contractAccentClass(contract.status),
                    )}
                  />
                  <div className="grid gap-3 pl-3 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-px w-8 bg-border" />
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", statusColors[contract.status] ?? "")}
                        >
                          {statusLabel(contract.status)}
                        </Badge>
                      </div>
                      <h3 className="mt-1.5 font-mono text-lg font-semibold leading-none text-foreground">
                        {contract.contract_number}
                      </h3>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                        {[
                          `${l("patients_signed")}: ${formatDateTime(contract.signed_at, commonNotSet)}`,
                          `${l("patients_valid_from")}: ${formatDate(contract.valid_from, commonNotSet)}`,
                          `${l("patients_valid_to")}: ${formatDate(contract.valid_to, commonNotSet)}`,
                        ].join(" - ")}
                      </p>
                      {contract.valid_to ? (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              isContractExpiringSoon(contract)
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-border/60 bg-muted/25 text-muted-foreground",
                            )}
                          >
                            {isContractExpiringSoon(contract)
                              ? l("patients_expiring_soon_2")
                              : l("patients_validity_set")}
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col justify-between gap-3 border-l border-dashed border-border pl-4">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {l("patients_contract")}
                      </span>
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-center rounded-lg"
                          onClick={() => onOpenContract(contract.id)}
                        >
                          {l("patients_open")}
                        </Button>
                        {canManageContracts ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            onClick={() => onEditContractStatus(contract)}
                          >
                            {l("patients_update_status")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
