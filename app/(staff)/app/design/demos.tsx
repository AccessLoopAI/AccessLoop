"use client";

// Interactive demos for the hidden /app/design page only.
import { useState } from "react";
import { Megaphone, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { LoopTimeline } from "@/components/ui/Timeline";

export function AnnounceDemo() {
  const announce = useAnnounce();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        variant="secondary"
        iconStart={<Icon icon={Megaphone} />}
        onClick={() => announce("This is a test message from the live region.")}
      >
        Announce a test message
      </Button>
      <p className="text-small text-ink-muted">Screen readers read it out; nothing changes on screen.</p>
    </div>
  );
}

export function PendingDemo() {
  const [pending, setPending] = useState(false);
  const announce = useAnnounce();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        iconStart={<Icon icon={Send} />}
        pending={pending}
        onClick={() => {
          setPending(true);
          announce("Sending your answer…");
        }}
      >
        Send answer (demo)
      </Button>
      <Button variant="quiet" iconStart={<Icon icon={RotateCcw} />} onClick={() => setPending(false)}>
        Reset the demo
      </Button>
    </div>
  );
}

/** Signature moment 1: the reporter says "Yes, it works now" and the loop closes. */
export function VerifiedMomentDemo() {
  const [verified, setVerified] = useState(false);
  const [run, setRun] = useState(0);
  const announce = useAnnounce();
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <p className="font-bold">Status:</p>
        <StatusBadge key={`badge-${run}-${verified}`} status={verified ? "verified" : "retest_open"} celebrate={verified} size="lg" />
      </div>
      <LoopTimeline key={`loop-${run}-${verified}`} current={4} closed={verified} animateClose={verified} />
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            setRun((r) => r + 1);
            setVerified(true);
            announce("Thank you. It's now marked as fixed and confirmed by you.");
          }}
        >
          Play the verified moment
        </Button>
        <Button variant="secondary" onClick={() => setVerified(false)}>
          Reset the loop
        </Button>
      </div>
    </div>
  );
}
