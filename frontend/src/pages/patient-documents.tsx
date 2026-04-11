import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  documentTone,
  downloadPortalDocument,
  downloadPortalUpload,
  formatPortalDateTime,
  formatPortalFileSize,
  uploadedDocumentTone,
} from "@/pages/patient-portal.shared";
import type {
  PortalDocumentItem,
  PortalUploadedDocumentItem,
} from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

export function PatientDocumentsPage() {
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [uploads, setUploads] = useState<PortalUploadedDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadKind, setUploadKind] = useState("general");
  const [uploadName, setUploadName] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
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
        const [releasedRows, uploadedRows] = await Promise.all([
          apiFetch<PortalDocumentItem[]>("/me/documents"),
          apiFetch<PortalUploadedDocumentItem[]>("/me/documents/uploads"),
        ]);
        if (cancelled) return;
        startTransition(() => {
          setDocuments(releasedRows);
          setUploads(uploadedRows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load documents.");
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

  const pending = useMemo(
    () => documents.filter((item) => item.requires_confirmation && !item.confirmed).length,
    [documents],
  );

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      formData.set("upload_kind", uploadKind);
      if (uploadName.trim()) {
        formData.set("auto_name", uploadName.trim());
      }
      if (uploadNotes.trim()) {
        formData.set("notes", uploadNotes.trim());
      }

      await apiFetch("/me/documents/upload", {
        method: "POST",
        body: formData,
      });

      setNotice("Upload sent to the care team.");
      setUploadFile(null);
      setUploadName("");
      setUploadNotes("");
      setUploadKind("general");
      setVersion((value) => value + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload document.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleConfirm(documentId: string) {
    setBusyId(documentId);
    setNotice("");
    setError("");

    try {
      await apiFetch(`/me/documents/${documentId}/confirm`, { method: "POST" });
      setNotice("Document receipt confirmed.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm release.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(item: PortalDocumentItem) {
    setBusyId(item.id);
    setNotice("");
    setError("");

    try {
      await downloadPortalDocument(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download document.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUploadDownload(item: PortalUploadedDocumentItem) {
    setBusyId(item.id);
    setNotice("");
    setError("");

    try {
      await downloadPortalUpload(item.id, item.original_filename ?? item.auto_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download uploaded document.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading documents...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Patient portal
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              My documents
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              Only files explicitly released to your portal are visible here.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              Pending confirmations: <span className="font-semibold text-slate-950">{pending}</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              My uploads: <span className="font-semibold text-slate-950">{uploads.length}</span>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 shadow-sm">
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-sm">
          {error}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Released to me</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Only files explicitly released by your care team are visible here.
                </p>
              </div>
            </div>
          </div>

          {documents.length === 0 ? (
            <section className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
              <p className="text-base font-semibold text-slate-950">No documents released yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Your care team will publish files here once they are cleared for portal access.
              </p>
            </section>
          ) : (
            documents.map((item) => {
              const busy = busyId === item.id;

              return (
                <article
                  key={item.id}
                  className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn("rounded-full", documentTone(item))}>
                          {item.confirmed ? "Confirmed" : item.requires_confirmation ? "Needs confirmation" : "Released"}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                          {item.status}
                        </Badge>
                      </div>
                      <h2 className="mt-3 text-xl font-semibold text-slate-950">{item.auto_name}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {[item.art, item.category, formatPortalFileSize(item.file_size)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {item.requires_confirmation && !item.confirmed ? (
                      <ShieldCheck className="size-5 text-amber-500" />
                    ) : null}
                  </div>

                  <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label="Released by" value={item.shared_by_name || "Care team"} />
                    <Detail label="Released at" value={formatPortalDateTime(item.shared_at)} />
                    <Detail label="Filename" value={item.original_filename || item.auto_name} />
                    <Detail label="Source" value={item.ursprung || item.klinik || "Portal release"} />
                  </dl>

                  {item.notes ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {item.notes}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={busy}
                      onClick={() => void handleDownload(item)}
                    >
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      Download
                    </Button>
                    {item.requires_confirmation && !item.confirmed ? (
                      <Button
                        variant="outline"
                        className="rounded-2xl"
                        disabled={busy}
                        onClick={() => void handleConfirm(item.id)}
                      >
                        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        Confirm receipt
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="space-y-4">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Upload documents</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Send files to the care team. Payment proofs stay internal and can be uploaded from the invoice workspace.
                </p>
              </div>
              <Upload className="mt-1 size-5 text-sky-700" />
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void handleUpload(event)}>
              <Field label="Upload type">
                <select
                  value={uploadKind}
                  onChange={(event) => setUploadKind(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="general">General</option>
                  <option value="medical_record">Medical record</option>
                  <option value="insurance_document">Insurance document</option>
                </select>
              </Field>
              <Field label="Title">
                <input
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  placeholder="Optional title"
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </Field>
              <Field label="File">
                <input
                  type="file"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                />
              </Field>
              <Field label="Note">
                <textarea
                  value={uploadNotes}
                  onChange={(event) => setUploadNotes(event.target.value)}
                  placeholder="Optional context for the care team"
                  className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </Field>
              {uploadError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {uploadError}
                </div>
              ) : null}
              <Button
                type="submit"
                className="w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={uploadBusy}
              >
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Send upload
              </Button>
            </form>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">My uploads</h2>
              <p className="mt-1 text-sm text-slate-500">
                Files you already sent from the portal.
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {uploads.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  No portal uploads yet.
                </div>
              ) : (
                uploads.map((item) => {
                  const busy = busyId === item.id;

                  return (
                    <article key={item.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className={cn("rounded-full", uploadedDocumentTone(item))}>
                              {item.art.replaceAll("_", " ")}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-slate-950">{item.auto_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[item.order_number, item.appointment_title, formatPortalFileSize(item.file_size)].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          disabled={busy}
                          onClick={() => void handleUploadDownload(item)}
                        >
                          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                          Download
                        </Button>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        Uploaded {formatPortalDateTime(item.created_at)}
                      </p>
                      {item.notes ? (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          {item.notes}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </section>
      </section>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
