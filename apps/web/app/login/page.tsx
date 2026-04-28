'use client';

// Login page — Atlas wordmark + Per Scholas attribution, single Google
// sign-in restricted to the @perscholas.org Workspace domain.
//
// Three layers of access control work together:
//   1. queryParams.hd → tells Google's account chooser to only show
//      accounts on the perscholas.org Workspace. UX nicety; not a real
//      gate (someone could craft a different OAuth request).
//   2. /auth/callback → server-side check on the email domain after
//      the code exchange. If the email doesn't end in @perscholas.org
//      the user is signed out and bounced back here with an error.
//   3. handle_new_user() Postgres trigger → refuses to insert a row in
//      public.users for non-@perscholas.org emails. Defense in depth.
//
// We also surface ?error=domain_restricted from the callback so the user
// sees a friendly explanation instead of a generic OAuth failure page.

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const ALLOWED_DOMAIN = 'perscholas.org';

export default function LoginPage() {
  // useSearchParams must be inside Suspense per Next.js requirements.
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginShell />
    </Suspense>
  );
}

function LoginShell() {
  const searchParams = useSearchParams();
  const errorKind = searchParams?.get('error') ?? null;
  const attempted = searchParams?.get('attempted') ?? null;

  const supabase = createClient();

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Restricts Google's account chooser to the Per Scholas Workspace.
        // The hd parameter is honored by Google for hosted-domain accounts.
        queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
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
              {/* Per Scholas 30th Anniversary horizontal logo */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/per-scholas-logo.png"
                alt="Per Scholas"
                className="h-12 w-auto mb-5"
              />
              <h1 className="text-5xl font-bold tracking-tight text-night">
                Atlas
              </h1>
              <div className="text-sm text-gray-500 mt-3 max-w-xs">
                Workforce intelligence — live job-market mapping aligned to curriculum.
              </div>
            </div>
          </div>

          {errorKind === 'domain_restricted' && (
            <div className="mb-4 border border-orange/30 bg-orange/5 rounded-sm p-4 text-sm">
              <div className="font-semibold text-orange uppercase tracking-wider text-xs mb-1">
                Access restricted
              </div>
              <p className="text-gray-700">
                Atlas is for Per Scholas Workspace accounts only. The account you tried
                {attempted ? (
                  <>
                    {' '}— <code className="text-night">{attempted}</code> —{' '}
                  </>
                ) : ' '}
                isn&apos;t on the <code className="text-night">@{ALLOWED_DOMAIN}</code> domain.
                Please sign in with your Per Scholas email.
              </p>
            </div>
          )}
          {errorKind === 'oauth_failed' && (
            <div className="mb-4 border border-orange/30 bg-orange/5 rounded-sm p-4 text-sm">
              <div className="font-semibold text-orange uppercase tracking-wider text-xs mb-1">
                Sign-in failed
              </div>
              <p className="text-gray-700">
                Something went wrong during sign-in. Please try again.
              </p>
            </div>
          )}

          <Card>
            <div className="p-8">
              <h2 className="text-lg font-semibold text-night mb-1">Sign in</h2>
              <p className="text-sm text-gray-600 mb-6">
                Use your Per Scholas Workspace account to continue.
              </p>

              <Button
                variant="primary"
                size="md"
                onClick={signInWithGoogle}
                className="w-full"
              >
                <GoogleMark />
                Continue with Google
              </Button>

              <div className="mt-6 pt-6 border-t border-gray-100 text-xs text-gray-500">
                Access is restricted to <code className="text-night">@{ALLOWED_DOMAIN}</code>{' '}
                accounts. Admin permissions are granted to authorized Per Scholas staff only.
              </div>
            </div>
          </Card>

          <div className="mt-8 text-center text-xs text-gray-400">
            v1 · Atlas pilot · Per Scholas national workforce intelligence
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
