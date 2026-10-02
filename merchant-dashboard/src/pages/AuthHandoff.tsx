import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";

// Lands here as /auth/handoff?code=<code>&embed=app when the Tolo app's
// "Merchant" button opens the merchant dashboard in its WebView -- the
// merchant counterpart of frontend/src/pages/AuthHandoff.tsx. The code is
// exchanged with tolo-merchant-login, which only succeeds for the account
// linked to the code's Tolo-verified phone, and only once that phone's
// merchant application has been approved. There is no password involved.
//
// The code is single-use, so this must run exactly once per code even
// under React StrictMode's dev double-invoke -- a ref guards that, since
// state updates aren't synchronous enough to block a second effect run.
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
    // Only an in-app path: never an absolute or protocol-relative URL, so
    // a crafted link can't bounce a freshly signed-in merchant off-site.
    const nextParam = params.get("next");
    const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

    if (!code) {
      setError(t("merchantAuthHandoff.missingCode"));
      return;
    }

    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke("tolo-merchant-login", { body: { code } });
      if (invokeError || !data?.session) {
        setError(t("merchantAuthHandoff.failed"));
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) {
        setError(t("merchantAuthHandoff.failed"));
        return;
      }

      // Drop the one-time code from the URL immediately so it can't be
      // replayed from browser history, the back button, or a shared link.
      window.history.replaceState({}, "", window.location.pathname);
      navigate(next, { replace: true });
    })();
  }, [params, navigate, t]);

  if (error) {
    return <p className="text-red-600 dark:text-red-400 text-center mt-10">{error}</p>;
  }
  return <p className="text-gray-500 dark:text-gray-400 text-center mt-10">{t("merchantAuthHandoff.signingIn")}</p>;
}
