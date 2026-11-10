import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  CircleAlert,
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

import { SectionHeading } from "@/components/ui/section-heading";
import { StaffLink } from "@/components/staff-link";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { apiFetch } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  currentPipelineStage,
  pipelineMissingLabel,
  pipelineStageLabel,
  pipelineStageSection,
  ORDER_APPOINTMENT_STATUS,
  pipelineStateLabel,
  type OrderPipeline,
  type OrderPipelineStage,
  type OrderPipelineStageKey,
} from "../model/order-pipeline";
import type { OrderSectionKey } from "../sections";

type OrderPipelinePanelProps = {
  orderId: string;
  lang: string;
  reloadNonce: number;
  appointmentsHref: string;
  /** Opens the new-appointment form for this order; empty without the right to plan. */
  newAppointmentHref?: string;
  providersHref: string;
  /** Patient invoices of this order; closure is settled there, not in the supplier invoices. */
  invoicesHref: string;
  onOpenSection: (section: OrderSectionKey) => void;
};

const linkButtonClass = cn(buttonVariants({ size: "sm" }), "h-auto min-h-[30px] rounded-lg px-2.5 py-1 text-[13px] max-sm:min-h-10");

const STAGE_ICONS: Record<OrderPipelineStageKey, LucideIcon> = {
  medical: Stethoscope,
  care_team: Users,
  appointments: CalendarClock,
  execution: ClipboardCheck,
  closure: ReceiptText,
};

function StageBlock({
  stage,
  lang,
  current,
  action,
  children,
  sectionRef,
}: {
  stage: OrderPipelineStage;
  lang: string;
  current: boolean;
  action?: ReactNode;
  children: ReactNode;
  sectionRef: (element: HTMLElement | null) => void;
}) {
  const Icon = STAGE_ICONS[stage.key];
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={pipelineStageLabel(stage.key, lang)}
      className={cn(
        "scroll-mt-3 overflow-hidden rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current ? "border-primary/25" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold"><SectionHeading icon={Icon}>{pipelineStageLabel(stage.key, lang)}</SectionHeading></h2>
          <StatusChip
            tone={
              stage.state === "done"
                ? "success"
                : stage.state === "active"
                  ? "warning"
                  : "neutral"
            }
          >
            {pipelineStateLabel(stage.state, lang)}
          </StatusChip>
        </div>
        {action}
      </header>
      <div className="space-y-2.5 p-3 text-[13px] leading-5">
        {stage.missing.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {stage.missing.map((reason) => (
              <li key={reason} className="max-w-full">
                <StatusChip tone="warning">
                  <CircleAlert aria-hidden />
                  {pipelineMissingLabel(reason, lang)}
                </StatusChip>
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
    <div className="min-w-0 border-b border-border/70 px-2 py-1.5">
      <div className="text-xs leading-4 text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-semibold leading-5 tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function OrderPipelinePanel({
  orderId,
  lang,
  reloadNonce,
  appointmentsHref,
  newAppointmentHref,
  providersHref,
  invoicesHref,
  onOpenSection,
}: OrderPipelinePanelProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [pipeline, setPipeline] = useState<OrderPipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = useRef<Partial<Record<OrderPipelineStageKey, HTMLElement>>>({});

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
    <Button type="button" size="sm" onClick={() => onOpenSection(pipelineStageSection(key))}>
      {label}
      <ChevronRight className="ml-1 size-3.5" />
    </Button>
  );
  const formatDate = (value: string) =>
    formatAppDate(value) || value;
  const medical = pipeline.medical;

  return (
    <div className="@container space-y-2">
      <nav aria-label={tx("Этапы выполнения заказа", "Bearbeitungsschritte des Auftrags")} className="overflow-x-auto rounded-xl border border-border bg-card p-1">
        <ol className="mx-auto flex w-max gap-1">
          {pipeline.stages.map((stage, index) => {
            const Icon = STAGE_ICONS[stage.key];
            return (
              <li key={stage.key}>
                <button
                  type="button"
                  data-workspace-tab
                  aria-current={stage.key === current ? "step" : undefined}
                  title={`${pipelineStageLabel(stage.key, lang)} · ${pipelineStateLabel(stage.state, lang)}`}
                  onClick={() => {
                    const section = sections.current[stage.key];
                    section?.scrollIntoView({ block: "start", behavior: "instant" });
                    section?.focus({ preventScroll: true });
                  }}
                  className="flex min-h-9 shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium transition-colors max-sm:min-h-10"
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{pipelineStageLabel(stage.key, lang)}</span>
                  <span aria-hidden className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums", stage.state === "done" && "bg-emerald-50 text-emerald-700")}>
                    {stage.state === "done" ? <Check className="size-3" /> : stage.state === "not_required" ? <Minus className="size-3" /> : index + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <StageBlock
        sectionRef={(element) => { sections.current.medical = element ?? undefined; }}
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
            <div className="grid gap-2 @[24rem]:grid-cols-2 @[36rem]:grid-cols-3 @[64rem]:grid-cols-6">
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
        sectionRef={(element) => { sections.current.care_team = element ?? undefined; }}
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
        sectionRef={(element) => { sections.current.appointments = element ?? undefined; }}
        stage={stageOf("appointments")}
        lang={lang}
        current={current === "appointments"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StaffLink to={appointmentsHref} className={linkButtonClass}>{tx("Календарь приёмов", "Terminkalender")}</StaffLink>
            {newAppointmentHref ? (
              <StaffLink to={newAppointmentHref} className={linkButtonClass}>{tx("Новый приём", "Neuer Termin")}</StaffLink>
            ) : null}
          </div>
        }
      >
        {pipeline.appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tx("К заказу ещё не привязан ни один приём.", "Dem Auftrag ist noch kein Termin zugeordnet.")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {pipeline.appointments.map((appointment) => {
              const status = ORDER_APPOINTMENT_STATUS[appointment.status];
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
        sectionRef={(element) => { sections.current.execution = element ?? undefined; }}
        stage={stageOf("execution")}
        lang={lang}
        current={current === "execution"}
        action={openSection("execution", tx("Выполнение", "Durchführung"))}
      >
        <div className="grid gap-2 @[24rem]:grid-cols-2 @[48rem]:grid-cols-4">
          <Fact label={tx("Запланировано", "Geplant")} value={pipeline.services.planned} />
          <Fact label={tx("Оказано", "Erbracht")} value={pipeline.services.delivered} />
          <Fact label={tx("Подтверждено", "Freigegeben")} value={pipeline.services.approved} />
          <Fact label={tx("В счёте", "Abgerechnet")} value={pipeline.services.invoiced} />
          {pipeline.services.cancelled ? (
            <Fact label={tx("Отменено", "Storniert")} value={pipeline.services.cancelled} />
          ) : null}
        </div>
      </StageBlock>

      <StageBlock
        sectionRef={(element) => { sections.current.closure = element ?? undefined; }}
        stage={stageOf("closure")}
        lang={lang}
        current={current === "closure"}
        action={
          <StaffLink to={invoicesHref} className={linkButtonClass}>
            {tx("Счета пациента", "Patientenrechnungen")}
            <ChevronRight className="ml-1 size-3.5" />
          </StaffLink>
        }
      >
        <div className="grid gap-2 @[24rem]:grid-cols-2">
          <Fact label={tx("Счетов", "Rechnungen")} value={pipeline.invoices.total} />
          <Fact label={tx("Не оплачено", "Offen")} value={pipeline.invoices.open} />
        </div>
      </StageBlock>
    </div>
  );
}
