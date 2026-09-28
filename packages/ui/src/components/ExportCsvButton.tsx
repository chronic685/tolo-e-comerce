import { Download } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

export interface ExportCsvButtonProps extends Omit<ButtonProps, "onClick"> {
  onExport: () => void;
}

/** The identical "Export CSV" action used across admin list pages — one
 * source instead of a hand-rolled button per page. */
export function ExportCsvButton({ onExport, disabled, className, ...props }: ExportCsvButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={disabled} className={className} {...props}>
      <Download className="w-3.5 h-3.5" />
      Export CSV
    </Button>
  );
}
