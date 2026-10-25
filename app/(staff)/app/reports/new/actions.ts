"use server";

// "Generate draft" (lead only; docs/domain.md §7: choose period -> freeze snapshot -> compile claims -> phrase ->
// validate -> store). A public POST endpoint like every server action: it checks the session, the lead role and the
// two dates itself. The org and the member come from the session only. On success it redirects to the new draft
// (outside any try/catch, so Next's redirect is never swallowed); the draft page announces "Draft ready".
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { aiRequestContext } from "@/lib/ai/context";
import { getStaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED, type CaseActionResult } from "@/lib/cases/action-result";
import { generateReport } from "@/lib/report/generate";
import { BUILT_COOKIE } from "@/lib/report/labels";
import { parsePeriod } from "@/lib/report/period";

const Form = z.object({ start: z.string().max(40), end: z.string().max(40) });

export async function generateDraft(form: FormData): Promise<CaseActionResult> {
  const staff = await getStaffOrg();
  if (!staff) return signedOutAnswer();
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at: Date.now() };

  const raw = Form.safeParse({ start: form.get("start") ?? "", end: form.get("end") ?? "" });
  if (!raw.success) return { ok: false, message: REFUSED.invalid, at: Date.now() };
  const period = parsePeriod(raw.data.start, raw.data.end);
  if (!period.ok) {
    const fieldErrors: Record<string, string> = {};
    if (period.fieldErrors.start) fieldErrors.start = period.fieldErrors.start;
    if (period.fieldErrors.end) fieldErrors.end = period.fieldErrors.end;
    return { ok: false, message: Object.values(fieldErrors)[0], fieldErrors, at: Date.now() };
  }

  let id: string;
  try {
    const ai = aiRequestContext(await headers()); // claude-cli runs only for a local request (domain §6.1)
    const r = await generateReport({ orgId: staff.orgId, memberId: staff.memberId, period: period.period, ai });
    if (!r.ok) return { ok: false, message: r.message, at: Date.now() };
    id = r.id;
  } catch (err) {
    // The class name only: never claim text, summaries or the error's own message.
    console.error(`[reports] could not build a draft (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: "We couldn't build the draft just now. Nothing was saved. Please try again.", at: Date.now() };
  }
  // The draft page plays "the report building itself" once for this id, then forgets it (signature moment 2). A
  // cookie, not a ?built=1 query: the address stays the draft's own, so a reload or a later save never replays it.
  (await cookies()).set(BUILT_COOKIE, id, { path: "/app/reports", maxAge: 120, sameSite: "lax", httpOnly: false, secure: !!process.env.VERCEL });
  redirect(`/app/reports/${id}`);
}
