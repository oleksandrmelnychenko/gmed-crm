import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Inbox,
  LoaderCircle,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  RefreshCw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  downloadIntakeAttachment,
  fetchIntake,
  fetchIntakes,
  updateIntakeStatus,
  type IntakeStatus,
  type VisitorIntakeDetail,
  type VisitorIntakeListItem,
} from "@/lib/api/visitor-intakes";

const STATUS_OPTIONS: { value: "" | IntakeStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "converted", label: "Converted" },
  { value: "archived", label: "Archived" },
  { value: "spam", label: "Spam" },
];

const STATUS_STYLES: Record<IntakeStatus, string> = {
  new: "border-blue-200 bg-blue-50 text-blue-700",
  reviewed: "border-amber-200 bg-amber-50 text-amber-700",
  converted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archived: "border-slate-200 bg-slate-100 text-slate-600",
  spam: "border-rose-200 bg-rose-50 text-rose-700",
};

function canViewIntakes(role?: string) {
  return role === "patient_manager" || role === "sales" || role === "ceo";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function dash(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function statusBadge(status: IntakeStatus) {
  return cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
    STATUS_STYLES[status] ?? STATUS_STYLES.archived,
  );
}

interface DetailSectionProps {
  title: string;
  children: React.ReactNode;
}

function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-sm text-slate-800">{value}</div>
    </div>
  );
}

export function IntakesPage() {
  const { user } = useAuth();
  const canView = useMemo(() => canViewIntakes(user?.role), [user?.role]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<VisitorIntakeListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | IntakeStatus>("");
  const [version, setVersion] = useState(0);

  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<VisitorIntakeDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const intakeParam = searchParams.get("intake") ?? "";
    if (!intakeParam) return;
    if (intakeParam !== selectedId) {
      setSelectedId(intakeParam);
      setDetail(null);
      setDetailError("");
    }
    if (!detailOpen) {
      setDetailOpen(true);
    }
  }, [searchParams, selectedId, detailOpen]);

  useEffect(() => {
    if (detailOpen) return;
    if (searchParams.has("intake")) {
      const next = new URLSearchParams(searchParams);
      next.delete("intake");
      setSearchParams(next, { replace: true });
    }
  }, [detailOpen, searchParams, setSearchParams]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchIntakes({ search, status: statusFilter })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load intakes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canView, search, statusFilter, version]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");

    fetchIntake(selectedId)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setDetailError(
            err instanceof Error ? err.message : "Failed to load intake",
          );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, selectedId]);

  const handleOpen = useCallback((id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailOpen(true);
  }, []);

  const handleStatusChange = useCallback(
    async (next: IntakeStatus) => {
      if (!detail) return;
      setStatusBusy(true);
      try {
        await updateIntakeStatus(detail.id, next);
        setDetail({ ...detail, processing_status: next });
        refresh();
      } catch (err) {
        setDetailError(
          err instanceof Error ? err.message : "Failed to update status",
        );
      } finally {
        setStatusBusy(false);
      }
    },
    [detail, refresh],
  );

  const handleDownload = useCallback(
    async (attachmentId: string, fileName: string) => {
      if (!detail) return;
      try {
        const blob = await downloadIntakeAttachment(detail.id, attachmentId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setDetailError(
          err instanceof Error ? err.message : "Failed to download attachment",
        );
      }
    },
    [detail],
  );

  if (!canView) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
        You do not have permission to view visitor intakes.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Inbox className="size-3.5" /> Visitor intakes
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            Wizard submissions
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Raw submissions from the public application wizard. Review each
            intake before promoting it to a lead.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex flex-1 min-w-[240px] flex-col gap-1">
          <Label htmlFor="intake-search" className="text-xs text-slate-500">
            Search
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="intake-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, country"
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-slate-500">Status</Label>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((option) => (
              <Button
                key={option.value || "all"}
                size="sm"
                variant={statusFilter === option.value ? "default" : "outline"}
                onClick={() => setStatusFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border/70 bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Flow</th>
              <th className="px-4 py-3">Files</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  <LoaderCircle className="inline size-4 animate-spin" /> Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No intakes match the current filters.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => handleOpen(item.id)}
                  className="cursor-pointer border-b border-border/60 transition hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {item.first_name} {item.last_name}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="flex flex-col gap-0.5">
                      {item.email ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Mail className="size-3" />
                          {item.email}
                        </span>
                      ) : null}
                      {item.primary_phone ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Phone className="size-3" />
                          {item.primary_phone}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <MapPin className="size-3" />
                      {dash(
                        [item.city, item.country].filter(Boolean).join(", "),
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <Badge variant="outline">{item.flow ?? "—"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Paperclip className="size-3" />
                      {item.attachment_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {formatDate(item.submitted_at ?? item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusBadge(item.processing_status)}>
                      {item.processing_status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {detail
                ? `${detail.first_name} ${detail.last_name}`
                : "Intake details"}
            </SheetTitle>
            <SheetDescription>
              {detail
                ? `Submitted ${formatDate(detail.submitted_at ?? detail.created_at)}`
                : "Loading intake…"}
            </SheetDescription>
          </SheetHeader>

          {detailError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {detailError}
            </div>
          ) : null}

          {detailLoading && !detail ? (
            <div className="mt-8 flex items-center justify-center text-slate-400">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : null}

          {detail ? (
            <div className="mt-4 space-y-6 px-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={statusBadge(detail.processing_status)}>
                  {detail.processing_status}
                </span>
                <span className="text-xs text-slate-500">
                  Flow: {dash(detail.flow)} · Locale: {dash(detail.locale)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  ["new", "reviewed", "converted", "archived", "spam"] as const
                ).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={detail.processing_status === s ? "default" : "outline"}
                    disabled={statusBusy || detail.processing_status === s}
                    onClick={() => handleStatusChange(s)}
                  >
                    Mark {s}
                  </Button>
                ))}
              </div>

              <DetailSection title="Identity">
                <Field label="Full name" value={
                  dash(
                    [
                      detail.first_name,
                      detail.middle_name,
                      detail.last_name,
                      detail.suffix,
                    ]
                      .filter(Boolean)
                      .join(" "),
                  )
                } />
                <Field label="Date of birth" value={dash(detail.date_of_birth)} />
                <Field label="Legal sex" value={dash(detail.legal_sex)} />
                <Field label="Primary language" value={dash(detail.primary_language)} />
                <Field label="Needs interpreter" value={yesNo(detail.needs_interpreter)} />
              </DetailSection>

              <DetailSection title="Contact">
                <Field label="Email" value={dash(detail.email)} />
                <Field label="Email consent" value={yesNo(detail.email_consent)} />
                <Field
                  label="Primary phone"
                  value={
                    detail.primary_phone
                      ? `${detail.primary_phone}${detail.primary_phone_type ? ` (${detail.primary_phone_type})` : ""}`
                      : "—"
                  }
                />
                <Field label="WhatsApp" value={dash(detail.whatsapp_number)} />
                <Field label="WhatsApp consent" value={yesNo(detail.whatsapp_consent)} />
              </DetailSection>

              <DetailSection title="Address">
                <Field label="Country" value={dash(detail.country)} />
                <Field label="City" value={dash(detail.city)} />
                <Field label="State/region" value={dash(detail.state)} />
                <Field label="Zip code" value={dash(detail.zip_code)} />
                <Field label="Street" value={dash(detail.street_address)} />
              </DetailSection>

              <DetailSection title="Eligibility & path">
                <Field label="Location" value={dash(detail.location)} />
                <Field label="Location detailed" value={dash(detail.location_detailed)} />
                <Field label="Wants membership" value={yesNo(detail.wants_membership)} />
                <Field label="Selected program" value={dash(detail.selected_program)} />
                <Field label="Can travel" value={yesNo(detail.can_travel)} />
                <Field label="Has medical records" value={dash(detail.has_medical_records)} />
                <Field
                  label="Records in accepted language"
                  value={yesNo(detail.records_in_accepted_language)}
                />
                <Field
                  label="Has travel documents"
                  value={yesNo(detail.has_travel_documents)}
                />
              </DetailSection>

              <DetailSection title="Health">
                <Field
                  label="Currently in treatment"
                  value={yesNo(detail.currently_in_treatment)}
                />
                <Field
                  label="Health risk for travel"
                  value={yesNo(detail.has_health_risk_for_travel)}
                />
              </DetailSection>

              {detail.primary_concern_text || detail.additional_concerns ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Concern
                  </h3>
                  {detail.primary_concern_text ? (
                    <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {detail.primary_concern_text}
                    </p>
                  ) : null}
                  {detail.additional_concerns ? (
                    <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {detail.additional_concerns}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <DetailSection title="Services & insurance">
                <Field
                  label="Services"
                  value={
                    detail.services.length > 0 ? detail.services.join(", ") : "—"
                  }
                />
                <Field label="Has insurance" value={yesNo(detail.has_insurance)} />
                <Field
                  label="Insurance covers Germany"
                  value={dash(detail.insurance_covers_germany)}
                />
              </DetailSection>

              <DetailSection title="Wrap up">
                <Field label="Preferred location" value={dash(detail.preferred_location)} />
                <Field label="Visit timing" value={dash(detail.visit_timing)} />
              </DetailSection>

              {detail.message ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Message
                  </h3>
                  <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {detail.message}
                  </p>
                </section>
              ) : null}

              <DetailSection title="Consents">
                <Field label="Automated contact" value={yesNo(detail.consent_automated_contact)} />
                <Field label="Healthcare" value={yesNo(detail.consent_healthcare)} />
                <Field label="Opt out" value={yesNo(detail.consent_opt_out)} />
                <Field
                  label="Privacy practices"
                  value={yesNo(detail.consent_privacy_practices)}
                />
              </DetailSection>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Attachments ({detail.attachments.length})
                </h3>
                {detail.attachments.length === 0 ? (
                  <p className="text-sm text-slate-500">No files uploaded.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.attachments.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <Paperclip className="size-4 text-slate-500" />
                          <div>
                            <div className="font-medium text-slate-800">
                              {file.file_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {dash(file.content_type)} · {formatSize(file.size_bytes)}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(file.id, file.file_name)}
                        >
                          Download
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
