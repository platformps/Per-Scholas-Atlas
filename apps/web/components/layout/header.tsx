// App header — Per Scholas logo + Atlas wordmark + page-specific subtitle
// area + user/nav block on the right. Used across the dashboard, admin, and
// any future authenticated pages. The subtitle slot is a render prop so the
// dashboard can put its CampusRolePicker there while the admin page can put
// "Admin · Operations".
//
// Layout: logo · divider · {Atlas + subtitle area + meta line} · spacer · nav
// On mobile (<sm) the nav collapses to icons-only / smaller text. We keep the
// header single-row to preserve the brand's clean horizontal supergraphic.

import type { ReactNode } from 'react';

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
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
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
        </div>
        <nav className="flex items-center gap-3 sm:gap-5 text-sm shrink-0">
          {nav}
        </nav>
      </div>
    </header>
  );
}

// ─── Common nav links ──────────────────────────────────────────────────────

interface NavLinksProps {
  email?: string;
  showAdminLink?: boolean;
  showDashboardLink?: boolean;
}

export function NavLinks({ email, showAdminLink, showDashboardLink }: NavLinksProps) {
  return (
    <>
      {showDashboardLink && (
        <a
          href="/"
          className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          Dashboard
        </a>
      )}
      {showAdminLink && (
        <a
          href="/admin"
          className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs transition-colors duration-150"
        >
          Admin
        </a>
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
