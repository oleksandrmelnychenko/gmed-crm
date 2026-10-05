import { FileSignature, Mail } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SignatureConnectionForm } from "@/pages/documents/ui/signature-connection-dialog";
import { SignatureDefaultsSettings } from "@/pages/documents/ui/signature-defaults-settings";
import { MailConnectionForm } from "@/pages/admin/ui/mail-connection-form";

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
          <MailConnectionForm canConfigure={admin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
