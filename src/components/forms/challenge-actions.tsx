"use client";

import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/forms/use-action";

/** Accept/decline for the recipient, cancel for the challenger. The database enforces who may. */
export function ChallengeActions({ id, direction, status, opponent }: { id: string; direction: "sent" | "received"; status: string; opponent: string }) {
  const { run, busy, error } = useAction();
  if (status !== "pending") return null;
  const act = (action: "accept" | "decline" | "cancel", success: string) =>
    run(action, `/api/challenges/${id}`, { method: "PATCH", body: { action }, success });

  if (direction === "received") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy === "accept"} onClick={() => void act("accept", `Accepted. Go play ${opponent} on Chess.com!`)}><Check aria-hidden /> Accept</Button>
        <Confirm title={`Decline ${opponent}’s challenge?`} body="They will be notified." confirmLabel="Decline" busy={busy === "decline"} onConfirm={() => act("decline", "Challenge declined")}>
          <Button size="sm" variant="outline"><X aria-hidden /> Decline</Button>
        </Confirm>
        {error ? <span role="alert" className="text-xs text-danger">{error.message}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Confirm title="Cancel this challenge?" body={`${opponent} will be told you cancelled it.`} confirmLabel="Cancel challenge" busy={busy === "cancel"} onConfirm={() => act("cancel", "Challenge cancelled")}>
        <Button size="sm" variant="outline">Cancel challenge</Button>
      </Confirm>
      {error ? <span role="alert" className="text-xs text-danger">{error.message}</span> : null}
    </div>
  );
}

function Confirm({ title, body, confirmLabel, busy, onConfirm, children }: { title: string; body: string; confirmLabel: string; busy: boolean; onConfirm: () => Promise<unknown>; children: React.ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{body}</AlertDialogDescription>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void onConfirm().then(() => toast.dismiss())}>{confirmLabel}</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
