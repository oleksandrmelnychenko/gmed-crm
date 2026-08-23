import { useCallback, useEffect, useState } from "react";
import { ListChecks, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import {
  isConciergeTaskActive,
  TASK_MANAGER_ROLES,
  type ConciergeTask,
} from "@/pages/concierge/model";

const TASK_EVENTS = [
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.deleted",
] as const;

export function openAssignedTaskCount(tasks: ConciergeTask[]) {
  return tasks.filter(isConciergeTaskActive).length;
}

export function OpenTaskQueueLink() {
  const { user } = useAuth();
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [count, setCount] = useState<number | null>(null);
  const canUseTaskManager = Boolean(
    user?.id && TASK_MANAGER_ROLES.includes(user.role as (typeof TASK_MANAGER_ROLES)[number]),
  );

  const refresh = useCallback(() => {
    if (!user?.id || !canUseTaskManager) {
      setCount(null);
      return;
    }
    void apiFetch<ConciergeTask[]>(
      `/concierge-operational-items?assigned_to=${encodeURIComponent(user.id)}`,
      { forceFresh: true },
    )
      .then((tasks) => setCount(openAssignedTaskCount(tasks)))
      .catch(() => setCount(null));
  }, [canUseTaskManager, user?.id]);

  useEffect(refresh, [refresh]);
  useDebouncedRealtimeSubscription(TASK_EVENTS, refresh, 250);

  if (!canUseTaskManager) return null;

  const label = lang === "de" ? "Offene Aufgaben" : "Открытых задач";
  return (
    <Button
      type="button"
      variant="outline"
      className="h-9 rounded-lg bg-card"
      onClick={() => staffGo("/task-manager")}
    >
      <ListChecks className="size-4 text-[var(--brand)]" />
      {label}
      <Badge variant="secondary" className="min-w-6 justify-center rounded-full px-1.5">
        {count === null ? <LoaderCircle className="size-3 animate-spin" /> : count}
      </Badge>
    </Button>
  );
}
