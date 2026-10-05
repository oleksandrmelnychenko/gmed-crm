import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Eye, FileSignature, LoaderCircle, Pencil, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { ApiRequestError } from "@/lib/api";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { downloadDocumentFile } from "../data/document-api";
import { PaperSignatureSection } from "./paper-signature-section";
import { SignatureConnectionDialog } from "./signature-connection-dialog";
import { SignatureSignerFields } from "./signature-signer-fields";
import { SignaturePackageComposer, emptyPackageSelection, expiryInstant, resolvePackage, type PackageSelection } from "./signature-package-composer";
import {
  abandonSignatureRequest, combinedSignerPolicy, createSignaturePackage, packageMinimumLevel, downloadSignatureReport, fetchPackageCandidates, fetchSignatureState,
  isSignaturePending, recordPaperSignature, recordSignatureDelivery, resolveSignatureReview, signatureAction, signatureErrorText, signatureFrameCoverage, signatureReasonValid, signerPolicyError,
  validSigners, type DeliveryChannel, type PackageCandidates, type SignatureRequest, type SignatureState, type SignatureStatus, type Signer, type SignerPolicy, type SignerRole,
} from "../data/document-signature-api";

const emptySigner = (role: SignerRole): Signer => ({ first_name: "", last_name: "", email: "", role });
const initialSigners = (policy: SignerPolicy | "conflict" = "flexible") =>
  policy === "client_only"
    ? [emptySigner("client")]
    : policy === "agency_only"
      ? [emptySigner("agency")]
    : policy === "payer_and_agency"
      ? [emptySigner("payer"), emptySigner("agency")]
    : policy === "client_payer_and_agency"
      ? [emptySigner("client"), emptySigner("payer"), emptySigner("agency")]
    : [emptySigner("client"), emptySigner("agency")];

/** Suggested signers that fit a policy: every recorded legal representative
 * of a minor, the patient, the Kostenübernehmer or the agency representatives. */
export function signersForPolicy(suggested: Signer[] | undefined, policy: SignerPolicy | "conflict" = "flexible") {
  const list = suggested ?? [];
  const patientSide = list.filter(signer => signer.role === "client");
  const agencySide = list.filter(signer => signer.role === "agency");
  const payers = list.filter(signer => signer.role === "payer");
  const others = list.filter(signer => !["client", "agency", "payer"].includes(signer.role));
  const orEmpty = (signers: Signer[], role: SignerRole) => signers.length ? signers : [emptySigner(role)];
  if (policy === "client_only") return patientSide.length > 0 ? patientSide : initialSigners("client_only");
  if (policy === "agency_only") return agencySide.length > 0 ? agencySide : initialSigners("agency_only");
  if (policy === "payer_and_agency") return [...orEmpty(payers, "payer"), ...orEmpty(agencySide, "agency")];
  if (policy === "client_payer_and_agency") return [...orEmpty(patientSide, "client"), ...orEmpty(payers, "payer"), ...orEmpty(agencySide, "agency")];
  if (policy === "both_parties") return [...orEmpty(patientSide, "client"), ...others, ...orEmpty(agencySide, "agency")];
  return list.length > 0 ? list : initialSigners(policy);
}

/** Suggestions of the document first, then those of the package, once per address. */
function mergeSuggestions(...groups: (Signer[] | undefined)[]) {
  const seen = new Set<string>();
  return groups.flatMap(group => group ?? []).filter(signer => {
    const key = signer.email.trim().toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const statuses: Record<SignatureStatus, [string, string]> = {
  submitting: ["Отправка приглашений", "Einladungen werden versendet"],
  submission_unknown: ["Проверяем отправку — повторно не отправляйте", "Versand wird geprüft – bitte nicht erneut senden"],
  pending: ["Ожидание подписей", "Unterschriften ausstehend"],
  completed: ["PDF и отчёт сохранены", "PDF und Protokoll gespeichert"],
  needs_review: ["Документ изменился во время подписания — нужна проверка", "Dokument während der Unterschrift geändert – Prüfung erforderlich"],
  declined: ["Подписание отклонено", "Unterschrift abgelehnt"],
  withdrawn: ["Запрос отозван", "Anfrage zurückgezogen"],
  expired: ["Срок запроса истёк", "Anfrage abgelaufen"],
  error: ["Ошибка подписания", "Signatur fehlgeschlagen"],
};

const closedKindLabels: Record<NonNullable<SignatureRequest["closed_kind"]>, [string, string]> = {
  auto_expired: ["Закрыт автоматически: Skribble не подтвердил запрос", "Automatisch geschlossen: Skribble hat die Anfrage nicht bestätigt"],
  abandoned: ["Закрыт сотрудником", "Von Mitarbeitenden geschlossen"],
  review_accepted: ["Подпись принята после проверки", "Unterschrift nach Prüfung anerkannt"],
  review_rejected: ["Подпись отклонена после проверки", "Unterschrift nach Prüfung verworfen"],
};

const deliveryChannels: Record<DeliveryChannel, [string, string]> = {
  skribble: ["Письмо Skribble о завершении", "Abschluss-E-Mail von Skribble"],
  email: ["Наш e-mail", "Eigene E-Mail"],
  portal: ["Портал пациента", "Patientenportal"],
  in_person: ["Лично", "Persönlich übergeben"],
  post: ["Почтой", "Per Post"],
};

const roleLabels: Record<SignerRole, [string, string]> = {
  client: ["Пациент / законный представитель", "Patient/in / gesetzliche Vertretung"],
  minor: ["Несовершеннолетний пациент (по желанию)", "Minderjährige/r Patient/in (optional)"],
  payer: ["Плательщик (принимает расходы)", "Kostenübernehmer"],
  agency: ["Представитель GMED", "GMED-Vertretung"],
  other: ["Другая сторона", "Weitere Partei"],
};

/** Asks for the reason of an abandon or review decision; null when cancelled or too short. */
function askSignatureReason(question: string, tx: (ru: string, de: string) => string): string | null {
  const reason = window.prompt(question);
  if (reason === null) return null;
  if (!signatureReasonValid(reason)) {
    window.alert(tx("Причина должна содержать от 10 до 2000 символов.", "Die Begründung muss 10 bis 2000 Zeichen lang sein."));
    return null;
  }
  return reason.trim();
}

const ineligibleMessages: Record<string, [string, string]> = {
  pdf_required: ["Для электронной подписи нужен сохранённый PDF. Сначала загрузите PDF-версию документа.", "Für die elektronische Unterschrift wird eine gespeicherte PDF benötigt. Laden Sie zuerst die PDF-Version hoch."],
  document_unavailable: ["Документ архивирован или его файл удалён.", "Das Dokument ist archiviert oder seine Datei wurde gelöscht."],
  document_superseded: ["Это предыдущая версия. Откройте текущую версию документа для подписи.", "Dies ist eine frühere Version. Öffnen Sie die aktuelle Dokumentversion zur Unterschrift."],
  document_already_signed: ["Этот документ уже отмечен как подписанный.", "Dieses Dokument ist bereits als unterzeichnet markiert."],
  informational_document_not_signable: [
    "Это информационный документ: его не подписывают. Он автоматически уходит как приложение для ознакомления вместе с договором, заказом или согласием — отправьте на подпись их.",
    "Dies ist ein Informationsdokument: Es wird nicht unterschrieben. Es geht automatisch als Anlage zur Kenntnisnahme mit dem Vertrag, dem Auftrag oder der Einwilligung mit – senden Sie diese zur Unterschrift.",
  ],
  electronic_form_excluded: ["Для этого документа закон исключает электронную форму — нужна подпись на бумаге.", "Für dieses Dokument ist die elektronische Form gesetzlich ausgeschlossen – Unterschrift auf Papier erforderlich."],
};

function requestTone(status: SignatureStatus) {
  if (status === "completed") return "success" as const;
  if (["declined", "withdrawn", "expired", "error"].includes(status)) return "error" as const;
  return "warning" as const;
}

const pageRange = (start: number | null, count: number | null, tx: (ru: string, de: string) => string) => {
  if (!start || !count) return "";
  return count <= 1 ? tx(`стр. ${start}`, `S. ${start}`) : tx(`стр. ${start}–${start + count - 1}`, `S. ${start}–${start + count - 1}`);
};

export type PackagePreviewSelection = { documents: { id: string; title: string }[]; attachments: { id: string; title: string }[] };

/** The documents a request covers, in bundle order with their pages, and its
 * read-only attachments. Documents the viewer may not open stay anonymous. */
export function SignatureRequestMembers({ request, documentId }: { request: SignatureRequest; documentId: string }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const members = request.members ?? [];
  const packaged = request.is_package && members.length > 1;
  return <>
    {packaged ? <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5" data-signature-members>
      <p className="text-xs font-medium text-foreground">{tx(`Пакет из ${members.length} документов — один подписанный PDF`, `Paket aus ${members.length} Dokumenten – eine signierte PDF`)}</p>
      <ol className="divide-y divide-border/50 text-xs">
        {members.map(member => {
          const current = member.document_id === documentId;
          const pages = pageRange(member.page_start, member.page_count, tx);
          return <li key={member.document_id} data-signature-member={member.document_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-foreground">
            <span className={current ? "min-w-0 break-words font-semibold" : "min-w-0 break-words"}>
              <span className="mr-1 font-mono text-muted-foreground">{member.position + 1}.</span>{" "}
              {member.accessible ? `${member.title ?? ""}${member.version ? ` · v${member.version}` : ""}` : tx("Документ без доступа", "Dokument ohne Zugriff")}
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {current ? <StatusBadge tone="info">{tx("этот документ", "dieses Dokument")}</StatusBadge> : null}
              {pages ? <Badge variant="outline" className="rounded-full font-mono text-[10px] text-foreground">{pages}</Badge> : null}
            </span>
          </li>;
        })}
      </ol>
      {request.result_document_id ? <p className="text-[11px] leading-5 text-foreground">{tx("Подписанный оригинал — общий PDF пакета; документ не разделяется, иначе подпись теряет силу.", "Das signierte Original ist die gemeinsame PDF des Pakets; sie wird nicht aufgeteilt, sonst verliert die Signatur ihre Wirkung.")}</p> : null}
    </div> : null}
    {request.attachments?.length ? <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground" data-signature-attachments>
      <StatusBadge tone="neutral" className="text-foreground">{tx("Для ознакомления", "Zur Kenntnisnahme")}</StatusBadge>
      <span className="min-w-0 break-words">{request.attachments.map(attachment => attachment.title ?? tx("документ без доступа", "Dokument ohne Zugriff")).join(", ")}</span>
    </p> : null}
  </>;
}

export function DocumentSignaturePanel({ documentId, onDone, onDirtyChange, onStateChange, onPreviewResult, onComposeNew, onPreviewRelated, onPackageSelectionChange, previewedDocumentIds = [], expanded = false, previewReady = true }: { documentId: string; onDone?: () => void; onDirtyChange?: (dirty: boolean) => void; onStateChange?: (state: SignatureState) => void; onPreviewResult?: (request: SignatureRequest) => void; onComposeNew?: () => void; onPreviewRelated?: (id: string, kind: "signing" | "review") => void; onPackageSelectionChange?: (selection: PackagePreviewSelection) => void; previewedDocumentIds?: string[]; expanded?: boolean; previewReady?: boolean }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [open, setOpen] = useState(expanded);
  const [state, setState] = useState<SignatureState | null>(null);
  const [candidates, setCandidates] = useState<PackageCandidates | null>(null);
  const [candidatesError, setCandidatesError] = useState(false);
  const [selection, setSelection] = useState<PackageSelection>(() => emptyPackageSelection(documentId));
  const [signers, setSigners] = useState<Signer[]>(initialSigners);
  const [baseline, setBaseline] = useState<Signer[]>(initialSigners);
  const [editingSigners, setEditingSigners] = useState<number[]>([]);
  const [excludedSigners, setExcludedSigners] = useState<number[]>([]);
  const [composeNew, setComposeNew] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>("skribble");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [awaitingState, setAwaitingState] = useState(false);
  const [refreshCheck, setRefreshCheck] = useState<{ id: string; before?: string } | null>(null);
  const [paperSigned, setPaperSigned] = useState(false);
  const busyRef = useRef(false);
  const onDoneRef = useRef(onDone);
  const onStateChangeRef = useRef(onStateChange);
  const previousRequests = useRef<string | null>(null);
  const previousPending = useRef(false);
  const initialized = useRef(false);
  const signersTouched = useRef(false);
  const appliedPolicy = useRef<string>("");
  // The suggested package is not a change by staff; only edits to it are.
  const [suggestedSelection, setSuggestedSelection] = useState(() => JSON.stringify(emptyPackageSelection(documentId)));
  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  const selectedSigners = signers.filter((_, index) => !excludedSigners.includes(index));
  const dirty = confirmed || excludedSigners.length > 0 || JSON.stringify(signers) !== JSON.stringify(baseline) || JSON.stringify(selection) !== suggestedSelection;
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const pending = state?.requests.some(r => isSignaturePending(r.status));
  const completed = state?.requests.some(r => r.status === "completed");
  const composing = Boolean(state?.enabled && state.can_send && !pending && !state.ineligible_reason && (!completed || composeNew));
  const resolved = resolvePackage(candidates, selection);
  // The document's own rules come from its signature state; added documents
  // bring theirs from the candidate list.
  const others = resolved.selected.filter(document => document.id !== documentId);
  const policy = combinedSignerPolicy([state?.signer_policy ?? "flexible", ...others.map(document => document.signer_policy)]);
  const minimumLevel = packageMinimumLevel([state?.minimum_level ?? "QES", ...others.map(document => document.minimum_level)]);

  // The workspace previews every PDF that will be sent, in sending order.
  const titleOf = (id: string) => candidates?.documents.find(document => document.id === id)?.title
    ?? candidates?.attachments.find(attachment => attachment.id === id)?.title ?? "";
  const previewKey = JSON.stringify([selection.documentIds, resolved.attachmentIds, Boolean(candidates)]);
  useEffect(() => {
    if (!onPackageSelectionChange) return;
    const [documentIds, attachmentIds] = JSON.parse(previewKey) as [string[], string[]];
    onPackageSelectionChange({
      documents: documentIds.map(id => ({ id, title: titleOf(id) })),
      attachments: attachmentIds.map(id => ({ id, title: titleOf(id) })),
    });
    // titleOf reads the same candidates that previewKey tracks.
  }, [previewKey, onPackageSelectionChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await fetchSignatureState(documentId);
        if (cancelled) return;
        const isPending = next.requests.some(r => isSignaturePending(r.status));
        setState(next); setError(false); setAwaitingState(false);
        onStateChangeRef.current?.(next);
        if (!initialized.current || isPending) {
          const defaults = signersForPolicy(next.suggested_signers, next.signer_policy);
          setSigners(defaults); setBaseline(defaults); setConfirmed(false); setEditingSigners([]); setExcludedSigners([]);
          signersTouched.current = false; appliedPolicy.current = next.signer_policy ?? "flexible";
          initialized.current = true;
        }
        const requestSnapshot = JSON.stringify(next.requests.map(r => [r.id, r.status, r.result_document_id, r.delivered_to_signers_at]));
        if ((previousRequests.current !== null && previousRequests.current !== requestSnapshot) || (previousPending.current && !isPending)) onDoneRef.current?.();
        previousRequests.current = requestSnapshot;
        previousPending.current = isPending;
        if (isPending) timer = setTimeout(() => { void load(); }, 5000);
      } catch (reason) {
        if (cancelled) return;
        if (reason instanceof ApiRequestError && reason.status === 403) setForbidden(true);
        else { setError(true); timer = setTimeout(() => { void load(); }, 15_000); }
      }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [documentId, open, revision]);

  // Candidates of the same patient or lead, with the suggested package.
  useEffect(() => {
    if (!composing) return;
    let cancelled = false;
    setCandidatesError(false);
    fetchPackageCandidates(documentId)
      .then(next => {
        if (cancelled) return;
        setCandidates(next);
        const preset = next.preset_document_ids.filter(id => id !== documentId && next.documents.some(document => document.id === id && !document.ineligible_reason));
        const suggested = { ...emptyPackageSelection(documentId, next.suggested_language), documentIds: [documentId, ...preset] };
        setSuggestedSelection(JSON.stringify(suggested));
        // A reload after an action keeps the staff's choice while it is still possible.
        const current = selectionRef.current;
        const stillPossible = current.documentIds.every(id => next.documents.some(document => document.id === id && !document.ineligible_reason));
        if (current.documentIds.length > 1 && stillPossible) return;
        if (JSON.stringify(current) !== JSON.stringify(suggested)) setConfirmed(false);
        setSelection(suggested);
      })
      .catch(() => { if (!cancelled) setCandidatesError(true); });
    return () => { cancelled = true; };
  }, [composing, documentId, revision]);

  // A package with a contract needs the agency too; consents only the patient
  // side. Suggestions follow the package until staff edit the signers.
  const documentSuggestions = state?.suggested_signers;
  useEffect(() => {
    if (!candidates || signersTouched.current || policy === appliedPolicy.current) return;
    appliedPolicy.current = policy;
    const next = signersForPolicy(mergeSuggestions(documentSuggestions, candidates.suggested_signers), policy);
    setSigners(next); setBaseline(next); setExcludedSigners([]); setEditingSigners([]);
  }, [candidates, policy, documentSuggestions]);

  // The parent keys the component by document ID: draft recipients cannot cross documents.
  if (forbidden) return expanded ? <p role="alert" className="text-sm text-destructive">{tx("Недостаточно прав для электронного подписания этого документа.", "Keine Berechtigung für die elektronische Signatur dieses Dokuments.")}</p> : null;
  async function run(action: () => Promise<unknown>, refresh = true) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setActionError(null);
    try { await action(); }
    catch (reason) {
      const body = reason instanceof ApiRequestError ? reason.body as ({ error?: string; statute?: string; minimum_level?: string } | null | undefined) : null;
      setActionError(signatureErrorText(body?.error, tx, { statute: body?.statute, minimum_level: body?.minimum_level }));
    }
    finally {
      // A successful POST or an ambiguous timeout must be reconciled before
      // another mutation. Stale cached state must never re-enable sending.
      if (refresh) { setAwaitingState(true); setRevision(value => value + 1); }
      busyRef.current = false; setBusy(false);
    }
  }
  const mutationDisabled = busy || awaitingState || error;
  const policyError = signerPolicyError(policy, selectedSigners);
  const previewIds = [...selection.documentIds, ...resolved.attachmentIds];
  const allPreviewed = previewReady && previewIds.every(id => previewedDocumentIds.includes(id));
  const levelOk = !(minimumLevel === "QES" && selection.level === "AES");
  const touchSigners = () => { signersTouched.current = true; setConfirmed(false); setActionError(null); };
  const updateSigner = (index: number, patch: Partial<Signer>) => {
    touchSigners();
    setEditingSigners(current => current.includes(index) ? current : [...current, index]);
    setSigners(current => current.map((signer, n) => n === index ? { ...signer, ...patch } : signer));
  };
  const selectSigner = (index: number, selected: boolean) => {
    touchSigners();
    setEditingSigners(current => current.filter(n => n !== index));
    setExcludedSigners(current => selected ? current.filter(n => n !== index) : [...current, index]);
  };
  const removeSigner = (index: number) => {
    touchSigners(); setEditingSigners([]);
    setSigners(current => current.filter((_, n) => n !== index));
    setExcludedSigners(current => current.filter(n => n !== index).map(n => n > index ? n - 1 : n));
  };
  const addSigner = (role: SignerRole) => {
    touchSigners();
    setSigners(current => [...current, emptySigner(role)]);
    setEditingSigners(current => [...current, signers.length]);
  };
  const isPackage = selection.documentIds.length > 1 || resolved.attachmentIds.length > 0;
  const canSend = !mutationDisabled && allPreviewed && Boolean(candidates) && resolved.complete && !resolved.blocked && levelOk && !policyError && confirmed && validSigners(selectedSigners);

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
        {error ? <Banner tone="error">{tx("Не удалось выполнить действие. Проверьте статус перед повторной отправкой.", "Aktion fehlgeschlagen. Prüfen Sie vor erneutem Versand den Status.")}</Banner> : null}
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}
        {state ? <>
          {!state.enabled ? <section className="rounded-xl border border-border/70 bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <AdminSectionTitle>{tx("Сервис подписи", "Signaturdienst")}</AdminSectionTitle>
              <StatusBadge tone="warning">{state.test_mode ? "DEMO" : "QES / eIDAS"}</StatusBadge>
            </div>
            <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Skribble · Deutschland</p>
                {!state.test_mode ? <p className="text-xs leading-5 text-muted-foreground">{tx("Квалифицированная подпись по стандарту eIDAS", "Qualifizierte Signatur nach eIDAS")}</p> : null}
              </div>
              <SignatureConnectionDialog canConfigure={state.can_configure} onChanged={() => { setAwaitingState(true); setRevision(value => value + 1); }} />
            </div>
            <p className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{tx("Для подписания нужно настроить немецкий аккаунт Skribble. Обратитесь к администратору.", "Zum Signieren muss das deutsche Skribble-Konto eingerichtet werden. Bitte wenden Sie sich an die Administration.")}</p>
          </section> : <div className="flex justify-end">
            <Badge variant="outline" className="rounded-full text-[10px]">{state.test_mode ? "DEMO · Skribble" : "QES / eIDAS · Skribble"}</Badge>
          </div>}
          {state.enabled && state.test_mode ? <Banner tone="warning">{tx("Тестовый режим (DEMO): подписи не имеют юридической силы и не меняют статус договоров, заказов и согласий.", "Testmodus (DEMO): Die Unterschriften haben keine Rechtswirkung und ändern keine Verträge, Aufträge oder Einwilligungen.")}</Banner> : null}
          {!state.can_send ? <p className="text-xs leading-5 text-muted-foreground">{tx("Доступен просмотр статуса. Для отправки документа на подпись нужны права редактирования и скачивания.", "Der Status ist sichtbar. Zum Versand werden Bearbeitungs- und Downloadrechte benötigt.")}</p> : null}

          {state.requests.map((request, index) => {
            return <section key={request.id} aria-label={index === 0 ? tx("Текущий запрос подписи", "Aktuelle Signaturanfrage") : tx("Предыдущий запрос подписи", "Frühere Signaturanfrage")} className="rounded-xl border border-border/70 bg-card shadow-xs" data-signature-request={request.id}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="space-y-1">
                <AdminSectionTitle>{index === 0 ? tx("Текущий запрос", "Aktuelle Anfrage") : tx("Предыдущий запрос", "Frühere Anfrage")}</AdminSectionTitle>
                <time dateTime={request.created_at} className="block font-mono text-[11px] text-foreground">{formatAppDateTime(request.created_at)}</time>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {request.level ? <StatusBadge tone="neutral">{request.test_mode ? "DEMO" : request.level}</StatusBadge> : null}
                <StatusBadge tone={requestTone(request.status)}>{request.test_mode ? "TEST · " : ""}{tx(...statuses[request.status])}</StatusBadge>
              </div>
            </div>
            <div className="space-y-2 p-4">
              <SignatureRequestMembers request={request} documentId={documentId} />
              {request.expires_at || request.invitation_note ? <p className="text-xs text-foreground">{request.expires_at ? `${tx("Подписать до", "Unterschreiben bis")} ${formatAppDate(request.expires_at)}` : ""}{request.expires_at && request.invitation_note ? " · " : ""}{request.invitation_note ?? ""}</p> : null}
              {refreshCheck?.id === request.id ? <p role="status" className="text-xs leading-5 text-foreground">
                {request.updated_at && request.updated_at !== refreshCheck.before
                  ? request.last_error
                    ? tx("Проверка не завершена: не удалось получить результат от Skribble. Повторная попытка выполнится автоматически.", "Prüfung nicht abgeschlossen: Das Ergebnis konnte nicht von Skribble abgerufen werden. Ein neuer Versuch erfolgt automatisch.")
                    : request.status === "pending"
                      ? tx(`Проверено: получено подписей ${request.evidence.signatures?.filter(s => s.status === "SIGNED").length ?? 0} из ${request.signers.length}. Ожидаем остальных подписантов.`, `Geprüft: ${request.evidence.signatures?.filter(s => s.status === "SIGNED").length ?? 0} von ${request.signers.length} Unterschriften erhalten. Weitere Unterschriften stehen aus.`)
                      : tx("Статус обновлён.", "Status aktualisiert.")
                  : tx("Проверка запрошена. Ожидаем ответ Skribble…", "Prüfung angefordert. Antwort von Skribble wird erwartet…")}
              </p> : null}
              {request.signers.map(signer => {
                const signed = request.evidence.signatures?.some(s => s.email.toLowerCase() === signer.email.toLowerCase() && s.status === "SIGNED");
                return <div key={signer.email} data-signature-signer={signed ? "signed" : request.status === "pending" ? "waiting" : "unconfirmed"} className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-foreground">{signer.first_name} {signer.last_name}</span>
                    <span className="block break-all text-foreground">{signer.email}</span>
                  </span>
                  <StatusBadge tone={signed ? "success" : request.status === "pending" ? "warning" : "neutral"} className={signed || request.status === "pending" ? "shrink-0 self-start sm:self-center" : "shrink-0 self-start text-foreground sm:self-center"}>{signed ? tx("Подписано", "Unterzeichnet") : request.status === "pending" ? tx("Ожидает подписи", "Unterschrift ausstehend") : tx("Подпись не подтверждена", "Unterschrift nicht bestätigt")}</StatusBadge>
                </div>;
              })}
              {request.status === "pending" && !request.last_error ? <p className="text-xs leading-5 text-foreground">{tx("Приглашение отправлено на E-Mail. После подписания PDF появится здесь автоматически.", "Die Einladung wurde per E-Mail versendet. Nach der Unterschrift erscheint die PDF hier automatisch.")}</p> : null}
              {request.status === "pending" && !request.last_error ? (() => {
                const frames = signatureFrameCoverage(request.signers);
                return <p data-signature-frames={frames} className={frames === "all" ? "text-xs leading-5 text-foreground" : "text-xs leading-5 text-amber-700"}>{frames === "all"
                  ? tx("Места подписи размечены в документе: подписанту достаточно нажать «Подписать».", "Die Unterschriftsfelder sind im Dokument gesetzt: Zum Unterzeichnen genügt ein Klick.")
                  : frames === "some"
                    ? tx("Места подписи размечены не для всех подписантов: остальные разместят подпись в документе сами.", "Die Unterschriftsfelder sind nicht für alle Personen gesetzt: Die übrigen platzieren ihre Unterschrift selbst.")
                    : tx("Места подписи в документе не размечены: подписант разместит подпись сам.", "Im Dokument sind keine Unterschriftsfelder gesetzt: Die Person platziert ihre Unterschrift selbst.")}</p>;
              })() : null}
              {request.status === "submission_unknown" && request.last_error === "provider_signers_mismatch" ? <p role="alert" className="text-xs leading-5 text-amber-700">{tx("Не удалось сопоставить подписантов в ответе Skribble. Требуется проверка подключения; повторное приглашение не отправляйте.", "Die Personen in der Skribble-Antwort konnten nicht zugeordnet werden. Die Verbindung muss geprüft werden; senden Sie keine zweite Einladung.")}</p> : null}
              {request.status === "error" && request.last_error === "provider_rate_limited" ? <p role="alert" className="text-xs leading-5 text-amber-700">{tx("Skribble временно ограничил число запросов. Приглашения не отправлены. Повторите отправку позже.", "Skribble hat die Anzahl der Anfragen vorübergehend begrenzt. Es wurden keine Einladungen versendet. Versuchen Sie den Versand später erneut.")}</p> : null}
              {request.last_error === "provider_response_too_large" ? <Banner tone="warning">{tx("Подписанный PDF больше 40 МБ и не может быть загружен. Обратитесь к администратору.", "Die signierte PDF ist größer als 40 MB und kann nicht übernommen werden. Wenden Sie sich an die Administration.")}</Banner> : null}
              {request.last_error && request.status === "pending" ? <p className="text-xs leading-5 text-foreground">{tx("Синхронизация повторится автоматически. Подписывать заново не нужно.", "Die Synchronisierung wird automatisch wiederholt. Erneutes Signieren ist nicht nötig.")}</p> : null}
              {request.status === "completed" && !request.test_mode ? request.delivered_to_signers_at
                ? <p className="text-xs text-emerald-700">{tx("Подписанная копия передана подписантам", "Signierte Kopie an die Unterzeichnenden übergeben")}: {formatAppDateTime(request.delivered_to_signers_at)}{request.delivery_channel ? ` · ${tx(...deliveryChannels[request.delivery_channel])}` : ""}</p>
                : request.can_record_delivery && state.can_send ? <div className="space-y-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                  <p>{tx("Потребитель должен получить подписанный договор на долговечном носителе (§ 312f BGB). Отметьте, как копия передана.", "Verbraucher müssen den signierten Vertrag auf einem dauerhaften Datenträger erhalten (§ 312f BGB). Halten Sie fest, wie die Kopie übergeben wurde.")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <NativeComboboxSelect className="h-8 min-w-0 flex-1 bg-field text-xs" aria-label={tx("Способ передачи", "Übergabeweg")} value={deliveryChannel} disabled={mutationDisabled} onChange={event => setDeliveryChannel(event.target.value as DeliveryChannel)}>
                      {(Object.keys(deliveryChannels) as DeliveryChannel[]).map(channel => <option key={channel} value={channel}>{tx(...deliveryChannels[channel])}</option>)}
                    </NativeComboboxSelect>
                    <Button type="button" size="sm" variant="outline" disabled={mutationDisabled} onClick={() => void run(() => recordSignatureDelivery(request.id, deliveryChannel))}>{tx("Отметить передачу", "Übergabe vermerken")}</Button>
                  </div>
                </div> : null : null}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {request.last_error?.startsWith("review_") || request.last_error?.startsWith("signing_") ? <p role="alert" className="w-full text-xs text-destructive">{tx("Комплект требует проверки: один из документов изменился или результат отправки не подтверждён. Не отправляйте повторно; проверьте статус или отзовите запрос.", "Das Paket muss geprüft werden: Eines der Dokumente wurde geändert oder der Versand ist unbestätigt. Nicht erneut senden; Status prüfen oder Anfrage zurückziehen.")}</p> : null}
                {request.result_document_id && onPreviewResult ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onPreviewResult(request)}><Eye className="size-4" />{request.is_package ? tx("Открыть подписанный пакет", "Signiertes Paket öffnen") : tx("Открыть PDF", "PDF öffnen")}</Button> : null}
                {request.result_document_id ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => downloadDocumentFile(request.result_document_id!, `${request.test_mode ? "TEST-" : ""}${request.is_package ? "signed-package" : "signed"}.pdf`), false)}><Download className="size-4" />{tx("Скачать PDF", "PDF herunterladen")}</Button> : null}
                {request.has_report ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => downloadSignatureReport(request.id), false)}>{tx("Отчёт о подписях", "Signaturprotokoll")}</Button> : null}
                {isSignaturePending(request.status) && state.enabled && state.can_send ? <Button type="button" variant="outline" size="sm" disabled={mutationDisabled} onClick={() => void run(async () => { await signatureAction(request.id, "refresh"); setRefreshCheck({ id: request.id, before: request.updated_at }); })}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{tx("Проверить статус", "Status prüfen")}</Button> : null}
                {(request.can_withdraw ?? request.status === "pending") && state.enabled && state.can_send ? <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={mutationDisabled} onClick={() => void run(() => signatureAction(request.id, "withdraw"))}>{tx("Отозвать запрос", "Anfrage zurückziehen")}</Button> : null}
                {request.can_abandon && (state.can_send || state.can_configure) ? <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={mutationDisabled} onClick={() => {
                  const reason = askSignatureReason(tx("Почему запрос закрывается? (10–2000 символов)", "Warum wird die Anfrage aufgegeben? (10–2000 Zeichen)"), tx);
                  if (reason) void run(() => abandonSignatureRequest(request.id, reason));
                }}>{tx("Закрыть запрос как ошибочный", "Anfrage als fehlgeschlagen schließen")}</Button> : null}
                {request.can_resolve_review && state.can_send ? <>
                  <Button type="button" variant="outline" size="sm" disabled={mutationDisabled} onClick={() => {
                    const reason = askSignatureReason(tx("Почему подпись принимается, хотя документ изменился?", "Warum wird die Unterschrift trotz Änderung anerkannt?"), tx);
                    if (reason) void run(() => resolveSignatureReview(request.id, "accept", reason));
                  }}>{tx("Принять подпись", "Unterschrift anerkennen")}</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={mutationDisabled} onClick={() => {
                    const reason = askSignatureReason(tx("Почему подпись отклоняется?", "Warum wird die Unterschrift verworfen?"), tx);
                    if (reason) void run(() => resolveSignatureReview(request.id, "reject", reason));
                  }}>{tx("Отклонить подпись", "Unterschrift verwerfen")}</Button>
                </> : null}
                {request.closed_kind ? <p className="w-full text-xs leading-5 text-foreground">{tx(...closedKindLabels[request.closed_kind])}{request.closed_at ? ` · ${formatAppDateTime(request.closed_at)}` : ""}{request.close_reason && request.closed_kind !== "auto_expired" ? ` · ${request.close_reason}` : ""}</p> : null}
              </div>
            </div>
          </section>;
          })}

          {state.can_send && !pending && state.ineligible_reason && !state.requests.some(r => r.result_document_id) ? <p className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs">{tx(...(ineligibleMessages[state.ineligible_reason] ?? ["Документ сейчас недоступен для подписания.", "Das Dokument kann derzeit nicht unterzeichnet werden."]))}{state.electronic_form_excluded ? ` (${state.electronic_form_excluded})` : ""}</p> : null}

          {state.enabled && state.can_send && !pending && !state.ineligible_reason && completed && !composeNew ? <Button type="button" variant="outline" disabled={mutationDisabled} onClick={() => { setComposeNew(true); onComposeNew?.(); }}><Plus className="size-4" />{tx("Новый запрос подписи", "Neue Signaturanfrage")}</Button> : null}
          {composing ? <section className="rounded-xl border border-border/70 bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <AdminSectionTitle>{tx("Новый запрос подписи", "Neue Signaturanfrage")}</AdminSectionTitle>
              <StatusBadge tone="neutral">{selection.level}</StatusBadge>
            </div>
            <div className="space-y-4 p-4">
              {candidatesError ? <Banner tone="error">{tx("Не удалось загрузить документы пациента. Повторите открытие окна.", "Die Dokumente der Person konnten nicht geladen werden. Öffnen Sie das Fenster erneut.")}</Banner> : null}
              {!candidates && !candidatesError ? <p role="status" className="text-xs text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{tx("Загрузка документов…", "Dokumente werden geladen…")}</p> : null}
              {candidates ? <SignaturePackageComposer documentId={documentId} candidates={candidates} selection={selection} disabled={busy || awaitingState} previewedDocumentIds={previewedDocumentIds} onPreview={onPreviewRelated} onChange={next => { setSelection(next); setConfirmed(false); setActionError(null); }} /> : null}

              <section aria-label={tx("Подписанты", "Unterzeichnende Personen")} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AdminSectionTitle>{policy === "client_only" ? tx("Подпись пациента", "Unterschrift der Patientenseite") : policy === "agency_only" ? tx("Подпись GMED", "GMED-Unterschrift") : tx("Подписанты", "Unterzeichnende Personen")}</AdminSectionTitle>
                  <Badge variant="outline" className="rounded-full text-[10px]" aria-label={`${tx("Выбрано подписантов", "Ausgewählte Personen")}: ${selectedSigners.length} / ${signers.length}`}>{selectedSigners.length} / {signers.length}</Badge>
                </div>
                {policy === "payer_and_agency" || policy === "client_payer_and_agency" ? <p className="text-xs leading-5 text-muted-foreground">{tx("Заявление о принятии расходов подписывает плательщик в своём поле подписи, затем GMED.", "Die Kostenübernahmeerklärung unterschreibt der Kostenübernehmer in seinem eigenen Unterschriftsfeld, danach GMED.")}</p> : null}
                {policy === "both_parties" && isPackage ? <p className="text-xs leading-5 text-muted-foreground">{tx("Сторона пациента получит одно приглашение со всеми документами и подпишет первой; GMED получит пакет после неё.", "Die Patientenseite erhält eine Einladung mit allen Dokumenten und unterschreibt zuerst; GMED erhält das Paket danach.")}</p> : null}
                {signers.map((signer, index) => {
                  const selected = !excludedSigners.includes(index);
                  const editing = selected && (!validSigners([signer]) || editingSigners.includes(index));
                  const name = `${signer.first_name} ${signer.last_name}`.trim() || `${tx("Подписант", "Unterzeichnende Person")} ${index + 1}`;
                  return <div key={index} className={`min-w-0 rounded-lg border p-3 ${selected ? "border-[var(--brand)]/35 bg-[var(--brand)]/[0.025]" : "border-border/70 bg-muted/20"}`}>
                    <div className="flex min-w-0 items-start gap-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input type="checkbox" aria-label={`${tx("Выбрать подписанта", "Person auswählen")} ${index + 1}: ${name}`} checked={selected} disabled={busy || awaitingState} onChange={event => selectSigner(index, event.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--brand)]" />
                        <span className="min-w-0 space-y-1">
                          <span className="block text-[11px] text-muted-foreground">{tx(...roleLabels[signer.role])}</span>
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
                      <SignatureSignerFields signer={signer} index={index} disabled={busy || awaitingState} embedded policy={policy === "conflict" ? "flexible" : policy} onChange={patch => updateSigner(index, patch)} />
                      {validSigners([signer]) ? <div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={busy || awaitingState} onClick={() => setEditingSigners(current => current.filter(n => n !== index))}>{tx("Готово", "Fertig")}</Button></div> : null}
                    </div> : null}
                  </div>;
                })}
                {signers.length < 6 ? <div className="flex flex-wrap gap-2">
                  {policy !== "agency_only" && policy !== "payer_and_agency" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => addSigner("client")}><Plus className="size-4" />{tx("Законный представитель / сторона пациента", "Gesetzliche Vertretung / Patientenseite")}</Button> : null}
                  {policy !== "agency_only" && policy !== "payer_and_agency" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => addSigner("minor")}><Plus className="size-4" />{tx("Несовершеннолетний пациент (с ~14 лет)", "Minderjährige/r Patient/in (ab ca. 14 J.)")}</Button> : null}
                  {policy === "payer_and_agency" || policy === "client_payer_and_agency" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => addSigner("payer")}><Plus className="size-4" />{tx("Плательщик", "Kostenübernehmer")}</Button> : null}
                  {policy !== "client_only" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => addSigner("agency")}><Plus className="size-4" />{tx("Представитель GMED", "GMED-Vertretung")}</Button> : null}
                  {policy === "flexible" ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => addSigner("other")}><Plus className="size-4" />{tx("Добавить подписанта", "Person hinzufügen")}</Button> : null}
                </div> : null}
                {policyError && selectedSigners.length > 0 ? <Banner tone="warning">{signatureErrorText(policyError, tx)}</Banner> : null}
              </section>
            </div>
            <div className="border-t border-border/60 bg-muted/10 p-4">
              {!allPreviewed ? <p className="mb-3 text-xs text-muted-foreground">{tx("Просмотрите все PDF пакета слева — без этого отправка недоступна.", "Sehen Sie alle PDFs des Pakets links an – vorher ist kein Versand möglich.")}</p> : null}
              <label className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-3 text-xs leading-5 dark:border-amber-800 dark:bg-amber-950/30"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--brand)]" /><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" /><span>{isPackage ? tx("Я проверил все PDF пакета, порядок документов и адреса. Отправить пакет выбранным подписантам через Skribble.", "Ich habe alle PDFs des Pakets, ihre Reihenfolge und die Adressen geprüft. Dieses Paket über Skribble versenden.") : tx("Я проверил сохранённый PDF и адреса. Отправить этот документ выбранным подписантам через Skribble.", "Ich habe die gespeicherte PDF und die Adressen geprüft. Dieses Dokument über Skribble an die ausgewählten Personen senden.")}</span></label>
              <div className="mt-3 flex justify-end">
                <Button type="button" className="h-9 rounded-lg" disabled={!canSend} onClick={() => void run(async () => {
                  await createSignaturePackage({
                    document_ids: selection.documentIds, signers: selectedSigners, attachment_ids: resolved.attachmentIds,
                    level: selection.level, expires_at: expiryInstant(selection.expiresOn), message: selection.message, language: selection.language,
                  });
                  previousPending.current = true; setSigners(baseline); setExcludedSigners([]); setConfirmed(false); setComposeNew(false);
                })}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{busy ? tx("Отправка…", "Wird versendet…") : isPackage ? tx("Отправить пакет на подпись", "Paket zur Unterschrift senden") : tx("Отправить на подпись", "Zur Unterschrift senden")}</Button>
              </div>
            </div>
          </section> : null}
          {paperSigned ? <p role="status" data-paper-signature-stored className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{tx("Скан сохранён как подписанная версия документа.", "Der Scan wurde als unterschriebene Fassung des Dokuments gespeichert.")}</p> : null}
          {state.can_sign_on_paper && !pending && !paperSigned ? <PaperSignatureSection lang={lang === "de" ? "de" : "ru"} electronicFormExcluded={state.electronic_form_excluded} disabled={mutationDisabled}
            onSubmit={async (scan, signedOn) => {
              let stored = false;
              await run(async () => {
                await recordPaperSignature(documentId, scan, signedOn);
                stored = true;
                setPaperSigned(true);
                onDoneRef.current?.();
              });
              return stored;
            }} /> : null}
        </> : null}
      </div> : null}
    </details>
  );
}
