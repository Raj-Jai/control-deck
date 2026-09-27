import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshnessFrom, freshnessLabel, freshnessExplanation,
} from '../src/lib/freshness.ts';

const T0 = 1_000_000;
const INTERVAL = 500; // the broadcaster pushes twice a second

test('a frame inside the expected window is live', () => {
  for (const ms of [0, 250, 500, 1500]) {
    const s = freshnessFrom(T0, T0 + ms, INTERVAL);
    assert.equal(s.status, 'live', `${ms}ms should be live, got ${s.status}`);
  }
});

test('a few frames behind is ageing, and says how long', () => {
  const s = freshnessFrom(T0, T0 + 3000, INTERVAL);
  assert.equal(s.status, 'ageing');
  assert.equal(s.seconds, 3);
  assert.equal(freshnessLabel(s), '3s ago');
});

test('well past that is stale, and the label says so', () => {
  const s = freshnessFrom(T0, T0 + 12_000, INTERVAL);
  assert.equal(s.status, 'stale');
  assert.match(freshnessLabel(s), /Stale/);
  assert.match(freshnessLabel(s), /12s ago/);
});

// A clock that has gone backwards must not produce a negative age.
test('a backwards clock does not produce a negative age', () => {
  const s = freshnessFrom(T0, T0 - 5000, INTERVAL);
  assert.equal(s.seconds, 0);
  assert.equal(s.status, 'live');
});

test('nothing received at all is lost, not live', () => {
  const s = freshnessFrom(null, T0, INTERVAL);
  assert.equal(s.status, 'lost');
  assert.match(freshnessLabel(s), /Not updating/);
  assert.match(freshnessExplanation(s), /Nothing on screen is current/);
});

test('every status has a label and an explanation', () => {
  for (const [last, now] of [[T0, T0], [T0, T0 + 3000], [T0, T0 + 20000], [null, T0]] as const) {
    const s = freshnessFrom(last, now, INTERVAL);
    assert.ok(freshnessLabel(s).length > 0);
    assert.ok(freshnessExplanation(s).length > 10, `explanation for ${s.status} is too short`);
  }
});

test('a slower stream is given proportionally more slack', () => {
  // The same 3 s gap is fine on a 2 s interval and stale on a 200 ms one.
  const slow = freshnessFrom(T0, T0 + 3000, 2000);
  const fast = freshnessFrom(T0, T0 + 3000, 200);
  assert.notEqual(slow.status, fast.status);
  assert.equal(fast.status, 'stale');
});

test('a zero interval is treated as one frame rather than dividing by zero', () => {
  const s = freshnessFrom(T0, T0 + 100, 0);
  assert.ok(['live', 'ageing', 'stale'].includes(s.status));
});
