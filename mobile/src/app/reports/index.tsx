// "My reports": the reports whose codes this device keeps. The list shows the reference, the organization and
// the date, never the code (it is read from the secure store only when a report is opened).
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useFocusOnScreen } from "../../a11y";
import { formatDate } from "../../format";
import { canKeepCodes, listReports, type SavedReport } from "../../reports-store";
import { Button } from "../../ui/Button";
import { Notice, Screen, Stack } from "../../ui/blocks";
import { Body, Heading, type HeadingRef } from "../../ui/text";

export default function MyReports() {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [secure, setSecure] = useState(true);
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const [list, can] = await Promise.all([listReports(), canKeepCodes()]);
        if (!alive) return;
        setReports(list);
        setSecure(can);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          My reports
        </Heading>
        <Body>
          {secure
            ? "The receipt codes of reports you sent or checked are kept here, on this device only. Only this app can read them."
            : "This browser keeps codes only until you close this tab. Write your codes down."}
        </Body>
      </Stack>

      {reports === null ? (
        <Body tone="muted">Loading your reports…</Body>
      ) : reports.length === 0 ? (
        <Notice tone="info" title="No reports on this device yet">
          When you send a report, its code is kept here so you can check on it later.
        </Notice>
      ) : (
        <Stack gap="md">
          {reports.map((r) => {
            const date = formatDate(r.savedAt);
            const label = [r.ref, r.orgName, date ? `added ${date}` : null, r.kept ? null : "kept only until you close the app"]
              .filter(Boolean)
              .join(", ");
            return (
              <Button
                key={r.id}
                label={label}
                hint="Shows where this report is now."
                variant="secondary"
                role="link"
                wide
                onPress={() => router.push(`/reports/${r.id}`)}
              />
            );
          })}
        </Stack>
      )}

      <Stack gap="md">
        <Button
          label="Report a barrier"
          hint="Starts a new report. There are 4 short steps."
          variant="secondary"
          onPress={() => router.push("/report")}
          wide
        />
        <Button
          label="Check a report with your code"
          hint="Type the receipt code you got when you sent a report."
          variant="secondary"
          onPress={() => router.push("/check")}
          wide
        />
      </Stack>
    </Screen>
  );
}
