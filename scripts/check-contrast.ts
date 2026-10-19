// Contrast check for the design tokens in app/globals.css.
//
//   npx tsx scripts/check-contrast.ts          -> prints a Markdown table, exits 1 if any pair fails
//   npm test                                    -> tests/contrast.test.ts runs the same check
//
// It reads ONLY the four colour blocks marked "/* @tokens <name> */" in app/globals.css (hex values),
// resolves var() references, and computes WCAG 2.x contrast ratios in four contexts:
// reporter/staff x light/dark (the staff blocks layer on top of the base blocks, as the CSS cascade does).
// No top-level await: works whether or not package.json sets "type": "module".
import { readFileSync } from "node:fs";
import path from "node:path";

export type Tokens = Record<string, string>;
export type ContextName = "Reporter light" | "Staff light" | "Reporter dark" | "Staff dark";

export interface PairSpec {
  fg: string;
  bg: string;
  min: number;
  what: string;
}

export interface PairResult extends PairSpec {
  context: ContextName;
  ratio: number;
  pass: boolean;
}

/** Text pairs: 7:1 for body text (AAA), 4.5:1 for other text. Non-text (boundaries, focus): 3:1. */
export const PAIRS: PairSpec[] = [
  { fg: "ink", bg: "bg", min: 7, what: "Body text on page" },
  { fg: "ink", bg: "surface", min: 7, what: "Body text on card" },
  { fg: "ink", bg: "surface-raised", min: 7, what: "Body text on raised card / input" },
  { fg: "ink", bg: "surface-sunken", min: 7, what: "Body text on sunken panel" },
  { fg: "ink-muted", bg: "bg", min: 7, what: "Muted text (hints) on page" },
  { fg: "ink-muted", bg: "surface", min: 7, what: "Muted text on card" },
  { fg: "ink-muted", bg: "surface-raised", min: 7, what: "Muted text on raised card" },
  { fg: "ink-muted", bg: "surface-sunken", min: 4.5, what: "Muted text on sunken panel" },
  { fg: "link", bg: "bg", min: 7, what: "Link on page" },
  { fg: "link", bg: "surface", min: 7, what: "Link on card" },
  { fg: "link-hover", bg: "bg", min: 7, what: "Hovered link on page" },
  { fg: "link", bg: "primary-soft", min: 4.5, what: "Link on selected row" },
  { fg: "ink", bg: "primary-soft", min: 7, what: "Text on selected option" },
  { fg: "on-primary", bg: "primary", min: 7, what: "Primary button text" },
  { fg: "on-primary", bg: "primary-hover", min: 7, what: "Primary button text (hover)" },
  { fg: "on-danger", bg: "danger", min: 4.5, what: "Danger button text" },
  { fg: "on-danger", bg: "danger-hover", min: 4.5, what: "Danger button text (hover)" },
  { fg: "info", bg: "info-bg", min: 4.5, what: "Info notice title" },
  { fg: "success", bg: "success-bg", min: 4.5, what: "Success notice title" },
  { fg: "warning", bg: "warning-bg", min: 4.5, what: "Warning notice title" },
  { fg: "danger", bg: "danger-bg", min: 4.5, what: "Danger notice title" },
  { fg: "ink", bg: "info-bg", min: 7, what: "Notice body (info)" },
  { fg: "ink", bg: "success-bg", min: 7, what: "Notice body (success)" },
  { fg: "ink", bg: "warning-bg", min: 7, what: "Notice body (warning)" },
  { fg: "ink", bg: "danger-bg", min: 7, what: "Notice body (danger)" },
  { fg: "danger", bg: "bg", min: 4.5, what: "Field error text on page" },
  { fg: "danger", bg: "surface", min: 4.5, what: "Field error text on card" },
  { fg: "success", bg: "surface", min: 4.5, what: "Success text on card" },
  { fg: "accent-ink", bg: "bg", min: 4.5, what: "Accent text on page" },
  { fg: "accent-ink", bg: "accent-soft", min: 4.5, what: "Accent text on accent tint" },
  { fg: "status-new-fg", bg: "status-new-bg", min: 4.5, what: "Badge: New" },
  { fg: "status-triaged-fg", bg: "status-triaged-bg", min: 4.5, what: "Badge: Triaged" },
  { fg: "status-assigned-fg", bg: "status-assigned-bg", min: 4.5, what: "Badge: Assigned" },
  { fg: "status-retest-open-fg", bg: "status-retest-open-bg", min: 4.5, what: "Badge: Waiting for the reporter" },
  { fg: "status-verified-fg", bg: "status-verified-bg", min: 4.5, what: "Badge: Verified by reporter" },
  { fg: "status-fixed-unverified-fg", bg: "status-fixed-unverified-bg", min: 4.5, what: "Badge: Fixed, not verified" },
  { fg: "status-closed-fg", bg: "status-closed-bg", min: 4.5, what: "Badge: Closed" },
  { fg: "redact-ink", bg: "redact-bg", min: 7, what: "Redaction highlight text" },
  { fg: "ink", bg: "selection", min: 7, what: "Selected text" },
  { fg: "chrome-ink", bg: "chrome-bg", min: 7, what: "Header text" },
  { fg: "chrome-muted", bg: "chrome-bg", min: 4.5, what: "Header muted text" },
  { fg: "chrome-ink", bg: "chrome-border", min: 4.5, what: "Header button text (hover)" },
  { fg: "border-strong", bg: "bg", min: 3, what: "Control boundary on page" },
  { fg: "border-strong", bg: "surface", min: 3, what: "Control boundary on card" },
  { fg: "border-strong", bg: "surface-raised", min: 3, what: "Control boundary on raised card" },
  { fg: "primary", bg: "bg", min: 3, what: "Primary button edge / ring on page" },
  { fg: "primary", bg: "surface", min: 3, what: "Primary ring segment on card" },
  { fg: "primary", bg: "primary-soft", min: 3, what: "Selected option border" },
  { fg: "ring-current", bg: "surface", min: 3, what: "Current ring segment on card" },
  { fg: "success", bg: "bg", min: 3, what: "Closed-loop ring on page" },
  { fg: "danger", bg: "surface-raised", min: 3, what: "Invalid input border" },
  { fg: "chart-1", bg: "surface", min: 3, what: "Chart mark on card (received, stages)" },
  { fg: "chart-verified", bg: "surface", min: 3, what: "Chart mark on card (verified by reporter)" },
  { fg: "border-strong", bg: "surface", min: 3, what: "Chart mark on card (not classified)" },
  { fg: "on-primary", bg: "primary", min: 4.5, what: "Chosen segment text (period selector)" },
  { fg: "focus", bg: "bg", min: 3, what: "Focus ring on page" },
  { fg: "focus", bg: "surface", min: 3, what: "Focus ring on card" },
  { fg: "focus", bg: "surface-raised", min: 3, what: "Focus ring on raised card" },
  { fg: "focus", bg: "surface-sunken", min: 3, what: "Focus ring on sunken panel" },
  { fg: "focus", bg: "primary-soft", min: 3, what: "Focus ring on selected option" },
  { fg: "focus", bg: "focus-halo", min: 3, what: "Focus ring against its halo" },
  { fg: "chrome-focus", bg: "chrome-bg", min: 3, what: "Focus ring in header" },
  { fg: "chrome-focus", bg: "chrome-focus-halo", min: 3, what: "Header focus ring against its halo" },
];

const CONTEXTS: { name: ContextName; layers: string[] }[] = [
  { name: "Reporter light", layers: ["base:light"] },
  { name: "Staff light", layers: ["base:light", "staff:light"] },
  { name: "Reporter dark", layers: ["base:light", "base:dark"] },
  { name: "Staff dark", layers: ["base:light", "base:dark", "staff:light", "staff:dark"] },
];

/** Extracts the custom properties of each "/* @tokens name *\/ selector { ... }" block. */
export function parseTokenBlocks(css: string): Record<string, Tokens> {
  const blocks: Record<string, Tokens> = {};
  const re = /\/\*\s*@tokens\s+([\w:-]+)\s*\*\/\s*[^{]+\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const tokens: Tokens = {};
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[d[1]] = d[2].trim();
    blocks[m[1]] = tokens;
  }
  return blocks;
}

function resolve(tokens: Tokens, name: string, seen = new Set<string>()): string {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`token --${name} is not defined`);
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (!ref) return raw;
  if (seen.has(name)) throw new Error(`token --${name} has a circular var() reference`);
  seen.add(name);
  return resolve(tokens, ref[1], seen);
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`not a 3- or 6-digit hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function checkContrast(css: string): { results: PairResult[]; problems: string[] } {
  const blocks = parseTokenBlocks(css);
  const problems: string[] = [];
  for (const name of ["base:light", "base:dark", "staff:light", "staff:dark"]) {
    if (!blocks[name]) problems.push(`missing "@tokens ${name}" block in app/globals.css`);
  }
  if (problems.length) return { results: [], problems };

  // The staff element gets both staff blocks; anything only set in staff:light would leak into dark mode.
  for (const key of Object.keys(blocks["staff:light"])) {
    if (!(key in blocks["staff:dark"])) problems.push(`--${key} is set in staff:light but not in staff:dark`);
  }
  for (const key of Object.keys(blocks["base:light"])) {
    if (!(key in blocks["base:dark"])) problems.push(`--${key} is set in base:light but not in base:dark`);
  }

  const results: PairResult[] = [];
  for (const ctx of CONTEXTS) {
    const tokens: Tokens = Object.assign({}, ...ctx.layers.map((l) => blocks[l]));
    for (const p of PAIRS) {
      const ratio = contrastRatio(resolve(tokens, p.fg), resolve(tokens, p.bg));
      results.push({ ...p, context: ctx.name, ratio, pass: ratio >= p.min });
    }
  }
  for (const r of results) {
    if (!r.pass) problems.push(`${r.context}: --${r.fg} on --${r.bg} is ${r.ratio.toFixed(2)}:1 (needs ${r.min}:1)`);
  }
  return { results, problems };
}

export function markdownTable(results: PairResult[]): string {
  const names = CONTEXTS.map((c) => c.name);
  const lines = [
    `| Pair | Min | ${names.join(" | ")} |`,
    `|---|---|${names.map(() => "---").join("|")}|`,
  ];
  for (const p of PAIRS) {
    const cells = names.map((n) => {
      const r = results.find((x) => x.context === n && x.fg === p.fg && x.bg === p.bg);
      return r ? `${r.ratio.toFixed(2)}${r.pass ? "" : " FAIL"}` : "-";
    });
    lines.push(`| ${p.what} (\`${p.fg}\` on \`${p.bg}\`) | ${p.min} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function readGlobalsCss(root = process.cwd()): string {
  return readFileSync(path.join(root, "app", "globals.css"), "utf8");
}

const invokedDirectly = /check-contrast\.ts$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  const { results, problems } = checkContrast(readGlobalsCss());
  console.log(markdownTable(results));
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks pass.`);
}
