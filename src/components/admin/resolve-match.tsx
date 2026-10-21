"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/forms/use-action";
import { AdminAction } from "@/components/admin/admin-action";

/** Moderator tools for one challenge that needs review. */
export function ResolveMatch({
  challengeId,
  challengerName,
  recipientName,
}: {
  challengeId: string;
  challengerName: string;
  recipientName: string;
}) {
  const id = useId();
  const [mode, setMode] = useState<"game" | "manual" | null>(null);
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [winner, setWinner] = useState("challenger");
  const [white, setWhite] = useState("challenger");
  const { run, busy, error } = useAction();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === "game" ? "default" : "outline"}
          onClick={() => setMode(mode === "game" ? null : "game")}
        >
          Pick the Chess.com game
        </Button>
        <Button
          size="sm"
          variant={mode === "manual" ? "default" : "outline"}
          onClick={() => setMode(mode === "manual" ? null : "manual")}
        >
          Enter result by hand
        </Button>
        <AdminAction
          label="Retry automatic check"
          payload={{ action: "retry_challenge_sync", challenge_id: challengeId }}
          needsReason={false}
          success="Queued for another automatic check"
        />
        <AdminAction
          label="Void"
          variant="destructive"
          title="Void this challenge?"
          description="It is closed with no result and nobody’s statistics change."
          payload={{ action: "void_challenge", challenge_id: challengeId }}
          success="Challenge voided"
        />
      </div>

      {mode ? (
        <form
          className="grid gap-3 rounded-lg border p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const body =
              mode === "game"
                ? { action: "resolve_with_game", challenge_id: challengeId, game_url: url, reason }
                : {
                    action: "manual_result",
                    challenge_id: challengeId,
                    game_url: url,
                    winner,
                    white_is_challenger: white === "challenger",
                    reason,
                  };
            const r = await run("resolve", "/api/admin", { body, success: "Result recorded" });
            if (r) setMode(null);
          }}
        >
          <p className="text-xs text-muted-foreground">
            {mode === "game"
              ? "Paste the Chess.com link of the correct game. It is looked up in both players’ archives and checked against the two players; the result comes from Chess.com’s own data."
              : "Last resort when the game cannot be found in the archives. This is recorded as moderator-entered and is not presented as verified by Chess.com data."}
          </p>
          <Field
            id={`${id}-u`}
            label="Chess.com game URL"
            error={error?.fieldError("game_url")}
            required
          >
            {(a) => (
              <Input
                {...a}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.chess.com/game/live/…"
                required
              />
            )}
          </Field>
          {mode === "manual" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`${id}-w`} label="Result">
                {(a) => (
                  <NativeSelect {...a} value={winner} onChange={(e) => setWinner(e.target.value)}>
                    <option value="challenger">{challengerName} won</option>
                    <option value="recipient">{recipientName} won</option>
                    <option value="draw">Draw</option>
                  </NativeSelect>
                )}
              </Field>
              <Field id={`${id}-c`} label="White pieces">
                {(a) => (
                  <NativeSelect {...a} value={white} onChange={(e) => setWhite(e.target.value)}>
                    <option value="challenger">{challengerName}</option>
                    <option value="recipient">{recipientName}</option>
                  </NativeSelect>
                )}
              </Field>
            </div>
          ) : null}
          <Field
            id={`${id}-r`}
            label={mode === "manual" ? "Evidence for this result" : "Why this game?"}
            hint="At least 10 characters. Recorded in the audit log."
            error={error?.fieldError("reason")}
            required
          >
            {(a) => (
              <Textarea
                {...a}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                required
              />
            )}
          </Field>
          {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
          <div>
            <Button type="submit" loading={busy === "resolve"}>
              Record result
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
