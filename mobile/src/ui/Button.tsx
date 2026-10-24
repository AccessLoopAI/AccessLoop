// The one button. At least 44 x 44 points (it grows with the text at large font sizes; never a fixed height),
// accessibilityRole/Label/Hint/State on every one (the hint is required), and a visible focus ring whenever a
// keyboard focuses it: the web, and Android or iPad with a hardware keyboard.
// "Disabled while busy" stays focusable and is announced as busy/dimmed, like the web's aria-disabled Back button.
import { useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "../a11y";
import { MIN_TARGET, radius, space, type, usePalette } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps {
  label: string;
  /** Read after the label by VoiceOver/TalkBack ("Double-tap to ..." is added by the system). Required. */
  hint: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Visible but does nothing (and says so). */
  disabled?: boolean;
  /** Working: shows a spinner (none under reduced motion) and is announced as busy. */
  busy?: boolean;
  /** Full width on phones (the answers on a step). */
  wide?: boolean;
  /** Role "link" for moves to another screen that aren't a step's Next/Back. */
  role?: "button" | "link";
  /** A show/hide button: says "expanded" / "collapsed". */
  expanded?: boolean;
  ref?: Ref<ComponentRef<typeof Pressable>>;
  /** Extra content after the label (e.g. a chevron). */
  trailing?: ReactNode;
}

export function Button({
  label,
  hint,
  onPress,
  variant = "primary",
  disabled,
  busy,
  wide,
  role = "button",
  expanded,
  ref,
  trailing,
}: ButtonProps) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const inactive = Boolean(disabled || busy);
  const colors = {
    primary: { bg: p.primary, fg: p.onPrimary, border: p.primary },
    secondary: { bg: p.surfaceRaised, fg: p.ink, border: p.borderStrong },
    quiet: { bg: "transparent", fg: p.link, border: "transparent" },
    danger: { bg: p.danger, fg: p.bg, border: p.danger },
  }[variant];

  return (
    <Pressable
      ref={ref}
      onPress={() => {
        if (!inactive) onPress();
      }}
      accessible
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy), ...(expanded === undefined ? {} : { expanded }) }}
      aria-disabled={Platform.OS === "web" && inactive ? true : undefined}
      aria-busy={Platform.OS === "web" && busy ? true : undefined}
      aria-expanded={Platform.OS === "web" ? expanded : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        wide && styles.wide,
        { backgroundColor: colors.bg, borderColor: colors.border },
        variant === "quiet" && styles.quiet,
        pressed && !inactive && { opacity: 0.85 },
        inactive && { opacity: 0.6 },
        focused && { outlineColor: p.focus, outlineWidth: 3, outlineStyle: "solid", outlineOffset: 2 },
      ]}
    >
      <View style={styles.row}>
        {busy && !reduced ? <ActivityIndicator color={colors.fg} accessibilityElementsHidden importantForAccessibility="no" /> : null}
        <Text style={[type.bodyBold, styles.label, { color: colors.fg }, variant === "quiet" && styles.underline]}>{label}</Text>
        {trailing}
      </View>
    </Pressable>
  );
}

/** Next first, Back after it, wrapping onto new lines at large text (the web's StepActions). */
export function Actions({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={[styles.actions, { borderTopColor: p.border }]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TARGET + 4,
    minWidth: MIN_TARGET,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  wide: { alignSelf: "stretch" },
  quiet: { paddingHorizontal: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 },
  label: { flexShrink: 1 },
  underline: { textDecorationLine: "underline" },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    paddingTop: space.xl,
  },
});
