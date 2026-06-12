'use client';
import type { Card } from '@last-card/engine';
import { GameCard } from '@/components/game/GameCard';
import { RULE_CARD_EXAMPLES } from '@/lib/card-examples';
import { useT } from '@/lib/i18n/context';

interface RuleItem {
  name: string;
  desc: string;
  cards?: Card[];
}

function RuleCards({ cards }: { cards?: Card[] }) {
  if (!cards?.length) return null;
  return (
    <div className="flex shrink-0 items-center -space-x-4">
      {cards.slice(0, 4).map((card) => (
        <GameCard key={card.id} card={card} />
      ))}
    </div>
  );
}

/** The House Rules card reference (grouped card list). Rendered inside the ?rules popup,
 *  which supplies the heading and intro. */
export function RulesReference() {
  const t = useT();
  const it = t.rules.items;
  const sections: { title: string; items: RuleItem[] }[] = [
    {
      title: t.rules.sectionColored,
      items: [
        { name: it.numbersName, desc: it.numbersDesc, cards: RULE_CARD_EXAMPLES.numbers },
        { name: it.coloredDrawsName, desc: it.coloredDrawsDesc, cards: RULE_CARD_EXAMPLES.coloredDraws },
        { name: it.playAgainName, desc: it.playAgainDesc, cards: RULE_CARD_EXAMPLES.playAgain },
        { name: it.skipName, desc: it.skipDesc, cards: RULE_CARD_EXAMPLES.skip },
        { name: it.minusName, desc: it.minusDesc, cards: RULE_CARD_EXAMPLES.minus },
      ],
    },
    {
      title: t.rules.sectionBlack,
      items: [
        { name: it.blackDrawsName, desc: it.blackDrawsDesc, cards: RULE_CARD_EXAMPLES.blackDraws },
        { name: it.multName, desc: it.multDesc, cards: RULE_CARD_EXAMPLES.mult },
        { name: it.divName, desc: it.divDesc, cards: RULE_CARD_EXAMPLES.div },
        { name: it.duelName, desc: it.duelDesc, cards: RULE_CARD_EXAMPLES.duel },
        { name: it.bombName, desc: it.bombDesc, cards: RULE_CARD_EXAMPLES.bomb },
        { name: it.reverseName, desc: it.reverseDesc, cards: RULE_CARD_EXAMPLES.reverseDraw },
        { name: it.recycleName, desc: it.recycleDesc, cards: RULE_CARD_EXAMPLES.recycle },
        { name: it.targetedName, desc: it.targetedDesc, cards: RULE_CARD_EXAMPLES.targeted },
        { name: it.drawUntilName, desc: it.drawUntilDesc, cards: RULE_CARD_EXAMPLES.drawUntilColor },
        { name: it.defenseName, desc: it.defenseDesc, cards: RULE_CARD_EXAMPLES.defense },
        { name: it.wildName, desc: it.wildDesc, cards: RULE_CARD_EXAMPLES.wild },
      ],
    },
    {
      title: t.rules.sectionKey,
      items: [
        { name: it.noBlackName, desc: it.noBlackDesc, cards: RULE_CARD_EXAMPLES.noBlackFinish },
        { name: it.overloadName, desc: it.overloadDesc },
        { name: it.winningName, desc: it.winningDesc },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <div key={s.title}>
          <h3 className="text-lg font-bold">{s.title}</h3>
          <dl className="mt-3 space-y-3">
            {s.items.map((item) => (
              <div key={item.name} className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
                <RuleCards cards={item.cards} />
                <div className="min-w-0">
                  <dt className="font-semibold">{item.name}</dt>
                  <dd className="text-sm text-muted-foreground">{item.desc}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
