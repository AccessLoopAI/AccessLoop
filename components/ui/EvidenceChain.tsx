// The evidence chain (CLAUDE.md signature moment 3, docs/domain.md §8): one case's history drawn as a chain of linked
// records, from the genesis dot through one short hash chip per record, each joined to the one before it (its hash
// seals the previous record's). The last record the report saw is ringed ("In this report"); records written after
// it are dashed; a broken link is drawn red, thick and dashed with a broken-link icon ("Broken here"), and the records
// after it are muted (nothing after a break can be vouched for). DECORATIVE: the whole drawing is aria-hidden, and the
// text next to it (the "Records" table's cells) carries every fact, including the plain explanation of a break. On
// first paint the links draw in from the left, once, only when nobody asked for reduced motion (a transform on the
// connector only; app/globals.css `.al-chain`).
import type { CSSProperties } from "react";
import { Unlink } from "lucide-react";
import { cx } from "./cx";
import { HashChip } from "./HashChip";
import { Icon } from "./Icon";

export interface ChainLinkItem {
  seq: number;
  hash: string;
  /** ok: joins the chain; broken: the first record that does not; unchecked: after a break. */
  state: "ok" | "broken" | "unchecked";
  /** The last record the report saw. */
  head?: boolean;
  /** Written after the report was built. */
  after?: boolean;
}

/** How many links the draw-in staggers before the rest arrive together (keeps it under a second). */
const STAGGER_MAX = 14;

export function EvidenceChain({ links, className }: { links: readonly ChainLinkItem[]; className?: string }) {
  return (
    <ol aria-hidden="true" className={cx("al-chain", className)}>
      {links.map((l, i) => (
        <li
          key={l.seq}
          className="al-chain-link"
          data-state={l.state}
          data-head={l.head || undefined}
          data-after={l.after || undefined}
          style={{ "--i": Math.min(i, STAGGER_MAX) } as CSSProperties}
        >
          <span className="al-chain-joint">{l.state === "broken" ? <Icon icon={Unlink} size="1.15em" strokeWidth={2.25} /> : null}</span>
          <HashChip
            hash={l.hash.slice(0, 6)}
            length={6}
            decorative
            tone={l.state === "broken" ? "danger" : l.state === "unchecked" || l.after ? "muted" : "default"}
            className="al-chain-chip"
          />
          {l.state === "broken" || l.head ? (
            <span className="al-chain-tags">
              {l.state === "broken" ? <span className="al-chain-tag" data-tone="danger">Broken here</span> : null}
              {l.head ? <span className="al-chain-tag">In this report</span> : null}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
