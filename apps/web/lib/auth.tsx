'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

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
  const signInGoogle = async () => { await signInWithPopup(auth, new GoogleAuthProvider()); };
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
