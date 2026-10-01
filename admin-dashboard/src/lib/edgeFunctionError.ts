// functions.invoke() replaces the function's own JSON error with a generic
// "non-2xx status code" message; the real one is on error.context.
export async function edgeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through to the generic message
    }
  }
  return (error as Error)?.message ?? "Something went wrong. Please try again.";
}
