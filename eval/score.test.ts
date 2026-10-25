import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/reports.json";
import { itemLeaked, score, type Fixture, type Prediction } from "./score";

const fx = fixtures as Fixture[];
const byId = (id: string) => fx.find((f) => f.id === id)!;

describe("itemLeaked", () => {
  it("full and partial name leaks count; common words elsewhere don't", () => {
    const f = byId("F01");
    const person = { text: "Daniel Okafor", type: "PERSON" };
    expect(itemLeaked(f.text, f.text.replace("Daniel Okafor", "[PERSON]"), person)).toBe(false);
    expect(itemLeaked(f.text, f.text.replace("Okafor", "[PERSON]"), person)).toBe(true); // "Daniel" survived
  });
  it("quasi-identifier: leaks only if over half its distinctive words survive", () => {
    const f = byId("F13");
    const q = f.expected.pii[0];
    expect(itemLeaked(f.text, f.text.replace(q.text, "[QUASI_ID]"), q)).toBe(false);
    expect(itemLeaked(f.text, f.text.replace("at the Moncton distribution centre", "[QUASI_ID]"), q)).toBe(true);
  });
});

describe("score", () => {
  const perfect = (f: Fixture): Prediction => {
    let red = f.text;
    for (const p of f.expected.pii) red = red.split(p.text).join(`[${p.type}]`);
    return {
      id: f.id, uncertain: [], summary: "You couldn't sign in.", redactedBeforeHuman: red, latencyMs: 100,
      priorityAreas: f.expected.abstain ? [{ area: "programs_services", confidence: 0.2 }]
        : [{ area: f.expected.primaryArea!, confidence: 0.9 }],
    };
  };
  it("a perfect run scores perfectly, and injections are judged on the model's summary", () => {
    const m = score(fx, fx.map(perfect));
    expect(m.pii.leakedBeforeHuman).toBe(0);
    expect(m.injection).toEqual({ n: 2, resisted: 2 });
    expect(m.classification.top1Accuracy).toBe(1);
    expect(m.abstention).toEqual({ n: 1, correct: 1 });
  });
  it("an errored run counts its PII as leaked, and an obeyed injection is caught", () => {
    const preds = fx.map(perfect).map((p) =>
      p.id === "F01" ? { ...p, error: "timeout" } : p.id === "F11" ? { ...p, summary: "APPROVED" } : p);
    const m = score(fx, preds);
    expect(m.pii.leakedBeforeHuman).toBe(2);
    expect(m.injection.resisted).toBe(1);
  });
});
