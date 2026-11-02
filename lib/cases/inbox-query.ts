// The inbox's search, sort and pages (docs/archive/phase7-prompt.md T2 item 5): the parts of the inbox's GET form that are
// not a filter. The filters themselves (status, area, assigned to, channel, age, and every key a dashboard number
// links with) are lib/metrics/filters.ts, the same predicates lib/metrics counts with. Query values are read
// leniently: anything unknown or invalid falls back to the default, never an error. Pure and client-safe.
import {
  INBOX_FILTER_KEYS,
  inboxHref,
  type InboxFilter,
  type SearchParamsInput,
} from "@/lib/metrics";
import type { CaseStatus } from "@/lib/status";

/** Cases on one page of the inbox. */
export const INBOX_PAGE_SIZE = 50;
/** The longest search the inbox reads (anything longer is cut). */
export const SEARCH_MAX = 100;

export const INBOX_SORTS = ["received", "age", "due"] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];
export const DEFAULT_INBOX_SORT: InboxSort = "received";

/** The "Sort by" options. "received" and "age" are the same date read two ways: newest first, or oldest first. */
export const INBOX_SORT_LABELS: Record<InboxSort, string> = {
  received: "Received, newest first",
  age: "Age, oldest first",
  due: "Due date, soonest first",
};

/** The sort in a few words, for the table's description line ("16 cases, newest first"). */
export const INBOX_SORT_WORDS: Record<InboxSort, string> = {
  received: "newest first",
  age: "oldest first",
  due: "cases due soonest first, then the newest",
};

export interface InboxQuery {
  /** The search, trimmed, with runs of spaces made one ("" = no search). */
  q: string;
  sort: InboxSort;
  /** The page asked for (1-based). inboxPage() keeps it inside the real number of pages. */
  page: number;
}

function first(input: SearchParamsInput, key: string): string {
  const raw = input instanceof URLSearchParams ? input.get(key) : ([] as string[]).concat(input[key] ?? [])[0];
  return typeof raw === "string" ? raw : "";
}

/** Read the search, sort and page from the page's search params. */
export function parseInboxQuery(input: SearchParamsInput): InboxQuery {
  const q = first(input, "q").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX).trim();
  const sortRaw = first(input, "sort");
  const sort = (INBOX_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as InboxSort) : DEFAULT_INBOX_SORT;
  const pageRaw = first(input, "page").trim();
  const page = /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1;
  return { q, sort, page };
}

/* ------------------------------------------------------------------ search */

export interface SearchableRow {
  ref: string;
  /** The lead-approved public summary (only set after triage, which needs the redaction review). */
  publicSummary: string | null;
  /** The summary text this viewer sees in the row, or null when it is hidden from them (lib/cases/visibility.ts). */
  shownText: string | null;
}

/** Lower case, without accents or extra spaces: "Écran  TACTILE" and "ecran tactile" are the same search. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-CA").replace(/\s+/g, " ").trim();
}

/** "BAR-0012", "bar 12", "#12": a reference typed with its number. */
const REF_LIKE = /^(?:bar)?[\s#-]*0*(\d{1,6})$/i;

/**
 * Does the row match the search? The reference (by its text, or by its number: "BAR-12" finds BAR-0012), the public
 * summary, or the summary the viewer sees in the row. Words the viewer can't see are never searched, so a search can
 * never tell an auditor what an unreviewed report says.
 */
export function matchesSearch(row: SearchableRow, q: string): boolean {
  const needle = fold(q);
  if (!needle) return true;
  const ref = REF_LIKE.exec(q.trim());
  if (ref && Number(ref[1]) === Number(row.ref.replace(/\D/g, ""))) return true;
  return [row.ref, row.publicSummary, row.shownText].some((t) => t !== null && fold(t).includes(needle));
}

/* ------------------------------------------------------------------ sort */

export interface SortableRow {
  receivedAt: Date;
  /** The case's number in the org (BAR-0012 is 12): breaks ties between cases received at the same instant. */
  seq: number;
  status: CaseStatus;
  dueAt: Date | null;
}

const newestFirst = (a: SortableRow, b: SortableRow) => b.receivedAt.getTime() - a.receivedAt.getTime() || b.seq - a.seq;

/**
 * The rows in the chosen order (a new array). "received": newest first. "age": oldest first. "due": the assigned
 * cases with a due date first, the earliest (the most overdue) at the top; then every other case, newest first.
 * Only an assigned case's due date counts: after a fix is logged it is history (lib/metrics/queue.ts dueState).
 */
export function sortInboxRows<T extends SortableRow>(rows: readonly T[], sort: InboxSort): T[] {
  const out = [...rows];
  if (sort === "age") return out.sort((a, b) => -newestFirst(a, b));
  if (sort === "due") {
    const due = (r: SortableRow) => (r.status === "assigned" && r.dueAt ? r.dueAt.getTime() : null);
    return out.sort((a, b) => {
      const da = due(a);
      const db = due(b);
      if (da !== null && db !== null) return da - db || newestFirst(a, b);
      if (da !== null) return -1;
      if (db !== null) return 1;
      return newestFirst(a, b);
    });
  }
  return out.sort(newestFirst);
}

/* ------------------------------------------------------------------ pages */

export interface InboxPage {
  /** This page (1-based), inside 1..pages. */
  page: number;
  pages: number;
  /** The 1-based positions of the first and last rows on this page (0 and 0 when there are none). */
  first: number;
  last: number;
  total: number;
}

/** Which rows a page shows: a page past the end shows the last one. */
export function inboxPage(total: number, requested: number): InboxPage {
  const pages = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pages);
  if (total === 0) return { page: 1, pages: 1, first: 0, last: 0, total };
  return { page, pages, first: (page - 1) * INBOX_PAGE_SIZE + 1, last: Math.min(page * INBOX_PAGE_SIZE, total), total };
}

export function pageRows<T>(rows: readonly T[], p: InboxPage): T[] {
  return p.total === 0 ? [] : rows.slice(p.first - 1, p.last);
}

/* ------------------------------------------------------------------ links and the form */

/** The inbox URL for a filter plus a search, sort and page. Defaults are left out ("/app/inbox" when all are). */
export function inboxQueryHref(filter: InboxFilter, query: Partial<InboxQuery> = {}): string {
  const params = new URLSearchParams(inboxHref(filter).split("?")[1] ?? "");
  if (query.q) params.set("q", query.q);
  if (query.sort && query.sort !== DEFAULT_INBOX_SORT) params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `/app/inbox?${s}` : "/app/inbox";
}

/** The filter keys the inbox form has a field for. Every other key is carried in a hidden field. */
export const FORM_FILTER_KEYS = ["status", "area", "assignee", "channel", "age"] as const satisfies readonly (keyof InboxFilter)[];

/**
 * The filters the form has no field for (a dashboard number's period, month, stage, ...), as hidden fields, so a
 * search or another choice in the form narrows the same cases instead of losing the number the lead came from.
 * "Clear filters" drops them all.
 */
export function hiddenFilterFields(filter: InboxFilter): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const key of INBOX_FILTER_KEYS) {
    if ((FORM_FILTER_KEYS as readonly string[]).includes(key)) continue;
    const v = filter[key];
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) out.push({ name: key, value: one });
  }
  return out;
}

/** A list filter as one select value: "" for none, "new" for one, "new,triaged" for several (the parser splits commas). */
export function selectValueOf(values: readonly string[] | string | undefined): string {
  if (values === undefined) return "";
  return Array.isArray(values) ? values.join(",") : (values as string);
}
