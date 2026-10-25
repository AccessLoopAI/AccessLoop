"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/** "Print poster": the browser's own print dialog; the print styles print the poster alone, one page. */
export function PrintPosterButton() {
  return (
    <Button onClick={() => window.print()} iconStart={<Icon icon={Printer} />}>
      Print poster
    </Button>
  );
}
