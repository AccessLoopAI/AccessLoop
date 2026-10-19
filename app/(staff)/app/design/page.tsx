import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Copy, Download, LogIn, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { BarChart } from "@/components/ui/charts/BarChart";
import { DeadlineBanner } from "@/components/ui/DeadlineBanner";
import { CheckRing } from "@/components/ui/CheckRing";
import { Checkbox } from "@/components/ui/Checkbox";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterSummary } from "@/components/ui/FilterSummary";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { EvidenceChain, type ChainLinkItem } from "@/components/ui/EvidenceChain";
import { TextField, TextareaField } from "@/components/ui/Field";
import { HashChip } from "@/components/ui/HashChip";
import { Icon } from "@/components/ui/Icon";
import { LoopMark } from "@/components/ui/LoopRing";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SelectField } from "@/components/ui/Select";
import { SourceNote, SourcesProvider } from "@/components/ui/SourceNote";
import { Stat } from "@/components/ui/Stat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { HistoryTimeline, LoopTimeline } from "@/components/ui/Timeline";
import { requireStaff } from "@/lib/auth/staff";
import { CASE_STATUSES } from "@/lib/status";
import { FeedbackBenchmarkView } from "@/components/benchmark/FeedbackBenchmarkCard";
import { IntakeCap } from "../dashboard/IntakeCap";
import { AnnounceDemo, PendingDemo, VerifiedMomentDemo } from "./demos";

// Hidden page (not linked from navigation): every component in every state, for review and axe.
// Fake demo values only; no case data is read here. Any signed-in staff member may open it
// (proxy.ts + requireStaff); an axe spec for it must sign in first.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  ["colour", "Colour"],
  ["type", "Type"],
  ["buttons", "Buttons"],
  ["fields", "Form fields"],
  ["choices", "Choices"],
  ["tables", "Tables"],
  ["badges", "Status badges"],
  ["cards", "Cards and page header"],
  ["disclosure", "Disclosure"],
  ["timeline", "Timeline"],
  ["stats", "Stats"],
  ["charts", "Dashboard charts and controls"],
  ["messages", "Empty state, notices and errors"],
  ["codes", "Receipt code, hash chip and evidence chain"],
  ["live", "Live region"],
] as const;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid gap-6 border-t border-border pt-10">
      <div className="grid gap-2">
        <h2 id={`${id}-title`}>{title}</h2>
        {intro ? <p className="max-w-[72ch] text-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Demo({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-3">{title}</h3>
      {children}
    </div>
  );
}

const SWATCHES: { group: string; tokens: [string, string][] }[] = [
  {
    group: "Surfaces and ink",
    tokens: [
      ["bg", "Page background"],
      ["surface", "Cards"],
      ["surface-raised", "Inputs, raised cards"],
      ["surface-sunken", "Panels, table heads"],
      ["ink", "Text"],
      ["ink-muted", "Hints, meta"],
      ["border", "Hairlines"],
      ["border-strong", "Control edges"],
    ],
  },
  {
    group: "Brand and focus",
    tokens: [
      ["primary", "Buttons, links, done"],
      ["primary-soft", "Selected options"],
      ["accent", "The reporter's dot"],
      ["ring-current", "Step in progress"],
      ["focus", "Focus ring"],
      ["focus-halo", "Focus halo"],
      ["redact-bg", "Redaction highlight"],
      ["chrome-bg", "Staff header"],
    ],
  },
  {
    group: "Feedback",
    tokens: [
      ["info", "Information"],
      ["info-bg", "Information tint"],
      ["success", "Success, closed loop"],
      ["success-bg", "Success tint"],
      ["warning", "Warning"],
      ["warning-bg", "Warning tint"],
      ["danger", "Errors, broken links"],
      ["danger-bg", "Error tint"],
    ],
  },
];

const TYPE = [
  ["text-display font-display font-bold", "Display", "Besley, landing hero"],
  ["text-h1 font-display font-bold", "Heading 1", "Besley 700, one per page"],
  ["text-h2 font-display font-semibold", "Heading 2", "Besley 650, sections"],
  ["text-h3 font-bold", "Heading 3", "Atkinson Hyperlegible Next 700"],
  ["text-lead", "Lead text for introductions", "Atkinson Hyperlegible Next 400"],
  ["text-body", "Body text: 20px on the reporter side, 16px for staff", "Atkinson Hyperlegible Next 400"],
  ["text-small text-ink-muted", "Small text for hints and meta lines", "Atkinson Hyperlegible Next 400"],
  ["font-mono text-body font-bold tracking-[0.12em]", "0O 1Il 5S 8B 2Z", "Atkinson Hyperlegible Mono, codes and hashes"],
] as const;

const HASH = "3fa9c1d27be04e5a9c1f6b8d2e7a4c90b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1";
/** Demo chains (fake hashes): intact with two records after the report, and broken at its fourth record. */
const demoChain = (n: number, f: (i: number) => Partial<ChainLinkItem>): ChainLinkItem[] =>
  Array.from({ length: n }, (_, i) => ({ seq: i + 1, hash: (i * 7 + 11).toString(16).padStart(2, "0").repeat(32), state: "ok", ...f(i) }));
const CHAIN_INTACT = demoChain(8, (i) => ({ head: i === 5, after: i > 5 }));
const CHAIN_BROKEN = demoChain(8, (i) => ({ state: i < 3 ? "ok" : i === 3 ? "broken" : "unchecked", head: i === 7 }));
const HASH_BROKEN = "d04b7e1f9a2c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b";

export default async function DesignPage() {
  await requireStaff();
  return (
    <div className="grid gap-12">
      <PageHeader
        eyebrow="Hidden page, not linked from navigation"
        title="Design system"
        description="Every AccessLoop component in every state, in the staff personality, with a reporter panel to compare. The theme follows your system setting."
      />

      <nav aria-labelledby="design-contents-title" className="rounded-lg border border-border bg-surface p-5">
        <h2 id="design-contents-title" className="font-sans text-h3 font-bold tracking-normal">
          Contents
        </h2>
        <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-11 min-w-11 items-center">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="colour"
        title="Colour"
        intro="Semantic tokens from app/globals.css. Components never use raw colours. Every text pair is at least 4.5:1 and body text at least 7:1, in both themes (scripts/check-contrast.ts)."
      >
        {SWATCHES.map((g) => (
          <Demo key={g.group} title={g.group}>
            <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-4">
              {g.tokens.map(([token, use]) => (
                <li key={token} className="grid gap-2">
                  <span
                    aria-hidden="true"
                    className="block h-16 rounded-md border border-border-strong"
                    style={{ background: `var(--${token})` }}
                  />
                  <span className="grid">
                    <code className="text-small font-bold">--{token}</code>
                    <span className="text-small text-ink-muted">{use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Demo>
        ))}
      </Section>

      <Section
        id="type"
        title="Type"
        intro="Besley (a warm Clarendon) for display headings; Atkinson Hyperlegible Next, designed for low-vision readers, for everything you read."
      >
        <ul className="m-0 grid list-none gap-5 p-0">
          {TYPE.map(([cls, sample, note]) => (
            <li key={sample} className="grid gap-1 border-b border-border pb-5 last:border-b-0">
              <p className={cls}>{sample}</p>
              <p className="text-small text-ink-muted">{note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        intro="Native buttons, at least 44px tall for staff and 52px for reporters. Pending keeps the same name and blocks a second click."
      >
        <Demo title="Variants">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Save triage</Button>
            <Button variant="secondary">Change it</Button>
            <Button variant="quiet">Keep my words only</Button>
            <Button variant="danger" iconStart={<Icon icon={Trash2} />}>
              Close case
            </Button>
          </div>
        </Demo>
        <Demo title="In the header: the chrome variant (Sign out)">
          <div
            className="flex flex-wrap items-center gap-3 rounded-md bg-chrome-bg p-4 text-chrome-ink"
            style={{ "--focus": "var(--chrome-focus)", "--focus-halo": "var(--chrome-focus-halo)" } as CSSProperties}
          >
            <Button variant="chrome" iconStart={<Icon icon={LogIn} />}>
              Switch account
            </Button>
          </div>
        </Demo>
        <Demo title="With icons and the large size">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" iconEnd={<Icon icon={Send} />}>
              Send report
            </Button>
            <Button size="lg" variant="secondary" iconStart={<Icon icon={Copy} />}>
              Copy code
            </Button>
            <ButtonLink href="#buttons" variant="secondary" iconStart={<Icon icon={Plus} />}>
              Log feedback (a link)
            </ButtonLink>
            <ButtonLink href="data:text/plain;charset=utf-8,Example" download="example.txt" variant="quiet" iconStart={<Icon icon={Download} />}>
              Download as a text file
            </ButtonLink>
          </div>
        </Demo>
        <Demo title="Pending and disabled">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button pending>Generate draft</Button>
              <Button variant="secondary" pending>
                Assign
              </Button>
              <Button disabled>Approve redaction</Button>
              <Button variant="secondary" disabled>
                Reopen
              </Button>
              <Button variant="danger" disabled>
                Delete
              </Button>
            </div>
            <PendingDemo />
          </div>
        </Demo>
      </Section>

      <Section id="fields" title="Form fields" intro="Visible labels, hints and errors linked with aria-describedby. No placeholder text as a label.">
        <div className="grid gap-8 lg:grid-cols-2">
          <TextField id="demo-public-summary" name="publicSummary" label="Public summary" hint="One plain sentence. It may appear in the published report." />
          <TextField
            id="demo-email"
            name="email"
            type="email"
            autoComplete="email"
            label="Email address"
            hint="We only use it to reply to you."
            error="Enter an email address like name@example.com"
            defaultValue="name@"
            required
          />
          <TextareaField
            id="demo-fix"
            name="fix"
            label="What did you fix?"
            hint="Say what changed and how you tested it."
            rows={4}
          />
          <div className="grid content-start gap-8">
            <TextField id="demo-start" name="start" type="date" label="Period start" inputWidth="medium" defaultValue="2026-01-01" />
            <SelectField
              id="demo-assign"
              name="assignee"
              label="Assign to"
              placeholderOption="Choose a team"
              options={[
                { value: "facilities", label: "Facilities team" },
                { value: "web", label: "Web team" },
              ]}
              selectWidth="medium"
            />
            <SelectField
              id="demo-area"
              name="area"
              label="Priority area"
              hint="The AI suggestion is pre-selected. Check it."
              defaultValue="built_environment"
              error="Choose the area this barrier belongs to"
              options={[
                { value: "ict", label: "Information and communication technologies" },
                { value: "built_environment", label: "The built environment" },
                { value: "programs_services", label: "The design and delivery of programs and services" },
              ]}
            />
          </div>
        </div>
        <div data-personality="reporter" className="grid gap-6 rounded-xl border border-border p-[var(--card-pad)]">
          <p className="text-small font-bold text-accent-ink">Reporter personality: 20px text, 52px controls</p>
          <TextareaField
            id="demo-reporter-text"
            name="text"
            label="What got in your way? (demo)"
            labelHeading={{ level: 3 }}
            hint="You can type or use your device's dictation."
            rows={4}
          />
        </div>
      </Section>

      <Section id="choices" title="Choices" intro="Radio groups are a fieldset with a legend. Each option is a whole clickable row.">
        <div className="grid gap-10 lg:grid-cols-2">
          <RadioGroup
            id="demo-where"
            name="where"
            legend="Where did it happen? (demo)"
            legendHeading={{ level: 3 }}
            defaultValue="place"
            options={[
              { value: "digital", label: "On a website or app" },
              {
                value: "place",
                label: "At a place",
                conditional: <TextField id="demo-where-detail" name="whereDetail" label="Which place? (optional)" />,
              },
              { value: "phone", label: "On the phone or at a service" },
              { value: "document", label: "In a document", hint: "A form, a letter, a PDF." },
              { value: "other", label: "Somewhere else" },
            ]}
          />
          <div className="grid content-start gap-10">
            <RadioGroup
              id="demo-retest"
              name="retest"
              legend="Can we ask you to check the fix later? (demo)"
              layout="inline"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              error="Choose yes or no"
            />
            <Checkbox
              id="demo-no-ai"
              name="aiOptOut"
              label="Don't use AI on my report (demo)"
              hint="A person reads it and sorts it instead."
            />
            <Checkbox id="demo-checked" name="checked" label="A checked checkbox" defaultChecked />
          </div>
        </div>
      </Section>

      <Section
        id="tables"
        title="Tables"
        intro="Real tables with a caption and header scopes. Wide tables scroll inside their own labelled region, never the page."
      >
        <FilterSummary
          id="demo-filters"
          title="Filters (demo)"
          titleLevel={3}
          summary="4 of 17 cases match all of these:"
          items={["Received Jan 1, 2026 to Dec 31, 2026 (spam not counted)", "Status: New, Triaged, Assigned or Waiting for the reporter to check"]}
          clearHref="#tables"
        />
        <Table id="demo-cases" caption="Cases (demo data)" description="4 cases, newest first">
          <THead>
            <Tr>
              <Th>Reference</Th>
              <Th>Summary</Th>
              <Th>Status</Th>
              <Th>Channel</Th>
              <Th numeric>Days open</Th>
            </Tr>
          </THead>
          <TBody>
            {[
              ["BAR-0019", "Door button at a branch entrance does not open the door.", "new", "Web", 1],
              ["BAR-0018", "Online form times out before it can be finished.", "assigned", "Email", 12],
              ["BAR-0017", "Phone menu has no option to reach a person.", "retest_open", "Phone", 26],
              ["BAR-0016", "Statement PDF cannot be read by a screen reader.", "verified", "Web", 34],
            ].map(([ref, summary, status, channel, days]) => (
              <Tr key={ref as string}>
                <Th scope="row">
                  <a href="#tables">{ref}</a>
                </Th>
                <Td className="min-w-[min(15rem,calc(100vw_-_9.25rem))] max-w-[34rem] sm:min-w-[18rem]">{summary}</Td>
                <Td>
                  <StatusBadge status={status as (typeof CASE_STATUSES)[number]} />
                </Td>
                <Td>{channel}</Td>
                <Td numeric>{days}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section id="badges" title="Status badges" intro="Icon, text and colour together. The verified badge is the closed loop.">
        <Demo title="Staff wording">
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {CASE_STATUSES.map((s) => (
              <li key={s}>
                <StatusBadge status={s} />
              </li>
            ))}
          </ul>
        </Demo>
        <Demo title="Reporter wording">
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {CASE_STATUSES.map((s) => (
              <li key={s}>
                <StatusBadge status={s} wording="reporter" closedReason="duplicate" />
              </li>
            ))}
          </ul>
        </Demo>
        <Demo title="Large">
          <div className="flex flex-wrap gap-3">
            <StatusBadge status="verified" size="lg" />
            <StatusBadge status="retest_open" size="lg" wording="reporter" />
          </div>
        </Demo>
      </Section>

      <Section id="cards" title="Cards and page header">
        <div className="grid gap-5 lg:grid-cols-3">
          <Card as="section" id="demo-card-default" title="Default card" titleLevel={3} description="Surface with a hairline border.">
            <p>Most content sits on these.</p>
          </Card>
          <Card
            as="section"
            id="demo-card-raised"
            title="Raised card"
            titleLevel={3}
            tone="raised"
            actions={
              <Button variant="quiet" size="md">
                Edit
              </Button>
            }
            footer={<p className="text-small text-ink-muted">Footer line</p>}
          >
            <p>One per view, for the thing that matters most.</p>
          </Card>
          <Card as="section" id="demo-card-inset" title="Inset panel" titleLevel={3} tone="inset">
            <p>Quoted or secondary content.</p>
          </Card>
        </div>
        <Card tone="default" padding="lg">
          <PageHeader
            level={2}
            eyebrow="Maple Harbour Bank"
            title="BAR-0017: Phone menu"
            meta={
              <>
                <StatusBadge status="retest_open" />
                <span>Received Sep 23, 2026</span>
                <span>Phone</span>
              </>
            }
            description="A page header with an eyebrow, title, facts and actions. Pages use level 1."
            actions={
              <>
                <Button variant="secondary">Show original</Button>
                <Button>Log fix</Button>
              </>
            }
            className="mb-0"
          />
        </Card>
      </Section>

      <Section id="disclosure" title="Disclosure" intro="A button with aria-expanded that shows and hides the content after it.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Demo title="Closed">
            <Disclosure summary="What is this?">
              <p>The share of fixes that the person who reported the barrier confirmed.</p>
            </Disclosure>
          </Demo>
          <Demo title="Open">
            <Disclosure summary="Why we ask for this" defaultOpen>
              <p>So the team can tell you when the fix is ready to check.</p>
            </Disclosure>
          </Demo>
          <Demo title="Block">
            <Disclosure summary="How redaction works" variant="block">
              <p className="mt-2">Names, emails and phone numbers are replaced with labels like [PERSON] before staff see the text.</p>
            </Disclosure>
          </Demo>
          <Demo title="Footnote in a sentence">
            <div>
              Of these, 7 were fixed and confirmed by the person who reported them.
              <Disclosure summary="Sources for this sentence (2 records)" variant="footnote">
                <ul aria-label="Sources (demo)" className="m-0 grid list-none gap-2 p-0 text-small">
                  <li>
                    <strong>BAR-0004</strong> The ramp at a branch entrance was too steep.
                  </li>
                  <li>
                    <strong>BAR-0007</strong> The bank website had no captions on videos.
                  </li>
                </ul>
              </Disclosure>
            </div>
          </Demo>
          <Demo title="Source note (a report sentence)">
            <SourcesProvider
              records={[
                { ref: "BAR-0004", summary: "The ramp at a branch entrance was too steep.", statusLabel: "Verified by reporter", status: "verified" },
                { ref: "BAR-0007", summary: null, statusLabel: "New", status: "new" },
                { ref: "BAR-0011", summary: null, statusLabel: "Closed", status: "closed" },
              ]}
            >
              <SourceNote text="Of these, 7 were fixed and confirmed by the person who reported them." sources={[0, 1, 2]} />
            </SourcesProvider>
          </Demo>
          <Demo title="Check rings (Report checks)">
            <ul className="al-checklist">
              {(["passed", "missing", "to_write"] as const).map((state) => (
                <li key={state} className="al-check" data-state={state}>
                  <CheckRing state={state} />
                  <span className="al-check-text">
                    <span className="al-check-label">{state === "passed" ? "Passed" : state === "missing" ? "Missing" : "To write"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Demo>
        </div>
        {/* The report page's benchmark card with made-up numbers: on a real report it renders only once a person has
            verified benchmark rows (data/benchmark/feedback-sections.csv), so this is where axe sees it today. */}
        <div className="max-w-xl">
          <FeedbackBenchmarkView
            coverage={{
              total_count: true,
              by_area: true,
              by_channel: true,
              areas_without_feedback: false,
              how_considered: true,
              process_changes: false,
              reporters_confirmed_fixes: true,
            }}
            summary={{
              reports: 3,
              median: 3,
              covered: {
                total_count: 2,
                by_area: 1,
                by_channel: 1,
                areas_without_feedback: 0,
                how_considered: 2,
                process_changes: 1,
                reporters_confirmed_fixes: 0,
              },
            }}
            signedOff={false}
            lastSection={4}
          />
        </div>
        <p className="text-small text-ink-muted">
          Redaction highlight: the caller was <mark className="al-redact">[PERSON]</mark> and left the number{" "}
          <mark className="al-redact">[PHONE]</mark>.
        </p>
      </Section>

      <Section
        id="timeline"
        title="Timeline"
        intro="The loop as an ordered list with a decorative ring. It closes when the reporter confirms. It lays out across when there is room."
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <Card as="section" id="demo-loop-new" title="New case" titleLevel={3}>
            <LoopTimeline current={0} details={["Oct 19, 2026"]} />
          </Card>
          <Card as="section" id="demo-loop-assigned" title="Assigned" titleLevel={3}>
            <LoopTimeline current={2} details={["Oct 2", "Oct 3", "Facilities team"]} />
          </Card>
          <Card as="section" id="demo-loop-waiting" title="Waiting for the reporter" titleLevel={3}>
            <LoopTimeline current={4} details={["Oct 2", "Oct 3", "Oct 3", "Oct 15"]} />
          </Card>
          <Card as="section" id="demo-loop-unchecked" title="Fixed, not checked by the reporter" titleLevel={3}>
            <LoopTimeline current={4} unchecked details={["Oct 2", "Oct 3", "Oct 3", "Oct 15"]} />
          </Card>
          <Card as="section" id="demo-loop-closed" title="Closed loop" titleLevel={3}>
            <LoopTimeline current={4} closed details={["Oct 2", "Oct 3", "Oct 3", "Oct 15", "Oct 16"]} />
          </Card>
          <Card as="section" id="demo-loop-reporter" title="Reporter wording" titleLevel={3}>
            <LoopTimeline current={3} wording="reporter" />
          </Card>
          <Card as="section" id="demo-history" title="Event history" titleLevel={3}>
            <HistoryTimeline
              events={[
                {
                  id: "e1",
                  title: "Report received on the web form",
                  at: "2026-10-02T14:05:00Z",
                  atLabel: "Oct 2, 2026, 10:05",
                  actor: "Reporter (anonymous)",
                  aside: <HashChip hash={HASH} label="Record hash" />,
                },
                {
                  id: "e2",
                  title: "Acknowledged on screen",
                  at: "2026-10-02T14:05:01Z",
                  atLabel: "Oct 2, 2026, 10:05",
                  actor: "System",
                  tone: "info",
                },
                {
                  id: "e3",
                  title: "Original viewed by Alex Rivera",
                  at: "2026-10-03T13:20:00Z",
                  atLabel: "Oct 3, 2026, 09:20",
                  tone: "warning",
                },
                {
                  id: "e4",
                  title: "Fix logged",
                  at: "2026-10-15T18:40:00Z",
                  atLabel: "Oct 15, 2026, 14:40",
                  actor: "Facilities team",
                  body: "Replaced the door operator motor and tested it 10 times with the button.",
                },
                {
                  id: "e5",
                  title: "Verified by reporter",
                  at: "2026-10-16T12:00:00Z",
                  atLabel: "Oct 16, 2026, 08:00",
                  actor: "Reporter, with the receipt code",
                  tone: "success",
                  aside: <HashChip hash={HASH} label="Record hash" tone="success" />,
                },
              ]}
            />
          </Card>
        </div>
        <Card as="section" id="demo-verified-moment" title="The verified moment" titleLevel={3} tone="raised">
          <VerifiedMomentDemo />
        </Card>
      </Section>

      <Section id="stats" title="Stats" intro="Each tile is a heading and text. Rings are decoration; the numbers are always written out.">
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4">
          <li className="grid sm:col-span-2">
            <Stat
              title="Verified-fix rate"
              value="7 / 8"
              detail="7 fixes confirmed by the reporter, 1 fixed but not checked. 0 through staff-given codes."
              ring={{ value: 7, max: 8 }}
              emphasis="headline"
              definition="Fixes the reporter confirmed, out of all fixes where a re-test was offered."
              href="#stats"
              linkLabel="See the 8 cases"
            />
          </li>
          <li className="grid">
            <Stat title="Median days to verified fix" value="14" unit="days" definition="From the day a report arrives to the day its reporter confirms the fix." />
          </li>
          <li className="grid">
            <Stat title="Acknowledgement" value="4 / 4" ring={{ value: 4, max: 4 }} detail="Every named reporter got an acknowledgement." />
          </li>
          <li className="grid">
            <Stat title="Reporter-correction rate" value="No real-AI summaries yet" detail="0 summaries from a real AI model." />
          </li>
          <li className="grid">
            <Stat title="Open barriers" value="4" detail="1 new, 1 triaged, 1 assigned, 1 waiting for the reporter" href="#stats" />
          </li>
        </ul>
      </Section>

      <Section
        id="charts"
        title="Dashboard charts and controls"
        intro="The only chart pattern (domain §10): a decorative SVG, and the same numbers in a real table that is always in the DOM (visually hidden from md up until Show as table is pressed or focus enters it; shown instead of the picture on phones). The table cells hold the links."
      >
        <Demo title="Deadline line">
          <DeadlineBanner
            what="Progress report due June 1, 2027"
            when="225 days"
            detail="The next Accessible Canada Act deliverable for a large private organization (100 or more employees)."
          />
        </Demo>
        <Demo title="Segmented control (native radios, nothing submits on change)">
          <SegmentedControl
            id="demo-period"
            name="demo-period"
            legend="Period (demo)"
            defaultValue="custom"
            options={[
              { value: "year", label: "This year" },
              { value: "90d", label: "Last 90 days" },
              {
                value: "custom",
                label: "Custom dates",
                reveals: (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <TextField id="demo-period-start" name="demo-start" type="date" label="Start date (demo)" defaultValue="2026-01-01" inputWidth="medium" />
                    <TextField id="demo-period-end" name="demo-end" type="date" label="End date (demo)" defaultValue="2026-06-30" inputWidth="medium" />
                  </div>
                ),
              },
            ]}
          />
        </Demo>
        <BarChart
          id="demo-bars"
          title="Bars (demo)"
          tableCaption="Demo bars: barriers per area"
          description="One series; the label above each bar, the count at its tip, a zero as a stub, the grey row is not a category of its own."
          labelHeader="Area"
          countHeader="Barriers"
          rows={[
            { key: "ict", label: "Information and communication technologies", value: { count: 5, href: "#charts", sr: "barriers (demo)" } },
            { key: "built", label: "The built environment", value: { count: 3, href: "#charts", sr: "barriers (demo)" } },
            { key: "transport", label: "Transportation", value: { count: 0, href: null, sr: "barriers (demo)" } },
            { key: "none", label: "Not classified yet", value: { count: 2, href: "#charts", sr: "barriers (demo)" }, tone: "muted" },
          ]}
        />
      </Section>

      <Section id="messages" title="Empty state, notices and errors" intro="Notices stay on the page and are not live regions.">
        <EmptyState
          title="No cases yet"
          action={
            <ButtonLink href="#messages" variant="secondary">
              Log a phone or mail report
            </ButtonLink>
          }
        >
          New reports from the web form and from staff appear here, newest first.
        </EmptyState>
        <div className="grid gap-4 lg:grid-cols-2">
          <Notice tone="info" title="An AI tool helps summarize reports">
            Names and contact details are removed before staff see them.
          </Notice>
          <Notice tone="success" title="Redaction approved">
            Owners can now see the redacted text.
          </Notice>
          <Notice tone="warning" title="Needs a manual check">
            The AI step did not finish, so redaction needs a person this time.
          </Notice>
          <Notice tone="danger">This record does not match its stored hash. It was changed after it was saved.</Notice>
        </div>
        {/* The dashboard's daily-cap line, both states (demo numbers). */}
        <IntakeCap cap={{ used: 37, limit: 200, reached: false, localAllowance: false }} />
        <IntakeCap cap={{ used: 200, limit: 200, reached: true, localAllowance: false }} />
        <ErrorSummary
          focusOnMount={false}
          errors={[
            { href: "#demo-email", message: "Enter an email address like name@example.com" },
            { href: "#demo-retest-0", message: "Choose yes or no" },
          ]}
        />
        <StepIndicator current={2} total={4} />
      </Section>

      <Section id="codes" title="Receipt code, hash chip and evidence chain">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <CodeDisplay code="7K3M-9Q2D-XW4H-B8RT" label="Your receipt code (demo)">
            <Button variant="secondary" iconStart={<Icon icon={Copy} />}>
              Copy the code (demo)
            </Button>
          </CodeDisplay>
          <div className="grid content-start gap-4">
            <p className="flex flex-wrap items-center gap-3">
              <span>Record</span>
              <HashChip hash={HASH} label="Record hash" />
            </p>
            <p className="flex flex-wrap items-center gap-3">
              <span>Verified link</span>
              <HashChip hash={HASH} label="Record hash" tone="success" />
            </p>
            <p className="flex flex-wrap items-center gap-3">
              <span>Broken link</span>
              <HashChip hash={HASH_BROKEN} label="Record hash, does not match" tone="danger" />
            </p>
            <p className="flex items-center gap-3 text-small text-ink-muted">
              <LoopMark size={40} className="text-primary" />
              <span>The brand mark: the loop, waiting for the person who reported it.</span>
            </p>
          </div>
        </div>
        <Demo title="Evidence chain (the /verify drawing)">
          <div className="grid gap-5 rounded-lg border border-border bg-surface p-5">
            <div className="grid gap-2">
              <p className="text-small text-ink-muted">Intact: the ringed record is the last one the report saw; the dashed ones came after it.</p>
              <EvidenceChain links={CHAIN_INTACT} />
            </div>
            <div className="grid gap-2">
              <p className="text-small text-ink-muted">Broken at record 4: red link and chip; the records after it are muted.</p>
              <EvidenceChain links={CHAIN_BROKEN} />
            </div>
            <p className="text-small text-ink-muted">
              Decorative (aria-hidden) everywhere: on /verify the table cell next to it says the same in words.
            </p>
          </div>
        </Demo>
      </Section>

      <Section id="live" title="Live region" intro="The page has exactly one polite status region, in the root layout. Pages announce through useAnnounce().">
        <AnnounceDemo />
      </Section>
    </div>
  );
}
