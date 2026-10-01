import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import {
  ADMIN_PAGE_SIZE,
  Button,
  DataTable,
  EmptyState,
  Pagination,
  SkeletonPage,
  SkeletonRows,
  toast,
  totalPagesFor,
  translateServerError,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
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
  const { t } = useTranslation();
  const isOwner = Boolean(merchant && user && merchant.owner_id === user.id);

  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(true);
  const [staff, setStaff] = useState<MerchantStaffRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundProfile | null | undefined>(undefined); // undefined = not searched yet
  const [alreadyStaff, setAlreadyStaff] = useState(false);
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("store_manager");
  const [adding, setAdding] = useState(false);

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
    const { data, count } = await supabase
      .from("merchant_staff")
      .select("id, role, created_at, user_id, profiles ( full_name, phone )", { count: "exact" })
      .eq("merchant_id", merchant.id)
      .order("created_at")
      .range(from, to);
    setStaff((data as unknown as MerchantStaffRow[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, from, to]);

  async function handleSearch() {
    if (!phone.trim()) return;
    setSearching(true);
    setFound(undefined);
    const { data, error } = await supabase.functions.invoke("merchant-staff-lookup", { body: { phone: phone.trim() } });
    setSearching(false);
    if (error || !data) {
      toast.error("Could not search for that phone number. Please try again.");
      return;
    }
    setFound(data.profile ?? null);
    setAlreadyStaff(Boolean(data.already_staff));
  }

  async function handleAdd() {
    if (!merchant || !found) return;
    setAdding(true);
    const { error } = await supabase
      .from("merchant_staff")
      .insert({ merchant_id: merchant.id, user_id: found.id, role })
      .select("id, created_at")
      .single();
    setAdding(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    // Reloads rather than patching the array in place, now that the list
    // is paginated -- the canonical page + total count is whatever the
    // server says after the insert, not assembled from `found` locally.
    await load();
    setPhone("");
    setFound(undefined);
    setRole("store_manager");
  }

  async function handleRemove(staffId: string) {
    const { error } = await supabase.from("merchant_staff").delete().eq("id", staffId);
    if (error) return;
    await load();
  }

  async function bulkRemove(rows: MerchantStaffRow[]) {
    const removable = rows.filter((s) => s.role !== "owner");
    if (removable.length === 0) return;
    await supabase.from("merchant_staff").delete().in("id", removable.map((s) => s.id));
    await load();
  }

  const columns: DataTableColumn<MerchantStaffRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (s) => s.profiles?.full_name ?? "Unnamed",
      filterValue: (s) => s.profiles?.full_name ?? "",
      sortValue: (s) => s.profiles?.full_name ?? "",
      csvValue: (s) => s.profiles?.full_name ?? "",
    },
    { key: "phone", header: "Phone", render: (s) => s.profiles?.phone ?? "—", csvValue: (s) => s.profiles?.phone ?? "" },
    { key: "role", header: "Role", render: (s) => <span className="capitalize">{ROLE_LABELS[s.role] ?? s.role}</span>, csvValue: (s) => s.role },
    {
      key: "actions",
      header: "",
      render: (s) =>
        isOwner && s.role !== "owner" ? (
          <Button size="sm" variant="destructive" onClick={() => handleRemove(s.id)}>
            Remove
          </Button>
        ) : null,
    },
  ];

  if (featureLoading) return <SkeletonPage />;

  if (!featureEnabled) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold mb-2 dark:text-gray-100">Staff</h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">Staff accounts aren't available on your account yet. Contact Tolo support if you'd like it enabled.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-1 dark:text-gray-100">Staff</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {isOwner
          ? "Add or remove people who can help run your store."
          : "Only the store owner can add or remove staff — you can see who else has access below."}
      </p>

      {isOwner && (
        <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4">
          <h2 className="font-medium text-sm mb-2 dark:text-gray-100">Add staff</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
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
              className="flex-1 border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !phone.trim()}
              className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
          {found === null && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">No Tolo account found with that phone number.</p>}

          {found && (
            <div className="border dark:border-white/20 rounded-md p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium dark:text-gray-100">{found.full_name ?? "Unnamed"}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{found.phone}</p>
                {alreadyStaff && <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">Already staff at your store.</p>}
              </div>
              {!alreadyStaff && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as (typeof ASSIGNABLE_ROLES)[number])}
                    className="border rounded-md px-2 py-1.5 text-xs dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
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
                    className="text-xs bg-navy dark:bg-navy-light text-white px-3 py-1.5 rounded-md hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
                  >
                    {adding ? "Adding..." : "Add"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonRows count={3} />
      ) : staff.length === 0 ? (
        <EmptyState icon={Users} title="No staff yet" description="People you add will show up here." />
      ) : (
        <>
          <DataTable
            storageKey="merchant.staff"
            columns={columns}
            rows={staff}
            getRowId={(s) => s.id}
            bulkActions={isOwner ? [{ label: "Remove", onAction: bulkRemove, variant: "destructive" }] : undefined}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
