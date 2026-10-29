import test from 'node:test';
import assert from 'node:assert/strict';
import { readContainerAudio } from '../lib/cropExport';
import { audioTracksInMoov, looksLikeMp4, sourceAudioVerdict, webmAudioFromHead } from '../lib/exportSpeed';

// ── tiny container builders ────────────────────────────────────────────────────
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload];
const hdlr = (handler: string) => box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), ...new Array(13).fill(0)]);
const trak = (handler: string) => box('trak', box('mdia', hdlr(handler)));
const moov = (handlers: string[]) => box('moov', [...box('mvhd', new Array(20).fill(0)), ...handlers.flatMap(trak)]);
const ftyp = (brand = 'isom') => box('ftyp', [...ascii(brand), 0, 0, 2, 0, ...ascii(brand)]);
/** Media data that happens to contain the bytes "hdlr....soun" (must NOT count: only moov is read). */
const mdat = (len: number) => box('mdat', [...new Array(len).fill(7), ...hdlr('soun')]);
const blob = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);

test('MP4/MOV with sound: one audio track found in moov, wherever moov sits (iPhone: after the media)', async () => {
  const moovFirst = await readContainerAudio(blob([...ftyp(), ...moov(['vide', 'soun']), ...box('mdat', new Array(500).fill(1))]));
  assert.deepEqual([moovFirst.certain, moovFirst.audioTracks], [true, 1]);
  const moovLast = await readContainerAudio(blob([...ftyp('qt  '), ...box('wide', []), ...box('mdat', new Array(3000).fill(1)), ...moov(['vide', 'soun'])]));
  assert.deepEqual([moovLast.kind, moovLast.certain, moovLast.audioTracks], ['mp4', true, 1]);
  assert.equal(sourceAudioVerdict(moovLast, 'unknown').audio, 'yes');
});

test('MP4 without sound: certain zero → "no sound"; stray bytes in the media data are not counted', async () => {
  const r = await readContainerAudio(blob([...ftyp(), ...mdat(100), ...moov(['vide'])]));
  assert.deepEqual([r.certain, r.audioTracks], [true, 0]);
  const v = sourceAudioVerdict(r, 'unknown');
  assert.equal(v.audio, 'no');
  assert.match(v.reason, /0 audio track/);
});

test("can't tell → the switch is shown (unknown), never 'no'", async () => {
  // MP4 with no moov (cut short), an unknown container, and an unreadable source.
  const cut = await readContainerAudio(blob([...ftyp(), ...box('mdat', new Array(50).fill(1))]));
  assert.equal(cut.certain, false);
  assert.equal(sourceAudioVerdict(cut, 'unknown').audio, 'unknown');
  const odd = await readContainerAudio(blob([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  assert.equal(odd.kind, 'unknown');
  assert.equal(sourceAudioVerdict(odd, 'unknown').audio, 'unknown');
  assert.equal(sourceAudioVerdict(null, 'unknown').audio, 'unknown');
  // An uncertain file plus a browser "yes" is a yes.
  assert.equal(sourceAudioVerdict(cut, 'yes').audio, 'yes');
});

test('WebM: certain only when the track list is in the first bytes', () => {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80];
  const tracks = (codecs: string[]) => [0x16, 0x54, 0xae, 0x6b, 0x80, ...codecs.flatMap((c) => [0xae, 0x80, 0x86, c.length, ...ascii(c)])];
  const withA = webmAudioFromHead(new Uint8Array([...ebml, ...tracks(['V_VP8', 'A_OPUS'])]));
  assert.deepEqual([withA.certain, withA.audioTracks], [true, 1]);
  const noA = webmAudioFromHead(new Uint8Array([...ebml, ...tracks(['V_VP9'])]));
  assert.deepEqual([noA.certain, noA.audioTracks], [true, 0]);
  const noTracks = webmAudioFromHead(new Uint8Array([...ebml, 0, 0, 0]));
  assert.equal(noTracks.certain, false);
});

test('moov scan and MP4 sniffing', () => {
  assert.equal(audioTracksInMoov(new Uint8Array(moov(['vide', 'soun', 'soun']))), 2);
  assert.equal(audioTracksInMoov(new Uint8Array(moov(['vide']))), 0);
  assert.equal(looksLikeMp4(new Uint8Array(ftyp())), true);
  assert.equal(looksLikeMp4(new Uint8Array([...box('mdat', [1, 2, 3])])), true);
  assert.equal(looksLikeMp4(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), false);
});
