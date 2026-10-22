// The silver-label eval set (docs/phase7-prompt.md T6 item 2; eval/README.md): one-line barrier statements written in
// our own words from published accessibility progress reports, each labelled with the priority area under which the
// SOURCE ORGANIZATION placed the theme. "Silver": the labels are the organizations' own, not two annotators'.
//
// The agent-written file is eval/fixtures/public-silver.draft.json with "status": "DRAFT". A human checks every row,
// sets "status": "reviewed" and "reviewedBy", and renames it to public-silver.json. Only that file is a result:
// `npm run eval -- --set silver` refuses the draft, and `--draft-check` runs it through the harness without saving.
// Pure parsing and conversion here (no fs), so tests/silver.test.ts checks the real file and the refusals.
import { z } from "zod";
import { LOCATION_KINDS } from "@/lib/intake/types";
import { PRIORITY_AREAS } from "@/lib/report/headings";
import type { Fixture } from "@/eval/score";

export const SILVER_FORMAT = "accessloop-silver/v1";
/** Project-relative paths (the runner joins them to the project root). */
export const SILVER_FILE = "eval/fixtures/public-silver.json";
export const SILVER_DRAFT_FILE = "eval/fixtures/public-silver.draft.json";
export const SILVER_MIN = 60;
export const SILVER_MAX = 100;

export const LABEL_BASES = ["feedback-theme-by-area", "area-section", "org-category-mapped"] as const;

const StatementSchema = z.object({
  id: z.string().regex(/^PS\d{3}$/),
  source: z.string().min(1),
  area: z.enum(PRIORITY_AREAS),
  labelBasis: z.enum(LABEL_BASES),
  /** Where in the source report the theme is (for the human check). */
  section: z.string().min(3).max(160),
  locationKind: z.enum(LOCATION_KINDS),
  /** ONE line, our words. */
  text: z.string().min(15).max(200).refine((t) => !/[\r\n]/.test(t), "one line only"),
});

const SourceSchema = z.object({
  id: z.string().min(1),
  org: z.string().min(2),
  year: z.string().regex(/^20\d{2}(-20\d{2})?$/),
  url: z.url({ protocol: /^https$/ }),
});

export const SilverFileSchema = z
  .object({
    format: z.literal(SILVER_FORMAT),
    status: z.enum(["DRAFT", "reviewed"]),
    notice: z.string().min(20),
    reviewedBy: z.array(z.string().min(1)),
    labelBasis: z.record(z.enum(LABEL_BASES), z.string()),
    sources: z.array(SourceSchema).min(1),
    statements: z.array(StatementSchema).min(SILVER_MIN).max(SILVER_MAX),
  })
  .superRefine((f, ctx) => {
    const sources = new Set(f.sources.map((s) => s.id));
    const ids = new Set<string>();
    const texts = new Set<string>();
    f.statements.forEach((s, i) => {
      if (!sources.has(s.source)) ctx.addIssue({ code: "custom", path: ["statements", i, "source"], message: "unknown source" });
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: ["statements", i, "id"], message: "duplicate id" });
      const key = s.text.toLowerCase();
      if (texts.has(key)) ctx.addIssue({ code: "custom", path: ["statements", i, "text"], message: "duplicate statement" });
      ids.add(s.id);
      texts.add(key);
    });
    if (f.status === "reviewed" && f.reviewedBy.length === 0) {
      ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "a reviewed set names who reviewed it" });
    }
  });
export type SilverFile = z.infer<typeof SilverFileSchema>;

/** The eval fixtures of a silver file: classification only (no PII is seeded in these statements). */
export function silverFixtures(file: SilverFile): Fixture[] {
  return file.statements.map((s) => ({
    id: s.id,
    lang: "en",
    inputMode: "paraphrase",
    locationKind: s.locationKind,
    tags: ["silver", s.source, s.labelBasis],
    text: s.text,
    expected: { primaryArea: s.area, acceptableAreas: [s.area], pii: [], notPii: [] },
  }));
}
