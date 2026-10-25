// Choose the organization: by its short name (slug), or from a location poster's QR code / deep link
// accessloop://report?org={slug}&loc={locationId}. A deep link only fills this screen in: the person still reads
// who they are telling and presses "Start my report" (no auto-advance).
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useAnnounce, useFocusOnScreen, useFocusWhen } from "../../a11y";
import { lookupOrg, ORG_SLUG, type OrgInfo } from "../../api";
import { ERRORS, problemMessage } from "../../copy";
import { useDraft } from "../../report-draft";
import { Actions, Button } from "../../ui/Button";
import { Card, Notice, Screen, Stack } from "../../ui/blocks";
import { TextField, type InputRef } from "../../ui/TextField";
import { Body, Heading, type HeadingRef } from "../../ui/text";

type Lookup =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "found"; org: OrgInfo; confirmed: boolean }
  | { kind: "error"; message: string; field: boolean; at: number };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default function ChooseOrganization() {
  const params = useLocalSearchParams<{ org?: string; loc?: string }>();
  const fromLink = one(params.org).toLowerCase();
  const locationId = one(params.loc);
  const { draft, start } = useDraft();
  const announce = useAnnounce();
  const [slug, setSlug] = useState(fromLink || draft.org?.slug || "");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const heading = useRef<HeadingRef>(null);
  const field = useRef<InputRef>(null);
  const result = useRef<HeadingRef>(null);
  const problem = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(field, lookup.kind === "error" && lookup.field ? lookup.at : null);
  // Offline, too many tries or a server failure (no field to point at): focus the heading of the notice, as on
  // check.tsx and follow-up.tsx, so a screen reader says what went wrong when the busy state ends.
  useFocusWhen(problem, lookup.kind === "error" && !lookup.field ? lookup.at : null);
  useFocusWhen(result, lookup.kind === "found" ? lookup.org.slug : null);

  async function find(value: string, loc?: string) {
    const s = value.trim().toLowerCase();
    if (!ORG_SLUG.test(s)) {
      setLookup({ kind: "error", message: ERRORS.slug, field: true, at: Date.now() });
      return;
    }
    setLookup({ kind: "looking" });
    const r = await lookupOrg(s, loc || undefined);
    if (r.ok) {
      setLookup({ kind: "found", org: r.data, confirmed: true });
      announce(`Found ${r.data.name}.`);
    } else if (r.problem === "unavailable") {
      // This server can't look names up (the lookup endpoint is a proposal): carry on with the name as typed.
      setLookup({
        kind: "found",
        org: { slug: s, name: s, location: null, contact: null },
        confirmed: false,
      });
    } else if (r.problem === "not_found") {
      setLookup({
        kind: "error",
        message: "We couldn't find an organization with that name. Check the spelling, or ask the organization for their link.",
        field: true,
        at: Date.now(),
      });
    } else {
      setLookup({ kind: "error", message: problemMessage(r.problem, "look up the organization"), field: false, at: Date.now() });
    }
  }

  // A deep link or QR code: look the organization up once per link, then wait for the person. A second poster
  // scanned while this screen is open (same screen, new params) fills it in again.
  const linked = useRef<string | null>(null);
  useEffect(() => {
    const key = `${fromLink}|${locationId}`;
    if (!fromLink || linked.current === key) return;
    linked.current = key;
    setSlug(fromLink);
    void find(fromLink, locationId); // find only reads its arguments and stable setters
  }, [fromLink, locationId]); // find is recreated each render on purpose; the ref keeps this to one call per link

  function begin(org: OrgInfo, confirmed: boolean) {
    start(org, confirmed);
    router.push("/report/what");
  }

  const fieldError = lookup.kind === "error" && lookup.field ? lookup.message : undefined;

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Who do you want to tell?
        </Heading>
        <Body>
          Enter the organization&apos;s short name. It is on their poster, or at the end of the link to their form, like
          maple-harbour.
        </Body>
      </Stack>

      <Stack gap="lg">
        <TextField
          id="org-slug"
          ref={field}
          label="Organization's short name"
          hint="Small letters, numbers and dashes. You can paste it."
          error={fieldError}
          value={slug}
          onChangeText={(v) => {
            setSlug(v);
            if (lookup.kind !== "looking") setLookup({ kind: "idle" });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          returnKeyType="search"
          onSubmitEditing={() => void find(slug)}
          maxLength={80}
        />
        <Actions>
          <Button
            label="Find organization"
            hint="Looks up the organization by its short name. Nothing is sent about you."
            busy={lookup.kind === "looking"}
            variant={lookup.kind === "found" ? "secondary" : "primary"}
            onPress={() => void find(slug)}
          />
        </Actions>
      </Stack>

      {lookup.kind === "error" && !lookup.field ? (
        <Stack gap="sm">
          <Heading level={3} ref={problem}>
            We could not go on just now
          </Heading>
          <Notice tone="warning">{lookup.message}</Notice>
        </Stack>
      ) : null}

      {lookup.kind === "found" ? (
        <Stack gap="lg">
          <Heading level={3} ref={result}>
            {lookup.confirmed ? `You are telling ${lookup.org.name}` : `You are telling "${lookup.org.slug}"`}
          </Heading>
          {lookup.confirmed ? null : (
            <Notice tone="info">
              We can&apos;t check this name right now, so we will use it as you typed it. If it is wrong, we will tell you
              before your report is sent.
            </Notice>
          )}
          {lookup.org.location ? (
            <Body>{`Place: ${lookup.org.location.name}. We will fill this in for you, and you can change it.`}</Body>
          ) : null}
          <OtherWays org={lookup.org} />
          <Actions>
            <Button
              label="Start my report"
              hint="There are 4 short steps. Take as long as you need."
              onPress={() => begin(lookup.org, lookup.confirmed)}
            />
          </Actions>
        </Stack>
      ) : null}
    </Screen>
  );
}

/** "Other ways to reach {org}" (ACR s.9(3)), when the server sends them. */
function OtherWays({ org }: { org: OrgInfo }) {
  const c = org.contact;
  const lines = c
    ? [
        c.designateTitle ? `Ask for: ${c.designateTitle}` : null,
        c.phone ? `Phone: ${c.phone}` : null,
        c.email ? `Email: ${c.email}` : null,
        c.mailingAddress ? `Mail: ${c.mailingAddress}` : null,
      ].filter((x): x is string => Boolean(x))
    : [];
  if (lines.length === 0) return null;
  return (
    <Card title={`Other ways to reach ${org.name}`}>
      <View style={{ gap: 4 }}>
        {lines.map((l) => (
          <Body key={l} selectable>
            {l}
          </Body>
        ))}
      </View>
    </Card>
  );
}
