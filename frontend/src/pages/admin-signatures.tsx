import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { SignatureConnectionForm } from "@/pages/documents/ui/signature-connection-dialog";

export function AdminSignaturesPage() {
  const { user } = useAuth();
  const { lang, t } = useLang();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav_signatures}
        description={lang === "de"
          ? "Skribble · Deutschland · Anmeldung und Verbindung mit GMED"
          : "Skribble · Германия · Вход и подключение к GMED"}
      />
      <section className="min-w-0 max-w-3xl" aria-label="Skribble">
        <SignatureConnectionForm canConfigure={user?.role === "ceo" || user?.role === "it_admin"} />
      </section>
    </div>
  );
}
