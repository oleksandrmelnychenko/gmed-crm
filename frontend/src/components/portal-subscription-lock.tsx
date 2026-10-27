import { LockKeyhole } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function PortalSubscriptionLock({ label, onClose }: { label?: string; onClose?: () => void }) {
  const { lang } = useLang();
  const german = lang === "de";
  const content = <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="status">
    <LockKeyhole className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 space-y-2">
      <p className="font-medium">{german ? "Dieser Bereich ist gesperrt." : "Этот раздел закрыт."}</p>
      <p>{german
        ? "Er wird mit einem aktiven Abonnement im Auftrag dieses Patienten verfügbar. Bitte wenden Sie sich an GMED."
        : "Он станет доступен при активной подписке в заказе этого пациента. Обратитесь в GMED."}</p>
      <p className="text-sm">{german
        ? "Konto, Datenschutz, Dokumente und Rechnungen bleiben verfügbar."
        : "Аккаунт, конфиденциальность, документы и счета остаются доступными."}</p>
    </div>
  </div>;

  if (!onClose) return <div className="mx-auto w-full max-w-3xl py-2">{content}</div>;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <AdminDialogScaffold
      title={<span className="inline-flex items-center gap-2"><LockKeyhole className="size-5 text-[var(--brand)]" aria-hidden="true" />{label}</span>}
      description={german ? "Aktives Abonnement erforderlich" : "Нужна активная подписка"}
      maxWidthClassName="sm:max-w-xl"
      footer={<div className="flex justify-end p-3"><Button variant="outline" onClick={onClose}>{german ? "Schließen" : "Закрыть"}</Button></div>}
    >{content}</AdminDialogScaffold>
  </Dialog>;
}
