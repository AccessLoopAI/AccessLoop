// Locations and QR posters (Phase 7 T4.5; D8 org_locations, N1 qrcode): the lead's input rules, the report form's
// pre-fill rule, the poster's address and the server-drawn QR code. Pure: no database (tests/locations.seed.test.ts
// has the queries).
import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { orgBody } from "@/lib/api/v1/reporter";
import { EMPTY_DRAFT, sameAnswers, withPlace, type ReportDraft } from "@/lib/intake/draft";
import { DETAIL_MAX, LOCATION_OPTIONS } from "@/lib/intake/types";
import {
  isLocationId,
  LOCATION_DETAIL_MAX,
  LOCATION_NAME_MAX,
  locationKindLabel,
  locationPrefill,
  parseLocationInput,
  posterPath,
} from "@/lib/locations/input";
import { isLocalOnlyUrl, posterAddress } from "@/lib/locations/poster";
import { QR_QUIET_ZONE, qrDrawing } from "@/lib/locations/qr";
import type { PublicOrg } from "@/lib/orgs";

const ID = "0b0e8f8e-1c1d-4e6b-9a2f-3c4d5e6f7a8b";

describe("parseLocationInput (the add and edit forms, checked again on the server)", () => {
  it("accepts a name, an answer and an optional detail, on one line with single spaces", () => {
    expect(parseLocationInput({ name: "  Main   Street\tbranch ", kind: "place", detail: " front\nentrance " })).toEqual({
      ok: true,
      value: { name: "Main Street branch", kind: "place", detail: "front entrance" },
    });
    expect(parseLocationInput({ name: "Phone banking line", kind: "phone_or_service", detail: "   " })).toEqual({
      ok: true,
      value: { name: "Phone banking line", kind: "phone_or_service", detail: null },
    });
  });

  it("asks for a name and an answer, and keeps each field under its limit", () => {
    const empty = parseLocationInput({ name: " ", kind: "" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors.name).toMatch(/^Enter the name to print on the poster/);
      expect(empty.errors.kind).toBe("Choose the answer the form should start with.");
    }
    const long = parseLocationInput({ name: "x".repeat(LOCATION_NAME_MAX + 1), kind: "place", detail: "y".repeat(LOCATION_DETAIL_MAX + 1) });
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.errors.name).toBe(`Keep the name under ${LOCATION_NAME_MAX} characters.`);
      expect(long.errors.detail).toBe(`Keep the detail under ${LOCATION_DETAIL_MAX} characters.`);
    }
    expect(parseLocationInput({ name: "x".repeat(LOCATION_NAME_MAX), kind: "place" }).ok).toBe(true);
  });

  it("only takes the form's own answers for the kind (never a made-up one)", () => {
    for (const o of LOCATION_OPTIONS) expect(parseLocationInput({ name: "A", kind: o.value }).ok).toBe(true);
    for (const bad of ["moon", "PLACE", "", null, 3, ["place"]]) expect(parseLocationInput({ name: "A", kind: bad }).ok).toBe(false);
    expect(parseLocationInput({ name: ["A"], kind: "place" }).ok).toBe(false);
  });
});

describe("location ids from ?loc=", () => {
  it("only a uuid is looked up", () => {
    expect(isLocationId(ID)).toBe(true);
    expect(isLocationId(ID.toUpperCase())).toBe(true);
    for (const bad of ["", "abc", `${ID}x`, `${ID}'--`, ["a"], undefined, null, 1]) expect(isLocationId(bad)).toBe(false);
  });
});

describe("locationPrefill (what the report form fills in)", () => {
  it("chooses the location's answer and puts its name, then its detail, in Where exactly?", () => {
    expect(locationPrefill({ name: "Main Street branch", kind: "place", detail: "front entrance" })).toEqual({
      name: "Main Street branch",
      locationKind: "place",
      locationDetail: "Main Street branch, front entrance",
    });
    expect(locationPrefill({ name: "Online banking", kind: "digital", detail: null })).toEqual({
      name: "Online banking",
      locationKind: "digital",
      locationDetail: "Online banking",
    });
  });

  it("always fits the form's Where exactly? box", () => {
    const p = locationPrefill({ name: "n".repeat(LOCATION_NAME_MAX), kind: "place", detail: "d".repeat(LOCATION_DETAIL_MAX) });
    expect(p.locationDetail.length).toBeLessThanOrEqual(DETAIL_MAX);
  });

  it("names the answer as the reporter sees it", () => {
    expect(locationKindLabel("place")).toBe("At a place");
    expect(locationKindLabel("phone_or_service")).toBe("On the phone or at a service");
  });
});

describe("withPlace (the form's starting answers from a poster)", () => {
  const place = { locationKind: "place" as const, locationDetail: "Main Street branch, front entrance" };
  const draft = (over: Partial<ReportDraft>): ReportDraft => ({ ...EMPTY_DRAFT, ...over });

  it("fills an unanswered step 2", () => {
    expect(withPlace(EMPTY_DRAFT, place)).toEqual(draft({ locationKind: "place", locationDetail: "Main Street branch, front entrance" }));
    expect(withPlace(draft({ text: "The door is heavy." }), place)).toEqual(
      draft({ text: "The door is heavy.", locationKind: "place", locationDetail: "Main Street branch, front entrance" }),
    );
  });

  it("never overwrites the person's own answers", () => {
    const kept = draft({ locationKind: "digital", locationDetail: "" });
    expect(withPlace(kept, place)).toBe(kept);
    const typed = draft({ locationDetail: "the ramp at the back" });
    expect(withPlace(typed, place)).toEqual(draft({ locationKind: "place", locationDetail: "the ramp at the back" }));
  });

  it("changes nothing without a poster", () => {
    expect(withPlace(EMPTY_DRAFT, null)).toBe(EMPTY_DRAFT);
  });

  it("sameAnswers compares every answer", () => {
    expect(sameAnswers(withPlace(EMPTY_DRAFT, place), withPlace(EMPTY_DRAFT, place))).toBe(true);
    expect(sameAnswers(withPlace(EMPTY_DRAFT, place), EMPTY_DRAFT)).toBe(false);
    expect(sameAnswers(draft({ email: "a@b.ca" }), EMPTY_DRAFT)).toBe(false);
  });
});

describe("the poster's address", () => {
  it("is the report form with ?loc=, on the configured public base URL", () => {
    expect(posterPath("maple-harbour", ID)).toBe(`/o/maple-harbour/report?loc=${ID}`);
    expect(posterAddress("maple-harbour", ID, "https://accessloop.example/")).toEqual({
      url: `https://accessloop.example/o/maple-harbour/report?loc=${ID}`,
      localOnly: false,
    });
    expect(posterAddress("maple-harbour", ID, null)).toEqual({ url: null, localOnly: false });
  });

  it("says when phones can't open it (an address on this computer only)", () => {
    for (const local of ["http://localhost:3000/x", "http://127.0.0.1:3102/x", "http://[::1]:3000/x", "http://app.localhost/x", "not a url"]) {
      expect(isLocalOnlyUrl(local), local).toBe(true);
    }
    for (const pub of ["https://accessloop.example/x", "https://localhost.example.com/x", "http://10.0.0.5:3000/x"]) {
      expect(isLocalOnlyUrl(pub), pub).toBe(false);
    }
    expect(posterAddress("maple-harbour", ID, "http://localhost:3102").localOnly).toBe(true);
  });
});

describe("qrDrawing (the QR code, drawn on the server)", () => {
  const url = `https://accessloop.example/o/maple-harbour/report?loc=${ID}`;

  it("holds exactly the printed address", () => {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const held = qr.segments.map((s) => Buffer.from((s as unknown as { data: Uint8Array }).data).toString("utf8")).join("");
    expect(held).toBe(url);
    expect(qrDrawing(url).text).toBe(url);
  });

  it("draws every dark module once, inside a 4-module quiet zone", () => {
    const d = qrDrawing(url);
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    expect(d.size).toBe(n + 2 * QR_QUIET_ZONE);
    expect(d.version).toBe(qr.version);
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += qr.modules.get(r, c) ? 1 : 0;
    // Each run is "M{x} {y}h{len}v1h-{len}z": the lengths add up to the dark modules, and no run leaves the code.
    let drawn = 0;
    for (const m of d.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, len, back] = [m[1], m[2], m[3], m[4]].map(Number);
      expect(back).toBe(len);
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x + len).toBeLessThanOrEqual(QR_QUIET_ZONE + n);
      expect(y).toBeLessThan(QR_QUIET_ZONE + n);
      drawn += len;
    }
    expect(drawn).toBe(dark);
    expect(d.path.replace(/M\d+ \d+h\d+v1h-\d+z/g, "")).toBe("");
  });

  it("is the same drawing for the same address (posters printed twice match)", () => {
    expect(qrDrawing(url)).toEqual(qrDrawing(url));
    expect(qrDrawing(url).path).not.toBe(qrDrawing(`${url}0`).path);
  });
});

describe("GET /api/v1/orgs/{slug}?loc= (the Expo app's poster link)", () => {
  const ORG: PublicOrg = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "maple-harbour",
    name: "Maple Harbour Bank",
    feedbackDesignateTitle: "Accessibility Lead",
    contactPhone: "1-800-555-0101",
    contactEmail: "access@mapleharbour.example",
    contactMailingAddress: "1 Harbour Road, Halifax, NS B3H 0A1",
  };

  it("has no place without a location, and the web form's starting answers with one", () => {
    expect(orgBody(ORG).place).toBeNull();
    const place = locationPrefill({ name: "Main Street branch", kind: "place", detail: "front entrance" });
    expect(orgBody(ORG, place).place).toEqual({
      name: "Main Street branch",
      locationKind: "place",
      locationDetail: "Main Street branch, front entrance",
    });
  });
});
