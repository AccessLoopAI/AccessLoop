# Zero-shot baseline prompts

`npm run eval -- --baseline` runs the same pipeline with the same backend, model, user turn, answer schema and
contract checks as a normal run, but with these two files as the system prompts instead of `lib/ai/prompts/*.md`.
That is the "same model without our prompt" that eval/README.md asks for next to the classification numbers.

They state the task and the answer format only: no area definitions, no abstention rule, no style rules and no
warning about instructions inside the report. What stays the same is part of the backend, not of our prompt: the
`<report>` delimiters, the "Where the person said it happened" line, the answer's JSON schema (it lists the seven
area keys and the five detail types) and, for `claude-cli`, the CLI's fixed positional prompt.

Do not tune these files. If you change one, its sha changes, and so does the result file name.
