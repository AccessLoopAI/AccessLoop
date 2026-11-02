// `npm run eval:e1 -- sheet | kappa`: the E1 labelling sheet and Cohen's kappa (eval/e1-labels.ts, eval/README.md).
import { e1Cli } from "./e1-labels";

try {
  process.exitCode = e1Cli(process.argv.slice(2));
} catch (e) {
  console.error(`eval:e1: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
