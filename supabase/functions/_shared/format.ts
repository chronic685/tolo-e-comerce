// Mirrors packages/ui/src/lib/format.ts's formatOrderNumber() -- Edge
// Functions run on Deno and can't import the npm-workspace @tolo/ui
// package, so this one small, stable formatter is duplicated rather than
// pulling in a whole frontend-oriented package (with a React peer
// dependency) just for one string template. Keep both in sync if the
// "TL-" prefix ever changes.
export function formatOrderNumber(orderNumber: number | string): string {
  return `TL-${orderNumber}`;
}
