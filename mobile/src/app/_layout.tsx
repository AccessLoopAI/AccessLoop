// The app shell: one stack of screens, the same "Get help" link in the same place on every screen (WCAG 3.2.6),
// the one status announcer, and screen transitions turned off under Reduce Motion.
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { AnnouncerProvider, useReducedMotion } from "../a11y";
import { ReportDraftProvider } from "../report-draft";
import { MIN_TARGET, space, type, usePalette } from "../theme";

export default function RootLayout() {
  const p = usePalette();
  const reduced = useReducedMotion();
  return (
    <AnnouncerProvider>
      <ReportDraftProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: p.bg },
            headerTintColor: p.primary,
            headerTitleStyle: { color: p.ink, fontWeight: "700" },
            headerShadowVisible: false,
            headerBackTitle: "Back",
            contentStyle: { backgroundColor: p.bg },
            animation: reduced ? "none" : "default",
            headerRight: () => <HelpLink />,
          }}
        >
          <Stack.Screen name="index" options={{ title: "AccessLoop" }} />
          <Stack.Screen name="help" options={{ title: "Get help", headerRight: () => null }} />
          <Stack.Screen name="report/index" options={{ title: "Report a barrier" }} />
          <Stack.Screen name="report/what" options={{ title: "Report a barrier" }} />
          <Stack.Screen name="report/where" options={{ title: "Report a barrier" }} />
          <Stack.Screen name="report/follow-up" options={{ title: "Report a barrier" }} />
          <Stack.Screen name="report/review" options={{ title: "Report a barrier" }} />
          <Stack.Screen
            name="report/receipt"
            // The report is sent: no way back into the form from here (Done goes home).
            options={{ title: "Your receipt", headerBackVisible: false, gestureEnabled: false }}
          />
          <Stack.Screen name="reports/index" options={{ title: "My reports" }} />
          <Stack.Screen name="reports/[id]" options={{ title: "Your report" }} />
          <Stack.Screen name="check" options={{ title: "Check a report" }} />
          <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
        </Stack>
      </ReportDraftProvider>
    </AnnouncerProvider>
  );
}

/** "Get help", top right on every screen except Help itself. */
function HelpLink() {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={() => router.push("/help")}
      accessibilityRole="link"
      accessibilityLabel="Get help"
      accessibilityHint="Opens help about reporting a barrier and your receipt code."
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={6}
      style={[
        { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: "center", paddingHorizontal: space.sm },
        focused && { outlineColor: p.focus, outlineWidth: 3, outlineStyle: "solid" },
      ]}
    >
      <Text style={[type.bodyBold, { color: p.link, textDecorationLine: "underline" }]}>Get help</Text>
    </Pressable>
  );
}
