// The reporter side's design tokens, copied from the web's app/globals.css ("@tokens base:light" / "base:dark"),
// so the app and the web form look like one product: warm paper, big type, high contrast, calm.
// System fonts on purpose: they follow Dynamic Type / Font size and Bold Text with no extra code.
import { useColorScheme } from "react-native";

const light = {
  bg: "#f6f3ed",
  surface: "#fffdf9",
  surfaceRaised: "#ffffff",
  surfaceSunken: "#ece7dd",
  ink: "#1b2033",
  inkMuted: "#444a5c",
  border: "#ddd6c8",
  borderStrong: "#77715f",
  primary: "#2d3a8c",
  onPrimary: "#ffffff",
  primarySoft: "#e6e8f5",
  link: "#2d3a8c",
  accentSoft: "#fbedc8",
  accentInk: "#6b4300",
  info: "#1d4d8a",
  infoBg: "#e4edf8",
  infoBorder: "#9cb8de",
  success: "#1b663b",
  successBg: "#e1f1e6",
  successBorder: "#94c7a6",
  warning: "#724300",
  warningBg: "#fbefd3",
  warningBorder: "#ddb061",
  danger: "#a0241e",
  dangerBg: "#fae5e2",
  dangerBorder: "#e3a098",
  focus: "#3a2bc2",
  redactBg: "#ffe08a",
  redactInk: "#1b2033",
  redactBorder: "#9a6200",
  status: {
    new: { fg: "#1d4d8a", bg: "#e3ecf8" },
    triaged: { fg: "#533797", bg: "#ece6f7" },
    assigned: { fg: "#0c5960", bg: "#dbeeef" },
    retest_open: { fg: "#724300", bg: "#fbebc6" },
    verified: { fg: "#ffffff", bg: "#1b663b" },
    fixed_unverified: { fg: "#4a5711", bg: "#ebefd3" },
    closed: { fg: "#444a5c", bg: "#e8e5df" },
  },
};

export type Palette = typeof light;

const dark: Palette = {
  bg: "#1b1916",
  surface: "#23201c",
  surfaceRaised: "#2b2823",
  surfaceSunken: "#151311",
  ink: "#f3eee5",
  inkMuted: "#cbc3b5",
  border: "#3b362f",
  borderStrong: "#8e8677",
  primary: "#b3bdff",
  onPrimary: "#141936",
  primarySoft: "#272c4a",
  link: "#b9c2ff",
  accentSoft: "#392d12",
  accentInk: "#f5cb70",
  info: "#a3c4f1",
  infoBg: "#172536",
  infoBorder: "#3d5a80",
  success: "#93d5a9",
  successBg: "#14281c",
  successBorder: "#3c6b4c",
  warning: "#f1c46e",
  warningBg: "#33260e",
  warningBorder: "#7a5a1c",
  danger: "#ffa89f",
  dangerBg: "#3a1916",
  dangerBorder: "#874038",
  focus: "#ffcf5c",
  redactBg: "#5a4300",
  redactInk: "#fff3cf",
  redactBorder: "#e0b13a",
  status: {
    new: { fg: "#a9c8f4", bg: "#172536" },
    triaged: { fg: "#cdbaf4", bg: "#251d3a" },
    assigned: { fg: "#88d3d8", bg: "#0f2a2d" },
    retest_open: { fg: "#f1c46e", bg: "#33260e" },
    verified: { fg: "#0b2414", bg: "#7dd39b" },
    fixed_unverified: { fg: "#cbd78c", bg: "#252a12" },
    closed: { fg: "#cbc3b5", bg: "#2d2a25" },
  },
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const palettes = { light, dark };

/**
 * Type scale (points; Dynamic Type scales every size, and the line heights with it). Body is 18, like the web
 * reporter side. Each screen's own heading is level 2 (under the navigation bar's title, which is the h1 on the
 * web, like the web form's "Report a barrier" h1 above each step's h2). Never a fixed height on anything that
 * holds text, never numberOfLines: text wraps, screens scroll.
 */
export const type = {
  h1: { fontSize: 30, lineHeight: 38, fontWeight: "700" as const },
  h2: { fontSize: 28, lineHeight: 35, fontWeight: "700" as const },
  h3: { fontSize: 21, lineHeight: 28, fontWeight: "700" as const },
  lead: { fontSize: 20, lineHeight: 30, fontWeight: "400" as const },
  body: { fontSize: 18, lineHeight: 27, fontWeight: "400" as const },
  bodyBold: { fontSize: 18, lineHeight: 27, fontWeight: "700" as const },
  small: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  code: { fontSize: 26, lineHeight: 36, fontWeight: "700" as const, letterSpacing: 2 },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/** WCAG 2.5.5 / platform guidelines: every target is at least 44 x 44 points. */
export const MIN_TARGET = 44;

/** Readable line length on tablets and the web (the web's --measure is about 65ch). */
export const MAX_CONTENT_WIDTH = 680;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
