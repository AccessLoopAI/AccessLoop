// The org settings form (/app/settings; ACR s.9(1) designate title, s.14(2) contact details, s.14(1)(b) plan areas).
// Pure and client-safe: field names, labels, limits and the validation the server action runs.
import { z } from "zod";
import type { orgs } from "@/db/schema";
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { EMAIL_PATTERN } from "@/lib/intake/types";

type OrgRow = typeof orgs.$inferSelect;
export type EntityClass = OrgRow["entityClass"];

/** "Organization type" (orgs.entity_class), which decides the next deadline (domain §1.5). Short labels: a native
 * <select> cuts longer option text at 390px. */
export const ENTITY_CLASS_OPTIONS: { value: EntityClass; label: string }[] = [
  { value: "federal_public", label: "Federal public sector" },
  { value: "private_large", label: "Large private (100+ employees)" },
  { value: "private_small", label: "Small private (10–99 employees)" },
];
const ENTITY_CLASSES = ENTITY_CLASS_OPTIONS.map((o) => o.value) as [EntityClass, ...EntityClass[]];

/** One checkbox per area of ACA s.5, named with the report heading (domain §1.2). */
export const PLAN_AREA_OPTIONS = PRIORITY_AREAS.map((value) => ({ value, label: AREA_HEADINGS[value].canonical }));

export const SETTINGS_LIMITS = { title: 120, address: 300, phone: 40, email: 254, offer: 200 } as const;

export interface OrgSettings {
  feedbackDesignateTitle: string;
  contactMailingAddress: string;
  contactPhone: string;
  contactEmail: string;
  retestOfferText: string | null;
  planAreas: PriorityArea[];
  entityClass: EntityClass;
}

export const SETTINGS_ERRORS = {
  title: "Enter the title of the person who receives feedback, like Accessibility Lead.",
  titleTooLong: `Keep the title under ${SETTINGS_LIMITS.title} characters.`,
  address: "Enter the mailing address where people can send feedback.",
  addressTooLong: `Keep the address under ${SETTINGS_LIMITS.address} characters.`,
  phone: "Enter a phone number with at least 7 digits, like 1-800-555-0100.",
  email: "Enter an email address, like accessibility@example.com.",
  offerTooLong: `Keep the offer under ${SETTINGS_LIMITS.offer} characters.`,
  planAreas: "Choose at least one area of your accessibility plan.",
  entityClass: "Choose your organization type.",
} as const;

const PHONE_CHARS = /^[0-9+().\-\s]*(?:(?:ext\.?|x)\s*[0-9]+)?$/i;

/** A `tel:` link for a saved phone number (RFC 3966): the digits and a leading +, and an extension as `;ext=N`, so
 * "613-555-0100 ext. 22" dials 6135550100 then 22, never the made-up number 613555010022. */
export function telHref(phone: string): string {
  const m = phone.match(/^(.*?)(?:\s*(?:ext\.?|x)\s*([0-9]+))?\s*$/i);
  const main = (m?.[1] ?? phone).replace(/[^\d+]/g, "");
  return `tel:${main}${m?.[2] ? `;ext=${m[2]}` : ""}`;
}
const SimpleEmail = z.email();

/** Validate the settings form. `planAreas` is every ticked value (FormData.getAll). */
export function parseOrgSettings(
  raw: Partial<Record<"feedbackDesignateTitle" | "contactMailingAddress" | "contactPhone" | "contactEmail" | "retestOfferText" | "entityClass", string>>,
  planAreas: readonly string[],
): { ok: true; value: OrgSettings } | { ok: false; errors: Record<string, string> } {
  const v = (k: keyof typeof raw) => (raw[k] ?? "").trim();
  const errors: Record<string, string> = {};

  const title = v("feedbackDesignateTitle");
  if (!title) errors.feedbackDesignateTitle = SETTINGS_ERRORS.title;
  else if (title.length > SETTINGS_LIMITS.title) errors.feedbackDesignateTitle = SETTINGS_ERRORS.titleTooLong;

  const address = v("contactMailingAddress");
  if (!address) errors.contactMailingAddress = SETTINGS_ERRORS.address;
  else if (address.length > SETTINGS_LIMITS.address) errors.contactMailingAddress = SETTINGS_ERRORS.addressTooLong;

  const phone = v("contactPhone").replace(/\s+/g, " ");
  const digits = phone.replace(/\D/g, "").length;
  if (!phone || digits < 7 || phone.length > SETTINGS_LIMITS.phone || !PHONE_CHARS.test(phone)) errors.contactPhone = SETTINGS_ERRORS.phone;

  const email = v("contactEmail");
  if (!email || email.length > SETTINGS_LIMITS.email || !EMAIL_PATTERN.test(email) || !SimpleEmail.safeParse(email).success) {
    errors.contactEmail = SETTINGS_ERRORS.email;
  }

  const offer = v("retestOfferText").replace(/\s+/g, " ");
  if (offer.length > SETTINGS_LIMITS.offer) errors.retestOfferText = SETTINGS_ERRORS.offerTooLong;

  const areas = PRIORITY_AREAS.filter((a) => planAreas.includes(a));
  if (areas.length === 0) errors.planAreas = SETTINGS_ERRORS.planAreas;

  const entity = z.enum(ENTITY_CLASSES).safeParse(v("entityClass"));
  if (!entity.success) errors.entityClass = SETTINGS_ERRORS.entityClass;

  if (Object.keys(errors).length || !entity.success) return { ok: false, errors };
  return {
    ok: true,
    value: {
      feedbackDesignateTitle: title,
      contactMailingAddress: address,
      contactPhone: phone,
      contactEmail: email,
      retestOfferText: offer || null,
      planAreas: areas,
      entityClass: entity.data,
    },
  };
}
