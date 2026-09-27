import { Toaster as SonnerToaster } from "sonner";

/** Mount once near the root of each app. Use the re-exported `toast` from
 * "@tolo/ui" anywhere to fire one. */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "font-sans",
          success: "!bg-emerald-50 !text-emerald-800 !border-emerald-200",
          error: "!bg-red-50 !text-red-800 !border-red-200",
        },
      }}
    />
  );
}

export { toast } from "sonner";
