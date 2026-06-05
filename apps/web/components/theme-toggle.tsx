'use client';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The theme is only known on the client (from localStorage / system),
  // so defer theme-dependent text until after mount to avoid a hydration mismatch.
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted ? (isDark ? 'Light' : 'Dark') : <span className="opacity-0">Dark</span>}
    </Button>
  );
}
