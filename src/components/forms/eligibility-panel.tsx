"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";

export function EligibilityPanel({ status, email, hasOpenRequest }: { status: "unverified" | "verified" | "revoked"; email: string | null; hasOpenRequest: boolean }) {
  const id = useId();
  const [identifier, setIdentifier] = useState("");
  const [note, setNote] = useState("");
  const { run, busy, error } = useAction();

  if (status === "verified") {
    return <Alert variant="success" title="You’re on the approved student list">Your Google account{email ? ` (${email})` : ""} matched the club’s list. Your email is never shown publicly.</Alert>;
  }
  if (status === "revoked") {
    return <Alert variant="danger" title="Your eligibility was withdrawn">An administrator removed your eligibility. Contact the club administrators if you think this is a mistake.</Alert>;
  }
  if (hasOpenRequest) {
    return <Alert variant="info" title="Waiting for an administrator">Your request is in the review queue. You’ll get a notification when it is decided. You can carry on with the other steps meanwhile.</Alert>;
  }
  return (
    <div className="grid gap-4">
      <Alert variant="warning" title="Your Google account isn’t on the approved student list yet">
        {email ? <>You signed in as <strong>{email}</strong>. </> : null}If you’re an MNNIT student using a personal email, ask for a manual review. An administrator will check your details.
      </Alert>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run("eligibility", "/api/eligibility/request", { body: { identifier, note: note || undefined }, success: "Request sent" });
        }}
      >
        <Field id={`${id}-who`} label="Roll number or college email" hint="So an administrator can match you to the student list." error={error?.fieldError("identifier")} required>
          {(a) => <Input {...a} value={identifier} onChange={(e) => setIdentifier(e.target.value)} maxLength={120} required />}
        </Field>
        <Field id={`${id}-note`} label="Anything else we should know? (optional)" error={error?.fieldError("note")}>
          {(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />}
        </Field>
        {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
        <div><Button type="submit" loading={busy === "eligibility"}>Request review</Button></div>
      </form>
    </div>
  );
}
