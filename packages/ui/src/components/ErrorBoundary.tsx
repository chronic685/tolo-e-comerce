import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { I18nContext } from "../i18n/I18nProvider";
import { resolveString } from "../i18n/loadTranslations";
import { getCurrentLocale } from "../i18n/locale";
import { Button } from "./Button";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called with the thrown error, e.g. to report it -- this component
   * never reports anything on its own. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// React error boundaries must be class components -- there is still no
// hook equivalent of getDerivedStateFromError/componentDidCatch. Reads
// translations directly (not via useTranslation(), which needs a function
// component) using the same locale/lookup helpers I18nProvider itself uses,
// so the fallback UI is still translated even though this can't be a
// context *consumer* of the normal hook shape.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- last resort: no crash reporter is wired up in this codebase yet.
    console.error("Unhandled error caught by ErrorBoundary:", error, info);
    this.props.onError?.(error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Falls back to a raw lookup (not through the hook) if this boundary
    // somehow renders outside I18nProvider -- an error screen must never
    // itself throw for want of context.
    const locale = this.context?.locale ?? getCurrentLocale();
    const t = (key: string) => resolveString(locale, key);

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <p className="font-medium text-gray-800 dark:text-gray-100">{t("errorBoundary.title")}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("errorBoundary.description")}</p>
          <Button className="mt-4" onClick={this.handleReset}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }
}
