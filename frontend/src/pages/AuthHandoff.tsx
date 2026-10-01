import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";

// Lands here as /auth/handoff?code=<code>&embed=app when the Tolo Delivery
// app opens this site in its WebView. The code is single-use, so this must
// run exactly once per code even under React StrictMode's dev double-invoke
// -- a ref guards that, since state updates aren't synchronous enough to
// block a second effect run.
export function AuthHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const embed = params.get("embed");
    const next = params.get("next") || "/";

    if (!code) {
      setError(t("errors.missingSignInCode"));
      return;
    }

    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke("tolo-app-login", { body: { code } });
      if (invokeError || !data?.session) {
        setError(t("errors.toloSignInFailed"));
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) {
        setError(t("errors.toloSignInFailed"));
        return;
      }

      // Drop the one-time code from the URL immediately so it can't be
      // replayed from browser history, the back button, or a shared link.
      window.history.replaceState({}, "", window.location.pathname);

      // embed=app isn't dropped from history above by accident -- it's
      // re-appended onto the destination explicitly so in-app embed mode
      // (see docs/integration/embed-mode.md) still detects it on the page
      // this redirects to.
      const destination = embed === "app" ? `${next}${next.includes("?") ? "&" : "?"}embed=app` : next;
      navigate(destination, { replace: true });
    })();
  }, [params, navigate, t]);

  if (error) {
    return <p className="text-red-600 text-center mt-10">{error}</p>;
  }
  return <p className="text-gray-500 text-center mt-10">{t("authHandoff.signingIn")}</p>;
}
