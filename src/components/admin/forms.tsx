"use client";

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
import { ROLE_LABEL } from "@/lib/admin-ui";

export function AllowlistForm({ canAddDomains }: { canAddDomains: boolean }) {
  const id = useId();
  const [kind, setKind] = useState<"email" | "domain">("email");
  const [values, setValues] = useState("");
  const [note, setNote] = useState("");
  const { run, busy, error } = useAction();
  // One bad line rejects the whole batch (so nothing is half-added); say exactly which lines.
  const problems =
    error?.fields
      .filter((f) => f.path === "values" || f.path.startsWith("values."))
      .map((f) => f.message) ?? [];
  const valuesError = problems.length
    ? `${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more` : ""}. Nothing was added.`
    : undefined;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const list = values
          .split(/[\s,;]+/)
          .map((v) => v.trim())
          .filter(Boolean);
        const r = await run<{ added: number }>("add", "/api/admin", {
          body: { action: "add_eligibility", kind, values: list, note: note || undefined },
          success: "Allowlist updated",
        });
        if (r) setValues("");
      }}
    >
      <Field id={`${id}-k`} label="What are you adding?">
        {(a) => (
          <NativeSelect
            {...a}
            value={kind}
            onChange={(e) => setKind(e.target.value as "email" | "domain")}
          >
            <option value="email">Student email addresses</option>
            {canAddDomains ? (
              <option value="domain">
                A whole email domain (e.g. mnnit.ac.in) — broad, super admin only
              </option>
            ) : null}
          </NativeSelect>
        )}
      </Field>
      <Field
        id={`${id}-v`}
        label={
          kind === "email"
            ? "Emails (paste a list: one per line, or separated by commas)"
            : "Domain"
        }
        hint={
          kind === "domain"
            ? "Anyone with a verified Google account on this domain becomes eligible. Only add a domain the institute controls."
            : "Up to 1000 at a time."
        }
        error={valuesError}
        required
      >
        {(a) => (
          <Textarea
            {...a}
            value={values}
            onChange={(e) => setValues(e.target.value)}
            rows={kind === "email" ? 6 : 2}
            required
          />
        )}
      </Field>
      <Field id={`${id}-n`} label="Note (optional)" error={error?.fieldError("note")}>
        {(a) => (
          <Input
            {...a}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="e.g. 2026 batch list from the department"
          />
        )}
      </Field>
      {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button type="submit" loading={busy === "add"}>
          Add to allowlist
        </Button>
      </div>
    </form>
  );
}

export function GrantRoleForm() {
  const id = useId();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("verification_admin");
  const [reason, setReason] = useState("");
  const { run, busy, error } = useAction();
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("grant", "/api/admin", {
          body: { action: "set_role", user_id: userId.trim(), role, grant: true, reason },
          success: "Role granted",
        });
        if (r) {
          setUserId("");
          setReason("");
        }
      }}
    >
      <Field
        id={`${id}-u`}
        label="User ID"
        hint="Copy it from the user’s page under Users. The person must have signed in at least once."
        error={error?.fieldError("user_id")}
        required
      >
        {(a) => (
          <Input
            {...a}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="font-mono"
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        )}
      </Field>
      <Field id={`${id}-r`} label="Role">
        {(a) => (
          <NativeSelect {...a} value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id={`${id}-why`} label="Reason" error={error?.fieldError("reason")} required>
        {(a) => (
          <Input
            {...a}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
        )}
      </Field>
      {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button type="submit" loading={busy === "grant"}>
          Grant role
        </Button>
      </div>
    </form>
  );
}

export function SettingForm({
  settingKey,
  value,
  description,
}: {
  settingKey: string;
  value: unknown;
  description: string;
}) {
  const id = useId();
  const kind =
    typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
  const [draft, setDraft] = useState(String(value));
  const [reason, setReason] = useState("");
  const { run, busy, error } = useAction();
  const parsed = kind === "boolean" ? draft === "true" : kind === "number" ? Number(draft) : draft;
  return (
    <form
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("save", "/api/admin", {
          body: { action: "update_setting", key: settingKey, value: parsed, reason },
          success: "Setting saved",
        });
        if (r) setReason("");
      }}
    >
      <div className="grid gap-0.5">
        <label htmlFor={`${id}-v`} className="font-mono text-sm font-medium">
          {settingKey}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {kind === "boolean" ? (
        <NativeSelect id={`${id}-v`} value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </NativeSelect>
      ) : (
        <Input
          id={`${id}-v`}
          type={kind === "number" ? "number" : "text"}
          min={kind === "number" ? 0 : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          required
        />
      )}
      <Input
        aria-label={`Reason for changing ${settingKey}`}
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        required
      />
      <Button
        type="submit"
        size="sm"
        loading={busy === "save"}
        disabled={reason.trim().length < 5 || draft === String(value)}
      >
        Save
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger sm:col-span-4">
          {error.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Sets or replaces a player's Chess.com account: the one tool for every "something went wrong"
 * case (a typo, a renamed account, someone who linked another person's username).
 */
export function SetChessLinkButton({
  userId,
  current,
}: {
  userId: string;
  current: string | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const { run, busy, error, clearError } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clearError();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {current ? "Change Chess.com account" : "Set Chess.com account"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run("set-link", "/api/admin", {
              body: { action: "set_chess_link", user_id: userId, username, reason },
              success: "Chess.com account updated",
            });
            if (r) {
              setOpen(false);
              setUsername("");
              setReason("");
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {current ? `Replace @${current}` : "Set the Chess.com account"}
            </DialogTitle>
            <DialogDescription>
              The player’s old link (if any) is archived. If another member currently holds this
              username, they are unlinked and notified. Both people are told what changed.
            </DialogDescription>
          </DialogHeader>
          <Field
            id={`${id}-user`}
            label="Chess.com username"
            hint="Username or profile link."
            error={error?.fieldError("username")}
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
          <Field
            id={`${id}-reason`}
            label="Reason"
            hint="At least 5 characters. Shown to the player and recorded in the audit log."
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy === "set-link"}
              disabled={!username.trim() || reason.trim().length < 5}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
