// An organization's locations (Phase 7 T4.5, human decision D8: the `org_locations` table): the places, phone lines,
// websites and documents people may report about. The lead names each one at /app/settings/locations and prints a
// poster for it, whose QR code opens /o/{slug}/report?loc={id} with "Where did it happen?" filled in (domain §4).
// Client-safe: limits, validation and the pre-fill rule only (lib/locations/store.ts holds the queries).
import { DETAIL_MAX, LOCATION_KINDS, LOCATION_OPTIONS, type LocationKindValue } from "@/lib/intake/types";

export const LOCATION_NAME_MAX = 80;
export const LOCATION_DETAIL_MAX = 200;
/** One organization's list stays a list a person can read (and a lead can't fill the table by accident). */
export const LOCATIONS_PER_ORG_MAX = 200;

// The name and the detail together always fit the report form's "Where exactly?" box.
const PREFILL_SEPARATOR = ", ";
if (LOCATION_NAME_MAX + PREFILL_SEPARATOR.length + LOCATION_DETAIL_MAX > DETAIL_MAX) {
  throw new Error("lib/locations/input.ts: a location's name and detail must fit the form's Where exactly? box");
}

/** Location ids are uuids (gen_random_uuid()); anything else in ?loc= is ignored without asking the database. */
const LOCATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLocationId(value: unknown): value is string {
  return typeof value === "string" && LOCATION_ID.test(value);
}

export interface LocationInput {
  name: string;
  kind: LocationKindValue;
  /** null = none. */
  detail: string | null;
}

/** What the report form fills in from a poster: the step 2 answer and the "Where exactly?" text. */
export interface LocationPrefill {
  /** The location's name, as the poster prints it (shown to the reporter: "The poster you scanned is for …"). */
  name: string;
  locationKind: LocationKindValue;
  locationDetail: string;
}

/** The step 2 answer's words for a kind ("At a place"), as the reporter sees them. */
export function locationKindLabel(kind: LocationKindValue): string {
  return LOCATION_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

/** One line, single spaces (a pasted name keeps no tabs or line breaks). */
function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export type LocationField = "name" | "kind" | "detail";

export type ParsedLocation =
  | { ok: true; value: LocationInput }
  | { ok: false; errors: Partial<Record<LocationField, string>> };

/** The add and edit forms' fields, checked the same way on the server (the browser is never trusted). */
export function parseLocationInput(raw: { name?: unknown; kind?: unknown; detail?: unknown }): ParsedLocation {
  const errors: Partial<Record<LocationField, string>> = {};
  const name = oneLine(raw.name);
  const detail = oneLine(raw.detail);
  if (!name) errors.name = "Enter the name to print on the poster, for example Main Street branch.";
  else if (name.length > LOCATION_NAME_MAX) errors.name = `Keep the name under ${LOCATION_NAME_MAX} characters.`;
  const kind = LOCATION_KINDS.find((k) => k === raw.kind);
  if (!kind) errors.kind = "Choose the answer the form should start with.";
  if (detail.length > LOCATION_DETAIL_MAX) errors.detail = `Keep the detail under ${LOCATION_DETAIL_MAX} characters.`;
  if (Object.keys(errors).length || !kind) return { ok: false, errors };
  return { ok: true, value: { name, kind, detail: detail || null } };
}

/**
 * The report form's starting answers for a location: its kind, and "Where exactly?" = the name, then the detail
 * ("Main Street branch, front entrance"), so the case says which branch even when the detail alone ("front
 * entrance") would not. The person can change both.
 */
export function locationPrefill(loc: { name: string; kind: LocationKindValue; detail: string | null }): LocationPrefill {
  const detail = loc.detail?.trim();
  const text = detail ? `${loc.name}${PREFILL_SEPARATOR}${detail}` : loc.name;
  return { name: loc.name, locationKind: loc.kind, locationDetail: text.slice(0, DETAIL_MAX) };
}

/** The form's path for a location's poster (the QR code and the printed address add the site's base URL). */
export function posterPath(orgSlug: string, locationId: string): string {
  return `/o/${orgSlug}/report?loc=${locationId}`;
}
