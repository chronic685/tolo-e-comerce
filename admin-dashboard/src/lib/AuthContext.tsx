import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
  user: User | null;
  session: Session | null;
  role: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadRole(userId: string) {
    const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    setRole(data?.role ?? null);
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
      else setRole(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const { data: profile } = await supabase.from("profiles").select("role, account_status").eq("id", data.user.id).maybeSingle();
    if (!profile || !TOLO_ROLES.has(profile.role)) {
      await supabase.auth.signOut();
      return { error: "This account does not have Tolo staff access." };
    }
    if (profile.account_status === "suspended") {
      await supabase.auth.signOut();
      return { error: "This staff account has been suspended." };
    }
    setRole(profile.role);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // Supabase owns the reset-token lifecycle entirely — this just requests
  // the email and never reveals whether the address is registered (the
  // caller shows the same neutral message regardless of the result).
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
      value={{ user: session?.user ?? null, session, role, loading, signIn, signOut, requestPasswordReset, updatePassword }}
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
