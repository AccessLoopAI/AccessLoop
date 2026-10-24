// Layout and content blocks: the scrolling screen, cards, notices, the status badge, redacted text and the
// receipt code. Nothing here moves unless asked (the verified moment respects reduced motion).
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CaseStatus } from "../api";
import { reporterStatusLabel } from "../copy";
import { codeLines, spellCode } from "../receipt-code";
import { useReducedMotion } from "../a11y";
import { MAX_CONTENT_WIDTH, radius, space, type, usePalette } from "../theme";
import { Heading, type HeadingRef } from "./text";

/** Every screen scrolls (large text never gets cut off) and keeps a readable width on tablets and the web. */
export function Screen({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: p.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Stack({ children, gap = "xl", style }: { children: ReactNode; gap?: keyof typeof space; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: space[gap] }, style]}>{children}</View>;
}

/** A framed section with an h3 title (the web's Card). */
export function Card({
  title,
  titleRef,
  children,
  tone = "default",
}: {
  title?: string;
  /** The title heading, for moving focus to it (useFocusWhen). */
  titleRef?: Ref<HeadingRef>;
  children: ReactNode;
  tone?: "default" | "inset";
}) {
  const p = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tone === "inset" ? p.surfaceSunken : p.surfaceRaised, borderColor: p.border },
      ]}
    >
      {title ? (
        <Heading level={3} ref={titleRef}>
          {title}
        </Heading>
      ) : null}
      {children}
    </View>
  );
}

export type NoticeTone = "info" | "success" | "warning" | "danger";

/** A calm boxed message. The tone is in the words and a bar, never colour alone. */
export function Notice({ tone = "info", title, children }: { tone?: NoticeTone; title?: string; children: ReactNode }) {
  const p = usePalette();
  const c = {
    info: { fg: p.info, bg: p.infoBg, border: p.infoBorder },
    success: { fg: p.success, bg: p.successBg, border: p.successBorder },
    warning: { fg: p.warning, bg: p.warningBg, border: p.warningBorder },
    danger: { fg: p.danger, bg: p.dangerBg, border: p.dangerBorder },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderColor: c.border, borderLeftColor: c.fg }]}>
      {title ? <Text style={[type.bodyBold, { color: p.ink }]}>{title}</Text> : null}
      {typeof children === "string" ? <Text style={[type.body, { color: p.ink }]}>{children}</Text> : children}
    </View>
  );
}

/**
 * The reporter's status words in a pill. `celebrate`: the verified moment right after "Yes, it works now", a
 * short grow-in once, and nothing at all under reduced motion.
 */
export function StatusBadge({
  status,
  closedReason,
  celebrate,
}: {
  status: CaseStatus;
  closedReason: string | null;
  celebrate?: boolean;
}) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const played = useRef(false);
  // The badge is already on screen when the answer comes back, so the grow-in starts when `celebrate` turns
  // true (not from the value it had when it first appeared), and only once.
  useEffect(() => {
    if (!celebrate || played.current) return;
    played.current = true;
    if (reduced) return;
    scale.setValue(0.85);
    Animated.spring(scale, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 5 }).start();
  }, [celebrate, reduced, scale]);
  // Reduce Motion turned on while it plays: stop at once.
  useEffect(() => {
    if (!reduced) return;
    scale.stopAnimation();
    scale.setValue(1);
  }, [reduced, scale]);
  const c = p.status[status];
  return (
    <Animated.View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.fg, transform: [{ scale }] }]}>
      <Text style={[type.bodyBold, { color: c.fg }]}>{reporterStatusLabel(status, closedReason)}</Text>
    </Animated.View>
  );
}

const TOKEN = /\[(EMAIL|PHONE|SIN|POSTAL_CODE|HEALTH_CARD|ACCOUNT_NUMBER|STREET_ADDRESS|URL|PERSON|STAFF_NAME|DOB|QUASI_ID|OTHER_ID)\]/g;

/**
 * Already-redacted text with each [TYPE] token highlighted (colour, a border-like underline AND the token text,
 * which is what a screen reader reads). Never pass original text here.
 */
export function RedactedText({ text, large }: { text: string; large?: boolean }) {
  const p = usePalette();
  const parts: { text: string; token: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), token: false });
    parts.push({ text: m[0], token: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), token: false });
  return (
    <Text style={[large ? type.lead : type.body, { color: p.ink }]}>
      {parts.map((part, i) =>
        part.token ? (
          <Text
            key={i}
            style={{ backgroundColor: p.redactBg, color: p.redactInk, textDecorationLine: "underline", textDecorationColor: p.redactBorder }}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={i}>{part.text}</Text>
        ),
      )}
    </Text>
  );
}

/**
 * The receipt code, big, in two lines of eight, selectable (long-press to copy), read one character at a time by
 * screen readers, with the same spelled-out reading shown under it for anyone reading it aloud.
 */
export function CodeDisplay({ code, label }: { code: string; label: string }) {
  const p = usePalette();
  const [first, second] = codeLines(code);
  const spelled = spellCode(code);
  return (
    <View style={[styles.code, { backgroundColor: p.surfaceRaised, borderColor: p.borderStrong }]}>
      <Text style={[type.bodyBold, { color: p.inkMuted }]}>{label}</Text>
      <Text
        selectable
        accessibilityLabel={`${label}: ${spelled}`}
        style={[type.code, styles.mono, { color: p.ink }]}
      >
        {`${first}\n${second}`}
      </Text>
      <Text style={[type.small, { color: p.inkMuted }]}>{`Read it as: ${spelled}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xxxl, alignItems: "center" },
  column: { width: "100%", maxWidth: MAX_CONTENT_WIDTH, gap: space.xxl },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  notice: { borderWidth: 1, borderLeftWidth: 6, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  badge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderWidth: 2,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  code: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
});
