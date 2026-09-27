import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every `deck-*` colour in a className has to exist in the Tailwind config, or
 * Tailwind drops the class silently and the element renders with no background
 * at all. That happened: `bg-deck-surface2` was used 17 times across the PIN
 * pad, the transport buttons, the clipboard rows and the stat bars, while the
 * token is `surface-2`. Nothing errored and nothing warned - the elements just
 * had no fill, which is very easy to mistake for a styling opinion rather than
 * a missing class.
 */
const config = readFileSync('tailwind.config.js', 'utf8');
const defined = new Set(
  [...config.matchAll(/'?([a-z0-9-]+)'?\s*:\s*token\(/g)].map((m) => m[1]),
);
// deck-card, deck-media-btn and friends are component classes in index.css,
// not colours, so they are legitimately not in the Tailwind palette.
const componentClasses = new Set(
  [...readFileSync('src/index.css', 'utf8').matchAll(/^\s*\.deck-([a-z0-9-]+)/gm)].map((m) => m[1]),
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('every deck-* colour used in the app is defined in the Tailwind config', () => {
  const unknown = new Map<string, string[]>();
  for (const file of walk('src')) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // Only look at hyphenated utility prefixes - bg-deck-surface-2,
      // text-deck-dim, border-deck-hairline. Requiring the leading hyphen is
      // what keeps prose out: "Drop files to ~/deck-drop" is visible text, not
      // a class, and it is preceded by a slash.
      for (const m of line.matchAll(/-deck-([a-z0-9-]+)/g)) {
        const name = m[1];
        if (defined.has(name) || componentClasses.has(name)) continue;
        if (!unknown.has(name)) unknown.set(name, []);
        unknown.get(name)!.push(`${file}:${i + 1}`);
      }
    });
  }
  const report = [...unknown.entries()]
    .map(([name, where]) => `  deck-${name}: ${where.length} use(s), first at ${where[0]}`)
    .join('\n');
  assert.equal(
    unknown.size,
    0,
    `these deck-* colours are not defined, so Tailwind drops the class and the\n` +
      `element renders with no background:\n${report}`,
  );
});
