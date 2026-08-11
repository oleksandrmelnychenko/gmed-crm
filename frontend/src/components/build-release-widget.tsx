import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

import { useLang } from "@/lib/i18n";
import {
  CURRENT_CUSTOMER_RELEASE,
  localizeReleaseText,
} from "@/lib/release-notes";

function releaseDateLabel(value: string, lang: "ru" | "de") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactBuildTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BuildReleaseWidget({ onOpen }: { onOpen?: () => void }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ left: 12, top: 56 });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const release = CURRENT_CUSTOMER_RELEASE;
  const channelLabel = release.channel === "development" ? "DEV" : "PROD";
  const text = lang === "de"
    ? {
        button: "Build",
        dialog: "Build-Inhalt",
        close: "Build-Informationen schließen",
        date: "Erstellt",
      }
    : {
        button: "Билд",
        dialog: "Состав сборки",
        close: "Закрыть информацию о билде",
        date: "Собрано",
      };

  useEffect(() => {
    if (!open) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const positionPanel = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = Math.min(370, window.innerWidth - 24);
      setPanelPosition({
        left: Math.max(12, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 12)),
        top: rect.bottom + 8,
      });
    };

    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      if (!current) onOpen?.();
      return !current;
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        className="flex h-7 items-center gap-1.5 rounded-md bg-[#111111] px-2.5 font-mono text-[10.5px] font-semibold tracking-[0.02em] text-[#789487] transition-colors hover:bg-black hover:text-[#8fa99c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <span>{channelLabel}</span>
        <span aria-hidden="true" className="text-[#566b62]">·</span>
        <span className="hidden uppercase md:inline">{text.button}</span>
        <span className="tracking-normal">{compactBuildTime(release.builtAt)}</span>
      </button>

      {open ? createPortal(
        <section
          ref={panelRef}
          role="dialog"
          aria-label={text.dialog}
          style={{ left: panelPosition.left, top: panelPosition.top }}
          className="fixed z-[70] w-[min(370px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-xl"
        >
          <div className="border-b border-border bg-card px-4 py-3.5 text-foreground">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  <span className="text-[#587363]">{channelLabel}</span>
                  <span aria-hidden="true" className="text-border">·</span>
                  {text.dialog}
                </p>
                <h2 className="mt-1 text-[15px] font-semibold leading-5">
                  {localizeReleaseText(release.title, lang)}
                </h2>
              </div>
              <button
                type="button"
                aria-label={text.close}
                onClick={() => setOpen(false)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
              <span className="font-mono text-foreground">Build {release.build}</span>
              <span aria-hidden="true" className="size-1 rounded-full bg-border" />
              <span>{text.date}: {releaseDateLabel(release.builtAt, lang)}</span>
            </div>
          </div>

          <div className="max-h-[min(540px,calc(100vh-150px))] divide-y divide-border overflow-y-auto overscroll-contain">
            {release.notes.map((note) => (
              <article key={note.commit} className="flex gap-3 px-4 py-3.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[var(--brand)]">
                  <Check aria-hidden="true" className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="text-[12.5px] font-semibold leading-5">
                      {localizeReleaseText(note.title, lang)}
                    </h3>
                    <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground">
                      {note.commit}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-[18px] text-muted-foreground">
                    {localizeReleaseText(note.description, lang)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>,
        document.body,
      ) : null}
    </div>
  );
}
