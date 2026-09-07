import { useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export function ClinicalReportPdfAction({ patientId }: { patientId: string }) {
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;

  async function download() {
    if (!patientId || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await downloadApiFile(
        `/patients/${encodeURIComponent(patientId)}/clinical.pdf?lang=${lang}`,
        "arztbrief.pdf",
        { cache: "no-store" },
      );
    } catch {
      toast.error(tx(
        "Не удалось сформировать врачебное заключение. Повторите попытку.",
        "Der Arztbrief konnte nicht erstellt werden. Bitte erneut versuchen.",
      ));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Button type="button" size="sm" variant="outline"
    className="h-9 rounded-lg gap-1.5 px-3.5"
    disabled={!patientId || busy} aria-busy={busy}
    title={tx("Скачать заключение из сохранённых данных пациента", "Arztbrief aus den gespeicherten Patientendaten herunterladen")}
    onClick={() => void download()}>
    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
    {tx("Врачебное заключение (PDF)", "Arztbrief (PDF)")}
  </Button>;
}
