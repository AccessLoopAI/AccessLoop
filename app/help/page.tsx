import type { Metadata } from "next";
import Link from "next/link";
import { OrgContactList, orgContact, OrgPageLink } from "@/components/layout/OrgContacts";
import { orgQuery, ReporterShell } from "@/components/layout/ReporterShell";
import { Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { spellCode } from "@/lib/intake/receipt-extras";
import { getPublicOrg } from "@/lib/orgs";

const EXAMPLE_CODE = "7K3M-9Q2D-XW4H-B8RT";
const exampleReading = spellCode(EXAMPLE_CODE);

export const metadata: Metadata = {
  title: "Get help",
  description: "How to report a barrier, stay anonymous and check your report later.",
};

// `?org={slug}` ("Get help" on an organization's pages) only names the organization the person came from: the
// "Other ways to reach" section then gives its own phone, email and mail (Phase 7 T4.1). A public slug, never data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ org?: string | string[] }> };

// Plain language, grade 6-8. Never "priority area" or "barrier classification" on reporter pages.
export default async function HelpPage({ searchParams }: Props) {
  const slug = (await searchParams).org;
  const org = typeof slug === "string" ? await getPublicOrg(slug) : null;
  return (
    <ReporterShell orgName={org?.name} orgSlug={org?.slug}>
      <PageHeader
        title="Get help"
        description="AccessLoop is a simple way to tell an organization about a barrier, and to check later that it was fixed."
      />

      <div className="grid gap-[var(--stack-lg)]">
        <section aria-labelledby="what-is-a-barrier" className="grid gap-4">
          <h2 id="what-is-a-barrier">What is a barrier?</h2>
          <p>
            A barrier is anything that makes it hard for you to take part. It can be a website or an app, a building,
            a phone line, a document or a rule.
          </p>
        </section>

        <section aria-labelledby="how-to-report" className="grid gap-4">
          <h2 id="how-to-report">How to report a barrier</h2>
          <ol className="m-0 grid list-decimal gap-3 pl-7 marker:font-bold marker:text-primary">
            <li>Open the organization&rsquo;s form to report a barrier.</li>
            <li>Tell them what got in your way. You can type, or use your device&rsquo;s dictation.</li>
            <li>Say where it happened.</li>
            <li>Choose if they can contact you later.</li>
            <li>Check your report, then send it.</li>
          </ol>
          <p>There is one question on each screen. You can go back and change your answers before you send.</p>
        </section>

        <section aria-labelledby="anonymous" className="grid gap-4">
          <h2 id="anonymous">You can stay anonymous</h2>
          <p>
            You do not have to give your name or your email. On the follow-up question, the first two answers keep you
            anonymous. Names and
            contact details in your words are hidden from the team that fixes the barrier. If a staff member ever
            looks at your original words, that is recorded.
          </p>
          <p>
            If you choose to add your email, only the organization&rsquo;s accessibility team can see it. It is never
            shown in public reports.
          </p>
        </section>

        <section aria-labelledby="no-time-limit" className="grid gap-4">
          <h2 id="no-time-limit">There is no time limit</h2>
          <p>
            Take as long as you need. Nothing on the form times out, and nothing moves to the next step until you
            choose to go on.
          </p>
        </section>

        <section aria-labelledby="check-later" className="grid gap-4">
          <h2 id="check-later">Check your report later</h2>
          <p>When you send a report, you get a receipt code. It looks like this:</p>
          {/* Shown as the receipt shows a real code: two groups of eight, spelled out under them. */}
          <CodeDisplay
            code={EXAMPLE_CODE}
            label="Example receipt code"
            halves
            reading={
              <p>
                <span className="font-bold text-ink">Spelled out: </span>
                {exampleReading[0]}; then {exampleReading[1]}.
              </p>
            }
          />
          <p>
            Keep your code somewhere safe. If you stay anonymous, it is the only way to check your report. It is also
            how you tell the organization if a fix works for you.
          </p>
          <p>
            To check your report, open the link on your receipt page, or type your code on the Check your report page.
            You can check as many times as you like. When a fix is ready, that is where you tell the organization if it
            works for you.
          </p>
          <p>
            <ButtonLink href={`/check${orgQuery(org?.slug)}`} variant="secondary" plain iconStart={<Icon icon={Search} />}>
              Check a report with your code
            </ButtonLink>
          </p>
        </section>

        <section aria-labelledby="other-ways" className="grid gap-4">
          <h2 id="other-ways">{org ? `Other ways to reach ${org.name}` : "Other ways to reach the organization"}</h2>
          {org ? (
            <>
              <OrgContactList org={orgContact(org)} />
              <p>You can also ask for information in another format, like large print, braille or audio.</p>
              <OrgPageLink org={org} />
            </>
          ) : (
            <p>
              You can also give feedback by phone, by mail or by email. Ask for the person who receives accessibility
              feedback. You can also ask for information in another format, like large print, braille or audio.
            </p>
          )}
        </section>

        <section aria-labelledby="about-accessloop" className="grid gap-4">
          <h2 id="about-accessloop">About AccessLoop</h2>
          <ul className="m-0 grid list-disc gap-3 pl-7 marker:text-primary">
            <li>
              <Link href="/trust">Privacy and AI</Link>: what the AI reads, who can see your report, where it is kept
              and for how long.
            </li>
            <li>
              <Link href="/accessibility">Accessibility</Link>: what we test, what we have not tested yet, and how to
              tell us about a problem with this site.
            </li>
          </ul>
        </section>
      </div>
    </ReporterShell>
  );
}
