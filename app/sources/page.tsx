import type { Metadata } from "next";
import Link from "next/link";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { BulletList } from "@/components/ui/BulletList";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { OnThisPage, type OnThisPageItem } from "@/components/ui/OnThisPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadingSection } from "@/components/ui/ReadingSection";
import { AREA_HEADINGS } from "@/lib/report/headings";
import { SCENARIO_ORG, SCENARIO_SOURCES, SCENARIOS, scenarioNote, scenarioSource, scenarioStage } from "@/lib/scenarios";

// Public: the scenario cases of the made-up organization Kestrel Bay Group and the published progress reports they
// come from (docs/archive/phase7-prompt.md T6 item 1; data/scenarios.json through lib/scenarios.ts). Static: it reads no
// database and nothing about any real case. The reports belong to their publishers: we name and link them as
// sources, never as tenants, and every scenario is in our own words. Never "compliant", "certified" or "guarantees".
export const metadata: Metadata = {
  title: "Where our scenario cases come from",
  description:
    "The demo cases of Kestrel Bay Group, a made-up organization, and the published accessibility progress reports each one is based on.",
};

const SECTIONS: OnThisPageItem[] = [
  { href: "#how", label: "How we wrote them" },
  { href: "#scenarios", label: "The scenarios" },
  { href: "#reports", label: "The reports we read" },
  { href: "#test-statements", label: "Draft test statements" },
  { href: "#benchmark", label: "How their Feedback sections compare" },
];

const scenarioCount = SCENARIOS.length;
const usedBy = (sourceId: string) => SCENARIOS.filter((s) => s.source === sourceId).length;

function sourceUse(src: (typeof SCENARIO_SOURCES)[number]): string {
  if (src.status === "unreachable") return "We could not open this report.";
  const n = usedBy(src.id);
  return n === 0 ? "Not used for any scenario." : `Used for ${n === 1 ? "1 scenario" : `${n} scenarios`}.`;
}

export default function SourcesPage() {
  return (
    <ReporterShell>
      <PageHeader
        title="Where our scenario cases come from"
        description={`${SCENARIO_ORG.name} is a made-up organization. Its ${scenarioCount} demo cases are based on barriers that real organizations described in their published accessibility progress reports.`}
        meta={<p>Updated October 20, 2026</p>}
      />

      <div className="grid gap-[var(--stack-lg)]">
        <Notice tone="info" title="These are not real reports">
          <p>
            No person sent these reports. We wrote each one ourselves, in our own words, from a theme in a published
            report. The organizations named below published those reports. None of them uses AccessLoop or took part in
            making it.
          </p>
        </Notice>

        <OnThisPage items={SECTIONS} />

        <ReadingSection id="how" title="How we wrote them">
          <p>{SCENARIO_ORG.about}</p>
          <BulletList>
            <li>Each case starts from one barrier theme in one report, for example a phone line that hangs up too soon.</li>
            <li>We wrote the words again ourselves. We did not copy sentences from any report.</li>
            <li>We did not copy any numbers. The dates and steps of each case are made up for the demo.</li>
            <li>No case describes a real person, and no real organization is a customer in this demo.</li>
            <li>
              Staff see the same note on each case page: &ldquo;Scenario derived from public report&rdquo;, then the
              organization, the year and the link, &ldquo;wording ours; not a real submission&rdquo;.
            </li>
          </BulletList>
          <p>
            You can see the made-up organization&rsquo;s{" "}
            <Link href={`/p/${SCENARIO_ORG.slug}`}>public feedback page</Link>.
          </p>
        </ReadingSection>

        <ReadingSection id="scenarios" title="The scenarios">
          <p>
            Each one shows the area the made-up feedback lead filed it under, where the case stands in the demo, and
            the report it comes from.
          </p>
          <ol className="m-0 grid list-none gap-4 p-0">
            {SCENARIOS.map((s) => {
              const src = scenarioSource(s);
              return (
                <Card key={s.id} as="li" id={`scenario-${s.id}`} title={s.theme} titleLevel={3}>
                  <dl className="m-0 grid gap-3">
                    <div className="grid gap-0.5">
                      <dt className="text-small font-bold text-ink-muted">Case</dt>
                      <dd className="m-0">
                        <span className="font-mono">{s.ref}</span> at {SCENARIO_ORG.name}
                      </dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-small font-bold text-ink-muted">Area</dt>
                      <dd className="m-0">{AREA_HEADINGS[s.area].canonical}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-small font-bold text-ink-muted">In the demo</dt>
                      <dd className="m-0">{scenarioStage(s)}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-small font-bold text-ink-muted">Based on</dt>
                      <dd className="m-0 wrap-anywhere">
                        <a href={src.url} rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
                          {src.org}, {src.title} ({src.year})
                        </a>
                      </dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-small font-bold text-ink-muted">Note on the case</dt>
                      <dd className="m-0 wrap-anywhere text-small">{scenarioNote(src)}</dd>
                    </div>
                  </dl>
                </Card>
              );
            })}
          </ol>
        </ReadingSection>

        <ReadingSection id="reports" title="The reports we read">
          <p>
            We tried to open each of these reports on October 20, 2026. Each one says below what we used it for. The
            reports belong to the organizations that published them. We use their themes in our own words and link to
            each one.
          </p>
          <ul className="m-0 grid list-none gap-4 p-0">
            {SCENARIO_SOURCES.map((src) => (
              <Card key={src.id} as="li" id={`source-${src.id}`} title={`${src.org} (${src.year})`} titleLevel={3}>
                <div className="grid gap-2">
                  <p className="wrap-anywhere">
                    <a href={src.url} rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
                      {src.title}
                    </a>
                  </p>
                  <p>{src.used}</p>
                  <p className="text-small text-ink-muted">{sourceUse(src)}</p>
                </div>
              </Card>
            ))}
          </ul>
        </ReadingSection>

        <ReadingSection id="test-statements" title="Draft test statements">
          <p>
            We also wrote a list of short statements from these reports to test how well the AI suggests an area. Each
            statement keeps the area that the organization itself put the theme under.
          </p>
          <p>
            The list is a draft. People still have to check every statement against its report, so we do not use it
            for any number yet.
          </p>
        </ReadingSection>

        <ReadingSection id="benchmark" title="How their Feedback sections compare">
          <p>
            We also noted what each report&rsquo;s Feedback section covers: how much feedback came in, by area and by
            channel, the areas with none, how it was taken into consideration, changes to the feedback process, and
            whether the people who reported barriers confirmed the fixes. Most of these come from the federal
            guidance on preparing a progress report; the last one is ours.
          </p>
          <p>
            These notes are a draft too. A lead sees how their own report compares only with the reports a person on
            our team has checked against the report itself.
          </p>
        </ReadingSection>
      </div>
    </ReporterShell>
  );
}
