"use client";

import { useEffect } from "react";
import { clearDraft } from "@/lib/intake/draft";
import { receiptSeenPath } from "@/lib/intake/receipt-cookie";

/**
 * The receipt is on screen: the report was sent, so the draft kept in this browser (lib/intake/draft.ts) has done
 * its job, and the cookie that carried the code is cleared (Phase 7 T3.10), so the code is shown only this once.
 * Rendered only with a valid receipt, i.e. right after "Send report" in this browser. Renders nothing; a failed
 * request changes nothing on the page (the cookie then ends on its own after 2 minutes).
 */
export function ReceiptSeen({ orgSlug }: { orgSlug: string }) {
  useEffect(() => {
    clearDraft(orgSlug);
    fetch(receiptSeenPath(orgSlug), { method: "POST", credentials: "same-origin", keepalive: true, cache: "no-store" }).catch(
      () => undefined,
    );
  }, [orgSlug]);
  return null;
}
