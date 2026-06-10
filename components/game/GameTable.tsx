'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  canStackDraw, isPlayable, classifySet, type Card, type CardColor, type CardKind, type Move,
} from '@last-card/engine';
import { useRoom, type PublicState } from '@/lib/hooks/useRoom';
import { useHand } from '@/lib/hooks/useHand';
import { usePresence } from '@/lib/hooks/usePresence';
import { usePeek } from '@/lib/hooks/usePeek';
import { useServerNow } from '@/lib/hooks/useServerNow';
import { useAuth } from '@/lib/auth';
import { callSubmitMove, callForceTimeout, callPauseGame, callResumeGame } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { GameCard, cardLabel } from './GameCard';
import { cardInfo } from '@/lib/card-info';
import { ChatPanel } from './ChatPanel';
import { GameLog } from './GameLog';
import { RoundTable } from './RoundTable';
import { ConnectionBanner } from './ConnectionBanner';
import { RoundEndDialog } from './RoundEndDialog';
import { LeaveRoomButton } from '@/components/lobby/LeaveRoomButton';
import { CARD_COLORS, TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import { LanguageToggle } from '@/components/LanguageToggle';

const WILD_COLORS: CardColor[] = ['red', 'green', 'blue', 'yellow'];
const TARGETED = new Set<CardKind>(['duel', 'eye', 'swap', 'steal', 'gift']);
const needsColor = (c: Card) => c.kind === 'wild' || c.kind === 'drawUntilColor' || c.kind === 'duel' || c.kind === 'bomb'
  || (c.kind === 'draw' && c.color === 'black');
const ACTIONABLE_PHASES = ['playing', 'duel', 'bombResponse'];
const DISCARD_PILE_MAX = 10;   // how many recently-played cards to keep fanned on the board

/** Hand display order: group by color (red -> green -> blue -> yellow -> black), then value
 *  ascending (value-less specials sort last within a color), with kind as a stable tiebreak. */
const HAND_COLOR_RANK: Record<CardColor, number> = { red: 0, green: 1, blue: 2, yellow: 3, black: 4 };
function compareHand(a: Card, b: Card): number {
  return (HAND_COLOR_RANK[a.color] - HAND_COLOR_RANK[b.color])
    || ((a.value ?? 99) - (b.value ?? 99))
    || a.kind.localeCompare(b.kind);
}

/** Whether a single card is a legal lead/response given the current public state. */
function isCardPlayable(c: Card, pub: PublicState, drawnPlayableCardId: string | null): boolean {
  if (drawnPlayableCardId) return c.id === drawnPlayableCardId; // after a draw, only the drawn card may be played
  if (pub.phase === 'bombResponse') return c.kind === 'shield' || c.kind === 'counter';
  if (pub.pendingUntil) return c.kind === 'drawUntilColor' || c.kind === 'recycle'; // bounce a draw-until-color threat
  if (pub.pending) return canStackDraw(pub.pending, c) || c.kind === 'div' || c.kind === 'mult' || c.kind === 'shield' || c.kind === 'counter';
  return isPlayable(c, pub.discardTop, pub.currentColor, pub.colorLocked);
}

export function GameTable({ roomId }: { roomId: string }) {
  const { meta, seats, pub, presence } = useRoom(roomId);
  const { cards: hand, drawnPlayableCardId } = useHand(roomId);
  const { peek, dismiss } = usePeek(roomId);
  const { user, nickname } = useAuth();
  usePresence(roomId);
  const serverNow = useServerNow();
  const t = useT();

  const [selected, setSelected] = useState<string[]>([]);
  // a play awaiting extra input (color / target / gift / minus discards). `effective` is the card
  // whose inputs we collect - the copied card for a recycle, otherwise the lead itself.
  const [draft, setDraft] = useState<{ cardIds: string[]; lead: Card; effective: Card; chosenColor?: CardColor; targetId?: string; minusDiscardIds?: string[] } | null>(null);
  // a card whose effect the player is inspecting
  const [inspect, setInspect] = useState<Card | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  // Discard pile: keep the last few played cards on the board (newest on top), capped at
  // DISCARD_PILE_MAX. We accumulate each new discardTop client-side as it changes.
  const [pile, setPile] = useState<Card[]>([]);
  const lastTopRef = useRef<string | null>(null);
  useEffect(() => {
    const top = pub?.discardTop;
    if (!top || top.id === lastTopRef.current) return;
    lastTopRef.current = top.id;
    setPile((prev) => (prev.some((c) => c.id === top.id) ? prev : [...prev, top].slice(-DISCARD_PILE_MAX)));
  }, [pub?.discardTop]);

  // Turn-timer enforcement: when the deadline passes and the player on turn is
  // ONLINE, any connected client asks the server to force the safe default. The
  // active player's own client fires immediately; others back it up after 2s.
  // Offline players are handled server-side (skip / forfeit), so we skip them here.
  const firedRef = useRef('');
  useEffect(() => {
    if (!pub?.turnDeadline || !pub.turnId || !meta || meta.paused) return;
    if (!['playing', 'duel', 'bombResponse'].includes(meta.phase)) return;
    if (presence[pub.turnId]?.online === false) return;
    const key = `${pub.turnId}:${pub.turnDeadline}`;
    const isMe = pub.turnId === (user?.uid ?? '');
    if (serverNow >= pub.turnDeadline + (isMe ? 0 : TIMING.timeoutBackupMs) && firedRef.current !== key) {
      firedRef.current = key;
      callForceTimeout({ roomId }).catch(() => {});
    }
  }, [serverNow, pub?.turnDeadline, pub?.turnId, meta, presence, user?.uid, roomId]);

  // Auto-draw for the active player when they have no legal move: there is nothing to
  // decide, so draw (or take the stack / accept the bomb) on their behalf after a short
  // beat. Guarded once per turn. The drawn-playable choice state is excluded.
  const autoDrewRef = useRef('');
  useEffect(() => {
    if (!pub || !meta || meta.paused) return;
    const myId = user?.uid ?? '';
    if (pub.turnId !== myId) return;
    const me = seats.find((s) => s.id === myId);
    if (me?.isAudience || me?.status === 'out') return;
    if (drawnPlayableCardId) return;
    if (!ACTIONABLE_PHASES.includes(pub.phase)) return;
    if (hand.length === 0 || hand.some((c) => isCardPlayable(c, pub, drawnPlayableCardId))) return;
    const key = `${pub.turnId}:${pub.turnDeadline ?? ''}`;
    if (autoDrewRef.current === key) return;
    const timer = setTimeout(() => {
      autoDrewRef.current = key;
      toast.message(t.game.autoDrawing);
      callSubmitMove({ roomId, move: { type: 'draw', playerId: myId } })
        .catch((e) => toast.error((e as { message?: string })?.message ?? t.errors.moveRejected));
    }, 700);
    return () => clearTimeout(timer);
  }, [pub, meta, seats, user?.uid, drawnPlayableCardId, hand, roomId, t]);

  if (!pub || !meta) return <div className="p-10 text-center text-muted-foreground">{t.game.dealing}</div>;

  const timerSecs = pub.turnDeadline && ['playing', 'duel', 'bombResponse'].includes(meta.phase)
    ? Math.max(0, Math.ceil((pub.turnDeadline - serverNow) / 1000)) : null;

  const myId = user?.uid ?? '';
  const myTurn = pub.turnId === myId;
  const me = seats.find((s) => s.id === myId);
  const iAmAudience = me?.isAudience === true;
  const eliminated = me?.status === 'out';
  const isHost = meta.hostId === myId;
  const canPause = ACTIONABLE_PHASES.includes(meta.phase);

  const togglePause = async (pause: boolean) => {
    setPauseBusy(true);
    try { await (pause ? callPauseGame : callResumeGame)({ roomId }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.pauseError); }
    finally { setPauseBusy(false); }
  };

  const submit = async (move: Move) => {
    setSelected([]); setDraft(null);
    try { await callSubmitMove({ roomId, move }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.moveRejected); }
  };

  const clientPlayable = (c: Card): boolean => isCardPlayable(c, pub, drawnPlayableCardId);
  // The card whose extra inputs a play needs: a recycle takes on the card it copies (seen through
  // recycle chains by the server via pub.recycleCopies), otherwise the lead itself.
  const effectiveOf = (lead: Card): Card => lead.kind === 'recycle' ? (pub.recycleCopies ?? lead) : lead;

  // Only let a selection begin with a playable card; once a playable lead is chosen, any
  // card may be added so multi-card combos (pairs / runs) still work. Deselecting is free.
  const toggle = (id: string) => {
    const already = selected.includes(id);
    if (!already && myTurn) {
      const card = hand.find((c) => c.id === id);
      const hasPlayableLead = selected.some((sid) => {
        const c = hand.find((x) => x.id === sid);
        return !!c && clientPlayable(c);
      });
      if (card && !clientPlayable(card) && !hasPlayableLead) {
        toast.message(t.game.notPlayable);
        return;
      }
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const tryPlay = () => {
    const cards = selected.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
    // Shield / counter are played by selecting the card; the engine takes a dedicated move for them.
    const only = cards.length === 1 ? cards[0] : null;
    if (only?.kind === 'shield') { submit({ type: 'shield', playerId: myId }); return; }
    if (only?.kind === 'counter') { submit({ type: 'counter', playerId: myId }); return; }
    const res = classifySet(cards);
    if (!res.ok) { toast.error(res.reason); return; }
    const lead = res.combo.lead;
    const effective = effectiveOf(lead);   // for a recycle, the card it copies (may need color/target/gift/minus)
    if (effective.kind === 'minus') {
      // Let the player pick which same-color cards to dump; skip the prompt if there are none.
      const sameColor = hand.filter((c) => c.color === effective.color && !selected.includes(c.id));
      if (sameColor.length === 0) { submit({ type: 'play', playerId: myId, cardIds: selected }); return; }
      setDraft({ cardIds: selected, lead, effective, minusDiscardIds: [] });
      return;
    }
    if (needsColor(effective) || TARGETED.has(effective.kind) || effective.kind === 'gift') {
      setDraft({ cardIds: selected, lead, effective });
      return;
    }
    submit({ type: 'play', playerId: myId, cardIds: selected });
  };

  // finalize a drafted play once all required inputs are present
  const finalizeDraft = (patch: Partial<NonNullable<typeof draft>>) => {
    const d = { ...draft!, ...patch };
    const needColor = needsColor(d.effective) && !d.chosenColor;
    const needTarget = TARGETED.has(d.effective.kind) && !d.targetId;
    const needGift = d.effective.kind === 'gift' && !(d as { giftCardId?: string }).giftCardId;
    if (needColor || needTarget || needGift) { setDraft(d); return; }
    const move: Move = { type: 'play', playerId: myId, cardIds: d.cardIds, chosenColor: d.chosenColor, targetId: d.targetId } as Move;
    submit(move);
  };

  const activeOpponents = seats.filter((s) => s.id !== myId && s.status === 'active');

  const selectedCards = selected.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
  const describeCard = describedCard(selectedCards);
  const sortedHand = [...hand].sort(compareHand);   // display order only; selection is by id

  // RD19: a recycled minus is black, so dumping every remaining card would empty the hand on a black
  // card - illegal. (A direct, colored minus may empty the hand to win, so this only guards recycle.)
  const minusWouldEmpty = (d: NonNullable<typeof draft>): boolean =>
    d.lead.kind === 'recycle'
    && hand.filter((c) => !d.cardIds.includes(c.id) && !(d.minusDiscardIds ?? []).includes(c.id)).length === 0;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <ConnectionBanner eliminated={!!eliminated} />
        <RoundEndDialog roomId={roomId} meta={meta} seats={seats} winnerId={pub.winnerId} />

        {/* Paused overlay: blocks the table for everyone; only the host can resume. */}
        {meta.paused && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-w-sm rounded-xl border bg-card p-6 text-center">
              <h3 className="text-lg font-bold">{t.game.pausedTitle}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t.game.pausedByHost}</p>
              {isHost && (
                <Button className="mt-4" disabled={pauseBusy} onClick={() => togglePause(false)}>{t.game.resume}</Button>
              )}
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
          <span className="font-bold">{t.game.room(meta.code)}</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: colorHex(pub.currentColor) }}>
              {t.game.current}: {t.colors[pub.currentColor]}
            </span>
            {pub.colorLocked && <span className="rounded bg-muted px-2 py-0.5 text-xs">{t.game.colorLocked}</span>}
            {timerSecs !== null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${timerSecs <= TIMING.timerWarnSeconds ? 'bg-lc-red text-white' : 'bg-muted'}`} aria-label={`${timerSecs} seconds left`}>
                {timerSecs}s
              </span>
            )}
            <span aria-label={pub.direction === 1 ? 'clockwise' : 'counter-clockwise'}>{pub.direction === 1 ? '↻' : '↺'}</span>
            {isHost && canPause && !meta.paused && (
              <Button size="sm" variant="outline" disabled={pauseBusy} onClick={() => togglePause(true)}>{t.game.pause}</Button>
            )}
            <LanguageToggle />
            <LeaveRoomButton roomId={roomId} canBecomeAudience={!iAmAudience && !eliminated} />
          </span>
        </div>

        {/* Spectators */}
        {seats.some((s) => s.isAudience) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold">{t.game.spectatorsLabel}</span>
            {seats.filter((s) => s.isAudience).map((s) => (
              <span key={s.id} className="rounded-full border px-2 py-0.5">{s.name}</span>
            ))}
          </div>
        )}

        {/* Center: round table with draw pile + fanned discard pile in the middle */}
        <RoundTable seats={seats} myId={myId} direction={pub.direction} presence={presence} serverNow={serverNow}>
          <div className="relative flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={!myTurn || eliminated}
              onClick={() => submit({ type: 'draw', playerId: myId })}
              aria-label={pub.pending ? `draw ${pub.pending.total}` : 'draw a card'}
              className="flex h-28 w-20 items-center justify-center rounded-xl border-4 border-white bg-lc-black font-bold text-white transition-transform duration-150 enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-60"
            >
              {t.game.draw}
            </button>
            <div className="flex flex-col items-center gap-1">
              {/* Fanned discard pile: older cards scattered underneath, newest on top flies in from the hand. */}
              <div className="relative h-28 w-20">
                {pile.map((c, i) => {
                  const isTop = i === pile.length - 1;
                  const { rot, dx, dy } = scatter(c.id);
                  return (
                    <span key={c.id} className="absolute inset-0" style={{ transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, zIndex: i }}>
                      <span className={isTop ? 'block animate-in fade-in zoom-in-95 slide-in-from-bottom-24 spin-in-2 duration-500 motion-reduce:animate-none' : 'block'}>
                        <GameCard card={c} onInspect={isTop ? () => setInspect(c) : undefined} />
                      </span>
                    </span>
                  );
                })}
              </div>
              <span className="text-xs text-white/80">{pub.drawCount} {t.game.deckSuffix}</span>
            </div>
            {pub.pending && (
              <div className="absolute -right-3 -top-3 rounded-lg bg-black/60 px-2 py-1 text-center text-white shadow-lg">
                {/* Re-key on the total so the number pops each time the stack grows. */}
                <div key={pub.pending.total} className="animate-badge-bump text-lg font-black motion-reduce:animate-none">+{pub.pending.total}</div>
                <div className="text-[10px]">{t.game.incoming}</div>
              </div>
            )}
          </div>
        </RoundTable>

        {/* Duel banner */}
        {pub.phase === 'duel' && pub.duel && (
          <div className="rounded-lg bg-lc-red/15 px-4 py-2 text-center text-sm font-semibold text-lc-red">
            {t.game.duel(seatName(seats, pub.duel.challengerId), seatName(seats, pub.duel.opponentId), seatName(seats, pub.turnId))}
          </div>
        )}
        {pub.phase === 'bombResponse' && (
          <div className="rounded-lg bg-lc-black px-4 py-2 text-center text-sm font-semibold text-white">
            💣 {pub.turnId === myId ? t.game.bombYour : t.game.waitingFor(seatName(seats, pub.turnId))}
          </div>
        )}
        {pub.pendingUntil && (
          <div className="rounded-lg bg-lc-blue/15 px-4 py-2 text-center text-sm font-semibold text-lc-blue">
            🃏 {t.game.drawUntil(t.colors[pub.pendingUntil.color])}! {pub.turnId === myId
              ? t.game.drawUntilBounce : t.game.waitingFor(seatName(seats, pub.turnId))}
          </div>
        )}

        {/* Action bar */}
        {!eliminated && myTurn && (
          <div className="flex flex-wrap items-center gap-2">
            {pub.phase === 'bombResponse' ? (
              <>
                <Button onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.accept}</Button>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{t.game.playSelected}</Button>
              </>
            ) : pub.pending ? (
              <>
                <Button variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.drawAmount(pub.pending.total)}</Button>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{t.game.playSelected}</Button>
              </>
            ) : pub.pendingUntil ? (
              <>
                <Button variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.drawUntil(t.colors[pub.pendingUntil.color])}</Button>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{t.game.playSelected}</Button>
              </>
            ) : drawnPlayableCardId ? (
              <>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{t.game.playSelected}</Button>
                <Button variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.keepCard}</Button>
                <span className="text-sm text-muted-foreground">{t.game.drewPlayable}</span>
              </>
            ) : (
              <>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{t.game.playSelected}</Button>
                {selected.length === 0 && <span className="text-sm text-muted-foreground">{t.game.selectHint}</span>}
              </>
            )}
          </div>
        )}
        {!eliminated && !myTurn && (
          <p className="text-sm text-muted-foreground">
            {t.game.waitingToPlayPrefix}<span className="font-semibold text-foreground">{seatName(seats, pub.turnId)}</span>{t.game.waitingToPlaySuffix}
          </p>
        )}
        {eliminated && <p className="text-sm font-semibold text-destructive">{t.game.inAudience}</p>}

        {/* Hand (hidden for spectators) */}
        {iAmAudience ? (
          <p className="rounded-lg border bg-card p-3 text-sm font-semibold text-muted-foreground">{t.game.spectatingHand}</p>
        ) : (
          <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
            {sortedHand.length === 0 && <span className="text-sm text-muted-foreground">{t.game.noCards}</span>}
            {sortedHand.map((c) => (
              <GameCard
                key={c.id}
                card={c}
                selected={selected.includes(c.id)}
                playable={myTurn && !eliminated && clientPlayable(c)}
                dimmed={!eliminated && myTurn && !clientPlayable(c) && !selected.includes(c.id)}
                onClick={() => toggle(c.id)}
                onInspect={() => setInspect(c)}
              />
            ))}
          </div>
        )}

        {/* Effect of the selected card (or the lead of a selected combo) */}
        {!iAmAudience && describeCard && (
          <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <GameCard card={describeCard} small />
            <div className="min-w-0">
              <div className="text-sm font-bold">{cardInfo(describeCard, t).name}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{cardInfo(describeCard, t).effect}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <GameLog log={pub.log} />
        <ChatPanel roomId={roomId} nickname={nickname} />
      </div>

      {/* Overlays: color / target / gift / minus pickers - driven by the effective (copied) card */}
      {draft && (
        <Overlay onClose={() => setDraft(null)}>
          {needsColor(draft.effective) && !draft.chosenColor && (
            <Picker title={t.game.chooseColor}>
              {WILD_COLORS.map((c) => (
                <Button key={c} className="text-white" style={{ backgroundColor: colorHex(c) }} onClick={() => finalizeDraft({ chosenColor: c })}>{t.colors[c]}</Button>
              ))}
            </Picker>
          )}
          {(!needsColor(draft.effective) || draft.chosenColor) && TARGETED.has(draft.effective.kind) && !draft.targetId && (
            <Picker title={t.game.choosePlayer}>
              {activeOpponents.map((o) => (
                <Button key={o.id} variant="outline" onClick={() => finalizeDraft({ targetId: o.id })}>{o.name}</Button>
              ))}
            </Picker>
          )}
          {draft.effective.kind === 'gift' && draft.targetId && (
            <Picker title={t.game.chooseGift}>
              {hand.filter((c) => !draft.cardIds.includes(c.id)).map((c) => (
                <button key={c.id} onClick={() => submit({ type: 'play', playerId: myId, cardIds: draft.cardIds, targetId: draft.targetId, giftCardId: c.id })}>
                  <GameCard card={c} small />
                </button>
              ))}
            </Picker>
          )}
          {draft.effective.kind === 'minus' && (
            <Picker title={t.game.dumpColor(t.colors[draft.effective.color])}>
              <div className="flex max-w-md flex-wrap gap-2">
                {hand.filter((c) => c.color === draft.effective.color && !draft.cardIds.includes(c.id)).map((c) => {
                  const picked = (draft.minusDiscardIds ?? []).includes(c.id);
                  return (
                    <button
                      key={c.id}
                      aria-pressed={picked}
                      onClick={() => setDraft((d) => {
                        if (!d) return d;
                        const cur = d.minusDiscardIds ?? [];
                        return { ...d, minusDiscardIds: cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id] };
                      })}
                    >
                      <GameCard card={c} small selected={picked} />
                    </button>
                  );
                })}
              </div>
              <Button
                className="mt-3"
                disabled={minusWouldEmpty(draft)}
                onClick={() => submit({ type: 'play', playerId: myId, cardIds: draft.cardIds, minusDiscardIds: draft.minusDiscardIds ?? [] })}
              >
                {(draft.minusDiscardIds?.length ?? 0) > 0 ? t.game.discardN(draft.minusDiscardIds!.length) : t.game.keepAll}
              </Button>
              {minusWouldEmpty(draft) && (
                <span className="mt-2 block text-xs text-lc-red">{t.game.minusKeepOne}</span>
              )}
            </Picker>
          )}
        </Overlay>
      )}

      {/* Card inspect */}
      {inspect && (
        <Overlay onClose={() => setInspect(null)}>
          <div className="max-w-xs rounded-xl border bg-card p-5 text-center">
            <div className="mb-3 flex justify-center"><GameCard card={inspect} /></div>
            <h3 className="font-bold">{cardInfo(inspect, t).name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{cardInfo(inspect, t).effect}</p>
            <Button className="mt-4" onClick={() => setInspect(null)}>{t.game.close}</Button>
          </div>
        </Overlay>
      )}

      {/* Eye peek modal */}
      {peek && (
        <Overlay onClose={dismiss}>
          <Picker title={t.game.handOf(seatName(seats, peek.targetId))}>
            <div className="flex max-w-md flex-wrap gap-2">
              {peek.cards.map((c) => <GameCard key={c.id} card={c} small />)}
            </div>
            <Button className="mt-3" onClick={dismiss}>{t.game.done}</Button>
          </Picker>
        </Overlay>
      )}
    </div>
  );
}

function colorHex(c: CardColor): string {
  return CARD_COLORS[c];
}
function seatName(seats: { id: string; name: string }[], id: string): string {
  return seats.find((s) => s.id === id)?.name ?? id;
}
/** Deterministic small scatter (rotation + offset) for a discarded card, keyed by its id so the
 *  pile stays put across re-renders. Kept small so the stack reads as a neat pile, not a mess. */
function scatter(id: string): { rot: number; dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return { rot: ((h >>> 0) % 13) - 6, dx: ((h >>> 4) % 7) - 3, dy: ((h >>> 8) % 7) - 3 };
}
/** The card whose effect to describe under the hand: the lone selection, or the lead of a combo. */
function describedCard(cards: Card[]): Card | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return cards[0];
  const res = classifySet(cards);
  return res.ok ? res.combo.lead : cards[cards.length - 1];
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function Picker({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="mb-4 text-xl font-bold sm:text-2xl">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// re-export so consumers can label cards if needed
export { cardLabel };
