import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { BulletList } from "@/components/ui/BulletList";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { MarkedList } from "@/components/ui/MarkedList";
import { OnThisPage, type OnThisPageItem } from "@/components/ui/OnThisPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadingSection } from "@/components/ui/ReadingSection";
import { describeThisCopy } from "@/lib/public-info/this-copy";

// Public: AccessLoop's own accessibility notes (CLAUDE.md routes: "our own conformance notes plus a link into our
// own feedback form"). Honest by rule: only what the tests in e2e/ and scripts/ really check, what is not tested
// yet, and the known gaps from docs/decisions.md that affect people. Never "compliant", "certified" or
// "guarantees". The feedback link goes to the demo organization's form, clearly labelled (docs/decisions.md):
// there is no AccessLoop organization in the seed. The storage line follows THIS copy's database, so it is dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "What we test, what we have not tested yet, what we know is not right, and how to tell us about a problem with AccessLoop.",
};

/** The demo organization (db/seed.ts), the same form the landing page links to. */
const DEMO_FORM = "/o/maple-harbour/report";

const SECTIONS: OnThisPageItem[] = [
  { href: "#goal", label: "Our goal" },
  { href: "#built-in", label: "What we built in" },
  { href: "#testing", label: "How we test it" },
  { href: "#not-tested", label: "What we have not tested yet" },
  { href: "#known-problems", label: "Problems we know about" },
  { href: "#help", label: "Help with AccessLoop" },
  { href: "#tell-us", label: "Tell us about a problem" },
];

const BUILT_IN = [
  {
    key: "native",
    content: "Standard buttons, links and form fields. Every field has a label you can see. We don't use custom controls that copy them.",
  },
  {
    key: "form",
    content: "The report form has no pop-up windows, no drag and drop, no CAPTCHA and no time limit. No step moves on by itself.",
  },
  {
    key: "focus-moves",
    content:
      "After each step, and each time you send something, keyboard focus moves to the new heading, or to the list of problems if something needs fixing. Screen readers also hear status messages.",
  },
  { key: "focus-ring", content: "A clear focus outline that the page header never covers." },
  { key: "targets", content: "Buttons and links at least 44 by 44 pixels. Links inside sentences are smaller." },
  {
    key: "reflow",
    content:
      "Pages fit a screen 320 pixels wide, and 400% zoom, without scrolling sideways. Wide staff tables scroll inside their own box.",
  },
  { key: "themes", content: "Light and dark colours that follow your device setting." },
  { key: "motion", content: "Nothing moves unless you act, and nothing at all if your device is set to reduce motion." },
  { key: "forced-colours", content: "Colours switch to your own system colours when a Windows contrast theme is on." },
  { key: "charts", content: "Any chart comes with a table of the same numbers." },
  { key: "help", content: "“Get help” is in the same place on every page." },
  {
    key: "font",
    content: "The font is Atkinson Hyperlegible Next. It was designed to be easy to read for people with low vision.",
  },
  {
    key: "no-retyping",
    content:
      "Your answers on the report form are saved on your device as you go, and the form never asks for the same thing twice. You can paste your receipt code.",
  },
];

const NOT_TESTED = [
  {
    key: "screen-readers",
    content: (
      <>
        <strong>Screen readers with real users.</strong> Testing with paid testers who use screen readers and other
        assistive technology has not happened yet. It is planned, and we will update this page with what they find.
      </>
    ),
  },
  {
    key: "browsers",
    content: (
      <>
        <strong>Firefox, and Safari itself.</strong> Firefox is not checked yet. The tests of the reporter&rsquo;s pages
        also run in WebKit, the engine behind Safari, but not in Safari on a real Mac, iPhone or iPad.
      </>
    ),
  },
  {
    key: "high-contrast",
    content: (
      <>
        <strong>Windows contrast themes.</strong> We designed for them, but have not tried a real Windows contrast
        theme yet. Our tests only simulate forced colours in the browser, on some pages.
      </>
    ),
  },
  {
    key: "devices",
    content: (
      <>
        <strong>Real phones and tablets.</strong> We check phone-sized screens, not real devices. So there are no
        tests yet with VoiceOver on iPhone, TalkBack on Android, or phone zoom.
      </>
    ),
  },
  {
    key: "other-at",
    content: (
      <>
        <strong>Voice control, switch access and screen magnifiers.</strong> Not tested yet.
      </>
    ),
  },
];

const KNOWN_PROBLEMS = [
  {
    key: "session",
    content: (
      <>
        <strong>Staff are signed out after 12 hours, with no warning.</strong> In this prototype, staff sign-in ends 12
        hours after you sign in, and you can&rsquo;t make it longer. If this happens while a form is open, the page
        tells you and keeps what you typed. Sign in again in a new tab, then press the button again.
      </>
    ),
  },
  {
    key: "code",
    content: (
      <>
        <strong>Your receipt code can&rsquo;t be shown again later.</strong> The receipt page shows the code once. If
        you reload the page or come back to it, the code is gone, and nobody can show it to you, not even staff. Copy
        it, download it, print it or write it down before you leave the page.
      </>
    ),
  },
  {
    key: "slow-ai",
    content: (
      <>
        <strong>The summary can take up to a minute.</strong> With real AI, &ldquo;Summarizing your report&hellip;&rdquo;
        can take a while. Nothing times out. On the next screen you can tick &ldquo;Don&rsquo;t use AI on my
        report&rdquo;, and nothing the AI made is kept with your report.
      </>
    ),
  },
  {
    key: "tables",
    content: (
      <>
        <strong>On small screens, some staff tables scroll sideways inside their own box.</strong> The rest of the page
        does not.
      </>
    ),
  },
  {
    key: "english",
    content: (
      <>
        <strong>AccessLoop is in English only.</strong> There is no French version yet.
      </>
    ),
  },
];

export default function AccessibilityPage() {
  const { storage } = describeThisCopy();

  return (
    <ReporterShell>
      <PageHeader
        title="Accessibility of AccessLoop"
        description="AccessLoop is for reporting barriers, so it has to work for the people who face them. Here is what we test, what we have not tested yet, and what we know is not right."
        meta={<p>These are our own notes, not an outside audit. Updated October 21, 2026.</p>}
      />

      <div className="grid gap-[var(--stack-lg)]">
        <OnThisPage items={SECTIONS} />

        <ReadingSection id="goal" title="Our goal">
          <p>
            We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA on every page. No outside
            expert has checked AccessLoop yet, so we don&rsquo;t claim that it meets them.
          </p>
          <p>On the pages for people who report barriers, we aim higher in some places:</p>
          <BulletList>
            <li>body text is at least 18 pixels</li>
            <li>body text and links have a contrast of at least 7 to 1</li>
            <li>each screen of the report form asks about one thing</li>
            <li>nothing moves unless you choose it</li>
          </BulletList>
          <p>
            <strong>For organizations:</strong> AccessLoop helps you meet your obligations under the Accessible Canada
            Act. It does not meet them for you. People still fix the barriers, and AccessLoop keeps the record.
          </p>
        </ReadingSection>

        <ReadingSection id="built-in" title="What we built in">
          <MarkedList mark="done" items={BUILT_IN} />
        </ReadingSection>

        <ReadingSection id="testing" title="How we test it">
          <h3>Automated tests</h3>
          <p>We run these before any part of AccessLoop counts as done.</p>
          <MarkedList
            mark="done"
            items={[
              {
                key: "axe",
                content: (
                  <>
                    <strong>axe</strong>, an automated checker, runs on every page and state our tests open, and on
                    the key screens in both light and dark. It checks WCAG 2.0, 2.1 and 2.2, Levels A and AA. Any
                    problem fails the tests. This page is checked too.
                  </>
                ),
              },
              {
                key: "structure",
                content: (
                  <>
                    <strong>Page structure.</strong> Each page has exactly one main heading, one place for status
                    messages, and one &ldquo;Get help&rdquo; link.
                  </>
                ),
              },
              {
                key: "focus",
                content: (
                  <>
                    <strong>Focus.</strong> Tests check that focus lands on the new heading after each step of the
                    report form, after you send it, and after staff sign in.
                  </>
                ),
              },
              {
                key: "keyboard",
                content: (
                  <>
                    <strong>Keyboard.</strong> Tests fill in and send the whole report form, and answer a re-test,
                    with the keyboard alone. They also take a progress report from a new draft to published with
                    the keyboard, and open its sources and its evidence check. At every stop the focus outline must
                    show, and the page header must not cover it.
                  </>
                ),
              },
              {
                key: "reflow",
                content: (
                  <>
                    <strong>Reflow.</strong> Tests check that nothing scrolls sideways at 320 pixels on the key
                    screens, in light and dark, and on the pages with the longest text, like the last step of the
                    report form and the staff case page with long email addresses and file names. Every phone-width
                    screenshot is checked too.
                  </>
                ),
              },
              {
                key: "text-spacing",
                content: (
                  <>
                    <strong>Your own text spacing.</strong> Tests set more space between lines, paragraphs, words and
                    letters on the key screens (the amounts in WCAG 1.4.12, as a reading tool or your own style sheet
                    would). No text may be cut off or run into other text, and nothing may scroll sideways.
                  </>
                ),
              },
              {
                key: "forced-colours",
                content: (
                  <>
                    <strong>Forced colours.</strong> Tests turn on a simulated Windows contrast theme on the key
                    screens. Buttons, status labels and the focus outline must still show.
                  </>
                ),
              },
              {
                key: "screenshots",
                content: (
                  <>
                    <strong>Screenshots.</strong> We save the key screens at desktop width (1440 pixels) and phone width
                    (390 pixels), in light and dark, with motion turned off, for people on our team to look at.
                  </>
                ),
              },
              {
                key: "contrast",
                content: (
                  <>
                    <strong>Colour contrast.</strong> A script checks the colour pairs in our design for text, controls
                    and the focus outline, on reporter and staff pages, in light and dark. The tests fail if any pair is
                    below its target.
                  </>
                ),
              },
            ]}
          />
          <p>
            These tests run in Chromium, the engine behind Chrome and Edge. The tests of the reporter&rsquo;s pages
            and the text spacing test also run in WebKit, the engine behind Safari. Automated tools find only some
            accessibility problems. That&rsquo;s why testing with people matters.
          </p>
          <h3>Testing with people</h3>
          <p>
            We plan to pay testers with disabilities to try AccessLoop with their own assistive technology, such as the
            NVDA screen reader and VoiceOver. That has not happened yet. When it does, we will write down every
            problem they find, fix it, and say here what changed.
          </p>
        </ReadingSection>

        <ReadingSection id="not-tested" title="What we have not tested yet">
          <MarkedList mark="not-yet" items={NOT_TESTED} />
        </ReadingSection>

        <ReadingSection id="known-problems" title="Problems we know about">
          <MarkedList mark="known-issue" items={KNOWN_PROBLEMS} />
        </ReadingSection>

        <ReadingSection id="help" title="Help with AccessLoop">
          <BulletList>
            <li>
              To learn how to report a barrier, stay anonymous or check your report, read{" "}
              <Link href="/help">How to report a barrier and check your report</Link>.
            </li>
            <li>
              To see where your report is, or to tell the team if a fix works for you, go to{" "}
              <Link href="/check">Check a report with your code</Link>.
            </li>
            <li>
              To learn what the AI reads, who can see your report and how long it is kept, read{" "}
              <Link href="/trust">Privacy and AI</Link>.
            </li>
          </BulletList>
          <p>
            <strong>Reach the organization another way.</strong> Organizations under the Accessible Canada Act must
            also take feedback by mail, phone and email. Ask for the person who receives accessibility feedback. You
            can also ask for information in another format, like large print, braille or audio.
          </p>
        </ReadingSection>

        <Card as="section" id="tell-us" tone="raised" padding="lg" className="grid gap-4">
          <h2>Tell us about a problem with AccessLoop</h2>
          <p>If part of AccessLoop doesn&rsquo;t work for you, we want to know. You can stay anonymous.</p>
          <p>
            This prototype does not have a feedback form of its own yet. You can use the form of Maple Harbour Bank
            instead. It is the made-up organization in this demo, and our team reads what comes in there. Start your
            report with &ldquo;About AccessLoop:&rdquo; so we know it is about this site, not about the bank.
          </p>
          <p>
            <ButtonLink href={DEMO_FORM} iconStart={<Icon icon={MessageSquareText} />}>
              Report a problem on the demo form
            </ButtonLink>
          </p>
          <BulletList>
            <li>
              Your report goes through the same steps as anyone else&rsquo;s. You get a receipt code, and later you can
              tell us if our fix works for you.
            </li>
            {storage === "this_computer" ? (
              <li>
                On this copy, what you send is saved on the computer that runs AccessLoop. If you are running
                AccessLoop on your own computer, it stays there, and our team won&rsquo;t see it.
              </li>
            ) : null}
            <li>If someone is showing you AccessLoop, you can also tell that person.</li>
          </BulletList>
        </Card>
      </div>
    </ReporterShell>
  );
}
