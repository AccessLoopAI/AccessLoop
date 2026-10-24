// A labelled native TextInput (so iOS and Android dictation work with no extra code). The visible label, hint and
// error are real text above the field, and the same words are the input's accessibilityLabel/Hint, so a screen
// reader hears them on the field. Placeholder text is never used as a label. Paste always works.
import { useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { MIN_TARGET, radius, space, type, usePalette } from "../theme";

export type InputRef = ComponentRef<typeof TextInput>;

interface TextFieldProps {
  /** Used to tie label, hint and error together on the web. */
  id: string;
  label: string;
  /** Renders the label yourself (a step's focusable Heading with the same words); `label` stays the field's name. */
  labelElement?: ReactNode;
  /** Shown under the label and read on the field. Required: every field says what to put in it. */
  hint: string;
  error?: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  /** Visible lines for a multiline field (it still grows with the text). */
  lines?: number;
  ref?: Ref<InputRef>;
  keyboardType?: TextInputProps["keyboardType"];
  autoComplete?: TextInputProps["autoComplete"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  spellCheck?: boolean;
  textContentType?: TextInputProps["textContentType"];
  inputMode?: TextInputProps["inputMode"];
  /** Monospace, wide letter spacing (receipt codes). */
  code?: boolean;
  /** Return key on a one-line field. */
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps["returnKeyType"];
  maxLength?: number;
}

export function TextField({
  id,
  label,
  labelElement,
  hint,
  error,
  value,
  onChangeText,
  multiline,
  lines = 6,
  ref,
  code,
  ...rest
}: TextFieldProps) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  // The error first, so it is heard before the hint when focus moves here after an error.
  const spokenHint = [error ? `Error: ${error}` : null, hint].filter(Boolean).join(" ");
  const minHeight = multiline ? Math.max(MIN_TARGET, lines * type.body.lineHeight) : MIN_TARGET + 8;
  return (
    <View style={styles.field}>
      {labelElement ?? (
        <Text nativeID={`${id}-label`} style={[type.bodyBold, { color: p.ink }]}>
          {label}
        </Text>
      )}
      {hint ? (
        <Text nativeID={`${id}-hint`} style={[type.small, { color: p.inkMuted }]}>
          {hint}
        </Text>
      ) : null}
      {error ? <FieldError id={`${id}-error`} message={error} /> : null}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        accessibilityLabel={label}
        accessibilityHint={spokenHint || undefined}
        aria-invalid={error ? true : undefined}
        {...webDescribedBy(id, Boolean(hint), Boolean(error), !labelElement)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.body,
          code && styles.code,
          styles.input,
          {
            minHeight,
            color: p.ink,
            backgroundColor: p.surfaceRaised,
            borderColor: error ? p.danger : focused ? p.primary : p.borderStrong,
            borderWidth: focused || error ? 3 : 2,
          },
          Platform.OS === "web" && focused && { outlineColor: p.focus, outlineWidth: 3, outlineStyle: "solid", outlineOffset: 2 },
        ]}
        {...rest}
      />
    </View>
  );
}

/** Web only: aria-describedby for the hint and error (react-native-web drops accessibilityHint). */
function webDescribedBy(id: string, hint: boolean, error: boolean, ownLabel: boolean): object {
  if (Platform.OS !== "web") return {};
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return { ...(ids ? { "aria-describedby": ids } : {}), ...(ownLabel ? { "aria-labelledby": `${id}-label` } : {}) };
}

/** An error under a question or field: a bar, the word "Error" and the message (never colour alone). */
export function FieldError({ message, id }: { message: string; id?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.error, { borderLeftColor: p.danger }]}>
      <Text nativeID={id} style={[type.bodyBold, { color: p.danger }]}>
        {`Error: ${message}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.sm },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  code: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), letterSpacing: 2 },
  error: { borderLeftWidth: 4, paddingLeft: space.md },
});
