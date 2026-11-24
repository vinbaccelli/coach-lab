/** Pure logic for the player share link: token, settings validation, email check, rate limit. */
import { createHash, randomBytes } from 'node:crypto';

export type ShareMode = 'view' | 'edit';

/** A new unguessable token (32 random bytes, URL-safe). */
export const newShareToken = (): string => randomBytes(32).toString('base64url');

export const hashShareToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Tokens we generate are exactly 43 URL-safe characters; reject anything else before touching the database. */
export const looksLikeShareToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateShareSettings(body: unknown): { ok: true; mode: ShareMode; allowed_email: string | null } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = b.mode === 'edit' ? 'edit' : b.mode === 'view' ? 'view' : null;
  if (!mode) return { ok: false, error: 'mode must be view or edit' };
  const raw = typeof b.allowed_email === 'string' ? b.allowed_email.trim() : '';
  if (raw && (raw.length > 254 || !EMAIL.test(raw))) return { ok: false, error: 'That email does not look right' };
  return { ok: true, mode, allowed_email: raw ? raw.toLowerCase() : null };
}

/** Email gate. No allowed email = open. Case and spaces ignored. (A typed-in check, not a verified login.) */
export function emailAllowed(allowed: string | null | undefined, typed: string | null | undefined): boolean {
  if (!allowed) return true;
  return (typed ?? '').trim().toLowerCase() === allowed.trim().toLowerCase();
}

/** At most this many things can be added through one link per hour (spam / abuse brake). */
export const LINK_ADDS_PER_HOUR = 30;
export const withinLinkLimit = (addedInLastHour: number): boolean => addedInLastHour < LINK_ADDS_PER_HOUR;
