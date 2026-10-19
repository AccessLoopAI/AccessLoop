// The app's fonts, defined once (Next's "font definitions file") and used by the root layout and by
// app/global-error.tsx, which replaces the root layout and must load its own fonts.
// Local font files only (app/fonts, OFL licences next to them). Never next/font/google: the build must work offline.
import localFont from "next/font/local";

const atkinson = localFont({
  src: [
    { path: "./fonts/atkinson-next-latin.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/atkinson-next-latin-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-atkinson",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Arial", "sans-serif"],
  adjustFontFallback: "Arial",
});

const besley = localFont({
  src: "./fonts/besley-latin.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-besley",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});

const atkinsonMono = localFont({
  src: "./fonts/atkinson-mono-latin.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-atkinson-mono",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "Consolas", "monospace"],
  adjustFontFallback: false,
});

/** Put on <html>: defines --font-atkinson, --font-besley and --font-atkinson-mono for app/globals.css. */
export const fontVariables = `${atkinson.variable} ${besley.variable} ${atkinsonMono.variable}`;
