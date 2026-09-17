import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  LoaderCircle,
  Minus,
  ReceiptText,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  currentPipelineStage,
  pipelineMissingLabel,
  pipelineStageLabel,
  pipelineStageSection,
  pipelineStateLabel,
  type OrderPipeline,
  type OrderPipelineStage,
  type OrderPipelineStageKey,
} from "../model/order-pipeline";
import type { OrderSectionKey } from "../sections";

type OrderPipelinePanelProps = {
  orderId: string;
  lang: string;
  locale: string;
  reloadNonce: number;
  appointmentsHref: string;
  providersHref: string;
  onOpenSection: (section: OrderSectionKey) => void;
};

const linkButtonClass = buttonVariants({ variant: "outline", size: "sm" });

const STAGE_ICONS: Record<OrderPipelineStageKey, LucideIcon> = {
  medical: Stethoscope,
  care_team: Users,
  appointments: CalendarClock,
  execution: ClipboardCheck,
  closure: ReceiptText,
};

const APPOINTMENT_STATUS: Record<string, { de: string; ru: string; tone: "neutral" | "info" | "warning" | "success" }> = {
  planned: { de: "Geplant", ru: "Запланирован", tone: "warning" },
  confirmed: { de: "Bestätigt", ru: "Подтверждён", tone: "info" },
  in_progress: { de: "Läuft", ru: "Идёт", tone: "info" },
  completed: { de: "Abgeschlossen", ru: "Завершён", tone: "success" },
  cancelled: { de: "Abgesagt", ru: "Отменён", tone: "neutral" },
};

function StageBlock({
  stage,
  lang,
  current,
  action,
  children,
}: {
  stage: OrderPipelineStage;
  lang: string;
  current: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = STAGE_ICONS[stage.key];
  return (
    <section
      className={cn(
        "rounded-lg border bg-card",
        current ? "border-orange-300 ring-1 ring-orange-200" : "border-border/70",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{pipelineStageLabel(stage.key, lang)}</h3>
          <StatusBadge
            tone={
              stage.state === "done"
                ? "success"
                : stage.state === "active"
                  ? "warning"
                  : "neutral"
            }
          >
            {pipelineStateLabel(stage.state, lang)}
          </StatusBadge>
        </div>
        {action}
      </header>
      <div className="space-y-3 p-4">
        {stage.missing.length > 0 ? (
          <ul className="space-y-1 text-sm text-amber-900">
            {stage.missing.map((reason) => (
              <li key={reason} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                {pipelineMissingLabel(reason, lang)}
              </li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/70 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function OrderPipelinePanel({
  orderId,
  lang,
  locale,
  reloadNonce,
  appointmentsHref,
  providersHref,
  onOpenSection,
}: OrderPipelinePanelProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [pipeline, setPipeline] = useState<OrderPipeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<OrderPipeline>(`/orders/${orderId}/pipeline`)
      .then((payload) => {
        if (!cancelled) setPipeline(payload);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadNonce]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!pipeline || pipeline.order_id !== orderId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-4 py-6 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {tx("Загружаем пайплайн заказа…", "Auftrags-Pipeline wird geladen…")}
      </div>
    );
  }

  const current = currentPipelineStage(pipeline.stages);
  const stageOf = (key: OrderPipelineStageKey) =>
    pipeline.stages.find((stage) => stage.key === key) ?? { key, state: "pending" as const, missing: [] };
  const openSection = (key: OrderPipelineStageKey, label: string) => (
    <Button type="button" variant="outline" size="sm" onClick={() => onOpenSection(pipelineStageSection(key))}>
      {label}
      <ChevronRight className="ml-1 size-3.5" />
    </Button>
  );
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(`${value}T00:00:00`),
    );
  const medical = pipeline.medical;

  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-5">
        {pipeline.stages.map((stage, index) => (
          <li
            key={stage.key}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
              stage.state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-800",
              stage.state === "not_required" && "border-border/60 bg-muted/30 text-muted-foreground",
              stage.key === current && "border-orange-300 bg-orange-50 text-orange-900",
              stage.state !== "done" &&
                stage.state !== "not_required" &&
                stage.key !== current &&
                "border-border/70 bg-card text-muted-foreground",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background/80 font-mono text-[11px]">
              {stage.state === "done" ? (
                <Check className="size-3" />
              ) : stage.state === "not_required" ? (
                <Minus className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0 truncate">{pipelineStageLabel(stage.key, lang)}</span>
          </li>
        ))}
      </ol>

      <StageBlock
        stage={stageOf("medical")}
        lang={lang}
        current={current === "medical"}
        action={
          medical.visible && medical.patient_id ? (
            <StaffLink to={`/patients/${encodeURIComponent(medical.patient_id)}?tab=clinical`} className={linkButtonClass}>
                {tx("Открыть медкарту", "Medizinische Akte öffnen")}
              </StaffLink>
          ) : undefined
        }
      >
        {!medical.visible ? (
          <p className="text-sm text-muted-foreground">
            {tx(
              "Медицинские данные доступны менеджеру пациента.",
              "Medizinische Daten sind dem Patientenmanager vorbehalten.",
            )}
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Fact label={tx("Кейс", "Fall")} value={medical.case_code ?? "—"} />
              <Fact
                label={tx("Анамнез", "Anamnese")}
                value={medical.anamnesis_recorded ? tx("Заполнен", "Erfasst") : tx("Нет", "Fehlt")}
              />
              <Fact label={tx("Диагнозы", "Vorerkrankungen")} value={medical.conditions} />
              <Fact label={tx("Аллергии", "Allergien")} value={medical.allergies} />
              <Fact label={tx("Медикаменты", "Medikamente")} value={medical.medications} />
              <Fact label={tx("Операции", "Operationen")} value={medical.operations} />
            </div>
            {medical.work_types.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {medical.work_types.map((workType) => (
                  <StatusBadge key={workType.id} tone={workType.status === "completed" ? "success" : "neutral"}>
                    {de
                      ? `${workType.specialization_de}: ${workType.name_de}`
                      : `${workType.specialization_ru}: ${workType.name_ru}`}
                  </StatusBadge>
                ))}
              </div>
            ) : null}
            <div>{openSection("medical", tx("План лечения", "Behandlungsplan"))}</div>
          </>
        )}
      </StageBlock>

      <StageBlock
        stage={stageOf("care_team")}
        lang={lang}
        current={current === "care_team"}
        action={
          <div className="flex flex-wrap gap-2">
            <StaffLink to={providersHref} className={linkButtonClass}>{tx("Подобрать провайдера", "Anbieter auswählen")}</StaffLink>
            {openSection("care_team", tx("Услуги заказа", "Leistungen"))}
          </div>
        }
      >
        {pipeline.care_team.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tx(
              "Провайдер и врач появятся здесь, когда будут указаны в услуге или приёме.",
              "Anbieter und Arzt erscheinen hier, sobald sie in einer Leistung oder einem Termin stehen.",
            )}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {pipeline.care_team.map((member) => (
              <li
                key={`${member.provider_id}:${member.doctor_id ?? ""}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <StaffLink
                    to={`/providers/${encodeURIComponent(member.provider_id)}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {member.provider_name}
                  </StaffLink>
                  <div className="text-xs text-muted-foreground">
                    {member.doctor_name
                      ? [member.doctor_title, member.doctor_name, member.doctor_specialty]
                          .filter(Boolean)
                          .join(" · ")
                      : tx("Врач не указан", "Kein Arzt angegeben")}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {tx("Услуг", "Leistungen")}: {member.services} · {tx("Приёмов", "Termine")}: {member.appointments}
                </div>
              </li>
            ))}
          </ul>
        )}
      </StageBlock>

      <StageBlock
        stage={stageOf("appointments")}
        lang={lang}
        current={current === "appointments"}
        action={
          <StaffLink to={appointmentsHref} className={linkButtonClass}>{tx("Календарь приёмов", "Terminkalender")}</StaffLink>
        }
      >
        {pipeline.appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tx("К заказу ещё не привязан ни один приём.", "Dem Auftrag ist noch kein Termin zugeordnet.")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {pipeline.appointments.map((appointment) => {
              const status = APPOINTMENT_STATUS[appointment.status];
              return (
                <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <StaffLink
                      to={`/appointments?appointment=${encodeURIComponent(appointment.id)}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {appointment.title}
                    </StaffLink>
                    <div className="text-xs text-muted-foreground">
                      {[
                        `${formatDate(appointment.date)}${appointment.time_start ? ` ${appointment.time_start}` : ""}`,
                        appointment.provider_name,
                        appointment.doctor_name,
                        appointment.interpreter_name
                          ? `${tx("Переводчик", "Dolmetscher")}: ${appointment.interpreter_name}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <StatusBadge tone={status?.tone ?? "neutral"}>
                    {status ? (de ? status.de : status.ru) : appointment.status}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </StageBlock>

      <StageBlock
        stage={stageOf("execution")}
        lang={lang}
        current={current === "execution"}
        action={openSection("execution", tx("Выполнение", "Durchführung"))}
      >
        <div className="grid gap-2 sm:grid-cols-4">
          <Fact label={tx("Запланировано", "Geplant")} value={pipeline.services.planned} />
          <Fact label={tx("Оказано", "Erbracht")} value={pipeline.services.delivered} />
          <Fact label={tx("Подтверждено", "Freigegeben")} value={pipeline.services.approved} />
          <Fact label={tx("В счёте", "Abgerechnet")} value={pipeline.services.invoiced} />
        </div>
      </StageBlock>

      <StageBlock
        stage={stageOf("closure")}
        lang={lang}
        current={current === "closure"}
        action={openSection("closure", tx("Счета заказа", "Rechnungen"))}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label={tx("Счетов", "Rechnungen")} value={pipeline.invoices.total} />
          <Fact label={tx("Не оплачено", "Offen")} value={pipeline.invoices.open} />
        </div>
      </StageBlock>
    </div>
  );
}
