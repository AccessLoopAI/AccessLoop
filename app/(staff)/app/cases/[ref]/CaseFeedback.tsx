"use client";

// How the case page answers every action: the generic staff pattern (components/ui/ActionFeedback.tsx) with the
// case page's own result line (data-testid="case-action-result") and its calm "didn't work" sentence. The line sits
// right under the page header, is focused and announced, and survives the refresh that removes the form that sent it.
// Field errors stay with their form (ErrorSummary + the field).
import type { ReactNode } from "react";
import { ActionFeedbackProvider, fieldErrorItems, useFormAction, type ActionAnswer } from "@/components/ui/ActionFeedback";
import { REFUSED } from "@/lib/cases/action-result";

export function CaseFeedbackProvider({ children }: { children: ReactNode }) {
  return (
    <ActionFeedbackProvider testId="case-action-result" failedMessage={REFUSED.failed}>
      {children}
    </ActionFeedbackProvider>
  );
}

/** Submit a case form to its server action without a page load (see useFormAction). */
export function useCaseAction<R extends ActionAnswer>(action: (form: FormData) => Promise<R>, onSuccess?: (r: R) => void) {
  return useFormAction(action, { onSuccess });
}

/** ErrorSummary items for a form's field errors, in the form's field order. */
export const summaryItems = fieldErrorItems;
