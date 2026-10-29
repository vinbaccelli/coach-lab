import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualReport } from '../lib/tennis/manualReportModel';
import { aggregateManualStats, type LoggedPoint } from '../lib/tennis/compileManualReport';
import { emptyFormattedBoard } from '../lib/tennis/matchFormat';
import { describeStartingScore } from '../lib/tennis/startingScore';
import { deriveBlocks, type EntryLike } from '../lib/reports/deriveBlocks';
import { manualMatchToReportInput } from '../lib/reports/manualMatchInput';

const points: LoggedPoint[] = [];
for (let i = 0; i < 30; i++) {
  points.push({
    winner: i % 2 ? 'player' : 'opponent',
    server: i % 4 < 2 ? 'player' : 'opponent',
    outcome:
      i % 3 === 0
        ? { kind: 'winner', stroke: 'Forehand' }
        : i % 3 === 1
          ? { kind: 'ue', stroke: 'Backhand' }
          : { kind: 'serve', detail: 'ace' },
  });
}

/** The same shape components/ManualMatchRecorder.tsx saves as `matchMetadata`. */
function recorderMetadata(startingScore: unknown) {
  return {
    manualMatch: {
      version: 2,
      playerName: 'Vin',
      opponentName: 'Luca',
      matchDate: '2026-10-12',
      format: {},
      startingScore,
      finish: 'completed',
      board: emptyFormattedBoard(),
      points,
      stats: aggregateManualStats(points),
      gameNotes: ['Second serve was weak.', 'Cramping late.'],
      settings: { advancedServeStats: false, advancedErrorCounter: false },
    },
  };
}

const entryFor = (metadata: unknown): EntryLike => ({
  id: 'm1',
  category: 'match',
  folder_label: 'Vin vs Luca',
  body_text: 'compiled plain text',
  created_at: new Date(2026, 9, 12, 20).toISOString(),
  source: 'manual_recorder',
  metadata,
});

test('a saved manual match rebuilds the same full report the recorder showed', () => {
  const startingScore = { gamesPlayer: 2, gamesOpponent: 1, pointsPlayer: '15', pointsOpponent: '0', server: 'player' };
  // Through JSON, as it travels to and from the database.
  const stored = JSON.parse(JSON.stringify(recorderMetadata(startingScore)));
  const [block] = deriveBlocks([entryFor(stored)], 'match');
  assert.equal(block.type, 'manualMatch');
  if (block.type !== 'manualMatch') return;

  const rebuilt = buildManualReport(manualMatchToReportInput(block.match));
  const live = buildManualReport({
    playerName: 'Vin',
    opponentName: 'Luca',
    points,
    board: emptyFormattedBoard(),
    startingScoreNote: describeStartingScore(startingScore as never, { player: 'Vin', opponent: 'Luca' }),
    finish: 'completed',
    gameNotes: ['Second serve was weak.', 'Cramping late.'],
  });
  assert.deepEqual(rebuilt, live);

  const text = JSON.stringify(rebuilt);
  assert.ok(text.includes('Game note 1: Second serve was weak.'), 'game notes are in the report');
  assert.ok(text.includes('Game note 2: Cramping late.'));
  assert.ok(text.includes('already in progress'), 'starting-score coverage line survives');
  assert.equal(rebuilt.length, 2, 'both sides');
  assert.ok(rebuilt.every((r) => r.sections.length >= 5), 'every section is there');
});

test('a match saved without a starting score or notes still builds', () => {
  const md = recorderMetadata(undefined);
  md.manualMatch.gameNotes = [];
  const [block] = deriveBlocks([entryFor(JSON.parse(JSON.stringify(md)))], 'match');
  assert.ok(block.type === 'manualMatch');
  const rebuilt = buildManualReport(manualMatchToReportInput(block.match));
  assert.equal(rebuilt.length, 2);
});
