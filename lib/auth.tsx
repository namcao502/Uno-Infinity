'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { toast } from 'sonner';
import { auth } from './firebase';

/** Map a Firebase Auth error code to a user-facing message, keeping the raw code for unmapped cases. */
function authErrorMessage(code: string): string {
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this project.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for sign-in.';
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by the browser.';
    default:
      return `Sign-in failed${code ? ` (${code})` : ''}. Please try again.`;
  }
}

interface AuthCtx {
  user: User | null;
  nickname: string;
  setNickname: (n: string) => void;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  ready: boolean;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNick] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('nickname') ?? '' : '';
    setNick(stored);
    // No auto sign-in: just resolve the current auth state. The user may be null.
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Prefill the nickname from the Google profile only when the user has not set one.
      if (u && !stored && u.displayName) setNick(u.displayName.slice(0, 20));
      setReady(true);
    });
    return unsub;
  }, []);

  const setNickname = (n: string) => { setNick(n); localStorage.setItem('nickname', n); };
  const signInGoogle = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // The user dismissing the popup themselves is not an error worth surfacing.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      toast.error(authErrorMessage(code));
    }
  };
  const signOutUser = async () => { await signOut(auth); };

  return (
    <Ctx.Provider value={{ user, nickname, setNickname, signInGoogle, signOutUser, ready }}>
      {children}
    </Ctx.Provider>
  );
}
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
};
