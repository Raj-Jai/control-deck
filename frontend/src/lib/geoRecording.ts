export interface SurveyPoint {
  lat: number;
  lng: number;
  ping: number;
  ts: number;
}

// A survey recording is capped. The canvas redraw is O(n) per point, so an
// unbounded list makes an hour-long walk unusable: every added point re-renders
// the whole polyline and grows React state without limit. Five thousand samples
// is over sixteen minutes at 5 Hz, longer than a typical survey leg. The oldest
// samples are dropped and the caller is told how many, so the user is not
// silently losing the start of the recording.
export const MAX_RECORD_POINTS = 5000;

export function appendPoint(
  prev: SurveyPoint[],
  point: SurveyPoint,
  onTrimmed: () => void
): SurveyPoint[] {
  if (prev.length < MAX_RECORD_POINTS) return [...prev, point];
  onTrimmed();
  // Keep the newest MAX_RECORD_POINTS, including the one just added.
  return prev.slice(prev.length - MAX_RECORD_POINTS + 1).concat(point);
}
