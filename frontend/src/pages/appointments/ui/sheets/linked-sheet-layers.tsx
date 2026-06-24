import { Suspense, lazy } from "react";

import type { PatientDetailSheetProps } from "@/pages/patients";
import type { LinkedCasesSheetProps } from "@/pages/appointments/ui/sheets/linked-cases-sheet";
import type { LinkedDocumentsSheetProps } from "@/pages/appointments/ui/sheets/linked-documents-sheet";
import type { LinkedProviderSheetProps } from "@/pages/appointments/ui/sheets/linked-provider-sheet";
import type { LinkedRecordsSheetProps } from "@/pages/appointments/ui/sheets/linked-records-sheet";
import { appointmentText } from "@/pages/appointments/model/labels";
import { AppointmentPreviewSheetLoadingState } from "@/pages/appointments/ui/shared/workspace-primitives";

const loadPatientDetailSheet = () => import("@/pages/patients");
const loadLinkedProviderSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-provider-sheet");
const loadLinkedCasesSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-cases-sheet");
const loadLinkedDocumentsSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-documents-sheet");
const loadLinkedRecordsSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-records-sheet");

const LazyPatientDetailSheet = lazy(async () => {
  const mod = await loadPatientDetailSheet();
  return { default: mod.MemoizedPatientDetailSheet };
});

const LazyLinkedProviderSheet = lazy(async () => {
  const mod = await loadLinkedProviderSheet();
  return { default: mod.MemoizedLinkedProviderSheet };
});

const LazyLinkedCasesSheet = lazy(async () => {
  const mod = await loadLinkedCasesSheet();
  return { default: mod.MemoizedLinkedCasesSheet };
});

const LazyLinkedDocumentsSheet = lazy(async () => {
  const mod = await loadLinkedDocumentsSheet();
  return { default: mod.MemoizedLinkedDocumentsSheet };
});

const LazyLinkedRecordsSheet = lazy(async () => {
  const mod = await loadLinkedRecordsSheet();
  return { default: mod.MemoizedLinkedRecordsSheet };
});

export function preloadLinkedPatientSheet() {
  void loadPatientDetailSheet();
}

export function preloadLinkedProviderSheet() {
  void loadLinkedProviderSheet();
}

export function preloadLinkedCasesSheet() {
  void loadLinkedCasesSheet();
}

export function preloadLinkedDocumentsSheet() {
  void loadLinkedDocumentsSheet();
}

export function preloadLinkedRecordsSheet() {
  void loadLinkedRecordsSheet();
}

type LinkedPatientSheetLayerProps = Pick<
  PatientDetailSheetProps,
  | "detail"
  | "detailBusy"
  | "detailError"
  | "dictionary"
  | "detailControls"
  | "assignments"
  | "assignableStaff"
  | "selectedAssignee"
  | "assignmentBusy"
  | "assignmentError"
  | "onAssigneeChange"
  | "onAssign"
  | "onOpenChange"
  | "onRefresh"
  | "onOpenCases"
  | "onOpenOrders"
  | "onOpenAppointments"
  | "onOpenContracts"
  | "onOpenDocuments"
> & {
  open: boolean;
};

export function LinkedPatientSheetLayer({
  open,
  onOpenChange,
  ...sheetProps
}: LinkedPatientSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={onOpenChange}
          title={appointmentText("appointments_patient")}
          maxWidthClassName="sm:max-w-[860px]"
          loadingLabel={appointmentText("appointments_loading_patient")}
        />
      }
    >
      <LazyPatientDetailSheet open={open} onOpenChange={onOpenChange} {...sheetProps} />
    </Suspense>
  );
}

type LinkedProviderSheetLayerProps = LinkedProviderSheetProps;

export function LinkedProviderSheetLayer({
  open,
  onOpenChange,
  detail,
  loading,
  error,
  fallbackTitle,
  formatDateTimeLabel,
  onOpenPatient,
  onOpenAppointment,
  onOpenOrder,
}: LinkedProviderSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={onOpenChange}
          title={detail?.name || fallbackTitle}
          maxWidthClassName="sm:max-w-[920px]"
          loadingLabel={appointmentText("appointments_loading_provider")}
        />
      }
    >
      <LazyLinkedProviderSheet
        open={open}
        onOpenChange={onOpenChange}
        detail={detail}
        loading={loading}
        error={error}
        fallbackTitle={fallbackTitle}
        formatDateTimeLabel={formatDateTimeLabel}
        onOpenPatient={onOpenPatient}
        onOpenAppointment={onOpenAppointment}
        onOpenOrder={onOpenOrder}
      />
    </Suspense>
  );
}

type LinkedCasesSheetLayerProps = LinkedCasesSheetProps;

export function LinkedCasesSheetLayer({
  open,
  onOpenChange,
  loading,
  error,
  items,
  patientId,
  formatDateTimeLabel,
}: LinkedCasesSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={onOpenChange}
          title={appointmentText("appointments_cases_2")}
          description={appointmentText("appointments_loading_case_context")}
          maxWidthClassName="sm:max-w-[980px]"
          loadingLabel={appointmentText("appointments_loading_cases")}
        />
      }
    >
      <LazyLinkedCasesSheet
        open={open}
        onOpenChange={onOpenChange}
        loading={loading}
        error={error}
        items={items}
        patientId={patientId}
        formatDateTimeLabel={formatDateTimeLabel}
      />
    </Suspense>
  );
}

type LinkedDocumentsSheetLayerProps = LinkedDocumentsSheetProps;

export function LinkedDocumentsSheetLayer({
  open,
  onOpenChange,
  loading,
  error,
  items,
  formatDateTime,
}: LinkedDocumentsSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={onOpenChange}
          title={appointmentText("appointments_documents")}
          description={appointmentText("appointments_documents_from_the_current_appointment_context")}
          maxWidthClassName="sm:max-w-[760px]"
          bodyClassName="space-y-4 px-5 py-4"
          loadingLabel={appointmentText("appointments_loading_documents")}
        />
      }
    >
      <LazyLinkedDocumentsSheet
        open={open}
        onOpenChange={onOpenChange}
        loading={loading}
        error={error}
        items={items}
        formatDateTime={formatDateTime}
      />
    </Suspense>
  );
}

type LinkedRecordsSheetLayerProps = LinkedRecordsSheetProps;

export function LinkedRecordsSheetLayer({
  open,
  onOpenChange,
  title,
  loading,
  error,
  payload,
  kind,
}: LinkedRecordsSheetLayerProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <AppointmentPreviewSheetLoadingState
          open={open}
          onOpenChange={onOpenChange}
          title={title}
          maxWidthClassName="sm:max-w-[540px]"
          bodyClassName="space-y-4 px-5 py-4"
          loadingLabel={appointmentText("appointments_loading_linked_records")}
        />
      }
    >
      <LazyLinkedRecordsSheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        loading={loading}
        error={error}
        payload={payload}
        kind={kind}
      />
    </Suspense>
  );
}
