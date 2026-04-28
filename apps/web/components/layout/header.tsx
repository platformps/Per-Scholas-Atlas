// App header — Per Scholas logo + Atlas wordmark + page-specific subtitle
// area + user/nav block on the right. Used across the dashboard, admin, and
// any future authenticated pages. The subtitle slot is a render prop so each
// page can put its own context (campus picker, "Admin · Operations", etc.).
//
// Layout: logo · divider · {Atlas + subtitle + meta line} · spacer · nav
//
// Visual chrome: the header carries a soft shadow (shadow-[0_1px_3px_rgba(...)])
// so it sits visibly above the content cards instead of looking flush with the
// page background. The logo + Atlas wordmark are wrapped in a Link to "/" so
// clicking either takes the user back to the aggregate homepage — that's the
// universal "home" affordance and removes the need for a separate Home button
// in every nav.

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
        <nav className="flex items-center gap-3 sm:gap-5 text-sm shrink-0">
          {nav}
        </nav>
      </div>
    </header>
  );
}

// ─── Common nav links ──────────────────────────────────────────────────────
//
// "Home" appears whenever the user is on a non-aggregate view — i.e. has any
// filter selected or is on /admin. The clickable wordmark covers the same
// affordance, but a dedicated link in the nav makes it discoverable for users
// who don't think to click the logo.

interface NavLinksProps {
  email?: string;
  showAdminLink?: boolean;
  showDashboardLink?: boolean;
  /** When true, render an explicit "Home" link to /. Use this when the
   *  current URL has filters set OR the user is on /admin or /faq. */
  showHomeLink?: boolean;
  /** When true, hide the FAQ link (use on /faq itself). Default: show. */
  hideFaqLink?: boolean;
}

export function NavLinks({
  email,
  showAdminLink,
  showDashboardLink,
  showHomeLink,
  hideFaqLink = false,
}: NavLinksProps) {
  return (
    <>
      {showHomeLink && (
        <Link
          href="/"
          className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          Home
        </Link>
      )}
      {showDashboardLink && (
        <Link
          href="/"
          className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          Dashboard
        </Link>
      )}
      {!hideFaqLink && (
        <Link
          href="/faq"
          className="text-gray-600 hover:text-night font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          FAQ
        </Link>
      )}
      {showAdminLink && (
        <Link
          href="/admin"
          className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          Admin
        </Link>
      )}
      {email && <span className="hidden md:inline text-gray-600">{email}</span>}
      <a
        href="/auth/signout"
        className="text-gray-500 hover:text-gray-800 uppercase tracking-wider text-xs transition-colors duration-150"
      >
        Sign out
      </a>
    </>
  );
}
