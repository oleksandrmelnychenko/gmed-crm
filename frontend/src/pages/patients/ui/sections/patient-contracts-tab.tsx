import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  StatCard,
  TabLoader,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type { ContractItem } from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
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
        title={l("Vertrags-Cockpit", "Панель договоров", "Contracts cockpit")}
        description={l(
          "Lifecycle, Gültigkeit und unmittelbare Pflege von Verträgen, ohne das Patientenprofil zu verlassen.",
          "Жизненный цикл, сроки действия и быстрое управление договорами без выхода из профиля пациента.",
          "Lifecycle, validity and direct contract management without leaving the patient profile.",
        )}
        accessory={<CountBadge>{contracts.length}</CountBadge>}
      />

      <FormSection
        title={l("Portfolio-Überblick", "Обзор портфеля", "Portfolio overview")}
        accessory={<CountBadge>{contracts.length} {l("Verträge", "договоров", "contracts")}</CountBadge>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={l("Aktiv oder unterzeichnet", "Активные или подписанные", "Active or signed")}
            value={contractSignedCount}
            description={l(
              "Verträge, die bereits wirksam sind oder unterzeichnet wurden.",
              "Договоры, которые уже вступили в силу или были подписаны.",
              "Contracts that are already effective or have been signed.",
            )}
          />
          <StatCard
            label={l("In Vorbereitung", "В подготовке", "In preparation")}
            value={contractPendingCount}
            description={l(
              "Entwürfe oder versandte Verträge, die noch nicht finalisiert wurden.",
              "Черновики или отправленные договоры, которые ещё не финализированы.",
              "Draft or sent contracts that still need to be finalized.",
            )}
          />
          <StatCard
            label={l("Laufen bald ab", "Скоро истекают", "Expiring soon")}
            value={contractExpiringSoonCount}
            description={l(
              "Verträge mit Enddatum innerhalb der nächsten 30 Tage.",
              "Договоры, у которых срок действия заканчивается в ближайшие 30 дней.",
              "Contracts with an end date in the next 30 days.",
            )}
          />
        </div>
      </FormSection>

      <FormSection
        title={l("Verträge dieses Patienten", "Договоры этого пациента", "Contracts for this patient")}
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
                {l("Neuer Vertrag", "Новый договор", "New contract")}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : contracts.length === 0 ? (
          <EmptyCell>
            {l("Für diesen Patienten wurde noch kein Vertrag angelegt.", "Для этого пациента пока не создано ни одного договора.", "No contract has been created for this patient yet.")}
          </EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {contracts.map((contract) => (
              <div
                key={contract.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{contract.contract_number}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[contract.status] ?? "")}
                  >
                    {statusLabel(contract.status)}
                  </Badge>
                </div>
                <div className="grid gap-1 text-sm text-muted-foreground">
                  <p>{l("Unterzeichnet", "Подписано", "Signed")}: {formatDateTime(contract.signed_at, commonNotSet)}</p>
                  <p>{l("Gültig ab", "Действует с", "Valid from")}: {formatDate(contract.valid_from, commonNotSet)}</p>
                  <p>{l("Gültig bis", "Действует до", "Valid to")}: {formatDate(contract.valid_to, commonNotSet)}</p>
                </div>
                {contract.valid_to ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      isContractExpiringSoon(contract)
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-border/60 bg-muted/25 text-muted-foreground",
                    )}
                  >
                    {isContractExpiringSoon(contract)
                      ? l("Läuft bald ab", "Скоро истекает", "Expiring soon")
                      : l("Gültigkeitsfenster gesetzt", "Срок действия задан", "Validity window set")}
                  </Badge>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenContract(contract.id)}
                  >
                    {l("Öffnen", "Открыть", "Open")}
                  </Button>
                  {canManageContracts ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onEditContractStatus(contract)}
                    >
                      {l("Status aktualisieren", "Обновить статус", "Update status")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
