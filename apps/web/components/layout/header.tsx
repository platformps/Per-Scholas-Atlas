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
      {/*
        Mobile: stack title block above nav (flex-col).
        sm+:    side-by-side single-row layout (sm:flex-row sm:justify-between).

        At narrow widths the title block + subtitle + nav can't fit on one
        row, so we used to see the wrapped subtitle visually colliding with
        the nav pills. Stacking eliminates that collision and gives both
        regions full available width.
      */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-5 flex flex-col gap-3 sm:gap-6 sm:flex-row sm:items-center sm:justify-between">
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
              className="h-8 sm:h-10 w-auto shrink-0"
            />
            <div className="hidden sm:block h-10 w-px bg-gray-200 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-night leading-none">
                  Atlas
                </h1>
                {subtitle}
              </div>
              {meta && (
                <div className="hidden sm:block text-xs text-gray-500 mt-1.5 line-clamp-1">
                  {meta}
                </div>
              )}
            </div>
          </Link>
        </div>
        {/*
          Mobile: nav row aligns to the start (left), with horizontal scroll
          if pills overflow (rare — only happens for admin users with FAQ +
          Admin both visible on a very narrow phone).
          sm+: shrink-0 right-anchored on the same line as the title.
        */}
        <nav className="flex items-center gap-1.5 sm:gap-3 shrink-0 -mx-1 sm:mx-0 overflow-x-auto sm:overflow-visible">
          {nav}
        </nav>
      </div>
    </header>
  );
}

// ─── Nav links ──────────────────────────────────────────────────────────────

import { LogOut } from 'lucide-react';
import { UserMenu } from './user-menu';

type ActivePage = 'home' | 'admin' | 'faq';

interface NavLinksProps {
  email?: string;
  showAdminLink?: boolean;
  /** Which page is currently active — drives the highlighted pill. */
  active?: ActivePage;
  /** Currently pinned home campus id from the session. Drives the
   *  selected option in the user menu's home-campus picker. */
  pinnedCampusId?: string | null;
}

export function NavLinks({
  email,
  showAdminLink,
  active,
  pinnedCampusId = null,
}: NavLinksProps) {
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
          <UserMenu email={email} pinnedCampusId={pinnedCampusId} />
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

// UserPill replaced by <UserMenu> (./user-menu.tsx) — same visual chrome
// plus a click-target dropdown with a home-campus picker and sign-out.
