"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";

/**
 * Links the Chess.com username the player types. There is no ownership proof, and the copy says
 * so: the link is public, one account belongs to one member, and administrators can change it.
 */
export function ChessLinkForm() {
  const id = useId();
  const [username, setUsername] = useState("");
  const { run, busy, error, clearError } = useAction();

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        clearError();
        const r = await run<{ chess_username: string; accountConfirmed: boolean }>(
          "link",
          "/api/chess/link",
          { body: { username } },
        );
        if (!r) return;
        if (r.accountConfirmed) toast.success(`Linked to @${r.chess_username}`);
        else
          toast.warning(
            `Linked to @${r.chess_username}, but Chess.com could not be reached to confirm the name. Check the spelling; an administrator can change it.`,
            { duration: 15_000 },
          );
      }}
    >
      <Field
        id={`${id}-user`}
        label="Chess.com username"
        hint="Your username or profile link, for example magnus_c or chess.com/member/magnus_c. It is shown on your public profile, and each account can belong to one member. If it is wrong, an administrator can change it."
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
        <Button type="submit" loading={busy === "link"}>
          Link my account
        </Button>
      </div>
    </form>
  );
}
