import { existingParentPatientFromError, fillMissingParentProfile } from "../model/parent-profile-reuse";
import {
  fillMissingFromSeed,
  fillMissingIdentityNames,
  newRequestForPersonLabel,
  prefilledFromSourceNotice,
  seedFromPatientRelation,
  seedFromTrustedContact,
  sourcePepHint,
  sourcePepHintActive,
  sourcePepHintText,
  type LeadSourcePerson,
} from "../model/lead-source-person";
import type { RelationItem } from "@/pages/patients/model/detail-tab-types";
import { OrderPatientDocumentReview, OrderExistingContractsTable, type RequestReviewRow } from "@/pages/orders/ui/order-patient-document-review";
import { isContractUsable } from "@/pages/orders/model/order-intake";
import { useRepeatPatientReview } from "../model/use-repeat-patient-review";
import { usePreviousRequests } from "../model/use-previous-requests";
import { PreviousRequestsPanel } from "./previous-requests-panel";
import { orderPeriodWarnings } from "../model/order-period-warnings";
import { createNewestLoadGuard, type NewestLoadGuard } from "../model/newest-load-guard";
import { repeatConsentNote, requestConsentStatus } from "../model/request-consents";
import { OrderCatalogServicesTable } from "@/pages/orders/ui/order-catalog-services-table";
import type { ServiceLine } from "@/pages/orders/model/order-service-line";
import { servicePriceOptionValue, parseServicePriceOptionValue, money, germanDateLabel, serviceBillingUnitLabel, serviceBillingUnitBadgeClass, formatMoneyValue, priceVersionDisplayName, resolveServiceDescriptionItems } from "@/pages/orders/model/order-service-presentation";
export { resolveServiceDescriptionTemplate, resolveServiceDescriptionItems } from "@/pages/orders/model/order-service-presentation";
import { SelectedWorkTypesSummary, workTypeDurationLabel } from "@/pages/orders/ui/order-work-types-summary";
import { costEstimateWorkTypeHint, costEstimateWorkTypeStatus } from "@/pages/orders/model/cost-estimate-work-types";
export { SelectedWorkTypesSummary } from "@/pages/orders/ui/order-work-types-summary";
import { serviceDescriptionItems, serviceDescriptionText, type ServiceDescriptionItem } from "@/lib/service-description";
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Download,
  Eye,
  ExternalLink,
  FileCheck2,
  FileText,
  HeartPulse,
  History,
  Info,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UserRoundCheck,
  UserRoundPlus,
  X,
  type LucideIcon,
} from "lucide-react";

import { AdminSectionTitle, AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { PARENT_ROLE_CHIP_CLASS, TrustedContactRole } from "./trusted-contact-role";
import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect, countryCodeForDisplay, countryCodeFromStoredValue, countryLabel } from "@/components/ui/country-select";
import { CitizenshipMultiSelect, normalizeCitizenships } from "@/components/ui/citizenship-multi-select";
import { nationalityCountryCode } from "@/pages/patients/model/nationalities";
import {
  patientDeclarationLeadId,
  PAYER_SECTION_ID,
  payerAmlCountries,
  payerGateErrorText,
  payerReadinessReasonFields,
  payerReadinessReasonLabels,
  payerReadinessReasonSteps,
} from "../model/lead-payer";
import { useLeadPayerDeclaration } from "../model/use-lead-payer-declaration";
import { useLeadPayerLink } from "../model/use-lead-payer-link";
import { amlPrefillFromLeadAnswers, applyAmlLeadPrefill } from "../model/enhanced-check-prefill";
import { fetchLeadPortalIntake, LEAD_CUSTODY_VALUES, moveLeadPortalUpload, type LeadCustody, type LeadRepresentative } from "../data/lead-portal-intake-api";
import type { RepresentativeUploadKind } from "../data/lead-risk-api";
import { useLeadEnhancedCheck } from "../model/use-lead-enhanced-check";
import { useRiskCountryLists } from "../model/use-risk-country-lists";
import {
  enhancedCheckReasonsText,
  enhancedCheckRequired,
  enhancedCheckRequirementLabel,
  enhancedCheckRiskTier,
  enhancedCheckTitle,
  enhancedCheckTriggers,
  highRiskCountryHint,
  isBlacklistCountry,
  isRiskCountry,
  pepEnhancedCheckHint,
  RISK_ASSESSMENT_REASON,
  SANCTIONS_REVIEW_PENDING,
  type LeadEnhancedCheck,
  type RiskCountryLists,
} from "../model/enhanced-check";
import { PAYER_PACKAGE_TEMPLATE_IDS } from "../data/lead-payer-package-api";
import { useCan } from "@/lib/permissions";
import {
  GWG_IDENTIFICATION_TEMPLATE,
  adultActingPersons,
  currentGwgSheet,
  gwgSheetErrorText,
  gwgSheetPlan,
  gwgSheetRequest,
  isGwgPayerSheetIncomplete,
  isOtherPersonUploadArt,
  type GwgSheetButton,
} from "../model/gwg-identification";
import { identificationErrorText, payerSamePerson } from "../model/lead-identification";
import {
  LEAD_SELF_DISCLOSURE_TEMPLATE,
  leadSelfDisclosureAvailable,
  leadSelfDisclosureErrorText,
  leadSelfDisclosureRequirement,
  leadSelfDisclosureRequirementLabel,
  leadSelfDisclosureSourceNote,
  leadSelfDisclosureUnavailableHint,
} from "../model/lead-self-disclosure";
import { custodyLabel, idDocumentTypeLabel, representativeName } from "../model/lead-gwg-statements";
import {
  TRUSTED_CONTACT_RELATIONS,
  changedRepresentativeDetails,
  contactEmailLoginWarning,
  createContactEmailLoginCheck,
  emailChangedOnSave,
  isLegalGuardianRelation,
  isParentOrGuardianRelation,
  leadUpdateWithChangedContacts,
  mergeTrustedContacts,
  representativeCabinetAddress,
  representativeMinorOnSave,
  storedTrustedContactDrafts,
  guardianRelationOptionLabel,
  trustedContactRelationLabel,
  trustedContactsPayload,
  type TrustedContactPayload,
  type TrustedContactRepresentativeDetails,
} from "../model/lead-trusted-contacts";
import { medicalStepHasContent } from "../model/medical-step-content";
import { uploadEach } from "../model/upload-each";
import { LEAD_UPLOAD_ACCEPT } from "@/pages/patient-lead/lead-request-model";
import { useLeadIdentificationStatus } from "../model/use-lead-identification-status";
import { removeLeadRepresentativeData, removeLeadTrustedContact, updateLeadRepresentativeDetails, type RepresentativeDetails } from "../data/lead-representation-api";
import { EMPTY_REPRESENTATIVE_DETAILS, fillEmptyRepresentativeDetails, guardianCandidateDetails, pendingRepresentativeDetailsReady, representativeDetailsChanged, representativeDetailsErrors } from "../model/lead-representative-details";
import { LeadConfirmDialog } from "./lead-confirm-dialog";
import { LeadCustodySelect } from "./lead-custody-select";
import { LeadGwgSheetActions, gwgSheetBusyKey } from "./lead-gwg-sheet-actions";
import { LeadPayerDeclarationSection, LeadPayerSignatureFlow } from "./lead-payer-section";
import { createPayerAutosaveRegistry } from "../model/lead-payer-autosave";
import { LANGUAGE_OPTIONS, englishLanguageName, languageLabel } from "@/components/ui/language-multi-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { paymentStatusLabel } from "@/lib/payment-status";
import { formatMoneyLabel, formatMoneyRange, moneyLineAmounts, roundCents, sameCents, toCents } from "@/lib/money";
import { ApiRequestError, apiFetch, clearApiCache } from "@/lib/api";
import { appDateKey, formatAppDate, isoToBerlinLocalInput, parseBerlinLocalInput, parseDateKey } from "@/lib/app-time-zone";
import { isValidEmailAddress } from "@/lib/contact-validation";
import { PERSON_CITY_MAX, PERSON_NAME_MAX, isValidPersonPhone, oneLine, personPhoneAcceptable } from "@/lib/person-fields";
import { EmailDomainWarning, emailDomainWarningText, knownNoMailEmailError } from "@/components/email-domain-warning";
import { useEmailDomainStatus } from "@/lib/email-domain-check";
import { useDebouncedRealtimeSubscription, useRealtimeSubscription } from "@/lib/realtime";
import {
  LEAD_PURGED_EVENT,
  LEAD_TIME_REFRESH_EVENTS,
  isLeadPurgedEvent,
  leadPurgedText,
  leadPurgedTitle,
  touchesLeadTimeState,
} from "../model/lead-time-events";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner,
  checkboxClass,
  CountBadge,
  EmptyCell,
  inputClass,
  Section as WorkspaceSection,
  selectClass,
  StatusBadge,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { ReadOnlyScope } from "@/components/read-only-scope";
import { useLang, type Lang } from "@/lib/i18n";
import { NEW_LEAD_COUNTER_REFRESH_EVENT } from "@/lib/use-nav-counters";
import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  completeCaseIntake,
  fetchCaseDetail,
  fetchCases,
  saveCaseOverview,
} from "@/pages/cases/data/case-api";
import {
  createContract,
  createQuote,
  fetchAgencyServices,
  fetchContract,
  fetchContracts,
  fetchQuotes,
  updateContractStatus,
  updateQuoteStatus,
} from "@/pages/contracts/data/contracts-api";
import type { AgencyServiceItem, ContractItem, QuoteItem } from "@/pages/contracts/model/types";
import {
  listAgencyServicePriceChoices,
} from "@/pages/contracts/model/contracts-model";
import {
  createDocumentPreviewObjectUrl,
  deleteStoredDocumentFile,
  downloadDocumentFile,
  fetchDocuments,
  generateDocument,
  markDocumentSigned,
  revokeDocumentPreviewObjectUrl,
  uploadDocument,
  type DocumentComplianceKind,
} from "@/pages/documents/data/document-api";
import { signatureGateErrorText } from "@/pages/documents/data/document-signature-api";
import {
  AML_ASSET_ORIGIN_EVIDENCE_ART,
  parseAssetOriginEvidence,
  type AssetOriginEvidence,
} from "@/pages/documents/model/asset-origin-evidence";
import { AssetOriginEvidenceField } from "@/pages/documents/ui/asset-origin-evidence-field";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { PaperSignatureConfirmButton } from "@/pages/documents/ui/paper-signature-confirm";
import { agencyCatalogItemName, agencyServiceLineDisplayName, germanDocumentUnitLabel } from "@/lib/agency-service-labels";
import { DocumentReviewStatus } from "@/pages/documents/ui/document-review-status";
import { SignatureDocumentPreview } from "@/pages/documents/ui/signature-document-preview";
import {
  canSignWizardDocument,
  documentSignedFor,
  documentVersionExistsErrorText,
  leadConsentFormTemplate,
  orderClientSignatureState,
  shouldReloadDocumentsAfterGenerationError,
  signatureNeedsProof,
  isMedicalUpload,
  isReplaceableFormVersion,
} from "../model/wizard-document-signing";
import {
  daysUntilRetentionDeadline,
  retentionCountdownHint,
  retentionDeadlineNotice,
  withFinalPeriod,
} from "../appearance/status-appearance";
import type { DocumentItem } from "@/pages/documents/model/types";
import {
  createOrder,
  createOrderLeistung,
  fetchOrder,
  fetchOrders,
  syncLeadWizardOrderLeistungen,
  updateOrderCommercialBasis,
} from "@/pages/orders/data/order-api";
import {
  clientSignatureNote,
  documentMatchesOrderTerms,
  signedTermsChangeConfirmText,
  SignedTermsChangeCancelled,
  withSignedTermsConfirmation,
} from "@/pages/orders/model/client-signature";
import type { Leistung, OrderSummary } from "@/pages/orders/model/types";
import {
  fetchAllDoctors,
  fetchPatientClinical,
  savePatientClinicalWarnings,
  savePatientDiagnoses,
  savePatientMedications,
  savePatientNarrative,
  type AllDoctorOption,
  type ClinicalDiagnosis,
  type ClinicalMedication,
  type ClinicalNarrative,
  type PatientClinicalProfile,
  type ClinicalWarning,
} from "@/pages/patients/data/patient-clinical";
import type { PatientDetail } from "@/pages/patients/model/list-model";
import { fetchProviders, fetchSpecializations } from "@/pages/providers/data/provider-api";
import { specializationLabelForValue } from "@/pages/providers/model/specialization-labels";
import type { ProviderSummary, SpecializationItem } from "@/pages/providers/model/types";
import { SanctionsLeadBanner, SanctionsLiveCheckNotice } from "@/pages/sanctions/components";
import { isSanctionsGateError, liveCheckInput } from "@/pages/sanctions/model";
import {
  fetchSpecializationWorkTypes,
  type SpecializationWorkType,
} from "@/pages/specializations/data/specialization-work-types-api";
import {
  LEAD_WIZARD_SERVICE_OPTIONS,
  leadConversionRunnable,
  leadOpenBlockingReasons,
  leadIntakeTypeFromLead,
  isLeadConvertedError,
  leadErrorBlockingReasons,
  leadErrorMessage,
  leadServerContactError,
  leadServerFieldError,
  normalizeLeadServiceSelection,
  normalizeLeadServiceValue,
  passportNameRuleText,
  updateLeadServiceSelection,
  useLeadLabels,
} from "@/pages/leads/model/leads-model";

import {
  LeadWizardDocumentMetadata,
  sortWizardDocumentsNewestFirst,
  wizardArchivedDocumentTitle,
  wizardDocumentIsArchived,
} from "./lead-wizard-document-metadata";
import { LeadGwgStatements } from "./lead-gwg-statements";
import { LeadAmlPepReviews } from "./lead-aml-pep-reviews";
import {
  parsePepReviews,
  PEP_SUBJECT_PATIENT,
  pepPersons,
  type PepReviews,
  withoutPepReviewStamp,
  withPepReview,
} from "../model/pep-review";
import { enhancedFundsProofOutstanding } from "../model/lead-gwg-statements";
import { LeadRiskAssessmentPanel } from "./lead-risk-assessment-panel";
import {
  CONSENT_RECIPIENT_SCOPES,
  checkedScopeCodes,
  normalizeScopeCodes,
  scopeOptionLabel,
  staffScopeSummary,
  toggleScopeCode,
  type ConsentRecipientScope,
} from "@/lib/consent-recipient-scope";
import { CabinetPersonActions, CabinetPersonDetails, CabinetPersonRow, CabinetRecipientBadge, type CabinetPersonEditTarget } from "./lead-cabinet-person-row";
import { cabinetPeople, consentFormRecipients, mergeLeadPeople, personNameKey, type CabinetPerson } from "../model/lead-people";
import { PortalConsentChoiceView } from "./lead-portal-consent-choices";
import { LeadIdentityDocumentData } from "./lead-identity-document-data";
import { LeadRepresentativeDetailsForm, PendingRepresentativeDetailsForm } from "./lead-representative-details";
import { LeadRepresentativeUploads, representativeFileOrigin } from "./lead-representative-uploads";
import { LeadPatientConcern } from "./lead-patient-concern";
import { useLeadRiskAssessment } from "../model/use-lead-risk-assessment";
import { gwgSheetSignatureNotice, representativeDocumentFieldsMissing, representativeDocumentFocus, representativeDocumentSlot, representativeMissingText, riskGateErrorText } from "../model/lead-risk-assessment";
import { LeadIdentificationStatus } from "./lead-identification-status";
import { LeadQuestionnaireFacts } from "./lead-questionnaire-facts";
import { PortalCredentialsDialog, type PortalCredentials } from "./lead-portal-access";
import {
  legalSexOptionElements,
  PatientDataPendingNotice,
  PatientUpdatedBanner,
  PortalInquiryConsentLine,
  PortalHealthConsentLine,
  PortalUploadsProvider,
  Step1FillModeSwitch,
  Step1PortalFieldNote,
  Step1PortalProvider,
  Step1PortalSummary,
  useStep1PortalField,
} from "./lead-wizard-portal-intake";
import { useLeadStep1Portal } from "../model/use-lead-step1-portal";
import { leadDisplayName } from "../model/lead-display-name";
import {
  LEAD_FAILURE_REASONS,
  LEAD_FAILURE_REASON_MAX_LENGTH,
  LEAD_FAILURE_REASON_OTHER,
  leadFailureReasonDraft,
  leadFailureReasonError,
  leadFailureReasonLabel,
  leadFailureReasonOtherLabel,
  leadFailureReasonValue,
  type LeadFailureReasonDraft,
} from "../model/lead-failure-reasons";
import { filterPatientsBySearch, patientSearchText } from "../model/lead-referrer-search";
import {
  PATIENT_FILLED_KEYS,
  PORTAL_FIELD_BY_DRAFT_KEY,
  mergePatientUpdates,
  patientDataPending,
  patientDataPendingFields,
  relaxMasterErrors,
  withPatientDataPending,
} from "../model/lead-portal-intake";
import { LeadSigningPackagePanel } from "./lead-signing-package-panel";
import { narrativeForIntakeSave } from "./lead-wizard.clinical-state";
import {
  WizardDocumentRowError,
  WizardDocumentRowErrorProvider,
  type WizardDocumentRowErrorState,
} from "./wizard-document-row-error";
import { WizardLoadError } from "./wizard-load-error";
import {
  agencyOrderConfirmationBlocked,
  discoveryReferrerMissing,
  insuranceAnswerFromStored,
  intakeAsksDiscoverySource,
  isMinor,
  isRepeatIntakeLead,
  preferredLanguageOptions,
  patientInsuranceCoversGermany,
  prepaymentDueAtPatch,
  repeatIntakePatientId,
  repeatIntakePatientNumber,
  type LeadWizardEntryPoint,
} from "../model/lead-wizard.model";

import {
  createLead,
  createLeadProspect,
  downloadLeadAttachment,
  fetchLeadDetail,
  fetchLeadReferrerPatients,
  checkLeadContactEmail,
  fetchLeadGuardianCandidates,
  type ContactEmailLoginOwner,
  type LeadAttachmentImportRefusal,
  type LeadGuardianCandidate,
  importLeadAttachments,
  resolveFailedLead,
  updateLeadStatus,
  updateLeadWizard,
  wizardConvertLead,
  type ProspectDuplicateCandidate,
  type LeadReferrerPatientOption,
} from "../data/leads-api";
import { refusedLeadAttachments } from "../model/lead-attachment-import";
import { LeadAttachmentImportNotice } from "./lead-attachment-import-notice";
import { nameNeedsLatinSpelling } from "@/pages/patient-lead/name-transliteration";

type Tx = (ru: string, de: string) => string;
type StepId = "master_data" | "medical" | "service" | "documents" | "order" | "commercial" | "release";
type CaseListItem = { id: string };

type LeadWizardProps = {
  leadId: string | null;
  open: boolean;
  createMode?: boolean;
  entryPoint: LeadWizardEntryPoint;
  creationKey?: string;
  existingPatient?: PatientDetail | null;
  /**
   * Create mode only: the relation / contact the new lead is prefilled from
   * («Новая заявка для этого человека»). Sent as `source_person`; the server
   * copies identity data into the empty fields and names them back.
   */
  sourcePerson?: LeadSourcePerson | null;
  /** Offered on a representative of an open lead; the host opens a create-mode wizard with the source. */
  onNewRequestForPerson?: (source: LeadSourcePerson) => void;
  onOpenChange: (open: boolean) => void;
  onCreated?: (leadId: string) => void;
  onContactsSaved?: () => void;
  onConverted?: (patientId: string) => void;
  onArchived?: () => void;
  onShowDetails?: (leadId: string) => void;
  onOrderCreated?: (orderId: string) => void;
};

type TrustedContactDraft = {
  id: string;
  relatedPatientId: string;
  relatedPatientLabel: string;
  name: string;
  phone: string;
  email: string;
  relation: string;
  birthDate: string;
  address: string;
  /** Scope of information printed on the consent form next to the contact (owner 2026-10-26). */
  scopeCodes?: ConsentRecipientScope[];
  /** A representative's citizenships / birth data changed in the dialog, sent with the contact (F-11). */
  representativeDetails?: TrustedContactRepresentativeDetails;
};

/** What a person picked in the contact dialog brought (see `changeGuardianPatient`). */
type GuardianCandidatePrefill = {
  /** `${source}:${id}`: a new pick is a new key. */
  key: string;
  /** Empty when the person brought no details: the previous pick's values then leave. */
  values: RepresentativeDetails;
  hasDetails: boolean;
  source: "patient" | "lead";
  displayId: string | null;
  /** The patient card's identity document: a linked parent's GwG data take it after the save. */
  document: { type: string | null; number: string | null; validUntil: string | null } | null;
};

type AmlRiskTier = "high_risk" | "blacklist";

type AmlEnhancedDueDiligenceDraft = {
  internalRiskAnalysis: boolean;
  individualReview: boolean;
  riskReason: string;
  assetOrigin: string;
  /** Uploaded proofs of the origin of the assets (§ 15 Abs. 4 Nr. 2 GwG). */
  assetOriginEvidence: AssetOriginEvidence[];
  pepContractPartner: boolean;
  pepBeneficialOwner: boolean;
  /** Staff checked the PEP status (owner 2026-10-09: the lead is asked only with the enhanced check). */
  pepStatusChecked: boolean;
  /**
   * Staff's PEP review of each representative and of the payer, and the
   * server's day and reviewer of every review (owner decision 2026-10-23).
   */
  pepReviews: PepReviews;
  pepOfficeFunction: string;
  pepAssetOrigin: string;
  /** Links to sanctioned persons the lead (block J) or the payer stated. */
  sanctionsLinks: string;
  highRiskCountryTransaction: boolean;
  highRiskCountryResident: boolean;
  affectedThirdCountry: string;
  additionalContractPartnerInfo: string;
  additionalBeneficialOwnerInfo: string;
  intendedBusinessRelationshipInfo: string;
  contractPartnerAssetInfo: string;
  beneficialOwnerAssetInfo: string;
  transactionReasons: string;
  plannedAssetUse: string;
  managerApprovalName: string;
  unusualComplexOrLarge: boolean;
  unusualPattern: boolean;
  noLawfulPurpose: boolean;
  investigationResults: string;
  continuousMonitoring: string;
  additionalMeasures: string;
  reviewerName: string;
  reviewDate: string;
};

type Draft = {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthDate: string;
  legalSex: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  /** ISO codes (several citizenships), stored as `leads.citizenships` only. */
  citizenships: string[];
  passportExpiry: string;
  amlEnhancedDueDiligence: AmlEnhancedDueDiligenceDraft;
  language: string;
  whatsappNumber: string;
  hasInsurance: "" | "yes" | "no";
  insuranceCoversGermany: string;
  insuranceType: string;
  insuranceProvider: string;
  insuranceNumber: string;
  trustedContacts: TrustedContactDraft[];
  concern: string;
  anamnese: string;
  narrative: ClinicalNarrative | null;
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  allergies: ClinicalWarning[];
  caves: ClinicalWarning[];
  serviceNeeds: string[];
  serviceComments: Record<string, string>;
  discoverySource: string;
  discoverySourceOther: string;
  referrerPatientId: string;
  referrerPatientLabel: string;
  referrer: string;
  serviceNotes: string;
  specialties: string[];
  selectedSpecializationWorkTypeIds: string[];
  costEstimateAdditionalLanguage: CostEstimateAdditionalLanguage;
  programDateFrom: string;
  programDateTo: string;
  frameworkContractId: string;
  contractValidFrom: string;
  costThreshold: string;
  privacyConsent: boolean;
  healthcareConsent: boolean;
};

export type { ServiceLine } from "@/pages/orders/model/order-service-line";

type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type WizardDocumentKind =
  | "identity"
  | "confidentiality_release"
  | "privacy_information"
  | "privacy_consents"
  | "enhanced_due_diligence"
  | "gwg_identification"
  | "lead_self_disclosure";
type CommercialDocumentKind =
  | "framework_contract"
  | "single_order"
  | "order_cost_estimate"
  | "cost_estimate";

type AutosaveSnapshot = {
  draft: Draft;
  lines: ServiceLine[];
  paidAmount: string;
  prepayment: boolean;
  prepaymentAmount: string;
  step: StepId;
};

type StoredCommercialDraft = {
  lines: ServiceLine[];
  /** When the wizard saved the draft; absent on drafts saved before 2026-10-11. */
  savedAt: string | null;
  paidAmount: string;
  prepayment: boolean;
  prepaymentAmount: string;
};

type CommercialFlagsPatch = {
  signed_patient?: boolean;
  signed_agency?: boolean;
  prepayment_required?: boolean;
  prepayment_amount?: string;
  prepayment_due_at?: string;
};

type CommercialFlagKey = keyof CommercialFlagsPatch;

const ESTIMATED_OUTLAYS_DESCRIPTION = "Voraussichtliche Auslagen";
const ESTIMATED_OUTLAYS_REFERENCE_SUFFIX = ":estimated-outlays";

// Owner rule 2026-10-07: only the black list (with a confirmed sanctions
// match, decided by the server) requires the enhanced check; the longer
// high-risk list is an amber hint for staff. Both lists are the server's
// risk configuration (`useRiskCountryLists`), never hardcoded here.
function amlRiskForCountries(
  lists: RiskCountryLists,
  ...values: Array<string | null | undefined>
): {
  tier: AmlRiskTier;
  countries: string[];
} | null {
  // A stored value may be a country name of an older row.
  const countries = [...new Set(values.map((value) => countryCodeFromStoredValue(value)).filter(Boolean))]
    .filter((code) => isRiskCountry(code, lists));
  if (countries.length === 0) return null;
  return {
    tier: countries.some((code) => isBlacklistCountry(code, lists)) ? "blacklist" : "high_risk",
    countries,
  };
}

/**
 * The country boxes of the § 15 form (QA 2026-10-10 B4): "Vertragspartner ist
 * dort niedergelassen oder wohnhaft" only when the patient lives there; a
 * citizenship of the patient and every country of a third-party payer
 * (residence, seat, citizenship) tick "Transaktion mit Bezug zu einem
 * Drittstaat mit hohem Risiko" — the payer is not the contract partner.
 */
function amlCountryBoxes(
  lists: RiskCountryLists,
  country: string | null | undefined,
  citizenships: readonly string[],
  payerCountries: readonly string[],
): { resident: boolean; transaction: boolean } {
  return {
    resident: amlRiskForCountries(lists, country) !== null,
    transaction: amlRiskForCountries(lists, ...citizenships, ...payerCountries) !== null,
  };
}

/**
 * Why the enhanced check is required (owner rule 2026-10-07): the server's
 * reasons with the black-list countries, or a black-list country the wizard
 * shows before it is saved; "" while nothing requires it. Required by the
 * risk level alone, it points to the risk assessment: the level label itself
 * is not shown (owner 2026-10-19), but a required check never stands there
 * without a reason. An unsaved black-list country names itself before the
 * level the server still reports.
 */
function amlEnhancedCheckRequiredText(
  check: LeadEnhancedCheck | null,
  blacklistCountries: readonly string[],
  tx: Tx,
  lang: Lang,
): string {
  const triggers = enhancedCheckTriggers(check);
  const ruleTriggers = triggers.filter((reason) => reason !== RISK_ASSESSMENT_REASON);
  const reasons = ruleTriggers.length > 0
    ? enhancedCheckReasonsText(ruleTriggers, tx)
    : blacklistCountries.length > 0
      ? tx("страна из чёрного списка", "Land auf der Blacklist")
      : enhancedCheckReasonsText(triggers, tx);
  if (!reasons) return "";
  const countries = [...new Set([...(check?.countries ?? []), ...blacklistCountries])]
    .map((code) => countryLabel(code, lang))
    .join(", ");
  return countries ? `${reasons} (${countries})` : reasons;
}

/**
 * Whether the server judged the enhanced check for good: loaded (the lead
 * exists) and no possible sanctions match waits. Only then may the wizard say
 * "not required" (QA 2026-10-10: before the lead existed it said so next to a
 * flagged name).
 */
function amlCheckSettled(check: LeadEnhancedCheck | null): boolean {
  return Boolean(check) && !check?.reasons.includes(SANCTIONS_REVIEW_PENDING);
}

/** Information next to the check, never a requirement: an open sanctions match, a high-risk country, a PEP. */
function amlEnhancedCheckHints({
  check,
  required,
  highRiskCountries,
  pep,
  tx,
  lang,
}: {
  check: LeadEnhancedCheck | null;
  /** The check is required (the server's answer or an unsaved black-list country). */
  required: boolean;
  highRiskCountries: readonly string[];
  pep: boolean;
  tx: Tx;
  lang: Lang;
}): string[] {
  const hints: string[] = [];
  if (check?.reasons.includes(SANCTIONS_REVIEW_PENDING)) {
    hints.push(enhancedCheckReasonsText([SANCTIONS_REVIEW_PENDING], tx));
  }
  // "Decided separately" would contradict a required check (level 2 and more,
  // QA 2026-10-10; also an unsaved black-list country next to a listed one).
  if (highRiskCountries.length > 0 && !required) {
    hints.push(
      highRiskCountryHint(highRiskCountries.map((code) => countryLabel(code, lang)).join(", "), tx, amlCheckSettled(check)),
    );
  }
  if (pep) hints.push(pepEnhancedCheckHint(tx));
  return hints;
}

function blankAmlEnhancedDueDiligence(): AmlEnhancedDueDiligenceDraft {
  return {
    // Ticked only when the enhanced check is required (see `openAmlSheet`):
    // a voluntary check is the finding of the individual review (QA 2026-10-11).
    internalRiskAnalysis: false,
    individualReview: false,
    riskReason: "",
    assetOrigin: "",
    assetOriginEvidence: [],
    pepContractPartner: false,
    pepBeneficialOwner: false,
    pepStatusChecked: false,
    pepReviews: {},
    pepOfficeFunction: "",
    pepAssetOrigin: "",
    sanctionsLinks: "",
    highRiskCountryTransaction: false,
    highRiskCountryResident: false,
    affectedThirdCountry: "",
    additionalContractPartnerInfo: "",
    additionalBeneficialOwnerInfo: "",
    intendedBusinessRelationshipInfo: "",
    contractPartnerAssetInfo: "",
    beneficialOwnerAssetInfo: "",
    transactionReasons: "",
    plannedAssetUse: "",
    managerApprovalName: "",
    unusualComplexOrLarge: false,
    unusualPattern: false,
    noLawfulPurpose: false,
    investigationResults: "",
    continuousMonitoring: "",
    additionalMeasures: "",
    reviewerName: "",
    reviewDate: appDateKey(),
  };
}

type MasterFieldKey =
  | "referrerPatientId"
  | "guardian"
  | "firstName"
  | "lastName"
  | "birthDate"
  | "legalSex"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "zip"
  | "insuranceType"
  | "insuranceProvider"
  | "insuranceNumber";

type MasterValidationErrors = Partial<Record<MasterFieldKey, string>>;

type ValidationIssue = {
  key: string;
  step: StepId;
  message: string;
  fieldId?: string;
};

type ValidationContext =
  | { kind: "master" }
  /** `qualification`: only what the server's qualification asks for (the rest blocks the conversion alone). */
  | { kind: "documents"; scope?: "qualification" }
  | { kind: "order" }
  | { kind: "server"; reasons: string[] };

type WizardDocumentPreview = {
  contentType: string;
  id: string;
  kind: "image" | "pdf";
  title: string;
  url: string;
};

const ignoreDocumentPreviewReady = () => undefined;

const AUTOSAVE_DELAY_MS = 800;
/** The first save of a new lead found an existing patient with the same name and birth date. */
class ProspectDuplicateError extends Error {}
const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;
const LeadMedicalIntakeForm = lazy(() =>
  import("./lead-medical-intake-form").then((module) => ({
    default: module.LeadMedicalIntakeForm,
  })),
);
const SERVICE_CONCERN_ID = "lead-wizard-concern";
const RISK_ASSESSMENT_SECTION_ID = "lead-wizard-risk-assessment";
const ENHANCED_CHECK_SECTION_ID = "lead-wizard-enhanced-check";
/** The preview's refusal leads to the risk assessment instead of a person's identity data. */
const PREVIEW_JUMP_RISK = "risk-assessment";
/** The preview's refusal of an organisation's GwG sheet leads to "who pays". */
const PREVIEW_JUMP_PAYER = "payer-declaration";
/** Suffix of a preview jump to a person's proof of authority (DEV 2026-10-27). */
const AUTHORITY_JUMP = "#authority";
const SERVICE_SPECIALTIES_ID = "lead-wizard-specialties";
const MEDICAL_ANAMNESE_ID = "lead-wizard-anamnese";
const ORDER_DATE_FROM_ID = "lead-wizard-program-date-from";
const ORDER_DATE_TO_ID = "lead-wizard-program-date-to";
const ORDER_SERVICE_SELECT_ID = "lead-wizard-order-service-select";
const PREPAYMENT_AMOUNT_ID = "lead-wizard-prepayment-amount";
const PRIVACY_CONSENT_ID = "lead-wizard-privacy-consent";
const HEALTHCARE_CONSENT_ID = "lead-wizard-healthcare-consent";
const CONFIDENTIALITY_RELEASE_ID = "lead-wizard-confidentiality-release";
const SELF_DISCLOSURE_SECTION_ID = "lead-wizard-self-disclosure";
/** Server blocking reason (crates/server/src/routes/leads.rs `SELF_DISCLOSURE_UNSIGNED`). */
const SELF_DISCLOSURE_UNSIGNED_REASON = "Patient form is not signed";
/**
 * Server conversion reason: the contract data of the representatives (birth
 * place, address, citizenships, identity document …) is incomplete. The
 * readiness names the keys in `contract_details_missing` (`rep1_birth_place`,
 * `rep2_id_valid_until` …; the same keys as `representative_details_incomplete`).
 */
const CONTRACT_DETAILS_MISSING_REASON = "Contract details of the representatives are missing";
const PRIVACY_DOCUMENT_ID = "lead-wizard-privacy-document";
const IDENTITY_DOCUMENT_ID = "lead-wizard-identity-document";
const FRAMEWORK_DOCUMENT_ID = "lead-wizard-framework-document";
const COST_THRESHOLD_ID = "lead-wizard-cost-threshold";
const ORDER_DOCUMENT_ID = "lead-wizard-order-document";
const ORDER_COST_ESTIMATE_DOCUMENT_ID = "lead-wizard-order-cost-estimate-document";
const ORDER_SIGNATURES_ID = "lead-wizard-order-signatures";
const QUOTE_SECTION_ID = "lead-wizard-quote";
const COST_ESTIMATE_DOCUMENT_ID = "lead-wizard-cost-estimate-document";
const COST_ESTIMATE_WORK_TYPES_ID = "lead-wizard-cost-estimate-work-types";
/** Server readiness reason (crates/server/src/routes/leads.rs): the VKS lists medical work types only. */
const COST_ESTIMATE_WORK_TYPES_REASON = "Medical work types are not selected";
const COST_ESTIMATE_OUTDATED_REASON = "Preliminary cost calculation document is missing";
const COST_ESTIMATE_WORK_TYPES_STEP = { ru: "Оформление заказа", de: "Auftragserfassung" };
const WIZARD_DOCUMENT_SECTION_CLASS = "min-w-0 rounded-xl border border-border/50 bg-card p-3.5";

/** Each wizard group sits on its own card against the shared muted canvas. */
function Section({ className, ...props }: ComponentProps<typeof WorkspaceSection>) {
  return <WorkspaceSection {...props} className={cn(WIZARD_DOCUMENT_SECTION_CLASS, className)} />;
}

const DISCOVERY_SOURCE_OPTIONS = [
  { value: "customer_referral", ru: "Рекомендация клиента", de: "Empfehlung eines Kunden" },
  { value: "online", ru: "Онлайн", de: "Online" },
  { value: "employee_referral", ru: "Рекомендация сотрудника", de: "Empfehlung eines Mitarbeiters" },
  { value: "medical_referral", ru: "Рекомендация врача или клиники", de: "Empfehlung eines Arztes oder einer Klinik" },
  { value: "partner_referral", ru: "Партнёр или агентство", de: "Partner oder Agentur" },
  { value: "insurance_referral", ru: "Страховая компания", de: "Versicherung" },
  { value: "social_media", ru: "Социальные сети", de: "Soziale Medien" },
  { value: "advertising", ru: "Реклама", de: "Werbung" },
  { value: "event", ru: "Мероприятие", de: "Veranstaltung" },
  { value: "other", ru: "Другое", de: "Sonstiges" },
] as const;

function referrerPatientOptionLabel(option: LeadReferrerPatientOption) {
  const name = [option.title, option.first_name, option.last_name]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  return [option.patient_id, name].filter(Boolean).join(" · ");
}

const MASTER_FIELD_ORDER: MasterFieldKey[] = [
  "referrerPatientId",
  "guardian",
  "firstName",
  "lastName",
  "birthDate",
  "legalSex",
  "email",
  "phone",
  "street",
  "zip",
  "city",
  "insuranceType",
  "insuranceProvider",
  "insuranceNumber",
];

const MASTER_FIELD_IDS: Record<MasterFieldKey, string> = {
  referrerPatientId: "lead-wizard-referrer-patient",
  guardian: "lead-wizard-guardian",
  firstName: "lead-wizard-first-name",
  lastName: "lead-wizard-last-name",
  birthDate: "lead-wizard-birth-date",
  legalSex: "lead-wizard-legal-sex",
  email: "lead-wizard-email",
  phone: "lead-wizard-phone",
  street: "lead-wizard-street",
  city: "lead-wizard-city",
  zip: "lead-wizard-zip",
  insuranceType: "lead-wizard-insurance-type",
  insuranceProvider: "lead-wizard-insurance-provider",
  insuranceNumber: "lead-wizard-insurance-number",
};

/** Lead columns a refusal of the server names (`field` of a 422), by wizard field. */
const SERVER_MASTER_FIELDS: Record<string, MasterFieldKey> = {
  first_name: "firstName",
  last_name: "lastName",
  date_of_birth: "birthDate",
  legal_sex: "legalSex",
  email: "email",
  phone: "phone",
};

/** Ids of the other step-1 controls, for their `<label for>` (QA 2026-10-11, N-01). */
const STEP1_CONTROL_IDS = {
  discoverySource: "lead-wizard-discovery-source",
  discoverySourceOther: "lead-wizard-discovery-source-other",
  middleName: "lead-wizard-middle-name",
  suffix: "lead-wizard-name-suffix",
  whatsapp: "lead-wizard-whatsapp",
  language: "lead-wizard-language",
  region: "lead-wizard-region",
  citizenships: "lead-wizard-citizenships",
  hasInsurance: "lead-wizard-has-insurance",
  insuranceCoversGermany: "lead-wizard-insurance-covers-germany",
} as const;

/** Error ids of the step-1 fields the patient portal knows (see `Step1PortalProvider`). */
const STEP1_PORTAL_ERROR_IDS: Record<string, string> = {
  firstName: `${MASTER_FIELD_IDS.firstName}-error`,
  lastName: `${MASTER_FIELD_IDS.lastName}-error`,
  birthDate: `${MASTER_FIELD_IDS.birthDate}-error`,
  legalSex: `${MASTER_FIELD_IDS.legalSex}-error`,
  phone: `${MASTER_FIELD_IDS.phone}-error`,
  street: `${MASTER_FIELD_IDS.street}-error`,
  city: `${MASTER_FIELD_IDS.city}-error`,
  zip: `${MASTER_FIELD_IDS.zip}-error`,
};

const STEPS: Array<{ id: StepId; ru: string; de: string }> = [
  { id: "master_data", ru: "Данные клиента", de: "Personendaten" },
  { id: "medical", ru: "Медицинская характеристика", de: "Medizinische Merkmale" },
  { id: "service", ru: "Сервисная история", de: "Servicehistorie" },
  { id: "documents", ru: "Документы", de: "Unterlagen" },
  { id: "order", ru: "Оформление заказа", de: "Auftragserfassung" },
  { id: "commercial", ru: "Договор и смета", de: "Vertrag & Angebot" },
  { id: "release", ru: "Создание пациента", de: "Freigabe" },
];

const STEP_ICONS: Record<StepId, LucideIcon> = {
  master_data: UserRound,
  medical: HeartPulse,
  service: History,
  documents: FileText,
  order: ClipboardList,
  commercial: ReceiptText,
  release: UserRoundCheck,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function inputString(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function inputStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function costEstimateAdditionalLanguage(value: unknown): CostEstimateAdditionalLanguage {
  const normalized = inputString(value).toLowerCase();
  return normalized === "ru" || normalized === "en" || normalized === "es"
    ? normalized
    : "";
}

function germanDocumentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value.trim();
}

function questionnairePayload(lead: LeadDetail) {
  const raw = asRecord(lead.raw_payload);
  return asRecord(raw?.["payload"]);
}

function questionnaireText(lead: LeadDetail, ...keys: string[]) {
  const payload = questionnairePayload(lead);
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function emptyTrustedContact(): TrustedContactDraft {
  return {
    id: crypto.randomUUID(),
    relatedPatientId: "",
    relatedPatientLabel: "",
    name: "",
    phone: "",
    email: "",
    relation: "",
    birthDate: "",
    address: "",
  };
}

function trustedContactsFromLead(lead: LeadDetail): TrustedContactDraft[] {
  const storedContacts = Array.isArray(lead.trusted_contacts)
    ? lead.trusted_contacts.flatMap((contact) => {
        const name = contact.name?.trim();
        if (!name) return [];
        return [{
          id: contact.id || crypto.randomUUID(),
          relatedPatientId: contact.related_patient_id ?? "",
          relatedPatientLabel: name,
          name,
          phone: contact.phone ?? "",
          email: contact.email ?? "",
          relation: contact.relation ?? "",
          birthDate: contact.birth_date ?? "",
          address: contact.address ?? "",
          scopeCodes: normalizeScopeCodes(contact.scope_codes ?? []),
        }];
      })
    : [];
  if (storedContacts.length > 0) return storedContacts;

  const legacyName = lead.trusted_contact_name
    ?? questionnaireText(lead, "emergencyContactName", "trustedContactName");
  if (!legacyName.trim()) return [];
  return [{
    id: crypto.randomUUID(),
    relatedPatientId: "",
    relatedPatientLabel: "",
    name: legacyName.trim(),
    phone: lead.trusted_contact_phone
      ?? questionnaireText(lead, "emergencyContactPhone", "trustedContactPhone"),
    email: lead.trusted_contact_email
      ?? questionnaireText(lead, "emergencyContactEmail", "trustedContactEmail"),
    relation: lead.trusted_contact_relation
      ?? questionnaireText(lead, "emergencyContactRelation", "trustedContactRelation"),
    birthDate: lead.trusted_contact_birth_date ?? "",
    address: lead.trusted_contact_address
      ?? questionnaireText(lead, "emergencyContactAddress", "trustedContactAddress"),
  }];
}

function storedCommercialDraftFromLead(lead: LeadDetail): StoredCommercialDraft | null {
  const stored = asRecord(lead.wizard_state?.["commercial_draft"]);
  if (!stored) return null;

  const lines = Array.isArray(stored.lines)
    ? stored.lines.flatMap((value, index) => {
        const line = asRecord(value);
        if (!line) return [];
        return [{
          id: inputString(line.id, `stored-line-${index + 1}`),
          agencyServiceId:
            typeof line.agency_service_id === "string" ? line.agency_service_id : null,
          agencyServicePriceVersionId:
            typeof line.agency_service_price_version_id === "string"
              ? line.agency_service_price_version_id
              : null,
          clientReference:
            typeof line.client_reference === "string" ? line.client_reference : null,
          managedByWizard: line.managed_by_wizard !== false,
          isCostPassthrough: line.is_cost_passthrough === true,
          description: inputString(line.description),
          catalogDescription: inputString(line.catalog_description),
          catalogDescriptionItems: serviceDescriptionItems(
            Array.isArray(line.catalog_description_items) ? line.catalog_description_items as ServiceDescriptionItem[] : undefined,
            inputString(line.catalog_description),
          ),
          catalogUnitLabel: inputString(line.catalog_unit_label),
          currency: inputString(line.currency, "EUR"),
          quantity: inputString(line.quantity, "1"),
          price: inputString(line.price),
          vat: inputString(line.vat, "19"),
        }];
      })
    : [];

  return {
    lines,
    savedAt: typeof stored.saved_at === "string" ? stored.saved_at : null,
    paidAmount: inputString(stored.paid_amount),
    prepayment: stored.prepayment === true,
    prepaymentAmount: inputString(stored.prepayment_amount),
  };
}

/** Technical line under the autosave error: which request failed and what the server said. */
function autosaveErrorDetailText(stage: string, error: unknown) {
  const status = error instanceof ApiRequestError && error.status ? ` · HTTP ${error.status}` : "";
  const message = error instanceof Error ? error.message.trim().slice(0, 200) : "";
  return `${stage}${status}${message ? ` · ${message}` : ""}`;
}

function autosaveSnapshotSignature(snapshot: AutosaveSnapshot) {
  // Moving between tabs is UI navigation, not a data change. Persist the
  // current tab with the next real save without issuing a write for each click.
  return JSON.stringify({
    draft: snapshot.draft,
    lines: snapshot.lines,
    paidAmount: snapshot.paidAmount,
    prepayment: snapshot.prepayment,
    prepaymentAmount: snapshot.prepaymentAmount,
  });
}

function autosavePayload(
  snapshot: AutosaveSnapshot,
  previousWizardState: Record<string, unknown>,
  includeClinicalDraft = true,
) {
  const { draft, lines, paidAmount, prepayment, prepaymentAmount, step } = snapshot;
  const payload: Record<string, unknown> & { wizard_state: Record<string, unknown> } = {
    date_of_birth: draft.birthDate || undefined,
    legal_sex: draft.legalSex || undefined,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    middle_name: draft.middleName.trim(),
    suffix: draft.suffix.trim(),
    whatsapp_number: draft.whatsappNumber.trim(),
    // Cleared answers persist (owner decision 2026-10-23): `null` / empty clears the stored
    // value; left out, it stayed. The required date of birth and sex above stay left out when empty.
    has_insurance: draft.hasInsurance ? draft.hasInsurance === "yes" : null,
    // Empty clears the stored answer (self-pay resets it); left out, it stayed.
    insurance_covers_germany: draft.insuranceCoversGermany,
    insurance_type: draft.insuranceType || null,
    insurance_provider: draft.insuranceProvider.trim(),
    insurance_number: draft.insuranceNumber.trim(),
    trusted_contacts: draft.trustedContacts.map((contact) => ({
      id: contact.id,
      related_patient_id: contact.relatedPatientId || null,
      name: contact.name.trim(),
      phone: contact.phone.trim() || null,
      email: contact.email.trim() || null,
      relation: contact.relation.trim() || null,
      birth_date: contact.birthDate || null,
      address: contact.address.trim() || null,
    })),
    street_address: draft.street.trim(),
    city: draft.city.trim(),
    state: draft.state.trim(),
    zip_code: draft.zip.trim(),
    country: draft.country.trim(),
    citizenships: normalizeCitizenships(draft.citizenships),
    primary_language: draft.language.trim(),
    primary_concern_text: draft.concern.trim(),
    additional_concerns: draft.anamnese.trim(),
    services: draft.serviceNeeds,
    needs_interpreter: draft.serviceNeeds.includes("interpreter_support"),
    notes: draft.serviceNotes.trim(),
    requested_specialties: draft.specialties,
    consent_privacy_practices: draft.privacyConsent,
    consent_healthcare: draft.healthcareConsent,
    referrer_patient_id: draft.discoverySource === "customer_referral"
      ? draft.referrerPatientId
      : "",
    wizard_state: {
      ...previousWizardState,
      step,
      onboarding_version: 3,
      discovery_source: draft.discoverySource,
      discovery_source_other: draft.discoverySource === "other"
        ? draft.discoverySourceOther
        : "",
      referrer_patient_id: draft.discoverySource === "customer_referral"
        ? draft.referrerPatientId || null
        : null,
      referrer_patient_label: draft.discoverySource === "customer_referral"
        ? draft.referrerPatientLabel
        : "",
      referrer: draft.referrer,
      program_date_from: draft.programDateFrom,
      program_date_to: draft.programDateTo,
      framework_contract_id: draft.frameworkContractId || null,
      contract_valid_from: draft.contractValidFrom,
      cost_threshold: draft.costThreshold,
      // `citizenships` is the one source; the legacy key of older leads is
      // dropped (undefined is left out of the JSON body).
      registration_country: undefined,
      // The identity document data entered from the scan is the one place of
      // "valid until" (2026-10-24); the wizard's old key is dropped the same way.
      passport_expiry: undefined,
      aml_enhanced_due_diligence: draft.amlEnhancedDueDiligence,
      selected_specialization_work_type_ids:
        draft.selectedSpecializationWorkTypeIds,
      cost_estimate_additional_language:
        draft.costEstimateAdditionalLanguage || null,
      service_comments: draft.serviceNeeds.reduce<Record<string, string>>((comments, value) => {
        const comment = draft.serviceComments[value];
        if (comment?.trim()) comments[value] = comment;
        return comments;
      }, {}),
      clinical_draft: includeClinicalDraft
        ? {
            narrative: draft.narrative,
            diagnoses: draft.diagnoses,
            medications: draft.medications,
            allergies: draft.allergies,
            caves: draft.caves,
          }
        : null,
      commercial_draft: {
        lines: lines.map((line) => ({
          id: line.id,
          agency_service_id: line.agencyServiceId,
          agency_service_price_version_id: line.agencyServicePriceVersionId,
          client_reference: line.clientReference,
          managed_by_wizard: line.managedByWizard !== false,
          is_cost_passthrough: line.isCostPassthrough === true,
          description: line.description,
          catalog_description: line.catalogDescription,
          catalog_description_items: serviceDescriptionItems(line.catalogDescriptionItems, line.catalogDescription),
          catalog_unit_label: line.catalogUnitLabel,
          currency: line.currency,
          quantity: line.quantity,
          price: line.price,
          vat: line.vat,
        })),
        paid_amount: paidAmount,
        prepayment,
        prepayment_amount: prepaymentAmount,
        saved_at: new Date().toISOString(),
      },
    },
  };

  if (draft.firstName.trim()) payload.first_name = draft.firstName.trim();
  if (draft.lastName.trim()) payload.last_name = draft.lastName.trim();

  return payload;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function nullableString(record: Record<string, unknown>, ...keys: string[]) {
  return firstString(record, ...keys).trim() || null;
}

function firstBoolean(record: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => record[key] === true);
}

function amlEnhancedDueDiligenceFromLead(lead: LeadDetail): AmlEnhancedDueDiligenceDraft {
  const stored = recordFromUnknown(lead.wizard_state?.["aml_enhanced_due_diligence"]);
  const defaults = blankAmlEnhancedDueDiligence();
  return {
    internalRiskAnalysis: stored["internalRiskAnalysis"] === true,
    individualReview: stored["individualReview"] === true,
    riskReason: inputString(stored["riskReason"]),
    assetOrigin: inputString(stored["assetOrigin"]),
    assetOriginEvidence: parseAssetOriginEvidence(stored["assetOriginEvidence"]),
    pepContractPartner: stored["pepContractPartner"] === true,
    pepBeneficialOwner: stored["pepBeneficialOwner"] === true,
    pepStatusChecked: stored["pepStatusChecked"] === true,
    pepReviews: parsePepReviews(stored["pepReviews"]),
    pepOfficeFunction: inputString(stored["pepOfficeFunction"]),
    pepAssetOrigin: inputString(stored["pepAssetOrigin"]),
    sanctionsLinks: inputString(stored["sanctionsLinks"]),
    highRiskCountryTransaction: stored["highRiskCountryTransaction"] === true,
    highRiskCountryResident: stored["highRiskCountryResident"] === true,
    affectedThirdCountry: inputString(stored["affectedThirdCountry"]),
    additionalContractPartnerInfo: inputString(stored["additionalContractPartnerInfo"]),
    additionalBeneficialOwnerInfo: inputString(stored["additionalBeneficialOwnerInfo"]),
    intendedBusinessRelationshipInfo: inputString(stored["intendedBusinessRelationshipInfo"]),
    contractPartnerAssetInfo: inputString(stored["contractPartnerAssetInfo"]),
    beneficialOwnerAssetInfo: inputString(stored["beneficialOwnerAssetInfo"]),
    transactionReasons: inputString(stored["transactionReasons"]),
    plannedAssetUse: inputString(stored["plannedAssetUse"]),
    managerApprovalName: inputString(stored["managerApprovalName"]),
    unusualComplexOrLarge: stored["unusualComplexOrLarge"] === true,
    unusualPattern: stored["unusualPattern"] === true,
    noLawfulPurpose: stored["noLawfulPurpose"] === true,
    investigationResults: inputString(stored["investigationResults"]),
    continuousMonitoring: inputString(stored["continuousMonitoring"]),
    additionalMeasures: inputString(stored["additionalMeasures"]),
    reviewerName: inputString(stored["reviewerName"]),
    reviewDate: inputString(stored["reviewDate"], defaults.reviewDate),
  };
}

function serviceCommentsFromLead(lead: LeadDetail) {
  const stored = recordFromUnknown(lead.wizard_state?.["service_comments"]);
  return Object.entries(stored).reduce<Record<string, string>>((comments, [value, comment]) => {
    if (typeof comment !== "string" || !value.trim()) return comments;
    comments[normalizeLeadServiceValue(value)] = comment;
    return comments;
  }, {});
}

function normalizedLanguageCode(value: string | null | undefined) {
  const key = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!key) return "";
  const aliases: Record<string, string> = {
    deutsch: "de",
    german: "de",
    englisch: "en",
    english: "en",
    russisch: "ru",
    russian: "ru",
    "русский": "ru",
    ukrainisch: "uk",
    ukrainian: "uk",
    "українська": "uk",
    arabisch: "ar",
    arabic: "ar",
    portugiesisch: "pt",
    portuguese: "pt",
    "französisch": "fr",
    french: "fr",
    spanisch: "es",
    spanish: "es",
    italienisch: "it",
    italian: "it",
    "türkisch": "tr",
    turkish: "tr",
    polnisch: "pl",
    polish: "pl",
    tschechisch: "cs",
    czech: "cs",
    "dänisch": "da",
    danish: "da",
    griechisch: "el",
    greek: "el",
    lettisch: "lv",
    latvian: "lv",
    chinesisch: "zh",
    chinese: "zh",
    persisch: "fa",
    persian: "fa",
    farsi: "fa",
    urdu: "ur",
  };
  const normalized = aliases[key] ?? key.split("-")[0] ?? "";
  return LANGUAGE_OPTIONS.some((option) => option.value === normalized) ? normalized : "";
}

function clinicalRowsFromLead(lead: LeadDetail) {
  const clinical = recordFromUnknown(lead.wizard_state?.["clinical_draft"]);
  const rows = <T,>(key: string, map: (row: Record<string, unknown>, index: number) => T) => (
    Array.isArray(clinical[key])
      ? (clinical[key] as unknown[]).map((item, index) => map(recordFromUnknown(item), index))
      : []
  );
  const narrativeRow = asRecord(clinical["narrative"]);
  const fallbackAnamnese = lead.additional_concerns?.trim() || null;
  const narrative: ClinicalNarrative | null = narrativeRow || fallbackAnamnese
      ? {
        id: narrativeRow && typeof narrativeRow.id === "string" ? narrativeRow.id : null,
        case_id: narrativeRow
          ? nullableString(narrativeRow, "case_id", "caseId")
          : null,
        anamnese_aktuelle: narrativeRow
          ? nullableString(narrativeRow, "anamnese_aktuelle") ?? fallbackAnamnese
          : fallbackAnamnese,
        anamnese_vorgeschichte: narrativeRow
          ? nullableString(narrativeRow, "anamnese_vorgeschichte")
          : null,
        anamnese_vegetative: narrativeRow
          ? nullableString(narrativeRow, "anamnese_vegetative")
          : null,
        anamnese_sozial: narrativeRow
          ? nullableString(narrativeRow, "anamnese_sozial")
          : null,
        anamnese_familie: narrativeRow
          ? nullableString(narrativeRow, "anamnese_familie")
          : null,
        beurteilung: narrativeRow ? nullableString(narrativeRow, "beurteilung") : null,
        anamnese_at: narrativeRow
          ? nullableString(narrativeRow, "anamnese_at", "anamneseAt")
          : null,
        is_active: narrativeRow?.is_active !== false,
        created_at: narrativeRow ? nullableString(narrativeRow, "created_at") : null,
        updated_at: narrativeRow ? nullableString(narrativeRow, "updated_at") : null,
      }
    : null;

  return {
    narrative,
    diagnoses: rows("diagnoses", (row, index): ClinicalDiagnosis => {
      const kindValue = firstString(row, "kind");
      const certaintyValue = firstString(row, "certainty");
      const chronificationValue = firstString(row, "chronifizierung", "chronification");
      const statusValue = firstString(row, "status");
      const sourceMode = firstString(row, "source_mode", "sourceMode");
      return {
        id: null,
        case_id: nullableString(row, "case_id", "caseId"),
        cid: firstString(row, "cid", "id") || `lead-diagnosis-${index + 1}`,
        parent_cid: nullableString(row, "parent_cid", "parentCid", "parent_id"),
        parent_id: null,
        kind: ["main", "secondary", "prozedur"].includes(kindValue)
          ? kindValue as ClinicalDiagnosis["kind"]
          : index === 0 ? "main" : "secondary",
        label: firstString(row, "label"),
        certainty: ["verdacht", "bestaetigt", "zustand_nach"].includes(certaintyValue)
          ? certaintyValue as ClinicalDiagnosis["certainty"]
          : "bestaetigt",
        chronifizierung: ["akut", "chronisch", "rezidivierend"].includes(chronificationValue)
          ? chronificationValue as ClinicalDiagnosis["chronifizierung"]
          : null,
        icd_code: nullableString(row, "icd_code", "icdCode"),
        ops_code: nullableString(row, "ops_code", "opsCode"),
        diagnosed_on: nullableString(row, "diagnosed_on", "diagnosedOn"),
        note: nullableString(row, "note"),
        source_mode: sourceMode === "extern" ? "extern" : "intern",
        provider_id: nullableString(row, "provider_id", "providerId"),
        provider_name: nullableString(row, "provider_name", "providerName"),
        doctor_id: nullableString(row, "doctor_id", "doctorId"),
        doctor_name: nullableString(row, "doctor_name", "doctorName"),
        doctor_title: nullableString(row, "doctor_title", "doctorTitle"),
        doctor_fachbereich: nullableString(row, "doctor_fachbereich", "doctorFachbereich"),
        external_clinic: nullableString(row, "external_clinic", "externalClinic"),
        external_doctor: nullableString(row, "external_doctor", "externalDoctor"),
        external_country: nullableString(row, "external_country", "externalCountry"),
        treating_doctor_id: nullableString(row, "treating_doctor_id", "treatingDoctorId"),
        treating_doctor_name: nullableString(row, "treating_doctor_name", "treatingDoctorName"),
        treating_doctor_title: nullableString(row, "treating_doctor_title", "treatingDoctorTitle"),
        treating_none: firstBoolean(row, "treating_none", "treatingNone"),
        status: ["active", "chronic", "resolved"].includes(statusValue)
          ? statusValue as ClinicalDiagnosis["status"]
          : chronificationValue === "chronisch" ? "chronic" : "active",
      };
    }),
    medications: rows("medications", (row, index): ClinicalMedication => {
      const categoryValue = firstString(row, "category");
      const statusValue = firstString(row, "status");
      const legacyStrength = [firstString(row, "dose"), firstString(row, "doseUnit")]
        .filter(Boolean)
        .join(" ");
      return {
        id: firstString(row, "id") || `lead-medication-${index + 1}`,
        provider_id: nullableString(row, "provider_id", "providerId"),
        provider_name: nullableString(row, "provider_name", "providerName"),
        doctor_id: nullableString(row, "doctor_id", "doctorId", "prescriberId"),
        doctor_name: nullableString(row, "doctor_name", "doctorName", "prescriber"),
        doctor_title: nullableString(row, "doctor_title", "doctorTitle"),
        doctor_fachbereich: nullableString(row, "doctor_fachbereich", "doctorFachbereich"),
        category: ["dauer", "besondere", "selbst"].includes(categoryValue)
          ? categoryValue as ClinicalMedication["category"]
          : firstString(row, "medicationType") === "permanent" ? "dauer" : "besondere",
        wirkstoff:
          nullableString(row, "wirkstoff", "activeIngredient") ??
          nullableString(row, "handelsname", "name"),
        handelsname: firstString(row, "handelsname", "name"),
        staerke: (nullableString(row, "staerke") ?? legacyStrength) || null,
        form: nullableString(row, "form"),
        einnahmeform: nullableString(row, "einnahmeform", "route"),
        dose_morgens: nullableString(row, "dose_morgens", "doseMorning"),
        dose_mittags: nullableString(row, "dose_mittags", "doseNoon"),
        dose_abends: nullableString(row, "dose_abends", "doseEvening"),
        dose_nachts: nullableString(row, "dose_nachts", "doseNight"),
        einheit: nullableString(row, "einheit", "unit"),
        hinweis: nullableString(row, "hinweis", "schedule", "note"),
        grund: nullableString(row, "grund", "reason"),
        verordnet_am: nullableString(row, "verordnet_am", "prescribedOn"),
        einnahme_von: nullableString(row, "einnahme_von", "since"),
        einnahme_bis: nullableString(row, "einnahme_bis", "expiryDate"),
        status: ["aktiv", "pausiert", "abgesetzt", "geplant"].includes(statusValue)
          ? statusValue as ClinicalMedication["status"]
          : "aktiv",
        apothekenpflichtig: firstBoolean(row, "apothekenpflichtig", "pharmacyOnly"),
        rezeptpflichtig: firstBoolean(row, "rezeptpflichtig", "prescriptionOnly"),
        btm: firstBoolean(row, "btm"),
        aut_idem_sperre: firstBoolean(row, "aut_idem_sperre", "autIdemBlocked"),
        abgabebeschraenkung: firstBoolean(row, "abgabebeschraenkung", "dispensingRestricted"),
        sonstige_vermerke: nullableString(row, "sonstige_vermerke", "otherNotes"),
        on_hold: firstBoolean(row, "on_hold", "onHold"),
        hold_from: nullableString(row, "hold_from", "holdFrom"),
        hold_until: nullableString(row, "hold_until", "holdUntil"),
        hold_note: nullableString(row, "hold_note", "holdNote"),
      };
    }),
    allergies: rows("allergies", (row, index): ClinicalWarning => ({
      id: firstString(row, "id") || `lead-allergy-${index + 1}`,
      kind: "allergie",
      label: firstString(row, "label"),
      reaction: nullableString(row, "reaction"),
      severity: nullableString(row, "severity"),
      note: nullableString(row, "note"),
    })),
    caves: rows("caves", (row, index): ClinicalWarning => ({
      id: firstString(row, "id") || `lead-cave-${index + 1}`,
      kind: "cave",
      label: firstString(row, "label"),
      reaction: null,
      severity: null,
      note: nullableString(row, "note"),
    })),
  };
}

const CLINICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clinicalText(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function isPersistedClinicalId(value: string | null | undefined): value is string {
  return Boolean(value && CLINICAL_UUID_PATTERN.test(value));
}

function diagnosisMergeKey(item: ClinicalDiagnosis) {
  return [
    item.kind,
    clinicalText(item.label),
    clinicalText(item.icd_code),
    clinicalText(item.ops_code),
    item.diagnosed_on ?? "",
  ].join("|");
}

function medicationMergeKey(item: ClinicalMedication) {
  return [
    item.category,
    clinicalText(item.wirkstoff),
    clinicalText(item.handelsname),
    clinicalText(item.staerke),
    clinicalText(item.form),
    clinicalText(item.einnahmeform),
    clinicalText(item.dose_morgens),
    clinicalText(item.dose_mittags),
    clinicalText(item.dose_abends),
    clinicalText(item.dose_nachts),
    item.einnahme_von ?? "",
  ].join("|");
}

function warningMergeKey(item: ClinicalWarning) {
  return [item.kind, clinicalText(item.label)].join("|");
}

function mergeDiagnoses(
  persisted: ClinicalDiagnosis[],
  local: ClinicalDiagnosis[],
  caseId: string,
) {
  const merged: ClinicalDiagnosis[] = persisted.map((item) => ({
    ...item,
    cid: item.cid ?? item.id ?? undefined,
    parent_cid: item.parent_cid ?? item.parent_id ?? null,
  }));
  const persistedById = new Map<string, number>();
  const persistedByKey = new Map<string, number>();
  merged.forEach((item, index) => {
    if (isPersistedClinicalId(item.id)) persistedById.set(item.id, index);
    persistedByKey.set(diagnosisMergeKey(item), index);
  });

  for (const item of local) {
    const idMatch = isPersistedClinicalId(item.id)
      ? persistedById.get(item.id)
      : undefined;
    if (idMatch !== undefined) {
      const serverItem = merged[idMatch]!;
      merged[idMatch] = {
        ...serverItem,
        ...item,
        id: serverItem.id,
        case_id: serverItem.case_id ?? null,
      };
      continue;
    }
    if (persistedByKey.has(diagnosisMergeKey(item))) continue;
    const next = {
      ...item,
      id: null,
      case_id: caseId,
    };
    merged.push(next);
    persistedByKey.set(diagnosisMergeKey(next), merged.length - 1);
  }
  return merged;
}

function mergeMedications(
  persisted: ClinicalMedication[],
  local: ClinicalMedication[],
) {
  const merged = persisted.map((item) => ({ ...item }));
  const persistedById = new Map<string, number>();
  const persistedByKey = new Set<string>();
  merged.forEach((item, index) => {
    if (isPersistedClinicalId(item.id)) persistedById.set(item.id, index);
    persistedByKey.add(medicationMergeKey(item));
  });

  for (const item of local) {
    const idMatch = isPersistedClinicalId(item.id)
      ? persistedById.get(item.id)
      : undefined;
    if (idMatch !== undefined) {
      const serverItem = merged[idMatch]!;
      merged[idMatch] = { ...serverItem, ...item, id: serverItem.id };
      continue;
    }
    const key = medicationMergeKey(item);
    if (persistedByKey.has(key)) continue;
    const newItem: ClinicalMedication = { ...item };
    delete newItem.id;
    merged.push(newItem);
    persistedByKey.add(key);
  }
  return merged;
}

function mergeWarnings(
  persisted: ClinicalWarning[],
  local: ClinicalWarning[],
) {
  const merged = persisted.map((item) => ({ ...item }));
  const persistedById = new Map<string, number>();
  const persistedByKey = new Set<string>();
  merged.forEach((item, index) => {
    if (isPersistedClinicalId(item.id)) persistedById.set(item.id, index);
    persistedByKey.add(warningMergeKey(item));
  });

  for (const item of local) {
    const idMatch = isPersistedClinicalId(item.id)
      ? persistedById.get(item.id)
      : undefined;
    if (idMatch !== undefined) {
      const serverItem = merged[idMatch]!;
      merged[idMatch] = { ...serverItem, ...item, id: serverItem.id };
      continue;
    }
    const key = warningMergeKey(item);
    if (persistedByKey.has(key)) continue;
    const newItem: ClinicalWarning = { ...item };
    delete newItem.id;
    merged.push(newItem);
    persistedByKey.add(key);
  }
  return merged;
}

const NARRATIVE_FIELDS = [
  "anamnese_aktuelle",
  "anamnese_vorgeschichte",
  "anamnese_vegetative",
  "anamnese_sozial",
  "anamnese_familie",
  "beurteilung",
] as const;

function mergeNarrative(
  persisted: ClinicalNarrative | null,
  local: ClinicalNarrative | null,
  caseId: string,
) {
  if (!persisted) {
    return local ? {
      ...local,
      id: null,
      case_id: local.case_id ?? caseId,
    } : null;
  }
  if (!local) return persisted;
  if (isPersistedClinicalId(local.id) && local.id === persisted.id) {
    return {
      ...persisted,
      ...local,
      id: persisted.id,
      case_id: persisted.case_id ?? null,
    };
  }

  const hasIncomingChanges = NARRATIVE_FIELDS.some((field) => (
    clinicalText(local[field])
    && clinicalText(local[field]) !== clinicalText(persisted[field])
  ));
  if (!hasIncomingChanges) return persisted;

  return {
    ...persisted,
    ...Object.fromEntries(NARRATIVE_FIELDS.map((field) => [
      field,
      local[field]?.trim() ? local[field] : persisted[field],
    ])),
    id: null,
    case_id: caseId,
    anamnese_at: local.anamnese_at ?? new Date().toISOString(),
    is_active: true,
    created_at: null,
    updated_at: null,
  } as ClinicalNarrative;
}

function mergePatientClinicalDraft(
  draft: Draft,
  persisted: PatientClinicalProfile,
  caseId: string,
): Draft {
  const narrative = mergeNarrative(persisted.narrative, draft.narrative, caseId);
  return {
    ...draft,
    anamnese: narrative?.anamnese_aktuelle ?? draft.anamnese,
    narrative,
    diagnoses: mergeDiagnoses(persisted.diagnoses, draft.diagnoses, caseId),
    medications: mergeMedications(persisted.medications, draft.medications),
    allergies: mergeWarnings(persisted.allergien, draft.allergies),
    caves: mergeWarnings(persisted.cave, draft.caves),
  };
}

type LeadClinicalDraftSection =
  | "narrative"
  | "diagnoses"
  | "medications"
  | "allergies"
  | "caves";

const LEAD_CLINICAL_DRAFT_SECTIONS: readonly LeadClinicalDraftSection[] = [
  "narrative",
  "diagnoses",
  "medications",
  "allergies",
  "caves",
];

function applyPersistedClinicalSection(
  draft: Draft,
  persisted: PatientClinicalProfile,
  section: LeadClinicalDraftSection,
): Draft {
  switch (section) {
    case "narrative":
      return {
        ...draft,
        anamnese: persisted.narrative?.anamnese_aktuelle ?? "",
        narrative: persisted.narrative,
      };
    case "diagnoses":
      return { ...draft, diagnoses: persisted.diagnoses };
    case "medications":
      return { ...draft, medications: persisted.medications };
    case "allergies":
      return { ...draft, allergies: persisted.allergien };
    case "caves":
      return { ...draft, caves: persisted.cave };
  }
}

function applyPersistedClinicalProfile(
  draft: Draft,
  persisted: PatientClinicalProfile,
): Draft {
  return LEAD_CLINICAL_DRAFT_SECTIONS.reduce(
    (current, section) => applyPersistedClinicalSection(current, persisted, section),
    draft,
  );
}

function draftFromLead(lead: LeadDetail): Draft {
  const clinical = clinicalRowsFromLead(lead);
  return {
    firstName: lead.first_name ?? "",
    middleName: lead.middle_name ?? "",
    lastName: lead.last_name ?? "",
    suffix: lead.suffix ?? "",
    birthDate: lead.date_of_birth ?? "",
    legalSex: lead.legal_sex ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    street: lead.street_address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zip: lead.zip_code ?? "",
    // An older lead may hold a written-out name: the next save stores the code.
    country: countryCodeFromStoredValue(lead.country),
    citizenships: lead.citizenships?.length
      ? normalizeCitizenships(lead.citizenships)
      : normalizeCitizenships([countryCodeFromStoredValue(inputString(lead.wizard_state?.["registration_country"]))]),
    passportExpiry: inputString(lead.wizard_state?.["passport_expiry"]),
    amlEnhancedDueDiligence: amlEnhancedDueDiligenceFromLead(lead),
    language: normalizedLanguageCode(lead.primary_language) || normalizedLanguageCode(lead.locale),
    whatsappNumber: lead.whatsapp_number ?? "",
    hasInsurance: insuranceAnswerFromStored({
      hasInsurance: lead.has_insurance,
      insuranceType: lead.insurance_type,
      insuranceProvider: lead.insurance_provider,
      insuranceNumber: lead.insurance_number,
    }),
    insuranceCoversGermany: lead.insurance_covers_germany ?? "",
    insuranceType: lead.insurance_type ?? "",
    // A self payer has no insurer or policy (the «Нет, самооплата» choice clears them too).
    insuranceProvider: lead.insurance_type === "self_pay" ? "" : lead.insurance_provider ?? "",
    insuranceNumber: lead.insurance_type === "self_pay" ? "" : lead.insurance_number ?? "",
    trustedContacts: trustedContactsFromLead(lead),
    concern: lead.primary_concern_text ?? "",
    anamnese: clinical.narrative?.anamnese_aktuelle ?? lead.additional_concerns ?? "",
    narrative: clinical.narrative,
    diagnoses: clinical.diagnoses,
    medications: clinical.medications,
    allergies: clinical.allergies,
    caves: clinical.caves,
    serviceNeeds: normalizeLeadServiceSelection([
      ...(lead.services ?? []),
      ...(lead.needs_interpreter ? ["interpreter_support"] : []),
    ]),
    serviceComments: serviceCommentsFromLead(lead),
    discoverySource: inputString(lead.wizard_state?.["discovery_source"]) || questionnaireText(lead, "discoverySource", "howDidYouHearAboutUs", "referralSource"),
    discoverySourceOther: inputString(lead.wizard_state?.["discovery_source_other"]),
    // The column is authoritative: it is nulled when the referrer patient is deleted,
    // while the wizard_state mirror would keep a stale ID that blocks every autosave.
    referrerPatientId: lead.referrer_patient_id ?? "",
    referrerPatientLabel: lead.referrer_patient_id
      ? lead.referrer_patient_name
        ? [lead.referrer_patient_pid, lead.referrer_patient_name].filter(Boolean).join(" · ")
        : inputString(lead.wizard_state?.["referrer_patient_label"])
      : "",
    referrer: inputString(lead.wizard_state?.["referrer"]),
    serviceNotes: lead.notes ?? "",
    specialties: lead.requested_specialties ?? [],
    selectedSpecializationWorkTypeIds: inputStringArray(
      lead.wizard_state?.["selected_specialization_work_type_ids"]
      ?? lead.wizard_state?.["selectedSpecializationWorkTypeIds"],
    ),
    costEstimateAdditionalLanguage: costEstimateAdditionalLanguage(
      lead.wizard_state?.["cost_estimate_additional_language"]
      ?? lead.wizard_state?.["costEstimateAdditionalLanguage"],
    ),
    programDateFrom: inputString(lead.wizard_state?.["program_date_from"]),
    programDateTo: inputString(lead.wizard_state?.["program_date_to"]),
    frameworkContractId: inputString(lead.wizard_state?.["framework_contract_id"]),
    contractValidFrom: inputString(lead.wizard_state?.["contract_valid_from"]) || appDateKey(),
    costThreshold: inputString(lead.wizard_state?.["cost_threshold"]),
    privacyConsent: lead.consent_privacy_practices,
    healthcareConsent: lead.consent_healthcare,
  };
}

function blankDraft(): Draft {
  return {
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    birthDate: "",
    legalSex: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    citizenships: [],
    passportExpiry: "",
    amlEnhancedDueDiligence: blankAmlEnhancedDueDiligence(),
    language: "",
    whatsappNumber: "",
    hasInsurance: "",
    insuranceCoversGermany: "",
    insuranceType: "",
    insuranceProvider: "",
    insuranceNumber: "",
    trustedContacts: [],
    concern: "",
    anamnese: "",
    narrative: null,
    diagnoses: [],
    medications: [],
    allergies: [],
    caves: [],
    serviceNeeds: [],
    serviceComments: {},
    discoverySource: "",
    discoverySourceOther: "",
    referrerPatientId: "",
    referrerPatientLabel: "",
    referrer: "",
    serviceNotes: "",
    specialties: [],
    selectedSpecializationWorkTypeIds: [],
    costEstimateAdditionalLanguage: "",
    programDateFrom: "",
    programDateTo: "",
    frameworkContractId: "",
    contractValidFrom: appDateKey(),
    costThreshold: "",
    privacyConsent: false,
    healthcareConsent: false,
  };
}

function patientLegalSex(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (["male", "m", "mann", "männlich", "м", "мужской"].includes(normalized ?? "")) {
    return "male";
  }
  if (["female", "f", "frau", "weiblich", "ж", "женский"].includes(normalized ?? "")) {
    return "female";
  }
  if (["diverse", "divers", "other", "другое"].includes(normalized ?? "")) {
    return "diverse";
  }
  return "";
}

function draftFromExistingPatient(patient: PatientDetail): Draft {
  const draft = blankDraft();
  const insuranceProvider = patient.insurance_provider?.trim() ?? "";
  const insuranceNumber = patient.insurance_number?.trim() ?? "";
  const insuranceType = patient.insurance_type?.trim() ?? "";
  const legal = asRecord(patient.legal_status);

  return {
    ...draft,
    firstName: patient.first_name?.trim() ?? "",
    lastName: patient.last_name?.trim() ?? "",
    birthDate: patient.birth_date?.trim() ?? "",
    legalSex: patientLegalSex(patient.gender),
    email: patient.email?.trim() ?? "",
    phone: patient.phone_primary?.trim() ?? "",
    street: patient.address_street?.trim() ?? "",
    city: patient.address_city?.trim() ?? "",
    zip: patient.address_zip?.trim() ?? "",
    // The patient file writes the country out ("Ukraine"); the lead keeps the
    // ISO code, as the server's repeat intake stores it, so the first save
    // does not overwrite "UA" with the name.
    country: countryCodeForDisplay(patient.address_country) || countryCodeForDisplay(patient.residence_country),
    citizenships: patient.citizenships?.length
      ? normalizeCitizenships(patient.citizenships)
      : normalizeCitizenships([nationalityCountryCode(patient.nationality)]),
    // Not taken from the patient card any more: staff enter "valid until"
    // with the document data from the scan (2026-10-24).
    passportExpiry: "",
    language: normalizedLanguageCode(patient.languages?.[0]),
    hasInsurance: insuranceAnswerFromStored({
      hasInsurance: null,
      insuranceType,
      insuranceProvider,
      insuranceNumber,
    }),
    // The patient file keeps the coverage only in the intake of the first
    // request; a repeat request showed "Не указано" (live QA 2026-10-24).
    insuranceCoversGermany: patientInsuranceCoversGermany(patient.intake_profile),
    privacyConsent: legal?.dsgvo_signed === true,
    insuranceType,
    insuranceProvider: insuranceType === "self_pay" ? "" : insuranceProvider,
    insuranceNumber: insuranceType === "self_pay" ? "" : insuranceNumber,
  };
}

function intakeTypeLabel(lead: LeadDetail, tx: Tx) {
  switch (leadIntakeTypeFromLead(lead)) {
    case "questionnaire":
      return tx("Опросник", "Fragebogen");
    case "form":
      return tx("Форма", "Formular");
    default:
      return tx("Внутреннее обращение", "Interne Anfrage");
  }
}

function intakeTypeTone(lead: LeadDetail) {
  switch (leadIntakeTypeFromLead(lead)) {
    case "questionnaire":
      return "brand" as const;
    case "form":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

function intakeFlowLabel(value: string | null | undefined, tx: Tx) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, [string, string]> = {
    medical: ["Медицинский", "Medizinisch"],
    contact: ["Контактная форма", "Kontaktformular"],
    standard: ["Стандартный", "Standard"],
    website_wizard: ["Опросник на сайте", "Website-Fragebogen"],
    repeat_patient: ["Повторное обращение", "Erneute Anfrage"],
  };
  const label = normalized ? labels[normalized] : null;
  return label ? tx(label[0], label[1]) : value || tx("Не указано", "Nicht angegeben");
}

function yesNoValue(value: boolean | null, tx: Tx) {
  if (value == null) return tx("Не указано", "Nicht angegeben");
  return value ? tx("Да", "Ja") : tx("Нет", "Nein");
}

function phoneTypeLabel(value: string | null | undefined, tx: Tx) {
  const labels: Record<string, [string, string]> = {
    mobile: ["Мобильный", "Mobil"],
    home: ["Домашний", "Privat"],
    private: ["Личный", "Privat"],
    work: ["Рабочий", "Geschäftlich"],
    other: ["Другой", "Sonstige"],
  };
  const normalized = value?.trim().toLowerCase();
  const label = normalized ? labels[normalized] : null;
  return label ? tx(label[0], label[1]) : value || tx("Не указано", "Nicht angegeben");
}

function serviceNeedLabel(value: string, tx: Tx) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, [string, string]> = {
    medical: ["Медицинское сопровождение", "Medizinische Betreuung"],
    medical_support: ["Медицинское сопровождение", "Medizinische Betreuung"],
    treatment: ["Организация лечения", "Behandlungsorganisation"],
    driver: ["Водитель", "Fahrer"],
    chauffeur: ["Водитель", "Fahrer"],
    transfer: ["Трансфер", "Transfer"],
    airport_transfer: ["Трансфер из аэропорта", "Flughafentransfer"],
    concierge: ["Консьерж", "Concierge"],
    concierge_support: ["Консьерж", "Concierge"],
    interpreter: ["Переводчик", "Dolmetscher"],
  };
  const label = labels[normalized];
  return label ? tx(label[0], label[1]) : value;
}

function newLine(index = 1): ServiceLine {
  return {
    id: "line-" + Date.now().toString(36) + "-" + index,
    agencyServiceId: null,
    agencyServicePriceVersionId: null,
    clientReference: null,
    managedByWizard: true,
    isCostPassthrough: false,
    description: "",
    catalogDescription: "",
    catalogUnitLabel: "",
    currency: "EUR",
    quantity: "1",
    price: "",
    vat: "19",
  };
}

export function isEstimatedOutlaysLine(line: ServiceLine) {
  return line.isCostPassthrough === true && (
    line.description.trim() === ESTIMATED_OUTLAYS_DESCRIPTION
    || line.clientReference?.endsWith(ESTIMATED_OUTLAYS_REFERENCE_SUFFIX) === true
  );
}

export function withEstimatedOutlaysLast(serviceLines: ServiceLine[]) {
  return serviceLines.toSorted((left, right) => (
    Number(isEstimatedOutlaysLine(left)) - Number(isEstimatedOutlaysLine(right))
  ));
}


type CostEstimateDocumentLanguage = "de" | "ru" | "de-ru";
type CostEstimateAdditionalLanguage = "" | "ru" | "en" | "es";

function costEstimateDocumentLanguage(
  additionalLanguage: CostEstimateAdditionalLanguage,
): CostEstimateDocumentLanguage {
  return additionalLanguage === "ru" ? "de-ru" : "de";
}

function costEstimateLanguageBlock(
  item: SpecializationWorkType,
  language: Exclude<CostEstimateAdditionalLanguage, ""> | "de",
) {
  const names = {
    de: item.name_de,
    ru: item.name_ru,
    en: item.name_en,
    es: item.name_es,
  };
  const name = names[language].trim() || item.name_de.trim() || item.code;
  const descriptions = item.descriptions
    .filter((description) => (
      description.is_active
      && description.language_code.split(/[-_]/)[0]?.toLowerCase() === language
      && description.body.trim()
    ))
    .toSorted((left, right) => left.sort_order - right.sort_order)
    .map((description) => description.body.trim());
  return descriptions.length > 0
    ? `${name}: ${descriptions.join(" ")}`
    : name;
}

function costEstimateWorkTypeDescription(
  item: SpecializationWorkType,
  additionalLanguage: CostEstimateAdditionalLanguage,
) {
  const german = costEstimateLanguageBlock(item, "de");
  return additionalLanguage
    ? `${german} / ${costEstimateLanguageBlock(item, additionalLanguage)}`
    : german;
}

// A catalog price is the price of the whole service. Its duration is
// informational: an operation of 15 hours is not 15 times its price.
function costEstimateWorkTypeRange(item: SpecializationWorkType) {
  return `${formatMoneyValue(item.min_price_eur, "de")} - ${formatMoneyValue(item.max_price_eur, "de")} €`;
}

function costEstimateServiceLines(
  workTypes: SpecializationWorkType[],
  additionalLanguage: CostEstimateAdditionalLanguage,
) {
  return workTypes.map((item) => ({
    description: costEstimateWorkTypeDescription(item, additionalLanguage),
    quantity: `${Math.max(1, item.duration_hours)} Std.`,
    fee: costEstimateWorkTypeRange(item),
    line_total: costEstimateWorkTypeRange(item),
  }));
}

function costEstimateTotalRange(
  workTypes: SpecializationWorkType[],
) {
  const total = workTypes.reduce(
    (result, item) => ({
      minimum: result.minimum + item.min_price_eur,
      maximum: result.maximum + item.max_price_eur,
    }),
    { minimum: 0, maximum: 0 },
  );
  return `${formatMoneyValue(total.minimum, "de")} - ${formatMoneyValue(total.maximum, "de")} €`;
}


function validLine(line: ServiceLine): boolean {
  return line.description.trim().length > 0 && money(line.quantity) > 0 && money(line.price) >= 0 && money(line.vat) >= 0 && money(line.vat) <= 100;
}

/** Order totals rounded per line, half away from zero, exactly like the server quote. */
export function calculateServiceLineEstimate(serviceLines: ServiceLine[]) {
  let net = 0;
  let vat = 0;
  let gross = 0;
  serviceLines.filter(validLine).forEach((line) => {
    const amounts = moneyLineAmounts(
      money(line.quantity),
      money(line.price),
      line.isCostPassthrough ? 0 : money(line.vat),
    );
    net += amounts.net;
    vat += amounts.vat;
    gross += amounts.gross;
  });
  return {
    net: roundCents(net),
    vat: roundCents(vat),
    gross: roundCents(gross),
  };
}

function specializationValue(item: SpecializationItem) {
  return item.code || item.name_en;
}

function quoteLineSignature(
  description: string,
  quantity: unknown,
  unitPrice: unknown,
  vatRate: unknown,
  isCostPassthrough: unknown,
) {
  return JSON.stringify([
    description.trim(),
    money(quantity).toFixed(4),
    money(unitPrice).toFixed(4),
    money(vatRate).toFixed(4),
    isCostPassthrough === true,
  ]);
}

function quoteMatchesServiceLines(quote: QuoteItem, lines: ServiceLine[]) {
  if (!Array.isArray(quote.line_items)) return false;
  const currentLines = lines
    .filter(validLine)
    .map((line) => quoteLineSignature(
      line.description,
      line.quantity,
      line.price,
      line.vat,
      line.isCostPassthrough,
    ))
    .sort();
  const quotedLines = quote.line_items
    .map((line) => quoteLineSignature(
      line.description,
      line.quantity,
      line.unit_price,
      line.vat_rate,
      line.is_cost_passthrough,
    ))
    .sort();
  return currentLines.length === quotedLines.length
    && currentLines.every((line, index) => line === quotedLines[index]);
}

export function quoteMatchesCurrentServices(
  quote: QuoteItem,
  lines: ServiceLine[],
  totalGross: number,
) {
  return sameCents(money(quote.total_gross), totalGross)
    && quoteMatchesServiceLines(quote, lines);
}

export function mergeCommercialQuoteReadiness(
  clientReady: boolean,
  serverQuoteAccepted: boolean | undefined,
  _serverPrepaymentReady: boolean | undefined,
) {
  // Payment readiness is informative and never gates commercial progress.
  void _serverPrepaymentReady;
  return clientReady && serverQuoteAccepted !== false;
}

function validMoneyInput(value: string) {
  if (!value.trim()) return true;
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) && parsed >= 0;
}

/** The `datetime-local` value of a deadline, in Berlin time. */
function localDeadline(value: string | null | undefined) {
  return isoToBerlinLocalInput(value);
}

function lineFromOrderLeistung(item: Leistung): ServiceLine {
  return {
    id: item.id,
    agencyServiceId: item.agency_service_id ?? null,
    agencyServicePriceVersionId: item.agency_service_price_version_id ?? null,
    clientReference: item.client_reference ?? null,
    managedByWizard: item.client_reference?.startsWith("lead-wizard:") ?? false,
    isCostPassthrough: item.is_cost_passthrough === true,
    description: item.description,
    catalogDescriptionItems: serviceDescriptionItems(
      item.agency_service_description_items_snapshot,
      item.agency_service_description_snapshot ?? item.agency_service_description,
    ),
    catalogDescription:
      item.agency_service_description_snapshot
      ?? item.agency_service_description
      ?? "",
    catalogUnitLabel:
      item.agency_service_unit_label_snapshot
      ?? item.agency_service_unit_label
      ?? "",
    currency: item.currency_snapshot ?? item.currency ?? "EUR",
    quantity: String(item.quantity ?? "1"),
    price: String(item.unit_price_snapshot ?? item.unit_price ?? ""),
    vat: String(
      item.is_cost_passthrough
        ? 0
        : item.vat_rate_snapshot ?? item.vat_rate ?? "19",
    ),
  };
}

export function preferPersistedCommercialLines(
  storedLines: ServiceLine[],
  orderLeistungen: Leistung[] | undefined,
  draftSavedAt: string | null = null,
  orderUpdatedAt: string | null = null,
) {
  // An empty order wins over stale draft lines, but not over lines the wizard
  // saved after the order last changed (DEV check 2026-10-11: a service picked
  // before "Сохранить договор и заказ" vanished when the wizard was reopened).
  const draftIsNewer = orderLeistungen !== undefined
    && orderLeistungen.length === 0
    && storedLines.length > 0
    && draftSavedAt !== null
    && orderUpdatedAt !== null
    && Date.parse(draftSavedAt) > Date.parse(orderUpdatedAt);
  return withEstimatedOutlaysLast(orderLeistungen !== undefined && !draftIsNewer
    ? orderLeistungen.map(lineFromOrderLeistung)
    : storedLines);
}

function wizardDocumentKind(item: DocumentItem): WizardDocumentKind | null {
  // A proof of the origin of assets belongs to the due-diligence form, whatever its file is called.
  if (item.art === AML_ASSET_ORIGIN_EVIDENCE_ART) return null;
  // What was uploaded for another person — in the lead cabinet for a person
  // who acts for the lead (a parent's passport, a proof of authority), on the
  // payer link by the payer (the payer's passport, the proof of funds) — is
  // never the lead's own identity document, although its category and name
  // say "identity".
  if (isOtherPersonUploadArt(item.art)) return null;
  const templateId = item.generated_template_id?.trim().toLowerCase();
  if (templateId === "privacy_information") return "privacy_information";
  if (templateId === "enhanced_due_diligence") return "enhanced_due_diligence";
  if (templateId === GWG_IDENTIFICATION_TEMPLATE) return "gwg_identification";
  if (templateId === LEAD_SELF_DISCLOSURE_TEMPLATE) return "lead_self_disclosure";

  const complianceKind = item.compliance_kind?.trim().toLowerCase();
  if (complianceKind === "identity" || complianceKind === "confidentiality_release") {
    return complianceKind;
  }
  if (complianceKind === "dsgvo") return "privacy_consents";

  if (templateId === "confidentiality_release") return "confidentiality_release";
  if (
    templateId === "privacy_consents"
    || templateId === "consent_data_release_child"
    || templateId === "consent_data_release_single"
  ) {
    return "privacy_consents";
  }

  // Guessing by the file name is for staff scans of the forms only.
  if (isMedicalUpload(item)) return null;
  const classification = [item.art, item.category, item.auto_name, item.original_filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (classification.includes("identity") || classification.includes("passport") || classification.includes("ausweis")) {
    return "identity";
  }
  if (classification.includes("schweigepflicht")) {
    return "confidentiality_release";
  }
  if (classification.includes("dsgvo") || classification.includes("datenschutz") || classification.includes("einwilligung")) {
    return "privacy_consents";
  }
  return null;
}

function wizardDocumentFilename(document: DocumentItem) {
  const filename = document.original_filename || document.auto_name || "document";
  const mimeType = document.mime_type?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== "application/pdf" || /\.pdf$/i.test(filename)) return filename;
  const filenameWithoutExtension = filename.replace(/\.[a-z0-9]{1,10}$/i, "");
  return `${filenameWithoutExtension || "document"}.pdf`;
}

function wizardDocumentComplianceKind(document: DocumentItem): DocumentComplianceKind | null {
  if (document.generated_template_id === "framework_contract") return "framework_contract";
  // The payer's Kostenübernahmeerklärung is confirmed (paper scan) like every other signed document (QA 2026-10-25).
  if (document.generated_template_id === "cost_coverage_declaration") return "cost_coverage_declaration";
  const kind = wizardDocumentKind(document);
  if (kind === "privacy_consents") return "dsgvo";
  // An internal GwG record or the lead's patient form touches no compliance flag of the lead.
  if (kind === "gwg_identification" || kind === "lead_self_disclosure") return "other";
  return kind === "privacy_information" ? null : kind;
}

function wizardDocumentPreviewKind(document: DocumentItem): "image" | "pdf" | null {
  const mimeType = document.mime_type?.trim().toLowerCase() ?? "";
  const filename = wizardDocumentFilename(document).toLowerCase();
  if (mimeType.startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|webp)$/.test(filename)) {
    return "image";
  }
  if (mimeType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  return null;
}

/** The lead has its patient: the wizard shows its data and changes nothing (QA 2026-10-25). */
function isConvertedLead(lead: Pick<LeadDetail, "converted_patient_id" | "qualification_status"> | null | undefined): boolean {
  return Boolean(lead && (lead.converted_patient_id || lead.qualification_status === "converted"));
}

/** Whether the optional service step holds anything: a program period, a requested service, a note. */
function serviceStepHasContent(
  draft: Pick<Draft, "programDateFrom" | "programDateTo" | "serviceNeeds" | "serviceComments" | "serviceNotes">,
): boolean {
  return Boolean(
    draft.programDateFrom
    || draft.programDateTo
    || draft.serviceNeeds.length > 0
    || draft.serviceNotes.trim()
    || Object.values(draft.serviceComments).some((comment) => comment.trim()),
  );
}

/** Saves a downloaded file under its name (a refused questionnaire upload). */
function saveBlobAs(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * 409 of a paper signature: the order document or the estimate is older than
 * the order (`order_document_outdated`, `estimate_document_outdated`), in
 * words; `null` for other errors.
 */
function outdatedDocumentSignErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const code = error.body?.error ?? error.body?.code ?? error.code;
  if (code === "order_document_outdated") {
    return tx(
      "Документ заказа устарел: заказ изменился после его создания. Создайте новую версию документа заказа и подпишите её.",
      "Der Einzelauftrag ist veraltet: Der Auftrag wurde nach seiner Erstellung geändert. Erstellen Sie eine neue Version des Einzelauftrags und lassen Sie diese unterschreiben.",
    );
  }
  if (code === "estimate_document_outdated") {
    return tx(
      "Смета устарела: заказ изменился после её создания. Пересчитайте смету, создайте новую версию документа и подпишите её.",
      "Der Kostenvoranschlag ist veraltet: Der Auftrag wurde nach seiner Erstellung geändert. Berechnen Sie ihn neu, erstellen Sie eine neue Version und lassen Sie diese unterschreiben.",
    );
  }
  return null;
}

/** The id of a commercial document's error block (scrolled into view after a refused action). */
function commercialDocumentErrorId(templateId: string): string {
  return `lead-commercial-document-error-${templateId}`;
}

/**
 * Confirming the framework contract's signature makes the contract signed,
 * which GMED countersigns only after the client signed the order (409
 * `payer_gate_blocked`, reason `client_order_signature_missing`): the next
 * step in words. Other refusals keep their own text (`null`).
 */
function frameworkContractSignErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError) || error.body?.error !== "payer_gate_blocked") return null;
  const reasons = Array.isArray(error.body.reasons) ? error.body.reasons : [];
  if (reasons.length !== 1 || reasons[0] !== "client_order_signature_missing") return null;
  return tx(
    "Подпись рамочного договора подтверждается после подписи заказа: сначала загрузите скан подписанного документа заказа («Подписано на бумаге» в блоке «Подписи») или подпишите его электронно, затем подтвердите подпись договора.",
    "Die Unterschrift des Rahmenvertrags wird nach der Unterschrift des Auftrags bestätigt: zuerst den Scan des unterschriebenen Einzelauftrags hochladen („Auf Papier unterschrieben“ unter „Unterschriften“) oder ihn elektronisch unterschreiben lassen, dann die Vertragsunterschrift bestätigen.",
  );
}

/** Why a paper signature of a wizard document was refused, when the wizard knows better than the generic text. */
function wizardSignatureErrorText(error: unknown, tx: Tx): string | null {
  return frameworkContractSignErrorText(error, tx)
    ?? payerGateErrorText(error, tx)
    ?? riskGateErrorText(error, tx)
    ?? outdatedDocumentSignErrorText(error, tx);
}

function errorText(error: unknown, tx: Tx): string {
  const payerGate = payerGateErrorText(error, tx) ?? riskGateErrorText(error, tx) ?? outdatedDocumentSignErrorText(error, tx);
  if (payerGate) return payerGate;
  const representation = gwgSheetErrorText(error, tx)
    ?? identificationErrorText(error, tx)
    ?? leadSelfDisclosureErrorText(error, tx)
    ?? documentVersionExistsErrorText(error, tx);
  if (representation) return representation;
  if (error instanceof Error && error.message === "Generate the current order document before confirming its signatures") {
    return tx("Сначала создайте актуальную версию документа заказа, затем подтвердите подписи", "Erstellen Sie zuerst die aktuelle Auftragsversion und bestätigen Sie anschließend die Unterschriften");
  }
  return leadErrorMessage(error, tx);
}

function readinessStepLabel(key: string, tx: Tx, repeatIntake = false) {
  const labels: Record<string, string> = {
    master_data: tx("Данные клиента", "Personendaten"),
    medical: tx("Медицинская характеристика", "Medizinische Merkmale"),
    service: tx("Сервисная история", "Servicehistorie"),
    need: tx("Сервисная история", "Servicehistorie"),
    documents: tx("Документы", "Unterlagen"),
    order: tx("Оформление заказа", "Auftragserfassung"),
    commercial: tx("Договор, заказ и смета", "Vertrag, Auftrag und Kostenvoranschlag"),
    release: repeatIntake ? tx("Готовность к завершению обращения", "Bereit zum Abschluss der Anfrage")
      : tx("Готовность к созданию пациента", "Bereit zur Patientenanlage"),
  };
  return labels[key] ?? tx("Проверка данных", "Datenprüfung");
}

/** The signature was refused by the risk assessment (it waits for a decision or rejected the lead). */
function riskGateRefusal(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return (error.body?.error ?? error.body?.code ?? error.code) === "risk_review_required";
}

/** "Identity document is not verified" for a minor: the contracting parents or the guardian are identified, not the child. */
function minorIdentityReasonLabel(tx: Tx) {
  return tx(
    "Подтвердите документы, удостоверяющие личность родителей или опекуна",
    "Ausweisdokumente der Eltern bzw. des Vormunds bestätigen",
  );
}

function readinessReasonLabel(reason: string, tx: Tx, minor = false) {
  // A minor is identified through the parents or the guardian, never the child.
  if (minor && reason === "Identity document is not verified") return minorIdentityReasonLabel(tx);
  const labels: Record<string, string> = {
    "Lead must be qualified before conversion": tx("Подтвердите данные обращения", "Angaben zum Anliegen bestätigen"),
    // Both mean the same fact: the signed DSGVO package (the generated consent
    // form, Anlage 1) is missing (owner naming 2026-10-23). The consents given in the cabinet do not replace the
    // signed form, and the optional disclosure to third parties is no part of it.
    "Compliance is not signed yet": tx("Нет подписанного пакета DSGVO (форма согласия, приложение 1)", "Unterschriebenes DSGVO-Paket fehlt (Einverständniserklärung, Anlage 1)"),
    "Birth date is missing": tx("Укажите дату рождения", "Geburtsdatum angeben"),
    "Legal sex is missing": tx("Укажите пол по документам", "Geschlecht laut Ausweisdokument angeben"),
    "Email or phone is required": tx("Укажите электронную почту или телефон", "E-Mail-Adresse oder Telefonnummer angeben"),
    "Privacy practices consent is missing": tx("Получите согласие на обработку запроса (в кабинете или на бумаге)", "Einwilligung zur Bearbeitung der Anfrage einholen (Kundenkabinett oder Papier)"),
    "Healthcare consent is missing": tx("Получите согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten einholen"),
    "Complete street, city and postal code": tx("Заполните улицу, город и почтовый индекс", "Straße, Ort und Postleitzahl vollständig angeben"),
    "Complete city and postal code": tx("Заполните город и почтовый индекс", "Ort und Postleitzahl vollständig angeben"),
    "Requested specialty is missing": tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
    "Identity document is not verified": tx("Подтвердите документ, удостоверяющий личность", "Ausweisdokument bestätigen"),
    "Signed DSGVO document is missing": tx("Нет подписанного пакета DSGVO (форма согласия, приложение 1)", "Unterschriebenes DSGVO-Paket fehlt (Einverständniserklärung, Anlage 1)"),
    "Signed confidentiality release is missing": tx("Нужно подписанное освобождение от медицинской тайны", "Unterzeichnete Schweigepflichtsentbindung erforderlich"),
    [SELF_DISCLOSURE_UNSIGNED_REASON]: tx("Анкета пациента не подписана — обязательна при первичном оформлении нового пациента", "Patientenformular nicht unterschrieben – Pflicht bei der Erstaufnahme eines neuen Patienten"),
    "Enhanced due diligence document is missing": tx("Заполните усиленную AML-проверку и создайте документ", "Verstärkte AML-Sorgfaltsprüfung ausfüllen und Dokument erstellen"),
    "Enhanced due diligence document is not signed": tx("Получите подпись на документе усиленной AML-проверки", "Unterschrift für die verstärkte AML-Sorgfaltsprüfung einholen"),
    "Risk assessment waits for a staff decision": tx("Нужно решение по оценке риска (документы → «Оценка риска»)", "Entscheidung zur Risikobewertung nötig (Unterlagen → „Risikobewertung“)"),
    "Framework contract is not signed": tx("Подпишите рамочный договор", "Rahmenvertrag unterzeichnen"),
    "Framework contract was terminated; create a new contract": tx("Рамочный договор расторгнут — оформите новый договор", "Rahmenvertrag wurde gekündigt – neuen Vertrag erstellen"),
    "Framework contract document is missing": tx("Создайте документ рамочного договора", "Rahmenvertragsdokument erstellen"),
    "Onboarding order is missing": tx("Создайте заказ", "Auftrag erstellen"),
    "Order needs at least one valid service": tx("Добавьте в заказ хотя бы одну услугу", "Mindestens eine Leistung zum Auftrag hinzufügen"),
    "Order document is missing": tx("Создайте документ заказа", "Einzelauftrag erstellen"),
    "Order cost estimate document is missing": tx("Создайте смету к заказу", "Kostenvoranschlag zum Einzelauftrag erstellen"),
    "Customer order signature is missing": tx("Получите подпись клиента на заказе", "Unterschrift des Kunden für den Auftrag einholen"),
    "Agency order signature is missing": tx("Подтвердите заказ со стороны агентства", "Auftrag durch die Agentur bestätigen"),
    "Quote is not accepted": tx("Подтвердите смету", "Kostenvoranschlag annehmen"),
    "Cost estimate document is missing": tx("Создайте предварительный расчёт медицинских расходов", "Vorläufige medizinische Kostenkalkulation erstellen"),
    "Preliminary cost calculation document is missing": tx("Создайте предварительный расчёт медицинских расходов", "Vorläufige medizinische Kostenkalkulation erstellen"),
    [COST_ESTIMATE_WORK_TYPES_REASON]: tx("Выберите медицинские виды работ для предварительного расчёта", "Medizinische Leistungsarten für die vorläufige Kostenkalkulation auswählen"),
    "Required prepayment is not complete": tx("Предоплата получена не полностью", "Vorauszahlung noch nicht vollständig eingegangen"),
    "Lead is already converted": tx("Пациент уже создан", "Patient wurde bereits angelegt"),
    [CONTRACT_DETAILS_MISSING_REASON]: tx("Данные представителей для договора неполные", "Angaben der Vertreter für den Vertrag unvollständig"),
    ...payerReadinessReasonLabels(tx),
  };
  return labels[reason] ?? tx("Проверьте незавершённые данные", "Unvollständige Angaben prüfen");
}

/** The optional readiness field with the missing contract keys of the representatives; `[]` on an older server. */
function contractDetailsMissingOf(readiness: unknown): string[] {
  const value = readiness && typeof readiness === "object" ? (readiness as { contract_details_missing?: unknown }).contract_details_missing : null;
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
}

/**
 * The reason as the lists show it: the label, and for the representatives'
 * contract data also who lacks what and where staff enter it (the person's
 * card under the identity document, or the contact's card in «Данные клиента»).
 */
function readinessReasonText(reason: string, tx: Tx, minor: boolean, readiness: unknown): string {
  const label = readinessReasonLabel(reason, tx, minor);
  if (reason !== CONTRACT_DETAILS_MISSING_REASON) return label;
  const missing = contractDetailsMissingOf(readiness);
  const detail = representativeMissingText(missing, tx);
  if (!detail) return label;
  const where = representativeDocumentFieldsMissing(missing)
    ? tx("Вносится в карточке этого лица в блоке «Документ, удостоверяющий личность».", "Wird in der Karte dieser Person im Block „Ausweisdokument“ erfasst.")
    : tx("Вносится в карточке контакта в разделе «Данные клиента».", "Wird in der Kontaktkarte unter „Personendaten“ erfasst.");
  return `${label}. ${detail} ${where}`;
}

function readinessReasonStep(reason: string): StepId {
  const steps: Record<string, StepId> = {
    "Lead must be qualified before conversion": "documents",
    "Compliance is not signed yet": "documents",
    "Birth date is missing": "master_data",
    "Legal sex is missing": "master_data",
    "Email or phone is required": "master_data",
    "Privacy practices consent is missing": "documents",
    "Healthcare consent is missing": "documents",
    "Complete street, city and postal code": "master_data",
    "Complete city and postal code": "master_data",
    "Requested specialty is missing": "order",
    "Identity document is not verified": "documents",
    "Signed DSGVO document is missing": "documents",
    "Signed confidentiality release is missing": "documents",
    [SELF_DISCLOSURE_UNSIGNED_REASON]: "documents",
    "Enhanced due diligence document is missing": "documents",
    "Enhanced due diligence document is not signed": "documents",
    "Risk assessment waits for a staff decision": "documents",
    "Framework contract is not signed": "commercial",
    "Framework contract was terminated; create a new contract": "commercial",
    "Framework contract document is missing": "commercial",
    "Onboarding order is missing": "commercial",
    "Order needs at least one valid service": "commercial",
    "Order document is missing": "commercial",
    "Order cost estimate document is missing": "commercial",
    "Customer order signature is missing": "commercial",
    "Agency order signature is missing": "commercial",
    "Quote is not accepted": "commercial",
    "Cost estimate document is missing": "commercial",
    "Preliminary cost calculation document is missing": "commercial",
    [COST_ESTIMATE_WORK_TYPES_REASON]: "order",
    "Required prepayment is not complete": "commercial",
    "Lead is already converted": "release",
    [CONTRACT_DETAILS_MISSING_REASON]: "documents",
    ...payerReadinessReasonSteps(),
  };
  return steps[reason] ?? "release";
}

export type CommercialSaveFeedback = {
  tone: "error" | "success" | "warning";
  message: string;
  /** The message follows the lead's live readiness instead of the save moment. */
  followsReadiness?: boolean;
};

/**
 * What the "Договор и смета" step still needs, from the lead's current
 * readiness. The hint shown after "Сохранить договор и заказ" is recomputed
 * from it, so creating or signing the contract, the order document or the
 * quote afterwards removes the finished items instead of leaving a stale list.
 */
export function commercialReadinessFeedback(
  readiness: Pick<LeadDetail["readiness"], "blocking_reasons" | "steps"> | null | undefined,
  tx: Tx,
): CommercialSaveFeedback {
  const commercialReady = readiness?.steps.some(
    (item) => item.key === "commercial" && item.ready,
  ) ?? false;
  if (commercialReady) {
    return {
      tone: "success",
      message: tx(
        "Договор и заказ сохранены и завершены",
        "Vertrag und Auftrag wurden gespeichert und abgeschlossen",
      ),
    };
  }
  const remaining = (readiness?.blocking_reasons ?? [])
    .filter((reason) => readinessReasonStep(reason) === "commercial" || reason === COST_ESTIMATE_WORK_TYPES_REASON)
    .map((reason) => readinessReasonLabel(reason, tx));
  return {
    tone: "warning",
    message: remaining.length > 0
      ? tx("Данные сохранены. Для завершения: ", "Daten gespeichert. Zum Abschluss: ")
        + remaining.join("; ")
      : tx(
          "Данные сохранены. Этап ещё не завершён — проверьте документы, подписи и смету.",
          "Daten gespeichert. Der Schritt ist noch nicht abgeschlossen – prüfen Sie Dokumente, Unterschriften und Kostenvoranschlag.",
        ),
  };
}

function readinessReasonFieldId(reason: string, draft: Draft | null) {
  const fields: Record<string, string> = {
    "Birth date is missing": MASTER_FIELD_IDS.birthDate,
    "Legal sex is missing": MASTER_FIELD_IDS.legalSex,
    "Email or phone is required": MASTER_FIELD_IDS.email,
    "Privacy practices consent is missing": PRIVACY_CONSENT_ID,
    "Healthcare consent is missing": HEALTHCARE_CONSENT_ID,
    "Requested specialty is missing": SERVICE_SPECIALTIES_ID,
    "Identity document is not verified": IDENTITY_DOCUMENT_ID,
    "Signed DSGVO document is missing": PRIVACY_DOCUMENT_ID,
    "Compliance is not signed yet": PRIVACY_DOCUMENT_ID,
    "Signed confidentiality release is missing": CONFIDENTIALITY_RELEASE_ID,
    [SELF_DISCLOSURE_UNSIGNED_REASON]: SELF_DISCLOSURE_SECTION_ID,
    "Enhanced due diligence document is missing": ENHANCED_CHECK_SECTION_ID,
    "Enhanced due diligence document is not signed": ENHANCED_CHECK_SECTION_ID,
    "Risk assessment waits for a staff decision": RISK_ASSESSMENT_SECTION_ID,
    "Framework contract is not signed": FRAMEWORK_DOCUMENT_ID,
    "Framework contract was terminated; create a new contract": FRAMEWORK_DOCUMENT_ID,
    "Framework contract document is missing": FRAMEWORK_DOCUMENT_ID,
    "Onboarding order is missing": ORDER_SERVICE_SELECT_ID,
    "Order needs at least one valid service": ORDER_SERVICE_SELECT_ID,
    "Order document is missing": ORDER_DOCUMENT_ID,
    "Order cost estimate document is missing": ORDER_COST_ESTIMATE_DOCUMENT_ID,
    "Customer order signature is missing": ORDER_SIGNATURES_ID,
    "Agency order signature is missing": ORDER_SIGNATURES_ID,
    "Quote is not accepted": QUOTE_SECTION_ID,
    "Required prepayment is not complete": QUOTE_SECTION_ID,
    "Cost estimate document is missing": COST_ESTIMATE_DOCUMENT_ID,
    "Preliminary cost calculation document is missing": COST_ESTIMATE_DOCUMENT_ID,
    // The representatives' cards sit under the identity document; address and birth data are fixed in the contact's card.
    [CONTRACT_DETAILS_MISSING_REASON]: IDENTITY_DOCUMENT_ID,
    ...payerReadinessReasonFields(),
  };
  if (reason === COST_ESTIMATE_WORK_TYPES_REASON) {
    // The work-type list appears once a specialization is chosen.
    return draft && draft.specialties.length === 0 ? SERVICE_SPECIALTIES_ID : COST_ESTIMATE_WORK_TYPES_ID;
  }
  if (reason === "Complete street, city and postal code" || reason === "Complete city and postal code") {
    if (!draft?.street.trim() && reason !== "Complete city and postal code") return MASTER_FIELD_IDS.street;
    if (!draft?.city.trim()) return MASTER_FIELD_IDS.city;
    return MASTER_FIELD_IDS.zip;
  }
  return fields[reason];
}

function masterValidationIssues(errors: MasterValidationErrors, tx: Tx): ValidationIssue[] {
  const labels: Record<MasterFieldKey, string> = {
    referrerPatientId: tx("Рекомендовавший клиент", "Empfehlender Kunde"),
    guardian: tx("Родитель или законный представитель", "Elternteil oder gesetzlicher Vertreter"),
    firstName: tx("Имя", "Vorname"),
    lastName: tx("Фамилия", "Nachname"),
    birthDate: tx("Дата рождения", "Geburtsdatum"),
    legalSex: tx("Пол согласно документам", "Geschlecht laut Ausweisdokument"),
    email: tx("Электронная почта", "E-Mail-Adresse"),
    phone: tx("Телефон", "Telefonnummer"),
    street: tx("Улица и дом", "Straße und Hausnummer"),
    city: tx("Город", "Ort"),
    zip: tx("Почтовый индекс", "Postleitzahl"),
    insuranceType: tx("Тип страхования", "Versicherungsart"),
    insuranceProvider: tx("Страховая компания", "Versicherer"),
    insuranceNumber: tx("Номер полиса", "Versicherungsnummer"),
  };
  const sharedContactError = errors.email && errors.email === errors.phone
    ? errors.email
    : null;

  return MASTER_FIELD_ORDER.flatMap((field) => {
    const message = errors[field];
    if (!message) return [];
    if (field === "phone" && sharedContactError) return [];
    if (field === "email" && sharedContactError) {
      return [{
        key: "primary-contact",
        step: "master_data" as const,
        message: sharedContactError,
        fieldId: MASTER_FIELD_IDS.email,
      }];
    }
    return [{
      key: field,
      step: "master_data" as const,
      message: `${labels[field]}: ${message}`,
      fieldId: MASTER_FIELD_IDS[field],
    }];
  });
}

function orderValidationIssues(draft: Draft | null, tx: Tx): ValidationIssue[] {
  if (!draft) return [];
  const issues: ValidationIssue[] = [];
  if (draft.specialties.length === 0) {
    issues.push({
      key: "specialties",
      step: "order",
      message: tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
      fieldId: SERVICE_SPECIALTIES_ID,
    });
  }
  if (!draft.programDateFrom && draft.programDateTo) {
    issues.push({
      key: "program-date-from",
      step: "service",
      message: tx("Укажите дату начала программы", "Startdatum des Programms angeben"),
      fieldId: ORDER_DATE_FROM_ID,
    });
  }
  if (draft.programDateFrom && !draft.programDateTo) {
    issues.push({
      key: "program-date-to",
      step: "service",
      message: tx("Укажите дату окончания программы", "Enddatum des Programms angeben"),
      fieldId: ORDER_DATE_TO_ID,
    });
  } else if (
    draft.programDateFrom
    && draft.programDateTo
    && draft.programDateTo < draft.programDateFrom
  ) {
    issues.push({
      key: "program-date-range",
      step: "service",
      message: tx(
        "Дата окончания не может быть раньше даты начала",
        "Das Enddatum darf nicht vor dem Startdatum liegen",
      ),
      fieldId: ORDER_DATE_TO_ID,
    });
  }
  return issues;
}

type CabinetConsents = { privacy: boolean; healthcare: boolean };
const NO_CABINET_CONSENTS: CabinetConsents = { privacy: false, healthcare: false };

/** The server's view of the active cabinet consents (adult lead or parent / guardian). */
function cabinetConsentsOf(readiness: { cabinet_consents?: { privacy_practices: boolean; healthcare: boolean } } | null | undefined): CabinetConsents {
  return {
    privacy: readiness?.cabinet_consents?.privacy_practices === true,
    healthcare: readiness?.cabinet_consents?.healthcare === true,
  };
}

/**
 * The documents-step issues the server's qualification asks for
 * (`qualification_reasons`: the signed consent form, the two consents, the
 * risk decision). The signed confidentiality release, the confirmed identity
 * document and the signed enhanced check block the conversion only (DEV
 * 2026-10-24: the wizard refused to qualify without them).
 */
const QUALIFICATION_DOCUMENT_ISSUE_KEYS: ReadonlySet<string> = new Set([
  "risk-assessment",
  "privacy-consent",
  "healthcare-consent",
  "privacy-document",
]);

function qualificationDocumentIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => QUALIFICATION_DOCUMENT_ISSUE_KEYS.has(issue.key));
}

function documentsValidationIssues(
  draft: Draft | null,
  documents: Record<WizardDocumentKind, DocumentItem[]>,
  tx: Tx,
  existingChecks?: Map<string, boolean>,
  /** Owner rule 2026-10-07: the server's enhanced check (or an unsaved black-list country). */
  amlRequired = false,
  demoChecks: readonly string[] = [],
  /** Consents given in the cabinet count like the staff's toggles (server readiness). */
  cabinet: CabinetConsents = NO_CABINET_CONSENTS,
  /** The server's check `risk_assessment_released` failed: qualification waits for the staff decision. */
  riskHeld = false,
  /** The server's check `identity_document_verified` passed (also a minor's parents' copies). */
  identityVerifiedByServer = false,
): ValidationIssue[] {
  if (!draft) return [];
  const issues: ValidationIssue[] = [];
  if (riskHeld) {
    issues.push({
      key: "risk-assessment",
      step: "documents",
      message: readinessReasonLabel("Risk assessment waits for a staff decision", tx),
      fieldId: RISK_ASSESSMENT_SECTION_ID,
    });
  }
  if (!draft.privacyConsent && !cabinet.privacy) {
    issues.push({
      key: "privacy-consent",
      step: "documents",
      message: readinessReasonLabel("Privacy practices consent is missing", tx),
      fieldId: PRIVACY_CONSENT_ID,
    });
  }
  if (!draft.healthcareConsent && !cabinet.healthcare) {
    issues.push({
      key: "healthcare-consent",
      step: "documents",
      message: readinessReasonLabel("Healthcare consent is missing", tx),
      fieldId: HEALTHCARE_CONSENT_ID,
    });
  }
  if (!demoChecks.includes("confidentiality_release_signed") && !existingChecks?.get("confidentiality_release_signed") && !documents.confidentiality_release.some((document) => (
    document.signed_at && document.compliance_kind === "confidentiality_release"
  )) && !documents.privacy_consents.some((document) => (
    // The minor's consent form carries the Schweigepflichtsentbindung (owner decision 2026-10-12).
    document.signed_at
    && ["consent_data_release_child", "consent_data_release_single"].includes(document.generated_template_id ?? "")
  ))) {
    issues.push({
      key: "confidentiality-release",
      step: "documents",
      message: readinessReasonLabel("Signed confidentiality release is missing", tx),
      fieldId: CONFIDENTIALITY_RELEASE_ID,
    });
  }
  if (!demoChecks.includes("dsgvo_document_signed") && !existingChecks?.get("dsgvo_document_signed") && !documents.privacy_consents.some((document) => (
    document.signed_at && document.compliance_kind === "dsgvo"
  ))) {
    issues.push({
      key: "privacy-document",
      step: "documents",
      message: readinessReasonLabel("Signed DSGVO document is missing", tx),
      fieldId: PRIVACY_DOCUMENT_ID,
    });
  }
  // A minor is identified through the contracting parents or guardian (the
  // server's check passes with their reviewed identity copies).
  if (!existingChecks?.get("identity_document_verified") && !identityVerifiedByServer && !documents.identity.some((document) => (
    document.signed_at && document.compliance_kind === "identity"
  ))) {
    issues.push({
      key: "identity-document",
      step: "documents",
      message: isMinor(draft.birthDate, new Date())
        ? minorIdentityReasonLabel(tx)
        : readinessReasonLabel("Identity document is not verified", tx),
      fieldId: IDENTITY_DOCUMENT_ID,
    });
  }
  // A PEP or a country of the high-risk list no longer requires the check.
  if (amlRequired && !demoChecks.includes("enhanced_due_diligence_document_signed") && !documents.enhanced_due_diligence.some((document) => (
    document.signed_at && document.compliance_kind === "enhanced_due_diligence"
  ))) {
    const documentGenerated = documents.enhanced_due_diligence.length > 0;
    issues.push({
      key: "enhanced-due-diligence-document",
      step: "documents",
      message: readinessReasonLabel(
        documentGenerated
          ? "Enhanced due diligence document is not signed"
          : "Enhanced due diligence document is missing",
        tx,
      ),
      // The list item leads to the section with the form and its document (QA 2026-10-22: it led nowhere).
      fieldId: ENHANCED_CHECK_SECTION_ID,
    });
  }
  return issues;
}

/**
 * A minor's own e-mail is optional: a minor gets no patient login, the
 * parents get their own access (the server accepts a minor without one).
 */
/** The earliest date of birth staff may store (the lead cabinet's bar too). */
const EARLIEST_BIRTH_DATE = "1900-01-01";

function minorEmailOptional(draft: Pick<Draft, "birthDate">): boolean {
  return isMinor(draft.birthDate, new Date());
}

/** The stored names, city and phone of the lead (shared rules: a change only). */
type StoredPersonFields = { firstName?: string | null; lastName?: string | null; city?: string | null; phone?: string | null; email?: string | null };

function validateMasterDraft(
  draft: Draft | null,
  tx: Tx,
  repeatIntake: boolean,
  // The server found in DNS that the e-mail domain receives no mail.
  emailNoMail = false,
  // The health-data consent given in the cabinet needs the address like the toggle.
  cabinetHealthcare = false,
  // What the server has: the shared rules check a new or changed value only.
  stored: StoredPersonFields = {},
): MasterValidationErrors {
  if (!draft) return {};

  const errors: MasterValidationErrors = {};
  const required = tx("Обязательное поле", "Pflichtfeld");
  if (discoveryReferrerMissing(draft, repeatIntake)) {
    errors.referrerPatientId = required;
  }
  const changedValue = (value: string, before: string | null | undefined) => oneLine(value) !== oneLine(before);
  const nameTooLong = tx(`Не более ${PERSON_NAME_MAX} символов`, `Höchstens ${PERSON_NAME_MAX} Zeichen`);
  if (!draft.firstName.trim()) errors.firstName = required;
  else if (changedValue(draft.firstName, stored.firstName) && oneLine(draft.firstName).length > PERSON_NAME_MAX) errors.firstName = nameTooLong;
  if (!draft.lastName.trim()) errors.lastName = required;
  else if (changedValue(draft.lastName, stored.lastName) && oneLine(draft.lastName).length > PERSON_NAME_MAX) errors.lastName = nameTooLong;
  if (changedValue(draft.city, stored.city) && oneLine(draft.city).length > PERSON_CITY_MAX) {
    errors.city = tx(`Не более ${PERSON_CITY_MAX} символов`, `Höchstens ${PERSON_CITY_MAX} Zeichen`);
  }
  if (!draft.birthDate) {
    errors.birthDate = required;
  } else if (draft.birthDate > appDateKey()) {
    errors.birthDate = tx(
      "Дата рождения не может быть в будущем",
      "Das Geburtsdatum darf nicht in der Zukunft liegen",
    );
  } else if (draft.birthDate < EARLIEST_BIRTH_DATE) {
    // The server refuses it too (`plausible_birth_date` in leads.rs).
    errors.birthDate = tx(
      "Дата рождения не может быть раньше 01.01.1900",
      "Das Geburtsdatum darf nicht vor dem 01.01.1900 liegen",
    );
  }
  if (isMinor(draft.birthDate, new Date())) {
    const guardian = draft.trustedContacts.find((contact) => (
      isParentOrGuardianRelation(contact.relation)
      && contact.name.trim()
      && (contact.email.trim() || contact.phone.trim())
    ));
    if (!guardian) {
      errors.guardian = tx(
        "Для несовершеннолетнего укажите мать, отца или законного представителя с контактными данными",
        "Für Minderjährige Elternteil oder gesetzlichen Vertreter mit Kontaktdaten angeben",
      );
    }
  }
  if (!draft.legalSex) errors.legalSex = required;

  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (!repeatIntake && !email && !minorEmailOptional(draft)) {
    // A new lead gets a patient login, the address is its user name
    // (owner decision 2026-10-03). A minor gets none: the parents get their
    // own access, so the child's address is optional (QA 2026-10-06, B1-a).
    errors.email = tx(
      "Обязательное поле — это логин пациента в портале",
      "Pflichtfeld – Login des Patienten im Portal",
    );
    if (phone && changedValue(phone, stored.phone) && !isValidPersonPhone(phone)) {
      errors.phone = tx(
        "Введите корректный номер телефона: не менее 6 цифр, только цифры, +, пробелы, ( ) - / .",
        "Gültige Telefonnummer eingeben: mindestens 6 Ziffern, nur Ziffern, +, Leerzeichen, ( ) - / .",
      );
    }
  } else if (repeatIntake && !email && !phone) {
    const contactRequired = tx(
      "Укажите электронную почту или телефон",
      "E-Mail oder Telefonnummer angeben",
    );
    errors.email = contactRequired;
    errors.phone = contactRequired;
  } else {
    if (email && !isValidEmailAddress(email)) {
      errors.email = tx(
        "Введите корректный адрес электронной почты",
        "Gültige E-Mail-Adresse eingeben",
      );
    } else if (email && emailNoMail && emailChangedOnSave(email, stored.email)) {
      // Only an address set or changed now is judged by its domain, as on the
      // server: the stored one never blocks saving another field (B-1a).
      errors.email = emailDomainWarningText(email, tx("ru", "de"));
    }
    if (phone && changedValue(phone, stored.phone) && !isValidPersonPhone(phone)) {
      errors.phone = tx(
        "Введите корректный номер телефона: не менее 6 цифр, только цифры, +, пробелы, ( ) - / .",
        "Gültige Telefonnummer eingeben: mindestens 6 Ziffern, nur Ziffern, +, Leerzeichen, ( ) - / .",
      );
    }
  }

  if (draft.healthcareConsent || cabinetHealthcare) {
    if (!draft.street.trim()) errors.street = required;
    if (!draft.city.trim()) errors.city = required;
    if (!draft.zip.trim()) errors.zip = required;
  }
  // A self payer names no insurer or policy, even with an older «Да» (F-W7).
  if (draft.hasInsurance === "yes" && draft.insuranceType !== "self_pay") {
    if (!draft.insuranceType) errors.insuranceType = required;
    if (!draft.insuranceProvider.trim()) errors.insuranceProvider = required;
    if (!draft.insuranceNumber.trim()) errors.insuranceNumber = required;
  }
  return errors;
}

function Field({
  label,
  children,
  className,
  error,
  errorId,
  required = false,
  portalField,
  htmlFor,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  error?: string;
  errorId?: string;
  required?: boolean;
  /** Lead column the patient fills in the portal (step 1), for fields without an error id. */
  portalField?: string;
  /**
   * Id of the control: the caption becomes its `<label for>`, so the control
   * is named by the caption alone, without the patient's marker or the error
   * (QA 2026-10-11, N-01).
   */
  htmlFor?: string;
}) {
  // In "the patient fills it in" mode the field is optional and says so —
  // unless the check still asks for it.
  const { patientFills } = useStep1PortalField(errorId, portalField);
  const caption = (
    <>
      {label}
      {required && (!patientFills || Boolean(error)) ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
    </>
  );
  // The patient's marker and hint sit on the label's line, at its right end (wrapping only when narrow).
  const content = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} data-wizard-field-label className={cn(tokens.text.label, "block font-mono")}>{caption}</label>
        ) : (
          <span data-wizard-field-label className={cn(tokens.text.label, "block font-mono")}>{caption}</span>
        )}
        <span className="ml-auto flex min-w-0 justify-end">
          <Step1PortalFieldNote errorId={errorId} portalField={portalField} />
        </span>
      </span>
      {children}
      {error ? (
        <span id={errorId} role="alert" className="block text-xs leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
  return htmlFor ? (
    <div className={cn("min-w-0 space-y-1.5", className)}>{content}</div>
  ) : (
    <label className={cn("min-w-0 space-y-1.5", className)}>{content}</label>
  );
}

function StateMark({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", done ? "text-emerald-700" : "text-muted-foreground")}>
      {done ? <Check className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current" />}
      {label}
    </span>
  );
}

function ToggleRow({
  id,
  checked,
  label,
  onChange,
  disabled,
  withDivider = true,
  hint,
  hintTestId,
}: {
  id?: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  withDivider?: boolean;
  /** Why the box cannot be ticked yet, under the label. */
  hint?: string;
  hintTestId?: string;
}) {
  const hintId = useId();
  return (
    <label className={cn(
      "flex items-center gap-3 py-3",
      disabled ? "cursor-not-allowed" : "cursor-pointer",
      withDivider && "border-b border-border/70 last:border-b-0",
    )}>
      <input id={id} type="checkbox" aria-label={label} aria-describedby={hint ? hintId : undefined} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className={checkboxClass} />
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {hint ? <span id={hintId} data-testid={hintTestId} className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Where a refused paper signature leads (DEV 2026-10-27, owner: «навігації передивись»). */
type WizardSignatureJump = (error: unknown) => { label: string; onClick: () => void } | null;
const WizardSignatureJumpContext = createContext<WizardSignatureJump | null>(null);

function WizardDocumentRows({
  documents,
  complianceKind,
  showSignatureStatus = true,
  emptyLabel,
  lang,
  busy,
  disabled,
  tx,
  onOpen,
  onDownload,
  onSign,
  onDelete,
  onChanged,
  documentNote,
}: {
  documents: DocumentItem[];
  complianceKind?: DocumentComplianceKind;
  showSignatureStatus?: boolean;
  emptyLabel: string;
  lang: Lang;
  busy: string | null;
  disabled: boolean;
  tx: Tx;
  onOpen: (document: DocumentItem) => void;
  onDownload: (document: DocumentItem) => void;
  onSign?: (document: DocumentItem, kind: DocumentComplianceKind) => void;
  onDelete: (document: DocumentItem) => void;
  onChanged?: () => void;
  /** A short note in the metadata line, e.g. who uploaded a representative's file. */
  documentNote?: (document: DocumentItem) => ReactNode;
}) {
  const signatureJump = useContext(WizardSignatureJumpContext);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [protectedDocumentIds, setProtectedDocumentIds] = useState<Set<string>>(() => new Set());
  if (documents.length === 0) {
    return emptyLabel ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null;
  }
  const sortedDocuments = sortWizardDocumentsNewestFirst(documents);
  // An old version, or a document the server put aside (status `archived`,
  // e.g. the previous payer's identity copy after a payer change; QA
  // 2026-10-24, C-7): both go to the archive group, and a put-aside document
  // is listed by the name the server gave it ("Früherer Zahler – …").
  const latestDocuments = sortedDocuments.filter((document) => document.is_latest_version && !wizardDocumentIsArchived(document));
  const archivedDocuments = sortedDocuments.filter((document) => !document.is_latest_version || wizardDocumentIsArchived(document));
  const archiveHasPutAside = archivedDocuments.some(wizardDocumentIsArchived);

  const renderDocument = (document: DocumentItem, archived: boolean) => {
    const signed = documentSignedFor(document, complianceKind);
    const putAside = wizardDocumentIsArchived(document);
    const title = putAside ? wizardArchivedDocumentTitle(document) : wizardDocumentFilename(document);
    return (
      <div key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-document-archived={putAside ? "true" : undefined}>
        {archived
          ? <History aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          : <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            title={title}
            disabled={disabled}
            className="block max-w-full truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onOpen(document)}
          >
            {title}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <LeadWizardDocumentMetadata document={document} lang={lang} />
            {documentNote?.(document)}
            {/* The order changed after this PDF was made (`terms_current`, documents.rs):
                it cannot be signed or confirmed any more (QA 2026-10-25, F-W3). */}
            {!archived && !putAside && document.terms_current === false ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                title={tx("Заказ изменился после создания документа — создайте новую версию", "Der Auftrag wurde nach der Erstellung geändert – neue Version erstellen")}
                data-testid={`lead-document-outdated-${document.id}`}
              >
                {document.generated_template_id === "order_cost_estimate" ? tx("Устарела", "Veraltet") : tx("Устарел", "Veraltet")}
              </Badge>
            ) : null}
            {putAside ? (
              <Badge variant="outline" className="border-border/70 bg-muted/40 text-[11px] font-normal text-muted-foreground" data-testid={`lead-document-archived-${document.id}`}>
                {tx("архив", "Archiv")}
              </Badge>
            ) : archived ? (
              <Badge variant="outline" className="font-mono text-[11px]">
                {tx("Версия", "Version")} {document.version_number}
              </Badge>
            ) : complianceKind && !signed && onSign && signatureNeedsProof(document, complianceKind) ? (
              // Owner decision 2026-10-11: "signed" only with proof — the scan of the
              // signed copy (or a QES through the signature action), never one click.
              <PaperSignatureConfirmButton
                documentId={document.id}
                title={wizardDocumentFilename(document)}
                lang={lang}
                disabled={disabled}
                errorText={(error) => wizardSignatureErrorText(error, tx)}
                errorAction={signatureJump ?? undefined}
                onDone={() => {
                  setProtectedDocumentIds((current) => new Set(current).add(document.id));
                  onChanged?.();
                }}
              />
            ) : complianceKind && !signed && onSign ? (
              <Button
                type="button"
                variant="default"
                size="xs"
                aria-busy={busy === `sign-${document.id}`}
                disabled={disabled}
                onClick={() => onSign(document, complianceKind)}
              >
                {busy === `sign-${document.id}` ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FileCheck2 aria-hidden="true" className="size-3.5" />}
                {busy === `sign-${document.id}` ? tx("Подтверждение…", "Wird bestätigt…") : complianceKind === "identity" ? tx("Подтвердить документ", "Dokument bestätigen") : tx("Подтвердить подпись", "Unterschrift bestätigen")}
              </Button>
            ) : complianceKind && showSignatureStatus ? (
              <StateMark
                done={signed}
                label={complianceKind === "identity" ? signed ? tx("Проверен", "Geprüft") : tx("Ожидает проверки", "Prüfung offen") : signed ? tx("Подписан", "Unterzeichnet") : tx("Ожидает подписи", "Unterschrift offen")}
              />
            ) : null}
          </div>
          {!archived && ["privacy_information", "cost_estimate"].includes(document.generated_template_id ?? "") ? (
            <DocumentReviewStatus
              key={document.id}
              documentId={document.id}
              disabled={disabled}
              onProtected={() => setProtectedDocumentIds((current) => {
                if (current.has(document.id)) return current;
                const next = new Set(current);
                next.add(document.id);
                return next;
              })}
            />
          ) : null}
          {!archived ? <WizardDocumentRowError documentId={document.id} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!archived && canSignWizardDocument(document) ? (
            <DocumentSignatureAction
              documentId={document.id}
              title={wizardDocumentFilename(document)}
              iconOnly
              disabled={disabled}
              signed={signed}
              onDone={() => {
                setProtectedDocumentIds((current) => {
                  if (current.has(document.id)) return current;
                  const next = new Set(current);
                  next.add(document.id);
                  return next;
                });
                onChanged?.();
              }}
            />
          ) : null}
          {wizardDocumentPreviewKind(document) ? (
            <Button type="button" variant="ghost" size="icon-sm" title={tx("Просмотреть", "Vorschau")} aria-label={tx("Просмотреть", "Vorschau")} disabled={disabled} onClick={() => onOpen(document)}>
              {busy === `preview-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" title={tx("Скачать", "Herunterladen")} aria-label={tx("Скачать", "Herunterladen")} disabled={disabled} onClick={() => onDownload(document)}>
            {busy === `download-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          </Button>
          {!archived && !document.deletion_protected && !protectedDocumentIds.has(document.id) ? (
            <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={tx("Удалить", "Löschen")} aria-label={tx("Удалить", "Löschen")} disabled={disabled} onClick={() => onDelete(document)}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className={cn("divide-y divide-border/70 rounded-lg", tokens.surface.card)}>
        {latestDocuments.map((document) => renderDocument(document, false))}
      </div>
      {archivedDocuments.length > 0 ? (
        <div className={cn("overflow-hidden rounded-lg", tokens.surface.card)}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen((current) => !current)}
          >
            <span className="flex items-center gap-2">
              <Archive aria-hidden="true" className="size-3.5" />
              {archiveHasPutAside ? tx("Архив", "Archiv") : tx("Архив версий", "Versionsarchiv")}
            </span>
            <CountBadge>{archivedDocuments.length}</CountBadge>
          </button>
          {archiveOpen ? (
            <div className="divide-y divide-border/70 border-t border-border/70">
              {archivedDocuments.map((document) => renderDocument(document, true))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

async function fetchWizardContracts(lead: LeadDetail): Promise<ContractItem[]> {
  const contracts = await fetchContracts(`/framework-contracts?lead_id=${encodeURIComponent(lead.id)}`);
  const selectedId = inputString(lead.wizard_state?.["framework_contract_id"]);
  if (!selectedId || contracts.some(item => item.id === selectedId)) return contracts;
  // Keep an already selected agreement when the same intake is reopened from Leads.
  // Loading this agreement does not start a patient-wide document review.
  const selected = await fetchContract(selectedId).catch(() => null);
  return selected ? [...contracts, selected] : contracts;
}

export function LeadWizard({
  leadId: requestedLeadId,
  open,
  createMode = false,
  entryPoint,
  creationKey,
  existingPatient = null,
  sourcePerson = null,
  onNewRequestForPerson,
  onOpenChange,
  onCreated,
  onContactsSaved,
  onConverted,
  onArchived,
  onShowDetails,
  onOrderCreated,
}: LeadWizardProps) {
  const onContactsSavedRef = useRef(onContactsSaved);
  useEffect(() => { onContactsSavedRef.current = onContactsSaved; }, [onContactsSaved]);
  const {
    knownLeadProgramServiceLabel,
    leadLocationDetailedLabel,
    leadLocationLabel,
    leadPreferredLocationLabel,
    leadProgramServiceLabel,
    leadSourceLabel,
    leadVisitTimingLabel,
  } = useLeadLabels();
  const { lang, t } = useLang();
  const tx: Tx = useCallback((ru, de) => (lang === "de" ? de : ru), [lang]);
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null);
  const leadId = requestedLeadId ?? createdLeadId;
  const activePayerLeadIdRef = useRef(leadId);
  activePayerLeadIdRef.current = leadId;
  const [lead, setLead] = useState<LeadDetail | null>(null);
  // A converted lead is read, not edited: the server answers 409
  // `lead_converted` to every change, the wizard shows the patient instead
  // (QA 2026-10-25). `convertedByServer` holds such an answer until the
  // reloaded lead carries `converted_patient_id`.
  const [convertedByServer, setConvertedByServer] = useState(false);
  const leadConverted = convertedByServer || isConvertedLead(lead);
  const [convertedPatient, setConvertedPatient] = useState<{ id: string; name: string; number: string } | null>(null);
  // The questionnaire files the import refused on this load (the lead's attachments carry the stored ones).
  const [attachmentImportRefused, setAttachmentImportRefused] = useState<LeadAttachmentImportRefusal[]>([]);
  const refusedAttachments = useMemo(
    () => refusedLeadAttachments(lead?.attachments, attachmentImportRefused),
    [attachmentImportRefused, lead?.attachments],
  );
  // Whether the electronic signature (Skribble) is connected, as the payer package state says; null until known.
  const [signatureEnabled, setSignatureEnabled] = useState<boolean | null>(null);
  // The retention sweep deleted the lead while the wizard was open
  // (`lead.purged`, owner request 2026-10-26): the wizard says so instead of
  // failing every save and load against the deleted lead.
  const [purgedByRetention, setPurgedByRetention] = useState(false);
  useEffect(() => {
    setConvertedByServer(false);
    setAttachmentImportRefused([]);
    setPurgedByRetention(false);
  }, [leadId]);
  useEffect(() => {
    const patientId = lead?.converted_patient_id ?? null;
    if (!open || !patientId) {
      setConvertedPatient(null);
      return;
    }
    let cancelled = false;
    void apiFetch<PatientDetail>(`/patients/${encodeURIComponent(patientId)}`)
      .then((patient) => {
        if (cancelled) return;
        setConvertedPatient({
          id: patientId,
          name: [patient.first_name, patient.last_name].filter(Boolean).join(" "),
          number: patient.patient_id ?? "",
        });
      })
      .catch(() => {
        if (!cancelled) setConvertedPatient({ id: patientId, name: "", number: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [lead?.converted_patient_id, open]);
  // "Кто платит": the payer declaration feeds the AML country risk, the
  // documents step and the signing order of the commercial step. It follows
  // every lead refresh (order signatures, documents, readiness).
  const payer = useLeadPayerDeclaration(open ? leadId : null);
  // "Kostenübernehmer" only for a real third party; a paying parent or patient is the paying person (owner 2026-10-22).
  const goToPayerLabel = payer.data?.declaration?.payer_kind === "third_party"
    ? tx("Перейти к плательщику", "Zum Kostenübernehmer")
    : tx("Перейти к плательщику", "Zur zahlenden Person");
  const [payerAutosaveRegistry] = useState(createPayerAutosaveRegistry);
  const registerPayerAutosave = useCallback(
    (flush: () => Promise<boolean>) => payerAutosaveRegistry.register(leadId, flush),
    [leadId, payerAutosaveRegistry],
  );
  // The third-party payer's own link and answers (phase 3a); sent, revoked and estimated with leads.edit.
  const payerLink = useLeadPayerLink(open ? leadId : null);
  const canEditPayerLink = useCan("leads.edit");
  const payerCountries = useMemo(() => payerAmlCountries(payer.data), [payer.data]);
  const reloadPayer = payer.reload;
  useEffect(() => {
    if (lead) void reloadPayer();
  }, [lead, reloadPayer]);
  // Owner rule 2026-10-07: whether the enhanced check is required is the
  // server's (black-list countries of the patient and the payer, confirmed
  // sanctions matches). Loaded again after every lead refresh, every "Кто
  // платит" save and on `lead.portal_updated`.
  const enhancedCheckVersion = useMemo(() => [lead, payer.data], [lead, payer.data]);
  const enhancedCheckState = useLeadEnhancedCheck(open ? leadId : null, enhancedCheckVersion);
  const enhancedCheck = enhancedCheckState.check;
  const riskCountryLists = useRiskCountryLists(open);
  const reloadEnhancedCheck = enhancedCheckState.reload;
  const retentionDeadline = lead?.retention_deadline_at ?? null;
  const retentionDays = daysUntilRetentionDeadline(retentionDeadline);
  // A repeat intake (lead opened for an existing patient) keeps its patient
  // review even when reopened from the leads registry, so the patient's valid
  // documents and contracts are reused instead of recreated. A first intake
  // that has already created its patient only has prospect_patient_id.
  const isRepeatIntake = isRepeatIntakeLead(entryPoint, lead);
  const repeatPatientId = repeatIntakePatientId(open && isRepeatIntake, existingPatient?.id, lead);
  const repeatPatientNumber = isRepeatIntake
    ? repeatIntakePatientNumber(existingPatient?.patient_id, lead)
    : null;
  // A repeat intake starts "Кто платит" from the declaration fixed when the
  // patient's last request was converted (QA B-18, 2026-10-11): the form is
  // prefilled, staff check and save it.
  const knownRepeatPayerLeadId = useMemo(
    () => (isRepeatIntake ? patientDeclarationLeadId(existingPatient) : null),
    [existingPatient, isRepeatIntake],
  );
  const [fetchedRepeatPayerLead, setFetchedRepeatPayerLead] = useState<{
    patientId: string;
    leadId: string | null;
  } | null>(null);
  useEffect(() => {
    if (!open || !isRepeatIntake || !repeatPatientId || knownRepeatPayerLeadId) return;
    let active = true;
    void apiFetch<PatientDetail>(`/patients/${repeatPatientId}`)
      .then((patient) => {
        if (active) setFetchedRepeatPayerLead({ patientId: repeatPatientId, leadId: patientDeclarationLeadId(patient) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isRepeatIntake, knownRepeatPayerLeadId, open, repeatPatientId]);
  const repeatPayerLeadId = knownRepeatPayerLeadId
    ?? (fetchedRepeatPayerLead?.patientId === repeatPatientId ? fetchedRepeatPayerLead.leadId : null);
  const previousPayer = useLeadPayerDeclaration(
    open && repeatPayerLeadId && repeatPayerLeadId !== leadId ? repeatPayerLeadId : null,
  );
  const payerPrefill = isRepeatIntake ? previousPayer.data?.declaration ?? null : null;
  // Read by callbacks created before the lead is loaded (e.g. the clinical
  // loader), so they follow the lead's repeat mode without being recreated.
  const isRepeatIntakeRef = useRef(isRepeatIntake);
  useEffect(() => {
    isRepeatIntakeRef.current = isRepeatIntake;
  }, [isRepeatIntake]);
  const patientReview = useRepeatPatientReview(repeatPatientId);
  const previousRequests = usePreviousRequests(repeatPatientId, lead?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [referrerSearch, setReferrerSearch] = useState("");
  const deferredReferrerSearch = useDeferredValue(referrerSearch);
  const [referrerPatients, setReferrerPatients] = useState<LeadReferrerPatientOption[]>([]);
  const [referrerPatientsLoading, setReferrerPatientsLoading] = useState(false);
  const [referrerPatientsError, setReferrerPatientsError] = useState("");
  const [guardianSearch, setGuardianSearch] = useState("");
  const deferredGuardianSearch = useDeferredValue(guardianSearch);
  const [guardianPatients, setGuardianPatients] = useState<LeadGuardianCandidate[]>([]);
  const [selectedGuardianCandidate, setSelectedGuardianCandidate] = useState("");
  const [guardianPatientsLoading, setGuardianPatientsLoading] = useState(false);
  const [guardianPatientsError, setGuardianPatientsError] = useState("");
  const [step, setStep] = useState<StepId>("master_data");
  // The step "Обновить" keeps (QA 2026-10-11 C-07: refreshing jumped back to step 1).
  const currentStepRef = useRef<StepId>("master_data");
  useEffect(() => {
    currentStepRef.current = step;
  }, [step]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [, setCases] = useState<CaseListItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [specialties, setSpecialties] = useState<SpecializationItem[]>([]);
  const [workTypesBySpecialization, setWorkTypesBySpecialization] = useState<
    Record<string, SpecializationWorkType[]>
  >({});
  const [workTypesLoading, setWorkTypesLoading] = useState(false);
  const [workTypesError, setWorkTypesError] = useState("");
  const [agencyServices, setAgencyServices] = useState<AgencyServiceItem[]>([]);
  const [clinicalProviders, setClinicalProviders] = useState<ProviderSummary[]>([]);
  const [allDoctors, setAllDoctors] = useState<AllDoctorOption[]>([]);
  const [medicalLookupsLoading, setMedicalLookupsLoading] = useState(false);
  const [commercialLookupsLoading, setCommercialLookupsLoading] = useState(false);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [prepayment, setPrepayment] = useState(false);
  const [signedPatient, setSignedPatient] = useState(false);
  const [signedAgency, setSignedAgency] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [prepaymentAmount, setPrepaymentAmount] = useState("");
  const [prepaymentDeadline, setPrepaymentDeadline] = useState("");
  const [commercialFlagsBusyCount, setCommercialFlagsBusyCount] = useState(0);
  // Typed prepayment values committed on blur; shown as saving, never blocking.
  const [commercialFlagsBackgroundCount, setCommercialFlagsBackgroundCount] = useState(0);
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // A refused "Подтвердить подпись" is shown under the row whose button was pressed.
  const [documentRowError, setDocumentRowError] = useState<WizardDocumentRowErrorState>(null);
  const [commercialSaveFeedback, setCommercialSaveFeedback] =
    useState<CommercialSaveFeedback | null>(null);
  const [commercialDocumentErrors, setCommercialDocumentErrors] = useState<
    Partial<Record<CommercialDocumentKind, string>>
  >({});
  const [commercialQuoteError, setCommercialQuoteError] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  // One-time password of the patient login created with the lead; shown once.
  const [issuedPortalAccess, setIssuedPortalAccess] = useState<(PortalCredentials & { language: string }) | null>(null);
  const [autosaveError, setAutosaveError] = useState("");
  const [existingParentPatientId, setExistingParentPatientId] = useState<string | null>(null);
  // What `POST /leads` copied from the source person, for the step-1 notice
  // and the PEP hint (read-only; the cabinet asks PEP / sanctions again).
  const [prefilledFromSource, setPrefilledFromSource] = useState<{ leadId: string; notice: string | null; pep: boolean } | null>(null);
  // The child's name for the notice, known once the seed is loaded.
  const sourcePersonNameRef = useRef<string | null>(null);
  const [autosaveErrorDetail, setAutosaveErrorDetail] = useState("");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  // «Не подходит» asks for a reason first (QA 2026-10-11, A-39a); null while the dialog is closed.
  const [notQualifiedReason, setNotQualifiedReason] = useState<LeadFailureReasonDraft | null>(null);
  const [notQualifiedError, setNotQualifiedError] = useState("");
  const [serviceReportOpen, setServiceReportOpen] = useState(false);
  const [collapsedWorkTypeSpecializationIds, setCollapsedWorkTypeSpecializationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [workTypesExpanded, setWorkTypesExpanded] = useState(true);
  const [reportWorkTypesExpanded, setReportWorkTypesExpanded] = useState(true);
  const [deleteServiceLine, setDeleteServiceLine] = useState<ServiceLine | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);
  // The contact whose GwG data staff want to remove: the question is asked first.
  const [gwgDataRemoval, setGwgDataRemoval] = useState<TrustedContactDraft | null>(null);
  const [trustedContactRemoval, setTrustedContactRemoval] = useState<TrustedContactDraft | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [trustedContactEditor, setTrustedContactEditor] = useState<TrustedContactDraft | null>(null);
  const [trustedContactEditorError, setTrustedContactEditorError] = useState("");
  const [trustedContactRelationError, setTrustedContactRelationError] = useState("");
  // A new minor's custody, stated before the lead exists and sent with its
  // creation: a guardian (Vormund) can be named only under "guardian".
  const [newLeadCustody, setNewLeadCustody] = useState<LeadCustody | "">("");
  const [trustedContactEmailError, setTrustedContactEmailError] = useState("");
  const [trustedContactPhoneError, setTrustedContactPhoneError] = useState("");
  const [trustedContactBirthDateError, setTrustedContactBirthDateError] = useState("");
  // Whose login the typed address already is (DEV QA V-A6): a warning, never a gate.
  const [trustedContactLoginOwner, setTrustedContactLoginOwner] = useState<ContactEmailLoginOwner | null>(null);
  // Whether the editor was opened from the minor's parent / legal representative block.
  const [trustedContactEditorGuardian, setTrustedContactEditorGuardian] = useState(false);
  // Address, birth data and citizenships of a parent the server does not know
  // yet (a new card): kept per contact id and written once the parent is on
  // file (walk-through 2026-10-24, mode «Заполняю сам»).
  const [trustedContactPendingDetails, setTrustedContactPendingDetails] = useState<RepresentativeDetails>(EMPTY_REPRESENTATIVE_DETAILS);
  // The person picked in the open contact dialog (DEV 2026-10-26): their
  // address, birth data and citizenships go into the empty fields of the GwG
  // block, and the dialog says where they come from.
  const [trustedContactCandidatePrefill, setTrustedContactCandidatePrefill] = useState<GuardianCandidatePrefill | null>(null);
  // The details form of a representative on file in the open contact dialog:
  // its values go with the dialog's own «Сохранить» (F-11).
  const trustedContactDetailsDraftRef = useRef<{ contactId: string; draft: RepresentativeDetails; loaded: RepresentativeDetails } | null>(null);
  const pendingRepresentativeDetailsRef = useRef(new Map<string, RepresentativeDetails>());
  // A document generation in flight (the busy state shows a render later).
  const documentGenerationRef = useRef(false);
  const [pendingRepresentativeDetailsVersion, setPendingRepresentativeDetailsVersion] = useState(0);
  // The trusted contacts as the server stores them, as far as this wizard
  // knows. A save sends the contacts only when staff changed them: a parent
  // added in the lead cabinet meanwhile must not be overwritten by an older list.
  const [trustedContactsBase, setTrustedContactsBase] = useState<TrustedContactPayload[]>([]);
  const trustedContactsBaseRef = useRef(trustedContactsBase);
  const lastSentTrustedContactsRef = useRef<TrustedContactPayload[] | null>(null);
  // Counts the saves that changed who represents the lead (the contacts, or
  // the date of birth crossing the age of majority): the portal state and the
  // identification status are loaded again after each.
  const [representationVersion, setRepresentationVersion] = useState(0);
  const savedMinorRef = useRef(false);
  const [amlSheetOpen, setAmlSheetOpen] = useState(false);
  const [amlSheetError, setAmlSheetError] = useState("");
  // The enhanced AML block shows the payer form's own interest and source of funds (owner 2026-10-19).
  const [payerAmlSlot, setPayerAmlSlot] = useState<HTMLDivElement | null>(null);
  // "Bearbeiter/in": the staff who may carry out the check (owner 2026-10-19).
  const [amlReviewers, setAmlReviewers] = useState<{ id: string; name: string }[]>([]);
  // Staff set the boxes of section 1 ("Interne Risikoanalyse", "Individuelle
  // Prüfung") themselves while the wizard is open: opening the check again
  // keeps that choice.
  const amlRiskFindingTouchedRef = useRef(false);
  const [documentPreview, setDocumentPreview] = useState<WizardDocumentPreview | null>(null);
  const [documentPreviewError, setDocumentPreviewError] = useState("");
  // The person whose document data a refused signature names: the banner
  // leads straight to that person's document form (DEV 2026-10-22).
  const [documentPreviewJump, setDocumentPreviewJump] = useState<string | null>(null);
  const [touchedMasterFields, setTouchedMasterFields] = useState<Set<MasterFieldKey>>(
    () => new Set(),
  );
  const [masterValidationAttempted, setMasterValidationAttempted] = useState(false);
  // A field the server refused on the last save (422 with `field`), shown at the field.
  const [serverMasterError, setServerMasterError] = useState<{ field: MasterFieldKey; message: string } | null>(null);
  // A trusted contact the server refused on the last save (422 with `contact_id`), shown at the contact.
  const [serverContactError, setServerContactError] = useState<{ contactId: string; message: string } | null>(null);
  // Why the birth-date picker did not take what was typed (see `onPickerValidation`).
  const [birthDateEntryError, setBirthDateEntryError] = useState<string | null>(null);
  const [orderValidationAttempted, setOrderValidationAttempted] = useState(false);
  const [validationContext, setValidationContext] = useState<ValidationContext | null>(null);
  const hydrated = useRef<string | null>(null);
  const stepNavRef = useRef<HTMLElement | null>(null);
  const stepPanelRef = useRef<HTMLElement | null>(null);
  const stepTabsRef = useRef<HTMLDivElement | null>(null);
  const stepPillRef = useRef<HTMLSpanElement | null>(null);
  const stepPillReadyRef = useRef(false);
  const wizardStateBaseRef = useRef<Record<string, unknown>>({});
  const currentAutosaveSignatureRef = useRef("");
  const lastSavedAutosaveSignatureRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Saves the lead's pending autosave now (not after the debounce) and waits
  // for the save under way; set below once `persistSnapshot` exists.
  const flushLeadAutosaveRef = useRef<() => Promise<void>>(async () => {});
  const creationKeyRef = useRef(creationKey ?? crypto.randomUUID());
  const clinicalBaselineRef = useRef<PatientClinicalProfile | null>(null);
  const [clinicalAccessDenied, setClinicalAccessDenied] = useState(false);
  const pendingClinicalEditsRef = useRef(new Map<string, { expected_revision: number; operation_id: string; remove_ids?: string }>());
  const loadPatientClinical = useCallback(async (patientId: string) => {
    try {
      const profile = await fetchPatientClinical(patientId);
      clinicalBaselineRef.current = profile;
      setClinicalAccessDenied(false);
      return profile;
    } catch (cause) {
      // An existing patient's record may be closed to this role; a repeat
      // intake then continues without the medical step, from either entry point.
      const repeatIntake = entryPoint === "repeat-patient" || isRepeatIntakeRef.current;
      if (!repeatIntake || !(cause instanceof ApiRequestError) || cause.status !== 403) throw cause;
      setClinicalAccessDenied(true);
      clinicalBaselineRef.current = null;
      return { diagnoses: [], medications: [], examinations: [], procedures: [], verlauf: [], narrative: null, allergien: [], cave: [] } satisfies PatientClinicalProfile;
    }
  }, [entryPoint]);
  const medicalSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const stepNavigationInFlightRef = useRef(false);
  const commercialGenerationInFlightRef = useRef(false);
  const reloadVersionRef = useRef(0);
  // Every load of the lead state (reload, documents/commercial refresh) takes
  // a number; a background refresh answered after a newer load started does
  // not write its older lead, quotes or orders over it (QA 2026-10-25, M F-2:
  // «Принято» next to «Смета не соответствует текущему заказу» right after
  // confirming — a refresh begun before the confirmation landed last).
  const stateLoadVersionRef = useRef(0);
  // The lead object alone is written by more loads than those (the lead-only
  // refresh, the cabinet's step-1 merge, the first autosave): every one takes
  // a ticket here and an older answer never replaces a newer one's lead.
  const leadLoadGuardRef = useRef<NewestLoadGuard>(createNewestLoadGuard());
  const lookupSessionVersionRef = useRef(0);
  const commercialLookupUiVersionRef = useRef(0);
  const medicalLookupsRequestRef = useRef<
    Promise<[ProviderSummary[], AllDoctorOption[]]> | null
  >(null);
  const specialtiesRequestRef = useRef<Promise<SpecializationItem[]> | null>(null);
  const agencyServicesRequestRef = useRef<Promise<AgencyServiceItem[]> | null>(null);
  const medicalLookupsLoadedRef = useRef(false);
  const specialtiesLoadedRef = useRef(false);
  const agencyServicesLoadedRef = useRef(false);
  const caseIdRef = useRef<string | null>(null);
  const prospectPatientIdRef = useRef<string | null>(null);
  const prospectMergeOnlyRef = useRef(false);
  const hydrateClinicalDraft = useCallback((value: Draft, profile: PatientClinicalProfile, caseId: string) => (
    prospectMergeOnlyRef.current ? applyPersistedClinicalProfile(value, profile) : mergePatientClinicalDraft(value, profile, caseId)
  ), []);
  const [prospectCandidates, setProspectCandidates] = useState<
    ProspectDuplicateCandidate[] | null
  >(null);
  const [prospectResolutionBusy, setProspectResolutionBusy] = useState(false);
  // Saves of a step-1 dialog (an allergy, a diagnosis, …) that found a
  // duplicate patient wait for staff's choice and are saved after
  // «Привязать» / «Создать нового пациента» (QA 2026-10-25, F-F8).
  const prospectWaitersRef = useRef<((resolved: boolean) => void)[]>([]);
  const settleProspectWaiters = useCallback((resolved: boolean) => {
    const waiters = prospectWaitersRef.current;
    prospectWaitersRef.current = [];
    waiters.forEach((waiter) => waiter(resolved));
  }, []);
  useEffect(() => () => settleProspectWaiters(false), [leadId, settleProspectWaiters]);
  const documentPreviewUrlRef = useRef<string | null>(null);
  const lastPersistedLeadIdRef = useRef<string | null>(null);
  const pendingParentProfileLeadRef = useRef<string | null>(null);
  // Service options that were present when the draft was hydrated. Kept so that
  // unchecking a lead-supplied service (one outside the fixed questionnaire options)
  // leaves its row in place instead of removing it and making it unrecoverable.
  const initialServiceOptionsRef = useRef<string[]>([]);
  const commercialFlagRequestVersionRef = useRef<Record<CommercialFlagKey, number>>({
    signed_patient: 0,
    signed_agency: 0,
    prepayment_required: 0,
    prepayment_amount: 0,
    prepayment_due_at: 0,
  });

  useEffect(() => {
    if (
      !open
      || !intakeAsksDiscoverySource(isRepeatIntake)
      || draft?.discoverySource !== "customer_referral"
    ) {
      setReferrerPatients([]);
      setReferrerPatientsLoading(false);
      setReferrerPatientsError("");
      return;
    }

    let active = true;
    setReferrerPatientsLoading(true);
    setReferrerPatientsError("");
    void fetchLeadReferrerPatients(deferredReferrerSearch)
      .then((patients) => {
        if (active) setReferrerPatients(patients);
      })
      .catch(() => {
        if (!active) return;
        setReferrerPatients([]);
        setReferrerPatientsError(tx(
          "Не удалось загрузить список клиентов",
          "Kundenliste konnte nicht geladen werden",
        ));
      })
      .finally(() => {
        if (active) setReferrerPatientsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deferredReferrerSearch, draft?.discoverySource, isRepeatIntake, open, tx]);

  useEffect(() => {
    if (!open || !trustedContactEditor) {
      setGuardianPatients([]);
      setGuardianPatientsLoading(false);
      setGuardianPatientsError("");
      return;
    }

    let active = true;
    setGuardianPatientsLoading(true);
    setGuardianPatientsError("");
    void fetchLeadGuardianCandidates(deferredGuardianSearch, leadId)
      .then((patients) => {
        if (active) setGuardianPatients(patients);
      })
      .catch(() => {
        if (!active) return;
        setGuardianPatients([]);
        setGuardianPatientsError(tx(
          "Не удалось загрузить список представителей",
          "Vertreterliste konnte nicht geladen werden",
        ));
      })
      .finally(() => {
        if (active) setGuardianPatientsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deferredGuardianSearch, leadId, open, trustedContactEditor?.id, tx]);
  useEffect(() => {
    setSelectedGuardianCandidate("");
  }, [trustedContactEditor?.id]);
  // DEV QA V-A6: 400 ms after the e-mail of the open contact changes, ask
  // whether it is another person's login. The stored address of a saved
  // contact is not asked about, so opening the editor sends nothing.
  const trustedContactEditorId = trustedContactEditor?.id ?? null;
  const trustedContactEditorEmail = trustedContactEditor?.email ?? "";
  const trustedContactEditorPatientId = trustedContactEditor?.relatedPatientId ?? "";
  useEffect(() => {
    if (!open || !leadId || !trustedContactEditorId) {
      setTrustedContactLoginOwner(null);
      return;
    }
    const check = createContactEmailLoginCheck(
      (email) => checkLeadContactEmail(leadId, email, trustedContactEditorId, trustedContactEditorPatientId || null),
      setTrustedContactLoginOwner,
    );
    const storedEmail = trustedContactsBaseRef.current.find((contact) => contact.id === trustedContactEditorId)?.email;
    check.update(trustedContactEditorEmail, storedEmail);
    return check.cancel;
  }, [leadId, open, trustedContactEditorEmail, trustedContactEditorId, trustedContactEditorPatientId]);
  const selectedSpecializationItems = useMemo(() => {
    const values = new Set(draft?.specialties ?? []);
    return specialties.filter((item) => values.has(specializationValue(item)));
  }, [draft?.specialties, specialties]);

  useEffect(() => {
    if (!open || selectedSpecializationItems.length === 0) {
      setWorkTypesBySpecialization({});
      setWorkTypesLoading(false);
      setWorkTypesError("");
      return;
    }
    if (step !== "order" && step !== "commercial") return;

    let active = true;
    setWorkTypesLoading(true);
    setWorkTypesError("");
    void Promise.all(
      selectedSpecializationItems.map(async (specialization) => {
        const items = await fetchSpecializationWorkTypes(specialization.id);
        return [
          specialization.id,
          items.filter((item) => item.is_active),
        ] as const;
      }),
    )
      .then((groups) => {
        if (active) {
          setWorkTypesBySpecialization(Object.fromEntries(groups));
        }
      })
      .catch((nextError) => {
        if (active) {
          setWorkTypesBySpecialization({});
          setWorkTypesError(errorText(nextError, tx));
        }
      })
      .finally(() => {
        if (active) {
          setWorkTypesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, selectedSpecializationItems, step, tx]);

  useEffect(() => {
    if (!open) return;
    // These catalogues are large and only used by their respective steps.
    // Keep one request per wizard session and load it on first use.
    const sessionVersion = lookupSessionVersionRef.current;
    const isCurrentSession = () => lookupSessionVersionRef.current === sessionVersion;
    const loadSpecialties = () => {
      specialtiesRequestRef.current ??= fetchSpecializations(false, true).catch(() => []);
      return specialtiesRequestRef.current;
    };

    if (step === "medical") {
      if (medicalLookupsLoadedRef.current && specialtiesLoadedRef.current) {
        setMedicalLookupsLoading(false);
        return;
      }
      medicalLookupsRequestRef.current ??= Promise.all([
        fetchProviders("/providers?active_only=true&provider_type=medical").catch(() => []),
        fetchAllDoctors().catch(() => []),
      ]);
      setMedicalLookupsLoading(true);
      void Promise.all([medicalLookupsRequestRef.current, loadSpecialties()])
        .then(([[nextProviders, nextAllDoctors], nextSpecialties]) => {
          if (!isCurrentSession()) return;
          setClinicalProviders(nextProviders.filter((item) => item.provider_type === "medical"));
          setAllDoctors(nextAllDoctors);
          setSpecialties(nextSpecialties);
          medicalLookupsLoadedRef.current = true;
          specialtiesLoadedRef.current = true;
        })
        .finally(() => {
          if (isCurrentSession()) setMedicalLookupsLoading(false);
        });
      return;
    }

    if (step === "order") {
      if (specialtiesLoadedRef.current) {
        setCommercialLookupsLoading(false);
        return;
      }
      const uiRequestVersion = commercialLookupUiVersionRef.current + 1;
      commercialLookupUiVersionRef.current = uiRequestVersion;
      setCommercialLookupsLoading(true);
      void loadSpecialties()
        .then((nextSpecialties) => {
          if (!isCurrentSession()) return;
          setSpecialties(nextSpecialties);
          specialtiesLoadedRef.current = true;
        })
        .finally(() => {
          if (
            isCurrentSession()
            && commercialLookupUiVersionRef.current === uiRequestVersion
          ) {
            setCommercialLookupsLoading(false);
          }
        });
      return;
    }

    if (step === "commercial") {
      if (specialtiesLoadedRef.current && agencyServicesLoadedRef.current) {
        setCommercialLookupsLoading(false);
        return;
      }
      const uiRequestVersion = commercialLookupUiVersionRef.current + 1;
      commercialLookupUiVersionRef.current = uiRequestVersion;
      agencyServicesRequestRef.current ??= fetchAgencyServices(
        "/agency-services?active_only=true",
        { forceFresh: true },
      ).catch(() => []);
      setCommercialLookupsLoading(true);
      void Promise.all([loadSpecialties(), agencyServicesRequestRef.current])
        .then(([nextSpecialties, nextAgencyServices]) => {
          if (!isCurrentSession()) return;
          setSpecialties(nextSpecialties);
          setAgencyServices(nextAgencyServices.filter((item) => item.is_active));
          specialtiesLoadedRef.current = true;
          agencyServicesLoadedRef.current = true;
        })
        .finally(() => {
          if (
            isCurrentSession()
            && commercialLookupUiVersionRef.current === uiRequestVersion
          ) {
            setCommercialLookupsLoading(false);
          }
        });
    }
  }, [open, step]);
  const selectedWorkTypeIdSet = useMemo(
    () => new Set(draft?.selectedSpecializationWorkTypeIds ?? []),
    [draft?.selectedSpecializationWorkTypeIds],
  );
  const selectedCostEstimateWorkTypes = useMemo(
    () => {
      const uniqueWorkTypes = new Map<string, SpecializationWorkType>();
      for (const specialization of selectedSpecializationItems) {
        for (const item of workTypesBySpecialization[specialization.id] ?? []) {
          if (item.is_active && selectedWorkTypeIdSet.has(item.id)) {
            uniqueWorkTypes.set(item.id, item);
          }
        }
      }
      return [...uniqueWorkTypes.values()].toSorted(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.code.localeCompare(right.code),
      );
    },
    [
      selectedSpecializationItems,
      selectedWorkTypeIdSet,
      workTypesBySpecialization,
    ],
  );
  // The VKS lists medical work types only; agency services never stand in for them.
  const costEstimateStatus = costEstimateWorkTypeStatus({
    specializationCount: draft?.specialties.length ?? 0,
    availableWorkTypeCount: selectedSpecializationItems.reduce(
      (count, specialization) => count + (workTypesBySpecialization[specialization.id]?.length ?? 0),
      0,
    ),
    selectedWorkTypeCount: selectedCostEstimateWorkTypes.length,
    loading: !workTypesError && (
      workTypesLoading
      || commercialLookupsLoading
      || selectedSpecializationItems.some((specialization) => !(specialization.id in workTypesBySpecialization))
    ),
    failed: Boolean(workTypesError),
  });
  const costEstimateHint = costEstimateWorkTypeHint(costEstimateStatus, tx, COST_ESTIMATE_WORK_TYPES_STEP);
  const selectedSpecializationLabelById = useMemo(
    () => new Map(
      selectedSpecializationItems.map((specialization) => [
        specialization.id,
        lang === "de"
          ? specialization.name_de || specialization.name_en || specialization.name_ru || specialization.code
          : specialization.name_ru || specialization.name_de || specialization.name_en || specialization.code,
      ]),
    ),
    [lang, selectedSpecializationItems],
  );
  const estimatedOutlaysLine = lines.find(isEstimatedOutlaysLine) ?? null;
  const orderServiceLines = useMemo(
    () => lines.filter((line) => !isEstimatedOutlaysLine(line)),
    [lines],
  );
  const orderPositionCount = orderServiceLines.length + selectedCostEstimateWorkTypes.length;

  const showWizardError = useCallback((nextError: unknown) => {
    if (isLeadConvertedError(nextError)) {
      // 409 `lead_converted`: the banner says it instead of a generic error.
      setConvertedByServer(true);
      setError("");
      setValidationContext(null);
      if (leadId) void fetchLeadDetail(leadId).then(setLead).catch(() => undefined);
      return;
    }
    const reasons = leadErrorBlockingReasons(nextError);
    if (reasons.length > 0) {
      const firstReason = reasons[0];
      if (!firstReason) return;
      setError("");
      setValidationContext({ kind: "server", reasons });
      setStep(readinessReasonStep(firstReason));
      const fieldId = readinessReasonFieldId(firstReason, null);
      if (fieldId) {
        window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      }
      return;
    }
    setValidationContext(null);
    setError(errorText(nextError, tx));
  }, [leadId, tx]);

  const clearServerValidation = useCallback(() => {
    setValidationContext((current) => current?.kind === "server" ? null : current);
  }, []);

  const replaceDocumentPreview = useCallback((nextPreview: WizardDocumentPreview | null) => {
    const currentUrl = documentPreviewUrlRef.current;
    if (currentUrl && currentUrl !== nextPreview?.url) {
      revokeDocumentPreviewObjectUrl(currentUrl);
    }
    documentPreviewUrlRef.current = nextPreview?.url ?? null;
    setDocumentPreview(nextPreview);
    setDocumentPreviewError("");
    setDocumentPreviewJump(null);
  }, []);

  useEffect(() => () => {
    if (documentPreviewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
      documentPreviewUrlRef.current = null;
    }
  }, []);

  const reload = useCallback(async (
    hydrateDraft: boolean,
    hydrateCommercial = false,
    readOnly = false,
    keepStep = false,
  ) => {
    if (!leadId) return;
    const reloadVersion = reloadVersionRef.current + 1;
    reloadVersionRef.current = reloadVersion;
    // A reload supersedes every load begun before it: their lead, quotes and
    // orders are not written once it started.
    stateLoadVersionRef.current += 1;
    const leadTicket = leadLoadGuardRef.current.begin();
    const isCurrentReload = () => reloadVersionRef.current === reloadVersion;
    const commercialVersions = { ...commercialFlagRequestVersionRef.current };
    setLoading(true);
    setError("");
    setValidationContext(null);
    replaceDocumentPreview(null);
    try {
      const leadPromise = fetchLeadDetail(leadId);
      const initialDocumentsPromise = fetchDocuments(
        "/documents?lead_id=" + encodeURIComponent(leadId) + "&include_archived_versions=true",
      ).catch(() => []);
      const documentsPromise = leadPromise.then(async (nextLead) => {
        let attachmentImportError: unknown = null;
        let refused: LeadAttachmentImportRefusal[] = [];
        let nextDocuments = await initialDocumentsPromise;
        // A converted lead imports nothing more; a file the import refused is not tried again on every load.
        if (
          !readOnly
          && !isConvertedLead(nextLead)
          && nextLead.attachments?.some((attachment) => !attachment.imported_at && !attachment.import_refused_at)
        ) {
          try {
            const imported = await importLeadAttachments(leadId);
            refused = imported?.refused ?? [];
            nextDocuments = await fetchDocuments(
              "/documents?lead_id=" + encodeURIComponent(leadId) + "&include_archived_versions=true",
            ).catch(() => nextDocuments);
          } catch (nextError) {
            attachmentImportError = nextError;
          }
        }
        return { attachmentImportError, documents: nextDocuments, refused };
      });
      const leadOrdersPath = "/orders?lead_id=" + encodeURIComponent(leadId);
      const ordersPromise = Promise.all([
        leadPromise,
        fetchOrders(leadOrdersPath).catch(() => []),
      ]).then(async ([orderLead, existingOrders]) => {
          if (
            readOnly
            ||
            existingOrders.length > 0
            || !["new", "in_progress", "qualified"].includes(orderLead.qualification_status)
          ) {
            return { bootstrapError: null, orders: existingOrders };
          }
          try {
            await createOrder({ source_lead_id: leadId });
            return {
              bootstrapError: null,
              orders: await fetchOrders(leadOrdersPath),
            };
          } catch (bootstrapError) {
            // A sanctions or country block has its own banner.
            if (isSanctionsGateError(bootstrapError)) return { bootstrapError: null, orders: existingOrders };
            return { bootstrapError, orders: existingOrders };
          }
        });

      const [
        nextLead,
        nextDocumentState,
        nextCases,
        nextContracts,
        nextOrderState,
        nextQuotes,
      ] = await Promise.all([
        leadPromise,
        documentsPromise,
        fetchCases("/cases?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        leadPromise.then(fetchWizardContracts).catch(() => []),
        ordersPromise,
        fetchQuotes("/quotes?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
      ]);
      if (!isCurrentReload()) return;
      const nextOrders = nextOrderState.orders;
      setDocuments(nextDocumentState.documents);
      setAttachmentImportRefused(nextDocumentState.refused);
      if (nextDocumentState.attachmentImportError) {
        setError(
          `${tx("Не удалось импортировать файлы опросника", "Fragebogendateien konnten nicht importiert werden")}: ${errorText(nextDocumentState.attachmentImportError, tx)}`,
        );
      }
      if (nextOrderState.bootstrapError) {
        setError(
          `${tx("Не удалось создать заказ для лида", "Auftrag für den Lead konnte nicht erstellt werden")}: ${errorText(nextOrderState.bootstrapError, tx)}`,
        );
      }
      const nextOrder = nextOrders[0] ?? null;
      const prospectId = nextLead.intake_model === "patient_first"
        ? nextLead.prospect_patient_id
        : null;
      const prospectCaseId = nextLead.intake_model === "patient_first"
        ? nextLead.prospect_case_id
        : null;
      const nextCase = prospectCaseId
        ? { id: prospectCaseId } as CaseListItem
        : nextCases[0] as CaseListItem | undefined;
      const [nextCaseDetail, nextOrderDetail, prospectClinical] = await Promise.all([
        nextCase && hydrateDraft
          ? fetchCaseDetail(nextCase.id).catch(() => null)
          : Promise.resolve(null),
        nextOrder && (hydrateDraft || hydrateCommercial)
          ? fetchOrder(nextOrder.id).catch(() => null)
          : Promise.resolve(null),
        prospectId && hydrateDraft
          ? loadPatientClinical(prospectId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!isCurrentReload()) return;
      const paymentQuote = nextOrder
        ? nextQuotes.find((item) => item.order_id === nextOrder.id)
        : nextQuotes[0];
      const storedCommercialDraft = storedCommercialDraftFromLead(nextLead);
      const storedLeadDraft = draftFromLead(nextLead);
      const leadDraft: Draft = {
        ...storedLeadDraft,
        programDateFrom: storedLeadDraft.programDateFrom || nextOrder?.date_from || "",
        programDateTo: storedLeadDraft.programDateTo || nextOrder?.date_to || "",
      };
      const caseDraft: Draft = {
        ...leadDraft,
        concern: nextCaseDetail?.hauptanfragegrund || leadDraft.concern,
        referrer: nextCaseDetail?.zuweiser || leadDraft.referrer,
      };
      prospectMergeOnlyRef.current = nextLead.prospect_patient_lifecycle === "active" || nextLead.prospect_patient_lifecycle === "inactive";
      const nextDraft = prospectClinical && prospectCaseId
        ? hydrateClinicalDraft(caseDraft, prospectClinical, prospectCaseId)
        : caseDraft;
      // A refresh of the open wizard stays on its step; opening a lead starts at step 1.
      const nextStep: StepId = keepStep && hydrated.current === leadId
        ? currentStepRef.current
        : "master_data";
      const nextLines = preferPersistedCommercialLines(
        storedCommercialDraft?.lines ?? [],
        nextOrderDetail?.leistungen,
        storedCommercialDraft?.savedAt ?? null,
        nextOrderDetail?.updated_at ?? null,
      );
      const nextPrepayment = nextOrder
        ? Boolean(nextOrder.prepayment_required)
        : storedCommercialDraft?.prepayment ?? false;
      const nextPrepaymentAmount = nextOrder?.prepayment_amount != null
        ? String(nextOrder.prepayment_amount)
        : storedCommercialDraft?.prepaymentAmount
          || (nextPrepayment && paymentQuote ? String(paymentQuote.total_gross) : "");
      const nextPaidAmount = paymentQuote
        ? String(paymentQuote.paid_amount ?? "")
        : "";

      if (leadLoadGuardRef.current.claim(leadTicket)) setLead(nextLead);
      setCases(nextCase ? [nextCase] : nextCases as CaseListItem[]);
      caseIdRef.current = nextCase?.id ?? null;
      prospectPatientIdRef.current = prospectId ?? null;
      prospectMergeOnlyRef.current = nextLead.prospect_patient_lifecycle === "active"
        || nextLead.prospect_patient_lifecycle === "inactive";
      setContracts(nextContracts);
      setOrders(nextOrders);
      setQuotes(nextQuotes);
      wizardStateBaseRef.current = nextLead.wizard_state ?? {};
      if (hydrateDraft || hydrated.current !== leadId) {
        hydrated.current = leadId;
        lastPersistedLeadIdRef.current = leadId;
        setDraft(nextDraft);
        setTrustedContactsBase(trustedContactsPayload(
          storedTrustedContactDrafts(nextLead.trusted_contacts, nextDraft.trustedContacts),
        ));
        lastSentTrustedContactsRef.current = null;
        savedMinorRef.current = isMinor(nextDraft.birthDate, new Date());
        initialServiceOptionsRef.current = nextDraft.serviceNeeds;
        setStep(nextStep);
        setTouchedMasterFields(new Set());
        setMasterValidationAttempted(false);
        setServerMasterError(null);
        setBirthDateEntryError(null);
        setOrderValidationAttempted(false);
            setValidationContext(null);
      }
      if (hydrateDraft || hydrateCommercial) {
        setLines(nextLines);
        if (commercialVersions.prepayment_required === commercialFlagRequestVersionRef.current.prepayment_required) setPrepayment(nextPrepayment);
        if (commercialVersions.prepayment_amount === commercialFlagRequestVersionRef.current.prepayment_amount) setPrepaymentAmount(nextPrepaymentAmount);
        if (commercialVersions.prepayment_due_at === commercialFlagRequestVersionRef.current.prepayment_due_at) setPrepaymentDeadline(localDeadline(nextOrder?.prepayment_due_at));
        if (commercialVersions.signed_patient === commercialFlagRequestVersionRef.current.signed_patient) setSignedPatient(Boolean(nextOrder?.signed_patient));
        if (commercialVersions.signed_agency === commercialFlagRequestVersionRef.current.signed_agency) setSignedAgency(Boolean(nextOrder?.signed_agency));
        setPaidAmount(nextPaidAmount);
      }
      if (hydrateDraft) {
        const signature = autosaveSnapshotSignature({
          draft: nextDraft,
          lines: nextLines,
          paidAmount: nextPaidAmount,
          prepayment: nextPrepayment,
          prepaymentAmount: nextPrepaymentAmount,
          step: nextStep,
        });
        currentAutosaveSignatureRef.current = signature;
        lastSavedAutosaveSignatureRef.current = signature;
        setAutosaveError("");
        setAutosaveStatus("saved");
      }
      return nextLead;
    } catch (nextError) {
      if (isCurrentReload()) showWizardError(nextError);
    } finally {
      if (isCurrentReload()) setLoading(false);
    }
  }, [hydrateClinicalDraft, leadId, loadPatientClinical, replaceDocumentPreview, showWizardError, tx]);

  const refreshLeadState = useCallback(async () => {
    if (!leadId) return null;
    const ticket = leadLoadGuardRef.current.begin();
    const nextLead = await fetchLeadDetail(leadId);
    if (hydrated.current === leadId && leadLoadGuardRef.current.claim(ticket)) {
      setLead(nextLead);
    }
    return nextLead;
  }, [leadId]);

  const refreshDocumentsState = useCallback(async () => {
    if (!leadId) return;
    const loadVersion = ++stateLoadVersionRef.current;
    const leadTicket = leadLoadGuardRef.current.begin();
    const commercialVersions = { ...commercialFlagRequestVersionRef.current };
    const [nextLead, nextDocuments, nextOrders] = await Promise.all([
      fetchLeadDetail(leadId),
      fetchDocuments("/documents?lead_id=" + encodeURIComponent(leadId) + "&include_archived_versions=true"),
      fetchOrders("/orders?lead_id=" + encodeURIComponent(leadId)).catch(() => null),
      patientReview.refresh(),
    ]);
    // A paper or electronic signature also signs the framework contract or the
    // order on the server: their chips follow without reopening the wizard
    // (QA 2026-10-11 C-07).
    const nextContracts = await fetchWizardContracts(nextLead).catch(() => null);
    if (hydrated.current !== leadId) return;
    if (stateLoadVersionRef.current !== loadVersion) return;
    if (leadLoadGuardRef.current.claim(leadTicket)) setLead(nextLead);
    setDocuments(nextDocuments);
    if (nextContracts) setContracts(nextContracts);
    if (nextOrders) {
      setOrders(nextOrders);
      const nextOrder = nextOrders[0] ?? null;
      if (commercialVersions.signed_patient === commercialFlagRequestVersionRef.current.signed_patient) setSignedPatient(Boolean(nextOrder?.signed_patient));
      if (commercialVersions.signed_agency === commercialFlagRequestVersionRef.current.signed_agency) setSignedAgency(Boolean(nextOrder?.signed_agency));
    }
  }, [leadId, patientReview.refresh]);

  // Patient portal (owner decision 2026-10-03): the patient's step-1 changes
  // are taken into fields staff have not edited since the last load.
  const step1PortalLeadRef = useRef<LeadDetail | null>(null);
  useEffect(() => {
    step1PortalLeadRef.current = lead;
  }, [lead]);
  useEffect(() => {
    trustedContactsBaseRef.current = trustedContactsBase;
  }, [trustedContactsBase]);
  const mergePatientStep1 = useCallback(async () => {
    if (!leadId) return;
    // A save under way reaches the server first, so the fresh lead knows it.
    await saveQueueRef.current;
    clearApiCache(`/leads/${leadId}`);
    const ticket = leadLoadGuardRef.current.begin();
    const fresh = await fetchLeadDetail(leadId).catch(() => null);
    if (!fresh || hydrated.current !== leadId) return;
    // An older lead than the one shown would merge stale cabinet values back.
    if (!leadLoadGuardRef.current.claim(ticket)) return;
    const previous = step1PortalLeadRef.current;
    const next = draftFromLead(fresh);
    if (previous) {
      const base = draftFromLead(previous);
      setDraft((current) => (current ? mergePatientUpdates(current, base, next) ?? current : current));
    }
    // The cabinet changes trusted contacts too (a second parent, a corrected
    // name): they replace the contacts staff have not edited.
    const freshContacts = storedTrustedContactDrafts(fresh.trusted_contacts, next.trustedContacts);
    const storedContacts = trustedContactsBaseRef.current;
    setTrustedContactsBase(trustedContactsPayload(freshContacts));
    lastSentTrustedContactsRef.current = null;
    setDraft((current) => {
      if (!current) return current;
      const merged = mergeTrustedContacts(current.trustedContacts, storedContacts, freshContacts);
      return JSON.stringify(merged) === JSON.stringify(current.trustedContacts)
        ? current
        : { ...current, trustedContacts: merged };
    });
    setLead(fresh);
  }, [leadId]);
  const step1Portal = useLeadStep1Portal({ leadId, open, onPatientDataChanged: mergePatientStep1 });
  /** The reason the lead wrote in the cabinet (trigger flow 13.1); "" without one or without medical access. */
  const patientRequestReason = step1Portal.intake?.request_reason?.text.trim() ?? "";
  // Who signs and pays (for a minor the legal representatives): shown in the
  // documents step and used by the buttons of the GwG identification sheet.
  const identification = useLeadIdentificationStatus(
    open && step === "documents" ? leadId : null,
    documents,
    payer.data?.declaration?.updated_at ?? null,
    representationVersion,
  );
  // Trigger flow 2026-10-07: points, level, blocks and staff decisions of the lead's risk assessment.
  const risk = useLeadRiskAssessment(open && step === "documents" ? leadId : null, enhancedCheckVersion);
  // A decision or a request of block D lifts the risk hold of the payer link: its panel follows.
  const riskPayerLinkKey = risk.assessment
    ? [risk.assessment.level, risk.assessment.status, risk.assessment.requested_blocks.join("")].join("|")
    : "";
  // The follow-up blocks the lead is asked: "Данные от пациента" leaves out the unasked questions.
  const riskAskedBlocks = useMemo(() => {
    const assessment = risk.assessment;
    if (!assessment) return [];
    return [...new Set([...assessment.blocks.filter((block) => block.open).map((block) => block.key), ...assessment.requested_blocks])];
  }, [risk.assessment]);
  const reloadPayerLink = payerLink.reload;
  useEffect(() => {
    if (riskPayerLinkKey) void reloadPayerLink();
  }, [riskPayerLinkKey, reloadPayerLink]);
  // A level of 2 or more requires the enhanced check: "Начать оценку", a
  // restart or a decision changes it at once, not only after reopening the
  // wizard (QA 2026-10-10).
  const riskEnhancedCheckKey = risk.assessment
    ? [risk.assessment.started_at ?? "", risk.assessment.level, risk.assessment.status ?? "", risk.assessment.decisions.length].join("|")
    : "";
  const riskEnhancedCheckKeyRef = useRef("");
  useEffect(() => {
    const previous = riskEnhancedCheckKeyRef.current;
    riskEnhancedCheckKeyRef.current = riskEnhancedCheckKey;
    // The first load of the assessment comes with the enhanced check's own load.
    if (previous && riskEnhancedCheckKey && previous !== riskEnhancedCheckKey) void reloadEnhancedCheck();
  }, [riskEnhancedCheckKey, reloadEnhancedCheck]);
  const canReviewPortalUploads = Boolean(step1Portal.intake?.can_review_uploads);
  // The patient form is filled from the sent request, or — staff enter the data
  // themselves and nothing was sent — from the data GMED recorded (owner decision 2026-10-23).
  const selfDisclosureIntake = step1Portal.intake ? { ...step1Portal.intake, fill_mode: step1Portal.mode } : step1Portal.intake;
  const leadRequestSent = leadSelfDisclosureAvailable(selfDisclosureIntake);
  const leadFormUnavailableHint = leadSelfDisclosureUnavailableHint(selfDisclosureIntake, tx);
  const leadFormSourceNote = leadSelfDisclosureSourceNote(selfDisclosureIntake, tx);
  // Owner decision 2026-10-23, decided by the server: required in a new
  // patient's first onboarding, optional for a repeat order.
  const selfDisclosureRequirement = leadSelfDisclosureRequirement(lead?.readiness.checks);
  const patientUploadDocuments = useMemo(() => {
    const ids = new Set(step1Portal.intake?.uploads.map((upload) => upload.document_id) ?? []);
    return documents.filter((item) => ids.has(item.id) && !item.file_deleted_at && item.has_stored_file !== false);
  }, [documents, step1Portal.intake]);
  const reloadStep1PortalState = step1Portal.reload;
  const reloadStep1Portal = useCallback(() => {
    void reloadStep1PortalState();
  }, [reloadStep1PortalState]);
  // A save that changed the contacts or the lead's age changes who represents the lead.
  useEffect(() => {
    if (representationVersion > 0) void reloadStep1PortalState();
  }, [representationVersion, reloadStep1PortalState]);
  // A new parent's card is on file after the autosave: its address, birth data
  // and citizenships are written then, as the saved card's form would.
  const pendingDetailsRepresentation = step1Portal.intake && step1Portal.intake.lead_id === leadId
    ? step1Portal.intake.representation
    : null;
  const applyStep1Representation = step1Portal.applyRepresentation;
  const autosaveSettled = autosaveStatus !== "dirty" && autosaveStatus !== "saving";
  useEffect(() => {
    const pending = pendingRepresentativeDetailsRef.current;
    if (!leadId || !pendingDetailsRepresentation || !autosaveSettled || pending.size === 0) return;
    const ready = pendingRepresentativeDetailsReady(pending, pendingDetailsRepresentation.representatives);
    for (const person of pendingDetailsRepresentation.representatives) pending.delete(person.id);
    for (const item of ready) {
      void updateLeadRepresentativeDetails(leadId, item.id, item.values, item.base).then(
        (representation) => applyStep1Representation(representation),
        (cause) => setError(errorText(cause, tx)),
      );
    }
  }, [leadId, pendingDetailsRepresentation, autosaveSettled, pendingRepresentativeDetailsVersion, applyStep1Representation, tx]);
  useEffect(() => {
    wizardStateBaseRef.current = { ...wizardStateBaseRef.current, step1_fill_mode: step1Portal.mode };
  }, [step1Portal.mode]);

  // Files added from the patient card or the documents page while the wizard
  // was open show up when the medical, documents or commercial step is opened again.
  useEffect(() => {
    if (step !== "medical" && step !== "documents" && step !== "commercial") return;
    void refreshDocumentsState().catch(() => {});
  }, [step, refreshDocumentsState]);

  const refreshCommercialState = useCallback(async () => {
    if (!leadId) return [];
    const targetLeadId = leadId;
    const loadVersion = ++stateLoadVersionRef.current;
    const leadTicket = leadLoadGuardRef.current.begin();
    const signatureVersions = { ...commercialFlagRequestVersionRef.current };
    const leadPromise = fetchLeadDetail(targetLeadId);
    const [nextLead, nextDocuments, nextContracts, nextOrders, nextQuotes] = await Promise.all([
      leadPromise,
      fetchDocuments(`/documents?lead_id=${encodeURIComponent(targetLeadId)}&include_archived_versions=true`),
      leadPromise.then(fetchWizardContracts),
      fetchOrders(`/orders?lead_id=${encodeURIComponent(targetLeadId)}`),
      fetchQuotes(`/quotes?lead_id=${encodeURIComponent(targetLeadId)}`),
    ]);
    if (hydrated.current !== targetLeadId) return [];
    // A newer load is on its way: its state wins; the caller still gets the documents.
    if (stateLoadVersionRef.current !== loadVersion) return nextDocuments;
    if (leadLoadGuardRef.current.claim(leadTicket)) setLead(nextLead);
    setDocuments(nextDocuments);
    setContracts(nextContracts);
    setOrders(nextOrders);
    setQuotes(nextQuotes);
    const nextOrder = nextOrders[0];
    const nextOrderId = nextOrder?.id;
    if (prospectMergeOnlyRef.current && nextOrder) {
      if (signatureVersions.signed_patient === commercialFlagRequestVersionRef.current.signed_patient) setSignedPatient(Boolean(nextOrder.signed_patient));
      if (signatureVersions.signed_agency === commercialFlagRequestVersionRef.current.signed_agency) setSignedAgency(Boolean(nextOrder.signed_agency));
    }
    if (nextOrder) {
      if (signatureVersions.prepayment_required === commercialFlagRequestVersionRef.current.prepayment_required) setPrepayment(Boolean(nextOrder.prepayment_required));
      if (signatureVersions.prepayment_amount === commercialFlagRequestVersionRef.current.prepayment_amount) setPrepaymentAmount(String(nextOrder.prepayment_amount ?? ""));
      if (signatureVersions.prepayment_due_at === commercialFlagRequestVersionRef.current.prepayment_due_at) setPrepaymentDeadline(localDeadline(nextOrder.prepayment_due_at));
    }
    const nextQuote = nextQuotes.find((item) => !nextOrderId || item.order_id === nextOrderId);
    setPaidAmount(nextQuote ? String(nextQuote.paid_amount ?? "") : "");
    return nextDocuments;
  }, [leadId]);

  useDebouncedRealtimeSubscription(["lead.payment_status_changed"], (_event, events) => {
    if (!open || !leadId || !events.some((event) => event.entity_id === leadId)) return;
    clearApiCache("/quotes");
    clearApiCache("/orders");
    clearApiCache(`/leads/${leadId}`);
    void refreshCommercialState().catch(() => undefined);
  }, 250);

  useRealtimeSubscription([LEAD_PURGED_EVENT], (event) => {
    if (open && isLeadPurgedEvent(event, leadId)) setPurgedByRetention(true);
  });
  // The deletion warning (the countdown in the header) and the 18th birthday
  // (the parents' access) change the lead behind the wizard: read it again.
  useDebouncedRealtimeSubscription(LEAD_TIME_REFRESH_EVENTS, (_event, events) => {
    if (!open || !leadId || !touchesLeadTimeState(events, leadId)) return;
    clearApiCache(`/leads/${leadId}`);
    void refreshLeadState().catch(() => undefined);
  }, 250);

  useEffect(() => {
    if (!open || !createMode || leadId || hydrated.current === "__new__") return;

    const nextDraft = existingPatient
      ? draftFromExistingPatient(existingPatient)
      : blankDraft();
    const signature = autosaveSnapshotSignature({
      draft: nextDraft,
      lines: [],
      paidAmount: "",
      prepayment: false,
      prepaymentAmount: "",
      step: "master_data",
    });

    hydrated.current = "__new__";
    setLead(null);
    setDraft(nextDraft);
    setPrefilledFromSource(null);
    sourcePersonNameRef.current = null;
    setTrustedContactsBase([]);
    setNewLeadCustody("");
    lastSentTrustedContactsRef.current = null;
    savedMinorRef.current = false;
    setStep("master_data");
    setDocuments([]);
    setCases([]);
    setContracts([]);
    setOrders([]);
    setQuotes([]);
    setSpecialties([]);
    setWorkTypesBySpecialization({});
    setWorkTypesLoading(false);
    setWorkTypesError("");
    setAgencyServices([]);
    setClinicalProviders([]);
    setAllDoctors([]);
    setMedicalLookupsLoading(false);
    setCommercialLookupsLoading(false);
    setLines([]);
    setPrepayment(false);
    setPrepaymentAmount("");
    setPrepaymentDeadline("");
    setSignedPatient(false);
    setSignedAgency(false);
    setPaidAmount("");
    setLoading(false);
    setError("");
    setCommercialDocumentErrors({});
    setCommercialQuoteError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setServerMasterError(null);
    setBirthDateEntryError(null);
    setOrderValidationAttempted(false);
    setValidationContext(null);
    wizardStateBaseRef.current = {};
    currentAutosaveSignatureRef.current = signature;
    lastSavedAutosaveSignatureRef.current = signature;
    caseIdRef.current = null;
    prospectPatientIdRef.current = null;
    prospectMergeOnlyRef.current = false;
    clinicalBaselineRef.current = null;
    pendingClinicalEditsRef.current.clear();
    setClinicalAccessDenied(false);
    initialServiceOptionsRef.current = [];
  }, [createMode, existingPatient, leadId, open]);

  // «Новая заявка для этого человека»: the name and contact data the frontend
  // already holds about the relation / contact seed the empty step-1 fields, so
  // staff see whom the request is for before the first save; the server merges
  // the rest (birth date, citizenships, identity document) at creation.
  useEffect(() => {
    if (!open || !createMode || leadId || !sourcePerson) return;
    let active = true;
    const run = async () => {
      if ("patient_id" in sourcePerson) {
        const [patient, relations] = await Promise.all([
          apiFetch<PatientDetail>(`/patients/${sourcePerson.patient_id}`),
          apiFetch<RelationItem[]>(`/patients/${sourcePerson.patient_id}/relations`),
        ]);
        const relation = relations.find((item) => item.id === sourcePerson.relation_id);
        return {
          name: [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim(),
          seed: relation ? seedFromPatientRelation(relation) : null,
        };
      }
      const [child, childPortal] = await Promise.all([
        fetchLeadDetail(sourcePerson.lead_id),
        // The representative on file holds the address, birth date and
        // citizenships staff should see before the lead exists (M F-7).
        fetchLeadPortalIntake(sourcePerson.lead_id).catch(() => null),
      ]);
      const contact = child.trusted_contacts?.find((item) => item.id === sourcePerson.contact_id);
      const representative = childPortal?.representation?.representatives
        .find((item) => item.id === sourcePerson.contact_id) ?? null;
      return {
        name: [child.first_name, child.last_name].filter(Boolean).join(" ").trim(),
        seed: contact ? seedFromTrustedContact(contact, representative) : null,
      };
    };
    void run()
      .then(({ name, seed }) => {
        if (!active || hydrated.current !== "__new__") return;
        sourcePersonNameRef.current = name || null;
        if (seed) setDraft((current) => current ? fillMissingFromSeed(current, seed) : current);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [createMode, leadId, open, sourcePerson]);

  useEffect(() => {
    if (!open || !leadId) return;
    void reload(hydrated.current !== leadId);
  }, [leadId, open, reload]);

  // Opening the wizard on a brand-new lead moves it into "in progress"
  // (see docs/lead-status-strategy-ua.md). Guarded to fire once per lead.
  const promotedInProgressRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !leadId || lead?.qualification_status !== "new") return;
    if (promotedInProgressRef.current === leadId) return;
    promotedInProgressRef.current = leadId;
    void updateLeadStatus(leadId, "in_progress")
      .then(() => {
        window.dispatchEvent(new Event(NEW_LEAD_COUNTER_REFRESH_EVENT));
        return refreshLeadState();
      })
      .catch(() => undefined);
  }, [open, leadId, lead?.qualification_status, refreshLeadState]);

  useEffect(() => {
    if (open) return;
    reloadVersionRef.current += 1;
    lookupSessionVersionRef.current += 1;
    commercialLookupUiVersionRef.current += 1;
    medicalLookupsRequestRef.current = null;
    specialtiesRequestRef.current = null;
    agencyServicesRequestRef.current = null;
    medicalLookupsLoadedRef.current = false;
    specialtiesLoadedRef.current = false;
    agencyServicesLoadedRef.current = false;
    setCreatedLeadId(null);
    hydrated.current = null;
    setLead(null);
    setDraft(null);
    setDocuments([]);
    setCases([]);
    setContracts([]);
    setOrders([]);
    setQuotes([]);
    setSpecialties([]);
    setWorkTypesBySpecialization({});
    setWorkTypesLoading(false);
    setWorkTypesError("");
    setAgencyServices([]);
    setClinicalProviders([]);
    setAllDoctors([]);
    setError("");
    setCommercialDocumentErrors({});
    setCommercialQuoteError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setMedicalLookupsLoading(false);
    setCommercialLookupsLoading(false);
    setArchiveConfirmOpen(false);
    setServiceReportOpen(false);
    setWorkTypesExpanded(true);
    setReportWorkTypesExpanded(true);
    setDeleteServiceLine(null);
    setDeleteDocument(null);
    setDeleteReason("");
    setDeleteError("");
    setTrustedContactEditor(null);
    setTrustedContactEditorError("");
    setAmlSheetOpen(false);
    setAmlSheetError("");
    replaceDocumentPreview(null);
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setServerMasterError(null);
    setBirthDateEntryError(null);
    setOrderValidationAttempted(false);
    setValidationContext(null);
    currentAutosaveSignatureRef.current = "";
    lastSavedAutosaveSignatureRef.current = "";
    wizardStateBaseRef.current = {};
    caseIdRef.current = null;
    prospectPatientIdRef.current = null;
    prospectMergeOnlyRef.current = false;
    clinicalBaselineRef.current = null;
    pendingClinicalEditsRef.current.clear();
    setClinicalAccessDenied(false);
    lastPersistedLeadIdRef.current = null;
    pendingParentProfileLeadRef.current = null;
    initialServiceOptionsRef.current = [];
  }, [open, replaceDocumentPreview]);

  useEffect(() => {
    if (!open) {
      stepPillReadyRef.current = false;
      if (stepTabsRef.current) delete stepTabsRef.current.dataset.pillReady;
      return;
    }
    const stepNav = stepNavRef.current;
    const stepTabs = stepTabsRef.current;
    const stepPill = stepPillRef.current;
    if (!stepNav || !stepTabs || !stepPill) return;

    const activeStep = () => stepTabs.querySelector<HTMLElement>(`[data-step="${step}"]`);
    const movePill = (animate: boolean) => {
      const active = activeStep();
      if (!active) return;
      if (!animate) {
        const previousTransition = stepPill.style.transition;
        stepPill.style.transition = "none";
        stepPill.style.transform = `translateX(${active.offsetLeft}px)`;
        stepPill.style.width = `${active.offsetWidth}px`;
        void stepPill.offsetWidth;
        stepPill.style.transition = previousTransition;
        return;
      }
      stepPill.style.transform = `translateX(${active.offsetLeft}px)`;
      stepPill.style.width = `${active.offsetWidth}px`;
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animationFrame = window.requestAnimationFrame(() => {
      movePill(stepPillReadyRef.current && !reduceMotion);
      stepPillReadyRef.current = true;
      // From now on the pill alone marks the active step; the tab's own
      // background stays only as the first-frame fallback. Both together
      // showed two highlighted steps while the pill slid (QA B-17).
      stepTabs.dataset.pillReady = "true";

      centerActiveStep(reduceMotion ? "auto" : "smooth");
    });
    // On a phone the bar scrolls: the active step stays in view also after
    // the window changes size (rotation) or a tab changes width (QA 2026-10-22).
    function centerActiveStep(behavior: ScrollBehavior) {
      const active = activeStep();
      if (!active || !stepNav) return;
      const navRect = stepNav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      stepNav.scrollTo({
        behavior,
        left: stepNav.scrollLeft
          + activeRect.left
          - navRect.left
          - (stepNav.clientWidth - activeRect.width) / 2,
      });
    }
    // The bar takes its narrow layout only after the resize event: measure
    // two frames later, or the centring uses the wide layout (CI 2026-10-22).
    let resizeFrame = 0;
    const handleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = window.requestAnimationFrame(() => {
          movePill(false);
          centerActiveStep("auto");
        });
      });
    };
    window.addEventListener("resize", handleResize);
    // A tab changes width without a window resize (a step turns done and its
    // number becomes a check mark): keep the pill on the active tab.
    // The first report only states the current sizes; acting on it would cut
    // the slide to the newly chosen step short.
    let initialSizesReported = false;
    const tabsObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (!initialSizesReported) {
            initialSizesReported = true;
            return;
          }
          if (stepPillReadyRef.current) {
            movePill(false);
            centerActiveStep("auto");
          }
        });
    tabsObserver?.observe(stepTabs);
    for (const tab of stepTabs.querySelectorAll<HTMLElement>("[data-step]")) {
      tabsObserver?.observe(tab);
    }
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", handleResize);
      tabsObserver?.disconnect();
    };
  }, [lang, open, step]);

  useEffect(() => {
    stepPanelRef.current?.scrollTo({ top: 0 });
  }, [open, step]);

  const order = orders[0] ?? null;
  const contract = draft?.frameworkContractId
    ? [...contracts, ...patientReview.contracts].find(item => item.id === draft.frameworkContractId) ?? null
    : contracts.find((item) => item.status !== "terminated" && item.status !== "expired") ?? null;
  const attachedPatientId = existingPatient?.id ?? lead?.prospect_patient_id;
  const inheritedContract = Boolean(contract?.patient_id && contract.patient_id === attachedPatientId);
  const periodWarnings = draft ? orderPeriodWarnings(draft.programDateFrom, draft.programDateTo) : [];
  const periodWarningBanner = periodWarnings.length ? (
    <Banner tone="warning">
      <ul data-testid="order-period-warnings" className="space-y-1 text-xs leading-5">
        {periodWarnings.map((item) => <li key={item.key}>{lang === "de" ? item.de : item.ru}</li>)}
      </ul>
    </Banner>
  ) : null;
  // Repeat intake: preselect the patient's latest signed framework contract.
  // Framework contracts are open-ended until terminated, so the new order
  // attaches to it instead of silently creating a second contract.
  const autoContractRef = useRef(false);
  useEffect(() => {
    if (!isRepeatIntake || !draft || draft.frameworkContractId || autoContractRef.current) return;
    if (contracts.length > 0 || patientReview.contracts.length === 0) return;
    const preferred = patientReview.contracts
      .filter(isContractUsable)
      .sort((left, right) => (right.signed_at ?? right.created_at).localeCompare(left.signed_at ?? left.created_at))[0];
    if (!preferred) return;
    autoContractRef.current = true;
    setDraft((current) => current ? { ...current, frameworkContractId: preferred.id } : current);
  }, [contracts.length, draft, isRepeatIntake, patientReview.contracts]);
  const currentPatientEvidence = useMemo(() => patientReview.documents.filter(item => item.is_latest_version && item.status === "active" && !item.file_deleted_at
    && ["identity", "confidentiality_release", "privacy_information", "privacy_consents"].includes(wizardDocumentKind(item) ?? "")), [patientReview.documents]);
  const estimate = useMemo(() => calculateServiceLineEstimate(lines), [lines]);
  const orderServicesEstimate = useMemo(
    () => calculateServiceLineEstimate(orderServiceLines),
    [orderServiceLines],
  );
  // A quote closed by a newer quote of the order is never the current one.
  const orderQuotes = useMemo(
    () => quotes.filter((item) => (!order || item.order_id === order.id) && item.status !== "superseded"),
    [order, quotes],
  );
  const quote = orderQuotes[0] ?? null;
  // Countries of the high-risk list (with the black list) among the
  // residence, the citizenships and the payer's countries: facts for the
  // forms and an amber hint. A PEP is a hint too.
  const amlRisk = useMemo(
    () => draft ? amlRiskForCountries(riskCountryLists, draft.country, ...draft.citizenships, ...payerCountries) : null,
    [riskCountryLists, draft?.country, draft?.citizenships, payerCountries],
  );
  // Step-1 fields that hold a value: no "the patient fills it in" hint over them.
  const step1FilledDraftKeys = useMemo(() => {
    if (!draft) return [];
    const values = draft as unknown as Record<string, unknown>;
    return Object.keys(PORTAL_FIELD_BY_DRAFT_KEY).filter((key) => {
      const value = values[key];
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return value.trim() !== "";
      return value !== null && value !== undefined;
    });
  }, [draft]);
  // Staff's conclusion "PEP" for the patient or any other person (2026-10-23).
  const amlPepTriggered = Boolean(
    draft?.amlEnhancedDueDiligence.pepContractPartner
    || draft?.amlEnhancedDueDiligence.pepBeneficialOwner
    || Object.values(draft?.amlEnhancedDueDiligence.pepReviews ?? {}).some((review) => review.isPep),
  );
  // Owner rule 2026-10-07: only the server's check requires the enhanced
  // check — or a black-list country shown here before it is saved.
  const amlBlacklistCountries = useMemo(
    () => amlRisk?.countries.filter((code) => isBlacklistCountry(code, riskCountryLists)) ?? [],
    [amlRisk, riskCountryLists],
  );
  const amlRequired = enhancedCheckRequired(enhancedCheck, amlBlacklistCountries);
  const amlRequiredText = amlEnhancedCheckRequiredText(enhancedCheck, amlBlacklistCountries, tx, lang);
  const amlHints = amlEnhancedCheckHints({
    check: enhancedCheck,
    required: amlRequired,
    highRiskCountries: amlRisk?.countries.filter((code) => !isBlacklistCountry(code, riskCountryLists)) ?? [],
    pep: amlPepTriggered,
    tx,
    lang,
  });
  const amlDocumentRiskTier = enhancedCheckRiskTier({
    check: enhancedCheck,
    blacklistHit: amlBlacklistCountries.length > 0,
    highRiskHint: Boolean(amlRisk),
    pep: amlPepTriggered,
  });
  // The EDD form asks the country fields for a country tier (the server checks the same).
  const amlCountryFieldsRequired = amlDocumentRiskTier === "blacklist" || amlDocumentRiskTier === "high_risk";
  const amlTriggeredCountries = useMemo(
    () => [...new Set([...(amlRisk?.countries ?? []), ...(enhancedCheck?.countries ?? [])])],
    [amlRisk, enhancedCheck],
  );
  const agencyServiceById = useMemo(
    () => new Map(agencyServices.map((service) => [service.id, service])),
    [agencyServices],
  );
  const wizardDocuments = useMemo(() => {
    const grouped: Record<WizardDocumentKind, DocumentItem[]> = {
      identity: [],
      confidentiality_release: [],
      privacy_information: [],
      privacy_consents: [],
      enhanced_due_diligence: [],
      gwg_identification: [],
      lead_self_disclosure: [],
    };
    const seenDocumentIds = new Set<string>();
    [...currentPatientEvidence, ...documents].forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      if (seenDocumentIds.has(item.id)) return;
      const kind = wizardDocumentKind(item);
      if (kind) {
        seenDocumentIds.add(item.id);
        grouped[kind].push(item);
      }
    });
    return grouped;
  }, [documents, currentPatientEvidence]);
  const commercialDocuments = useMemo(() => {
    const grouped: Record<CommercialDocumentKind, DocumentItem[]> = {
      framework_contract: [],
      single_order: [],
      order_cost_estimate: [],
      cost_estimate: [],
    };
    documents.forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      const templateId = item.generated_template_id as CommercialDocumentKind | null;
      if (templateId && templateId in grouped) grouped[templateId].push(item);
    });
    return grouped;
  }, [documents]);
  // The current KV PDF states older terms than the order (`terms_current: false`):
  // the quote is not confirmed on it (409 `estimate_document_outdated`, F-W3/F-W4).
  const estimateDocumentOutdated = commercialDocuments.order_cost_estimate.some(
    (item) => item.is_latest_version && !wizardDocumentIsArchived(item) && item.terms_current === false,
  );
  // Medical files of the client: uploaded and listed in the medical step.
  const medicalDocuments = useMemo(
    () => documents.filter((item) => (
      !item.file_deleted_at
      && item.has_stored_file !== false
      && item.is_medical
      && !item.generated_template_id
      && !wizardDocumentKind(item)
    )),
    [documents],
  );
  const hasMedicalRecords = lead?.has_medical_records === "yes" || medicalDocuments.length > 0;
  // A representative's own uploads are listed under that person's ID card, not as "other documents".
  const representativeDocumentIds = useMemo(
    () => new Set(
      (step1Portal.intake?.representation?.representatives ?? []).flatMap((person) =>
        [...person.identity_documents, ...person.authority_documents].map((item) => item.id),
      ),
    ),
    [step1Portal.intake],
  );
  const supplementaryDocuments = useMemo(
    () => documents.filter((item) => (
      !item.file_deleted_at
      && item.has_stored_file !== false
      && !representativeDocumentIds.has(item.id)
      && !wizardDocumentKind(item)
      && !(item.is_medical && !item.generated_template_id)
      && !["framework_contract", "single_order", "order_cost_estimate", "cost_estimate", "cost_coverage_declaration"].includes(item.generated_template_id ?? "")
      // The payer's signature package lists its own documents (phase 3b).
      && !(PAYER_PACKAGE_TEMPLATE_IDS as readonly string[]).includes(item.generated_template_id ?? "")
    )),
    [documents, representativeDocumentIds],
  );
  // The third-party payer's Kostenübernahmeerklärung (payer section).
  const costAssumptionDocuments = useMemo(
    () => documents.filter((item) => (
      !item.file_deleted_at
      && item.has_stored_file !== false
      && item.generated_template_id === "cost_coverage_declaration"
    )),
    [documents],
  );
  const previewedDocument = [...currentPatientEvidence, ...documents].find((item) => item.id === documentPreview?.id);
  const previewComplianceKind = previewedDocument ? wizardDocumentComplianceKind(previewedDocument) : null;
  const previewDocumentSigned = Boolean(
    previewedDocument && documentSignedFor(previewedDocument, previewComplianceKind),
  );
  const intakeType = lead ? leadIntakeTypeFromLead(lead) : null;
  const isQuestionnaireLead = intakeType === "questionnaire";
  const isExternalIntakeLead = intakeType === "questionnaire" || intakeType === "form";
  const readiness = useMemo(() => new Map((lead?.readiness.steps ?? []).map((item) => [item.key, item.ready])), [lead?.readiness.steps]);
  const readinessChecks = useMemo(
    () => new Map((lead?.readiness.checks ?? []).map((item) => [item.key, item.passed])),
    [lead?.readiness.checks],
  );
  const quoteIsCurrent = useMemo(() => Boolean(
    quote
    && quoteMatchesCurrentServices(quote, lines, estimate.gross)
  ), [estimate.gross, lines, quote]);
  const acceptedQuote = quote?.status === "accepted" && quoteIsCurrent ? quote : null;
  const quoteTotal = quote ? money(quote.total_gross) : 0;
  const persistedPrepayment = quote ? money(quote.paid_amount) : 0;
  const enteredPrepayment = money(paidAmount);
  const requiredPrepayment = prepayment ? money(prepaymentAmount) || quoteTotal : 0;
  const requiredPrepaymentValid = !prepayment || (
    validMoneyInput(prepaymentAmount)
    && requiredPrepayment > 0
    && toCents(requiredPrepayment) <= toCents(quoteTotal)
  );
  const prepaymentRemaining = Math.max(requiredPrepayment - enteredPrepayment, 0);
  const serverQuoteAccepted = readinessChecks.get("quote_accepted");
  // A repeat order covered by a package needs no quote: the server's check
  // passes then, and the step counter follows it.
  const clientQuoteAndPrepaymentReady = Boolean(acceptedQuote) || serverQuoteAccepted === true;
  const serverPrepaymentReady = readinessChecks.get("prepayment_ready");
  const quoteAndPrepaymentReady = mergeCommercialQuoteReadiness(
    clientQuoteAndPrepaymentReady,
    serverQuoteAccepted,
    serverPrepaymentReady,
  );
  const quoteStateLabel = !quote
    ? tx("Смета ещё не рассчитана", "Kostenvoranschlag noch nicht berechnet")
    : !quoteIsCurrent
      ? tx("Услуги изменены — пересчитайте смету", "Leistungen geändert — Kostenvoranschlag neu berechnen")
      : quote.status !== "accepted"
        ? tx("Смета ожидает подтверждения", "Kostenvoranschlag wartet auf Annahme")
        : serverQuoteAccepted === false
          ? tx("Смета не соответствует текущему заказу — пересчитайте", "Kostenvoranschlag stimmt nicht mit dem aktuellen Auftrag überein — neu berechnen")
        : prepayment && (
            !requiredPrepaymentValid
            || toCents(persistedPrepayment) < toCents(requiredPrepayment)
            || serverPrepaymentReady === false
          )
          ? tx("Смета подтверждена, ожидается предоплата", "Kostenvoranschlag angenommen, Vorauszahlung ausstehend")
          : tx("Смета и предоплата актуальны", "Kostenvoranschlag und Vorauszahlung sind aktuell");

  const commercialDocumentTitle = (templateId: CommercialDocumentKind) => ({
    framework_contract: tx("Рамочный договор", "Rahmenvertrag"),
    single_order: tx("Документ заказа", "Einzelauftrag"),
    order_cost_estimate: tx("Смета к заказу", "Kostenvoranschlag zum Einzelauftrag"),
    cost_estimate: tx("Предварительный расчёт медицинских расходов", "Vorläufige medizinische Kostenkalkulation"),
  })[templateId];

  const renderCommercialDocumentError = (templateId: CommercialDocumentKind) => {
    const message = commercialDocumentErrors[templateId];
    if (!message) return null;
    const clientName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(" ")
      : "";
    // The VKS total is the medical work-type range; the agency order total never applies.
    const totalLabel = templateId !== "cost_estimate"
      ? formatMoneyLabel(estimate.gross)
      : selectedCostEstimateWorkTypes.length > 0
        ? costEstimateTotalRange(selectedCostEstimateWorkTypes)
        : null;
    const prepaymentLabel = !prepayment
      ? tx("не требуется", "nicht erforderlich")
      : prepaymentAmount.trim()
        ? formatMoneyLabel(money(prepaymentAmount))
        : tx("требуется, сумма не указана", "erforderlich, Betrag fehlt");

    const prepaymentExceedsTotal = templateId !== "cost_estimate"
      && prepayment && validMoneyInput(prepaymentAmount.trim())
      && toCents(money(prepaymentAmount)) > toCents(estimate.gross);

    return (
      <div
        id={commercialDocumentErrorId(templateId)}
        role="alert"
        aria-live="polite"
        className="mt-3 space-y-3 rounded-xl border border-destructive/25 bg-card p-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-80 items-start gap-2">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1 text-sm leading-6">
              <p className="font-semibold text-destructive">
                {tx("Не удалось выполнить действие", "Aktion fehlgeschlagen")}: {commercialDocumentTitle(templateId)}
              </p>
              <p className="text-foreground">{message}</p>
            </div>
          </div>
          {prepaymentExceedsTotal ? (
            <Button type="button" size="sm" className="h-8 shrink-0 bg-[var(--brand)] text-white hover:brightness-95"
              onClick={() => openValidationIssue({ key: "prepayment-amount", step: "commercial", message: "", fieldId: PREPAYMENT_AMOUNT_ID })}>
              {tx("К предоплате", "Zur Vorauszahlung")}<ArrowRight aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clientName ? (
            <StatusChip tone="warning"><UserRound aria-hidden="true" />{tx("Клиент", "Kunde")}: {clientName}</StatusChip>
          ) : null}
          <StatusChip className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
            <FileText aria-hidden="true" />{tx("Заказ", "Auftrag")}: {order?.order_number || tx("ещё не создан", "noch nicht erstellt")}
          </StatusChip>
          {totalLabel ? (
            <StatusChip tone="info"><ReceiptText aria-hidden="true" />{tx("Итого", "Gesamt")}: <span className="font-mono font-semibold tabular-nums">{totalLabel}</span></StatusChip>
          ) : null}
          {templateId !== "cost_estimate" ? (
            <StatusChip tone={prepaymentExceedsTotal ? "error" : "warning"}>
              {prepaymentExceedsTotal ? <CircleAlert aria-hidden="true" /> : <ReceiptText aria-hidden="true" />}
              {tx("Предоплата", "Vorauszahlung")}: <span className="font-mono font-semibold tabular-nums">{prepaymentLabel}</span>
            </StatusChip>
          ) : null}
        </div>
      </div>
    );
  };
  const masterEmailNoMail = useEmailDomainStatus(draft?.email ?? "") === "no_mail";
  const cabinetConsents = useMemo(() => cabinetConsentsOf(lead?.readiness), [lead?.readiness]);
  const storedPerson = useMemo<StoredPersonFields>(
    () => ({ firstName: lead?.first_name, lastName: lead?.last_name, city: lead?.city, phone: lead?.phone, email: lead?.email }),
    [lead?.first_name, lead?.last_name, lead?.city, lead?.phone, lead?.email],
  );
  const strictMasterErrors = useMemo(
    () => validateMasterDraft(draft, tx, isRepeatIntake, masterEmailNoMail, cabinetConsents.healthcare, storedPerson),
    [draft, isRepeatIntake, masterEmailNoMail, tx, cabinetConsents.healthcare, storedPerson],
  );
  // "The patient fills it in": only names and e-mail are needed for the lead.
  const masterErrors = useMemo(
    () => relaxMasterErrors(strictMasterErrors, step1Portal.mode, (key) => {
      const value = draft?.[key as keyof Draft];
      return typeof value === "string" ? value.trim() !== "" : Boolean(value);
    }),
    [draft, step1Portal.mode, strictMasterErrors],
  );
  const waitingForPatientData = patientDataPending(step1Portal.mode, draft);
  // What keeps step 1 of a saved lead open, by field. The cabinet can leave a
  // field empty that the stepper counts while the server's release list does
  // not (QA 2026-10-24, A-4: "Данные клиента — не завершено" with no marker
  // in the step); the step names these fields itself.
  // In «Заполнит пациент» mode date of birth and legal sex are not required to
  // save the lead, but the step stays open without them (owner 2026-10-26):
  // the medical part waits for both, so the step names them too.
  const masterOpenIssues = useMemo(
    () => (leadId ? masterValidationIssues(withPatientDataPending(masterErrors, strictMasterErrors, waitingForPatientData), tx) : []),
    [leadId, masterErrors, strictMasterErrors, tx, waitingForPatientData],
  );
  const orderIssues = useMemo(() => orderValidationIssues(draft, tx), [draft, tx]);
  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!validationContext) return [];
    if (validationContext.kind === "master") {
      return masterValidationIssues(masterErrors, tx);
    }
    if (validationContext.kind === "documents") {
      const issues = documentsValidationIssues(draft, wizardDocuments, tx, isRepeatIntake ? readinessChecks : undefined, amlRequired, lead?.readiness.demo_onboarding?.credited_checks, cabinetConsents, readinessChecks.get("risk_assessment_released") === false, readinessChecks.get("identity_document_verified") === true);
      return validationContext.scope === "qualification" ? qualificationDocumentIssues(issues) : issues;
    }
    if (validationContext.kind === "order") {
      return orderIssues;
    }
    return validationContext.reasons.map((reason) => ({
      key: reason,
      step: readinessReasonStep(reason),
      message: readinessReasonText(reason, tx, Boolean(draft && isMinor(draft.birthDate, new Date())), lead?.readiness),
      fieldId: readinessReasonFieldId(reason, draft),
    }));
  }, [draft, masterErrors, orderIssues, tx, validationContext, wizardDocuments, isRepeatIntake, readinessChecks, amlRequired, lead?.readiness, cabinetConsents]);
  const visibleOrderErrors = orderValidationAttempted ? orderIssues : [];
  const orderFieldError = (...keys: string[]) =>
    visibleOrderErrors.find((issue) => keys.includes(issue.key))?.message;
  const autosaveSnapshot = useMemo<AutosaveSnapshot | null>(
    () => draft ? { draft, lines, paidAmount, prepayment, prepaymentAmount, step } : null,
    [draft, lines, paidAmount, prepayment, prepaymentAmount, step],
  );

  // The confirmation covers what staff reviewed on the release step. Data is
  // only edited on the other steps, so leaving the release step (or switching
  // the lead) asks for it again. Saves and refreshes while staying there, e.g.
  // completing the intake from the "Подтвердите данные обращения" blocker,
  // replace the draft, document and quote objects without changing what was
  // reviewed, and must not clear the tick.
  useEffect(() => {
    setConversionConfirmed(false);
  }, [leadId, step]);

  const ensureProspect = useCallback(async (
    medicalDraft: Draft,
    options?: { attachPatientId?: string; forceCreate?: boolean },
  ) => {
    if (!leadId) throw new Error("Lead is not selected");
    if (!options && prospectPatientIdRef.current && caseIdRef.current) {
      return { patientId: prospectPatientIdRef.current, caseId: caseIdRef.current };
    }
    // The prospect patient is made from the stored lead: a legal sex or birth
    // date just chosen (the step-2 notice, step 1) reaches the server first
    // (owner 2026-10-26).
    await flushLeadAutosaveRef.current();
    const response = await createLeadProspect(leadId, {
      attach_patient_id: existingPatient?.id ?? options?.attachPatientId,
      force_create: existingPatient ? false : options?.forceCreate,
      hauptanfragegrund: medicalDraft.concern.trim(),
      zuweiser: medicalDraft.referrer.trim(),
    });
    if (response.duplicate_candidates?.length) {
      setProspectCandidates(response.duplicate_candidates);
      throw new ProspectDuplicateError(tx(
        "Найден существующий пациент с теми же данными — выберите: привязать или создать нового",
        "Vorhandener Patient mit denselben Stammdaten gefunden — bitte verknüpfen oder neu anlegen",
      ));
    }
    if (!response.patient_id || !response.case_id
      || (existingPatient && response.patient_id !== existingPatient.id)) {
      throw new Error(tx(
        "Не удалось создать карточку пациента",
        "Patientenakte konnte nicht angelegt werden",
      ));
    }
    prospectPatientIdRef.current = response.patient_id;
    caseIdRef.current = response.case_id;
    prospectMergeOnlyRef.current = response.attached === true
      || response.lifecycle_status === "active"
      || response.lifecycle_status === "inactive";
    setCases([{ id: response.case_id }]);
    setLead((current) => current ? {
      ...current,
      intake_model: "patient_first",
      prospect_patient_id: response.patient_id!,
      prospect_case_id: response.case_id!,
    } : current);
    return { patientId: response.patient_id, caseId: response.case_id };
  }, [existingPatient, leadId, tx]);

  const hydrateProspectClinical = useCallback(async (
    patientId: string,
    caseId: string,
    fallbackDraft: Draft,
  ) => {
    let clinical: PatientClinicalProfile;
    try {
      clinical = await loadPatientClinical(patientId);
    } catch (nextError) {
      throw new Error(tx(
        `Не удалось безопасно загрузить медицинскую карту пациента: ${errorText(nextError, tx)}`,
        `Die Patientenakte konnte nicht sicher geladen werden: ${errorText(nextError, tx)}`,
      ), { cause: nextError });
    }
    const hydrated = hydrateClinicalDraft(fallbackDraft, clinical, caseId);
    setDraft((current) => current
      ? hydrateClinicalDraft(current, clinical, caseId)
      : hydrated);
    return hydrated;
  }, [hydrateClinicalDraft, loadPatientClinical, tx]);

  const persistMedicalDraft = useCallback(async (medicalDraft: Draft) => {
    const run = async () => {
      if (!leadId) throw new Error("Lead is not selected");
      const { patientId, caseId } = await ensureProspect(medicalDraft);
      if (prospectMergeOnlyRef.current) {
        await saveCaseOverview(caseId, { hauptanfragegrund: medicalDraft.concern.trim(), zuweiser: medicalDraft.referrer.trim() });
        return caseId;
      }
      const latestClinical = await loadPatientClinical(patientId).catch((nextError) => {
        throw new Error(tx(
          `Не удалось проверить актуальные медицинские данные перед сохранением: ${errorText(nextError, tx)}`,
          `Die aktuellen medizinischen Daten konnten vor dem Speichern nicht geprüft werden: ${errorText(nextError, tx)}`,
        ));
      });
      const safeDraft = hydrateClinicalDraft(medicalDraft, latestClinical, caseId);
      const saveMode = prospectMergeOnlyRef.current ? "merge" : "replace";
      await saveCaseOverview(caseId, {
        hauptanfragegrund: safeDraft.concern.trim(),
        zuweiser: safeDraft.referrer.trim(),
      });
      await Promise.all([
        savePatientClinicalWarnings(
          patientId,
          "allergie",
          safeDraft.allergies.filter((item) => item.label.trim()),
          saveMode,
        ),
        savePatientClinicalWarnings(
          patientId,
          "cave",
          safeDraft.caves.filter((item) => item.label.trim()),
          saveMode,
        ),
        savePatientDiagnoses(
          patientId,
          safeDraft.diagnoses.filter((item) => item.label.trim()),
          saveMode,
        ),
        savePatientMedications(
          patientId,
          safeDraft.medications.filter((item) => item.wirkstoff?.trim()),
          saveMode,
        ),
      ]);
      const narrative = safeDraft.narrative;
      const hasNarrativeContent = Boolean(narrative && [
        narrative.anamnese_aktuelle,
        narrative.anamnese_vorgeschichte,
        narrative.anamnese_vegetative,
        narrative.anamnese_sozial,
        narrative.anamnese_familie,
        narrative.beurteilung,
      ].some((field) => field?.trim()));
      if (narrative && (narrative.id || hasNarrativeContent)
        && (!narrative.id || narrative.case_id === caseId)) {
        const saved = await savePatientNarrative(patientId, {
          ...narrative,
          case_id: caseId,
          is_active: true,
        });
        safeDraft.narrative = saved;
      }
      const persistedClinical = await loadPatientClinical(patientId);
      setDraft((previous) => previous
        ? applyPersistedClinicalProfile(previous, persistedClinical)
        : applyPersistedClinicalProfile(safeDraft, persistedClinical));
      return caseId;
    };
    const queued = medicalSaveQueueRef.current.then(run, run);
    medicalSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [ensureProspect, hydrateClinicalDraft, leadId, loadPatientClinical, tx]);

  const persistClinicalDraftSection = useCallback(async (
    section: LeadClinicalDraftSection,
    medicalDraft: Draft,
  ) => {
    const run = async () => {
      if (!leadId) throw new Error("Lead is not selected");
      const { patientId, caseId } = await ensureProspect(medicalDraft);
      const saveMode = prospectMergeOnlyRef.current ? "merge" : "replace";

      const baseline = clinicalBaselineRef.current;
      const field = section === "allergies" ? "allergien" : section === "caves" ? "cave" : section;
      const nextValue = section === "narrative" ? medicalDraft.narrative : medicalDraft[section];
      const requestKey = JSON.stringify([section, nextValue]);
      let guard = pendingClinicalEditsRef.current.get(requestKey);
      if (prospectMergeOnlyRef.current && !guard) {
        if (baseline?.revision == null) throw new Error(tx("Обновите медицинскую карту перед сохранением", "Aktualisieren Sie die Patientenakte vor dem Speichern"));
        const nextIds = new Set(Array.isArray(nextValue) ? nextValue.map(item => item.id) : []);
        const previous = baseline[field];
        const removedIds = Array.isArray(previous) ? previous.flatMap(item => item.id && !nextIds.has(item.id) ? [item.id] : []) : [];
        guard = { expected_revision: baseline.revision, operation_id: crypto.randomUUID(), ...(removedIds.length ? {remove_ids: removedIds.join(",")} : {}) };
        pendingClinicalEditsRef.current.set(requestKey, guard);
      }

      try {
      switch (section) {
        case "narrative":
          if (!medicalDraft.narrative) {
            throw new Error(tx("Анамнез не заполнен", "Anamnese ist nicht ausgefüllt"));
          }
          await savePatientNarrative(patientId, narrativeForIntakeSave(medicalDraft.narrative, caseId), guard);
          break;
        case "diagnoses":
          await savePatientDiagnoses(
            patientId,
            medicalDraft.diagnoses.filter((item) => item.label.trim()),
            saveMode,
            guard,
          );
          break;
        case "medications":
          await savePatientMedications(
            patientId,
            medicalDraft.medications.filter((item) => item.wirkstoff?.trim()),
            saveMode,
            guard,
          );
          break;
        case "allergies":
          await savePatientClinicalWarnings(
            patientId,
            "allergie",
            medicalDraft.allergies.filter((item) => item.label.trim()),
            saveMode,
            guard,
          );
          break;
        case "caves":
          await savePatientClinicalWarnings(
            patientId,
            "cave",
            medicalDraft.caves.filter((item) => item.label.trim()),
            saveMode,
            guard,
          );
          break;
      }

      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === 409) {
          pendingClinicalEditsRef.current.delete(requestKey);
          clinicalBaselineRef.current = null;
          throw new Error(tx("Медицинская карта изменена другим пользователем. Обновите обращение и проверьте изменения перед сохранением.", "Die Patientenakte wurde zwischenzeitlich geändert. Aktualisieren Sie die Anfrage und prüfen Sie die Änderungen vor dem Speichern."), { cause });
        }
        throw cause;
      }
      const persistedClinical = await loadPatientClinical(patientId);
      setDraft((previous) => prospectMergeOnlyRef.current
        ? applyPersistedClinicalProfile(previous ?? medicalDraft, persistedClinical)
        : applyPersistedClinicalSection(previous ?? medicalDraft, persistedClinical, section));
      pendingClinicalEditsRef.current.delete(requestKey);
      return persistedClinical;
    };

    const queued = medicalSaveQueueRef.current.then(run, run);
    medicalSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [ensureProspect, leadId, loadPatientClinical, tx]);

  async function saveClinicalDraftChange<S extends LeadClinicalDraftSection>(
    section: S,
    nextDraft: Draft,
  ): Promise<NonNullable<Draft[S]>> {
    setError("");
    clearServerValidation();
    let toSave = nextDraft;
    let profile: PatientClinicalProfile;
    try {
      profile = await persistClinicalDraftSection(section, toSave);
    } catch (cause) {
      if (!(cause instanceof ProspectDuplicateError)) throw cause;
      // The value stays in its dialog while staff choose in «Найден
      // существующий пациент»; once attached (or a new patient created) it is
      // saved into that record beside what is already there (QA 2026-10-25, F-F8).
      const resolved = await new Promise<boolean>((resolve) => {
        prospectWaitersRef.current.push(resolve);
      });
      const persisted = clinicalBaselineRef.current;
      const caseId = caseIdRef.current;
      if (!resolved || !persisted || !caseId) throw cause;
      const merged = mergePatientClinicalDraft(nextDraft, persisted, caseId);
      toSave = section === "narrative"
        ? { ...nextDraft, narrative: merged.narrative, anamnese: merged.anamnese }
        : { ...nextDraft, [section]: merged[section] };
      profile = await persistClinicalDraftSection(section, toSave);
    }
    const saved = applyPersistedClinicalProfile(toSave, profile)[section];
    if (saved == null) throw new Error(tx("Не удалось загрузить сохранённую запись", "Der gespeicherte Eintrag konnte nicht geladen werden"));
    return saved as NonNullable<Draft[S]>;
  }

  const persistSnapshot = useCallback((
    snapshot: AutosaveSnapshot,
    force = false,
    knownSignature?: string,
  ) => {
    const signature = knownSignature ?? autosaveSnapshotSignature(snapshot);
    const previousWizardState = wizardStateBaseRef.current;
    const payload = autosavePayload(
      snapshot,
      previousWizardState,
      !lead?.prospect_patient_id,
    );

    const run = async () => {
      if (!force && currentAutosaveSignatureRef.current !== signature) return;
      // A flush (the step-2 notice, a prospect patient) saved it already.
      if (!force && lastSavedAutosaveSignatureRef.current === signature) return;

      let targetLeadId = leadId ?? lastPersistedLeadIdRef.current;
      let stage = "lead-create";
      let inheritedDraft = snapshot.draft;
      const initializing = !leadId;
      if (
        (hydrated.current === targetLeadId || (!targetLeadId && hydrated.current === "__new__")) &&
        currentAutosaveSignatureRef.current === signature
      ) {
        setAutosaveError("");
        setAutosaveStatus("saving");
      }

      try {
        if (!targetLeadId) {
          setExistingParentPatientId(null);
          const created = await createLead({
            creation_key: creationKeyRef.current,
            ...(existingPatient?.id ? { repeat_patient_id: existingPatient.id } : {}),
            ...(sourcePerson ? { source_person: sourcePerson } : {}),
            first_name: snapshot.draft.firstName.trim(),
            last_name: snapshot.draft.lastName.trim(),
            email: snapshot.draft.email.trim() || null,
            phone: snapshot.draft.phone.trim() || null,
            date_of_birth: snapshot.draft.birthDate || null,
            trusted_contacts: snapshot.draft.trustedContacts.map((contact) => ({
              id: contact.id,
              related_patient_id: contact.relatedPatientId || null,
              name: contact.name.trim(),
              phone: contact.phone.trim() || null,
              email: contact.email.trim() || null,
              relation: contact.relation.trim() || null,
              birth_date: contact.birthDate || null,
              address: contact.address.trim() || null,
            })),
            source: "manual",
            country: snapshot.draft.country.trim() || null,
            ...(newLeadCustody && isMinor(snapshot.draft.birthDate, new Date()) ? { custody: newLeadCustody } : {}),
            notes: snapshot.draft.serviceNotes.trim() || null,
          });
          targetLeadId = created.id;
          hydrated.current = targetLeadId;
          lastPersistedLeadIdRef.current = targetLeadId;
          const portalPassword = created.portal_account?.one_time_password;
          if (created.portal_account?.reused) {
            pendingParentProfileLeadRef.current = created.id;
            toast.success(lang === "de" ? "Bestehender Elternzugang verknüpft. Passwort und Zugang zu den Kindern bleiben erhalten." : "Подключён существующий аккаунт родителя. Пароль и доступ к детям сохранены.");
          }
          if (created.portal_account && portalPassword) {
            setIssuedPortalAccess({
              email: created.portal_account.email,
              password: portalPassword,
              firstName: snapshot.draft.firstName.trim(),
              language: snapshot.draft.language,
              leadId: created.id,
              userId: created.portal_account.user_id,
            });
          }
          if (created.prefilled_from_source) {
            // The server filled the empty fields from the source person: the
            // draft takes them before the first update (which sends every field).
            pendingParentProfileLeadRef.current = created.id;
            const notice = prefilledFromSourceNotice(created.prefilled_from_source, sourcePersonNameRef.current, tx);
            setPrefilledFromSource({ leadId: created.id, notice, pep: sourcePepHint(created.prefilled_from_source) });
            if (notice) toast.success(notice);
          }
        }

        // Creation can succeed while the profile GET fails. Keep this boundary
        // pending across Retry so its first update cannot erase inherited data.
        if (pendingParentProfileLeadRef.current === targetLeadId) {
          const profile = await fetchLeadDetail(targetLeadId);
          inheritedDraft = fillMissingIdentityNames(fillMissingParentProfile(snapshot.draft, profile), profile);
          Object.assign(payload, autosavePayload({ ...snapshot, draft: inheritedDraft }, previousWizardState, !lead?.prospect_patient_id));
          setDraft((current) => hydrated.current === targetLeadId && current
            ? fillMissingIdentityNames(fillMissingParentProfile(current, profile), profile)
            : current);
        }

        lastPersistedLeadIdRef.current = targetLeadId;
        stage = "lead-update";
        // The contacts go out only when staff changed them since they were
        // loaded. The list this wizard sent last is what the server has, even
        // before the next render knows it.
        const update = leadUpdateWithChangedContacts(
          payload,
          snapshot.draft.trustedContacts,
          lastSentTrustedContactsRef.current ?? trustedContactsBase,
        );
        await updateLeadWizard(targetLeadId, update.body);
        if (update.contacts) onContactsSavedRef.current?.();
        if (pendingParentProfileLeadRef.current === targetLeadId) pendingParentProfileLeadRef.current = null;
        if (hydrated.current !== targetLeadId) return;
        if (update.contacts) {
          lastSentTrustedContactsRef.current = update.contacts;
          setTrustedContactsBase(update.contacts);
        }
        const savedMinor = isMinor(snapshot.draft.birthDate, new Date());
        if (update.contacts || savedMinor !== savedMinorRef.current) {
          savedMinorRef.current = savedMinor;
          setRepresentationVersion((version) => version + 1);
        }

        let savedDraft = inheritedDraft;
        if (
          existingPatient?.id
          && !prospectPatientIdRef.current
          && !lead?.prospect_patient_id
        ) {
          stage = "prospect";
          const prospect = await createLeadProspect(targetLeadId, {
            attach_patient_id: existingPatient.id,
            hauptanfragegrund: snapshot.draft.concern.trim(),
            zuweiser: snapshot.draft.referrer.trim(),
          });
          if (prospect.patient_id !== existingPatient.id || !prospect.case_id) {
            throw new Error(tx(
              "Не удалось привязать повторное обращение к пациенту",
              "Die erneute Anfrage konnte dem Patienten nicht zugeordnet werden",
            ));
          }
          prospectPatientIdRef.current = prospect.patient_id;
          caseIdRef.current = prospect.case_id;
          prospectMergeOnlyRef.current = true;
          setCases([{ id: prospect.case_id }]);
        }

        if (initializing) {
          if (existingPatient?.id && caseIdRef.current) {
            const clinical = await loadPatientClinical(existingPatient.id);
            savedDraft = hydrateClinicalDraft(snapshot.draft, clinical, caseIdRef.current);
          }
          stage = "order-create";
          await createOrder({ source_lead_id: targetLeadId });
        }

        wizardStateBaseRef.current = payload.wizard_state;
        if (initializing) {
          const freshTicket = leadLoadGuardRef.current.begin();
          const fresh = await fetchLeadDetail(targetLeadId);
          // A minor's repeat intake starts with the patient's parents as
          // trusted contacts (server prefill): the draft takes them, so the
          // representatives, "Кто платит" and a later contact save see them
          // instead of an empty list that would remove them.
          const freshContacts = storedTrustedContactDrafts(fresh.trusted_contacts, draftFromLead(fresh).trustedContacts);
          if (snapshot.draft.trustedContacts.length === 0 && freshContacts.length > 0) {
            const base = trustedContactsPayload(freshContacts);
            lastSentTrustedContactsRef.current = base;
            setTrustedContactsBase(base);
            savedDraft = { ...savedDraft, trustedContacts: freshContacts };
            setDraft((current) => current && current.trustedContacts.length === 0 && hydrated.current === targetLeadId
              ? { ...current, trustedContacts: freshContacts }
              : current);
            setRepresentationVersion((version) => version + 1);
          }
          if (leadLoadGuardRef.current.claim(freshTicket)) setLead(fresh);
        }
        lastSavedAutosaveSignatureRef.current = signature;
        setServerMasterError(null);
        setServerContactError(null);
        if (currentAutosaveSignatureRef.current === signature) {
          if (savedDraft !== snapshot.draft) {
            const savedSignature = autosaveSnapshotSignature({ ...snapshot, draft: savedDraft });
            setDraft(savedDraft);
            currentAutosaveSignatureRef.current = savedSignature;
            lastSavedAutosaveSignatureRef.current = savedSignature;
          }
          setAutosaveError("");
          setAutosaveStatus("saved");
        } else {
          setAutosaveStatus("dirty");
        }
        // Publish the ID only after bootstrap completes. Otherwise the reload
        // triggered by onCreated races with attachment and hides save failures.
        if (initializing) {
          setCreatedLeadId(targetLeadId);
          onCreated?.(targetLeadId);
        }
      } catch (nextError) {
        if (
          (hydrated.current === targetLeadId || (!targetLeadId && hydrated.current === "__new__")) &&
          currentAutosaveSignatureRef.current === signature
        ) {
          if (isLeadConvertedError(nextError)) {
            // The lead got its patient meanwhile: nothing to save here any more (QA 2026-10-25).
            setConvertedByServer(true);
            setAutosaveError("");
            setAutosaveStatus("saved");
            if (targetLeadId) void fetchLeadDetail(targetLeadId).then(setLead).catch(() => undefined);
            throw nextError;
          }
          setExistingParentPatientId(existingParentPatientFromError(nextError)?.patientId ?? null);
          const refusedField = SERVER_MASTER_FIELDS[leadServerFieldError(nextError) ?? ""];
          setServerMasterError(refusedField ? { field: refusedField, message: errorText(nextError, tx) } : null);
          const refusedContact = leadServerContactError(nextError);
          setServerContactError(refusedContact ? { contactId: refusedContact.contactId, message: errorText(nextError, tx) } : null);
          setAutosaveError(errorText(nextError, tx));
          setAutosaveErrorDetail(autosaveErrorDetailText(stage, nextError));
          setAutosaveStatus("error");
        }
        throw nextError;
      }
    };

    const queued = saveQueueRef.current.then(run, run);
    saveQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [existingPatient?.id, hydrateClinicalDraft, lead?.prospect_patient_id, leadId, loadPatientClinical, newLeadCustody, onCreated, sourcePerson, trustedContactsBase, tx]);

  useEffect(() => {
    if (!open || !autosaveSnapshot || loading) return;
    // Nothing is saved for a converted lead (the server would answer 409 `lead_converted`).
    if (leadConverted) return;

    const signature = autosaveSnapshotSignature(autosaveSnapshot);
    currentAutosaveSignatureRef.current = signature;

    if (signature === lastSavedAutosaveSignatureRef.current) {
      setAutosaveError("");
      setAutosaveStatus("saved");
      return;
    }

    setAutosaveError("");
    setAutosaveStatus("dirty");
    if (!leadId) return;
    const timer = window.setTimeout(() => {
      void persistSnapshot(autosaveSnapshot, false, signature).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    autosaveSnapshot,
    leadId,
    loading,
    open,
    persistSnapshot,
  ]);

  const autosaveSnapshotRef = useRef<AutosaveSnapshot | null>(autosaveSnapshot);
  useEffect(() => {
    autosaveSnapshotRef.current = autosaveSnapshot;
  }, [autosaveSnapshot]);
  useEffect(() => {
    flushLeadAutosaveRef.current = async () => {
      await saveQueueRef.current;
      const snapshot = autosaveSnapshotRef.current;
      if (!snapshot || !leadId || leadConverted) return;
      const signature = autosaveSnapshotSignature(snapshot);
      if (signature === lastSavedAutosaveSignatureRef.current) return;
      currentAutosaveSignatureRef.current = signature;
      await persistSnapshot(snapshot, true, signature);
    };
  }, [leadConverted, leadId, persistSnapshot]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError("");
    clearServerValidation();
    setServerMasterError((current) => current?.field === key ? null : current);
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const changeDiscoverySource = (value: string) => {
    setError("");
    clearServerValidation();
    setReferrerSearch("");
    setDraft((current) => current ? {
      ...current,
      discoverySource: value,
      ...(value === "customer_referral"
        ? {}
        : { referrerPatientId: "", referrerPatientLabel: "" }),
      ...(value === "other" ? {} : { discoverySourceOther: "" }),
    } : current);
  };

  const changeReferrerPatient = (patientId: string) => {
    const selected = referrerPatients.find((patient) => patient.id === patientId);
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      referrerPatientId: patientId,
      referrerPatientLabel: selected ? referrerPatientOptionLabel(selected) : "",
    } : current);
  };

  const patchAml = <K extends keyof AmlEnhancedDueDiligenceDraft>(
    key: K,
    value: AmlEnhancedDueDiligenceDraft[K],
  ) => {
    setAmlSheetError("");
    if (key === "internalRiskAnalysis" || key === "individualReview") {
      amlRiskFindingTouchedRef.current = true;
    }
    setDraft((current) => current ? {
      ...current,
      amlEnhancedDueDiligence: {
        ...current.amlEnhancedDueDiligence,
        [key]: value,
      },
    } : current);
  };

  /**
   * Residence, every citizenship and a third-party payer's countries are the
   * facts of the AML forms. Owner rule 2026-10-07: only a new black-list
   * country requires the check — it fills the reason and opens the review
   * sheet; a country of the longer high-risk list stays a hint.
   */
  function handleAmlCountryChange(change: {
    country?: string | null;
    citizenships?: string[];
    payerCountries?: readonly string[];
  }) {
    const country = change.country !== undefined ? change.country : draft?.country;
    const citizenships = change.citizenships ?? draft?.citizenships ?? [];
    const nextPayerCountries = change.payerCountries ?? payerCountries;
    const nextRisk = amlRiskForCountries(
      riskCountryLists,
      country,
      ...citizenships,
      ...nextPayerCountries,
    );
    const boxes = amlCountryBoxes(riskCountryLists, country, citizenships, nextPayerCountries);
    const newBlacklistCountry = nextRisk?.countries.some((code) => (
      isBlacklistCountry(code, riskCountryLists) && !amlRisk?.countries.includes(code)
    )) ?? false;
    const affectedThirdCountry = nextRisk?.countries
      .map((code) => countryLabel(code, "de"))
      .join(", ") ?? "";
    // A new black-list country requires the check: the internal risk
    // analysis established the risk (see `openAmlSheet`).
    const internalRiskByRule = newBlacklistCountry
      && !amlRiskFindingTouchedRef.current
      && wizardDocuments.enhanced_due_diligence.length === 0;
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      ...(change.country !== undefined ? { country: change.country ?? "" } : {}),
      ...(change.citizenships ? { citizenships: normalizeCitizenships(change.citizenships) } : {}),
      amlEnhancedDueDiligence: nextRisk ? {
        ...current.amlEnhancedDueDiligence,
        ...(internalRiskByRule ? { internalRiskAnalysis: true } : {}),
        affectedThirdCountry,
        highRiskCountryResident: boxes.resident,
        highRiskCountryTransaction: boxes.transaction || current.amlEnhancedDueDiligence.highRiskCountryTransaction,
        // A stated reason answers "erhöhtes Risiko" on the GwG sheet: only
        // the black list fills it by itself.
        riskReason: current.amlEnhancedDueDiligence.riskReason || (
          nextRisk.tier === "blacklist"
            ? "Bezug zu einem Land der FATF-Liste der Hochrisiko-Jurisdiktionen"
            : ""
        ),
      } : {
        ...current.amlEnhancedDueDiligence,
        affectedThirdCountry: "",
        highRiskCountryResident: false,
        // The country tick goes with the country it was set for.
        highRiskCountryTransaction: current.amlEnhancedDueDiligence.affectedThirdCountry
          ? false
          : current.amlEnhancedDueDiligence.highRiskCountryTransaction,
      },
    } : current);
    // Only for an existing lead: before the lead is created the form has no
    // patient to attach the check to — the banner informs instead (QA 2026-10-10).
    if (newBlacklistCountry && leadId) {
      setAmlSheetError("");
      setAmlSheetOpen(true);
      void prefillAmlFromLeadAnswers();
    }
  }

  /**
   * The lead's and the payer's answers fill the empty fields of the check
   * (source of funds, PEP details, sanctions links, proofs of the funds;
   * QA 2026-10-10). What staff typed stays; a failed load changes nothing.
   */
  async function prefillAmlFromLeadAnswers() {
    const targetLeadId = leadId ?? lastPersistedLeadIdRef.current;
    if (!targetLeadId) return;
    let intake: Awaited<ReturnType<typeof fetchLeadPortalIntake>>;
    try {
      intake = await fetchLeadPortalIntake(targetLeadId);
    } catch {
      intake = null;
    }
    const prefill = amlPrefillFromLeadAnswers({
      identification: intake?.identification_hidden ? null : intake?.identification,
      enhancedDetails: intake?.enhanced_details,
      payer: payerLink.data?.questionnaire,
      countryName: (code) => countryLabel(code, "de"),
    });
    setDraft((current) => current ? {
      ...current,
      amlEnhancedDueDiligence: applyAmlLeadPrefill(current.amlEnhancedDueDiligence, prefill),
    } : current);
  }

  /** Opens the enhanced check: required by the rule, or filled voluntarily. */
  function openAmlSheet() {
    const affectedThirdCountry = amlRisk?.countries
      .map((code) => countryLabel(code, "de"))
      .join(", ") ?? "";
    // "Interne Risikoanalyse" is ticked only when the enhanced check is
    // required; a voluntary check is the finding of the individual review
    // (QA 2026-10-11, as the server prints it). Until a check document
    // exists — and unless staff set the boxes themselves — they follow the rule.
    const riskFindingFollowsRule = !amlRiskFindingTouchedRef.current
      && wizardDocuments.enhanced_due_diligence.length === 0;
    setDraft((current) => {
      if (!current) return current;
      // Residence only for the patient's own country (QA 2026-10-10 B4).
      const boxes = amlCountryBoxes(riskCountryLists, current.country, current.citizenships, payerCountries);
      return {
        ...current,
        amlEnhancedDueDiligence: {
          ...current.amlEnhancedDueDiligence,
          ...(riskFindingFollowsRule
            ? {
                internalRiskAnalysis: amlRequired,
                individualReview: !amlRequired || current.amlEnhancedDueDiligence.individualReview,
              }
            : {}),
          affectedThirdCountry: current.amlEnhancedDueDiligence.affectedThirdCountry || affectedThirdCountry,
          ...(amlRisk ? {
            highRiskCountryResident: boxes.resident,
            highRiskCountryTransaction: boxes.transaction || current.amlEnhancedDueDiligence.highRiskCountryTransaction,
          } : {}),
        },
      };
    });
    setAmlSheetError("");
    setAmlSheetOpen(true);
    void prefillAmlFromLeadAnswers();
    void loadAmlReviewers();
  }

  /** The reviewers to choose from; the one who opened the check fills an empty field. */
  async function loadAmlReviewers() {
    if (!leadId) return;
    try {
      const response = await apiFetch<{ reviewers?: { id: string; name: string }[]; me?: string }>(
        `/leads/${leadId}/aml-reviewers`,
      );
      const reviewers = (response.reviewers ?? []).filter((reviewer) => reviewer.name);
      setAmlReviewers(reviewers);
      const me = reviewers.find((reviewer) => reviewer.id === response.me);
      if (me) {
        setDraft((current) => current && !current.amlEnhancedDueDiligence.reviewerName.trim()
          ? { ...current, amlEnhancedDueDiligence: { ...current.amlEnhancedDueDiligence, reviewerName: me.name } }
          : current);
      }
    } catch {
      // The field stays free text.
    }
  }

  /**
   * A PEP is a fact (row b of the GwG sheet) and an amber hint: since the
   * owner's rule of 2026-10-07 it neither requires the enhanced check nor
   * fills its reason — staff decide and open the check themselves.
   */
  function handleAmlPepChange(
    key: "pepContractPartner" | "pepBeneficialOwner" | "pepStatusChecked",
    checked: boolean,
  ) {
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      amlEnhancedDueDiligence: {
        ...current.amlEnhancedDueDiligence,
        [key]: checked,
        // The stored day and reviewer describe the old decision; the server stamps the saved one.
        pepReviews: withoutPepReviewStamp(current.amlEnhancedDueDiligence.pepReviews, PEP_SUBJECT_PATIENT),
      },
    } : current);
  }

  /** Staff's PEP review of a representative or the payer (owner decision 2026-10-23). */
  function handleAmlPepReviewChange(subject: string, patch: { checked?: boolean; isPep?: boolean }) {
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      amlEnhancedDueDiligence: {
        ...current.amlEnhancedDueDiligence,
        pepReviews: withPepReview(current.amlEnhancedDueDiligence.pepReviews, subject, patch),
      },
    } : current);
  }

  const toggleSpecializationWorkType = (workTypeId: string, checked: boolean) => {
    setError("");
    clearServerValidation();
    setDraft((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedSpecializationWorkTypeIds);
      if (checked) selected.add(workTypeId);
      else selected.delete(workTypeId);
      return {
        ...current,
        selectedSpecializationWorkTypeIds: [...selected],
      };
    });
  };

  const removeSpecializationSelection = (value: string) => {
    const specialization = specialties.find(
      (item) => specializationValue(item) === value,
    );
    const removedWorkTypeIds = new Set(
      specialization
        ? (workTypesBySpecialization[specialization.id] ?? []).map((item) => item.id)
        : [],
    );
    setError("");
    clearServerValidation();
    setDraft((current) => {
      if (!current) return current;
      const remainingSpecialties = current.specialties.filter(
        (item) => item !== value,
      );
      const stillAvailableWorkTypeIds = new Set(
        remainingSpecialties.flatMap((specialtyValue) => {
          const remainingSpecialization = specialties.find(
            (item) => specializationValue(item) === specialtyValue,
          );
          return remainingSpecialization
            ? (workTypesBySpecialization[remainingSpecialization.id] ?? []).map(
                (item) => item.id,
              )
            : [];
        }),
      );
      return {
        ...current,
        specialties: remainingSpecialties,
        selectedSpecializationWorkTypeIds:
          current.selectedSpecializationWorkTypeIds.filter(
            (id) =>
              !removedWorkTypeIds.has(id) ||
              stillAvailableWorkTypeIds.has(id),
          ),
      };
    });
  };

  // `guardian`: opened from the block "Родитель или законный представитель" of
  // a minor — the editor asks explicitly for mother, father or guardian.
  const openNewTrustedContact = (guardian = false) => {
    setTrustedContactEditorError("");
    setTrustedContactRelationError("");
    setTrustedContactEmailError("");
    setTrustedContactPhoneError("");
    setTrustedContactBirthDateError("");
    setGuardianSearch("");
    setTrustedContactEditorGuardian(guardian);
    setTrustedContactPendingDetails(EMPTY_REPRESENTATIVE_DETAILS);
    setTrustedContactCandidatePrefill(null);
    setTrustedContactEditor(emptyTrustedContact());
  };

  const openTrustedContact = (contact: TrustedContactDraft, guardian = false) => {
    setTrustedContactEditorError("");
    setTrustedContactRelationError("");
    setTrustedContactEmailError("");
    setTrustedContactPhoneError("");
    setTrustedContactBirthDateError("");
    setGuardianSearch("");
    setTrustedContactEditorGuardian(guardian);
    setTrustedContactPendingDetails(pendingRepresentativeDetailsRef.current.get(contact.id) ?? EMPTY_REPRESENTATIVE_DETAILS);
    setTrustedContactCandidatePrefill(null);
    setTrustedContactEditor({ ...contact });
  };

  // Whether the server knows the contact as a representative of this lead.
  const representativeOnFile = (contactId: string) => Boolean(
    leadId
    && step1Portal.intake?.lead_id === leadId
    && step1Portal.intake.representation?.representatives.some((person) => person.id === contactId),
  );

  const closeTrustedContactEditor = () => {
    trustedContactDetailsDraftRef.current = null;
    setTrustedContactCandidatePrefill(null);
    setTrustedContactEditor(null);
    setTrustedContactEditorError("");
    setTrustedContactRelationError("");
    setTrustedContactEmailError("");
    setTrustedContactPhoneError("");
    setTrustedContactBirthDateError("");
  };

  const patchTrustedContactEditor = <K extends keyof TrustedContactDraft>(
    key: K,
    value: TrustedContactDraft[K],
  ) => {
    if (key === "name" && trustedContactEditorError) setTrustedContactEditorError("");
    if (key === "relation") setTrustedContactRelationError("");
    if (key === "email") setTrustedContactEmailError("");
    if (key === "phone" || key === "email") setTrustedContactPhoneError("");
    if (key === "birthDate") setTrustedContactBirthDateError("");
    setTrustedContactEditor((current) => current ? { ...current, [key]: value } : current);
  };

  const guardianCandidateLabel = (candidate: LeadGuardianCandidate) => [
    candidate.source === "lead" ? tx("Лид", "Lead") : candidate.display_id,
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" "),
    candidate.email,
  ].filter(Boolean).join(" · ");

  const changeGuardianPatient = (candidateId: string) => {
    const selected = guardianPatients.find((patient) => `${patient.source}:${patient.id}` === candidateId);
    setSelectedGuardianCandidate(candidateId);
    // The GwG block takes what the system holds for the person, in its empty
    // fields only (DEV 2026-10-26: a father picked from the patients left it
    // empty and staff typed his address again). A field still holding the
    // previous pick's value follows the new pick.
    const details = selected ? guardianCandidateDetails(selected) : null;
    const idDocument = selected?.source === "patient" && !selected.contact_hidden && (selected.id_document_number || selected.id_document_type)
      ? { type: selected.id_document_type ?? null, number: selected.id_document_number ?? null, validUntil: selected.id_valid_until ?? null }
      : null;
    const previous = trustedContactCandidatePrefill?.values ?? null;
    if (details || previous) {
      setTrustedContactPendingDetails((current) => (
        fillEmptyRepresentativeDetails(current, details ?? EMPTY_REPRESENTATIVE_DETAILS, previous).details
      ));
    }
    setTrustedContactCandidatePrefill(selected && (details || idDocument || previous) ? {
      key: candidateId,
      values: details ?? EMPTY_REPRESENTATIVE_DETAILS,
      hasDetails: Boolean(details),
      source: selected.source,
      displayId: selected.display_id,
      document: idDocument,
    } : null);
    setTrustedContactEditor((current) => current ? {
      ...current,
      relatedPatientId: selected?.patient_record_id ?? "",
      relatedPatientLabel: selected ? guardianCandidateLabel(selected) : "",
      ...(selected ? {
        name: [selected.first_name, selected.last_name].filter(Boolean).join(" "),
      } : {}),
      // Without `patients.view` (Sales) a patient row carries only the name and
      // number (owner 2026-10-23): what staff typed for the contact stays.
      ...(selected && !selected.contact_hidden ? {
        email: selected.email ?? "",
        phone: selected.phone ?? "",
        birthDate: selected.birth_date ?? "",
        address: selected.address ?? "",
      } : {}),
    } : current);
  };

  const saveTrustedContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trustedContactEditor) return;
    const name = trustedContactEditor.name.trim();
    if (!name) {
      setTrustedContactEditorError(tx("Укажите имя контактного лица", "Name der Kontaktperson angeben"));
      return;
    }
    // The cabinet's passport-name rule, here too: the server refuses the same (422 `trusted_contact_name_invalid`).
    if (nameNeedsLatinSpelling(name)) {
      setTrustedContactEditorError(passportNameRuleText(tx));
      return;
    }
    if (trustedContactEditorGuardian && !["mother", "father", "guardian"].includes(trustedContactEditor.relation)) {
      setTrustedContactRelationError(tx("Укажите, кто представляет ребёнка: мать, отец или опекун", "Bitte Mutter, Vater oder Vormund auswählen"));
      return;
    }
    // What the server has for this contact: an older value it keeps is not
    // checked again (owner 2026-10-22), as on the server.
    const storedContact = trustedContactsBaseRef.current.find((contact) => contact.id === trustedContactEditor.id);
    if (trustedContactEditor.email.trim() && !isValidEmailAddress(trustedContactEditor.email)) {
      setTrustedContactEmailError(tx("Введите корректный адрес электронной почты", "Gültige E-Mail-Adresse eingeben"));
      return;
    }
    // Only an address set or changed on this card is judged by its domain, as
    // on the server (B-1a): the stored one never blocks saving another field.
    const trustedContactNoMail = emailChangedOnSave(trustedContactEditor.email, storedContact?.email)
      ? knownNoMailEmailError(trustedContactEditor.email, lang)
      : null;
    if (trustedContactNoMail) {
      setTrustedContactEmailError(trustedContactNoMail);
      return;
    }
    const contactPhone = trustedContactEditor.phone.trim();
    if (!personPhoneAcceptable(contactPhone, storedContact?.phone)) {
      setTrustedContactPhoneError(tx(
        "Введите корректный номер телефона: не менее 6 цифр, только цифры, +, пробелы, ( ) - / .",
        "Gültige Telefonnummer eingeben: mindestens 6 Ziffern, nur Ziffern, +, Leerzeichen, ( ) - / .",
      ));
      return;
    }
    // A parent is reached and gets the access through these (the minor's check asks for one).
    if (trustedContactEditorGuardian && !contactPhone && !trustedContactEditor.email.trim()) {
      setTrustedContactPhoneError(tx("Укажите e-mail или телефон представителя", "E-Mail oder Telefonnummer der Vertretung angeben"));
      return;
    }
    const contactBirthDate = trustedContactEditor.birthDate;
    if (contactBirthDate && (contactBirthDate > appDateKey() || contactBirthDate < EARLIEST_BIRTH_DATE)) {
      setTrustedContactBirthDateError(tx(
        "Дата рождения не может быть в будущем или раньше 01.01.1900",
        "Das Geburtsdatum darf nicht in der Zukunft oder vor dem 01.01.1900 liegen",
      ));
      return;
    }
    // A parent, guardian or representative is of full age, as in the cabinet and on
    // the server (owner 2026-10-24); a stored entry keeps saving as it is.
    if (representativeMinorOnSave(
      trustedContactEditor,
      storedContact ? { relation: storedContact.relation ?? "", birthDate: storedContact.birth_date ?? "" } : undefined,
      appDateKey(),
    )) {
      setTrustedContactBirthDateError(tx(
        "Родитель или представитель должен быть совершеннолетним (18+)",
        "Ein Elternteil oder eine Vertretung muss volljährig sein (18+)",
      ));
      return;
    }
    // A guardian (Vormund) of a minor needs the custody "guardian" (owner
    // 2026-10-22, the server refuses it too); a contact stored as guardian
    // before keeps saving as it is. While the portal state is still loading
    // the custody is unknown here: the server decides (DEV 2026-10-24: the
    // editor refused «Опекун» before the state arrived).
    const knownCustody = leadId ? step1Portal.intake?.representation?.custody : newLeadCustody;
    if (
      draft
      && isMinor(draft.birthDate, new Date())
      && isLegalGuardianRelation(trustedContactEditor.relation)
      && !isLegalGuardianRelation(storedContact?.relation ?? "")
      && (!leadId || step1Portal.intake?.representation != null)
      && knownCustody !== "guardian"
    ) {
      setTrustedContactRelationError(tx(
        "Опекун возможен только при опеке по решению суда; для родителя выберите Мать или Отец",
        "Vormund ist nur bei gerichtlich angeordneter Vormundschaft möglich; für einen Elternteil Mutter oder Vater wählen",
      ));
      return;
    }

    // A representative on file: the citizenships and birth data typed in the
    // details form go with the contact in the wizard save, so the GwG row and
    // the country triggers follow (F-11, QA 2026-10-25: «Сохранить» dropped
    // them); changed address parts are written on their own endpoint.
    const detailsDraft = leadId && trustedContactDetailsDraftRef.current?.contactId === trustedContactEditor.id
      ? trustedContactDetailsDraftRef.current
      : null;
    // A value the details form marks as too long stops the save, as its own button did (V-A4).
    if (detailsDraft && Object.keys(representativeDetailsErrors(detailsDraft.draft, detailsDraft.loaded)).length > 0) {
      // The field itself says what is wrong; the name field is not the place for it.
      toast.error(tx(
        "Исправьте отмеченные поля в блоке «Адрес и данные для анкеты GwG»",
        "Bitte die markierten Felder unter „Anschrift und Angaben für den GwG-Bogen“ korrigieren",
      ));
      return;
    }
    const changedDetails = detailsDraft ? changedRepresentativeDetails(detailsDraft.draft, detailsDraft.loaded) : undefined;
    const normalizedContact: TrustedContactDraft = {
      ...trustedContactEditor,
      name,
      phone: trustedContactEditor.phone.trim(),
      email: trustedContactEditor.email.trim(),
      relation: trustedContactEditor.relation.trim(),
      address: trustedContactEditor.address.trim(),
      ...(changedDetails
        ? { representativeDetails: { ...trustedContactEditor.representativeDetails, ...changedDetails } }
        : {}),
    };
    if (leadId && detailsDraft) {
      const { draft: typed, loaded } = detailsDraft;
      const addressChanged = (["street", "zip", "city", "country"] as const)
        .some((key) => typed[key].trim() !== loaded[key].trim());
      if (addressChanged) {
        const addressOnly: RepresentativeDetails = {
          ...loaded,
          street: typed.street,
          zip: typed.zip,
          city: typed.city,
          country: typed.country,
        };
        void updateLeadRepresentativeDetails(leadId, trustedContactEditor.id, addressOnly, loaded)
          .then((representation) => {
            if (representation) step1Portal.applyRepresentation(representation);
          })
          .catch((cause: unknown) => {
            setServerContactError({ contactId: trustedContactEditor.id, message: errorText(cause, tx) });
          });
      }
    }
    // A parent not on file yet: the address and citizenships entered on the
    // card are written once the autosave has created the parent.
    if (trustedContactEditorGuardian && !representativeOnFile(normalizedContact.id)) {
      if (representativeDetailsChanged(trustedContactPendingDetails, EMPTY_REPRESENTATIVE_DETAILS)) {
        pendingRepresentativeDetailsRef.current.set(normalizedContact.id, trustedContactPendingDetails);
      } else {
        pendingRepresentativeDetailsRef.current.delete(normalizedContact.id);
      }
      setPendingRepresentativeDetailsVersion((version) => version + 1);
    }
    setError("");
    clearServerValidation();
    setServerContactError((current) => current?.contactId === normalizedContact.id ? null : current);
    setDraft((current) => {
      if (!current) return current;
      const exists = current.trustedContacts.some((contact) => contact.id === normalizedContact.id);
      return {
        ...current,
        trustedContacts: exists
          ? current.trustedContacts.map((contact) => (
              contact.id === normalizedContact.id ? normalizedContact : contact
            ))
          : [...current.trustedContacts, normalizedContact],
      };
    });
    closeTrustedContactEditor();
  };

  const removeTrustedContact = async (contact: TrustedContactDraft) => {
    setBusy(`remove-contact-${contact.id}`);
    setError("");
    clearServerValidation();
    try {
      // Serialize removal with autosave. A new contact not saved yet only
      // leaves the draft; unrelated unfinished fields need not be valid.
      const run = async () => {
        const stored = lastSentTrustedContactsRef.current ?? trustedContactsBaseRef.current;
        if (leadId && stored.some((item) => item.id === contact.id)) {
          step1Portal.applyRepresentation(await removeLeadTrustedContact(leadId, contact.id));
        }
        const remaining = (autosaveSnapshot?.draft.trustedContacts ?? [])
          .filter((item) => item.id !== contact.id);
        const baseline = stored.filter((item) => item.id !== contact.id);
        trustedContactsBaseRef.current = baseline;
        lastSentTrustedContactsRef.current = baseline;
        setTrustedContactsBase(baseline);
        if (autosaveSnapshot) {
          const signature = autosaveSnapshotSignature({
            ...autosaveSnapshot,
            draft: { ...autosaveSnapshot.draft, trustedContacts: remaining },
          });
          currentAutosaveSignatureRef.current = signature;
          if (leadId && lastSavedAutosaveSignatureRef.current === autosaveSnapshotSignature(autosaveSnapshot)) {
            lastSavedAutosaveSignatureRef.current = signature;
          }
        }
        setDraft((current) => current ? {
          ...current,
          trustedContacts: current.trustedContacts.filter((item) => item.id !== contact.id),
        } : current);
        setRepresentationVersion((version) => version + 1);
        setTrustedContactRemoval(null);
        toast.success(tx(`Контакт «${contact.name}» удалён из обращения`, `Kontakt „${contact.name}“ aus der Anfrage entfernt`));
      };
      const queued = saveQueueRef.current.then(run, run);
      saveQueueRef.current = queued.then(() => undefined, () => undefined);
      await queued;
    } catch (nextError) {
      setTrustedContactRemoval(null);
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * A contact whose GwG data were entered in the lead cabinet cannot simply be
   * removed through a list save (the server keeps it). This optional action
   * clears only those data; the contact and uploaded documents stay.
   */
  const removeRepresentativeGwgData = async (contact: TrustedContactDraft) => {
    if (!leadId) return;
    setBusy(`remove-gwg-data-${contact.id}`);
    setError("");
    try {
      step1Portal.applyRepresentation(await removeLeadRepresentativeData(leadId, contact.id));
      setRepresentationVersion((version) => version + 1);
      setGwgDataRemoval(null);
      toast.success(tx(`Данные GwG у контакта «${contact.name}» удалены`, `GwG-Angaben von „${contact.name}“ entfernt`));
    } catch (nextError) {
      setGwgDataRemoval(null);
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  };

  const toggleServiceNeed = (value: string, checked: boolean) => {
    setError("");
    clearServerValidation();
    setDraft((current) => {
      if (!current) return current;
      const serviceNeeds = updateLeadServiceSelection(current.serviceNeeds, value, checked);
      const selectedServices = new Set(serviceNeeds);
      const serviceComments = Object.fromEntries(
        Object.entries(current.serviceComments).filter(([service]) => selectedServices.has(service)),
      );
      return {
        ...current,
        serviceNeeds,
        serviceComments,
      };
    });
  };

  const patchServiceComment = (value: string, comment: string) => {
    const normalized = normalizeLeadServiceValue(value);
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      serviceComments: {
        ...current.serviceComments,
        [normalized]: comment,
      },
    } : current);
  };

  const touchMasterField = (field: MasterFieldKey) => {
    setTouchedMasterFields((current) => {
      if (current.has(field)) return current;
      const nextFields = new Set(current);
      nextFields.add(field);
      return nextFields;
    });
  };

  const visibleMasterError = (field: MasterFieldKey) =>
    (masterValidationAttempted || touchedMasterFields.has(field) ? masterErrors[field] : undefined)
    // What the server refused stays at the field until it is changed.
    ?? (serverMasterError?.field === field ? serverMasterError.message : undefined);
  // A typed date the picker does not take keeps the stored one: say why at the field.
  const birthDateEntryText = !birthDateEntryError || !touchedMasterFields.has("birthDate")
    ? undefined
    : birthDateEntryError === "maxDate" || birthDateEntryError === "disableFuture"
      ? tx("Дата рождения не может быть в будущем", "Das Geburtsdatum darf nicht in der Zukunft liegen")
      : birthDateEntryError === "minDate"
        ? tx("Дата рождения не может быть раньше 01.01.1900", "Das Geburtsdatum darf nicht vor dem 01.01.1900 liegen")
        : tx("Введите дату полностью: ДД.ММ.ГГГГ", "Datum vollständig eingeben: TT.MM.JJJJ");
  const birthDateError = birthDateEntryText ?? visibleMasterError("birthDate");

  const ensureMasterDataReady = () => {
    const firstInvalid = MASTER_FIELD_ORDER.find((field) => masterErrors[field]);
    if (!firstInvalid) {
      setValidationContext((current) => current?.kind === "master" ? null : current);
      return true;
    }
    setError("");
    setValidationContext({ kind: "master" });
    setMasterValidationAttempted(true);
    setStep("master_data");
    window.requestAnimationFrame(() => {
      document.getElementById(MASTER_FIELD_IDS[firstInvalid])?.focus();
    });
    return false;
  };

  async function flushPayerAutosave(): Promise<boolean> {
    try {
      const saved = await payerAutosaveRegistry.flush(leadId);
      if (activePayerLeadIdRef.current !== leadId) return false;
      if (saved) return true;
      if (hydrated.current === leadId) setError(tx(
        "Данные плательщика не сохранены. Проверьте блок «Кто платит» и повторите сохранение.",
        "Die Zahlerangaben sind nicht gespeichert. Prüfen Sie „Wer zahlt“ und versuchen Sie das Speichern erneut.",
      ));
    } catch (nextError) {
      if (hydrated.current === leadId) setError(errorText(nextError, tx));
    }
    return false;
  }

  async function save(target = step, trackBusy = true, draftOverride?: Draft): Promise<boolean> {
    const source = draftOverride ?? draft;
    if (!source || (!leadId && !createMode)) return false;
    if (!(await flushPayerAutosave())) return false;
    if (trackBusy) setBusy("save");
    setError("");
    setValidationContext(null);
    try {
      const snapshot: AutosaveSnapshot = {
        draft: source,
        lines,
        paidAmount,
        prepayment,
        prepaymentAmount,
        step: target,
      };
      currentAutosaveSignatureRef.current = autosaveSnapshotSignature(snapshot);
      await persistSnapshot(snapshot, true);
      return true;
    } catch (nextError) {
      showWizardError(nextError);
      return false;
    } finally {
      if (trackBusy) setBusy(null);
    }
  }

  /** `draftOverride`: the draft `finishIntake` saved just before, newer than this render's. */
  async function finishOrder(targetStep: StepId, draftOverride?: Draft): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (!(await flushPayerAutosave())) return false;
    const issues = orderIssues;
    if (issues.length > 0) {
      setError("");
      setValidationContext({ kind: "order" });
      setOrderValidationAttempted(true);
      openValidationIssue(issues[0]);
      return false;
    }
    const saved = await save(targetStep, true, draftOverride);
    if (saved) setOrderValidationAttempted(false);
    return saved;
  }

  async function completeMedicalIntake(source: Draft) {
    const id = await persistMedicalDraft(source);
    await completeCaseIntake(id, true, {
      hauptanfragegrund: source.concern.trim(),
    });
  }

  /** Completes the intake and saves; the draft it saved, or null when it stopped. */
  async function finishIntake(targetStep: StepId): Promise<Draft | null> {
    if (!leadId || !draft) return null;
    if (!(await flushPayerAutosave())) return null;
    setError("");
    if (
      step1Portal.mode === "patient"
      && Object.keys(masterErrors).length === 0
      && Object.keys(strictMasterErrors).length > 0
    ) {
      // Completing the intake needs the full master data the patient has not sent yet.
      setError(tx(
        "Ждём данные пациента: заполните данные клиента или дождитесь, пока пациент заполнит их в портале.",
        "Warten auf die Daten des Patienten: Personendaten ausfüllen oder warten, bis der Patient sie im Portal einträgt.",
      ));
      setStep("master_data");
      return null;
    }
    if (!ensureMasterDataReady()) return null;
    // The lead's own reason from the cabinet is taken into the empty staff
    // field (QA 2026-10-10). The reason is optional since 2026-10-19 (owner):
    // an empty one never sends staff back to the medical step.
    let intakeDraft = draft;
    if (!draft.concern.trim() && patientRequestReason) {
      intakeDraft = { ...draft, concern: patientRequestReason };
      setDraft((current) => current && !current.concern.trim() ? { ...current, concern: patientRequestReason } : current);
    }
    // Qualification asks for what the server's `qualification_reasons` hold;
    // the conversion-level documents stay in the release list only.
    const documentIssues = qualificationDocumentIssues(documentsValidationIssues(intakeDraft, wizardDocuments, tx, isRepeatIntake ? readinessChecks : undefined, amlRequired, lead?.readiness.demo_onboarding?.credited_checks, cabinetConsents, readinessChecks.get("risk_assessment_released") === false, readinessChecks.get("identity_document_verified") === true));
    if (documentIssues.length > 0) {
      setValidationContext({ kind: "documents", scope: "qualification" });
      setStep("documents");
      window.requestAnimationFrame(() => {
        document.getElementById(documentIssues[0]?.fieldId ?? "")?.focus();
      });
      return null;
    }
    setBusy("intake");
    setValidationContext(null);
    try {
      await completeMedicalIntake(intakeDraft);
      const saved = await save(targetStep, false, intakeDraft);
      if (saved && lead?.qualification_status !== "qualified") {
        await updateLeadStatus(leadId, "qualified");
      }
      if (saved) await refreshLeadState();
      return saved ? intakeDraft : null;
    } catch (nextError) {
      showWizardError(nextError);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "identity" | "medical", files: File[]) {
    if (!leadId || files.length === 0) return;
    setBusy("upload-" + kind);
    setError("");
    try {
      // Each file on its own: a refused file does not stop the others, and
      // the ones uploaded are shown (QA 2026-10-24).
      const result = await uploadEach(files, async (file) => {
        const form = new FormData();
        form.set("lead_id", leadId);
        form.set("file", file);
        if (kind === "identity") {
          // German like every document name of the lead (QA 2026-10-10).
          form.set("auto_name", "Ausweisdokument");
          form.set("art", "identity");
          form.set("category", "identity");
        } else {
          form.set("auto_name", file.name);
          form.set("art", "medical_report");
          form.set("category", "medical_report");
          form.set("is_medical", "true");
        }
        await uploadDocument(form);
      }, MAX_DOCUMENT_FILE_SIZE);
      if (result.uploaded.length > 0) {
        // Uploaded medical files answer the "documents exist" question.
        if (kind === "medical" && lead?.has_medical_records !== "yes") {
          await updateLeadWizard(leadId, { has_medical_records: "yes" });
        }
        await refreshDocumentsState();
      }
      const firstFailure = result.failed[0];
      if (result.uploaded.length === 0 && result.tooLarge.length === 0 && result.failed.length === 1 && firstFailure) {
        showWizardError(firstFailure.error);
      } else if (result.tooLarge.length > 0 || result.failed.length > 0) {
        setError([
          ...result.tooLarge.map((file) => `${file.name}: ${tx("размер файла не должен превышать 25 МБ", "die Datei darf höchstens 25 MB groß sein")}`),
          ...result.failed.map(({ file, error }) => `${file.name}: ${errorText(error, tx)}`),
        ].join(" · "));
      }
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function setHasMedicalRecords(value: boolean) {
    if (!leadId) return;
    setBusy("medical-records");
    setError("");
    try {
      await updateLeadWizard(leadId, { has_medical_records: value ? "yes" : "no" });
      await refreshLeadState();
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function downloadDocument(document: DocumentItem, fromPreview = false) {
    setBusy(`download-${document.id}`);
    setError("");
    if (fromPreview) setDocumentPreviewError("");
    try {
      await downloadDocumentFile(
        document.id,
        wizardDocumentFilename(document),
      );
    } catch (nextError) {
      if (fromPreview) setDocumentPreviewError(errorText(nextError, tx));
      else showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function openOrDownloadDocument(
    document: DocumentItem,
    generatedNow = false,
  ) {
    const previewKind = wizardDocumentPreviewKind(document);
    if (!previewKind) {
      await downloadDocument(document);
      return;
    }

    setBusy(`preview-${document.id}`);
    setError("");
    try {
      const preview = await createDocumentPreviewObjectUrl(document.id);
      replaceDocumentPreview({
        ...preview,
        id: document.id,
        kind: previewKind,
        title: wizardDocumentFilename(document),
      });
    } catch {
      setValidationContext(null);
      setError(generatedNow
        ? tx(
            "Документ создан, но предпросмотр не открылся. Скачайте PDF из списка документов.",
            "Das Dokument wurde erstellt, die Vorschau konnte jedoch nicht geöffnet werden. Laden Sie die PDF-Datei aus der Dokumentenliste herunter.",
          )
        : tx(
            "Не удалось открыть предпросмотр. Скачайте PDF из списка документов.",
            "Die Vorschau konnte nicht geöffnet werden. Laden Sie die PDF-Datei aus der Dokumentenliste herunter.",
          ));
    } finally {
      setBusy(null);
    }
  }

  async function deleteWizardDocument() {
    if (!deleteDocument) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setDeleteError(tx("Укажите причину удаления", "Löschgrund angeben"));
      return;
    }

    setBusy(`delete-${deleteDocument.id}`);
    setDeleteError("");
    try {
      await deleteStoredDocumentFile(deleteDocument.id, reason);
      setDeleteDocument(null);
      setDeleteReason("");
      await refreshDocumentsState();
    } catch (nextError) {
      setDeleteError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function signDocument(id: string, kind: DocumentComplianceKind, fromPreview = false) {
    setBusy("sign-" + id);
    setError("");
    setDocumentRowError(null);
    if (fromPreview) setDocumentPreviewError("");
    try {
      await markDocumentSigned(id, kind);
      await refreshDocumentsState();
    } catch (nextError) {
      // A lead gate names its reason (risk assessment, sanctions, blocked country).
      const gate = signatureGateErrorText(nextError, tx);
      const slot = representativeDocumentSlot(nextError);
      const focus = representativeDocumentFocus(nextError);
      const representativeId = slot
        ? step1Portal.intake?.representation?.representatives.find((person) => person.slot === slot)?.id ?? null
        : null;
      // The sheet for legal entities names the paying organisation's data (owner 2026-10-22).
      const payerSheet = isGwgPayerSheetIncomplete(nextError);
      if (fromPreview) {
        setDocumentPreviewError(gate ?? errorText(nextError, tx));
        setDocumentPreviewJump(riskGateRefusal(nextError)
          ? PREVIEW_JUMP_RISK
          : payerSheet ? PREVIEW_JUMP_PAYER : slot === "patient" ? "patient"
            : representativeId ? (focus === "authority" ? `${representativeId}${AUTHORITY_JUMP}` : representativeId) : null);
      } else if (gate || leadErrorBlockingReasons(nextError).length === 0) {
        // Next to the pressed button, not at the bottom of the step (DEV 2026-10-19),
        // with the way to what blocks it (QA 2026-10-22: the text named the
        // risk assessment, but staff had to find the section themselves).
        setValidationContext(null);
        setDocumentRowError({
          documentId: id,
          text: gate ?? errorText(nextError, tx),
          action: riskGateRefusal(nextError)
            ? {
                label: tx("Перейти к оценке риска", "Zur Risikobewertung"),
                onClick: () => {
                  setDocumentRowError(null);
                  openValidationIssue({ key: "risk-assessment", step: "documents", message: "", fieldId: RISK_ASSESSMENT_SECTION_ID });
                },
              }
            : payerSheet
              ? {
                  label: goToPayerLabel,
                  onClick: () => {
                    setDocumentRowError(null);
                    openValidationIssue({ key: "payer-declaration", step: "documents", message: "", fieldId: PAYER_SECTION_ID });
                  },
                }
            : representativeId || slot === "patient"
              ? {
                  label: focus === "authority" && representativeId
                    ? tx("Загрузить подтверждение полномочий", "Vertretungsnachweis hochladen")
                    : tx("Перейти к данным документа", "Zu den Ausweisdaten"),
                  onClick: () => {
                    setDocumentRowError(null);
                    openRepresentativeIdData(representativeId ?? "patient", representativeId ? focus : null);
                  },
                }
              : null,
        });
      } else showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  /**
   * The GwG identification sheet of the patient, of the third-party payer or
   * — for a minor — of one legal representative. The server fills it from the
   * lead, so the wizard is saved first; a new sheet replaces the current one
   * of the same person as its next version.
   */
  async function generateGwgIdentificationSheet({ subject }: GwgSheetButton) {
    if (!draft) return;
    setBusy(gwgSheetBusyKey(subject));
    setError("");
    try {
      if (!(await save("documents", false))) return;
      const targetLeadId = leadId ?? lastPersistedLeadIdRef.current;
      if (!targetLeadId) return;
      const generated = await generateDocument(
        gwgSheetRequest({
          leadId: targetLeadId,
          subject,
          orderId: order?.id,
          orderNumber: order?.order_number,
          replaceDocument: currentGwgSheet(wizardDocuments.gwg_identification, subject),
        }),
      );
      const nextDocuments = await fetchDocuments(`/documents?lead_id=${encodeURIComponent(targetLeadId)}&include_archived_versions=true`);
      setDocuments(nextDocuments);
      const generatedDocument = nextDocuments.find((document) => document.id === generated.id);
      if (generatedDocument) await openOrDownloadDocument(generatedDocument, true);
      // Named now, not first when the signature is confirmed.
      const notice = gwgSheetSignatureNotice(generated.signature_details, tx);
      if (notice) setError(notice);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function generateLeadComplianceDocument(
    templateId:
      | "confidentiality_release"
      | "privacy_information"
      | "privacy_consents"
      | "enhanced_due_diligence"
      // Filled by the server from the sent request only; the bindings below change nothing in it.
      | typeof LEAD_SELF_DISCLOSURE_TEMPLATE,
  ): Promise<boolean> {
    if (!draft) return false;
    // One generation at a time: a second click before the busy state shows
    // (or after a network error) made a second v1 (DEV 2026-10-24).
    if (documentGenerationRef.current) return false;
    documentGenerationRef.current = true;
    setBusy(`generate-${templateId}`);
    setError("");
    try {
      // The AML form edits the one record of the source of funds itself
      // (owner decision 2026-10-23): save it first; the server prints the
      // funds of the person who pays from that record, never a copy kept in
      // the wizard state.
      if (templateId === "enhanced_due_diligence" && !(await flushPayerAutosave())) return false;
      if (!(await save(templateId === "enhanced_due_diligence" ? "master_data" : "documents", false))) {
        return false;
      }
      const targetLeadId = leadId ?? lastPersistedLeadIdRef.current;
      if (!targetLeadId) return false;
      // For a minor the parents or the guardian declare on the child's form
      // (QA 2026-10-12, A2-06); a new version replaces the same form, also
      // when the date of birth or the custody changed its variant (round 3).
      const generatedTemplateId = templateId === "privacy_consents"
        ? leadConsentFormTemplate(
          isMinor(draft.birthDate, new Date()),
          step1Portal.intake?.representation?.custody,
        )
        : templateId;
      const generated = await generateDocument({
        template_id: generatedTemplateId,
        lead_id: targetLeadId,
        order_id: order?.id,
        replace_document_id: sortWizardDocumentsNewestFirst(
          wizardDocuments[templateId].filter((document) => (
            isReplaceableFormVersion(document, generatedTemplateId)
          )),
        ).find((document) => document.is_latest_version)?.id,
        language: "de",
        document_language: "de",
        document_direction: "outgoing",
        document_variant: "original",
        access_category: "patient",
        status: "active",
        bindings: {
          order_number: order?.order_number,
          party_city: draft.city.trim() || undefined,
          party_sign_place: draft.city.trim() || undefined,
          // The consent form's boxes are never preset by staff: only the
          // person's own choice from the cabinet ticks them (2026-10-12).
          // Required by the rule or carried out voluntarily: the tier names why.
          ...(templateId === "enhanced_due_diligence"
            ? {
                aml_enhanced_due_diligence: {
                  ...draft.amlEnhancedDueDiligence,
                  riskTier: amlDocumentRiskTier,
                  triggeredCountries: amlTriggeredCountries,
                },
              }
            : {}),
        },
      });
      const nextDocuments = await fetchDocuments(`/documents?lead_id=${encodeURIComponent(targetLeadId)}&include_archived_versions=true`);
      setDocuments(nextDocuments);
      const generatedDocument = nextDocuments.find((document) => document.id === generated.id);
      if (generatedDocument) await openOrDownloadDocument(generatedDocument, true);
      return true;
    } catch (nextError) {
      showWizardError(nextError);
      // The server may have stored the document although the answer was lost:
      // the list shows it, so the next click makes a new version of it.
      if (shouldReloadDocumentsAfterGenerationError(nextError)) void refreshDocumentsState();
      return false;
    } finally {
      documentGenerationRef.current = false;
      setBusy(null);
    }
  }

  async function submitAmlEnhancedDueDiligence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setAmlSheetError("");
    const generated = await generateLeadComplianceDocument("enhanced_due_diligence");
    if (generated) {
      setAmlSheetOpen(false);
      await refreshLeadState();
    } else {
      setAmlSheetError(tx(
        "Не удалось сохранить проверку и создать документ",
        "Prüfung konnte nicht gespeichert und das Dokument nicht erstellt werden",
      ));
    }
  }

  function commercialNeedsDescription() {
    if (!draft) return "";
    const serviceCommentLines = draft.serviceNeeds.flatMap((value) => {
      const comment = draft.serviceComments[value]?.trim();
      if (!comment) return [];
      const label = knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx);
      return [`- ${label}: ${comment}`];
    });

    return [
      draft.concern.trim(),
      lead?.message ? `${tx("Комментарий клиента", "Kundennachricht")}: ${lead.message.trim()}` : "",
      draft.serviceNeeds.length > 0
        ? `${tx("Запрошенные услуги", "Gewünschte Leistungen")}: ${draft.serviceNeeds.map((value) => knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx)).join(", ")}`
        : "",
      serviceCommentLines.length > 0
        ? `${tx("Комментарии к услугам", "Kommentare zu Leistungen")}:
${serviceCommentLines.join("\n")}`
        : "",
      lead?.location_detailed
        ? `${tx("Текущее местонахождение", "Aktueller Aufenthaltsort")}: ${leadLocationDetailedLabel(lead.location_detailed, t)}`
        : lead?.location
          ? `${tx("Текущее местонахождение", "Aktueller Aufenthaltsort")}: ${leadLocationLabel(lead.location, t)}`
          : "",
      lead?.preferred_location
        ? `${tx("Предпочитаемое место лечения", "Bevorzugter Behandlungsort")}: ${leadPreferredLocationLabel(lead.preferred_location, t)}`
        : "",
      lead?.visit_timing
        ? `${tx("Желаемый срок", "Gewünschter Zeitraum")}: ${leadVisitTimingLabel(lead.visit_timing, t)}`
        : "",
      lead?.needs_interpreter
        ? tx("Нужен переводчик", "Dolmetscher benötigt")
        : "",
      lead?.can_travel != null
        ? `${tx("Может приехать", "Kann anreisen")}: ${yesNoValue(lead.can_travel, tx)}`
        : "",
      lead?.has_travel_documents != null
        ? `${tx("Проездные документы", "Reisedokumente")}: ${yesNoValue(lead.has_travel_documents, tx)}`
        : "",
    ].filter(Boolean).join("\n");
  }

  async function ensureCommercial(
    flags: CommercialFlagsPatch = {},
    syncOrderServiceLines = true,
  ) {
    if (!leadId || !draft) throw new Error(tx("Обращение не выбрано", "Kein Lead ausgewählt"));
    if (syncOrderServiceLines && !lines.some(validLine)) {
      throw new Error(
        tx(
          "Добавьте корректную услугу",
          "Mindestens eine gültige Leistung ist erforderlich",
        ),
      );
    }
    if (!(await save("commercial", false))) throw new Error(tx("Не удалось сохранить обращение", "Lead konnte nicht gespeichert werden"));
    if (draft.frameworkContractId && !contract) throw new Error(tx("Выбранный договор недоступен. Обновите проверку документов.", "Der gewählte Vertrag ist nicht verfügbar. Aktualisieren Sie die Dokumentenprüfung."));
    if (inheritedContract && contract && !isContractUsable(contract)) {
      throw new Error(tx("Сохранённый договор не подписан или расторгнут. Выберите подписанный договор или оформите новый.", "Der gespeicherte Vertrag ist nicht unterzeichnet oder wurde gekündigt. Wählen Sie einen unterzeichneten Vertrag oder erstellen Sie einen neuen."));
    }
    let contractId = contract?.id;
    if (!contractId) {
      if (!parseDateKey(draft.contractValidFrom)) {
        throw new Error(tx("Укажите корректную дату начала действия договора", "Geben Sie ein gültiges Datum für den Vertragsbeginn an"));
      }
      contractId = (await createContract({
        lead_id: leadId,
        status: "sent",
        valid_from: draft.contractValidFrom,
        client_reference: "lead-onboarding:" + leadId + ":framework",
      })).id;
    }
    let orderId = order?.id;
    const needsDescription = commercialNeedsDescription();
    if (!orderId) {
      orderId = (await createOrder({
        source_lead_id: leadId,
        contract_id: contractId,
        needs_description: needsDescription,
        date_from: draft.programDateFrom,
        date_to: draft.programDateTo,
      })).id;
    }
    const requestedPrepaymentAmount = flags.prepayment_amount
      ?? (prepayment ? prepaymentAmount : undefined);
    const normalizedPrepaymentAmount = requestedPrepaymentAmount?.trim();
    // The typed deadline travels with every commercial save, like the typed
    // amount: its field commits only on blur, and an action started without
    // that blur would otherwise reload the order's empty deadline over it.
    const prepaymentDueAt = flags.prepayment_due_at ?? prepaymentDueAtPatch(
      flags.prepayment_required ?? prepayment,
      prepaymentDeadline,
      order?.prepayment_due_at,
    );
    const targetOrderId = orderId;
    // QA C3-01: the client's signature covers the services and the period it
    // was given for. A change of a signed order is refused until the user
    // confirms the reset; the dialog names the signed and the new total.
    const persistCommercialTerms = async (confirmSignatureReset: boolean) => {
      await updateOrderCommercialBasis(targetOrderId, {
        ...(confirmSignatureReset ? { confirm_signature_reset: true } : {}),
        contract_id: contractId,
        prepayment_required: flags.prepayment_required ?? prepayment,
        ...(prepaymentDueAt !== undefined ? { prepayment_due_at: prepaymentDueAt } : {}),
        ...(!syncOrderServiceLines
          && normalizedPrepaymentAmount
          && validMoneyInput(normalizedPrepaymentAmount)
          ? { prepayment_amount: normalizedPrepaymentAmount }
          : {}),
        // Existing repeat signatures are changed only by the explicit signature action.
        // Sending cached checkboxes here would restore signatures invalidated by a service edit.
        // The client's signature follows the signed order document only (owner
        // decision 2026-10-12): never sent from the cached state, which would
        // undo a scan or QES recorded meanwhile.
        signed_patient: flags.signed_patient,
        // The agency mark is sent only by its own checkbox (`saveFlags`): a
        // cached `false` sent with the next commercial save (confirming the
        // quote, «Сохранить договор и заказ») unticked a mark stored meanwhile
        // (QA 2026-10-25, M F-6 / F-G9; the server keeps it when left out).
        signed_agency: flags.signed_agency,
        needs_description: needsDescription,
        date_from: draft.programDateFrom,
        date_to: draft.programDateTo,
      });

      let persistedServiceLines = withEstimatedOutlaysLast(lines.filter(validLine));
      if (syncOrderServiceLines) {
        const currentServiceLines = withEstimatedOutlaysLast(
          lines.filter((line) => validLine(line) && line.managedByWizard !== false),
        ).map((line) => ({
          line,
          clientReference:
            line.clientReference ?? `lead-wizard:${leadId}:${line.id}`,
        }));
        await Promise.all(
          currentServiceLines.map(({ line, clientReference }) =>
            createOrderLeistung(targetOrderId, {
              agency_service_id: line.agencyServiceId,
              agency_service_price_version_id: requestedAgencyServicePriceId(line),
              description: line.description.trim(),
              quantity: money(line.quantity),
              unit_price: money(line.price),
              vat_rate: money(line.vat),
              is_cost_passthrough: line.isCostPassthrough === true,
              client_reference: clientReference,
              confirm_signature_reset: confirmSignatureReset,
            }),
          ),
        );
        await syncLeadWizardOrderLeistungen(
          targetOrderId,
          leadId,
          currentServiceLines.map((item) => item.clientReference),
          confirmSignatureReset,
        );
        const persistedOrder = await fetchOrder(targetOrderId);
        persistedServiceLines = withEstimatedOutlaysLast(
          persistedOrder.leistungen.map(lineFromOrderLeistung).filter(validLine),
        );
        if (persistedServiceLines.length === 0) {
          throw new Error(tx(
            "Заказ не сохранил ни одной корректной услуги",
            "Der Auftrag enthält nach dem Speichern keine gültige Leistung",
          ));
        }
        const persistedEstimate = calculateServiceLineEstimate(persistedServiceLines);
        if (
          normalizedPrepaymentAmount
          && validMoneyInput(normalizedPrepaymentAmount)
          && toCents(money(normalizedPrepaymentAmount)) > toCents(persistedEstimate.gross)
        ) {
          throw new Error(tx(
            "Необходимая предоплата превышает пересчитанную сумму заказа. Обновите сумму предоплаты.",
            "Die erforderliche Vorauszahlung übersteigt den neu berechneten Auftragsbetrag. Passen Sie die Vorauszahlung an.",
          ));
        }
        await updateOrderCommercialBasis(targetOrderId, {
          total_estimated: persistedEstimate.gross.toFixed(2),
          ...(normalizedPrepaymentAmount && validMoneyInput(normalizedPrepaymentAmount)
            ? { prepayment_amount: normalizedPrepaymentAmount }
            : {}),
        });
        setLines(persistedServiceLines);
      }
      return persistedServiceLines;
    };
    const persistedServiceLines = await withSignedTermsConfirmation(
      persistCommercialTerms,
      (refusal) => window.confirm(signedTermsChangeConfirmText(
        refusal,
        syncOrderServiceLines
          ? calculateServiceLineEstimate(withEstimatedOutlaysLast(lines.filter(validLine))).gross
          : null,
      )),
    );
    return { contractId, orderId, serviceLines: persistedServiceLines };
  }

  async function prepareCommercial() {
    setCommercialSaveFeedback(null);
    if (!lines.some(validLine)) {
      const message = tx(
        "Выберите услугу и укажите количество больше нуля",
        "Wählen Sie eine Leistung und geben Sie eine Menge größer als null ein",
      );
      setCommercialSaveFeedback({ tone: "error", message });
      window.requestAnimationFrame(() => {
        document.getElementById(ORDER_SERVICE_SELECT_ID)?.focus();
      });
      return;
    }
    setBusy("commercial");
    try {
      await ensureCommercial();
      const nextLead = await reload(false, true);
      const feedback = commercialReadinessFeedback(nextLead?.readiness, tx);
      // A pending list keeps following the lead's readiness (see render).
      setCommercialSaveFeedback(
        feedback.tone === "warning" ? { ...feedback, followsReadiness: true } : feedback,
      );
    } catch (nextError) {
      // Keeping the client's signature is a choice, not a failure (QA C3-01).
      setCommercialSaveFeedback(nextError instanceof SignedTermsChangeCancelled
        ? { tone: "warning", message: nextError.message }
        : { tone: "error", message: errorText(nextError, tx) });
      setValidationContext(null);
      setError("");
    } finally {
      setBusy(null);
    }
  }

  async function signContract(documentId: string, fromPreview = false) {
    setBusy("sign-" + documentId);
    setError("");
    if (fromPreview) setDocumentPreviewError("");
    setCommercialDocumentErrors((current) => ({ ...current, framework_contract: "" }));
    try {
      const result = await ensureCommercial();
      // The signed document is the proof the contract status needs (owner
      // decision 2026-10-11); both steps check the payer gate of a lead.
      await markDocumentSigned(documentId, "framework_contract");
      await updateContractStatus(result.contractId, { status: "signed" });
      if (fromPreview) await refreshCommercialState();
      else await reload(false, true);
    } catch (nextError) {
      setValidationContext(null);
      // QA 2026-10-10: the refusal (the client signs the order first) went unnoticed.
      const message = frameworkContractSignErrorText(nextError, tx)
        ?? signatureGateErrorText(nextError, tx)
        ?? errorText(nextError, tx);
      if (fromPreview) setDocumentPreviewError(message);
      else {
        setCommercialDocumentErrors((current) => ({
          ...current,
          framework_contract: message,
        }));
        window.requestAnimationFrame(() => {
          document.getElementById(commercialDocumentErrorId("framework_contract"))
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      }
    } finally {
      setBusy(null);
    }
  }

  /**
   * Persists commercial flags on the order. A `background` save commits a
   * typed value when its field loses focus: it keeps the other controls
   * enabled, because that blur usually comes from a click on the next control,
   * and disabling it between mousedown and click swallowed that first click.
   * Actions started meanwhile send the same typed values via ensureCommercial,
   * and the per-flag request versions keep a stale response from winning.
   */
  async function saveFlags(
    patchValue: CommercialFlagsPatch,
    rollbackValue: CommercialFlagsPatch,
    { background = false }: { background?: boolean } = {},
  ) {
    const existingOrderId = order?.id;
    // Without an order the save creates it first, which must block the wizard.
    const blocking = !background || !existingOrderId;
    const setFlagsCount = blocking
      ? setCommercialFlagsBusyCount
      : setCommercialFlagsBackgroundCount;
    setFlagsCount((current) => current + 1);
    const flagKeys = Object.keys(patchValue) as CommercialFlagKey[];
    const requestVersions = new Map(
      flagKeys.map((key) => {
        const version = commercialFlagRequestVersionRef.current[key] + 1;
        commercialFlagRequestVersionRef.current[key] = version;
        return [key, version] as const;
      }),
    );
    const targetLeadId = leadId;
    if (!existingOrderId) setBusy("flags");
    // Clearing a shown error moves the footer; a background save does it only
    // after the click that caused the blur has landed.
    if (blocking) setError("");
    try {
      if (existingOrderId) {
        const saved = await updateOrderCommercialBasis(existingOrderId, patchValue);
        if (!blocking && hydrated.current === targetLeadId) setError("");
        flagKeys.forEach((key) => {
          if (commercialFlagRequestVersionRef.current[key] === requestVersions.get(key)) {
            commercialFlagRequestVersionRef.current[key] += 1;
          }
        });
        setOrders((current) => current.map((item) => (
          item.id === existingOrderId ? { ...item, ...patchValue, prepayment_due_at: saved.prepayment_due_at } : item
        )));
        if (hydrated.current === targetLeadId && patchValue.prepayment_required === false) {
          setPrepaymentDeadline("");
        }

        if (targetLeadId) {
          void refreshCommercialState().catch(() => undefined);
        }
      } else {
        await ensureCommercial(patchValue);
        await reload(false, true);
      }
    } catch (nextError) {
      if (hydrated.current === targetLeadId) {
        showWizardError(nextError);
        flagKeys.forEach((key) => {
          if (commercialFlagRequestVersionRef.current[key] !== requestVersions.get(key)) return;
          const rollback = rollbackValue[key];
          if (rollback === undefined) return;
          if (key === "signed_patient" && typeof rollback === "boolean") {
            setSignedPatient(rollback);
          }
          if (key === "signed_agency" && typeof rollback === "boolean") {
            setSignedAgency(rollback);
          }
          if (key === "prepayment_required" && typeof rollback === "boolean") {
            setPrepayment(rollback);
          }
          // A refused amount (e.g. above the order total) stays in the field next
          // to the server's reason so it can be corrected (QA 2026-10-11 C-07).
          const refusedInput = nextError instanceof ApiRequestError && nextError.status === 422;
          if (key === "prepayment_amount" && typeof rollback === "string" && !refusedInput) {
            setPrepaymentAmount(rollback);
          }
          if (key === "prepayment_due_at" && typeof rollback === "string") {
            setPrepaymentDeadline(localDeadline(rollback));
          }
        });
      }
    } finally {
      if (!existingOrderId) setBusy(null);
      setFlagsCount((current) => Math.max(0, current - 1));
    }
  }

  async function createOrAcceptQuote(accept: boolean) {
    if (accept && (!quote || !quoteIsCurrent)) {
      setError("");
      setCommercialQuoteError(tx(
        "Сначала пересчитайте смету по текущим услугам",
        "Berechnen Sie zuerst den Kostenvoranschlag für die aktuellen Leistungen neu",
      ));
      return;
    }
    if (
      prepayment
      && (
        !validMoneyInput(prepaymentAmount)
        || requiredPrepayment <= 0
        || (accept && !requiredPrepaymentValid)
      )
    ) {
      setError("");
      setCommercialQuoteError(tx(
        "Укажите необходимую предоплату больше нуля и не больше суммы сметы",
        "Geben Sie eine erforderliche Vorauszahlung größer als null und nicht höher als den Kostenvoranschlag an",
      ));
      return;
    }

    setBusy(accept ? "accept" : "quote");
    setError("");
    setCommercialQuoteError("");
    try {
      const result = await ensureCommercial();
      const persistedEstimate = calculateServiceLineEstimate(result.serviceLines);
      if (prepayment && toCents(requiredPrepayment) > toCents(persistedEstimate.gross)) {
        await reload(false, true);
        setCommercialQuoteError(tx(
          "Необходимая предоплата превышает пересчитанную сумму заказа. Обновите сумму предоплаты.",
          "Die erforderliche Vorauszahlung übersteigt den neu berechneten Auftragsbetrag. Passen Sie die Vorauszahlung an.",
        ));
        return;
      }
      if (
        accept
        && (!quote || !quoteMatchesCurrentServices(quote, result.serviceLines, persistedEstimate.gross))
      ) {
        await reload(false, true);
        setCommercialQuoteError(tx(
          "Цены заказа изменились по периоду программы. Пересчитайте смету перед подтверждением.",
          "Die Auftragspreise haben sich für den Programmzeitraum geändert. Berechnen Sie den Kostenvoranschlag vor der Annahme neu.",
        ));
        return;
      }
      if (!accept) {
        const created = await createQuote(result.orderId, {});
        const createdQuote: QuoteItem = {
          id: created.id,
          order_id: created.order_id,
          order_number: order?.order_number ?? "",
          contract_id: created.contract_id ?? result.contractId,
          patient_id: created.patient_id ?? null,
          lead_id: created.lead_id ?? leadId,
          patient_name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "",
          patient_pid: "",
          quote_number: created.quote_number,
          status: created.status,
          total_net: created.total_net,
          total_vat: created.total_vat,
          total_gross: created.total_gross,
          valid_until: created.valid_until ?? null,
          paid_amount: created.paid_amount ?? "0",
          paid_at: created.paid_at ?? null,
          notes: created.notes ?? null,
          version_count: created.version_count,
          current_version_number: created.current_version_number,
          created_at: created.created_at,
          updated_at: created.updated_at,
          line_items: created.line_items,
        };
        setPaidAmount(String(createdQuote.paid_amount ?? ""));
        setQuotes((current) => [createdQuote, ...current.filter((item) => item.id !== createdQuote.id)]);
      } else if (quote) {
        const accepted = await updateQuoteStatus(quote.id, {
          status: "accepted",
        });
        setPaidAmount(String(accepted.paid_amount ?? ""));
        setQuotes((current) => [accepted, ...current.filter((item) => item.id !== accepted.id)]);
        // One reload after the confirmation supersedes every load begun before
        // it (QA 2026-10-25, M F-2): none of their older leads, with the
        // readiness of before, is written after it — and none is reused.
        if (leadId) {
          clearApiCache(`/leads/${leadId}`);
          clearApiCache("/quotes");
          clearApiCache("/orders");
        }
      }
      await reload(false, true);
    } catch (nextError) {
      setValidationContext(null);
      // 409 `estimate_document_outdated`: the KV PDF is older than the order.
      setCommercialQuoteError(outdatedDocumentSignErrorText(nextError, tx) ?? errorText(nextError, tx));
      if (outdatedDocumentSignErrorText(nextError, tx)) void refreshDocumentsState();
    } finally {
      setBusy(null);
    }
  }

  async function generateCommercialDocument(templateId: CommercialDocumentKind) {
    if (!leadId || !draft || commercialGenerationInFlightRef.current) return;
    const validServiceLines = lines.filter(validLine);
    // The VKS lists the selected medical work types only, never the agency's services.
    if (templateId === "cost_estimate" && costEstimateHint) {
      setError("");
      setCommercialDocumentErrors((current) => ({ ...current, cost_estimate: costEstimateHint }));
      return;
    }
    const normalizedPrepaymentAmount = prepaymentAmount.trim();
    const invalidRequiredPrepayment = prepayment && (
      !normalizedPrepaymentAmount
      || !validMoneyInput(normalizedPrepaymentAmount)
      || money(normalizedPrepaymentAmount) <= 0
    );
    if (invalidRequiredPrepayment) {
      setValidationContext(null);
      setError("");
      setCommercialDocumentErrors((current) => ({
        ...current,
        [templateId]: tx(
          "Укажите необходимую предоплату больше нуля и не больше суммы сметы",
          "Geben Sie eine erforderliche Vorauszahlung größer als null und nicht höher als den Kostenvoranschlag an",
        ),
      }));
      return;
    }
    commercialGenerationInFlightRef.current = true;
    setBusy(`generate-${templateId}`);
    setError("");
    setCommercialDocumentErrors((current) => ({ ...current, [templateId]: "" }));
    try {
      const documentLanguage = templateId === "cost_estimate"
        ? costEstimateDocumentLanguage(draft.costEstimateAdditionalLanguage)
        : "de";
      const commercial = await ensureCommercial(
        {},
        templateId !== "cost_estimate" || validServiceLines.length > 0,
      );
      const commercialServiceLines = withEstimatedOutlaysLast(
        commercial.serviceLines.filter(validLine),
      );
      const commercialEstimate = calculateServiceLineEstimate(commercialServiceLines);
      const documentServiceLines = commercialServiceLines.filter((line) => (
        templateId === "order_cost_estimate" || !isEstimatedOutlaysLine(line)
      ));
      const documentEstimate = calculateServiceLineEstimate(documentServiceLines);
      if (
        prepayment
        && commercialServiceLines.length > 0
        && toCents(requiredPrepayment) > toCents(commercialEstimate.gross)
      ) {
        await reload(false, true);
        setCommercialDocumentErrors((current) => ({
          ...current,
          [templateId]: tx(
            "Необходимая предоплата превышает пересчитанную сумму заказа. Обновите сумму предоплаты.",
            "Die erforderliche Vorauszahlung übersteigt den neu berechneten Auftragsbetrag. Passen Sie die Vorauszahlung an.",
          ),
        }));
        return;
      }
      const latestOrderQuote = quotes.find(
        (item) => item.order_id === commercial.orderId && item.status !== "superseded",
      );
      const latestQuoteIsCurrent = Boolean(
        latestOrderQuote
        && quoteMatchesCurrentServices(
          latestOrderQuote,
          commercialServiceLines,
          commercialEstimate.gross,
        ),
      );
      if (
        templateId !== "framework_contract"
        && templateId !== "cost_estimate"
        && !latestQuoteIsCurrent
      ) {
        await createQuote(commercial.orderId, {});
      }
      const generated = await generateDocument({
        template_id: templateId,
        lead_id: leadId,
        order_id: commercial.orderId,
        replace_document_id: sortWizardDocumentsNewestFirst(
          commercialDocuments[templateId],
        ).find((document) => document.is_latest_version)?.id,
        language: documentLanguage,
        document_language: documentLanguage,
        document_direction: "outgoing",
        document_variant: "original",
        access_category: ["order_cost_estimate", "cost_estimate"].includes(templateId)
          ? "financial"
          : "patient",
        status: "active",
        bindings: {
          cost_threshold: draft.costThreshold.trim() || undefined,
          party_city: draft.city.trim() || undefined,
          party_sign_place: draft.city.trim() || undefined,
          specialties: draft.specialties.map((value) => specialtyDocumentLabel(value)).join(", "),
          period_from: draft.programDateFrom || undefined,
          period_to: draft.programDateTo || undefined,
          // German amounts, "1.234,56 €", as the document is German (QA 2026-10-10: no
          // "550.00 EUR"; owner rule: the euro sign, never "EUR").
          estimate_total: templateId === "cost_estimate"
            ? costEstimateTotalRange(selectedCostEstimateWorkTypes)
            : `${formatMoneyValue(documentEstimate.gross, "de")} €`,
          service_lines: templateId === "cost_estimate"
            ? costEstimateServiceLines(
                selectedCostEstimateWorkTypes,
                draft.costEstimateAdditionalLanguage,
              )
            : documentServiceLines.map((line) => ({
                description: serviceDocumentDescription(line),
                quantity: line.quantity,
                fee: serviceDocumentFee(line),
                line_total: `${formatMoneyValue(roundCents(money(line.quantity) * money(line.price)), "de")} €`,
                vat_rate: line.vat,
                // A 0 % pass-through cost is a durchlaufender Posten, not tax-exempt medical care.
                is_cost_passthrough: line.isCostPassthrough === true,
                note: serviceDocumentNote(line),
                description_items: resolvedServiceCatalogItems(line),
              })),
        },
      });
      let nextDocuments: DocumentItem[];
      try {
        nextDocuments = await refreshCommercialState();
      } catch {
        setValidationContext(null);
        const message = tx(
          "Документ создан, но список документов не обновился. Закройте и снова откройте обращение.",
          "Das Dokument wurde erstellt, die Dokumentenliste konnte jedoch nicht aktualisiert werden. Schließen und öffnen Sie den Lead erneut.",
        );
        setCommercialDocumentErrors((current) => ({
          ...current,
          [templateId]: message,
        }));
        return;
      }
      const generatedDocument = nextDocuments.find((document) => document.id === generated.id);
      if (generatedDocument) {
        await openOrDownloadDocument(generatedDocument, true);
      } else {
        setValidationContext(null);
        const message = tx(
          "Документ создан, но пока не появился в списке. Обновите обращение и откройте его из документов.",
          "Das Dokument wurde erstellt, ist aber noch nicht in der Liste verfügbar. Aktualisieren Sie den Lead und öffnen Sie es über die Dokumente.",
        );
        setCommercialDocumentErrors((current) => ({
          ...current,
          [templateId]: message,
        }));
      }
    } catch (nextError) {
      setValidationContext(null);
      setCommercialDocumentErrors((current) => ({
        ...current,
        [templateId]: errorText(nextError, tx),
      }));
    } finally {
      commercialGenerationInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function convert() {
    if (!leadId) return;
    if (!conversionConfirmed) {
      setError(tx(
        "Подтвердите, что данные проверены и пациента можно создать",
        "Bestätigen Sie, dass die Daten geprüft wurden und der Patient angelegt werden kann",
      ));
      return;
    }
    const intakeDraft = await finishIntake("release");
    if (!intakeDraft) return;
    if (!(await finishOrder("release", intakeDraft))) return;
    setBusy("convert");
    try {
      await ensureCommercial();
      const result = await wizardConvertLead(leadId, true);
      if (isRepeatIntake && order?.id && onOrderCreated) onOrderCreated(order.id);
      else if (onConverted) onConverted(result.patient_id);
      else onOpenChange(false);
    } catch (nextError) {
      await reload(false);
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function archiveLead() {
    if (!leadId) return;
    if (!(await flushPayerAutosave())) return;
    setBusy("archive");
    setError("");
    try {
      await resolveFailedLead(leadId, {
        resolution: "archive",
        // The reason chosen with «Не подходит»; without one the lead does not fit the service.
        reason: lead?.failed_outcome?.reason?.trim() || "not_our_lead",
      });
      setArchiveConfirmOpen(false);
      if (onArchived) onArchived();
      else onOpenChange(false);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  function openNotQualified() {
    setNotQualifiedError("");
    setNotQualifiedReason(leadFailureReasonDraft(lead?.failed_outcome?.reason));
  }

  /** «Не подходит» with the chosen reason; the server keeps it as the lead's failure reason. */
  async function markNotQualified() {
    if (!leadId || !notQualifiedReason) return;
    if (!(await flushPayerAutosave())) return;
    const reason = leadFailureReasonValue(notQualifiedReason);
    if (!reason) {
      setNotQualifiedError(leadFailureReasonError(notQualifiedReason, tx) ?? "");
      return;
    }
    setBusy("not_qualified");
    setNotQualifiedError("");
    try {
      await updateLeadStatus(leadId, "not_qualified", reason);
    } catch (nextError) {
      setNotQualifiedError(errorText(nextError, tx));
      setBusy(null);
      return;
    }
    setNotQualifiedReason(null);
    try {
      await refreshLeadState();
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function createLeadAndNavigate(target: StepId) {
    try {
      if (!ensureMasterDataReady()) return;
      if (await save(target)) setStep(target);
    } finally {
      stepNavigationInFlightRef.current = false;
    }
  }

  async function prepareReleaseAndNavigate() {
    try {
      if (!leadId || !draft) return;
      if (!(await flushPayerAutosave())) return;
      setBusy("intake");
      if (!(await save("release", false))) return;
      await refreshLeadState();
      setStep("release");
    } finally {
      setBusy(null);
      stepNavigationInFlightRef.current = false;
    }
  }

  async function navigateToStep(target: StepId) {
    if (target === step || loading || isBusy || stepNavigationInFlightRef.current) return;
    stepNavigationInFlightRef.current = true;
    try {
      if (!(await flushPayerAutosave())) return;
      setError("");
      setValidationContext(null);
      setOrderValidationAttempted(false);
        if (!leadId && createMode) await createLeadAndNavigate(target);
      else if (target === "release") await prepareReleaseAndNavigate();
      else setStep(target);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      stepNavigationInFlightRef.current = false;
    }
  }

  function updateLine(id: string, patchValue: Partial<ServiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patchValue } : line));
  }

  function addEstimatedOutlays() {
    if (!leadId) return;
    setCommercialSaveFeedback(null);
    setLines((current) => {
      if (current.some(isEstimatedOutlaysLine)) return current;
      return withEstimatedOutlaysLast([
        ...current,
        {
          ...newLine(current.length + 1),
          clientReference: `lead-wizard:${leadId}${ESTIMATED_OUTLAYS_REFERENCE_SUFFIX}`,
          isCostPassthrough: true,
          description: ESTIMATED_OUTLAYS_DESCRIPTION,
          quantity: "1",
          price: "",
          vat: "0",
        },
      ]);
    });
  }

  function servicePriceChoiceLabel(
    price: ReturnType<typeof listAgencyServicePriceChoices>[number],
  ) {
    const period = `${germanDateLabel(price.valid_from)} — ${
      price.valid_to
        ? germanDateLabel(price.valid_to)
        : tx("бессрочно", "unbefristet")
    }`;
    return [
      formatMoneyLabel(money(inputString(price.unit_price)), price.currency),
      priceVersionDisplayName(price),
      period,
      price.is_effective ? tx("рекомендуемая", "empfohlen") : "",
    ].filter(Boolean).join(" · ");
  }

  function applyAgencyServicePrice(
    lineId: string,
    service: AgencyServiceItem,
    priceVersionId: string,
  ) {
    const price = listAgencyServicePriceChoices(
      service,
      draft?.programDateFrom || undefined,
    ).find((candidate) => candidate.id === priceVersionId);
    if (!price || price.currency.toUpperCase() !== "EUR") {
      return;
    }
    setCommercialSaveFeedback(null);
    updateLine(lineId, {
      agencyServicePriceVersionId: price.id || null,
      currency: price.currency || "EUR",
      price: inputString(price.unit_price),
      vat: inputString(price.vat_rate, "19"),
    });
  }

  function selectedAgencyServicePriceId(line: ServiceLine, service: AgencyServiceItem) {
    if (line.agencyServicePriceVersionId) return line.agencyServicePriceVersionId;
    const choices = listAgencyServicePriceChoices(
      service,
      draft?.programDateFrom || undefined,
    );
    const matchingSnapshot = choices.find((candidate) => (
      candidate.currency === line.currency
      && Math.abs(money(candidate.unit_price) - money(line.price)) < 0.005
      && Math.abs(money(candidate.vat_rate) - money(line.vat)) < 0.005
    ));
    return matchingSnapshot?.id
      ?? choices.find((candidate) => candidate.is_effective)?.id
      ?? "";
  }

  function requestedAgencyServicePriceId(line: ServiceLine) {
    if (!line.agencyServiceId) return null;
    const service = agencyServiceById.get(line.agencyServiceId);
    return service
      ? selectedAgencyServicePriceId(line, service) || null
      : line.agencyServicePriceVersionId;
  }

  function addAgencyService(selection: string) {
    const parsedSelection = parseServicePriceOptionValue(selection);
    if (!parsedSelection) return;
    const service = agencyServiceById.get(parsedSelection.serviceId);
    if (!service) return;
    const selectedPrice = listAgencyServicePriceChoices(
      service,
      draft?.programDateFrom || undefined,
    ).find((candidate) => candidate.id === parsedSelection.priceVersionId);
    if (
      !selectedPrice
      || selectedPrice.currency.toUpperCase() !== "EUR"
    ) return;
    setCommercialSaveFeedback(null);
    setLines((current) => {
      if (current.some((line) => line.agencyServiceId === service.id)) return current;
      return withEstimatedOutlaysLast([
        ...current,
        {
          ...newLine(current.length + 1),
          agencyServiceId: service.id,
          agencyServicePriceVersionId: selectedPrice.id || null,
          description: service.service_name,
          catalogDescription: service.description?.trim() ?? "",
          catalogDescriptionItems: serviceDescriptionItems(service.description_items, service.description),
          catalogUnitLabel: service.unit_label?.trim() ?? "",
          currency: selectedPrice.currency || "EUR",
          price: inputString(selectedPrice.unit_price),
          vat: inputString(selectedPrice.vat_rate, "19"),
        },
      ]);
    });
  }

  function openValidationIssue(issue: ValidationIssue) {
    setStep(issue.step);
    const fieldId = issue.fieldId;
    if (!fieldId) return;
    // The target step may still be mounting (lazy sections), so retry for a few frames.
    let attempts = 0;
    const focusField = () => {
      const field = document.getElementById(fieldId);
      const panel = stepPanelRef.current;
      if (field && panel?.contains(field)) {
        // scrollIntoView also scrolls the overflow-hidden modal, which can move
        // its header and entire body out of view. Only the step panel scrolls.
        const panelRect = panel.getBoundingClientRect();
        const fieldRect = field.getBoundingClientRect();
        panel.scrollTo({
          top: panel.scrollTop + fieldRect.top - panelRect.top
            - Math.max(0, (panel.clientHeight - fieldRect.height) / 2),
        });
        field.focus({ preventScroll: true });
        window.requestAnimationFrame(() => keepFocus(field, 0));
      } else if (++attempts < 30) {
        window.requestAnimationFrame(focusField);
      }
    };
    // A jump pressed on a control that then goes away (the refusal under a
    // document row) makes the dialog take the focus back a frame later: keep
    // it on the target for a few frames, unless the user moved on.
    const keepFocus = (field: HTMLElement, frames: number) => {
      const active = document.activeElement;
      if (active !== field && (active === document.body || active?.getAttribute("role") === "dialog")) {
        field.focus({ preventScroll: true });
      }
      if (frames < 10) window.requestAnimationFrame(() => keepFocus(field, frames + 1));
    };
    window.requestAnimationFrame(focusField);
  }

  /** The identity document data of a person who acts for the lead, in the documents step. */
  function openRepresentativeIdData(representativeId: string, focus: "identity" | "authority" | null = null) {
    setStep("documents");
    // The person's card is a <details>: open it, then go to its first field —
    // or to the proof of authority when that is what is missing (DEV 2026-10-27).
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const authority = focus === "authority" && representativeId !== "patient"
        ? document.querySelector<HTMLElement>(`[data-testid="lead-representative-upload-authority-${representativeId}"]`)
        : null;
      // Without an upload place for the proof (the card does not ask it), the person's card.
      const form = authority ?? document.querySelector<HTMLElement>(
        representativeId === "patient" ? '[data-testid="lead-id-data"]'
          : `[data-testid="lead-representative-id-data-${representativeId}"]`,
      );
      const card = form?.closest("details");
      if (card) card.open = true;
      const panel = stepPanelRef.current;
      if (!form || !panel?.contains(form)) return;
      // Scroll only the step body. Scrolling/focusing through the modal's
      // ancestors can push its header and footer out of their fixed positions.
      const field = authority
        ? form.querySelector<HTMLElement>("button, label[for]")
        : form.querySelector<HTMLElement>("select, input");
      const target = field ?? form;
      const panelRect = panel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      panel.scrollTo({
        top: panel.scrollTop + targetRect.top - panelRect.top
          - Math.max(0, (panel.clientHeight - targetRect.height) / 2),
      });
      field?.focus({ preventScroll: true });
    }));
  }

  const draftIsMinor = Boolean(draft && isMinor(draft.birthDate, new Date()));

  function openReadinessReason(reason: string) {
    if (reason === "Lead must be qualified before conversion") {
      void finishIntake("release");
      return;
    }
    openValidationIssue({
      key: reason,
      step: readinessReasonStep(reason),
      message: readinessReasonText(reason, tx, draftIsMinor, lead?.readiness),
      fieldId: readinessReasonFieldId(reason, draft),
    });
  }

  function specialtyLabel(value: string) {
    const specialty = specialties.find(
      (item) => specializationValue(item) === value,
    );
    // The catalogue loads lazily and may not hold an old code: the built-in
    // names keep "cardiology" from showing as a raw code (QA B-18).
    if (!specialty) return specializationLabelForValue(value, [], lang === "de" ? "de" : "ru");
    return lang === "de"
      ? specialty.name_de || specialty.name_en
      : specialty.name_ru || specialty.name_de || specialty.name_en;
  }

  function specialtyDocumentLabel(value: string) {
    const specialty = specialties.find(
      (item) => specializationValue(item) === value,
    );
    return specialty?.name_de || specialty?.name_en || specialty?.name_ru || value;
  }

  function serviceDocumentDescription(line: ServiceLine) {
    const catalogService = line.agencyServiceId
      ? agencyServiceById.get(line.agencyServiceId)
      : undefined;
    return line.description.trim() || catalogService?.service_name.trim() || "";
  }

  function resolvedServiceCatalogItems(line: ServiceLine) {
    const items = serviceDescriptionItems(line.catalogDescriptionItems, line.catalogDescription);
    return resolveServiceDescriptionItems(items, {
      dateFrom: draft?.programDateFrom ?? "",
      dateTo: draft?.programDateTo ?? "",
      specialties: (draft?.specialties ?? []).map((value) => specialtyDocumentLabel(value)),
    });
  }

  function resolvedServiceCatalogDescription(line: ServiceLine) {
    return serviceDescriptionText(resolvedServiceCatalogItems(line));
  }

  function serviceDocumentNote(line: ServiceLine) {
    return resolvedServiceCatalogDescription(line) || undefined;
  }

  function serviceDocumentFee(line: ServiceLine) {
    const catalogService = line.agencyServiceId
      ? agencyServiceById.get(line.agencyServiceId)
      : undefined;
    const unit = germanDocumentUnitLabel(line.catalogUnitLabel.trim() || catalogService?.unit_label?.trim());
    // German document: "550,00 € / Stück", never the raw catalogue unit "EUR/item" (QA 2026-10-11).
    const currency = (line.currency || "EUR").toUpperCase();
    const amount = `${formatMoneyValue(money(line.price), "de")} ${currency === "EUR" ? "€" : currency}`;
    return unit ? `${amount} / ${unit}` : amount;
  }

  const isBusy = busy !== null || commercialFlagsBusyCount > 0;
  // The prepayment deadline is stored on the order when its field loses focus
  // or with the next commercial action; until then it is not saved.
  const prepaymentDeadlineUnsaved = Boolean(order)
    && prepaymentDueAtPatch(prepayment, prepaymentDeadline, order?.prepayment_due_at) !== undefined;
  // The table above checks the patient card; step 4 is closed only by this
  // request's own consents and documents, which are never inherited. These rows
  // show the same things the server checks, so a green table means a done step.
  const consentReasons = ["Privacy practices consent is missing", "Healthcare consent is missing"];
  // A consent given in the cabinet counts like the toggle (server readiness).
  const privacyConsentGiven = Boolean(draft?.privacyConsent) || cabinetConsents.privacy;
  const healthcareConsentGiven = Boolean(draft?.healthcareConsent) || cabinetConsents.healthcare;
  const missingConsentField = draft && !privacyConsentGiven ? PRIVACY_CONSENT_ID : draft && !healthcareConsentGiven ? HEALTHCARE_CONSENT_ID : null;
  const requestReviewRows: RequestReviewRow[] = draft && lead ? [
    {
      key: "request:consents",
      label: tx("Согласия в этом обращении", "Einwilligungen in dieser Anfrage"),
      ready: !missingConsentField,
      // The status names exactly what is still unticked: "not ticked" only
      // when neither consent is (QA 2026-10-12 B3-01).
      status: requestConsentStatus(privacyConsentGiven, healthcareConsentGiven, tx),
      detail: [
        `${tx("Согласие на обработку запроса", "Einwilligung zur Bearbeitung der Anfrage")}: ${cabinetConsents.privacy ? tx("да (кабинет)", "ja (Kundenkabinett)") : draft.privacyConsent ? tx("да (на бумаге)", "ja (Papier)") : tx("нет", "nein")}`,
        `${tx("Медицинские данные", "Gesundheitsdaten")}: ${cabinetConsents.healthcare ? tx("да (кабинет)", "ja (Kundenkabinett)") : draft.healthcareConsent ? tx("да", "ja") : tx("нет", "nein")}`,
      ].join(" · "),
      action: missingConsentField ? {
        label: tx("Отметить согласия", "Einwilligungen bestätigen"),
        onClick: () => openValidationIssue({ key: "request-consents", step: "documents", message: readinessReasonLabel(missingConsentField === PRIVACY_CONSENT_ID ? consentReasons[0] : consentReasons[1], tx), fieldId: missingConsentField }),
      } : undefined,
    },
    ...leadOpenBlockingReasons(lead.readiness, lead.qualification_status)
      .filter((reason) => readinessReasonStep(reason) === "documents" && !consentReasons.includes(reason))
      .map((reason): RequestReviewRow => ({
        key: `request:${reason}`,
        label: tx("В этом обращении", "In dieser Anfrage"),
        ready: false,
        status: readinessReasonText(reason, tx, draftIsMinor, lead.readiness),
        detail: "—",
        action: { label: tx("Исправить", "Beheben"), onClick: () => openReadinessReason(reason) },
      })),
  ] : [];
  const patientDocumentReview = repeatPatientId ? <>
    {patientReview.error ? <Banner tone="error"><p>{tx("Не удалось проверить документы пациента", "Patientendokumente konnten nicht geprüft werden")}: {patientReview.error}</p><Button type="button" variant="default" size="sm" onClick={() => void patientReview.refresh().catch(() => undefined)}>{tx("Повторить", "Erneut versuchen")}</Button></Banner> : null}
    {patientReview.loading ? <p role="status" className="text-xs text-muted-foreground">{tx("Проверка документов пациента…", "Patientendokumente werden geprüft…")}</p> : null}
    {patientReview.readiness ? <OrderPatientDocumentReview readiness={patientReview.readiness} documents={[...patientReview.documents, ...documents]} dateTo={draft?.programDateTo || null} lang={lang} busy={isBusy || patientReview.loading} requestRows={requestReviewRows}
      onRefresh={() => void Promise.all([patientReview.refresh(), refreshLeadState()]).catch(showWizardError)}
      onOpenDocuments={() => { setStep("documents"); window.requestAnimationFrame(() => document.getElementById(CONFIDENTIALITY_RELEASE_ID)?.focus()); }}
      onSaveExpiry={async expiry => { setBusy("passport-expiry"); setError(""); try { return await patientReview.saveExpiry(expiry); } catch (cause) { showWizardError(cause); return false; } finally { setBusy(null); } }} /> : null}
  </> : null;
  // Contracts signed in this request stay lead-owned until the request is
  // completed, so the patient list alone would hide them.
  const reviewContracts = [...contracts.filter((item) => item.lead_id && !patientReview.contracts.some((known) => known.id === item.id)), ...patientReview.contracts];
  const patientContractReview = repeatPatientId && draft ? <Section title={tx("Сохранённые договоры пациента", "Gespeicherte Patientenverträge")}>
    {periodWarningBanner ? <div className="mb-3">{periodWarningBanner}</div> : null}
    <OrderExistingContractsTable contracts={reviewContracts} selectedId={contract?.id ?? null} lang={lang} busy={isBusy || patientReview.loading}
      onSelect={id => { if (reviewContracts.some(item => item.id === id)) setDraft(current => current ? { ...current, frameworkContractId: id } : current); }} />
    {inheritedContract ? <Button type="button" size="sm" variant="default" disabled={isBusy} onClick={() => setDraft(current => current ? { ...current, frameworkContractId: "" } : current)}>{tx("Оформить договор для этого обращения", "Vertrag für diese Anfrage erstellen")}</Button> : null}
  </Section> : null;
  // "Кто платит" in the documents step; its own interest and source of funds
  // are edited in the AML form (owner 2026-10-19). With `amlPartOnly` only
  // that part, for the AML form opened from another step (one instance on
  // the page at any time, so no input is doubled).
  const renderPayerDeclarationSection = (amlPartOnly: boolean) => leadId && draft ? (
    <LeadPayerDeclarationSection
      leadId={leadId}
      data={payer.data}
      loading={payer.loading}
      loadError={payer.error}
      disabled={isBusy}
      canEdit
      lang={lang}
      tx={tx}
      patientMarker={step1Portal.intake?.patient_payer ?? null}
      portalIntake={step1Portal.intake}
      enhancedDetails={step1Portal.intake?.enhanced_details ?? null}
      amlSlot={payerAmlSlot}
      amlPartHidden
      amlPartOnly={amlPartOnly}
      prefill={payerPrefill}
      prefillRepresentative={payerPrefill ? previousPayer.data?.status.payer_representative ?? null : null}
      payerLink={payerLink}
      payerLinkCanEdit={canEditPayerLink}
      leadLanguage={draft.language}
      onPayerLinkSent={() => void payer.reload()}
      // The archived copy of a previous payer's questionnaire opens in the
      // wizard's preview like every other document (map item 95).
      onOpenPayerDocument={(documentId, title) => {
        const document = documents.find((item) => item.id === documentId);
        if (document) void openOrDownloadDocument(document);
        else void downloadDocumentFile(documentId, `${title}.pdf`).catch(showWizardError);
      }}
      registerAutosave={registerPayerAutosave}
      errorText={(nextError) => errorText(nextError, tx)}
      onSave={async (form) => {
        const targetLeadId = leadId;
        const saved = await payer.save(form);
        if (hydrated.current !== targetLeadId) return;
        handleAmlCountryChange({ payerCountries: payerAmlCountries(saved) });
        // Another payer or e-mail clears the payment route the payer stated:
        // "Данные от пациента" is read afresh, not left stale.
        void reloadStep1PortalState();
        await refreshCommercialState().catch(() => undefined);
      }}
    />
  ) : null;
  // The estimate, the prepayment and the lead's update time: the payer package
  // is loaded again when they change in this session (QA 2026-10-25).
  const payerPackageRefreshKey = [
    quote?.id ?? "",
    quote?.status ?? "",
    quote?.updated_at ?? "",
    String(order?.prepayment_required ?? ""),
    order?.prepayment_amount ?? "",
    lead?.updated_at ?? "",
  ].join("|");
  // Client → payer → GMED, with the payer's Kostenübernahmeerklärung; the
  // payer's signature package (phase 3b) has its panel in the commercial step.
  const renderPayerSignatureFlow = (packagePanel: boolean) => leadId ? (
    <LeadPayerSignatureFlow
      leadId={leadId}
      demoChecks={lead?.readiness.demo_onboarding?.credited_checks}
      signatureDocumentId={sortWizardDocumentsNewestFirst(commercialDocuments.single_order)[0]?.id
        ?? (inheritedContract ? undefined : sortWizardDocumentsNewestFirst(commercialDocuments.framework_contract)[0]?.id)}
      status={payer.data?.status ?? null}
      documents={costAssumptionDocuments}
      disabled={isBusy}
      canGenerate
      tx={tx}
      errorText={(nextError) => errorText(nextError, tx)}
      onChanged={() => { void refreshDocumentsState().catch(showWizardError); }}
      payerPackage={{
        panel: packagePanel,
        canEdit: canEditPayerLink,
        refreshKey: payerPackageRefreshKey,
        onState: (state) => setSignatureEnabled(state.signature_enabled),
        onOpenDocument: (documentId, title) => {
          const document = documents.find((item) => item.id === documentId);
          if (document) void openOrDownloadDocument(document);
          else void downloadDocumentFile(documentId, `${title}.pdf`).catch(showWizardError);
        },
        onChanged: () => {
          void reloadPayer();
          void refreshDocumentsState().catch(showWizardError);
        },
      }}
      renderDocuments={(items) => (
        <WizardDocumentRows
          documents={items}
          complianceKind="cost_coverage_declaration"
          emptyLabel=""
          lang={lang}
          busy={busy}
          disabled={isBusy}
          tx={tx}
          onOpen={(document) => void openOrDownloadDocument(document)}
          onDownload={(document) => void downloadDocument(document)}
          onSign={(document, kind) => void signDocument(document.id, kind)}
          onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
          // The signed scan (owner decision 2026-10-11) also changes the payer's state.
          onChanged={() => { void reloadPayer(); void refreshDocumentsState(); }}
        />
      )}
    />
  ) : null;
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const previousStep = STEPS[stepIndex - 1];
  const nextStep = STEPS[stepIndex + 1];
  const commercialReady = Boolean(readiness.get("commercial")) && quoteAndPrepaymentReady;
  const demoSignatureChecks = lead?.readiness.demo_onboarding?.credited_checks ?? [];
  // The conversion qualifies the lead itself: that blocker alone keeps nothing disabled (owner decision 2026-10-23).
  const conversionReady = leadConversionRunnable(lead?.readiness, lead?.qualification_status) && quoteAndPrepaymentReady;
  const visibleCommercialSaveFeedback = commercialSaveFeedback?.followsReadiness
    ? commercialReadinessFeedback(lead?.readiness, tx)
    : commercialSaveFeedback;
  // What staff still have to do: the qualification is no step of its own (the conversion does it).
  const openBlockingReasons = leadOpenBlockingReasons(lead?.readiness, lead?.qualification_status);
  const completionBlockerCount = openBlockingReasons.length
    + (!quoteAndPrepaymentReady && !(lead?.readiness.blocking_reasons ?? []).some((reason) => ["Quote is not accepted", "Required prepayment is not complete"].includes(reason)) ? 1 : 0);
  const isStepReady = (id: string) => {
    // Date of birth and legal sex keep step 1 open even when the patient fills
    // them in the portal (owner 2026-10-26): no tick while either is missing.
    if (id === "master_data") return Boolean(draft && Object.keys(masterErrors).length === 0 && !waitingForPatientData);
    // Nothing in the medical step is required: the reason of the request is
    // optional since 2026-10-19 (owner), as in the server's readiness.
    if (id === "medical") return readiness.get("medical") ?? true;
    // The server's "service" step means the specialties, which staff choose in
    // the order step; the service step itself holds only the optional program
    // period and wishes. Each tab follows what it shows.
    if (id === "service") return Boolean(draft && !orderIssues.some((issue) => issue.step === "service"));
    // The program period is entered with the service history but completes the order too.
    if (id === "order") return Boolean(draft && orderIssues.length === 0);
    if (id === "commercial") return commercialReady;
    if (id === "release") return conversionReady;
    return readiness.get(id) ?? false;
  };
  // The tick of the tab bar: the optional medical tab gets it only when
  // something in it is filled (owner 2026-10-22); empty it stays neutral
  // while the readiness above still counts it as ready.
  const medicalTabFilled = Boolean(draft && medicalStepHasContent({
    ...draft,
    hasMedicalRecords,
    medicalDocumentCount: medicalDocuments.length,
  }));
  // The service step is optional too: its tick needs data (a program period,
  // a requested service, a note); a new lead shows it open (QA 2026-10-25).
  const serviceTabFilled = Boolean(draft && serviceStepHasContent(draft));
  // A converted lead is finished: every step stands as done and read-only, only
  // an optional step left empty says so (QA 2026-10-25, N-3: «Договор и смета —
  // не завершено» on a lead that already is a patient).
  const isStepTicked = (id: StepId) => (
    id === "medical"
      ? medicalTabFilled && (leadConverted || isStepReady(id))
      : id === "service"
        ? serviceTabFilled && (leadConverted || isStepReady(id))
        : leadConverted || isStepReady(id)
  );
  // Why «Подписано на бумаге» would be refused now (409 `*_document_outdated`
  // of the paper signature): the button waits and the reason stands beside
  // it instead of a refusal after the scan (QA 2026-10-25).
  // The server tells per document whether its terms are still current
  // (`terms_current`, documents.rs); a readiness check of the same name is
  // honoured too should one appear. A stale PDF cannot be signed on paper
  // (409 order_document_outdated / estimate_document_outdated).
  const paperSignatureBlocker = (document: Pick<DocumentItem, "generated_template_id" | "terms_current">): string | null => {
    const checks = lead?.readiness.checks ?? [];
    const failing = (key: string) => document.terms_current === false
      || checks.some((check) => check.key === key && !check.passed);
    const template = document.generated_template_id ?? "";
    if (template === "single_order" && failing("order_document_outdated")) {
      return tx("Документ заказа устарел — создайте новую версию и подпишите её", "Einzelauftrag veraltet – neue Version erstellen und unterschreiben lassen");
    }
    if (template === "order_cost_estimate" && failing("estimate_document_outdated")) {
      return tx("Документ сметы создан до последнего изменения сумм или предоплаты — создайте новую версию", "Kostenvoranschlag vor der letzten Änderung von Beträgen oder Vorauszahlung erstellt – neue Version erstellen");
    }
    return null;
  };

  if (!leadId && !createMode) return null;
  const autosaveIsDirty = autosaveStatus === "dirty"
    || autosaveStatus === "saving"
    || autosaveStatus === "error";
  const saveInProgress = isBusy || autosaveStatus === "saving";
  // A create-mode form with typed data and no lead yet: closing it loses that data.
  const createModeUnsaved = createMode && !leadId && !saveInProgress && autosaveIsDirty;
  // «Данные заполнены из записи …» belongs to the creating session; the PEP
  // hint stays until the person answers the PEP question (QA 2026-10-25).
  const sessionPrefill = prefilledFromSource && prefilledFromSource.leadId === (leadId ?? createdLeadId)
    ? prefilledFromSource
    : null;
  const showSourcePepHint = sourcePepHintActive(lead, {
    sessionHint: Boolean(sessionPrefill?.pep),
    pepAnswer: step1Portal.intake?.identification?.pep_self,
  });
  const editingTrustedContact = Boolean(
    trustedContactEditor
    && draft?.trustedContacts.some((contact) => contact.id === trustedContactEditor.id),
  );
  // Who represents the lead, as the server knows it: the sheets of a minor are
  // made per legal representative, an adult's representative and legal
  // guardian get one each beside the adult's, and a contact with GwG data
  // keeps them.
  const portalRepresentation = step1Portal.intake?.representation ?? null;
  // PEP and sanctions answers per person and staff's review per person (owner
  // decision 2026-10-23): the patient, each person who acts for the lead, the
  // third-party payer — never one person's answer for another.
  const amlPayerQuestionnaire = payerLink.data?.questionnaire ?? null;
  const amlPayerSent = amlPayerQuestionnaire && amlPayerQuestionnaire.source !== "cabinet"
    && (amlPayerQuestionnaire.submitted_at || amlPayerQuestionnaire.state === "submitted")
    ? amlPayerQuestionnaire
    : null;
  const amlPayerDeclaration = payer.data?.declaration ?? null;
  const amlPepPersons = draft ? pepPersons({
    fields: draft.amlEnhancedDueDiligence,
    patientName: `${draft.firstName} ${draft.lastName}`,
    patientAnswers: step1Portal.intake?.identification_hidden ? null : step1Portal.intake?.identification ?? null,
    representatives: portalRepresentation?.representatives ?? [],
    // A third-party row of before that names a parent is the parent's card
    // (the server's `paying_parent`), never a second person.
    thirdPartyPayer: amlPayerDeclaration?.payer_kind === "third_party" && payer.data?.status.paying_parent !== true,
    payerName: amlPayerSent?.answers.organisation_name?.trim()
      || [amlPayerSent?.answers.first_name, amlPayerSent?.answers.last_name].filter(Boolean).join(" ")
      || amlPayerDeclaration?.organisation_name?.trim()
      || [amlPayerDeclaration?.first_name, amlPayerDeclaration?.last_name].filter(Boolean).join(" "),
    payerAnswers: amlPayerSent?.answers ?? null,
  }) : [];
  // A representative's own files of one kind (QA 2026-10-10: they sat under
  // "Другие документы"), with who uploaded each — the cabinet or staff.
  const representativeFileRows = (person: LeadRepresentative, kind: RepresentativeUploadKind) => {
    const uploads = kind === "authority" ? person.authority_documents : person.identity_documents;
    const byId = new Map(uploads.map((item) => [item.id, item]));
    const files = documents.filter((item) => byId.has(item.id) && !item.file_deleted_at);
    // A parent who is a patient: the passport of the patient record counts here;
    // it is not one of this lead's documents, so it is named, not managed (DEV 2026-10-27).
    const fromRecord = uploads.filter((item) => item.from_patient_record && !files.some((file) => file.id === item.id));
    if (files.length === 0 && fromRecord.length === 0) return null;
    return (
      <>
      {fromRecord.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm" data-testid="representative-file-from-patient-record">
          <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-all">{item.file_name || tx("Документ", "Dokument")}</span>
          <StatusChip tone="success">{tx("Из карточки пациента", "Aus der Patientenakte")}</StatusChip>
        </div>
      ))}
      {files.length > 0 ? <WizardDocumentRows
        documents={files}
        emptyLabel=""
        lang={lang}
        busy={busy}
        disabled={isBusy}
        tx={tx}
        onOpen={(document) => void openOrDownloadDocument(document)}
        onDownload={(document) => void downloadDocument(document)}
        onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
        onChanged={() => { void refreshDocumentsState(); }}
        documentNote={(document) => {
          const upload = byId.get(document.id);
          return upload ? <StatusChip tone="warning">{representativeFileOrigin(upload, tx)}</StatusChip> : null;
        }}
      /> : null}
      </>
    );
  };
  const afterRepresentativeUpload = () => {
    void reloadStep1PortalState();
    void risk.controller.reload();
    void refreshDocumentsState();
  };
  const gwgDataContactIds = new Set(
    (portalRepresentation?.representatives ?? []).flatMap((person) => (person.has_data ? [person.id] : [])),
  );
  const gwgSheets = gwgSheetPlan({
    minor: identification.status?.minor
      ?? step1Portal.intake?.minor
      ?? (draft ? isMinor(draft.birthDate, new Date()) : false),
    representatives: identification.status
      ? identification.status.representatives
      // Before the status answers: the persons who act for the child, as the server lists them.
      : (portalRepresentation?.representatives ?? []).filter((person) => person.slot !== null).map((person) => ({
          id: person.id,
          name: representativeName(person),
        })),
    actingPersons: adultActingPersons(portalRepresentation?.representatives).map((person) => ({
      id: person.id,
      name: representativeName(person),
    })),
    payer: payer.data?.declaration,
    payerSamePersonName: payerSamePerson(identification.status)?.name ?? null,
    payerSamePersonUnknown: !identification.loaded,
  });
  if (purgedByRetention) {
    // Nothing is left to save or to show: only the notice and the way out.
    return (
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onOpenChange(false); }}>
        <DialogContent className="max-w-md" data-testid="lead-wizard-purged">
          <DialogHeader>
            <DialogTitle>{leadPurgedTitle(lang === "de" ? "de" : "ru")}</DialogTitle>
            <DialogDescription>{leadPurgedText(lang === "de" ? "de" : "ru")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {tx("Закрыть", "Schließen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  // Where a refused paper signature leads: the payer's section, the risk
  // assessment or the person's card (DEV 2026-10-27).
  const signatureErrorJump: WizardSignatureJump = (error) => {
    if (error instanceof ApiRequestError && error.body?.error === "payer_gate_blocked") {
      const reasons = Array.isArray(error.body.reasons) ? error.body.reasons : [];
      if (reasons.length === 1 && reasons[0] === "client_order_signature_missing") return null;
      return {
        label: goToPayerLabel,
        onClick: () => openValidationIssue({ key: "payer-declaration", step: "documents", message: "", fieldId: PAYER_SECTION_ID }),
      };
    }
    if (riskGateRefusal(error)) {
      return {
        label: tx("Перейти к оценке риска", "Zur Risikobewertung"),
        onClick: () => openValidationIssue({ key: "risk-assessment", step: "documents", message: "", fieldId: RISK_ASSESSMENT_SECTION_ID }),
      };
    }
    const slot = representativeDocumentSlot(error);
    const focus = representativeDocumentFocus(error);
    const representativeId = slot && slot !== "patient"
      ? step1Portal.intake?.representation?.representatives.find((person) => person.slot === slot)?.id ?? null
      : null;
    if (slot === "patient" || representativeId) {
      return {
        label: focus === "authority" && representativeId
          ? tx("Загрузить подтверждение полномочий", "Vertretungsnachweis hochladen")
          : tx("Перейти к данным документа", "Zu den Ausweisdaten"),
        onClick: () => openRepresentativeIdData(representativeId ?? "patient", representativeId ? focus : null),
      };
    }
    return null;
  };

  return (
    <WizardSignatureJumpContext.Provider value={signatureErrorJump}>
    <WizardDocumentRowErrorProvider value={documentRowError}>
    <PortalUploadsProvider
      intake={step1Portal.intake}
      canReview={canReviewPortalUploads}
      onReviewed={reloadStep1Portal}
    >
      <Dialog
        open={open}
        modal={!documentPreview}
        // Pending edits are saved on close (below); only a save that failed asks
        // before discarding — and a new lead not created yet, whose typed data
        // nothing can save on close (QA 2026-10-25, F-W1/F-G8: Escape or a click
        // outside lost the whole form without a question).
        dirty={(!saveInProgress && autosaveStatus === "error") || createModeUnsaved}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && saveInProgress) {
            details.cancel();
            return;
          }
          if (!nextOpen) {
            details.cancel();
            const targetLeadId = leadId;
            // A pick made just before Escape (a second specialisation, a
            // checkbox) is saved first, not lost with the close (QA 2026-10-25).
            const pendingDraft = Boolean(targetLeadId) && !leadConverted && autosaveIsDirty;
            void (async () => {
              if (!(await flushPayerAutosave())) return;
              if (pendingDraft && !(await save(step, false))) return;
              if (activePayerLeadIdRef.current === targetLeadId
                && (hydrated.current === targetLeadId || (!targetLeadId && hydrated.current === "__new__"))) {
                onOpenChange(false);
              }
            })();
            return;
          }
          onOpenChange(nextOpen);
        }}
      >
      <DialogContent
        overlayClassName="bg-black/40"
        showOverlay={!documentPreview}
        showCloseButton={!saveInProgress}
        className="flex h-[94vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-clip rounded-lg p-0 [&_dt]:font-mono [&_[data-wizard-field-label]]:font-mono sm:h-[min(96vh,68rem)] sm:w-[91vw] sm:max-w-[91vw] sm:pb-0"
      >
        <DialogTitle className="sr-only">{tx("Оформление обращения", "Lead-Aufnahme")}</DialogTitle>
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 pr-14 sm:gap-4 sm:px-5 sm:pr-14">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-base font-semibold text-foreground">
                {lead
                  ? leadDisplayName(lead, tx)
                  : existingPatient
                    ? [existingPatient.first_name, existingPatient.last_name].filter(Boolean).join(" ")
                  : createMode
                    ? tx("Новый лид", "Neuer Lead")
                    : tx("Оформление обращения", "Lead-Aufnahme")}
              </h2>
              {/* The countdown sits after the name: date, days left and what stops it (2026-10-23); the rule is in the tooltip. */}
              {retentionDays != null && retentionDeadline ? (
                <StatusChip
                  role="status"
                  data-lead-retention-countdown
                  title={retentionCountdownHint(lang)}
                  tone={retentionDays <= 3 ? "error" : "warning"}
                  className="shrink-0"
                >
                  <CircleAlert aria-hidden="true" className="size-3.5" />
                  {withFinalPeriod(retentionDeadlineNotice(retentionDeadline, retentionDays, lang))}
                </StatusChip>
              ) : null}
            </div>
            {isRepeatIntake ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {tx("Повторное обращение", "Erneute Anfrage")}
                {repeatPatientNumber ? ` · ${repeatPatientNumber}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {leadId && lead && ["new", "in_progress", "qualified"].includes(lead.qualification_status) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                disabled={loading || isBusy}
                onClick={openNotQualified}
              >
                {tx("Не подходит", "Nicht geeignet")}
              </Button>
            ) : null}
            {leadId && lead && ["not_qualified", "archived"].includes(lead.qualification_status) ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-8"
                disabled={loading || isBusy}
                onClick={() => {
                  if (!leadId) return;
                  void updateLeadStatus(leadId, "in_progress")
                    .then(() => refreshLeadState())
                    .catch((error) => setError(errorText(error, tx)));
                }}
              >
                {tx("Вернуть в работу", "Zurück in Bearbeitung")}
              </Button>
            ) : null}
            {/* An archived or deleted lead cannot be archived again (QA 2026-10-11, N-17). */}
            {leadId && !(lead && (
              ["archived", "deleted"].includes(lead.qualification_status)
              || (lead.failed_outcome?.status ?? "none") !== "none"
              || isConvertedLead(lead)
            )) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                title={tx("Архивировать обращение", "Lead archivieren")}
                aria-label={tx("Архивировать обращение", "Lead archivieren")}
                disabled={loading || isBusy}
                onClick={() => setArchiveConfirmOpen(true)}
              >
                <Archive aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            {onShowDetails && leadId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={tx("Подробности обращения", "Lead-Details")}
                aria-label={tx("Подробности обращения", "Lead-Details")}
                disabled={loading || isBusy}
                onClick={() => onShowDetails(leadId)}
              >
                <Eye aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            {leadId ? (
              <Button type="button" variant="outline" size="icon-sm" title={tx("Обновить", "Aktualisieren")} aria-label={tx("Обновить", "Aktualisieren")} disabled={loading || isBusy} onClick={() => void Promise.all([reload(true, false, false, true), patientReview.refresh()]).catch(showWizardError)}>
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            ) : null}
          </div>
        </header>

        <nav
          ref={stepNavRef}

          className="shrink-0 overflow-x-auto overscroll-x-contain border-b border-border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={tx("Этапы оформления", "Schritte der Lead-Aufnahme")}
        >
          <div className="flex w-max min-w-full justify-center px-4 py-2.5">
            <div ref={stepTabsRef} className="t-tabs lead-wizard-step-tabs" role="tablist">
              <span ref={stepPillRef} className="t-tabs-pill lead-wizard-step-pill" aria-hidden="true" />
              {STEPS.map((item, itemIndex) => {
                const selected = item.id === step;
                const done = isStepTicked(item.id);
                const optionalEmpty = (item.id === "medical" || item.id === "service") && !done && (leadConverted || isStepReady(item.id));
                const StepIcon = STEP_ICONS[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`lead-wizard-tab-${item.id}`}
                    aria-controls="lead-wizard-step-panel"
                    tabIndex={selected ? 0 : -1}
                    data-step={item.id}
                    disabled={loading || isBusy}
                    onClick={() => navigateToStep(item.id)}
                    onKeyDown={(event) => {
                      const targetIndex = event.key === "ArrowRight" ? (itemIndex + 1) % STEPS.length
                        : event.key === "ArrowLeft" ? (itemIndex + STEPS.length - 1) % STEPS.length
                          : event.key === "Home" ? 0
                            : event.key === "End" ? STEPS.length - 1
                              : null;
                      if (targetIndex === null) return;
                      event.preventDefault();
                      stepTabsRef.current?.querySelector<HTMLElement>(`[data-step="${STEPS[targetIndex].id}"]`)?.focus();
                    }}
                    aria-selected={selected}
                    aria-current={selected ? "step" : undefined}
                    className="t-tab lead-wizard-step-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <StepIcon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="whitespace-nowrap">{item.id === "documents" && isRepeatIntake ? tx("Проверка документов", "Dokumentenprüfung") : item.id === "release" && isRepeatIntake
                      ? tx("Завершение обращения", "Anfrage abschließen")
                      : lang === "de" ? item.de : item.ru}</span>
                    <span
                      aria-hidden="true"
                      data-count
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none",
                        selected
                          ? "bg-white/20 text-white"
                          : done
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <Check aria-hidden="true" className="size-3" /> : itemIndex + 1}
                    </span>
                    <span className="sr-only">{done
                      ? tx(" — выполнено", " — erledigt")
                      : optionalEmpty
                        ? tx(" — необязательно, не заполнено", " — optional, nicht ausgefüllt")
                        : tx(" — не завершено", " — noch offen")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <main ref={stepPanelRef} id="lead-wizard-step-panel" role="tabpanel" aria-labelledby={`lead-wizard-tab-${step}`} tabIndex={-1} aria-busy={loading || isBusy} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-scroll overscroll-contain bg-muted px-3 py-4 outline-none [scrollbar-gutter:stable] sm:px-5 sm:py-5">
          <SanctionsLeadBanner leadId={leadId} refreshKey={lead} className="mb-5" />
          {leadConverted ? (
            <div
              role="status"
              data-testid="lead-converted-banner"
              className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100"
            >
              <UserRoundCheck aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{tx("Пациент создан", "Patient angelegt")}</span>
                {convertedPatient && (convertedPatient.name || convertedPatient.number)
                  ? `: ${[convertedPatient.name, convertedPatient.number].filter(Boolean).join(", ")}`
                  : ""}
                {" — "}
                {tx(
                  "данные обращения только для чтения; изменения вносятся в карточке пациента.",
                  "die Angaben sind nur noch lesbar; Änderungen erfolgen in der Patientenakte.",
                )}
              </span>
              {lead?.converted_patient_id ? (
                <StaffLink
                  to={`/patients/${encodeURIComponent(lead.converted_patient_id)}`}
                  className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
                  data-testid="lead-converted-open-patient"
                  onClick={() => onOpenChange(false)}
                >
                  {tx("Открыть карточку пациента", "Patientenakte öffnen")}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </StaffLink>
              ) : null}
            </div>
          ) : null}
          {/* Read-only for a converted lead: every control inside is off, the tabs above stay (QA 2026-10-25). */}
          <fieldset disabled={leadConverted} aria-readonly={leadConverted || undefined} data-readonly={leadConverted ? "true" : undefined} className="m-0 min-w-0 border-0 p-0">
          {/* The fieldset turns native controls off; the scope turns off the shared
              ones it cannot reach (date pickers, lists in portals) — QA 2026-10-25, F-W8. */}
          <ReadOnlyScope active={leadConverted} banner={false}>
          {validationIssues.length > 0 ? (
            <div role="alert" aria-live="assertive" className="mb-5">
              <Banner tone="error">
                <div className="flex items-center gap-2 font-medium">
                  <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                  {tx("Требуют внимания", "Bitte prüfen")}
                </div>
                <ul className="mt-2 space-y-1.5">
                  {validationIssues.map((issue) => (
                    <li key={issue.key}>
                      <button
                        type="button"
                        className="w-full text-left text-xs leading-5 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openValidationIssue(issue)}
                      >
                        <span className="font-medium">{readinessStepLabel(issue.step, tx, isRepeatIntake)}:</span>{" "}
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          ) : null}
          {loading && !lead ? <div role="status" aria-live="polite" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</div> : null}

          {draft && step === "master_data" ? (
            <section className="min-w-0 space-y-5">
              {sessionPrefill?.notice || showSourcePepHint ? (
                <div
                  data-testid="lead-prefilled-from-source"
                  className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/30 px-3.5 py-3 text-xs leading-5 text-muted-foreground"
                >
                  {sessionPrefill?.notice ? (
                    <p className="text-foreground">
                      {sessionPrefill.notice}
                      {" "}
                      {tx("Проверьте и при необходимости исправьте.", "Bitte prüfen und bei Bedarf korrigieren.")}
                    </p>
                  ) : null}
                  {showSourcePepHint ? (
                    <StatusChip tone="warning" data-testid="lead-source-pep-hint">
                      <CircleAlert aria-hidden="true" />
                      <span>{sourcePepHintText(tx)}</span>
                    </StatusChip>
                  ) : null}
                </div>
              ) : null}
              {lead ? (
                <Section title={tx("Данные опросника", "Fragebogendaten")}>
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Тип", "Typ"), value: <StatusBadge tone={intakeTypeTone(lead)}>{intakeTypeLabel(lead, tx)}</StatusBadge> },
                    { label: tx("Канал поступления", "Eingangskanal"), value: lead.source ? leadSourceLabel(lead.source, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Тип формы", "Formulartyp"), value: intakeFlowLabel(lead.flow, tx) },
                    ...(isExternalIntakeLead ? [{
                      label: tx("Язык заполнения", "Eingabesprache"),
                      value: normalizedLanguageCode(lead.locale)
                        ? languageLabel(normalizedLanguageCode(lead.locale), lang)
                        : lead.locale || tx("Не указано", "Nicht angegeben"),
                    }] : []),
                    ...(isExternalIntakeLead ? [
                      { label: tx("Тип основного телефона", "Typ der Hauptnummer"), value: phoneTypeLabel(lead.primary_phone_type, tx) },
                      ...(lead.phones?.length
                        ? lead.phones.map((item, index, all) => ({
                            label: all.length > 1
                              ? `${tx("Телефон из опросника", "Telefon aus dem Fragebogen")} ${index + 1}`
                              : tx("Телефон из опросника", "Telefon aus dem Fragebogen"),
                            value: `${item.number} · ${phoneTypeLabel(item.type, tx)}`,
                          }))
                        : [{
                            label: tx("Телефоны из опросника", "Telefonnummern aus dem Fragebogen"),
                            value: tx("Не указано", "Nicht angegeben"),
                          }]),
                    ] : []),
                    ...(lead.message ? [{
                      label: tx("Комментарий клиента", "Kundennachricht"),
                      value: (
                        <span className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 font-normal text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                          <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <span className="min-w-0 whitespace-pre-wrap break-words">{lead.message}</span>
                        </span>
                      ),
                      wide: true,
                    }] : []),
                  ]}
                />
                </Section>
              ) : null}
              <Step1PortalProvider
                mode={step1Portal.mode}
                intake={step1Portal.intake}
                errorIdByDraftKey={STEP1_PORTAL_ERROR_IDS}
                patientFilledKeys={PATIENT_FILLED_KEYS}
                portalFieldByDraftKey={PORTAL_FIELD_BY_DRAFT_KEY}
                filledDraftKeys={step1FilledDraftKeys}
                tx={tx}
              >
              <Section
                title={isMinor(draft.birthDate, new Date()) ? tx("Личные данные ребёнка", "Persönliche Daten des Kindes") : tx("Личные данные", "Persönliche Daten")}
                accessory={isRepeatIntake ? null : (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Everything the client fills in, staff fill in too: the client's own form (owner 2026-10-29). */}
                    {leadId && !leadConverted ? (
                      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" data-testid="lead-wizard-client-form"
                        onClick={() => window.open(`/leads/${encodeURIComponent(leadId)}/client-form`, "_blank", "noopener")}>
                        <FileText className="size-3.5" />
                        {tx("Заполнить анкету за клиента", "Formular für den Kunden ausfüllen")}
                      </Button>
                    ) : null}
                    <Step1FillModeSwitch mode={step1Portal.mode} onChange={step1Portal.setMode} disabled={isBusy} tx={tx} />
                  </div>
                )}
              >
              {step1Portal.modeFailed && !isRepeatIntake ? (
                <p role="alert" className="mb-3 text-xs font-medium text-destructive" data-testid="step1-fill-mode-error">
                  {tx("Выбор «кто заполняет» не сохранён. Попробуйте ещё раз.", "Die Auswahl, wer ausfüllt, wurde nicht gespeichert. Bitte erneut versuchen.")}
                </p>
              ) : null}
              {step1Portal.patientUpdatedAt ? (
                <PatientUpdatedBanner at={step1Portal.patientUpdatedAt} onClose={step1Portal.dismissPatientUpdate} tx={tx} />
              ) : null}
              {isRepeatIntake ? null : <Step1PortalSummary intake={step1Portal.intake} mode={step1Portal.mode} tx={tx} />}
              {masterOpenIssues.length > 0 && validationContext?.kind !== "master" && !masterValidationAttempted ? (
                // The fields the stepper counts as open, named here (A-4); "Показать
                // поля" marks each of them and leads to the first.
                <div
                  role="status"
                  data-testid="lead-master-data-open-fields"
                  className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{tx("Шаг не завершён. ", "Schritt noch offen. ")}</span>
                    {masterOpenIssues.map((issue) => issue.message).join(" · ")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0"
                    disabled={isBusy}
                    onClick={() => {
                      setValidationContext({ kind: "master" });
                      setMasterValidationAttempted(true);
                      const firstFieldId = masterOpenIssues.find((issue) => issue.fieldId)?.fieldId;
                      if (firstFieldId) {
                        window.requestAnimationFrame(() => {
                          document.getElementById(firstFieldId)?.focus();
                        });
                      }
                    }}
                  >
                    {tx("Показать поля", "Felder anzeigen")}
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                {intakeAsksDiscoverySource(isRepeatIntake) ? (
                // A row of its own: the person's fields below pair up (first | last name, street | postal code).
                <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
                  <Field label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")} htmlFor={STEP1_CONTROL_IDS.discoverySource}>
                    <NativeComboboxSelect
                      id={STEP1_CONTROL_IDS.discoverySource}
                      aria-label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")}
                      name="discovery_source"
                      value={draft.discoverySource}
                      onChange={(event) => changeDiscoverySource(event.target.value)}
                      className={selectClass}
                    >
                      <option value="">{tx("Выберите источник", "Quelle auswählen")}</option>
                      {draft.discoverySource && !DISCOVERY_SOURCE_OPTIONS.some((option) => option.value === draft.discoverySource) ? (
                        <option value={draft.discoverySource}>
                          {tx("Текущее значение", "Aktueller Wert")}: {draft.discoverySource}
                        </option>
                      ) : null}
                      {DISCOVERY_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {lang === "de" ? option.de : option.ru}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  {draft.discoverySource === "customer_referral" ? (
                    <Field
                      label={tx("Рекомендовавший клиент", "Empfehlender Kunde")}
                      required
                      error={visibleMasterError("referrerPatientId")}
                      errorId={`${MASTER_FIELD_IDS.referrerPatientId}-error`}
                      htmlFor={MASTER_FIELD_IDS.referrerPatientId}
                    >
                      <NativeComboboxSelect
                        id={MASTER_FIELD_IDS.referrerPatientId}
                        name="referrer_patient_id"
                        value={draft.referrerPatientId}
                        required
                        aria-invalid={Boolean(visibleMasterError("referrerPatientId"))}
                        aria-describedby={visibleMasterError("referrerPatientId")
                          ? `${MASTER_FIELD_IDS.referrerPatientId}-error`
                          : undefined}
                        className={cn(selectClass, visibleMasterError("referrerPatientId") && "border-destructive")}
                        searchPlaceholder={tx("Найти клиента по имени или PID", "Kunde nach Name oder PID suchen")}
                        onSearchChange={setReferrerSearch}
                        missingValueLabel={() => draft.referrerPatientLabel || draft.referrerPatientId}
                        onBlur={() => touchMasterField("referrerPatientId")}
                        onChange={(event) => changeReferrerPatient(event.target.value)}
                      >
                        <option value="">{tx("Выберите клиента", "Kunden auswählen")}</option>
                        {/* Filtered by what is typed now, whatever the server answered last (QA 2026-10-11, N-16). */}
                        {filterPatientsBySearch(referrerPatients, referrerSearch).map((patient) => (
                          <option key={patient.id} value={patient.id} data-search-text={patientSearchText(patient)}>
                            {referrerPatientOptionLabel(patient)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                      <p className={cn(
                        "mt-1.5 text-[11.5px] leading-tight",
                        referrerPatientsError ? "text-destructive" : "text-muted-foreground",
                      )}>
                        {referrerPatientsError
                          || (referrerPatientsLoading
                            ? tx("Загрузка клиентов…", "Kunden werden geladen…")
                            : tx(
                                "Связь сохранится для статистики клиентских рекомендаций.",
                                "Die Verknüpfung wird für die Statistik der Kundenempfehlungen gespeichert.",
                              ))}
                      </p>
                    </Field>
                  ) : null}
                  {draft.discoverySource === "other" ? (
                    <Field label={tx("Укажите источник", "Andere Quelle angeben")} htmlFor={STEP1_CONTROL_IDS.discoverySourceOther}>
                      <Input
                        id={STEP1_CONTROL_IDS.discoverySourceOther}
                        name="discovery_source_other"
                        autoComplete="off"
                        className={inputClass}
                        value={draft.discoverySourceOther}
                        placeholder={tx("Введите источник вручную", "Quelle manuell eingeben")}
                        onChange={(event) => patch("discoverySourceOther", event.target.value)}
                      />
                    </Field>
                  ) : null}
                </div>
                ) : null}
                <Field
                  label={tx("Имя", "Vorname")}
                  required
                  error={visibleMasterError("firstName")}
                  errorId={`${MASTER_FIELD_IDS.firstName}-error`}
                  htmlFor={MASTER_FIELD_IDS.firstName}
                >
                  <Input
                    id={MASTER_FIELD_IDS.firstName}
                    name="first_name"
                    autoComplete="given-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("firstName"))}
                    aria-describedby={visibleMasterError("firstName") ? `${MASTER_FIELD_IDS.firstName}-error` : undefined}
                    className={inputClass}
                    value={draft.firstName}
                    onBlur={() => touchMasterField("firstName")}
                    onChange={(event) => patch("firstName", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Фамилия", "Nachname")}
                  required
                  error={visibleMasterError("lastName")}
                  errorId={`${MASTER_FIELD_IDS.lastName}-error`}
                  htmlFor={MASTER_FIELD_IDS.lastName}
                >
                  <Input
                    id={MASTER_FIELD_IDS.lastName}
                    name="last_name"
                    autoComplete="family-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("lastName"))}
                    aria-describedby={visibleMasterError("lastName") ? `${MASTER_FIELD_IDS.lastName}-error` : undefined}
                    className={inputClass}
                    value={draft.lastName}
                    onBlur={() => touchMasterField("lastName")}
                    onChange={(event) => patch("lastName", event.target.value)}
                  />
                </Field>
                <Field label={tx("Отчество / второе имя", "Zweiter Vorname")} portalField="middle_name" htmlFor={STEP1_CONTROL_IDS.middleName}>
                  <Input
                    id={STEP1_CONTROL_IDS.middleName}
                    className={inputClass}
                    name="middle_name"
                    autoComplete="additional-name"
                    value={draft.middleName}
                    onChange={(event) => patch("middleName", event.target.value)}
                  />
                </Field>
                <Field label={tx("Дополнение к имени", "Namenszusatz")} htmlFor={STEP1_CONTROL_IDS.suffix}>
                  <Input
                    id={STEP1_CONTROL_IDS.suffix}
                    className={inputClass}
                    name="name_suffix"
                    value={draft.suffix}
                    onChange={(event) => patch("suffix", event.target.value)}
                  />
                </Field>
                <SanctionsLiveCheckNotice
                  className="md:col-span-2 -mt-2"
                  input={liveCheckInput({
                    firstName: draft.firstName,
                    lastName: draft.lastName,
                    middleName: draft.middleName,
                    birthDate: draft.birthDate,
                    citizenships: draft.citizenships,
                    leadId,
                  })}
                  saved={!autosaveIsDirty}
                />

                <Field
                  label={tx("Дата рождения", "Geburtsdatum")}
                  required
                  error={birthDateError}
                  errorId={`${MASTER_FIELD_IDS.birthDate}-error`}
                  htmlFor={MASTER_FIELD_IDS.birthDate}
                >
                  <Input
                    id={MASTER_FIELD_IDS.birthDate}
                    name="birth_date"
                    autoComplete="bday"
                    type="date"
                    min={EARLIEST_BIRTH_DATE}
                    max={appDateKey()}
                    onPickerValidation={setBirthDateEntryError}
                    required
                    aria-invalid={Boolean(birthDateError)}
                    aria-describedby={birthDateError ? `${MASTER_FIELD_IDS.birthDate}-error` : undefined}
                    className={inputClass}
                    value={draft.birthDate}
                    onBlur={() => touchMasterField("birthDate")}
                    onChange={(event) => patch("birthDate", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Пол согласно документам", "Geschlecht laut Ausweisdokument")}
                  required
                  error={visibleMasterError("legalSex")}
                  errorId={`${MASTER_FIELD_IDS.legalSex}-error`}
                  htmlFor={MASTER_FIELD_IDS.legalSex}
                >
                  <NativeComboboxSelect
                    id={MASTER_FIELD_IDS.legalSex}
                    name="legal_sex"
                    value={draft.legalSex}
                    required
                    aria-invalid={Boolean(visibleMasterError("legalSex"))}
                    aria-describedby={visibleMasterError("legalSex") ? `${MASTER_FIELD_IDS.legalSex}-error` : undefined}
                    onBlur={() => touchMasterField("legalSex")}
                    onChange={(event) => patch("legalSex", event.target.value)}
                    className={cn(selectClass, visibleMasterError("legalSex") && "border-destructive")}
                  >
                    {legalSexOptionElements(tx)}
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label="E-Mail"
                  required={isRepeatIntake ? !draft.phone.trim() : !minorEmailOptional(draft)}
                  error={visibleMasterError("email")}
                  errorId={`${MASTER_FIELD_IDS.email}-error`}
                  htmlFor={MASTER_FIELD_IDS.email}
                >
                  <Input
                    id={MASTER_FIELD_IDS.email}
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    type="email"
                    aria-required={isRepeatIntake ? !draft.phone.trim() : !minorEmailOptional(draft)}
                    aria-invalid={Boolean(visibleMasterError("email"))}
                    aria-describedby={[
                      visibleMasterError("email") ? `${MASTER_FIELD_IDS.email}-error` : "",
                      !isRepeatIntake && minorEmailOptional(draft) ? `${MASTER_FIELD_IDS.email}-minor-hint` : "",
                    ].filter(Boolean).join(" ") || undefined}
                    className={inputClass}
                    value={draft.email}
                    onBlur={() => touchMasterField("email")}
                    onChange={(event) => patch("email", event.target.value)}
                  />
                  {visibleMasterError("email") ? null : <EmailDomainWarning email={draft.email} lang={lang} />}
                  {!isRepeatIntake && minorEmailOptional(draft) ? (
                    // Read as the field's description, not as part of its name.
                    <span
                      id={`${MASTER_FIELD_IDS.email}-minor-hint`}
                      aria-hidden="true"
                      className="block text-[11px] leading-4 text-muted-foreground"
                      data-testid="lead-wizard-minor-email-hint"
                    >
                      {tx(
                        "Для несовершеннолетнего необязательно: у ребёнка нет своего доступа, родители получают свой",
                        "Für Minderjährige optional: Das Kind hat keinen eigenen Zugang, die Eltern erhalten ihren",
                      )}
                    </span>
                  ) : null}
                </Field>
                <Field
                  label={tx("Телефон", "Telefon")}
                  required={isRepeatIntake && !draft.email.trim()}
                  error={visibleMasterError("phone")}
                  errorId={`${MASTER_FIELD_IDS.phone}-error`}
                  htmlFor={MASTER_FIELD_IDS.phone}
                >
                  <Input
                    id={MASTER_FIELD_IDS.phone}
                    name="phone"
                    autoComplete="tel"
                    type="tel"
                    aria-required={isRepeatIntake && !draft.email.trim()}
                    aria-invalid={Boolean(visibleMasterError("phone"))}
                    aria-describedby={visibleMasterError("phone") ? `${MASTER_FIELD_IDS.phone}-error` : undefined}
                    className={inputClass}
                    value={draft.phone}
                    onBlur={() => touchMasterField("phone")}
                    onChange={(event) => patch("phone", event.target.value)}
                  />
                </Field>
                <Field label="WhatsApp" htmlFor={STEP1_CONTROL_IDS.whatsapp}>
                  <Input
                    id={STEP1_CONTROL_IDS.whatsapp}
                    className={inputClass}
                    name="whatsapp_number"
                    autoComplete="tel"
                    type="tel"
                    value={draft.whatsappNumber}
                    onChange={(event) => patch("whatsappNumber", event.target.value)}
                  />
                </Field>
                <Field label={tx("Предпочитаемый язык", "Bevorzugte Sprache")} portalField="primary_language" htmlFor={STEP1_CONTROL_IDS.language}>
                  <NativeComboboxSelect id={STEP1_CONTROL_IDS.language} name="primary_language" value={draft.language} className={selectClass} onChange={(event) => patch("language", event.target.value)}>
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    {/* Only languages with a name in the UI language; a stored code without one stays visible. */}
                    {/* The languages GMED serves (owner 2026-10-29); a stored other language stays visible. */}
                    {draft.language && !preferredLanguageOptions(LANGUAGE_OPTIONS, draft.language).some((item) => item.value === draft.language) ? <option value={draft.language}>{draft.language}</option> : null}
                    {preferredLanguageOptions(LANGUAGE_OPTIONS, draft.language).map((item) => <option key={item.value} value={item.value} data-search-text={`${item.value} ${languageLabel(item.value, "ru")} ${languageLabel(item.value, "de")} ${englishLanguageName(item.value)}`}>{languageLabel(item.value, lang)}</option>)}
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Улица и дом", "Straße und Hausnummer")}
                  required={draft.healthcareConsent || cabinetConsents.healthcare}
                  error={visibleMasterError("street")}
                  errorId={`${MASTER_FIELD_IDS.street}-error`}
                  htmlFor={MASTER_FIELD_IDS.street}
                >
                  <Input
                    id={MASTER_FIELD_IDS.street}
                    name="street_address"
                    autoComplete="street-address"
                    required={draft.healthcareConsent || cabinetConsents.healthcare}
                    aria-invalid={Boolean(visibleMasterError("street"))}
                    aria-describedby={visibleMasterError("street") ? `${MASTER_FIELD_IDS.street}-error` : undefined}
                    className={inputClass}
                    value={draft.street}
                    onBlur={() => touchMasterField("street")}
                    onChange={(event) => patch("street", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Почтовый индекс", "Postleitzahl")}
                  required={draft.healthcareConsent || cabinetConsents.healthcare}
                  error={visibleMasterError("zip")}
                  errorId={`${MASTER_FIELD_IDS.zip}-error`}
                  htmlFor={MASTER_FIELD_IDS.zip}
                >
                  <Input
                    id={MASTER_FIELD_IDS.zip}
                    name="postal_code"
                    autoComplete="postal-code"
                    required={draft.healthcareConsent || cabinetConsents.healthcare}
                    aria-invalid={Boolean(visibleMasterError("zip"))}
                    aria-describedby={visibleMasterError("zip") ? `${MASTER_FIELD_IDS.zip}-error` : undefined}
                    className={inputClass}
                    value={draft.zip}
                    onBlur={() => touchMasterField("zip")}
                    onChange={(event) => patch("zip", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Город", "Ort")}
                  required={draft.healthcareConsent || cabinetConsents.healthcare}
                  error={visibleMasterError("city")}
                  errorId={`${MASTER_FIELD_IDS.city}-error`}
                  htmlFor={MASTER_FIELD_IDS.city}
                >
                  <Input
                    id={MASTER_FIELD_IDS.city}
                    name="city"
                    autoComplete="address-level2"
                    required={draft.healthcareConsent || cabinetConsents.healthcare}
                    aria-invalid={Boolean(visibleMasterError("city"))}
                    aria-describedby={visibleMasterError("city") ? `${MASTER_FIELD_IDS.city}-error` : undefined}
                    className={inputClass}
                    value={draft.city}
                    onBlur={() => touchMasterField("city")}
                    onChange={(event) => patch("city", event.target.value)}
                  />
                </Field>
                <Field label={tx("Регион / область", "Region / Bundesland")} htmlFor={STEP1_CONTROL_IDS.region}>
                  <Input
                    id={STEP1_CONTROL_IDS.region}
                    className={inputClass}
                    name="address_region"
                    autoComplete="address-level1"
                    value={draft.state}
                    onChange={(event) => patch("state", event.target.value)}
                  />
                </Field>
                <Field label={tx("Страна проживания", "Wohnsitzland")} portalField="country">
                  <CountrySelect
                    value={draft.country}
                    lang={lang}
                    className={selectClass}
                    aria-label={tx("Страна проживания", "Wohnsitzland")}
                    onChange={(value) => handleAmlCountryChange({ country: value })}
                  />
                </Field>
                <Field label={tx("Гражданство (можно несколько)", "Staatsangehörigkeiten (mehrere möglich)")} portalField="citizenships" htmlFor={STEP1_CONTROL_IDS.citizenships}>
                  <CitizenshipMultiSelect
                    id={STEP1_CONTROL_IDS.citizenships}
                    value={draft.citizenships}
                    className={selectClass}
                    placeholder={tx("Гражданство", "Staatsangehörigkeit")}
                    onChange={(next) => handleAmlCountryChange({ citizenships: next })}
                  />
                </Field>
              </div>
              {amlRequired || amlHints.length > 0 || wizardDocuments.enhanced_due_diligence.length > 0 ? (
                <div className="mt-4" data-testid="lead-aml-enhanced-check" data-required={amlRequired ? "true" : "false"}>
                  <div className="rounded-xl border border-border/50 bg-card p-3.5">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <StatusChip tone={amlRequired ? "error" : amlHints.length > 0 ? "warning" : "neutral"}>
                          <ShieldCheck aria-hidden="true" />
                          {/* The same name as the documents step and the form (owner 2026-10-19). */}
                          {amlRequired
                            ? tx("Усиленная AML-проверка (ориентир § 15 GwG): требуется по правилу GMED", "Verstärkte AML-Prüfung (Orientierung § 15 GwG): nach GMED-Regel erforderlich")
                            : amlCheckSettled(enhancedCheck)
                              ? tx("Усиленная AML-проверка (ориентир § 15 GwG): добровольная", "Verstärkte AML-Prüfung (Orientierung § 15 GwG): freiwillig")
                              : enhancedCheckTitle(tx)}
                        </StatusChip>
                        {amlRequired && amlRequiredText ? (
                          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200" data-testid="lead-aml-enhanced-check-reasons">
                            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {amlRequiredText}
                          </p>
                        ) : null}
                        {amlHints.map((hint) => (
                          <StatusChip key={hint} tone="warning" data-testid="lead-aml-enhanced-check-hint">
                            <CircleAlert aria-hidden="true" />
                            <span>{hint}</span>
                          </StatusChip>
                        ))}
                        {!leadId ? (
                          <div className="text-xs leading-5 text-muted-foreground" data-testid="lead-aml-enhanced-check-after-create">
                            {tx(
                              "Проверку можно заполнить после создания обращения.",
                              "Die Prüfung kann nach dem Anlegen des Leads ausgefüllt werden.",
                            )}
                          </div>
                        ) : null}
                      </div>
                      {leadId ? (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="h-8 shrink-0 rounded-lg"
                          disabled={isBusy}
                          onClick={openAmlSheet}
                        >
                          <ShieldCheck aria-hidden="true" className="size-3.5" />
                          {wizardDocuments.enhanced_due_diligence.length > 0
                            ? tx("Создать новую версию", "Neue Version erstellen")
                            : tx("Заполнить проверку", "Prüfung ausfüllen")}
                        </Button>
                      ) : null}
                    </div>
                    {wizardDocuments.enhanced_due_diligence.length > 0 ? (
                      <div className="mt-3 border-t border-border/50 pt-3">
                        <WizardDocumentRows
                          documents={wizardDocuments.enhanced_due_diligence}
                          complianceKind="enhanced_due_diligence"
                          emptyLabel=""
                          lang={lang}
                          busy={busy}
                          disabled={isBusy}
                          tx={tx}
                          onOpen={(document) => void openOrDownloadDocument(document)}
                          onDownload={(document) => void downloadDocument(document)}
                          onSign={(document, kind) => void signDocument(document.id, kind)}
                          onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                          onChanged={() => { void refreshDocumentsState(); }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              </Section>
              {isMinor(draft.birthDate, new Date()) ? (
                <Section
                  title={tx("Родитель или законный представитель", "Elternteil oder gesetzlicher Vertreter")}
                  accessory={(
                    <Button type="button" size="sm" variant="default" onClick={() => openNewTrustedContact(true)}>
                      <Plus aria-hidden="true" className="size-3.5" />
                      {tx("Добавить", "Hinzufügen")}
                    </Button>
                  )}
                >
                  <div
                    id={MASTER_FIELD_IDS.guardian}
                    tabIndex={-1}
                    className={cn(
                      "space-y-3 rounded-lg focus:outline-none",
                      visibleMasterError("guardian") && "ring-1 ring-destructive/50",
                    )}
                  >
                    <p className="text-xs leading-5 text-muted-foreground">
                      {tx(
                        "Для ребёнка контакт и электронную подпись оформляет мать, отец или законный представитель. Можно выбрать существующего пациента или внести данные вручную.",
                        "Bei Minderjährigen werden Kontakt und elektronische Unterschrift durch einen Elternteil oder gesetzlichen Vertreter angegeben. Eine bestehende Patientenakte kann verknüpft oder der Kontakt manuell erfasst werden.",
                      )}
                    </p>
                    {visibleMasterError("guardian") ? (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {visibleMasterError("guardian")}
                      </p>
                    ) : null}
                    {leadId && portalRepresentation ? (
                      <LeadCustodySelect
                        leadId={leadId}
                        representation={portalRepresentation}
                        disabled={isBusy}
                        tx={tx}
                        errorText={(nextError) => errorText(nextError, tx)}
                        // The server must know the date of birth of a minor before it takes the custody.
                        beforeSave={step1Portal.intake?.minor ? undefined : () => save(step, false)}
                        onSaved={step1Portal.applyRepresentation}
                      />
                    ) : !leadId ? (
                      // Before the lead exists: sent with its creation, so a
                      // child under guardianship can name the guardian at once.
                      <label className="block max-w-md space-y-1.5" data-testid="lead-new-custody">
                        <span data-wizard-field-label className="block font-mono text-xs font-medium text-muted-foreground">{tx("Кто представляет ребёнка", "Wer vertritt das Kind")}</span>
                        <NativeComboboxSelect
                          value={newLeadCustody}
                          className={selectClass}
                          disabled={isBusy}
                          aria-label={tx("Кто представляет ребёнка", "Wer vertritt das Kind")}
                          onChange={(event) => setNewLeadCustody(LEAD_CUSTODY_VALUES.find((item) => item === event.target.value) ?? "")}
                        >
                          <option value="">{tx("Выберите", "Bitte wählen")}</option>
                          {LEAD_CUSTODY_VALUES.map((item) => (
                            <option key={item} value={item}>{custodyLabel(item, tx)}</option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                    ) : null}
                    {draft.trustedContacts.filter((contact) => isParentOrGuardianRelation(contact.relation)).length === 0 ? (
                      <EmptyCell>{tx("Представитель не указан", "Kein Vertreter angegeben")}</EmptyCell>
                    ) : (
                      <ul className={cn("divide-y divide-border/70 rounded-lg", tokens.surface.card)}>
                        {draft.trustedContacts
                          .filter((contact) => isParentOrGuardianRelation(contact.relation))
                          .map((contact) => (
                            <li key={contact.id} className="flex items-center gap-3 px-3 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{contact.name}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                  <TrustedContactRole relation={contact.relation} tx={tx} />
                                  {/* On file, but not one of the persons who act for the child
                                      (a second parent under sole custody, a third one): no
                                      contract, signature or GwG sheet is made for that person. */}
                                  {portalRepresentation?.representatives.some((person) => person.id === contact.id && person.slot === null) ? (
                                    <span className="text-amber-700 dark:text-amber-300" data-testid="trusted-contact-not-representing">
                                      {tx("Не представляет ребёнка", "Vertritt das Kind nicht")}
                                    </span>
                                  ) : null}
                                  <span className="break-all">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</span>
                                </div>
                                {serverContactError?.contactId === contact.id ? (
                                  <p role="alert" className="mt-1 text-xs font-medium text-destructive" data-testid="trusted-contact-server-error">
                                    {serverContactError.message}
                                  </p>
                                ) : null}
                              </div>
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => openTrustedContact(contact, true)} aria-label={tx("Редактировать представителя", "Vertreter bearbeiten")}>
                                <Pencil aria-hidden="true" className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-destructive hover:text-destructive"
                                disabled={isBusy}
                                title={tx("Удалить представителя", "Vertreter entfernen")}
                                aria-label={`${tx("Удалить представителя", "Vertreter entfernen")}: ${contact.name}`}
                                onClick={() => setTrustedContactRemoval(contact)}
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                              </Button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </Section>
              ) : null}
              {/* Inside the portal state too: the lead fills the insurance in the cabinet, its
                  fields carry the «от пациента» marker like the personal ones (QA 2026-10-11, N-03). */}
              <Section title={tx("Страхование", "Versicherung")}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={tx("Есть ли медицинская страховка", "Krankenversicherung vorhanden")} portalField="has_insurance" htmlFor={STEP1_CONTROL_IDS.hasInsurance}>
                  <NativeComboboxSelect
                    id={STEP1_CONTROL_IDS.hasInsurance}
                    name="has_insurance"
                    value={draft.hasInsurance}
                    className={selectClass}
                    onChange={(event) => {
                      const value = event.target.value as Draft["hasInsurance"];
                      clearServerValidation();
                      setDraft((current) => current ? {
                        ...current,
                        hasInsurance: value,
                        ...(value === "no" ? {
                          insuranceType: "self_pay",
                          insuranceProvider: "",
                          insuranceNumber: "",
                          insuranceCoversGermany: "",
                        } : {}),
                      } : current);
                    }}
                  >
                    <option value="">{tx("Не указано", "Nicht angegeben")}</option>
                    <option value="yes">{tx("Да", "Ja")}</option>
                    <option value="no">{tx("Нет, самооплата", "Nein, Selbstzahler")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Тип страхования", "Versicherungsart")}
                  portalField="insurance_type"
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceType")}
                  errorId={`${MASTER_FIELD_IDS.insuranceType}-error`}
                  htmlFor={MASTER_FIELD_IDS.insuranceType}
                >
                  <NativeComboboxSelect
                    id={MASTER_FIELD_IDS.insuranceType}
                    name="insurance_type"
                    value={draft.insuranceType}
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceType"))}
                    aria-describedby={visibleMasterError("insuranceType") ? `${MASTER_FIELD_IDS.insuranceType}-error` : undefined}
                    className={cn(selectClass, visibleMasterError("insuranceType") && "border-destructive")}
                    onBlur={() => touchMasterField("insuranceType")}
                    onChange={(event) => patch("insuranceType", event.target.value)}
                  >
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    <option value="private">{tx("Частное", "Privat")}</option>
                    <option value="public">{tx("Государственное", "Gesetzlich")}</option>
                    <option value="foreign">{tx("Иностранное", "Ausland")}</option>
                    <option value="self_pay">{tx("Самооплата", "Selbstzahler")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Страховая компания", "Versicherer")}
                  portalField="insurance_provider"
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceProvider")}
                  errorId={`${MASTER_FIELD_IDS.insuranceProvider}-error`}
                  htmlFor={MASTER_FIELD_IDS.insuranceProvider}
                >
                  <Input
                    id={MASTER_FIELD_IDS.insuranceProvider}
                    name="insurance_provider"
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceProvider"))}
                    aria-describedby={visibleMasterError("insuranceProvider") ? `${MASTER_FIELD_IDS.insuranceProvider}-error` : undefined}
                    className={inputClass}
                    value={draft.insuranceProvider}
                    onBlur={() => touchMasterField("insuranceProvider")}
                    onChange={(event) => patch("insuranceProvider", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Номер полиса", "Versicherungsnummer")}
                  portalField="insurance_number"
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceNumber")}
                  errorId={`${MASTER_FIELD_IDS.insuranceNumber}-error`}
                  htmlFor={MASTER_FIELD_IDS.insuranceNumber}
                >
                  <Input
                    id={MASTER_FIELD_IDS.insuranceNumber}
                    name="insurance_number"
                    autoComplete="off"
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceNumber"))}
                    aria-describedby={visibleMasterError("insuranceNumber") ? `${MASTER_FIELD_IDS.insuranceNumber}-error` : undefined}
                    className={inputClass}
                    value={draft.insuranceNumber}
                    onBlur={() => touchMasterField("insuranceNumber")}
                    onChange={(event) => patch("insuranceNumber", event.target.value)}
                  />
                </Field>
                <Field label={tx("Покрывает лечение в Германии", "Deckung in Deutschland")} portalField="insurance_covers_germany" htmlFor={STEP1_CONTROL_IDS.insuranceCoversGermany}>
                  <NativeComboboxSelect
                    id={STEP1_CONTROL_IDS.insuranceCoversGermany}
                    name="insurance_covers_germany"
                    value={draft.insuranceCoversGermany}
                    className={selectClass}
                    disabled={draft.hasInsurance === "no"}
                    onChange={(event) => patch("insuranceCoversGermany", event.target.value)}
                  >
                    <option value="">{tx("Не указано", "Nicht angegeben")}</option>
                    <option value="yes">{tx("Да", "Ja")}</option>
                    <option value="no">{tx("Нет", "Nein")}</option>
                    <option value="not_sure">{tx("Не уверен", "Nicht sicher")}</option>
                  </NativeComboboxSelect>
                </Field>
              </div>
              </Section>
              </Step1PortalProvider>
            </section>
          ) : null}

          {draft && lead && step === "medical" ? (
            <section className="space-y-5">
              <Section title={tx("Обращение", "Anliegen")}>
              <Field label={tx("Направивший врач", "Zuweisender Arzt")} className="block pb-2"><Input className={inputClass} value={draft.referrer} onChange={(event) => patch("referrer", event.target.value)} /></Field>
              <PreviousRequestsPanel
                requests={previousRequests.requests}
                currentConcern={draft.concern}
                tx={tx}
                specialtyLabel={specialtyLabel}
                onUse={(concern) => patch("concern", concern)}
              />
              {/* Trigger flow 13.2: what the lead wrote in the cabinet, with the lead's medical uploads. */}
              <LeadPatientConcern
                reason={step1Portal.intake?.request_reason}
                documents={patientUploadDocuments}
                currentConcern={draft.concern}
                onTransfer={(text) => patch("concern", text)}
                onOpen={(document) => void openOrDownloadDocument(document)}
                onDownload={(document) => void downloadDocument(document)}
                tx={tx}
                disabled={isBusy}
              />
              <Field label={tx("Причина обращения", "Anliegen")}>
                <textarea
                  id={SERVICE_CONCERN_ID}
                  className={cn(textareaClass, "min-h-28 bg-card")}
                  value={draft.concern}
                  onChange={(event) => patch("concern", event.target.value)}
                />
              </Field>
              </Section>
              {medicalLookupsLoading ? (
                <div
                  role="status"
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground", tokens.surface.mutedCard)}
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружаются справочники врачей и клиник…", "Ärzte- und Klinikkataloge werden geladen…")}
                </div>
              ) : null}
              <Suspense
                fallback={(
                  <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    {tx("Загрузка медицинской формы…", "Medizinisches Formular wird geladen…")}
                  </div>
                )}
              >
                {clinicalAccessDenied ? <Banner tone="warning">{tx("У вашей роли нет доступа к медицинской карте. Медицинскую часть заполняет уполномоченный сотрудник; остальные этапы обращения доступны.", "Ihre Rolle hat keinen Zugriff auf die Patientenakte. Den medizinischen Teil bearbeitet eine berechtigte Person; die übrigen Schritte bleiben verfügbar.")}</Banner> : waitingForPatientData ? <PatientDataPendingNotice
                  onOpenStep1={() => setStep("master_data")}
                  tx={tx}
                  missing={patientDataPendingFields(draft)}
                  patientCanFill={step1Portal.mode === "patient"}
                  disabled={isBusy}
                  legalSex={draft.legalSex}
                  onLegalSexChange={(value) => {
                    touchMasterField("legalSex");
                    patch("legalSex", value);
                    // Saved at once (as on closing the wizard), so the
                    // prospect patient finds it on the server.
                    void save(step, false, { ...draft, legalSex: value });
                  }}
                  birthDate={draft.birthDate}
                  onBirthDateChange={(value) => {
                    patch("birthDate", value);
                    void save(step, false, { ...draft, birthDate: value });
                  }}
                  onBirthDateBlur={() => touchMasterField("birthDate")}
                  onBirthDatePickerValidation={setBirthDateEntryError}
                  birthDateError={birthDateError}
                  birthDateMin={EARLIEST_BIRTH_DATE}
                  birthDateMax={appDateKey()}
                /> : <LeadMedicalIntakeForm
                  lead={lead}
                  tx={tx}
                  lang={lang}
                  anamneseId={MEDICAL_ANAMNESE_ID}
                  narrative={draft.narrative}
                  diagnoses={draft.diagnoses}
                  medications={draft.medications}
                  allergies={draft.allergies}
                  caves={draft.caves}
                  providers={clinicalProviders}
                  allDoctors={allDoctors}
                  specializations={specialties}
                  onNarrativeChange={(value) => saveClinicalDraftChange("narrative", {
                    ...draft,
                    narrative: value,
                    anamnese: value.anamnese_aktuelle ?? "",
                  })}
                  onDiagnosesChange={(value) => saveClinicalDraftChange("diagnoses", { ...draft, diagnoses: value })}
                  onMedicationsChange={(value) => saveClinicalDraftChange("medications", { ...draft, medications: value })}
                  onAllergiesChange={(value) => saveClinicalDraftChange("allergies", { ...draft, allergies: value })}
                  onCavesChange={(value) => saveClinicalDraftChange("caves", { ...draft, caves: value })}
                />}
              </Suspense>
              {leadId && !clinicalAccessDenied ? (
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Медицинские документы", "Medizinische Unterlagen")}
                  accessory={hasMedicalRecords ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <StatusChip tone="warning" className="whitespace-normal">
                        {tx("PDF, JPG или PNG · до 25 МБ · можно выбрать несколько файлов", "PDF, JPG oder PNG · bis 25 MB · mehrere Dateien möglich")}
                      </StatusChip>
                      <input
                        id="lead-file-medical"
                        type="file"
                        multiple
                        className="peer sr-only"
                        accept={LEAD_UPLOAD_ACCEPT}
                        disabled={isBusy}
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []);
                          event.currentTarget.value = "";
                          void upload("medical", files);
                        }}
                      />
                      <label
                        htmlFor="lead-file-medical"
                        className={cn(
                          buttonVariants({ variant: "default", size: "sm" }),
                          "h-8 rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                          isBusy && "pointer-events-none opacity-50",
                        )}
                      >
                        {busy === "upload-medical" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Upload aria-hidden="true" className="size-3.5" />}
                        {busy === "upload-medical" ? tx("Загрузка…", "Wird hochgeladen…") : tx("Загрузить файлы", "Dateien hochladen")}
                      </label>
                    </span>
                  ) : undefined}
                >
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="has_medical_records"
                      className="size-4 rounded border-border accent-orange-500"
                      checked={hasMedicalRecords}
                      // Uploaded files are the answer; it can change once they are removed.
                      disabled={isBusy || medicalDocuments.length > 0}
                      onChange={(event) => void setHasMedicalRecords(event.target.checked)}
                    />
                    {tx("У клиента есть медицинские документы", "Der Kunde hat medizinische Unterlagen")}
                  </label>
                  {hasMedicalRecords ? (
                    <>
                      <WizardDocumentRows
                        documents={medicalDocuments}
                        emptyLabel={tx("Файлы не загружены", "Keine Dateien hochgeladen")}
                        lang={lang}
                        busy={busy}
                        disabled={isBusy}
                        tx={tx}
                        onOpen={(document) => void openOrDownloadDocument(document)}
                        onDownload={(document) => void downloadDocument(document)}
                        onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                        onChanged={() => { void refreshDocumentsState(); }}
                      />
                    </>
                  ) : null}
                </Section>
              ) : null}
            </section>
          ) : null}


          {draft && lead && step === "service" ? (
            <section className="space-y-5">
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Период программы", "Programmzeitraum")}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={tx("Начало программы", "Programmbeginn")}
                    required={Boolean(draft.programDateTo)}
                    error={orderFieldError("program-date-from")}
                    errorId={`${ORDER_DATE_FROM_ID}-error`}
                  >
                    <Input
                      id={ORDER_DATE_FROM_ID}
                      name="program_date_from"
                      type="date"
                      required={Boolean(draft.programDateTo)}
                      aria-invalid={Boolean(orderFieldError("program-date-from"))}
                      aria-describedby={orderFieldError("program-date-from") ? `${ORDER_DATE_FROM_ID}-error` : undefined}
                      className={inputClass}
                      value={draft.programDateFrom}
                      onChange={(event) => patch("programDateFrom", event.target.value)}
                    />
                  </Field>
                  <Field
                    label={tx("Окончание программы", "Programmende")}
                    required={Boolean(draft.programDateFrom)}
                    error={orderFieldError("program-date-to", "program-date-range")}
                    errorId={`${ORDER_DATE_TO_ID}-error`}
                  >
                    <Input
                      id={ORDER_DATE_TO_ID}
                      name="program_date_to"
                      type="date"
                      min={draft.programDateFrom || undefined}
                      required={Boolean(draft.programDateFrom)}
                      aria-invalid={Boolean(orderFieldError("program-date-to", "program-date-range"))}
                      aria-describedby={orderFieldError("program-date-to", "program-date-range") ? `${ORDER_DATE_TO_ID}-error` : undefined}
                      className={inputClass}
                      value={draft.programDateTo}
                      onChange={(event) => patch("programDateTo", event.target.value)}
                    />
                  </Field>
                </div>
                {periodWarningBanner ? <div className="mt-3">{periodWarningBanner}</div> : null}
              </Section>
              {isQuestionnaireLead ? (
                <Section title={tx("Данные опросника", "Fragebogendaten")}>
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Нужен переводчик", "Dolmetscher benötigt"), value: yesNoValue(draft.serviceNeeds.includes("interpreter_support"), tx) },
                    { label: tx("Может приехать", "Kann anreisen"), value: yesNoValue(lead.can_travel, tx) },
                    { label: tx("Есть проездные документы", "Reisedokumente vorhanden"), value: yesNoValue(lead.has_travel_documents, tx) },
                    { label: tx("Регион нахождения", "Aufenthaltsregion"), value: lead.location ? leadLocationLabel(lead.location, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Детальная локация", "Detaillierter Standort"), value: lead.location_detailed ? leadLocationDetailedLabel(lead.location_detailed, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Предпочитаемое место лечения", "Bevorzugter Behandlungsort"), value: lead.preferred_location ? leadPreferredLocationLabel(lead.preferred_location, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Желаемый срок", "Gewünschter Zeitraum"), value: lead.visit_timing ? leadVisitTimingLabel(lead.visit_timing, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Интерес к программе", "Interesse an einem Programm"), value: yesNoValue(lead.wants_membership, tx) },
                    { label: tx("Выбранная программа", "Gewähltes Programm"), value: lead.selected_program ? leadProgramServiceLabel(lead.selected_program, t) : tx("Не указано", "Nicht angegeben") },
                  ]}
                />
                </Section>
              ) : null}
              <Section
                title={tx("Запрошенные услуги", "Gewünschte Leistungen")}
                accessory={<CountBadge>{draft.serviceNeeds.length}</CountBadge>}
              >
                <div className="grid items-start gap-2 sm:grid-cols-2">
                  {Array.from(new Set([
                    ...LEAD_WIZARD_SERVICE_OPTIONS,
                    ...initialServiceOptionsRef.current,
                    ...draft.serviceNeeds,
                  ])).map((value, index) => {
                    const checked = draft.serviceNeeds.includes(value);
                    const label = knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx);
                    const fieldKey = `${index}-${value.replace(/[^a-z0-9_-]/gi, "-")}`;
                    const checkboxId = `lead-service-${fieldKey}`;
                    const commentId = `lead-service-comment-${fieldKey}`;
                    const commentLabel = tx("Комментарий к услуге", "Kommentar zur Leistung");
                    return (
                      <div
                        key={value}
                        className={cn(
                          "overflow-hidden rounded-lg border bg-card",
                          checked ? "border-[var(--brand)]" : "border-border/50",
                        )}
                      >
                        <label
                          htmlFor={checkboxId}
                          className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5"
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            className={checkboxClass}
                            checked={checked}
                            onChange={(event) => toggleServiceNeed(value, event.target.checked)}
                          />
                          <span className="min-w-0 break-words text-sm text-foreground">{label}</span>
                        </label>
                        {checked ? (
                          <div className="space-y-1.5 border-t border-border px-3 pb-3 pt-2.5">
                            <label
                              htmlFor={commentId}
                              className={cn(tokens.text.label, "block font-mono")}
                            >
                              {commentLabel}
                            </label>
                            <textarea
                              id={commentId}
                              aria-label={`${commentLabel}: ${label}`}
                              className={cn(textareaClass, "min-h-20 resize-y bg-card")}
                              value={draft.serviceComments[value] ?? ""}
                              onChange={(event) => patchServiceComment(value, event.target.value)}
                              placeholder={tx("Детали по этой услуге", "Details zu dieser Leistung")}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <Field label={tx("Общий комментарий", "Allgemeiner Kommentar")}><textarea className={cn(textareaClass, "min-h-24 bg-card")} value={draft.serviceNotes} onChange={(event) => patch("serviceNotes", event.target.value)} /></Field>
              </Section>
            </section>
          ) : null}

          {draft && step === "documents" ? (
            <section className="space-y-5">
              <LeadAttachmentImportNotice
                refused={refusedAttachments}
                tx={tx}
                canDownload={Boolean(leadId) && lead?.medical_fields_hidden !== true}
                onDownload={(file) => {
                  if (!leadId) return;
                  void downloadLeadAttachment(leadId, file.id)
                    .then((blob) => saveBlobAs(blob, file.file_name))
                    .catch(showWizardError);
                }}
              />
              {patientDocumentReview}
              {patientContractReview}
              {renderPayerDeclarationSection(false)}
              {leadId && payer.data?.status.cost_assumption.required ? renderPayerSignatureFlow(false) : null}
              {step1Portal.intake ? (
                <Section title={tx("Согласия из кабинета", "Einwilligungen aus dem Kundenkabinett")}>
                  <PortalInquiryConsentLine intake={step1Portal.intake} tx={tx} />
                  <PortalHealthConsentLine intake={step1Portal.intake} tx={tx} />
                </Section>
              ) : null}
              {patientUploadDocuments.length > 0 ? (
                <Section className={WIZARD_DOCUMENT_SECTION_CLASS} title={tx("Загружено пациентом", "Vom Patienten hochgeladen")}>
                  <WizardDocumentRows
                    documents={patientUploadDocuments}
                    emptyLabel=""
                    lang={lang}
                    busy={busy}
                    disabled={isBusy}
                    tx={tx}
                    onOpen={(document) => void openOrDownloadDocument(document)}
                    onDownload={(document) => void downloadDocument(document)}
                    onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                    onChanged={() => { void refreshDocumentsState(); }}
                  />
                </Section>
              ) : null}
              {leadId ? (
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={gwgSheets.payerIsOrganisation
                    // A paying organisation adds the sheet for legal entities (owner 2026-10-22).
                    ? tx("Листы идентификации по GwG", "Dokumentationsbögen (GwG)")
                    : tx("Лист идентификации по GwG", "Dokumentationsbogen natürliche Personen (GwG)")}
                  accessory={(
                    <LeadGwgSheetActions
                      plan={gwgSheets}
                      documents={wizardDocuments.gwg_identification}
                      busy={busy}
                      disabled={isBusy}
                      tx={tx}
                      onGenerate={(button) => void generateGwgIdentificationSheet(button)}
                    />
                  )}
                >
                  {identification.error ? (
                    <WizardLoadError
                      message={tx("Не удалось загрузить статус идентификации", "Identifizierungsstatus konnte nicht geladen werden")}
                      detail={errorText(identification.error, tx)}
                      onRetry={() => void identification.reload()}
                      tx={tx}
                      testId="lead-identification-load-error"
                    />
                  ) : null}
                  <LeadIdentificationStatus
                    identification={identification}
                    canEdit
                    disabled={isBusy}
                    tx={tx}
                    errorText={(nextError) => errorText(nextError, tx)}
                    paymentRoute={step1Portal.intake?.billing ?? null}
                  />
                  <LeadGwgStatements
                    intake={step1Portal.intake}
                    onDownloadDocument={(document) => void downloadDocumentFile(document.id, document.file_name).catch(showWizardError)}
                    onMoveDocument={canReviewPortalUploads && leadId ? (document, target) => {
                      // A file in the wrong slot (owner 2026-10-24).
                      setError("");
                      void moveLeadPortalUpload(leadId, document.id, target.kind, target.representativeId)
                        .then(() => reloadStep1PortalState())
                        .catch(showWizardError);
                    } : undefined}
                    payer={payer.data?.declaration ?? null}
                    payerLink={payerLink.data}
                    askedBlocks={riskAskedBlocks}
                    tx={tx}
                    lang={lang}
                  />
                  <WizardDocumentRows
                    documents={wizardDocuments.gwg_identification}
                    complianceKind="other"
                    emptyLabel=""
                    lang={lang}
                    busy={busy}
                    disabled={isBusy}
                    tx={tx}
                    onOpen={(document) => void openOrDownloadDocument(document)}
                    onDownload={(document) => void downloadDocument(document)}
                    onSign={(document, kind) => void signDocument(document.id, kind)}
                    onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                    onChanged={() => { void refreshDocumentsState(); }}
                  />
                </Section>
              ) : null}
              {leadId ? (
                <div id={RISK_ASSESSMENT_SECTION_ID} tabIndex={-1} className="focus:outline-none">
                  {risk.error ? (() => {
                    // Without a last known assessment the panel renders nothing: the
                    // section stays, with the reason and a retry.
                    const line = (
                      <WizardLoadError
                        message={tx("Не удалось загрузить оценку риска", "Risikobewertung konnte nicht geladen werden")}
                        detail={errorText(risk.error, tx)}
                        onRetry={() => void risk.controller.reload()}
                        tx={tx}
                        testId="lead-risk-assessment-load-error"
                      />
                    );
                    return risk.assessment ? line : (
                      <Section className={WIZARD_DOCUMENT_SECTION_CLASS} title={tx("Оценка риска", "Risikobewertung")}>
                        {line}
                      </Section>
                    );
                  })() : null}
                  <LeadRiskAssessmentPanel assessment={risk.assessment} controller={risk.controller} tx={tx} disabled={isBusy} />
                </div>
              ) : null}
              {/* Always here: required by the owner's rule (2026-10-07) or carried out voluntarily. */}
              <div
                id={ENHANCED_CHECK_SECTION_ID}
                tabIndex={-1}
                className="focus:outline-none"
                data-testid="lead-wizard-enhanced-check-section"
                data-required={amlRequired ? "true" : "false"}
              >
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={(
                    // One row: the check and whether it is required (owner 2026-10-19: more compact).
                    <span className="flex flex-wrap items-center gap-2" data-testid="lead-wizard-enhanced-check-status">
                      <span className="text-sm font-semibold text-foreground">{enhancedCheckTitle(tx)}</span>
                      <StatusChip tone={amlRequired ? "error" : "info"} className="whitespace-normal">
                        <ShieldCheck aria-hidden="true" />
                        {enhancedCheckRequirementLabel(amlRequired, tx)}
                      </StatusChip>
                    </span>
                  )}
                  accessory={(
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={isBusy}
                      onClick={openAmlSheet}
                    >
                      <ShieldCheck className="size-3.5" />
                      {wizardDocuments.enhanced_due_diligence.length > 0
                        ? tx("Создать новую версию", "Neue Version erstellen")
                        : tx("Заполнить проверку", "Prüfung ausfüllen")}
                    </Button>
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {amlRequired && amlRequiredText ? <p className="text-xs leading-5 text-rose-700 dark:text-rose-300">{amlRequiredText}</p> : null}
                    {amlHints.map((hint) => (
                      <StatusChip key={hint} tone="warning" data-testid="lead-wizard-enhanced-check-hint">
                        <CircleAlert aria-hidden="true" />
                        <span>{hint}</span>
                      </StatusChip>
                    ))}
                    {/* The check is required: a self-paying patient owes the proof of funds (owner rule 2026-10-07). */}
                    {amlRequired && enhancedFundsProofOutstanding(step1Portal.intake?.enhanced_details) ? (
                      <StatusChip tone="warning" data-testid="lead-wizard-self-funds-proof-missing">
                        <CircleAlert aria-hidden="true" />
                        <span>{tx(
                          "Подтверждение источника средств пациента ещё не загружено",
                          "Der Nachweis der Herkunft der Mittel des Patienten fehlt noch",
                        )}</span>
                      </StatusChip>
                    ) : null}
                  </div>
                  <WizardDocumentRows
                    documents={wizardDocuments.enhanced_due_diligence}
                    complianceKind="enhanced_due_diligence"
                    emptyLabel=""
                    lang={lang}
                    busy={busy}
                    disabled={isBusy}
                    tx={tx}
                    onOpen={(document) => void openOrDownloadDocument(document)}
                    onDownload={(document) => void downloadDocument(document)}
                    onSign={(document, kind) => void signDocument(document.id, kind)}
                    onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                    onChanged={() => { void refreshDocumentsState(); }}
                  />
                </Section>
              </div>
              {/* The lead's own answers as a document, signed inside the lead's package (owner request 2026-10-08). */}
              {leadId ? (
                <div
                  id={SELF_DISCLOSURE_SECTION_ID}
                  tabIndex={-1}
                  className="focus:outline-none"
                  data-testid="lead-wizard-self-disclosure-section"
                  data-available={leadRequestSent ? "true" : "false"}
                  data-requirement={selfDisclosureRequirement ?? undefined}
                >
                  <Section
                    className={WIZARD_DOCUMENT_SECTION_CLASS}
                    title={tx("Анкета пациента", "Patientenformular")}
                    accessory={(
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={isBusy || !leadRequestSent}
                        title={leadFormUnavailableHint ?? undefined}
                        onClick={() => void generateLeadComplianceDocument(LEAD_SELF_DISCLOSURE_TEMPLATE)}
                      >
                        {busy === `generate-${LEAD_SELF_DISCLOSURE_TEMPLATE}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                        {wizardDocuments.lead_self_disclosure.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                      </Button>
                    )}
                  >
                    {selfDisclosureRequirement ? (
                      <StatusChip
                        tone={selfDisclosureRequirement === "required" ? "info" : "neutral"}
                        className="w-fit"
                        data-testid="lead-wizard-self-disclosure-requirement"
                      >
                        {leadSelfDisclosureRequirementLabel(selfDisclosureRequirement, tx)}
                      </StatusChip>
                    ) : null}
                    <StatusChip tone="warning" className="w-full items-start whitespace-normal rounded-xl px-3 py-2" data-testid="lead-wizard-self-disclosure-source">
                      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span>{leadFormSourceNote}</span>
                    </StatusChip>
                    {leadFormUnavailableHint ? (
                      <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-wizard-self-disclosure-hint">
                        <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span>{leadFormUnavailableHint}</span>
                      </StatusChip>
                    ) : null}
                    <WizardDocumentRows
                      documents={wizardDocuments.lead_self_disclosure}
                      complianceKind="other"
                      emptyLabel=""
                      lang={lang}
                      busy={busy}
                      disabled={isBusy}
                      tx={tx}
                      onOpen={(document) => void openOrDownloadDocument(document)}
                      onDownload={(document) => void downloadDocument(document)}
                      onSign={(document, kind) => void signDocument(document.id, kind)}
                      onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                      onChanged={() => { void refreshDocumentsState(); }}
                    />
                  </Section>
                </div>
              ) : null}
              <div id={CONFIDENTIALITY_RELEASE_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Освобождение от медицинской тайны", "Schweigepflichtsentbindung")}
                  accessory={isMinor(draft.birthDate, new Date()) ? undefined : (
                    <Button type="button" variant="default" size="sm" className="h-8 rounded-lg" disabled={isBusy} onClick={() => void generateLeadComplianceDocument("confidentiality_release")}>
                      {busy === "generate-confidentiality_release" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {wizardDocuments.confidentiality_release.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                    </Button>
                  )}
                >
                {/* For a minor the child's consent form carries the release (owner decision 2026-10-12);
                    the adult form in the child's name is refused (QA 2026-10-12, A2-06). */}
                <StatusChip tone="warning" className="w-full items-start whitespace-normal rounded-xl px-3 py-2" data-testid="lead-wizard-confidentiality-release-note">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                  {isMinor(draft.birthDate, new Date())
                    ? tx(
                      "Для несовершеннолетнего освобождение от медицинской тайны входит в согласие для ребёнка ниже: его подписывают родители или опекун.",
                      "Bei Minderjährigen ist die Schweigepflichtsentbindung Teil der Einverständniserklärung für das Kind unten; sie unterschreiben die Sorgeberechtigten bzw. der Vormund.",
                    )
                    : tx(
                      "Разрешение лечащим врачам и медицинским учреждениям раскрывать сведения, составляющие медицинскую тайну.",
                      "Entbindung der behandelnden Ärzte und medizinischen Einrichtungen von der Schweigepflicht.",
                    )}
                  </span>
                </StatusChip>
                <WizardDocumentRows
                  documents={wizardDocuments.confidentiality_release}
                  complianceKind="confidentiality_release"
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document, kind) => void signDocument(document.id, kind)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
                </Section>
              </div>

              <div id={PRIVACY_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={isMinor(draft.birthDate, new Date())
                    ? tx(
                      "Согласие на передачу данных ребёнка и освобождение от тайны (подписывают родители / опекун)",
                      "Einverständniserklärung (Kind) – unterschreiben die Sorgeberechtigten bzw. der Vormund",
                    )
                    : tx("Согласие на использование и передачу персональных и медицинских данных", "Einverständniserklärung zur Datenübermittlung")}
                  accessory={(
                    <Button type="button" variant="default" size="sm" className="h-8 rounded-lg" disabled={isBusy} onClick={() => void generateLeadComplianceDocument("privacy_consents")}>
                      {busy === "generate-privacy_consents" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {wizardDocuments.privacy_consents.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                    </Button>
                  )}
                >
                <PortalConsentChoiceView intake={step1Portal.intake} tx={tx} />
                <div className="space-y-1 rounded-lg border border-border/70 bg-muted/10 px-3 py-2">
                  {isRepeatIntake && (!privacyConsentGiven || !healthcareConsentGiven) ? (
                    <p data-testid="repeat-consent-note" className="pb-1 text-xs leading-5 text-amber-800">
                      {repeatConsentNote(privacyConsentGiven, healthcareConsentGiven, tx)}
                    </p>
                  ) : null}
                  {/* A consent given in the cabinet (adult lead, or a parent / guardian
                      for a minor) shows here as given and locks the toggle; the toggle
                      itself records only a consent obtained outside the cabinet (paper). */}
                  <ToggleRow id={PRIVACY_CONSENT_ID} checked={privacyConsentGiven} disabled={isBusy || cabinetConsents.privacy} withDivider={false} onChange={(checked) => patch("privacyConsent", checked)} label={tx("Согласие на обработку запроса получено на бумаге", "Einwilligung zur Bearbeitung der Anfrage auf Papier erhalten")} />
                  <ToggleRow id={HEALTHCARE_CONSENT_ID} checked={healthcareConsentGiven} disabled={isBusy || cabinetConsents.healthcare} withDivider={false} onChange={(checked) => patch("healthcareConsent", checked)} label={tx("Получено согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor")} />
                  {cabinetConsents.privacy || cabinetConsents.healthcare ? (
                    <StatusChip tone="warning" className="w-full items-start whitespace-normal rounded-xl px-3 py-2" data-testid="cabinet-consents-note">
                      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 leading-5">{cabinetConsents.privacy && cabinetConsents.healthcare
                        ? tx("Оба согласия даны в кабинете — отдельная отметка не нужна.", "Beide Einwilligungen wurden im Kundenkabinett erteilt – keine gesonderte Bestätigung nötig.")
                        : cabinetConsents.privacy
                          ? tx("Согласие на обработку запроса дано в кабинете. Согласие на медицинские данные отметьте, только если получили его иначе (например, на бумаге).", "Die Einwilligung zur Bearbeitung der Anfrage liegt aus dem Kundenkabinett vor. Die Einwilligung zu Gesundheitsdaten nur bestätigen, wenn sie anders (z. B. auf Papier) vorliegt.")
                          : tx("Согласие на медицинские данные дано в кабинете. Согласие на обработку запроса отметьте, только если получили его на бумаге.", "Die Einwilligung zu Gesundheitsdaten liegt aus dem Kundenkabinett vor. Die Einwilligung zur Bearbeitung der Anfrage nur bestätigen, wenn sie auf Papier vorliegt.")}</span>
                    </StatusChip>
                  ) : null}
                </div>
                {(() => {
                  // One list of everybody the forms name (owner 2026-10-26): staff
                  // contacts and representatives, and the persons the client named
                  // in the cabinet (read-only), each person once.
                  const peopleRows = mergeLeadPeople(
                    draft.trustedContacts,
                    cabinetPeople(step1Portal.intake?.trusted_persons, step1Portal.intake?.consent_form),
                  );
                  // Staff correct or remove a cabinet person by its place in the
                  // cabinet's own list (owner 2026-10-29).
                  const storedCabinetPersons = step1Portal.intake?.trusted_persons ?? [];
                  const cabinetEdit = (person: CabinetPerson): CabinetPersonEditTarget | null => {
                    const index = storedCabinetPersons.findIndex((stored) => personNameKey(stored.name) === personNameKey(person.name));
                    return index >= 0 && leadId
                      ? { leadId, index, stored: storedCabinetPersons[index], onChanged: reloadStep1Portal }
                      : null;
                  };
                  const formRecipients = consentFormRecipients(
                    step1Portal.intake?.consent_form,
                    draft.trustedContacts,
                    isMinor(draft.birthDate, new Date()),
                  );
                  return (
                <div className="space-y-3 rounded-xl border border-border/60 bg-card p-3 sm:p-4" data-testid="lead-people">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminSectionTitle className="text-sm">
                          {tx("Лица и учреждения", "Personen und Einrichtungen")}
                        </AdminSectionTitle>
                        <CountBadge>{peopleRows.length}</CountBadge>
                      </div>
                    </div>
                    <Button type="button" variant="default" size="sm" onClick={() => openNewTrustedContact()}>
                      <Plus aria-hidden="true" className="size-3.5" />
                      {tx("Добавить контакт", "Kontakt hinzufügen")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2.5 text-xs" data-testid="consent-form-recipients">
                    <FileText aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
                    <span className="font-mono text-foreground/80">{tx("В форму согласия попадут:", "In die Einverständniserklärung kommen:")}</span>
                    {formRecipients.names.length > 0
                      ? formRecipients.names.map((name, index) => <StatusChip key={`${index}:${name}`} tone="warning" className="whitespace-normal"><UserRound aria-hidden="true" /><span className="min-w-0 break-words">{name}</span></StatusChip>)
                      : <StatusChip>{tx("никто", "niemand")}</StatusChip>}
                    <StatusChip tone={formRecipients.source === "cabinet" ? "info" : "neutral"} className="whitespace-normal">
                      {formRecipients.source === "cabinet"
                        ? tx("по выбору клиента в кабинете", "nach Wahl des Kunden im Kundenkabinett")
                        : tx("контакты GMED — клиент в кабинете не выбирал", "Kontakte von GMED – keine Wahl im Kundenkabinett")}
                    </StatusChip>
                  </div>
                  {peopleRows.length === 0 ? (
                    <EmptyCell>
                      {tx("Лица и учреждения пока не добавлены", "Noch keine Personen oder Einrichtungen hinzugefügt")}
                    </EmptyCell>
                  ) : (
                    <ul aria-label={tx("Лица и учреждения", "Personen und Einrichtungen")} className="space-y-2">
                      {peopleRows.map((row) => {
                        const contact = row.contact;
                        if (!contact) {
                          return row.cabinet ? <CabinetPersonRow key={row.key} person={row.cabinet} tx={tx} lang={lang} edit={cabinetEdit(row.cabinet)} /> : null;
                        }
                        return (
                        <li key={row.key} className="flex flex-wrap items-start gap-3 rounded-xl border border-border/60 bg-card p-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <UserRound aria-hidden="true" className="size-4 shrink-0 text-foreground" />
                              <span className="min-w-0 break-words text-sm font-semibold text-foreground">{contact.name}</span>
                              {contact.relation ? (
                                <StatusChip className={PARENT_ROLE_CHIP_CLASS}>{trustedContactRelationLabel(contact.relation, tx)}</StatusChip>
                              ) : null}
                              {gwgDataContactIds.has(contact.id) ? (
                                <StatusChip tone="info" data-testid="trusted-contact-gwg-badge">
                                  {tx("Представитель (GwG)", "Vertreter/in (GwG)")}
                                </StatusChip>
                              ) : null}
                              {row.cabinet ? <CabinetRecipientBadge tx={tx} /> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-foreground">
                              {contact.birthDate ? <StatusChip tone="info"><CalendarDays aria-hidden="true" />{germanDocumentDate(contact.birthDate)}</StatusChip> : null}
                              {contact.email ? <StatusChip tone="warning" className="whitespace-normal"><Mail aria-hidden="true" /><span className="min-w-0 break-all">{contact.email}</span></StatusChip> : null}
                              {contact.phone ? <StatusChip tone="warning"><Phone aria-hidden="true" />{contact.phone}</StatusChip> : null}
                              {contact.address ? <span className="inline-flex min-w-0 items-start gap-1.5 text-sm"><MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="break-words">{contact.address}</span></span> : null}
                              {contact.scopeCodes?.length ? (
                                <div className="flex w-full flex-wrap items-center gap-2" data-testid="trusted-contact-scope-summary">
                                  <span className="font-mono text-xs text-foreground/80">{tx("Объём информации:", "Auskunftsumfang:")}</span>
                                  {normalizeScopeCodes(contact.scopeCodes).map((code) => <StatusChip key={code} tone="info">{staffScopeSummary([code], lang === "de" ? "de" : "ru")}</StatusChip>)}
                                </div>
                              ) : null}
                            </div>
                            {row.cabinet ? (() => {
                              const edit = cabinetEdit(row.cabinet);
                              return (
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1"><CabinetPersonDetails person={row.cabinet} tx={tx} lang={lang} /></div>
                                  {edit ? <div className="mt-2"><CabinetPersonActions target={edit} tx={tx} /></div> : null}
                                </div>
                              );
                            })() : null}
                            {serverContactError?.contactId === contact.id ? (
                              <p role="alert" className="mt-1 text-xs font-medium text-destructive" data-testid="trusted-contact-server-error">
                                {serverContactError.message}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {leadId && onNewRequestForPerson && !contact.relatedPatientId ? (
                              // The person becomes a lead of their own with the identity data
                              // GMED already holds; documents are regenerated and re-signed.
                              <Button
                                type="button"
                                variant="default"
                                size="icon-sm"
                                title={newRequestForPersonLabel(tx)}
                                aria-label={`${newRequestForPersonLabel(tx)}: ${contact.name}`}
                                data-testid="trusted-contact-new-request"
                                disabled={isBusy}
                                onClick={() => onNewRequestForPerson({ lead_id: leadId, contact_id: contact.id })}
                              >
                                <UserRoundPlus aria-hidden="true" className="size-3.5" />
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title={tx("Редактировать контакт", "Kontakt bearbeiten")}
                              aria-label={`${tx("Редактировать контакт", "Kontakt bearbeiten")}: ${contact.name}`}
                              onClick={() => openTrustedContact(contact)}
                            >
                              <Pencil aria-hidden="true" className="size-3.5" />
                            </Button>
                            {gwgDataContactIds.has(contact.id) ? (
                              // Clearing only the extra data remains separate from removing the contact.
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:text-destructive"
                                disabled={isBusy}
                                aria-label={`${tx("Убрать данные GwG", "GwG-Angaben entfernen")}: ${contact.name}`}
                                onClick={() => setGwgDataRemoval(contact)}
                              >
                                {busy === `remove-gwg-data-${contact.id}`
                                  ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                                  : null}
                                {tx("Убрать данные GwG", "GwG-Angaben entfernen")}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              title={tx("Удалить контакт", "Kontakt entfernen")}
                              aria-label={`${tx("Удалить контакт", "Kontakt entfernen")}: ${contact.name}`}
                              disabled={isBusy}
                              onClick={() => setTrustedContactRemoval(contact)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                            </Button>
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                  );
                })()}
                <WizardDocumentRows
                  documents={wizardDocuments.privacy_consents}
                  complianceKind="dsgvo"
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document, kind) => void signDocument(document.id, kind)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
                </Section>
              </div>

              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Информационный лист о защите персональных данных", "Informationsblatt zum Datenschutz")}
                accessory={(
                  <Button type="button" variant="default" size="sm" className="h-8 rounded-lg" disabled={isBusy} onClick={() => void generateLeadComplianceDocument("privacy_information")}>
                    {busy === "generate-privacy_information" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                    {wizardDocuments.privacy_information.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                  </Button>
                )}
              >
                <WizardDocumentRows
                  documents={wizardDocuments.privacy_information}
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
              </Section>

              <div id={IDENTITY_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Документ, удостоверяющий личность", "Ausweisdokument")}
                accessory={(
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <StatusChip tone="warning">
                      {tx("PDF, JPG или PNG · до 25 МБ", "PDF, JPG oder PNG · bis 25 MB")}
                    </StatusChip>
                    <input
                      id="lead-file-identity"
                      type="file"
                      className="peer sr-only"
                      accept={LEAD_UPLOAD_ACCEPT}
                      disabled={isBusy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) {
                          void upload("identity", [file]);
                          event.currentTarget.value = "";
                        }
                      }}
                    />
                    <label
                      htmlFor="lead-file-identity"
                      className={cn(
                        buttonVariants({ variant: "default", size: "sm" }),
                        "h-8 rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                        isBusy && "pointer-events-none opacity-50",
                      )}
                    >
                      {busy === "upload-identity" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Upload aria-hidden="true" className="size-3.5" />}
                      {busy === "upload-identity" ? tx("Загрузка…", "Wird hochgeladen…") : wizardDocuments.identity.length > 0 ? tx("Добавить файл", "Datei hinzufügen") : tx("Загрузить файл", "Datei hochladen")}
                    </label>
                  </span>
                )}
              >
                {/* Trigger flow 2026-10-07: staff enter the document data from the scan; the lead only uploads it. */}
                {(() => {
                  // The lead's cabinet uploads are the scan too: listed by the
                  // document data block, never "no file" next to them.
                  const cabinetScanIds = new Set((step1Portal.intake?.identity_documents ?? []).map((file) => file.id));
                  const hasCabinetScan = [...cabinetScanIds].some((id) => !wizardDocuments.identity.some((document) => document.id === id));
                  const patientScans = (
                    <WizardDocumentRows
                      documents={wizardDocuments.identity}
                      complianceKind="identity"
                      emptyLabel={hasCabinetScan ? "" : tx("Файл не загружен", "Keine Datei hochgeladen")}
                      lang={lang}
                      busy={busy}
                      disabled={isBusy}
                      tx={tx}
                      onOpen={(document) => void openOrDownloadDocument(document)}
                      onDownload={(document) => void downloadDocument(document)}
                      onSign={(document, kind) => void signDocument(document.id, kind)}
                      onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                      onChanged={() => { void refreshDocumentsState(); }}
                    />
                  );
                  if (!leadId) return patientScans;
                  return (
                    <>
                    {step1Portal.error ? (
                      // The document data and the representatives' cards come
                      // with the portal state: say why they are missing.
                      <WizardLoadError
                        message={tx("Не удалось загрузить данные кабинета (документ и представители)", "Portaldaten (Ausweis und Vertretung) konnten nicht geladen werden")}
                        detail={errorText(step1Portal.error, tx)}
                        onRetry={() => void reloadStep1PortalState()}
                        tx={tx}
                        testId="lead-portal-intake-load-error"
                      />
                    ) : null}
                    <LeadIdentityDocumentData
                      leadId={leadId}
                      intake={step1Portal.intake}
                      fallbackValidUntil={draft.passportExpiry}
                      tx={tx}
                      lang={lang}
                      disabled={isBusy}
                      patientScans={patientScans}
                      patientScanIds={wizardDocuments.identity.map((document) => document.id)}
                      patientBirthDate={draft.birthDate || null}
                      representativeFiles={representativeFileRows}
                      onSaved={() => {
                        void reloadStep1PortalState();
                        void risk.controller.reload();
                      }}
                      onUploaded={afterRepresentativeUpload}
                    />
                    </>
                  );
                })()}
              </Section>
              </div>
              {supplementaryDocuments.length > 0 ? (
                <Section className={WIZARD_DOCUMENT_SECTION_CLASS} title={tx("Другие документы", "Weitere Dokumente")}>
                  <WizardDocumentRows
                    documents={supplementaryDocuments}
                    emptyLabel=""
                    lang={lang}
                    busy={busy}
                    disabled={isBusy}
                    tx={tx}
                    onOpen={(document) => void openOrDownloadDocument(document)}
                    onDownload={(document) => void downloadDocument(document)}
                    onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                    onChanged={() => { void refreshDocumentsState(); }}
                  />
                </Section>
              ) : null}
            </section>
          ) : null}

          {draft && step === "order" ? (
            <section className="min-w-0 space-y-5">
              {commercialLookupsLoading ? (
                <div
                  role="status"
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground", tokens.surface.mutedCard)}
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружаются каталоги специализаций и услуг…", "Fachrichtungs- und Leistungskataloge werden geladen…")}
                </div>
              ) : null}
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Специализации", "Fachrichtungen")}
              >
                <Field
                  label={tx("Добавить специализацию", "Fachrichtung hinzufügen")}
                  required
                  error={orderFieldError("specialties")}
                  errorId={`${SERVICE_SPECIALTIES_ID}-error`}
                >
                <NativeComboboxSelect
                  id={SERVICE_SPECIALTIES_ID}
                  aria-label={tx("Добавить специализацию", "Fachrichtung hinzufügen")}
                  aria-invalid={Boolean(orderFieldError("specialties"))}
                  aria-describedby={orderFieldError("specialties") ? `${SERVICE_SPECIALTIES_ID}-error` : undefined}
                  name="specialty"
                  value=""
                  // The chosen ones stay visible in the field and ticked in the
                  // list; a second pick removes one (QA C-07).
                  selectedValues={selectedSpecializationItems.map((item) => item.id)}
                  showValueIndicator={false}
                  hidePlaceholderOption
                  selectedLabel={
                    draft.specialties.length > 0
                      ? `${tx("Выбрано", "Ausgewählt")}: ${draft.specialties.map((value) => specialtyLabel(value)).join(", ")}`
                      : undefined
                  }
                  title={draft.specialties.map((value) => specialtyLabel(value)).join(", ") || undefined}
                  onChange={(event) => {
                    const selected = specialties.find((item) => item.id === event.target.value);
                    if (!selected) return;
                    const value = specializationValue(selected);
                    if (draft.specialties.includes(value)) removeSpecializationSelection(value);
                    else patch("specialties", [...draft.specialties, value]);
                  }}
                  className={cn(selectClass, orderFieldError("specialties") && "border-destructive")}
                >
                  <option value="">{tx("Добавить специализацию", "Fachrichtung hinzufügen")}</option>
                  {specialties.map((item) => (
                    <option key={item.id} value={item.id}>
                      {lang === "de" ? item.name_de || item.name_en : item.name_ru || item.name_de || item.name_en}
                    </option>
                  ))}
                </NativeComboboxSelect>
                </Field>
                <div className="border-y border-border/60 py-2.5">
                  <p className="mb-2 text-xs font-semibold text-foreground">
                    {tx("Языки документа", "Dokumentsprachen")}
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className={checkboxClass}
                      />
                      Deutsch
                    </label>
                    {([
                      { code: "ru", label: "Русский" },
                      { code: "en", label: "English" },
                      { code: "es", label: "Español" },
                    ] satisfies Array<{
                      code: Exclude<CostEstimateAdditionalLanguage, "">;
                      label: string;
                    }>).map((languageOption) => (
                      <label
                        key={languageOption.code}
                        className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                      >
                        <input
                          type="checkbox"
                          name="cost_estimate_additional_language"
                          checked={
                            draft.costEstimateAdditionalLanguage ===
                            languageOption.code
                          }
                          onChange={(event) =>
                            patch(
                              "costEstimateAdditionalLanguage",
                              event.target.checked ? languageOption.code : "",
                            )
                          }
                          className={checkboxClass}
                        />
                        {languageOption.label}
                      </label>
                    ))}
                  </div>
                </div>
                {selectedSpecializationItems.length > 0 ? (
                  <div id={COST_ESTIMATE_WORK_TYPES_ID} tabIndex={-1} className="mt-3 border-t border-border/70 pt-3 focus:outline-none">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {tx("Виды работ", "Leistungsarten")}
                        </p>
                        {selectedCostEstimateWorkTypes.length > 0 ? (
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>{tx("Выбрано:", "Ausgewählt:")}</span>
                            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold tabular-nums text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
                              {selectedCostEstimateWorkTypes.length}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {workTypesLoading ? (
                          <LoaderCircle
                            aria-label={tx("Загрузка видов работ", "Leistungsarten werden geladen")}
                            className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
                          />
                        ) : null}
                      </div>
                    </div>
                    {workTypesError ? (
                      <p className="mb-2 text-xs text-destructive">{workTypesError}</p>
                    ) : null}
                    {costEstimateStatus === "no_catalog_work_types" && costEstimateHint ? (
                      <StatusChip tone="warning" role="status" className="mb-2 w-full items-start rounded-xl px-3 py-2">
                        <CircleAlert aria-hidden="true" className="mt-[3px]" />
                        <span className="min-w-0 leading-5">{costEstimateHint}</span>
                      </StatusChip>
                    ) : null}
                    {!workTypesLoading && !workTypesError ? (
                      <div
                        data-testid="lead-wizard-specialization-list"
                        role="region"
                        aria-label={tx("Выбранные специализации и виды работ", "Ausgewählte Fachrichtungen und Leistungsarten")}
                        tabIndex={0}
                        className="max-h-[clamp(16rem,42dvh,26rem)] space-y-2 overflow-y-scroll overscroll-contain pr-1 outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {selectedSpecializationItems.map((specialization) => {
                          const specializationWorkTypes =
                            workTypesBySpecialization[specialization.id] ?? [];
                          const selectedInSpecialization = specializationWorkTypes.filter((workType) =>
                            selectedWorkTypeIdSet.has(workType.id),
                          ).length;
                          const isExpanded = !collapsedWorkTypeSpecializationIds.has(specialization.id);
                          return (
                            <div
                              key={specialization.id}
                              className="t-acc min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card"
                              data-open={String(isExpanded)}
                            >
                              <div className="flex items-center gap-1 bg-muted/35 px-1.5">
                                <button
                                  type="button"
                                  className="t-acc-head flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-expanded={isExpanded}
                                  onClick={() => {
                                    setCollapsedWorkTypeSpecializationIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(specialization.id)) next.delete(specialization.id);
                                      else next.add(specialization.id);
                                      return next;
                                    });
                                  }}
                                >
                                  <span className="t-acc-chevron flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                                    <ChevronDown aria-hidden="true" className="size-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-start gap-2 text-xs font-semibold text-foreground">
                                      <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full bg-orange-500" />
                                      <span className="min-w-0 break-words">{specialtyLabel(specializationValue(specialization))}</span>
                                    </span>
                                    <span className="mt-0.5 block pl-4 text-[11px] text-muted-foreground">
                                      {selectedInSpecialization > 0
                                        ? tx(
                                            `${selectedInSpecialization} из ${specializationWorkTypes.length} выбрано`,
                                            `${selectedInSpecialization} von ${specializationWorkTypes.length} ausgewählt`,
                                          )
                                        : tx(
                                            `${specializationWorkTypes.length} доступно`,
                                            `${specializationWorkTypes.length} verfügbar`,
                                          )}
                                    </span>
                                  </span>
                                </button>
                                <div className="shrink-0 border-l border-border/60 pl-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-7"
                                    title={tx("Удалить специализацию", "Fachrichtung entfernen")}
                                    aria-label={tx("Удалить специализацию", "Fachrichtung entfernen")}
                                    onClick={() =>
                                      removeSpecializationSelection(
                                        specializationValue(specialization),
                                      )
                                    }
                                  >
                                    <X aria-hidden="true" className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="t-acc-panel" aria-hidden={!isExpanded}>
                                <div className="t-acc-panel-inner">
                                  {specializationWorkTypes.length > 0 ? (
                                    <div className="divide-y divide-border/50 border-t border-border/60">
                                      {specializationWorkTypes.map((workType) => {
                                        const selected = selectedWorkTypeIdSet.has(workType.id);
                                        const durationHours = Math.max(1, workType.duration_hours);
                                        return (
                                          <label
                                            key={workType.id}
                                            className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/45 motion-reduce:transition-none"
                                          >
                                            <input
                                              type="checkbox"
                                              name="selected_specialization_work_type_ids"
                                              checked={selected}
                                              onChange={(event) =>
                                                toggleSpecializationWorkType(
                                                  workType.id,
                                                  event.target.checked,
                                                )
                                              }
                                              className={cn(checkboxClass, "mt-0.5")}
                                            />
                                            <span className="min-w-0 flex-1">
                                              <span className={cn(
                                                "block break-words text-sm leading-5",
                                                selected ? "font-medium text-foreground" : "text-foreground/85",
                                              )}>
                                                {lang === "de"
                                                  ? workType.name_de ||
                                                    workType.name_en ||
                                                    workType.name_ru ||
                                                    workType.name_es ||
                                                    workType.code
                                                  : workType.name_ru ||
                                                    workType.name_de ||
                                                    workType.name_en ||
                                                    workType.name_es ||
                                                    workType.code}
                                              </span>
                                              <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                                  {workTypeDurationLabel(durationHours, tx)}
                                                </span>
                                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono font-medium tabular-nums text-emerald-800 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                                                  {formatMoneyRange(workType.min_price_eur, workType.max_price_eur)}
                                                </span>
                                              </span>
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground">
                                      {tx("Нет активных видов работ", "Keine aktiven Leistungsarten")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </Section>
            </section>
          ) : null}

          {draft && step === "commercial" ? (
            <section className="space-y-5">
              {patientContractReview}
              {commercialLookupsLoading ? (
                <div
                  role="status"
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground", tokens.surface.mutedCard)}
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружается каталог услуг…", "Leistungskatalog wird geladen…")}
                </div>
              ) : null}
              {leadId ? (
                <LeadSigningPackagePanel
                  demoChecks={lead?.readiness.demo_onboarding?.credited_checks}
                  leadId={leadId}
                  contractDocument={inheritedContract ? null : sortWizardDocumentsNewestFirst(commercialDocuments.framework_contract)[0] ?? null}
                  orderDocument={sortWizardDocumentsNewestFirst(commercialDocuments.single_order)[0] ?? null}
                  contractSigned={contract?.status === "signed"}
                  inheritedContract={inheritedContract}
                  onDone={() => { void refreshDocumentsState(); }}
                />
              ) : null}
              <div id={FRAMEWORK_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={(
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>{tx("Рамочный договор", "Rahmenvertrag")}</span>
                      <StatusBadge tone={contract?.status === "signed" ? "success" : "neutral"}>
                        {contract?.status === "signed" ? tx("Подписан", "Unterzeichnet")
                          : demoSignatureChecks.includes("contract_signed") ? tx("DEMO-подпись", "DEMO-Unterschrift")
                            : tx("Ожидает подписи", "Unterschrift offen")}
                      </StatusBadge>
                    </span>
                  )}
                  accessory={leadConverted ? null : (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={isBusy || inheritedContract || !lines.some(validLine)}
                      aria-describedby={!inheritedContract && !lines.some(validLine) ? "lead-framework-contract-needs-position" : undefined}
                      onClick={() => void generateCommercialDocument("framework_contract")}
                    >
                      {busy === "generate-framework_contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {commercialDocuments.framework_contract.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                    </Button>
                  )}
                >
                {!inheritedContract && !lines.some(validLine) ? (
                  // Walk-through 2026-10-24: the button was disabled without a word.
                  <StatusChip tone="warning" id="lead-framework-contract-needs-position" data-testid="lead-framework-contract-needs-position" className="mb-3 w-full items-start rounded-xl px-3 py-2">
                    <CircleAlert aria-hidden="true" className="mt-0.5" />
                    <span className="min-w-0 leading-5">
                      {tx(
                        "Договор создаётся после того, как в «Позиции заказа» ниже добавлена хотя бы одна услуга.",
                        "Der Vertrag wird erstellt, sobald unter „Auftragspositionen“ unten mindestens eine Leistung erfasst ist.",
                      )}
                      <button
                        type="button"
                        className="ml-2 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        onClick={() => openValidationIssue({ key: "contract-services", step: "commercial", message: "", fieldId: ORDER_SERVICE_SELECT_ID })}
                      >
                        {tx("К позициям заказа", "Zu den Auftragspositionen")}
                      </button>
                    </span>
                  </StatusChip>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={tx("Начало действия договора", "Vertragsbeginn")} htmlFor="lead-contract-valid-from">
                    <Input
                      id="lead-contract-valid-from"
                      type="date"
                      required
                      className={inputClass}
                      value={contract ? contract.valid_from ?? "" : draft.contractValidFrom}
                      disabled={isBusy || Boolean(contract)}
                      onChange={(event) => patch("contractValidFrom", event.target.value)}
                    />
                  </Field>
                  <Field
                    label={tx(
                      "Граница согласования превышения бюджета",
                      "Mehrkosten-Freigabegrenze",
                    )}
                  >
                    <div className="relative">
                      <Input
                        id={COST_THRESHOLD_ID}
                        name="cost_threshold"
                        inputMode="decimal"
                        className={cn(inputClass, "pr-12 font-mono tabular-nums")}
                        placeholder="500,00"
                        value={draft.costThreshold}
                        onChange={(event) => patch("costThreshold", event.target.value)}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted-foreground">
                        €
                      </span>
                    </div>
                  </Field>
                </div>
                {inheritedContract ? <p className="text-sm">{tx("Используется подписанный договор", "Unterzeichneter Vertrag wird verwendet")}: {contract?.contract_number} · {tx("Бессрочный", "Unbefristet")}</p> : <WizardDocumentRows
                  documents={commercialDocuments.framework_contract}
                  complianceKind="framework_contract"
                  showSignatureStatus={false}
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document) => void signContract(document.id)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />}
                {renderCommercialDocumentError("framework_contract")}
                </Section>
              </div>
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Позиции заказа", "Auftragspositionen")}
                accessory={(
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="size-7 rounded-lg"
                      disabled={orderPositionCount === 0}
                      title={tx("Открыть полный отчёт", "Vollständige Übersicht öffnen")}
                      aria-label={tx("Открыть полный отчёт по позициям заказа", "Vollständige Übersicht der Auftragspositionen öffnen")}
                      onClick={() => setServiceReportOpen(true)}
                    >
                      <Eye aria-hidden="true" className="size-3.5" />
                    </Button>
                    <CountBadge>{orderPositionCount}</CountBadge>
                  </div>
                )}
              >
                {draft.serviceNeeds.length > 0 ? (
                  <LeadQuestionnaireFacts
                    items={[
                      {
                        label: tx("Запрос клиента", "Kundenbedarf"),
                        value: (
                          <span className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 font-normal text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                            <MessageSquareText
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                            />
                            <span className="min-w-0 whitespace-pre-wrap break-words">
                              {draft.serviceNeeds
                                .map((value) =>
                                  knownLeadProgramServiceLabel(value, t)
                                  ?? serviceNeedLabel(value, tx),
                                )
                                .join(", ")}
                            </span>
                          </span>
                        ),
                        wide: true,
                      },
                    ]}
                  />
                ) : null}
                {selectedCostEstimateWorkTypes.length > 0 ? (
                  <div className="t-acc" data-open={String(workTypesExpanded)}>
                    <button
                      type="button"
                      className="t-acc-head flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={workTypesExpanded}
                      onClick={() => setWorkTypesExpanded((current) => !current)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="size-2 rounded-full bg-orange-500" />
                        <span className="text-xs font-semibold text-foreground">
                          {tx("Виды работ и часы", "Leistungsarten und Stunden")}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <CountBadge>{selectedCostEstimateWorkTypes.length}</CountBadge>
                        <span className="t-acc-chevron text-muted-foreground">
                          <ChevronDown aria-hidden="true" className="size-4" />
                        </span>
                      </span>
                    </button>
                    <div className="t-acc-panel" aria-hidden={!workTypesExpanded}>
                      <div className="t-acc-panel-inner">
                        <div className="space-y-2 pt-1">
                          <SelectedWorkTypesSummary
                            workTypes={selectedCostEstimateWorkTypes}
                            specializationLabels={selectedSpecializationLabelById}
                            lang={lang}
                            tx={tx}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <label
                    htmlFor={ORDER_SERVICE_SELECT_ID}
                    className="flex items-center gap-2 text-xs font-semibold text-foreground"
                  >
                    <span aria-hidden="true" className="size-2 rounded-full bg-orange-500" />
                    <span>{tx("Добавить услугу из каталога", "Leistung aus dem Katalog hinzufügen")}</span>
                  </label>
                  {draft.specialties.length === 0 ? (
                    <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-order-service-needs-specialty">
                      <CircleAlert aria-hidden="true" className="mt-[3px]" />
                      <span className="min-w-0 leading-5">
                        {tx(
                          "Сначала выберите специализацию: от неё зависят услуги и смета.",
                          "Bitte zuerst eine Fachrichtung auswählen: Leistungen und Kostenvoranschlag hängen davon ab.",
                        )}
                        <button
                          type="button"
                          className="ml-2 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          onClick={() => openValidationIssue({
                            key: "specialties",
                            step: "order",
                            message: tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
                            fieldId: SERVICE_SPECIALTIES_ID,
                          })}
                        >
                          {tx("К специализации", "Zur Fachrichtung")}
                        </button>
                      </span>
                    </StatusChip>
                  ) : null}
                  <NativeComboboxSelect
                    id={ORDER_SERVICE_SELECT_ID}
                    aria-label={tx("Выбрать услугу из каталога", "Leistung aus dem Katalog auswählen")}
                    name="agency_service"
                    value=""
                    onChange={(event) => addAgencyService(event.target.value)}
                    className={cn(selectClass, "w-full md:max-w-2xl")}
                  >
                    <option value="">{tx("Выберите услугу и цену", "Leistung und Preis auswählen")}</option>
                    {agencyServices.map((service) => {
                      const priceChoices = listAgencyServicePriceChoices(
                        service,
                        draft.programDateFrom || undefined,
                      );
                      const alreadySelected = lines.some(
                        (line) => line.agencyServiceId === service.id,
                      );
                      return (
                        <optgroup key={service.id} label={agencyCatalogItemName(service, t, lang)}>
                          {priceChoices.map((price) => (
                            <option
                              key={price.id || `${service.id}-catalog-price`}
                              value={servicePriceOptionValue(service.id, price.id)}
                              disabled={
                                alreadySelected
                                || (!price.id && !price.is_effective)
                                || price.currency.toUpperCase()
                                  !== "EUR"
                              }
                            >
                              {servicePriceChoiceLabel(price)} / {serviceBillingUnitLabel(service.unit_label, tx)}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </NativeComboboxSelect>
                </div>
                {orderServiceLines.length > 0 ? (
                  <OrderCatalogServicesTable lines={orderServiceLines} catalogById={agencyServiceById} effectiveOn={draft.programDateFrom || undefined} lang={lang} tx={tx} disabled={isBusy}
                    describe={resolvedServiceCatalogDescription} selectedPriceId={selectedAgencyServicePriceId}
                    onQuantityChange={(line, quantity) => { setCommercialSaveFeedback(null); updateLine(line.id, { quantity }); }}
                    onPriceChange={(line, service, priceId) => applyAgencyServicePrice(line.id, service, priceId)}
                    onDelete={setDeleteServiceLine} totals={orderServicesEstimate} />
                ) : null}
              </Section>
              <div id={ORDER_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Документ заказа", "Einzelauftrag")}
                  accessory={leadConverted ? null : (
                    <Button type="button" variant="default" size="sm" className="h-8 rounded-lg" disabled={isBusy || !lines.some(validLine)} aria-describedby={!lines.some(validLine) ? "lead-order-document-needs-services" : undefined} onClick={() => void generateCommercialDocument("single_order")}>
                      {busy === "generate-single_order" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {commercialDocuments.single_order.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                    </Button>
                  )}
                >
                {!leadConverted && !lines.some(validLine) ? (
                  <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" id="lead-order-document-needs-services" data-testid="lead-order-document-needs-services">
                    <CircleAlert aria-hidden="true" className="mt-0.5" />
                    <span className="min-w-0 leading-5">
                      {lines.length > 0
                        ? tx("Проверьте позиции заказа: нужна хотя бы одна услуга с описанием, количеством больше нуля, корректной ценой и НДС.", "Prüfen Sie die Auftragspositionen: Mindestens eine Leistung mit Beschreibung, einer Menge größer als null sowie gültigem Preis und Steuersatz ist erforderlich.")
                        : draft.specialties.length === 0
                          ? tx("Сначала выберите специализацию и добавьте хотя бы одну услугу в «Позиции заказа» — после этого можно создать документ заказа.", "Wählen Sie zuerst eine Fachrichtung und fügen Sie unter „Auftragspositionen“ mindestens eine Leistung hinzu. Danach kann der Einzelauftrag erstellt werden.")
                          : tx("Сначала добавьте хотя бы одну услугу в «Позиции заказа» — после этого можно создать документ заказа.", "Fügen Sie unter „Auftragspositionen“ zuerst mindestens eine Leistung hinzu. Danach kann der Einzelauftrag erstellt werden.")}
                      <button
                        type="button"
                        className="ml-2 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        onClick={() => openValidationIssue({
                          key: "order-service",
                          step: draft.specialties.length === 0 && lines.length === 0 ? "order" : "commercial",
                          message: "",
                          fieldId: draft.specialties.length === 0 && lines.length === 0 ? SERVICE_SPECIALTIES_ID : ORDER_SERVICE_SELECT_ID,
                        })}
                      >
                        {draft.specialties.length === 0 && lines.length === 0 ? tx("К специализации", "Zur Fachrichtung") : tx("К позициям заказа", "Zu den Auftragspositionen")}
                      </button>
                    </span>
                  </StatusChip>
                ) : null}
                <WizardDocumentRows
                  documents={commercialDocuments.single_order}
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
                {isRepeatIntake && commercialDocuments.single_order.length > 0 && readinessChecks.get("order_document_generated") === false ? <Banner tone="warning">{tx("Заказ изменён. Создайте актуальную версию документа и подтвердите подписи заново.", "Der Auftrag wurde geändert. Erstellen Sie die aktuelle Dokumentversion und bestätigen Sie die Unterschriften erneut.")}</Banner> : null}
                {renderCommercialDocumentError("single_order")}
                </Section>
              </div>
              {renderPayerSignatureFlow(true)}
              <div id={ORDER_SIGNATURES_ID} tabIndex={-1} className="focus:outline-none">
              <Section className={WIZARD_DOCUMENT_SECTION_CLASS} title={tx("Подписи", "Unterschriften")}>
                <div className="space-y-3">
                {/* Owner decision 2026-10-12 (QA C2-14): the client's signature of the
                    order counts only with proof — the scan of the signed copy or a QES
                    (inside the contract package during intake) — never one click. */}
                {(() => {
                  // QA C3-01: a version made before the last change of the
                  // services or the period no longer records the signature.
                  const termsChangedAt = order?.client_signature?.terms_changed_at;
                  const { needsDocument, documentToSign, manualOnly } = orderClientSignatureState(
                    commercialDocuments.single_order.filter((document) => (
                      Boolean(document.signed_at)
                      || documentMatchesOrderTerms(document.created_at, termsChangedAt)
                    )),
                    signedPatient,
                  );
                  const signedVersionNote = clientSignatureNote(
                    order?.client_signature,
                    signedPatient,
                    order?.total_estimated,
                  );
                  return (
                    <div
                      data-testid="lead-order-client-signature"
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 bg-card p-3"
                    >
                      <div className="min-w-0 flex-1 basis-96 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-medium text-muted-foreground">{tx("Клиент", "Kunde")}</span>
                          <StatusChip tone={demoSignatureChecks.includes("order_signed_patient") ? "info" : signedPatient ? "success" : "warning"}>
                            {signedPatient ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
                            {demoSignatureChecks.includes("order_signed_patient")
                              ? tx("DEV · Клиент подписал тестовый заказ", "DEV · Kunde hat den Testauftrag unterzeichnet")
                              : signedPatient
                                ? tx("Клиент подписал заказ", "Auftrag vom Kunden unterzeichnet")
                                : tx("Юридическая подпись заказа ещё не подтверждена", "Rechtswirksame Auftragsunterschrift noch nicht bestätigt")}
                          </StatusChip>
                        </div>
                        {needsDocument && !manualOnly && !signedPatient && !demoSignatureChecks.includes("order_signed_patient") ? (
                          <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-order-signature-needs-document">
                            <CircleAlert aria-hidden="true" className="mt-0.5" />
                            <span className="min-w-0 leading-5">
                              {tx(
                                "Сначала создайте документ заказа. Юридическое подтверждение — завершённое электронное подписание пакета или скан подписанного экземпляра.",
                                "Erstellen Sie zuerst den Einzelauftrag. Als rechtswirksamer Nachweis gilt die abgeschlossene elektronische Paketunterzeichnung oder der Scan des unterschriebenen Exemplars.",
                              )}
                              <button
                                type="button"
                                className="ml-2 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                                onClick={() => openValidationIssue({ key: "order-document", step: "commercial", message: "", fieldId: ORDER_DOCUMENT_ID })}
                              >
                                {tx("К документу заказа", "Zum Einzelauftrag")}
                              </button>
                            </span>
                          </StatusChip>
                        ) : (
                        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          {demoSignatureChecks.includes("order_signed_patient")
                            ? tx("Тестовая подпись зачтена для оформления на DEV.", "Testunterschrift für die Aufnahme auf DEV angerechnet.")
                            : manualOnly
                            ? tx(
                                "Отмечено вручную, подписанный документ заказа отсутствует. Отметка продолжает действовать; загрузите скан подписанного экземпляра.",
                                "Manuell markiert, kein unterschriebener Einzelauftrag vorhanden. Die Markierung zählt weiterhin; laden Sie den Scan des unterschriebenen Exemplars hoch.",
                              )
                            : signedPatient
                              ? tx("По подписанному документу заказа.", "Laut unterschriebenem Einzelauftrag.")
                              : tx(
                                    "Юридическое подтверждение — завершённое электронное подписание пакета или скан подписанного экземпляра («Подписано на бумаге»). Тестовая подпись (DEMO) подписью заказа не считается.",
                                    "Als rechtswirksamer Nachweis gilt die abgeschlossene elektronische Paketunterzeichnung oder der Scan des unterschriebenen Exemplars („Auf Papier unterschrieben“). Eine Testunterschrift (DEMO) gilt nicht als Auftragsunterschrift.",
                                  )}
                        </p>
                        )}
                        {signedVersionNote ? (
                          <p
                            data-testid="lead-order-signed-version"
                            className={cn(
                              "text-xs",
                              signedVersionNote.tone === "warning"
                                ? "text-amber-800 dark:text-amber-300"
                                : "text-muted-foreground",
                            )}
                          >
                            {signedVersionNote.text}
                          </p>
                        ) : null}
                      </div>
                      {documentToSign && !demoSignatureChecks.includes("order_signed_patient") ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <PaperSignatureConfirmButton
                            documentId={documentToSign.id}
                            title={wizardDocumentFilename(documentToSign)}
                            lang={lang}
                            size="sm"
                            label={tx("Подписано на бумаге", "Auf Papier unterschrieben")}
                            // Off while the server would refuse it (the document is older than the order).
                            disabled={isBusy || Boolean(paperSignatureBlocker(documentToSign))}
                            errorText={(error) => wizardSignatureErrorText(error, tx)}
                            errorAction={signatureErrorJump}
                            onDone={() => {
                              // The scan signs the order for the client on the server: the
                              // agency checkbox opens at once, not after the refresh lands
                              // (QA 2026-10-25, M F-6: the first click on it was lost).
                              setSignedPatient(true);
                              void refreshDocumentsState();
                            }}
                          />
                          {paperSignatureBlocker(documentToSign) ? (
                            <span className="text-xs text-amber-800 dark:text-amber-300" data-testid="lead-order-paper-signature-blocked">
                              {paperSignatureBlocker(documentToSign)}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
                <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-muted-foreground">GMED</span>
                    <StatusChip tone={demoSignatureChecks.includes("order_signed_agency") ? "info" : signedAgency ? "success" : "warning"}>
                      {signedAgency ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
                      {demoSignatureChecks.includes("order_signed_agency") ? tx("DEV · GMED подписал тестовый заказ", "DEV · GMED hat den Testauftrag unterzeichnet") : signedAgency ? tx("Подтверждено", "Bestätigt") : tx("Ожидает подтверждения", "Bestätigung ausstehend")}
                    </StatusChip>
                  </div>
                {demoSignatureChecks.includes("order_signed_agency")
                  ? null
                  : <ToggleRow
                  checked={signedAgency}
                  // The server confirms the agency's side only after the client
                  // signed (409 before; walk-through 2026-10-24); a mark made
                  // stays removable.
                  disabled={isBusy || agencyOrderConfirmationBlocked(signedPatient, signedAgency)}
                  onChange={(checked) => {
                    setSignedAgency(checked);
                    void saveFlags(
                      { signed_agency: checked },
                      { signed_agency: signedAgency },
                    );
                  }}
                  label={tx("Агентство подтвердило заказ", "Auftrag von der Agentur bestätigt")}
                />}
                  {agencyOrderConfirmationBlocked(signedPatient, signedAgency) && !demoSignatureChecks.includes("order_signed_agency") ? (
                    <div data-testid="lead-order-agency-confirmation-hint" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span>{tx("Доступно после подписи клиента: сначала подтвердите подпись заказа клиентом (выше).", "Verfügbar nach der Unterschrift des Kunden: zuerst die Auftragsunterschrift des Kunden bestätigen (oben).")}</span>
                    </div>
                  ) : null}
                </div>
                </div>
              </Section>
              </div>
              <div id={QUOTE_SECTION_ID} tabIndex={-1} className="focus:outline-none">
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Смета и предоплата", "Kostenvoranschlag und Vorauszahlung")}
                accessory={(
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={isBusy || !lines.some(validLine)}
                    title={quote
                      ? tx("Обновить смету по текущим услугам и ценам", "Kostenvoranschlag mit aktuellen Leistungen und Preisen aktualisieren")
                      : tx("Сформировать смету по текущим услугам и ценам", "Kostenvoranschlag aus aktuellen Leistungen und Preisen erstellen")}
                    onClick={() => void createOrAcceptQuote(false)}
                  >
                    {busy === "quote" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    {quote ? tx("Пересчитать", "Neu berechnen") : tx("Сформировать смету", "Kostenvoranschlag erstellen")}
                  </Button>
                )}
              >
                <div className="rounded-xl border border-border/60 bg-card p-3">
                  {estimatedOutlaysLine ? (
                    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                      <Field
                        className="w-full min-w-0 sm:w-56"
                        label={tx("Предполагаемые расходы", ESTIMATED_OUTLAYS_DESCRIPTION)}
                      >
                        <div className="relative">
                          <Input
                            id="lead-wizard-estimated-outlays"
                            aria-label={tx("Предполагаемые расходы", ESTIMATED_OUTLAYS_DESCRIPTION)}
                            className={cn(inputClass, "h-9 bg-card pr-10 font-mono tabular-nums text-foreground")}
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={estimatedOutlaysLine.price}
                            onChange={(event) => {
                              setCommercialSaveFeedback(null);
                              updateLine(estimatedOutlaysLine.id, { price: event.target.value });
                            }}
                            disabled={isBusy}
                            placeholder="0.00"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted-foreground">
                            €
                          </span>
                        </div>
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isBusy}
                        title={tx("Удалить предполагаемые расходы", "Voraussichtliche Auslagen entfernen")}
                        aria-label={tx("Удалить предполагаемые расходы", "Voraussichtliche Auslagen entfernen")}
                        onClick={() => setDeleteServiceLine(estimatedOutlaysLine)}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                      <StatusChip tone="warning" className="mb-0.5 rounded-lg px-2.5 py-1">
                        <Info aria-hidden="true" />
                        <span>
                        {tx(
                          "Будет добавлено последней строкой сметы без НДС.",
                          "Wird als letzte Position des Kostenvoranschlags ohne MwSt. ausgewiesen.",
                        )}
                        </span>
                      </StatusChip>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={isBusy || !leadId}
                      onClick={addEstimatedOutlays}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      {tx("Добавить предполагаемые расходы", "Voraussichtliche Auslagen hinzufügen")}
                    </Button>
                  )}
                </div>
                {quote ? (
                  <dl className="flex flex-wrap gap-2">
                    <div className="min-w-36 rounded-lg border border-border/60 bg-card px-3 py-2">
                      <dt className="font-mono text-xs font-medium text-muted-foreground">
                        {tx("Статус", "Status")}
                      </dt>
                      <dd className="mt-1 text-xs font-medium text-foreground">
                        <StatusChip tone={quote.status === "accepted" ? "success" : quote.status === "sent" ? "info" : quote.status === "rejected" ? "error" : quote.status === "draft" || quote.status === "expired" ? "warning" : "neutral"}>
                          {/* Same quote status labels as the contracts page. */}
                          {(
                            {
                              draft: t.revenue_quote_status_draft,
                              sent: t.revenue_quote_status_sent,
                              accepted: t.revenue_quote_status_accepted,
                              rejected: t.revenue_quote_status_rejected,
                              expired: t.revenue_quote_status_expired,
                              superseded: t.revenue_quote_status_superseded,
                            } as Record<string, string>
                          )[quote.status] ?? quote.status}
                        </StatusChip>
                      </dd>
                    </div>
                    <div className="min-w-36 rounded-lg border border-border/60 bg-card px-3 py-2">
                      <dt className="font-mono text-xs font-medium text-muted-foreground">
                        {tx("Сумма", "Betrag")}
                      </dt>
                      <dd className="mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-300">
                        {formatMoneyLabel(quoteTotal)}
                      </dd>
                    </div>
                    <div className="min-w-36 rounded-lg border border-border/60 bg-card px-3 py-2">
                      <dt className="font-mono text-xs font-medium text-muted-foreground">
                        {tx("Предоплата", "Vorauszahlung")}
                      </dt>
                      <dd className="mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-sky-800 dark:text-sky-300">
                        {formatMoneyLabel(persistedPrepayment)}
                      </dd>
                    </div>
                    <div className="min-w-36 rounded-lg border border-border/60 bg-card px-3 py-2">
                      <dt className="font-mono text-xs font-medium text-muted-foreground">
                        {tx("Остаток", "Restbetrag")}
                      </dt>
                      <dd className={cn("mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums", quoteTotal > persistedPrepayment ? "text-amber-900 dark:text-amber-200" : "text-emerald-800 dark:text-emerald-300")}>
                        {formatMoneyLabel(Math.max(quoteTotal - persistedPrepayment, 0))}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                <div className="space-y-3 rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ToggleRow
                      checked={prepayment}
                      disabled={isBusy}
                      onChange={(checked) => {
                        setPrepayment(checked);
                        const nextAmount = checked
                          ? prepaymentAmount || (quote ? quoteTotal.toFixed(2) : "")
                          : prepaymentAmount;
                        if (checked && nextAmount !== prepaymentAmount) {
                          setPrepaymentAmount(nextAmount);
                        }
                        void saveFlags(
                          {
                            prepayment_required: checked,
                            ...(checked && nextAmount ? { prepayment_amount: nextAmount } : {}),
                          },
                          {
                            prepayment_required: prepayment,
                            prepayment_amount: prepaymentAmount,
                          },
                        );
                      }}
                      label={tx("Требуется предоплата", "Vorauszahlung erforderlich")}
                    />
                    {prepayment && quote ? (
                      <StatusChip tone="warning">
                        <ReceiptText aria-hidden="true" />
                        <span>{tx("Осталось получить", "Noch zu erhalten")}:</span>
                        <span className="font-mono font-semibold tabular-nums">{formatMoneyLabel(prepaymentRemaining, quote.currency)}</span>
                      </StatusChip>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {prepayment ? (
                      <Field className="w-full sm:w-56" label={tx("Необходимая предоплата", "Erforderliche Vorauszahlung")}>
                        <Input
                          id={PREPAYMENT_AMOUNT_ID}
                          className={cn(inputClass, "h-9 bg-card font-mono tabular-nums text-foreground")}
                          inputMode="decimal"
                          min="0.01"
                          max={quote ? quoteTotal : undefined}
                          step="0.01"
                          value={prepaymentAmount}
                          onChange={(event) => setPrepaymentAmount(event.target.value)}
                          onBlur={() => {
                            const normalizedAmount = prepaymentAmount.trim();
                            if (order?.id && normalizedAmount && validMoneyInput(normalizedAmount)) {
                              void saveFlags(
                                { prepayment_amount: normalizedAmount },
                                { prepayment_amount: String(order.prepayment_amount ?? "") },
                                { background: true },
                              );
                            }
                          }}
                          disabled={isBusy}
                          placeholder="0.00"
                        />
                      </Field>
                    ) : null}
                    {prepayment ? (
                      <Field className="w-full sm:w-56" label={tx("Внести предоплату до", "Vorauszahlung fällig bis")}>
                        <Input
                          type="datetime-local"
                          id="lead-wizard-prepayment-deadline"
                          aria-label={tx("Внести предоплату до", "Vorauszahlung fällig bis")}
                          value={prepaymentDeadline}
                          className={cn(inputClass, "h-9 bg-card text-foreground")}
                          onChange={(event) => setPrepaymentDeadline(event.target.value)}
                          onBlur={() => {
                            const deadline = prepaymentDeadline ? parseBerlinLocalInput(prepaymentDeadline) : null;
                            if (prepaymentDeadline && !deadline) return;
                            const nextDueAt = deadline?.toISOString() ?? "";
                            if (localDeadline(order?.prepayment_due_at) === prepaymentDeadline) return;
                            void saveFlags(
                              { prepayment_due_at: nextDueAt },
                              { prepayment_due_at: order?.prepayment_due_at ?? "" },
                              { background: true },
                            );
                          }}
                          disabled={isBusy}
                        />
                      </Field>
                    ) : null}
                    {/* Received prepayment is recorded through patient invoices, outside the lead wizard. */}
                    {!acceptedQuote ? (
                      <div className="flex w-full items-center sm:w-auto">
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 w-fit bg-[var(--brand)] text-white hover:brightness-95"
                          disabled={isBusy || !quote || !quoteIsCurrent || estimateDocumentOutdated}
                          aria-describedby={estimateDocumentOutdated ? "lead-wizard-estimate-outdated" : undefined}
                          onClick={() => void createOrAcceptQuote(true)}
                        >
                          {busy === "accept" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                          {tx("Подтвердить смету", "Kostenvoranschlag annehmen")}
                        </Button>

                      </div>
                    ) : null}
                  </div>

                  {!acceptedQuote && estimateDocumentOutdated ? (
                    // The amounts may be right: the PDF of the estimate prints the
                    // prepayment and was made before its last change (DEV 2026-10-29).
                    <div id="lead-wizard-estimate-outdated" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                      <span className="flex min-w-0 flex-1 basis-80 items-start gap-2"><Info aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>{tx("Документ сметы создан до последнего изменения сумм или предоплаты — создайте новую версию документа.", "Das Dokument des Kostenvoranschlags stammt von vor der letzten Änderung der Beträge oder der Vorauszahlung – erstellen Sie eine neue Version.")}</span></span>
                      <Button type="button" variant="default" size="sm" className="h-8 shrink-0 bg-[var(--brand)] text-white hover:brightness-95" disabled={isBusy || !lines.some(validLine)} data-testid="lead-wizard-estimate-new-version"
                        onClick={() => void generateCommercialDocument("order_cost_estimate")}>
                        {busy === "generate-order_cost_estimate" ? <LoaderCircle className="size-3 animate-spin" /> : <FileText className="size-3" />}
                        {tx("Создать новую версию", "Neue Version erstellen")}
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2" role="status">
                  {prepayment && order?.payment_tracking ? (
                    <StatusChip tone="info"><CalendarDays aria-hidden="true" />
                      {paymentStatusLabel(order.payment_tracking.status, lang)}
                    </StatusChip>
                  ) : null}
                  <StatusChip tone={quoteAndPrepaymentReady ? "success" : "warning"}>
                    {quoteAndPrepaymentReady ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
                    {quoteStateLabel}
                  </StatusChip>
                  </div>
                </div>
                {commercialQuoteError ? (
                  <div role="alert" aria-live="polite" className="space-y-3 rounded-xl border border-destructive/25 bg-card p-3">
                    <div className="flex items-start gap-2">
                      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <div className="min-w-0 space-y-1 text-sm leading-6">
                        <p className="font-semibold text-destructive">
                          {tx("Не удалось обновить смету", "Kostenvoranschlag konnte nicht aktualisiert werden")}
                        </p>
                        <p className="text-foreground">{commercialQuoteError}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
                        <FileText aria-hidden="true" />{tx("Смета", "Kostenvoranschlag")}: {quote?.quote_number || tx("ещё не создана", "noch nicht erstellt")}
                      </StatusChip>
                      <StatusChip tone="info">
                        <ReceiptText aria-hidden="true" />{tx("Итого", "Gesamt")}: <span className="font-mono font-semibold tabular-nums">{formatMoneyLabel(quote ? quoteTotal : estimate.gross)}</span>
                      </StatusChip>
                      <StatusChip tone={prepayment && validMoneyInput(prepaymentAmount.trim()) && toCents(money(prepaymentAmount)) > toCents(estimate.gross) ? "error" : "warning"}>
                        <ReceiptText aria-hidden="true" />{tx("Предоплата", "Vorauszahlung")}: <span className="font-mono font-semibold tabular-nums">{prepayment
                          ? prepaymentAmount.trim()
                            ? formatMoneyLabel(money(prepaymentAmount))
                            : tx("сумма не указана", "Betrag fehlt")
                          : tx("не требуется", "nicht erforderlich")}</span>
                      </StatusChip>
                    </div>
                  </div>
                ) : null}
              </Section>
              </div>
              <div id={ORDER_COST_ESTIMATE_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Смета к заказу", "Kostenvoranschlag zum Einzelauftrag")}
                  accessory={leadConverted ? null : (
                    <Button type="button" variant="default" size="sm" className="h-8 rounded-lg" disabled={isBusy || !lines.some(validLine)} onClick={() => void generateCommercialDocument("order_cost_estimate")}>
                      {busy === "generate-order_cost_estimate" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {commercialDocuments.order_cost_estimate.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                    </Button>
                  )}
                >
                {commercialDocuments.order_cost_estimate.length === 0 ? (
                  <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-order-estimate-not-created">
                    <CircleAlert aria-hidden="true" className="mt-0.5" />
                    <span className="min-w-0 font-semibold leading-5">{tx("Смета к заказу ещё не создана", "Kostenvoranschlag zum Einzelauftrag wurde noch nicht erstellt")}</span>
                  </StatusChip>
                ) : null}
                <WizardDocumentRows
                  documents={commercialDocuments.order_cost_estimate}
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
                {isRepeatIntake && commercialDocuments.order_cost_estimate.length > 0 && readinessChecks.get("order_cost_estimate_document_generated") === false ? <Banner tone="warning">{tx("Смета к заказу устарела. Создайте актуальную версию.", "Der Kostenvoranschlag zum Auftrag ist veraltet. Erstellen Sie eine aktuelle Version.")}</Banner> : null}
                {renderCommercialDocumentError("order_cost_estimate")}
                </Section>
              </div>
              <div id={COST_ESTIMATE_DOCUMENT_ID} tabIndex={-1} className="focus:outline-none">
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Предварительный расчёт медицинских расходов", "Vorläufige medizinische Kostenkalkulation")}
                  accessory={leadConverted ? null : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={isBusy || costEstimateStatus !== "ready"}
                      aria-describedby={costEstimateHint ? `${COST_ESTIMATE_DOCUMENT_ID}-hint` : undefined}
                      onClick={() => void generateCommercialDocument("cost_estimate")}
                      variant="default"
                    >
                      {busy === "generate-cost_estimate" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {commercialDocuments.cost_estimate.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                    </Button>
                  )}
                >
                <WizardDocumentRows
                  documents={commercialDocuments.cost_estimate}
                  emptyLabel=""
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  onChanged={() => { void refreshDocumentsState(); }}
                />
                {costEstimateHint ? (
                  <div id={`${COST_ESTIMATE_DOCUMENT_ID}-hint`} className="mt-3">
                    {costEstimateStatus === "loading" ? (
                      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                        {costEstimateHint}
                      </p>
                    ) : (
                      <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2">
                        <CircleAlert aria-hidden="true" className="mt-[3px]" />
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:gap-3">
                          <span className="min-w-0 flex-1 leading-5">{costEstimateHint}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 text-xs"
                            disabled={isBusy}
                            onClick={() => openReadinessReason(COST_ESTIMATE_WORK_TYPES_REASON)}
                          >
                            {tx("Перейти к видам работ", "Zu den Leistungsarten")}
                          </Button>
                        </span>
                      </StatusChip>
                    )}
                  </div>
                ) : commercialDocuments.cost_estimate.length > 0
                  && lead?.readiness.blocking_reasons.includes(COST_ESTIMATE_OUTDATED_REASON) ? (
                  <div className="mt-3">
                    <Banner tone="warning">
                      {tx(
                        "Предварительный расчёт не отражает выбранные медицинские виды работ. Создайте новую версию.",
                        "Die vorläufige Kostenkalkulation enthält die gewählten medizinischen Leistungsarten nicht. Erstellen Sie eine neue Version.",
                      )}
                    </Banner>
                  </div>
                ) : null}
                {renderCommercialDocumentError("cost_estimate")}
                </Section>
              </div>
            </section>
          ) : null}

          {lead && step === "release" ? (
            <section className="space-y-5">
              {patientDocumentReview}
              {patientContractReview}
              <Section title={isRepeatIntake ? tx("Завершение обращения", "Anfrage abschließen") : tx("Создание пациента", "Patient anlegen")}>
                <p className="text-sm text-muted-foreground">
                  {isRepeatIntake
                    ? tx("Проверьте все этапы. После подтверждения обращение и заказ будут связаны с существующей карточкой пациента.", "Prüfen Sie alle Schritte. Nach der Bestätigung werden Anfrage und Auftrag der bestehenden Patientenakte zugeordnet.")
                    : tx("Проверьте все этапы. После подтверждения система создаст карточку пациента и перенесёт в неё данные обращения.", "Prüfen Sie alle Schritte. Nach der Bestätigung wird die Patientenakte angelegt und die Angaben aus dem Lead werden übernommen.")}
                </p>
                <div>
                  {/* The wizard's own steps: the server knows no "order" step
                      and its "service" readiness is the order step's specialties. */}
                  {(lead.readiness.steps.length > 0 ? STEPS : []).map((target) => {
                    const item = { key: target.id };
                    const ready = isStepReady(item.key);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md border-b border-border/70 px-2 py-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        disabled={isBusy || !target || target.id === step}
                        onClick={() => target && navigateToStep(target.id)}
                      >
                        <span className="text-sm text-foreground">{readinessStepLabel(item.key, tx, isRepeatIntake)}</span>
                        <span className="inline-flex shrink-0 items-center gap-2">
                          {/* As the tab bar says it: the optional medical step left empty is no "done" (owner 2026-10-22). */}
                          {ready && ((item.key === "medical" && !medicalTabFilled) || (item.key === "service" && !serviceTabFilled))
                            ? <StateMark done={false} label={tx("Необязательно, не заполнено", "Optional, nicht ausgefüllt")} />
                            : <StateMark done={ready} label={ready ? tx("Выполнено", "Erledigt") : tx("Не завершено", "Noch offen")} />}
                          <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>
              {!leadConverted && (openBlockingReasons.length > 0 || !quoteAndPrepaymentReady) ? (
                <Banner tone="warning">
                  <div className="font-medium">{tx("Что осталось заполнить", "Was noch fehlt")}: {completionBlockerCount}</div>
                  <div data-testid="completion-blockers" className="mt-2 space-y-2">
                    {STEPS.map((candidate) => {
                      const reasons = openBlockingReasons.filter((reason) => readinessReasonStep(reason) === candidate.id);
                      const quoteMissing = candidate.id === "commercial" && !quoteAndPrepaymentReady
                        && !lead.readiness.blocking_reasons.some((reason) => ["Quote is not accepted", "Required prepayment is not complete"].includes(reason));
                      if (!reasons.length && !quoteMissing) return null;
                      return (
                        <div key={candidate.id}>
                          <button
                            type="button"
                            className="text-left text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            disabled={isBusy || candidate.id === step}
                            onClick={() => navigateToStep(candidate.id)}
                          >
                            {readinessStepLabel(candidate.id, tx, isRepeatIntake)}
                          </button>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5">
                            {reasons.map((reason) => (
                              <li key={reason}>
                                <button
                                  type="button"
                                  className="block text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  disabled={isBusy}
                                  onClick={() => openReadinessReason(reason)}
                                >
                                  {readinessReasonText(reason, tx, draftIsMinor, lead.readiness)}
                                </button>
                              </li>
                            ))}
                            {quoteMissing ? (
                              <li>
                                <button type="button" className="block text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={isBusy} onClick={() => openReadinessReason("Quote is not accepted")}>
                                  {quoteStateLabel}
                                </button>
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </Banner>
              ) : null}
              {leadConverted ? null : (
              <label className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <input
                  type="checkbox"
                  className={cn(checkboxClass, "mt-0.5")}
                  checked={conversionConfirmed}
                  disabled={isBusy}
                  onChange={(event) => setConversionConfirmed(event.target.checked)}
                />
                <span className="text-sm leading-5 text-foreground">
                  {isRepeatIntake ? tx(
                    "Я проверил данные повторного обращения. Документы, медицинские данные и заказ будут связаны с существующей карточкой пациента.",
                    "Ich habe die erneute Anfrage geprüft. Unterlagen, medizinische Daten und Auftrag werden der bestehenden Patientenakte zugeordnet.",
                  ) : tx(
                    "Я проверил данные обращения и подтверждаю, что пациента можно создать. Данные, документы, медицинская характеристика, услуги и заказ будут перенесены в карточку пациента.",
                    "Ich habe die Angaben geprüft und bestätige, dass der Patient angelegt werden kann. Daten, Dokumente, medizinische Merkmale, Leistungen und Auftrag werden in die Patientenakte übernommen.",
                  )}
                </span>
              </label>
              )}
            </section>
          ) : null}
          </ReadOnlyScope>
          </fieldset>
        </main>
        {draft ? (
          <footer className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {error || autosaveStatus === "error" ? (
              <div role="alert" className="mb-3 flex max-h-28 items-start gap-2 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  {autosaveStatus === "error" ? (
                    <>
                      <p className="font-medium">{tx("Изменения не сохранены", "Änderungen nicht gespeichert")}</p>
                      {autosaveError || error ? <p className="mt-0.5">{autosaveError || error}</p> : null}
                      {/* QA C3-03: the user reads the translated text; the request and
                          the server's own words stay folded for support. */}
                      {autosaveErrorDetail ? (
                        <details data-testid="lead-autosave-error-detail" className="mt-1 text-[10px] opacity-70">
                          <summary className="cursor-pointer select-none">
                            {tx("Подробности для поддержки", "Details für den Support")}
                          </summary>
                          <p className="mt-0.5 break-all font-mono">{autosaveErrorDetail}</p>
                        </details>
                      ) : null}
                    </>
                  ) : error}
                  {existingParentPatientId ? <StaffLink to={`/patients/${encodeURIComponent(existingParentPatientId)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")} onClick={() => onOpenChange(false)}>{tx("Открыть пациента", "Patientenakte öffnen")}</StaffLink> : null}
                </div>
                {autosaveStatus === "error" ? (
                  <Button type="button" variant="default" size="xs" disabled={isBusy || loading} onClick={() => void save()}>
                    <RefreshCw aria-hidden="true" className="size-3" />
                    {tx("Повторить", "Erneut versuchen")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {step === "commercial" && visibleCommercialSaveFeedback ? (
              <div role={visibleCommercialSaveFeedback.tone === "error" ? "alert" : "status"} className="mb-3 max-h-28 overflow-y-auto text-xs">
                <div className={cn("rounded-lg border px-3 py-2", visibleCommercialSaveFeedback.tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : visibleCommercialSaveFeedback.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                  {visibleCommercialSaveFeedback.message}
                </div>
              </div>
            ) : null}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-x-3">
                <span>{tx("Этап", "Schritt")} {stepIndex + 1} {tx("из", "von")} {STEPS.length}</span>
                {lead && !leadConverted && step !== "release" && completionBlockerCount > 0 ? (
                  <button
                    type="button"
                    data-testid="completion-blocker-count"
                    className="font-medium text-amber-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={loading || isBusy}
                    onClick={() => navigateToStep("release")}
                  >
                    {isRepeatIntake ? tx("До завершения обращения осталось", "Bis zum Abschluss offen") : tx("До создания пациента осталось", "Bis zur Patientenanlage offen")}: {completionBlockerCount}
                  </button>
                ) : lead && !leadConverted && step !== "release" && conversionReady ? (
                  <span className="font-medium text-emerald-700">{isRepeatIntake ? tx("Обращение можно завершить", "Anfrage kann abgeschlossen werden") : tx("Пациента можно создать", "Patient kann angelegt werden")}</span>
                ) : null}
              </span>
              <span role="status" className="inline-flex items-center gap-1.5">
                {leadConverted ? tx("Только чтение: пациент создан", "Nur Lesen: Patient angelegt")
                  : autosaveStatus === "error" ? null : autosaveStatus === "saving" || commercialFlagsBusyCount + commercialFlagsBackgroundCount > 0 ? (
                    <><LoaderCircle aria-hidden="true" className="size-3 animate-spin" />{tx("Сохранение…", "Wird gespeichert…")}</>
                  ) : !leadId ? tx("Обращение создастся при переходе далее", "Der Lead wird beim Weitergehen angelegt")
                  : autosaveStatus === "dirty" || prepaymentDeadlineUnsaved ? tx("Есть несохранённые изменения", "Ungespeicherte Änderungen")
                    : autosaveStatus === "saved" ? (
                      <><Check aria-hidden="true" className="size-3 text-emerald-700" />{tx("Данные сохранены", "Daten gespeichert")}</>
                    ) : null}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" className="h-9" disabled={!previousStep || loading || isBusy} onClick={() => previousStep && navigateToStep(previousStep.id)}>
                <ArrowLeft aria-hidden="true" className="size-3.5" />
                {tx("Назад", "Zurück")}
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {validationIssues.length > 0 ? (
                  <Button type="button" variant="link" size="sm" className="text-destructive" disabled={isBusy} onClick={() => openValidationIssue(validationIssues[0])}>
                    {tx("Требуют внимания", "Bitte prüfen")}: {validationIssues.length}
                  </Button>
                ) : null}
                {step === "commercial" && !leadConverted ? (
                  <Button type="button" className="h-9" aria-label={tx("Сохранить договор и заказ", "Vertrag und Auftrag speichern")} disabled={loading || isBusy} onClick={() => void prepareCommercial()}>
                    {busy === "commercial" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
                    <span className="sm:hidden">{tx("Сохранить", "Speichern")}</span>
                    <span className="hidden sm:inline">{tx("Сохранить договор и заказ", "Vertrag und Auftrag speichern")}</span>
                  </Button>
                ) : null}
                {nextStep ? (
                  <Button type="button" variant="default" className="h-9" disabled={loading || isBusy} onClick={() => navigateToStep(nextStep.id)}>
                    {busy === "save" || busy === "intake" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
                    {step === "commercial" ? tx("Проверить готовность", "Bereitschaft prüfen") : tx("Далее", "Weiter")}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Button>
                ) : leadConverted && lead?.converted_patient_id ? (
                  <StaffLink
                    to={`/patients/${encodeURIComponent(lead.converted_patient_id)}`}
                    className={cn(buttonVariants({ size: "sm" }), "h-9")}
                    data-testid="lead-wizard-open-patient"
                    onClick={() => onOpenChange(false)}
                  >
                    <UserRoundCheck aria-hidden="true" className="size-4" />
                    {tx("Открыть карточку пациента", "Patientenakte öffnen")}
                  </StaffLink>
                ) : (
                  <Button type="button" className="h-9" disabled={loading || isBusy || !conversionReady || !conversionConfirmed} onClick={() => void convert()}>
                    {busy === "convert" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <UserRoundCheck aria-hidden="true" className="size-4" />}
                    {isRepeatIntake ? tx("Завершить обращение", "Anfrage abschließen") : tx("Создать пациента", "Patient anlegen")}
                  </Button>
                )}
              </div>
            </div>
          </footer>
        ) : error ? <div role="alert" className="shrink-0 border-t border-border p-4"><Banner tone="error">{error}</Banner></div> : null}
      </DialogContent>
      </Dialog>
      {/* The AML form opened from another step: the payer's funds part still reaches its slot. */}
      <Sheet open={amlSheetOpen} onOpenChange={setAmlSheetOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-none gap-0 border-l border-border p-0 sm:max-w-3xl"
        >
          {draft ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitAmlEnhancedDueDiligence}>
              <AdminSheetScaffold
                title={enhancedCheckTitle(tx)}
                footer={(
                  <SheetFormFooter
                    cancelLabel={tx("Отмена", "Abbrechen")}
                    submitLabel={wizardDocuments.enhanced_due_diligence.length > 0
                      ? tx("Сохранить и создать новую версию", "Speichern und neue Version erstellen")
                      : tx("Сохранить и создать документ", "Speichern und Dokument erstellen")}
                    submittingLabel={tx("Создание документа", "Dokument wird erstellt")}
                    submitting={busy === "generate-enhanced_due_diligence"}
                    error={amlSheetError || undefined}
                    onCancel={() => setAmlSheetOpen(false)}
                  />
                )}
                bodyClassName="bg-muted/40"
                bodyWrapperClassName="space-y-3"
              >
                <div
                  className="space-y-2 rounded-xl border border-border/50 bg-card p-3.5"
                  data-testid="lead-aml-sheet-requirement"
                >
                  <StatusChip tone={amlRequired ? "error" : "neutral"}>
                    <ShieldCheck aria-hidden="true" />
                    {enhancedCheckRequirementLabel(amlRequired, tx)}
                  </StatusChip>
                  {amlRequiredText ? (
                    <p className="text-xs leading-5 text-muted-foreground">{amlRequiredText}</p>
                  ) : null}
                  {amlHints.map((hint) => (
                    <StatusChip key={hint} tone="warning">
                      <CircleAlert aria-hidden="true" />
                      <span>{hint}</span>
                    </StatusChip>
                  ))}
                </div>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("1. Установление повышенного риска", "1. Feststellung eines erhöhten Geldwäscherisikos")}
                  </AdminSectionTitle>
                  <div className="border-y border-border/70">
                    <ToggleRow
                      checked={draft.amlEnhancedDueDiligence.internalRiskAnalysis}
                      disabled={isBusy}
                      onChange={(checked) => patchAml("internalRiskAnalysis", checked)}
                      label={tx("Внутренний анализ рисков", "Interne Risikoanalyse")}
                    />
                    <ToggleRow
                      checked={draft.amlEnhancedDueDiligence.individualReview}
                      disabled={isBusy}
                      onChange={(checked) => patchAml("individualReview", checked)}
                      label={tx("Индивидуальная оценка конкретного случая", "Individuelle Prüfung des konkreten Einzelfalls")}
                    />
                  </div>
                  <Field required label={tx("Обоснование повышенного риска", "Begründung des erhöhten Risikos")}>
                    <textarea
                      className={textareaClass}
                      required
                      rows={3}
                      value={draft.amlEnhancedDueDiligence.riskReason}
                      onChange={(event) => patchAml("riskReason", event.target.value)}
                    />
                  </Field>
                  {/* One source of funds (owner 2026-10-19): entered in the AML block of the page, printed from there; one card with its proofs. */}
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3" data-testid="lead-aml-asset-origin-card">
                    <span className="text-[13px] font-medium text-foreground">{tx("Экономические интересы и происхождение средств", "Wirtschaftliches Interesse und Herkunft der Mittel")}</span>
                    {/* The payer form's own interest and source of funds live here (owner 2026-10-19); printed as "Herkunft der eingesetzten Vermögenswerte". */}
                    <div ref={setPayerAmlSlot} data-testid="lead-wizard-payer-aml-slot" />
                    {/* Opened from another step (e.g. a new black-list country in the personal data): "Кто платит" is not mounted there. */}
                    {step !== "documents" ? renderPayerDeclarationSection(true) : null}
                    <div className="border-t border-border/60 pt-3">
                      <AssetOriginEvidenceField
                        value={draft.amlEnhancedDueDiligence.assetOriginEvidence}
                        subject={{ leadId }}
                        lang={lang}
                        disabled={isBusy}
                        onChange={(next) => patchAml("assetOriginEvidence", next)}
                      />
                    </div>
                  </div>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("Политически значимое лицо (PEP)", "Politisch exponierte Person (PeP)")}
                  </AdminSectionTitle>
                  {/* Per person (owner 2026-10-23): who answered what, and staff's review of each person. */}
                  <LeadAmlPepReviews
                    persons={amlPepPersons}
                    patient={draft.amlEnhancedDueDiligence}
                    disabled={isBusy}
                    tx={tx}
                    Toggle={ToggleRow}
                    onPatientChange={handleAmlPepChange}
                    onReviewChange={handleAmlPepReviewChange}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field required={amlPepTriggered} label={tx("Должность / функция", "Amt / Funktion")}>
                      <Input
                        className={inputClass}
                        required={amlPepTriggered}
                        value={draft.amlEnhancedDueDiligence.pepOfficeFunction}
                        onChange={(event) => patchAml("pepOfficeFunction", event.target.value)}
                      />
                    </Field>
                    <Field required={amlPepTriggered} label={tx("Происхождение активов PEP", "Herkunft der Vermögenswerte der PeP")}>
                      <Input
                        className={inputClass}
                        required={amlPepTriggered}
                        value={draft.amlEnhancedDueDiligence.pepAssetOrigin}
                        onChange={(event) => patchAml("pepAssetOrigin", event.target.value)}
                      />
                    </Field>
                  </div>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("Связи с лицами под санкциями", "Verbindungen zu sanktionierten Personen")}
                  </AdminSectionTitle>
                  <Field label={tx("Сведения о связях с лицами под санкциями", "Angaben zu Verbindungen zu sanktionierten Personen")}>
                    <textarea
                      className={textareaClass}
                      rows={2}
                      data-testid="lead-aml-sanctions-links"
                      value={draft.amlEnhancedDueDiligence.sanctionsLinks}
                      onChange={(event) => patchAml("sanctionsLinks", event.target.value)}
                    />
                  </Field>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("Третья страна с высоким риском", "Drittstaat mit hohem Risiko")}
                  </AdminSectionTitle>
                  <div className="border-y border-border/70">
                    <ToggleRow
                      checked={draft.amlEnhancedDueDiligence.highRiskCountryTransaction}
                      disabled={isBusy}
                      onChange={(checked) => patchAml("highRiskCountryTransaction", checked)}
                      label={tx("Операция связана с третьей страной высокого риска", "Transaktion steht im Zusammenhang mit einem Drittstaat mit hohem Risiko")}
                    />
                    <ToggleRow
                      checked={draft.amlEnhancedDueDiligence.highRiskCountryResident}
                      disabled={isBusy}
                      onChange={(checked) => patchAml("highRiskCountryResident", checked)}
                      label={tx("Контрагент проживает или зарегистрирован в такой стране", "Vertragspartner ist dort niedergelassen oder wohnhaft")}
                    />
                  </div>
                  <Field required={amlCountryFieldsRequired} label={tx("Затронутая третья страна", "Betroffener Drittstaat")}>
                    <Input
                      className={inputClass}
                      required={amlCountryFieldsRequired}
                      value={draft.amlEnhancedDueDiligence.affectedThirdCountry}
                      onChange={(event) => patchAml("affectedThirdCountry", event.target.value)}
                    />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field required={amlCountryFieldsRequired} label={tx("Дополнительная информация о контрагенте", "Zusätzliche Informationen zum Vertragspartner")}>
                      <textarea className={textareaClass} required={amlCountryFieldsRequired} rows={3} value={draft.amlEnhancedDueDiligence.additionalContractPartnerInfo} onChange={(event) => patchAml("additionalContractPartnerInfo", event.target.value)} />
                    </Field>
                    <Field label={tx("Дополнительная информация о бенефициаре", "Zusätzliche Informationen zum wirtschaftlich Berechtigten")}>
                      <textarea className={textareaClass} rows={3} value={draft.amlEnhancedDueDiligence.additionalBeneficialOwnerInfo} onChange={(event) => patchAml("additionalBeneficialOwnerInfo", event.target.value)} />
                    </Field>
                    <Field required={amlCountryFieldsRequired} label={tx("Планируемый характер деловых отношений", "Angestrebte Art der Geschäftsbeziehung")}>
                      <textarea className={textareaClass} required={amlCountryFieldsRequired} rows={3} value={draft.amlEnhancedDueDiligence.intendedBusinessRelationshipInfo} onChange={(event) => patchAml("intendedBusinessRelationshipInfo", event.target.value)} />
                    </Field>
                    <Field required={amlCountryFieldsRequired} label={tx("Активы контрагента", "Vermögenswerte des Vertragspartners")}>
                      <textarea className={textareaClass} required={amlCountryFieldsRequired} rows={3} value={draft.amlEnhancedDueDiligence.contractPartnerAssetInfo} onChange={(event) => patchAml("contractPartnerAssetInfo", event.target.value)} />
                    </Field>
                    <Field label={tx("Активы бенефициарного владельца", "Vermögenswerte des wirtschaftlich Berechtigten")}>
                      <textarea className={textareaClass} rows={3} value={draft.amlEnhancedDueDiligence.beneficialOwnerAssetInfo} onChange={(event) => patchAml("beneficialOwnerAssetInfo", event.target.value)} />
                    </Field>
                    <Field required={amlCountryFieldsRequired} label={tx("Причины конкретной операции", "Gründe der konkreten Transaktion")}>
                      <textarea className={textareaClass} required={amlCountryFieldsRequired} rows={3} value={draft.amlEnhancedDueDiligence.transactionReasons} onChange={(event) => patchAml("transactionReasons", event.target.value)} />
                    </Field>
                    <Field required={amlCountryFieldsRequired} label={tx("Планируемое использование активов", "Geplante Verwendung der eingesetzten Vermögenswerte")}>
                      <textarea className={textareaClass} required={amlCountryFieldsRequired} rows={3} value={draft.amlEnhancedDueDiligence.plannedAssetUse} onChange={(event) => patchAml("plannedAssetUse", event.target.value)} />
                    </Field>
                    {/* Chosen like «Проверил» from the same people (owner 2026-10-29); never filled in by itself. */}
                    <Field required label={tx("Согласовавший руководитель", "Zustimmende Führungskraft")}>
                      <Input className={inputClass} required list="lead-aml-managers" autoComplete="off" data-testid="lead-aml-manager" value={draft.amlEnhancedDueDiligence.managerApprovalName} onChange={(event) => patchAml("managerApprovalName", event.target.value)} />
                      <datalist id="lead-aml-managers">
                        {amlReviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.name} />)}
                      </datalist>
                    </Field>
                  </div>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("Необычная операция", "Ungewöhnliche Transaktion")}
                  </AdminSectionTitle>
                  <div className="border-y border-border/70">
                    <ToggleRow checked={draft.amlEnhancedDueDiligence.unusualComplexOrLarge} disabled={isBusy} onChange={(checked) => patchAml("unusualComplexOrLarge", checked)} label={tx("Сложная или необычно крупная операция", "Komplexe oder ungewöhnlich große Transaktion")} />
                    <ToggleRow checked={draft.amlEnhancedDueDiligence.unusualPattern} disabled={isBusy} onChange={(checked) => patchAml("unusualPattern", checked)} label={tx("Необычная схема операции", "Ungewöhnliches Transaktionsmuster")} />
                    <ToggleRow checked={draft.amlEnhancedDueDiligence.noLawfulPurpose} disabled={isBusy} onChange={(checked) => patchAml("noLawfulPurpose", checked)} label={tx("Нет очевидной законной цели", "Kein offensichtlicher rechtmäßiger Zweck")} />
                  </div>
                  <Field label={tx("Результаты проверки", "Ergebnisse der Untersuchung")}>
                    <textarea className={textareaClass} rows={3} value={draft.amlEnhancedDueDiligence.investigationResults} onChange={(event) => patchAml("investigationResults", event.target.value)} />
                  </Field>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("2. Усиленный мониторинг", "2. Verstärkte kontinuierliche Überwachung")}
                  </AdminSectionTitle>
                  <Field required label={tx("Меры постоянного мониторинга", "Maßnahmen der kontinuierlichen Überwachung")}>
                    <textarea className={textareaClass} required rows={3} value={draft.amlEnhancedDueDiligence.continuousMonitoring} onChange={(event) => patchAml("continuousMonitoring", event.target.value)} />
                  </Field>
                </section>

                <section className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5">
                  <AdminSectionTitle>
                    {tx("3. Дополнительные меры", "3. Weitere verstärkte Sorgfaltspflichten")}
                  </AdminSectionTitle>
                  <Field label={tx("Принятые дополнительные меры", "Zusätzliche getroffene Maßnahmen")}>
                    <textarea className={textareaClass} rows={3} value={draft.amlEnhancedDueDiligence.additionalMeasures} onChange={(event) => patchAml("additionalMeasures", event.target.value)} />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field required label={tx("Проверил", "Bearbeiter/in")}>
                      <Input className={inputClass} required list="lead-aml-reviewers" autoComplete="off" data-testid="lead-aml-reviewer" value={draft.amlEnhancedDueDiligence.reviewerName} onChange={(event) => patchAml("reviewerName", event.target.value)} />
                      <datalist id="lead-aml-reviewers">
                        {amlReviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.name} />)}
                      </datalist>
                    </Field>
                    <Field required label={tx("Дата проверки", "Prüfdatum")} htmlFor="lead-aml-review-date">
                      <Input id="lead-aml-review-date" className={inputClass} type="date" required value={draft.amlEnhancedDueDiligence.reviewDate} onChange={(event) => patchAml("reviewDate", event.target.value)} />
                    </Field>
                  </div>
                </section>
              </AdminSheetScaffold>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(trustedContactEditor)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeTrustedContactEditor();
        }}
      >
          {trustedContactEditor ? (
              <AdminDialogScaffold
                testId="trusted-contact-editor"
                onSubmit={saveTrustedContact}
                // The editor checks every field itself and says it at the field in the app's
                // words; the browser's own bubble came first for a mistyped e-mail (QA 2026-10-25, V-A5).
                noValidate
                title={trustedContactEditorGuardian
                  ? (editingTrustedContact
                      ? tx("Редактировать родителя или законного представителя", "Elternteil oder gesetzlichen Vertreter bearbeiten")
                      : tx("Добавить родителя или законного представителя", "Elternteil oder gesetzlichen Vertreter hinzufügen"))
                  : editingTrustedContact
                    ? tx("Редактировать контакт или представителя", "Kontakt oder Vertretung bearbeiten")
                    : tx("Добавить контакт или представителя", "Kontakt oder Vertretung hinzufügen")}
                footer={(
                  <SheetFormFooter
                    cancelLabel={tx("Отмена", "Abbrechen")}
                    submitLabel={editingTrustedContact ? tx("Сохранить", "Speichern") : tx("Добавить", "Hinzufügen")}
                    onCancel={closeTrustedContactEditor}
                  />
                )}
              >
                <p className="text-xs leading-5 text-muted-foreground">
                  {trustedContactEditorGuardian
                    ? tx(
                        "Мать, отец или законный представитель ребёнка: получает свой доступ к заявке и подписывает за ребёнка.",
                        "Mutter, Vater oder gesetzliche Vertretung des Kindes: erhält einen eigenen Zugang zur Anfrage und unterschreibt für das Kind.",
                      )
                    : tx(
                        "Контакт будет сохранён в обращении и перенесён в карточку пациента при конвертации.",
                        "Der Kontakt wird im Lead gespeichert und bei der Konvertierung in die Patientenakte übernommen.",
                      )}
                </p>
                <AdminFormSection title={tx("Данные представителя", "Angaben zur Person")}>
                <div className="grid gap-4 sm:grid-cols-2 [&>div]:min-w-0">
                  <Field
                    className="sm:col-span-2"
                    label={tx("Выбрать из пациентов или лидов", "Aus Patienten oder Leads auswählen")}
                    htmlFor="trusted-contact-candidate"
                  >
                    <NativeComboboxSelect
                      id="trusted-contact-candidate"
                      value={selectedGuardianCandidate || (trustedContactEditor.relatedPatientId ? `patient:${trustedContactEditor.relatedPatientId}` : "")}
                      className={selectClass}
                      searchPlaceholder={tx("Найти по имени, e-mail или PID", "Nach Name, E-Mail oder PID suchen")}
                      onSearchChange={setGuardianSearch}
                      missingValueLabel={() => trustedContactEditor.relatedPatientLabel || trustedContactEditor.relatedPatientId}
                      onChange={(event) => changeGuardianPatient(event.target.value)}
                    >
                      <option value="">{tx("Внести данные вручную", "Daten manuell eingeben")}</option>
                      {guardianPatients.map((patient) => (
                        <option key={`${patient.source}:${patient.id}`} value={`${patient.source}:${patient.id}`} data-search-text={`${guardianCandidateLabel(patient)} ${patient.phone ?? ""}`}>
                          {guardianCandidateLabel(patient)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                    <p className={cn(
                      "mt-1.5 text-[11.5px] leading-tight",
                      guardianPatientsError ? "text-destructive" : "text-muted-foreground",
                    )}>
                      {guardianPatientsError || (guardianPatientsLoading
                        ? tx("Загрузка представителей…", "Vertreter werden geladen…")
                        : tx("Данные выбранного человека заполнятся автоматически. Доступ к заявке выдаётся отдельно.", "Die Angaben der ausgewählten Person werden übernommen. Der Zugang zur Anfrage wird separat vergeben."))}
                    </p>
                  </Field>
                  <Field
                    required
                    className="sm:col-span-2"
                    label={tx("Имя и фамилия", "Vor- und Nachname")}
                    error={trustedContactEditorError || undefined}
                    errorId="trusted-contact-name-error"
                    htmlFor="trusted-contact-name"
                  >
                    <Input
                      id="trusted-contact-name"
                      name="name"
                      autoComplete="off"
                      className={inputClass}
                      autoFocus
                      required
                      value={trustedContactEditor.name}
                      aria-invalid={Boolean(trustedContactEditorError)}
                      aria-describedby={trustedContactEditorError ? "trusted-contact-name-error" : undefined}
                      onChange={(event) => patchTrustedContactEditor("name", event.target.value)}
                    />
                  </Field>
                  <Field label="E-Mail" error={trustedContactEmailError || undefined} errorId="trusted-contact-email-error" htmlFor="trusted-contact-email">
                    <Input
                      id="trusted-contact-email"
                      name="email"
                      className={inputClass}
                      type="email"
                      value={trustedContactEditor.email}
                      aria-invalid={Boolean(trustedContactEmailError)}
                      aria-describedby={trustedContactEmailError ? "trusted-contact-email-error" : undefined}
                      onChange={(event) => patchTrustedContactEditor("email", event.target.value)}
                    />
                    {trustedContactEmailError ? null : <EmailDomainWarning email={trustedContactEditor.email} lang={lang} />}
                    {trustedContactEmailError || !trustedContactLoginOwner ? null : (
                      <span
                        role="status"
                        data-testid="trusted-contact-email-login-warning"
                        className="mt-1 block text-xs font-normal leading-5 text-amber-800 dark:text-amber-200"
                      >
                        {contactEmailLoginWarning(trustedContactLoginOwner, tx)}
                      </span>
                    )}
                  </Field>
                  <Field label={tx("Телефон", "Telefon")} error={trustedContactPhoneError || undefined} errorId="trusted-contact-phone-error" htmlFor="trusted-contact-phone">
                    <Input
                      id="trusted-contact-phone"
                      name="phone"
                      className={inputClass}
                      type="tel"
                      value={trustedContactEditor.phone}
                      aria-invalid={Boolean(trustedContactPhoneError)}
                      aria-describedby={trustedContactPhoneError ? "trusted-contact-phone-error" : undefined}
                      onChange={(event) => patchTrustedContactEditor("phone", event.target.value)}
                    />
                  </Field>
                  <Field
                    className={trustedContactEditorGuardian ? "sm:col-span-2" : undefined}
                    label={trustedContactEditorGuardian ? tx("Кем приходится ребёнку", "Beziehung zum Kind") : tx("Кем приходится клиенту", "Beziehung zur Person")}
                    required={trustedContactEditorGuardian} error={trustedContactRelationError || undefined} errorId="trusted-contact-relation-error"
                    htmlFor="trusted-contact-relation">
                    <NativeComboboxSelect
                      id="trusted-contact-relation"
                      className={selectClass}
                      value={trustedContactEditor.relation}
                      aria-invalid={Boolean(trustedContactRelationError)}
                      aria-describedby={trustedContactRelationError ? "trusted-contact-relation-error" : undefined}
                      onChange={(event) => patchTrustedContactEditor("relation", event.target.value)}
                    >
                      <option value="">{tx("Выберите", "Auswählen")}</option>
                      {trustedContactEditor.relation && !(TRUSTED_CONTACT_RELATIONS as readonly string[]).includes(trustedContactEditor.relation) ? (
                        <option value={trustedContactEditor.relation}>{trustedContactRelationLabel(trustedContactEditor.relation, tx)}</option>
                      ) : null}
                      {/* A parent block names the specific role; legacy values remain visible until clarified. */}
                      {TRUSTED_CONTACT_RELATIONS.filter((relation) => (
                        !trustedContactEditorGuardian
                        || relation === "mother"
                        || relation === "father"
                        || relation === "guardian"
                        || relation === trustedContactEditor.relation
                      )).map((relation) => (
                        <option key={relation} value={relation}>
                          {guardianRelationOptionLabel(relation, tx, trustedContactEditorGuardian || isMinor(draft?.birthDate ?? "", new Date()))}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                    {trustedContactEditorGuardian ? (
                      // The Linda case (2026-10-22): a father entered as "Опекун" was printed as Vormund.
                      <p className="mt-1.5 text-[11.5px] leading-tight text-muted-foreground" data-testid="trusted-contact-relation-hint">
                        {tx(
                          "Для родителя выберите «Мать» или «Отец» — и тогда, когда ребёнка воспитывает один родитель (это указывается в поле «Кто представляет ребёнка»). «Опекун» — только человек, назначенный судом вместо родителей.",
                          "Für einen Elternteil „Mutter“ oder „Vater“ wählen – auch wenn ein Elternteil allein sorgeberechtigt ist (das steht im Feld „Wer vertritt das Kind“). „Vormund“ nur für eine vom Gericht bestellte Person anstelle der Eltern.",
                        )}
                      </p>
                    ) : null}
                    {trustedContactEditorGuardian
                      && trustedContactEditor.relation === "guardian"
                      && !(leadId
                        ? portalRepresentation?.custody_stated && portalRepresentation.custody === "guardian"
                        : newLeadCustody === "guardian") ? (
                      <p role="status" className="mt-1.5 text-[11.5px] leading-tight text-amber-700 dark:text-amber-300" data-testid="trusted-contact-guardian-warning">
                        {tx(
                          "В поле «Кто представляет ребёнка» не указан опекун — в документах человек будет назван опекуном (Vormund). Если это мать или отец, выберите «Мать» или «Отец».",
                          "Im Feld „Wer vertritt das Kind“ ist kein Vormund angegeben – in den Unterlagen wird die Person als Vormund bezeichnet. Handelt es sich um Mutter oder Vater, bitte „Mutter“ oder „Vater“ wählen.",
                        )}
                      </p>
                    ) : null}
                  </Field>
                  {/* `htmlFor`: inside a wrapping <label> a click on the day opened the calendar instead of the typing field. */}
                  <Field label={tx("Дата рождения", "Geburtsdatum")} error={trustedContactBirthDateError || undefined} errorId="trusted-contact-birth-date-error" htmlFor="trusted-contact-birth-date">
                    <Input
                      id="trusted-contact-birth-date"
                      name="birthDate"
                      className={inputClass}
                      type="date"
                      min={EARLIEST_BIRTH_DATE}
                      max={appDateKey()}
                      aria-invalid={Boolean(trustedContactBirthDateError)}
                      aria-describedby={trustedContactBirthDateError ? "trusted-contact-birth-date-error" : undefined}
                      value={trustedContactEditor.birthDate}
                      onChange={(event) => patchTrustedContactEditor("birthDate", event.target.value)}
                    />
                  </Field>
                  {(() => {
                    // A representative's address from the cabinet: the GwG sheet and the
                    // consent form print these parts, so the one-line address is not edited here.
                    const onFile = leadId && editingTrustedContact
                      ? portalRepresentation?.representatives.find((item) => item.id === trustedContactEditor.id)
                      : undefined;
                    const cabinetAddress = onFile
                      ? representativeCabinetAddress(onFile, (code) => countryLabel(code, lang))
                      : null;
                    // Said by its source: a parent GMED entered has nothing from the cabinet
                    // (QA 2026-10-25, V-A4).
                    const fromCabinet = Boolean(onFile && (onFile.has_login || onFile.contact_origin === "portal"));
                    // A representative takes the address in parts (street, postcode, city,
                    // country) below: a one-line address never reached the contract's check
                    // (walk-through 2026-10-24).
                    if (!cabinetAddress && (onFile || trustedContactEditorGuardian)) return null;
                    return (
                      <Field className="sm:col-span-2" label={tx("Адрес", "Adresse")} htmlFor="trusted-contact-address">
                        <Input
                          id="trusted-contact-address"
                          name="address"
                          className={cn(inputClass, cabinetAddress && "bg-muted/40 text-muted-foreground")}
                          value={cabinetAddress ?? trustedContactEditor.address}
                          readOnly={Boolean(cabinetAddress)}
                          aria-describedby={cabinetAddress ? "trusted-contact-address-cabinet" : undefined}
                          onChange={(event) => patchTrustedContactEditor("address", event.target.value)}
                        />
                        {cabinetAddress ? (
                          <p id="trusted-contact-address-cabinet" className="mt-1.5 text-[11.5px] leading-tight text-muted-foreground" data-testid="trusted-contact-address-cabinet">
                            {fromCabinet
                              ? tx(
                                  "Из кабинета: так адрес стоит в анкете GwG и в документах. Исправить его можно в блоке «Адрес и данные для анкеты GwG» ниже.",
                                  "Aus dem Kundenkabinett: so steht sie im GwG-Bogen und in den Unterlagen. Korrigieren unten unter „Anschrift und Angaben für den GwG-Bogen“.",
                                )
                              : tx(
                                  "Внесено сотрудниками GMED: так адрес стоит в анкете GwG и в документах. Исправить его можно в блоке «Адрес и данные для анкеты GwG» ниже.",
                                  "Von GMED erfasst: so steht sie im GwG-Bogen und in den Unterlagen. Korrigieren unten unter „Anschrift und Angaben für den GwG-Bogen“.",
                                )}
                          </p>
                        ) : null}
                      </Field>
                    );
                  })()}
                </div>
                {/* What the person may be told: printed on the consent form next to the
                    contact while the client named no recipients in the cabinet; the
                    same choices as the cabinet's trusted persons (owner 2026-10-26). */}
                <fieldset className="space-y-1 border-t border-border/60 pt-3" data-testid="trusted-contact-scope">
                  <legend className="text-sm font-medium text-foreground">
                    {tx("Объём информации (для формы согласия)", "Umfang der Auskunft (für die Einverständniserklärung)")}
                  </legend>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {tx(
                      "Печатается в форме согласия рядом с этим лицом, если клиент не выбрал получателей сам в кабинете. Выбор клиента всегда важнее.",
                      "Wird in der Einverständniserklärung neben dieser Person gedruckt, wenn der Kunde im Kundenkabinett keine Empfänger selbst gewählt hat. Die Wahl des Kunden geht immer vor.",
                    )}
                  </p>
                  {CONSENT_RECIPIENT_SCOPES.map((code) => (
                    <ToggleRow
                      key={code}
                      id={`trusted-contact-scope-${code}`}
                      withDivider={false}
                      label={scopeOptionLabel(code, lang === "de" ? "de" : "ru")}
                      checked={checkedScopeCodes(trustedContactEditor.scopeCodes ?? []).includes(code)}
                      onChange={() => patchTrustedContactEditor("scopeCodes", toggleScopeCode(trustedContactEditor.scopeCodes ?? [], code))}
                    />
                  ))}
                </fieldset>
                {(() => {
                  // A representative on file: staff correct the parts the GwG sheet
                  // prints (owner 2026-10-24) and upload the identity document
                  // copy (and proof of authority) the contract gate asks for.
                  const person = leadId && editingTrustedContact
                    ? portalRepresentation?.representatives.find((item) => item.id === trustedContactEditor.id)
                    : undefined;
                  // Where the filled values come from (DEV 2026-10-26). The patient's
                  // document is not a field here: the saved parent's GwG data take it
                  // from the linked card, unless staff stated another document for them.
                  const prefill = trustedContactCandidatePrefill;
                  const prefillDocument = prefill?.document
                    && (!person?.id_document_number || person.id_document_number === prefill.document.number)
                    ? prefill.document
                    : null;
                  const prefillNote = prefill && (prefill.hasDetails || prefillDocument) ? (
                    <div className="mb-3 space-y-1 text-[11.5px] leading-tight text-muted-foreground" role="status" data-testid="trusted-contact-candidate-prefill">
                      {prefill.hasDetails ? (
                        <p>
                          {prefill.source === "patient"
                            ? tx(`Данные из карточки пациента ${prefill.displayId ?? ""}`.trim(), `Daten aus der Patientenakte ${prefill.displayId ?? ""}`.trim())
                            : tx("Данные из лида", "Daten aus dem Lead")}
                          {tx(" — подставлены в пустые поля.", " – in leere Felder übernommen.")}
                        </p>
                      ) : null}
                      {prefillDocument ? (
                        <p data-testid="trusted-contact-candidate-document">
                          {tx("Документ из карточки пациента", "Ausweis aus der Patientenakte")}
                          {": "}
                          {[
                            prefillDocument.type ? idDocumentTypeLabel(prefillDocument.type, tx) : null,
                            prefillDocument.number ? `№ ${prefillDocument.number}` : null,
                            prefillDocument.validUntil
                              ? tx(`действителен до ${formatAppDate(prefillDocument.validUntil)}`, `gültig bis ${formatAppDate(prefillDocument.validUntil)}`)
                              : null,
                          ].filter(Boolean).join(" · ")}
                          {tx(
                            ". После сохранения он будет в данных документа представителя.",
                            ". Nach dem Speichern steht er in den Ausweisdaten der Vertretung.",
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null;
                  if (!leadId || !person) {
                    // A parent not on file yet (a new card): the same fields, written
                    // once the card is saved and the parent exists on the server.
                    if (!trustedContactEditorGuardian) return null;
                    return (
                      <div className="mt-4 border-t border-border/70 pt-3">
                        {prefillNote}
                        <PendingRepresentativeDetailsForm
                          value={trustedContactPendingDetails}
                          tx={tx}
                          lang={lang}
                          disabled={isBusy}
                          onChange={setTrustedContactPendingDetails}
                        />
                      </div>
                    );
                  }
                  return (
                    <>
                    <div className="mt-4 border-t border-border/70 pt-3">
                      {prefillNote}
                      <LeadRepresentativeDetailsForm
                        person={person}
                        tx={tx}
                        lang={lang}
                        disabled={isBusy}
                        prefill={prefill}
                        onDraftChange={(details, loaded) => {
                          trustedContactDetailsDraftRef.current = { contactId: person.id, draft: details, loaded };
                        }}
                      />
                    </div>
                    <div className="mt-4 space-y-2 border-t border-border/70 pt-3" data-testid="trusted-contact-representative-uploads">
                      <h4 className="text-xs font-semibold text-foreground">
                        {tx("Документы представителя", "Unterlagen des Vertreters")}
                      </h4>
                      <LeadRepresentativeUploads
                        leadId={leadId}
                        person={person}
                        custody={portalRepresentation?.custody}
                        tx={tx}
                        disabled={isBusy}
                        renderFiles={representativeFileRows}
                        onUploaded={afterRepresentativeUpload}
                      />
                    </div>
                    </>
                  );
                })()}
                </AdminFormSection>
              </AdminDialogScaffold>
          ) : null}
      </Dialog>
      <Dialog
        open={serviceReportOpen}
        allowImplicitDismissal
        onOpenChange={setServiceReportOpen}
      >
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-border/70 px-6 py-4 pr-14">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="flex items-center gap-2">
                  <Eye aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  {tx("Отчёт по позициям заказа", "Übersicht der Auftragspositionen")}
                </DialogTitle>
              </div>
              <Badge variant="outline" className="border-border bg-muted/40 text-[10px] text-muted-foreground">
                {tx("Только просмотр", "Nur Ansicht")}
              </Badge>
            </div>
          </DialogHeader>

          {draft ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/15 px-6 py-5">
              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Данные заказа", "Auftragsdaten")}
              >
              <dl className="grid overflow-hidden rounded-lg border border-border/70 bg-card sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    label: tx("Клиент", "Kunde"),
                    value: [draft.firstName, draft.lastName].filter(Boolean).join(" ") || "—",
                  },
                  {
                    label: tx("Период программы", "Programmzeitraum"),
                    value: draft.programDateFrom || draft.programDateTo
                      ? `${draft.programDateFrom ? germanDateLabel(draft.programDateFrom) : "—"} — ${draft.programDateTo ? germanDateLabel(draft.programDateTo) : "—"}`
                      : "—",
                  },
                  {
                    label: tx("Специализации", "Fachrichtungen"),
                    value: draft.specialties.map((value) => specialtyLabel(value)).join(", ") || "—",
                  },
                  {
                    label: tx("Позиций", "Positionen"),
                    value: String(orderPositionCount),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="min-w-0 border-b border-border px-4 py-3 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2n)]:border-r lg:last:border-r-0"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
              </Section>

              {draft.serviceNeeds.length > 0 ? (
                <Section
                  className={WIZARD_DOCUMENT_SECTION_CLASS}
                  title={tx("Запрос клиента", "Kundenbedarf")}
                >
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="min-w-0 whitespace-pre-wrap break-words">
                      {draft.serviceNeeds
                        .map((value) =>
                          knownLeadProgramServiceLabel(value, t)
                          ?? serviceNeedLabel(value, tx),
                        )
                        .join(", ")}
                    </p>
                  </div>
                </Section>
              ) : null}

              {selectedCostEstimateWorkTypes.length > 0 ? (
                <section
                  className={cn("t-acc", WIZARD_DOCUMENT_SECTION_CLASS)}
                  data-open={String(reportWorkTypesExpanded)}
                >
                  <button
                    type="button"
                    className="t-acc-head flex w-full items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={reportWorkTypesExpanded}
                    onClick={() => setReportWorkTypesExpanded((current) => !current)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange-500" />
                      <span className="text-sm font-semibold text-foreground">
                        {tx("Виды работ и часы", "Leistungsarten und Stunden")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <CountBadge>{selectedCostEstimateWorkTypes.length}</CountBadge>
                      <span className="t-acc-chevron text-muted-foreground">
                        <ChevronDown aria-hidden="true" className="size-4" />
                      </span>
                    </span>
                  </button>
                  <div className="t-acc-panel" aria-hidden={!reportWorkTypesExpanded}>
                    <div className="t-acc-panel-inner">
                      <div className="pt-2.5">
                        <SelectedWorkTypesSummary
                          workTypes={selectedCostEstimateWorkTypes}
                          specializationLabels={selectedSpecializationLabelById}
                          lang={lang}
                          tx={tx}
                          compact
                        />
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Услуги и описания", "Leistungen und Beschreibungen")}
                accessory={<CountBadge>{lines.length}</CountBadge>}
              >
                <div className="space-y-3">
                  {lines.map((line) => {
                    const catalogService = line.agencyServiceId
                      ? agencyServiceById.get(line.agencyServiceId)
                      : undefined;
                    const rawUnit = line.catalogUnitLabel || catalogService?.unit_label;
                    const unit = serviceBillingUnitLabel(rawUnit, tx);
                    const descriptionItems = resolvedServiceCatalogItems(line);
                    const { net, gross: lineGross } = moneyLineAmounts(
                      money(line.quantity),
                      money(line.price),
                      line.isCostPassthrough ? 0 : money(line.vat),
                    );
                    return (
                      <article
                        key={line.id}
                        className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
                      >
                        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/35 px-4 py-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <div className="min-w-0">
                              <h4 className="break-words text-sm font-semibold leading-5 text-foreground">{agencyServiceLineDisplayName(line.description, catalogService, t, lang)}</h4>
                              {rawUnit ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "mt-1 w-fit text-[10px] font-semibold",
                                    serviceBillingUnitBadgeClass(rawUnit),
                                  )}
                                >
                                  {unit}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 font-mono text-[10px] font-semibold",
                              serviceBillingUnitBadgeClass(rawUnit),
                            )}
                          >
                            {line.quantity || "0"} {unit}
                          </Badge>
                        </header>
                        <div className="space-y-3 px-4 py-3">
                          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {tx("Полное описание", "Vollständige Beschreibung")}
                            </p>
                            {descriptionItems.length > 0 ? (
                              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-5 text-foreground">
                                {descriptionItems.map((item) => (
                                  <li key={item.id} className="whitespace-pre-wrap break-words">{item.text}</li>
                                ))}
                              </ol>
                            ) : (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {tx("Описание не указано", "Keine Beschreibung hinterlegt")}
                              </p>
                            )}
                          </div>
                          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                            {[
                              { label: tx("Объём", "Umfang"), value: `${line.quantity || "0"} ${unit}`, isTotal: false },
                              { label: tx("Ставка", "Satz"), value: `${formatMoneyLabel(money(line.price), line.currency)} / ${unit}`, isTotal: false },
                              { label: tx("НДС", "MwSt."), value: `${formatMoneyValue(money(line.vat), lang)}%`, isTotal: false },
                              { label: tx("Нетто", "Netto"), value: formatMoneyLabel(net, line.currency), isTotal: false },
                              { label: tx("Итого", "Gesamt"), value: formatMoneyLabel(lineGross, line.currency), isTotal: true },
                            ].map((item) => (
                              <div key={item.label} className="rounded-md border border-border/70 bg-muted/25 px-3 py-2">
                                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                                <dd className="mt-0.5 whitespace-nowrap font-mono text-xs font-medium tabular-nums text-foreground">
                                  {item.isTotal ? (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-200 bg-emerald-50 font-mono text-[10px] font-semibold tabular-nums text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    >
                                      {item.value}
                                    </Badge>
                                  ) : item.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Section>

              <Section
                className={WIZARD_DOCUMENT_SECTION_CLASS}
                title={tx("Итоги заказа", "Auftragssummen")}
              >
              <dl className="grid overflow-hidden rounded-lg border border-border/70 bg-muted/20 sm:grid-cols-3">
                {[
                  { label: tx("Нетто", "Netto"), value: estimate.net },
                  { label: tx("НДС", "MwSt."), value: estimate.vat },
                  { label: tx("Итого", "Gesamt"), value: estimate.gross, strong: true },
                ].map((item) => (
                  <div key={item.label} className="border-b border-border px-4 py-3 text-right last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <dt className={cn("uppercase tracking-wide", item.strong ? "text-xs font-semibold text-foreground" : "text-[10px] font-medium text-muted-foreground")}>{item.label}</dt>
                    <dd className={cn("mt-0.5 whitespace-nowrap font-mono text-sm tabular-nums text-foreground", item.strong && "text-[15px] font-semibold")}>
                      {item.strong ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-[15px] font-semibold tabular-nums text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          {formatMoneyLabel(item.value)}
                        </Badge>
                      ) : formatMoneyLabel(item.value)}
                    </dd>
                  </div>
                ))}
              </dl>
              </Section>
            </div>
          ) : null}

          <DialogFooter className="mx-0 mb-0 border-t border-border bg-card px-6 py-4">
            <Button type="button" onClick={() => setServiceReportOpen(false)}>
              {tx("Закрыть", "Schließen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteServiceLine)}
        allowImplicitDismissal
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteServiceLine(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Удалить позицию заказа?", "Auftragsposition entfernen?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Позиция будет удалена, а итоговая сумма заказа пересчитается.",
                "Die Position wird entfernt und die Auftragssumme neu berechnet.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm font-medium text-foreground">
            <span className="block truncate" title={deleteServiceLine?.description || undefined}>
              {deleteServiceLine?.description}
            </span>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteServiceLine(null)}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleteServiceLine) return;
                setCommercialSaveFeedback(null);
                setLines((current) =>
                  current.filter((item) => item.id !== deleteServiceLine.id),
                );
                setDeleteServiceLine(null);
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              {tx("Удалить", "Entfernen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(documentPreview)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) replaceDocumentPreview(null);
        }}
      >
        <DialogContent
          className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 duration-0 data-closed:animate-none data-open:animate-none sm:h-[min(88vh,52rem)] sm:w-[min(96vw,84rem)] sm:max-w-[84rem]"
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle title={documentPreview?.title} className="line-clamp-2 break-words text-sm [overflow-wrap:anywhere] sm:text-base">
                  {documentPreview?.title ?? tx("Просмотр документа", "Dokumentvorschau")}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {tx("Просмотр документа и действия с ним", "Dokumentvorschau und Dokumentaktionen")}
                </DialogDescription>
                {previewedDocument ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <LeadWizardDocumentMetadata document={previewedDocument} lang={lang} />
                  </div>
                ) : null}
              </div>
              {documentPreview ? (
                <div className="flex shrink-0 items-center gap-1">
                  {documentPreview.kind === "pdf" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title={tx("Открыть PDF в новой вкладке", "PDF in neuem Tab öffnen")}
                      aria-label={tx("Открыть PDF в новой вкладке", "PDF in neuem Tab öffnen")}
                      onClick={() => {
                        setDocumentPreviewError("");
                        const previewWindow = window.open(documentPreview.url, "_blank");
                        if (previewWindow) {
                          previewWindow.opener = null;
                          return;
                        }
                        setDocumentPreviewError(tx(
                          "Браузер заблокировал новую вкладку. Разрешите всплывающие окна или скачайте PDF.",
                          "Der Browser hat den neuen Tab blockiert. Erlauben Sie Pop-ups oder laden Sie die PDF-Datei herunter.",
                        ));
                      }}
                    >
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    title={tx("Скачать файл", "Datei herunterladen")}
                    aria-label={tx("Скачать файл", "Datei herunterladen")}
                    aria-busy={busy === `download-${documentPreview.id}`}
                    disabled={isBusy || !previewedDocument}
                    onClick={() => { if (previewedDocument) void downloadDocument(previewedDocument, true); }}
                  >
                    {busy === `download-${documentPreview.id}` ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Download aria-hidden="true" className="size-3.5" />}
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
            {previewedDocument && canSignWizardDocument(previewedDocument) && documentPreview?.kind !== "image" ? (
              <div className="shrink-0 px-3 pt-3">
                {signatureEnabled === false ? (
                  // Skribble is off: no electronic signature to offer; the paper signature below stands (QA 2026-10-25).
                  <p className="text-xs leading-5 text-amber-800 dark:text-amber-300" data-testid="lead-wizard-esign-disabled">
                    {tx("Электронная подпись отключена — используйте бумажную подпись", "Elektronische Signatur ist deaktiviert – bitte die Unterschrift auf Papier verwenden")}
                  </p>
                ) : (
                  <DocumentSignatureAction documentId={previewedDocument.id} title={wizardDocumentFilename(previewedDocument)} signed={previewDocumentSigned} onDone={() => { void refreshDocumentsState(); }} />
                )}
              </div>
            ) : null}
            {documentPreview?.kind === "image" ? (
              <img
                src={documentPreview.url}
                alt={documentPreview.title}
                className="m-3 mx-auto min-h-0 flex-1 object-contain"
              />
            ) : documentPreview?.kind === "pdf" ? (
              <SignatureDocumentPreview
                documentId={documentPreview.id}
                onReady={ignoreDocumentPreviewReady}
              />
            ) : documentPreview ? (
              <iframe
                title={documentPreview.title}
                src={documentPreview.url}
                className="m-3 min-h-0 flex-1 border border-border bg-white"
              />
            ) : null}
          </div>
          {documentPreviewError ? (
            <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive sm:px-5">
              <span className="min-w-0 flex-1">{documentPreviewError}</span>
              {documentPreviewJump ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  data-testid="lead-document-preview-jump"
                  onClick={() => {
                    const target = documentPreviewJump;
                    replaceDocumentPreview(null);
                    if (target === PREVIEW_JUMP_RISK) {
                      openValidationIssue({ key: "risk-assessment", step: "documents", message: "", fieldId: RISK_ASSESSMENT_SECTION_ID });
                    } else if (target === PREVIEW_JUMP_PAYER) {
                      openValidationIssue({ key: "payer-declaration", step: "documents", message: "", fieldId: PAYER_SECTION_ID });
                    } else if (target) {
                      const authority = target.endsWith(AUTHORITY_JUMP);
                      openRepresentativeIdData(authority ? target.slice(0, -AUTHORITY_JUMP.length) : target, authority ? "authority" : null);
                    }
                  }}
                >
                  {documentPreviewJump === PREVIEW_JUMP_RISK
                    ? tx("Перейти к оценке риска", "Zur Risikobewertung")
                    : documentPreviewJump === PREVIEW_JUMP_PAYER
                      ? goToPayerLabel
                      : documentPreviewJump.endsWith(AUTHORITY_JUMP)
                        ? tx("Загрузить подтверждение полномочий", "Vertretungsnachweis hochladen")
                        : tx("Перейти к данным документа", "Zu den Ausweisdaten")}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            {previewComplianceKind ? (
              <span role="status">
                <StateMark
                  done={previewDocumentSigned}
                  label={previewComplianceKind === "identity"
                    ? previewDocumentSigned ? tx("Проверен", "Geprüft") : tx("Ожидает проверки", "Prüfung offen")
                    : previewDocumentSigned ? tx("Подписан", "Unterzeichnet") : tx("Ожидает подписи", "Unterschrift offen")}
                />
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => replaceDocumentPreview(null)}>
                {tx("К документам", "Zur Dokumentenliste")}
              </Button>
              {previewedDocument && previewComplianceKind && !previewDocumentSigned
                && signatureNeedsProof(previewedDocument, previewComplianceKind) ? (
                // "Signed" only with the scan of the signed copy (owner decision 2026-10-11).
                <PaperSignatureConfirmButton
                  documentId={previewedDocument.id}
                  title={wizardDocumentFilename(previewedDocument)}
                  lang={lang}
                  size="sm"
                  disabled={isBusy || Boolean(paperSignatureBlocker(previewedDocument))}
                  errorText={(error) => wizardSignatureErrorText(error, tx)}
                  errorAction={(error) => {
                    const jump = signatureErrorJump(error);
                    return jump ? { ...jump, onClick: () => { replaceDocumentPreview(null); jump.onClick(); } } : null;
                  }}
                  onDone={() => {
                    // The scan is a new version of the document: back to the list.
                    replaceDocumentPreview(null);
                    void refreshDocumentsState();
                  }}
                />
              ) : previewedDocument && previewComplianceKind && !previewDocumentSigned ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
                  aria-busy={busy === `sign-${previewedDocument.id}`}
                  onClick={() => {
                    if (previewComplianceKind === "framework_contract") void signContract(previewedDocument.id, true);
                    else void signDocument(previewedDocument.id, previewComplianceKind, true);
                  }}
                >
                  {busy === `sign-${previewedDocument.id}` ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FileCheck2 aria-hidden="true" className="size-3.5" />}
                  {busy === `sign-${previewedDocument.id}`
                    ? tx("Подтверждение…", "Wird bestätigt…")
                    : previewComplianceKind === "identity" ? tx("Подтвердить документ", "Dokument bestätigen") : tx("Подтвердить подпись", "Unterschrift bestätigen")}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteDocument)}
        allowImplicitDismissal
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          setDeleteDocument(null);
          setDeleteReason("");
          setDeleteError("");
        }}
      >
        <DialogContent className="min-w-0 max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>{tx("Удалить файл?", "Datei löschen?")}</DialogTitle>
            <DialogDescription className="min-w-0 break-all [overflow-wrap:anywhere]">
              {deleteDocument?.original_filename || deleteDocument?.auto_name}
            </DialogDescription>
          </DialogHeader>
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void deleteWizardDocument();
            }}
          >
            <Field
              required
              label={tx("Причина удаления", "Löschgrund")}
              error={deleteError || undefined}
              errorId="lead-wizard-delete-reason-error"
            >
              <textarea
                className={cn(textareaClass, "min-h-20", deleteError && "border-destructive")}
                value={deleteReason}
                aria-invalid={Boolean(deleteError)}
                aria-describedby={deleteError ? "lead-wizard-delete-reason-error" : undefined}
                onChange={(event) => {
                  setDeleteReason(event.target.value);
                  if (deleteError) setDeleteError("");
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy?.startsWith("delete-")} onClick={() => setDeleteDocument(null)}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy?.startsWith("delete-")}>
                {busy?.startsWith("delete-") ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {tx("Удалить файл", "Datei löschen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <PortalCredentialsDialog
        credentials={issuedPortalAccess}
        created
        lang={lang}
        defaultLanguage={issuedPortalAccess?.language}
        onClose={() => setIssuedPortalAccess(null)}
      />
      <LeadConfirmDialog
        open={Boolean(trustedContactRemoval)}
        testId="lead-contact-remove-dialog"
        title={tx(
          `Удалить «${trustedContactRemoval?.name ?? ""}» из обращения?`,
          `„${trustedContactRemoval?.name ?? ""}“ aus der Anfrage entfernen?`,
        )}
        description={tx(
          "Контакт и его данные представителя будут удалены из обращения. Доступ к этой заявке будет отозван. Аккаунт, доступ к другим детям и сохранённые документы останутся.",
          "Der Kontakt und seine Vertretungsdaten werden aus der Anfrage entfernt. Der Zugang zu dieser Anfrage wird widerrufen. Das Konto, der Zugang zu anderen Kindern und gespeicherte Dokumente bleiben erhalten.",
        )}
        confirmLabel={tx("Удалить", "Entfernen")}
        cancelLabel={tx("Отмена", "Abbrechen")}
        destructive
        busy={Boolean(trustedContactRemoval && busy === `remove-contact-${trustedContactRemoval.id}`)}
        onConfirm={() => {
          if (trustedContactRemoval) void removeTrustedContact(trustedContactRemoval);
        }}
        onCancel={() => setTrustedContactRemoval(null)}
      />
      <LeadConfirmDialog
        open={Boolean(gwgDataRemoval)}
        testId="lead-gwg-data-remove-dialog"
        title={tx(
          `Убрать данные GwG у контакта «${gwgDataRemoval?.name ?? ""}»?`,
          `GwG-Angaben von „${gwgDataRemoval?.name ?? ""}“ entfernen?`,
        )}
        description={tx(
          "Сведения, внесённые в кабинете (адрес, гражданство, документ), и привязка загруженных файлов будут удалены. Сам контакт и документы останутся.",
          "Die im Portal erfassten Angaben (Anschrift, Staatsangehörigkeit, Ausweis) und die Zuordnung der hochgeladenen Dateien werden gelöscht. Der Kontakt und die Dokumente bleiben erhalten.",
        )}
        confirmLabel={tx("Убрать данные GwG", "GwG-Angaben entfernen")}
        cancelLabel={tx("Отмена", "Abbrechen")}
        destructive
        busy={Boolean(gwgDataRemoval && busy === `remove-gwg-data-${gwgDataRemoval.id}`)}
        onConfirm={() => {
          if (gwgDataRemoval) void removeRepresentativeGwgData(gwgDataRemoval);
        }}
        onCancel={() => setGwgDataRemoval(null)}
      />
      <Dialog
        open={notQualifiedReason !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && busy !== "not_qualified") setNotQualifiedReason(null);
        }}
      >
        <DialogContent className="max-w-md" data-testid="lead-not-qualified-dialog">
          <DialogHeader>
            <DialogTitle>{tx("Обращение не подходит?", "Lead nicht geeignet?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Обращение получит статус «Не подходит». Причина сохранится и будет указана при архивировании.",
                "Der Lead erhält den Status „Nicht geeignet“. Der Grund wird gespeichert und beim Archivieren übernommen.",
              )}
            </DialogDescription>
          </DialogHeader>
          {notQualifiedReason ? (
            <div className="space-y-3">
              <Field label={tx("Причина", "Grund")} required htmlFor="lead-not-qualified-reason">
                <NativeComboboxSelect
                  id="lead-not-qualified-reason"
                  value={notQualifiedReason.choice}
                  className={selectClass}
                  disabled={busy === "not_qualified"}
                  onChange={(event) => {
                    const choice = event.target.value as LeadFailureReasonDraft["choice"];
                    setNotQualifiedError("");
                    setNotQualifiedReason((current) => (current ? { ...current, choice } : current));
                  }}
                >
                  <option value="">{tx("Выберите причину", "Grund auswählen")}</option>
                  {LEAD_FAILURE_REASONS.map((reason) => (
                    <option key={reason.code} value={reason.code}>{tx(reason.ru, reason.de)}</option>
                  ))}
                  <option value={LEAD_FAILURE_REASON_OTHER}>{leadFailureReasonOtherLabel(tx)}</option>
                </NativeComboboxSelect>
              </Field>
              {notQualifiedReason.choice === LEAD_FAILURE_REASON_OTHER ? (
                <Field label={tx("Опишите причину", "Grund beschreiben")} required htmlFor="lead-not-qualified-reason-text">
                  <textarea
                    id="lead-not-qualified-reason-text"
                    className={cn(textareaClass, "min-h-20")}
                    maxLength={LEAD_FAILURE_REASON_MAX_LENGTH}
                    disabled={busy === "not_qualified"}
                    value={notQualifiedReason.text}
                    onChange={(event) => {
                      const text = event.target.value;
                      setNotQualifiedError("");
                      setNotQualifiedReason((current) => (current ? { ...current, text } : current));
                    }}
                  />
                </Field>
              ) : null}
              {notQualifiedError ? (
                <p role="alert" className="text-xs leading-4 text-destructive">{notQualifiedError}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy === "not_qualified"}
              onClick={() => setNotQualifiedReason(null)}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "not_qualified"}
              onClick={() => void markNotQualified()}
            >
              {busy === "not_qualified" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              {tx("Не подходит", "Nicht geeignet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Переместить обращение в архив?", "Lead archivieren?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Обращение исчезнет из активного списка, но останется доступным в архиве.",
                "Der Lead wird aus der aktiven Liste entfernt und bleibt im Archiv verfügbar.",
              )}
              {leadFailureReasonLabel(lead?.failed_outcome?.reason, tx) ? (
                <span className="mt-2 block" data-testid="lead-archive-reason">
                  {`${tx("Причина", "Grund")}: ${leadFailureReasonLabel(lead?.failed_outcome?.reason, tx)}`}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy === "archive"}
              onClick={() => setArchiveConfirmOpen(false)}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "archive"}
              onClick={() => void archiveLead()}
            >
              {busy === "archive" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
              {tx("Архивировать", "Archivieren")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={prospectCandidates != null}
        onOpenChange={(open) => {
          if (!open && !prospectResolutionBusy) {
            setProspectCandidates(null);
            settleProspectWaiters(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {tx("Найден существующий пациент", "Vorhandener Patient gefunden")}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "Имя и дата рождения совпадают с существующей карточкой. Привязать обращение к ней или создать нового пациента?",
                "Name und Geburtsdatum stimmen mit einer bestehenden Patientenakte überein. Anfrage mit ihr verknüpfen oder einen neuen Patienten anlegen?",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(prospectCandidates ?? []).map((candidate) => (
              <div
                key={candidate.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {candidate.first_name} {candidate.last_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {candidate.patient_id} · {formatAppDate(candidate.birth_date) || candidate.birth_date}
                    {candidate.email ? ` · ${candidate.email}` : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={prospectResolutionBusy}
                  onClick={() => {
                    void (async () => {
                      if (!draft) return;
                      setProspectResolutionBusy(true);
                      setError("");
                      try {
                        const subject = await ensureProspect(draft, {
                          attachPatientId: candidate.id,
                        });
                        await hydrateProspectClinical(
                          subject.patientId,
                          subject.caseId,
                          draft,
                        );
                        setProspectCandidates(null);
                        // The dialog value that ran into the duplicate check is saved now.
                        settleProspectWaiters(true);
                        // The server made the lead a request of that patient: the header (no
                        // purge countdown), the step names and the repeat review follow at once,
                        // not after a reload (QA 2026-10-25, V-A1).
                        await refreshLeadState().catch(() => null);
                      } catch (nextError) {
                        showWizardError(nextError);
                      } finally {
                        setProspectResolutionBusy(false);
                      }
                    })();
                  }}
                >
                  {tx("Привязать", "Verknüpfen")}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={prospectResolutionBusy}
              onClick={() => {
                setProspectCandidates(null);
                settleProspectWaiters(false);
              }}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              disabled={prospectResolutionBusy}
              onClick={() => {
                void (async () => {
                  if (!draft) return;
                  setProspectResolutionBusy(true);
                  setError("");
                    try {
                      await ensureProspect(draft, { forceCreate: true });
                      await persistMedicalDraft(draft);
                      setProspectCandidates(null);
                      settleProspectWaiters(true);
                  } catch (nextError) {
                    showWizardError(nextError);
                  } finally {
                    setProspectResolutionBusy(false);
                  }
                })();
              }}
            >
              {prospectResolutionBusy
                ? <LoaderCircle className="size-3.5 animate-spin" />
                : <Plus className="size-3.5" />}
              {tx("Создать нового пациента", "Neuen Patienten anlegen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalUploadsProvider>
    </WizardDocumentRowErrorProvider>
    </WizardSignatureJumpContext.Provider>
  );
}
