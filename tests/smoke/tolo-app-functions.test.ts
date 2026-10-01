import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Real HTTP calls to the four Tolo-app Edge Functions (tolo-app-login,
// tolo-merchant-login, review-merchant-application,
// merchant-application-status) running under CI's Deno runtime
// (`supabase functions serve`) -- request handling, Deno.env, and every
// Supabase client call included, not just the pure logic the supabase/
// Vitest project covers.
//
// The Tolo backend is tests/ci/tolo-backend-stub.mjs, which only CI
// starts, so this whole file runs only where the workflow sets
// TOLO_CI_INBOUND_KEY. Locally the backend suite points at the live
// project, which has no stub -- and these tests create accounts.
const INBOUND_KEY = process.env.TOLO_CI_INBOUND_KEY;

interface Session {
  access_token: string;
  refresh_token: string;
}

/** A fresh, valid Ethiopian mobile number per call. */
function newPhone(): string {
  return `+2519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/** A one-time code the stub verifies to `phone` (exactly once). */
function codeFor(phone: string): string {
  return `valid.${phone}.${randomUUID()}`;
}

async function toloLogin(phone: string): Promise<Session> {
  const res = await callFunction("tolo-app-login", { body: { code: codeFor(phone) } });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json as { session: Session }).session;
}

async function clientFor(session: Session): Promise<SupabaseClient> {
  const client = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.setSession(session);
  if (error) throw error;
  return client;
}

async function userIdOf(session: Session): Promise<string> {
  const { data } = await (await clientFor(session)).auth.getUser();
  return data.user!.id;
}

// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

describe.skipIf(!INBOUND_KEY)("Tolo-app Edge Functions under the Deno runtime", () => {
  const db = serviceClient();
  let categoryId: string;
  let adminToken: string;
  let previousRateLimits: unknown;

  /** Signs a new customer in through tolo-app-login and submits an application as them. */
  async function applicant(): Promise<{ phone: string; session: Session; userId: string; applicationId: string }> {
    const phone = newPhone();
    const session = await toloLogin(phone);
    const client = await clientFor(session);
    const userId = await userIdOf(session);
    const path = `${userId}/${randomUUID()}.png`;
    const upload = await client.storage.from("merchant-application-licenses").upload(path, PNG, { contentType: "image/png" });
    expect(upload.error).toBeNull();
    const { data, error } = await client
      .rpc("submit_merchant_application", {
        p_business_name: "CI TEST — Tolo applicant",
        p_category_id: categoryId,
        p_address: "CI Test Address, Addis Ababa",
        p_license_photo_url: path,
      })
      .single();
    expect(error).toBeNull();
    return { phone, session, userId, applicationId: (data as { id: string }).id };
  }

  function review(applicationId: string, action: "approve" | "reject", token: string = adminToken) {
    return callFunction("review-merchant-application", { token, body: { application_id: applicationId, action, note: "CI review" } });
  }

  function status(phone: unknown, key: string | null = INBOUND_KEY!) {
    // Server-to-server call: the inbound key is the bearer, no Supabase JWT.
    return callFunction("merchant-application-status", {
      body: { phone },
      headers: key === null ? { Authorization: "" } : { Authorization: `Bearer ${key}` },
    });
  }

  beforeAll(async () => {
    // Both logins rate-limit by source IP (default 25 per 10 min, migration
    // 0077), and every call here comes from the same runner. Raise the
    // limit for this file only -- this is CI's throwaway database -- and
    // restore it after.
    const { data: settings } = await db.from("system_settings").select("value").eq("key", "rate_limits").maybeSingle();
    previousRateLimits = settings?.value ?? null;
    const raised = { ...((settings?.value as object) ?? {}), app_login: { max_count: 500, window_seconds: 600 }, merchant_app_login: { max_count: 500, window_seconds: 600 } };
    await db.from("system_settings").upsert({ key: "rate_limits", value: raised });

    const slug = `ci-tolo-${randomUUID()}`;
    const { data: category, error } = await db.from("categories").insert({ name: "CI TEST category", slug }).select("id").single();
    if (error) throw error;
    categoryId = category.id;

    adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
  });

  afterAll(async () => {
    if (previousRateLimits) await db.from("system_settings").update({ value: previousRateLimits }).eq("key", "rate_limits");
  });

  describe("tolo-app-login", () => {
    it("redeems a valid code with the (stubbed) Tolo backend and returns a working session linked to that phone", async () => {
      const phone = newPhone();
      const session = await toloLogin(phone);
      const client = await clientFor(session);
      // The session is real, and the account is linked to the verified phone.
      const { data: link } = await client.from("tolo_phone_links").select("phone").single();
      expect(link).toEqual({ phone });
    });

    it("rejects a missing code with 400 and an unknown code with the generic 401", async () => {
      expect((await callFunction("tolo-app-login", { body: {} })).status).toBe(400);
      const res = await callFunction("tolo-app-login", { body: { code: "not-a-real-code" } });
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: "Sign-in failed." });
    });

    it("refuses a reused (duplicate) code", async () => {
      const code = codeFor(newPhone());
      expect((await callFunction("tolo-app-login", { body: { code } })).status).toBe(200);
      const replay = await callFunction("tolo-app-login", { body: { code } });
      expect(replay.status).toBe(401);
      expect(replay.json).toEqual({ error: "Sign-in failed." });
    });

    it("an attacker who sets their profile phone to someone's number doesn't capture that person's login", async () => {
      const attacker = await toloLogin(newPhone());
      const attackerId = await userIdOf(attacker);
      const victimPhone = newPhone();
      const { error } = await (await clientFor(attacker)).from("profiles").update({ phone: victimPhone }).eq("id", attackerId);
      expect(error).toBeNull();

      const victim = await toloLogin(victimPhone);
      expect(await userIdOf(victim)).not.toBe(attackerId);
    });
  });

  describe("review-merchant-application", () => {
    it("rejects a caller with no session (401) and a non-admin customer (403)", async () => {
      const { applicationId, session } = await applicant();
      expect((await callFunction("review-merchant-application", { body: { application_id: applicationId, action: "approve" } })).status).toBe(401);
      const asCustomer = await review(applicationId, "approve", session.access_token);
      expect(asCustomer.status).toBe(403);
    });

    it("an admin approves: an active merchant is created for the applicant's own account", async () => {
      const { applicationId, userId } = await applicant();
      const res = await review(applicationId, "approve");
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const merchantId = (res.json as { merchant_id: string }).merchant_id;
      const { data: merchant } = await db.from("merchants").select("owner_id, status").eq("id", merchantId).single();
      expect(merchant).toEqual({ owner_id: userId, status: "active" });

      // Reviewing it again is a conflict, not a second merchant.
      expect((await review(applicationId, "approve")).status).toBe(409);
    });

    it("an admin rejects, and the applicant can then reapply", async () => {
      const { applicationId, session } = await applicant();
      expect((await review(applicationId, "reject")).status).toBe(200);
      const { data } = await db.from("merchant_applications").select("status, admin_note").eq("id", applicationId).single();
      expect(data).toEqual({ status: "rejected", admin_note: "CI review" });

      const client = await clientFor(session);
      const userId = await userIdOf(session);
      const path = `${userId}/${randomUUID()}.png`;
      expect((await client.storage.from("merchant-application-licenses").upload(path, PNG, { contentType: "image/png" })).error).toBeNull();
      const again = await client.rpc("submit_merchant_application", {
        p_business_name: "CI TEST — reapplied",
        p_category_id: categoryId,
        p_address: "CI Test Address, Addis Ababa",
        p_license_photo_url: path,
      });
      expect(again.error).toBeNull();
    });
  });

  describe("merchant-application-status", () => {
    it("rejects a missing or wrong inbound key with 401", async () => {
      expect((await status(newPhone(), null)).status).toBe(401);
      expect((await status(newPhone(), "wrong-key")).status).toBe(401);
    });

    it("reports pending, then approved with is_merchant once an admin approves", async () => {
      const { phone, applicationId } = await applicant();
      const pending = await status(phone);
      expect(pending.status).toBe(200);
      expect(pending.json).toMatchObject({ phone, is_merchant: false, application: { id: applicationId, status: "pending" } });

      expect((await review(applicationId, "approve")).status).toBe(200);
      expect((await status(phone)).json).toMatchObject({ is_merchant: true, application: { status: "approved" } });
    });

    it("answers for a phone that never applied, and rejects an invalid phone with 400", async () => {
      expect((await status(newPhone())).json).toMatchObject({ is_merchant: false, application: null });
      expect((await status("12345")).status).toBe(400);
    });
  });

  describe("tolo-merchant-login", () => {
    it("signs an approved merchant in, no password, to the account that owns the merchant", async () => {
      const { phone, applicationId, userId } = await applicant();
      expect((await review(applicationId, "approve")).status).toBe(200);

      const res = await callFunction("tolo-merchant-login", { body: { code: codeFor(phone) } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const session = (res.json as { session: Session }).session;
      expect(await userIdOf(session)).toBe(userId);
      // With that session, merchants RLS shows the merchant it owns --
      // exactly what merchant-dashboard's MerchantContext loads.
      const { data: merchants } = await (await clientFor(session)).from("merchants").select("owner_id, status").eq("owner_id", userId);
      expect(merchants).toEqual([{ owner_id: userId, status: "active" }]);
    });

    it("rejects a missing code with 400", async () => {
      expect((await callFunction("tolo-merchant-login", { body: {} })).status).toBe(400);
    });

    it("refuses an applicant whose application is still pending, and a customer who never applied", async () => {
      const { phone } = await applicant();
      expect((await callFunction("tolo-merchant-login", { body: { code: codeFor(phone) } })).json).toEqual({ error: "Sign-in failed." });

      const customerPhone = newPhone();
      await toloLogin(customerPhone);
      const res = await callFunction("tolo-merchant-login", { body: { code: codeFor(customerPhone) } });
      expect(res.status).toBe(401);
    });

    it("refuses a reused code", async () => {
      const { phone, applicationId } = await applicant();
      expect((await review(applicationId, "approve")).status).toBe(200);
      const code = codeFor(phone);
      expect((await callFunction("tolo-merchant-login", { body: { code } })).status).toBe(200);
      expect((await callFunction("tolo-merchant-login", { body: { code } })).status).toBe(401);
    });
  });
});
