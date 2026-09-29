import { useState } from "react";
import { Download } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

export interface ExportCsvButtonProps extends Omit<ButtonProps, "onClick"> {
  // May be async: on a paginated list page, this typically needs to fetch
  // the whole matching set fresh (not just the current page's rows) before
  // building the CSV.
  onExport: () => void | Promise<void>;
}

/** The identical "Export CSV" action used across admin list pages — one
 * source instead of a hand-rolled button per page. */
export function ExportCsvButton({ onExport, disabled, className, ...props }: ExportCsvButtonProps) {
  const [exporting, setExporting] = useState(false);

  async function handleClick() {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={disabled || exporting} className={className} {...props}>
      <Download className="w-3.5 h-3.5" />
      {exporting ? "Exporting..." : "Export CSV"}
    </Button>
  );
}
