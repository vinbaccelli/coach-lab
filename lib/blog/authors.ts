/**
 * Author boxes. `bio` repeats only what Vin's public profile already says
 * (lib/coach/curated/vinbaccelli.ts bioLines + directoryBlurb, and the About
 * section on /coach/vinbaccelli, read 2026-11-18). Add no credential that is
 * not on his profile.
 */
export interface Author {
  name: string;
  /** Site-relative profile path. */
  url: string;
  bio: string;
}

export const AUTHORS: Record<string, Author> = {
  'Vin Baccelli': {
    name: 'Vin Baccelli',
    url: '/coach/vinbaccelli',
    bio:
      'PTR-certified tennis coach in Milan and founder of AngleMotion. He earned a scholarship to play NCAA Division I tennis at Lindenwood University, has worked in video analysis for over 7 years and has coached 1,000+ players.',
  },
};

export function getAuthor(name: string): Author | undefined {
  return AUTHORS[name];
}
