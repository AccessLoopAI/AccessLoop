// Regression floor for layer-1 redaction. Add cases freely; never delete or weaken one.
import { describe, expect, it } from "vitest";
import fixtures from "../eval/fixtures/reports.json";
import { applyRedaction, detectPatterns, spansFromValues } from "@/lib/redaction/patterns";

const LAYER1 = new Set(["EMAIL", "PHONE", "SIN", "POSTAL_CODE", "HEALTH_CARD", "ACCOUNT_NUMBER", "STREET_ADDRESS", "URL"]);
const types = (s: string) => detectPatterns(s).map((x) => `${x.type}=${s.slice(x.start, x.end)}`);

describe("layer-1 patterns on eval fixtures", () => {
  for (const f of fixtures) {
    it(`${f.id}: removes every pattern-type PII item and keeps notPii`, () => {
      const red = applyRedaction(f.text, detectPatterns(f.text));
      for (const p of f.expected.pii.filter((p) => LAYER1.has(p.type))) expect(red).not.toContain(p.text);
      for (const keep of f.expected.notPii) expect(red).toContain(keep);
    });
  }
});

describe("layer-1 unit cases", () => {
  it("phones", () => {
    expect(types("call 416-555-0142 or (613) 555-0199 or +1 905 555 0100")).toEqual([
      "PHONE=416-555-0142", "PHONE=(613) 555-0199", "PHONE=+1 905 555 0100",
    ]);
  });
  it("dictated digits, EN and FR", () => {
    expect(types("at four one six five five five zero one four two thanks")).toHaveLength(1);
    expect(types("au cinq un quatre cinq cinq cinq zéro un deux trois")).toHaveLength(1);
    expect(types("I waited three weeks, one or two times, five days")).toEqual([]);
  });
  it("SIN needs a valid Luhn checksum", () => {
    expect(types("SIN 123 456 789 is not valid; 046-454-286 is")).toEqual(["SIN=046-454-286"]);
  });
  it("street address", () => {
    expect(types("I live at 42 Maple Leaf Crescent, Apt 3 in Ottawa")).toEqual(["STREET_ADDRESS=42 Maple Leaf Crescent, Apt 3"]);
  });
  it("leaves ordinary numbers alone", () => {
    expect(types("year 2026, 3 weeks, a 20 minute timer, order 12345")).toEqual([]);
  });
  it("maps LLM values back onto the original text", () => {
    const text = "Priya said no. Ask Priya again.";
    expect(spansFromValues(text, [{ text: "Priya", type: "STAFF_NAME" }])).toHaveLength(2);
    expect(applyRedaction(text, spansFromValues(text, [{ text: "Priya", type: "STAFF_NAME" }])))
      .toBe("[STAFF_NAME] said no. Ask [STAFF_NAME] again.");
  });
});

// Phase 7 (docs/phase7-prompt.md T1 item 4): keyword-anchored patterns for the misses the review reproduced with
// detectPatterns. Each case below failed before these rules; the false-positive guards keep ordinary words visible.
describe("layer-1 keyword-anchored patterns (phase 7)", () => {
  it("lowercase and dictated street addresses", () => {
    expect(types("I live at 12 king street west, near the bank")).toEqual(["STREET_ADDRESS=12 king street west"]);
    expect(types("my place is 250 old mill rd, unit 4")).toEqual(["STREET_ADDRESS=250 old mill rd, unit 4"]);
    expect(types("send it to 9 st. clair avenue east please")).toEqual(["STREET_ADDRESS=9 st. clair avenue east"]);
    expect(types("i live at one twenty three king street")).toEqual(["STREET_ADDRESS=one twenty three king street"]);
    expect(types("my address is twelve main st")).toEqual(["STREET_ADDRESS=twelve main st"]);
  });
  it("street words without a house number, and counted things, are not addresses", () => {
    expect(types("the door at the king street branch")).toEqual([]);
    expect(types("3 cars on the road and a 5 minute drive")).toEqual([]);
    expect(types("it's a 2 hours drive, a 4 lane highway and a 2 way street")).toEqual([]);
    expect(types("I visited 2 branches on main street")).toEqual([]);
  });
  it("French street words and abbreviations in any case", () => {
    expect(types("au 12 boul. René-Lévesque Ouest")).toEqual(["STREET_ADDRESS=12 boul. René-Lévesque Ouest"]);
    expect(types("1234, CH. DE LA CÔTE-DES-NEIGES, Montréal")).toEqual(["STREET_ADDRESS=1234, CH. DE LA CÔTE-DES-NEIGES"]);
    expect(types("45 BOUL SAINT-LAURENT")).toEqual(["STREET_ADDRESS=45 BOUL SAINT-LAURENT"]);
    expect(types("j'habite au 8 av. du Parc")).toEqual(["STREET_ADDRESS=8 av. du Parc"]);
    expect(types("12 RUE PRINCIPALE")).toEqual(["STREET_ADDRESS=12 RUE PRINCIPALE"]);
  });
  it("OHIP and other health card numbers without version letters, near their keyword", () => {
    expect(types("my OHIP number is 1234 567 890")).toEqual(["HEALTH_CARD=1234 567 890"]);
    expect(types("OHIP 1234567890")).toEqual(["HEALTH_CARD=1234567890"]);
    expect(types("health card 1234-567-890 please")).toEqual(["HEALTH_CARD=1234-567-890"]);
    expect(types("carte santé : 1234 567 890")).toEqual(["HEALTH_CARD=1234 567 890"]);
    expect(types("RAMQ ABCD 1234 5678")).toEqual(["HEALTH_CARD=ABCD 1234 5678"]);
    // The Ontario 4-3-3 grouping is no phone number's, so it is caught on its own too.
    expect(types("the number on my card: 1234-567-890.")).toEqual(["HEALTH_CARD=1234-567-890"]);
  });
  it("bank transit and account numbers near transit / account / compte", () => {
    expect(types("transit 12345, account 1234567")).toEqual(["ACCOUNT_NUMBER=12345", "ACCOUNT_NUMBER=1234567"]);
    expect(types("transit number 12345-003")).toEqual(["ACCOUNT_NUMBER=12345-003"]);
    expect(types("numéro de compte : 123-4567")).toEqual(["ACCOUNT_NUMBER=123-4567"]);
    expect(types("compte chèques 7654321")).toEqual(["ACCOUNT_NUMBER=7654321"]);
    expect(types("acct #00123456")).toEqual(["ACCOUNT_NUMBER=00123456"]);
    expect(types("my account was locked for 30 minutes, then transit stop 1234")).toEqual([]);
  });
  it("SIN / NAS followed by 9 digits even when not Luhn-valid (with a joining word; a bare SIN stays Luhn-checked)", () => {
    expect(types("my SIN is 123 456 789")).toEqual(["SIN=123 456 789"]);
    expect(types("SIN: 123-456-789")).toEqual(["SIN=123-456-789"]);
    expect(types("SIN number 123456789")).toEqual(["SIN=123456789"]);
    expect(types("mon NAS est le 123 456 789")).toEqual(["SIN=123 456 789"]);
    expect(types("NAS : 123456789")).toEqual(["SIN=123456789"]);
    expect(types("social insurance number 987654321")).toEqual(["SIN=987654321"]);
    expect(types("numéro d'assurance sociale 123 456 789")).toEqual(["SIN=123 456 789"]);
  });
  it("dates of birth near born / né(e) / date de naissance / DOB, in common formats", () => {
    expect(types("I was born on 14/05/1990")).toEqual(["DOB=14/05/1990"]);
    expect(types("DOB: 1990-05-14")).toEqual(["DOB=1990-05-14"]);
    expect(types("date of birth is May 3rd, 1985")).toEqual(["DOB=May 3rd, 1985"]);
    expect(types("born 05-14-90 in Halifax")).toEqual(["DOB=05-14-90"]);
    expect(types("née le 3 mars 1985")).toEqual(["DOB=3 mars 1985"]);
    expect(types("date de naissance : 1er mai 1990")).toEqual(["DOB=1er mai 1990"]);
    expect(types("I was born in March 1985")).toEqual(["DOB=March 1985"]);
    // Other dates, and birth words without a date, stay visible.
    expect(types("born with spina bifida; my birthday is next week; it broke on 14/05/2026")).toEqual([]);
  });
  it("PO Box and rural route addresses", () => {
    expect(types("P.O. Box 1234")).toEqual(["STREET_ADDRESS=P.O. Box 1234"]);
    expect(types("PO Box 55, Station A")).toEqual(["STREET_ADDRESS=PO Box 55"]);
    expect(types("RR 2 Ottawa")).toEqual(["STREET_ADDRESS=RR 2"]);
    expect(types("R.R. #3")).toEqual(["STREET_ADDRESS=R.R. #3"]);
    expect(types("C.P. 456, succursale B")).toEqual(["STREET_ADDRESS=C.P. 456"]);
    expect(types("case postale 12")).toEqual(["STREET_ADDRESS=case postale 12"]);
    expect(types("check box 3 on the form")).toEqual([]);
  });
  it("ticket IDs like INC0012345, and reference numbers near their keyword", () => {
    expect(types("ticket INC0012345 was closed")).toEqual(["OTHER_ID=INC0012345"]);
    expect(types("they gave me RITM0045678")).toEqual(["OTHER_ID=RITM0045678"]);
    expect(types("ticket #48213")).toEqual(["OTHER_ID=48213"]);
    expect(types("case number 01234567")).toEqual(["OTHER_ID=01234567"]);
    expect(types("booking reference QX7T2M")).toEqual(["OTHER_ID=QX7T2M"]);
    expect(types("My candidate ID is 448812.")).toEqual(["OTHER_ID=448812"]);
    expect(types("numéro de dossier 2024-55")).toEqual(["OTHER_ID=2024-55"]);
    // Our own case refs, short numbers and words without a digit stay visible.
    expect(types("duplicate of case number BAR-0003; ticket 2026; the reference to the policy")).toEqual([]);
    // A ticket number inside a link's path is the staff's own work item, not the reporter's.
    expect(types("https://servicenow.example.com/browse/INC0012345")).toEqual([]);
  });
  it("the report's own sentences stay clean", () => {
    expect(types("In this reporting period, we received 14 pieces of feedback about accessibility, all through our online form.")).toEqual([]);
    expect(types("Of these, 7 were fixed and confirmed by the person who reported them, 4 were fixed but not yet confirmed.")).toEqual([]);
  });
});

describe("layer-1 patterns stay fast on hostile text (no ReDoS)", () => {
  it("long runs of spaces, joining words and signs take milliseconds, not minutes", () => {
    const hostile = [
      "number ".repeat(800) + " is ".repeat(500) + ": ".repeat(500),
      ("account " + "no ".repeat(30) + "x ").repeat(100),
      ("SIN: " + "is ".repeat(40)).repeat(100),
      ("born " + "on the ".repeat(40)).repeat(60),
      "PO Box" + " ".repeat(5000) + "x account" + " ".repeat(5000),
      ("i live at " + "one ".repeat(50) + "x ").repeat(40),
      "12 ".repeat(3000),
    ];
    for (const text of hostile) {
      const t0 = performance.now();
      detectPatterns(text);
      expect(performance.now() - t0, text.slice(0, 30)).toBeLessThan(1500);
    }
  });
});
