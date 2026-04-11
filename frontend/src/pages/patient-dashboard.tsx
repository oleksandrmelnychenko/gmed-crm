import { startTransition, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, LoaderCircle, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  appointmentStatusTone,
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceStatusTone,
  privacyRequestLabel,
  privacyStatusTone,
} from "@/pages/patient-portal.shared";
import type {
  PortalAppointmentItem,
  PortalDocumentItem,
  PortalInvoiceItem,
  PortalPrivacyRequest,
} from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-slate-200 bg-white shadow-sm",
    extra,
  );
}

export function PatientDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoiceItem[]>([]);
  const [requests, setRequests] = useState<PortalPrivacyRequest[]>([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const [portalAppointments, docs, portalInvoices, privacy] = await Promise.all([
          apiFetch<PortalAppointmentItem[]>("/me/appointments").catch(() => []),
          apiFetch<PortalDocumentItem[]>("/me/documents").catch(() => []),
          apiFetch<PortalInvoiceItem[]>("/me/invoices").catch(() => []),
          apiFetch<PortalPrivacyRequest[]>("/me/privacy-requests").catch(() => []),
        ]);

        if (cancelled) return;
        startTransition(() => {
          setAppointments(portalAppointments);
          setDocuments(docs);
          setInvoices(portalInvoices);
          setRequests(privacy);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load portal workspace.");
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
  }, [loading, version]);

  const releasedDocuments = documents.length;
  const upcomingAppointments = useMemo(
    () => appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10)).length,
    [appointments],
  );
  const pendingConfirmations = useMemo(
    () => documents.filter((item) => item.requires_confirmation && !item.confirmed).length,
    [documents],
  );
  const openRequests = useMemo(
    () =>
      requests.filter(
        (item) => !["rejected", "completed", "executed"].includes(item.status),
      ).length,
    [requests],
  );
  const outstandingBalance = useMemo(
    () => invoices.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0),
    [invoices],
  );
  const recentDocuments = useMemo(() => documents.slice(0, 4), [documents]);
  const recentAppointments = useMemo(() => appointments.slice(0, 4), [appointments]);
  const recentInvoices = useMemo(() => invoices.slice(0, 4), [invoices]);
  const recentRequests = useMemo(() => requests.slice(0, 4), [requests]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading portal workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#172554_52%,#0f766e_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">
              Patient portal
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Hello, {user?.name ?? "Patient"}
            </h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Only explicitly released documents and privacy workflows are shown here.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/documents">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                My documents
              </Button>
            </Link>
            <Link to="/appointments">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                My appointments
              </Button>
            </Link>
            <Link to="/privacy">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <ShieldCheck className="size-4" />
                Privacy requests
              </Button>
            </Link>
            <Link to="/invoices">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                My invoices
              </Button>
            </Link>
            <Button
              variant="outline"
              className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Upcoming visits" value={upcomingAppointments} description={`${releasedDocuments} released documents`} />
        <MetricCard label="Outstanding balance" value={outstandingBalance === 0 ? "EUR 0.00" : formatPortalCurrency(outstandingBalance)} />
        <MetricCard label="Open privacy requests" value={openRequests} description={`${pendingConfirmations} pending confirmations`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr_1fr_1fr]">
        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Upcoming visits</h2>
              <p className="mt-1 text-sm text-slate-500">
                Scheduled patient-facing appointments.
              </p>
            </div>
            <Link to="/appointments" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              Open all
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {recentAppointments.length === 0 ? (
              <EmptyState message="No scheduled visits yet." />
            ) : (
              recentAppointments.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[item.provider_name, item.doctor_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", appointmentStatusTone(item.status))}
                    >
                      {item.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {formatPortalDate(item.date)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Recent documents</h2>
              <p className="mt-1 text-sm text-slate-500">
                Files released by your care team for portal access.
              </p>
            </div>
            <Link to="/documents" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              Open all
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {recentDocuments.length === 0 ? (
              <EmptyState message="No documents have been released to your portal yet." />
            ) : (
              recentDocuments.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.auto_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[item.art, item.category, item.shared_by_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {item.confirmed ? "Confirmed" : item.requires_confirmation ? "Needs confirmation" : "Released"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Released {formatPortalDateTime(item.shared_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Recent invoices</h2>
              <p className="mt-1 text-sm text-slate-500">
                Billing snapshots and current payment state.
              </p>
            </div>
            <Link to="/invoices" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              Open all
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {recentInvoices.length === 0 ? (
              <EmptyState message="No invoices released to the portal yet." />
            ) : (
              recentInvoices.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.invoice_number}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.order_number} · Due {formatPortalDate(item.due_date)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", invoiceStatusTone(item.status))}
                    >
                      {item.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Open {formatPortalCurrency(item.balance_due)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Privacy request history</h2>
              <p className="mt-1 text-sm text-slate-500">
                DSGVO-related requests you already submitted.
              </p>
            </div>
            <Link to="/privacy" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              Open all
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {recentRequests.length === 0 ? (
              <EmptyState message="No privacy requests submitted yet." />
            ) : (
              recentRequests.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Requested {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", privacyStatusTone(item.status))}
                    >
                      {item.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Due {formatPortalDate(item.due_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function MetricCard({ label, value, description }: { label: string; value: number | string; description?: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
      {message}
    </div>
  );
}
