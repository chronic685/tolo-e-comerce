// Reading a merchant's pickup contact (business name and phone) so the same deployed code works at every stage of the
// private-contacts rollout (migrations 0099 expand and 0100 contract):
//
//   before 0099 : only merchants.phone exists, and there is no merchant_private to embed, so the first query errors;
//   after 0099  : both exist and are kept identical, so the first query succeeds;
//   after 0100  : only merchant_private has the phone (merchants.phone is gone), so only the first query can succeed.
//
// So: try merchant_private first; fall back to the old column only if that query fails. Deploying a function before or after the
// expand migration is safe, and it needs no change for the contract migration.

interface QueryResult {
  data: unknown;
  error: unknown;
}

export interface MerchantContactDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { single(): PromiseLike<QueryResult> };
    };
  };
}

export interface MerchantPickupContact {
  business_name: string | null;
  phone: string | null;
}

function phoneFromPrivate(row: unknown): string | null {
  const embedded = (row as { merchant_private?: { phone?: string | null } | { phone?: string | null }[] | null } | null)?.merchant_private;
  return (Array.isArray(embedded) ? embedded[0]?.phone : embedded?.phone) ?? null;
}

/** Same shape the callers already destructured from a Supabase query: `{ data }`, with `data` null if the merchant could not be read. */
export async function loadMerchantPickupContact(db: MerchantContactDb, merchantId: string): Promise<{ data: MerchantPickupContact | null }> {
  const preferred = await db.from("merchants").select("business_name, merchant_private ( phone )").eq("id", merchantId).single();
  if (!preferred.error && preferred.data) {
    const row = preferred.data as { business_name?: string | null };
    return { data: { business_name: row.business_name ?? null, phone: phoneFromPrivate(preferred.data) } };
  }

  const legacy = await db.from("merchants").select("business_name, phone").eq("id", merchantId).single();
  if (!legacy.error && legacy.data) {
    const row = legacy.data as { business_name?: string | null; phone?: string | null };
    return { data: { business_name: row.business_name ?? null, phone: row.phone ?? null } };
  }
  return { data: null };
}
