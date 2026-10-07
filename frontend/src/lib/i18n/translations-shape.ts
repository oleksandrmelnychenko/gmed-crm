import type { AdminSystemTranslations } from "./catalogs/admin-system";
import type { CasesClinicalTranslations } from "./catalogs/cases-clinical";
import type { ClinicalTranslations } from "./catalogs/clinical";
import type { ExtractedUiTranslations } from "./catalogs/extracted-ui";
import type { FinanceBalancesTranslations } from "./catalogs/finance-balances";
import type { GwgTrainingTranslations } from "./catalogs/gwg-training";
import type { OperationsTranslations } from "./catalogs/operations";
import type { PatientsPortalTranslations } from "./catalogs/patients-portal";
import type { PersonnelTranslations } from "./catalogs/personnel";
import type { RevenueTranslations } from "./catalogs/revenue";
import type { SanctionsTranslations } from "./catalogs/sanctions";
import type { SharedCoreTranslations } from "./catalogs/shared";
import type { StaffAccessTranslations } from "./catalogs/staff-access";

export type TranslationShape = SharedCoreTranslations &
  AdminSystemTranslations &
  CasesClinicalTranslations &
  ClinicalTranslations &
  ExtractedUiTranslations &
  FinanceBalancesTranslations &
  GwgTrainingTranslations &
  OperationsTranslations &
  PatientsPortalTranslations &
  PersonnelTranslations &
  RevenueTranslations &
  SanctionsTranslations &
  StaffAccessTranslations &
  Record<string, unknown>;
