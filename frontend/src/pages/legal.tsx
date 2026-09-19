import { useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import { useLang } from "@/lib/i18n";

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

/**
 * Impressum and Datenschutzerklärung, reachable without signing in (Art. 13
 * DSGVO, § 5 TMG). The controller details come from the agency settings so the
 * page never drifts from the contracts.
 */
export function LegalNoticePage() {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [notice, setNotice] = useState<LegalNotice | null>(null);
  const [failed, setFailed] = useState(false);

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

  const name = notice?.agency_name || "GMED";
  const privacyEmail = notice?.agency_privacy_email || notice?.agency_email || "";
  const paragraphs = (key: string) => l(key).split("\n\n");

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 text-sm text-foreground">
      <a href="/login" className="text-xs text-muted-foreground underline">
        {l("legal_back")}
      </a>

      <section className="space-y-3" data-testid="legal-imprint">
        <h1 className="text-xl font-semibold">{l("legal_imprint_title")}</h1>
        {failed ? <p className="text-red-700">{l("legal_load_error")}</p> : null}
        <address className="not-italic leading-6">
          <strong>{name}</strong>
          {notice?.agency_care_of ? <><br />{notice.agency_care_of}</> : null}
          {notice?.agency_address ? <><br />{notice.agency_address}</> : null}
          {notice?.agency_phone ? <><br />{l("legal_phone")}: {notice.agency_phone}</> : null}
          {notice?.agency_email ? <><br />{l("legal_email")}: {notice.agency_email}</> : null}
          {notice?.agency_website ? <><br />{notice.agency_website}</> : null}
          {notice?.agency_vat_id ? <><br />{l("legal_vat_id")}: {notice.agency_vat_id}</> : null}
        </address>
      </section>

      <section className="space-y-3" data-testid="legal-privacy">
        <h2 className="text-lg font-semibold">{l("legal_privacy_title")}</h2>
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
        <h3 className="font-semibold">{l("legal_rights_title")}</h3>
        <p>{l("legal_rights_body")}</p>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">
          {l("legal_objection_notice")}
        </p>
        <p>{l("legal_complaint_body")}</p>
      </section>
    </main>
  );
}
