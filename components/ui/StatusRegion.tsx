"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce | null>(null);

/**
 * THE one polite live region of the app (role="status"). Mounted once, in app/layout.tsx.
 * Nothing else may render role="status" or <output>. Never stream AI output into it.
 * It is visually hidden: pages also show the same message visibly (a Notice, a heading), so
 * sighted users get it too. The message is cleared on navigation.
 */
export function StatusRegionProvider({ children }: { children: ReactNode }) {
  // The message remembers the page it was announced on; after a navigation it is no longer shown.
  const [state, setState] = useState({ message: "", path: "" });
  const frame = useRef<number | null>(null);
  const pathname = usePathname();

  const announce = useCallback<Announce>((next) => {
    // Clear first, then set on the next frame, so repeating the same sentence is announced again.
    setState({ message: "", path: "" });
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setState({ message: next, path: window.location.pathname });
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const message = state.path === pathname ? state.message : "";
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="status-region">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

/** const announce = useAnnounce(); announce("Summarizing your report…"); */
export function useAnnounce(): Announce {
  const ctx = useContext(AnnounceContext);
  if (!ctx) throw new Error("useAnnounce() must be used inside <StatusRegionProvider> (app/layout.tsx).");
  return ctx;
}

/**
 * Announce a message when a server-rendered page arrives with a result (e.g. after a POST:
 * "Thank you. It's now marked as fixed and confirmed by you."). Renders nothing itself.
 */
export function Announce({ message }: { message: string }) {
  const announce = useAnnounce();
  useEffect(() => {
    if (message) announce(message);
  }, [announce, message]);
  return null;
}
