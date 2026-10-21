import { AppShell } from "@/components/layout/app-shell";
import { requireOnboarded } from "@/server/auth";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  // Signed in AND onboarding finished; otherwise the user is sent to /login or /onboarding.
  const ctx = await requireOnboarded();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
