import { describe, expect, it } from "vitest";
import { checkContrast, contrastRatio, parseTokenBlocks, readGlobalsCss } from "../scripts/check-contrast";

describe("design tokens (app/globals.css)", () => {
  const css = readGlobalsCss();

  it("computes WCAG contrast correctly", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("has all four colour blocks", () => {
    expect(Object.keys(parseTokenBlocks(css)).sort()).toEqual(["base:dark", "base:light", "staff:dark", "staff:light"]);
  });

  it("meets every contrast minimum in both personalities and both themes", () => {
    const { results, problems } = checkContrast(css);
    expect(problems).toEqual([]);
    expect(results.length).toBeGreaterThan(200);
  });
});
