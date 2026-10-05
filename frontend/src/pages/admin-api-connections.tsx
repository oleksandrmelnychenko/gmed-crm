import { FileSignature, Mail } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SignatureConnectionForm } from "@/pages/documents/ui/signature-connection-dialog";
import { SignatureDefaultsSettings } from "@/pages/documents/ui/signature-defaults-settings";

type ApiTab = "signature" | "email";

/**
 * API connections: the one menu item for external services (owner decision
 * 2026-10-05). One tab per service: the electronic signature (Skribble access
 * and who signs for GMED) and the outgoing e-mail (Mittaro).
 */
export function AdminApiConnectionsPage() {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const [params, setParams] = useSearchParams();
  const tab: ApiTab = params.get("tab") === "email" ? "email" : "signature";
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const admin = user?.role === "ceo" || user?.role === "it_admin";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav_api_connections}
        description={tx(
          "Доступ к внешним сервисам: электронная подпись и e-mail",
          "Zugänge zu externen Diensten: elektronische Signatur und E-Mail",
        )}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setParams(value === "email" ? { tab: "email" } : {}, { replace: true })}
        className="min-w-0 max-w-3xl gap-3"
      >
        <TabsList className="h-auto w-max max-w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-0">
          {([
            ["signature", FileSignature, tx("Электронная подпись · Skribble", "Elektronische Signatur · Skribble")],
            ["email", Mail, "E-Mail · Mittaro"],
          ] as const).map(([value, Icon, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                buttonVariants({ variant: tab === value ? "default" : "ghost", size: "sm" }),
                "h-9 min-w-0 rounded-md px-3 text-xs text-foreground data-active:!bg-primary data-active:!text-primary-foreground data-active:shadow-none sm:h-8",
              )}
            >
              <Icon />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="signature" className="grid min-w-0 gap-3">
          <SignatureConnectionForm canConfigure={admin} />
          {admin ? <SignatureDefaultsSettings /> : null}
        </TabsContent>

        <TabsContent value="email" className="grid min-w-0 gap-3">
          {/* The key of the mail service still lives in the server
              configuration (GMED_MITTARO_API_KEY, GMED_MAIL_FROM); this block
              becomes its form once the mailer reads a stored connection. */}
          <section
            className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card"
            data-testid="mail-connection"
          >
            <div className="border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
              <AdminSectionTitle>{tx("Подключение Mittaro", "Mittaro-Verbindung")}</AdminSectionTitle>
            </div>
            <div className="space-y-2 p-3.5 text-xs leading-5 text-muted-foreground">
              <p>
                {tx(
                  "Письма из системы отправляются через Mittaro — сервис транзакционных писем с серверами в Германии.",
                  "E-Mails aus dem System werden über Mittaro versendet – einen Dienst für Transaktions-E-Mails mit Servern in Deutschland.",
                )}
              </p>
              <p>
                {tx(
                  "API-ключ и адрес отправителя пока задаются в конфигурации сервера. Ввод ключа и тестовое письмо на этой вкладке появятся следующим обновлением.",
                  "API-Schlüssel und Absenderadresse stehen vorerst in der Serverkonfiguration. Eingabe des Schlüssels und Test-E-Mail folgen auf diesem Reiter mit dem nächsten Update.",
                )}
              </p>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
