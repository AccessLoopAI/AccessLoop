// What to tell a person whose local Postgres would not start (docs/phase7-prompt.md T3 item 16), for
// scripts/local-run.ts. Pure: the caller passes the output it saw, the platform and the installed locales.
//
// Two failures on a minimal Linux machine, both from embedded-postgres (node_modules/embedded-postgres):
//   - it runs initdb with --lc-messages=en_US.UTF-8; without that locale initdb stops with "invalid locale name".
//     embedded-postgres drops initdb's stderr, so scripts/local.ts only prints
//     "Postgres init script exited with code 1. Please check the logs ...";
//   - Postgres refuses to run as root ("You are running this script as root", "cannot run as a root user").

export const ROOT_MESSAGE = [
  "Local Postgres can't run as root: Postgres refuses to start for the root user, and so does embedded-postgres.",
  "Run AccessLoop's local commands as a normal user (in a container: add a user and switch to it, e.g. `USER node`).",
].join("\n");

export const LOCALE_MESSAGE = [
  'Local Postgres could not be set up: this machine has no "en_US.UTF-8" locale, and embedded-postgres runs',
  'initdb with it (initdb then stops with "invalid locale name"). Install the locale, then run the command again:',
  "  Debian:        sudo apt-get install -y locales && sudo sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && sudo locale-gen",
  "  Ubuntu:        sudo apt-get install -y locales && sudo locale-gen en_US.UTF-8",
  "  Fedora/RHEL:   sudo dnf install -y glibc-langpack-en",
  "  Alpine (musl): use a glibc-based image (e.g. node:22-bookworm-slim) instead.",
  "Postgres also can't run as root: use a normal user account.",
  "If .data/pg was left half-made, run `npm run local:reset` once the locale is installed.",
].join("\n");

export const INIT_MESSAGE = [
  "Local Postgres could not be set up (initdb failed). Check that this account can write to .data/pg and is not",
  "root, then run `npm run local:reset` to start .data/pg again from scratch.",
].join("\n");

const ROOT_OUTPUT = /running this script as root|cannot run as a root user|cannot be run as root/i;
const INIT_OUTPUT = /invalid locale name|Postgres init script exited with code/i;

/** True when `locale -a` output lists en_US.UTF-8 (glibc prints it as en_US.utf8). */
export function hasEnUsUtf8(localeList: string): boolean {
  return localeList.split(/\r?\n/).some((l) => /^en_US\.utf-?8$/i.test(l.trim()));
}

/**
 * The hint for a failed local command, or null when the output shows neither failure. `localeList` is the output
 * of `locale -a` (null when it could not be run, e.g. not on Linux).
 */
export function localFailureHint(output: string, platform: NodeJS.Platform, localeList: string | null): string | null {
  if (ROOT_OUTPUT.test(output)) return ROOT_MESSAGE;
  if (!INIT_OUTPUT.test(output)) return null;
  if (/invalid locale name/i.test(output)) return LOCALE_MESSAGE;
  if (platform === "linux" && localeList !== null && !hasEnUsUtf8(localeList)) return LOCALE_MESSAGE;
  return INIT_MESSAGE;
}
