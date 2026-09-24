import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AdminTier = "admin" | "super_admin" | null;

interface AuthState {
  user: User | null;
  session: Session | null;
  role: string | null;
  permissions: string[];
  adminTier: AdminTier;
  // True for BOTH admin and super_admin (migration 0050) — this is what
  // "full access to everything, same as super admin day-to-day" means:
  // both tiers bypass the permissions checklist and see every page, and
  // both can create/edit/delete plain staff accounts. isSuperAdmin below
  // is the one narrower boundary between them.
  isAdmin: boolean;
  // True only for the one super_admin row — the only account allowed to
  // create, delete, demote, or edit another admin-tier account (including
  // granting admin_tier at all). Everything else in this app treats admin
  // and super_admin identically; only account-management UI should ever
  // branch on this specifically.
  isSuperAdmin: boolean;
  // Admin/super admin always have access regardless of what's in
  // permissions — everyone else needs the page's key explicitly listed there.
  hasAccess: (pageKey: string) => boolean;
  loading: boolean;
  // Returns the resolved fields alongside the error so a caller (Login.tsx,
  // to pick a real landing page) can use them immediately — the state
  // updates signIn() makes internally are queued for the next render, not
  // available synchronously to whatever called signIn().
  signIn: (
    usernameOrEmail: string,
    password: string,
  ) => Promise<{ error: string | null; role?: string; permissions?: string[]; adminTier?: AdminTier }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const TOLO_ROLES = new Set([
  "tolo_ops",
  "tolo_finance",
  "tolo_admin",
  "tolo_marketing",
  "tolo_support",
  "tolo_merchant_verification",
]);

// A staff/admin account created directly (username + password, no email —
// see admin-create-staff Edge Function) never has a real email; its
// auth.users row uses this synthetic one instead so signInWithPassword()
// (which requires an email) still works unmodified. Pre-existing accounts
// keep signing in with their real email exactly as before — this is only
// applied when what was typed doesn't already look like an email.
function resolveEmail(usernameOrEmail: string): string {
  const trimmed = usernameOrEmail.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed.toLowerCase()}@staff.internal`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [adminTier, setAdminTier] = useState<AdminTier>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = adminTier !== null;
  const isSuperAdmin = adminTier === "super_admin";

  async function loadRole(userId: string) {
    const { data } = await supabase.from("profiles").select("role, account_status, permissions, admin_tier").eq("id", userId).maybeSingle();
    // account_status matches is_tolo_admin()'s own definition exactly
    // (migration 0028) — a suspended admin isn't treated as one here
    // either, consistent with what the DB would actually accept from them.
    const active = data?.account_status === "active";
    setRole(data?.role ?? null);
    setPermissions((data?.permissions as string[] | null) ?? []);
    setAdminTier(active ? ((data?.admin_tier as AdminTier) ?? null) : null);
  }

  function hasAccess(pageKey: string) {
    return isAdmin || permissions.includes(pageKey);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadRole(data.session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) await loadRole(newSession.user.id);
      else {
        setRole(null);
        setPermissions([]);
        setAdminTier(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(usernameOrEmail: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: resolveEmail(usernameOrEmail), password });
    if (error) return { error: error.message };

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status, permissions, admin_tier")
      .eq("id", data.user.id)
      .maybeSingle();
    if (!profile || !TOLO_ROLES.has(profile.role)) {
      await supabase.auth.signOut();
      return { error: "This account does not have Tolo staff access." };
    }
    if (profile.account_status === "suspended") {
      await supabase.auth.signOut();
      return { error: "This staff account has been suspended." };
    }
    const resolvedPermissions = (profile.permissions as string[] | null) ?? [];
    const resolvedTier = (profile.admin_tier as AdminTier) ?? null;
    setRole(profile.role);
    setPermissions(resolvedPermissions);
    setAdminTier(resolvedTier);
    return { error: null, role: profile.role, permissions: resolvedPermissions, adminTier: resolvedTier };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // Supabase owns the reset-token lifecycle entirely — this just requests
  // the email and never reveals whether the address is registered (the
  // caller shows the same neutral message regardless of the result). Not
  // meaningful for a username-only account (no real inbox behind
  // {username}@staff.internal) — an admin resets those by creating a new
  // password directly, same as account creation.
  async function requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  }

  // Only valid with an active session (normally the temporary one Supabase
  // establishes from the recovery link) — always updates that session's own
  // user, never an arbitrary account. The staff-role gate lives in signIn,
  // not here, so this intentionally doesn't re-check role/account_status.
  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  }

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        role,
        permissions,
        adminTier,
        isAdmin,
        isSuperAdmin,
        hasAccess,
        loading,
        signIn,
        signOut,
        requestPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
