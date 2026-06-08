/**
 * App-wide constants: brand colors (for JS/inline-style use), timings, limits,
 * and user-facing UI strings. Brand hex values live once in globals.css @theme;
 * the COLORS map below references them via CSS variables so JS stays in sync.
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

export const STRINGS = {
  common: {
    backToHome: 'Back to home',
    loading: 'Loading...',
    cancel: 'Cancel',
  },
  header: {
    signIn: 'Sign in with Google',
    signOut: 'Sign out',
    howToPlay: 'How to Play',
    houseRules: 'House Rules',
    about: 'About',
  },
  signInGate: {
    title: 'Sign in to play',
    subtitle: 'Create or join a room with your Google account. It only takes a moment.',
    cta: 'Continue with Google',
  },
  createJoin: {
    nicknameLabel: 'Your nickname',
    nicknamePlaceholder: 'Player',
    joinTitle: 'Join a room',
    createTitle: 'Create a room',
    roomCodeLabel: 'Room code',
    deckTitle: 'Deck & rules',
    publicToggle: 'List this room publicly so anyone can find and join it',
    joinAsPlayer: 'Join as player',
    watchAsAudience: 'Watch as audience',
    createRoom: 'Create room',
    browsePrompt: 'browse open rooms',
  },
  browser: {
    title: 'Open rooms',
    createRoom: 'Create a room',
    loading: 'Loading rooms...',
    emptyPrefix: 'No open rooms right now. ',
    emptyLink: 'Create one',
    inGame: 'In game',
    inLobby: 'In lobby',
    play: 'Play',
    watch: 'Watch',
    roomFull: 'Room is full',
  },
  lobby: {
    roomCode: 'Room code',
    copyLink: 'Copy link',
    players: 'Players',
    spectators: 'Spectators',
    addBot: 'Add bot',
    startGame: 'Start game',
    needTwo: 'Need at least 2 players',
    waitingForHost: 'Waiting for the host to start...',
    spectating: 'You are spectating this room.',
    notFound: 'Room not found.',
    loadingRoom: 'Loading room...',
  },
  leave: {
    button: 'Leave',
    title: 'Leave this room?',
    note: 'You can re-join only once after leaving.',
    leaveRoom: 'Leave room',
    becomeAudience: 'Become audience (keep watching)',
  },
  game: {
    dealing: 'Dealing...',
    draw: 'DRAW',
    deckSuffix: 'in deck',
    playSelected: 'Play selected',
    selectHint: 'Tap a card below to select, then Play.',
    keepCard: 'Keep card',
    drewPlayable: 'You drew a card you can play - play it, or keep it.',
    accept: 'Accept (draw 4)',
    shield: 'Shield',
    counter: 'Counter',
    inAudience: 'You are in the audience - watch & chat.',
    spectatingHand: 'You are spectating - watch & chat.',
    noCards: 'No cards.',
    close: 'Close',
    reconnecting: 'Reconnecting...',
    audienceBanner: 'You are in the audience - you can still watch and chat.',
    historyTitle: 'Game history',
    emptyHistory: 'No moves yet.',
    drawChain: 'Draw chain',
  },
  roundEnd: {
    gameOver: 'Game over',
    winnerDecided: 'Winner decided',
    backToLobby: 'Back to lobby',
  },
  chat: {
    title: 'Room chat',
    empty: 'No messages yet.',
    placeholder: 'Message room...',
    send: 'Send',
  },
  errors: {
    signInRequired: 'Please sign in to play.',
    googleRequired: 'Sign in with Google to play.',
    roomNotFound: 'Room not found.',
    alreadyStarted: 'That game already started.',
    roomFull: 'Room is full.',
    serverUnreachable: 'Cannot reach the game server. Please try again shortly.',
    generic: 'Something went wrong. Please try again.',
  },
} as const;
