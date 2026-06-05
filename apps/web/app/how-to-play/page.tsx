import Link from 'next/link';
import { SiteHeader } from '@/components/marketing/SiteHeader';

export default function HowToPlay() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <SiteHeader />
      <article className="prose-invert mt-4 space-y-4">
        <h1 className="text-3xl font-black">How to play</h1>
        <p className="text-muted-foreground">
          UNO Infinity is an expanded take on UNO for 2-10 players. Match the discard pile by
          <strong> color</strong> or <strong>type/number</strong>, empty your hand to win - but mind the
          extra cards that can swing a game in one turn.
        </p>
        <ol className="list-decimal space-y-2 pl-6 text-muted-foreground">
          <li><strong>Create or join a room.</strong> The host tunes the deck, shares the 4-letter code, and can add bots to fill seats.</li>
          <li><strong>On your turn</strong>, play a matching card (or a pair/run/three-consecutive-pairs of the same color), or draw.</li>
          <li><strong>Draw cards stack.</strong> A +N passes a growing penalty to the next player, who can stack a bigger draw, shield/counter it, halve it with &divide;2, or draw the lot.</li>
          <li><strong>Special cards</strong> let you duel 1v1, bomb everyone, peek/steal/swap/gift hands, recycle the last effect, and more.</li>
          <li><strong>You cannot finish on a black card</strong>, and anyone whose hand passes 30 cards is knocked out into the audience.</li>
          <li><strong>First to empty their hand wins</strong> (or the last player standing).</li>
        </ol>
        <p><Link href="/rules" className="font-semibold text-[#f4c430] hover:underline">See the full house rules &rarr;</Link></p>
      </article>
    </main>
  );
}
