import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPoint, MAX_RECORD_POINTS, type SurveyPoint } from '../src/lib/geoRecording.ts';

// A survey recording was unbounded: the canvas redraw is O(n) per point, so a
// long walk made the card progressively slower and grew React state without
// limit.
const mk = (i: number): SurveyPoint => ({ lat: 1 + i / 1000, lng: 2 + i / 1000, ping: 10, ts: i });

test('appends below the cap and reports nothing dropped', () => {
  let dropped = 0;
  let pts: SurveyPoint[] = [];
  for (let i = 0; i < 100; i++) {
    pts = appendPoint(pts, mk(i), () => { dropped++; });
  }
  assert.equal(pts.length, 100);
  assert.equal(dropped, 0);
  assert.equal(pts[0].ts, 0, 'the first sample is still first');
});

test('holds at the cap and reports every dropped sample', () => {
  let dropped = 0;
  let pts: SurveyPoint[] = [];
  const total = MAX_RECORD_POINTS + 250;
  for (let i = 0; i < total; i++) {
    pts = appendPoint(pts, mk(i), () => { dropped++; });
  }
  assert.equal(pts.length, MAX_RECORD_POINTS, 'never grows past the cap');
  assert.equal(dropped, 250, 'every sample over the cap is reported');
});

test('keeps the newest samples once trimming starts', () => {
  let pts: SurveyPoint[] = [];
  for (let i = 0; i < MAX_RECORD_POINTS + 5; i++) {
    pts = appendPoint(pts, mk(i), () => {});
  }
  const last = pts[pts.length - 1];
  assert.equal(last.ts, MAX_RECORD_POINTS + 4, 'the newest sample is the last one');
  assert.equal(pts[0].ts, 5, 'the five oldest samples were dropped');
});

test('a point right at the cap is kept', () => {
  let pts: SurveyPoint[] = [];
  for (let i = 0; i < MAX_RECORD_POINTS; i++) {
    pts = appendPoint(pts, mk(i), () => {});
  }
  assert.equal(pts.length, MAX_RECORD_POINTS);
  assert.equal(pts[pts.length - 1].ts, MAX_RECORD_POINTS - 1);
});
