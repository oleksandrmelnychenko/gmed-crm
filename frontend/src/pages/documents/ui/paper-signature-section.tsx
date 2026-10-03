import { useId, useState } from "react";
import { FileUp, LoaderCircle, Stamp } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
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
    <section data-paper-signature className="rounded-xl border border-border/70 bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <AdminSectionTitle>{tx("Подписано на бумаге", "Auf Papier unterschrieben")}</AdminSectionTitle>
        <Stamp aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs leading-5 text-muted-foreground">
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
        <div className="flex flex-wrap items-center gap-2">
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
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-9 cursor-pointer rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                blocked && "pointer-events-none opacity-50",
              )}
            >
              <FileUp aria-hidden="true" className="size-4" />
              {scan ? tx("Выбрать другой файл", "Andere Datei wählen") : tx("Выбрать скан", "Scan auswählen")}
            </label>
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {scan ? scan.name : tx("PDF, JPG или PNG, до 25 МБ", "PDF, JPG oder PNG, bis 25 MB")}
          </span>
        </div>
        {tooLarge ? (
          <p role="alert" className="text-xs text-destructive">
            {tx("Скан больше 25 МБ.", "Der Scan ist größer als 25 MB.")}
          </p>
        ) : null}
        <label className="grid max-w-56 gap-1.5 text-xs font-medium text-muted-foreground">
          {tx("Дата подписи", "Unterschrieben am")}
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-field px-2 text-sm font-normal text-foreground"
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
        <label className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-3 text-xs leading-5 dark:border-amber-800 dark:bg-amber-950/30">
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
            className="h-9 rounded-lg"
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
