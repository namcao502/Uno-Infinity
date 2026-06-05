# UNO Infinity - Engine Design & Resolved Rules

> Source ruleset: `docs/UNO_infinity_rules.md` (Vietnamese). This document is the engineering
> interpretation that the implementation plan will be built on. It REPLACES the classic ruleset.
> Each "RD#" below is a resolved decision for an ambiguous source rule - review and correct before
> the plan tasks are generated.

## Scope (confirmed)
- UNO Infinity **replaces** the classic game. Infra (Next.js, Firebase, Auth, RTDB, Cloud Functions
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
  | 'number'        // value 0-9
  | 'draw'          // colored +2/+4 (value) OR black +2/+4/+6/+8/+10 (value); color distinguishes
  | 'playAgain'     // colored: play again, next card must match this color or be another playAgain
  | 'skip'          // colored: next player loses a turn
  | 'minus'         // colored: optionally discard all same-color cards from hand
  // black / colorless
  | 'mult'          // x2  : double the attached draw card's contribution (played WITH a draw)
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
  value: number | null;   // number: 0-9; draw: amount; reverseDraw: 4|10; mult/div: 2; else null
}
```

**RD1 - Active color after a black card.** Any black card that does not otherwise set a color requires
the player to choose the new active color when playing it (same as `wild`). The move carries `chosenColor`.

**RD2 - `draw` unifies colored and black draw cards.** `kind:'draw'`, `value` = amount,
`color` in {red,green,blue,yellow} for colored or `'black'` for black draws.

---

## State model

```ts
export type GamePhase = 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver';
export interface BombResponse {
  bomberId: string;          // who played ++4
  pending: string[];         // active player ids still to respond, in seat order
  bomberDraw: number;        // accumulated cards the bomber draws (4 per counter)
  endColor: CardColor;       // color the bomber chose, applied after resolution
}
export interface PendingDraw {
  total: number;                 // accumulated cards the resolver must draw
  topValue: number;              // value of the most-recent draw card (for stacking-order checks)
  source: 'colorDraw' | 'blackDraw'; // for matching rules
}
export interface DuelState {
  challengerId: string;          // who played +4T
  opponentId: string;            // the targeted player
  activeId: string;              // whose turn within the duel
}
export const MAX_HAND = 30;       // hand.length > 30 -> eliminated (RD20)
export interface PlayerState {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out';      // 'out' = eliminated (hand exceeded MAX_HAND), now audience
  hand: Card[]; score: number;
}
export interface GameState {
  phase: GamePhase;
  config: RuleConfig;            // deck composition + optional toggles (below)
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor;       // active color; black cards set it via chosenColor
  colorLocked: boolean;          // true after a run/3-consecutive-pairs: next must match currentColor
  turnIndex: number;
  direction: 1 | -1;
  pending: PendingDraw | null;   // active draw stack, or null
  duel: DuelState | null;        // non-null only in phase 'duel'
  bombResponse: BombResponse | null; // non-null only in phase 'bombResponse'
  goAgain: boolean;              // true after playAgain: same player continues, color-restricted
  winnerId: string | null;
  seed: string;
  log: string;
}
```

---

## Move model

```ts
export type Move =
  | { type: 'play'; playerId: string; cardIds: string[];   // 1 card, or a pair/run/3-pairs set, or [draw,x2]
      chosenColor?: CardColor; targetId?: string;           // targetId for duel/eye/swap/steal/gift
      giftCardId?: string;                                  // which card to gift
      minusDiscard?: boolean }                              // for minus: also dump same-color cards
  | { type: 'draw'; playerId: string }                      // draw 1 (turn passes), or resolve a pending stack
  | { type: 'shield'; playerId: string }
  | { type: 'counter'; playerId: string };
// First cut: drawing always passes the turn, so there is no separate 'pass' move.
```

**RD3 - Multi-card plays.** `cardIds` may be: a single card; a **pair** (2 identical color+number); a
**run** of 3+ consecutive numbers, same color (e.g. 6-7-8); or **three consecutive pairs**, same color
(6-6-7-7-8-8). The first card of the set must be legally playable on the current top; the rest must
form the valid pattern. Runs and 3-consecutive-pairs **lock the color** (`colorLocked=true`): the next
player must play `currentColor` (or a black card). Numbers do not wrap (9 is the top; no 9-0-1). Pairs
alone do not lock color.

**RD4 - x2 is a 2-card play.** `mult` (x2) is played together with a draw card whose value >= the
current `pending.topValue` (or any draw if no pending). It doubles that attached draw card's
contribution. Example: pending 6 (from +2,+4); player plays [+4, x2] -> adds 4*2=8 -> total 14, passes on.

**RD5 - /2 resolves the stack.** `div` (/2) is played by the player facing a pending draw: it halves
`pending.total` (round down), that player draws the result, the stack clears, turn passes. Example:
pending 6 -> play /2 -> draw 3.

**RD6 - Draw stacking order.** A draw card (colored or black) may be played onto a pending stack only
if its `value >= pending.topValue`. Colored and black draws may both extend a stack (cross-type allowed).

**RD7 - Shield / Counter (on your turn).** Playable only when a `pending` stack is on you (your turn):
`shield` moves the whole `pending` to the next player (you draw nothing, turn passes to them with the
stack); `counter` moves it back to the previous player. They cannot start a stack and cannot be played
with no pending.

**RD8 - playAgain.** Keeps the turn with the same player (`goAgain=true`) and sets `currentColor` to
the card's color; their next play must match that color or be another `playAgain`.

**RD9 - skip.** Advances the turn by 2 (next player loses their turn).

**RD10 - minus (-#).** Colored. On play, if `minusDiscard` is true, all cards in hand sharing the
minus card's color are discarded (no effects triggered). Turn passes.

**RD11 - duel (+4T).** Enters `phase:'duel'` with `pending.total=4` on the targeted opponent. Turns
alternate only between challenger and opponent; both may stack draws / x2 / /2 / shield / counter. The
duel ends when one of them resolves the stack by drawing (or /2-draws). On exit: the **challenger**
chooses `currentColor` (even if they just went out), `phase` returns to `'playing'`, and the turn passes
to the player after the challenger in the main order.

**RD12 - bomb (++4), counterable via a sequential response phase.** Playable only when the top discard
is a number. Playing it enters `phase:'bombResponse'`: each other active player, in seat order starting
after the bomber, gets a mini-turn to choose **Accept** (draw 4), **Shield**, or **Counter**. Shield or
Counter spares that player their 4 and makes the **bomber draw 4** (the shield/counter card is consumed).
Multiple responders stack: the bomber draws **4 per responder who shields/counters** (3 counters ->
bomber draws 12). After all have responded, the bomber draws the accumulated total, `currentColor` is set
to the bomber's chosen color, and play resumes from the player after the bomber. This is a sequential
sub-phase (no timer); each responder acts "on their turn" within the phase, so it fits the chosen model.
State: `bombResponse: { bomberId; pending: string[]; bomberDraw: number; endColor: CardColor } | null`.

**RD13 - reverseDraw (+4/+10).** Flips `direction`; the player immediately behind (the previous player
in the new direction) draws `value` and is skipped; play continues from the current player in the new
direction. **First-cut simplification:** reverseDraw is a **standalone effect, not a stack extender** -
it cannot be played onto an active `pending` draw stack (the source's "stackable if prior draw value <=
this" is deferred), and it is never playable on a bomb (moot, since it cannot stack). In 2-player games
the direction flip plus skip returns the turn to the player who played it (they effectively go again);
this is the intended behavior and is covered by a dedicated test.

**RD14 - recycle.** Re-applies the effect of the current top discard card as if this player had played a
copy of it (the recycling player supplies any required `chosenColor`/`targetId`). Illegal if the top is
itself a recycle or has no effect (e.g. the initial deal card before any play).

**RD15 - eye.** Server-mediated: the server returns a one-time snapshot of `targetId`'s hand to the
caller only (callable return value / short-lived owner-only node), never a persistent readable path.
Illegal while a `pending` stack exists. Turn passes.

**RD16 - swap / steal / gift.** `swap` exchanges full hands with `targetId`. `steal` takes one
server-chosen random card from `targetId`. `gift` moves `giftCardId` from the caller to `targetId`.
All pass the turn after resolving; illegal while a `pending` stack exists.

**RD17 - drawUntilColor.** The next player draws cards until they draw one of `chosenColor`, then loses
their turn. Illegal while a `pending` stack exists.

**RD18 - Win condition.** First player to empty their hand wins (`firstToEmpty`, single round in the
first cut). You cannot "go out" if you are instead forced to resolve a pending draw. Points-target
scoring is a later toggle. See RD20 for the last-player-standing path.

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

---

## RuleConfig (Infinity)

The "full rule builder" becomes mostly **deck composition** plus a few optional toggles (most Infinity
mechanics are core, not toggles). Proposed default deck counts (tunable; validated to fit one deck):

| Card | Count | | Card | Count |
|------|-------|-|------|-------|
| number 0-9 (per color, 2 each) | 80 | | black +2/+4/+6/+8/+10 (2 each) | 10 |
| colored +2 (2/color) | 8 | | x2 / /2 | 4 / 4 |
| colored +4 (2/color) | 8 | | duel +4T / bomb ++4 | 2 / 2 |
| playAgain (2/color) | 8 | | reverseDraw +4 / +10 | 2 / 2 |
| skip (2/color) | 8 | | recycle / wild | 4 / 4 |
| minus (1/color) | 4 | | eye / swap / steal / gift | 3 / 2 / 3 / 3 |
| | | | drawUntilColor / shield / counter | 3 / 4 / 4 |

Optional toggles kept from classic: starting hand size, max players, points-target win (off by default).

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
