import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { SignatureConnectionForm } from "@/pages/documents/ui/signature-connection-dialog";

/**
 * API connections: the one place where access keys of external services are
 * entered (owner request 2026-10-05). Today that is the signature provider;
 * each further service gets its own block here.
 */
export function AdminApiConnectionsPage() {
  const { user } = useAuth();
  const { lang, t } = useLang();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav_api_connections}
        description={lang === "de"
          ? "Zugangsschlüssel externer Dienste · Skribble (elektronische Signatur)"
          : "Ключи доступа к внешним сервисам · Skribble (электронная подпись)"}
      />
      <section className="grid min-w-0 max-w-3xl gap-3" aria-label="Skribble">
        <SignatureConnectionForm canConfigure={user?.role === "ceo" || user?.role === "it_admin"} />
      </section>
    </div>
  );
}
