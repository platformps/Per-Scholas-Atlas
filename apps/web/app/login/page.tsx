'use client';

import { createClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  const supabase = createClient();

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) console.error('Sign-in error:', error);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md border border-zinc-800 bg-zinc-950/40 p-8">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
          Per Scholas Job Intelligence
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 mb-2">
          Sign in
        </h1>
        <p className="text-sm text-zinc-400 mb-8">
          Use your Google account to access the dashboard.
        </p>
        <button
          onClick={signInWithGoogle}
          className="w-full bg-zinc-100 text-zinc-900 hover:bg-white font-medium py-2.5 px-4 transition-colors"
        >
          Continue with Google
        </button>
        <div className="mt-6 text-xs font-mono text-zinc-600">
          v1 · open access for all Google accounts
        </div>
      </div>
    </main>
  );
}
