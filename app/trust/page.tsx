import type { Metadata } from "next";
import Link from "next/link";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { BulletList } from "@/components/ui/BulletList";
import { Notice } from "@/components/ui/Notice";
import { OnThisPage, type OnThisPageItem } from "@/components/ui/OnThisPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Quote } from "@/components/ui/Quote";
import { ReadingSection } from "@/components/ui/ReadingSection";
import { StepList, StepListItem } from "@/components/ui/StepList";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import { TextSpecimen } from "@/components/ui/TextSpecimen";
import { TRUST_EXAMPLE } from "@/lib/public-info/example";
import { ACR_S19, ACR_SOURCE } from "@/lib/public-info/legal";
import { describeThisCopy, type ThisCopy } from "@/lib/public-info/this-copy";
import { SIGNING_KEYS_PATH, VERIFIER_PATH } from "@/lib/report/labels";

// Public: how AccessLoop handles a report (docs/domain.md §9 "The /trust page states plainly what goes to the LLM
// (masked text only), which provider, where data is stored, the retention period ... and that reporters have no
// accounts"). Every sentence was checked against the code on 2026-10-19 (docs/decisions.md). Plain language, grade
// 6-8. Never "compliant", "certified" or "guarantees"; never "priority area". The box at the top describes THIS
// running copy (AI, email, database) from the server's env at request time, in words only, so the page is dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy and AI",
  description:
    "What happens to your words after you write them: what the AI reads, who can see your report, where it is kept and for how long.",
};

const SECTIONS: OnThisPageItem[] = [
  { href: "#short-version", label: "The short version" },
  { href: "#path", label: "The path your words take" },
  { href: "#ai", label: "What the AI never gets or does" },
  { href: "#provider", label: "Which AI we use" },
  { href: "#storage", label: "Where your report is stored" },
  { href: "#services", label: "Services we plan to use" },
  { href: "#encryption", label: "What is locked with encryption" },
  { href: "#who", label: "Who can see what" },
  { href: "#receipt-code", label: "Your receipt code" },
  { href: "#retention", label: "How long reports are kept" },
  { href: "#record", label: "A record nobody can quietly change" },
  { href: "#not-finished", label: "What is not finished yet" },
  { href: "#questions", label: "Questions" },
];

const AI_LINE: Record<ThisCopy["ai"], string> = {
  simulated: "The AI is simulated. Ready-made test answers stand in for it, so nothing is sent to an AI company.",
  api: "This copy uses real AI: Claude models made by Anthropic. They get your words only as the steps below describe.",
  "claude-cli":
    "This copy uses our team's development tool for AI. It runs on this computer with a team member's own Claude account, and it is only for the team's own testing.",
  misconfigured: "The AI setting on this copy is not working, so no AI is used. Staff check each report for names by hand.",
};

const EMAIL_LINE: Record<ThisCopy["email"], string> = {
  simulated: "Emails are not sent. If you add your email, this copy will not email you. Staff can see what would have been sent.",
  resend: "Emails are sent. If you add your email, you get an email that says your report arrived.",
  not_set_up: "Email is not set up on this copy, so it can't email you.",
};

const STORAGE_LINE: Record<ThisCopy["storage"], string | null> = {
  this_computer: "Reports are saved in a database on the computer that runs this copy.",
  hosted: "Reports are saved in a database run by a hosting service, not on this computer.",
  unknown: null,
};

// "Services we plan to use when it goes live" (docs/archive/phase7-prompt.md Wave 4 item 1; docs/decisions.md 2026-10-20):
// the planned sub-processors, what OUR code would send each one, and where each company's own public page says it
// stores or processes data, read on 2026-10-20. Anything those pages did not say is written as "we could not confirm
// this yet". No retention numbers until the hosting step states them. Re-check every line before going live.
/** Sentence cells: wide enough to read beside the row header, and the table scrolls inside its region at 320 px. */
const SENTENCE_CELL = "min-w-[min(15rem,calc(100vw_-_9.25rem))] sm:min-w-[14rem]";

const SERVICE_PAGES = [
  { href: "https://vercel.com/docs/regions", label: "Vercel: global network and regions" },
  { href: "https://supabase.com/docs/guides/platform/regions", label: "Supabase: available regions" },
  { href: "https://platform.claude.com/docs/en/manage-claude/data-residency", label: "Anthropic: data residency" },
  { href: "https://resend.com/docs/dashboard/domains/regions", label: "Resend: choosing a region" },
  { href: "https://clerk.com/security", label: "Clerk: security" },
] as const;

export default function TrustPage() {
  const copy = describeThisCopy();
  const storage = STORAGE_LINE[copy.storage];

  return (
    <ReporterShell>
      <PageHeader
        title="How AccessLoop handles your report"
        description="What happens to your words after you write them: what the AI reads, who can see your report, where it is kept and for how long."
        meta={<p>Updated October 21, 2026</p>}
      />

      <div className="grid gap-[var(--stack-lg)]">
        <Notice tone="info" title="About this copy of AccessLoop">
          <p>This is a prototype. Here is how this copy is set up right now:</p>
          <BulletList>
            <li>{AI_LINE[copy.ai]}</li>
            <li>{EMAIL_LINE[copy.email]}</li>
            {storage ? <li>{storage}</li> : null}
            <li>
              Maple Harbour Bank, Lakeview Telecom and Kestrel Bay Group are{" "}
              <span className="whitespace-nowrap">made-up</span> organizations. Kestrel Bay Group&rsquo;s cases are{" "}
              <Link href="/sources">based on published reports</Link>, in our own words.
            </li>
          </BulletList>
        </Notice>

        <OnThisPage items={SECTIONS} />

        <ReadingSection id="short-version" title="The short version">
          <BulletList>
            <li>You don&rsquo;t need an account. You get a receipt code instead.</li>
            <li>You stay anonymous unless you choose to add your email.</li>
            <li>
              Contact details are taken out of your words before any AI reads them. Names are taken out before the
              team that fixes the barrier reads them.
            </li>
            <li>You can choose &ldquo;Don&rsquo;t use AI on my report&rdquo;. Then no AI reads it at all.</li>
            <li>AI never decides anything about your report. People do. Only you can confirm that a fix works.</li>
            <li>
              Your original words and your email are locked with encryption. Only the organization&rsquo;s feedback
              lead can open them, and each time they do, it is recorded.
            </li>
            <li>The organization must keep feedback for seven years. AccessLoop can&rsquo;t delete it sooner.</li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="path" title="The path your words take">
          <p>Here is what happens to a made-up report, step by step.</p>
          <StepList className="mt-2">
            <StepListItem n={1} title="You write your report">
              <p>
                You type it, or use your device&rsquo;s dictation. While you write, your answers are saved in this
                browser so you don&rsquo;t lose them. Your email address is not saved there.
              </p>
              <TextSpecimen caption="What you wrote" text={TRUST_EXAMPLE.written} />
            </StepListItem>
            <StepListItem n={2} title="Fixed rules hide contact details">
              <p>
                Our server runs fixed rules first. They are not AI. They swap contact details and ID numbers for a
                label. They look for:
              </p>
              <BulletList>
                <li>email addresses</li>
                <li>phone numbers, also when you say the digits out loud with dictation</li>
                <li>postal codes and street addresses</li>
                <li>Social Insurance Numbers, health card numbers, and card or account numbers</li>
                <li>
                  dates of birth, and ticket or reference numbers, when a word like &ldquo;born&rdquo; or
                  &ldquo;ticket&rdquo; comes with them
                </li>
                <li>web links that carry extra codes</li>
              </BulletList>
              <TextSpecimen caption="After the rules" text={TRUST_EXAMPLE.afterRules} />
            </StepListItem>
            <StepListItem n={3} title="An AI finds names">
              <p>
                Next, an AI reads the text from step 2. It lists anything else that could show who someone is: names
                of people and staff, birth dates, and clues like &ldquo;the only person who uses a wheelchair on my
                floor&rdquo;. Those words are hidden too. This step does see names, because finding them is its job.
              </p>
              <p>Your answer to &ldquo;Where exactly?&rdquo; goes through steps 2 and 3 as well.</p>
              <TextSpecimen caption="After the AI" text={TRUST_EXAMPLE.afterAi} />
            </StepListItem>
            <StepListItem n={4} title="An AI writes a short summary">
              <p>
                A second AI step reads only the text from step 3, plus the kind of place you picked, like &ldquo;At a
                place&rdquo;. It writes a summary of one or two sentences and suggests what your report is about.
              </p>
              <p>
                You see the summary before you send. You choose &ldquo;Yes, that&rsquo;s right&rdquo;, change it, or
                keep your own words only. Steps 3 and 4 happen when you move to the last screen of the form, before
                you send. If you leave without sending, the organization never gets your report.
              </p>
              <TextSpecimen caption="The summary you check" text={TRUST_EXAMPLE.summary} />
            </StepListItem>
            <StepListItem n={5} title="The feedback lead checks what was hidden">
              <p>
                When you send your report, the organization&rsquo;s feedback lead sees the version with details
                hidden. They check it and can hide more words. Nobody else on the team can read your words until the
                lead has done this.
              </p>
              <TextSpecimen caption="What staff see" text={TRUST_EXAMPLE.afterAi} />
            </StepListItem>
            <StepListItem n={6} title="A team fixes the barrier">
              <p>
                The lead passes your report to the team that can fix it, like facilities or IT. They work from the
                version with details hidden, never from your original words. When they are done, they write down what
                they changed. If you said they can ask you to check the fix, you can then tell them if it works for
                you.
              </p>
            </StepListItem>
          </StepList>
          <p className="mt-2">
            <strong>If you choose &ldquo;Don&rsquo;t use AI on my report&rdquo;</strong> on the last screen, the
            summary from steps 3 and 4 is thrown away, and nothing the AI made is kept with your report. No AI reads
            it again: not for the progress report, and not to look for similar reports. The lead reads your words and
            hides names by hand in step 5.
          </p>
        </ReadingSection>

        <ReadingSection id="ai" title="What the AI never gets or does">
          <p>
            <strong>
              The AI only ever gets your words after the fixed rules in step 2 have hidden contact details and ID
              numbers.
            </strong>
          </p>
          <h3>The AI never gets</h3>
          <BulletList>
            <li>your email address, or contact details staff write down for you</li>
            <li>your receipt code</li>
            <li>your IP address (the address of your internet connection)</li>
            <li>pictures. You can&rsquo;t add a photo in this version, and images are never sent to the AI.</li>
          </BulletList>
          <p>We also tell the AI that your words are information to read, not instructions to follow.</p>

          <h3>AI never decides</h3>
          <BulletList>
            <li>AI never moves your report from one step to the next. People do.</li>
            <li>The topic the AI suggests is only a suggestion. The lead picks the topic.</li>
            <li>When staff see a summary the AI wrote, it is marked as an AI summary.</li>
            <li>AI never writes the numbers in a report. AccessLoop counts them from the records.</li>
            <li>
              Only you can confirm that a fix works, with your receipt code. No staff member can do it for you, and no
              AI can either.
            </li>
          </BulletList>

          <h3>The yearly report</h3>
          <p>
            Organizations publish a progress report about accessibility. When they draft it, an AI may reword some
            sentences to make them easier to read. Those sentences are made from counts and from short summaries the
            lead wrote. They never contain your words. If the AI changes or drops a number, AccessLoop uses the plain
            standard sentence instead.
          </p>

          <h3>Saying no to AI</h3>
          <p>
            On the form, you can tick &ldquo;Don&rsquo;t use AI on my report&rdquo;. It is on the last screen,
            &ldquo;Check your report&rdquo;, next to the summary the AI wrote. Then that summary is not kept, and no
            AI is used on your report after that. If you give feedback by phone, mail, email or in person, you can ask
            staff not to use AI. They tick the same choice for you.
          </p>
          <p>
            Before you press Next on step 3, and again next to that choice, the form says where your words go when AI
            is on in that copy of AccessLoop.
          </p>
        </ReadingSection>

        <ReadingSection id="provider" title="Which AI we use">
          <BulletList>
            <li>
              When real AI is on, AccessLoop uses Claude models made by Anthropic, through Anthropic&rsquo;s API (the
              service that apps use to connect to Claude).
            </li>
            <li>
              A copy made for testing can use simulated AI instead: ready-made answers, with nothing sent to anyone.
              The box at the top of this page says which one this copy uses.
            </li>
            <li>
              Our team also has a development tool. It runs Claude through the Claude Code app, signed in with a team
              member&rsquo;s own Claude account, on that person&rsquo;s computer. We use it only to test our AI
              instructions. It refuses to run anywhere except on that computer. We don&rsquo;t use it for real
              people&rsquo;s reports, for testers or judges, or on a public website.
            </li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="storage" title="Where your report is stored">
          <h3>In this prototype</h3>
          <p>
            Reports are saved in a database on the computer that runs AccessLoop. When AI and email are simulated,
            nothing is sent to a cloud service, an AI company or an email service.
          </p>
          <h3>When AccessLoop goes live (not yet)</h3>
          <BulletList>
            <li>The plan is to keep the database in a Canadian region (Canada Central).</li>
            <li>
              Some services that would help run AccessLoop handle data outside Canada: the AI company (it gets text
              with contact details hidden), the email service if real email is on (it gets your email address and the
              message), and the service that signs staff in. The web host can run in Canada, but we have not set that
              up yet. <a href="#services">Services we plan to use when it goes live</a> lists what each one would get.
            </li>
          </BulletList>
          <h3>On your own device</h3>
          <BulletList>
            <li>
              While you fill in the form, your answers are saved in this browser, so you don&rsquo;t lose them. Your
              email address is not saved there.
            </li>
            <li>
              They are kept only in this browser tab, and are gone when you close it. If you tick &ldquo;Keep this
              draft on this device&rdquo;, they are kept on this device for up to 7 days instead.
            </li>
            <li>
              They are removed when you send your report or press &ldquo;Start over&rdquo;. On a shared computer,
              press &ldquo;Start over&rdquo; before you leave if you did not send.
            </li>
            <li>
              After you send, your browser holds your receipt code for at most 2 minutes, just long enough to show it
              on the receipt page. The receipt page then removes it, so it is shown only once.
            </li>
            <li>We don&rsquo;t use advertising or tracking cookies.</li>
          </BulletList>
          <h3>Your IP address and the logs</h3>
          <BulletList>
            <li>
              Your IP address is the address of your internet connection. The AccessLoop app does not save it. To stop
              too many tries, it counts them under a scrambled code made from the address, the date and a secret key.
              Without that key, the code can&rsquo;t be turned back into your address. It changes every day, and old
              counts are deleted after about two days.
            </li>
            <li>AccessLoop is built so its own logs never hold your words, your email, your receipt code or your IP address.</li>
            <li>
              When AccessLoop is hosted (not yet), the hosting service will keep its own logs of each visit: your IP
              address, the time and the address of the page. The address of your report page has your receipt code in
              it, so those logs can hold your code too. Before AccessLoop goes live, we will say here how long the
              hosting service keeps those logs.
            </li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="services" title="Services we plan to use when it goes live">
          <p>
            This prototype runs on one computer and uses none of these services. When AccessLoop goes live, these
            companies would help run it. Here is what each one would get from AccessLoop, and where, as far as each
            company&rsquo;s own public pages say.
          </p>
          <Table
            id="planned-services"
            caption="Planned when hosted: what each service would get"
            description="None of these is used yet. Checked on October 20, 2026."
          >
            <THead>
              <Tr>
                <Th>Company</Th>
                <Th>What it would get</Th>
                <Th>Where, as its own pages say</Th>
              </Tr>
            </THead>
            <TBody>
              <Tr className="align-top">
                <Th scope="row">
                  Vercel
                  <span className="block font-normal text-ink-muted">would run the website</span>
                </Th>
                <Td className={SENTENCE_CELL}>
                  Each visit to a page: your IP address, the time, your browser&rsquo;s name and the address of the page.
                  Your report page&rsquo;s address has your receipt code in it. What you type passes through it on the
                  way to the database. It would also keep AccessLoop&rsquo;s secret keys and its own logs.
                </Td>
                <Td className={SENTENCE_CELL}>
                  It can run websites in Montr&eacute;al, Canada. If no place is chosen, it uses Washington, D.C., in the
                  United States. We have not chosen yet. Where it keeps its logs, and for how long: we could not confirm
                  this yet.
                </Td>
              </Tr>
              <Tr className="align-top">
                <Th scope="row">
                  Supabase
                  <span className="block font-normal text-ink-muted">would keep the database</span>
                </Th>
                <Td className={SENTENCE_CELL}>
                  Everything AccessLoop saves: reports with details hidden, each report&rsquo;s history, scrambled
                  receipt codes and staff names. Also your original words and your email, but locked with encryption.
                  The key is not kept in the database.
                </Td>
                <Td className={SENTENCE_CELL}>
                  Canada (Central), the region we plan to pick. Its page says the region decides where the main data is
                  stored. Where its backups and logs are kept: we could not confirm this yet.
                </Td>
              </Tr>
              <Tr className="align-top">
                <Th scope="row">
                  Anthropic
                  <span className="block font-normal text-ink-muted">would be the AI (Claude), when real AI is on</span>
                </Th>
                <Td className={SENTENCE_CELL}>
                  Your words after the fixed rules hide contact details and ID numbers, your answer to &ldquo;Where
                  exactly?&rdquo; after the same rules, and the kind of place you picked. For a progress report:
                  sentences made of counts and the lead&rsquo;s short summaries. When the lead looks for similar past
                  reports: the short summaries the lead wrote, never your words. Never your email, your receipt code
                  or your IP address. After you choose &ldquo;Don&rsquo;t use AI on my report&rdquo;, nothing more
                  about your report: not its summary, its sentence in a progress report, or a search for similar
                  reports.
                </Td>
                <Td className={SENTENCE_CELL}>
                  Its page says the data it keeps is stored in the United States. The AI itself may run in any country
                  where Anthropic works, unless a setting keeps it in the United States. There is no choice for Canada.
                  We have not picked the setting yet.
                </Td>
              </Tr>
              <Tr className="align-top">
                <Th scope="row">
                  Resend
                  <span className="block font-normal text-ink-muted">would send emails</span>
                </Th>
                <Td className={SENTENCE_CELL}>
                  Only if you give your email: your address and each email sent to you. That is your report&rsquo;s
                  reference and your receipt code, or a link to tell us if a fix works. Staff would get emails about
                  reports given to them, with the reference and a link only.
                </Td>
                <Td className={SENTENCE_CELL}>
                  Its page says it keeps account data, email details and logs in the United States. It sends email from
                  the United States, Ireland, Brazil or Japan. There is no choice for Canada.
                </Td>
              </Tr>
              <Tr className="align-top">
                <Th scope="row">
                  Clerk
                  <span className="block font-normal text-ink-muted">would sign staff in</span>
                </Th>
                <Td className={SENTENCE_CELL}>
                  Staff names, work email addresses and how they sign in. Nothing about you: the report form never uses
                  it.
                </Td>
                <Td className={SENTENCE_CELL}>
                  Its page says it keeps data in the United States, with no choice of country.
                </Td>
              </Tr>
            </TBody>
          </Table>
          <p>
            Before AccessLoop goes live, we will check each line again, add how long each company keeps what it gets,
            and update this page. If you don&rsquo;t want an AI company to get your words, choose &ldquo;Don&rsquo;t use
            AI on my report&rdquo;.
          </p>
          <p>The pages we read, on October 20, 2026:</p>
          <BulletList>
            {SERVICE_PAGES.map((p) => (
              <li key={p.href}>
                <a href={p.href} className="inline-flex min-h-11 items-center">
                  {p.label}
                </a>
              </li>
            ))}
          </BulletList>
        </ReadingSection>

        <ReadingSection id="encryption" title="What is locked with encryption">
          <p>Encryption scrambles information. Only someone with a secret key can read it again. AccessLoop encrypts:</p>
          <BulletList>
            <li>your original words, exactly as you wrote them</li>
            <li>your email address, if you gave one</li>
            <li>contact details staff write down for you, like a phone number or mailing address</li>
          </BulletList>
          <p>It uses AES-256-GCM, a strong and widely used method.</p>
          <p>
            Staff work from a copy of your words with details hidden. That copy is not encrypted, so they can work with
            it.
          </p>
          <p>
            When AccessLoop runs on one computer, like this prototype, the key is kept on that same computer. That
            protects a copy of the database on its own, but not against someone who has the whole computer. When
            AccessLoop goes live, the key will be kept apart from the database.
          </p>
        </ReadingSection>

        <ReadingSection id="who" title="Who can see what">
          <h3>The feedback lead</h3>
          <p>This is the person the organization named to receive accessibility feedback.</p>
          <BulletList>
            <li>Sees your report with details hidden.</li>
            <li>Checks what was hidden, and can hide more, before anyone else reads it.</li>
            <li>
              Can open your original words and contact details with &ldquo;Show original&rdquo;. Each time, AccessLoop
              records who did it and when. The original is not saved on their computer, and it is gone when they
              leave the page.
            </li>
          </BulletList>
          <h3>The team that fixes the barrier</h3>
          <BulletList>
            <li>Sees only the reports given to them, and only after the lead has checked them for names.</li>
            <li>Never sees your original words or your email.</li>
          </BulletList>
          <h3>Auditors</h3>
          <p>For example, the organization&rsquo;s internal audit team.</p>
          <BulletList>
            <li>
              Can read reports with details hidden, after the lead has checked them, and each report&rsquo;s history.
              That history shows every time someone opened an original.
            </li>
            <li>Can&rsquo;t change anything, and can&rsquo;t see your original words or your email.</li>
          </BulletList>
          <h3>The public</h3>
          <BulletList>
            <li>
              A published progress report shows counts and short summaries the lead wrote. It never shows your words,
              your name or your email.
            </li>
          </BulletList>
          <h3>Anyone who has your receipt code</h3>
          <BulletList>
            <li>Can see where your report is and what the team changed, and can answer the question about the fix.</li>
            <li>Can&rsquo;t see your words or your email.</li>
          </BulletList>
          <h3>Anyone who has the link in an email asking you to check a fix</h3>
          <BulletList>
            <li>
              Can see the same things, and answer that one question, for 30 days at most. A later check comes with a
              new link.
            </li>
            <li>Can&rsquo;t see your words, your email or your receipt code.</li>
          </BulletList>
          <h3>Other organizations</h3>
          <BulletList>
            <li>Each organization&rsquo;s reports are kept apart. Staff at one organization can&rsquo;t see another&rsquo;s.</li>
          </BulletList>
          <p>
            These rules are built into the database, not just the screens. For example, the database only lets the
            lead read the encrypted parts.
          </p>
        </ReadingSection>

        <ReadingSection id="receipt-code" title="Your receipt code">
          <BulletList>
            <li>
              You don&rsquo;t make an account or a password. When you send a report, you get a receipt code instead. It
              has 16 letters and numbers, like{" "}
              <span className="font-mono whitespace-nowrap">{TRUST_EXAMPLE.sampleCode}</span>.
            </li>
            <li>
              We don&rsquo;t keep your code. We keep only a scrambled version, made with a secret key. It can&rsquo;t
              be turned back into your code.
            </li>
            <li>
              So if you lose your code, nobody can look it up or send it to you again. Copy it, download it, or write
              it down.{" "}
              {copy.email === "resend"
                ? "If you add your email, the email that says your report arrived has your code in it."
                : "This copy does not send emails, so it can't email you the code either."}
            </li>
            <li>Anyone who has your code can check your report and answer the question about the fix. Keep it private.</li>
            <li>Your code works until 30 days after your report is confirmed fixed or closed.</li>
            <li>
              If you gave your email, the email that asks you to check a fix has a link. The link answers that one
              question only, and works for 30 days at most. It never has your code in it.
            </li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="retention" title="How long reports are kept">
          <p>The law says:</p>
          <Quote source={ACR_SOURCE}>{ACR_S19}</Quote>
          <p>
            In plain words: the organization must keep your feedback for seven years, starting on the day it gets it.
            AccessLoop helps the organization meet this obligation.
          </p>
          <BulletList>
            <li>Each report gets a &ldquo;keep until&rdquo; date, seven years after the day it arrived.</li>
            <li>The AccessLoop app is not allowed to delete reports or their history at all.</li>
            <li>With your receipt code, you can ask the team to stop contacting you. Your report is still kept.</li>
            <li>
              The organization runs a clean-up step. It removes your email address and any contact details 30 days
              after your report is confirmed fixed or closed. After that, nobody contacts you about it.
            </li>
            <li>
              After the &ldquo;keep until&rdquo; date, the same step removes your original words too. The copy with
              details hidden and the report&rsquo;s history are kept.
            </li>
            <li>Each time the step removes something, the report&rsquo;s history records it.</li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="record" title="A record nobody can quietly change">
          <p>
            Every step of a report is saved in its history: when it arrived, when names were checked, who opened the
            original, what fix was made, and your answer.
          </p>
          <BulletList>
            <li>New records can be added. Old ones can&rsquo;t be changed or deleted. The database blocks it.</li>
            <li>
              Each record has a digital fingerprint, and each fingerprint includes the one before it. If someone changed
              an old record, the chain would break, and a check finds the record where it breaks.
            </li>
            <li>
              When an organization publishes its progress report, an &ldquo;Evidence check&rdquo; page lets anyone see
              if the report still matches these records.
            </li>
          </BulletList>
          <p>
            This makes changes easy to spot, but someone with full control of the database could still try to rewrite a
            whole history. So when an organization signs off its progress report, AccessLoop seals the report, the
            lead&rsquo;s own text and the latest record of every case history in one fingerprint, and signs it with
            AccessLoop&rsquo;s key. The organization gives that fingerprint to the regulator. A history rewritten later no
            longer matches the fingerprint the regulator already has.
          </p>
          <p>
            You can check a published report on your own computer, offline, without relying on this website: download its
            evidence bundle, save <a href={SIGNING_KEYS_PATH}>AccessLoop&rsquo;s published signing keys</a>, and run{" "}
            <a href={VERIFIER_PATH} download>
              the checking script
            </a>{" "}
            with Node.js. The report&rsquo;s &ldquo;Evidence check&rdquo; page lists the steps.
          </p>
        </ReadingSection>

        <ReadingSection id="not-finished" title="What is not finished yet">
          <BulletList>
            <li>Real AI and real email may be turned off in this copy. The box at the top says which.</li>
            <li>Staff sign-in in this prototype has no passwords. It only works on the computer running AccessLoop.</li>
            <li>
              If a name was missed at first, the lead can hide it later. But records saved in the report&rsquo;s history
              before that can&rsquo;t be changed, so a copy there may still have it.
            </li>
            <li>
              An organization can&rsquo;t yet turn AI off for every report it gets. Each person can, with &ldquo;Don&rsquo;t
              use AI on my report&rdquo;.
            </li>
            <li>For your &ldquo;Where exactly?&rdquo; answer, we keep only the version with details hidden, not your original words.</li>
            <li>
              If you change the summary and type a new name in it, a staff member checks for it, not the AI. The
              summary you wrote, with contact details hidden, is also kept in the report&rsquo;s history records.
              Staff screens don&rsquo;t show that copy, but it can&rsquo;t be removed.
            </li>
            <li>
              We test how well the AI finds names using made-up reports. We have not run that test with the real AI
              yet, so we don&rsquo;t share a number.
            </li>
          </BulletList>
        </ReadingSection>

        <ReadingSection id="questions" title="Questions">
          <BulletList>
            <li>
              To learn how to report a barrier or check your report, read{" "}
              <Link href="/help">How to report a barrier and check your report</Link>.
            </li>
            <li>
              To tell us about a problem with AccessLoop itself, see{" "}
              <Link href="/accessibility#tell-us">Tell us about a problem with AccessLoop</Link>.
            </li>
          </BulletList>
        </ReadingSection>
      </div>
    </ReporterShell>
  );
}
