"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/forms/use-action";

export function RecoveryForm({ hasOpen }: { hasOpen: boolean }) {
  const id = useId();
  const [kind, setKind] = useState("change_username");
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const { run, busy, error } = useAction();
  if (hasOpen)
    return (
      <Alert variant="info" title="Recovery request open">
        An administrator will review it. You’ll be notified of the decision.
      </Alert>
    );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("recovery", "/api/recovery", {
          body: { kind, username, reason },
          success: "Request sent to the administrators",
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Your Chess.com link can’t be edited here. If you made a typo, renamed your Chess.com
        account, or someone linked your username before you, an administrator has to review it.
        Approval removes the wrong link, and then you add the right username yourself.
      </p>
      <Field id={`${id}-kind`} label="What do you need?">
        {(a) => (
          <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="change_username">
              Unlink my current Chess.com account so I can link a different one
            </option>
            <option value="transfer_username">
              A Chess.com username I own is linked to another (old) account
            </option>
          </NativeSelect>
        )}
      </Field>
      <Field
        id={`${id}-user`}
        label={
          kind === "change_username"
            ? "The Chess.com account you want to link next"
            : "The Chess.com username that is linked elsewhere"
        }
        error={error?.fieldError("username")}
        required
      >
        {(a) => (
          <Input
            {...a}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={200}
            required
          />
        )}
      </Field>
      <Field
        id={`${id}-reason`}
        label="What went wrong? How can an administrator tell the account is yours?"
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
      {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button type="submit" loading={busy === "recovery"}>
          Send request
        </Button>
      </div>
    </form>
  );
}
