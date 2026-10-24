// Text primitives. Every size comes from theme.type and scales with Dynamic Type / Font size (allowFontScaling
// stays on, no maxFontSizeMultiplier, never numberOfLines), so nothing is cut off at the largest sizes.
import type { ComponentRef, ReactNode, Ref } from "react";
import { Platform, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { type, usePalette } from "../theme";

type Tone = "default" | "muted";

export function Body({
  children,
  tone = "default",
  bold,
  style,
  selectable,
  lang,
}: {
  children: ReactNode;
  tone?: Tone;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
  /** e.g. "fr" when the text is French (web: the lang attribute). */
  lang?: string;
}) {
  const p = usePalette();
  return (
    <Text
      style={[bold ? type.bodyBold : type.body, { color: tone === "muted" ? p.inkMuted : p.ink }, style]}
      selectable={selectable}
      lang={lang}
    >
      {children}
    </Text>
  );
}

export function Small({ children, tone = "muted", style }: { children: ReactNode; tone?: Tone; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return <Text style={[type.small, { color: tone === "muted" ? p.inkMuted : p.ink }, style]}>{children}</Text>;
}

export type HeadingRef = ComponentRef<typeof Text>;

/**
 * A heading (accessibilityRole "header"; an h1/h2/h3 on the web). `prefix` is the small line above it, such as
 * "Step 1 of 4", and is part of the heading, so a screen reader reads "Step 1 of 4: What got in your way?"
 * when focus lands on it. Pass `ref` to move focus here (src/a11y.tsx useFocusOnScreen).
 */
export function Heading({
  level,
  children,
  prefix,
  ref,
  style,
}: {
  level: 1 | 2 | 3;
  children: string;
  prefix?: string;
  ref?: Ref<HeadingRef>;
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  const size = level === 1 ? type.h1 : level === 2 ? type.h2 : type.h3;
  return (
    <Text
      ref={ref}
      accessibilityRole="header"
      accessibilityLabel={prefix ? `${prefix}: ${children}` : undefined}
      style={[size, { color: p.ink }, style]}
      {...webHeadingProps(level)}
    >
      {prefix ? <Text style={[type.small, styles.prefix, { color: p.inkMuted }]}>{`${prefix}\n`}</Text> : null}
      {children}
    </Text>
  );
}

/** Web only: the heading level, and tabIndex -1 so focus can be moved to it (never a Tab stop). */
function webHeadingProps(level: number): object {
  return Platform.OS === "web" ? { "aria-level": level, tabIndex: -1 } : {};
}

const styles = StyleSheet.create({
  prefix: { fontWeight: "700", letterSpacing: 0.3 },
});
