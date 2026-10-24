// A single-choice question: the native "radiogroup" with one "radio" per answer (the web's fieldset + legend).
// Each answer is a full-width row of at least 44 points with its own hint; the chosen one is shown by a filled
// circle AND a heavier border (never colour alone). The question text is the group's label; an error is shown
// under it and read with it. `ref` on the first answer lets a screen move focus there after an error.
// VoiceOver doesn't read a group's label when focus lands on an answer, so on phones the error is also the start
// of the first answer's hint (the answer focus moves to after an error).
import { useId, useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MIN_TARGET, radius, space, type, usePalette } from "../theme";
import { FieldError } from "./TextField";

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  /** Shown under the label and read after it. Required: every answer says what it does. */
  hint: string;
}

interface RadioGroupProps<V extends string> {
  /** The question. Shown as the group's heading-sized label, unless `labelElement` renders it instead. */
  label: string;
  /** Renders the question yourself (e.g. a focusable step Heading); `label` is still the group's name. */
  labelElement?: ReactNode;
  description?: ReactNode;
  options: readonly RadioOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  error?: string;
  firstOptionRef?: Ref<ComponentRef<typeof Pressable>>;
  /** Shown under the chosen answer only (e.g. the email field). */
  conditional?: Partial<Record<V, ReactNode>>;
}

export function RadioGroup<V extends string>({
  label,
  labelElement,
  description,
  options,
  value,
  onChange,
  error,
  firstOptionRef,
  conditional,
}: RadioGroupProps<V>) {
  const p = usePalette();
  const groupId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={error ? `${label} ${error}` : label}
      style={styles.group}
    >
      {labelElement ?? <Text style={[type.h3, { color: p.ink }]}>{label}</Text>}
      {description ? <View>{description}</View> : null}
      {error ? <FieldError message={error} /> : null}
      <View style={styles.options}>
        {options.map((o, i) => (
          <View key={o.value} style={styles.optionBlock}>
            <RadioRow
              option={o}
              index={i}
              count={options.length}
              checked={value === o.value}
              onPress={() => onChange(o.value)}
              invalid={Boolean(error)}
              error={i === 0 ? error : undefined}
              hintId={`radio-${groupId}-${i}-hint`}
              ref={i === 0 ? firstOptionRef : undefined}
            />
            {value === o.value && conditional?.[o.value] ? (
              <View style={[styles.conditional, { borderLeftColor: p.borderStrong }]}>{conditional[o.value]}</View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function RadioRow<V extends string>({
  option,
  index,
  count,
  checked,
  onPress,
  invalid,
  error,
  hintId,
  ref,
}: {
  option: RadioOption<V>;
  index: number;
  count: number;
  checked: boolean;
  onPress: () => void;
  invalid: boolean;
  /** The group's error, on the first answer only. */
  error?: string;
  /** Web: the id of the visible hint, for aria-describedby. */
  hintId: string;
  ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const spokenHint = error ? `Error: ${error} ${option.hint}` : option.hint;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessible
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      accessibilityHint={spokenHint}
      // `checked` only: adding `selected` makes VoiceOver and TalkBack say the state twice.
      accessibilityState={{ checked }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...webRadioProps(checked, index, count, onPress, hintId)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: checked ? p.primarySoft : p.surfaceRaised,
          borderColor: checked ? p.primary : invalid ? p.danger : p.borderStrong,
          borderWidth: checked ? 3 : 2,
        },
        pressed && { opacity: 0.9 },
        focused && { outlineColor: p.focus, outlineWidth: 3, outlineStyle: "solid", outlineOffset: 2 },
      ]}
    >
      <View style={[styles.circle, { borderColor: checked ? p.primary : p.borderStrong }]}>
        {checked ? <View style={[styles.dot, { backgroundColor: p.primary }]} /> : null}
      </View>
      <View style={styles.texts}>
        <Text style={[type.bodyBold, { color: p.ink }]}>{option.label}</Text>
        <Text nativeID={hintId} style={[type.small, { color: p.inkMuted }]}>
          {option.hint}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Web only: react-native-web reads aria-* (not accessibilityState or accessibilityHint, so the visible hint is
 * tied on with aria-describedby), and a keyboard's Space chooses an answer like a native radio (Enter already
 * works). On phones the group itself says "1 of 3".
 */
function webRadioProps(checked: boolean, index: number, count: number, choose: () => void, hintId: string): object {
  if (Platform.OS !== "web") return {};
  return {
    "aria-checked": checked,
    "aria-describedby": hintId,
    "aria-setsize": count,
    "aria-posinset": index + 1,
    onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
      const key = e.key ?? e.nativeEvent?.key;
      if (key === " " || key === "Spacebar") {
        e.preventDefault?.();
        choose();
      }
    },
  };
}

const styles = StyleSheet.create({
  group: { gap: space.md },
  options: { gap: space.md },
  optionBlock: { gap: space.md },
  row: {
    minHeight: MIN_TARGET + 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  texts: { flex: 1, gap: space.xs },
  conditional: { borderLeftWidth: 4, paddingLeft: space.lg, marginLeft: space.md, gap: space.md },
});
