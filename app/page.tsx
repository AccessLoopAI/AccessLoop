import type { Metadata } from "next";
import { ArrowRight, Inbox, Mail, MessageSquareText, Phone, ShieldCheck, Store } from "lucide-react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { LoopClosedIcon } from "@/components/ui/LoopRing";

export const metadata: Metadata = {
  title: { absolute: "AccessLoop" },
};

// docs/domain.md: "Positioning sentence (use it verbatim in UI copy, README and pitch)". Do not edit.
const POSITIONING =
  "AccessLoop is the record system for the Accessible Canada Act feedback obligation. Every barrier someone reports, whether a website, a building, a phone line or a policy, is closed only when the person who reported it confirms the fix, and the Feedback section of the required progress report is drafted from those records, each sentence linked to its evidence.";

const STEPS = [
  {
    name: "Reported",
    text: "Anyone can report a barrier: on the web form, or by phone, mail, email or in person. Nobody has to give a name or an email.",
  },
  {
    name: "Triaged",
    text: "Names and contact details are removed before staff work on it. The feedback lead sorts it by area.",
  },
  {
    name: "Assigned",
    text: "The team that can fix it gets the case, with the redacted text only.",
  },
  {
    name: "Fix logged",
    text: "They write down what they changed, with evidence.",
  },
  {
    name: "Checked by reporter",
    text: "The person who reported it is asked if it works now. Only their answer closes the loop.",
  },
];

const f = (n: number) => Number(n.toFixed(2));
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: f(200 + r * Math.cos(a)), y: f(200 + r * Math.sin(a)) };
};

/** The hero picture: the loop, almost closed, waiting for the person (the amber dot). Decorative. */
function HeroLoop({ className }: { className?: string }) {
  const gapCentre = -48;
  const gap = 46;
  const start = gapCentre + gap / 2;
  const end = gapCentre - gap / 2 + 360;
  const p0 = at(start, 148);
  const p1 = at(end, 148);
  // Five stages evenly round the ring; four are beads on the loop, the fifth is the person in the gap.
  const beads = [1, 2, 3, 4].map((k) => at(gapCentre + k * 72, 148));
  const dot = at(gapCentre, 148);
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false" className={cx("h-auto w-full", className)}>
      <circle cx={200} cy={200} r={190} className="al-hero-disc" />
      <circle cx={200} cy={200} r={112} fill="none" className="al-ring-track" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
      <path
        d={`M ${p0.x} ${p0.y} A 148 148 0 1 1 ${p1.x} ${p1.y}`}
        className="al-logo-ring text-primary"
        strokeWidth={26}
      />
      {beads.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={6} className="fill-on-primary" />
      ))}
      <circle cx={dot.x} cy={dot.y} r={21} className="al-logo-dot" />
    </svg>
  );
}

const FACTS = [
  {
    icon: ShieldCheck,
    title: "No account, no CAPTCHA, no time limit",
    text: "Reporters never sign up. They get a receipt code instead, so they can check their report and confirm the fix while staying anonymous.",
  },
  {
    icon: Inbox,
    title: "Every channel, one loop",
    text: "Feedback that arrives by phone, mail, email or in person is logged by staff and goes through the same steps as the web form.",
    channels: [
      { icon: MessageSquareText, label: "Web form" },
      { icon: Phone, label: "Phone" },
      { icon: Mail, label: "Mail and email" },
      { icon: Store, label: "In person" },
    ],
  },
  {
    icon: LoopClosedIcon,
    title: "A report built from the records",
    text: "The Feedback section is drafted from the cases themselves. Every sentence links to the records behind it, and an evidence check shows nothing was changed afterwards.",
  },
];

export default function Home() {
  return (
    <ReporterShell width="wide">
      {/* 8/4: the two calls to action share one row beside the picture (at 7/5 "Staff sign in" dropped under the
          first one) and the headline takes three lines, not four. */}
      <section aria-labelledby="hero-title" className="grid items-center gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-16">
        <div className="grid gap-6">
          <p className="text-small font-bold text-accent-ink">For organizations under the Accessible Canada Act</p>
          <h1 id="hero-title" className="text-display">
            A barrier is fixed when the person who reported it says so.
          </h1>
          <p className="max-w-[60ch] text-lead text-ink">{POSITIONING}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <ButtonLink href="/o/maple-harbour/report" size="lg" iconEnd={<Icon icon={ArrowRight} />}>
              Report a barrier to Maple Harbour Bank
            </ButtonLink>
            <ButtonLink href="/sign-in" variant="secondary" size="lg">
              Staff sign in
            </ButtonLink>
          </div>
          <p className="text-small text-ink-muted">Maple Harbour Bank is a fictional demo organization.</p>
        </div>
        <HeroLoop className="mx-auto max-w-[17rem] sm:max-w-[22rem] lg:max-w-none" />
      </section>

      <section aria-labelledby="loop-title" className="mt-20 sm:mt-28">
        <h2 id="loop-title">How the loop closes</h2>
        <p className="mt-3 max-w-[60ch] text-ink-muted">
          Five steps, the same for every barrier. Staff can move a case forward, but only the reporter can mark it
          verified.
        </p>
        <ol className="m-0 mt-10 grid list-none gap-0 p-0 lg:grid-cols-5 lg:gap-6">
          {STEPS.map((s, i) => {
            const last = i === STEPS.length - 1;
            return (
              <li
                key={s.name}
                className="relative grid content-start grid-cols-[3rem_minmax(0,1fr)] gap-x-4 pb-8 lg:grid-cols-1 lg:gap-y-4 lg:pb-0"
              >
                {!last ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-14 bottom-2 left-[calc(1.5rem-1px)] w-0.5 bg-border-strong lg:top-[calc(1.5rem-1px)] lg:-right-2 lg:bottom-auto lg:left-16 lg:h-0.5 lg:w-auto"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cx(
                    "relative flex size-12 items-center justify-center rounded-pill border-2 font-display text-h4 font-bold",
                    last ? "border-success bg-success text-on-primary" : "border-primary bg-surface-raised text-primary",
                  )}
                >
                  {last ? <Icon icon={LoopClosedIcon} size="1.4em" strokeWidth={2.25} /> : i + 1}
                </span>
                <div className="grid gap-2">
                  <h3>{s.name}</h3>
                  <p className="text-ink-muted">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="record-title" className="mt-20 grid gap-10 border-t border-border pt-14 sm:mt-28 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
        <div className="grid content-start gap-4">
          <h2 id="record-title">A record people can trust</h2>
          <p className="text-ink-muted">
            AccessLoop helps you meet your obligations. It never fixes anything automatically, and it is not an
            overlay: people fix barriers, and AccessLoop keeps the record.
          </p>
        </div>
        <ul className="m-0 grid list-none gap-8 p-0">
          {FACTS.map((fact) => (
            <li key={fact.title} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4">
              <span className="flex size-11 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Icon icon={fact.icon} size="1.5rem" />
              </span>
              <div className="grid gap-2">
                <h3>{fact.title}</h3>
                <p className="max-w-[60ch] text-ink-muted">{fact.text}</p>
                {fact.channels ? (
                  <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
                    {fact.channels.map((c) => (
                      <li
                        key={c.label}
                        className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1 text-small font-bold text-ink"
                      >
                        <Icon icon={c.icon} size="1.1em" />
                        <span>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </ReporterShell>
  );
}
