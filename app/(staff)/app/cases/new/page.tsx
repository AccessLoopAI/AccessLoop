import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { yearsBefore, zonedDate } from "@/lib/dates";
import { LogFeedbackForm } from "./LogFeedbackForm";

// Staff-logged intake (docs/domain.md §1.3 ACR s.9(3), §3, §4; CLAUDE.md "Routes": lead only, owners and auditors
// get 404). Feedback received by email, phone, mail, in person or another way enters the same loop as the web form.
// The receipt code is shown at most once, from the POST answer, never from this page's GET (a reload shows an empty
// form again).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Log feedback" };

export default async function LogFeedbackPage() {
  await requireStaff(["lead"]); // lead only: owners and auditors get 404
  const today = zonedDate(new Date());
  return (
    <>
      <PageHeader
        title="Log feedback received another way"
        description="For feedback that came by email, phone, mail or in person. It joins the same loop as your web form: names and contact details are hidden, and you check the redaction before anyone else reads it."
      />
      <LogFeedbackForm today={today} earliest={yearsBefore(today, 7)} />
    </>
  );
}
