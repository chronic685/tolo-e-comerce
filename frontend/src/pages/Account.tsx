import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

export function Account() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullName(data?.full_name ?? "");
        setPhone(data?.phone ?? "");
      });
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ full_name: fullName, phone }).eq("id", user.id);
    setSaving(false);
    setMessage(error ? error.message : "Saved. This phone number will be used automatically at checkout.");
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-bold mb-1">Account</h1>
      <p className="text-sm text-gray-500 mb-4">{user?.email}</p>
      <form onSubmit={handleSave} className="bg-white border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+2519..."
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
          <p className="text-xs text-gray-400 mt-1">Used automatically for delivery — you won't be asked again at checkout.</p>
        </div>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        <button
          type="submit"
          disabled={saving}
          className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}
