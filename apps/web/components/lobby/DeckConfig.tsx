'use client';
import { DEFAULT_CONFIG, deckTotal, type RuleConfig } from '@uno/engine';
import { CONFIG_FIELDS, getPath, setPath, type ConfigField } from '@/lib/config-fields';
import { Button } from '@/components/ui/button';

const GROUPS = ['Table', 'Win', 'Colored cards', 'Black draws', 'Math & defense', 'Special cards', 'Targeted cards'] as const;

const LITE: RuleConfig = setPath(DEFAULT_CONFIG, 'deck', {
  ...DEFAULT_CONFIG.deck, duel: 1, bomb: 1, eye: 1, swap: 1, steal: 1, gift: 1, reverseDraw4: 1, reverseDraw10: 1, recycle: 2,
});
const CHAOS: RuleConfig = setPath(setPath(DEFAULT_CONFIG, 'startingHandSize', 10), 'deck', {
  ...DEFAULT_CONFIG.deck, duel: 4, bomb: 4, mult: 6, div: 6, recycle: 6, eye: 4, swap: 4, steal: 4, gift: 4,
});

interface DeckConfigProps { config: RuleConfig; onChange: (c: RuleConfig) => void; disabled?: boolean }

function Stepper({ field, value, onChange, disabled }: { field: ConfigField; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const min = field.min ?? 0;
  const max = field.max ?? 99;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
      <span className="text-sm">{field.label}</span>
      <div className="flex items-center gap-2">
        <Button size="icon-xs" variant="outline" disabled={disabled || value <= min}
          aria-label={`decrease ${field.label}`} onClick={() => onChange(Math.max(min, value - 1))}>-</Button>
        <span className="w-6 text-center text-sm font-semibold tabular-nums">{value}</span>
        <Button size="icon-xs" variant="outline" disabled={disabled || value >= max}
          aria-label={`increase ${field.label}`} onClick={() => onChange(Math.min(max, value + 1))}>+</Button>
      </div>
    </div>
  );
}

export function DeckConfig({ config, onChange, disabled }: DeckConfigProps) {
  const total = deckTotal(config.deck);
  const needed = config.startingHandSize * config.maxPlayers + 1;
  const fitsDeck = needed <= total;
  const set = (path: string, v: unknown) => onChange(setPath(config, path, v));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">Presets:</span>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(DEFAULT_CONFIG)}>Default</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(LITE)}>Lite</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(CHAOS)}>Chaos</Button>
        <span className="ml-auto text-sm">Deck total: <strong className="tabular-nums">{total}</strong></span>
      </div>
      {!fitsDeck && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Deck too small: {needed} cards needed to deal, only {total} in deck. Reduce hand size / players or add cards.
        </p>
      )}
      {GROUPS.map((group) => {
        const fields = CONFIG_FIELDS.filter((f) => f.group === group);
        if (!fields.length) return null;
        return (
          <section key={group}>
            <h3 className="mb-2 text-sm font-bold">{group}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) =>
                f.type === 'enum' ? (
                  <div key={f.path} className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
                    <label htmlFor={f.path} className="text-sm">{f.label}</label>
                    <select id={f.path} disabled={disabled} className="rounded border bg-background px-2 py-1 text-sm"
                      value={String(getPath(config, f.path))} onChange={(e) => set(f.path, e.target.value)}>
                      {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <Stepper key={f.path} field={f} value={Number(getPath(config, f.path))} disabled={disabled}
                    onChange={(v) => set(f.path, v)} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
