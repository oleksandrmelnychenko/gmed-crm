import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDatevText } from "./text";

const green = "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:border-emerald-600 focus-visible:ring-emerald-600/30 dark:border-emerald-600 dark:bg-emerald-700 dark:hover:bg-emerald-800 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 h-auto min-h-8 whitespace-normal py-1.5";

/** Every enabled DATEV operation is named, described and confirmed before execution. */
export function DatevActionButton({ title, description, context, contextKey = "", onConfirm, disabled, children, className = "", type = "button", ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "title"> & {
  title: string; description: string; context?: ReactNode; contextKey?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const { lang } = useDatevText(); const de = lang === "de";
  const [pending, setPending] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState(false);
  const lock = useRef(false); const cancel = useRef<HTMLButtonElement>(null);
  const open = pending === contextKey && !disabled;
  return <>
    <Button {...props} type={type} disabled={disabled || working} className={`${green} ${className}`} data-datev-action="true" aria-haspopup="dialog" onClick={(event) => {
      event.preventDefault();
      if (disabled || lock.current) return;
      if (type === "submit" && !event.currentTarget.closest("form")?.reportValidity()) return;
      setFailure(false); setPending(contextKey);
    }}>{children}</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!next) setPending(null); }}>
      <DialogContent className="left-1/2 right-auto top-1/2 bottom-auto w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 sm:max-w-lg" initialFocus={cancel}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {context ? <div className="min-w-0 break-words rounded-md border bg-muted/30 p-3 text-sm">{context}</div> : null}
        <DialogFooter>
          <Button ref={cancel} type="button" variant="outline" onClick={() => setPending(null)}>{de ? "Abbrechen" : "Отмена"}</Button>
          <Button type="button" className={green} disabled={disabled || working} onClick={() => {
            if (disabled || lock.current || pending !== contextKey) return;
            lock.current = true; setWorking(true); setPending(null);
            // Consume the confirmation synchronously; double clicks cannot repeat an operation.
            void Promise.resolve().then(onConfirm).catch(() => setFailure(true)).finally(() => { lock.current = false; setWorking(false); });
          }}>{de ? "DATEV · Bestätigen" : "DATEV · Подтвердить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {failure ? <p role="alert" className="text-sm text-destructive">{de ? "Aktion fehlgeschlagen. Erneut versuchen." : "Не удалось выполнить действие. Повторите попытку."}</p> : null}
  </>;
}
