import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { exportToCsv } from "../lib/csvExport";
import type { Merchant, MerchantDocument } from "../types";

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

const docStatusColors: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  under_review: "bg-blue-100 text-blue-800",
  verified: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

export function Merchants() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<MerchantDocument[]>([]);
  const [docLinks, setDocLinks] = useState<Record<string, string>>({});
  const [reasonPromptId, setReasonPromptId] = useState<string | null>(null);
  const [reasonPromptKind, setReasonPromptKind] = useState<"rejected" | "suspended" | null>(null);
  const [reason, setReason] = useState("");

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

  async function updateStatus(m: Merchant, status: string, reasonText?: string) {
    const payload: Record<string, unknown> = { status };
    if (status === "active" && user) {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = user.id;
    }
    if (status === "rejected") payload.rejection_reason = reasonText ?? null;
    if (status === "suspended") payload.suspension_reason = reasonText ?? null;
    await supabase.from("merchants").update(payload).eq("id", m.id);
    setReasonPromptId(null);
    setReason("");
    await load();
  }

  async function toggleExpand(m: Merchant) {
    if (expandedId === m.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(m.id);
    const { data } = await supabase.from("merchant_documents").select("*").eq("merchant_id", m.id);
    setDocuments(data ?? []);
  }

  async function openDocument(doc: MerchantDocument) {
    if (docLinks[doc.id]) {
      window.open(docLinks[doc.id], "_blank");
      return;
    }
    const { data, error } = await supabase.storage.from("merchant-documents").createSignedUrl(doc.file_url, 300);
    if (error || !data) return;
    setDocLinks((prev) => ({ ...prev, [doc.id]: data.signedUrl }));
    window.open(data.signedUrl, "_blank");
  }

  async function setDocStatus(doc: MerchantDocument, status: string) {
    await supabase
      .from("merchant_documents")
      .update({ status, verified_by: user?.id, verification_date: new Date().toISOString() })
      .eq("id", doc.id);
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status } : d)));
  }

  function handleExport() {
    exportToCsv(
      `merchants-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      merchants.map((m) => ({
        id: m.id,
        business_name: m.business_name,
        category: m.business_category ?? "",
        subcategory: m.business_subcategory ?? "",
        phone: m.phone ?? "",
        email: m.email ?? "",
        city: m.city ?? "",
        sub_city: m.sub_city ?? "",
        status: m.status,
        owner_full_name: m.owner_full_name ?? "",
        owner_phone: m.owner_phone ?? "",
        created_at: m.created_at,
      })),
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Merchants</h1>
        <button
          onClick={handleExport}
          disabled={merchants.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setSearchParams(s === "all" ? {} : { status: s })}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              statusFilter === s ? "bg-navy text-white border-navy" : "bg-white"
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
            <div key={m.id}>
              <div className="flex items-center justify-between p-4">
                <button className="text-left" onClick={() => toggleExpand(m)}>
                  <p className="font-medium text-sm hover:text-navy">{m.business_name}</p>
                  <p className="text-xs text-gray-500">
                    {[m.business_category, m.business_subcategory].filter(Boolean).join(" · ") || "—"} ·{" "}
                    {[m.city, m.sub_city].filter(Boolean).join(", ") || m.location || "—"}
                  </p>
                  {m.status === "rejected" && m.rejection_reason && (
                    <p className="text-xs text-red-600 mt-0.5">Rejected: {m.rejection_reason}</p>
                  )}
                  {m.status === "suspended" && m.suspension_reason && (
                    <p className="text-xs text-orange-600 mt-0.5">Suspended: {m.suspension_reason}</p>
                  )}
                </button>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[m.status]}`}>
                    {m.status.replace(/_/g, " ")}
                  </span>
                  {(m.status === "registered" || m.status === "pending_verification" || m.status === "under_review") && (
                    <>
                      <button
                        onClick={() => updateStatus(m, "active")}
                        className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          setReasonPromptId(reasonPromptId === m.id ? null : m.id);
                          setReasonPromptKind("rejected");
                        }}
                        className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {m.status === "active" && (
                    <button
                      onClick={() => {
                        setReasonPromptId(reasonPromptId === m.id ? null : m.id);
                        setReasonPromptKind("suspended");
                      }}
                      className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50"
                    >
                      Suspend
                    </button>
                  )}
                  {m.status === "suspended" && (
                    <button
                      onClick={() => updateStatus(m, "active")}
                      className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>

              {reasonPromptId === m.id && reasonPromptKind && (
                <div className="px-4 pb-3 flex gap-2">
                  <input
                    placeholder={`Reason for ${reasonPromptKind === "rejected" ? "rejection" : "suspension"}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex-1 border rounded-md px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => updateStatus(m, reasonPromptKind, reason || undefined)}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700"
                  >
                    Confirm {reasonPromptKind === "rejected" ? "reject" : "suspend"}
                  </button>
                </div>
              )}

              {expandedId === m.id && (
                <div className="bg-gray-50 px-4 py-3 text-sm">
                  <p className="text-xs font-medium text-gray-500 mb-1">Owner</p>
                  <p className="mb-3">
                    {m.owner_full_name ?? "—"} · {m.owner_phone ?? "—"} · {m.owner_email ?? m.email ?? "—"}
                  </p>
                  <p className="text-xs font-medium text-gray-500 mb-1">Documents</p>
                  {documents.length === 0 ? (
                    <p className="text-gray-500 text-xs">No documents uploaded yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {documents.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between bg-white border rounded-md px-3 py-1.5">
                          <button onClick={() => openDocument(doc)} className="text-left hover:text-navy">
                            <span className="capitalize">{doc.doc_type.replace(/_/g, " ")}</span>
                            {doc.file_name && <span className="text-gray-400"> — {doc.file_name}</span>}
                          </button>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${docStatusColors[doc.status]}`}>
                              {doc.status.replace(/_/g, " ")}
                            </span>
                            {doc.status !== "verified" && (
                              <button onClick={() => setDocStatus(doc, "verified")} className="text-xs text-emerald-700 hover:underline">
                                Verify
                              </button>
                            )}
                            {doc.status !== "rejected" && (
                              <button onClick={() => setDocStatus(doc, "rejected")} className="text-xs text-red-600 hover:underline">
                                Reject
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
