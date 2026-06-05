import { SiteHeader } from '@/components/marketing/SiteHeader';

export default function About() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <SiteHeader />
      <article className="mt-4 space-y-4">
        <h1 className="text-3xl font-black">About</h1>
        <p className="text-muted-foreground">
          UNO Infinity is a real-time, server-authoritative multiplayer card game. A pure TypeScript
          rule engine is the single source of truth; Cloud Functions validate every move against secret
          state, so hands stay private and the rules are enforced on the server - not the client.
        </p>
        <p className="text-muted-foreground">
          Built with Next.js, Firebase Realtime Database, Auth, and Cloud Functions. Play anonymously
          with a nickname, or sign in with Google to keep your identity across sessions.
        </p>
      </article>
    </main>
  );
}
