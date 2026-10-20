// The receipt's safeguards (docs/domain.md §4; Phase 7 T4.4): the code shown in two groups of eight with a spelled-out
// reading, a copy without hyphens, the text file, and a calendar reminder (.ics) that links to /check and NEVER holds
// the code. Pure and client-safe: no server imports, nothing logged.

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** One plain word for each letter of the receipt alphabet (Crockford base32 has no I, L, O or U). */
const LETTER_WORDS: Record<string, string> = {
  A: "Alpha",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  J: "Juliet",
  K: "Kilo",
  M: "Mike",
  N: "November",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

/** The code's letters and digits only (what "Copy code" puts on the clipboard: no hyphens, no spaces). */
export function copyableCode(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** "ABCD-EFGH-JKMN-PQRS" -> ["ABCD-EFGH", "JKMN-PQRS"]: two groups of eight, each still split in the middle. */
export function codeHalves(code: string): [string, string] {
  const groups = code.split("-");
  const mid = Math.ceil(groups.length / 2);
  return [groups.slice(0, mid).join("-"), groups.slice(mid).join("-")];
}

/** One character as it is said: a digit as its word, a letter as "K for Kilo". */
function sayChar(c: string): string {
  if (/^[0-9]$/.test(c)) return DIGIT_WORDS[Number(c)];
  const word = LETTER_WORDS[c.toUpperCase()];
  return word ? `${c.toUpperCase()} for ${word}` : c;
}

/**
 * The spelled-out reading of each half, for reading the code aloud or writing it down without mixing up letters
 * that sound alike: "seven, K for Kilo, three, M for Mike, ...".
 */
export function spellCode(code: string): [string, string] {
  const [a, b] = codeHalves(code);
  const say = (half: string) => [...copyableCode(half)].map(sayChar).join(", ");
  return [say(a), say(b)];
}

/** A `data:` URL for a small file the browser saves with a `download` link (nothing is stored on a server). */
export function dataUrl(mime: string, text: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}

export interface ReceiptFileInput {
  orgName: string;
  ref: string;
  code: string;
  /** Where to check later (absolute when the app's URL is configured). */
  checkUrl: string;
  /** The reporter's page, /r/{code}. */
  reportUrl: string;
}

/** "Download as a text file": the code (in two groups and spelled out), the reference, and where to check. */
export function receiptTextFile({ orgName, ref, code, checkUrl, reportUrl }: ReceiptFileInput): string {
  const [first, second] = codeHalves(code);
  const [sayFirst, saySecond] = spellCode(code);
  return [
    "AccessLoop receipt",
    "",
    `Organization: ${orgName}`,
    `Reference: ${ref}`,
    `Receipt code: ${code}`,
    `In two parts: ${first}  ${second}`,
    `Spelled out: ${sayFirst}; then ${saySecond}`,
    "",
    "Keep this code. It is the only way to check your report or confirm a fix if you stay anonymous.",
    "",
    `Check your report: ${reportUrl}`,
    `Or go to ${checkUrl} and type your code.`,
    "",
  ].join("\r\n");
}

/* ------------------------------------------------------------------ the calendar reminder (RFC 5545) */

/** Text values in iCalendar escape backslash, semicolon, comma and line breaks. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 character. */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const icsDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const icsStamp = (d: Date) => `${d.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

export interface ReminderInput {
  orgName: string;
  ref: string;
  /** The /check page: the reminder links there, so the person types the code they kept. */
  checkUrl: string;
  now: Date;
  /** A unique id for the event (a random UUID on the page; fixed in tests). */
  uid: string;
  /** The reminder is an all-day event this many days from now. */
  daysLater?: number;
}

/** The days the reminder is set for (shown next to the link, so the person knows what they add). */
export const REMINDER_DAYS = 14;

/**
 * "Add a reminder to my calendar": one all-day event, 2 weeks from now, with a 9:00 alert. It names the
 * organization and the non-secret reference (the person can quote it by phone) and links to /check. It never holds
 * the receipt code: calendars are often synced and shared.
 */
export function reminderCalendar({ orgName, ref, checkUrl, now, uid, daysLater = REMINDER_DAYS }: ReminderInput): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysLater));
  const next = new Date(day.getTime() + 86_400_000);
  const summary = `Check on my report to ${orgName}`;
  const description =
    `Go to ${checkUrl} and type your receipt code to see where your report is. ` +
    `Your reference is ${ref}. Your code is not in this reminder: use the one you kept.`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AccessLoop//Receipt reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}@accessloop`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART;VALUE=DATE:${icsDate(day)}`,
    `DTEND;VALUE=DATE:${icsDate(next)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    ...(/^https?:\/\//.test(checkUrl) ? [`URL:${checkUrl}`] : []),
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(summary)}`,
    "TRIGGER:PT9H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}
