import { KeySquare } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SignatureDefaultsSettings } from "@/pages/documents/ui/signature-defaults-settings";

/**
 * Electronic signature: who signs for GMED by default. The API access of the
 * provider is entered on the API connections page (`/admin/api-connections`,
 * owner request 2026-10-05), together with the keys of other services.
 */
export function AdminSignaturesPage() {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const admin = user?.role === "ceo" || user?.role === "it_admin";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav_signatures}
        description={lang === "de"
          ? "Skribble · Deutschland · Wer für GMED unterschreibt"
          : "Skribble · Германия · Кто подписывает за GMED"}
      />
      <section className="grid min-w-0 max-w-3xl gap-3" aria-label={t.nav_signatures}>
        {admin ? <SignatureDefaultsSettings /> : null}
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            {lang === "de"
              ? "API-Benutzername, API-Schlüssel und Modus der Verbindung zu Skribble stehen unter „API-Verbindungen“."
              : "Имя API-пользователя, API-ключ и режим подключения к Skribble находятся в разделе «API-подключения»."}
          </p>
          <StaffLink
            to="/admin/api-connections"
            data-testid="api-connections-link"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 rounded-md")}
          >
            <KeySquare aria-hidden="true" className="size-3.5" />
            {t.nav_api_connections}
          </StaffLink>
        </div>
      </section>
    </div>
  );
}
