// /verify/[reportId] (docs/domain.md §8; CLAUDE.md signature moment 3), built from components/ui: the verdict (the
// status line shown visibly; the page announces the same words through the one StatusRegion), the five checks with
// what each one recomputed, and the "Records" table: ONE row per cited case, one column per check, every mark with
// its words. The chain drawing in "Records intact" is decorative (aria-hidden); the cells' text is the record.
import type { ReactNode } from "react";
import Link from "next/link";
import { Clock, PenLine } from "lucide-react";
import { CheckRing } from "@/components/ui/CheckRing";
import { EvidenceChain } from "@/components/ui/EvidenceChain";
import { HashChip } from "@/components/ui/HashChip";
import { Icon, type Glyph } from "@/components/ui/Icon";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { formatDateLong } from "@/lib/format";
import { FIELD_WORDS, refList, updatesPhrase, type EvidenceCheck, type EvidenceRow } from "@/lib/report/evidence";
import { SIGNING_KEYS_PATH, noSummaryWords } from "@/lib/report/labels";
import { signedReasons, type RowSigned, type SignedCheck } from "@/lib/report/signed-check";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The status line as a headline and its detail: "Problems found:" + what failed, "All records match" + the updates. */
function splitLine(line: string): [string, string] {
  const m = /^(Problems found:) (.+)$/.exec(line) ?? /^(All records match) (\(.+)$/.exec(line);
  return m ? [m[1], m[2]] : [line, ""];
}

export function EvidenceVerdict({ check, checkedAt }: { check: EvidenceCheck; checkedAt: Date }) {
  return (
    <div className="al-verdict" data-ok={check.allOk || undefined}>
      <CheckRing state={check.allOk ? "passed" : "missing"} className="al-verdict-ring" />
      <div className="grid min-w-0 gap-1.5">
        <p className="al-verdict-line" data-testid="evidence-line">
          <span className="al-verdict-head">{splitLine(check.line)[0]}</span>
          {splitLine(check.line)[1] ? (
            <>
              {" "}
              <span className="al-verdict-rest">{splitLine(check.line)[1]}</span>
            </>
          ) : null}
        </p>
        <p className="text-small text-ink-muted">
          Checked <time dateTime={checkedAt.toISOString()}>{formatDateLong(checkedAt)}</time>, straight from the case records:{" "}
          {check.intact.cases} {plural(check.intact.cases, "case history", "case histories")}, {check.intact.records}{" "}
          {plural(check.intact.records, "record", "records")}.
        </p>
      </div>
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return <CheckRing state={ok ? "passed" : "missing"} />;
}

function Fingerprints({ check }: { check: EvidenceCheck }) {
  const same = check.fingerprint.ok;
  return (
    <div className="al-fingerprints" data-ok={same || undefined}>
      <span className="al-fingerprint">
        <span className="al-fingerprint-label">Saved when the report was built</span>
        <HashChip hash={check.fingerprint.saved} label="Fingerprint saved when the report was built" length={16} tone={same ? "default" : "danger"} />
      </span>
      <span className="al-fingerprint-sign" aria-hidden="true">
        {same ? "=" : "≠"}
      </span>
      <span className="al-fingerprint">
        <span className="al-fingerprint-label">Computed now</span>
        <HashChip hash={check.fingerprint.now} label="Fingerprint computed now" length={16} tone={same ? "default" : "danger"} />
      </span>
      <VisuallyHidden>{same ? "The two fingerprints are the same." : "The two fingerprints are different."}</VisuallyHidden>
    </div>
  );
}

function CheckItem({
  ok,
  info,
  infoIcon = Clock,
  label,
  state,
  children,
}: {
  ok: boolean;
  info?: boolean;
  infoIcon?: Glyph;
  label: string;
  state: string;
  children: ReactNode;
}) {
  return (
    <li className="al-check al-evidence-check" data-state={info ? "info" : ok ? "passed" : "missing"}>
      {info ? <Icon icon={infoIcon} size="1.25rem" className="al-evidence-info" /> : <Mark ok={ok} />}
      <div className="al-check-text gap-1.5">
        <p className="al-check-label font-bold">
          {label}
          <VisuallyHidden>:</VisuallyHidden> <span className="al-check-state">{state}</span>
        </p>
        <div className="grid gap-3 text-ink">{children}</div>
      </div>
    </li>
  );
}

/** The signed root and the one computed now, side by side (check 5), like check 1's fingerprints. */
function SignedRoots({ signed }: { signed: SignedCheck }) {
  if (!signed.root) return null;
  const now = signed.signature?.recomputedRoot ?? "";
  const same = !!now && now === signed.root;
  return (
    <div className="al-fingerprints" data-ok={same || undefined} data-testid="signed-roots">
      <span className="al-fingerprint">
        <span className="al-fingerprint-label">Signed at sign-off (key {signed.keyId})</span>
        <HashChip hash={signed.root} label="Signed fingerprint" length={16} tone={same ? "default" : "danger"} />
      </span>
      {now ? (
        <>
          <span className="al-fingerprint-sign" aria-hidden="true">
            {same ? "=" : "≠"}
          </span>
          <span className="al-fingerprint">
            <span className="al-fingerprint-label">Computed now</span>
            <HashChip hash={now} label="Signed fingerprint computed now" length={16} tone={same ? "default" : "danger"} />
          </span>
          <VisuallyHidden>{same ? "The two signed fingerprints are the same." : "The two signed fingerprints are different."}</VisuallyHidden>
        </>
      ) : null}
    </div>
  );
}

function signedState(s: SignedCheck): string {
  return s.state === "draft" ? "Not signed yet" : s.ok ? "Passed" : "Failed";
}

/** Check 5's explanation (docs/domain.md §8 "Signed at sign-off"). */
function SignedBody({ signed }: { signed: SignedCheck }) {
  if (signed.state === "draft") {
    return (
      <p>
        A draft is not signed. When the lead signs it off, AccessLoop seals this report, its sentences, the lead&rsquo;s own
        text and the latest record of every case history of the organization in one fingerprint, and signs it with
        AccessLoop&rsquo;s key.
      </p>
    );
  }
  if (signed.ok) {
    const n = signed.heads.total;
    return (
      <>
        <p>
          At sign-off{signed.signedAt ? ` on ${formatDateLong(new Date(signed.signedAt))}` : ""}, AccessLoop sealed this
          report, its sentences, the lead&rsquo;s own text and the latest record of all {n}{" "}
          {plural(n, "case history", "case histories")} of the organization in one fingerprint, and signed it. Recomputed
          now from what is stored, the fingerprint is still the signed one, every sealed history still holds its signed
          record, and the signature checks with <a href={SIGNING_KEYS_PATH}>AccessLoop&rsquo;s published signing keys</a>.
        </p>
        <SignedRoots signed={signed} />
      </>
    );
  }
  const reasons = signedReasons(signed);
  return (
    <>
      <p>
        {signed.state === "unsigned"
          ? "This report was signed off without AccessLoop’s signature, so it can’t be checked against what was signed."
          : `This report no longer matches what AccessLoop signed at sign-off: ${reasons.join("; ")}.`}
      </p>
      {signed.state === "checked" ? (
        <p>
          Someone changed what is stored after the lead signed the report off. The signed fingerprint the organization
          gave the regulator still shows what was signed.
        </p>
      ) : null}
      <SignedRoots signed={signed} />
    </>
  );
}

/** The five checks of domain §8, each with what it recomputed and what a failure means. */
export function EvidenceChecks({ check }: { check: EvidenceCheck }) {
  const { intact, matches, later } = check;
  const brokenN = intact.broken.length;
  const factsN = matches.facts.mismatched.length;
  return (
    <ol className="al-checklist al-evidence-checks">
      <CheckItem ok={check.unchanged} label="Report unchanged" state={check.unchanged ? "Passed" : "Failed"}>
        <p>
          {check.unchanged
            ? "The fingerprint computed from the stored report is the one saved when it was built, and every sentence still checks against the records frozen into it."
            : !check.fingerprint.ok
              ? "The fingerprint computed from the stored report is not the one saved when it was built: the report's frozen numbers or records were changed after it was generated."
              : "The fingerprint matches, but sentences no longer check against the records frozen into the report: its wording or numbers were changed after it was generated."}
        </p>
        <Fingerprints check={check} />
      </CheckItem>
      <CheckItem ok={intact.ok} label="Records intact" state={intact.ok ? "Passed" : "Failed"}>
        <p>
          {intact.ok
            ? `Every cited case history checks out: each record is sealed with the fingerprint of the one before it, all the way back to the first.`
            : `${brokenN} of ${intact.cases} case ${plural(intact.cases, "history has", "histories have")} a broken link (${refList(intact.broken)}): a record was changed or removed after it was written.`}
        </p>
      </CheckItem>
      <CheckItem ok={matches.ok} label="Report matches records" state={matches.ok ? "Passed" : "Failed"}>
        <p>
          {matches.ok
            ? "Replaying each history up to the last record the report saw gives the same status, area, public summary and dates, and every count in the report comes out the same."
            : [
                matches.differ.length > 0 ? `Replaying the records does not give what the report says for ${refList(matches.differ)}.` : null,
                !matches.facts.ok
                  ? factsN > 0
                    ? `${factsN} of the report's ${plural(factsN, "counts doesn't", "counts don't")} match a recount of the records.`
                    : "The report's counts can't be recounted from the records."
                  : null,
              ]
                .filter(Boolean)
                .join(" ") || "The report does not match the records."}
        </p>
      </CheckItem>
      <CheckItem ok info label="Later updates" state={later.updates > 0 ? updatesPhrase(later.updates) : "None"}>
        <p>
          {later.updates > 0
            ? `${refList(later.refs)} changed after the report was built. That is not a problem: the report keeps the records as they were then. A new version would include the updates.`
            : "No cited case has changed since the report was built."}
        </p>
      </CheckItem>
      <CheckItem
        ok={check.signed.ok}
        info={check.signed.state === "draft"}
        infoIcon={PenLine}
        label="Signed by AccessLoop at sign-off"
        state={signedState(check.signed)}
      >
        <SignedBody signed={check.signed} />
      </CheckItem>
    </ol>
  );
}

const SIGNED_CELL: Readonly<Record<RowSigned, string>> = {
  draft: "Not signed yet",
  ok: "Signed",
  report: "Signature fails",
  history: "Changed after signing",
  absent: "Not sealed",
};

function SignedCell({ state }: { state: RowSigned }) {
  if (state === "draft") return <span className="text-ink-muted">{SIGNED_CELL.draft}</span>;
  return (
    <span className="al-evidence-cell">
      <Mark ok={state === "ok"} />
      <span>{SIGNED_CELL[state]}</span>
    </span>
  );
}

function intactText(r: EvidenceRow): string {
  if (r.intact.ok) return `Intact (${r.intact.length} ${plural(r.intact.length, "record", "records")})`;
  if (r.intact.brokenAtSeq !== null) return `Broken at record ${r.intact.brokenAtSeq} of ${r.intact.length}`;
  return "No records found";
}

function brokenExplanation(r: EvidenceRow): string | null {
  if (r.intact.ok) return null;
  if (r.intact.brokenAtSeq === null) return "This case's history is missing from the records.";
  const what = r.intact.broken ? ` (${r.intact.broken.word}, ${formatDateLong(new Date(r.intact.broken.at))})` : "";
  return `Record ${r.intact.brokenAtSeq}${what}, or one just before it, was changed or removed after it was written, so the chain of fingerprints no longer joins up there.`;
}

function matchesText(r: EvidenceRow): string {
  if (r.matches.ok) return "Matches";
  const parts: string[] = [];
  if (!r.matches.headFound) parts.push("the last record the report saw is gone");
  if (r.matches.differs.length) parts.push(r.matches.differs.map((f) => FIELD_WORDS[f]).join(", "));
  if (r.matches.factsDiffer) parts.push("a count that includes it");
  return `Differs: ${parts.join("; ") || "the records"}`;
}

/** The "Records" table: one row per cited case (domain §8), one column per check. */
export function EvidenceRecords({ check, caseHref }: { check: EvidenceCheck; caseHref?: (ref: string) => string }) {
  return (
    <Table id="records" caption="Records" density="compact" className="al-evidence-table">
      <THead>
        <Tr>
          <Th>Case</Th>
          <Th>Report unchanged</Th>
          <Th>Records intact</Th>
          <Th>Report matches records</Th>
          <Th>Later updates</Th>
          <Th>Signed at sign-off</Th>
        </Tr>
      </THead>
      <TBody>
        {check.rows.map((r) => {
          const explanation = brokenExplanation(r);
          return (
            <Tr key={r.caseId} className="align-top">
              <Th scope="row" className="al-evidence-case">
                {caseHref ? (
                  <Link href={caseHref(r.ref)} className="al-source-ref inline-flex min-h-11 items-center">
                    {r.ref}
                  </Link>
                ) : (
                  <span className="al-source-ref">{r.ref}</span>
                )}
                <span className="block text-small font-normal text-ink-muted">{r.publicSummary ?? noSummaryWords(r.status)}</span>
                {/* Phones: the drawing sits with the case (the check columns are a sideways scroll away). */}
                {r.chain.length ? <EvidenceChain links={r.chain} className="mt-2.5 sm:hidden" /> : null}
              </Th>
              <Td>
                <span className="al-evidence-cell">
                  <Mark ok={r.unchanged} />
                  <span>{r.unchanged ? "Unchanged" : "Changed"}</span>
                </span>
              </Td>
              <Td className="al-evidence-chain-cell">
                <span className="al-evidence-cell" data-ok={r.intact.ok || undefined}>
                  <Mark ok={r.intact.ok} />
                  <span>{intactText(r)}</span>
                </span>
                {explanation ? <p className="al-evidence-why">{explanation}</p> : null}
                {r.chain.length ? <EvidenceChain links={r.chain} className="al-evidence-chain mt-2.5 hidden sm:flex" /> : null}
              </Td>
              <Td>
                <span className="al-evidence-cell">
                  <Mark ok={r.matches.ok} />
                  <span>{matchesText(r)}</span>
                </span>
              </Td>
              <Td>
                {r.laterUpdates > 0 ? (
                  <span className="al-evidence-cell">
                    <Icon icon={Clock} size="1.1em" className="al-evidence-info" />
                    <span>
                      {r.laterUpdates} {plural(r.laterUpdates, "update", "updates")}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-muted">None</span>
                )}
              </Td>
              <Td>
                <SignedCell state={r.signed} />
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/** What the drawings mean (visible text, under the table). */
export function EvidenceLegend() {
  return (
    <div className="al-chain-legend">
      <EvidenceChain
        links={[
          { seq: 1, hash: "3fa9c1d27be04e5a", state: "ok" },
          { seq: 2, hash: "b1d3e5f7a9c2b4d6", state: "ok", head: true },
          { seq: 3, hash: "e8f0a1c3e5b7d9f1", state: "ok", after: true },
        ]}
      />
      <p>
        About the drawings: each chip is one record of the case&rsquo;s history, sealed with the fingerprint of the record
        before it. The ringed record is the last one the report saw; dashed records were written after it. A red break
        marks the record where the chain stops joining up.
      </p>
    </div>
  );
}
