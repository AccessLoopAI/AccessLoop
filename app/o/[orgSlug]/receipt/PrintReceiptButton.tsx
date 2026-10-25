"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/** "Print receipt": the browser's own print dialog; the print styles leave out the buttons and the header. */
export function PrintReceiptButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} iconStart={<Icon icon={Printer} />}>
      Print receipt
    </Button>
  );
}
