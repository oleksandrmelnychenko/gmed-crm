import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { buildApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t as translationsFor, useLang } from "@/lib/i18n";
import { isLeadPortalUser } from "@/lib/staff-route-access";
import { asLeadCabinetLang } from "./patient-lead/lead-request-text";
import { FormPrivacyNotice } from "./form-privacy-notice";

type LegalNotice = Partial<Record<
  | "agency_name"
  | "agency_care_of"
  | "agency_address"
  | "agency_country_code"
  | "agency_phone"
  | "agency_email"
  | "agency_website"
  | "agency_vat_id"
  | "agency_privacy_email"
  | "agency_data_system_name"
  | "agency_data_processor_notice"
  | "agency_data_controller_statement",
  string
>>;

const cardClass = "space-y-4 rounded-xl border border-border/50 bg-card p-4 sm:p-5";
const headingClass = "flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground";

function SectionMarker() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />;
}

/**
 * Impressum and Datenschutzerklärung, reachable without signing in (Art. 13
 * DSGVO, § 5 TMG). The controller details come from the agency settings so the
 * page never drifts from the contracts. A signed-in patient or lead sees the
 * same page inside the portal (see `LegalNoticeRoute`).
 */
export function LegalNoticePage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { hash, search } = useLocation();
  const noticeLang = asLeadCabinetLang(new URLSearchParams(search).get("lang")) ?? lang;
  const localizedLabels: Partial<Record<string, string>> = noticeLang === "en" ? {
    legal_imprint_title: "Legal notice", legal_privacy_title: "Privacy notice",
    legal_load_error: "The agency contact details could not be loaded.",
    legal_phone: "Telephone", legal_email: "Email", legal_vat_id: "VAT ID", legal_back: "Back to sign in",
  } : noticeLang === "uk" ? {
    legal_imprint_title: "Юридична інформація", legal_privacy_title: "Повідомлення про конфіденційність",
    legal_load_error: "Не вдалося завантажити контактні дані агентства.",
    legal_phone: "Телефон", legal_email: "Електронна пошта", legal_vat_id: "Номер ПДВ", legal_back: "Назад до входу",
  } : {};
  const noticeUi = noticeLang === "de" || noticeLang === "ru" ? translationsFor(noticeLang).uiText : t.uiText;
  const l = (key: string) => localizedLabels[key] ?? noticeUi[key] ?? key;
  const [notice, setNotice] = useState<LegalNotice | null>(null);
  const [failed, setFailed] = useState(false);
  const inPortal = user?.role === "patient" && !user.password_change_required;
  const formNotice = !inPortal || isLeadPortalUser(user);

  useEffect(() => {
    let cancelled = false;
    fetch(buildApiUrl("/public/legal"))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: LegalNotice) => {
        if (!cancelled) setNotice(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A link to "/legal#privacy" (the consent in the lead cabinet) opens at the privacy notice.
  useEffect(() => {
    if (hash === "#privacy" && (notice || failed)) {
      document.getElementById("privacy")?.scrollIntoView({ block: "start" });
    }
  }, [hash, notice, failed]);

  const name = notice?.agency_name || "GMED";
  const privacyEmail = notice?.agency_privacy_email || notice?.agency_email || "";
  const paragraphs = (key: string) => l(key).split("\n\n");
  const title = { de: "Impressum & Datenschutz", en: "Legal notice & data protection", uk: "Юридична інформація та захист даних", ru: "Impressum и защита данных" }[noticeLang];

  const content = (
    <>
      <section className={cardClass} data-testid="legal-imprint">
        <h2 className={headingClass}><SectionMarker />{l("legal_imprint_title")}</h2>
        {failed ? <p className="text-red-700">{l("legal_load_error")}</p> : null}
        <address className="break-words not-italic leading-6">
          <strong>{name}</strong>
          {notice?.agency_care_of ? <><br />{notice.agency_care_of}</> : null}
          {notice?.agency_address ? <><br />{notice.agency_address}</> : null}
          {notice?.agency_phone ? <><br />{l("legal_phone")}: {notice.agency_phone}</> : null}
          {notice?.agency_email ? <><br />{l("legal_email")}: {notice.agency_email}</> : null}
          {notice?.agency_website ? <><br />{notice.agency_website}</> : null}
          {notice?.agency_vat_id ? <><br />{l("legal_vat_id")}: {notice.agency_vat_id}</> : null}
        </address>
      </section>

      <section id="privacy" className={`${cardClass} scroll-mt-4 leading-relaxed`} data-testid="legal-privacy">
        <h2 className={headingClass}><SectionMarker />{l("legal_privacy_title")}</h2>
        {formNotice ? <FormPrivacyNotice lang={noticeLang === "ru" ? "ru" : "de"} agency={notice} /> : <>
        <p>
          <strong>{l("legal_privacy_controller")}:</strong> {name}
          {notice?.agency_address ? `, ${notice.agency_address}` : ""}
          {privacyEmail ? ` · ${l("legal_email")}: ${privacyEmail}` : ""}
        </p>
        {notice?.agency_data_controller_statement ? <p>{notice.agency_data_controller_statement}</p> : null}
        {paragraphs("legal_privacy_body").map((paragraph, index) => (
          <p key={index}>{paragraph.replace("{system}", notice?.agency_data_system_name || "GMED-CRM-System")}</p>
        ))}
        {notice?.agency_data_processor_notice ? <p>{notice.agency_data_processor_notice}</p> : null}
        <h3 className="pt-1 font-semibold">{l("legal_rights_title")}</h3>
        <p>{l("legal_rights_body")}</p>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">
          {l("legal_objection_notice")}
        </p>
        <p>{l("legal_complaint_body")}</p>
        </>}
      </section>
    </>
  );

  // Inside the portal the shell already provides <main> and the way back.
  if (inPortal) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 pb-16 text-[13px] text-foreground" data-testid="legal-notice">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {content}
      </div>
    );
  }
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 text-[13px] text-foreground sm:px-6" data-testid="legal-notice">
      <header className="space-y-5 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <img src="/gmed-logo.png" alt="GMED" className="h-8 w-auto object-contain" />
          <a href="/login" className={`${buttonVariants({ variant: "outline", size: "sm" })} h-8 rounded-lg bg-field text-xs`}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />{l("legal_back")}
          </a>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </header>
      {content}
    </main>
  );
}
