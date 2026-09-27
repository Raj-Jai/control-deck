import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ValueSlider has two ways out: a throttled send while the thumb is moving, and
 * one final send when the drag ends. For a long time only the throttled path
 * applied `toValue`, so the release sent the raw 0-100 slider position as the
 * host value. For volume that put 44 where 0.44 was meant, and PulseAudio took
 * 44 as a linear multiplier and set the sink to 4400%.
 *
 * These assert the invariant both paths depend on: `pending` holds the slider
 * position, and the conversion to the host's units happens at send time, once,
 * on every path.
 */

/** The shape of the component, minus React: enough to exercise the two paths. */
function makeSlider(opts: { toValue: (pct: number) => number; throttleMs?: number }) {
  const throttleMs = opts.throttleMs ?? 80;
  const sent: number[] = [];
  let pending: number | null = null;
  let lastSent = 0;
  let now = 10_000; // far enough past the epoch that the first send is not throttled

  return {
    sent,
    /**
     * The onChange handler. `elapsedPerChange` models the time between two
     * pointermove events during a drag - small, because a drag generates them
     * far faster than the throttle window.
     */
    change(percent: number, elapsedPerChange = 10) {
      now += elapsedPerChange;
      pending = percent;
      if (now - lastSent < throttleMs) return;
      lastSent = now;
      sent.push(opts.toValue(percent));
    },
    /** The end-of-drag handler. */
    commit() {
      const last = pending;
      pending = null;
      if (last === null) return null;
      const host = opts.toValue(last);
      sent.push(host);
      return host;
    },
  };
}

test('the commit converts the slider position exactly like a throttled send', () => {
  // The real volume mapping: 0-100 position, curved, to 0-1.
  const toValue = (pct: number) => Math.pow(pct / 100, 2) * 0.6;
  const s = makeSlider({ toValue, throttleMs: 0 });

  s.change(44);
  const fromDrag = s.sent.at(-1);
  const fromCommit = s.commit();

  assert.equal(fromCommit, fromDrag, 'release must send what the drag was sending');
  assert.ok(
    Math.abs(fromCommit! - toValue(44)) < 1e-12,
    'commit must apply toValue to the position',
  );
  // The bug this guards: 44 sent raw instead of the converted value.
  assert.notEqual(fromCommit, 44, 'the raw position must never reach the host');
});

test('a commit with no intervening change is a no-op', () => {
  const s = makeSlider({ toValue: (p) => p / 100 });
  assert.equal(s.commit(), null);
  assert.deepEqual(s.sent, []);
});

test('the position survives a throttled change, so the release is still correct', () => {
  // A fast drag: several moves land inside the throttle window, so only the
  // first is sent immediately. The release must still carry the last one.
  const toValue = (pct: number) => pct / 100;
  const s = makeSlider({ toValue, throttleMs: 100 });
  s.change(10);
  s.change(20);
  s.change(30);
  s.change(80); // inside the window, so not sent
  assert.equal(s.sent.length, 1, 'only the first change clears the throttle');
  assert.equal(s.commit(), 0.8, 'the release carries the last position, not the first');
});

test('brightness, whose conversion is the identity, is unaffected either way', () => {
  // Worth asserting because it is why the volume bug survived: the identical
  // mistake was harmless here and catastrophic for volume.
  const toValue = (pct: number) => pct;
  const s = makeSlider({ toValue, throttleMs: 0 });
  s.change(81);
  assert.equal(s.commit(), 81);
});


/**
 * The tests above exercise a model of the component's two send paths, which
 * documents the invariant and would catch a change to the model - but not a
 * change to the real file. Rendering the component needs a DOM and a React
 * renderer, and this suite is plain node, so this is a source check instead.
 *
 * It is here because the regression it guards is a one-token edit that is
 * invisible until someone drags a slider: `onSend(last)` instead of
 * `onSend(toValue(last))`, which sends the position as the value and put the
 * sink at 4400%.
 */
test('the real component converts on the commit path too', () => {
  const src = readFileSync('src/components/ValueSlider.tsx', 'utf8');
  // Bounded to the commit callback itself. Slicing to end-of-file would match
  // the toValue() in handleChange instead and pass even with the bug present -
  // which is exactly what the first version of this test did. The bound is the
  // next top-level declaration, so it survives helpers being added in between.
  const start = src.indexOf('const commit = useCallback');
  assert.ok(start >= 0, 'could not find the commit callback');
  const rest = src.slice(start);
  const m = rest.slice(1).match(/\n {2}(?:const|function)\s/);
  const commit = m ? rest.slice(0, m.index! + 1) : rest;
  // Assert the invariant, not one particular spelling of it. An earlier version
  // matched the literal `onSend(toValue(` and broke the moment the value was
  // hoisted into a local, even though the code was correct.
  assert.match(
    commit,
    /toValue\(/,
    'commit() must convert the slider position with toValue() before sending',
  );
  assert.doesNotMatch(
    commit,
    /onSend\(\s*(last|pending\.current)\s*[,)]/,
    'commit() must never hand onSend the raw slider position; a bare onSend(last) ' +
      'sends 0-100 as the host value',
  );
  assert.match(
    src,
    /pending\.current = percent/,
    'pending must hold the raw slider position, so the conversion stays at send time',
  );
  // The invariant has to be written down somewhere - inline or in the JSDoc.
  // Asserting a particular location was over-specified: an earlier version
  // demanded it sat on the declaration and failed when the note moved up into
  // the component's doc comment, which is where it reads better.
  assert.match(src, /invariant/i,
    'the pending-holds-the-slider-position invariant should be documented');
  assert.match(src, /raw slider position|0-100/,
    'the invariant should say what pending holds and in what units');
});
