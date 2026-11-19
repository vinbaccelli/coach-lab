/** Academy divisions (Vin's list). A post's `category` must be one of these keys.
 *  A division with no published posts is hidden from the index, the sitemap and its own page. */
export const CATEGORIES = {
  tutorials: {
    label: 'Tutorials',
    description: 'Step-by-step guides to video analysis with the AngleMotion tools.',
  },
  articles: {
    label: 'Articles',
    description: 'Short articles on analysing tennis strokes on video, also published as Instagram carousels.',
  },
  ebooks: {
    label: 'eBooks',
    description: 'eBooks by Vin Baccelli, analysed with the AngleMotion skeleton, motion layer and snapshots.',
  },
  'pro-analysis': {
    label: 'Pro player analysis',
    description: 'Looking at how professional players move and hit.',
  },
  coaching: {
    label: 'Coaching',
    description: 'Coaching workflows and working with video.',
  },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export function isCategory(value: string): value is CategoryKey {
  return Object.hasOwn(CATEGORIES, value);
}
