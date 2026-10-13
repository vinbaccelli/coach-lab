import type { TourDef } from './types';
import { shot } from './shot';

const id = (k: string) => `[data-tour-id="${k}"]`;
const pic = (name: string, h: number, alt: string) => shot('decoder', name, h, alt);

/**
 * Match decoder — /decoder (components/decoder/MatchDecoderClient.tsx).
 * Add SwingVision screenshots, Read screenshots (tesseract.js OCR on the
 * device — no model anywhere in the flow), check what was read, type the
 * names, then the report and Save to Google Docs.
 */
export const DECODER_TOUR: TourDef = {
  id: 'decoder',
  title: 'Match decoder',
  summary: 'Turn your SwingVision screenshots into match statistics and a report.',
  feature: 'matchDecoder',
  steps: [
    {
      id: 'upload',
      title: 'Add your SwingVision screenshots',
      body: 'Tap the box and pick the match’s stats and point-by-point screenshots, up to 25. Scrolled captures of the same screen are fine — they get stitched.',
      target: 'dec-upload',
      advance: { kind: 'visible', selector: `${id('dec-file')}, ${id('dec-counts')}` },
      skipIf: `${id('dec-file')}, ${id('dec-counts')}`,
      image: pic('upload', 221, 'Upload your SwingVision screenshots: a box to add up to 25 screenshots and a Read screenshots button.'),
    },
    {
      id: 'read',
      title: 'Read screenshots',
      body: 'Check the list — Remove takes one out — then press Read screenshots. They are read on this device with text recognition (OCR): no AI is involved and nothing is estimated.',
      target: 'dec-read',
      advance: { kind: 'visible', selector: id('dec-counts') },
      skipIf: id('dec-counts'),
      image: pic('read', 234, 'The upload box showing 15 of 25 screenshots added, with each file listed and a Remove link.'),
    },
    {
      id: 'counts',
      title: 'What was read',
      body: 'How many stats and timeline screenshots it recognised, and how many games and points it found. If something is missing, Start over with different screenshots.',
      target: 'dec-counts',
      advance: { kind: 'next' },
    },
    {
      id: 'names',
      title: 'Who played?',
      body: 'Pick Singles or Doubles and type the names — that is the only thing to fill in. Names are never read from the screenshots. Who served each game is worked out for you; if the two sides look reversed, press Swap sides.',
      target: 'dec-setup',
      advance: { kind: 'next' },
    },
    {
      id: 'report',
      title: 'The match report',
      body: 'One report per side: general stats, unforced errors, winners, serve and return, shot and spin distribution. Every number is read from your screenshots; where something could not be read, the report says so instead of filling the gap.',
      target: 'dec-report',
      advance: { kind: 'next' },
      image: pic('report', 300, 'The top of the match report: Side A, General stats & indices, with points won and winners for this side and the opponent.'),
    },
    {
      id: 'summary',
      title: 'Coach’s summary',
      body: 'Observations computed from the figures above. Each line names the numbers it rests on — none of it is written by a language model.',
      target: 'dec-section-summary',
      advance: { kind: 'next' },
      image: pic('summary', 257, 'The Coach’s summary: six lines such as “Most unforced errors came off the forehand: 5 of 9 (56%)”.'),
    },
    {
      id: 'save',
      title: 'Save to Google Docs',
      body: 'Choose whose stats to include — one side or both — and which player’s doc they go into. You can add a new player right there.',
      target: 'dec-save',
      advance: { kind: 'next' },
      image: pic('save', 103, 'The Save to Google Docs button under the Coach’s summary.'),
    },
  ],
};
