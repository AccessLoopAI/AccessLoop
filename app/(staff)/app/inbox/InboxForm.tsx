import Form from "next/form";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { SelectField, type SelectOption } from "@/components/ui/Select";
import {
  INBOX_SORTS,
  INBOX_SORT_LABELS,
  SEARCH_MAX,
  hiddenFilterFields,
  selectValueOf,
  type InboxQuery,
} from "@/lib/cases/inbox-query";
import { INTAKE_CHANNEL_LABELS } from "@/lib/cases/labels";
import {
  AGE_FILTERS,
  AGE_FILTER_LABELS,
  AREA_NONE,
  AREA_NOT_CLASSIFIED,
  ASSIGNEE_NONE,
  INTAKE_CHANNELS,
  type InboxFilter,
} from "@/lib/metrics";
import { AREA_HEADINGS, PRIORITY_AREAS } from "@/lib/report/headings";
import { CASE_STATUSES, STAFF_STATUS_LABELS } from "@/lib/status";

export interface AssignableMember {
  id: string;
  displayName: string;
}

const or = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

/**
 * The options of one select, plus (first) the combination a dashboard link chose when it chose several values
 * ("New, Triaged, Assigned or Waiting for the reporter to check"), so the select shows the truth and submitting the
 * form keeps it.
 */
function withCurrent(options: SelectOption[], current: readonly string[] | undefined, label: (v: string) => string): SelectOption[] {
  if (!current || current.length < 2) return options;
  return [{ value: selectValueOf(current), label: or(current.map(label)) }, ...options];
}

/**
 * The inbox's search and filters (docs/archive/phase7-prompt.md T2 item 5): a native GET form (next/form: a client-side
 * navigation with JavaScript, a normal page load without it). Nothing happens until "Show cases" is pressed (WCAG
 * 3.2.2); RouteFocus then moves focus to the h1, and the filter summary says what the list is narrowed by. Filters
 * the form has no field for (a dashboard number's period, month, ...) travel in hidden fields, so a search narrows
 * the cases the lead came from. A search landmark named by its visible heading.
 */
export function InboxForm({
  filter,
  query,
  members,
}: {
  filter: InboxFilter;
  query: InboxQuery;
  members: AssignableMember[];
}) {
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const memberLabel = (id: string) => (id === ASSIGNEE_NONE ? "No one yet" : (names.get(id) ?? "Someone not in this organization"));
  const areaLabel = (a: string) => (a === AREA_NONE ? AREA_NOT_CLASSIFIED : AREA_HEADINGS[a as (typeof PRIORITY_AREAS)[number]].canonical);
  const statusLabel = (s: string) => STAFF_STATUS_LABELS[s as (typeof CASE_STATUSES)[number]];
  const channelLabel = (c: string) => INTAKE_CHANNEL_LABELS[c as (typeof INTAKE_CHANNELS)[number]];

  const statusOptions = withCurrent(
    CASE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
    filter.status,
    statusLabel,
  );
  const areaOptions = withCurrent(
    [...PRIORITY_AREAS.map((a) => ({ value: a, label: areaLabel(a) })), { value: AREA_NONE, label: AREA_NOT_CLASSIFIED }],
    filter.area,
    areaLabel,
  );
  const memberOptions = members.map((m) => ({ value: m.id, label: m.displayName }));
  // An id from a link that is not one of this org's members: keep it visible rather than silently showing "Anyone".
  const unknown = (filter.assignee ?? []).filter((id) => id !== ASSIGNEE_NONE && !names.has(id));
  const assigneeOptions = withCurrent(
    [
      { value: ASSIGNEE_NONE, label: "No one yet" },
      ...memberOptions,
      ...(filter.assignee?.length === 1 && unknown.length === 1 ? [{ value: unknown[0], label: memberLabel(unknown[0]) }] : []),
    ],
    filter.assignee,
    memberLabel,
  );
  const channelOptions = withCurrent(
    INTAKE_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) })),
    filter.channel,
    channelLabel,
  );

  return (
    <Form
      action="/app/inbox"
      role="search"
      aria-labelledby="inbox-find-title"
      className="al-card mb-6 grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-[var(--card-pad)]"
    >
      <h2 id="inbox-find-title" className="al-subhead">
        Find cases
      </h2>
      <TextField
        id="inbox-q"
        name="q"
        type="search"
        label="Search"
        hint="A reference such as BAR-0012, or words from a summary."
        defaultValue={query.q}
        maxLength={SEARCH_MAX}
        autoComplete="off"
        spellCheck={false}
        inputWidth="medium"
      />
      <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          id="inbox-status"
          name="status"
          label="Status"
          placeholderOption="Any status"
          options={statusOptions}
          defaultValue={selectValueOf(filter.status)}
        />
        <SelectField
          id="inbox-area"
          name="area"
          label="Area"
          placeholderOption="Any area"
          options={areaOptions}
          defaultValue={selectValueOf(filter.area)}
        />
        <SelectField
          id="inbox-assignee"
          name="assignee"
          label="Assigned to"
          placeholderOption="Anyone"
          options={assigneeOptions}
          defaultValue={selectValueOf(filter.assignee)}
        />
        <SelectField
          id="inbox-channel"
          name="channel"
          label="Came in by"
          placeholderOption="Any channel"
          options={channelOptions}
          defaultValue={selectValueOf(filter.channel)}
        />
        <SelectField
          id="inbox-age"
          name="age"
          label="Age"
          placeholderOption="Any age"
          options={AGE_FILTERS.map((a) => ({ value: a, label: AGE_FILTER_LABELS[a] }))}
          defaultValue={filter.age ?? ""}
        />
        <SelectField
          id="inbox-sort"
          name="sort"
          label="Sort by"
          options={INBOX_SORTS.map((s) => ({ value: s, label: INBOX_SORT_LABELS[s] }))}
          defaultValue={query.sort}
        />
      </div>
      {hiddenFilterFields(filter).map((f, i) => (
        <input key={`${f.name}-${i}`} type="hidden" name={f.name} value={f.value} />
      ))}
      <div>
        <Button type="submit" iconStart={<Icon icon={Search} />}>
          Show cases
        </Button>
      </div>
    </Form>
  );
}
