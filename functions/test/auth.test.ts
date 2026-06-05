import { describe, it, expect } from 'vitest';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { requireHuman } from '../src/auth.js';

type Auth = CallableRequest['auth'];

function authWith(provider: string): Auth {
  return { uid: 'u1', token: { firebase: { sign_in_provider: provider } } } as unknown as Auth;
}

function codeOf(fn: () => void): string {
  try { fn(); } catch (e) { if (e instanceof HttpsError) return e.code; throw e; }
  throw new Error('expected requireHuman to throw');
}

describe('requireHuman', () => {
  it('returns the uid for a Google caller', () => {
    expect(requireHuman(authWith('google.com'))).toBe('u1');
  });
  it('rejects a missing caller as unauthenticated', () => {
    expect(codeOf(() => requireHuman(undefined))).toBe('unauthenticated');
  });
  it('rejects an anonymous caller as permission-denied', () => {
    expect(codeOf(() => requireHuman(authWith('anonymous')))).toBe('permission-denied');
  });
});
