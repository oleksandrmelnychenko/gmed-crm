import { useEffect, useMemo, useState, type ElementType, type FormEvent } from "react";
import {
  BookOpen,
  CheckCheck,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SopItem = {
  id: string;
  title: string;
  category: string;
  summary?: string | null;
  body_markdown: string;
  status: string;
  approval_required_role?: string | null;
  target_roles: string[];
  requires_ack: boolean;
  revision_no: number;
  created_by_name?: string | null;
  created_by_role: string;
  approved_by_name?: string | null;
  approved_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
  assigned_user_count: number;
  target_user_ids: string[];
  my_ack_status?: string | null;
  my_acknowledged_at?: string | null;
  pending_ack_count: number;
  acknowledged_count: number;
  can_edit: boolean;
  can_review: boolean;
  can_request_ack: boolean;
  can_acknowledge: boolean;
};

type EligibleUser = {
  id: string;
  name: string;
  role: string;
};

type EligibleUsersPayload = {
  allowed_target_roles: string[];
  eligible_users: EligibleUser[];
};

type SopFormState = {
  title: string;
  category: string;
  summary: string;
  bodyMarkdown: string;
  requiresAck: boolean;
  targetRoles: string[];
  targetUserIds: string[];
};

function emptyForm(): SopFormState {
  return {
    title: "",
    category: "sop",
    summary: "",
    bodyMarkdown: "",
    requiresAck: false,
    targetRoles: [],
    targetUserIds: [],
  };
}

function card(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra,
  );
}

function categoryLabel(value: string) {
  if (value === "sop") return "SOP";
  if (value === "handbook") return "Handbook";
  if (value === "training") return "Training";
  return value;
}

function statusTone(value: string) {
  if (value === "approved") return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100";
  if (value === "pending_approval") return "bg-amber-100 text-amber-700 hover:bg-amber-100";
  if (value === "rejected") return "bg-rose-100 text-rose-700 hover:bg-rose-100";
  if (value === "archived") return "bg-slate-200 text-slate-700 hover:bg-slate-200";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
}

function roleCanOpenLearning(role?: string) {
  return role !== undefined && role !== "patient";
}

function roleCanCreate(role?: string) {
  return role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter";
}

function roleCanReview(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

function formatDate(value?: string | null) {
  if (!value) return "Not set";
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

function metricCard(label: string, value: string | number, icon: ElementType) {
  const Icon = icon;
  return (
    <article className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

function approvalRoleLabel(value?: string | null) {
  if (value === "ceo") return "CEO approval";
  if (value === "patient_manager") return "Patient-manager approval";
  return "Approval";
}

function reviewQueueCopy(role?: string) {
  if (role === "patient_manager") {
    return {
      metric: "PM review queue",
      title: "Patient-manager approval queue",
      description:
        "Interpreter-team SOPs waiting for patient-manager approval before they become visible.",
    };
  }

  return {
    metric: "CEO review queue",
    title: "CEO approval queue",
    description: "Team-authored SOPs waiting for CEO approval before they become visible.",
  };
}

function formDescription(role?: string) {
  if (role === "ceo") {
    return "Create role-scoped SOP, handbook or training content. CEO content is published immediately.";
  }
  if (role === "patient_manager") {
    return "Create role-scoped SOP, handbook or training content. Patient-manager content is routed to CEO approval.";
  }
  return "Create interpreter-team SOP content. Teamlead interpreter content is routed to patient-manager approval and can target interpreters only.";
}

export function SopsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [items, setItems] = useState<SopItem[]>([]);
  const [reviewQueue, setReviewQueue] = useState<SopItem[]>([]);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [allowedTargetRoles, setAllowedTargetRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [editing, setEditing] = useState<SopItem | null>(null);
  const [reviewItem, setReviewItem] = useState<SopItem | null>(null);
  const [reviewDecision, setReviewDecision] = useState("approve");
  const [reviewNote, setReviewNote] = useState("");
  const [form, setForm] = useState<SopFormState>(emptyForm());

  const canCreate = roleCanCreate(user?.role);
  const canReviewQueue = roleCanReview(user?.role);
  const queueCopy = useMemo(() => reviewQueueCopy(user?.role), [user?.role]);

  useEffect(() => {
    if (!roleCanOpenLearning(user?.role)) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      if (loading) setRefreshing(false);
      else setRefreshing(true);

      try {
        const [library, eligible, queue] = await Promise.all([
          apiFetch<SopItem[]>("/sops").catch(() => []),
          canCreate ? apiFetch<EligibleUsersPayload>("/sops/eligible-users").catch(() => null) : Promise.resolve(null),
          canReviewQueue ? apiFetch<SopItem[]>("/sops/review-queue").catch(() => []) : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setItems(library);
        setEligibleUsers(eligible?.eligible_users ?? []);
        setAllowedTargetRoles(eligible?.allowed_target_roles ?? []);
        setReviewQueue(queue);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load SOP workspace.");
        }
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
  }, [canCreate, canReviewQueue, loading, user?.role, version]);

  const visibleMetrics = useMemo(() => {
    const approved = items.filter((item) => item.status === "approved").length;
    const pendingAck = items.filter((item) => item.my_ack_status === "pending").length;
    return { approved, pendingAck };
  }, [items]);

  const filteredUsers = useMemo(() => {
    if (form.targetRoles.length === 0) return eligibleUsers;
    return eligibleUsers.filter(
      (item) =>
        form.targetRoles.includes(item.role) || form.targetUserIds.includes(item.id),
    );
  }, [eligibleUsers, form.targetRoles, form.targetUserIds]);

  function resetForm() {
    setEditing(null);
    setForm(emptyForm());
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(item: SopItem) {
    setEditing(item);
    setForm({
      title: item.title,
      category: item.category,
      summary: item.summary ?? "",
      bodyMarkdown: item.body_markdown,
      requiresAck: item.requires_ack,
      targetRoles: item.target_roles,
      targetUserIds: item.target_user_ids,
    });
    setFormOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await apiFetch(editing ? `/sops/${editing.id}/update` : "/sops", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          summary: form.summary || null,
          body_markdown: form.bodyMarkdown,
          target_roles: form.targetRoles,
          target_user_ids: form.targetUserIds,
          requires_ack: form.requiresAck,
        }),
      });
      setFormOpen(false);
      resetForm();
      setNotice(editing ? "Learning content updated." : "Learning content created.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save learning content.");
    } finally {
      setSaving(false);
    }
  }

  async function requestAck(item: SopItem) {
    try {
      await apiFetch(`/sops/${item.id}/request-acknowledgement`, { method: "POST" });
      setNotice("Acknowledgement request sent.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request acknowledgement.");
    }
  }

  async function acknowledge(item: SopItem) {
    try {
      await apiFetch(`/sops/${item.id}/acknowledge`, { method: "POST" });
      setNotice("Acknowledgement recorded.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge content.");
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewItem) return;

    setReviewBusy(true);
    setError("");
    setNotice("");

    try {
      await apiFetch(`/sops/${reviewItem.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: reviewDecision, note: reviewNote || null }),
      });
      setReviewOpen(false);
      setReviewItem(null);
      setReviewNote("");
      setNotice("Review decision saved.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review content.");
    } finally {
      setReviewBusy(false);
    }
  }

  if (!roleCanOpenLearning(user?.role)) {
    return (
      <section className={card("px-6 py-10 text-center")}>
        <h1 className="text-2xl font-semibold text-slate-950">SOP & learning</h1>
        <p className="mt-3 text-sm text-slate-500">This workspace is available only for staff roles.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading SOP workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#111827_54%,#334155_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">Learning</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">SOP & learning library</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Role-scoped SOPs, handbooks and trainings with multi-step approval routing and acknowledgement tracking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate ? (
              <Button
                variant="outline"
                className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
                onClick={openCreate}
              >
                <Plus className="size-4" />
                New content
              </Button>
            ) : null}
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

      {notice ? <section className={card("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}>{notice}</section> : null}
      {error ? <section className={card("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>{error}</section> : null}

      <section className="grid gap-4 md:grid-cols-4">
        {metricCard("Visible items", items.length, BookOpen)}
        {metricCard("Approved", visibleMetrics.approved, FileCheck2)}
        {metricCard("Pending acknowledgement", visibleMetrics.pendingAck, CheckCheck)}
        {metricCard(queueCopy.metric, reviewQueue.length, ShieldCheck)}
      </section>

      {canReviewQueue && reviewQueue.length > 0 ? (
        <section className={card("p-6")}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">{queueCopy.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {queueCopy.description}
              </p>
            </div>
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{reviewQueue.length}</Badge>
          </div>
          <div className="mt-5 space-y-3">
            {reviewQueue.map((item) => (
              <article key={item.id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                      <Badge className={statusTone(item.status)}>{item.status.replaceAll("_", " ")}</Badge>
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{categoryLabel(item.category)}</Badge>
                      {item.approval_required_role ? (
                        <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                          {approvalRoleLabel(item.approval_required_role)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      Created by {item.created_by_name || item.created_by_role} · {formatDate(item.updated_at)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReviewItem(item);
                      setReviewDecision("approve");
                      setReviewNote(item.review_note ?? "");
                      setReviewOpen(true);
                    }}
                  >
                    Review
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-4">
          {items.length === 0 ? (
            <section className={card("border-dashed px-6 py-12 text-center")}>
              <p className="text-base font-semibold text-slate-950">No SOP content visible yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Once content is approved for your role or assigned directly, it will appear here.
              </p>
            </section>
          ) : (
            items.map((item) => (
              <article key={item.id} className={card("p-5")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={statusTone(item.status)}>{item.status.replaceAll("_", " ")}</Badge>
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{categoryLabel(item.category)}</Badge>
                      {item.status === "pending_approval" && item.approval_required_role ? (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                          {approvalRoleLabel(item.approval_required_role)}
                        </Badge>
                      ) : null}
                      {item.requires_ack ? (
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">Ack required</Badge>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Revision {item.revision_no} · Created by {item.created_by_name || tr[`role_${item.created_by_role}`] || item.created_by_role}
                      {item.approved_by_name ? ` · Approved by ${item.approved_by_name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.can_edit ? (
                      <Button variant="outline" onClick={() => openEdit(item)}>
                        Edit
                      </Button>
                    ) : null}
                    {item.can_request_ack ? (
                      <Button variant="outline" onClick={() => void requestAck(item)}>
                        Request ack
                      </Button>
                    ) : null}
                    {item.can_acknowledge ? (
                      <Button onClick={() => void acknowledge(item)}>Acknowledge</Button>
                    ) : null}
                  </div>
                </div>

                {item.summary ? <p className="mt-4 text-sm leading-6 text-slate-600">{item.summary}</p> : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {item.target_roles.map((role) => (
                    <Badge key={`${item.id}-${role}`} className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                      {tr[`role_${role}`] ?? role}
                    </Badge>
                  ))}
                  {item.assigned_user_count > 0 ? (
                    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      {item.assigned_user_count} direct users
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                  <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body_markdown}</pre>
                </div>

                <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>{item.pending_ack_count} pending acknowledgements</span>
                  <span>{item.acknowledged_count} acknowledged</span>
                  {item.my_ack_status ? <span>My status: {item.my_ack_status.replaceAll("_", " ")}</span> : null}
                  {item.review_note ? <span>Review note: {item.review_note}</span> : null}
                </div>
              </article>
            ))
          )}
        </section>

        <section className="space-y-6">
          <section className={card("p-6")}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Users className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-950">Targeting model</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Content visibility is driven by target roles and optional direct user assignment.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {allowedTargetRoles.length > 0 ? allowedTargetRoles.map((role) => (
                <Badge key={role} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                  {tr[`role_${role}`] ?? role}
                </Badge>
              )) : (
                <span className="text-sm text-slate-500">Creation is not available for your role.</span>
              )}
            </div>
          </section>

          <section className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">Current-state scope</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This slice covers SOP library retrieval, CEO or patient-manager approval routing, acknowledgement tracking and scoped distribution for operational teams.
            </p>
          </section>
        </section>
      </section>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit learning content" : "New learning content"}</DialogTitle>
            <DialogDescription>
              {formDescription(user?.role)}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-5" onSubmit={(event) => void submitForm(event)}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="sop">SOP</option>
                  <option value="handbook">Handbook</option>
                  <option value="training">Training</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Summary</Label>
              <Input value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Body</Label>
              <textarea
                value={form.bodyMarkdown}
                onChange={(event) => setForm((current) => ({ ...current, bodyMarkdown: event.target.value }))}
                className="min-h-[220px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <Label>Target roles</Label>
                <div className="grid gap-2">
                  {allowedTargetRoles.map((role) => (
                    <label key={role} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.targetRoles.includes(role)}
                        onChange={(event) => {
                          setForm((current) => ({
                            ...current,
                            targetRoles: event.target.checked
                              ? [...current.targetRoles, role]
                              : current.targetRoles.filter((item) => item !== role),
                          }));
                        }}
                      />
                      <span>{tr[`role_${role}`] ?? role}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Label>Direct users</Label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-3">
                  {(filteredUsers.length > 0 ? filteredUsers : eligibleUsers).map((item) => (
                    <label key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.targetUserIds.includes(item.id)}
                        onChange={(event) => {
                          setForm((current) => ({
                            ...current,
                            targetUserIds: event.target.checked
                              ? [...current.targetUserIds, item.id]
                              : current.targetUserIds.filter((value) => value !== item.id),
                          }));
                        }}
                      />
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{tr[`role_${item.role}`] ?? item.role}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.requiresAck}
                onChange={(event) => setForm((current) => ({ ...current, requiresAck: event.target.checked }))}
              />
              <span>Mark as acknowledgement-relevant</span>
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {editing ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review learning content</DialogTitle>
            <DialogDescription>Approve the SOP or send it back with a concrete note.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submitReview(event)}>
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
              <p className="text-sm font-semibold text-slate-950">{reviewItem?.title}</p>
              <p className="mt-2 text-sm text-slate-500">
                {reviewItem?.created_by_name || "Author"} · {reviewItem ? formatDate(reviewItem.updated_at) : ""}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Decision</Label>
              <select
                value={reviewDecision}
                onChange={(event) => setReviewDecision(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="approve">Approve</option>
                <option value="reject">Reject / changes requested</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Review note</Label>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                className="min-h-[160px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={reviewBusy}>
                {reviewBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Save review
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
