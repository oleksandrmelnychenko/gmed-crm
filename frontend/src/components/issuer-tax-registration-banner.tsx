/**
 * Warns while GMED's own Steuernummer / USt-IdNr. is missing: invoices are
 * not released without it (§ 14 Abs. 4 Nr. 2 UStG, server code
 * `issuer_tax_registration_missing`). Shown on the billing pages and in the
 * system settings; renders nothing once a tax registration is set.
 */

import { useEffect, useState } from "react";

import { StaffLink } from "@/components/staff-link";
import { Banner } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";

export const ISSUER_TAX_REGISTRATION_PATH = "/invoices/issuer-tax-registration";
export const SYSTEM_SETTINGS_PATH = "/admin/settings";

const copy = {
  ru: {
    title: "Не указаны налоговые данные GMED.",
    body: "Пока в системных настройках не заполнены Steuernummer или USt-IdNr. компании, счета нельзя выпустить (§ 14 UStG); черновики создавать можно.",
    link: "Открыть системные настройки",
    ask: "Заполнить их может CEO или IT-администратор.",
    onSettings: "Заполните поле «Налоговый номер / Steuernummer» или «ИНН по НДС / USt-IdNr.» ниже.",
  },
  de: {
    title: "Steuerdaten der GMED fehlen.",
    body: "Solange in den Systemeinstellungen weder Steuernummer noch USt-IdNr. des Unternehmens hinterlegt sind, können keine Rechnungen ausgestellt werden (§ 14 UStG); Entwürfe sind möglich.",
    link: "Systemeinstellungen öffnen",
    ask: "Eintragen können CEO oder IT-Administration.",
    onSettings: "Bitte unten „Steuernummer“ oder „USt-IdNr.“ ausfüllen.",
  },
} as const;

export function issuerTaxRegistrationText(lang: string) {
  return lang === "de" ? copy.de : copy.ru;
}

/** `true`/`false` once loaded; `null` while loading or when it cannot be read. */
export function useIssuerTaxRegistration(refreshKey: unknown = null): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<{ configured?: unknown } | null>(ISSUER_TAX_REGISTRATION_PATH, { forceFresh: true })
      .then((result) => {
        if (!active) return;
        // Anything but a clear answer shows no warning.
        setConfigured(typeof result?.configured === "boolean" ? result.configured : null);
      })
      .catch(() => {
        if (active) setConfigured(null);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);
  return configured;
}

export function IssuerTaxRegistrationBanner({
  onSettingsPage = false,
  refreshKey = null,
}: {
  /** On the settings page itself: point to the fields instead of linking. */
  onSettingsPage?: boolean;
  refreshKey?: unknown;
}) {
  const { lang } = useLang();
  const { user } = useAuth();
  const configured = useIssuerTaxRegistration(refreshKey);
  if (configured !== false) return null;
  const text = issuerTaxRegistrationText(lang);
  const canEditSettings = hasCapability(user, "admin.settings");
  return (
    <Banner tone="warning" withIcon>
      <p className="font-medium">{text.title}</p>
      <p className="mt-1">{text.body}</p>
      <p className="mt-1">
        {onSettingsPage ? (
          text.onSettings
        ) : canEditSettings ? (
          <StaffLink className="font-medium underline underline-offset-4" to={SYSTEM_SETTINGS_PATH}>
            {text.link}
          </StaffLink>
        ) : (
          text.ask
        )}
      </p>
    </Banner>
  );
}
