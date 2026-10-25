"use server";

// The "Find similar past barriers" button of the staff case page (docs/domain.md §6.2). A public POST endpoint like
// every server action, so it checks everything again: the signed-in member, the lead role, the case looked up by
// ref INSIDE their org, and that the case has an area and a public summary. It reads; it never writes: no event, no
// link, no merge, no close. The AI call runs after the read transaction has ended (claude-cli may take 60 s).
import { headers } from "next/headers";
import { withOrg } from "@/db/tenant";
import { aiRequestContext } from "@/lib/ai/context";
import { getStaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED } from "@/lib/cases/action-result";
import { CASE_REF } from "@/lib/cases/labels";
import { similarCandidates, suggestSimilar, type SimilarFindResult } from "@/lib/cases/similar";
import { findStaffCase } from "@/lib/cases/staff-case";

export async function findSimilarBarriers(form: FormData): Promise<SimilarFindResult> {
  const staff = await getStaffOrg();
  if (!staff) return signedOutAnswer();
  const at = Date.now();
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at };
  const ref = form.get("ref");
  if (typeof ref !== "string" || !CASE_REF.test(ref)) return { ok: false, message: REFUSED.notFound, at };
  try {
    const found = await withOrg({ orgId: staff.orgId, role: "lead" }, async (tx) => {
      const c = await findStaffCase(tx, staff, ref);
      if (!c) return null;
      return { c, candidates: await similarCandidates(tx, c) };
    });
    if (!found) return { ok: false, message: REFUSED.notFound, at };
    return await suggestSimilar(found.c, found.candidates, aiRequestContext(await headers()));
  } catch (err) {
    console.error(`[case] similar past barriers failed (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: "That didn't work just now. Nothing was changed. Please try again.", at };
  }
}
