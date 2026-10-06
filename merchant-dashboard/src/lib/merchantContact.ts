import { supabase } from "./supabase";

export interface MerchantContactFields {
  phone: string | null;
  email: string | null;
  owner_full_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
}

// True when the error says the table / relationship is not there, i.e. migration 0099 (expand) has not been applied yet.
export function isMerchantPrivateMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  return /PGRST205|42P01|merchant_private/i.test(text) && /schema cache|does not exist|could not find|relation/i.test(text);
}

/**
 * Saves a merchant's contact details so the same deployed code works at every stage of the private-contacts rollout (migrations
 * 0099 expand and 0100 contract): write merchant_private (an upsert, because during the expand phase inserting the merchant already
 * created an empty private row); if that table does not exist yet, write the old columns on merchants instead, which is where the
 * details lived before.
 */
export async function saveMerchantContact(merchantId: string, fields: MerchantContactFields): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("merchant_private").upsert({ merchant_id: merchantId, ...fields });
  if (!error) return { error: null };
  if (!isMerchantPrivateMissing(error)) return { error };
  const legacy = await supabase.from("merchants").update(fields).eq("id", merchantId);
  return { error: legacy.error };
}
