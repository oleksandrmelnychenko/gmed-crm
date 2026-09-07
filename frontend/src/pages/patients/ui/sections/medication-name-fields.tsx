import { useEffect, useId, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";

import { useOverlayDirtyField } from "@/components/ui/dismissal-guard";
import {
  fetchMedicationNames,
  uniqueMedicationCounterpart,
  type MedicationNameField,
  type MedicationNameSuggestions,
} from "../../data/medication-names";

type NameValues = { handelsname: string; wirkstoff: string | null };
type Search = { field: MedicationNameField; query: string; related?: string };
type Lookup = { key: string; result: MedicationNameSuggestions | null };
const otherField = (field: MedicationNameField): MedicationNameField =>
  field === "handelsname" ? "wirkstoff" : "handelsname";
const nameKey = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();

export function MedicationNameFields({ value, onChange, lang, inputClassName }: {
  value: NameValues;
  onChange: (patch: Partial<NameValues>) => void;
  lang: string;
  inputClassName: string;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const id = useId();
  const [search, setSearch] = useState<Search | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: MedicationNameField; revision: number } | null>(null);
  const latest = useRef(value);
  const revision = useRef(0);
  const alive = useRef(true);
  const inferred = useRef<MedicationNameField | null>(null);
  const committed = useRef<Partial<Record<MedicationNameField, string>>>({});
  const anchor = useRef<{ field: MedicationNameField; value: string } | null>(null);
  const resolving = useRef<AbortController | null>(null);
  const inputs = useRef<Record<MedicationNameField, HTMLInputElement | null>>({ handelsname: null, wirkstoff: null });
  const dirtyBrand = useOverlayDirtyField(value.handelsname);
  const dirtySubstance = useOverlayDirtyField(value.wirkstoff ?? "");
  const searchKey = search ? JSON.stringify(search) : "";

  useEffect(() => { latest.current = value; }, [value]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; resolving.current?.abort(); };
  }, []);
  useEffect(() => {
    if (focusRequest) inputs.current[focusRequest.field]?.focus();
  }, [focusRequest]);
  useEffect(() => {
    if (!searchKey) return;
    const current = JSON.parse(searchKey) as Search;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchMedicationNames(current.field, current.query, current.related, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setLookup({ key: searchKey, result });
        }).catch(() => {
          if (!controller.signal.aborted) setLookup({ key: searchKey, result: null });
        });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchKey]);

  function patchValues(patch: Partial<NameValues>) {
    if (patch.handelsname !== undefined) dirtyBrand(patch.handelsname);
    if (patch.wirkstoff !== undefined) dirtySubstance(patch.wirkstoff ?? "");
    latest.current = { ...latest.current, ...patch };
    onChange(patch);
  }

  function searchFor(field: MedicationNameField, query: string): Search {
    const link = anchor.current;
    return { field, query, ...(link && link.field !== field ? { related: link.value } : {}) };
  }

  function changeName(field: MedicationNameField, next: string) {
    revision.current++;
    resolving.current?.abort();
    delete committed.current[field];
    const opposite = otherField(field);
    const patch: Partial<NameValues> = { [field]: next };
    if (inferred.current === opposite) {
      patch[opposite] = "";
      delete committed.current[opposite];
    }
    inferred.current = null;
    if (anchor.current?.field === field) anchor.current = null;
    patchValues(patch);
    setSearch(searchFor(field, next));
  }

  async function commitName(field: MedicationNameField, name: string, selected = false) {
    const key = nameKey(name);
    if (!key || committed.current[field] === key) return;
    committed.current[field] = key;
    resolving.current?.abort();
    const controller = new AbortController();
    resolving.current = controller;
    const currentRevision = revision.current;
    const opposite = otherField(field);
    const link = anchor.current;
    const choosingLinkedName = link?.field === opposite
      && nameKey(latest.current[opposite] ?? "") === nameKey(link.value);
    if (selected && choosingLinkedName) {
      // The second choice completes a known pair, even for many-to-many names.
      inferred.current = null;
      anchor.current = null;
      setSearch(null);
      return;
    }
    try {
      const result = await fetchMedicationNames(opposite, "", name, controller.signal);
      if (!alive.current || controller.signal.aborted || revision.current !== currentRevision
          || nameKey(latest.current[field] ?? "") !== key) return;
      if (choosingLinkedName && result.items.some((item) => nameKey(item) === nameKey(link.value))) {
        inferred.current = null;
        anchor.current = null;
        setSearch(null);
        return;
      }
      const unique = uniqueMedicationCounterpart(result);
      if (unique !== null) {
        patchValues({ [opposite]: unique });
        inferred.current = opposite;
        committed.current[opposite] = nameKey(unique);
        anchor.current = null;
        setSearch(null);
      } else if (result.items.length > 0 || result.has_more) {
        // A choice in one field never chooses arbitrarily among multiple matches.
        patchValues({ [opposite]: "" });
        delete committed.current[opposite];
        inferred.current = null;
        anchor.current = { field, value: name };
        const nextSearch = { field: opposite, query: "", related: name };
        setLookup({ key: JSON.stringify(nextSearch), result });
        setSearch(nextSearch);
        setFocusRequest({ field: opposite, revision: currentRevision });
      }
    } catch {
      // The medication can still be entered and saved while lookup is unavailable.
      if (!controller.signal.aborted) delete committed.current[field];
    }
  }

  const ready = lookup?.key === searchKey;
  const result = ready ? lookup?.result : undefined;
  const items = result?.items ?? [];

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {(["handelsname", "wirkstoff"] as const).map((field) => {
        const label = field === "handelsname" ? tx("Торговое название", "Handelsname") : tx("Действующее вещество", "Wirkstoff");
        const open = search?.field === field;
        return (
          <div key={field} className="min-w-0">
            <label htmlFor={`${id}-${field}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {label}{field === "wirkstoff" ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
            </label>
            <Autocomplete.Root<string>
              value={value[field] ?? ""}
              items={open ? items : []}
              filter={null}
              modal={false}
              open={open}
              openOnInputClick
              onOpenChange={(nextOpen) => {
                if (nextOpen) setSearch((current) => current?.field === field ? current : searchFor(field, latest.current[field] ?? ""));
                else setSearch((current) => current?.field === field ? null : current);
              }}
              onValueChange={(next, details) => {
                changeName(field, next);
                if (details.reason === "item-press") void commitName(field, next, true);
              }}
            >
              <Autocomplete.Input
                id={`${id}-${field}`}
                aria-label={label}
                ref={(node) => { inputs.current[field] = node; }}
                required={field === "wirkstoff"}
                className={inputClassName}
                autoComplete="off"
                onFocus={() => setSearch((current) => current?.field === field ? current : searchFor(field, latest.current[field] ?? ""))}
                onBlur={() => { void commitName(field, latest.current[field] ?? ""); }}
                onKeyDownCapture={(event) => {
                  if (event.key === "Escape" && open) {
                    event.preventDefault();
                    event.stopPropagation();
                    setSearch(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.currentTarget.getAttribute("aria-activedescendant")) {
                    event.preventDefault();
                    void commitName(field, latest.current[field] ?? "");
                  }
                }}
              />
              <Autocomplete.Portal>
                <Autocomplete.Positioner align="start" sideOffset={4} className="isolate z-[150]" data-overlay-interaction-root="">
                  <Autocomplete.Popup data-overlay-interaction-root="" className="w-(--anchor-width) max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
                    <Autocomplete.List className="max-h-60 overflow-y-auto p-1">
                      {(item: string) => <Autocomplete.Item key={item} value={item} className="cursor-pointer rounded-md px-3 py-2 text-sm break-words outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">{item}</Autocomplete.Item>}
                    </Autocomplete.List>
                    {!items.length ? <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
                      {!ready ? tx("Поиск…", "Suche…") : !result
                        ? tx("Подсказки недоступны. Введите название вручную.", "Vorschläge nicht verfügbar. Namen manuell eingeben.")
                        : tx("Нет сохранённых названий. Можно ввести новое.", "Keine gespeicherten Namen. Neue Eingabe möglich.")}
                    </div> : null}
                    {result?.has_more ? <div className="border-t px-3 py-2 text-xs text-muted-foreground">{tx("Продолжите ввод, чтобы уточнить список.", "Weiter tippen, um die Auswahl einzugrenzen.")}</div> : null}
                  </Autocomplete.Popup>
                </Autocomplete.Positioner>
              </Autocomplete.Portal>
            </Autocomplete.Root>
          </div>
        );
      })}
    </div>
  );
}
