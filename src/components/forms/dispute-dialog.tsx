"use client";

import { Flag } from "lucide-react";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/forms/use-action";

/** Transparent manual route when automation cannot (or wrongly did) identify the game. */
export function DisputeDialog({
  challengeId,
  opponent,
  verified,
}: {
  challengeId: string;
  opponent: string;
  verified: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState("");
  const { run, busy, error } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Flag aria-hidden /> {verified ? "Dispute this result" : "Report a problem"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(`dispute`, `/api/challenges/${challengeId}/dispute`, {
              body: { reason, game_url: url || undefined, proposed_result: result || undefined },
              success: "A moderator will review this",
            });
            if (r) setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {verified ? "Dispute the recorded result" : "Report a problem with this game"}
            </DialogTitle>
            <DialogDescription>
              {verified
                ? "The result stops counting toward statistics until a moderator rules on it."
                : "Use this if you played the game but it hasn’t been found, or the wrong game would be picked."}{" "}
              {opponent} is notified.
            </DialogDescription>
          </DialogHeader>
          <Field
            id={`${id}-r`}
            label="What happened?"
            hint="At least 10 characters."
            error={error?.fieldError("reason")}
            required
          >
            {(a) => (
              <Textarea
                {...a}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={1000}
                required
              />
            )}
          </Field>
          <Field
            id={`${id}-u`}
            label="Link to the Chess.com game (optional)"
            error={error?.fieldError("game_url")}
          >
            {(a) => (
              <Input
                {...a}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.chess.com/game/live/…"
              />
            )}
          </Field>
          <Field id={`${id}-w`} label="Who do you say won? (optional)">
            {(a) => (
              <NativeSelect {...a} value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="">Not sure / leave to the moderator</option>
                <option value="challenger">The player who sent the challenge</option>
                <option value="recipient">The player who received it</option>
                <option value="draw">Draw</option>
              </NativeSelect>
            )}
          </Field>
          {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === "dispute"}>
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
