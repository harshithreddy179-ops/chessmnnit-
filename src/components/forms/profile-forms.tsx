"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { useAction } from "@/components/forms/use-action";
import { TIME_CLASSES, TIME_CLASS_LABEL, type TimeClass } from "@/lib/chess/constants";

export function ProfileForm({ displayName, bio }: { displayName: string; bio: string | null }) {
  const id = useId();
  const [name, setName] = useState(displayName);
  const [about, setAbout] = useState(bio ?? "");
  const { run, busy, error } = useAction();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("profile", "/api/profile", {
          method: "PATCH",
          body: { display_name: name, bio: about },
          success: "Profile saved",
        });
      }}
    >
      <Field
        id={`${id}-name`}
        label="Display name"
        hint="Shown publicly. Use the name classmates know you by (2–40 characters)."
        error={error?.fieldError("display_name")}
        required
      >
        {(a) => (
          <Input
            {...a}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="nickname"
            required
          />
        )}
      </Field>
      <Field
        id={`${id}-bio`}
        label="About you (optional)"
        hint={`${about.length}/280 — shown publicly`}
        error={error?.fieldError("bio")}
      >
        {(a) => (
          <Textarea
            {...a}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={280}
            rows={3}
          />
        )}
      </Field>
      {error && !error.fields.length ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button type="submit" loading={busy === "profile"}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

export function PreferencesForm({ preferred, open }: { preferred: TimeClass[]; open: boolean }) {
  const [classes, setClasses] = useState<TimeClass[]>(preferred);
  const [accepting, setAccepting] = useState(open);
  const { run, busy, error } = useAction();
  const toggle = (c: TimeClass) =>
    setClasses((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run("prefs", "/api/profile", {
          method: "PATCH",
          body: { preferred_time_classes: classes, open_to_challenges: accepting },
          success: "Preferences saved",
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Preferred time controls</legend>
        <p className="text-xs text-muted-foreground">Others can filter the player list by these.</p>
        <div className="flex flex-wrap gap-2">
          {TIME_CLASSES.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={classes.includes(c)}
                onChange={() => toggle(c)}
              />
              {TIME_CLASS_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Switch id="accepting" checked={accepting} onCheckedChange={setAccepting} />
        <Label htmlFor="accepting">I’m open to challenges</Label>
      </div>
      {error ? <Alert variant="danger">{error.message}</Alert> : null}
      <div>
        <Button type="submit" loading={busy === "prefs"}>
          Save preferences
        </Button>
      </div>
    </form>
  );
}
