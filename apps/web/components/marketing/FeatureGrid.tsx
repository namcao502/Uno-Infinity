const FEATURES = [
  { icon: '⚙', tint: 'rgba(230,57,70,0.16)', title: 'Full deck builder', body: 'Tune every card count - draw stacks, x2/÷2, duels, bombs, shields, swaps, 7-0 style specials. Save it on the room.' },
  { icon: '⚡', tint: 'rgba(43,108,176,0.16)', title: 'Instant rooms', body: 'Private codes, live sync via Firebase, reconnect to your seat if you drop. Bots fill empty chairs.' },
  { icon: '💬', tint: 'rgba(42,157,74,0.16)', title: 'Chat & emotes', body: 'Talk smack in-room, fire emoji reactions, and enjoy snappy card animations and sound.' },
];

export function FeatureGrid() {
  return (
    <section className="mt-16 grid gap-4 md:grid-cols-3">
      {FEATURES.map((f) => (
        <div key={f.title} className="rounded-xl border bg-card p-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg text-xl" style={{ background: f.tint }}>
            {f.icon}
          </div>
          <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
        </div>
      ))}
    </section>
  );
}
