import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AppointmentCreateContext } from "@/pages/appointments/model/form-factories";
import type {
  FiltersState,
  OperationalScope,
} from "@/pages/appointments/model/types";

type SetSearchParams = (
  nextInit: URLSearchParams,
  navigateOptions?: { replace?: boolean },
) => void;

type QuerySyncOptions = {
  replace?: boolean;
};

type UseAppointmentQueryActionsOptions = {
  searchParams: URLSearchParams;
  setSearchParams: SetSearchParams;
  defaultFilters: FiltersState;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
  setOperationalScope: Dispatch<SetStateAction<OperationalScope>>;
};

type UseAppointmentRouteHydrationOptions = {
  searchParams: URLSearchParams;
  setSearchParams: SetSearchParams;
  selectedId: string;
  detailOpen: boolean;
  canCreate: boolean;
  closeDetailWorkspace: (clearQuery?: boolean) => void;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
  openDetailWorkspace: (appointmentId: string) => void;
  onOpenCreateFromRoute: (context: AppointmentCreateContext) => void;
};

export function useAppointmentQueryActions({
  searchParams,
  setSearchParams,
  defaultFilters,
  setFilters,
  setOperationalScope,
}: UseAppointmentQueryActionsOptions) {
  const syncQuery = useCallback(
    (next: Record<string, string | null>, options: QuerySyncOptions = {}) => {
      const params = new URLSearchParams(searchParams);
      Object.entries(next).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      setSearchParams(params, { replace: options.replace ?? true });
    },
    [searchParams, setSearchParams],
  );

  const resetSearchFilters = useCallback(() => {
    setOperationalScope("all");
    setFilters(defaultFilters);
    syncQuery({
      patient: null,
      order: null,
      provider: null,
      doctor: null,
      appointment: null,
      detailTab: null,
    });
  }, [defaultFilters, setFilters, setOperationalScope, syncQuery]);

  const handleSearchPatientChange = useCallback(
    (patientId: string) => {
      setFilters((current) => ({ ...current, patientId }));
      // The order context belongs to the previous patient.
      const keepOrder =
        Boolean(patientId) && searchParams.get("patient") === patientId;
      syncQuery({
        patient: patientId || null,
        ...(keepOrder ? {} : { order: null }),
      });
    },
    [searchParams, setFilters, syncQuery],
  );

  const handleSearchProviderChange = useCallback(
    (providerId: string) => {
      setFilters((current) => ({
        ...current,
        providerId,
        doctorId: "",
      }));
      syncQuery({
        provider: providerId || null,
        doctor: null,
      });
    },
    [setFilters, syncQuery],
  );

  const handleSearchDoctorChange = useCallback(
    (doctorId: string) => {
      setFilters((current) => ({ ...current, doctorId }));
      syncQuery({ doctor: doctorId || null });
    },
    [setFilters, syncQuery],
  );

  return {
    syncQuery,
    resetSearchFilters,
    handleSearchPatientChange,
    handleSearchProviderChange,
    handleSearchDoctorChange,
  };
}

export function useAppointmentRouteHydration({
  searchParams,
  setSearchParams,
  selectedId,
  detailOpen,
  canCreate,
  closeDetailWorkspace,
  setFilters,
  openDetailWorkspace,
  onOpenCreateFromRoute,
}: UseAppointmentRouteHydrationOptions) {
  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const orderParam = searchParams.get("order") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";
    const appointmentParam = searchParams.get("appointment") ?? "";
    const createParam = searchParams.get("create") ?? "";

    setFilters((current) => {
      if (
        current.patientId === patientParam &&
        current.providerId === providerParam &&
        current.doctorId === doctorParam
      ) {
        return current;
      }
      return {
        ...current,
        patientId: patientParam,
        providerId: providerParam,
        doctorId: providerParam ? doctorParam : "",
      };
    });

    if (appointmentParam && appointmentParam !== selectedId) {
      openDetailWorkspace(appointmentParam);
    }

    if (!appointmentParam && (selectedId || detailOpen)) {
      closeDetailWorkspace(false);
    }

    if (createParam && canCreate) {
      onOpenCreateFromRoute({ patientId: patientParam, orderId: orderParam });
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [
    canCreate,
    closeDetailWorkspace,
    detailOpen,
    onOpenCreateFromRoute,
    openDetailWorkspace,
    searchParams,
    selectedId,
    setFilters,
    setSearchParams,
  ]);
}
