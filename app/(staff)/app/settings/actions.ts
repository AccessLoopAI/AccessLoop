"use server";

// "Save settings" (lead only). A public POST endpoint like every server action: it checks the signed-in member and
// the lead role itself, validates with lib/org-settings.ts, and updates ONLY the member's own org (orgs is not
// tenant-scoped, so the WHERE id = staff.orgId is the whole scope; the id never comes from the request).
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";
import { getStaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED, type CaseActionResult } from "@/lib/cases/action-result";
import { parseOrgSettings } from "@/lib/org-settings";

const FIELDS = ["feedbackDesignateTitle", "contactMailingAddress", "contactPhone", "contactEmail", "retestOfferText", "entityClass"] as const;

export async function saveSettings(form: FormData): Promise<CaseActionResult> {
  const staff = await getStaffOrg();
  if (!staff) return signedOutAnswer();
  const at = Date.now();
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at };

  const raw: Partial<Record<(typeof FIELDS)[number], string>> = {};
  for (const name of FIELDS) {
    const value = form.get(name);
    if (typeof value === "string") raw[name] = value;
  }
  const areas = form.getAll("planAreas").filter((v): v is string => typeof v === "string");
  const parsed = parseOrgSettings(raw, areas);
  if (!parsed.ok) return { ok: false, message: Object.values(parsed.errors)[0], fieldErrors: parsed.errors, at };

  try {
    const updated = await db.update(orgs).set(parsed.value).where(eq(orgs.id, staff.orgId)).returning({ id: orgs.id });
    if (updated.length !== 1) return { ok: false, message: REFUSED.failed, at: Date.now() };
  } catch (err) {
    console.error(`[settings] could not save the org settings (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: REFUSED.failed, at: Date.now() };
  }
  refresh();
  return { ok: true, message: "Settings saved. Your public pages and new reports use them from now on.", at: Date.now() };
}
