"use server";

// "Add location" and "Save location" (lead only; Phase 7 T4.5). Public POST endpoints like every server action: each
// checks the signed-in member and the lead role itself, validates with lib/locations/input.ts, and writes ONLY inside
// the member's own org (withOrg with staff.orgId; the location id from the form is looked up inside that org, so
// another org's id finds nothing). Nothing typed here is logged.
import { refresh } from "next/cache";
import { getStaffOrg, type StaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED, type CaseActionResult } from "@/lib/cases/action-result";
import { LOCATIONS_PER_ORG_MAX, parseLocationInput, type LocationInput } from "@/lib/locations/input";
import { createLocation, updateLocation, type SaveLocationResult } from "@/lib/locations/store";

export type LocationActionResult = CaseActionResult & { id?: string };

const NOT_FOUND = "We can't find this location. Nothing was saved.";

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function refusal(result: Exclude<SaveLocationResult, { ok: true }>, name: string, at: number): LocationActionResult {
  if (result.reason === "duplicate") {
    const message = `You already have a location in use called ${name}. Give this one another name.`;
    return { ok: false, message, fieldErrors: { name: message }, at };
  }
  if (result.reason === "too_many") {
    return { ok: false, message: `You can have up to ${LOCATIONS_PER_ORG_MAX} locations. Change one you don't use any more.`, at };
  }
  return { ok: false, message: NOT_FOUND, at };
}

async function leadOrRefusal(): Promise<{ staff: StaffOrg } | { refused: LocationActionResult }> {
  const staff = await getStaffOrg();
  if (!staff) return { refused: signedOutAnswer() };
  if (staff.role !== "lead") return { refused: { ok: false, message: REFUSED.role, at: Date.now() } };
  return { staff };
}

function parsed(form: FormData): { value: LocationInput } | { refused: LocationActionResult } {
  const p = parseLocationInput({ name: text(form, "name"), kind: text(form, "kind"), detail: text(form, "detail") });
  if (p.ok) return { value: p.value };
  const fieldErrors: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.errors)) if (v) fieldErrors[k] = v;
  return { refused: { ok: false, message: Object.values(fieldErrors)[0] ?? REFUSED.invalid, fieldErrors, at: Date.now() } };
}

export async function addLocation(form: FormData): Promise<LocationActionResult> {
  const who = await leadOrRefusal();
  if ("refused" in who) return who.refused;
  const input = parsed(form);
  if ("refused" in input) return input.refused;
  let result: SaveLocationResult;
  try {
    result = await createLocation(who.staff.orgId, input.value);
  } catch (err) {
    console.error(`[locations] could not add a location (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: REFUSED.failed, at: Date.now() };
  }
  if (!result.ok) return refusal(result, input.value.name, Date.now());
  refresh();
  return {
    ok: true,
    id: result.id,
    message: `Location added: ${input.value.name}. Its poster is ready to print from the list.`,
    at: Date.now(),
  };
}

export async function saveLocation(form: FormData): Promise<LocationActionResult> {
  const who = await leadOrRefusal();
  if ("refused" in who) return who.refused;
  const input = parsed(form);
  if ("refused" in input) return input.refused;
  const status = text(form, "status");
  if (status !== "active" && status !== "retired") {
    const message = "Choose whether this location is in use.";
    return { ok: false, message, fieldErrors: { status: message }, at: Date.now() };
  }
  let result: SaveLocationResult;
  try {
    result = await updateLocation(who.staff.orgId, text(form, "id"), { ...input.value, active: status === "active" });
  } catch (err) {
    console.error(`[locations] could not save a location (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: REFUSED.failed, at: Date.now() };
  }
  if (!result.ok) return refusal(result, input.value.name, Date.now());
  refresh();
  return {
    ok: true,
    id: result.id,
    message:
      status === "active"
        ? `Location saved: ${input.value.name}. Its posters fill in the new details from now on.`
        : `Location saved and retired: ${input.value.name}. Its posters now open the form without the place filled in.`,
    at: Date.now(),
  };
}
