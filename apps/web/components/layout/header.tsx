// App header — Per Scholas logo + Atlas wordmark + page-specific subtitle
// area + user/nav block on the right. Used across the dashboard, admin, FAQ,
// and any future authenticated pages.
//
// Visual chrome: soft 1px shadow under the header so it elevates above the
// content cards. Logo + Atlas wordmark are a single Link to "/" so clicking
// either returns the user to the aggregate homepage.
//
// Nav layout (right side): three groups separated by a thin vertical rule.
//   [ Home · FAQ · Admin ]   |   [ user pill ]   |   [ sign-out icon ]
//
//   Group 1 (primary nav)  — page links rendered as pill buttons. The active
//                            page gets a Royal-tinted fill so the user always
//                            knows where they are.
//   Group 2 (user pill)    — circular initial chip + email (md+ only). Reads
//                            as "you are signed in as X".
//   Group 3 (sign-out)     — small icon-only button with an aria-label. Less
//                            visible than the page links so it doesn't compete,
//                            but discoverable on hover.

import type { ReactNode } from 'react';
import Link from 'next/link';

interface HeaderProps {
  /** Slot rendered next to the Atlas wordmark. Typically a campus/role picker
   *  or a static "Admin · Operations" label. */
  subtitle: ReactNode;
  /** Small grey line under the Atlas+subtitle row — meta info like address, last fetch. */
  meta?: ReactNode;
  /** Right-side nav. Pass <NavLinks /> below or any custom content. */
  nav: ReactNode;
}

export function Header({ subtitle, meta, nav }: HeaderProps) {
  return (
    <header className="border-b border-gray-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          <Link
            href="/"
            aria-label="Atlas home"
            className="flex items-center gap-3 sm:gap-5 min-w-0 rounded-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-royal/30 transition-opacity duration-150"
          >
            {/* Per Scholas 30th Anniversary horizontal logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/per-scholas-logo.png"
              alt="Per Scholas"
              className="h-9 sm:h-10 w-auto shrink-0"
            />
            <div className="hidden sm:block h-10 w-px bg-gray-200 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-night leading-none">
                  Atlas
                </h1>
                {subtitle}
              </div>
              {meta && (
                <div className="text-xs text-gray-500 mt-1.5 line-clamp-2 sm:line-clamp-1">
                  {meta}
                </div>
              )}
            </div>
          </Link>
        </div>
        <nav className="flex items-center gap-2 sm:gap-3 shrink-0">{nav}</nav>
      </div>
    </header>
  );
}

// ─── Nav links ──────────────────────────────────────────────────────────────

import { LogOut } from 'lucide-react';

type ActivePage = 'home' | 'admin' | 'faq';

interface NavLinksProps {
  email?: string;
  showAdminLink?: boolean;
  /** Which page is currently active — drives the highlighted pill. */
  active?: ActivePage;
}

export function NavLinks({ email, showAdminLink, active }: NavLinksProps) {
  return (
    <>
      <div className="flex items-center gap-1">
        <NavPill href="/" label="Home" isActive={active === 'home'} />
        <NavPill href="/faq" label="FAQ" isActive={active === 'faq'} />
        {showAdminLink && (
          <NavPill href="/admin" label="Admin" isActive={active === 'admin'} />
        )}
      </div>

      {email && (
        <>
          <span
            className="hidden md:inline-block h-6 w-px bg-gray-200 mx-1"
            aria-hidden
          />
          <UserPill email={email} />
        </>
      )}

      <a
        href="/auth/signout"
        aria-label="Sign out"
        title="Sign out"
        className="inline-flex items-center justify-center h-9 w-9 rounded-sm text-gray-500 hover:text-night hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-royal/30 transition-colors duration-150"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </a>
    </>
  );
}

// ─── A single nav pill (primary link button) ────────────────────────────────
function NavPill({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-royal/30',
        isActive
          ? 'bg-royal/10 text-royal'
          : 'text-gray-600 hover:text-night hover:bg-gray-100',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

// ─── User pill — initial chip + email (md+) ─────────────────────────────────
function UserPill({ email }: { email: string }) {
  const initial = email.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className="inline-flex items-center gap-2 rounded-sm py-1 pl-1 md:pr-3 bg-transparent"
      title={email}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center h-7 w-7 rounded-sm bg-royal/10 text-royal text-xs font-semibold"
      >
        {initial}
      </span>
      <span className="hidden md:inline text-sm text-gray-700 truncate max-w-[180px]">
        {email}
      </span>
    </div>
  );
}
