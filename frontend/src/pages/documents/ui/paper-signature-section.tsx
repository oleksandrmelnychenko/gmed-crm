import { useId, useState } from "react";
import { FileText, FileUp, Info, LoaderCircle, Stamp } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

const MAX_SCAN_SIZE = 25 * 1024 * 1024;

type Props = {
  lang: "de" | "ru";
  /** The law excludes the electronic form for this document, e.g. "§ 766 S. 2 BGB". */
  electronicFormExcluded?: string | null;
  disabled?: boolean;
  /** Stores the scan as the signed version; resolves to whether it was stored. */
  onSubmit: (scan: File, signedOn: string) => Promise<boolean>;
};

/**
 * A signature given on paper: staff choose the scan of the signed copy and the
 * day it was signed. The scan becomes the signed version of the document, with
 * the same effects as an electronic signature.
 */
export function PaperSignatureSection({ lang, electronicFormExcluded, disabled = false, onSubmit }: Props) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const inputId = useId();
  const today = appDateKey();
  const [scan, setScan] = useState<File | null>(null);
  const [signedOn, setSignedOn] = useState(today);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const tooLarge = Boolean(scan && scan.size > MAX_SCAN_SIZE);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(signedOn) && signedOn <= today;
  const blocked = disabled || busy;

  async function submit() {
    if (!scan || tooLarge || !dateValid || !confirmed || blocked) return;
    setBusy(true);
    try {
      if (await onSubmit(scan, signedOn)) {
        setScan(null);
        setConfirmed(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-paper-signature className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <AdminSectionTitle>{tx("Подписано на бумаге", "Auf Papier unterschrieben")}</AdminSectionTitle>
        <Stamp aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
          {electronicFormExcluded
            ? tx(
                `Для этого документа закон исключает электронную форму (${electronicFormExcluded}). Загрузите скан экземпляра, подписанного от руки.`,
                `Für dieses Dokument ist die elektronische Form ausgeschlossen (${electronicFormExcluded}). Laden Sie den Scan des handschriftlich unterschriebenen Exemplars hoch.`,
              )
            : tx(
                "Если документ подписан от руки, загрузите его скан. Скан станет подписанной версией документа, а договор, заказ или согласие будут отмечены как подписанные.",
                "Wurde das Dokument handschriftlich unterschrieben, laden Sie den Scan hoch. Der Scan wird zur unterschriebenen Fassung des Dokuments; Vertrag, Auftrag oder Einwilligung gelten damit als unterschrieben.",
              )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">{tx("PDF, JPG или PNG · до 25 МБ", "PDF, JPG oder PNG · bis 25 MB")}</StatusChip>
          <span className="inline-flex">
            <input
              id={inputId}
              type="file"
              className="peer sr-only"
              accept=".pdf,.jpg,.jpeg,.png"
              disabled={blocked}
              onChange={(event) => {
                setScan(event.currentTarget.files?.[0] ?? null);
                setConfirmed(false);
                event.currentTarget.value = "";
              }}
            />
            <label
              htmlFor={inputId}
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "h-8 cursor-pointer rounded-lg bg-[var(--brand)] text-white hover:brightness-95 peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                blocked && "pointer-events-none opacity-50",
              )}
            >
              <FileUp aria-hidden="true" className="size-4" />
              {scan ? tx("Выбрать другой файл", "Andere Datei wählen") : tx("Выбрать скан", "Scan auswählen")}
            </label>
          </span>
          {scan ? (
            <StatusChip className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
              <FileText aria-hidden="true" />
              <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{scan.name}</span>
            </StatusChip>
          ) : null}
        </div>
        {tooLarge ? (
          <p role="alert" className="text-xs text-destructive">
            {tx("Скан больше 25 МБ.", "Der Scan ist größer als 25 MB.")}
          </p>
        ) : null}
        {/* The app's DD.MM.YYYY date field, not the browser's own (QA C3-02). */}
        <label className="grid max-w-56 gap-1.5 text-xs font-medium text-foreground">
          <span className="font-mono">{tx("Дата подписи", "Unterschrieben am")}</span>
          <Input
            type="date"
            data-testid="paper-signature-date"
            className="h-9 bg-card text-sm font-normal text-foreground"
            max={today}
            value={signedOn}
            disabled={blocked}
            onChange={(event) => {
              setSignedOn(event.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        {!dateValid ? (
          <p role="alert" className="text-xs text-destructive">
            {tx("Дата подписи не может быть в будущем.", "Das Unterschriftsdatum darf nicht in der Zukunft liegen.")}
          </p>
        ) : null}
        <label className="flex items-start gap-2 rounded-lg bg-muted/25 px-3 py-2.5 text-sm leading-6 text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={blocked || !scan}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
          />
          <span>
            {tx(
              "Я сверил скан с этим документом: на нём стоят все нужные подписи. Оригинал на бумаге хранится в агентстве.",
              "Ich habe den Scan mit diesem Dokument verglichen: Er trägt alle erforderlichen Unterschriften. Das Papieroriginal wird in der Agentur aufbewahrt.",
            )}
          </span>
        </label>
        <div className="flex justify-end">
          <Button
            type="button"
            className="h-9 rounded-lg bg-[var(--brand)] text-white hover:brightness-95"
            disabled={!scan || tooLarge || !dateValid || !confirmed || blocked}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Stamp className="size-4" />}
            {busy ? tx("Сохранение…", "Wird gespeichert…") : tx("Сохранить как подписанный", "Als unterschrieben speichern")}
          </Button>
        </div>
      </div>
    </section>
  );
}
