// Shared in-app notification sender. Looks up the admin-editable template
// for an event (notification_templates), fills its {{variables}}, and
// respects the platform-wide notification_channels.in_app toggle — so
// disabling a channel or editing copy from the admin Settings/Notification
// Templates pages actually changes what gets sent, not just what's stored.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const inAppEnabled = (channelSettings?.value as { in_app?: boolean } | null)?.in_app ?? true;
  if (!inAppEnabled) return;

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

  await db.from("notifications").insert({
    user_id: userId,
    type: eventType,
    title: fill(template.title_template),
    body: fill(template.body_template),
  });
}
