"use client";

// The /check form: one field, one button. Errors show on the field and in an ErrorSummary that takes focus;
// a connection problem shows a notice that takes focus. Every result is also said through the page's one
// status region. The code field allows paste and has no autocomplete or spellcheck (WCAG 3.3.8).
import { useActionState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { CHECK_MESSAGES, isFieldProblem } from "@/lib/check-code";
import { checkReceiptCode } from "./actions";

const FIELD_ID = "receipt-code";

export function CheckForm() {
  const [state, formAction] = useActionState(checkReceiptCode, null);
  const announce = useAnnounce();
  const noticeRef = useRef<HTMLDivElement>(null);
  const message = state ? CHECK_MESSAGES[state.problem] : null;
  const fieldError = state && isFieldProblem(state.problem) ? CHECK_MESSAGES[state.problem] : undefined;

  useEffect(() => {
    if (!state) return;
    announce(CHECK_MESSAGES[state.problem]);
    if (!isFieldProblem(state.problem)) noticeRef.current?.focus();
  }, [state, announce]);

  return (
    <form action={formAction} noValidate className="grid gap-[var(--stack)]">
      <ErrorSummary errors={fieldError ? [{ href: `#${FIELD_ID}`, message: fieldError }] : []} focusKey={state?.at} />
      {message && !fieldError ? (
        <div ref={noticeRef} tabIndex={-1} className="rounded-lg">
          <Notice tone="warning" title="We could not check your code">
            {message}
          </Notice>
        </div>
      ) : null}
      <TextField
        // A new result remounts the field with what was typed, so a typo can be fixed in place.
        key={state?.at ?? "first"}
        id={FIELD_ID}
        name="code"
        label="Your receipt code"
        hint="It has 16 letters and numbers, like ABCD-EFGH-JKMN-PQRS. You can paste it."
        error={fieldError}
        required
        defaultValue={state?.code ?? ""}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        translate="no"
        inputWidth="medium"
        inputClassName="font-mono tracking-[0.08em]"
      />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" iconStart={<Icon icon={Search} />}>
          Check
        </Button>
      </div>
    </form>
  );
}
