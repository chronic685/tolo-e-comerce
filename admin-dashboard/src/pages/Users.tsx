import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { ADMIN_PAGES } from "../lib/adminPages";
import type { StaffProfile } from "../types";

const ROLES = ["tolo_ops", "tolo_finance", "tolo_admin", "tolo_marketing", "tolo_support", "tolo_merchant_verification"];
const PROFILE_SELECT = "id, full_name, phone, role, account_status, suspension_reason, permissions, admin_tier, username, created_at";

// Mirrors USERNAME_RE in supabase/functions/admin-create-staff -- keep in sync.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,30}$/;

function usernameProblem(username: string): string | null {
  if (!username) return null;
  if (username.includes("@")) return "Usernames can't contain @ — enter a username, not an email.";
  if (username.length < 3) return "Too short — at least 3 characters.";
  if (username.length > 31) return "Too long — at most 31 characters.";
  if (!/^[a-z0-9]/.test(username)) return "Must start with a letter or number.";
  if (!USERNAME_RE.test(username)) return "Only lowercase letters, numbers, dot (.), dash (-), and underscore (_) are allowed.";
  return null;
}

// functions.invoke() replaces the function's own JSON error with a generic
// "non-2xx status code" message; the real one is on error.context.
async function edgeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through to the generic message
    }
  }
  return (error as Error)?.message ?? "Something went wrong. Please try again.";
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
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StaffProfile[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [reasonPromptId, setReasonPromptId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
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
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .neq("role", "customer")
      .order("created_at", { ascending: false });
    setStaff((data as StaffProfile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

  // Same row (via RoleRow) renders in both `staff` (filtered role <>
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
      if (!stillStaff) return prev.filter((row) => row.id !== p.id);
      return prev.some((row) => row.id === p.id) ? prev.map((row) => (row.id === p.id ? updated : row)) : [updated, ...prev];
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
    const problem =
      credEdit.mode === "username"
        ? (usernameProblem(value) ?? (value ? null : "Enter a username."))
        : value.length < 8
          ? "Password must be at least 8 characters."
          : null;
    if (problem) {
      setCredError(problem);
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
    const name = p.full_name ?? p.username ?? "Account";
    if (credEdit.mode === "username") {
      applyProfileChange(p, { username: data.username });
      setMessage(`${name} now signs in as "${data.username}".`);
    } else {
      setMessage(`Password reset for ${name}. Share the new password with them securely.`);
    }
    setCredEdit(null);
    setCredValue("");
  }

  async function changeRole(p: StaffProfile, role: string) {
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    setMessage(error ? error.message : `${p.full_name ?? "User"} is now ${role.replace(/_/g, " ")}.`);
    if (error) return;
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
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ account_status: "active" }).eq("id", p.id);
    setMessage(error ? error.message : `${p.full_name ?? "User"} is now active.`);
    if (error) return;
    applyProfileChange(p, { account_status: "active", suspension_reason: null });
  }

  async function confirmSuspend(p: StaffProfile) {
    setMessage(null);
    const { error } = await supabase
      .from("profiles")
      .update({ account_status: "suspended", suspension_reason: reason || null })
      .eq("id", p.id);
    setMessage(error ? error.message : `${p.full_name ?? "User"} is now suspended.`);
    setReasonPromptId(null);
    setReason("");
    if (error) return;
    applyProfileChange(p, { account_status: "suspended", suspension_reason: reason || null });
  }

  // Same immediate-commit-per-click pattern as the role select/suspend
  // button (no separate "save" step anywhere on this page). Blocked
  // server-side for anyone the DB trigger doesn't accept regardless of this
  // UI (prevent_role_self_escalation, migration 0050) -- the checklist
  // isn't even rendered as editable for a caller who can't manage this row
  // in the first place (see RoleRow below).
  async function updatePermissions(p: StaffProfile, pageKey: string, checked: boolean) {
    const next = checked ? [...p.permissions, pageKey] : p.permissions.filter((k) => k !== pageKey);
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ permissions: next }).eq("id", p.id);
    if (error) {
      setMessage(error.message);
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
    setMessage(null);
    const admin_tier = grant ? "admin" : null;
    const { error } = await supabase.from("profiles").update({ admin_tier }).eq("id", p.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    applyProfileChange(p, { admin_tier });
  }

  async function handleDelete(p: StaffProfile) {
    setDeleting(true);
    setMessage(null);
    const { error } = await supabase.functions.invoke("admin-delete-staff", { body: { user_id: p.id } });
    setDeleting(false);
    setDeleteConfirmId(null);
    if (error) {
      setMessage(`Could not delete this account: ${await edgeFunctionError(error)}`);
      return;
    }
    setStaff((prev) => prev.filter((row) => row.id !== p.id));
    setSearchResults((prev) => prev.filter((row) => row.id !== p.id));
    setMessage(`${p.full_name ?? p.username ?? "Account"} deleted.`);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!createForm.username.trim() || !createForm.password) {
      setCreateError("Username and password are required.");
      return;
    }
    const problem = usernameProblem(createForm.username.trim());
    if (problem) {
      setCreateError(problem);
      return;
    }
    if (createForm.password.length < 8) {
      setCreateError("Password must be at least 8 characters.");
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
      setCreateError(error ? await edgeFunctionError(error) : "Could not create this account. Please try again.");
      return;
    }
    // The Edge Function's response only carries {id, username} -- everything
    // else needed to render the new row is already in hand from the form
    // itself, so the new account can be added directly instead of
    // re-fetching the whole staff list.
    const newProfile: StaffProfile = {
      id: data.id,
      full_name: createForm.full_name.trim() || null,
      phone: null,
      role: createForm.role,
      account_status: "active",
      suspension_reason: null,
      permissions: createForm.grantAdmin ? [] : createForm.permissions,
      admin_tier: createForm.grantAdmin ? "admin" : null,
      username: data.username,
      created_at: new Date().toISOString(),
    };
    setStaff((prev) => [newProfile, ...prev]);
    setCreateForm(EMPTY_CREATE_FORM);
    setShowCreateForm(false);
    setMessage(`Account "${data.username}" created.`);
  }

  // A render function, not a nested component: a component declared inside
  // Users() is a new type on every render, so React remounted each row on
  // every keystroke and text inputs inside it (suspend reason, username,
  // password) lost focus after one character.
  function renderRow(p: StaffProfile) {
    const editable = canManage(p);
    const credEditable = canEditCredentials(p);
    const isProtected = p.admin_tier === "super_admin";
    return (
      <div>
        <div className="p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              {p.full_name ?? p.username ?? "Unnamed"}
              {p.admin_tier && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    p.admin_tier === "super_admin" ? "bg-navy text-white" : "bg-navy-50 text-navy"
                  }`}
                >
                  {p.admin_tier === "super_admin" ? "Super Admin" : "Admin"}
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500">
              {p.username ? `@${p.username}` : (p.phone ?? "—")}
            </p>
            {p.account_status === "suspended" && p.suspension_reason && (
              <p className="text-xs text-red-600 mt-0.5">Suspended: {p.suspension_reason}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={p.role}
              onChange={(e) => changeRole(p, e.target.value)}
              disabled={!editable}
              className="border rounded-md px-2 py-1.5 text-xs capitalize disabled:opacity-50 disabled:bg-gray-50"
            >
              <option value="customer">customer (remove staff access)</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button
              onClick={() => toggleStatus(p)}
              disabled={!editable}
              className={`text-xs px-2 py-1.5 rounded-md border disabled:opacity-50 ${
                p.account_status === "active" ? "hover:bg-gray-50" : "bg-red-50 text-red-700 border-red-200"
              }`}
            >
              {p.account_status === "active" ? "Suspend" : "Reactivate"}
            </button>
            {isSuperAdmin && !isProtected && (
              <button
                onClick={() => updateAdminTier(p, p.admin_tier !== "admin")}
                className={`text-xs px-2 py-1.5 rounded-md border ${
                  p.admin_tier === "admin" ? "bg-navy-50 text-navy border-navy-100" : "hover:bg-gray-50"
                }`}
              >
                {p.admin_tier === "admin" ? "Revoke admin" : "Grant admin"}
              </button>
            )}
            {credEditable && p.username && (
              <button
                onClick={() => openCredEdit(p, "username")}
                className="text-xs px-2 py-1.5 rounded-md border hover:bg-gray-50"
              >
                Edit username
              </button>
            )}
            {credEditable && (
              <button
                onClick={() => openCredEdit(p, "password")}
                className="text-xs px-2 py-1.5 rounded-md border hover:bg-gray-50"
              >
                Reset password
              </button>
            )}
            {editable && p.role !== "customer" && !isProtected && (
              <button
                onClick={() => setDeleteConfirmId(deleteConfirmId === p.id ? null : p.id)}
                className="text-xs text-red-600 border border-red-200 px-2 py-1.5 rounded-md hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {reasonPromptId === p.id && (
          <div className="px-3 pb-3 flex gap-2">
            <input
              placeholder="Reason for suspension"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex-1 border rounded-md px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => confirmSuspend(p)}
              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700"
            >
              Confirm suspend
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
            className="px-3 pb-3"
          >
            <div className="flex gap-2">
              {credEdit.mode === "username" ? (
                <input
                  name="edit-staff-username"
                  aria-label="New username"
                  placeholder="New username"
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value.toLowerCase())}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  className="flex-1 border rounded-md px-3 py-1.5 text-sm"
                />
              ) : (
                <input
                  type="password"
                  name="edit-staff-password"
                  aria-label="New password"
                  placeholder="New password (min. 8 characters)"
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  className="flex-1 border rounded-md px-3 py-1.5 text-sm"
                />
              )}
              <button
                type="submit"
                disabled={credSaving}
                className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
              >
                {credSaving ? "Saving..." : credEdit.mode === "username" ? "Save username" : "Set password"}
              </button>
              <button
                type="button"
                onClick={() => setCredEdit(null)}
                className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
            {credError ? (
              <p className="text-xs text-red-600 mt-1">{credError}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">
                {credEdit.mode === "username"
                  ? "3–31 characters: lowercase letters, numbers, . _ - (no @). They sign in with the new name right away."
                  : "Takes effect immediately; their old password stops working."}
              </p>
            )}
          </form>
        )}
        {deleteConfirmId === p.id && (
          <div className="px-3 pb-3 flex items-center gap-2">
            <span className="text-xs text-gray-700">
              Delete {p.full_name ?? p.username}? This immediately revokes their access and can't be undone.
            </span>
            <button
              onClick={() => handleDelete(p)}
              disabled={deleting}
              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Yes, delete"}
            </button>
            <button onClick={() => setDeleteConfirmId(null)} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50">
              Cancel
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
            <div className="px-3 pb-3 pt-1 border-t">
              <p className="text-xs text-gray-500">Full access to every page (admin tier) — the checklist below doesn't apply.</p>
            </div>
          ) : (
            <div className="px-3 pb-3 pt-1 border-t">
              <p className="text-xs font-medium text-gray-500 mb-1.5">
                Page access{!editable && <span className="text-gray-400 font-normal"> (read-only — admin access required to change)</span>}
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {ADMIN_PAGES.map((page) => (
                  <label key={page.key} className={`flex items-center gap-1.5 text-xs ${editable ? "" : "text-gray-500"}`}>
                    <input
                      type="checkbox"
                      checked={p.permissions.includes(page.key)}
                      disabled={!editable}
                      onChange={(e) => updatePermissions(p, page.key, e.target.checked)}
                    />
                    {page.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Users &amp; Roles</h1>
        {isAdmin && (
          <button
            onClick={() => {
              // Always opens blank -- never with what was typed last time.
              setCreateForm(EMPTY_CREATE_FORM);
              setCreateError(null);
              setUsernameUnlocked(false);
              setShowCreateForm(!showCreateForm);
            }}
            className="bg-navy text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark"
          >
            {showCreateForm ? "Cancel" : "+ New account"}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Admin and super admin accounts can create, edit, and delete staff accounts and their page access. Only the super admin can create,
        delete, or edit another admin-tier account — regular staff never see these controls, even with Users &amp; Roles access.
      </p>
      {message && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2 mb-4">{message}</p>}

      {showCreateForm && isAdmin && (
        <form onSubmit={handleCreate} autoComplete="off" className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <h2 className="font-medium text-sm">Create account</h2>
          <p className="text-xs text-gray-400">
            No email required — this account signs in with just the username and password below.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <input
                placeholder="Username"
                name="new-staff-username"
                value={createForm.username}
                // Lowercased as typed: the server lowercases anyway, so this
                // shows exactly what they'll sign in with.
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value.toLowerCase() })}
                readOnly={!usernameUnlocked}
                onFocus={() => setUsernameUnlocked(true)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={usernameProblem(createForm.username.trim()) !== null}
                className={`w-full border rounded-md px-3 py-2 text-sm ${
                  usernameProblem(createForm.username.trim()) ? "border-red-400" : ""
                }`}
              />
              {usernameProblem(createForm.username.trim()) ? (
                <p className="text-xs text-red-600 mt-1">{usernameProblem(createForm.username.trim())}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-1">3–31 characters: lowercase letters, numbers, . _ - (no @).</p>
              )}
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                name="new-staff-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                autoComplete="new-password"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <p
                className={`text-xs mt-1 ${
                  createForm.password && createForm.password.length < 8 ? "text-red-600" : "text-gray-400"
                }`}
              >
                At least 8 characters.
              </p>
            </div>
          </div>
          <input
            placeholder="Full name (optional)"
            value={createForm.full_name}
            onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 block mb-1">Role</label>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
              className="w-full border rounded-md px-2 py-1.5 text-sm capitalize"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          {isSuperAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createForm.grantAdmin}
                onChange={(e) => setCreateForm({ ...createForm, grantAdmin: e.target.checked })}
              />
              Grant admin tier (full access to everything, can manage staff accounts)
            </label>
          )}
          {!createForm.grantAdmin && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Page access</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {ADMIN_PAGES.map((page) => (
                  <label key={page.key} className="flex items-center gap-1.5 text-xs">
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
                    {page.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {createError && <p className="text-red-600 text-sm">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create account"}
          </button>
        </form>
      )}

      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-medium mb-2 text-sm">Find a registered account to promote to staff</h2>
        <div className="flex gap-2">
          <input
            placeholder="Search by name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 border rounded-md px-3 py-2 text-sm"
          />
          <button onClick={handleSearch} className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
            Search
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          For someone who already has a Tolo account (e.g. as a customer) — for a brand-new account with no email, use "+ New account" above.
        </p>
      </div>

      {searchResults.length > 0 && (
        <div className="bg-white border rounded-lg divide-y mb-6">
          {searchResults.map((p) => (
            <div key={p.id}>{renderRow(p)}</div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Current Tolo Staff</h2>
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : staff.length === 0 ? (
        <p className="text-gray-500 text-sm">No staff accounts yet.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {staff.map((p) => (
            <div key={p.id}>{renderRow(p)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
