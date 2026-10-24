// Accessibility plumbing shared by every screen: moving focus to a heading, the one status announcer, and the
// reduced-motion setting. VoiceOver/TalkBack test steps for all of it are in mobile/A11Y-TESTING.md.
import { useFocusEffect } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { AccessibilityInfo, findNodeHandle, Platform, StyleSheet, Text, View } from "react-native";

/* ------------------------------------------------------------------ reduced motion */

// One app-wide value, read once when the app starts and kept up to date, so a component that appears later (the
// verified badge) knows the setting at once instead of starting from "motion allowed" and finding out a moment
// later. Until the system has answered, motion counts as reduced: the calmer choice.
let reducedNow = true;
let watching = false;
const reducedListeners = new Set<() => void>();

function setReducedNow(value: boolean) {
  if (value === reducedNow) return;
  reducedNow = value;
  for (const listener of reducedListeners) listener();
}

function subscribeReduced(listener: () => void): () => void {
  if (!watching) {
    watching = true;
    // If the system can't say, motion stays off. The listener lives as long as the app.
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedNow, () => {});
    AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedNow);
  }
  reducedListeners.add(listener);
  return () => {
    reducedListeners.delete(listener);
  };
}

/** The system's Reduce Motion (iOS) / Remove animations (Android) / prefers-reduced-motion (web) setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => reducedNow,
    () => true,
  );
}

/* ------------------------------------------------------------------ moving focus */

type Focusable = { focus?: () => void } | null;

/**
 * Move the screen reader's focus (and, on the web, keyboard focus) to an element: a step's heading after the
 * step changes, a field after an error. Native: sendAccessibilityEvent(ref, "focus"), the New Architecture form
 * of AccessibilityInfo.setAccessibilityFocus (deprecated in React Native 0.88), with the old call as a fallback.
 * Web: element.focus() (the heading carries tabIndex -1).
 */
export function moveFocus(ref: RefObject<unknown>): void {
  const node = ref.current;
  if (!node) return;
  if (Platform.OS === "web") {
    (node as Focusable)?.focus?.();
    return;
  }
  try {
    AccessibilityInfo.sendAccessibilityEvent(node as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0], "focus");
  } catch {
    const tag = findNodeHandle(node as Parameters<typeof findNodeHandle>[0]);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  }
}

/**
 * Each time this screen comes into view (pushed, or returned to with Back), move focus to `ref`, usually the
 * screen's h2. Native waits for the screen transition, or VoiceOver puts its focus on the Back button after us.
 */
export function useFocusOnScreen(ref: RefObject<unknown>, enabled = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const delay = Platform.OS === "web" ? 50 : 600;
      const timer = setTimeout(() => moveFocus(ref), delay);
      return () => clearTimeout(timer);
    }, [ref, enabled]),
  );
}

/** Focus `ref` whenever `key` changes to a new non-null value (an error appears, an answer is saved). */
export function useFocusWhen(ref: RefObject<unknown>, key: unknown): void {
  const last = useRef<unknown>(null);
  useEffect(() => {
    if (key == null || key === last.current) return;
    last.current = key;
    const timer = setTimeout(() => moveFocus(ref), Platform.OS === "web" ? 0 : 150);
    return () => clearTimeout(timer);
  }, [ref, key]);
}

/* ------------------------------------------------------------------ the one status announcer */

type Announce = (message: string) => void;
const AnnounceContext = createContext<Announce>(() => {});

/**
 * One polite status region for the whole app (like the web's role="status"). Native: the screen reader's
 * announcement API. Web: a visually hidden aria-live region. Never used for AI output, never for every keystroke.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce = useCallback<Announce>((text) => {
    if (Platform.OS === "web") {
      // Clear first, so the same sentence twice is still read.
      setMessage("");
      setTimeout(() => setMessage(text), 50);
    } else {
      AccessibilityInfo.announceForAccessibility(text);
    }
  }, []);
  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      {Platform.OS === "web" ? (
        <View style={styles.visuallyHidden} accessibilityLiveRegion="polite" role="status">
          <Text>{message}</Text>
        </View>
      ) : null}
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

const styles = StyleSheet.create({
  // Off-screen, not transparent: still in the accessibility tree, never seen.
  visuallyHidden: {
    position: "absolute",
    left: -10000,
    top: 0,
    width: 1,
    height: 1,
    overflow: "hidden",
  },
});
