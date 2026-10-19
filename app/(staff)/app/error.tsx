"use client";

// A staff page threw (a query failed, the database is down). Rendered inside the staff shell, so the header,
// nav, Sign out and "Get help" stay. Never shows the error itself (it could hold case data).
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

export default function StaffError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHeader
        title="Something went wrong"
        focusOnMount
        description="We could not load this page just now. Try again in a moment."
      />
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()} iconStart={<Icon icon={RotateCw} />}>
          Try again
        </Button>
        <ButtonLink href="/app" variant="secondary">
          Go to your start page
        </ButtonLink>
      </div>
    </>
  );
}
