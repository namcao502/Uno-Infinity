const FAN = [
  { label: '7', bg: '#2b6cb0', rot: -22, x: -110 },
  { label: '+2', bg: '#2a9d4a', rot: -9, x: -55 },
  { label: '⚠', bg: '#e63946', rot: 2, x: 0 },
  { label: '0', bg: '#f4c430', rot: 13, x: 55, dark: true },
  { label: '+4', bg: '#15161c', rot: 24, x: 110 },
];

export function CardFan() {
  return (
    <div className="relative flex h-[300px] items-center justify-center">
      {FAN.map((c, i) => (
        <div
          key={i}
          className="absolute flex h-44 w-30 items-center justify-center rounded-2xl border-4 border-white text-5xl font-extrabold shadow-2xl"
          style={{
            background: c.bg,
            color: c.dark ? '#1a1500' : '#fff',
            transform: `rotate(${c.rot}deg) translateX(${c.x}px)`,
            zIndex: i,
            width: '7.5rem',
            height: '11rem',
          }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}
