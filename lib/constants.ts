/**
 * App-wide constants: brand colors (for JS/inline-style use), timings, and limits.
 * Brand hex values live once in globals.css @theme; the COLORS map below references
 * them via CSS variables so JS stays in sync. User-facing strings live in lib/i18n
 * (en/vi dictionaries) - use the useT() hook.
 */

export const COLORS = {
  yellow: 'var(--color-lc-yellow)',
  red: 'var(--color-lc-red)',
  green: 'var(--color-lc-green)',
  blue: 'var(--color-lc-blue)',
  black: 'var(--color-lc-black)',
  table: 'var(--color-lc-table)',
  ink: 'var(--color-lc-ink)',
  white: '#ffffff',
} as const;

/** Card fill color by card color. */
export const CARD_COLORS: Record<'red' | 'green' | 'blue' | 'yellow' | 'black', string> = {
  red: COLORS.red,
  green: COLORS.green,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
  black: COLORS.black,
};

export const TIMING = {
  /** Long-press duration to open card inspect. */
  longPressMs: 400,
  /** Backup delay before a non-active client forces a turn timeout. */
  timeoutBackupMs: 2000,
  /** Server-clock tick interval for countdowns. */
  serverTickMs: 500,
  /** Seconds a disconnected player has to reconnect before removal. */
  reconnectSeconds: 30,
  /** Seconds remaining at which the turn timer turns red. */
  timerWarnSeconds: 3,
  /** Delay before the lobby shows "room not found". */
  roomNotFoundMs: 4000,
} as const;

export const LIMITS = {
  nicknameMax: 20,
  roomCodeLength: 4,
  chatMax: 280,
} as const;
