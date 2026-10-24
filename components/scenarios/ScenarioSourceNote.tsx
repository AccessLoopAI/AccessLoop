import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { SCENARIO_NOTE_END, SCENARIO_NOTE_START, scenarioForCase } from "@/lib/scenarios";

/**
 * On the staff case page: the note a scenario case carries (docs/phase7-prompt.md T6 item 1), "Scenario derived from
 * public report: {org}, {year}, {url}; wording ours; not a real submission", with the URL as a link. Nothing for any
 * other case. Server component: the lookup is data/scenarios.json by the signed-in org's slug and the case's ref.
 */
export function ScenarioSourceNote({ orgSlug, caseRef }: { orgSlug: string; caseRef: string }) {
  const hit = scenarioForCase(orgSlug, caseRef);
  if (!hit) return null;
  const { source } = hit;
  return (
    <Notice tone="info" title="A scenario case, not a real report" className="mb-6">
      <p className="wrap-anywhere" data-testid="scenario-note">
        {SCENARIO_NOTE_START} {source.org}, {source.year},{" "}
        <a href={source.url} rel="noopener noreferrer">
          {source.url}
        </a>
        ; {SCENARIO_NOTE_END}.
      </p>
      <p className="mt-2">
        <Link href="/sources" className="inline-flex min-h-11 items-center">
          Every scenario and the report it comes from
        </Link>
      </p>
    </Notice>
  );
}
