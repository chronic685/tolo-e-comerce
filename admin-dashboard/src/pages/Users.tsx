import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { StaffProfile } from "../types";

const ROLES = ["tolo_ops", "tolo_finance", "tolo_admin", "tolo_marketing", "tolo_support", "tolo_merchant_verification"];

export function Users() {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StaffProfile[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, phone, role, account_status, created_at")
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
      .select("id, full_name, phone, role, account_status, created_at")
      .or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`)
      .limit(10);
    setSearchResults((data as StaffProfile[]) ?? []);
  }

  async function changeRole(p: StaffProfile, role: string) {
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    setMessage(error ? error.message : `${p.full_name ?? "User"} is now ${role.replace(/_/g, " ")}.`);
    await load();
    await handleSearch();
  }

  async function toggleStatus(p: StaffProfile) {
    setMessage(null);
    const next = p.account_status === "active" ? "suspended" : "active";
    const { error } = await supabase.from("profiles").update({ account_status: next }).eq("id", p.id);
    setMessage(error ? error.message : `${p.full_name ?? "User"} is now ${next}.`);
    await load();
    await handleSearch();
  }

  function RoleRow({ p }: { p: StaffProfile }) {
    return (
      <div className="p-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{p.full_name ?? "Unnamed"}</p>
          <p className="text-xs text-gray-500">{p.phone ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={p.role}
            onChange={(e) => changeRole(p, e.target.value)}
            className="border rounded-md px-2 py-1.5 text-xs capitalize"
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
            className={`text-xs px-2 py-1.5 rounded-md border ${
              p.account_status === "active" ? "hover:bg-gray-50" : "bg-red-50 text-red-700 border-red-200"
            }`}
          >
            {p.account_status === "active" ? "Suspend" : "Reactivate"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Users &amp; Roles</h1>
      <p className="text-sm text-gray-500 mb-4">
        Only a Super Admin account can change roles or suspend a user — others will see an error if they try.
      </p>
      {message && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2 mb-4">{message}</p>}

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
          A new staff account can't be created from here — the person must already have registered via one of the apps first.
        </p>
      </div>

      {searchResults.length > 0 && (
        <div className="bg-white border rounded-lg divide-y mb-6">
          {searchResults.map((p) => (
            <RoleRow key={p.id} p={p} />
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
            <RoleRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
