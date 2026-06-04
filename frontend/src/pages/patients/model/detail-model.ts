import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";

export type PatientTimelineItem = {
  entity_type: string;
  entity_id: string;
  title: string;
  category: string;
  status: string;
  happened_at: string;
  source_label?: string | null;
};

export type PatientTimelineSummary = {
  total: number;
  open: number;
  recent: number;
  entityCounts: Array<{ entityType: string; count: number }>;
};

export type PatientLabelFormatId =
  | "compact-90x48"
  | "standard-105x74"
  | "sheet-70x37";

export type PatientLabelFormat = {
  id: PatientLabelFormatId;
  labelKey: string;
  width_mm: number;
  height_mm: number;
};

export type PatientLabelPayload = {
  patient_id: string;
  title?: string | null;
  salutation: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  country_code?: string | null;
  insurance_provider?: string | null;
  agency: {
    name: string;
    care_of: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  format: PatientLabelFormat;
  available_formats?: PatientLabelFormat[];
  generated_at: string;
};

export type PatientTimelineRangeFilter = "all" | "30d" | "90d" | "180d" | "365d";

const PATIENT_RELATION_TYPE_LABEL_KEYS = {
  caregiver: "patient_relation_type_caregiver",
  child: "patient_relation_type_child",
  friend: "patient_relation_type_friend",
  guardian: "patient_relation_type_guardian",
  other: "patient_relation_type_other",
  parent: "patient_relation_type_parent",
  relative: "patient_relation_type_relative",
  sibling: "patient_relation_type_sibling",
  spouse: "patient_relation_type_spouse",
} satisfies Partial<Record<string, TranslationKey>>;

export function patientRelationTypeLabel(value?: string | null) {
  return formatEnumLabelFromKeys(
    value,
    PATIENT_RELATION_TYPE_LABEL_KEYS,
    translateCatalog(getLang()),
  );
}

type PatientTimelineNavigationAccess = {
  patientId?: string | null;
  canOpenDocumentsWorkspace: boolean;
  canViewContracts: boolean;
  canViewInvoices: boolean;
  canOpenComplianceWorkspace: boolean;
};

type PatientTabAccess = {
  canViewOperationalSurface: boolean;
  canViewDocuments: boolean;
  canViewContracts: boolean;
  canViewInvoices: boolean;
};

type PatientTimelineFilters = {
  entityFilter: string;
  categoryFilter: string;
  sourceFilter: string;
  search: string;
  rangeFilter: PatientTimelineRangeFilter;
  now?: Date;
};

const TIMELINE_CLOSED_STATUSES = new Set([
  "closed",
  "completed",
  "paid",
  "signed",
  "archived",
  "cancelled",
  "expired",
  "terminated",
]);

const TIMELINE_RANGE_DAYS: Record<Exclude<PatientTimelineRangeFilter, "all">, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

const PATIENT_OPERATIONAL_SURFACE_ROLES = new Set([
  "ceo",
  "patient_manager",
  "billing",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "it_admin",
]);

const PATIENT_DOCUMENT_WORKSPACE_ROLES = new Set([
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "it_admin",
]);

const PATIENT_CONTRACT_SURFACE_ROLES = new Set([
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
  "it_admin",
]);

const PATIENT_INVOICE_SURFACE_ROLES = PATIENT_CONTRACT_SURFACE_ROLES;
const PATIENT_OPERATIONAL_TAB_KEYS = new Set([
  "relations",
  "cases",
  "orders",
  "appointments",
  "clinical",
  "workflow",
  "curators",
  "timeline",
]);

const PATIENT_LABEL_BIRTH_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const DEFAULT_PATIENT_LABEL_FORMAT_ID: PatientLabelFormatId = "compact-90x48";

export const PATIENT_LABEL_FORMAT_OPTIONS: PatientLabelFormat[] = [
  {
    id: "compact-90x48",
    labelKey: "patients_label_format_compact_90x48",
    width_mm: 90,
    height_mm: 48,
  },
  {
    id: "standard-105x74",
    labelKey: "patients_label_format_standard_105x74",
    width_mm: 105,
    height_mm: 74,
  },
  {
    id: "sheet-70x37",
    labelKey: "patients_label_format_sheet_70x37",
    width_mm: 70,
    height_mm: 37,
  },
];

export function patientLabelFormatLabel(format: PatientLabelFormat) {
  const tr = translateCatalog(getLang());
  return tr.uiText[format.labelKey] ?? format.labelKey;
}

export function canViewPatientOperationalSurface(role?: string) {
  return PATIENT_OPERATIONAL_SURFACE_ROLES.has(role ?? "");
}

export function canViewPatientDocumentsSurface(role?: string) {
  return canViewPatientOperationalSurface(role);
}

export function canOpenPatientDocumentsWorkspace(role?: string) {
  return PATIENT_DOCUMENT_WORKSPACE_ROLES.has(role ?? "");
}

export function canViewPatientContractsSurface(role?: string) {
  return PATIENT_CONTRACT_SURFACE_ROLES.has(role ?? "");
}

export function canViewPatientInvoicesSurface(role?: string) {
  return PATIENT_INVOICE_SURFACE_ROLES.has(role ?? "");
}

export function normalizePatientDetailTab(tab: string | null | undefined, access: PatientTabAccess) {
  const requestedTab = (tab ?? "profile").trim() || "profile";
  if (PATIENT_OPERATIONAL_TAB_KEYS.has(requestedTab) && !access.canViewOperationalSurface) {
    return "profile";
  }
  if (requestedTab === "documents" && !access.canViewDocuments) {
    return "profile";
  }
  if (requestedTab === "contracts" && !access.canViewContracts) {
    return "profile";
  }
  if (requestedTab === "invoices" && !access.canViewInvoices) {
    return "profile";
  }
  return requestedTab;
}

export function resolvePatientTimelineRoute(
  item: Pick<PatientTimelineItem, "entity_type" | "entity_id">,
  access: PatientTimelineNavigationAccess
) {
  switch (item.entity_type) {
    case "case":
      if (access.patientId) {
        return `/cases/${item.entity_id}?patient=${access.patientId}`;
      }
      return `/cases?case=${item.entity_id}`;
    case "order":
      if (access.patientId) {
        return `/orders/${item.entity_id}?patient=${access.patientId}`;
      }
      return `/orders?order=${item.entity_id}`;
    case "appointment":
      return `/appointments?appointment=${item.entity_id}`;
    case "document":
      return access.canOpenDocumentsWorkspace ? `/documents?document=${item.entity_id}` : null;
    case "contract":
      return access.canViewContracts ? `/contracts?contract=${item.entity_id}` : null;
    case "invoice":
      return access.canViewInvoices ? `/invoices?invoice=${item.entity_id}` : null;
    case "invoice_visibility":
      return access.canViewInvoices ? `/invoices?invoice=${item.entity_id}` : null;
    case "service_package":
    case "service_package_consumption":
    case "service_package_change":
      return access.patientId && access.canViewInvoices
        ? `/patients/${access.patientId}?tab=invoices`
        : null;
    case "interpreter_preference":
      return access.patientId
        ? `/patients/${access.patientId}?tab=appointments`
        : null;
    case "drug_verification":
      return access.patientId
        ? `/patients/${access.patientId}?tab=timeline&entity_type=drug_verification`
        : null;
    case "recommendation":
      return access.patientId
        ? `/patients/${access.patientId}?tab=timeline&entity_type=recommendation`
        : null;
    case "translation_request":
      return access.patientId && access.canOpenDocumentsWorkspace
        ? `/patients/${access.patientId}?tab=documents`
        : null;
    case "service_group":
      return access.patientId
        ? `/patients/${access.patientId}?tab=orders`
        : null;
    case "compliance":
      return access.canOpenComplianceWorkspace ? "/admin/compliance" : null;
    default:
      return null;
  }
}

export function filterPatientTimelineItems(
  items: PatientTimelineItem[],
  filters: PatientTimelineFilters
) {
  const {
    entityFilter,
    categoryFilter,
    sourceFilter,
    search,
    rangeFilter,
    now = new Date(),
  } = filters;
  const normalizedSearch = search.trim().toLowerCase();
  const normalizedSourceFilter = sourceFilter.trim().toLowerCase();
  const rangeCutoff =
    rangeFilter === "all"
      ? null
      : now.getTime() - TIMELINE_RANGE_DAYS[rangeFilter] * 24 * 60 * 60 * 1000;

  return items.filter((item) => {
    if (entityFilter !== "all" && item.entity_type !== entityFilter) {
      return false;
    }

    if (categoryFilter !== "all" && item.category !== categoryFilter) {
      return false;
    }

    if (normalizedSourceFilter && (item.source_label ?? "").toLowerCase() !== normalizedSourceFilter) {
      return false;
    }

    if (rangeCutoff !== null) {
      const happenedAt = Date.parse(item.happened_at);
      if (Number.isNaN(happenedAt) || happenedAt < rangeCutoff) {
        return false;
      }
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      item.title,
      item.category,
      item.status,
      item.entity_type,
      item.source_label ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });
}

export function buildPatientTimelineSummary(
  items: PatientTimelineItem[],
  now: Date = new Date()
): PatientTimelineSummary {
  const entityCountsMap = new Map<string, number>();
  const recentCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let open = 0;
  let recent = 0;

  for (const item of items) {
    entityCountsMap.set(item.entity_type, (entityCountsMap.get(item.entity_type) ?? 0) + 1);

    if (!TIMELINE_CLOSED_STATUSES.has(item.status)) {
      open += 1;
    }

    const happenedAt = Date.parse(item.happened_at);
    if (!Number.isNaN(happenedAt) && happenedAt >= recentCutoff) {
      recent += 1;
    }
  }

  return {
    total: items.length,
    open,
    recent,
    entityCounts: [...entityCountsMap.entries()]
      .map(([entityType, count]) => ({ entityType, count }))
      .toSorted((left, right) => right.count - left.count || left.entityType.localeCompare(right.entityType)),
  };
}

export function formatRelatedPatientOption(option: {
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  const name = formatRelatedPatientName(option);
  return name ? `${option.patient_id} · ${name}` : option.patient_id;
}

export function formatRelatedPatientName(option: {
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  const name = [option.title, option.first_name, option.last_name]
    .filter((value) => Boolean(value && value.trim()))
    .join(" ")
    .trim();
  return name || option.patient_id;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPrintValue(value?: string | null, fallback?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : fallback ?? translateCatalog(getLang()).common_not_set;
}

function formatPatientLabelBirthDate(value: string) {
  try {
    return PATIENT_LABEL_BIRTH_DATE_FORMATTER.format(
      new Date(value.includes("T") ? value : `${value}T00:00:00`),
    );
  } catch {
    return value;
  }
}

function resolvePatientLabelFormat(formatId: string): PatientLabelFormat {
  return (
    PATIENT_LABEL_FORMAT_OPTIONS.find((option) => option.id === formatId) ??
    PATIENT_LABEL_FORMAT_OPTIONS[0]
  );
}

export function buildPatientLabelPrintHtml(payload: PatientLabelPayload) {
  const lang = getLang();
  const tr = translateCatalog(lang);
  const format = resolvePatientLabelFormat(payload.format?.id ?? DEFAULT_PATIENT_LABEL_FORMAT_ID);
  const labelWidth = Math.max(format.width_mm - 10, 48);
  const labelHeight = Math.max(format.height_mm - 10, 24);
  const titleLine = [payload.salutation, payload.title, payload.first_name, payload.last_name]
    .filter((value) => Boolean(value && value.trim()))
    .join(" ");
  const birthDateLine = payload.birth_date
    ? `${tr.patient_label_print_dob} ${formatPatientLabelBirthDate(payload.birth_date)}`
    : "";
  const metaLine = [
    birthDateLine,
    payload.country_code ? `${tr.patient_label_print_country} ${payload.country_code}` : "",
    payload.insurance_provider
      ? `${tr.patient_label_print_insurance} ${payload.insurance_provider}`
      : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const agencyLine = [
    payload.agency.care_of || payload.agency.name,
    payload.agency.address,
    payload.agency.phone,
    payload.agency.email,
  ]
    .filter((value) => Boolean(value && value.trim()))
    .join("  ·  ");
  const footerLine = `${tr.patient_label_print_generated} ${formatPrintValue(payload.generated_at, new Date().toISOString())}`;
  const documentTitle = tr.patient_label_print_browser_title.replace(
    "{patientId}",
    payload.patient_id,
  );

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>
      @page {
        size: ${format.width_mm}mm ${format.height_mm}mm;
        margin: 5mm;
      }

      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: 100%;
        background: #f3f4f6;
        font-family: "Onest Variable", sans-serif;
        color: #0f172a;
      }

      body {
        display: grid;
        place-items: center;
        padding: 6mm;
      }

      .label {
        width: ${labelWidth}mm;
        min-height: ${labelHeight}mm;
        border: 1px solid #cbd5e1;
        border-radius: 4mm;
        background:
          radial-gradient(circle at top right, rgba(15, 23, 42, 0.06), transparent 42%),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        padding: 4mm;
        display: grid;
        gap: 2.2mm;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
      }

      .eyebrow {
        font-size: 8pt;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #475569;
      }

      .patient-id {
        font-size: 12pt;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .name {
        font-size: ${format.height_mm <= 40 ? "11.5pt" : "14pt"};
        font-weight: 700;
        line-height: 1.15;
      }

      .meta,
      .agency,
      .footer {
        font-size: ${format.height_mm <= 40 ? "7.5pt" : "8.5pt"};
        line-height: 1.35;
        color: #334155;
      }

      .footer {
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <article class="label">
      <div class="eyebrow">${escapeHtml(patientLabelFormatLabel(format))}</div>
      <div class="patient-id">${escapeHtml(payload.patient_id)}</div>
      <div class="name">${escapeHtml(titleLine || payload.patient_id)}</div>
      <div class="meta">${escapeHtml(metaLine || tr.patient_label_print_dob_not_set)}</div>
      <div class="agency">${escapeHtml(agencyLine || payload.agency.name || tr.patient_label_print_agency_not_configured)}</div>
      <div class="footer">${escapeHtml(footerLine)}</div>
    </article>
    <script>
      window.addEventListener("load", function () {
        window.setTimeout(function () {
          window.focus();
          window.print();
        }, 80);
      });
    </script>
  </body>
</html>`;
}
