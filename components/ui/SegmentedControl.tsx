import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentOption {
  value: string;
  /** The radio's accessible name; short ("This year"). */
  label: string;
  /** Content shown under the segments only while this option is chosen (CSS only, works without JavaScript). */
  reveals?: ReactNode;
}

interface SegmentedControlProps {
  /** Unique on the page; option ids are `${id}-${index}`. */
  id: string;
  name: string;
  /** The question; the group's accessible name (a visible <legend>). */
  legend: string;
  options: SegmentOption[];
  defaultValue?: string;
  /** Linked to the group with aria-describedby (a field error inside the revealed content). */
  describedBy?: string;
  /** Something that sits on the same row as the segments (the form's submit button). */
  after?: ReactNode;
  className?: string;
}

/**
 * Native radio buttons drawn as one row of segments (the dashboard's period selector): a <fieldset> + <legend>,
 * arrow keys move between options, nothing submits on change (WCAG 3.2.2): the form's own button does. The chosen
 * segment is filled AND framed; the focus ring sits on the segment. At most one option may `reveal` extra content
 * (the custom dates), shown with :has() while it is chosen. 44px targets; forced-colors keeps the frame.
 */
export function SegmentedControl({ id, name, legend, options, defaultValue, describedBy, after, className }: SegmentedControlProps) {
  const revealing = options.find((o) => o.reveals);
  return (
    <fieldset id={id} aria-describedby={describedBy} className={cx("al-segmented m-0 grid min-w-0 gap-2 border-0 p-0", className)}>
      <legend className="float-left w-full p-0 text-small font-bold text-ink-muted">{legend}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <div className="al-segments inline-flex max-w-full flex-wrap rounded-md border border-border-strong bg-surface-raised p-0.5">
          {options.map((o, i) => {
            const optId = `${id}-${i}`;
            return (
              <span key={o.value} className="al-segment relative">
                <input
                  type="radio"
                  id={optId}
                  name={name}
                  value={o.value}
                  defaultChecked={defaultValue === o.value}
                  data-reveals={o.reveals ? "" : undefined}
                  className="al-segment-input"
                />
                <label
                  htmlFor={optId}
                  className="al-segment-label al-transition inline-flex min-h-11 cursor-pointer items-center rounded-sm px-3.5 text-small font-bold"
                >
                  {o.label}
                </label>
              </span>
            );
          })}
        </div>
        {after}
      </div>
      {revealing ? <div className="al-segment-reveal">{revealing.reveals}</div> : null}
    </fieldset>
  );
}
