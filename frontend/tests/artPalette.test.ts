import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteFromPixels } from '../src/lib/artPalette.ts';

const FALLBACK = { primary: '', accent: '' };
const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

// A solid field: every sampled pixel is the same colour, so the palette must
// reflect it rather than returning nothing.
test('extracts a palette from a solid colour', () => {
  const data = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) data.set(px(220, 40, 40), i * 4);
  const p = paletteFromPixels(data, FALLBACK);
  assert.ok(p, 'expected a palette for a solid red field');
  assert.match(p.primary, /^hsl\(/);
  assert.match(p.accent, /^hsl\(/);
});

// The two failure shapes that used to leave the previous track's colours on
// screen: nothing sampled, and nothing but transparent pixels.
test('returns null for an image with no usable pixels', () => {
  const transparent = new Uint8ClampedArray(16 * 4); // all zeros: alpha 0
  assert.equal(paletteFromPixels(transparent, FALLBACK), null);

  const allBlack = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) allBlack.set(px(0, 0, 0), i * 4);
  assert.equal(paletteFromPixels(allBlack, FALLBACK), null, 'near-black is not a palette');

  const allWhite = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) allWhite.set(px(255, 255, 255), i * 4);
  assert.equal(paletteFromPixels(allWhite, FALLBACK), null, 'near-white is not a palette');
});

// Greys have no hue to build a complement from, and including them only adds
// noise to the bucket counts.
test('ignores greys', () => {
  const data = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) data.set(px(128, 128, 128), i * 4);
  assert.equal(paletteFromPixels(data, FALLBACK), null);
});

test('picks the dominant hue when several are present', () => {
  const data = new Uint8ClampedArray(16 * 4);
  // 12 blue, 4 green.
  for (let i = 0; i < 12; i++) data.set(px(30, 60, 220), i * 4);
  for (let i = 12; i < 16; i++) data.set(px(40, 200, 60), i * 4);
  const p = paletteFromPixels(data, FALLBACK);
  assert.ok(p);
  // Blue is around hue 232, so the primary's hue should be in that neighbourhood.
  const hue = Number(/hsl\((\d+)/.exec(p.primary)![1]);
  assert.ok(hue > 200 && hue < 260, `primary hue ${hue} is not in the blue range`);
});

test('the accent is the complement of the primary', () => {
  const data = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) data.set(px(20, 120, 200), i * 4);
  const p = paletteFromPixels(data, FALLBACK)!;
  const ph = Number(/hsl\((\d+)/.exec(p.primary)![1]);
  const ah = Number(/hsl\((\d+)/.exec(p.accent)![1]);
  // The shortest distance around the colour wheel should be 180 degrees.
  const raw = Math.abs(ah - ph) % 360;
  const diff = Math.min(raw, 360 - raw);
  assert.ok(Math.abs(diff - 180) < 2, `primary ${ph} and accent ${ah} are ${diff} apart, want 180`);
});

// A very light or very dark cover must not produce an accent that is
// unreadable against the card surfaces.
test('the accent lightness stays in a legible band', () => {
  for (const colour of [[255, 250, 240], [5, 5, 20], [255, 0, 0], [0, 0, 255]]) {
    const data = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) data.set(px(...colour as [number, number, number]), i * 4);
    const p = paletteFromPixels(data, FALLBACK);
    if (!p) continue;
    const l = Number(/,\s*([\d.]+)%\)$/.exec(p.accent)![1]);
    assert.ok(l >= 52 && l <= 64, `accent lightness ${l} for ${colour} is outside 52-64`);
  }
});

test('empty input is handled', () => {
  assert.equal(paletteFromPixels(new Uint8ClampedArray(0), FALLBACK), null);
});
