/**
 * Italian fiscal identifiers a coach enters on /billing for their fattura
 * elettronica: Codice Fiscale, Partita IVA, Codice Destinatario (SdI) and PEC.
 * Pure validation + normalisation, unit-tested (tests/italianFields.test.ts).
 * The same shapes are CHECK constraints in billing_profiles (SQL).
 */

export interface ItalianFields {
  codice_fiscale: string | null;
  partita_iva: string | null;
  codice_destinatario: string | null;
  pec: string | null;
}

export type ItalianFieldErrors = Partial<Record<keyof ItalianFields, string>>;

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '');

// Codice Fiscale check character (DM 23/12/1976): odd-position values below,
// even positions count 0–9 / A=0…Z=25, total mod 26 → letter.
const CF_ODD: Record<string, number> = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const evenValue = (c: string) => (/[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65);

/** A person's 16-character Codice Fiscale with a valid check letter (omocodia letters allowed). */
export function isValidPersonCF(cf: string): boolean {
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? CF_ODD[cf[i]] : evenValue(cf[i]);
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** An 11-digit Partita IVA (or a company's numeric Codice Fiscale) with a valid check digit. */
export function isValidPartitaIva(piva: string): boolean {
  if (!/^[0-9]{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(piva[i]);
    if (i % 2 === 0) sum += d;
    else sum += d * 2 > 9 ? d * 2 - 9 : d * 2;
  }
  return (10 - (sum % 10)) % 10 === Number(piva[10]);
}

export function isValidCodiceFiscale(cf: string): boolean {
  return cf.length === 11 ? isValidPartitaIva(cf) : isValidPersonCF(cf);
}

/**
 * Normalise and validate what the form sent. Empty = null. Returns the clean
 * values, or the per-field errors (Italian-facing copy in English, as the app).
 */
export function parseItalianFields(input: Record<string, unknown>):
  { ok: true; value: ItalianFields } | { ok: false; errors: ItalianFieldErrors } {
  const cf = clean(input.codice_fiscale);
  const piva = clean(input.partita_iva).replace(/^IT/, '');
  const cd = clean(input.codice_destinatario);
  const pec = typeof input.pec === 'string' ? input.pec.trim().toLowerCase() : '';
  const errors: ItalianFieldErrors = {};

  if (cf && !isValidCodiceFiscale(cf)) errors.codice_fiscale = 'This Codice Fiscale is not valid. Check it on your tessera sanitaria.';
  if (piva && !isValidPartitaIva(piva)) errors.partita_iva = 'This Partita IVA is not valid (11 digits).';
  if (cd && !/^[A-Z0-9]{7}$/.test(cd)) errors.codice_destinatario = 'The Codice Destinatario has 7 letters or digits.';
  if (pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) errors.pec = 'This PEC address is not valid.';
  if (pec.length > 256) errors.pec = 'This PEC address is too long.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { codice_fiscale: cf || null, partita_iva: piva || null, codice_destinatario: cd || null, pec: pec || null },
  };
}
