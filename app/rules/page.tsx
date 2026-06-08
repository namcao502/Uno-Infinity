import type { Card } from '@last-card/engine';
import { GameCard } from '@/components/game/GameCard';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { RULE_CARD_EXAMPLES } from '@/lib/card-examples';

interface RuleItem {
  name: string;
  desc: string;
  cards?: Card[];
}

const SECTIONS: { title: string; items: RuleItem[] }[] = [
  {
    title: 'Colored cards',
    items: [
      {
        name: 'Numbers 0-9',
        desc: 'Match by color or number. Play a pair (same color+number), a run of 3+ consecutive (e.g. 6-7-8), or three consecutive pairs - runs lock the next player to that color.',
        cards: RULE_CARD_EXAMPLES.numbers,
      },
      {
        name: '+2 / +4',
        desc: 'Start or extend a draw stack. Colored draw cards can stack across colors when the value is equal or higher.',
        cards: RULE_CARD_EXAMPLES.coloredDraws,
      },
      {
        name: 'Play again',
        desc: 'Take another turn; your next card must match this card\'s color (or be another play-again).',
        cards: RULE_CARD_EXAMPLES.playAgain,
      },
      {
        name: 'Skip',
        desc: 'The next player loses their turn.',
        cards: RULE_CARD_EXAMPLES.skip,
      },
      {
        name: 'Minus (-)',
        desc: 'Optionally dump every card of this color from your hand.',
        cards: RULE_CARD_EXAMPLES.minus,
      },
    ],
  },
  {
    title: 'Black (colorless) cards',
    items: [
      {
        name: '+2 / +4 / +6 / +8 / +10',
        desc: 'Bigger draw cards; stack onto colored or black pending draws if your value is equal or higher. Once black is on top, only black draw cards can stack.',
        cards: RULE_CARD_EXAMPLES.blackDraws,
      },
      {
        name: 'x2',
        desc: 'Played with a draw card - doubles that card\'s contribution to the stack.',
        cards: RULE_CARD_EXAMPLES.mult,
      },
      {
        name: '/2',
        desc: 'Halve the pending stack, then draw the result.',
        cards: RULE_CARD_EXAMPLES.div,
      },
      {
        name: 'Duel (+4T)',
        desc: 'Start a 1v1 with a chosen player until one of them draws.',
        cards: RULE_CARD_EXAMPLES.duel,
      },
      {
        name: 'Bomb (++4)',
        desc: 'Every other player draws 4 - but each may shield/counter to bounce 4 back to you.',
        cards: RULE_CARD_EXAMPLES.bomb,
      },
      {
        name: 'Reverse +N',
        desc: 'Flip direction and make the previous player draw.',
        cards: RULE_CARD_EXAMPLES.reverseDraw,
      },
      {
        name: 'Recycle',
        desc: 'Copy the effect of the card beneath it.',
        cards: RULE_CARD_EXAMPLES.recycle,
      },
      {
        name: 'Eye / Swap / Steal / Gift',
        desc: 'Peek a hand, swap hands, take a random card, or give a card.',
        cards: RULE_CARD_EXAMPLES.targeted,
      },
      {
        name: 'Draw-until-color',
        desc: 'The next player draws until they hit your chosen color.',
        cards: RULE_CARD_EXAMPLES.drawUntilColor,
      },
      {
        name: 'Shield / Counter',
        desc: 'On a draw stack: push it to the next player, or bounce it back to the previous one.',
        cards: RULE_CARD_EXAMPLES.defense,
      },
      {
        name: 'Wild',
        desc: 'Choose the active color.',
        cards: RULE_CARD_EXAMPLES.wild,
      },
    ],
  },
  {
    title: 'Key rules',
    items: [
      {
        name: 'No finishing on black',
        desc: 'You cannot win by playing a black/special card as your last card.',
        cards: RULE_CARD_EXAMPLES.noBlackFinish,
      },
      {
        name: 'Overload knockout',
        desc: 'Reach more than 30 cards and you are eliminated to the audience (you can still watch and chat).',
      },
      {
        name: 'Winning',
        desc: 'First to empty their hand wins - or the last active player standing.',
      },
    ],
  },
];

function RuleCards({ cards }: { cards?: Card[] }) {
  if (!cards?.length) return null;
  return (
    <div className="flex min-w-24 shrink-0 items-center -space-x-3 sm:min-w-32">
      {cards.slice(0, 4).map((card) => (
        <div key={card.id} className="scale-90">
          <GameCard card={card} small />
        </div>
      ))}
    </div>
  );
}

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
              {s.items.map((item) => (
                <div key={item.name} className="flex gap-3 rounded-lg border bg-card p-3">
                  <RuleCards cards={item.cards} />
                  <div className="min-w-0">
                    <dt className="font-semibold">{item.name}</dt>
                    <dd className="text-sm text-muted-foreground">{item.desc}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </main>
  );
}
