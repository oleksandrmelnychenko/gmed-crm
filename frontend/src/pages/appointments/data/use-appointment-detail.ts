import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type SetStateAction,
} from "react";

import { apiFetch } from "@/lib/api";
import { fetchAppointmentDetailResourceGroup } from "@/pages/appointments/data/detail-resource-groups";
import {
  APPOINTMENT_DETAIL_RESOURCE_GROUPS,
  getRequiredAppointmentDetailResourceGroups,
  type AppointmentDetailResourceGroup,
} from "@/pages/appointments/model/detail-resource-needs";
import { resolveFollowUpDefaultAssignee } from "@/pages/appointments/model/form-factories";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentCommunicationEntry,
  AppointmentDetail,
  AppointmentPermissions,
  AppointmentWorkspaceTab,
  ChecklistItem,
  ConciergeServiceEntry,
  PatientAssignment,
  ReminderEntry,
  ReportSummary,
  TaskEntry,
} from "@/pages/appointments/model/types";

function createDetailResourceKeyState() {
  return APPOINTMENT_DETAIL_RESOURCE_GROUPS.reduce<
    Record<AppointmentDetailResourceGroup, string>
  >(
    (state, group) => {
      state[group] = "";
      return state;
    },
    {
      checklist: "",
      reminders: "",
      report: "",
      tasks: "",
      services: "",
      communications: "",
    },
  );
}

type UseAppointmentDetailOptions = {
  detailOpen: boolean;
  selectedId: string;
  detailVersion: number;
  detailTab: AppointmentWorkspaceTab;
  isMobile: boolean;
  permissions: AppointmentPermissions;
};

type AppointmentDetailState = {
  detailLoading: boolean;
  detailError: string;
  detail: AppointmentDetail | null;
  detailAssignments: PatientAssignment[];
  detailResourceKeys: Record<AppointmentDetailResourceGroup, string>;
  detailChecklist: ChecklistItem[];
  detailReminders: ReminderEntry[];
  detailReport: ReportSummary | null;
  detailTasks: TaskEntry[];
  detailServices: ConciergeServiceEntry[];
  detailCommunications: AppointmentCommunicationEntry[];
};

type AppointmentDetailPatch =
  | Partial<AppointmentDetailState>
  | ((current: AppointmentDetailState) => Partial<AppointmentDetailState>);

function createAppointmentDetailState(): AppointmentDetailState {
  return {
    detailLoading: false,
    detailError: "",
    detail: null,
    detailAssignments: [],
    detailResourceKeys: createDetailResourceKeyState(),
    detailChecklist: [],
    detailReminders: [],
    detailReport: null,
    detailTasks: [],
    detailServices: [],
    detailCommunications: [],
  };
}

function appointmentDetailReducer(
  state: AppointmentDetailState,
  patch: AppointmentDetailPatch,
): AppointmentDetailState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function useAppointmentDetail({
  detailOpen,
  selectedId,
  detailVersion,
  detailTab,
  isMobile,
  permissions,
}: UseAppointmentDetailOptions) {
  const [detailState, dispatchDetailState] = useReducer(
    appointmentDetailReducer,
    undefined,
    createAppointmentDetailState,
  );
  const {
    detailLoading,
    detailError,
    detail,
    detailAssignments,
    detailResourceKeys,
    detailChecklist,
    detailReminders,
    detailReport,
    detailTasks,
    detailServices,
    detailCommunications,
  } = detailState;
  const detailResourceRequestKeysRef = useRef(createDetailResourceKeyState());
  const setDetailError = useCallback(
    (nextValue: SetStateAction<string>) => {
      dispatchDetailState((current) => ({
        detailError:
          typeof nextValue === "function"
            ? nextValue(current.detailError)
            : nextValue,
      }));
    },
    [],
  );

  const currentDetailResourceKey = selectedId ? `${selectedId}:${detailVersion}` : "";
  const requiredDetailResourceGroups = getRequiredAppointmentDetailResourceGroups(
    detailTab,
    isMobile,
    permissions,
  );
  const missingDetailResourceGroups = useMemo(
    () =>
      requiredDetailResourceGroups.filter(
        (group) => detailResourceKeys[group] !== currentDetailResourceKey,
      ),
    [currentDetailResourceKey, detailResourceKeys, requiredDetailResourceGroups],
  );
  const requiresExtendedDetailResources =
    detailOpen && Boolean(selectedId) && requiredDetailResourceGroups.length > 0;
  const detailExtendedLoading =
    requiresExtendedDetailResources && missingDetailResourceGroups.length > 0;
  const detailExtendedResourcesReady =
    !requiresExtendedDetailResources || missingDetailResourceGroups.length === 0;
  const detailDefaultAssigneeId = useMemo(
    () =>
      detail ? resolveFollowUpDefaultAssignee(detail, detailAssignments) : "",
    [detail, detailAssignments],
  );

  const resetAppointmentDetailState = useCallback(() => {
    detailResourceRequestKeysRef.current = createDetailResourceKeyState();
    dispatchDetailState(createAppointmentDetailState());
  }, []);

  useEffect(() => {
    if (!selectedId || !detailOpen) return;
    let active = true;

    async function loadDetail() {
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
      dispatchDetailState({
        detailLoading: true,
        detailResourceKeys: createDetailResourceKeyState(),
        detailError: "",
      });
      try {
        const appointmentDetail = await apiFetch<AppointmentDetail>(
          `/appointments/${selectedId}`,
        );
        const assignments =
          appointmentDetail.is_blocked || !permissions.canViewNotes
            ? []
            : await apiFetch<PatientAssignment[]>(
                `/patients/${appointmentDetail.patient_id}/assignments`,
              ).catch(() => []);

        if (!active) return;
        dispatchDetailState({
          detail: appointmentDetail,
          detailAssignments: assignments,
          detailChecklist: [],
          detailReminders: [],
          detailReport: null,
          detailTasks: [],
          detailServices: [],
          detailCommunications: [],
          detailLoading: false,
        });
      } catch (error) {
        if (!active) return;
        dispatchDetailState({
          detail: null,
          detailAssignments: [],
          detailChecklist: [],
          detailReminders: [],
          detailReport: null,
          detailTasks: [],
          detailServices: [],
          detailCommunications: [],
          detailError:
            error instanceof Error
              ? error.message
              : appointmentText("appointments_failed_to_load_appointment"),
          detailLoading: false,
        });
      }
    }

    void loadDetail();
    return () => {
      active = false;
    };
  }, [
    detailOpen,
    detailVersion,
    permissions.canViewNotes,
    selectedId,
  ]);

  useEffect(() => {
    if (
      !selectedId ||
      !detailOpen ||
      detailLoading ||
      !detail ||
      !requiresExtendedDetailResources ||
      missingDetailResourceGroups.length === 0
    ) {
      return;
    }

    const pendingGroups = missingDetailResourceGroups.filter(
      (group) =>
        detailResourceRequestKeysRef.current[group] !== currentDetailResourceKey,
    );
    if (pendingGroups.length === 0) {
      return;
    }

    let active = true;

    function loadExtendedDetailResources() {
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = currentDetailResourceKey;
      }

      const detailResourceRequest = Promise.allSettled(
        pendingGroups.map((group) =>
          fetchAppointmentDetailResourceGroup(group, selectedId),
        ),
      );

      if (!active) {
        return;
      }

      void detailResourceRequest.then((results) => {
        if (!active) {
          return;
        }

        const loadedGroups: AppointmentDetailResourceGroup[] = [];
      const detailPatch: Partial<AppointmentDetailState> = {};
      let firstErrorMessage = "";

      for (const [index, result] of results.entries()) {
        const group = pendingGroups[index];
        if (result.status === "fulfilled") {
          const resource = result.value;
          loadedGroups.push(group);
          switch (resource.group) {
            case "checklist":
              detailPatch.detailChecklist = resource.value;
              break;
            case "reminders":
              detailPatch.detailReminders = resource.value;
              break;
            case "report":
              detailPatch.detailReport = resource.value;
              break;
            case "tasks":
              detailPatch.detailTasks = resource.value;
              break;
            case "services":
              detailPatch.detailServices = resource.value;
              break;
            case "communications":
              detailPatch.detailCommunications = resource.value;
              break;
          }
          continue;
        }

        if (!firstErrorMessage) {
          firstErrorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : appointmentText("appointments_failed_to_load_extended_appointment_data");
        }

        switch (group) {
          case "checklist":
            detailPatch.detailChecklist = [];
            break;
          case "reminders":
            detailPatch.detailReminders = [];
            break;
          case "report":
            detailPatch.detailReport = null;
            break;
          case "tasks":
            detailPatch.detailTasks = [];
            break;
          case "services":
            detailPatch.detailServices = [];
            break;
          case "communications":
            detailPatch.detailCommunications = [];
            break;
        }
      }

      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = "";
      }
        if (
          pendingGroups.length > 0 ||
          firstErrorMessage ||
          Object.keys(detailPatch).length > 0
        ) {
          dispatchDetailState((current) => {
            if (pendingGroups.length > 0) {
              const detailResourceKeys = { ...current.detailResourceKeys };
              for (const group of pendingGroups) {
                detailResourceKeys[group] = currentDetailResourceKey;
              }
              detailPatch.detailResourceKeys = detailResourceKeys;
            }
            if (firstErrorMessage) {
              detailPatch.detailError = firstErrorMessage;
            }
            return detailPatch;
          });
        }
      });
    }

    loadExtendedDetailResources();
    return () => {
      active = false;
      for (const group of pendingGroups) {
        if (detailResourceRequestKeysRef.current[group] === currentDetailResourceKey) {
          detailResourceRequestKeysRef.current[group] = "";
        }
      }
    };
  }, [
    currentDetailResourceKey,
    detail,
    detailLoading,
    detailOpen,
    missingDetailResourceGroups,
    requiresExtendedDetailResources,
    selectedId,
  ]);

  return {
    detailLoading,
    detailError,
    setDetailError,
    detail,
    detailAssignments,
    detailChecklist,
    detailReminders,
    detailReport,
    detailTasks,
    detailServices,
    detailCommunications,
    detailExtendedLoading,
    detailExtendedResourcesReady,
    detailDefaultAssigneeId,
    resetAppointmentDetailState,
  };
}
