// "Similar past barriers" on the staff case page (docs/domain.md §6.2; docs/phase7-prompt.md T2 item 10). Lead only,
// once the case has an area and a public summary. The candidates are plain Postgres history (lib/cases/similar.ts:
// same org, area and kind of place, last 24 months, the 40 newest, public summaries only), always readable in the
// table below; the AI only points out which of them may be the same barrier, when the lead asks
// (SimilarBarriersFinder). Nothing is ever merged, linked or closed for the lead. A case whose reporter chose "Don't
// use AI on my report" gets the table only, with no AI button (lib/cases/similar.ts refuses it too).
import Link from "next/link";
import { withOrg } from "@/db/tenant";
import { Card } from "@/components/ui/Card";
import { Disclosure } from "@/components/ui/Disclosure";
import { RedactedText } from "@/components/ui/RedactedText";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { StaffOrg } from "@/lib/auth/staff";
import { LOCATION_KIND_LABELS } from "@/lib/cases/labels";
import { SIMILAR_WINDOW_MONTHS, similarCandidates, similarReady } from "@/lib/cases/similar";
import type { StaffCaseRow } from "@/lib/cases/staff-case";
import { formatDate } from "@/lib/format";
import { AREA_HEADINGS } from "@/lib/report/headings";
import { SimilarBarriersFinder } from "./SimilarBarriersFinder";

const casesWord = (n: number) => (n === 1 ? "1 case" : `${n} cases`);

export async function SimilarBarriers({ staff, caseRow: c }: { staff: Pick<StaffOrg, "orgId" | "role">; caseRow: StaffCaseRow }) {
  if (staff.role !== "lead" || !c.priorityArea || !similarReady(c)) return null;
  const candidates = await withOrg({ orgId: staff.orgId, role: "lead" }, (tx) => similarCandidates(tx, c));
  const n = candidates.length;

  return (
    <Card
      as="section"
      id="similar-barriers"
      title="Similar past barriers"
      description={`Cases from the last ${SIMILAR_WINDOW_MONTHS} months with the same area (${AREA_HEADINGS[c.priorityArea].canonical}) and place (${LOCATION_KIND_LABELS[c.locationKind]}) as this one.`}
    >
      {n === 0 ? (
        <p className="max-w-[var(--measure)]">There are none: no other case from the last {SIMILAR_WINDOW_MONTHS} months has the same area and place.</p>
      ) : (
        <div className="grid gap-5">
          {c.aiOptOut ? (
            // domain §4: "Don't use AI on my report" means no further AI call is made for this case.
            <p className="max-w-[var(--measure)]">
              {n === 1 ? "There is 1 such case" : `There are ${n} such cases`}. The person who reported this case chose not
              to use AI on their report, so there is no AI suggestion here. Read the cases below to spot the same barrier.
            </p>
          ) : (
            <SimilarBarriersFinder
              caseRef={c.ref}
              intro={`${n === 1 ? "There is 1 such case" : `There are ${n} such cases`}. The AI can point out the ones that may be the same barrier: reported again, or back after a fix. It reads only their public summaries (never those of reports whose reporter chose not to use AI), and it changes nothing.`}
            />
          )}
          <Disclosure summary={`All ${casesWord(n)} with the same area and place`} panelClassName="max-w-none">
            <Table
              id="similar-candidates"
              caption="Cases with the same area and place"
              description={`Received in the last ${SIMILAR_WINDOW_MONTHS} months, newest first. Public summaries only.`}
              density="compact"
            >
              <THead>
                <Tr>
                  <Th>Reference</Th>
                  <Th className="sm:w-1/2">Summary</Th>
                  <Th>Status</Th>
                  <Th>Received</Th>
                </Tr>
              </THead>
              <TBody>
                {candidates.map((s) => (
                  <Tr key={s.id} className="max-sm:align-top">
                    <Th scope="row">
                      <Link href={`/app/cases/${s.ref}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-mono">
                        {s.ref}
                      </Link>
                    </Th>
                    <Td className="min-w-[min(15rem,calc(100vw_-_9.25rem))] sm:min-w-[18rem]">
                      <RedactedText as="span" text={s.publicSummary} />
                    </Td>
                    <Td>
                      <StatusBadge status={s.status} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <time dateTime={s.receivedAt.toISOString()}>{formatDate(s.receivedAt)}</time>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Disclosure>
        </div>
      )}
    </Card>
  );
}
