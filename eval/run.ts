// `npm run eval` = tsx --env-file-if-exists=.env.local eval/run.ts [--set visible|holdout|silver|injection] [--draft-check]
//                  [--baseline] [--backend X] [--repeats N] [--layer1-only]
// The runner itself is eval/runner.ts (tested in tests/eval-runner.test.ts); see eval/README.md.
import { cli } from "./runner";

cli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`[eval] stopped by an unexpected ${err instanceof Error ? err.name : "error"}. Nothing was saved.\n`);
    process.exitCode = 1;
  },
);
