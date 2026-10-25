// The plain-text export of a progress report (docs/domain.md §7 step 9: "A plain-text export is available").
// Same sections, sentences and sources as the page: every generated sentence ends with a [n] marker, SOURCES lists
// the records behind each marker, RECORDS gives each record's lead-approved public summary, and the end names the
// evidence check, the report's fingerprint and (once signed off) the signed fingerprint. Never reporter text, names or
// contact details of reporters. Pure.
import { formatDateLong } from "@/lib/format";
import type { ReportContent, ReportSnapshot } from "./types";
import { leadParagraphs, receivedPhrase, reportView, type SentenceView } from "./view";

export interface PlainTextInput {
  title: string;
  orgName: string;
  content: ReportContent;
  snapshot: ReportSnapshot;
  areaText: Readonly<Record<string, string>>;
  consultationsText: string | null;
  manifestHash: string;
  signedOffAt: Date | null;
  publishedAt: Date | null;
  /** The evidence check's address (absolute when the app's base URL is configured). */
  verifyUrl: string;
}

const RULE = "=".repeat(72);

/**
 * Wrap a paragraph at 80 characters (words are never split; a longer word gets its own line). `hang` indents the
 * lines after the first (list items, sources, records).
 */
function wrap(text: string, hang = "", width = 80): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const room = width - (lines.length ? hang.length : 0);
    if (line && (line + " " + word).length > room) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? hang + l : l)).join("\n");
}

export function reportPlainText(r: PlainTextInput): string {
  const view = reportView(r.content, r.snapshot);
  const out: string[] = [];
  const sources: { n: number; refs: string[] }[] = [];
  const cite = (s: SentenceView): string => {
    const n = sources.length + 1;
    sources.push({ n, refs: s.sources.map((i) => view.cases[i].ref) });
    return `${s.text} [${n}]`;
  };

  out.push(r.title.toUpperCase(), r.orgName, `Feedback received ${receivedPhrase(r.snapshot.period)}.`);
  if (r.signedOffAt) {
    out.push(`Signed off on ${formatDateLong(r.signedOffAt)}.${r.publishedAt ? ` Published on ${formatDateLong(r.publishedAt)}.` : ""}`);
  } else out.push("DRAFT: not signed off yet. Do not publish this version.");
  out.push(`Feedback is received by the ${r.content.settings.feedbackDesignateTitle.replace(/^the\s+/i, "")}.`, RULE);

  for (const sec of view.sections) {
    out.push("", sec.heading.toUpperCase(), "");
    for (const b of sec.blocks) {
      if (b.kind === "org") out.push(wrap(b.text), "");
      else if (b.kind === "lead") {
        const key = sec.key;
        const text = key === "consultations" ? r.consultationsText : key.startsWith("area:") ? r.areaText[key.slice(5)] : "";
        const paras = leadParagraphs(text);
        if (paras.length) for (const p of paras) out.push(wrap(p), "");
        else out.push("(Not written yet.)", "");
      } else if (b.kind === "subheading") out.push(b.text, "");
      else if (b.kind === "claim") out.push(wrap(cite(b.sentence)), "");
      else for (const s of b.sentences) out.push(wrap(`- ${cite(s)}`, "  "), "");
    }
  }

  out.push(RULE, "", "SOURCES", "");
  for (const s of sources) out.push(wrap(`[${s.n}] ${s.refs.length ? s.refs.join(", ") : "No records"}`, "    "));

  const cited = new Set(sources.flatMap((s) => s.refs));
  out.push("", "RECORDS", "", "Each record with its status when this report was built.", "");
  for (const c of view.cases) {
    if (!cited.has(c.ref)) continue;
    const none = c.status === "closed" ? "Closed before review (no public summary)." : "Waiting for review (no public summary yet).";
    out.push(wrap(`${c.ref} (${c.statusLabel}): ${c.summary ?? none}`, "  "));
  }

  out.push("", RULE, "", `Evidence check: ${r.verifyUrl}`, `Fingerprint of this report (SHA-256): ${r.manifestHash}`);
  // The root signed at sign-off (docs/domain.md §8), the fingerprint the organization gives its regulator.
  const signing = r.content.signing;
  if (signing && /^[0-9a-f]{64}$/.test(signing.root)) out.push(`Signed fingerprint (Ed25519, key ${signing.keyId}): ${signing.root}`);
  out.push("");
  return out.join("\n");
}

/** "accessibility-progress-report-2026-version-1.txt", from the title. */
export function plainTextFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "progress-report"}.txt`;
}
