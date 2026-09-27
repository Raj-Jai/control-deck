import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFrame, emptyAccumulator, isDeltaMessage } from '../src/lib/sseDelta.ts';

// A client that does not understand deltas must keep working, because the wire
// format is a superset of the old full-frame one.
test('a full frame is applied as-is', () => {
  const acc = emptyAccumulator();
  const next = applyFrame(acc, { pos: 1, title: 't' });
  assert.deepEqual(next, { pos: 1, title: 't' });
});

test('a delta patches the previous frame', () => {
  const acc = emptyAccumulator();
  let state = applyFrame(acc, { pos: 1, title: 't', vol: 50 });
  assert.ok(state);
  acc.state = state; acc.ordinal = 1;

  state = applyFrame(acc, { o: 2, p: { pos: 2 } });
  assert.deepEqual(state, { pos: 2, title: 't', vol: 50 });
});

test('null in a patch removes the key', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1, title: 't' };
  acc.ordinal = 1;
  const next = applyFrame(acc, { o: 2, p: { title: null } });
  assert.deepEqual(next, { pos: 1 });
  assert.ok(!('title' in next!));
});

// A missed delta must not leave the client quietly wrong. Dropping the base
// means the next full frame rebuilds it.
test('a gap in the ordinals drops the base', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1 };
  acc.ordinal = 4;
  // The base came from a delta, so only the very next ordinal is safe.
  acc.baseIsFullFrame = false;
  assert.equal(applyFrame(acc, { o: 9, p: { pos: 2 } }), null);
});

test('an out-of-order or repeated delta is refused', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1 };
  acc.ordinal = 5;
  acc.baseIsFullFrame = false;
  assert.equal(applyFrame(acc, { o: 3, p: { pos: 2 } }), null, 'older than the base');
  assert.equal(applyFrame(acc, { o: 5, p: { pos: 2 } }), null, 'the same ordinal twice');
});

// A full frame carries no ordinal, so after one the client cannot know where
// the numbering stands - but it is also the one moment at which it cannot have
// missed a delta, so the next one is safe whatever its number. Without this the
// client would reject every delta after a reconnect and sit on stale data
// until the server happened to send a whole frame.
test('after a full frame any forward delta is safe', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1 };
  acc.ordinal = 0;
  acc.baseIsFullFrame = true;
  const next = applyFrame(acc, { o: 17, p: { pos: 2 } });
  assert.deepEqual(next, { pos: 2 });
  assert.equal(acc.baseIsFullFrame, true, 'the base is still a full frame until a delta lands');
});

// ...and once a delta has landed, contiguity is enforced again.
test('contiguity returns as soon as a delta lands', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1 };
  acc.ordinal = 0;
  acc.baseIsFullFrame = true;
  const first = applyFrame(acc, { o: 17, p: { pos: 2 } });
  assert.deepEqual(first, { pos: 2 });
  acc.state = first as Record<string, unknown>;
  acc.ordinal = 17;
  acc.baseIsFullFrame = false;
  assert.equal(applyFrame(acc, { o: 30, p: { pos: 3 } }), null);
  assert.deepEqual(applyFrame(acc, { o: 18, p: { pos: 3 } }), { pos: 3 });
});

test('a delta with no base at all is refused', () => {
  const acc = emptyAccumulator();
  assert.equal(applyFrame(acc, { o: 1, p: { pos: 1 } }), null);
});

test('isDeltaMessage rejects things that are not deltas', () => {
  for (const v of [null, undefined, 42, 'x', {}, { o: '1', p: {} }, { o: 1 }, { p: {} }]) {
    assert.equal(isDeltaMessage(v), false, `${JSON.stringify(v)} should not be a delta`);
  }
  assert.equal(isDeltaMessage({ o: 1, p: {} }), true);
});

// The base must not be mutated, or a re-applied message would compound.
test('applying a delta does not mutate the previous state', () => {
  const acc = emptyAccumulator();
  acc.state = { pos: 1, title: 't' };
  acc.ordinal = 1;
  const before = { ...acc.state };
  applyFrame(acc, { o: 2, p: { pos: 5, title: null } });
  assert.deepEqual(acc.state, before);
});

// The real wire sequence: one full frame, then deltas, mirroring what the host
// sends. The client must end up in the same state a full frame each time would
// have produced.
test('the real sequence - a full frame then deltas - reassembles exactly', () => {
  const acc = emptyAccumulator();
  const frames: Record<string, unknown>[] = [
    { pos: 1, title: 'one', vol: 50 },
    { pos: 2, title: 'one', vol: 50 },
    { pos: 2, title: 'two', vol: 50 },
    { pos: 3, title: 'two', vol: 60 },
    { pos: 3, title: 'two', vol: 60 },
  ];

  for (const [i, want] of frames.entries()) {
    // The host sends frame 1 whole, and only frames that differ as deltas.
    let message: unknown = { ...want };
    if (i > 0) {
      const previous = acc.state!;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(want)) {
        if (previous[k] !== v) patch[k] = v;
      }
      for (const k of Object.keys(previous)) {
        if (!(k in want)) patch[k] = null;
      }
      if (Object.keys(patch).length) message = { o: i + 1, p: patch };
    }

    const next = applyFrame(acc, message);
    assert.ok(next, `frame ${i + 1} produced no state`);
    acc.state = next as Record<string, unknown>;
    if (isDeltaMessage(message)) { acc.ordinal = message.o; acc.baseIsFullFrame = false; }
    else { acc.baseIsFullFrame = true; }
    assert.deepEqual(next, want, `frame ${i + 1}`);
  }
});
