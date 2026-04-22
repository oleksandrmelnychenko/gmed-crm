import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

export function useAppointmentDetail({
  detailOpen,
  selectedId,
  detailVersion,
  detailTab,
  isMobile,
  permissions,
}: UseAppointmentDetailOptions) {
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailAssignments, setDetailAssignments] = useState<
    PatientAssignment[]
  >([]);
  const [detailResourceKeys, setDetailResourceKeys] = useState(() =>
    createDetailResourceKeyState(),
  );
  const detailResourceRequestKeysRef = useRef(createDetailResourceKeyState());
  const [detailChecklist, setDetailChecklist] = useState<ChecklistItem[]>([]);
  const [detailReminders, setDetailReminders] = useState<ReminderEntry[]>([]);
  const [detailReport, setDetailReport] = useState<ReportSummary | null>(null);
  const [detailTasks, setDetailTasks] = useState<TaskEntry[]>([]);
  const [detailServices, setDetailServices] = useState<ConciergeServiceEntry[]>(
    [],
  );
  const [detailCommunications, setDetailCommunications] = useState<
    AppointmentCommunicationEntry[]
  >([]);

  const currentDetailResourceKey = useMemo(
    () => (selectedId ? `${selectedId}:${detailVersion}` : ""),
    [detailVersion, selectedId],
  );
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
    setDetailLoading(false);
    setDetailError("");
    setDetail(null);
    setDetailAssignments([]);
    setDetailResourceKeys(createDetailResourceKeyState());
    setDetailChecklist([]);
    setDetailReminders([]);
    setDetailReport(null);
    setDetailTasks([]);
    setDetailServices([]);
    setDetailCommunications([]);
  }, []);

  useEffect(() => {
    if (!selectedId || !detailOpen) return;
    let active = true;

    async function loadDetail() {
      setDetailLoading(true);
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
      setDetailResourceKeys(createDetailResourceKeyState());
      setDetailError("");
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
        setDetail(appointmentDetail);
        setDetailAssignments(assignments);
        setDetailChecklist([]);
        setDetailReminders([]);
        setDetailReport(null);
        setDetailTasks([]);
        setDetailServices([]);
        setDetailCommunications([]);
      } catch (error) {
        if (!active) return;
        setDetail(null);
        setDetailAssignments([]);
        setDetailChecklist([]);
        setDetailReminders([]);
        setDetailReport(null);
        setDetailTasks([]);
        setDetailServices([]);
        setDetailCommunications([]);
        setDetailError(
          error instanceof Error
            ? error.message
            : appointmentText(
                "Termin konnte nicht geladen werden.",
                "Не удалось загрузить приём.",
                "Failed to load appointment",
              ),
        );
      } finally {
        if (active) setDetailLoading(false);
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
      detailError ||
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

    async function loadExtendedDetailResources() {
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = currentDetailResourceKey;
      }

      const results = await Promise.allSettled(
        pendingGroups.map((group) =>
          fetchAppointmentDetailResourceGroup(group, selectedId),
        ),
      );

      if (!active) {
        return;
      }

      const loadedGroups: AppointmentDetailResourceGroup[] = [];
      let firstErrorMessage = "";

      for (const [index, result] of results.entries()) {
        const group = pendingGroups[index];
        if (result.status === "fulfilled") {
          loadedGroups.push(group);
          switch (result.value.group) {
            case "checklist":
              setDetailChecklist(result.value.value);
              break;
            case "reminders":
              setDetailReminders(result.value.value);
              break;
            case "report":
              setDetailReport(result.value.value);
              break;
            case "tasks":
              setDetailTasks(result.value.value);
              break;
            case "services":
              setDetailServices(result.value.value);
              break;
            case "communications":
              setDetailCommunications(result.value.value);
              break;
          }
          continue;
        }

        if (!firstErrorMessage) {
          firstErrorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : appointmentText(
                  "Erweiterte Termindaten konnten nicht geladen werden.",
                  "Не удалось загрузить расширенные данные приёма.",
                  "Failed to load extended appointment data.",
                );
        }

        switch (group) {
          case "checklist":
            setDetailChecklist([]);
            break;
          case "reminders":
            setDetailReminders([]);
            break;
          case "report":
            setDetailReport(null);
            break;
          case "tasks":
            setDetailTasks([]);
            break;
          case "services":
            setDetailServices([]);
            break;
          case "communications":
            setDetailCommunications([]);
            break;
        }
      }

      if (loadedGroups.length > 0) {
        setDetailResourceKeys((current) => {
          const next = { ...current };
          for (const group of loadedGroups) {
            next[group] = currentDetailResourceKey;
          }
          return next;
        });
      }
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = "";
      }
      if (firstErrorMessage) {
        setDetailError(firstErrorMessage);
      }
    }

    void loadExtendedDetailResources();
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
    detailError,
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
