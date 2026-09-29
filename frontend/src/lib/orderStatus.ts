import { useTranslation } from "@tolo/ui";

// Customer-facing copy (spec: order status should read as reassurance, not
// raw internal state names). Group 5: a hook, not a plain exported const,
// since the copy is now translated -- it needs the active locale from
// useTranslation(), which only works inside a component.
const STATUSES = ["new", "accepted", "processing", "ready_for_pickup", "picked_up", "delivered", "completed", "cancelled", "rejected"] as const;

export function useStatusCopy(): Record<string, { label: string; detail: string }> {
  const { t } = useTranslation();
  return Object.fromEntries(
    STATUSES.map((status) => [status, { label: t(`customerOrderStatus.${status}.label`), detail: t(`customerOrderStatus.${status}.detail`) }]),
  );
}
