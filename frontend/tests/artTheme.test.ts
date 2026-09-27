import test from 'node:test';
import assert from 'node:assert/strict';
import { applyArtTheme, clearArtTheme, type ThemeRoot } from '../src/lib/artTheme.ts';

function stubRoot() {
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const root: ThemeRoot = {
    classList: {
      add: (n) => { classes.add(n); },
      remove: (n) => { classes.delete(n); },
    },
    style: {
      setProperty: (n, v) => { props.set(n, v); },
      removeProperty: (n) => { props.delete(n); },
    },
  };
  return { root, classes, props };
}

test('applying a palette sets the class and both properties', () => {
  const { root, classes, props } = stubRoot();
  const ok = applyArtTheme(root, { primary: 'hsl(0,70%,60%)', accent: 'hsl(180,60%,55%)' });
  assert.equal(ok, true);
  assert.ok(classes.has('art-themed'));
  assert.equal(props.get('--art-primary'), 'hsl(0,70%,60%)');
  assert.equal(props.get('--art-accent'), 'hsl(180,60%,55%)');
});

test('a null palette leaves the theme alone rather than half-applying', () => {
  const { root, classes, props } = stubRoot();
  const ok = applyArtTheme(root, null);
  assert.equal(ok, false);
  assert.equal(classes.size, 0);
  assert.equal(props.size, 0);
});

// The regression: a failed extraction used to leave the previous track's
// colours on screen because the class was only removed in onerror.
test('a failure after a success removes the stale palette completely', () => {
  const { root, classes, props } = stubRoot();
  applyArtTheme(root, { primary: 'hsl(0,70%,60%)', accent: 'hsl(180,60%,55%)' });
  assert.ok(classes.has('art-themed'));

  // The next cover yields nothing usable.
  applyArtTheme(root, null);
  assert.equal(classes.has('art-themed'), false, 'the class stuck');
  assert.equal(props.has('--art-primary'), false, '--art-primary stuck');
  assert.equal(props.has('--art-accent'), false, '--art-accent stuck');
});

test('clearing is idempotent', () => {
  const { root, classes, props } = stubRoot();
  clearArtTheme(root);
  clearArtTheme(root);
  assert.equal(classes.size, 0);
  assert.equal(props.size, 0);
});

test('switching between two palettes overwrites rather than accumulating', () => {
  const { root, props } = stubRoot();
  applyArtTheme(root, { primary: 'hsl(0,70%,60%)', accent: 'hsl(180,60%,55%)' });
  applyArtTheme(root, { primary: 'hsl(120,50%,50%)', accent: 'hsl(300,50%,55%)' });
  assert.equal(props.get('--art-primary'), 'hsl(120,50%,50%)');
  assert.equal(props.get('--art-accent'), 'hsl(300,50%,55%)');
  assert.equal(props.size, 2);
});
