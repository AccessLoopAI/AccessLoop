"use client";

// Shown only when the root layout itself fails. It replaces the root layout, so it brings its own <html lang>,
// <title> (global-error can't export metadata), styles, fonts, skip link, landmarks and the same "Get help" link
// (WCAG 3.1.1, 2.4.2, 3.2.6). No status region or other providers: nothing here announces anything. "Reload the
// page" does a full reload, which starts the root layout again (React renders this page, so scripts run).
import { RotateCw } from "lucide-react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkipLink } from "@/components/ui/SkipLink";
import { fontVariables } from "./font-faces";
import "./globals.css";

export default function GlobalError() {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <title>Something went wrong | AccessLoop</title>
        <SkipLink />
        <ReporterShell>
          <PageHeader title="Something went wrong" description="We could not load AccessLoop just now. Anything you already sent is safe." />
          <div className="grid justify-items-start gap-[var(--stack)]">
            <p className="max-w-[var(--measure)]">Try again in a moment.</p>
            <Button onClick={() => window.location.reload()} iconStart={<Icon icon={RotateCw} />}>
              Reload the page
            </Button>
          </div>
        </ReporterShell>
      </body>
    </html>
  );
}
