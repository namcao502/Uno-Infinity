# Last Card - Engine Design & Resolved Rules

> Source ruleset: `docs/last-card-rules.md` (Vietnamese). This document is the engineering
> interpretation, reconciled with the implemented engine in `packages/engine/src`. It REPLACES the
> classic ruleset. Each "RD#" below is a resolved decision for an ambiguous source rule; the types and
> snippets mirror the engine source - keep them in sync when the engine changes.

## Scope (confirmed)
- Last Card **replaces** the classic game. Infra (Next.js, Firebase, Auth, RTDB, Cloud Functions
  shell, lobby, theme) carries over; the rule engine, card model, move model and game-table UI are rebuilt.
- **All** mechanic groups in scope: multi-card plays, extended draw math, targeted cards, special modes.
- **Shield/Counter:** "on your turn" model only (no out-of-turn reaction window).
- **Jungle rule:** dropped (server rejects illegal moves, so there is nothing to penalize).
- **Eye/peek:** server-mediated one-time reveal (never via RTDB read rules - preserves hand privacy).
- Authority, security rules, RTDB layout, transactions, bots remain as in the validated plan.

---

## Card model

```ts
export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'black'; // black = colorless / wild

export type CardKind =
  // colored
  | 'number'        // value 0-10
  | 'draw'          // colored +2/+4 (value) OR black +2/+4/+6/+8/+10 (value); color distinguishes
  | 'playAgain'     // colored: play again, next card must match this color or be another playAgain
  | 'skip'          // colored: next player loses a turn
  | 'minus'         // colored: optionally discard chosen same-color cards from hand
  // black / colorless
  | 'mult'          // x2  : double a draw on the stack (with a draw card, or alone - RD4)
  | 'div'           // /2  : halve the pending draw, then draw it
  | 'duel'          // +4T : 1v1 duel
  | 'bomb'          // ++4 : all other players draw 4
  | 'reverseDraw'   // reverse direction + previous player draws value (4/10)
  | 'recycle'       // copy the effect of the current top discard
  | 'eye'           // peek a target's hand (server-mediated reveal)
  | 'swap'          // swap hands with a target
  | 'steal'         // take 1 random card from a target
  | 'gift'          // give 1 chosen card to a target
  | 'drawUntilColor'// next player draws until they draw the chosen color
  | 'shield'        // push pending draw to the next player
  | 'counter'       // push pending draw back to the previous player
  | 'wild';         // choose active color (generic color setter)

export interface Card {
  id: string;
  color: CardColor;       // 'black' for all colorless kinds
  kind: CardKind;
  value: number | null;   // number: 0-10; draw: amount; reverseDraw: 4|10; mult/div: 2; else null (never undefined)
}
```

**RD1 - Active color after a black card.** Any black card that does not otherwise set a color requires
the player to choose the new active color when playing it (same as `wild`). The move carries `chosenColor`.

**RD2 - `draw` unifies colored and black draw cards.** `kind:'draw'`, `value` = amount,
`color` in {red,green,blue,yellow} for colored or `'black'` for black draws. A black draw requires
`chosenColor`; that color becomes the active color when the card is played (and persists after the
draw stack resolves).

---

## State model

```ts
export type GamePhase = 'playing' | 'duel' | 'bombResponse' | 'gameOver';  // single round; no 'roundEnd'
export const MAX_HAND = 30;       // hand.length > 30 -> eliminated (RD20)

export interface PendingDraw {
  total: number;                 // accumulated cards the resolver must draw
  topValue: number;              // value of the most-recent draw card (for stacking-order checks)
  source: 'colorDraw' | 'blackDraw'; // for matching rules
}
export interface PendingUntil { color: CardColor }   // a draw-until-color threat (RD17)
export interface DuelState {
  challengerId: string;          // who played +4T
  opponentId: string;            // the targeted player
  activeId: string;              // whose turn within the duel
}
export interface BombResponse {
  bomberId: string;          // who played ++4
  pending: string[];         // active player ids still to respond, in seat order
  bomberDraw: number;        // accumulated cards the bomber draws (4 per counter)
  endColor: CardColor;       // color the bomber chose, applied after resolution
}
export interface PlayerState {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out';      // 'out' = eliminated (hand exceeded MAX_HAND), now audience
  hand: Card[];                  // no per-player score: win is fixed (empty hand / last standing)
}

/** One granular history entry; `text` is a verb phrase WITHOUT the actor name (the UI prefixes it). */
export interface LogEntry {
  seq: number;                   // unique monotonic id -> React key / ordering
  actorId: string; actorName: string;
  kind: 'play' | 'draw' | 'shield' | 'counter' | 'skip' | 'eliminate' | 'win' | 'system';
  text: string;
  cards?: Card[];                // cards played (kind 'play')
  drawCount?: number;            // cards drawn (kind 'draw')
  stackId?: number;              // present -> part of a draw-stack chain (grouped in the UI)
  detail?: boolean;              // an indented consequence sub-line (no actor name / glyphs)
  chosenColor?: CardColor;       // a color the play set/chose -> UI shows a color chip
}

export interface GameState {
  phase: GamePhase;
  config: RuleConfig;            // deck composition + settings (below)
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor;       // active color; black cards set it via chosenColor
  colorLocked: boolean;          // true after a run/3-consecutive-pairs: next must match currentColor
  turnIndex: number;
  direction: 1 | -1;
  pending: PendingDraw | null;   // active draw stack, or null
  pendingUntil: PendingUntil | null; // a draw-until-color threat the player on turn must answer (RD17)
  duel: DuelState | null;        // non-null only in phase 'duel'
  bombResponse: BombResponse | null; // non-null only in phase 'bombResponse'
  goAgain: boolean;              // true after playAgain: same player continues, color-restricted
  drawnPlayable: { playerId: string; cardId: string } | null; // just-drawn playable card: play it or draw again to keep (RD21)
  winnerId: string | null;
  seed: string;
  log: LogEntry[];               // granular history, bounded (LOG_MAX in moves.ts)
  chainId: number;               // bumped when a draw stack opens; ties chain entries together
  eventSeq: number;              // next LogEntry.seq to assign
}
```

---

## Move model

```ts
export type Move =
  | { type: 'play'; playerId: string; cardIds: string[];   // 1 card, or a pair/run/3-pairs set, or [draw,x2]
      chosenColor?: CardColor; targetId?: string;           // targetId for duel/eye/swap/steal/gift
      giftCardId?: string;                                  // which card to gift
      minusDiscardIds?: string[] }                          // for minus: which same-color cards to dump
  | { type: 'draw'; playerId: string }                      // draw 1 (turn passes), or resolve a pending stack
  | { type: 'shield'; playerId: string }
  | { type: 'counter'; playerId: string };
// No separate 'pass' move: a plain draw passes the turn, EXCEPT a drawn playable card keeps the
// turn open (RD21 - play that card, or draw again to keep it and pass).
```

**RD3 - Multi-card plays.** `cardIds` may be: a single card; a **pair** (2 identical color+number); a
**run** of 3+ consecutive numbers, same color (e.g. 6-7-8); or **consecutive pairs** - 3+ consecutive
ranks each twice, same color (6-6-7-7-8-8, or 6-6-7-7-8-8-9-9). The first card of the set must be
legally playable on the current top; the rest must
form the valid pattern. Runs and 3-consecutive-pairs **lock the color** (`colorLocked=true`): the next
player must play `currentColor` (or a black card). Numbers do not wrap (9 is the top; no 9-0-1). Pairs
alone do not lock color.

**RD4 - x2 (only onto a draw stack; two forms).** `mult` (x2) is **never** legal with no pending stack -
it always responds to a stack that is on you. Two forms: (a) **`[draw, x2]`** (a 2-card play) where the
draw's value `>= pending.topValue` - it doubles that attached draw's contribution (pending 6 + `[+4, x2]`
-> +4*2 -> total 14, `topValue` becomes 4); or (b) **x2 alone** - doubles the current stack top by adding
`pending.topValue` again, with no new draw card (pending 6 with top +4 -> x2 alone -> total 10, `topValue`
unchanged). Both pass the turn on.

**RD5 - /2 resolves the stack.** `div` (/2) is played by the player facing a pending draw: it halves
`pending.total` (round down), that player draws the result, the stack clears, turn passes. Example:
pending 6 -> play /2 -> draw 3.

**RD6 - Draw stacking order.** A draw card may be played onto a pending stack only if its
`value >= pending.topValue`. Colored draws may stack on colored draws across colors, e.g.
Red +2 -> Blue +2 -> Blue +4. Black draws may stack on colored or black draws, but once the current
top +draw is black, only black +draws may extend it.

**RD7 - Shield / Counter (on your turn).** Playable only when a `pending` stack is on you (your turn):
`shield` moves the whole `pending` to the next player (you draw nothing, turn passes to them with the
stack); `counter` moves it back to the previous player. They cannot start a stack and cannot be played
with no pending.

**RD8 - playAgain.** Keeps the turn with the same player (`goAgain=true`) and sets `currentColor` to
the card's color; their next play must match that color or be another `playAgain`.

**RD9 - skip.** Advances the turn by 2 (next player loses their turn).

**RD10 - minus (-#).** Colored. On play, the cards listed in `minusDiscardIds` are discarded from the
hand (no effects triggered); legality requires each to be in hand and share the minus card's color. The
player may dump none, some, or all of that color. Turn passes.

**RD11 - duel (+4T).** The challenger chooses `currentColor` **upfront** when playing the +4T (it is
applied immediately, like any black card per RD1), then `phase:'duel'` opens with `pending.total=4` on
the targeted opponent. Turns alternate only between challenger and opponent; both may stack draws / x2 /
/2 / shield / counter. The duel ends when one of them resolves the stack by drawing (or /2-draws);
`phase` returns to `'playing'` and the turn passes to the player after the challenger in the main order.
(Black draws stacked during the duel may change `currentColor` before it ends.)

**RD12 - bomb (++4), counterable via a sequential response phase.** Playable only when the top discard
is a number. Playing it enters `phase:'bombResponse'`: each other active player, in seat order starting
after the bomber, gets a mini-turn to choose **Accept** (draw 4), **Shield**, or **Counter**. Shield or
Counter spares that player their 4 and makes the **bomber draw 4** (the shield/counter card is consumed).
Multiple responders stack: the bomber draws **4 per responder who shields/counters** (3 counters ->
bomber draws 12). After all have responded, the bomber draws the accumulated total, `currentColor` is set
to the bomber's chosen color, and play resumes from the player after the bomber. This is a sequential
sub-phase (no timer); each responder acts "on their turn" within the phase, so it fits the chosen model.
State: `bombResponse: { bomberId; pending: string[]; bomberDraw: number; endColor: CardColor } | null`.

**RD13 - reverseDraw (+4/+10).** Flips `direction`, then opens a `pending` draw stack of `value` aimed
at the previous player (the new "next" in the flipped direction). That player answers it like any draw
stack - draw the running total, shield, counter, `/2`, or stack a `+draw` of equal or higher value - so
the response IS their turn (they are not separately skipped). **Still deferred:** reverseDraw cannot
itself be played onto an already-active stack to flip mid-chain (the source's "stackable if prior draw
value <= this"), and it is never playable on a bomb. In 2-player games the flip aims the stack at the
only opponent and, once answered, returns the turn to the player who played it.

**RD14 - recycle.** Re-applies the effect of the copied discard card as if this player had played a copy
of it (the recycling player supplies any required `chosenColor`/`targetId`). The copied card is resolved
by `recycleTarget` (state.ts): the nearest non-recycle card beneath the top, **seeing through** stacked
recycles - so recycle-on-recycle copies what the lower recycle pointed at and can never re-enter
`applyRecycle` (no infinite recursion). Illegal only when there is no real card to copy (e.g. the lone
opening deal card).

**RD15 - eye.** Server-mediated: the server returns a one-time snapshot of `targetId`'s hand to the
caller only (callable return value / short-lived owner-only node), never a persistent readable path.
Illegal while a `pending` stack exists. Turn passes.

**RD16 - swap / steal / gift.** `swap` exchanges full hands with `targetId`. `steal` takes one
server-chosen random card from `targetId`. `gift` moves `giftCardId` from the caller to `targetId`.
All pass the turn after resolving; illegal while a `pending` stack exists.

**RD17 - drawUntilColor.** Opens a defendable `pendingUntil = { color }` threat and passes to the next
player instead of resolving immediately. That player may bounce it by playing their own `drawUntilColor`
(new color) or a `recycle` that copies it (new color), re-aiming `pendingUntil` at the following player;
the threat chains until someone accepts. Accepting (a `draw` move, or a timeout/disconnect default) makes
the player draw until `chosenColor`, then they lose their turn. RD19 forbids bouncing with a last (black)
card. Illegal while a `pending` stack exists.

**RD18 - Win condition.** First player to empty their hand wins (single round). You cannot "go out" if
you are instead forced to resolve a pending draw. The win condition is fixed - there is no points-target
scoring. See RD20 for the last-player-standing path.

**RD19 - No going out on a black card.** A `play` is **illegal** if it would empty the player's hand
and the final card played is black (colorless/special). Players cannot win on a wild/+4/bomb/etc.; they
must shed black cards earlier or keep them covered by colored cards. For multi-card sets, the rule
applies to the last card of the set. (Implemented in `isMoveLegal`, not as a silent no-op.)

**RD20 - Overload elimination -> audience.** Whenever a player's hand exceeds 30 cards
(`hand.length > 30`, i.e. 31+) after drawing, that player is immediately set to `status:'out'` and
removed from the turn rotation, becoming an audience member. Rules:
- Eliminated players are **skipped** by turn advancement and the duel pointer.
- They **cannot be targeted** by duel / eye / swap / steal / gift, and are not hit by the bomb.
- They keep RTDB room membership (can watch + chat) but hold no seat in turn order; their hand is moot.
- The game ends (`gameOver`) when only **one active player remains** (that player wins), in addition to
  the normal firstToEmpty win.
- The check runs after every draw resolution (a single +14 stack can push a hand past 30). `MAX_HAND = 30`.

**RD21 - Draw-then-play.** A plain `draw` with **no** pending stack draws one card; if that card is
immediately playable, the turn stays open (`drawnPlayable` is set) and the player may either play **that
card only** or `draw` again to keep it and pass. Any other turn change clears `drawnPlayable`. If the
drawn card is not playable, the turn passes as before. (Does not apply while a `pending` stack or
`pendingUntil` threat is on the player - those resolve on draw.)

**RD22 - Random colored opener.** The opening discard is the first non-black card after the deal in the
shuffled deck (effectively a random colored card). Black openers are skipped so the active color is
always defined, and an opening card's effect is never applied.

---

## RuleConfig (Infinity)

The "full rule builder" is mostly **deck composition** plus a few settings (most Infinity mechanics are
core, not toggles). Default deck counts (tunable; validated to fit one deck):

| Card | Count | | Card | Count |
|------|-------|-|------|-------|
| number 0-10 (per color, 2 each) | 88 | | black +2/+4/+6/+8/+10 (2 each) | 10 |
| colored +2 (2/color) | 8 | | x2 / /2 | 4 / 4 |
| colored +4 (2/color) | 8 | | duel +4T / bomb ++4 | 2 / 2 |
| playAgain (2/color) | 8 | | reverseDraw +4 / +10 | 2 / 2 |
| skip (2/color) | 8 | | recycle / wild | 4 / 4 |
| minus (1/color) | 4 | | eye / swap / steal / gift | 3 / 2 / 3 / 3 |
| | | | drawUntilColor / shield / counter | 3 / 4 / 4 |

Configurable settings (`ruleConfigSchema`): `version` (literal 1), `startingHandSize` (1-15, default 7),
`maxPlayers` (2-10, default 6), and the `deck` counts. The win condition is **fixed** (empty your hand,
or be the last player standing) - there is no points-target toggle. `mergeConfig` validates the result,
including that the deck is large enough to deal every player (`startingHandSize * maxPlayers + 1 <= deckTotal`).

---

## Open items the implementer must keep in mind
- **Sub-phases (RD11 duel, RD12 bomb-response)** each need their own turn pointer and a clean exit back
  to the main order (`endDuel` / `finishBomb`). They are the highest-risk pieces - isolate and test heavily.
- **Bomb counter (RD12) IS in scope** via the sequential `bombResponse` phase (each hit player responds
  in seat order; shield/counter bounces 4 to the bomber). A fully general timed out-of-turn reaction
  window for OTHER cards remains out of the first cut.
- **Eye/steal/swap/gift** must all run through Cloud Functions (server picks randomness, server reveals
  Eye) - never trust the client and never expose hidden cards via RTDB.
- Deck counts (RD/table above) are guesses; expect to tune for balance after playtests.
