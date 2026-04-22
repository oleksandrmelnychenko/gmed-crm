import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shield,
  UserRound,
  UsersRound,
} from "lucide-react";

import {
  AdminSheetScaffold,
  AdminInlineMetric,
  SheetFormFooter,
  AdminTableCard,
  AdminToolbar,
} from "@/components/admin-page-patterns";
import {
  Banner,
  EmptyCell,
  PageHeader,
  TabLoader,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

const ROLE_KEYS = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "sales",
  "it_admin",
  "patient",
] as const;

const ROLE_COLORS: Record<string, string> = {
  ceo: "bg-purple-100 text-purple-700",
  ceo_assistant: "bg-purple-100 text-purple-700",
  patient_manager: "bg-blue-100 text-blue-700",
  teamlead_interpreter: "bg-cyan-100 text-cyan-700",
  interpreter: "bg-cyan-100 text-cyan-700",
  concierge: "bg-teal-100 text-teal-700",
  billing: "bg-amber-100 text-amber-700",
  sales: "bg-amber-100 text-amber-700",
  it_admin: "bg-slate-100 text-slate-700",
  patient: "bg-emerald-100 text-emerald-700",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value.split("T")[0];
  }
}

export function AdminUsersPage() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newRole, setNewRole] = useState<string>("patient_manager");

  const [editUser, setEditUser] = useState<User | null>(null);
  const [euName, setEuName] = useState("");
  const [euEmail, setEuEmail] = useState("");
  const [euRole, setEuRole] = useState("");
  const [euPassword, setEuPassword] = useState("");
  const [euSaving, setEuSaving] = useState(false);

  const roleLabel = useCallback((role: string) => tr[`role_${role}`] ?? role, [tr]);
  const closeUnsavedConfirmMessage = tr.common_discard_unsaved_confirm ?? "Discard unsaved changes?";

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<User[]>("/users");
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active).length;
    const admins = users.filter((u) => ["ceo", "ceo_assistant", "it_admin"].includes(u.role)).length;
    return { total, active, inactive: total - active, admins };
  }, [users]);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q),
    );
  }, [users, search, roleLabel]);

  const onSubmitCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      setCreateError(t.users_password_mismatch);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch<User>("/users", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, name: newName, password: newPassword, role: newRole }),
      });
      closeCreateSheet();
      void loadUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u: User) => {
    setEuName(u.name);
    setEuEmail(u.email);
    setEuRole(u.role);
    setEuPassword("");
    setEditUser(u);
  };

  const closeCreateSheet = useCallback(() => {
    setShowCreate(false);
    setCreateError(null);
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setNewRole("patient_manager");
  }, []);

  const closeEditSheet = useCallback(() => {
    setEditUser(null);
    setEuName("");
    setEuEmail("");
    setEuRole("");
    setEuPassword("");
  }, []);

  const createDirty =
    newName.trim().length > 0 ||
    newEmail.trim().length > 0 ||
    newPassword.length > 0 ||
    newPasswordConfirm.length > 0 ||
    newRole !== "patient_manager";

  const editDirty = Boolean(
    editUser &&
      (euName !== editUser.name ||
        euEmail !== editUser.email ||
        euRole !== editUser.role ||
        euPassword.length > 0),
  );

  const handleCreateSheetOpenChange = useSheetDirtyGuard({
    isDirty: createDirty,
    onClose: closeCreateSheet,
    confirmMessage: closeUnsavedConfirmMessage,
  });

  const handleEditSheetOpenChange = useSheetDirtyGuard({
    isDirty: editDirty,
    onClose: closeEditSheet,
    confirmMessage: closeUnsavedConfirmMessage,
  });

  const saveUser = async () => {
    if (!editUser) return;
    setEuSaving(true);
    try {
      await apiFetch(`/users/${editUser.id}/update`, {
        method: "POST",
        body: JSON.stringify({ name: euName, email: euEmail, role: euRole }),
      });
      closeEditSheet();
      void loadUsers();
    } finally {
      setEuSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!editUser || euPassword.length < 8) return;
    await apiFetch(`/users/${editUser.id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password: euPassword }),
    });
    setEuPassword("");
  };

  const toggleActive = async (userId: string, currentlyActive: boolean) => {
    const path = currentlyActive ? `/users/${userId}/deactivate` : `/users/${userId}/activate`;
    await apiFetch(path, { method: "POST" });
    void loadUsers();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.users_title}
        description={t.users_subtitle}
        actions={(
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
              onClick={loadUsers}
            >
              <RefreshCw className="size-3.5" />
              {t.common_refresh}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg gap-1.5 px-3.5"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="size-3.5" />
              {t.users_new}
            </Button>
          </>
        )}
      />

      {!loading && !error ? (
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <AdminInlineMetric
            icon={UsersRound}
            tone="sky"
            label={t.users_count}
            value={metrics.total}
            description={t.common_registry}
          />
          <AdminInlineMetric
            icon={UserRound}
            tone="emerald"
            label={t.users_active}
            value={metrics.active}
            description={t.users_status}
          />
          <AdminInlineMetric
            icon={UserRound}
            tone="amber"
            label={t.users_inactive}
            value={metrics.inactive}
            description={t.users_status}
          />
          <AdminInlineMetric
            icon={Shield}
            tone="slate"
            label={t.users_admins}
            value={metrics.admins}
            description={t.users_role}
          />
        </div>
      ) : null}

      {!loading && !error ? (
        <AdminToolbar>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder={t.common_search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-[240px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>
        </AdminToolbar>
      ) : null}

      <Sheet open={showCreate} onOpenChange={handleCreateSheetOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
          <form onSubmit={onSubmitCreate} className="flex min-h-0 flex-1 flex-col">
            <AdminSheetScaffold
              title={t.users_create_title}
              description={t.users_subtitle}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.users_cancel}
                  submitLabel={t.users_create_btn}
                  submittingLabel={t.users_creating}
                  submitting={creating}
                  submitDisabled={Boolean(newPasswordConfirm && newPassword !== newPasswordConfirm)}
                  onCancel={closeCreateSheet}
                />
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_name}</Label>
                    <Input required placeholder="Max Muller" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 rounded-lg bg-card" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_email}</Label>
                    <Input type="email" required placeholder="max@gmed.de" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-9 rounded-lg bg-card" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_role}</Label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v ?? "")}>
                    <SelectTrigger className="h-9 w-full rounded-lg bg-card">
                      <SelectValue>{roleLabel(newRole)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>{roleLabel(key)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_password}</Label>
                    <Input type="password" required minLength={8} placeholder={t.users_password_hint} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-9 rounded-lg bg-card" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.users_confirm_password}
                    </Label>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      placeholder={t.users_password_hint}
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      className={cn("h-9 rounded-lg bg-card", newPasswordConfirm && newPassword !== newPasswordConfirm && "border-rose-400 ring-2 ring-rose-100")}
                    />
                    {newPasswordConfirm && newPassword !== newPasswordConfirm ? (
                      <p className="text-xs text-rose-600">
                        {t.users_password_mismatch}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={editUser !== null} onOpenChange={handleEditSheetOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void saveUser();
            }}
          >
            <AdminSheetScaffold
              title={`${t.patients_edit} - ${editUser?.name ?? ""}`}
              description={editUser?.email}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submitting={euSaving}
                  onCancel={closeEditSheet}
                />
              )}
            >
              <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_name}</Label>
                    <Input value={euName} onChange={(e) => setEuName(e.target.value)} className="h-9 rounded-lg bg-card" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_email}</Label>
                    <Input type="email" value={euEmail} onChange={(e) => setEuEmail(e.target.value)} className="h-9 rounded-lg bg-card" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_role}</Label>
                  <Select value={euRole} onValueChange={(v) => setEuRole(v ?? "")}>
                    <SelectTrigger className="h-9 w-full rounded-lg bg-card">
                      <SelectValue>{roleLabel(euRole)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>{roleLabel(key)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                    {t.users_reset_password}
                  </Label>
                  <div className="flex gap-3">
                    <Input type="password" placeholder={t.users_password_hint} value={euPassword} onChange={(e) => setEuPassword(e.target.value)} className="h-9 rounded-lg bg-card" />
                    <Button type="button" variant="outline" className="h-9 px-3.5 rounded-lg" disabled={euPassword.length < 8 || euSaving} onClick={resetPassword}>
                      {t.users_reset_button}
                    </Button>
                  </div>
                </div>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      {loading ? <TabLoader /> : null}
      {!loading && error ? <Banner tone="error">{error}</Banner> : null}

      {!loading && !error ? (
        <AdminTableCard
          title={t.users_title}
          description={t.users_subtitle}
          count={filtered.length}
          className="overflow-hidden"
        >
          {filtered.length === 0 ? (
            <div className="p-4">
              <EmptyCell>{search ? t.users_empty_no_results : t.users_empty_no_users}</EmptyCell>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[2.5fr_2.5fr_1.5fr_1fr_1.2fr_1.5fr] gap-3 px-5 py-3 border-b border-border/50 bg-slate-900">
                {[t.users_name, t.users_email, t.users_role, t.users_status, t.users_created, t.users_actions].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{h}</span>
                ))}
              </div>

              {filtered.map((user, idx) => (
                <div
                  key={user.id}
                  className={cn(
                    "grid grid-cols-[2.5fr_2.5fr_1.5fr_1fr_1.2fr_1.5fr] gap-3 items-center px-5 py-3 transition-colors hover:bg-slate-50/60",
                    idx < filtered.length - 1 && "border-b border-border/30",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center justify-center size-9 shrink-0 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                      {initials(user.name)}
                    </div>
                    <span className="text-sm font-medium text-slate-900 truncate">{user.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5 min-w-0">
                    <Mail className="size-3.5 text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-500 truncate">{user.email}</span>
                  </div>

                  <div>
                    <Badge className={cn("font-medium", ROLE_COLORS[user.role] ?? ROLE_COLORS.it_admin)}>
                      {roleLabel(user.role)}
                    </Badge>
                  </div>

                  <div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium",
                      user.is_active ? "text-emerald-600" : "text-slate-400",
                    )}>
                      <span className={cn("size-1.5 rounded-full", user.is_active ? "bg-emerald-500" : "bg-slate-300")} />
                      {user.is_active ? t.users_active : t.users_inactive}
                    </span>
                  </div>

                  <span className="text-xs text-slate-400">{formatDate(user.created_at)}</span>

                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="xs" className="rounded-lg" onClick={() => openEdit(user)}>
                      {t.patients_edit}
                    </Button>
                    <Button
                      variant={user.is_active ? "destructive" : "outline"}
                      size="xs"
                      className="rounded-lg"
                      onClick={() => toggleActive(user.id, user.is_active)}
                    >
                      {user.is_active ? t.users_deactivate : t.users_activate}
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </AdminTableCard>
      ) : null}
    </div>
  );
}
