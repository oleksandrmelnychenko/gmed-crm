import { useEffect, useState } from "react";
import { ExternalLink, FileText, FileSignature, LoaderCircle, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/* ─────────── Documents ─────────── */

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
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] gap-0">
        <SheetHeader className="px-4 py-3 flex-row items-center justify-between">
          <SheetTitle className="inline-flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            {l("Dokumente", "Документы", "Documents")}
          </SheetTitle>
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
            {l("Vollansicht", "Открыть раздел", "Full view")}
            <ExternalLink className="size-3" />
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {busy ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <EmptyBlock text={l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")} />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => {
                    onOpenChange(false);
                    staffGo(`/documents?patient=${patientId}&document=${item.id}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {item.filename}
                    </p>
                    {item.status ? (
                      <Badge variant="outline" className="rounded-full text-[10px] shrink-0">
                        {item.status}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground truncate">
                    {formatDate(item.created_at)}
                    {item.category ? ` · ${item.category}` : ""}
                    {item.uploaded_by_name ? ` · ${item.uploaded_by_name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─────────── Contracts ─────────── */

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
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] gap-0">
        <SheetHeader className="px-4 py-3 flex-row items-center justify-between">
          <SheetTitle className="inline-flex items-center gap-2">
            <FileSignature className="size-4 text-muted-foreground" />
            {l("Verträge", "Договоры", "Contracts")}
          </SheetTitle>
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
            {l("Vollansicht", "Открыть раздел", "Full view")}
            <ExternalLink className="size-3" />
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {busy ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <EmptyBlock text={l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")} />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => {
                    onOpenChange(false);
                    staffGo(`/contracts?patient=${patientId}&contract=${item.id}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground truncate font-mono">
                      {item.contract_number}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px] shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {item.signed_at
                      ? `${l("signiert", "подписан", "signed")} ${formatDate(item.signed_at)}`
                      : formatDate(item.created_at)}
                    {item.valid_from ? ` · ${formatDate(item.valid_from)}—${formatDate(item.valid_to)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─────────── Invoices ─────────── */

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
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] gap-0">
        <SheetHeader className="px-4 py-3 flex-row items-center justify-between">
          <SheetTitle className="inline-flex items-center gap-2">
            <ReceiptText className="size-4 text-muted-foreground" />
            {l("Rechnungen", "Счета", "Invoices")}
          </SheetTitle>
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
            {l("Vollansicht", "Открыть раздел", "Full view")}
            <ExternalLink className="size-3" />
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {busy ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <EmptyBlock text={l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")} />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => {
                    onOpenChange(false);
                    staffGo(`/invoices?patient=${patientId}&invoice=${item.id}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground font-mono">
                      {item.invoice_number}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px] shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {formatDate(item.issued_at)}
                    {item.total_gross ? ` · € ${item.total_gross}` : ""}
                    {item.balance_due && item.balance_due !== "0.00"
                      ? ` · ${l("offen", "остаток", "due")} € ${item.balance_due}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
      <LoaderCircle className="size-4 mr-2 animate-spin" />
      Loading…
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
