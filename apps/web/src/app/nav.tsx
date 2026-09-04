'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/sources', label: 'Data Sources' },
  { href: '/production', label: 'Production Lines' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-4">
        <span className="text-sm font-semibold tracking-wide text-[var(--color-text)]">
          Celesnity <span className="font-normal text-[var(--color-text-muted)]">factory platform</span>
        </span>
        <nav className="flex gap-1">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-black/5'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
