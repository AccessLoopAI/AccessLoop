// lib/intake/receipt-extras.ts (Phase 7 T4.4): the code in two groups of eight, its spelled-out reading, the copy
// without hyphens, the text file and the calendar reminder, which must NEVER hold the code.
import { describe, expect, it } from "vitest";
import {
  codeHalves,
  copyableCode,
  dataUrl,
  icsEscape,
  icsFold,
  receiptTextFile,
  reminderCalendar,
  spellCode,
} from "@/lib/intake/receipt-extras";
import { formatReceiptCode, generateReceiptCode, normalizeReceiptCode } from "@/lib/receipt-code";

const CODE = "7K3M-9Q2D-XW4H-B8RT";

describe("the receipt code on screen", () => {
  it("shows two groups of eight, each still split in the middle", () => {
    expect(codeHalves(CODE)).toEqual(["7K3M-9Q2D", "XW4H-B8RT"]);
    expect(codeHalves(CODE).join("-")).toBe(CODE);
  });

  it("spells each group out: digits as words, letters with a word that can't be misheard", () => {
    const [first, second] = spellCode(CODE);
    expect(first).toBe("seven, K for Kilo, three, M for Mike, nine, Q for Quebec, two, D for Delta");
    expect(second).toBe("X for X-ray, W for Whiskey, four, H for Hotel, B for Bravo, eight, R for Romeo, T for Tango");
  });

  it("has a word for every character a receipt code can hold", () => {
    for (let i = 0; i < 50; i++) {
      const code = formatReceiptCode(normalizeReceiptCode(generateReceiptCode())!);
      for (const half of spellCode(code)) {
        for (const part of half.split(", ")) expect(part, code).toMatch(/^([a-z]+|[A-Z] for [A-Z][a-zA-Z-]+)$/);
      }
    }
  });

  it("copies the 16 letters and numbers without hyphens, which /check still accepts", () => {
    expect(copyableCode(CODE)).toBe("7K3M9Q2DXW4HB8RT");
    expect(normalizeReceiptCode(copyableCode(CODE))).toBe(normalizeReceiptCode(CODE));
  });
});

describe("the receipt files", () => {
  const input = {
    orgName: "Maple Harbour Bank",
    ref: "BAR-0017",
    code: CODE,
    checkUrl: "https://accessloop.example/check?org=maple-harbour",
    reportUrl: `https://accessloop.example/r/${CODE}`,
  };

  it("the text file has the code, both groups, the reading, the reference and where to check", () => {
    const text = receiptTextFile(input);
    expect(text).toContain(`Receipt code: ${CODE}`);
    expect(text).toContain("In two parts: 7K3M-9Q2D  XW4H-B8RT");
    expect(text).toContain("seven, K for Kilo");
    expect(text).toContain("Reference: BAR-0017");
    expect(text).toContain(input.checkUrl);
    expect(text).toContain("\r\n");
    expect(dataUrl("text/plain", text)).toMatch(/^data:text\/plain;charset=utf-8,AccessLoop%20receipt/);
  });

  it("the calendar reminder is a valid all-day event in 2 weeks that links to /check and never holds the code", () => {
    const now = new Date("2026-10-20T15:30:00Z");
    const ics = reminderCalendar({ orgName: input.orgName, ref: input.ref, checkUrl: input.checkUrl, now, uid: "fixed-uid" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:fixed-uid@accessloop");
    expect(ics).toContain("DTSTAMP:20261020T153000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103");
    expect(ics).toContain("DTEND;VALUE=DATE:20261104");
    expect(ics).toContain(`URL:${input.checkUrl}`);
    expect(ics).toContain("SUMMARY:Check on my report to Maple Harbour Bank");
    // Never the code, in any form (grouped, without hyphens, spelled out).
    const unfolded = ics.replace(/\r\n /g, "");
    for (const form of [CODE, copyableCode(CODE), "7K3M", "XW4H", "K for Kilo"]) expect(unfolded).not.toContain(form);
    expect(unfolded).toContain("BAR-0017");
    // Every physical line fits in 75 octets.
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("a relative /check link (no app URL configured) is described but never put in URL", () => {
    const ics = reminderCalendar({ orgName: "X", ref: "BAR-0001", checkUrl: "/check", now: new Date(), uid: "u" });
    expect(ics).not.toContain("URL:");
  });

  it("escapes and folds text as RFC 5545 says", () => {
    expect(icsEscape("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const long = `DESCRIPTION:${"é".repeat(60)}`;
    const folded = icsFold(long);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
