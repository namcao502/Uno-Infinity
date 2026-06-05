'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';

export function SignInGate() {
  const { signInGoogle } = useAuth();
  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-black">Sign in to play</h1>
      <p className="text-muted-foreground">
        Create or join a room with your Google account. It only takes a moment.
      </p>
      <Button
        onClick={() => { signInGoogle().catch(() => {}); }}
        className="w-full bg-[#f4c430] text-[#1a1500] hover:bg-[#f4c430]/90"
      >
        Continue with Google
      </Button>
      <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        Back to home
      </Link>
    </div>
  );
}
