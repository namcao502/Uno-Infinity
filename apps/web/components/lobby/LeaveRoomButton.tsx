'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callLeaveRoom, callBecomeAudience } from '@/lib/functions';
import { Button } from '@/components/ui/button';

/** Leave control with a confirm dialog: leave the room, or stay as a spectator. */
export function LeaveRoomButton({ roomId, canBecomeAudience = true }: { roomId: string; canBecomeAudience?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    setBusy(true);
    try { await callLeaveRoom({ roomId }); router.push('/'); }
    catch { setBusy(false); }
  };
  const audience = async () => {
    setBusy(true);
    try { await callBecomeAudience({ roomId }); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Leave</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Leave this room?</h3>
            <p className="mt-1 text-sm text-muted-foreground">You can re-join only once after leaving.</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button disabled={busy} onClick={leave} className="bg-[#e63946] text-white hover:bg-[#e63946]/90">Leave room</Button>
              {canBecomeAudience && (
                <Button disabled={busy} variant="outline" onClick={audience}>Become audience (keep watching)</Button>
              )}
              <Button disabled={busy} variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
