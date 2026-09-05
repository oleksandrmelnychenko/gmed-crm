import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, Paperclip, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, clearApiCache, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import type { PatientSummary } from "@/pages/patients/model/list-model";
import type { ProviderDetail } from "../model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

type ProviderDocument = {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  patient_number: string | null;
  auto_name: string;
  original_filename: string | null;
  is_medical: boolean;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by_name: string;
  created_at: string;
};

const copy = {
  de: {
    title: "Dokumente",
    upload: "Dokument hochladen",
    search: "Dokument oder Patient suchen",
    allPatients: "Alle Patienten",
    name: "Bezeichnung",
    patient: "Patient",
    type: "Typ",
    uploaded: "Hochgeladen",
    actions: "Aktionen",
    medical: "Medizinisch",
    provider: "Provider-Dokument",
    noPatient: "Ohne Patient",
    empty: "Noch keine Dokumente mit diesem Provider verknüpft",
    file: "Datei",
    titleField: "Bezeichnung",
    notes: "Notiz",
    linkPatient: "Patient zuordnen",
    medicalToggle: "Medizinisches Dokument",
    medicalHint: "Medizinische Dokumente müssen einem Patienten zugeordnet werden.",
    cancel: "Abbrechen",
    save: "Hochladen",
    saving: "Wird hochgeladen",
    chooseFile: "PDF, Bild oder Word-Datei auswählen",
    error: "Dokument konnte nicht verarbeitet werden",
  },
  ru: {
    title: "Документы",
    upload: "Загрузить документ",
    search: "Поиск по документу или пациенту",
    allPatients: "Все пациенты",
    name: "Название",
    patient: "Пациент",
    type: "Тип",
    uploaded: "Загружено",
    actions: "Действия",
    medical: "Медицинский",
    provider: "Документ провайдера",
    noPatient: "Без пациента",
    empty: "У этого провайдера пока нет документов",
    file: "Файл",
    titleField: "Название",
    notes: "Примечание",
    linkPatient: "Привязать пациента",
    medicalToggle: "Медицинский документ",
    medicalHint: "Медицинский документ обязательно привязывается к пациенту.",
    cancel: "Отмена",
    save: "Загрузить",
    saving: "Загрузка",
    chooseFile: "Выберите PDF, изображение или файл Word",
    error: "Не удалось обработать документ",
  },
} as const;

function formatSize(value: number | null) {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProviderDocumentsSection({
  detail,
  canManage,
}: {
  detail: ProviderDetail;
  canManage: boolean;
}) {
  const { lang } = useLang();
  const labels = copy[lang];
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<ProviderDocument[]>([]);
  const [patientFilter, setPatientFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [patientId, setPatientId] = useState("");
  const [isMedical, setIsMedical] = useState(detail.provider_type === "medical");
  const linkedPatientOptions = useMemo(
    () => detail.linked_patients.map((patient) => ({
      id: patient.id,
      patientNumber: patient.patient_id,
      name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
    })),
    [detail.linked_patients],
  );
  const [patientOptions, setPatientOptions] = useState(linkedPatientOptions);

  useEffect(() => {
    setPatientOptions(linkedPatientOptions);
    if (!canManage) return;
    let cancelled = false;
    void apiFetch<PatientSummary[]>("/patients?active_only=true", { cacheTtlMs: 30_000 })
      .then((patients) => {
        if (cancelled) return;
        setPatientOptions(patients.map((patient) => ({
          id: patient.id,
          patientNumber: patient.patient_id,
          name: [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.patient_id,
        })).sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canManage, linkedPatientOptions]);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (patientFilter) params.set("patient_id", patientFilter);
      if (query.trim()) params.set("q", query.trim());
      const path = `/providers/${detail.id}/documents${params.size ? `?${params.toString()}` : ""}`;
      setDocuments(await apiFetch<ProviderDocument[]>(path, { forceFresh: true }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : labels.error);
    } finally {
      setLoading(false);
    }
  }, [detail.id, labels.error, patientFilter, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(), 200);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  function openUpload() {
    setFile(null);
    setTitle("");
    setNotes("");
    setPatientId("");
    setIsMedical(detail.provider_type === "medical");
    setError("");
    setDialogOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || (isMedical && !patientId)) return;
    setSubmitting(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("title", title.trim());
      body.append("notes", notes.trim());
      body.append("patient_id", patientId);
      body.append("is_medical", String(isMedical));
      await apiFetch(`/providers/${detail.id}/documents`, {
        method: "POST",
        body,
        timeoutMs: 90_000,
      });
      clearApiCache(`/providers/${detail.id}/documents`);
      setDialogOpen(false);
      await loadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : labels.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-0 overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="relative z-30 flex flex-wrap items-center gap-2 border-b border-border/70 bg-card p-2.5 sm:flex-nowrap sm:gap-1.5 sm:overflow-x-auto sm:px-3 sm:py-2">
        <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
          {labels.title}
        </span>
        {canManage ? <Button type="button" size="sm" className="h-8 shrink-0 self-center rounded-lg" onClick={openUpload}><Plus className="size-3.5" />{labels.upload}</Button> : null}
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
        <div className="relative min-w-[240px] flex-1"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 bg-field pl-8 text-xs" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} /></div>
        <select className="h-8 w-[220px] shrink-0 rounded-md border border-input bg-field px-3 text-xs" value={patientFilter} onChange={(event) => setPatientFilter(event.target.value)}>
          <option value="">{labels.allPatients}</option>
          {patientOptions.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
        </select>
      </div>

      {error && !dialogOpen ? <p className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2">{labels.name}</th><th className="px-3 py-2">{labels.patient}</th><th className="px-3 py-2">{labels.type}</th><th className="px-3 py-2">{labels.uploaded}</th><th className="w-11 px-1 py-2 text-right"><span className="sr-only">{labels.actions}</span></th></tr></thead>
          <tbody className="divide-y">
            {documents.map((document) => (
              <tr key={document.id} className="hover:bg-muted/20">
                <td className="px-3 py-2.5"><p className="font-medium">{document.auto_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{document.original_filename} · {formatSize(document.file_size)}</p></td>
                <td className="px-3 py-2.5"><p>{document.patient_name || labels.noPatient}</p>{document.patient_number ? <p className="text-xs text-muted-foreground">{document.patient_number}</p> : null}</td>
                <td className="px-3 py-2.5"><Badge variant="outline" className={document.is_medical ? "border-sky-200 bg-sky-50 text-sky-700" : ""}>{document.is_medical ? labels.medical : labels.provider}</Badge></td>
                <td className="px-3 py-2.5"><p>{new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(document.created_at))}</p><p className="text-xs text-muted-foreground">{document.uploaded_by_name}</p></td>
                <td className="px-1 py-2.5"><div className="flex items-center justify-end gap-1"><DocumentSignatureAction documentId={document.id} title={document.original_filename || document.auto_name} iconOnly onDone={() => void loadDocuments()} /><Button type="button" size="icon-sm" variant="ghost" title={document.original_filename || document.auto_name} onClick={() => void downloadApiFile(`/documents/${document.id}/download`, document.original_filename || document.auto_name)}><Download /></Button></div></td>
              </tr>
            ))}
            {!loading && documents.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">{labels.empty}</td></tr> : null}
            {loading ? <tr><td colSpan={5} className="px-4 py-12 text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr> : null}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{labels.upload}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <label className="block space-y-1.5 text-sm font-medium"><span>{labels.file}</span><input ref={fileRef} type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Button type="button" variant="outline" className="w-full justify-start" onClick={() => fileRef.current?.click()}><Paperclip />{file?.name || labels.chooseFile}</Button></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>{labels.titleField}</span><Input value={title} maxLength={255} placeholder={file?.name || ""} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>{labels.linkPatient}</span><select className="h-9 w-full rounded-md border border-input bg-field px-3 text-sm" value={patientId} required={isMedical} onChange={(event) => setPatientId(event.target.value)}><option value="">{labels.noPatient}</option>{patientOptions.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.patientNumber}</option>)}</select></label>
            <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm"><input type="checkbox" className="mt-0.5" checked={isMedical} onChange={(event) => setIsMedical(event.target.checked)} /><span><span className="font-medium">{labels.medicalToggle}</span><span className="mt-0.5 block text-xs text-muted-foreground">{labels.medicalHint}</span></span></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>{labels.notes}</span><textarea className="min-h-24 w-full rounded-md border border-input bg-field px-3 py-2 text-sm" value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={submitting} onClick={() => setDialogOpen(false)}>{labels.cancel}</Button><Button type="submit" disabled={submitting || !file || (isMedical && !patientId)}>{submitting ? <LoaderCircle className="animate-spin" /> : <FileText />}{submitting ? labels.saving : labels.save}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
