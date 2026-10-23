// What a staff action answers when it arrives without a valid session: the local session ended (frozen
// lib/auth/local-session.ts, 12 hours from sign-in) or the person signed out in another tab. Client-safe.
// proxy.ts answers a server-action POST without a session with this text (401, text/plain), which Next's client
// throws as the Error's message; the actions return it too if they find no member. Either way the form keeps what
// was typed and the person learns why nothing was saved (WCAG 2.2.1, 3.3.1), instead of a generic "try again".
export const SIGNED_OUT =
  "You are signed out, so nothing was saved. Sign in again in a new tab, then press the button again.";

/** The sentence for a server-action call that threw: the signed-out answer from proxy.ts, else `fallback`. */
export function actionFailureMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message === SIGNED_OUT ? SIGNED_OUT : fallback;
}

/** A refusal every staff action's result type accepts. */
export function signedOutAnswer(): { ok: false; message: string; at: number } {
  return { ok: false, message: SIGNED_OUT, at: Date.now() };
}
