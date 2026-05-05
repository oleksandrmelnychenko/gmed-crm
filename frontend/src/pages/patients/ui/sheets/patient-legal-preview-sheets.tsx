import { useEffect, useState } from "react";
import { ExternalLink, FileSignature, FileText, LoaderCircle, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import {
  documentCategoryLabel,
  formatPortalCurrency,
  invoiceTypeLabel,
  portalStatusLabel,
} from "../../model/portal-shared";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

function formatDate(value?: string | null, lang = "ru") {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

type DocumentItem = {
  id: string;
  filename: string;
  category?: string | null;
  status?: string | null;
  uploaded_by_name?: string | null;
  created_at: string;
};

export function PatientDocumentsPreviewSheet({
  patientId,
  open,
  onOpenChange,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [items, setItems] = useState<DocumentItem[] | null>(null);
  const busy = items === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<DocumentItem[]>(`/patients/${patientId}/documents`)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="narrow"
      title={
        <span className="inline-flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          {t.patient_preview_documents_title}
        </span>
      }
      bodyClassName="px-4 py-3 space-y-3"
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-lg gap-1 text-[12px] text-muted-foreground"
          onClick={() => {
            onOpenChange(false);
            staffGo(`/documents?patient=${patientId}`);
          }}
        >
          {t.patient_preview_full_view}
          <ExternalLink className="size-3" />
        </Button>
      </div>

      {busy ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyBlock text={t.patient_preview_not_recorded} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="cursor-pointer rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40"
              onClick={() => {
                onOpenChange(false);
                staffGo(`/documents?patient=${patientId}&document=${item.id}`);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {item.filename}
                </p>
                {item.status ? (
                  <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                    {portalStatusLabel(item.status)}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {formatDate(item.created_at, lang)}
                {item.category ? ` | ${documentCategoryLabel(item.category)}` : ""}
                {item.uploaded_by_name ? ` | ${item.uploaded_by_name}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PatientSheetScaffold>
  );
}

type ContractItem = {
  id: string;
  contract_number: string;
  status: string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at: string;
};

export function PatientContractsPreviewSheet({
  patientId,
  open,
  onOpenChange,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [items, setItems] = useState<ContractItem[] | null>(null);
  const busy = items === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<ContractItem[]>(`/patients/${patientId}/framework-contracts`)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="narrow"
      title={
        <span className="inline-flex items-center gap-2">
          <FileSignature className="size-4 text-muted-foreground" />
          {t.patient_preview_contracts_title}
        </span>
      }
      bodyClassName="px-4 py-3 space-y-3"
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-lg gap-1 text-[12px] text-muted-foreground"
          onClick={() => {
            onOpenChange(false);
            staffGo(`/contracts?patient=${patientId}`);
          }}
        >
          {t.patient_preview_full_view}
          <ExternalLink className="size-3" />
        </Button>
      </div>

      {busy ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyBlock text={t.patient_preview_not_recorded} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="cursor-pointer rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40"
              onClick={() => {
                onOpenChange(false);
                staffGo(`/contracts?patient=${patientId}&contract=${item.id}`);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="truncate font-mono text-[13px] font-medium text-foreground">
                  {item.contract_number}
                </p>
                <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                  {portalStatusLabel(item.status)}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {item.signed_at
                  ? `${t.patient_preview_signed} ${formatDate(item.signed_at, lang)}`
                  : formatDate(item.created_at, lang)}
                {item.valid_from ? ` | ${formatDate(item.valid_from, lang)}-${formatDate(item.valid_to, lang)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PatientSheetScaffold>
  );
}

type InvoiceItem = {
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issued_at: string;
  due_date?: string | null;
  total_gross?: string | null;
  balance_due?: string | null;
};

export function PatientInvoicesPreviewSheet({
  patientId,
  open,
  onOpenChange,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [items, setItems] = useState<InvoiceItem[] | null>(null);
  const busy = items === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<InvoiceItem[]>(`/patients/${patientId}/invoices`)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="narrow"
      title={
        <span className="inline-flex items-center gap-2">
          <ReceiptText className="size-4 text-muted-foreground" />
          {t.patient_preview_invoices_title}
        </span>
      }
      bodyClassName="px-4 py-3 space-y-3"
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-lg gap-1 text-[12px] text-muted-foreground"
          onClick={() => {
            onOpenChange(false);
            staffGo(`/invoices?patient=${patientId}`);
          }}
        >
          {t.patient_preview_full_view}
          <ExternalLink className="size-3" />
        </Button>
      </div>

      {busy ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyBlock text={t.patient_preview_not_recorded} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="cursor-pointer rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40"
              onClick={() => {
                onOpenChange(false);
                staffGo(`/invoices?patient=${patientId}&invoice=${item.id}`);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-[13px] font-medium text-foreground">
                  {item.invoice_number}
                </p>
                <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                  {portalStatusLabel(item.status)}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {formatDate(item.issued_at, lang)}
                {item.invoice_type ? ` | ${invoiceTypeLabel(item.invoice_type)}` : ""}
                {item.total_gross ? ` | ${formatPortalCurrency(item.total_gross)}` : ""}
                {item.balance_due && item.balance_due !== "0.00"
                  ? ` | ${t.patient_preview_due} ${formatPortalCurrency(item.balance_due)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PatientSheetScaffold>
  );
}

function LoadingBlock() {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      {t.patient_preview_loading}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
