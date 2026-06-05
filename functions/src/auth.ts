import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/**
 * Require a signed-in, non-anonymous (Google) caller and return their uid.
 * Mirrors the client-side gate so the rule holds even if the client is bypassed.
 */
export function requireHuman(auth: CallableRequest['auth']): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first');
  if (auth.token?.firebase?.sign_in_provider === 'anonymous')
    throw new HttpsError('permission-denied', 'Sign in with Google to play');
  return auth.uid;
}
