import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Resolves the commission rate for a merchant order line, preferring the most
// specific active rule: merchant > category > platform default.
export async function resolveCommissionRate(
  db: SupabaseClient,
  merchantId: string,
  categoryId: string | null,
): Promise<number> {
  const { data: merchantRule } = await db
    .from("commission_rules")
    .select("rate_percent")
    .eq("scope_type", "merchant")
    .eq("scope_id", merchantId)
    .eq("is_active", true)
    .maybeSingle();
  if (merchantRule) return Number(merchantRule.rate_percent);

  if (categoryId) {
    const { data: categoryRule } = await db
      .from("commission_rules")
      .select("rate_percent")
      .eq("scope_type", "category")
      .eq("scope_id", categoryId)
      .eq("is_active", true)
      .maybeSingle();
    if (categoryRule) return Number(categoryRule.rate_percent);
  }

  const { data: platformRule } = await db
    .from("commission_rules")
    .select("rate_percent")
    .eq("scope_type", "platform")
    .eq("is_active", true)
    .maybeSingle();
  if (platformRule) return Number(platformRule.rate_percent);

  const { data: setting } = await db
    .from("system_settings")
    .select("value")
    .eq("key", "default_commission_rate_percent")
    .maybeSingle();
  return setting ? Number(setting.value) : 10;
}
