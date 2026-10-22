"use client";

// Signature moment 1 on the staff side (CLAUDE.md): the first time this browser opens a case the reporter has
// just verified, the badge and the closing ring play their one transition (CSS only, nothing under
// prefers-reduced-motion). This remembers the case afterwards, so later visits are calm. The page reads the same
// cookie on the server to decide; the cookie holds short case keys only (no text), path /app.
import { useEffect } from "react";
import { SEEN_VERIFIED_COOKIE, SEEN_VERIFIED_MAX, parseSeenVerified } from "@/lib/cases/seen-verified";

export function RememberVerified({ caseKey }: { caseKey: string }) {
  useEffect(() => {
    try {
      const raw = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${SEEN_VERIFIED_COOKIE}=`))
        ?.slice(SEEN_VERIFIED_COOKIE.length + 1);
      const keys = parseSeenVerified(raw);
      if (keys.includes(caseKey)) return;
      const next = [...keys, caseKey].slice(-SEEN_VERIFIED_MAX).join(".");
      document.cookie = `${SEEN_VERIFIED_COOKIE}=${next}; path=/app; max-age=31536000; samesite=lax`;
    } catch {
      // Cookies blocked: the moment may play again next time, which is harmless.
    }
  }, [caseKey]);
  return null;
}
