import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/data/primitives";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the MNNIT Chess Community stores about its members, who can see it, and how to delete it.",
};

/** Plain-language summary of docs/PRIVACY.md. Keep the two in step. */
export default function PrivacyPage() {
  return (
    <div className="grid gap-10">
      <PageHeader
        title="Privacy"
        description="What this site keeps about you, who can see it, and how to remove it."
      />
      <div className="grid max-w-3xl gap-10 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-3xl [&_h2]:text-foreground [&_strong]:text-foreground [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-5">
        <section>
          <h2>What is public</h2>
          <ul>
            <li>
              Once you have joined: your <strong>display name</strong>, short bio, preferred time
              controls, your <strong>Chess.com username</strong>, your imported Chess.com ratings,
              and your college matches (players, result and a link to the game on Chess.com).
            </li>
            <li>
              Whether you are <strong>online</strong> is visible to signed-in members only, only
              while your tab is open, and not at all if you choose <strong>Invisible</strong>. It is
              never saved to a database.
            </li>
          </ul>
        </section>
        <section>
          <h2>What is private</h2>
          <ul>
            <li>
              Your <strong>Google email</strong> is used to sign you in. If the club requires a
              student list, it is also checked against that list. It is never shown on the site.
              Only administrators who manage members can see it.
            </li>
            <li>
              If the club requires a student list, any roll number or note you type into a review
              request is visible only to you and the administrators who manage members.
            </li>
            <li>
              We never ask for your Chess.com password. We only read your public Chess.com profile
              and games. The username you enter is not proven to be yours, and administrators can
              change it if it is wrong.
            </li>
          </ul>
        </section>
        <section>
          <h2>Administrators</h2>
          <p>
            A small number of administrators can verify students, resolve disputed results and
            suspend accounts. Every such action needs a written reason and is recorded in an audit
            log that cannot be edited from the site.
          </p>
        </section>
        <section>
          <h2>Deleting your account</h2>
          <p>
            <Link className="text-primary hover:underline" href="/settings">
              Settings → Delete my account
            </Link>{" "}
            removes your profile, Chess.com link, ratings, challenges and notifications and your
            sign-in. Verified match results stay in your opponents’ history and statistics so their
            record does not change; those records keep your Chess.com username and the link to the
            public game, but no longer point to a member profile, name or email. Nothing on
            Chess.com or Google is deleted.
          </p>
        </section>
        <section>
          <h2>Who else handles data</h2>
          <p>
            Supabase (database, sign-in and live updates), Google (sign-in), Chess.com (we read its
            public API) and the hosting provider. The site uses one sign-in cookie and a theme
            preference, with no analytics or advertising.
          </p>
        </section>
      </div>
    </div>
  );
}
