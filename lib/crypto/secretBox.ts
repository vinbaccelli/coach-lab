import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated symmetric encryption for secrets held in our own tables.
 *
 * WHY THIS EXISTS
 * Supabase encrypts at rest already, so this is not about the disk — it is about
 * the key living somewhere the database does not. A leaked backup, or a leaked
 * service-role key, yields ciphertext and nothing else unless the attacker also
 * has the environment. That separation is the whole point; keep
 * YOUTUBE_TOKEN_ENC_KEY out of the database and out of the repo.
 *
 * AES-256-GCM rather than CBC: GCM authenticates as well as encrypts, so a
 * tampered payload fails loudly on decrypt instead of quietly producing garbage
 * that then gets sent to Google as a refresh token.
 *
 * SERVER ONLY. `node:crypto` is unavailable in the browser and the key must
 * never reach it.
 */

const ALGORITHM = 'aes-256-gcm';
/** 96 bits — the size GCM is specified for; larger IVs cost an extra hash step. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Decode the key from the environment. Accepts base64 (44 chars with padding) or
 * hex (64 chars) — whichever the operator pasted — and insists on exactly 32
 * decoded bytes, because a short key silently weakens every payload written with
 * it and the failure would otherwise never surface.
 */
function loadKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `${envName} is not configured. Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\n` +
        `and set it in .env.local (and the Vercel project env).`,
    );
  }
  const trimmed = raw.trim();

  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) candidates.push(Buffer.from(trimmed, 'hex'));
  candidates.push(Buffer.from(trimmed, 'base64'));

  const key = candidates.find((b) => b.length === KEY_BYTES);
  if (!key) {
    throw new Error(
      `${envName} must decode to exactly ${KEY_BYTES} bytes ` +
        `(base64 of 32 random bytes, or 64 hex chars). ` +
        `Got ${candidates[candidates.length - 1].length} bytes after decoding.`,
    );
  }
  return key;
}

/**
 * Encrypt `plaintext`, returning `iv:tag:ciphertext` with each part base64.
 *
 * The IV is random per call and stored alongside — that is its intended use, it
 * is not secret. What must never repeat for a given key is the IV itself, which
 * `randomBytes` at 96 bits makes negligible for our volume.
 */
export function encryptSecret(plaintext: string, envName = 'YOUTUBE_TOKEN_ENC_KEY'): string {
  const key = loadKey(envName);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Reverse of `encryptSecret`. Throws on a malformed payload, a wrong key, or any
 * tampering — GCM's tag check is what turns "wrong key" into an exception rather
 * than silent nonsense. Callers should treat a throw as "this connection is
 * unusable, ask the coach to reconnect", never as a reason to fall back to an
 * unauthenticated path.
 */
export function decryptSecret(payload: string, envName = 'YOUTUBE_TOKEN_ENC_KEY'): string {
  const key = loadKey(envName);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload — expected "iv:tag:ciphertext".');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  if (iv.length !== IV_BYTES) throw new Error('Malformed encrypted payload — bad IV length.');
  if (tag.length !== 16) throw new Error('Malformed encrypted payload — bad auth tag length.');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** True when the key is present and well-formed — for health checks, not for control flow. */
export function secretKeyConfigured(envName = 'YOUTUBE_TOKEN_ENC_KEY'): boolean {
  try {
    loadKey(envName);
    return true;
  } catch {
    return false;
  }
}
