"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";
import { chessProfileUrl } from "@/lib/chess/username";
import type { ProviderStatus } from "@/lib/chess/verification/types";
import { formatDateTime, formatRelative } from "@/lib/utils";

/** Failures that close the claim: the page re-renders without it, so the explanation must live outside the claim panel. */
const CLOSES_CLAIM = new Set([
  "chess_account_already_linked",
  "user_already_linked",
  "claim_expired",
  "claim_not_open",
]);

export interface ClaimView {
  status: "pending" | "needs_review";
  chess_username: string;
  verification_code: string | null;
  code_expires_at: string | null;
  attempts: number;
  last_checked_at: string | null;
  last_check_result: string | null;
  method: string;
}

/**
 * The whole Chess.com ownership flow in one component:
 *   enter username -> add code to your profile -> check -> (or) ask an administrator.
 * It states plainly which routes are available and never claims verification it has not done.
 */
export function ChessVerification({
  claim,
  eligible,
  providers,
}: {
  claim: ClaimView | null;
  eligible: boolean;
  providers: ProviderStatus[];
}) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { run, busy, error, clearError } = useAction();
  const profileCode = providers.find((p) => p.id === "profile_code");
  const oauth = providers.find((p) => p.id === "oauth");

  if (!eligible) {
    return (
      <Alert variant="info" title="Confirm you’re a student first">
        Chess.com verification starts once your college eligibility is verified.
      </Alert>
    );
  }

  if (claim?.status === "needs_review") {
    return (
      <div className="grid gap-3">
        <Alert
          variant="info"
          title={`Waiting for an administrator to verify @${claim.chess_username}`}
        >
          They’ll confirm you control the account and you’ll be notified. Until then you won’t
          appear on leaderboards or be able to play ranked college matches.
        </Alert>
        <div>
          <Button
            variant="outline"
            onClick={() =>
              void run("cancel", "/api/chess/claim", {
                method: "DELETE",
                success: "Verification cancelled",
              })
            }
            loading={busy === "cancel"}
          >
            Cancel and start over
          </Button>
        </div>
      </div>
    );
  }

  if (claim?.status === "pending" && claim.verification_code) {
    const code = claim.verification_code;
    return (
      <div className="grid gap-5">
        <ol className="grid gap-3 text-sm">
          <li className="flex gap-3">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs text-accent-foreground">
              1
            </span>
            <span>
              Open your Chess.com <strong>Settings → Profile</strong> (
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href={chessProfileUrl(claim.chess_username)}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{claim.chess_username} <ExternalLink className="size-3" aria-hidden />
              </a>
              ).
            </span>
          </li>
          <li className="grid gap-2">
            <span className="flex gap-3">
              <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs text-accent-foreground">
                2
              </span>
              <span>
                Add this code to your <strong>Location</strong> field (you can remove it
                afterwards):
              </span>
            </span>
            <span className="ml-9 flex items-center gap-2">
              <code className="rounded-md border bg-muted px-3 py-2 font-mono text-base font-semibold tracking-wide select-all">
                {code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Copy code"
                onClick={() => {
                  void navigator.clipboard.writeText(code).then(
                    () => toast.success("Code copied"),
                    () => toast.error("Couldn’t copy; select it manually"),
                  );
                }}
              >
                <Copy aria-hidden />
              </Button>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs text-accent-foreground">
              3
            </span>
            <span>
              Save, then press <strong>Check my profile</strong>.
            </span>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          This code is unique to you and expires{" "}
          {claim.code_expires_at ? formatDateTime(claim.code_expires_at) : "in 48 hours"}. We only
          read your public Chess.com profile. We never ask for your password.
        </p>

        {result ? <Alert variant="warning">{result}</Alert> : null}
        {error ? <Alert variant="danger">{error.message}</Alert> : null}
        {claim.last_checked_at && !result ? (
          <p className="text-xs text-muted-foreground">
            Last checked {formatRelative(claim.last_checked_at)} · {claim.attempts} attempt
            {claim.attempts === 1 ? "" : "s"}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {profileCode?.state === "available" ? (
            <Button
              loading={busy === "check"}
              onClick={async () => {
                setResult(null);
                const r = await run<{ verified: boolean; reason?: string; message?: string }>(
                  "check",
                  "/api/chess/claim/check",
                  { success: undefined },
                );
                if (r?.verified) toast.success("Chess.com account verified");
                else if (r && r.reason && CLOSES_CLAIM.has(r.reason))
                  toast.error(r.message ?? "Verification did not succeed.", { duration: 20_000 });
                else if (r) setResult(r.message ?? "Not verified yet.");
              }}
            >
              <Check aria-hidden /> Check my profile
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setShowReview((v) => !v)}>
            Ask an administrator instead
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void run("cancel", "/api/chess/claim", {
                method: "DELETE",
                success: "Verification cancelled",
              })
            }
            loading={busy === "cancel"}
          >
            Use a different username
          </Button>
        </div>
        {profileCode?.state !== "available" ? (
          <Alert variant="info">{profileCode?.description}</Alert>
        ) : (
          <p className="text-xs text-muted-foreground">{profileCode?.description}</p>
        )}

        {showReview ? (
          <form
            className="grid gap-3 rounded-lg border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run("review", "/api/chess/claim/review", {
                body: { note },
                success: "Sent to the administrators",
              });
            }}
          >
            <Field
              id={`${id}-note`}
              label="How can an administrator confirm this account is yours?"
              hint="For example: you can show them the account in person at the club, or the profile already shows the code but hasn’t refreshed."
              error={error?.fieldError("note")}
              required
            >
              {(a) => (
                <Textarea
                  {...a}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  required
                />
              )}
            </Field>
            <div>
              <Button type="submit" loading={busy === "review"}>
                Send for review
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        clearError();
        await run("start", "/api/chess/claim", {
          body: { username },
          success: "Verification started",
        });
      }}
    >
      <Field
        id={`${id}-user`}
        label="Chess.com username"
        hint="Your username or profile link, for example magnus_c or chess.com/member/magnus_c. Only you can link your account, and each account can belong to one member."
        error={
          error?.fieldError("username") ??
          (error && !error.fields.length ? error.message : undefined)
        }
        required
      >
        {(a) => (
          <Input
            {...a}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            required
          />
        )}
      </Field>
      <div>
        <Button type="submit" loading={busy === "start"}>
          Start verification
        </Button>
      </div>
      {oauth ? (
        <p className="text-xs text-muted-foreground">
          <strong>{oauth.label}:</strong> {oauth.description}
        </p>
      ) : null}
    </form>
  );
}
