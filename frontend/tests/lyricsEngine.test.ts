import { parseLRC, getActiveLineIndex } from '../src/lib/lyricsEngine.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

test('parses a standard two-digit-minute timestamp', () => {
  const lines = parseLRC('[00:12.34]hello');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].timeMs, 12340);
  assert.equal(lines[0].text, 'hello');
});

test('parses a single-digit minute', () => {
  // Very common in the wild. The old pattern required exactly two digits, so
  // every line of such a file was silently dropped and the card showed no
  // lyrics at all (BUG-037).
  const lines = parseLRC('[1:23.45]one minute twenty three');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].timeMs, 83450);
  assert.equal(lines[0].text, 'one minute twenty three');
});

test('parses a timestamp with no fractional part', () => {
  const lines = parseLRC('[00:07]no fraction');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].timeMs, 7000);
});

test('treats a one-digit fraction as tenths, not hundredths', () => {
  // ".5" is 500ms, not 5ms.
  const lines = parseLRC('[00:01.5]half a second');
  assert.equal(lines[0].timeMs, 1500);
});

test('expands every timestamp on a multi-timestamp line', () => {
  // A repeated chorus is one line with several tags; the old code read only
  // the first and the rest of the song lost its lyrics.
  const lines = parseLRC('[00:10.00][01:20.00][02:30.00]chorus');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.timeMs), [10000, 80000, 150000]);
  assert.ok(lines.every((l) => l.text === 'chorus'));
});

test('ignores metadata tags', () => {
  const lines = parseLRC('[ar:Some Artist]\n[ti:Some Title]\n[00:03.00]real line');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'real line');
});

test('handles a line with a timestamp and no text', () => {
  const lines = parseLRC('[00:05.00]');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '');
});

test('sorts out-of-order lines by time', () => {
  const lines = parseLRC('[00:30.00]third\n[00:10.00]first\n[00:20.00]second');
  assert.deepEqual(lines.map((l) => l.text), ['first', 'second', 'third']);
});

test('returns nothing for empty or tagless input', () => {
  assert.deepEqual(parseLRC(''), []);
  assert.deepEqual(parseLRC('just some text\nand more'), []);
});

test('getActiveLineIndex picks the last line at or before the position', () => {
  const lines = parseLRC('[00:00.00]a\n[00:10.00]b\n[00:20.00]c');
  assert.equal(getActiveLineIndex(lines, 0), 0);
  assert.equal(getActiveLineIndex(lines, 9999), 0);
  assert.equal(getActiveLineIndex(lines, 10000), 1);
  assert.equal(getActiveLineIndex(lines, 19999), 1);
  assert.equal(getActiveLineIndex(lines, 999999), 2);
});
