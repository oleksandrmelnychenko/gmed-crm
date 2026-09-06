import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileSignature, LoaderCircle, Pencil, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { downloadDocumentFile } from "../data/document-api";
import { SignatureConnectionDialog } from "./signature-connection-dialog";
import { SignatureSignerFields } from "./signature-signer-fields";
import { createSignatureRequest, downloadSignatureReport, fetchSignatureState, isSignaturePending, signatureAction, validSigners, type SignatureState, type SignatureStatus, type Signer } from "../data/document-signature-api";

const emptySigner = (role: Signer["role"]): Signer => ({ first_name: "", last_name: "", email: "", role });
const initialSigners = () => [emptySigner("client"), emptySigner("agency")];
const statuses: Record<SignatureStatus, [string, string]> = {
  submitting: ["Отправка приглашений", "Einladungen werden versendet"],
  submission_unknown: ["Проверяем отправку — повторно не отправляйте", "Versand wird geprüft – bitte nicht erneut senden"],
  pending: ["Ожидание подписей", "Unterschriften ausstehend"],
  completed: ["PDF и отчёт сохранены", "PDF und Protokoll gespeichert"],
  needs_review: ["Исходный документ изменён — нужна проверка", "Ausgangsdokument geändert – Prüfung erforderlich"],
  declined: ["Подписание отклонено", "Unterschrift abgelehnt"],
  withdrawn: ["Запрос отозван", "Anfrage zurückgezogen"],
  expired: ["Срок запроса истёк", "Anfrage abgelaufen"],
  error: ["Ошибка подписания", "Signatur fehlgeschlagen"],
};

const ineligibleMessages: Record<string, [string, string]> = {
  pdf_required: ["Для электронной подписи нужен сохранённый PDF. Сначала загрузите PDF-версию документа.", "Für die elektronische Unterschrift wird eine gespeicherte PDF benötigt. Laden Sie zuerst die PDF-Version hoch."],
  document_unavailable: ["Документ архивирован или его файл удалён.", "Das Dokument ist archiviert oder seine Datei wurde gelöscht."],
  document_superseded: ["Это предыдущая версия. Откройте текущую версию документа для подписи.", "Dies ist eine frühere Version. Öffnen Sie die aktuelle Dokumentversion zur Unterschrift."],
  document_already_signed: ["Этот документ уже отмечен как подписанный.", "Dieses Dokument ist bereits als unterzeichnet markiert."],
};

function requestStatusClassName(status: SignatureStatus) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (["declined", "withdrawn", "expired", "error"].includes(status)) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
}

export function DocumentSignaturePanel({ documentId, onDone, onDirtyChange, expanded = false, previewReady = true }: { documentId: string; onDone?: () => void; onDirtyChange?: (dirty: boolean) => void; expanded?: boolean; previewReady?: boolean }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [open, setOpen] = useState(expanded);
  const [state, setState] = useState<SignatureState | null>(null);
  const [signers, setSigners] = useState<Signer[]>(initialSigners);
  const [baseline, setBaseline] = useState<Signer[]>(initialSigners);
  const [editingSigners, setEditingSigners] = useState<number[]>([]);
  const [excludedSigners, setExcludedSigners] = useState<number[]>([]);
  const [composeNew, setComposeNew] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [awaitingState, setAwaitingState] = useState(false);
  const busyRef = useRef(false);
  const onDoneRef = useRef(onDone);
  const previousPending = useRef(false);
  const initialized = useRef(false);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  const selectedSigners = signers.filter((_, index) => !excludedSigners.includes(index));
  const dirty = confirmed || excludedSigners.length > 0 || JSON.stringify(signers) !== JSON.stringify(baseline);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await fetchSignatureState(documentId);
        if (cancelled) return;
        const pending = next.requests.some(r => isSignaturePending(r.status));
        setState(next); setError(false); setAwaitingState(false);
        if (!initialized.current || pending) {
          const defaults = next.suggested_signers?.length ? next.suggested_signers : initialSigners();
          setSigners(defaults); setBaseline(defaults); setConfirmed(false); setEditingSigners([]); setExcludedSigners([]);
          initialized.current = true;
        }
        if (previousPending.current && !pending) onDoneRef.current?.();
        previousPending.current = pending;
        if (pending) timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (cancelled) return;
        if (reason instanceof ApiRequestError && reason.status === 403) setForbidden(true);
        else { setError(true); timer = setTimeout(() => { void load(); }, 15_000); }
      }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [documentId, open, revision]);

  // The parent keys the component by document ID: draft recipients cannot cross documents.
  if (forbidden) return expanded ? <p role="alert" className="text-sm text-destructive">{tx("Недостаточно прав для электронного подписания этого документа.", "Keine Berechtigung für die elektronische Signatur dieses Dokuments.")}</p> : null;
  async function run(action: () => Promise<unknown>, refresh = true) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setActionError(null);
    try { await action(); }
    catch (reason) {
      const code = reason instanceof ApiRequestError ? reason.body?.error : null;
      setActionError(code === "both_contract_parties_required"
        ? tx("Для договора нужны клиент и представитель агентства.", "Verträge benötigen Kunde und Agenturvertretung.")
        : tx("Действие не выполнено. Проверьте статус перед повторной отправкой.", "Aktion fehlgeschlagen. Prüfen Sie vor erneutem Versand den Status."));
    }
    finally {
      // A successful POST or an ambiguous timeout must be reconciled before
      // another mutation. Stale cached state must never re-enable sending.
      if (refresh) { setAwaitingState(true); setRevision(value => value + 1); }
      busyRef.current = false; setBusy(false);
    }
  }
  const pending = state?.requests.some(r => isSignaturePending(r.status));
  const mutationDisabled = busy || awaitingState || error;
  const completed = state?.requests.some(r => r.status === "completed");
  const updateSigner = (index: number, patch: Partial<Signer>) => {
    setConfirmed(false);
    setEditingSigners(current => current.includes(index) ? current : [...current, index]);
    setSigners(current => current.map((signer, n) => n === index ? { ...signer, ...patch } : signer));
  };
  const selectSigner = (index: number, selected: boolean) => {
    setConfirmed(false); setActionError(null);
    setEditingSigners(current => current.filter(n => n !== index));
    setExcludedSigners(current => selected ? current.filter(n => n !== index) : [...current, index]);
  };
  const removeSigner = (index: number) => {
    setConfirmed(false); setActionError(null); setEditingSigners([]);
    setSigners(current => current.filter((_, n) => n !== index));
    setExcludedSigners(current => current.filter(n => n !== index).map(n => n > index ? n - 1 : n));
  };
  return (
    <details
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
      className={expanded ? "" : "rounded-xl border border-border/70 bg-card p-4 shadow-xs"}
    >
      <summary className={expanded ? "hidden" : "cursor-pointer text-sm font-medium"}>
        <FileSignature aria-hidden="true" className="mr-2 inline size-4" />
        {tx("Электронная подпись", "Elektronische Unterschrift")}
      </summary>
      {open ? <div className={expanded ? "grid gap-4 text-sm" : "mt-4 grid gap-4 text-sm"}>
        {!state && !error ? <div role="status" className="flex min-h-28 items-center justify-center rounded-xl border border-border/70 bg-card text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</div> : null}
        {error ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{tx("Не удалось выполнить действие. Проверьте статус перед повторной отправкой.", "Aktion fehlgeschlagen. Prüfen Sie vor erneutem Versand den Status.")}</p> : null}
        {actionError ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{actionError}</p> : null}
        {state ? <>
          <section className="rounded-xl border border-border/70 bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <AdminSectionTitle>{tx("Сервис подписи", "Signaturdienst")}</AdminSectionTitle>
              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {state.test_mode ? "DEMO" : "QES / eIDAS"}
              </Badge>
            </div>
            <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Skribble · Deutschland</p>
                {!state.test_mode ? <p className="text-xs leading-5 text-muted-foreground">{tx("Квалифицированная подпись по стандарту eIDAS", "Qualifizierte Signatur nach eIDAS")}</p> : null}
              </div>
              <SignatureConnectionDialog canConfigure={state.can_configure} onChanged={() => { setAwaitingState(true); setRevision(value => value + 1); }} />
            </div>
            {!state.enabled ? <p className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{tx("Для подписания нужно настроить немецкий аккаунт Skribble. Обратитесь к администратору.", "Zum Signieren muss das deutsche Skribble-Konto eingerichtet werden. Bitte wenden Sie sich an die Administration.")}</p> : null}
            {!state.can_send ? <p className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{tx("Доступен просмотр статуса. Для отправки документа на подпись нужны права редактирования и скачивания.", "Der Status ist sichtbar. Zum Versand werden Bearbeitungs- und Downloadrechte benötigt.")}</p> : null}
          </section>

          {state.requests.map(request => <section key={request.id} className="rounded-xl border border-border/70 bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <AdminSectionTitle>{tx("Запрос подписи", "Signaturanfrage")}</AdminSectionTitle>
              <Badge role="status" variant="outline" className={`rounded-full text-[10px] ${requestStatusClassName(request.status)}`}>
                {request.test_mode ? "TEST · " : ""}{tx(...statuses[request.status])}
              </Badge>
            </div>
            <div className="space-y-2 p-4">
              {request.signers.map(signer => {
                const signed = request.evidence.signatures?.some(s => s.email.toLowerCase() === signer.email.toLowerCase() && s.status === "SIGNED");
                return <div key={signer.email} className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"><span className="break-words font-medium text-foreground">{signer.first_name} {signer.last_name} · {signer.email}</span><span className={signed ? "text-emerald-700" : "text-muted-foreground"}>{signed ? tx("Подписано", "Unterzeichnet") : tx("Подпись не завершена", "Unterschrift nicht abgeschlossen")}</span></div>;
              })}
              {request.last_error && request.status === "pending" ? <p className="text-xs leading-5 text-muted-foreground">{tx("Синхронизация повторится автоматически. Подписывать заново не нужно.", "Die Synchronisierung wird automatisch wiederholt. Erneutes Signieren ist nicht nötig.")}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {request.result_document_id ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => downloadDocumentFile(request.result_document_id!, request.test_mode ? "TEST-signed.pdf" : "signed.pdf"), false)}>{tx("Подписанный PDF", "Signiertes PDF")}</Button> : null}
                {request.has_report ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => downloadSignatureReport(request.id), false)}>{tx("Отчёт о подписях", "Signaturprotokoll")}</Button> : null}
                {isSignaturePending(request.status) && state.enabled && state.can_send ? <Button type="button" variant="outline" size="sm" disabled={mutationDisabled} onClick={() => void run(() => signatureAction(request.id, "refresh"))}>{tx("Проверить статус", "Status prüfen")}</Button> : null}
                {request.status === "pending" && state.enabled && state.can_send ? <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={mutationDisabled} onClick={() => void run(() => signatureAction(request.id, "withdraw"))}>{tx("Отозвать запрос", "Anfrage zurückziehen")}</Button> : null}
              </div>
            </div>
          </section>)}

          {state.can_send && !pending && state.ineligible_reason && !state.requests.some(r => r.result_document_id) ? <p className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs">{tx(...(ineligibleMessages[state.ineligible_reason] ?? ["Документ сейчас недоступен для подписания.", "Das Dokument kann derzeit nicht unterzeichnet werden."]))}</p> : null}

          {state.enabled && state.can_send && !pending && !state.ineligible_reason && completed && !composeNew ? <Button type="button" variant="outline" disabled={mutationDisabled} onClick={() => setComposeNew(true)}><Plus className="size-4" />{tx("Новый запрос подписи", "Neue Signaturanfrage")}</Button> : null}
          {state.enabled && state.can_send && !pending && !state.ineligible_reason && (!completed || composeNew) ? <section className="rounded-xl border border-border/70 bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <AdminSectionTitle>{tx("Подписанты", "Unterzeichnende Personen")}</AdminSectionTitle>
              <Badge variant="outline" className="rounded-full text-[10px]" aria-label={`${tx("Выбрано подписантов", "Ausgewählte Personen")}: ${selectedSigners.length} / ${signers.length}`}>{selectedSigners.length} / {signers.length}</Badge>
            </div>
            <div className="space-y-4 p-4">
              {signers.map((signer, index) => {
                const selected = !excludedSigners.includes(index);
                const editing = selected && (!validSigners([signer]) || editingSigners.includes(index));
                const name = `${signer.first_name} ${signer.last_name}`.trim() || `${tx("Подписант", "Unterzeichnende Person")} ${index + 1}`;
                return <div key={index} className={`min-w-0 rounded-lg border p-3 ${selected ? "border-[var(--brand)]/35 bg-[var(--brand)]/[0.025]" : "border-border/70 bg-muted/20"}`}>
                  <div className="flex min-w-0 items-start gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input type="checkbox" aria-label={`${tx("Выбрать подписанта", "Person auswählen")} ${index + 1}: ${name}`} checked={selected} disabled={busy || awaitingState} onChange={event => selectSigner(index, event.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--brand)]" />
                      <span className="min-w-0 space-y-1">
                        <span className="block text-[11px] text-muted-foreground">{signer.role === "agency" ? tx("Представитель GMED", "GMED-Vertretung") : signer.role === "client" ? tx("Клиент / представитель клиента", "Kunde / Kundenvertretung") : tx("Другая сторона", "Weitere Partei")}</span>
                        <span className="block break-words text-sm font-medium">{name}</span>
                        {signer.email ? <span className="block break-all text-xs text-muted-foreground">{signer.email}</span> : null}
                      </span>
                    </label>
                    <div className="flex shrink-0 flex-col gap-1">
                      {!editing ? <Button type="button" variant="ghost" size="icon-sm" disabled={busy || awaitingState || !selected} aria-label={`${tx("Изменить подписанта", "Person bearbeiten")} ${index + 1}`} onClick={() => setEditingSigners(current => [...current, index])}><Pencil className="size-3.5" /></Button> : null}
                      {signers.length > 1 ? <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" disabled={busy || awaitingState} aria-label={`${tx("Удалить подписанта", "Person entfernen")} ${index + 1}`} onClick={() => removeSigner(index)}><Trash2 className="size-3.5" /></Button> : null}
                    </div>
                  </div>
                  {editing ? <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                    <SignatureSignerFields signer={signer} index={index} disabled={busy || awaitingState} embedded onChange={patch => updateSigner(index, patch)} />
                    {validSigners([signer]) ? <div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={busy || awaitingState} onClick={() => setEditingSigners(current => current.filter(n => n !== index))}>{tx("Готово", "Fertig")}</Button></div> : null}
                  </div> : null}
                </div>;
              })}
              {signers.length < 6 ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setConfirmed(false); setSigners(current => [...current, emptySigner("other")]); }}><Plus className="size-4" />{tx("Добавить подписанта", "Person hinzufügen")}</Button> : null}
            </div>
            <div className="border-t border-border/60 bg-muted/10 p-4">
              <label className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-3 text-xs leading-5 dark:border-amber-800 dark:bg-amber-950/30"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--brand)]" /><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" /><span>{tx("Я проверил сохранённый PDF и адреса. Отправить этот документ выбранным подписантам через Skribble.", "Ich habe die gespeicherte PDF und die Adressen geprüft. Dieses Dokument über Skribble an die ausgewählten Personen senden.")}</span></label>
              <div className="mt-3 flex justify-end">
                <Button type="button" className="h-9 rounded-lg" disabled={mutationDisabled || !previewReady || !confirmed || !validSigners(selectedSigners)} onClick={() => void run(async () => { await createSignatureRequest(documentId, selectedSigners); previousPending.current = true; setSigners(baseline); setExcludedSigners([]); setConfirmed(false); setComposeNew(false); })}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{busy ? tx("Отправка…", "Wird versendet…") : tx("Отправить на подпись", "Zur Unterschrift senden")}</Button>
              </div>
            </div>
          </section> : null}
        </> : null}
      </div> : null}
    </details>
  );
}
