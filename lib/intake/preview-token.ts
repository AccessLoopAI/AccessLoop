// The preview token (reporter flow step 3 -> step 4 -> submit). The preview server action runs the AI once
// and hands the browser a SEALED token; "Send report" hands it back. The server then re-runs redaction itself
// and uses the token only if it is genuine AND was made for exactly the text the server now redacts.
//
//   token = base64url(encrypt(JSON payload)) + "." + hmacHex("SESSION_SECRET", "intake-preview:" + body)
//
// Encrypted (AES-256-GCM, lib/crypto.ts) so the reporter never receives the suggested areas or the layer-2
// values; MACed with SESSION_SECRET so it can't be forged. The token never holds the raw text, only hashes.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decrypt, encrypt, hmacHex } from "@/lib/crypto";
import { AI_BACKENDS } from "@/lib/ai/backend";
import { PiiItemSchema, StructureOutputSchema } from "@/lib/ai/schemas";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One redacted piece of text: the hash of its redacted form and the layer-2 values (null = failed). */
const RedactedPartSchema = z.object({ sha: SHA256, pii: z.array(PiiItemSchema).nullable() });

export const AiMetaSchema = z.object({
  backend: z.enum(AI_BACKENDS),
  model: z.string(),
  promptSha: z.string(),
  latencyMs: z.number().int().nonnegative(),
  cliVersion: z.string().optional(),
});

const PreviewPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal("intake_preview"),
  orgId: z.string().regex(UUID),
  /** sha256 of the server's redacted report text, the text structure() saw. */
  maskedSha256: SHA256,
  /** Layer-2 values for the report text (null = flagPii failed: manual redaction). */
  pii: z.array(PiiItemSchema).nullable(),
  /** The "Where exactly?" text, redacted the same way; null when it was empty. */
  detail: RedactedPartSchema.nullable(),
  /** structure() on the redacted text, with its backend metadata; null when it failed. */
  ai: z.object({ value: StructureOutputSchema, meta: AiMetaSchema }).nullable(),
});

export type PreviewPayload = z.infer<typeof PreviewPayloadSchema>;

/**
 * The longest token "Send report" accepts (its zod schema) and openPreview reads. buildPreview never hands out a
 * longer one: a real model's long answer (many layer-2 items, long notes) then counts as "no summary", the shared
 * fallback, instead of a token that would make "Send report" fail.
 */
export const PREVIEW_TOKEN_MAX = 16_000;
const MAC_CONTEXT = "intake-preview:"; // keeps these MACs apart from other SESSION_SECRET uses (local session)

function mac(body: string): string {
  return hmacHex("SESSION_SECRET", MAC_CONTEXT + body);
}

export function sealPreview(payload: Omit<PreviewPayload, "v" | "kind">): string {
  const full: PreviewPayload = { v: 1, kind: "intake_preview", ...payload };
  const body = Buffer.from(encrypt(JSON.stringify(full)), "utf8").toString("base64url");
  return `${body}.${mac(body)}`;
}

/** The payload if the token is genuine and well-formed, else null. Never throws. */
export function openPreview(token: unknown): PreviewPayload | null {
  if (typeof token !== "string" || token.length === 0 || token.length > PREVIEW_TOKEN_MAX) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(given)) return null;
  try {
    const expected = Buffer.from(mac(body), "hex");
    if (!timingSafeEqual(Buffer.from(given, "hex"), expected)) return null;
    const json = decrypt(Buffer.from(body, "base64url").toString("utf8"));
    const parsed = PreviewPayloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
