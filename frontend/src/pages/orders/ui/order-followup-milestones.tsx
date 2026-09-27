import { useState, type Dispatch, type SetStateAction } from "react";
import { BellPlus, CalendarPlus, CheckCircle2, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { updateOrderFollowupFlow } from "../data/order-api";
import { FOLLOWUP_MILESTONES_ANCHOR_ID } from "../model/blocking-reasons";
import {
  FOLLOWUP_MILESTONES,
  followupMilestoneKeys,
  followupMilestoneLabel,
  followupMilestoneNeedsDate,
  followupMilestoneTitle,
  followupReminderAt,
  recommendedFollowupDate,
  withFollowupMilestoneStatus,
  type FollowupMilestone,
} from "../model/order-followup-milestones";
import { formatDateOnly } from "../model/order-model";
import type { FollowupStatus, OrderFollowupFlow, OrderFollowupFormState } from "../model/types";

type Bilingual = (ru: string, de: string) => string;

/** DOM id of the milestone planner; the follow-up blockers open it directly. */
export const ORDER_FOLLOWUP_MILESTONES_ANCHOR = FOLLOWUP_MILESTONES_ANCHOR_ID;

type Notice = { milestone: FollowupMilestone; text: string; tone: "success" | "error" };

/**
 * The 1-week / 1-month / 6-month follow-up contacts of an order. Each one is
 * planned here with a status and a date (prefilled from the closure anchor);
 * "scheduled" with a date counts for the follow-up gate. A reminder (on the
 * order's appointment) or a follow-up visit can be created directly for the
 * date, with visible confirmation.
 */
export function OrderFollowupMilestones({
  orderId,
  patientId,
  flow,
  form,
  onFormChange,
  canManage,
  currentUserId,
  lang,
  statusLabel,
  onCreated,
}: {
  orderId: string;
  patientId: string | null;
  flow: OrderFollowupFlow;
  form: OrderFollowupFormState;
  onFormChange: Dispatch<SetStateAction<OrderFollowupFormState>>;
  canManage: boolean;
  currentUserId: string | null;
  lang: Lang;
  statusLabel: (status: FollowupStatus) => string;
  onCreated: () => void;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function create(milestone: FollowupMilestone, kind: "reminder" | "visit") {
    const keys = followupMilestoneKeys(milestone);
    const date = form[keys.dateField] || recommendedFollowupDate(flow, milestone);
    const title = followupMilestoneTitle(milestone, tx);
    setBusy(`${milestone}:${kind}`);
    setNotice(null);
    try {
      if (kind === "reminder") {
        const anchor = flow.reminder_anchor_appointment_id;
        const remindAt = followupReminderAt(date);
        if (!anchor || !currentUserId || !remindAt) {
          throw new Error(
            tx(
              "У заказа нет приёма, к которому можно привязать напоминание. Запланируйте визит.",
              "Der Auftrag hat keinen Termin für die Erinnerung. Planen Sie einen Nachsorgetermin.",
            ),
          );
        }
        await apiFetch(`/appointments/${anchor}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: currentUserId,
            remind_at: remindAt,
            title,
            description: tx("Запланировано из заказа.", "Aus dem Auftrag geplant."),
          }),
        });
      } else {
        if (!patientId) {
          throw new Error(tx("Заказ не привязан к пациенту.", "Der Auftrag hat keinen Patienten."));
        }
        await apiFetch("/appointments", {
          method: "POST",
          body: JSON.stringify({
            patient_id: patientId,
            order_id: orderId,
            owner_user_id: currentUserId,
            appointment_type: "medical",
            care_path_kind: "followup",
            followup_milestone: milestone,
            skip_medical_provider_binding: true,
            title,
            date,
            time_start: null,
            time_end: null,
          }),
        });
      }
      await updateOrderFollowupFlow(orderId, {
        [keys.apiStatus]: "scheduled",
        [keys.apiDate]: date,
      });
      onFormChange((current) => ({
        ...current,
        [keys.statusField]: "scheduled",
        [keys.dateField]: date,
      }));
      const dateLabel = formatDateOnly(date, "de-DE", date);
      const text =
        kind === "reminder"
          ? tx(`Напоминание на ${dateLabel} создано.`, `Erinnerung für ${dateLabel} erstellt.`)
          : tx(`Визит на ${dateLabel} запланирован.`, `Termin am ${dateLabel} geplant.`);
      setNotice({ milestone, text, tone: "success" });
      toast.success(text);
      onCreated();
    } catch (error) {
      const text =
        error instanceof Error && error.message
          ? error.message
          : tx("Не удалось создать.", "Konnte nicht erstellt werden.");
      setNotice({ milestone, text, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      id={ORDER_FOLLOWUP_MILESTONES_ANCHOR}
      className="scroll-mt-4 rounded-2xl border border-border p-4"
      data-testid="order-followup-milestones"
    >
      <div className="text-sm font-semibold text-foreground">
        {tx("Контрольные контакты после лечения", "Nachsorgekontakte nach der Behandlung")}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {tx(
          "Статус «Запланировано» с датой засчитывается для перехода в наблюдение. Напоминание или визит можно создать сразу — дата подставлена от даты закрытия.",
          "„Geplant“ mit Datum zählt für den Übergang in die Nachsorge. Erinnerung oder Termin lassen sich direkt anlegen – das Datum ist ab dem Abschlussdatum vorbelegt.",
        )}
      </p>
      <div className="mt-4 divide-y divide-border/60">
        {FOLLOWUP_MILESTONES.map((milestone) => {
          const keys = followupMilestoneKeys(milestone);
          const ready = Boolean(flow[keys.ready]);
          const needsDate = followupMilestoneNeedsDate(form, milestone);
          const rowNotice = notice?.milestone === milestone ? notice : null;
          const label = followupMilestoneLabel(milestone, tx);
          return (
            <div key={milestone} className="grid gap-2 py-3" data-testid={`followup-milestone-${milestone}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full",
                    ready
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  {ready
                    ? tx("Учтено", "Berücksichtigt")
                    : tx("Не запланировано", "Nicht geplant")}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <NativeComboboxSelect
                  aria-label={`${label}: ${tx("статус", "Status")}`}
                  disabled={!canManage}
                  value={form[keys.statusField]}
                  onChange={(event) =>
                    onFormChange((current) =>
                      withFollowupMilestoneStatus(
                        current,
                        milestone,
                        event.target.value as FollowupStatus,
                        flow,
                      ),
                    )
                  }
                  className="h-9 w-full rounded-lg bg-field text-sm"
                >
                  {(["pending", "scheduled", "completed", "not_required"] as const).map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </NativeComboboxSelect>
                <Input
                  type="date"
                  aria-label={`${label}: ${tx("дата", "Datum")}`}
                  disabled={!canManage}
                  value={form[keys.dateField]}
                  aria-invalid={needsDate || undefined}
                  onChange={(event) =>
                    onFormChange((current) => ({ ...current, [keys.dateField]: event.target.value }))
                  }
                  className="h-9"
                />
              </div>
              {needsDate ? (
                <p className="text-xs text-amber-700">
                  {tx(
                    "Укажите дату — без неё запланированный контакт не засчитывается.",
                    "Datum angeben – ohne Datum zählt der geplante Kontakt nicht.",
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {tx("Визиты", "Termine")}: {flow[keys.visits]} · {tx("Напоминания", "Erinnerungen")}:{" "}
                  {flow[keys.reminders]}
                </span>
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={busy !== null || !flow.reminder_anchor_appointment_id}
                      title={
                        flow.reminder_anchor_appointment_id
                          ? undefined
                          : tx(
                              "Нет приёма заказа для напоминания — запланируйте визит.",
                              "Kein Auftragstermin für die Erinnerung – planen Sie einen Termin.",
                            )
                      }
                      onClick={() => void create(milestone, "reminder")}
                    >
                      {busy === `${milestone}:reminder` ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <BellPlus className="size-3.5" />
                      )}
                      {tx("Создать напоминание", "Erinnerung anlegen")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={busy !== null || !patientId}
                      onClick={() => void create(milestone, "visit")}
                    >
                      {busy === `${milestone}:visit` ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <CalendarPlus className="size-3.5" />
                      )}
                      {tx("Запланировать визит", "Termin planen")}
                    </Button>
                  </>
                ) : null}
              </div>
              {rowNotice ? (
                <p
                  role={rowNotice.tone === "error" ? "alert" : "status"}
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    rowNotice.tone === "error" ? "text-destructive" : "text-emerald-700",
                  )}
                >
                  {rowNotice.tone === "success" ? <CheckCircle2 className="size-3.5" /> : null}
                  {rowNotice.text}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
