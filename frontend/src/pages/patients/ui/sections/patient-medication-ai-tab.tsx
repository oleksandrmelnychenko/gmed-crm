import { useState } from "react";

import { AiMark } from "@/components/ui/ai-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";

import { MedicationEvidenceReviewPanel } from "./medication-evidence-review-panel";
import { MedicationIntelligencePanel } from "./medication-intelligence-panel";

type PatientMedicationAiTabProps = {
  patientId: string;
};

export function PatientMedicationAiTab({ patientId }: PatientMedicationAiTabProps) {
  const { lang } = useLang();
  const [aboutOpen, setAboutOpen] = useState(false);

  const copy = lang === "de" ? {
    action: "So funktioniert die KI-Analyse",
    title: "Was macht die KI-Analyse?",
    description: "Kurz erklärt: welche Daten geprüft werden, was das Ergebnis bedeutet und wofür es verwendet wird.",
    steps: [
      {
        title: "Daten",
        text: "Die Analyse verwendet die Medikamentenliste, bestätigte Präparate-IDs und verknüpfte Nachweise aus offenen Quellen – vor allem aus amtlichen deutschen Registern.",
      },
      {
        title: "Prüfung",
        text: "Das System markiert bestätigte Treffer, Widersprüche, fehlende Angaben und Fragen, die anhand der Originalunterlagen geprüft werden müssen.",
      },
      {
        title: "Ergebnis",
        text: "Die KI erstellt einen strukturierten Entwurf mit Befunden, offenen Fragen und direkten Verweisen auf die verwendeten Quellen.",
      },
    ],
    purposeTitle: "Warum ist das nützlich?",
    purpose: "So werden fehlende Daten und mögliche Prüfsignale schneller sichtbar. Die Fachkraft erhält eine nachvollziehbare Arbeitsgrundlage, statt jeden Nachweis einzeln zusammensuchen zu müssen.",
    safetyTitle: "Wichtig",
    safety: [
      "Die KI stellt keine Diagnose und wählt keine Behandlung aus.",
      "Sie verordnet, beendet oder verändert weder Medikamente noch Dosierungen.",
      "Jede Aussage muss anhand der verknüpften Quelle und der Patientenunterlagen geprüft werden.",
      "Die abschließende klinische Beurteilung trifft ausschließlich eine autorisierte medizinische Fachkraft.",
    ],
    privacy: "Wenn ein externer KI-Anbieter freigegeben und eingerichtet ist, erhält er nur einen minimierten, de-identifizierten Evidenz-Snapshot. Die vollständige Patientenakte wird nicht übertragen.",
  } : {
    action: "Как работает AI-анализ",
    title: "Что делает AI-анализ?",
    description: "Коротко: какие данные он проверяет, что означает результат и для чего он нужен.",
    steps: [
      {
        title: "Данные",
        text: "Анализ использует список медикаментов, подтверждённые идентификаторы препаратов и связанные доказательства из открытых источников — прежде всего официальных реестров Германии.",
      },
      {
        title: "Проверка",
        text: "Система отмечает подтверждённые совпадения, противоречия, недостающие данные и вопросы, которые нужно сверить с оригинальными документами.",
      },
      {
        title: "Результат",
        text: "AI формирует структурированный черновик с выводами, открытыми вопросами и прямыми ссылками на использованные источники.",
      },
    ],
    purposeTitle: "Зачем это нужно?",
    purpose: "Так быстрее видны пробелы в данных и возможные сигналы для проверки. Специалист получает понятную рабочую основу и не ищет каждый источник вручную.",
    safetyTitle: "Важно",
    safety: [
      "AI не ставит диагноз и не выбирает лечение.",
      "Он не назначает, не отменяет и не изменяет медикаменты или дозировку.",
      "Каждое утверждение нужно проверить по прикреплённому источнику и документам пациента.",
      "Финальное клиническое решение принимает только уполномоченный медицинский специалист.",
    ],
    privacy: "Если внешний AI-провайдер разрешён и настроен, ему передаётся только минимизированный обезличенный снимок доказательств. Полная карточка пациента не передаётся.",
  };

  return (
    <section className="space-y-4" aria-label={lang === "de" ? "KI-Medikationsanalyse" : "AI-анализ медикаментов"}>
      <header className="flex flex-col gap-3 border-b border-border/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <AiMark className="size-4 text-foreground" />
          <h2 className="text-base font-semibold text-foreground">
            {lang === "de" ? "KI-Medikationsanalyse" : "AI-анализ медикаментов"}
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          aria-haspopup="dialog"
          onClick={() => setAboutOpen(true)}
        >
          <AiMark className="size-3.5" />
          {copy.action}
        </Button>
      </header>

      <MedicationEvidenceReviewPanel patientId={patientId} />
      <MedicationIntelligencePanel patientId={patientId} />

      <Dialog open={aboutOpen} onOpenChange={(open) => setAboutOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader className="border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <AiMark className="size-4 text-foreground" />
              <DialogTitle>{copy.title}</DialogTitle>
            </div>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <ol className="grid gap-2 sm:grid-cols-3">
              {copy.steps.map((step, index) => (
                <li key={step.title} className="rounded-lg border border-border/70 bg-muted/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-orange-500" />
                    <span className="text-xs font-semibold text-foreground">{index + 1}. {step.title}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>

            <section className="rounded-lg border border-border/70 px-3 py-3">
              <h3 className="text-xs font-semibold text-foreground">{copy.purposeTitle}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{copy.purpose}</p>
            </section>

            <section className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3">
              <h3 className="text-xs font-semibold text-sky-950">{copy.safetyTitle}</h3>
              <ul className="mt-2 space-y-1.5">
                {copy.safety.map((item) => (
                  <li key={item} className="flex gap-2 text-xs leading-relaxed text-sky-950/75">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-sky-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-[11px] leading-relaxed text-muted-foreground">{copy.privacy}</p>
          </div>

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </section>
  );
}
