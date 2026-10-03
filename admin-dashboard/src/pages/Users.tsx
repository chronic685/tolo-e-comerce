import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { GRANTABLE_ADMIN_PAGES } from "../lib/adminPages";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  DataTable,
  type DataTableColumn,
  Pagination,
  SkeletonRows,
  toast,
  totalPagesFor,
  translateServerError,
  usePagination,
  useTranslation,
} from "@tolo/ui";
import { edgeFunctionError } from "../lib/edgeFunctionError";
import type { StaffProfile } from "../types";

const ROLES = ["tolo_ops", "tolo_finance", "tolo_admin", "tolo_marketing", "tolo_support", "tolo_merchant_verification"];
const PROFILE_SELECT = "id, full_name, phone, role, account_status, suspension_reason, permissions, admin_tier, username, created_at";

// Mirrors USERNAME_RE in supabase/functions/admin-create-staff -- keep in sync.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,30}$/;

// Returns an i18n key (not display text) so the caller translates it.
function usernameProblem(username: string): string | null {
  if (!username) return null;
  if (username.includes("@")) return "users.problem.noAt";
  if (username.length < 3) return "users.problem.tooShort";
  if (username.length > 31) return "users.problem.tooLong";
  if (!/^[a-z0-9]/.test(username)) return "users.problem.badStart";
  if (!USERNAME_RE.test(username)) return "users.problem.badChars";
  return null;
}

const EMPTY_CREATE_FORM = {
  username: "",
  password: "",
  full_name: "",
  role: ROLES[0],
  grantAdmin: false,
  permissions: [] as string[],
};

export function Users() {
  const { t } = useTranslation();
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [staffTotalCount, setStaffTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StaffProfile[]>([]);
  const [reasonPromptId, setReasonPromptId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  // Username stays read-only until focused: Chrome autofills the signed-in
  // admin's own saved login into a username field on page load and ignores
  // autocomplete="off" there, but never fills a read-only field.
  const [usernameUnlocked, setUsernameUnlocked] = useState(false);

  const [credEdit, setCredEdit] = useState<{ id: string; mode: "username" | "password" } | null>(null);
  const [credValue, setCredValue] = useState("");
  const [credError, setCredError] = useState<string | null>(null);
  const [credSaving, setCredSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, count } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT, { count: "exact" })
      .neq("role", "customer")
      .order("created_at", { ascending: false })
      .range(from, to);
    setStaff((data as StaffProfile[]) ?? []);
    setStaffTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function handleSearch() {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`)
      .limit(10);
    setSearchResults((data as StaffProfile[]) ?? []);
  }

  // Same row (via renderRow) renders in both `staff` (filtered role <>
  // 'customer') and `searchResults` (unfiltered) -- was `await load(); await
  // handleSearch();` after every mutation below, each of which sets
  // loading=true/re-runs the search, flashing both lists. Patches both
  // arrays directly instead: `staff` gains or loses the row depending on
  // whether its new role still qualifies as staff, `searchResults` is
  // always just patched in place since it isn't role-filtered.
  function applyProfileChange(p: StaffProfile, updates: Partial<StaffProfile>) {
    const updated = { ...p, ...updates };
    setSearchResults((prev) => prev.map((row) => (row.id === p.id ? updated : row)));
    setStaff((prev) => {
      const stillStaff = updated.role !== "customer";
      const wasOnThisPage = prev.some((row) => row.id === p.id);
      if (wasOnThisPage) {
        return stillStaff ? prev.map((row) => (row.id === p.id ? updated : row)) : prev.filter((row) => row.id !== p.id);
      }
      // A row promoted into staff from the search results wasn't on this
      // page before -- which page it now belongs to (by created_at) is a
      // server question, not something to guess by prepending locally.
      if (stillStaff) void load();
      return prev;
    });
  }

  // Who may edit p's role/status/permissions/admin_tier or delete it: the
  // super admin can touch anything except (handled separately, see below)
  // the super admin row itself; a plain admin can manage only plain staff
  // rows (admin_tier is null) -- per spec, an admin "cannot create, delete,
  // demote, or edit another admin or the super admin account" at all.
  function canManage(p: StaffProfile): boolean {
    return isSuperAdmin || (isAdmin && p.admin_tier === null);
  }

  // Mirrors admin-update-staff's rules, which are the real enforcement: never
  // your own row (that's the Change password page), never the super admin,
  // and admin-tier rows only for the super admin.
  function canEditCredentials(p: StaffProfile): boolean {
    if (!isAdmin || p.id === user?.id || p.role === "customer" || p.admin_tier === "super_admin") return false;
    return isSuperAdmin || p.admin_tier === null;
  }

  function openCredEdit(p: StaffProfile, mode: "username" | "password") {
    const same = credEdit?.id === p.id && credEdit.mode === mode;
    setCredEdit(same ? null : { id: p.id, mode });
    setCredValue(!same && mode === "username" ? (p.username ?? "") : "");
    setCredError(null);
  }

  async function saveCredentials(p: StaffProfile) {
    if (!credEdit) return;
    const value = credEdit.mode === "username" ? credValue.trim() : credValue;
    const problemKey =
      credEdit.mode === "username"
        ? (usernameProblem(value) ?? (value ? null : "users.problem.enterUsername"))
        : value.length < 8
          ? "users.passwordTooShort"
          : null;
    if (problemKey) {
      setCredError(t(problemKey));
      return;
    }
    setCredSaving(true);
    setCredError(null);
    const { data, error } = await supabase.functions.invoke("admin-update-staff", {
      body: { user_id: p.id, [credEdit.mode]: value },
    });
    setCredSaving(false);
    if (error) {
      setCredError(await edgeFunctionError(error));
      return;
    }
    const name = p.full_name ?? p.username ?? t("users.accountFallback");
    if (credEdit.mode === "username") {
      applyProfileChange(p, { username: data.username });
      toast.success(t("users.nowSignsInAs", { name, username: data.username }));
    } else {
      toast.success(t("users.passwordResetFor", { name }));
    }
    setCredEdit(null);
    setCredValue("");
  }

  async function changeRole(p: StaffProfile, role: string) {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("users.roleChanged", { name: p.full_name ?? t("users.userFallback"), role: t(`staffRole.${role}`) }));
    applyProfileChange(p, { role });
  }

  // Same reason-prompt pattern as Merchants.tsx (and now Customers.tsx):
  // suspending requires a typed reason, stored on profiles.suspension_reason
  // and audit-logged via profiles_log_change/log_config_change (migration
  // 0040) — the same mechanism/table as merchant and customer suspensions.
  // Reactivating stays a single click, matching both.
  async function toggleStatus(p: StaffProfile) {
    if (p.account_status === "active") {
      setReasonPromptId(reasonPromptId === p.id ? null : p.id);
      return;
    }
    const { error } = await supabase.functions.invoke("admin-set-account-status", {
      body: { user_id: p.id, status: "active" },
    });
    if (error) {
      toast.error(translateServerError(await edgeFunctionError(error), t));
      return;
    }
    toast.success(t("users.nowActive", { name: p.full_name ?? t("users.userFallback") }));
    applyProfileChange(p, { account_status: "active", suspension_reason: null });
  }

  // Goes through admin-set-account-status: besides flipping account_status
  // (which cuts data access through RLS immediately), it bans the login so
  // the account can't sign in again or refresh its session.
  async function confirmSuspend(p: StaffProfile) {
    const { error } = await supabase.functions.invoke("admin-set-account-status", {
      body: { user_id: p.id, status: "suspended", reason: reason || null },
    });
    setReasonPromptId(null);
    setReason("");
    if (error) {
      toast.error(translateServerError(await edgeFunctionError(error), t));
      return;
    }
    toast.success(t("users.nowSuspended", { name: p.full_name ?? t("users.userFallback") }));
    applyProfileChange(p, { account_status: "suspended", suspension_reason: reason || null });
  }

  // Same immediate-commit-per-click pattern as the role select/suspend
  // button (no separate "save" step anywhere on this page). Blocked
  // server-side for anyone the DB trigger doesn't accept regardless of this
  // UI (prevent_role_self_escalation, migration 0050) -- the checklist
  // isn't even rendered as editable for a caller who can't manage this row
  // in the first place (see renderRow below).
  async function updatePermissions(p: StaffProfile, pageKey: string, checked: boolean) {
    const next = checked ? [...p.permissions, pageKey] : p.permissions.filter((k) => k !== pageKey);
    const { error } = await supabase.from("profiles").update({ permissions: next }).eq("id", p.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    applyProfileChange(p, { permissions: next });
  }

  // Only grants/revokes "admin" -- "super_admin" is never assigned through
  // this generic control (see the report on how the one super admin
  // account is designated; idx_profiles_one_super_admin also enforces this
  // structurally regardless). Super-admin-only in the UI; the DB trigger
  // enforces the same thing either way.
  async function updateAdminTier(p: StaffProfile, grant: boolean) {
    const admin_tier = grant ? "admin" : null;
    const { error } = await supabase.from("profiles").update({ admin_tier }).eq("id", p.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    applyProfileChange(p, { admin_tier });
  }

  async function handleDelete(p: StaffProfile) {
    setDeleting(true);
    const { error } = await supabase.functions.invoke("admin-delete-staff", { body: { user_id: p.id } });
    setDeleting(false);
    setDeleteConfirmId(null);
    if (error) {
      toast.error(t("errors.deleteAccountFailed", { reason: translateServerError(await edgeFunctionError(error), t) }));
      return;
    }
    await load();
    setSearchResults((prev) => prev.filter((row) => row.id !== p.id));
    toast.success(t("users.deleted", { name: p.full_name ?? p.username ?? t("users.accountFallback") }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.username.trim() || !createForm.password) {
      toast.error(t("users.usernamePasswordRequired"));
      return;
    }
    const problemKey = usernameProblem(createForm.username.trim());
    if (problemKey) {
      toast.error(t(problemKey));
      return;
    }
    if (createForm.password.length < 8) {
      toast.error(t("users.passwordTooShort"));
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("admin-create-staff", {
      body: {
        username: createForm.username.trim(),
        password: createForm.password,
        full_name: createForm.full_name.trim() || null,
        role: createForm.role,
        admin_tier: createForm.grantAdmin ? "admin" : null,
        permissions: createForm.grantAdmin ? [] : createForm.permissions,
      },
    });
    setCreating(false);
    if (error || !data?.id) {
      toast.error(error ? translateServerError(await edgeFunctionError(error), t) : t("toast.somethingWentWrong"));
      return;
    }
    // Newest-first ordering means a brand-new account always belongs on
    // page 1 -- reload only when that's the page currently showing, and
    // land there otherwise so it's visible.
    if (page === 1) await load();
    else setPage(1);
    setCreateForm(EMPTY_CREATE_FORM);
    setShowCreateForm(false);
    toast.success(t("users.accountCreated", { username: data.username }));
  }

  // A render function feeding DataTable's `render`, not a nested
  // component: a component declared inside Users() is a new type on every
  // render, so React remounted each row on every keystroke and text inputs
  // inside it (suspend reason, username, password) lost focus after one
  // character.
  function renderRow(p: StaffProfile) {
    const editable = canManage(p);
    const credEditable = canEditCredentials(p);
    const isProtected = p.admin_tier === "super_admin";
    return (
      <div className="py-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              {p.full_name ?? p.username ?? t("customers.unnamed")}
              {p.admin_tier && (
                <Badge variant={p.admin_tier === "super_admin" ? "navy" : "navy-subtle"}>
                  {p.admin_tier === "super_admin" ? t("adminNav.superAdmin") : t("adminNav.admin")}
                </Badge>
              )}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{p.username ? `@${p.username}` : (p.phone ?? "—")}</p>
            {p.account_status === "suspended" && p.suspension_reason && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{t("merchants.suspendedPrefix", { reason: p.suspension_reason })}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <select
              value={p.role}
              onChange={(e) => changeRole(p, e.target.value)}
              disabled={!editable}
              className="border rounded-md px-2 py-1.5 text-xs capitalize disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            >
              <option value="customer">{t("users.customerRemoveStaff")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`staffRole.${r}`)}
                </option>
              ))}
            </select>
            <button
              onClick={() => toggleStatus(p)}
              disabled={!editable || p.id === user?.id || isProtected}
              className={`text-xs px-2 py-1.5 rounded-md border disabled:opacity-50 dark:border-white/20 ${
                p.account_status === "active" ? "hover:bg-gray-50 dark:hover:bg-white/5 dark:text-gray-200" : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400"
              }`}
            >
              {p.account_status === "active" ? t("customers.suspend") : t("customers.reactivate")}
            </button>
            {isSuperAdmin && !isProtected && (
              <button
                onClick={() => updateAdminTier(p, p.admin_tier !== "admin")}
                className={`text-xs px-2 py-1.5 rounded-md border dark:border-white/20 ${
                  p.admin_tier === "admin" ? "bg-navy-50 text-navy border-navy-100 dark:bg-navy-light/20 dark:text-navy-light" : "hover:bg-gray-50 dark:hover:bg-white/5 dark:text-gray-200"
                }`}
              >
                {p.admin_tier === "admin" ? t("users.revokeAdmin") : t("users.grantAdmin")}
              </button>
            )}
            {credEditable && p.username && (
              <button onClick={() => openCredEdit(p, "username")} className="text-xs px-2 py-1.5 rounded-md border dark:border-white/20 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">
                {t("users.editUsername")}
              </button>
            )}
            {credEditable && (
              <button onClick={() => openCredEdit(p, "password")} className="text-xs px-2 py-1.5 rounded-md border dark:border-white/20 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">
                {t("users.resetPassword")}
              </button>
            )}
            {editable && p.role !== "customer" && !isProtected && (
              <button
                onClick={() => setDeleteConfirmId(deleteConfirmId === p.id ? null : p.id)}
                className="text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                {t("common.delete")}
              </button>
            )}
          </div>
        </div>
        {reasonPromptId === p.id && (
          <div className="pt-3 flex gap-2">
            <input
              placeholder={t("customers.suspensionReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <button onClick={() => confirmSuspend(p)} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700">
              {t("merchants.confirmSuspend")}
            </button>
          </div>
        )}
        {credEdit?.id === p.id && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCredentials(p);
            }}
            autoComplete="off"
            className="pt-3"
          >
            <div className="flex gap-2">
              {credEdit.mode === "username" ? (
                <input
                  name="edit-staff-username"
                  aria-label={t("users.newUsername")}
                  placeholder={t("users.newUsername")}
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value.toLowerCase())}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                />
              ) : (
                <input
                  type="password"
                  name="edit-staff-password"
                  aria-label={t("users.newPassword")}
                  placeholder={t("users.newPasswordPlaceholder")}
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                />
              )}
              <button type="submit" disabled={credSaving} className="text-xs bg-navy dark:bg-navy-light text-white px-3 py-1.5 rounded-md hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60">
                {credSaving ? t("users.saving") : credEdit.mode === "username" ? t("users.saveUsername") : t("users.setPassword")}
              </button>
              <button type="button" onClick={() => setCredEdit(null)} className="text-xs border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5">
                {t("common.cancel")}
              </button>
            </div>
            {credError ? (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{credError}</p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {credEdit.mode === "username" ? t("users.usernameChangeHint") : t("users.passwordChangeHint")}
              </p>
            )}
          </form>
        )}
        {deleteConfirmId === p.id && (
          <div className="pt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-700 dark:text-gray-300">
              {t("users.deleteConfirmText", { name: p.full_name ?? p.username ?? "" })}
            </span>
            <button onClick={() => handleDelete(p)} disabled={deleting} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60">
              {deleting ? t("users.deleting") : t("users.yesDelete")}
            </button>
            <button onClick={() => setDeleteConfirmId(null)} className="text-xs border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5">
              {t("common.cancel")}
            </button>
          </div>
        )}
        {/* Permissions are meaningless before someone is actually staff --
            promote via the role select above first, then grant pages here.
            Admin/super-admin rows never need this (they bypass the
            checklist entirely, see AuthContext.hasAccess), so it's replaced
            with a plain note for them instead of a checklist nobody can
            usefully edit. */}
        {p.role !== "customer" &&
          (p.admin_tier ? (
            <div className="pt-3 mt-2 border-t dark:border-white/10">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("users.adminFullAccessNote")}</p>
            </div>
          ) : (
            <div className="pt-3 mt-2 border-t dark:border-white/10">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                {t("users.pageAccess")}
                {!editable && <span className="text-gray-400 dark:text-gray-500 font-normal">{t("users.readOnlyNote")}</span>}
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {GRANTABLE_ADMIN_PAGES.map((page) => (
                  <label key={page.key} className={`flex items-center gap-1.5 text-xs ${editable ? "dark:text-gray-200" : "text-gray-500 dark:text-gray-500"}`}>
                    <input
                      type="checkbox"
                      checked={p.permissions.includes(page.key)}
                      disabled={!editable}
                      onChange={(e) => updatePermissions(p, page.key, e.target.checked)}
                    />
                    {t(page.labelKey)}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>
    );
  }

  const columns: DataTableColumn<StaffProfile>[] = [
    {
      key: "row",
      header: t("users.staffColumn"),
      render: renderRow,
      filterValue: (p) => `${p.full_name ?? ""} ${p.username ?? ""} ${p.phone ?? ""} ${p.role}`,
      csvValue: (p) => p.full_name ?? p.username ?? "",
    },
  ];

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("nav.users")}</h1>
        {isAdmin && (
          <button
            onClick={() => {
              // Always opens blank -- never with what was typed last time.
              setCreateForm(EMPTY_CREATE_FORM);
              setUsernameUnlocked(false);
              setShowCreateForm(!showCreateForm);
            }}
            className="bg-navy dark:bg-navy-light text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark dark:hover:bg-navy"
          >
            {showCreateForm ? t("common.cancel") : t("users.newAccount")}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("users.description")}</p>

      {showCreateForm && isAdmin && (
        <form onSubmit={handleCreate} autoComplete="off" className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 space-y-3">
          <h2 className="font-medium text-sm dark:text-gray-100">{t("users.createAccount")}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">{t("users.noEmailNote")}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <input
                placeholder={t("users.usernamePlaceholder")}
                name="new-staff-username"
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value.toLowerCase() })}
                readOnly={!usernameUnlocked}
                onFocus={() => setUsernameUnlocked(true)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={usernameProblem(createForm.username.trim()) !== null}
                className={`w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100 ${
                  usernameProblem(createForm.username.trim()) ? "border-red-400 dark:border-red-700" : ""
                }`}
              />
              {usernameProblem(createForm.username.trim()) ? (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t(usernameProblem(createForm.username.trim()) as string)}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("users.usernameHint")}</p>
              )}
            </div>
            <div>
              <input
                type="password"
                placeholder={t("users.passwordPlaceholder")}
                name="new-staff-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                autoComplete="new-password"
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
              <p className={`text-xs mt-1 ${createForm.password && createForm.password.length < 8 ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-gray-500"}`}>
                {t("users.passwordHint")}
              </p>
            </div>
          </div>
          <input
            placeholder={t("users.fullNameOptional")}
            value={createForm.full_name}
            onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("users.roleLabel")}</label>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
              className="w-full border rounded-md px-2 py-1.5 text-sm capitalize dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`staffRole.${r}`)}
                </option>
              ))}
            </select>
          </div>
          {isSuperAdmin && (
            <label className="flex items-center gap-2 text-sm dark:text-gray-200">
              <input type="checkbox" checked={createForm.grantAdmin} onChange={(e) => setCreateForm({ ...createForm, grantAdmin: e.target.checked })} />
              {t("users.grantAdminTier")}
            </label>
          )}
          {!createForm.grantAdmin && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{t("users.pageAccess")}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {GRANTABLE_ADMIN_PAGES.map((page) => (
                  <label key={page.key} className="flex items-center gap-1.5 text-xs dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={createForm.permissions.includes(page.key)}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          permissions: e.target.checked
                            ? [...createForm.permissions, page.key]
                            : createForm.permissions.filter((k) => k !== page.key),
                        })
                      }
                    />
                    {t(page.labelKey)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <button type="submit" disabled={creating} className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60">
            {creating ? t("users.creating") : t("users.createAccount")}
          </button>
        </form>
      )}

      <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4">
        <h2 className="font-medium mb-2 text-sm dark:text-gray-100">{t("users.findAccountHeading")}</h2>
        <div className="flex gap-2">
          <input
            placeholder={t("customers.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <button onClick={handleSearch} className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
            {t("common.search")}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{t("users.findAccountNote")}</p>
      </div>

      {searchResults.length > 0 && (
        <div className="mb-6">
          <DataTable storageKey="admin.users.search" columns={columns} rows={searchResults} getRowId={(p) => p.id} />
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("users.currentStaff")}</h2>
      {loading ? (
        <SkeletonRows />
      ) : staff.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">{t("users.noStaffYet")}</p>
      ) : (
        <>
          <DataTable storageKey="admin.users.staff" columns={columns} rows={staff} getRowId={(p) => p.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(staffTotalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
