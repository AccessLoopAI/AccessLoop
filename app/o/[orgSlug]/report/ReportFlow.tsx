"use client";

// The 4-step reporter form (docs/domain.md §4). One question per screen, no time limit, no modals, no
// auto-advance. After every step change, focus moves to the new step's heading (its h2), which starts with a visually
// hidden "Step N of 4: " (the visible step line above is hidden from screen readers, so it is said once). Errors show
// on the field and focus moves to it. The AI summary is fetched once (step 3 "Next") and never streamed.
// Step 3 is ONE question, "How can we follow up?" (Phase 7 T4.2); "Don't use AI on my report" is on the review.
// The answers are autosaved in this browser as the person types (lib/intake/draft.ts: in this tab only, or on this
// device when they tick "Keep this draft on this device"; never the email address, never the AI summary or its token)
// and come back after a reload, always on step 1, with a "Start over".
// From a location poster's QR code (?loc=, Phase 7 T4.5) the page passes `poster`: step 2 starts with that location's
// answer and "Where exactly?" filled in (only where the person has not answered yet), says so, and can be changed.
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Send, Quote } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextareaField, TextField } from "@/components/ui/Field";
import { Heading } from "@/components/ui/Heading";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { RedactedText } from "@/components/ui/RedactedText";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import {
  clearDraft,
  draftFromStored,
  EMPTY_DRAFT,
  hasContent,
  loadDraft,
  sameAnswers,
  withPlace,
  saveDraft,
  type DraftPlace,
  type ReportDraft,
  type StoredDraft,
} from "@/lib/intake/draft";
import { detectFrench } from "@/lib/intake/language";
import type { LocationPrefill } from "@/lib/locations/input";
import {
  DETAIL_MAX,
  EDITED_SUMMARY_MAX,
  EMAIL_MAX,
  EMAIL_PATTERN,
  FOLLOW_UP_OPTIONS,
  followUpChoice,
  LOCATION_OPTIONS,
  TEXT_MAX,
  type FollowUpValue,
  type LocationKindValue,
  type SummaryChoice,
} from "@/lib/intake/types";
import { AI_PAUSED_MESSAGE, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { previewReport, submitReport } from "./actions";

type Step = 1 | 2 | 3 | 4;
const STEPS = 4;

const STEP_TITLES: Record<Step, string> = {
  1: "What got in your way?",
  2: "Where did it happen?",
  3: "How can we follow up?",
  4: "Check your report",
};

/** Read at the start of each step's heading, where focus lands after a step change (never shown). */
function stepPrefix(step: Step): ReactNode {
  return <VisuallyHidden>{`Step ${step} of ${STEPS}: `}</VisuallyHidden>;
}

type Draft = ReportDraft;

/** How long typing pauses before the draft is saved. */
const AUTOSAVE_DELAY_MS = 300;

type ErrorKey = "text" | "where" | "detail" | "followUp" | "email" | "choice" | "edited" | "preview";
type Errors = Partial<Record<ErrorKey, string>>;

const ERROR_FOR: Partial<Record<keyof Draft, ErrorKey>> = {
  text: "text",
  locationKind: "where",
  locationDetail: "detail",
  followUp: "followUp",
  email: "email",
};

interface PreviewState {
  summary: string | null;
  token: string | null;
  /** The AI step did not give a summary (not the same as opting out). */
  failed: boolean;
  /** No AI ran because the hour's AI budget is spent (lib/rate-limit.ts): the review says so. */
  paused?: boolean;
}

const AI_DISCLOSURE = "An AI tool helps summarize your report. We remove names and contact details before staff see it.";
/** Step 3's notice. `aiWhere` (lib/public-info/ai-where.ts) says where the words go: Next sends them to the AI. */
const aiStep3 = (aiWhere: string) =>
  `${AI_DISCLOSURE} ${aiWhere} When you press Next, you can check its summary, or choose not to use AI.`;
const AI_OPT_OUT_HINT =
  "We delete the AI summary, and no AI is used on your report after this. A staff member reads your words and sorts your report.";
const NO_AI_STEP_3 =
  "We won't use AI on your report. A staff member will read it and remove names and contact details before others see it. You can change this on the next screen.";
const NO_AI_REVIEW = "You asked us not to use AI. A staff member will read your words.";
const SUMMARIZING = "Summarizing your report…";

const subscribeNever = () => () => {};

/**
 * Browser storage only exists in the browser: the server render (and hydration) start with an empty form. Only
 * when a draft is kept does the form mount once more, with it (so without a draft nothing is re-mounted, and
 * nothing typed during hydration can be lost). "Start over" mounts a fresh, empty form the same way.
 */
export function ReportFlow({
  orgSlug,
  orgName,
  poster = null,
  aiWhere,
  noscript,
  otherWays,
}: {
  orgSlug: string;
  orgName: string;
  /** The location of the poster the person scanned (?loc=, checked on the server inside this org), or null. */
  poster?: LocationPrefill | null;
  /** Where the words go when AI is on, for this copy (lib/public-info/ai-where.ts, from the server's env). */
  aiWhere: string;
  noscript?: ReactNode;
  /** "Other ways to reach {org}" (rendered by the page), under the form on every step. */
  otherWays?: ReactNode;
}) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [run, setRun] = useState(0);
  // The h1 stays the same on every step; the introduction (with the organization's name) shows on step 1 only, so
  // later steps start with their own question instead of the same four lines again (the form reports its step).
  const [firstStep, setFirstStep] = useState(true);
  const onStep = useCallback((step: Step) => setFirstStep(step === 1), []);
  // Read once per mount of the form (not on every render), so a later re-render can't swap the form under the
  // person's hands.
  const kept = useMemo(() => (hydrated && run === 0 ? loadDraft(orgSlug) : null), [hydrated, run, orgSlug]);
  const intro = `Tell ${orgName} what made something hard for you. There are 4 short steps. Take as long as you need, and you don't have to give your name.`;
  // A kept draft that already says where it happened wins over the poster (withPlace keeps its answer), so the
  // poster's sentences ("step 2 already says where", "We filled this in") show only when its place was filled in
  // (review finding, docs/decisions.md 2026-10-21). After "Start over" (run > 0, no kept draft) it is filled in again.
  const posterFilled = poster && !(kept && draftFromStored(kept.draft).locationKind) ? poster : null;
  return (
    <>
      <PageHeader
        title="Report a barrier"
        description={
          !firstStep ? undefined : posterFilled ? (
            <>
              <p>{intro}</p>
              <p className="mt-3">
                You came from the poster for <span lang={detectFrench(posterFilled.name)}>{posterFilled.name}</span>, so step 2 already
                says where it happened. You can change it.
              </p>
            </>
          ) : (
            intro
          )
        }
      />
      {noscript}
      <ReportForm
        key={run > 0 ? `run-${run}` : kept ? "kept" : "fresh"}
        orgSlug={orgSlug}
        orgName={orgName}
        poster={posterFilled}
        aiWhere={aiWhere}
        initial={kept}
        autosave={hydrated}
        startedOver={run > 0}
        onStartOver={() => setRun((n) => n + 1)}
        onStep={onStep}
        otherWays={otherWays}
      />
    </>
  );
}

interface ReportFormProps {
  orgSlug: string;
  orgName: string;
  /** The poster's place (?loc=) when it fills in step 2 (not when a kept draft already answered it), or null. */
  poster: LocationPrefill | null;
  /** Where the words go when AI is on (step 3's notice and the review's AI opt-out). */
  aiWhere: string;
  /** The draft kept in this browser and where it was kept, or null. */
  initial: { draft: StoredDraft; place: DraftPlace } | null;
  /** Save as the person types (off for the server-rendered first pass, which can't see the browser). */
  autosave: boolean;
  /** This form replaces one the person cleared with "Start over". */
  startedOver: boolean;
  onStartOver: () => void;
  /** Told the step before each paint (the page header shows its introduction on step 1 only). */
  onStep: (step: Step) => void;
  otherWays?: ReactNode;
}

function ReportForm({ orgSlug, orgName, poster, aiWhere, initial, autosave, startedOver, onStartOver, onStep, otherWays }: ReportFormProps) {
  const announce = useAnnounce();
  const [step, setStep] = useState<Step>(1);
  const [moved, setMoved] = useState(false);
  // A kept draft always starts on step 1 (no auto-advance), with what the person had typed and chosen. A poster's
  // place fills in only a "Where did it happen?" the person has not answered (their own answers always win).
  const [draft, setDraft] = useState<Draft>(() => withPlace(draftFromStored(initial?.draft ?? null), poster));
  /** "Keep this draft on this device": localStorage instead of this tab's sessionStorage. */
  const [keep, setKeep] = useState(initial?.place === "device");
  const [errors, setErrors] = useState<Errors>({});
  const [focusRequest, setFocusRequest] = useState<{ id: string; at: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** What the current preview was made from (report text, where, detail). */
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  /** A new summary replaced one the person had already answered (shown as a visible note on step 4). */
  const [summaryRenewed, setSummaryRenewed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [choice, setChoice] = useState<SummaryChoice | null>(null);
  const [edited, setEdited] = useState("");
  const [sendState, send, sending] = useActionState(submitReport, null);
  const sendErrorRef = useRef<HTMLDivElement>(null);
  /** How the last summary answer was chosen: an arrow key moves the choice, so focus must not jump away then. */
  const choiceByArrow = useRef(false);

  // Autosave: a short pause after the last change. Never on mount or when autosave turns on after hydration
  // (nothing changed yet), and the last pending change is written when the page goes away. The email address
  // is dropped by saveDraft itself.
  const place: DraftPlace = keep ? "device" : "tab";
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);
  const pendingSave = useRef<Draft | null>(null);
  const firstRun = useRef(true);
  useEffect(() => {
    if (!autosave) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    pendingSave.current = draft;
    const timer = window.setTimeout(() => {
      if (pendingSave.current) saveDraft(orgSlug, pendingSave.current, placeRef.current);
      pendingSave.current = null;
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autosave, draft, orgSlug]);
  useEffect(() => {
    if (!autosave) return;
    const flush = () => {
      if (pendingSave.current) saveDraft(orgSlug, pendingSave.current, placeRef.current);
      pendingSave.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [autosave, orgSlug]);

  /** Tick or untick "Keep this draft on this device": the draft moves there at once. */
  function changeKeep(next: boolean) {
    setKeep(next);
    if (!autosave) return;
    pendingSave.current = null;
    saveDraft(orgSlug, draft, next ? "device" : "tab");
  }

  /** "Start over": forget the kept draft and show an empty form on step 1. */
  function startOver() {
    pendingSave.current = null;
    clearDraft(orgSlug);
    announce("We cleared your answers. You can start again.");
    onStartOver();
  }

  // Errors: focus the field that needs fixing (its label, hint and error are read out).
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (sendState?.error) sendErrorRef.current?.focus();
  }, [sendState]);

  // Before paint, so the introduction above never shows for a frame on a later step.
  useLayoutEffect(() => onStep(step), [onStep, step]);

  // Words typed before React took over the page (a slow phone or connection: until then the form is the server's
  // HTML) are still in the box when it hydrates, but the next render would write the empty state back over them.
  // Keep them, once, on mount (found by the WebKit e2e run, Phase 7 T4.7). A kept draft or "Start over" mounts a new
  // box, which holds the draft or nothing, so this changes nothing then.
  useLayoutEffect(() => {
    const box = document.getElementById("report-text");
    const typed = box instanceof HTMLTextAreaElement ? box.value : "";
    // The DOM is the outside system here: it held the person's words before React did, and only before paint (a
    // layout effect) can they be read back before the next render clears the box.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (typed) setDraft((d) => (d.text ? d : { ...d, text: typed }));
  }, []);

  // The page title says which step this is (WCAG 2.4.2), once the person has moved between steps.
  useEffect(() => {
    if (moved) document.title = `Step ${step} of ${STEPS}: ${STEP_TITLES[step]} - Report a barrier to ${orgName} | AccessLoop`;
  }, [moved, step, orgName]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    // Once the person changes the answer, its error has done its job.
    const errorKey = ERROR_FOR[key];
    if (errorKey) setErrors((e) => (e[errorKey] ? { ...e, [errorKey]: undefined } : e));
  }

  function showErrors(next: Errors, focusId: string) {
    setErrors(next);
    setFocusRequest({ id: focusId, at: Date.now() });
  }

  function goTo(next: Step) {
    setErrors({});
    setStep(next);
    setMoved(true);
  }

  function submitWhat(e: FormEvent) {
    e.preventDefault();
    const text = draft.text.trim();
    if (!text) return showErrors({ text: "Tell us what got in your way. A few words is enough." }, "report-text");
    if (text.length > TEXT_MAX) {
      return showErrors({ text: `This is too long to send. Keep it under ${TEXT_MAX.toLocaleString("en-CA")} characters.` }, "report-text");
    }
    goTo(2);
  }

  function submitWhere(e: FormEvent) {
    e.preventDefault();
    if (!draft.locationKind) {
      return showErrors({ where: "Choose where it happened. If you are not sure, choose Somewhere else." }, "where-0");
    }
    if (draft.locationDetail.trim().length > DETAIL_MAX) {
      return showErrors({ detail: `Keep this under ${DETAIL_MAX} characters.` }, "where-detail");
    }
    goTo(3);
  }

  /** What a summary is made from: a change to any of these needs a new one. */
  const currentKey = () => JSON.stringify([draft.text.trim(), draft.locationKind, draft.locationDetail.trim()]);

  /**
   * Ask for the AI summary of the report as it is now. False when the person must stay where they are (too many
   * tries: the message is shown and focused, nothing is lost). A failed summary still goes on (the review shows
   * the person's own words, and sending works).
   */
  async function runPreview(key: string): Promise<boolean> {
    const hadAnswer = choice !== null;
    setChoice(null);
    setErrors({});
    setPreviewing(true);
    announce(SUMMARIZING);
    let result: PreviewState = { summary: null, token: null, failed: true };
    try {
      const r = await previewReport(orgSlug, {
        text: draft.text.trim(),
        locationKind: draft.locationKind,
        locationDetail: draft.locationDetail.trim(),
        aiOptOut: false,
      });
      if (r.ok) result = { summary: r.summary, token: r.token, failed: r.summary === null, paused: r.aiPaused === true };
      else if (r.rateLimited) {
        setPreviewing(false);
        announce(RATE_LIMITED_MESSAGE);
        showErrors({ preview: RATE_LIMITED_MESSAGE }, "preview-error");
        return false;
      }
    } catch {
      // Network or server trouble: the review shows the person's own words. Sending still works.
    }
    setPreview(result);
    setPreviewKey(key);
    // The report changed after the person had answered "Is this right?": say plainly that this is a new summary.
    setSummaryRenewed(hadAnswer && result.summary !== null);
    setEdited(result.summary ?? "");
    setPreviewing(false);
    return true;
  }

  async function submitFollowUp(e: FormEvent) {
    e.preventDefault();
    if (previewing) return;
    const next: Errors = {};
    let first: string | null = null;
    if (!draft.followUp) {
      next.followUp = "Choose one answer. The first two keep you anonymous.";
      first = "follow-up-0";
    } else if (draft.followUp === "email") {
      const email = draft.email.trim();
      if (!email) {
        next.email = "Enter your email address, or choose one of the other answers.";
        first = "reporter-email";
      } else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
        next.email = "Enter an email address like name@example.com.";
        first = "reporter-email";
      }
    }
    if (first) return showErrors(next, first);

    // Back, then Next, with nothing changed that the summary depends on: keep the summary, the answer and any
    // edit the person typed, and don't ask the AI again (WCAG 3.3.7 Redundant Entry). The token stays valid:
    // the server only uses it for exactly this text.
    const key = currentKey();
    if (key === previewKey && preview && !preview.failed) {
      goTo(4);
      return;
    }
    // "Don't use AI on my report" was chosen (on the review, or in a kept draft): no AI call at all.
    if (draft.aiOptOut) {
      if (key !== previewKey) {
        setPreview(null);
        setPreviewKey(null);
        setChoice(null);
        setSummaryRenewed(false);
        setEdited("");
      }
      goTo(4);
      return;
    }
    if (await runPreview(key)) goTo(4);
  }

  const hasSummary = Boolean(!draft.aiOptOut && preview?.summary);

  /** "Don't use AI on my report" on the review: the summary goes away (or comes back), and the change is said once. */
  async function changeAiOptOut(next: boolean) {
    update("aiOptOut", next);
    setErrors((e) => ({ ...e, choice: undefined, edited: undefined, preview: undefined }));
    if (next) {
      announce("We won't use AI on your report. A staff member will read your words.");
      return;
    }
    const key = currentKey();
    if (key === previewKey && preview) {
      announce(preview.summary ? "We will use the AI summary. Check it under We understood." : "We could not make a short summary this time. A staff member will read your words.");
      return;
    }
    // No summary was made for this report yet (AI was off when the person pressed Next): make it now.
    if (await runPreview(key)) {
      announce("We made a short summary. Check it under We understood.");
    }
  }

  /** "Yes, that's right" / "Change it" / "Keep my words only": one answer at a time; a pick clears the error. */
  function choose(next: SummaryChoice) {
    const byArrow = choiceByArrow.current;
    choiceByArrow.current = false;
    setChoice(next);
    setErrors((e) => ({ ...e, choice: undefined, edited: undefined }));
    if (next === "ai_edited") {
      // Phase 7 T4.3: the box for the person's own summary opens under "Change it". Chosen by click, tap or Space,
      // focus goes into it (its label and hint are read: the one announcement). Arrow keys only move the choice
      // through the answers, so then focus stays and the status region says it once.
      if (byArrow) announce("A box for your own summary is open under Change it.");
      else setFocusRequest({ id: "edited-summary", at: Date.now() });
    }
  }

  function sendReport(e: FormEvent) {
    e.preventDefault();
    if (sending || previewing) return;
    if (hasSummary && !choice) {
      return showErrors({ choice: "Choose one answer: Yes, that's right, Change it, or Keep my words only." }, "summary-choice-0");
    }
    if (hasSummary && choice === "ai_edited") {
      const t = edited.trim();
      if (!t) return showErrors({ edited: "Write a short summary, or choose Keep my words only." }, "edited-summary");
      if (t.length > EDITED_SUMMARY_MAX) {
        return showErrors({ edited: `Keep your summary under ${EDITED_SUMMARY_MAX} characters.` }, "edited-summary");
      }
    }
    if (!draft.followUp) return goTo(3); // never reached: step 3 checks it
    setErrors({});
    const follow = followUpChoice(draft.followUp);
    const payload = {
      orgSlug,
      text: draft.text.trim(),
      locationKind: draft.locationKind,
      locationDetail: draft.locationDetail.trim(),
      wantsRetest: follow.wantsRetest,
      emailChoice: follow.emailChoice,
      email: follow.emailChoice === "email" ? draft.email.trim() : "",
      aiOptOut: draft.aiOptOut,
      choice: hasSummary ? choice : ("reporter_words" as const),
      editedSummary: hasSummary && choice === "ai_edited" ? edited.trim() : "",
      token: draft.aiOptOut ? null : (preview?.token ?? null),
    };
    announce("Sending your report…");
    startTransition(() => send(payload));
  }

  const whereLabel = LOCATION_OPTIONS.find((o) => o.value === draft.locationKind)?.label ?? "";
  const followLabel = FOLLOW_UP_OPTIONS.find((o) => o.value === draft.followUp)?.label ?? "";
  const words = draft.text.trim();
  const detail = draft.locationDetail.trim();

  return (
    <div className="grid gap-6">
      {step === 1 && initial ? (
        // Where it is kept now (the person may have ticked or unticked "Keep this draft on this device" since).
        <Notice tone="info" title={keep ? "We kept what you wrote on this device." : "We kept what you wrote in this tab."}>
          <div className="grid justify-items-start gap-3">
            <p>
              {keep
                ? "You can carry on where you left off. If other people use this device, you can start over to clear it."
                : "You can carry on where you left off. We forget it when you close this tab."}
            </p>
            <Button variant="secondary" onClick={startOver} iconStart={<Icon icon={RotateCcw} />}>
              Start over
            </Button>
          </div>
        </Notice>
      ) : null}
      {step === 1 && startedOver && (poster ? sameAnswers(draft, withPlace(EMPTY_DRAFT, poster)) : !hasContent(draft)) ? (
        <Notice tone="success">We cleared your answers. This device doesn&rsquo;t keep them any more.</Notice>
      ) : null}
      {/* Hidden from screen readers: each step's heading says "Step N of 4" where focus lands. */}
      <StepIndicator current={step} total={STEPS} inHeading />

      {/* key={step}: every step mounts fresh, so its heading takes focus (focusOnMount). */}
      <div key={step}>
        {step === 1 ? (
          <form onSubmit={submitWhat} method="post" noValidate>
            <StepCard>
              <TextareaField
                id="report-text"
                name="text"
                label={STEP_TITLES[1]}
                labelHeading={{ level: 2, focusOnMount: moved || startedOver }}
                headingPrefix={stepPrefix(1)}
                hint="You can type or use your device's dictation."
                required
                error={errors.text}
                rows={7}
                value={draft.text}
                onChange={(e) => update("text", e.target.value)}
                spellCheck
              />
              <StepActions>
                <Button type="submit" size="lg" iconEnd={<Icon icon={ArrowRight} />}>
                  Next
                </Button>
              </StepActions>
            </StepCard>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={submitWhere} method="post" noValidate>
            <StepCard>
              <RadioGroup
                id="where"
                name="locationKind"
                legend={STEP_TITLES[2]}
                legendHeading={{ level: 2, focusOnMount: true }}
                headingPrefix={stepPrefix(2)}
                hint={
                  poster ? (
                    <>
                      We filled this in from the poster for <span lang={detectFrench(poster.name)}>{poster.name}</span>. You
                      can change it.
                    </>
                  ) : undefined
                }
                error={errors.where}
                value={draft.locationKind}
                onChange={(v) => update("locationKind", v as LocationKindValue)}
                options={LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
              />
              <TextField
                id="where-detail"
                name="locationDetail"
                label="Where exactly? (optional)"
                hint="For example, the name of the page, the street or the branch."
                error={errors.detail}
                value={draft.locationDetail}
                onChange={(e) => update("locationDetail", e.target.value)}
                autoComplete="off"
              />
              <StepActions>
                <Button type="submit" size="lg" iconEnd={<Icon icon={ArrowRight} />}>
                  Next
                </Button>
                <BackButton onClick={() => goTo(1)} />
              </StepActions>
            </StepCard>
          </form>
        ) : null}

        {step === 3 ? (
          <form onSubmit={submitFollowUp} method="post" noValidate>
            <StepCard>
              <RadioGroup
                id="follow-up"
                name="followUp"
                legend={STEP_TITLES[3]}
                legendHeading={{ level: 2, focusOnMount: true }}
                headingPrefix={stepPrefix(3)}
                hint="The first two answers keep you anonymous. Any answer is fine."
                error={errors.followUp}
                value={draft.followUp}
                onChange={(v) => update("followUp", v as FollowUpValue)}
                options={[
                  {
                    value: "none",
                    label: FOLLOW_UP_OPTIONS[0].label,
                    hint: "You still get a receipt code, to see where your report is.",
                  },
                  {
                    value: "code",
                    label: FOLLOW_UP_OPTIONS[1].label,
                    conditional: (
                      <p className="max-w-[var(--measure)]">
                        After you send this report, you get a receipt code. When a fix is ready, you use your code to
                        tell us if it works for you. You stay anonymous.
                      </p>
                    ),
                  },
                  {
                    value: "email",
                    label: FOLLOW_UP_OPTIONS[2].label,
                    conditional:
                      draft.followUp === "email" ? (
                        <div className="grid gap-4">
                          <p className="max-w-[var(--measure)]">
                            We email you that we got your report, and again when a fix is ready for you to check. You
                            also get a receipt code.
                          </p>
                          <TextField
                            id="reporter-email"
                            name="email"
                            type="email"
                            label="Email address"
                            hint="If you add your email, the organization's accessibility team can see it. It is never shown in public reports."
                            error={errors.email}
                            value={draft.email}
                            onChange={(e) => update("email", e.target.value)}
                            autoComplete="email"
                            spellCheck={false}
                            inputWidth="medium"
                          />
                        </div>
                      ) : undefined,
                  },
                ]}
              />

              <Notice tone="info">{draft.aiOptOut ? NO_AI_STEP_3 : aiStep3(aiWhere)}</Notice>

              {errors.preview ? (
                <div id="preview-error" tabIndex={-1} className="rounded-lg">
                  <Notice tone="warning" title="We could not go on just now">
                    {errors.preview}
                  </Notice>
                </div>
              ) : null}

              <StepActions>
                <Button type="submit" size="lg" pending={previewing} iconEnd={<Icon icon={ArrowRight} />}>
                  Next
                </Button>
                <BackButton onClick={() => goTo(2)} disabled={previewing} />
                {previewing ? <SummarizingLine /> : null}
              </StepActions>
            </StepCard>
          </form>
        ) : null}

        {step === 4 ? (
          <form onSubmit={sendReport} method="post" noValidate>
            <StepCard>
              <div className="grid gap-3">
                <Heading level={2} focusOnMount>
                  {stepPrefix(4)}
                  {STEP_TITLES[4]}
                </Heading>
                <p className="text-ink-muted">Read it over before you send it. You can still go back and change anything.</p>
                {hasSummary && summaryRenewed ? (
                  <Notice tone="info">You changed your report, so we wrote a new summary. Check it again.</Notice>
                ) : null}
              </div>

              <Card as="section" id="your-words" title="Your words" titleLevel={3} tone="inset">
                <blockquote className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                  <Icon icon={Quote} className="mt-1 text-accent-ink" />
                  {/* lang: French words are read with a French voice (WCAG 3.1.2). */}
                  <p className="whitespace-pre-wrap break-words" lang={detectFrench(words)}>
                    {words}
                  </p>
                </blockquote>
                <dl className="mt-5 grid gap-1 border-t border-border pt-4">
                  <dt className="text-small font-bold text-ink-muted">Where it happened</dt>
                  <dd className="m-0 wrap-anywhere">
                    {whereLabel}
                    {detail ? (
                      <>
                        {": "}
                        <span lang={detectFrench(detail)}>{detail}</span>
                      </>
                    ) : null}
                  </dd>
                </dl>
              </Card>

              {hasSummary && preview?.summary ? (
                <Card
                  as="section"
                  id="we-understood"
                  title="We understood"
                  titleLevel={3}
                  description="Our AI tool wrote this short version of your report. It leaves out names and contact details."
                >
                  <div className="grid gap-5">
                    <div lang={detectFrench(preview.summary)}>
                      <RedactedText text={preview.summary} className="font-display text-lead" />
                    </div>
                    {/* Phase 7 T4.3: one choice, so radio buttons in a fieldset (they were three aria-pressed
                        buttons). Arrow keys are told apart from a click or Space (see choose()). */}
                    <div
                      onKeyDownCapture={(e) => {
                        choiceByArrow.current = e.key.startsWith("Arrow");
                      }}
                      onPointerDownCapture={() => {
                        choiceByArrow.current = false;
                      }}
                    >
                      <RadioGroup
                        id="summary-choice"
                        name="summaryChoice"
                        legend="Is this right?"
                        error={errors.choice}
                        value={choice ?? ""}
                        onChange={(v) => choose(v as SummaryChoice)}
                        options={[
                          // Straight apostrophe: e2e/demo.spec.ts names this radio exactly.
                          { value: "ai_confirmed", label: "Yes, that's right" },
                          {
                            value: "ai_edited",
                            label: "Change it",
                            conditional:
                              choice === "ai_edited" ? (
                                <TextareaField
                                  id="edited-summary"
                                  name="editedSummary"
                                  label="Your summary"
                                  hint="Write it the way you want the team to read it. We take out contact details, and a staff member checks it for names."
                                  error={errors.edited}
                                  rows={4}
                                  value={edited}
                                  onChange={(e) => {
                                    setEdited(e.target.value);
                                    setErrors((x) => (x.edited ? { ...x, edited: undefined } : x));
                                  }}
                                />
                              ) : undefined,
                          },
                          {
                            value: "reporter_words",
                            label: "Keep my words only",
                            conditional: <p className="text-ink-muted">We will send your own words, just as you wrote them.</p>,
                          },
                        ]}
                      />
                    </div>
                  </div>
                </Card>
              ) : (
                <Notice tone="info">
                  {draft.aiOptOut
                    ? NO_AI_REVIEW
                    : previewing
                      ? "We are making a short summary of your report."
                      : preview?.paused
                        ? AI_PAUSED_MESSAGE
                        : "We could not make a short summary this time. A staff member will read your words."}
                </Notice>
              )}

              {/* Phase 7 T4.2: the AI choice moved here from step 3, next to what the AI wrote. Wave 4 item 1: its hint
                  starts with where the words go when AI is on (for this copy), so it is read with the checkbox. */}
              <div className="grid gap-3">
                <Checkbox
                  id="ai-opt-out"
                  name="aiOptOut"
                  label="Don't use AI on my report"
                  hint={
                    <>
                      <span id="ai-where" className="block">
                        {aiWhere}
                      </span>
                      <span className="mt-1 block">{AI_OPT_OUT_HINT}</span>
                    </>
                  }
                  checked={draft.aiOptOut}
                  onChange={(e) => void changeAiOptOut(e.target.checked)}
                />
                {previewing ? <SummarizingLine /> : null}
                {errors.preview ? (
                  <div id="preview-error" tabIndex={-1} className="rounded-lg">
                    <Notice tone="warning" title="We could not make a summary just now">
                      {errors.preview}
                    </Notice>
                  </div>
                ) : null}
              </div>

              {/* Framed like "Your words", so the page is a run of panels with one left edge (it was loose text
                  between two framed panels). */}
              <Card title="Your choices" titleLevel={3} tone="inset">
                {/* Each pair in its own div (valid in a dl): on phones a pair sits close together with more space
                    between pairs; from sm the pairs share two columns through subgrid. wrap-anywhere, so a long email
                    wraps at 320px instead of widening the page (overflow-wrap: break-word does not lower min-content). */}
                <dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-[max-content_minmax(0,1fr)]">
                  <div className="grid gap-y-1 sm:col-span-2 sm:grid-cols-subgrid">
                    <dt className="font-bold">How we follow up</dt>
                    <dd className="m-0">{followLabel}</dd>
                  </div>
                  {draft.followUp === "email" ? (
                    <div className="grid gap-y-1 sm:col-span-2 sm:grid-cols-subgrid">
                      <dt className="font-bold">Email</dt>
                      <dd className="m-0 wrap-anywhere">{draft.email.trim()}</dd>
                    </div>
                  ) : null}
                  <div className="grid gap-y-1 sm:col-span-2 sm:grid-cols-subgrid">
                    <dt className="font-bold">AI summary</dt>
                    <dd className="m-0">{draft.aiOptOut ? "Not used" : hasSummary ? "Used" : "Not used this time"}</dd>
                  </div>
                </dl>
              </Card>

              {sendState?.error ? (
                <div ref={sendErrorRef} tabIndex={-1} className="rounded-lg">
                  <Notice tone="danger" title="Your report was not sent">
                    {sendState.error}
                  </Notice>
                </div>
              ) : null}

              <StepActions>
                <Button type="submit" size="lg" pending={sending || previewing} iconStart={<Icon icon={Send} />}>
                  Send report
                </Button>
                <BackButton onClick={() => goTo(3)} disabled={sending || previewing} />
              </StepActions>
            </StepCard>
          </form>
        ) : null}
      </div>

      {/* On every step, after the step's own buttons: where the draft is kept, and the other ways to give feedback. */}
      <div className="grid gap-5 pt-2">
        <Checkbox
          id="keep-draft"
          name="keepDraft"
          label="Keep this draft on this device"
          hint="Only on your own device. We keep your answers here for 7 days, but never your email address. If you don't tick this, we forget them when you close this tab."
          checked={keep}
          onChange={(e) => changeKeep(e.target.checked)}
        />
        {otherWays}
      </div>
    </div>
  );
}

/** Not announced again: the status region already said "Summarizing your report…". */
function SummarizingLine() {
  // A real model can take a while (domain §6.1), and nothing on this page times out.
  return (
    <p className="text-ink-muted">
      <span className="font-bold">{SUMMARIZING}</span> It can take up to a minute.
    </p>
  );
}

/**
 * The raised panel that holds one step: the one thing that matters on the screen. On phones it lies flat on
 * the page (no frame, no padding), so the text keeps a comfortable width instead of nesting boxes.
 */
function StepCard({ children }: { children: ReactNode }) {
  return (
    <Card
      tone="raised"
      padding="none"
      className="grid gap-8 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none sm:p-[calc(var(--card-pad)*1.25)]"
    >
      {children}
    </Card>
  );
}

/** Next (or Send) first, so it sits in the same place on every screen; Back after it. */
function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-6">{children}</div>;
}

/** Back to the previous step. While a request runs it stays visible but does nothing (aria-disabled). */
function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="secondary"
      size="lg"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      iconStart={<Icon icon={ArrowLeft} />}
    >
      Back
    </Button>
  );
}
