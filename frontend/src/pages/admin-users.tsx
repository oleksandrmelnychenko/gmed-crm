import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Unlock,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSheetScaffold,
  SheetFormFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  Banner,
  PageHeader,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import {
  createAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  resetUserTotp,
  revokeAdminUserSessions,
  setAdminUserActive,
  unlockAdminUser,
  updateAdminUser,
} from "@/pages/admin/data/admin-api";
import {
  ADMIN_USER_ROLE_KEYS,
  canSaveAdminUserEdit,
  describeAdminUserError,
  getAdminUserActions,
  getAssignableAdminUserRoles,
  getOptionalAdminPasswordError,
  getRequiredAdminPasswordError,
  generateAdminPassword,
  isAdminUserLocked,
  isPasswordConfirmationMismatch,
} from "@/pages/admin-users.helpers";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  password_reset_required: boolean;
  totp_enrolled: boolean;
  active_sessions: number;
  last_login_at: string | null;
  created_at: string;
  /** Present only in the response that generated it. */
  one_time_password?: string;
}

type ResetPasswordResult = {
  password_reset_required: boolean;
  sessions_revoked: boolean;
  one_time_password?: string;
};

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

const ADMIN_USER_REALTIME_EVENTS = [
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.activated",
  "user.password_reset",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
  "session.revoked",
] as const;

const ADMIN_USER_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const ADMIN_USER_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type PasswordMode = "one_time" | "manual";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(value: string) {
  try {
    return ADMIN_USER_DATE_FORMATTER.format(new Date(value));
  } catch {
    return value.split("T")[0];
  }
}

function formatDateTime(value: string) {
  try {
    return ADMIN_USER_DATE_TIME_FORMATTER.format(new Date(value));
  } catch {
    return value.replace("T", " ").slice(0, 16);
  }
}

function DotTitle({ children }: { children: ReactNode }) {
  return (
    <span className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{children}</span>
    </span>
  );
}

function DotSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
      <h3>
        <DotTitle>{title}</DotTitle>
      </h3>
      {children}
    </section>
  );
}

/**
 * The one-time password, shown exactly once with a copy button. The value
 * lives only in component state and disappears when the sheet closes.
 */
function OneTimePasswordReveal({
  password,
  title,
  hint,
  copyLabel,
  copiedLabel,
}: {
  password: string;
  title: string;
  hint: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, permissions); the
      // password stays visible so it can still be copied by hand.
      setCopied(false);
    }
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5"
      role="status"
      data-testid="one-time-password-panel"
    >
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
        <KeyRound className="size-4" />
        {title}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="select-all rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-base tracking-wide text-foreground"
          data-testid="one-time-password"
        >
          {password}
        </code>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-1.5 rounded-lg bg-white px-3.5"
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <p className="text-xs text-amber-900/80">{hint}</p>
    </section>
  );
}

type AdminUsersState = {
  users: User[];
  loading: boolean;
  error: string | null;
  search: string;
  showCreate: boolean;
  creating: boolean;
  createError: string | null;
  newName: string;
  newEmail: string;
  newPasswordMode: PasswordMode;
  newPassword: string;
  newPasswordConfirm: string;
  newPasswordVisible: boolean;
  newRole: string;
  /** Filled after a successful creation with a generated password. */
  createdUser: { name: string; email: string; oneTimePassword: string } | null;
  editUser: User | null;
  editError: string | null;
  editNotice: string | null;
  euName: string;
  euEmail: string;
  euRole: string;
  euPassword: string;
  euPasswordConfirm: string;
  euPasswordVisible: boolean;
  passwordResetSuccess: boolean;
  generatedResetPassword: string | null;
  confirmPasswordReset: boolean;
  confirmGenerateReset: boolean;
  confirmRevokeSessions: User | null;
  unlockingUserId: string | null;
  revokingUserId: string | null;
  euSaving: boolean;
};

type AdminUsersPatch =
  | Partial<AdminUsersState>
  | ((current: AdminUsersState) => Partial<AdminUsersState>);

function adminUsersReducer(state: AdminUsersState, patch: AdminUsersPatch): AdminUsersState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createAdminUsersFieldPatch<K extends keyof AdminUsersState>(
  field: K,
  value: SetStateAction<AdminUsersState[K]>,
): AdminUsersPatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: AdminUsersState[K]) => AdminUsersState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<AdminUsersState>;
  };
}

const INITIAL_CREATE_FIELDS = {
  showCreate: false,
  creating: false,
  createError: null,
  newName: "",
  newEmail: "",
  newPasswordMode: "one_time" as PasswordMode,
  newPassword: "",
  newPasswordConfirm: "",
  newPasswordVisible: false,
  newRole: "patient_manager",
  createdUser: null,
} satisfies Partial<AdminUsersState>;

const INITIAL_EDIT_FIELDS = {
  editUser: null,
  editError: null,
  editNotice: null,
  euName: "",
  euEmail: "",
  euRole: "",
  euPassword: "",
  euPasswordConfirm: "",
  euPasswordVisible: false,
  passwordResetSuccess: false,
  generatedResetPassword: null,
  confirmPasswordReset: false,
  confirmGenerateReset: false,
} satisfies Partial<AdminUsersState>;

function useAdminUsersPageContent() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const [adminUsersState, dispatchAdminUsersState] = useReducer(
    adminUsersReducer,
    undefined,
    (): AdminUsersState => ({
      users: [],
      loading: true,
      error: null,
      search: "",
      ...INITIAL_CREATE_FIELDS,
      ...INITIAL_EDIT_FIELDS,
      confirmRevokeSessions: null,
      unlockingUserId: null,
      revokingUserId: null,
      euSaving: false,
    }),
  );
  const {
    users,
    loading,
    error,
    search,
    showCreate,
    creating,
    createError,
    newName,
    newEmail,
    newPasswordMode,
    newPassword,
    newPasswordConfirm,
    newPasswordVisible,
    newRole,
    createdUser,
    editUser,
    editError,
    editNotice,
    euName,
    euEmail,
    euRole,
    euPassword,
    euPasswordConfirm,
    euPasswordVisible,
    passwordResetSuccess,
    generatedResetPassword,
    confirmPasswordReset,
    confirmGenerateReset,
    confirmRevokeSessions,
    unlockingUserId,
    revokingUserId,
    euSaving,
  } = adminUsersState;
  const setAdminUsersField = <K extends keyof AdminUsersState>(
    field: K,
    value: SetStateAction<AdminUsersState[K]>,
  ) => dispatchAdminUsersState(createAdminUsersFieldPatch(field, value));
  const setUsers = (value: SetStateAction<User[]>) =>
    setAdminUsersField("users", value);
  const setLoading = (value: SetStateAction<boolean>) =>
    setAdminUsersField("loading", value);
  const setError = (value: SetStateAction<string | null>) =>
    setAdminUsersField("error", value);
  const setSearch = (value: SetStateAction<string>) =>
    setAdminUsersField("search", value);
  const setShowCreate = (value: SetStateAction<boolean>) =>
    setAdminUsersField("showCreate", value);
  const setCreating = (value: SetStateAction<boolean>) =>
    setAdminUsersField("creating", value);
  const setCreateError = (value: SetStateAction<string | null>) =>
    setAdminUsersField("createError", value);
  const setNewName = (value: SetStateAction<string>) =>
    setAdminUsersField("newName", value);
  const setNewEmail = (value: SetStateAction<string>) =>
    setAdminUsersField("newEmail", value);
  const setNewPasswordMode = (value: SetStateAction<PasswordMode>) =>
    setAdminUsersField("newPasswordMode", value);
  const setNewPassword = (value: SetStateAction<string>) =>
    setAdminUsersField("newPassword", value);
  const setNewPasswordConfirm = (value: SetStateAction<string>) =>
    setAdminUsersField("newPasswordConfirm", value);
  const setNewPasswordVisible = (value: SetStateAction<boolean>) =>
    setAdminUsersField("newPasswordVisible", value);
  const setNewRole = (value: SetStateAction<string>) =>
    setAdminUsersField("newRole", value);
  const setEditError = (value: SetStateAction<string | null>) =>
    setAdminUsersField("editError", value);
  const setEditNotice = (value: SetStateAction<string | null>) =>
    setAdminUsersField("editNotice", value);
  const setEuName = (value: SetStateAction<string>) =>
    setAdminUsersField("euName", value);
  const setEuEmail = (value: SetStateAction<string>) =>
    setAdminUsersField("euEmail", value);
  const setEuRole = (value: SetStateAction<string>) =>
    setAdminUsersField("euRole", value);
  const setEuPassword = (value: SetStateAction<string>) =>
    setAdminUsersField("euPassword", value);
  const setEuPasswordConfirm = (value: SetStateAction<string>) =>
    setAdminUsersField("euPasswordConfirm", value);
  const setEuPasswordVisible = (value: SetStateAction<boolean>) =>
    setAdminUsersField("euPasswordVisible", value);
  const setPasswordResetSuccess = (value: SetStateAction<boolean>) =>
    setAdminUsersField("passwordResetSuccess", value);
  const setConfirmPasswordReset = (value: SetStateAction<boolean>) =>
    setAdminUsersField("confirmPasswordReset", value);
  const setConfirmGenerateReset = (value: SetStateAction<boolean>) =>
    setAdminUsersField("confirmGenerateReset", value);
  const setConfirmRevokeSessions = (value: SetStateAction<User | null>) =>
    setAdminUsersField("confirmRevokeSessions", value);
  const setUnlockingUserId = (value: SetStateAction<string | null>) =>
    setAdminUsersField("unlockingUserId", value);
  const setRevokingUserId = (value: SetStateAction<string | null>) =>
    setAdminUsersField("revokingUserId", value);
  const setEuSaving = (value: SetStateAction<boolean>) =>
    setAdminUsersField("euSaving", value);

  const roleLabel = useCallback(
    (role: string) => tr[`role_${role}`] ?? formatUnknownValue(role, t),
    [t, tr],
  );
  // Only the CEO (`users.manage_ceo`) may assign the CEO role or touch an
  // existing CEO account; the technical admin manages every other account.
  const { user: currentUser } = useAuth();
  const canManageCeo = hasCapability(currentUser, "users.manage_ceo");
  const currentUserId = currentUser?.id ?? null;
  const actionsFor = useCallback(
    (u: User) => getAdminUserActions(u, { canManageCeo, currentUserId }),
    [canManageCeo, currentUserId],
  );
  const assignableRoles = useMemo(
    () => getAssignableAdminUserRoles(canManageCeo),
    [canManageCeo],
  );
  const describeError = useCallback(
    (e: unknown, targetRole?: string) => describeAdminUserError(e, t, targetRole),
    [t],
  );
  const closeUnsavedConfirmMessage = t.common_discard_unsaved_confirm;
  const manualPassword = newPasswordMode === "manual";
  const newPasswordError =
    manualPassword && newPassword
      ? getRequiredAdminPasswordError(newPassword, t)
      : null;
  const newPasswordMismatch =
    manualPassword &&
    isPasswordConfirmationMismatch(newPassword, newPasswordConfirm);
  const euPasswordError = getOptionalAdminPasswordError(euPassword, t);
  const euPasswordMismatch = isPasswordConfirmationMismatch(
    euPassword,
    euPasswordConfirm,
  );
  const euPasswordConfirmed =
    euPassword.length > 0 && euPassword === euPasswordConfirm;
  const editProfileDirty = Boolean(
    editUser &&
      (euName !== editUser.name ||
        euEmail !== editUser.email ||
        euRole !== editUser.role),
  );
  const editCanSave = canSaveAdminUserEdit({
    profileDirty: editProfileDirty,
    password: euPassword,
    confirmation: euPasswordConfirm,
    passwordError: euPasswordError,
    saving: euSaving,
  });
  const editActions = editUser ? actionsFor(editUser) : null;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers<User>();
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

  useRealtimeSubscription(ADMIN_USER_REALTIME_EVENTS, () => {
    clearApiCache("/users");
    void loadUsers();
  });

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
  const usersPagination = useDataTablePagination(filtered, search);

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        id: "name",
        label: t.users_name,
        accessor: (user) => user.name,
        searchable: true,
        required: true,
        pinned: "left",
        width: 260,
        render: (user) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
              {initials(user.name)}
            </div>
            <span className="truncate text-xs font-medium text-foreground">
              {user.name}
            </span>
          </div>
        ),
      },
      {
        id: "email",
        label: t.users_email,
        accessor: (user) => user.email,
        searchable: true,
        required: true,
        pinned: "left",
        width: 280,
        render: (user) => (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
            <Mail className="size-3.5 shrink-0 text-foreground/70" />
            <span className="truncate">{user.email}</span>
          </span>
        ),
      },
      {
        id: "role",
        label: t.users_role,
        accessor: (user) => roleLabel(user.role),
        filterType: "enum",
        filterOptions: ADMIN_USER_ROLE_KEYS.map((role) => ({
          value: roleLabel(role),
          label: roleLabel(role),
        })),
        searchable: true,
        sortable: true,
        width: 190,
        render: (user) => (
          <Badge
            className={cn(
              "font-medium",
              ROLE_COLORS[user.role] ?? ROLE_COLORS.it_admin,
            )}
          >
            {roleLabel(user.role)}
          </Badge>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (user) => user.is_active,
        filterType: "boolean",
        sortable: true,
        width: 210,
        render: (user) => {
          const locked = isAdminUserLocked(user);
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Badge
                variant="outline"
                title={
                  locked && user.locked_until
                    ? `${t.users_locked_until} ${formatDateTime(user.locked_until)}`
                    : undefined
                }
                className={cn(
                  "rounded-full",
                  locked
                    ? "border-red-300 bg-red-50 text-red-700"
                    : user.is_active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-border/60 bg-muted/25 text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    locked
                      ? "bg-red-600"
                      : user.is_active
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/45",
                  )}
                />
                {locked
                  ? t.users_locked
                  : user.is_active
                    ? t.users_active
                    : t.users_inactive}
              </Badge>
              {user.password_reset_required ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-amber-300 bg-amber-50 text-amber-800"
                  data-testid="password-reset-required"
                >
                  <KeyRound className="size-3" />
                  {t.users_password_reset_required_badge}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "totp",
        label: t.users_totp,
        accessor: (user) => user.totp_enrolled,
        filterType: "boolean",
        sortable: true,
        width: 150,
        render: (user) => (
          <span
            className={cn(
              "text-xs",
              user.totp_enrolled ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            {user.totp_enrolled ? t.users_totp_enrolled : t.users_totp_missing}
          </span>
        ),
      },
      {
        id: "last_login_at",
        label: t.users_last_login,
        accessor: (user) => user.last_login_at ?? "",
        filterType: "date",
        sortable: true,
        width: 170,
        render: (user) => (
          <span className="text-xs tabular-nums text-foreground">
            {user.last_login_at
              ? formatDateTime(user.last_login_at)
              : <span className="text-muted-foreground">{t.users_never_logged_in}</span>}
          </span>
        ),
      },
      {
        id: "active_sessions",
        label: t.users_sessions,
        accessor: (user) => user.active_sessions,
        filterType: "number",
        sortable: true,
        width: 110,
        render: (user) => (
          <span className="text-xs tabular-nums text-foreground">
            {user.active_sessions}
          </span>
        ),
      },
      {
        id: "created_at",
        label: t.users_created,
        accessor: (user) => user.created_at,
        filterType: "date",
        sortable: true,
        width: 170,
        render: (user) => (
          <span className="text-xs tabular-nums text-foreground">
            {formatDate(user.created_at)}
          </span>
        ),
      },
    ],
    [roleLabel, t],
  );

  const onSubmitCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (manualPassword) {
      const passwordError = getRequiredAdminPasswordError(newPassword, t);
      if (passwordError) {
        setCreateError(passwordError);
        return;
      }
      if (isPasswordConfirmationMismatch(newPassword, newPasswordConfirm)) {
        setCreateError(t.users_password_mismatch);
        return;
      }
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createAdminUser<User>({
        email: newEmail,
        name: newName,
        role: newRole,
        ...(manualPassword ? { password: newPassword } : {}),
      });
      clearApiCache("/users");
      if (created.one_time_password) {
        // Keep the sheet open: the password is shown exactly once.
        dispatchAdminUsersState({
          createError: null,
          newPassword: "",
          newPasswordConfirm: "",
          createdUser: {
            name: created.name,
            email: created.email,
            oneTimePassword: created.one_time_password,
          },
        });
      } else {
        closeCreateSheet();
      }
      void loadUsers();
    } catch (e) {
      setCreateError(describeError(e, newRole));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u: User) => {
    if (!actionsFor(u).canEdit) {
      return;
    }
    dispatchAdminUsersState({
      ...INITIAL_EDIT_FIELDS,
      editUser: u,
      euName: u.name,
      euEmail: u.email,
      euRole: u.role,
    });
  };

  const closeCreateSheet = useCallback(() => {
    dispatchAdminUsersState({ ...INITIAL_CREATE_FIELDS });
  }, []);

  const closeEditSheet = useCallback(() => {
    dispatchAdminUsersState({ ...INITIAL_EDIT_FIELDS });
  }, []);

  const createDirty =
    createdUser === null &&
    (newName.trim().length > 0 ||
      newEmail.trim().length > 0 ||
      newPassword.length > 0 ||
      newPasswordConfirm.length > 0 ||
      newRole !== "patient_manager");

  const editDirty =
    editProfileDirty ||
    euPassword.length > 0 ||
    euPasswordConfirm.length > 0;

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
    const passwordDirty =
      euPassword.length > 0 || euPasswordConfirm.length > 0;
    if (passwordDirty) {
      const passwordError = getRequiredAdminPasswordError(euPassword, t);
      if (passwordError) {
        setEditError(passwordError);
        return;
      }
      if (!euPasswordConfirmed) {
        setEditError(t.users_password_mismatch);
        return;
      }
    }
    if (!editProfileDirty && !passwordDirty) return;
    setEuSaving(true);
    setEditError(null);
    try {
      if (editProfileDirty) {
        await updateAdminUser(editUser.id, {
          name: euName,
          email: euEmail,
          role: euRole,
        });
      }
      if (passwordDirty) {
        await resetAdminUserPassword(editUser.id, {
          new_password: euPassword,
        });
      }
      clearApiCache("/users");
      closeEditSheet();
      void loadUsers();
    } catch (e) {
      setEditError(describeError(e, editUser.role));
    } finally {
      setEuSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!editUser) return;
    const passwordError = getRequiredAdminPasswordError(euPassword, t);
    if (passwordError) {
      setEditError(passwordError);
      return;
    }
    if (!euPasswordConfirmed) {
      setEditError(t.users_password_mismatch);
      return;
    }
    setEuSaving(true);
    setConfirmPasswordReset(false);
    setEditError(null);
    try {
      await resetAdminUserPassword(editUser.id, { new_password: euPassword });
      dispatchAdminUsersState({
        euPassword: "",
        euPasswordConfirm: "",
        euPasswordVisible: false,
        passwordResetSuccess: true,
        generatedResetPassword: null,
      });
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setEditError(describeError(e, editUser.role));
    } finally {
      setEuSaving(false);
    }
  };

  const generateOneTimeResetPassword = async () => {
    if (!editUser) return;
    setEuSaving(true);
    setConfirmGenerateReset(false);
    setEditError(null);
    try {
      const result = await resetAdminUserPassword(editUser.id, {
        generate: true,
      }) as ResetPasswordResult;
      dispatchAdminUsersState({
        euPassword: "",
        euPasswordConfirm: "",
        euPasswordVisible: false,
        passwordResetSuccess: true,
        generatedResetPassword: result.one_time_password ?? null,
      });
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setEditError(describeError(e, editUser.role));
    } finally {
      setEuSaving(false);
    }
  };

  const generatePassword = () => {
    const password = generateAdminPassword();
    dispatchAdminUsersState({
      euPassword: password,
      euPasswordConfirm: password,
      euPasswordVisible: true,
      passwordResetSuccess: false,
      generatedResetPassword: null,
      editError: null,
    });
  };

  const generateNewPassword = () => {
    const password = generateAdminPassword();
    setNewPassword(password);
    setNewPasswordConfirm(password);
    setNewPasswordVisible(true);
    setCreateError(null);
  };

  const unlockUser = async (user: User) => {
    setUnlockingUserId(user.id);
    setError(null);
    try {
      await unlockAdminUser(user.id);
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setError(describeError(e, user.role));
    } finally {
      setUnlockingUserId(null);
    }
  };

  const revokeSessions = async (user: User) => {
    setRevokingUserId(user.id);
    setConfirmRevokeSessions(null);
    setError(null);
    try {
      await revokeAdminUserSessions(user.id);
      clearApiCache("/users");
      if (editUser?.id === user.id) {
        setEditNotice(t.users_sessions_revoked);
      }
      void loadUsers();
    } catch (e) {
      const message = describeError(e, user.role);
      if (editUser?.id === user.id) {
        setEditError(message);
      } else {
        setError(message);
      }
    } finally {
      setRevokingUserId(null);
    }
  };

  const toggleActive = async (user: User) => {
    setError(null);
    try {
      await setAdminUserActive(user.id, !user.is_active);
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setError(describeError(e, user.role));
    }
  };

  const resetTotp = () => {
    if (!editUser) return;
    setEditError(null);
    setEditNotice(null);
    resetUserTotp(editUser.id)
      .then(() => {
        setEditNotice(t.uiText.twofactor_admin_reset_done);
        clearApiCache("/users");
        void loadUsers();
      })
      .catch((e: unknown) => setEditError(describeError(e, editUser.role)));
  };

  const fieldLabelClass = "text-[11.5px] font-medium text-muted-foreground leading-tight";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.users_title}
        description={t.users_subtitle}
        actions={(
          <>
            <AdminGuideButton title={t.users_title} description={t.users_subtitle} showTableToolbarGuide={false} />
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

      <Sheet
        open={showCreate}
        onOpenChange={handleCreateSheetOpenChange}
        dirty={createDirty}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          {createdUser ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <AdminSheetScaffold
                title={t.users_created_title}
                description={`${createdUser.name} · ${createdUser.email}`}
                footer={(
                  <SheetFormFooter
                    cancelLabel={t.users_done}
                    submitLabel={t.users_done}
                    onCancel={closeCreateSheet}
                    onSubmit={closeCreateSheet}
                  />
                )}
              >
                <OneTimePasswordReveal
                  password={createdUser.oneTimePassword}
                  title={t.users_one_time_password_title}
                  hint={t.users_one_time_password_shown_once}
                  copyLabel={t.users_copy_password}
                  copiedLabel={t.users_copied}
                />
              </AdminSheetScaffold>
            </div>
          ) : (
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
                    submitDisabled={Boolean(newPasswordError || newPasswordMismatch)}
                    onCancel={closeCreateSheet}
                  />
                )}
              >
                {createError ? <Banner tone="error">{createError}</Banner> : null}
                <DotSection title={t.users_create_title}>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className={fieldLabelClass}>{t.users_name}</Label>
                      <Input required placeholder={t.users_name_placeholder} value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 rounded-lg bg-field" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className={fieldLabelClass}>{t.users_email}</Label>
                      <Input type="email" required placeholder={t.users_email_placeholder} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-9 rounded-lg bg-field" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={fieldLabelClass}>{t.users_role}</Label>
                    <NativeComboboxSelect
                      value={newRole}
                      aria-label={t.users_role}
                      onChange={(event) => setNewRole(event.target.value ?? "")}
                      className="h-9 w-full rounded-lg bg-field"
                    >
                      {assignableRoles.map((key) => (
                        <option key={key} value={key}>{roleLabel(key)}</option>
                      ))}
                    </NativeComboboxSelect>
                  </div>
                </DotSection>
                <DotSection title={t.users_password}>
                  <div
                    role="radiogroup"
                    aria-label={t.users_password}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {(
                      [
                        ["one_time", t.users_one_time_password_mode],
                        ["manual", t.users_manual_password_mode],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={newPasswordMode === mode}
                        onClick={() => {
                          setNewPasswordMode(mode);
                          setCreateError(null);
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                          newPasswordMode === mode
                            ? "border-[var(--brand)] bg-[var(--brand)]/5 text-foreground"
                            : "border-border/70 bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-2 rounded-full",
                            newPasswordMode === mode ? "bg-[var(--brand)]" : "bg-border",
                          )}
                        />
                        {label}
                      </button>
                    ))}
                  </div>
                  {manualPassword ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className={fieldLabelClass}>{t.users_password}</Label>
                          <div className="relative">
                            <Input
                              type={newPasswordVisible ? "text" : "password"}
                              required
                              minLength={8}
                              maxLength={256}
                              placeholder={t.users_password_policy_hint}
                              value={newPassword}
                              onChange={(e) => {
                                setNewPassword(e.target.value);
                                setCreateError(null);
                              }}
                              className={cn("h-9 rounded-lg bg-field pr-10", newPasswordError && "border-rose-400 ring-2 ring-rose-100")}
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={newPasswordVisible ? t.login_hide_password : t.login_show_password}
                              onClick={() => setNewPasswordVisible((visible) => !visible)}
                            >
                              {newPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </div>
                          {newPasswordError ? (
                            <p className="text-xs text-rose-600">
                              {newPasswordError}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t.users_password_policy_hint}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label className={fieldLabelClass}>
                            {t.users_confirm_password}
                          </Label>
                          <Input
                            type={newPasswordVisible ? "text" : "password"}
                            required
                            minLength={8}
                            maxLength={256}
                            placeholder={t.users_password_policy_hint}
                            value={newPasswordConfirm}
                            onChange={(e) => {
                              setNewPasswordConfirm(e.target.value);
                              setCreateError(null);
                            }}
                            className={cn("h-9 rounded-lg bg-field", newPasswordMismatch && "border-rose-400 ring-2 ring-rose-100")}
                          />
                          {newPasswordMismatch ? (
                            <p className="text-xs text-rose-600">
                              {t.users_password_mismatch}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          disabled={creating}
                          onClick={generateNewPassword}
                        >
                          {t.users_generate_password}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t.users_one_time_password_mode_hint}
                    </p>
                  )}
                </DotSection>
              </AdminSheetScaffold>
            </form>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editUser !== null}
        onOpenChange={handleEditSheetOpenChange}
        dirty={editDirty}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <div
            className="flex min-h-0 flex-1 flex-col"
          >
            <AdminSheetScaffold
              title={`${t.patients_edit} - ${editUser?.name ?? ""}`}
              description={editUser?.email}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submitting={euSaving}
                  submitDisabled={!editCanSave}
                  onCancel={closeEditSheet}
                  onSubmit={() => void saveUser()}
                />
              )}
            >
              {editError ? <Banner tone="error">{editError}</Banner> : null}
              {editNotice ? (
                <div
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  role="status"
                >
                  {editNotice}
                </div>
              ) : null}
              {passwordResetSuccess ? (
                <div
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  role="status"
                >
                  {t.users_password_reset_success}
                </div>
              ) : null}
              {generatedResetPassword ? (
                <OneTimePasswordReveal
                  password={generatedResetPassword}
                  title={t.users_one_time_password_title}
                  hint={t.users_one_time_password_shown_once}
                  copyLabel={t.users_copy_password}
                  copiedLabel={t.users_copied}
                />
              ) : null}
              <DotSection title={t.users_title}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className={fieldLabelClass}>{t.users_name}</Label>
                    <Input value={euName} onChange={(e) => setEuName(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className={fieldLabelClass}>{t.users_email}</Label>
                    <Input type="email" value={euEmail} onChange={(e) => setEuEmail(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className={fieldLabelClass}>{t.users_role}</Label>
                  <NativeComboboxSelect
                    value={euRole}
                    aria-label={t.users_role}
                    onChange={(event) => setEuRole(event.target.value ?? "")}
                    className="h-9 w-full rounded-lg bg-field"
                  >
                    {assignableRoles.map((key) => (
                      <option key={key} value={key}>{roleLabel(key)}</option>
                    ))}
                  </NativeComboboxSelect>
                </div>
              </DotSection>
              <DotSection title={t.users_sessions}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">{t.users_last_login}</dt>
                  <dd className="tabular-nums text-foreground">
                    {editUser?.last_login_at
                      ? formatDateTime(editUser.last_login_at)
                      : t.users_never_logged_in}
                  </dd>
                  <dt className="text-muted-foreground">{t.users_sessions}</dt>
                  <dd className="tabular-nums text-foreground">{editUser?.active_sessions ?? 0}</dd>
                  <dt className="text-muted-foreground">{t.users_totp}</dt>
                  <dd className="text-foreground">
                    {editUser?.totp_enrolled ? t.users_totp_enrolled : t.users_totp_missing}
                  </dd>
                  {editUser?.locked_until && isAdminUserLocked(editUser) ? (
                    <>
                      <dt className="text-muted-foreground">{t.users_locked_until}</dt>
                      <dd className="tabular-nums text-red-700">{formatDateTime(editUser.locked_until)}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="flex flex-wrap justify-end gap-2">
                  {editActions?.canUnlock ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 gap-1.5 rounded-lg px-3.5"
                      disabled={euSaving || unlockingUserId === editUser?.id}
                      onClick={() => editUser && void unlockUser(editUser)}
                    >
                      <Unlock className="size-3.5" />
                      {t.users_unlock}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 gap-1.5 rounded-lg px-3.5"
                    disabled={euSaving || !editActions?.canRevokeSessions || revokingUserId === editUser?.id}
                    onClick={() => setConfirmRevokeSessions(editUser)}
                  >
                    <LogOut className="size-3.5" />
                    {t.users_revoke_sessions}
                  </Button>
                </div>
              </DotSection>
              <DotSection title={t.uiText.twofactor_admin_reset}>
                <p className="text-xs text-muted-foreground">{t.uiText.twofactor_admin_reset_hint}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-9 rounded-lg px-3.5"
                  disabled={euSaving || !editActions?.canResetTotp}
                  onClick={resetTotp}
                >
                  {t.uiText.twofactor_admin_reset}
                </Button>
              </DotSection>
              <DotSection title={t.users_reset_password}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{t.users_one_time_password_mode_hint}</p>
                  <Button
                    type="button"
                    className="h-9 gap-1.5 rounded-lg px-3.5"
                    disabled={euSaving}
                    onClick={() => setConfirmGenerateReset(true)}
                  >
                    <KeyRound className="size-3.5" />
                    {t.users_generate_one_time_password}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                  <Label className={fieldLabelClass}>
                    {t.users_password}
                  </Label>
                  <div className="relative">
                    <Input
                      type={euPasswordVisible ? "text" : "password"}
                      minLength={8}
                      maxLength={256}
                      placeholder={t.users_password_policy_hint}
                      value={euPassword}
                      onChange={(e) => {
                        setEuPassword(e.target.value);
                        setEditError(null);
                        setPasswordResetSuccess(false);
                      }}
                      className={cn("h-9 rounded-lg bg-field pr-10", euPasswordError && "border-rose-400 ring-2 ring-rose-100")}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={euPasswordVisible ? t.login_hide_password : t.login_show_password}
                      onClick={() => setEuPasswordVisible((visible) => !visible)}
                    >
                      {euPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {euPasswordError ? (
                    <p className="text-xs text-rose-600">
                      {euPasswordError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t.users_password_policy_hint}
                    </p>
                  )}
                </div>
                  <div className="space-y-1.5">
                    <Label className={fieldLabelClass}>
                      {t.users_confirm_password}
                    </Label>
                    <Input
                      type={euPasswordVisible ? "text" : "password"}
                      minLength={8}
                      maxLength={256}
                      placeholder={t.users_confirm_password}
                      value={euPasswordConfirm}
                      onChange={(event) => {
                        setEuPasswordConfirm(event.target.value);
                        setEditError(null);
                        setPasswordResetSuccess(false);
                      }}
                      className={cn(
                        "h-9 rounded-lg bg-field",
                        euPasswordMismatch && "border-rose-400 ring-2 ring-rose-100",
                      )}
                    />
                    {euPasswordMismatch ? (
                      <p className="text-xs text-rose-600">{t.users_password_mismatch}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3.5"
                    disabled={euSaving}
                    onClick={generatePassword}
                  >
                    {t.users_generate_password}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3.5"
                    disabled={Boolean(euPasswordError) || !euPasswordConfirmed || euSaving}
                    onClick={() => setConfirmPasswordReset(true)}
                  >
                    {t.users_reset_button}
                  </Button>
                </div>
              </DotSection>
            </AdminSheetScaffold>
          </div>
        </SheetContent>
      </Sheet>

      {loading ? <TabLoader /> : null}
      {!loading && error ? <Banner tone="error">{error}</Banner> : null}

      {!loading && !error ? (
        <AdminTableCard
          title={<DotTitle>{t.users_title}</DotTitle>}
          description={t.users_subtitle}
          count={filtered.length}
          className="overflow-hidden"
        >
          <DataTableSurface
            rows={usersPagination.pagedRows}
            columns={columns}
            toolbarStart={
              <ToolbarField label={t.common_search} className="min-w-[220px] flex-1 sm:max-w-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t.common_search}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full rounded-md bg-field pl-8 text-xs"
                />
              </div>
              </ToolbarField>
            }
            toolbarAfter={
              <DataTablePager
                pageIndex={usersPagination.pageIndex}
                pageSize={usersPagination.pageSize}
                totalPages={usersPagination.totalPages}
                totalRows={usersPagination.totalRows}
                previousLabel={t.pagination_previous}
                nextLabel={t.pagination_next}
                onPageChange={usersPagination.onPageChange}
              />
            }
            defaultDensity="comfortable"
            defaultFrozenColumns={["name", "email"]}
            defaultSort={[{ field: "created_at", dir: "desc" }]}
            dictionary={tr}
            emptyState={
              <span className="text-sm text-muted-foreground">
                {search ? t.users_empty_no_results : t.users_empty_no_users}
              </span>
            }
            rowId={(user) => user.id}
            activeRowId={editUser?.id ?? null}
            onRowClick={openEdit}
            rowActions={(user) => {
              const actions = actionsFor(user);
              return (
                <>
                  {actions.isLocked ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-muted-foreground hover:bg-amber-50 hover:text-amber-700"
                      disabled={unlockingUserId === user.id || !actions.canUnlock}
                      onClick={() => void unlockUser(user)}
                      aria-label={t.users_unlock}
                      title={t.users_unlock}
                    >
                      <Unlock className="size-3.5" />
                    </Button>
                  ) : null}
                  {user.active_sessions > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-muted-foreground hover:bg-amber-50 hover:text-amber-700"
                      disabled={revokingUserId === user.id || !actions.canRevokeSessions}
                      onClick={() => setConfirmRevokeSessions(user)}
                      aria-label={t.users_revoke_sessions}
                      title={t.users_revoke_sessions}
                    >
                      <LogOut className="size-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                    disabled={!actions.canEdit}
                    onClick={() => openEdit(user)}
                    aria-label={t.patients_edit}
                    title={actions.canEdit ? t.patients_edit : t.users_ceo_managed_by_ceo_only}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "size-7 rounded-full text-muted-foreground",
                      user.is_active
                        ? "hover:bg-rose-50 hover:text-rose-600"
                        : "hover:bg-emerald-50 hover:text-emerald-700",
                    )}
                    disabled={user.is_active ? !actions.canDeactivate : !actions.canActivate}
                    onClick={() => void toggleActive(user)}
                    aria-label={user.is_active ? t.users_deactivate : t.users_activate}
                    title={user.is_active ? t.users_deactivate : t.users_activate}
                  >
                    {user.is_active ? (
                      <UserRoundX className="size-3.5" />
                    ) : (
                      <UserRoundCheck className="size-3.5" />
                    )}
                  </Button>
                </>
              );
            }}
            rowActionsWidth={136}
            tableClassName="min-h-[420px]"
            footer={({ filteredCount, totalCount }) => (
              <span className="tabular-nums">
                {filteredCount === totalCount
                  ? `${totalCount}`
                  : `${filteredCount} / ${totalCount}`}{" "}
                {t.users_title.toLowerCase()}
              </span>
            )}
          />
        </AdminTableCard>
      ) : null}

      <DirtyDismissConfirmDialog
        open={confirmPasswordReset}
        title={t.users_reset_password}
        message={t.users_password_reset_confirm}
        cancelLabel={t.common_cancel}
        confirmLabel={t.users_reset_button}
        confirmDisabled={euSaving}
        onCancel={() => setConfirmPasswordReset(false)}
        onConfirm={() => void resetPassword()}
      />
      <DirtyDismissConfirmDialog
        open={confirmGenerateReset}
        title={t.users_generate_one_time_password}
        message={t.users_generate_one_time_password_confirm}
        cancelLabel={t.common_cancel}
        confirmLabel={t.users_generate_one_time_password}
        confirmDisabled={euSaving}
        onCancel={() => setConfirmGenerateReset(false)}
        onConfirm={() => void generateOneTimeResetPassword()}
      />
      <DirtyDismissConfirmDialog
        open={confirmRevokeSessions !== null}
        title={t.users_revoke_sessions}
        message={t.users_revoke_sessions_confirm}
        cancelLabel={t.common_cancel}
        confirmLabel={t.users_revoke_sessions}
        confirmDisabled={revokingUserId !== null}
        onCancel={() => setConfirmRevokeSessions(null)}
        onConfirm={() => confirmRevokeSessions && void revokeSessions(confirmRevokeSessions)}
      />
    </div>
  );
}

export function AdminUsersPage(...args: Parameters<typeof useAdminUsersPageContent>) {
  return useAdminUsersPageContent(...args);
}
