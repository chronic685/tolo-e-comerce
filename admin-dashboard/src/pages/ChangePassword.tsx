import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { toast, translateAuthError, useTranslation } from "@tolo/ui";

const MIN_LENGTH = 8; // same minimum admin-create-staff enforces

export function ChangePassword() {
  const { t } = useTranslation();
  const { user, updatePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next.length < MIN_LENGTH) {
      toast.error(t("changePassword.minLength", { min: MIN_LENGTH }));
      return;
    }
    if (next !== confirm) {
      toast.error(t("changePassword.dontMatch"));
      return;
    }
    if (next === current) {
      toast.error(t("changePassword.mustDiffer"));
      return;
    }
    if (!user?.email) {
      toast.error(t("changePassword.notSignedIn"));
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
      toast.error(t("changePassword.currentIncorrect"));
      return;
    }

    const { error: updateError } = await updatePassword(next);
    setSaving(false);
    if (updateError) {
      toast.error(translateAuthError(updateError, t));
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-bold mb-1">{t("admin.changePassword")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("changePassword.description")}</p>
      <form onSubmit={handleSubmit} className="space-y-3 bg-white dark:bg-navy-dark border rounded-lg p-4">
        <input
          type="password"
          placeholder={t("changePassword.currentPassword")}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder={t("auth.newPassword")}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <p className={`text-xs -mt-2 ${next && next.length < MIN_LENGTH ? "text-red-600" : "text-gray-400 dark:text-gray-500"}`}>
          {t("changePassword.atLeastChars", { min: MIN_LENGTH })}
        </p>
        <input
          type="password"
          placeholder={t("auth.confirmNewPassword")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {done && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2">{t("changePassword.successMessage")}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {saving ? t("common.saving") : t("admin.changePassword")}
        </button>
      </form>
    </div>
  );
}
