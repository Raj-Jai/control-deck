import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Album-art theming must only ever tint accents. It must not repaint the page.
 *
 * `.art-themed body` used to declare a hardcoded `#0b0d12` background, outside
 * the token set, so the moment a track with cover art started playing the light
 * theme became white cards floating on a near-black page, with a light top strip
 * above them and a dark bottom strip below. Nothing in the palette could reach
 * it, which is why it survived so long: it looked like a deliberate "dark shell
 * with light cards" design rather than a bug.
 *
 * This is a source-level check because the rule lives in CSS, not in a value we
 * can import.
 */
const css = readFileSync('src/index.css', 'utf8');

function artBlock(): string {
  const start = css.indexOf('.art-themed body');
  assert.ok(start >= 0, 'the .art-themed body rule is gone; re-check what replaced it');
  // Up to the next top-level rule.
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

test('art theming does not hardcode a page background colour', () => {
  const block = artBlock();
  const hex = block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(
    hex,
    [],
    `.art-themed sets a literal colour (${hex.join(', ')}) instead of the theme's own ` +
      'page colour, so playing a track repaints the page in both themes',
  );
  assert.match(
    block,
    /rgb\(var\(--cd-bg\)\)/,
    'the art background must be built from --cd-bg so the theme stays in charge',
  );
});

test('art theming does not reintroduce a wide accent glow', () => {
  // The block used to pin a 16px slider-thumb shadow at 50% opacity and a 20px
  // active-tile shadow. Those are what made the neon look come back every time a
  // song started, overriding the restraint the base theme had. The threshold is
  // 16px because the remaining 10px and 12px entries are the art tint for
  // elements that already carried a modest glow in the base theme, at 20-25%
  // rather than 50%, so they are the same family and not a regression.
  const start = css.indexOf('.art-themed');
  assert.ok(start >= 0);
  const section = css.slice(start, css.indexOf('@media (pointer: coarse)'));
  const wide = section.match(/0 0 (?:1[6-9]|[2-9][0-9])px/g) ?? [];
  assert.deepEqual(
    wide,
    [],
    `.art-themed pins a wide diffuse glow (${wide.join(', ')}); it should defer to ` +
      'the themed --cd-glow-accent',
  );
});

test('the art accents still come from the artwork', () => {
  // The point of art theming. Guard against "fixed" meaning "removed".
  const section = css.slice(css.indexOf('.art-themed'));
  assert.match(section, /--art-accent/, 'art theming must still drive accents from the art');
  assert.match(section, /--art-primary/);
});
