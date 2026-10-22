// Who is asking for an AI call (docs/domain.md §6.1, claude-cli hard limit 2). The fake and api backends ignore it;
// the claude-cli backend refuses to run without one, because the team's Claude subscription may only serve the team's
// own local development:
//
//   aiRequestContext(headers)    Inside Next (server actions, routes): pass the request's headers (`await headers()`
//                                or `request.headers`). claude-cli runs only when localRequestAllowed(headers) is true
//                                (AUTH_MODE=local, VERCEL unset, a localhost Host, and no forwarding header that points
//                                away from this computer), the same rule as the local "Sign in as" page. The Host
//                                alone is not enough: a tunnel or proxy that rewrites Host to localhost (ngrok
//                                --host-header=rewrite) would otherwise let anyone on the internet run the team's
//                                subscription through the public report form (review finding, docs/decisions.md
//                                2026-10-21).
//   aiLocalScriptContext(name)   A command-line script with no request, e.g. eval/run.ts started by `npm run eval` on
//                                the dev machine. claude-cli still requires AUTH_MODE=local and VERCEL unset, and also
//                                that the process is NOT a Next server (NEXT_RUNTIME unset; the `next` CLI sets it), so
//                                app code can't use this marker to skip the host check.
//
// No context at all means "unknown caller": claude-cli refuses.
import type { HeaderReader } from "@/lib/auth/local-request";

/** The request headers the local-request check reads (lib/auth/local-request.ts), copied when the context is made. */
export const AI_CONTEXT_HEADERS = ["host", "x-forwarded-host", "x-forwarded-for", "x-real-ip", "forwarded"] as const;
export type AiContextHeader = (typeof AI_CONTEXT_HEADERS)[number];

export type AiContext =
  | { readonly kind: "request"; readonly headers: Readonly<Record<AiContextHeader, string | null>> }
  | { readonly kind: "local-script"; readonly script: string };

/** For server actions and route handlers: the request's headers (`await headers()` or `request.headers`). */
export function aiRequestContext(headers: HeaderReader): AiContext {
  const copy = {} as Record<AiContextHeader, string | null>;
  for (const name of AI_CONTEXT_HEADERS) copy[name] = headers.get(name);
  return { kind: "request", headers: copy };
}

/** A HeaderReader over a request context's copied headers (for localRequestAllowed). */
export function aiContextHeaders(ctx: Extract<AiContext, { kind: "request" }>): HeaderReader {
  return { get: (name) => ctx.headers[name.toLowerCase() as AiContextHeader] ?? null };
}

/** For CLI scripts that run on the dev machine with no request (eval/run.ts). See the rules above. */
export function aiLocalScriptContext(script: string): AiContext {
  return { kind: "local-script", script };
}
