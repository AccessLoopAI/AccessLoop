"use client";

// How a staff page answers its server actions (CLAUDE.md: after every submit move focus, announce, show it visibly).
// One provider per page keeps the last result in a line where the provider sits (right under the page header): the
// line is shown, focused and announced through the page's one StatusRegion. It lives in the provider (not in the
// form), so it survives the server re-render that follows an action, when the form that sent it may be gone.
// Field errors stay with their form (ErrorSummary + the field). The case page uses it through CaseFeedback.tsx.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { actionFailureMessage } from "@/lib/auth/signed-out";
import { Notice } from "./Notice";
import { useAnnounce } from "./StatusRegion";

export type FieldErrors = Record<string, string>;

export interface ActionAnswer {
  ok: boolean;
  message: string;
  at: number;
  fieldErrors?: FieldErrors;
}

interface Shown {
  tone: "success" | "danger";
  message: string;
  at: number;
}

interface Feedback {
  report: (r: Shown) => void;
  /** Remove the result line (a quiet success: the form's own success view replaces an earlier failure line). */
  clear: () => void;
  failedMessage: string;
}

const FeedbackContext = createContext<Feedback | null>(null);

const FAILED = "That didn't work just now. Nothing was saved. Please try again.";

export function ActionFeedbackProvider({
  children,
  testId = "action-result",
  failedMessage = FAILED,
  placement = "before",
  focusResult = true,
}: {
  children: ReactNode;
  /** data-testid of the result line. */
  testId?: string;
  /** Said when the action itself could not be reached (network, server error). */
  failedMessage?: string;
  /**
   * Where the line sits: "before" the form (a page's one result line under its header, the default) or "after" it
   * (a small form inside a long document, such as one section's text box in a report: the line appears under its
   * button, where the person already is).
   */
  placement?: "before" | "after";
  /**
   * Move focus to the line (default). Turn off when the button that sent the form stays on the page and focus should
   * stay on it (the line is still shown and announced through the StatusRegion).
   */
  focusResult?: boolean;
}) {
  const [last, setLast] = useState<Shown | null>(null);
  const announce = useAnnounce();
  const report = useCallback(
    (r: Shown) => {
      setLast(r);
      announce(r.message);
    },
    [announce],
  );
  const clear = useCallback(() => setLast(null), []);
  const value = useMemo(() => ({ report, clear, failedMessage }), [report, clear, failedMessage]);
  const line = <ResultLine last={last} testId={testId} focus={focusResult} after={placement === "after"} />;
  return (
    <FeedbackContext.Provider value={value}>
      {placement === "before" ? line : null}
      {children}
      {placement === "after" ? line : null}
    </FeedbackContext.Provider>
  );
}

/** The visible result of the last action. Focused when it changes; never a live region itself. */
function ResultLine({ last, testId, focus, after }: { last: Shown | null; testId: string; focus: boolean; after: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = last?.at;
  useEffect(() => {
    if (at && focus) ref.current?.focus();
  }, [at, focus]);
  if (!last) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid={testId}
      className={`${after ? "mt-4" : "mb-6"} rounded-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus`}
    >
      <Notice tone={last.tone}>{last.message}</Notice>
    </div>
  );
}

function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("Forms that use useFormAction must be inside <ActionFeedbackProvider>.");
  return ctx;
}

/**
 * Submit a form to its server action without a page load. Field errors come back to the form (so nothing typed
 * is lost: there is no automatic form reset); every other answer goes to the result line, unless `quietSuccess`
 * (the form shows its own success view, focused and announced by itself; the line is then cleared, so an earlier
 * failure never contradicts it).
 */
export function useFormAction<R extends ActionAnswer>(
  action: (form: FormData) => Promise<R>,
  opts: { onSuccess?: (r: R) => void; quietSuccess?: boolean } = {},
) {
  const { report, clear, failedMessage } = useFeedback();
  const { onSuccess, quietSuccess } = opts;
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<{ fields: FieldErrors; at: number } | null>(null);

  const submit = useCallback(
    (data: FormData) => {
      start(async () => {
        let r: R | undefined;
        try {
          r = await action(data);
        } catch (err) {
          // Signed out (proxy.ts answers in words): say so; anything else: the page's calm "didn't work" sentence.
          report({ tone: "danger", message: actionFailureMessage(err, failedMessage), at: Date.now() });
          return;
        }
        if (!r) return; // the action redirected: the router is already on its way
        if (!r.ok && r.fieldErrors && Object.keys(r.fieldErrors).length) {
          setErrors({ fields: r.fieldErrors, at: r.at });
          return;
        }
        setErrors(null);
        if (r.ok) onSuccess?.(r);
        // A quiet success clears an earlier failure line, so "Nothing was saved" never stays above the success view.
        if (r.ok && quietSuccess) clear();
        else report({ tone: r.ok ? "success" : "danger", message: r.message, at: r.at });
      });
    },
    [action, onSuccess, quietSuccess, report, clear, failedMessage],
  );

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (pending) return;
      submit(new FormData(e.currentTarget));
    },
    [pending, submit],
  );

  return { onSubmit, submit, pending, errors };
}

/** ErrorSummary items for a form's field errors, in the form's field order (`ids`: field name -> element id). */
export function fieldErrorItems(errors: { fields: FieldErrors } | null, ids: Record<string, string>) {
  if (!errors) return [];
  return Object.entries(ids)
    .filter(([name]) => errors.fields[name])
    .map(([name, id]) => ({ href: `#${id}`, message: errors.fields[name] }));
}
