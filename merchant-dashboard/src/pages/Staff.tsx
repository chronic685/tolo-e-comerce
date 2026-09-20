import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import type { MerchantStaffRow } from "../types";

// Assignable roles for staff added through this page. "owner" isn't offered
// here — it belongs to whoever merchants.owner_id actually is, not
// something reassignable through a staff-management form. The owner does
// still show up in the list below (they have their own merchant_staff row
// with role='owner', same as every merchant fixture in this codebase), but
// their row can't be edited or removed from here.
const ASSIGNABLE_ROLES = ["store_manager", "product_manager", "order_manager", "inventory_manager"] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  store_manager: "Store manager",
  product_manager: "Product manager",
  order_manager: "Order manager",
  inventory_manager: "Inventory manager",
};

interface FoundProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
}

export function Staff() {
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const isOwner = Boolean(merchant && user && merchant.owner_id === user.id);

  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(true);
  const [staff, setStaff] = useState<MerchantStaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundProfile | null | undefined>(undefined); // undefined = not searched yet
  const [alreadyStaff, setAlreadyStaff] = useState(false);
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("store_manager");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    // Platform-wide toggle (admin-dashboard Settings.tsx, merchant_features
    // .staff_accounts_enabled) — same pattern as bulk_upload_enabled: no
    // per-merchant override exists for any merchant_features flag.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { staff_accounts_enabled?: boolean } | null;
        setFeatureEnabled(features?.staff_accounts_enabled ?? false);
        setFeatureLoading(false);
      });
  }, []);

  async function load() {
    if (!merchant) return;
    setLoading(true);
    const { data } = await supabase
      .from("merchant_staff")
      .select("id, role, created_at, user_id, profiles ( full_name, phone )")
      .eq("merchant_id", merchant.id)
      .order("created_at");
    setStaff((data as unknown as MerchantStaffRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant]);

  async function handleSearch() {
    if (!phone.trim()) return;
    setSearching(true);
    setSearchError(null);
    setFound(undefined);
    const { data, error } = await supabase.functions.invoke("merchant-staff-lookup", { body: { phone: phone.trim() } });
    setSearching(false);
    if (error || !data) {
      setSearchError("Could not search for that phone number. Please try again.");
      return;
    }
    setFound(data.profile ?? null);
    setAlreadyStaff(Boolean(data.already_staff));
  }

  async function handleAdd() {
    if (!merchant || !found) return;
    setAdding(true);
    setAddError(null);
    const { error } = await supabase.from("merchant_staff").insert({ merchant_id: merchant.id, user_id: found.id, role });
    setAdding(false);
    if (error) {
      setAddError(error.message);
      return;
    }
    setPhone("");
    setFound(undefined);
    setRole("store_manager");
    await load();
  }

  async function handleRemove(staffId: string) {
    await supabase.from("merchant_staff").delete().eq("id", staffId);
    await load();
  }

  if (featureLoading) return <p className="text-gray-500">Loading...</p>;

  if (!featureEnabled) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold mb-2">Staff</h1>
        <p className="text-gray-600 text-sm">Staff accounts aren't available on your account yet. Contact Tolo support if you'd like it enabled.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-1">Staff</h1>
      <p className="text-sm text-gray-500 mb-4">
        {isOwner
          ? "Add or remove people who can help run your store."
          : "Only the store owner can add or remove staff — you can see who else has access below."}
      </p>

      {isOwner && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h2 className="font-medium text-sm mb-2">Add staff</h2>
          <p className="text-xs text-gray-500 mb-2">
            The person must already have a Tolo account (e.g. as a customer) — search by the phone number they registered with.
          </p>
          <div className="flex gap-2 mb-2">
            <input
              placeholder="Phone number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setFound(undefined);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 border rounded-md px-3 py-2 text-sm"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !phone.trim()}
              className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
          {searchError && <p className="text-red-600 text-xs mb-2">{searchError}</p>}

          {found === null && <p className="text-xs text-gray-500 mb-2">No Tolo account found with that phone number.</p>}

          {found && (
            <div className="border rounded-md p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{found.full_name ?? "Unnamed"}</p>
                <p className="text-xs text-gray-500">{found.phone}</p>
                {alreadyStaff && <p className="text-xs text-orange-600 mt-0.5">Already staff at your store.</p>}
              </div>
              {!alreadyStaff && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as (typeof ASSIGNABLE_ROLES)[number])}
                    className="border rounded-md px-2 py-1.5 text-xs"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAdd}
                    disabled={adding}
                    className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
                  >
                    {adding ? "Adding..." : "Add"}
                  </button>
                </div>
              )}
            </div>
          )}
          {addError && <p className="text-red-600 text-xs mt-2">{addError}</p>}
        </div>
      )}

      <div className="bg-white border rounded-lg divide-y">
        {loading ? (
          <p className="text-gray-500 text-sm p-4">Loading...</p>
        ) : staff.length === 0 ? (
          <p className="text-gray-500 text-sm p-4">No staff yet.</p>
        ) : (
          staff.map((s) => (
            <div key={s.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{s.profiles?.full_name ?? "Unnamed"}</p>
                <p className="text-xs text-gray-500">
                  {s.profiles?.phone ?? "—"} · <span className="capitalize">{ROLE_LABELS[s.role] ?? s.role}</span>
                </p>
              </div>
              {isOwner && s.role !== "owner" && (
                <button onClick={() => handleRemove(s.id)} className="text-xs text-red-600 font-medium flex-shrink-0">
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
