'use client';

// Login page — Atlas wordmark + Per Scholas attribution, single Google
// sign-in. Brand-aligned: white surface, navy/royal type, hairline border,
// generous negative space. Geometric brand-accent strip at the top per the
// brand book's "supergraphic" guidance.

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
    <div className="min-h-screen flex flex-col">
      <div className="brand-accent-bar" aria-hidden />
      <main className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <div className="inline-flex flex-col items-center">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-royal mb-3">
                Per Scholas
              </div>
              <h1 className="text-5xl font-bold tracking-tight text-night">
                Atlas
              </h1>
              <div className="text-sm text-gray-500 mt-3 max-w-xs">
                Workforce intelligence — live job-market mapping aligned to curriculum.
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-md p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-night mb-1">Sign in</h2>
            <p className="text-sm text-gray-600 mb-6">
              Use your Google or Per Scholas Workspace account to continue.
            </p>

            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full inline-flex items-center justify-center gap-3 bg-royal text-white hover:bg-navy transition-colors font-semibold py-2.5 px-4 rounded-sm text-sm"
            >
              <GoogleMark />
              Continue with Google
            </button>

            <div className="mt-6 pt-6 border-t border-gray-100 text-xs text-gray-500">
              Open access for any Google account. Admin role is granted to authorized
              Per Scholas staff only.
            </div>
          </div>

          <div className="mt-8 text-center text-xs text-gray-400">
            v1 · Atlas pilot · Atlanta · Critical Facilities Technician
          </div>
        </div>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#FFFFFF"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        opacity="0.9"
      />
      <path
        fill="#FFFFFF"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        opacity="0.7"
      />
      <path
        fill="#FFFFFF"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
        opacity="0.5"
      />
      <path
        fill="#FFFFFF"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
        opacity="0.8"
      />
    </svg>
  );
}
