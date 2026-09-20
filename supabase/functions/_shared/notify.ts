// Shared notification sender. Looks up the admin-editable template for an
// event (notification_templates), fills its {{variables}}, and creates the
// in-app notification and/or sends the same content as SMS/email, each
// gated independently by system_settings.notification_channels
// (in_app / sms / email) — so disabling a channel or editing copy from the
// admin Settings/Notification Templates pages actually changes what gets
// sent, not just what's stored.
//
// SMS reuses the same Africa's Talking integration send-sms-otp already
// uses for auth OTPs (_shared/sms.ts), and email reuses Resend
// (_shared/email.ts) — neither stands up a second client for the same
// provider. Both reuse the same notification_templates row as in_app —
// there is no separate SMS/email-specific template today, so the outbound
// text is just "title: body" (or "title" as subject / "body" as content,
// for email).
//
// push has no provider connected at all (no credentials, nothing wired up
// anywhere) — its Settings.tsx toggle is disabled there until a real
// provider exists. Nothing here checks it, on purpose.
//
// SMS and email are deliberately NOT sent for every event type — see
// OUT_OF_APP_ALERT_EVENTS below:
//  - order_unacknowledged_escalated (internal Tolo ops/admin alert) and
//    merchant_approved/merchant_rejected (merchant approval) are both fired
//    from pure PL/pgSQL triggers (migrations 0033 and 0029) with no
//    HTTP-calling capability (no pg_net) — they never call this function at
//    all, so they can't reach SMS/email regardless. Alerting internal ops
//    staff by SMS/email for every escalation would also be exactly the
//    "minor internal event" spam this scoping exists to avoid.
//  - promotion is marketing content, not a transactional order/payment
//    update, and this schema has no per-user marketing consent field to
//    check — left off the allow-list rather than assumed safe to blast.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isEmailConfigured, sendEmail } from "./email.ts";
import { isSmsConfigured, sendSms } from "./sms.ts";

// Explicit allow-list, not "everything except a blocklist" — a future event
// type defaults to SMS/email-off until someone decides it belongs here.
// Covers the "new order" and "order status change" cases plus
// payment/refund outcomes, all of which are genuinely time-sensitive for
// someone who may not have the app open. Shared by both channels: nothing
// today needs SMS to reach a wider or narrower set of events than email.
const OUT_OF_APP_ALERT_EVENTS = new Set([
  "order_new",
  "order_received",
  "order_preparing",
  "order_ready_for_pickup",
  "order_picked_up",
  "order_delivered",
  "order_cancelled",
  "order_rejected",
  "payment_success",
  "payment_failed",
  "refund_issued",
]);

export async function sendNotification(
  db: SupabaseClient,
  userId: string,
  eventType: string,
  variables: Record<string, string | number>,
) {
  const { data: channelSettings } = await db
    .from("system_settings")
    .select("value")
    .eq("key", "notification_channels")
    .maybeSingle();
  const channels = channelSettings?.value as { in_app?: boolean; sms?: boolean; email?: boolean } | null;
  const inAppEnabled = channels?.in_app ?? true;
  const eventIsOutOfAppEligible = OUT_OF_APP_ALERT_EVENTS.has(eventType);
  const smsEnabled = (channels?.sms ?? true) && eventIsOutOfAppEligible;
  const emailEnabled = (channels?.email ?? true) && eventIsOutOfAppEligible;

  if (!inAppEnabled && !smsEnabled && !emailEnabled) return;

  const { data: template } = await db
    .from("notification_templates")
    .select("title_template, body_template, enabled")
    .eq("event_type", eventType)
    .eq("channel", "in_app")
    .eq("language", "en")
    .maybeSingle();

  if (!template || !template.enabled) return;

  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => String(variables[key] ?? ""));

  const title = fill(template.title_template);
  const body = fill(template.body_template);

  if (inAppEnabled) {
    await db.from("notifications").insert({
      user_id: userId,
      type: eventType,
      title,
      body,
    });
  }

  if (smsEnabled && isSmsConfigured()) {
    // No per-user notification opt-out or verified-phone gate exists
    // anywhere in this schema today (profiles.phone_verified is defined but
    // never set to true by anything, so gating on it would silently block
    // every SMS ever sent — that's not "respecting an existing check", it's
    // inventing a new one that happens to always fail). If either should be
    // a real prerequisite, that's a product decision for a follow-up, not
    // assumed here.
    const { data: profile } = await db.from("profiles").select("phone").eq("id", userId).maybeSingle();
    if (profile?.phone) {
      try {
        // Best-effort, same failure-isolation principle used everywhere
        // else notifications are sent (see migration 0033) — an SMS
        // provider hiccup must never fail the order/payment action that
        // triggered it.
        await sendSms(profile.phone, `${title}: ${body}`);
      } catch {
        // No logging infra for this yet — swallow rather than throw.
      }
    }
  }

  if (emailEnabled && isEmailConfigured()) {
    // Email lives on auth.users, not public.profiles — there's no
    // customer-facing table column for it, so this is the admin API lookup,
    // not a plain table select. Same best-effort failure isolation as SMS.
    const { data: userRecord } = await db.auth.admin.getUserById(userId);
    const email = userRecord?.user?.email;
    if (email) {
      try {
        await sendEmail(email, title, body);
      } catch {
        // No logging infra for this yet — swallow rather than throw.
      }
    }
  }
}
