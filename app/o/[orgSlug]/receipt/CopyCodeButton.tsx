"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { copyableCode } from "@/lib/intake/receipt-extras";

/**
 * "Copy code": copies the receipt code (its 16 letters and numbers, without hyphens: Phase 7 T4.4, so it pastes
 * cleanly into any field, and /check accepts it either way) and says so through the page's one status region, plus
 * a visible line for sighted users. If the browser can't copy (no clipboard access), it selects the code instead and
 * says how to copy it, so nobody is stuck.
 */
export function CopyCodeButton({
  code,
  codeElementId,
  children,
}: {
  code: string;
  codeElementId: string;
  /** The other receipt actions (the download link), kept in the same row, before the confirmation line. */
  children?: ReactNode;
}) {
  const announce = useAnnounce();
  const [result, setResult] = useState<"copied" | "selected" | null>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard not available");
      await navigator.clipboard.writeText(copyableCode(code));
      setResult("copied");
      announce("Code copied.");
    } catch {
      const el = document.getElementById(codeElementId);
      const selection = window.getSelection();
      if (el && selection) {
        selection.removeAllRanges();
        selection.selectAllChildren(el);
      }
      setResult("selected");
      announce("The code is selected. Copy it with your keyboard or your device's menu.");
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={copy} iconStart={<Icon icon={result === "copied" ? Check : Copy} />}>
        Copy code
      </Button>
      {children}
      {result ? (
        <p className="basis-full text-small font-bold text-ink-muted">
          {result === "copied" ? "Code copied." : "The code is selected. Copy it with your keyboard or your device's menu."}
        </p>
      ) : null}
    </>
  );
}
