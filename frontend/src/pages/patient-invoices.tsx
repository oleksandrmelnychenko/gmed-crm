import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Download, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import {
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceStatusTone,
  invoiceTypeTone,
  downloadPortalInvoicePdf,
  openPortalInvoicePdf,
} from "@/pages/patient-portal.shared";
import type { PortalInvoiceItem, PortalInvoiceLineItem } from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn("rounded-[1.75rem] border border-slate-200 bg-white shadow-sm", extra);
}

export function PatientInvoicesPage() {
  const [invoices, setInvoices] = useState<PortalInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [detail, setDetail] = useState<PortalInvoiceItem | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await apiFetch<PortalInvoiceItem[]>("/me/invoices");
        if (cancelled) return;
        startTransition(() => {
          setInvoices(rows);
          setError("");
          if (rows.length === 0) {
            setSelectedInvoiceId("");
          } else if (!rows.some((item) => item.id === selectedInvoiceId)) {
            setSelectedInvoiceId(rows[0]?.id ?? "");
          }
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load invoices.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loading, selectedInvoiceId, version]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setDetail(null);
      setDetailError("");
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      setDetailBusy(true);
      try {
        const invoice = await apiFetch<PortalInvoiceItem>(`/me/invoices/${selectedInvoiceId}`);
        if (cancelled) return;
        setDetail(invoice);
        setDetailError("");
      } catch (err) {
        if (cancelled) return;
        setDetailError(err instanceof Error ? err.message : "Failed to load invoice detail.");
      } finally {
        if (!cancelled) {
          setDetailBusy(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedInvoiceId, version]);

  const totalBalance = useMemo(
    () => invoices.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0),
    [invoices],
  );
  const overdueCount = useMemo(
    () => invoices.filter((item) => item.status === "overdue").length,
    [invoices],
  );
  const proofPendingCount = useMemo(
    () =>
      invoices.filter(
        (item) =>
          !["paid", "cancelled"].includes(item.status) &&
          !item.last_payment_proof_at,
      ).length,
    [invoices],
  );

  async function handlePaymentProofUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (!uploadFile) {
      setUploadError("Choose a file first.");
      return;
    }

    setUploadBusy(true);
    setUploadError("");
    setNotice("");

    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("order_id", detail.order_id);
      formData.set("upload_kind", "payment_proof");
      formData.set("auto_name", `Payment proof ${detail.invoice_number}`);
      if (uploadNote.trim()) {
        formData.set("notes", uploadNote.trim());
      }

      await apiFetch("/me/documents/upload", { method: "POST", body: formData });
      setNotice("Payment proof uploaded for the billing team.");
      setUploadOpen(false);
      setUploadFile(null);
      setUploadNote("");
      setVersion((value) => value + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload payment proof.");
    } finally {
      setUploadBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading invoices...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_34%),linear-gradient(135deg,#082f49_0%,#0f172a_52%,#14532d_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">Patient portal</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">My invoices</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Review released invoice snapshots, track payment state and upload payment proof when you already transferred funds.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/documents">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Upload className="size-4" />
                Open documents
              </Button>
            </Link>
            <Button
              variant="outline"
              className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <section className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}>
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Visible invoices" value={String(invoices.length)} />
        <MetricCard label="Outstanding balance" value={formatPortalCurrency(totalBalance)} />
        <MetricCard label="Missing payment proof" value={String(proofPendingCount)} description={`${overdueCount} overdue`} />
      </section>

      {invoices.length === 0 ? (
        <section className={shellCard("border-dashed px-6 py-12 text-center")}>
          <p className="text-base font-semibold text-slate-950">No invoices released yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Billing snapshots will appear here once they are available for portal access.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {invoices.map((invoice) => {
            const balanceDue = Number(invoice.balance_due ?? 0);

            return (
              <button
                key={invoice.id}
                type="button"
                onClick={() => setSelectedInvoiceId(invoice.id)}
                className={cn(
                  "rounded-[1.75rem] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                  selectedInvoiceId === invoice.id ? "border-sky-300 ring-4 ring-sky-100" : "border-slate-200",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                      {invoice.invoice_number}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">{invoice.order_number}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Issued {formatPortalDateTime(invoice.issued_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={cn("rounded-full", invoiceStatusTone(invoice.status))}>
                      {invoice.status.replaceAll("_", " ")}
                    </Badge>
                    <Badge variant="outline" className={cn("rounded-full", invoiceTypeTone(invoice.invoice_type))}>
                      {invoice.invoice_type}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <MetricChip label="Total" value={formatPortalCurrency(invoice.total_gross)} />
                  <MetricChip label="Open" value={formatPortalCurrency(balanceDue)} />
                  <MetricChip
                    label="Payment proof"
                    value={invoice.last_payment_proof_at ? `Uploaded ${formatPortalDate(invoice.last_payment_proof_at)}` : "Not uploaded"}
                  />
                </div>
              </button>
            );
          })}
        </section>
      )}

      <Sheet open={Boolean(selectedInvoiceId)} onOpenChange={(open) => { if (!open) setSelectedInvoiceId(""); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{detail ? detail.invoice_number : "Invoice detail"}</SheetTitle>
            <SheetDescription>
              Commercial totals, line items and payment-proof handoff for the selected invoice.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {detailBusy ? (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <LoaderCircle className="size-4 animate-spin" />
                Loading invoice detail...
              </div>
            ) : detailError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {detailError}
              </div>
            ) : !detail ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Choose an invoice card to open the detail workspace.
              </div>
            ) : (
              <>
                <section className={shellCard("p-5")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Invoice overview</h2>
                      <p className="mt-1 text-sm text-slate-500">Amounts, due date and linked quote/order context.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void openPortalInvoicePdf(detail.id).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : "Failed to open invoice PDF.");
                          })
                        }
                      >
                        Preview PDF
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void downloadPortalInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : "Failed to download invoice PDF.");
                          })
                        }
                      >
                        <Download className="size-4" />
                        Download PDF
                      </Button>
                      <Badge variant="outline" className={cn("rounded-full", invoiceStatusTone(detail.status))}>
                        {detail.status.replaceAll("_", " ")}
                      </Badge>
                      <Badge variant="outline" className={cn("rounded-full", invoiceTypeTone(detail.invoice_type))}>
                        {detail.invoice_type}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label="Issued at" value={formatPortalDateTime(detail.issued_at)} />
                    <Detail label="Due date" value={formatPortalDate(detail.due_date)} />
                    <Detail label="Order" value={detail.order_number} />
                    <Detail label="Quote" value={detail.quote_number || "Not set"} />
                    <Detail label="Total gross" value={formatPortalCurrency(detail.total_gross)} />
                    <Detail label="Open balance" value={formatPortalCurrency(detail.balance_due)} />
                  </div>
                  {detail.notes ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {detail.notes}
                    </div>
                  ) : null}
                </section>

                <section className={shellCard("p-5")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Payment proof</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Upload transfer receipt or payment confirmation once funds were sent.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={uploadBusy || ["paid", "cancelled"].includes(detail.status)}
                      onClick={() => {
                        setUploadError("");
                        setUploadOpen(true);
                      }}
                    >
                      <Upload className="size-4" />
                      Upload payment proof
                    </Button>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label="Uploaded proofs" value={String(detail.payment_proof_count ?? 0)} />
                    <Detail
                      label="Latest upload"
                      value={detail.last_payment_proof_at ? formatPortalDateTime(detail.last_payment_proof_at) : "Not uploaded"}
                    />
                  </div>
                </section>

                <section className={shellCard("p-5")}>
                  <h2 className="text-lg font-semibold text-slate-950">Line items</h2>
                  <p className="mt-1 text-sm text-slate-500">Materialized billing lines for the current invoice snapshot.</p>
                  <div className="mt-5 space-y-3">
                    {!detail.line_items || detail.line_items.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        No line items available.
                      </div>
                    ) : (
                      detail.line_items.map((line, index) => (
                        <InvoiceLineCard key={`${detail.id}-${index}`} line={line} />
                      ))
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) {
            setUploadBusy(false);
            setUploadError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload payment proof</DialogTitle>
            <DialogDescription>
              This file is attached internally for billing follow-up and is not auto-shared back to the portal.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handlePaymentProofUpload(event)}>
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-proof">File</Label>
              <input
                id="invoice-payment-proof"
                type="file"
                className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-proof-note">Note</Label>
              <textarea
                id="invoice-payment-proof-note"
                className="min-h-[110px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                placeholder="Optional transfer reference, payment date or clarification."
                value={uploadNote}
                onChange={(event) => setUploadNote(event.target.value)}
              />
            </div>
            {uploadError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {uploadError}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={uploadBusy}>
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Send proof
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </section>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}

function InvoiceLineCard({ line }: { line: PortalInvoiceLineItem }) {
  return (
    <article className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{line.description}</p>
          <p className="mt-1 text-xs text-slate-500">
            Qty {line.quantity} · Unit {formatPortalCurrency(line.unit_price)} · VAT {line.vat_rate}%
          </p>
        </div>
        <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
          {formatPortalCurrency(line.line_gross)}
        </Badge>
      </div>
      {line.notes ? <p className="mt-3 text-xs text-slate-500">{line.notes}</p> : null}
    </article>
  );
}
