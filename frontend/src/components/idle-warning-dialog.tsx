import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { useLeadCabinetLang } from "@/pages/patient-lead/lead-cabinet-language";

/** Staff UI (de/ru) and lead cabinet (de/ru/uk/en); anything else reads as Russian. */
export type IdleWarningLang = "de" | "ru" | "uk" | "en" | string;

type IdleWarningText = {
  title: string;
  body: string;
  countdown: (time: string) => string;
  stay: string;
  signOut: string;
};

/** The texts of the dialog (owner wording 2026-10-26). */
export function idleWarningText(lang: IdleWarningLang): IdleWarningText {
  switch (lang) {
    case "de":
      return {
        title: "Sind Sie noch da?",
        body: "In 2 Minuten werden Sie wegen Inaktivität abgemeldet.",
        countdown: (time) => `Abmeldung in ${time}`,
        stay: "Weiterarbeiten",
        signOut: "Abmelden",
      };
    case "uk":
    case "ua":
      return {
        title: "Ви ще тут?",
        body: "Через 2 хвилини ви вийдете із системи через бездіяльність.",
        countdown: (time) => `Вихід через ${time}`,
        stay: "Продовжити роботу",
        signOut: "Вийти",
      };
    case "en":
      return {
        title: "Are you still there?",
        body: "You will be signed out in 2 minutes due to inactivity.",
        countdown: (time) => `Signing out in ${time}`,
        stay: "Continue working",
        signOut: "Sign out",
      };
    default:
      return {
        title: "Вы ещё здесь?",
        body: "Через 2 минуты вы выйдете из системы из-за бездействия.",
        countdown: (time) => `Выход через ${time}`,
        stay: "Продолжить работу",
        signOut: "Выйти",
      };
  }
}

/** Remaining time as m:ss, never below 0:00. */
export function formatIdleCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "Are you still there?" two minutes before the idle sign-out, with a
 * countdown. Closing it any other way than "sign out" counts as continuing.
 */
export function IdleWarningDialog({ deadline, lang, onStay, onSignOut }: {
  /** The sign-out moment; null hides the dialog. */
  deadline: number | null;
  lang: IdleWarningLang;
  onStay: () => void;
  onSignOut: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const text = idleWarningText(lang);
  const open = deadline !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onStay(); }} allowImplicitDismissal>
      <DialogContent showCloseButton={false} data-testid="idle-warning-dialog">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.body}</DialogDescription>
        </DialogHeader>
        <p role="timer" className="text-center text-2xl font-semibold tabular-nums">
          {open ? text.countdown(formatIdleCountdown(deadline - now)) : null}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={onSignOut}>
            {text.signOut}
          </Button>
          <Button type="button" className="h-9 rounded-lg" onClick={onStay} autoFocus>
            {text.stay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog for the signed-in `user`: the lead cabinet speaks its own
 * language (DE, EN, UA, RU), everyone else the console language (DE, RU).
 */
export function SessionIdleWarning({ user, ...props }: {
  user: { id?: string | null; role?: string | null; portal_mode?: string | null; preferred_language?: string | null };
  deadline: number | null;
  onStay: () => void;
  onSignOut: () => void;
}) {
  const { lang } = useLang();
  const cabinetLang = useLeadCabinetLang(user, lang);
  // Not `isLeadPortalUser`: staff-route-access → permissions → auth would close an import cycle.
  const leadCabinet = user.role === "patient" && user.portal_mode === "lead";
  return <IdleWarningDialog {...props} lang={leadCabinet ? cabinetLang : lang} />;
}
