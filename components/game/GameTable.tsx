'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  canStackDraw, isPlayable, classifySet, type Card, type CardColor, type CardKind, type Move,
} from '@last-card/engine';
import { useRoom } from '@/lib/hooks/useRoom';
import { useHand } from '@/lib/hooks/useHand';
import { usePresence } from '@/lib/hooks/usePresence';
import { usePeek } from '@/lib/hooks/usePeek';
import { useServerNow } from '@/lib/hooks/useServerNow';
import { useAuth } from '@/lib/auth';
import { callSubmitMove, callForceTimeout } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { GameCard, cardLabel } from './GameCard';
import { cardInfo } from '@/lib/card-info';
import { ChatPanel } from './ChatPanel';
import { GameLog } from './GameLog';
import { ConnectionBanner } from './ConnectionBanner';
import { RoundEndDialog } from './RoundEndDialog';
import { LeaveRoomButton } from '@/components/lobby/LeaveRoomButton';
import { CARD_COLORS, TIMING, STRINGS } from '@/lib/constants';

const WILD_COLORS: CardColor[] = ['red', 'green', 'blue', 'yellow'];
const TARGETED = new Set<CardKind>(['duel', 'eye', 'swap', 'steal', 'gift']);
const needsColor = (c: Card) => c.kind === 'wild' || c.kind === 'drawUntilColor' || c.kind === 'duel' || c.kind === 'bomb'
  || (c.kind === 'draw' && c.color === 'black');

export function GameTable({ roomId }: { roomId: string }) {
  const { meta, seats, pub, presence } = useRoom(roomId);
  const { cards: hand, drawnPlayableCardId } = useHand(roomId);
  const { peek, dismiss } = usePeek(roomId);
  const { user, nickname } = useAuth();
  usePresence(roomId);
  const serverNow = useServerNow();

  const [selected, setSelected] = useState<string[]>([]);
  // a play awaiting extra input (color / target / gift)
  const [draft, setDraft] = useState<{ cardIds: string[]; lead: Card; chosenColor?: CardColor; targetId?: string } | null>(null);
  // a card whose effect the player is inspecting
  const [inspect, setInspect] = useState<Card | null>(null);

  // Turn-timer enforcement: when the deadline passes and the player on turn is
  // ONLINE, any connected client asks the server to force the safe default. The
  // active player's own client fires immediately; others back it up after 2s.
  // Offline players are handled server-side (skip / forfeit), so we skip them here.
  const firedRef = useRef('');
  useEffect(() => {
    if (!pub?.turnDeadline || !pub.turnId || !meta) return;
    if (!['playing', 'duel', 'bombResponse'].includes(meta.phase)) return;
    if (presence[pub.turnId]?.online === false) return;
    const key = `${pub.turnId}:${pub.turnDeadline}`;
    const isMe = pub.turnId === (user?.uid ?? '');
    if (serverNow >= pub.turnDeadline + (isMe ? 0 : TIMING.timeoutBackupMs) && firedRef.current !== key) {
      firedRef.current = key;
      callForceTimeout({ roomId }).catch(() => {});
    }
  }, [serverNow, pub?.turnDeadline, pub?.turnId, meta, presence, user?.uid, roomId]);

  if (!pub || !meta) return <div className="p-10 text-center text-muted-foreground">{STRINGS.game.dealing}</div>;

  const timerSecs = pub.turnDeadline && ['playing', 'duel', 'bombResponse'].includes(meta.phase)
    ? Math.max(0, Math.ceil((pub.turnDeadline - serverNow) / 1000)) : null;

  const myId = user?.uid ?? '';
  const myTurn = pub.turnId === myId;
  const me = seats.find((s) => s.id === myId);
  const iAmAudience = me?.isAudience === true;
  const eliminated = me?.status === 'out';

  const submit = async (move: Move) => {
    setSelected([]); setDraft(null);
    try { await callSubmitMove({ roomId, move }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? 'Move rejected'); }
  };

  const clientPlayable = (c: Card): boolean => {
    if (drawnPlayableCardId) return c.id === drawnPlayableCardId; // after a draw, only the drawn card may be played
    if (pub.phase === 'bombResponse') return c.kind === 'shield' || c.kind === 'counter'; // respond by selecting a shield/counter
    if (pub.pending) return canStackDraw(pub.pending, c) || c.kind === 'div' || c.kind === 'mult' || c.kind === 'shield' || c.kind === 'counter';
    return isPlayable(c, pub.discardTop, pub.currentColor, pub.colorLocked);
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const tryPlay = () => {
    const cards = selected.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
    // Shield / counter are played by selecting the card; the engine takes a dedicated move for them.
    const only = cards.length === 1 ? cards[0] : null;
    if (only?.kind === 'shield') { submit({ type: 'shield', playerId: myId }); return; }
    if (only?.kind === 'counter') { submit({ type: 'counter', playerId: myId }); return; }
    const res = classifySet(cards);
    if (!res.ok) { toast.error(res.reason); return; }
    const lead = res.combo.lead;
    if (needsColor(lead) || TARGETED.has(lead.kind) || lead.kind === 'gift') {
      setDraft({ cardIds: selected, lead });
      return;
    }
    submit({ type: 'play', playerId: myId, cardIds: selected });
  };

  // finalize a drafted play once all required inputs are present
  const finalizeDraft = (patch: Partial<NonNullable<typeof draft>>) => {
    const d = { ...draft!, ...patch };
    const needColor = needsColor(d.lead) && !d.chosenColor;
    const needTarget = TARGETED.has(d.lead.kind) && !d.targetId;
    const needGift = d.lead.kind === 'gift' && !(d as { giftCardId?: string }).giftCardId;
    if (needColor || needTarget || needGift) { setDraft(d); return; }
    const move: Move = { type: 'play', playerId: myId, cardIds: d.cardIds, chosenColor: d.chosenColor, targetId: d.targetId,
      minusDiscard: d.lead.kind === 'minus' ? true : undefined } as Move;
    submit(move);
  };

  const activeOpponents = seats.filter((s) => s.id !== myId && s.status === 'active');

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <ConnectionBanner eliminated={!!eliminated} />
        <RoundEndDialog roomId={roomId} meta={meta} seats={seats} winnerId={pub.winnerId} />

        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
          <span className="font-bold">Room {meta.code}</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: colorHex(pub.currentColor) }}>
              Current: {pub.currentColor}
            </span>
            {pub.colorLocked && <span className="rounded bg-muted px-2 py-0.5 text-xs">color-locked</span>}
            {timerSecs !== null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${timerSecs <= TIMING.timerWarnSeconds ? 'bg-lc-red text-white' : 'bg-muted'}`} aria-label={`${timerSecs} seconds left`}>
                {timerSecs}s
              </span>
            )}
            <span aria-label={pub.direction === 1 ? 'clockwise' : 'counter-clockwise'}>{pub.direction === 1 ? '↻' : '↺'}</span>
            <LeaveRoomButton roomId={roomId} canBecomeAudience={!iAmAudience && !eliminated} />
          </span>
        </div>

        {/* Opponents */}
        <div className="flex flex-wrap gap-3">
          {seats.filter((s) => s.id !== myId && !s.isAudience).map((s) => {
            const offline = !s.isBot && s.status === 'active' && presence[s.id]?.online === false;
            const reconnectLeft = offline && presence[s.id]?.lastSeen
              ? Math.max(0, TIMING.reconnectSeconds - Math.floor((serverNow - presence[s.id].lastSeen) / 1000)) : null;
            return (
              <div key={s.id} className={`rounded-lg border px-3 py-2 text-sm ${s.turn ? 'border-lc-yellow ring-2 ring-lc-yellow/40' : 'bg-card'} ${offline ? 'opacity-60' : ''}`}>
                <div className="font-semibold">{s.name}{s.isBot ? ' 🤖' : ''}</div>
                <div className="text-xs text-muted-foreground">
                  {s.status === 'out' ? <span className="font-bold text-destructive">AUDIENCE</span> : `${s.handCount} cards`}
                  {s.status === 'active' && s.handCount === 1 && ' • 1 card!'}
                </div>
                {offline && (
                  <div className="text-xs font-semibold text-lc-red">
                    disconnected{reconnectLeft !== null ? ` - ${reconnectLeft}s` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Spectators */}
        {seats.some((s) => s.isAudience) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold">Spectators:</span>
            {seats.filter((s) => s.isAudience).map((s) => (
              <span key={s.id} className="rounded-full border px-2 py-0.5">{s.name}</span>
            ))}
          </div>
        )}

        {/* Center */}
        <div className="flex items-center justify-center gap-8 rounded-2xl border bg-lc-table p-8">
          <button
            type="button"
            disabled={!myTurn || eliminated}
            onClick={() => submit({ type: 'draw', playerId: myId })}
            aria-label={pub.pending ? `draw ${pub.pending.total}` : 'draw a card'}
            className="flex h-24 w-16 items-center justify-center rounded-xl border-4 border-white bg-lc-black font-bold text-white disabled:opacity-60"
          >
            {STRINGS.game.draw}
          </button>
          <div className="flex flex-col items-center gap-1">
            <GameCard card={pub.discardTop} onInspect={() => setInspect(pub.discardTop)} />
            <span className="text-xs text-white/80">{pub.drawCount} {STRINGS.game.deckSuffix}</span>
          </div>
          {pub.pending && (
            <div className="rounded-lg bg-black/40 px-3 py-2 text-center text-white">
              <div className="text-2xl font-black">+{pub.pending.total}</div>
              <div className="text-xs">incoming</div>
            </div>
          )}
        </div>

        {/* Duel banner */}
        {pub.phase === 'duel' && pub.duel && (
          <div className="rounded-lg bg-lc-red/15 px-4 py-2 text-center text-sm font-semibold text-lc-red">
            ⚔ Duel: {seatName(seats, pub.duel.challengerId)} vs {seatName(seats, pub.duel.opponentId)} — {seatName(seats, pub.turnId)}&apos;s move
          </div>
        )}
        {pub.phase === 'bombResponse' && (
          <div className="rounded-lg bg-lc-black px-4 py-2 text-center text-sm font-semibold text-white">
            💣 Bomb! {pub.turnId === myId ? 'Your response' : `Waiting for ${seatName(seats, pub.turnId)}`}
          </div>
        )}

        {/* Action bar */}
        {!eliminated && myTurn && (
          <div className="flex flex-wrap items-center gap-2">
            {pub.phase === 'bombResponse' ? (
              <>
                <Button onClick={() => submit({ type: 'draw', playerId: myId })}>{STRINGS.game.accept}</Button>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{STRINGS.game.playSelected}</Button>
              </>
            ) : pub.pending ? (
              <>
                <Button variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>Draw {pub.pending.total}</Button>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{STRINGS.game.playSelected}</Button>
              </>
            ) : drawnPlayableCardId ? (
              <>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{STRINGS.game.playSelected}</Button>
                <Button variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{STRINGS.game.keepCard}</Button>
                <span className="text-sm text-muted-foreground">{STRINGS.game.drewPlayable}</span>
              </>
            ) : (
              <>
                <Button disabled={selected.length === 0} onClick={tryPlay}>{STRINGS.game.playSelected}</Button>
                {selected.length === 0 && <span className="text-sm text-muted-foreground">{STRINGS.game.selectHint}</span>}
              </>
            )}
          </div>
        )}
        {!eliminated && !myTurn && (
          <p className="text-sm text-muted-foreground">
            Waiting for <span className="font-semibold text-foreground">{seatName(seats, pub.turnId)}</span> to play...
          </p>
        )}
        {eliminated && <p className="text-sm font-semibold text-destructive">{STRINGS.game.inAudience}</p>}

        {/* Hand (hidden for spectators) */}
        {iAmAudience ? (
          <p className="rounded-lg border bg-card p-3 text-sm font-semibold text-muted-foreground">{STRINGS.game.spectatingHand}</p>
        ) : (
          <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
            {hand.length === 0 && <span className="text-sm text-muted-foreground">{STRINGS.game.noCards}</span>}
            {hand.map((c) => (
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
      </div>

      <div className="space-y-4">
        <GameLog log={pub.log} />
        <ChatPanel roomId={roomId} nickname={nickname} />
      </div>

      {/* Overlays: color / target / gift pickers */}
      {draft && (
        <Overlay onClose={() => setDraft(null)}>
          {needsColor(draft.lead) && !draft.chosenColor && (
            <Picker title="Choose a color">
              {WILD_COLORS.map((c) => (
                <Button key={c} className="capitalize text-white" style={{ backgroundColor: colorHex(c) }} onClick={() => finalizeDraft({ chosenColor: c })}>{c}</Button>
              ))}
            </Picker>
          )}
          {(!needsColor(draft.lead) || draft.chosenColor) && TARGETED.has(draft.lead.kind) && !draft.targetId && (
            <Picker title="Choose a player">
              {activeOpponents.map((o) => (
                <Button key={o.id} variant="outline" onClick={() => finalizeDraft({ targetId: o.id })}>{o.name}</Button>
              ))}
            </Picker>
          )}
          {draft.lead.kind === 'gift' && draft.targetId && (
            <Picker title="Choose a card to gift">
              {hand.filter((c) => !draft.cardIds.includes(c.id)).map((c) => (
                <button key={c.id} onClick={() => submit({ type: 'play', playerId: myId, cardIds: draft.cardIds, targetId: draft.targetId, giftCardId: c.id })}>
                  <GameCard card={c} small />
                </button>
              ))}
            </Picker>
          )}
        </Overlay>
      )}

      {/* Card inspect */}
      {inspect && (
        <Overlay onClose={() => setInspect(null)}>
          <div className="max-w-xs rounded-xl border bg-card p-5 text-center">
            <div className="mb-3 flex justify-center"><GameCard card={inspect} /></div>
            <h3 className="font-bold">{cardInfo(inspect).name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{cardInfo(inspect).effect}</p>
            <Button className="mt-4" onClick={() => setInspect(null)}>{STRINGS.game.close}</Button>
          </div>
        </Overlay>
      )}

      {/* Eye peek modal */}
      {peek && (
        <Overlay onClose={dismiss}>
          <Picker title={`${seatName(seats, peek.targetId)}'s hand`}>
            <div className="flex max-w-md flex-wrap gap-2">
              {peek.cards.map((c) => <GameCard key={c.id} card={c} small />)}
            </div>
            <Button className="mt-3" onClick={dismiss}>Done</Button>
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
      <h3 className="mb-3 font-bold">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// re-export so consumers can label cards if needed
export { cardLabel };
