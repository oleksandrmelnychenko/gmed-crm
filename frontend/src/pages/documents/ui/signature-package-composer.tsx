import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import {
  blockingWarning, packageMinimumLevel, packageWarnings, requiredAttachmentTemplates,
  type PackageCandidate, type PackageCandidates, type PackageWarning, type SignatureLevel,
} from "../data/document-signature-api";

export type PackageSelection = {
  documentIds: string[];
  attachments: Record<string, string>;
  level: SignatureLevel;
  expiresOn: string;
  message: string;
  language: string;
};

export const emptyPackageSelection = (documentId: string, language = "de"): PackageSelection => ({
  documentIds: [documentId], attachments: {}, level: "QES", expiresOn: "", message: "", language,
});

const languageNames: Record<string, [string, string]> = {
  de: ["Немецкий", "Deutsch"], en: ["Английский", "Englisch"], fr: ["Французский", "Französisch"], it: ["Итальянский", "Italienisch"],
};

function attachmentLabel(template: string, tx: (ru: string, de: string) => string) {
  return template === "privacy_information"
    ? tx("Информация о защите данных (ст. 13/14 DSGVO)", "Datenschutzinformation (Art. 13/14 DSGVO)")
    : tx("Предварительный расчёт медицинских расходов", "Vorläufige medizinische Kostenkalkulation");
}

function warningText(warning: PackageWarning, tx: (ru: string, de: string) => string) {
  switch (warning.kind) {
    case "no_frames": return tx("Нет поля для подписи — Skribble разместит подпись сам.", "Kein Unterschriftsfeld – Skribble platziert die Signatur selbst.");
    case "pending_elsewhere": return tx("Уже отправлен на подпись в другом запросе.", "Bereits in einer anderen Anfrage zur Unterschrift versendet.");
    case "ineligible": return tx("Недоступен для подписи (архив, старая версия или уже подписан).", "Nicht signierbar (archiviert, frühere Version oder bereits unterschrieben).");
    case "electronic_form_excluded": return tx("Электронная форма исключена законом — только бумажная подпись.", "Elektronische Form gesetzlich ausgeschlossen – nur Papierunterschrift.");
    case "too_large": return tx("Пакет больше 18 МБ — уберите документы или отправьте их отдельно.", "Das Paket ist größer als 18 MB – entfernen Sie Dokumente oder versenden Sie sie einzeln.");
    case "too_many": return tx("Не больше 10 документов в одном пакете.", "Höchstens 10 Dokumente pro Paket.");
    case "policy_conflict": return tx("Внутренний документ GMED нельзя объединять с документами для пациента.", "Ein internes GMED-Dokument kann nicht mit Dokumenten für die Patientenseite kombiniert werden.");
  }
}

const sizeLabel = (bytes: number | null) => bytes == null ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Selected documents in order, the attachments the package needs and the
 * blocking problems, derived from one selection (also used by the panel). */
export function resolvePackage(candidates: PackageCandidates | null, selection: PackageSelection) {
  const byId = new Map((candidates?.documents ?? []).map(document => [document.id, document]));
  const selected = selection.documentIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
  const required = requiredAttachmentTemplates(selected);
  const orderIds = new Set(selected.filter(document => document.companion === "cost_estimate").map(document => document.order_id));
  const attachmentOptions = Object.fromEntries(required.map(template => [template, (candidates?.attachments ?? []).filter(attachment =>
    attachment.template === template && (template !== "cost_estimate" || orderIds.has(attachment.order_id)))]));
  const attachmentIds = required.flatMap(template => {
    const options = attachmentOptions[template] ?? [];
    const chosen = selection.attachments[template] || (options.length === 1 ? options[0].id : "");
    return chosen ? [chosen] : [];
  });
  const warnings = candidates ? packageWarnings(selected, candidates.limits) : [];
  const minimumLevel = packageMinimumLevel(selected.map(document => document.minimum_level));
  return {
    selected, required, attachmentOptions, attachmentIds, warnings, minimumLevel,
    complete: selected.length === selection.documentIds.length && attachmentIds.length === required.length,
    blocked: warnings.some(blockingWarning),
  };
}

export function SignaturePackageComposer({ documentId, candidates, selection, onChange, previewedDocumentIds, onPreview, disabled }: {
  documentId: string;
  candidates: PackageCandidates;
  selection: PackageSelection;
  onChange: (selection: PackageSelection) => void;
  previewedDocumentIds: string[];
  onPreview?: (id: string, kind: "signing" | "review") => void;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const resolved = resolvePackage(candidates, selection);
  const available = candidates.documents.filter(document => !selection.documentIds.includes(document.id));
  const update = (patch: Partial<PackageSelection>) => onChange({ ...selection, ...patch });
  const move = (index: number, delta: number) => {
    const next = [...selection.documentIds];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    update({ documentIds: next });
  };
  const presetIds = candidates.preset_document_ids.filter(id => id !== documentId && candidates.documents.some(document => document.id === id));
  const presetApplied = presetIds.length > 0 && presetIds.every(id => selection.documentIds.includes(id));
  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + candidates.limits.max_expiry_days * 86_400_000).toISOString().slice(0, 10);
  const documentWarnings = (id: string) => resolved.warnings.filter(warning => warning.document_id === id);

  return <div className="space-y-4">
    <section aria-label={tx("Документы на подпись", "Dokumente zur Unterschrift")} className="space-y-3 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/[0.025] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminSectionTitle>{tx("Документы на подпись", "Dokumente zur Unterschrift")}</AdminSectionTitle>
        <StatusBadge tone="neutral">{selection.documentIds.length} / {candidates.limits.max_documents}</StatusBadge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{tx(
        "Все выбранные PDF объединяются в один файл и подписываются один раз. Подписанты получат одно приглашение со списком документов и страниц.",
        "Alle ausgewählten PDFs werden zu einer Datei zusammengeführt und einmal unterschrieben. Die Unterzeichnenden erhalten eine Einladung mit der Liste der Dokumente und Seiten.",
      )}</p>
      {presetIds.length > 0 && !presetApplied ? <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => update({ documentIds: [...selection.documentIds, ...presetIds.filter(id => !selection.documentIds.includes(id))] })}>
        <Plus className="size-4" />{tx("Добавить предложенный комплект", "Vorgeschlagenes Paket übernehmen")}
      </Button> : null}
      <ol className="space-y-2">
        {selection.documentIds.map((id, index) => {
          const document = candidates.documents.find(candidate => candidate.id === id);
          const previewed = previewedDocumentIds.includes(id);
          return <li key={id} className="rounded-lg border border-border/70 bg-card px-3 py-2.5" data-package-document={id}>
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 font-mono text-xs text-muted-foreground">{index + 1}.</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-sm font-medium text-foreground">{document?.title ?? tx("Документ недоступен", "Dokument nicht verfügbar")}{document ? ` · v${document.version}` : ""}</p>
                <p className="text-[11px] text-muted-foreground">{[index === 0 ? tx("основной документ", "Hauptdokument") : null, sizeLabel(document?.size ?? null), document?.minimum_level === "AES" ? tx("допустима AES", "AES zulässig") : "QES"].filter(Boolean).join(" · ")}</p>
                {documentWarnings(id).map(warning => <p key={warning.kind} className={blockingWarning(warning) ? "text-xs text-destructive" : "text-xs text-amber-700 dark:text-amber-300"}>{warningText(warning, tx)}</p>)}
                {!previewed ? <p className="text-[11px] text-muted-foreground">{tx("Ещё не просмотрен", "Noch nicht angesehen")}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onPreview ? <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${tx("Просмотреть", "Ansehen")}: ${document?.title ?? id}`} onClick={() => onPreview(id, "signing")}><Eye className="size-3.5" /></Button> : null}
                {index > 1 ? <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={tx("Выше", "Nach oben")} onClick={() => move(index, -1)}><ArrowUp className="size-3.5" /></Button> : null}
                {index > 0 && index < selection.documentIds.length - 1 ? <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={tx("Ниже", "Nach unten")} onClick={() => move(index, 1)}><ArrowDown className="size-3.5" /></Button> : null}
                {index > 0 ? <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" disabled={disabled} aria-label={`${tx("Убрать из пакета", "Aus dem Paket entfernen")}: ${document?.title ?? id}`} onClick={() => update({ documentIds: selection.documentIds.filter(other => other !== id) })}><Trash2 className="size-3.5" /></Button> : null}
              </div>
            </div>
          </li>;
        })}
      </ol>
      {resolved.warnings.filter(warning => !warning.document_id).map(warning => <Banner key={warning.kind} tone="error">{warningText(warning, tx)}</Banner>)}
      {available.length > 0 && selection.documentIds.length < candidates.limits.max_documents ? <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{tx("Добавить документ этого пациента/лида", "Dokument dieser Person hinzufügen")}
        <NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value="" disabled={disabled} onChange={event => { const id = event.target.value; if (id) update({ documentIds: [...selection.documentIds, id] }); }}>
          <option value="">{tx("Выберите документ", "Dokument auswählen")}</option>
          {available.map(document => <option key={document.id} value={document.id} disabled={Boolean(document.ineligible_reason)}>{document.title} · v{document.version}{document.pending_elsewhere ? tx(" · уже на подписи", " · bereits versendet") : document.electronic_form_excluded ? tx(" · только на бумаге", " · nur Papierform") : ""}</option>)}
        </NativeComboboxSelect>
      </label> : null}
    </section>

    {resolved.required.length > 0 ? <section aria-label={tx("Приложения для ознакомления", "Anlagen zur Kenntnisnahme")} className="space-y-3 rounded-lg border border-border p-3">
      <AdminSectionTitle>{tx("Приложения для ознакомления", "Anlagen zur Kenntnisnahme")}</AdminSectionTitle>
      <p className="text-xs leading-5 text-muted-foreground">{tx("Обязательны для этого пакета: подписанты получают их вместе с приглашением, без отдельной подписи.", "Für dieses Paket verpflichtend: Die Unterzeichnenden erhalten sie mit der Einladung, ohne eigene Unterschrift.")}</p>
      {resolved.required.map(template => {
        const options = resolved.attachmentOptions[template] ?? [];
        const chosen = selection.attachments[template] || (options.length === 1 ? options[0].id : "");
        const label = attachmentLabel(template, tx);
        return <div key={template} className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">{label}</p>
          {options.length ? <div className="flex flex-wrap items-center gap-2">
            <NativeComboboxSelect className="min-w-0 flex-1" aria-label={label} value={chosen} disabled={disabled} onChange={event => update({ attachments: { ...selection.attachments, [template]: event.target.value } })}>
              <option value="">{tx("Выберите документ", "Dokument auswählen")}</option>
              {options.map(option => <option key={option.id} value={option.id}>{option.title} · v{option.version}</option>)}
            </NativeComboboxSelect>
            <Button type="button" variant="outline" size="sm" disabled={!chosen || disabled || !onPreview} onClick={() => onPreview?.(chosen, "review")}><Eye className="size-4" />{tx("Проверить", "Prüfen")}</Button>
          </div> : <Banner tone="error">{tx(`Сначала создайте документ «${label}». Без него пакет не отправляется.`, `Erstellen Sie zuerst das Dokument „${label}“. Ohne dieses wird das Paket nicht versendet.`)}</Banner>}
        </div>;
      })}
    </section> : null}

    <section aria-label={tx("Параметры приглашения", "Einstellungen der Einladung")} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{tx("Уровень подписи", "Signaturstufe")}
        <NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value={selection.level} disabled={disabled} onChange={event => update({ level: event.target.value as SignatureLevel })}>
          <option value="QES">{tx("QES — квалифицированная (заменяет письменную форму)", "QES – qualifiziert (ersetzt die Schriftform)")}</option>
          <option value="AES" disabled={resolved.minimumLevel === "QES"}>{tx("AES — усиленная (только согласия и сметы)", "AES – fortgeschritten (nur Einwilligungen und Kostenvoranschläge)")}</option>
        </NativeComboboxSelect>
        {resolved.minimumLevel === "QES" ? <span className="font-normal">{tx("Для договоров и заказов нужна QES (§ 126a BGB).", "Verträge und Aufträge erfordern eine QES (§ 126a BGB).")}</span> : null}
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{tx("Язык приглашения", "Sprache der Einladung")}
        <NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value={selection.language} disabled={disabled} onChange={event => update({ language: event.target.value })}>
          {candidates.languages.map(language => <option key={language} value={language}>{languageNames[language] ? tx(...languageNames[language]) : language}</option>)}
        </NativeComboboxSelect>
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{tx("Подписать до (необязательно)", "Unterschreiben bis (optional)")}
        <input type="date" className="h-9 rounded-md border border-input bg-field px-2 text-sm font-normal text-foreground" min={minDate} max={maxDate} value={selection.expiresOn} disabled={disabled} onChange={event => update({ expiresOn: event.target.value })} />
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">{tx("Сообщение подписантам (необязательно)", "Nachricht an die Unterzeichnenden (optional)")}
        <textarea className="min-h-16 rounded-md border border-input bg-field px-2 py-1.5 text-sm font-normal text-foreground" maxLength={candidates.limits.max_message_chars} value={selection.message} disabled={disabled} onChange={event => update({ message: event.target.value })} />
        <span className="font-normal">{tx("Без медицинских данных и диагнозов: письмо уходит по обычной почте. Список документов добавляется автоматически.", "Ohne Gesundheitsdaten oder Diagnosen: Die Nachricht geht per normaler E-Mail. Die Liste der Dokumente wird automatisch ergänzt.")}</span>
      </label>
    </section>
  </div>;
}

/** End of the chosen day in Berlin, as the server expects an instant. */
export function expiryInstant(expiresOn: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null;
  return new Date(`${expiresOn}T21:59:00Z`).toISOString();
}

export type { PackageCandidate };
