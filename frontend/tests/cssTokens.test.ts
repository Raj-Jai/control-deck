import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The theme tokens are space-separated RGB *channels* — `--cd-accent` is
 * `34 211 238`, not a colour. Every use therefore has to be wrapped:
 * `rgb(var(--cd-accent))`. Written bare, `outline: 2px solid var(--cd-accent)`
 * is invalid at computed-value time, so it resolves to the property's initial
 * value and paints nothing.
 *
 * That is not hypothetical. Three declarations did exactly this:
 *
 *   - the global `:focus-visible` outline, which is unlayered and so outranks
 *     every layered focus style. It was winning the cascade while rendering
 *     nothing, which is why 21 of 22 controls tabbed through had no visible
 *     focus indicator at all. The audit had already logged this as fixed
 *     (A11Y-13); it never was.
 *   - the range-input focus outline, same cause.
 *   - `.status-dot.playing` inside the prefers-reduced-motion block. That one
 *     is worse than invisible styling: reduced motion is the whole reason that
 *     rule exists, since the dot's pulse animation is suppressed there, so the
 *     static fill was the only remaining cue and it had no fill.
 */
const css = readFileSync('src/index.css', 'utf8');

/** Properties where a bare var() would be taken as a colour. */
const COLOUR_PROPS =
  '(?:outline|background|background-color|color|border-color|border|box-shadow|text-shadow|fill|stroke|caret-color)';

/**
 * Not every --cd-* token is a channel triple: some hold a whole value (a shadow,
 * a radius) and some hold an alpha fraction. Rather than keep an allow-list that
 * will drift, the check is structural: strip anything already inside a colour
 * function, then look for a token still sitting on its own.
 */
// One level of nesting, because `rgb(var(--cd-track))` puts a var() - with its
// own parens - inside the call.
// A template literal, not a single-quoted string: in '...' the \( is an escape
// for ( and the backslash is silently dropped, which turns the inner group into
// a capture of literal parens and the whole pattern stops matching anything.
const COLOUR_FN = `(?:[^()]|\\([^()]*\\))*`;
const COLOUR_FNS = new RegExp(
  `rgb\\(${COLOUR_FN}\\)|rgba\\(${COLOUR_FN}\\)|hsl\\(${COLOUR_FN}\\)|color-mix\\(${COLOUR_FN}\\)`,
  'g',
);

/**
 * Tokens that hold a whole value rather than RGB channels. Using these bare is
 * correct. The list is short and each entry is a whole-value token; a new one
 * will fail the test once, which is the right time to decide whether it belongs
 * here.
 */
const VALUE_TOKENS = new Set([
  '--cd-glow-accent',
  '--cd-shadow-card',
  '--cd-shadow-raised',
  '--cd-radius-card',
  '--cd-radius-control',
  '--cd-card-alpha',
  '--cd-card-border',
  '--cd-card-border-hover',
]);

test('no theme token is used as a bare colour anywhere in the stylesheet', () => {
  const lines = css.split('\n');
  const offenders: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (/^\s*(\*|\/\/)/.test(line)) continue; // a comment explaining the rule
    // Values already wrapped in a colour function are correct by construction.
    const bare = line.replace(COLOUR_FNS, ' COLORFN ');
    for (const m of bare.matchAll(
      new RegExp(`${COLOUR_PROPS}\\s*:[^;]*?var\\((\\--cd-[a-z0-9-]+)\\)`, 'g'),
    )) {
      if (VALUE_TOKENS.has(m[1])) continue;
      offenders.push(`${i + 1}: ${line.trim()}  (${m[1]})`);
      break;
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these declarations use a channel triple as if it were a colour, so they are ' +
      `invalid and paint nothing:\n  ${offenders.join('\n  ')}`,
  );
});

test('the focus ring is actually declared with rgb()', () => {
  // Belt and braces on the one that mattered most: assert the ring exists and
  // is not the invalid form.
  const block = css.slice(css.indexOf(':focus-visible {'));
  assert.ok(block.length > 0, 'the global :focus-visible rule has gone');
  assert.match(
    block,
    /outline:\s*2px solid rgb\(var\(--cd-accent\)\)/,
    'the focus ring must wrap the token in rgb() or it renders nothing',
  );
});

test('the reduced-motion status dot keeps a visible fill', () => {
  // Scope to the media block itself, and match the rule body rather than
  // slicing by brace, which the first version of this test got wrong.
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(at >= 0, 'the reduced-motion block is missing');
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  const block = css.slice(open, close);
  const rule = block.slice(block.indexOf('.status-dot.playing'));
  assert.match(
    rule,
    /background:\s*rgb\(var\(--cd-accent\)\)/,
    'under reduced motion the pulse is suppressed, so this fill is the only cue left',
  );
});


/**
 * The slider thumb has to be centred on its track.
 *
 * With `appearance: none`, Blink lays the thumb's top edge against the track's
 * top edge instead of centring it, so a 24px thumb on a 10px track hung 7px low
 * - the owner saw it as "the slider dot is misaligned a little down from the
 * expected line". Measured from painted pixels: track centre 21.5, thumb centre
 * 28.5.
 *
 * A partial edit once removed the correction while leaving the Firefox rule
 * pointing at a `--cd-thumb-h` that was never declared, which is a Firefox
 * regression too - the thumb would have had no size at all.
 */
const sliderBlock = css.slice(css.indexOf("input[type='range'] {"), css.indexOf("@media (pointer: coarse)"));

test('the slider thumb is centred on its track with a derived margin', () => {
  const thumb = stripComments(sliderBlock.slice(sliderBlock.indexOf('::-webkit-slider-thumb')));
  assert.match(
    thumb,
    /margin-top:\s*calc\(\(var\(--cd-track-h\)\s*-\s*var\(--cd-thumb-h\)\)\s*\/\s*2\)/,
    'the webkit thumb needs margin-top: (track - thumb) / 2 to sit on the track',
  );
  // Derived, not hardcoded, so a change to either height keeps working.
  assert.doesNotMatch(thumb, /margin-top:\s*-?\d+px/, 'the margin must be derived, not a magic number');
});

/** Drop /* ... *\/ comments so prose about a property is not read as the property. */
const stripComments = (cssText: string) => cssText.replace(/\/\*[\s\S]*?\*\//g, '');

test('the Firefox thumb is sized but not nudged', () => {
  const thumb = stripComments(sliderBlock.slice(sliderBlock.indexOf('::-moz-range-thumb')));
  assert.match(thumb, /width:\s*var\(--cd-thumb-h\)/, 'the moz thumb must have a width');
  assert.match(thumb, /height:\s*var\(--cd-thumb-h\)/, 'the moz thumb must have a height');
  assert.doesNotMatch(
    thumb,
    /margin-top/,
    'Firefox centres its thumb already; a margin here would push it above the track',
  );
});

test('every --cd-* token used in the slider block is declared', () => {
  const used = new Set([...sliderBlock.matchAll(/var\((--cd-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  // The block declares its own two; the rest come from :root.
  const locallyDeclared = new Set(
    [...sliderBlock.matchAll(/(--cd-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
  const rootTokens = new Set([...css.slice(0, css.indexOf('@layer components')).matchAll(/(--cd-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !locallyDeclared.has(t) && !rootTokens.has(t));
  assert.deepEqual(missing, [], `undefined token(s) in the slider block: ${missing.join(', ')}`);
});

test('the track keeps the 44px touch target and touch-action', () => {
  assert.match(sliderBlock, /height:\s*44px/, 'the input must stay a 44px touch target');
  assert.match(
    sliderBlock,
    /touch-action:\s*none/,
    'without touch-action:none a horizontal drag can be stolen as a scroll, ' +
      'which cancels the pointer mid-gesture and snaps the handle back',
  );
});
