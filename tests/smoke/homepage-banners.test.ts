import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 4, item 18 (migration 0068). Public read only ever sees active
// banners (or an admin sees everything); only an admin with the 'banners'
// page permission can insert/update/delete. The QA staff fixture already
// carries admin-tier access (see other admin-gated tests in this suite),
// so it stands in for "has the banners permission" here.
const db = serviceClient();

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("homepage banners (migration 0068)", () => {
  let staffToken: string;
  let customerToken: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
  });

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.from("homepage_banners").delete().eq("id", id);
    }
  });

  it("a customer can see an active banner but not an inactive one", async () => {
    const { data: active, error: activeError } = await db
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-active.png", title: "QA TEST active", is_active: true, sort_order: 999 })
      .select()
      .single();
    expect(activeError).toBeNull();
    createdIds.push(active!.id);

    const { data: inactive, error: inactiveError } = await db
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-inactive.png", title: "QA TEST inactive", is_active: false, sort_order: 999 })
      .select()
      .single();
    expect(inactiveError).toBeNull();
    createdIds.push(inactive!.id);

    const customerClient = authedClient(customerToken);
    const { data: visible } = await customerClient.from("homepage_banners").select("id").in("id", [active!.id, inactive!.id]);
    const visibleIds = (visible ?? []).map((b) => b.id);
    expect(visibleIds).toContain(active!.id);
    expect(visibleIds).not.toContain(inactive!.id);
  });

  it("an admin can see an inactive banner too", async () => {
    const { data: inactive, error } = await db
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-admin-visible.png", is_active: false, sort_order: 999 })
      .select()
      .single();
    expect(error).toBeNull();
    createdIds.push(inactive!.id);

    const staffClient = authedClient(staffToken);
    const { data } = await staffClient.from("homepage_banners").select("id").eq("id", inactive!.id).maybeSingle();
    expect(data).not.toBeNull();
  });

  it("a plain customer cannot insert, update, or delete a banner", async () => {
    const customerClient = authedClient(customerToken);

    const { error: insertError } = await customerClient
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-customer-insert.png", is_active: true });
    expect(insertError).not.toBeNull();

    const { data: seed } = await db
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-customer-target.png", is_active: true, sort_order: 999 })
      .select()
      .single();
    createdIds.push(seed!.id);

    // RLS on an UPDATE/DELETE the caller isn't allowed to perform can
    // either return an error or silently match zero rows, depending on the
    // policy shape -- what actually matters, and what's asserted below, is
    // that the row itself never changed.
    await customerClient.from("homepage_banners").update({ is_active: false }).eq("id", seed!.id);
    const { data: stillActive } = await db.from("homepage_banners").select("is_active").eq("id", seed!.id).single();
    expect(stillActive!.is_active).toBe(true);

    await customerClient.from("homepage_banners").delete().eq("id", seed!.id);
    const { data: stillThere } = await db.from("homepage_banners").select("id").eq("id", seed!.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  it("an admin can insert, update, and delete a banner", async () => {
    const staffClient = authedClient(staffToken);

    const { data: created, error: insertError } = await staffClient
      .from("homepage_banners")
      .insert({ image_url: "https://example.test/qa-admin-crud.png", title: "QA TEST admin crud", is_active: true, sort_order: 999 })
      .select()
      .single();
    expect(insertError).toBeNull();
    createdIds.push(created!.id);

    const { error: updateError } = await staffClient.from("homepage_banners").update({ sort_order: 5 }).eq("id", created!.id);
    expect(updateError).toBeNull();
    const { data: updated } = await db.from("homepage_banners").select("sort_order").eq("id", created!.id).single();
    expect(updated!.sort_order).toBe(5);

    const { error: deleteError } = await staffClient.from("homepage_banners").delete().eq("id", created!.id);
    expect(deleteError).toBeNull();
    const { data: gone } = await db.from("homepage_banners").select("id").eq("id", created!.id).maybeSingle();
    expect(gone).toBeNull();
    createdIds.splice(createdIds.indexOf(created!.id), 1);
  });
});
