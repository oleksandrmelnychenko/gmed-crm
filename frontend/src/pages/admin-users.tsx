import { useCallback, useEffect, useMemo, useReducer, type FormEvent, type ReactNode, type SetStateAction } from "react";
import {
  Eye,
  EyeOff,
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
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  setAdminUserActive,
  unlockAdminUser,
  updateAdminUser,
} from "@/pages/admin/data/admin-api";
import {
  canSaveAdminUserEdit,
  getOptionalAdminPasswordError,
  getRequiredAdminPasswordError,
  generateAdminPassword,
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

const ADMIN_USER_REALTIME_EVENTS = [
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.activated",
  "user.password_reset",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
] as const;

const ADMIN_USER_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

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

function isUserLocked(user: User) {
  if (!user.locked_until) return false;
  const lockedUntil = new Date(user.locked_until).getTime();
  return Number.isFinite(lockedUntil) && lockedUntil > Date.now();
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
  newPassword: string;
  newPasswordConfirm: string;
  newPasswordVisible: boolean;
  newRole: string;
  editUser: User | null;
  editError: string | null;
  euName: string;
  euEmail: string;
  euRole: string;
  euPassword: string;
  euPasswordConfirm: string;
  euPasswordVisible: boolean;
  passwordResetSuccess: boolean;
  confirmPasswordReset: boolean;
  unlockingUserId: string | null;
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
      showCreate: false,
      creating: false,
      createError: null,
      newName: "",
      newEmail: "",
      newPassword: "",
      newPasswordConfirm: "",
      newPasswordVisible: false,
      newRole: "patient_manager",
      editUser: null,
      editError: null,
      euName: "",
      euEmail: "",
      euRole: "",
      euPassword: "",
      euPasswordConfirm: "",
      euPasswordVisible: false,
      passwordResetSuccess: false,
      confirmPasswordReset: false,
      unlockingUserId: null,
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
    newPassword,
    newPasswordConfirm,
    newPasswordVisible,
    newRole,
    editUser,
    editError,
    euName,
    euEmail,
    euRole,
    euPassword,
    euPasswordConfirm,
    euPasswordVisible,
    passwordResetSuccess,
    confirmPasswordReset,
    unlockingUserId,
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
  const setNewPassword = (value: SetStateAction<string>) =>
    setAdminUsersField("newPassword", value);
  const setNewPasswordConfirm = (value: SetStateAction<string>) =>
    setAdminUsersField("newPasswordConfirm", value);
  const setNewPasswordVisible = (value: SetStateAction<boolean>) =>
    setAdminUsersField("newPasswordVisible", value);
  const setNewRole = (value: SetStateAction<string>) =>
    setAdminUsersField("newRole", value);
  const setEditUser = (value: SetStateAction<User | null>) =>
    setAdminUsersField("editUser", value);
  const setEditError = (value: SetStateAction<string | null>) =>
    setAdminUsersField("editError", value);
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
  const setUnlockingUserId = (value: SetStateAction<string | null>) =>
    setAdminUsersField("unlockingUserId", value);
  const setEuSaving = (value: SetStateAction<boolean>) =>
    setAdminUsersField("euSaving", value);

  const roleLabel = useCallback(
    (role: string) => tr[`role_${role}`] ?? formatUnknownValue(role, t),
    [t, tr],
  );
  const closeUnsavedConfirmMessage = t.common_discard_unsaved_confirm;
  const newPasswordError = newPassword
    ? getRequiredAdminPasswordError(newPassword, t)
    : null;
  const newPasswordMismatch = isPasswordConfirmationMismatch(
    newPassword,
    newPasswordConfirm,
  );
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
        filterOptions: ROLE_KEYS.map((role) => ({
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
        width: 150,
        render: (user) => {
          const locked = isUserLocked(user);
          return (
            <Badge
              variant="outline"
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
          );
        },
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
    const passwordError = getRequiredAdminPasswordError(newPassword, t);
    if (passwordError) {
      setCreateError(passwordError);
      return;
    }
    if (isPasswordConfirmationMismatch(newPassword, newPasswordConfirm)) {
      setCreateError(t.users_password_mismatch);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAdminUser<User>({
        email: newEmail,
        name: newName,
        password: newPassword,
        role: newRole,
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
    setEditError(null);
    setEuName(u.name);
    setEuEmail(u.email);
    setEuRole(u.role);
    setEuPassword("");
    setEuPasswordConfirm("");
    setEuPasswordVisible(false);
    setPasswordResetSuccess(false);
    setConfirmPasswordReset(false);
    setEditUser(u);
  };

  const closeCreateSheet = useCallback(() => {
    setShowCreate(false);
    setCreateError(null);
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setNewPasswordVisible(false);
    setNewRole("patient_manager");
  }, []);

  const closeEditSheet = useCallback(() => {
    setEditUser(null);
    setEditError(null);
    setEuName("");
    setEuEmail("");
    setEuRole("");
    setEuPassword("");
    setEuPasswordConfirm("");
    setEuPasswordVisible(false);
    setPasswordResetSuccess(false);
    setConfirmPasswordReset(false);
  }, []);

  const createDirty =
    newName.trim().length > 0 ||
    newEmail.trim().length > 0 ||
    newPassword.length > 0 ||
    newPasswordConfirm.length > 0 ||
    newRole !== "patient_manager";

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
      setEditError(e instanceof Error ? e.message : String(e));
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
      setEuPassword("");
      setEuPasswordConfirm("");
      setEuPasswordVisible(false);
      setPasswordResetSuccess(true);
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEuSaving(false);
    }
  };

  const generatePassword = () => {
    const password = generateAdminPassword();
    setEuPassword(password);
    setEuPasswordConfirm(password);
    setEuPasswordVisible(true);
    setPasswordResetSuccess(false);
    setEditError(null);
  };

  const generateNewPassword = () => {
    const password = generateAdminPassword();
    setNewPassword(password);
    setNewPasswordConfirm(password);
    setNewPasswordVisible(true);
    setCreateError(null);
  };

  const unlockUser = async (userId: string) => {
    setUnlockingUserId(userId);
    setError(null);
    try {
      await unlockAdminUser(userId);
      clearApiCache("/users");
      void loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUnlockingUserId(null);
    }
  };

  const toggleActive = async (userId: string, currentlyActive: boolean) => {
    setError(null);
    try {
      await setAdminUserActive(userId, !currentlyActive);
      void loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_name}</Label>
                    <Input required placeholder={t.users_name_placeholder} value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_email}</Label>
                    <Input type="email" required placeholder={t.users_email_placeholder} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_role}</Label>
                  <NativeComboboxSelect value={newRole}
                    onChange={(event) => setNewRole(event.target.value ?? "")} className="h-9 w-full rounded-lg bg-field">
                      {ROLE_KEYS.map((key) => (
                        <option key={key} value={key}>{roleLabel(key)}</option>
                      ))}
                    </NativeComboboxSelect>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_password}</Label>
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
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">
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
              </DotSection>
            </AdminSheetScaffold>
          </form>
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
              {passwordResetSuccess ? (
                <div
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  role="status"
                >
                  {t.users_password_reset_success}
                </div>
              ) : null}
              <DotSection title={t.users_title}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_name}</Label>
                    <Input value={euName} onChange={(e) => setEuName(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_email}</Label>
                    <Input type="email" value={euEmail} onChange={(e) => setEuEmail(e.target.value)} className="h-9 rounded-lg bg-field" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.users_role}</Label>
                  <NativeComboboxSelect value={euRole}
                    onChange={(event) => setEuRole(event.target.value ?? "")} className="h-9 w-full rounded-lg bg-field">
                      {ROLE_KEYS.map((key) => (
                        <option key={key} value={key}>{roleLabel(key)}</option>
                      ))}
                    </NativeComboboxSelect>
                </div>
              </DotSection>
              <DotSection title={t.users_reset_password}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">
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
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">
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
            rowActions={(user) => (
              <>
                {isUserLocked(user) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:bg-amber-50 hover:text-amber-700"
                    disabled={unlockingUserId === user.id}
                    onClick={() => void unlockUser(user.id)}
                    aria-label={t.users_unlock}
                    title={t.users_unlock}
                  >
                    <Unlock className="size-3.5" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(user)}
                  aria-label={t.patients_edit}
                  title={t.patients_edit}
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
                  onClick={() => void toggleActive(user.id, user.is_active)}
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
            )}
            rowActionsWidth={104}
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
    </div>
  );
}

export function AdminUsersPage(...args: Parameters<typeof useAdminUsersPageContent>) {
  return useAdminUsersPageContent(...args);
}
