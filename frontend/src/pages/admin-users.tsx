import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shield,
  UserRound,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function cardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  tone: "sky" | "emerald" | "amber" | "slate";
}) {
  const toneClass =
    tone === "sky"
      ? "bg-sky-100 text-sky-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : tone === "amber"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-700";

  return (
    <div className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
        <span className={cn("rounded-2xl p-2", toneClass)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminUsersPage() {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newRole, setNewRole] = useState<string>("patient_manager");

  // edit dialog
  const [editUser, setEditUser] = useState<User | null>(null);
  const [euName, setEuName] = useState("");
  const [euEmail, setEuEmail] = useState("");
  const [euRole, setEuRole] = useState("");
  const [euPassword, setEuPassword] = useState("");
  const [euSaving, setEuSaving] = useState(false);

  const roleLabel = useCallback((role: string) => tr[`role_${role}`] ?? role, [tr]);

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
        roleLabel(u.role).toLowerCase().includes(q)
    );
  }, [users, search, roleLabel]);

  // -- create --
  const onSubmitCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      setCreateError(lang === "de" ? "Passwörter stimmen nicht überein" : "Пароли не совпадают");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch<User>("/users", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, name: newName, password: newPassword, role: newRole }),
      });
      setShowCreate(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setNewRole("patient_manager");
      void loadUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  // -- edit --
  const openEdit = (u: User) => {
    setEuName(u.name);
    setEuEmail(u.email);
    setEuRole(u.role);
    setEuPassword("");
    setEditUser(u);
  };

  const saveUser = async () => {
    if (!editUser) return;
    setEuSaving(true);
    try {
      await apiFetch(`/users/${editUser.id}/update`, {
        method: "POST",
        body: JSON.stringify({ name: euName, email: euEmail, role: euRole }),
      });
      setEditUser(null);
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

  // -- render --
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">{t.users_title}</h1>
          <p className="text-sm text-slate-500 mt-1">{t.users_subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadUsers} className="gap-2">
            <RefreshCw className="size-3.5" />
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="size-4" />
            {t.users_new}
          </Button>
        </div>
      </div>

      {/* Metrics */}
      {!loading && !error && (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard icon={UsersRound} label={t.users_count} value={String(metrics.total)} tone="sky" />
          <MetricCard icon={UserRound} label={t.users_active} value={String(metrics.active)} tone="emerald" />
          <MetricCard icon={UserRound} label={t.users_inactive} value={String(metrics.inactive)} tone="amber" />
          <MetricCard icon={Shield} label="Admins" value={String(metrics.admins)} tone="slate" />
        </div>
      )}

      {/* Search */}
      {!loading && !error && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            placeholder={t.common_search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9 rounded-xl border-slate-200 bg-white"
          />
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.users_create_title}</DialogTitle>
            <DialogDescription>{t.users_subtitle}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmitCreate} className="grid gap-5 py-2">
            {createError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_name}</Label>
                <Input required placeholder="Max Müller" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_email}</Label>
                <Input type="email" required placeholder="max@gmed.de" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="space-y-2.5">
              <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_role}</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v ?? "")}>
                <SelectTrigger className="w-full h-11 rounded-xl">
                  <SelectValue>{roleLabel(newRole)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{roleLabel(key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_password}</Label>
                <Input type="password" required minLength={8} placeholder={t.users_password_hint} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                  {lang === "de" ? "Passwort bestätigen" : "Подтвердите пароль"}
                </Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  placeholder={t.users_password_hint}
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  className={cn("h-10 rounded-xl", newPasswordConfirm && newPassword !== newPasswordConfirm && "border-rose-400 ring-2 ring-rose-100")}
                />
                {newPasswordConfirm && newPassword !== newPasswordConfirm && (
                  <p className="text-xs text-rose-600">
                    {lang === "de" ? "Passwörter stimmen nicht überein" : "Пароли не совпадают"}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>{t.users_cancel}</Button>
              <Button type="submit" disabled={creating || (!!newPasswordConfirm && newPassword !== newPasswordConfirm)}>
                {creating ? t.users_creating : t.users_create_btn}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editUser !== null} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.patients_edit} — {editUser?.name}</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_name}</Label>
                <Input value={euName} onChange={(e) => setEuName(e.target.value)} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_email}</Label>
                <Input type="email" value={euEmail} onChange={(e) => setEuEmail(e.target.value)} className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="space-y-2.5">
              <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.users_role}</Label>
              <Select value={euRole} onValueChange={(v) => setEuRole(v ?? "")}>
                <SelectTrigger className="w-full h-11 rounded-xl">
                  <SelectValue>{roleLabel(euRole)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{roleLabel(key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2.5">
              <Label className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                {lang === "de" ? "Passwort zurücksetzen" : "Сброс пароля"}
              </Label>
              <div className="flex gap-3">
                <Input type="password" placeholder={t.users_password_hint} value={euPassword} onChange={(e) => setEuPassword(e.target.value)} className="h-10 rounded-xl" />
                <Button type="button" variant="outline" className="h-10 px-5 rounded-xl" disabled={euPassword.length < 8} onClick={resetPassword}>
                  Reset
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditUser(null)}>{t.common_cancel}</Button>
            <Button disabled={euSaving} onClick={saveUser}>
              {euSaving ? <LoaderCircle className="size-4 animate-spin" /> : t.common_save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Users list */}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <LoaderCircle className="size-6 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-900">
            {search ? (lang === "de" ? "Keine Ergebnisse" : "Нет результатов") : (lang === "de" ? "Keine Benutzer" : "Нет пользователей")}
          </p>
        </div>
      ) : (
        <div className={cardClass("overflow-hidden")}>
          {/* Table header */}
          <div className="grid grid-cols-[2.5fr_2.5fr_1.5fr_1fr_1.2fr_1.5fr] gap-3 px-5 py-3 border-b border-border/50 bg-slate-900">
            {[t.users_name, t.users_email, t.users_role, t.users_status, t.users_created, t.users_actions].map((h) => (
              <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{h}</span>
            ))}
          </div>

          {/* Rows */}
          {filtered.map((user, idx) => (
            <div
              key={user.id}
              className={cn(
                "grid grid-cols-[2.5fr_2.5fr_1.5fr_1fr_1.2fr_1.5fr] gap-3 items-center px-5 py-3 transition-colors hover:bg-slate-50/60",
                idx < filtered.length - 1 && "border-b border-border/30"
              )}
            >
              {/* Name + avatar */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center size-9 shrink-0 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                  {initials(user.name)}
                </div>
                <span className="text-sm font-medium text-slate-900 truncate">{user.name}</span>
              </div>

              {/* Email */}
              <div className="flex items-center gap-1.5 min-w-0">
                <Mail className="size-3.5 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-500 truncate">{user.email}</span>
              </div>

              {/* Role badge */}
              <div>
                <Badge className={cn("font-medium", ROLE_COLORS[user.role] ?? ROLE_COLORS.it_admin)}>
                  {roleLabel(user.role)}
                </Badge>
              </div>

              {/* Status */}
              <div>
                <span className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium",
                  user.is_active ? "text-emerald-600" : "text-slate-400"
                )}>
                  <span className={cn("size-1.5 rounded-full", user.is_active ? "bg-emerald-500" : "bg-slate-300")} />
                  {user.is_active ? t.users_active : t.users_inactive}
                </span>
              </div>

              {/* Created */}
              <span className="text-xs text-slate-400">{formatDate(user.created_at)}</span>

              {/* Actions */}
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
        </div>
      )}
    </div>
  );
}
