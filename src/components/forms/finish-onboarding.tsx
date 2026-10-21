"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/forms/use-action";

export function FinishOnboarding({ canFinish, approved }: { canFinish: boolean; approved: boolean }) {
  const router = useRouter();
  const { run, busy, error } = useAction();
  return (
    <div className="grid gap-3">
      {!canFinish ? <Alert variant="info">Start the Chess.com step above first (you don’t have to finish verifying to complete registration).</Alert> : null}
      {canFinish && !approved ? <Alert variant="warning" title="You’ll be listed once verification is complete">You can finish registration now. You appear on leaderboards and can play ranked college matches once your student eligibility and Chess.com ownership are both verified.</Alert> : null}
      {error ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button
          size="lg"
          disabled={!canFinish}
          loading={busy === "finish"}
          onClick={async () => {
            const r = await run("finish", "/api/onboarding/complete", { success: "Registration complete", refresh: false });
            if (r) {
              router.push("/dashboard");
              router.refresh();
            }
          }}
        >
          Complete registration
        </Button>
      </div>
    </div>
  );
}
