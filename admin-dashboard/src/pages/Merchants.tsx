import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { Merchant } from "../types";

const STATUS_FILTERS = ["all", "registered", "under_review", "active", "suspended", "rejected", "closed"];

const statusColors: Record<string, string> = {
  registered: "bg-yellow-100 text-yellow-800",
  pending_verification: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  approved: "bg-blue-100 text-blue-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-orange-100 text-orange-800",
  rejected: "bg-red-100 text-red-800",
  closed: "bg-gray-200 text-gray-700",
};

export function Merchants() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let query = supabase.from("merchants").select("*").order("created_at", { ascending: false });
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const { data } = await query;
    setMerchants(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function updateStatus(m: Merchant, status: string) {
    const payload: Record<string, unknown> = { status };
    if (status === "active" && user) {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = user.id;
    }
    await supabase.from("merchants").update(payload).eq("id", m.id);
    await load();
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Merchants</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setSearchParams(s === "all" ? {} : { status: s })}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              statusFilter === s ? "bg-slate-900 text-white border-slate-900" : "bg-white"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : merchants.length === 0 ? (
        <p className="text-gray-500">No merchants in this view.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {merchants.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-sm">{m.business_name}</p>
                <p className="text-xs text-gray-500">
                  {m.business_category ?? "—"} · {m.location ?? "—"} · {m.phone ?? m.email}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[m.status]}`}>
                  {m.status.replace(/_/g, " ")}
                </span>
                {(m.status === "registered" || m.status === "pending_verification" || m.status === "under_review") && (
                  <>
                    <button
                      onClick={() => updateStatus(m, "active")}
                      className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateStatus(m, "rejected")}
                      className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                {m.status === "active" && (
                  <button
                    onClick={() => updateStatus(m, "suspended")}
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50"
                  >
                    Suspend
                  </button>
                )}
                {m.status === "suspended" && (
                  <button
                    onClick={() => updateStatus(m, "active")}
                    className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
