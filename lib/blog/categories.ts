/** Blog categories (Vin's topic list). A post's `category` must be one of these keys. */
export const CATEGORIES = {
  'using-anglemotion': {
    label: 'Using AngleMotion',
    description: 'Step-by-step guides to the AngleMotion tools.',
  },
  'video-analysis': {
    label: 'Video analysis',
    description: 'How to film, review and measure video of a stroke.',
  },
  technique: {
    label: 'Technique',
    description: 'Forehand, backhand, serve and volley technique.',
  },
  coaching: {
    label: 'Coaching',
    description: 'Coaching workflows and working with video.',
  },
  'pro-analysis': {
    label: 'Pro player analysis',
    description: 'Looking at how professional players move and hit.',
  },
  performance: {
    label: 'Movement and performance',
    description: 'Sports performance and movement analysis.',
  },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export function isCategory(value: string): value is CategoryKey {
  return Object.hasOwn(CATEGORIES, value);
}
