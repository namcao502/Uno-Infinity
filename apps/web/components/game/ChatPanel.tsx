'use client';
import { useState } from 'react';
import { useChat } from '@/lib/hooks/useChat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const EMOTES = ['😂', '😍', '😡', '😭', '👏', '🔥', '👀'];

export function ChatPanel({ roomId, nickname }: { roomId: string; nickname: string }) {
  const { messages, send } = useChat(roomId, nickname);
  const [text, setText] = useState('');

  const submit = () => { if (text.trim()) { send('text', text); setText(''); } };

  return (
    <div className="flex h-[560px] flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3 font-bold">Room chat</div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto px-4 py-3">
        {messages.map((m) =>
          m.kind === 'emote' ? (
            <div key={m.id} className="text-2xl"><span className="text-xs text-muted-foreground">{m.name}: </span>{m.body}</div>
          ) : (
            <div key={m.id} className="text-sm leading-snug"><b className="text-[#f4c430]">{m.name}:</b> {m.body}</div>
          ),
        )}
        {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      <div className="flex gap-1 border-t px-2 py-2">
        {EMOTES.map((e) => (
          <button key={e} className="rounded p-1 text-xl hover:bg-muted" aria-label={`send ${e}`} onClick={() => send('emote', e)}>{e}</button>
        ))}
      </div>
      <div className="flex gap-2 border-t p-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Message room..." maxLength={280} />
        <Button onClick={submit}>Send</Button>
      </div>
    </div>
  );
}
