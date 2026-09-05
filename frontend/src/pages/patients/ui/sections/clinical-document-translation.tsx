import { Button } from "@/components/ui/button";
import type { ClinicalDocumentTranslation } from "../../data/clinical-document-import";
import { germanTranslationPage } from "../../data/clinical-document-translation";

export function ClinicalDocumentTranslationPanel({ translation, pageNumber, textScope, expanded, onExpand, lang }: {
  translation: ClinicalDocumentTranslation;
  pageNumber: number;
  textScope?: "page" | "document";
  expanded: boolean;
  onExpand: () => void;
  lang: string;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const ready = translation.status === "review_required" && Boolean(translation.text);
  return (
    <section className="mb-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4" aria-label={tx("Перевод на немецкий", "Deutsche Übersetzung")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{tx("Английский → немецкий", "Englisch → Deutsch")}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {ready ? tx(
              "Машинный черновик. Проверьте медицинские термины, отрицания, дозировки и даты по оригиналу перед переносом в карту.",
              "Maschineller Entwurf. Medizinische Begriffe, Verneinungen, Dosierungen und Daten vor der Übernahme anhand des Originals prüfen.",
            ) : translation.status === "too_large" ? tx(
              "Документ слишком большой для автоматического перевода. Распознанный оригинал доступен для ручной проверки.",
              "Das Dokument ist für die automatische Übersetzung zu groß. Das erkannte Original steht zur manuellen Prüfung bereit.",
            ) : translation.status === "unavailable" ? tx(
              "Автоматический перевод пока не настроен на сервере. Распознанный оригинал сохранён.",
              "Die automatische Übersetzung ist auf dem Server noch nicht eingerichtet. Das erkannte Original bleibt erhalten.",
            ) : tx(
              "Не удалось создать перевод. Оригинал сохранён; повторное распознавание повторит перевод.",
              "Die Übersetzung konnte nicht erstellt werden. Das Original bleibt erhalten; eine erneute Erkennung wiederholt die Übersetzung.",
            )}
          </p>
        </div>
        {ready && !expanded ? <Button type="button" size="sm" variant="outline" onClick={onExpand}>{tx("Открыть перевод", "Übersetzung öffnen")}</Button> : null}
      </div>
      {translation.warnings.includes("translation_numbers_changed") ? (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {tx("В переводе изменились числа или их формат. Обязательно сверьте значения с оригиналом. Такие фрагменты нельзя перенести кнопкой перевода.", "Zahlen oder Zahlenformate wurden verändert. Werte unbedingt mit dem Original abgleichen. Solche Abschnitte können nicht per Übersetzungsschaltfläche übernommen werden.")}
        </p>
      ) : null}
      {translation.warnings.includes("translation_candidate_too_long") ? (
        <p className="text-xs text-amber-900">{tx("Некоторые переведённые записи слишком длинные для переноса. Проверьте и сократите текст вручную.", "Einige übersetzte Einträge sind für die Übernahme zu lang. Text manuell prüfen und kürzen.")}</p>
      ) : null}
      {translation.warnings.includes("translation_terms_changed") ? (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {tx("В переводе могли быть пропущены медицинские уточнения. Сверьте текст с оригиналом. Такие фрагменты нельзя перенести кнопкой перевода.", "Medizinische Präzisierungen könnten in der Übersetzung fehlen. Text mit dem Original abgleichen. Solche Abschnitte können nicht per Übersetzungsschaltfläche übernommen werden.")}
        </p>
      ) : null}
      {ready && expanded ? (
        <label className="block space-y-2 text-xs font-medium">
          <span>{textScope === "document" ? tx("Немецкий черновик · весь документ", "Deutscher Entwurf · gesamtes Dokument") : tx(`Немецкий черновик · страница ${pageNumber}`, `Deutscher Entwurf · Seite ${pageNumber}`)}</span>
          <textarea readOnly lang="de" value={germanTranslationPage(translation, pageNumber)} className="min-h-48 max-h-[60vh] w-full resize-y rounded-lg border border-blue-200 bg-white p-4 text-sm leading-6" />
        </label>
      ) : null}
    </section>
  );
}
