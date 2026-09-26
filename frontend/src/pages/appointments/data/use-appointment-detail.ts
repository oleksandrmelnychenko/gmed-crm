import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type SetStateAction,
} from "react";

import { apiFetch } from "@/lib/api";
import {
  fetchAppointmentDetailResourceGroup,
  type AppointmentDetailResourcePayload,
} from "@/pages/appointments/data/detail-resource-groups";
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

export function createDetailResourceKeyState() {
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

export function selectUnattemptedAppointmentDetailResourceGroups(
  missingGroups: AppointmentDetailResourceGroup[],
  attemptedKeys: Record<AppointmentDetailResourceGroup, string>,
  currentKey: string,
) {
  return missingGroups.filter(
    (group) => attemptedKeys[group] !== currentKey,
  );
}

export function areAppointmentDetailResourceGroupsSettled(
  requiredGroups: AppointmentDetailResourceGroup[],
  loadedKeys: Record<AppointmentDetailResourceGroup, string>,
  attemptedKeys: Record<AppointmentDetailResourceGroup, string>,
  loadingKeys: Record<AppointmentDetailResourceGroup, string>,
  currentKey: string,
) {
  return requiredGroups.every(
    (group) =>
      loadedKeys[group] === currentKey ||
      (attemptedKeys[group] === currentKey &&
        loadingKeys[group] !== currentKey),
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

export type AppointmentDetailState = {
  detailLoading: boolean;
  detailError: string;
  detail: AppointmentDetail | null;
  detailAssignments: PatientAssignment[];
  detailResourceKeys: Record<AppointmentDetailResourceGroup, string>;
  detailResourceAttemptedKeys: Record<AppointmentDetailResourceGroup, string>;
  detailResourceLoadingKeys: Record<AppointmentDetailResourceGroup, string>;
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

export function createAppointmentDetailState(): AppointmentDetailState {
  return {
    detailLoading: false,
    detailError: "",
    detail: null,
    detailAssignments: [],
    detailResourceKeys: createDetailResourceKeyState(),
    detailResourceAttemptedKeys: createDetailResourceKeyState(),
    detailResourceLoadingKeys: createDetailResourceKeyState(),
    detailChecklist: [],
    detailReminders: [],
    detailReport: null,
    detailTasks: [],
    detailServices: [],
    detailCommunications: [],
  };
}

export function appointmentDetailReducer(
  state: AppointmentDetailState,
  patch: AppointmentDetailPatch,
): AppointmentDetailState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

/** Empty rows for a resource group, as its state field patch. */
const EMPTY_DETAIL_RESOURCE_PATCH: Record<
  AppointmentDetailResourceGroup,
  () => Partial<AppointmentDetailState>
> = {
  checklist: () => ({ detailChecklist: [] }),
  reminders: () => ({ detailReminders: [] }),
  report: () => ({ detailReport: null }),
  tasks: () => ({ detailTasks: [] }),
  services: () => ({ detailServices: [] }),
  communications: () => ({ detailCommunications: [] }),
};

/**
 * Start of a detail (re)load for a new resource key: no resource group
 * counts as loaded, attempted or in flight any more.
 */
export function beginAppointmentDetailLoad(): Partial<AppointmentDetailState> {
  return {
    detailLoading: true,
    detailResourceKeys: createDetailResourceKeyState(),
    detailResourceAttemptedKeys: createDetailResourceKeyState(),
    detailResourceLoadingKeys: createDetailResourceKeyState(),
    detailError: "",
  };
}

/**
 * `GET /appointments/{id}` answered for `resourceKey`. The resource groups
 * for the same key are requested in parallel and may already have settled
 * (a refresh bumps the key while the previous detail is still shown), so
 * only groups not loaded for `resourceKey` are cleared: they still hold the
 * previous key's rows. Clearing everything here wiped a just-approved
 * report or a just-added checklist item until the page was reloaded,
 * because their groups already counted as loaded and were not requested
 * again.
 */
export function applyLoadedAppointmentDetail(
  current: AppointmentDetailState,
  loaded: {
    detail: AppointmentDetail;
    assignments: PatientAssignment[];
    assignmentsError: string;
  },
  resourceKey: string,
): Partial<AppointmentDetailState> {
  const patch: Partial<AppointmentDetailState> = {
    detail: loaded.detail,
    detailAssignments: loaded.assignments,
    // Keep an extended-resource error that already arrived for this load.
    detailError: loaded.assignmentsError || current.detailError,
    detailLoading: false,
  };
  for (const group of APPOINTMENT_DETAIL_RESOURCE_GROUPS) {
    if (current.detailResourceKeys[group] !== resourceKey) {
      Object.assign(patch, EMPTY_DETAIL_RESOURCE_PATCH[group]());
    }
  }
  return patch;
}

/** The resource groups in `groups` were requested for `resourceKey`. */
export function markAppointmentDetailResourceGroupsRequested(
  current: AppointmentDetailState,
  groups: AppointmentDetailResourceGroup[],
  resourceKey: string,
): Partial<AppointmentDetailState> {
  const detailResourceAttemptedKeys = { ...current.detailResourceAttemptedKeys };
  const detailResourceLoadingKeys = { ...current.detailResourceLoadingKeys };
  for (const group of groups) {
    detailResourceAttemptedKeys[group] = resourceKey;
    detailResourceLoadingKeys[group] = resourceKey;
  }
  return { detailResourceAttemptedKeys, detailResourceLoadingKeys };
}

export function settleAppointmentDetailResourceResults(
  pendingGroups: AppointmentDetailResourceGroup[],
  results: PromiseSettledResult<AppointmentDetailResourcePayload>[],
) {
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
      firstErrorMessage = appointmentText(
        "appointments_failed_to_load_extended_appointment_data",
      );
    }
  }

  return { detailPatch, firstErrorMessage, loadedGroups };
}

/**
 * Store a settled resource request for `resourceKey`: the fulfilled groups
 * count as loaded for that key and no requested group stays in flight.
 */
export function applyAppointmentDetailResourceSettlement(
  current: AppointmentDetailState,
  pendingGroups: AppointmentDetailResourceGroup[],
  settlement: ReturnType<typeof settleAppointmentDetailResourceResults>,
  resourceKey: string,
): Partial<AppointmentDetailState> {
  const patch: Partial<AppointmentDetailState> = { ...settlement.detailPatch };
  const detailResourceLoadingKeys = { ...current.detailResourceLoadingKeys };
  for (const group of pendingGroups) {
    if (detailResourceLoadingKeys[group] === resourceKey) {
      detailResourceLoadingKeys[group] = "";
    }
  }
  patch.detailResourceLoadingKeys = detailResourceLoadingKeys;
  if (settlement.loadedGroups.length > 0) {
    const detailResourceKeys = { ...current.detailResourceKeys };
    for (const group of settlement.loadedGroups) {
      detailResourceKeys[group] = resourceKey;
    }
    patch.detailResourceKeys = detailResourceKeys;
  }
  if (settlement.firstErrorMessage) {
    patch.detailError = settlement.firstErrorMessage;
  }
  return patch;
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
    detailResourceAttemptedKeys,
    detailResourceLoadingKeys,
    detailChecklist,
    detailReminders,
    detailReport,
    detailTasks,
    detailServices,
    detailCommunications,
  } = detailState;
  const detailResourceRequestKeysRef = useRef(createDetailResourceKeyState());
  const detailResourceRequestGenerationRef = useRef(0);
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
  const {
    canManageChecklist,
    canViewCommunications,
    canViewConciergeServices,
    canViewReminders,
    canViewReport,
    canViewTasks,
  } = permissions;
  const selectedDetailIsBlocked =
    Boolean(detail?.is_blocked) && detail?.id === selectedId;
  const requiredDetailResourceGroups = useMemo(
    () =>
      getRequiredAppointmentDetailResourceGroups(
        detailTab,
        isMobile,
        {
          canManageChecklist,
          canViewCommunications,
          canViewConciergeServices,
          canViewReminders,
          canViewReport,
          canViewTasks,
        },
        selectedDetailIsBlocked,
      ),
    [
      canManageChecklist,
      canViewCommunications,
      canViewConciergeServices,
      canViewReminders,
      canViewReport,
      canViewTasks,
      detailTab,
      isMobile,
      selectedDetailIsBlocked,
    ],
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
    requiresExtendedDetailResources &&
    requiredDetailResourceGroups.some(
      (group) =>
        detailResourceLoadingKeys[group] === currentDetailResourceKey,
    );
  const detailExtendedResourcesReady =
    !requiresExtendedDetailResources ||
    areAppointmentDetailResourceGroupsSettled(
      requiredDetailResourceGroups,
      detailResourceKeys,
      detailResourceAttemptedKeys,
      detailResourceLoadingKeys,
      currentDetailResourceKey,
    );
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
    detailResourceRequestGenerationRef.current += 1;
    detailResourceRequestKeysRef.current = createDetailResourceKeyState();
    return () => {
      detailResourceRequestGenerationRef.current += 1;
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
    };
  }, [detailOpen, detailVersion, selectedId]);

  useEffect(() => {
    if (!selectedId || !detailOpen) return;
    let active = true;
    const resourceKey = `${selectedId}:${detailVersion}`;

    async function loadDetail() {
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
      dispatchDetailState(beginAppointmentDetailLoad());
      try {
        const appointmentDetail = await apiFetch<AppointmentDetail>(
          `/appointments/${selectedId}`,
        );
        let assignments: PatientAssignment[] = [];
        let assignmentsError = "";
        if (!appointmentDetail.is_blocked && permissions.canViewNotes) {
          try {
            assignments = await apiFetch<PatientAssignment[]>(
              `/patients/${appointmentDetail.patient_id}/assignments`,
            );
          } catch {
            assignmentsError = appointmentText(
              "appointments_failed_to_load_extended_appointment_data",
            );
          }
        }

        if (!active) return;
        dispatchDetailState((current) =>
          applyLoadedAppointmentDetail(
            current,
            { detail: appointmentDetail, assignments, assignmentsError },
            resourceKey,
          ),
        );
      } catch {
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
          detailError: appointmentText(
            "appointments_failed_to_load_appointment",
          ),
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

  // On a refresh `detail` still holds the previous load when the key changes,
  // so the groups for the new key are requested alongside
  // `GET /appointments/{id}` and can settle first (see
  // `applyLoadedAppointmentDetail`).
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

    const pendingGroups = selectUnattemptedAppointmentDetailResourceGroups(
      missingDetailResourceGroups,
      detailResourceRequestKeysRef.current,
      currentDetailResourceKey,
    );
    if (pendingGroups.length === 0) {
      return;
    }

    function loadExtendedDetailResources() {
      const requestGeneration =
        detailResourceRequestGenerationRef.current;
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = currentDetailResourceKey;
      }
      dispatchDetailState((current) =>
        markAppointmentDetailResourceGroupsRequested(
          current,
          pendingGroups,
          currentDetailResourceKey,
        ),
      );

      const detailResourceRequest = Promise.allSettled(
        pendingGroups.map((group) =>
          fetchAppointmentDetailResourceGroup(group, selectedId),
        ),
      );

      void detailResourceRequest.then((results) => {
        if (
          requestGeneration !==
          detailResourceRequestGenerationRef.current
        ) {
          return;
        }
        const requestStillCurrent = pendingGroups.some(
          (group) =>
            detailResourceRequestKeysRef.current[group] ===
            currentDetailResourceKey,
        );
        if (!requestStillCurrent) {
          return;
        }

        const settlement = settleAppointmentDetailResourceResults(
          pendingGroups,
          results,
        );
        dispatchDetailState((current) =>
          applyAppointmentDetailResourceSettlement(
            current,
            pendingGroups,
            settlement,
            currentDetailResourceKey,
          ),
        );
      });
    }

    loadExtendedDetailResources();
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
