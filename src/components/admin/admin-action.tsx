"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";

type Payload = Record<string, unknown> & { action: string };

/**
 * Runs one administrator action. Sensitive actions ask for a reason, which is sent to the
 * server, shown to the affected person where relevant, and written to the audit log.
 */
export function AdminAction({
  label,
  title,
  description,
  payload,
  reasonLabel = "Reason",
  needsReason = true,
  variant = "outline",
  size = "sm",
  success = "Done",
  reasonKey = "reason",
  children,
}: {
  label: string;
  title?: string;
  description?: React.ReactNode;
  payload: Payload;
  reasonLabel?: string;
  needsReason?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  success?: string;
  reasonKey?: string;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy, error } = useAction();

  const go = async () => {
    const r = await run("admin", "/api/admin", {
      body: needsReason ? { ...payload, [reasonKey]: reason } : payload,
      success,
    });
    if (r) {
      setOpen(false);
      setReason("");
    } else if (!needsReason) {
      toast.error("That didn’t work. See the message and try again.");
    }
  };

  if (!needsReason) {
    return (
      <Button variant={variant} size={size} loading={busy === "admin"} onClick={go}>
        {label}
      </Button>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title ?? label}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          <Field
            id={`${id}-reason`}
            label={reasonLabel}
            hint="At least 5 characters. Recorded in the audit log."
            error={error?.fieldError(reasonKey)}
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={variant === "destructive" ? "destructive" : "default"}
              loading={busy === "admin"}
              disabled={reason.trim().length < 5}
            >
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
