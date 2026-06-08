import type { Card, CardColor, CardKind } from '@last-card/engine';

function sampleCard(id: string, color: CardColor, kind: CardKind, value: number | null): Card {
  return { id, color, kind, value };
}

export const CONFIG_FIELD_CARDS: Record<string, Card[]> = {
  'deck.numberPerColor': [
    sampleCard('cfg-number-red-6', 'red', 'number', 6),
    sampleCard('cfg-number-red-7', 'red', 'number', 7),
    sampleCard('cfg-number-red-8', 'red', 'number', 8),
  ],
  'deck.colorDraw2PerColor': [sampleCard('cfg-color-draw-2', 'red', 'draw', 2)],
  'deck.colorDraw4PerColor': [sampleCard('cfg-color-draw-4', 'blue', 'draw', 4)],
  'deck.playAgainPerColor': [sampleCard('cfg-play-again', 'green', 'playAgain', null)],
  'deck.skipPerColor': [sampleCard('cfg-skip', 'yellow', 'skip', null)],
  'deck.minusPerColor': [sampleCard('cfg-minus', 'red', 'minus', null)],
  'deck.blackDraw2': [sampleCard('cfg-black-draw-2', 'black', 'draw', 2)],
  'deck.blackDraw4': [sampleCard('cfg-black-draw-4', 'black', 'draw', 4)],
  'deck.blackDraw6': [sampleCard('cfg-black-draw-6', 'black', 'draw', 6)],
  'deck.blackDraw8': [sampleCard('cfg-black-draw-8', 'black', 'draw', 8)],
  'deck.blackDraw10': [sampleCard('cfg-black-draw-10', 'black', 'draw', 10)],
  'deck.mult': [sampleCard('cfg-mult', 'black', 'mult', 2)],
  'deck.div': [sampleCard('cfg-div', 'black', 'div', 2)],
  'deck.shield': [sampleCard('cfg-shield', 'black', 'shield', null)],
  'deck.counter': [sampleCard('cfg-counter', 'black', 'counter', null)],
  'deck.duel': [sampleCard('cfg-duel', 'black', 'duel', 4)],
  'deck.bomb': [sampleCard('cfg-bomb', 'black', 'bomb', 4)],
  'deck.reverseDraw4': [sampleCard('cfg-reverse-draw-4', 'black', 'reverseDraw', 4)],
  'deck.reverseDraw10': [sampleCard('cfg-reverse-draw-10', 'black', 'reverseDraw', 10)],
  'deck.recycle': [sampleCard('cfg-recycle', 'black', 'recycle', null)],
  'deck.wild': [sampleCard('cfg-wild', 'black', 'wild', null)],
  'deck.drawUntilColor': [sampleCard('cfg-draw-until-color', 'black', 'drawUntilColor', null)],
  'deck.eye': [sampleCard('cfg-eye', 'black', 'eye', null)],
  'deck.swap': [sampleCard('cfg-swap', 'black', 'swap', null)],
  'deck.steal': [sampleCard('cfg-steal', 'black', 'steal', null)],
  'deck.gift': [sampleCard('cfg-gift', 'black', 'gift', null)],
};

export const RULE_CARD_EXAMPLES: Record<string, Card[]> = {
  numbers: [
    sampleCard('rules-number-6', 'red', 'number', 6),
    sampleCard('rules-number-7', 'red', 'number', 7),
    sampleCard('rules-number-8', 'red', 'number', 8),
  ],
  coloredDraws: [
    sampleCard('rules-red-draw-2', 'red', 'draw', 2),
    sampleCard('rules-blue-draw-4', 'blue', 'draw', 4),
  ],
  playAgain: [sampleCard('rules-play-again', 'green', 'playAgain', null)],
  skip: [sampleCard('rules-skip', 'yellow', 'skip', null)],
  minus: [sampleCard('rules-minus', 'red', 'minus', null)],
  blackDraws: [
    sampleCard('rules-black-draw-4', 'black', 'draw', 4),
    sampleCard('rules-black-draw-10', 'black', 'draw', 10),
  ],
  mult: [sampleCard('rules-mult', 'black', 'mult', 2)],
  div: [sampleCard('rules-div', 'black', 'div', 2)],
  duel: [sampleCard('rules-duel', 'black', 'duel', 4)],
  bomb: [sampleCard('rules-bomb', 'black', 'bomb', 4)],
  reverseDraw: [
    sampleCard('rules-reverse-draw-4', 'black', 'reverseDraw', 4),
    sampleCard('rules-reverse-draw-10', 'black', 'reverseDraw', 10),
  ],
  recycle: [sampleCard('rules-recycle', 'black', 'recycle', null)],
  targeted: [
    sampleCard('rules-eye', 'black', 'eye', null),
    sampleCard('rules-swap', 'black', 'swap', null),
    sampleCard('rules-steal', 'black', 'steal', null),
    sampleCard('rules-gift', 'black', 'gift', null),
  ],
  drawUntilColor: [sampleCard('rules-draw-until-color', 'black', 'drawUntilColor', null)],
  defense: [
    sampleCard('rules-shield', 'black', 'shield', null),
    sampleCard('rules-counter', 'black', 'counter', null),
  ],
  wild: [sampleCard('rules-wild', 'black', 'wild', null)],
  noBlackFinish: [sampleCard('rules-no-black-finish', 'black', 'wild', null)],
};
