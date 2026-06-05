import { SiteHeader } from '@/components/marketing/SiteHeader';

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Colored cards',
    items: [
      ['Numbers 0-9', 'Match by color or number. Play a pair (same color+number), a run of 3+ consecutive (e.g. 6-7-8), or three consecutive pairs - runs lock the next player to that color.'],
      ['+2 / +4', 'Start or extend a draw stack. The next player draws the running total unless they respond.'],
      ['Play again', 'Take another turn; your next card must match this card\'s color (or be another play-again).'],
      ['Skip', 'The next player loses their turn.'],
      ['Minus (-)', 'Optionally dump every card of this color from your hand.'],
    ],
  },
  {
    title: 'Black (colorless) cards',
    items: [
      ['+2 / +4 / +6 / +8 / +10', 'Bigger draw cards; stack onto a pending draw if your value is at least the current top.'],
      ['x2', 'Played with a draw card - doubles that card\'s contribution to the stack.'],
      ['÷2', 'Halve the pending stack, then draw the result.'],
      ['Duel (+4T)', 'Start a 1v1 with a chosen player until one of them draws.'],
      ['Bomb (++4)', 'Every other player draws 4 - but each may shield/counter to bounce 4 back to you.'],
      ['Reverse +N', 'Flip direction and make the previous player draw.'],
      ['Recycle', 'Copy the effect of the card beneath it.'],
      ['Eye / Swap / Steal / Gift', 'Peek a hand, swap hands, take a random card, or give a card.'],
      ['Draw-until-color', 'The next player draws until they hit your chosen color.'],
      ['Shield / Counter', 'On a draw stack: push it to the next player, or bounce it back to the previous one.'],
      ['Wild', 'Choose the active color.'],
    ],
  },
  {
    title: 'Key rules',
    items: [
      ['No finishing on black', 'You cannot win by playing a black/special card as your last card.'],
      ['Overload knockout', 'Reach more than 30 cards and you are eliminated to the audience (you can still watch and chat).'],
      ['Winning', 'First to empty their hand wins - or the last active player standing.'],
    ],
  },
];

export default function Rules() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <SiteHeader />
      <h1 className="mt-4 text-3xl font-black">House rules</h1>
      <p className="mt-2 text-muted-foreground">Every card count is tunable per room. Here is what each card does.</p>
      <div className="mt-6 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-xl font-bold">{s.title}</h2>
            <dl className="mt-3 space-y-3">
              {s.items.map(([name, desc]) => (
                <div key={name} className="rounded-lg border bg-card p-3">
                  <dt className="font-semibold">{name}</dt>
                  <dd className="text-sm text-muted-foreground">{desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </main>
  );
}
