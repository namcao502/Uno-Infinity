import { setGlobalOptions } from 'firebase-functions/v2';
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
export { createRoom, joinRoom, addBot, leaveRoom, becomeAudience } from './rooms.js';
export { startGame, submitMove, nextRound, forceTimeout } from './game.js';
export { driveBots } from './bots.js';
