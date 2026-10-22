"use client";

import { Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api-client";

export interface TimeControlOption {
  time_control: string;
  label: string;
  time_class: string;
}

export type ChallengeAbility = "ok" | "signed_out" | "not_approved" | "self";

/** "Challenge" button that opens the time-control / message dialog. */
export function ChallengeButton({
  recipientId,
  recipientName,
  options,
  ability,
  size = "sm",
  defaultControl,
}: {
  recipientId: string;
  recipientName: string;
  options: TimeControlOption[];
  ability: ChallengeAbility;
  size?: "sm" | "md";
  defaultControl?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [control, setControl] = useState(
    defaultControl ??
      options.find((o) => o.time_control === "600")?.time_control ??
      options[0]?.time_control ??
      "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ability === "self") return null;
  if (ability === "signed_out") {
    return (
      <Button asChild size={size} variant="outline">
        <Link href="/login">
          <Swords aria-hidden /> Sign in to challenge
        </Link>
      </Button>
    );
  }
  if (ability === "not_approved") {
    return (
      <Button
        asChild
        size={size}
        variant="outline"
        title="Finish onboarding and Chess.com verification to play"
      >
        <Link href="/onboarding">
          <Swords aria-hidden /> Finish setting up to challenge
        </Link>
      </Button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("/api/challenges", {
        body: { recipient_id: recipientId, time_control: control, message: message.trim() || null },
      });
      toast.success(`Challenge sent to ${recipientName}`);
      setOpen(false);
      router.push(`/challenges/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not send the challenge.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <Swords aria-hidden /> Challenge
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Challenge {recipientName}</DialogTitle>
            <DialogDescription>
              They will be notified. If they accept, you both play on Chess.com. We check Chess.com
              for the finished game and record the result automatically.
            </DialogDescription>
          </DialogHeader>
          <Field id={`${uid}-tc`} label="Time control" required>
            {(aria) => (
              <NativeSelect
                {...aria}
                value={control}
                onChange={(e) => setControl(e.target.value)}
                required
              >
                {["bullet", "blitz", "rapid", "daily"].map((cls) => {
                  const group = options.filter((o) => o.time_class === cls);
                  return group.length ? (
                    <optgroup key={cls} label={cls[0]!.toUpperCase() + cls.slice(1)}>
                      {group.map((o) => (
                        <option key={o.time_control} value={o.time_control}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </NativeSelect>
            )}
          </Field>
          <Field
            id={`${uid}-msg`}
            label="Message (optional)"
            hint={`${message.length}/280`}
            error={error}
          >
            {(aria) => (
              <Textarea
                {...aria}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={280}
                rows={3}
                placeholder="Free after the lab at 6?"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!control}>
              Send challenge
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
