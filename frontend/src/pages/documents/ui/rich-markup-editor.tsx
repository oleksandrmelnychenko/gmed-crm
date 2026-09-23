import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Eraser, Heading2, List, ListOrdered, Pilcrow, Redo2, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { htmlToMarkup, markupToHtml } from "./translation-markup";

type Props = {
  value: string;
  onChange: (markup: string) => void;
  lang?: string;
  placeholder?: string;
  labels: {
    toolbar: string;
    bold: string;
    heading: string;
    bullet: string;
    numbered: string;
    paragraph: string;
    clear: string;
    undo: string;
    redo: string;
  };
  className?: string;
};

type ActiveState = { bold: boolean; heading: boolean; bullet: boolean; numbered: boolean };

const INACTIVE: ActiveState = { bold: false, heading: false, bullet: false, numbered: false };

/**
 * Visual editor for translation drafts. What the reviewer sees (bold,
 * headings, lists, paragraphs) is stored as the line markup the PDF renderer
 * reads, so the saved PDF looks like the editor.
 *
 * Built on contentEditable with the browser's editing commands instead of a
 * third-party editor: the markup is small and fixed, and the commands give
 * native undo, Ctrl+B and IME support.
 */
export function RichMarkupEditor({ value, onChange, lang, placeholder, labels, className }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastMarkup = useRef<string | null>(null);
  const [active, setActive] = useState<ActiveState>(INACTIVE);
  const [focused, setFocused] = useState(false);

  // External value changes (a machine draft, a loaded translation) replace the
  // content; the editor's own edits come back through onChange unchanged.
  useEffect(() => {
    const element = editorRef.current;
    if (!element || value === lastMarkup.current) return;
    element.innerHTML = markupToHtml(value);
    lastMarkup.current = value;
  }, [value]);

  const emit = useCallback(() => {
    const element = editorRef.current;
    if (!element) return;
    const markup = htmlToMarkup(element);
    if (markup === lastMarkup.current) return;
    lastMarkup.current = markup;
    onChange(markup);
  }, [onChange]);

  const refreshActive = useCallback(() => {
    const element = editorRef.current;
    const selection = document.getSelection();
    if (!element || !selection?.anchorNode || !element.contains(selection.anchorNode)) {
      setActive(INACTIVE);
      return;
    }
    const block = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    setActive({
      bold: document.queryCommandState("bold"),
      heading: /^h[1-6]$/.test(block),
      bullet: document.queryCommandState("insertUnorderedList"),
      numbered: document.queryCommandState("insertOrderedList"),
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshActive);
    return () => document.removeEventListener("selectionchange", refreshActive);
  }, [refreshActive]);

  const run = (command: string, argument?: string) => {
    const element = editorRef.current;
    if (!element) return;
    element.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand(command, false, argument);
    emit();
    refreshActive();
  };

  const toggleHeading = () => run("formatBlock", active.heading ? "p" : "h3");

  const clearFormatting = () => {
    run("removeFormat");
    if (active.bullet) run("insertUnorderedList");
    if (active.numbered) run("insertOrderedList");
    run("formatBlock", "p");
  };

  const button = (label: string, pressed: boolean | undefined, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // Keep the selection in the editor while clicking the toolbar.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-950",
        pressed && "bg-white text-[var(--brand)] shadow-sm ring-1 ring-border",
      )}
    >
      {icon}
    </button>
  );

  const empty = !value.trim();

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-input bg-field transition",
        focused && "border-ring ring-2 ring-ring/30",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-slate-50 p-1" role="toolbar" aria-label={labels.toolbar}>
        {button(labels.bold, active.bold, () => run("bold"), <Bold className="size-4" />)}
        {button(labels.heading, active.heading, toggleHeading, <Heading2 className="size-4" />)}
        {button(labels.bullet, active.bullet, () => run("insertUnorderedList"), <List className="size-4" />)}
        {button(labels.numbered, active.numbered, () => run("insertOrderedList"), <ListOrdered className="size-4" />)}
        {button(labels.paragraph, undefined, () => run("formatBlock", "p"), <Pilcrow className="size-4" />)}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {button(labels.clear, undefined, clearFormatting, <Eraser className="size-4" />)}
        {button(labels.undo, undefined, () => run("undo"), <Undo2 className="size-4" />)}
        {button(labels.redo, undefined, () => run("redo"), <Redo2 className="size-4" />)}
      </div>
      <div className="relative min-h-[360px] flex-1 overflow-auto">
        {empty && placeholder ? (
          <p className="pointer-events-none absolute left-4 top-3 text-[15px] leading-7 text-muted-foreground/70">{placeholder}</p>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={labels.toolbar}
          lang={lang}
          contentEditable
          suppressContentEditableWarning
          data-testid="translation-rich-editor"
          className={cn(
            "min-h-[360px] px-4 py-3 text-[15px] leading-7 text-foreground outline-none",
            "[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[17px] [&_h3]:font-semibold",
            "[&_p]:min-h-7 [&_strong]:font-semibold [&_b]:font-semibold",
            "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6",
          )}
          onInput={emit}
          onBlur={() => {
            setFocused(false);
            emit();
          }}
          onFocus={() => setFocused(true)}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={(event) => {
            // Pasted Word/PDF formatting would not survive the PDF renderer;
            // keep the text and let the toolbar add the formatting.
            event.preventDefault();
            const pasted = event.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, pasted);
            emit();
          }}
        />
      </div>
    </div>
  );
}
