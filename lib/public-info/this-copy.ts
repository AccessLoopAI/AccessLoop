// What THIS running copy of AccessLoop is set up to do, for the public /trust and /accessibility pages.
// The pages say it in words ("The AI is simulated", "Emails are not sent", "saved on this computer"), so a reader
// of a local prototype is never told that real AI or real email is on when it isn't, and the other way round.
//
// Pure: it reads only the env object it is given, and it never returns an env value (no URL, host, key, model
// ID or address), only which of a few fixed cases applies. The pages that use it are dynamic, so they follow the
// server's env at request time (Playwright forces FAKE_LLM=1 and FAKE_EMAIL=1 on its server).
import { effectiveBackend } from "@/lib/ai/backend";

/** Which AI answers: the fake (ready-made answers), Anthropic's API, the team's claude-cli dev tool, or a bad setting. */
export type AiSetup = "simulated" | "api" | "claude-cli" | "misconfigured";
/** lib/email/send.ts: FAKE_EMAIL=1 logs only; otherwise Resend needs RESEND_API_KEY and EMAIL_FROM, else "failed". */
export type EmailSetup = "simulated" | "resend" | "not_set_up";
/** Where DATABASE_URL points: a loopback host (this computer), any other host, or no usable URL. */
export type StorageSetup = "this_computer" | "hosted" | "unknown";

export interface ThisCopy {
  ai: AiSetup;
  email: EmailSetup;
  storage: StorageSetup;
}

type Env = Readonly<Record<string, string | undefined>>;

function aiSetup(env: Env): AiSetup {
  try {
    const backend = effectiveBackend(env); // the one rule every AI call uses (FAKE_LLM=1 wins)
    return backend === "fake" ? "simulated" : backend;
  } catch {
    return "misconfigured"; // an unknown AI_BACKEND: every AI call fails, so no AI is used
  }
}

function emailSetup(env: Env): EmailSetup {
  if (env.FAKE_EMAIL === "1") return "simulated"; // exactly the mailer's test (lib/email/send.ts)
  return env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim() ? "resend" : "not_set_up";
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

function storageSetup(env: Env): StorageSetup {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return "unknown";
  try {
    const host = new URL(raw).hostname;
    if (!host) return "unknown"; // e.g. a Unix socket given as a query parameter
    return LOOPBACK.test(host) ? "this_computer" : "hosted";
  } catch {
    return "unknown";
  }
}

export function describeThisCopy(env: Env = process.env): ThisCopy {
  return { ai: aiSetup(env), email: emailSetup(env), storage: storageSetup(env) };
}
