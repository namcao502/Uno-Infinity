import type { RuleConfig } from '@uno/engine';

export type FieldType = 'number' | 'enum';
export interface ConfigField {
  path: string; type: FieldType; label: string; help?: string;
  min?: number; max?: number; options?: { value: string; label: string }[];
  group: 'Table' | 'Colored cards' | 'Black draws' | 'Math & defense' | 'Special cards' | 'Targeted cards' | 'Win';
}

export const CONFIG_FIELDS: ConfigField[] = [
  { path: 'maxPlayers', type: 'number', label: 'Max players', min: 2, max: 10, group: 'Table' },
  { path: 'startingHandSize', type: 'number', label: 'Starting hand size', min: 1, max: 15, group: 'Table' },
  { path: 'win.condition', type: 'enum', label: 'Win condition', options: [{ value: 'firstToEmpty', label: 'First to empty' }, { value: 'pointsTarget', label: 'Points target' }], group: 'Win' },
  { path: 'win.pointsTarget', type: 'number', label: 'Points target', min: 50, max: 2000, group: 'Win' },
  // Colored deck counts (per color x4)
  { path: 'deck.numberPerColor', type: 'number', label: 'Numbers (each 0-9, per color)', min: 0, max: 4, group: 'Colored cards' },
  { path: 'deck.colorDraw2PerColor', type: 'number', label: 'Colored +2 (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.colorDraw4PerColor', type: 'number', label: 'Colored +4 (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.playAgainPerColor', type: 'number', label: 'Play-again (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.skipPerColor', type: 'number', label: 'Skip (per color)', min: 0, max: 6, group: 'Colored cards' },
  { path: 'deck.minusPerColor', type: 'number', label: 'Minus (per color)', min: 0, max: 6, group: 'Colored cards' },
  // Black draws (totals)
  { path: 'deck.blackDraw2', type: 'number', label: 'Black +2', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw4', type: 'number', label: 'Black +4', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw6', type: 'number', label: 'Black +6', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw8', type: 'number', label: 'Black +8', min: 0, max: 10, group: 'Black draws' },
  { path: 'deck.blackDraw10', type: 'number', label: 'Black +10', min: 0, max: 10, group: 'Black draws' },
  // Math & defense
  { path: 'deck.mult', type: 'number', label: 'x2', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.div', type: 'number', label: '/2', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.shield', type: 'number', label: 'Shield', min: 0, max: 10, group: 'Math & defense' },
  { path: 'deck.counter', type: 'number', label: 'Counter', min: 0, max: 10, group: 'Math & defense' },
  // Special
  { path: 'deck.duel', type: 'number', label: 'Duel (+4T)', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.bomb', type: 'number', label: 'Bomb (++4)', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.reverseDraw4', type: 'number', label: 'Reverse +4', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.reverseDraw10', type: 'number', label: 'Reverse +10', min: 0, max: 8, group: 'Special cards' },
  { path: 'deck.recycle', type: 'number', label: 'Recycle', min: 0, max: 10, group: 'Special cards' },
  { path: 'deck.wild', type: 'number', label: 'Wild (color)', min: 0, max: 10, group: 'Special cards' },
  { path: 'deck.drawUntilColor', type: 'number', label: 'Draw-until-color', min: 0, max: 10, group: 'Special cards' },
  // Targeted
  { path: 'deck.eye', type: 'number', label: 'Eye (peek)', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.swap', type: 'number', label: 'Swap hands', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.steal', type: 'number', label: 'Steal', min: 0, max: 8, group: 'Targeted cards' },
  { path: 'deck.gift', type: 'number', label: 'Gift', min: 0, max: 8, group: 'Targeted cards' },
];

export function getPath(cfg: RuleConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cfg);
}
export function setPath(cfg: RuleConfig, path: string, value: unknown): RuleConfig {
  const keys = path.split('.');
  const clone = structuredClone(cfg);
  let node = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] as Record<string, unknown>;
  node[keys[keys.length - 1]] = value;
  return clone;
}
