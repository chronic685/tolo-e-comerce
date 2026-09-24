import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

const MIN_LENGTH = 8; // same minimum admin-create-staff enforces

export function ChangePassword() {
  const { user, updatePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from your current one.");
      return;
    }
    if (!user?.email) {
      setError("You're not signed in. Please sign in again.");
      return;
    }

    setSaving(true);
    // A live session alone isn't proof it's still the account's owner at the
    // keyboard, so the current password is checked by signing in with it.
    // user.email is the real email or the {username}@staff.internal one, so
    // this works for both kinds of account.
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
    if (reauthError) {
      setSaving(false);
      setError("Current password is incorrect.");
      return;
    }

    const { error: updateError } = await updatePassword(next);
    setSaving(false);
    if (updateError) {
      setError(updateError);
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-bold mb-1">Change password</h1>
      <p className="text-sm text-gray-500 mb-4">Enter your current password, then choose a new one.</p>
      <form onSubmit={handleSubmit} className="space-y-3 bg-white border rounded-lg p-4">
        <input
          type="password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="New password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <p className={`text-xs -mt-2 ${next && next.length < MIN_LENGTH ? "text-red-600" : "text-gray-400"}`}>
          At least {MIN_LENGTH} characters.
        </p>
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {done && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2">Password changed. Use it next time you sign in.</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {saving ? "Saving..." : "Change password"}
        </button>
      </form>
    </div>
  );
}
