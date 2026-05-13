import type { AdminSystemTranslations } from "./catalogs/admin-system";
import type { CasesClinicalTranslations } from "./catalogs/cases-clinical";
import type { ClinicalTranslations } from "./catalogs/clinical";
import type { ExtractedUiTranslations } from "./catalogs/extracted-ui";
import type { OperationsTranslations } from "./catalogs/operations";
import type { PatientsPortalTranslations } from "./catalogs/patients-portal";
import type { RevenueTranslations } from "./catalogs/revenue";
import type { SharedCoreTranslations } from "./catalogs/shared";

export type TranslationShape = SharedCoreTranslations &
  AdminSystemTranslations &
  CasesClinicalTranslations &
  ClinicalTranslations &
  ExtractedUiTranslations &
  OperationsTranslations &
  PatientsPortalTranslations &
  RevenueTranslations &
  Record<string, unknown>;
