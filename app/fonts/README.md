# Fonts (local files only)

Loaded with `next/font/local` in `app/layout.tsx`. Never use `next/font/google`: the build must work offline.
Downloaded once on 2026-10-19 with `npm pack` (Fontsource 5.3.0 packages, not added to package.json), latin subset only
(covers English and French, including œ). Each family is under the SIL Open Font License 1.1; the licence text is next to it.

| File | Family | Source package | Licence |
|---|---|---|---|
| `atkinson-next-latin.woff2`, `atkinson-next-latin-italic.woff2` | Atkinson Hyperlegible Next (variable, wght 200-800) | `@fontsource-variable/atkinson-hyperlegible-next@5.3.0` | `OFL-atkinson-next.txt` |
| `besley-latin.woff2` | Besley (variable, wght 400-900) | `@fontsource-variable/besley@5.3.0` | `OFL-besley.txt` |
| `atkinson-mono-latin.woff2` | Atkinson Hyperlegible Mono (variable, wght 200-800) | `@fontsource-variable/atkinson-hyperlegible-mono@5.3.0` | `OFL-atkinson-mono.txt` |
