"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api-client";

export function DeleteAccount() {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="destructive">Delete my account</Button></DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/api/account/delete", { body: { confirm: typed } });
              router.replace("/");
              router.refresh();
            } catch (err) {
              setError(err instanceof ApiClientError ? err.message : "Could not delete the account.");
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently removes your profile, Chess.com link, ratings, challenges and notifications. Match results you played stay in your opponents’ history, but without your identity. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <Field id={`${id}-c`} label="Type DELETE to confirm" required>
            {(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep my account</Button>
            <Button type="submit" variant="destructive" loading={busy} disabled={typed !== "DELETE"}>Delete permanently</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
