import type { Card, CardKind } from '@uno/engine';

export interface CardInfo {
  /** Tiny label shown under the glyph on the card face ('' = none). */
  short: string;
  /** Full card name for the inspect popover. */
  name: string;
  /** What the card does, for the inspect popover. Wording mirrors app/rules. */
  effect: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const KIND_INFO: Record<Exclude<CardKind, 'number' | 'draw' | 'reverseDraw'>, CardInfo> = {
  mult: { short: 'x2', name: 'Times two (x2)', effect: 'Play with a draw card to double that card\'s contribution to the draw stack.' },
  div: { short: 'Halve', name: 'Divide by two', effect: 'Halve the pending draw stack, then draw the result yourself.' },
  skip: { short: 'Skip', name: 'Skip', effect: 'The next player loses their turn.' },
  playAgain: { short: 'Again', name: 'Play again', effect: 'Take another turn. Your next card must match this card\'s color (or be another play-again).' },
  minus: { short: 'Minus', name: 'Minus', effect: 'Optionally dump every card of this color from your hand.' },
  duel: { short: 'Duel', name: 'Duel', effect: 'Start a 1v1 with a chosen player until one of them draws.' },
  bomb: { short: 'Bomb', name: 'Bomb', effect: 'Every other player draws 4 - each may shield or counter to bounce 4 back to you.' },
  recycle: { short: 'Recycle', name: 'Recycle', effect: 'Copy the effect of the card beneath it on the pile.' },
  eye: { short: 'Eye', name: 'Eye peek', effect: 'Secretly look at a chosen player\'s hand.' },
  swap: { short: 'Swap', name: 'Swap hands', effect: 'Swap your entire hand with a chosen player.' },
  steal: { short: 'Steal', name: 'Steal', effect: 'Take a random card from a chosen player.' },
  gift: { short: 'Gift', name: 'Gift', effect: 'Give one of your cards to a chosen player.' },
  drawUntilColor: { short: 'Draw color', name: 'Draw until color', effect: 'The next player draws until they hit your chosen color.' },
  shield: { short: 'Shield', name: 'Shield', effect: 'On a draw stack: push the whole stack on to the next player.' },
  counter: { short: 'Counter', name: 'Counter', effect: 'On a draw stack: bounce the whole stack back to the previous player.' },
  wild: { short: 'Wild', name: 'Wild', effect: 'Choose the active color.' },
};

export function cardInfo(card: Card): CardInfo {
  if (card.kind === 'number')
    return { short: '', name: `${cap(card.color)} ${card.value}`, effect: 'Match by color or number. Combine into pairs, runs of 3+, or three consecutive pairs.' };
  if (card.kind === 'draw')
    return { short: `Draw ${card.value}`, name: `Draw +${card.value}`, effect: 'Start or extend a draw stack. The next player draws the running total unless they respond.' };
  if (card.kind === 'reverseDraw')
    return { short: `Rev +${card.value}`, name: `Reverse draw +${card.value}`, effect: 'Flip direction and make the previous player draw.' };
  return KIND_INFO[card.kind];
}
