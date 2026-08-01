import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ClipboardList,
  CornerDownLeft,
  LoaderCircle,
  Magnet,
  Search,
  UsersRound,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { listStaffNavItems } from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";

type PaletteItem = {
  key: string;
  section: "nav" | "patients" | "leads" | "orders";
  label: string;
  hint?: string;
  href: string;
};

type PatientHit = {
  id: string;
  patient_id: string;
  first_name: string | null;
  last_name: string | null;
};

type LeadHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  qualification_status: string;
};

type OrderHit = {
  id: string;
  order_number: string;
  patient_pid: string | null;
  patient_name: string | null;
};

const SEARCH_DEBOUNCE_MS = 250;
const SECTION_LIMIT = 6;

function fullName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

export function CommandPalette() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{
    patients: PatientHit[];
    leads: LeadHit[];
    orders: OrderHit[];
  }>({ patients: [], leads: [], orders: [] });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const isStaff = Boolean(user) && user?.role !== "patient";

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setHits({ patients: [], leads: [], orders: [] });
  }, []);

  // Global hotkey: Ctrl/Cmd+K toggles the palette.
  useEffect(() => {
    if (!isStaff) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isStaff]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Server search across patients / leads / orders (role failures are silent).
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(() => {
      if (trimmed.length < 2) {
        setHits({ patients: [], leads: [], orders: [] });
        setBusy(false);
        return;
      }
      setBusy(true);
      const encoded = encodeURIComponent(trimmed);
      void Promise.all([
        apiFetch<PatientHit[]>(`/patients?search=${encoded}`).catch(() => []),
        apiFetch<LeadHit[]>(`/leads?search=${encoded}`).catch(() => []),
        apiFetch<OrderHit[]>(`/orders?search=${encoded}`).catch(() => []),
      ]).then(([patients, leads, orders]) => {
        if (requestSeq.current !== seq) return;
        setHits({
          patients: (patients ?? []).slice(0, SECTION_LIMIT),
          leads: (leads ?? []).slice(0, SECTION_LIMIT),
          orders: (orders ?? []).slice(0, SECTION_LIMIT),
        });
        setBusy(false);
      });
    }, trimmed.length < 2 ? 0 : SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const navItems = useMemo(() => {
    if (!user || user.role === "patient") return [];
    return listStaffNavItems(user.role).map((item) => ({
      id: item.id,
      to: item.to,
      label: tr[item.labelKey] ?? item.labelKey,
    }));
  }, [tr, user]);

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    const matchingNav = trimmed
      ? navItems.filter((item) => item.label.toLowerCase().includes(trimmed))
      : navItems;
    for (const item of matchingNav.slice(0, trimmed ? 4 : 8)) {
      result.push({
        key: `nav:${item.id}`,
        section: "nav",
        label: item.label,
        href: item.to,
      });
    }
    for (const patient of hits.patients) {
      result.push({
        key: `patient:${patient.id}`,
        section: "patients",
        label: fullName(patient.first_name, patient.last_name) || patient.patient_id,
        hint: patient.patient_id,
        href: `/patients/${patient.id}`,
      });
    }
    for (const lead of hits.leads) {
      result.push({
        key: `lead:${lead.id}`,
        section: "leads",
        label: fullName(lead.first_name, lead.last_name) || lead.id,
        hint: tr[`lead_status_${lead.qualification_status}`] ?? lead.qualification_status,
        href: `/leads?lead=${lead.id}`,
      });
    }
    for (const order of hits.orders) {
      result.push({
        key: `order:${order.id}`,
        section: "orders",
        label: order.order_number,
        hint: [order.patient_pid, order.patient_name].filter(Boolean).join(" · "),
        href: `/orders?order=${order.id}`,
      });
    }
    return result;
  }, [hits, navItems, query, tr]);


  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, items.length - 1));

  const openItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      close();
      staffGo(item.href);
    },
    [close, staffGo],
  );

  if (!isStaff || !open) return null;

  const sectionLabels: Record<PaletteItem["section"], string> = {
    nav: tr.nav_main ?? "Navigation",
    patients: t.patients_title,
    leads: t.leads_title,
    orders: t.orders_title,
  };
  const sectionIcons: Record<PaletteItem["section"], typeof Search> = {
    nav: Search,
    patients: UsersRound,
    leads: Magnet,
    orders: ClipboardList,
  };

  let lastSection: PaletteItem["section"] | null = null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-foreground/25 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex(Math.min(clampedActiveIndex + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex(Math.max(clampedActiveIndex - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                openItem(items[clampedActiveIndex]);
              }
            }}
            placeholder={t.common_search}
            className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <kbd className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Esc
            </kbd>
          )}
        </div>

        <div className="max-h-[46vh] overflow-y-auto overscroll-contain p-1.5">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim().length < 2 ? t.common_search : t.common_no_results}
            </div>
          ) : (
            items.map((item, index) => {
              const SectionIcon = sectionIcons[item.section];
              const showHeader = item.section !== lastSection;
              lastSection = item.section;
              return (
                <div key={item.key}>
                  {showHeader ? (
                    <div className="px-2.5 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                      {sectionLabels[item.section]}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
                      index === clampedActiveIndex
                        ? "bg-[var(--brand)]/10 text-foreground"
                        : "text-foreground hover:bg-muted/60",
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => openItem(item)}
                  >
                    <SectionIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        index === clampedActiveIndex ? "text-[var(--brand)]" : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                      {item.label}
                    </span>
                    {item.hint ? (
                      <span className="shrink-0 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.hint}
                      </span>
                    ) : null}
                    {index === clampedActiveIndex ? (
                      <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
