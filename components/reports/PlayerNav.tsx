'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import StickyBack from '@/components/reports/StickyBack';

/**
 * ONE pinned navigation bar for the player pages: Players / <name> / Reports.
 * Replaces the separate "← Players" link (profile) and "← <name>" link (reports),
 * so there is a single control that stays in view. Compact for 390 px: the player's
 * name is the one part that shrinks (ellipsis); every link keeps a 44 px touch height.
 *
 * `current` is the page being shown and is not a link: 'profile' → Players / name;
 * 'reports' → Players / name / Reports; 'report' → the same, with Reports as the
 * link back to the list (the report's own title is the page heading).
 */
/** Shown instead of a report page when the player no longer exists. */
export function PlayerNotFound() {
  return (
    <div style={{ padding: '32px 0', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Player not found</h1>
      <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
        This player no longer exists, or isn’t in your list. Their reports are gone with them.
      </p>
      <Link href="/players" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 12, background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
        Back to Players
      </Link>
    </div>
  );
}

export default function PlayerNav({
  playerId,
  playerName,
  current,
  maxWidth = 720,
}: {
  playerId: string;
  playerName?: string;
  current: 'profile' | 'reports' | 'report';
  maxWidth?: number;
}) {
  const name = playerName?.trim() || 'Player';
  const link: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    color: 'var(--cl-accent)',
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  };
  const here: CSSProperties = { ...link, color: 'var(--cl-text-primary)' };
  const sep = (
    <span aria-hidden style={{ color: 'var(--cl-text-muted)', fontSize: 14, padding: '0 6px', flexShrink: 0 }}>
      /
    </span>
  );
  const nameStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: '100%' };

  return (
    <StickyBack maxWidth={maxWidth}>
      <nav aria-label="Player navigation" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <Link href="/players" style={{ ...link, gap: 4, flexShrink: 0 }}>
          <ArrowLeft size={16} aria-hidden /> Players
        </Link>
        {sep}
        {current === 'profile' ? (
          <span aria-current="page" style={{ ...here, minWidth: 0, flex: '0 1 auto' }}>
            <span style={nameStyle}>{name}</span>
          </span>
        ) : (
          <Link href={`/players/${playerId}`} style={{ ...link, minWidth: 0, flex: '0 1 auto' }}>
            <span style={nameStyle}>{name}</span>
          </Link>
        )}
        {current !== 'profile' ? (
          <>
            {sep}
            {current === 'reports' ? (
              <span aria-current="page" style={{ ...here, flexShrink: 0 }}>Reports</span>
            ) : (
              <Link href={`/players/${playerId}/reports`} style={{ ...link, flexShrink: 0 }}>
                Reports
              </Link>
            )}
          </>
        ) : null}
      </nav>
    </StickyBack>
  );
}
