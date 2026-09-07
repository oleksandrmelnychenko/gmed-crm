import { ArrowUpRight, CheckCircle2, Circle, FileCheck2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import type { DatevProfile } from "./setup-api";
import { useDatevText } from "./text";
import { DATEV_COMPATIBILITY_DOCS, datevReadiness, READINESS_LABELS_DE } from "./readiness-model";
import { DatevSetupSection } from "./setup-section";

export function DatevReadiness({ profile, dirty }: { profile: DatevProfile; dirty: boolean }) {
  const { lang } = useDatevText();
  const { canStaffPath } = useStaffNavigate();
  const de = lang === "de";
  const checks = datevReadiness(profile);
  const labels = de ? READINESS_LABELS_DE : {
    company: "Указана компания", numbers: "Указаны Beraternummer и Mandantennummer",
    modules: "Выбраны используемые модули", version: "Указана версия Belege online",
    export: "Уточнён статус заказа Export Rechnungswesen",
  };
  return <DatevSetupSection
    title={de ? "Vorbereitung der Verbindung" : "Подготовка подключения"}
    data-testid="datev-readiness"
    action={<>
      <Badge variant="secondary" className="whitespace-normal">{de ? "Angaben vorbereitet" : "Данные подготовлены"}: {checks.filter((check) => check.complete).length} / {checks.length}</Badge>
      {canStaffPath("/invoices") ? <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={() => document.getElementById("datev-document-checks")?.scrollIntoView()}><FileCheck2 aria-hidden className="size-3.5" />{de ? "Dokumente prüfen" : "Проверить документы"}</Button> : null}
    </>}
    description={dirty
      ? de ? "Stand des gespeicherten Profils. Änderungen zuerst speichern." : "Показан сохранённый профиль. Сначала сохраните изменения."
      : de ? "Eigene Angaben in GMed. DATEV-Zugriffsrechte werden erst nach der Autorisierung geprüft." : "Сведения из GMed. Права доступа к DATEV будут проверены после авторизации."}
  >
    <ul className="grid gap-2 sm:grid-cols-2">
      {checks.map((check) => <li key={check.id} className="flex min-w-0 items-start gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-5">
        {check.complete ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <span>{labels[check.id]}<span className="sr-only"> — {check.complete ? de ? "erledigt" : "готово" : de ? "offen" : "не заполнено"}</span></span>
      </li>)}
    </ul>
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>{de ? "Noch erforderlich: App-Registrierung, API-Abonnements, Sandbox-Test und Freigabe der Steuerberatung. Die Verbindung bleibt bis dahin nicht eingerichtet." : "Ещё нужны регистрация приложения, доступ к API, тест в sandbox и разрешение бухгалтерии. До этого подключение остаётся ненастроенным."}</p>
    </div>
    {profile.modules.includes("belege") ? <p className="text-xs leading-5 text-muted-foreground">
      {de ? "Bei der neuen Version von Belege online wird Rechnungsdatenservice 1.0 derzeit nicht unterstützt. Den passenden Datenservice und die Formate anhand der tatsächlichen Version prüfen." : "Новая версия Belege online пока не поддерживает Rechnungsdatenservice 1.0. Сервис обмена и форматы нужно сверить с фактической версией кабинета."}{" "}
      <a href={DATEV_COMPATIBILITY_DOCS} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">{de ? "DATEV-Kompatibilität" : "Совместимость DATEV"}<ArrowUpRight aria-hidden className="size-3" /></a>
    </p> : null}
  </DatevSetupSection>;
}
