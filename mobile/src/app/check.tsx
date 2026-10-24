// "Check a report": type (or paste) a receipt code. The code goes only in the Authorization header of
// GET /api/v1/status; the report then opens by a local id. It is kept on the device only if the person chooses.
import { router } from "expo-router";
import { useRef, useState } from "react";
import { useFocusOnScreen, useFocusWhen } from "../a11y";
import { getStatus } from "../api";
import { CODE_NOT_FOUND, ERRORS, problemMessage } from "../copy";
import { normalizeReceiptCode } from "../receipt-code";
import { holdForSession } from "../reports-store";
import { Actions, Button } from "../ui/Button";
import { Notice, Screen, Stack } from "../ui/blocks";
import { TextField, type InputRef } from "../ui/TextField";
import { Body, Heading, type HeadingRef } from "../ui/text";

type ErrorState = { field: boolean; message: string; at: number } | null;

export default function CheckScreen() {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const heading = useRef<HeadingRef>(null);
  const field = useRef<InputRef>(null);
  const notice = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(field, error?.field ? error.at : null);
  useFocusWhen(notice, error && !error.field ? error.at : null);

  async function check() {
    if (checking) return;
    const normalized = normalizeReceiptCode(code);
    if (!normalized) return setError({ field: true, message: ERRORS.code, at: Date.now() });
    setError(null);
    setChecking(true);
    const r = await getStatus(normalized);
    setChecking(false);
    if (!r.ok) {
      // The same answer whether the code never existed or no longer works: it never says which.
      if (r.problem === "not_found") return setError({ field: true, message: CODE_NOT_FOUND, at: Date.now() });
      return setError({ field: false, message: problemMessage(r.problem, "check your code"), at: Date.now() });
    }
    const held = await holdForSession({
      code: normalized,
      ref: r.data.ref,
      orgName: r.data.orgName,
      orgSlug: r.data.orgSlug,
    });
    setCode("");
    router.push(`/reports/${held.id}`);
  }

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Check your report
        </Heading>
        <Body>Type the receipt code you got when you sent your report. We will show you where your report is.</Body>
      </Stack>

      <Stack gap="lg">
        <TextField
          id="receipt-code"
          ref={field}
          label="Your receipt code"
          hint="It has 16 letters and numbers, like ABCD-EFGH-JKMN-PQRS. You can paste it."
          error={error?.field ? error.message : undefined}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          code
          maxLength={64}
          returnKeyType="search"
          onSubmitEditing={() => void check()}
        />
        {error && !error.field ? (
          <Stack gap="sm">
            <Heading level={3} ref={notice}>
              We could not check your code
            </Heading>
            <Notice tone="warning">{error.message}</Notice>
          </Stack>
        ) : null}
        <Actions>
          <Button label="Check" hint="Shows where your report is." busy={checking} onPress={() => void check()} />
        </Actions>
      </Stack>

      <Stack gap="md">
        <Heading level={3}>If you lost your code</Heading>
        <Body>
          We can&apos;t show your report without the code. That keeps it private. You can still call or write to the
          organization you reported to, and give them your reference, like BAR-0017.
        </Body>
      </Stack>
    </Screen>
  );
}
