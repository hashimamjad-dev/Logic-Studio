/**
 * Wire geometry.
 *
 * Geometry is derived, never stored as truth: a wire stores two endpoint references
 * and the corners the user clicked, and the polyline is recomputed from those every
 * time. That is what lets a part move and its wires follow without the electrical
 * model noticing anything at all.
 *
 * Routing is orthogonal by default. Between two points that do not line up, one
 * elbow is inserted; the direction of the elbow alternates with the previous segment
 * so a run of clicks does not double back on itself.
 */

import type { GridPoint } from '../core/types';

export type Axis = 'horizontal' | 'vertical';

export interface Segment {
  index: number;
  start: GridPoint;
  end: GridPoint;
  axis: Axis | 'diagonal';
}

const EPSILON = 1e-6;

function aligned(a: GridPoint, b: GridPoint): Axis | undefined {
  if (Math.abs(a.y - b.y) < EPSILON) return 'horizontal';
  if (Math.abs(a.x - b.x) < EPSILON) return 'vertical';
  return undefined;
}

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

/**
 * Expand a list of clicked points into a fully orthogonal polyline.
 *
 * `preferAxis` decides which way the first elbow turns; after that each elbow turns
 * the opposite way to the segment before it.
 */
export function routeOrthogonal(points: GridPoint[], preferAxis: Axis = 'horizontal'): GridPoint[] {
  if (points.length === 0) return [];
  const out: GridPoint[] = [{ ...points[0] }];
  let lastAxis: Axis | undefined;

  for (let i = 1; i < points.length; i++) {
    const from = out[out.length - 1];
    const to = points[i];
    if (samePoint(from, to)) continue;

    const direct = aligned(from, to);
    if (direct) {
      out.push({ ...to });
      lastAxis = direct;
      continue;
    }
    // Turn the opposite way to the previous segment so the run keeps flowing.
    const axis: Axis = lastAxis ? (lastAxis === 'horizontal' ? 'vertical' : 'horizontal') : preferAxis;
    const elbow: GridPoint =
      axis === 'horizontal' ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    out.push(elbow, { ...to });
    lastAxis = axis === 'horizontal' ? 'vertical' : 'horizontal';
  }
  return out;
}

export function segmentsOf(path: GridPoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const start = path[i];
    const end = path[i + 1];
    segments.push({ index: i, start, end, axis: aligned(start, end) ?? 'diagonal' });
  }
  return segments;
}

export function pathLength(path: GridPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return total;
}

export interface PathHit {
  distance: number;
  /** Index of the segment that was hit. */
  segment: number;
  /** Closest point on the wire, in grid units. */
  point: GridPoint;
}

export function hitTestPath(path: GridPoint[], probe: GridPoint): PathHit | undefined {
  let best: PathHit | undefined;
  for (const segment of segmentsOf(path)) {
    const hit = closestPointOnSegment(segment.start, segment.end, probe);
    if (!best || hit.distance < best.distance) {
      best = { distance: hit.distance, segment: segment.index, point: hit.point };
    }
  }
  return best;
}

function closestPointOnSegment(
  a: GridPoint,
  b: GridPoint,
  p: GridPoint,
): { point: GridPoint; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) {
    return { point: { ...a }, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/**
 * Move one segment of a wire sideways, keeping its orientation.
 *
 * A horizontal segment can only move up and down, a vertical one only left and
 * right; the two neighbouring corners follow so the run stays orthogonal, and new
 * corners are inserted when the segment being dragged is at either end of the wire.
 *
 * `corners` are the stored intermediate points; the endpoints are fixed because they
 * belong to whatever the wire is plugged into.
 */
export function dragSegment(
  path: GridPoint[],
  corners: GridPoint[],
  segmentIndex: number,
  delta: GridPoint,
): GridPoint[] {
  const segments = segmentsOf(path);
  const segment = segments[segmentIndex];
  if (!segment || segment.axis === 'diagonal') return corners;

  const horizontal = segment.axis === 'horizontal';
  const shift = horizontal ? { x: 0, y: Math.round(delta.y) } : { x: Math.round(delta.x), y: 0 };
  if (shift.x === 0 && shift.y === 0) return corners;

  // Work in path space (endpoint, corners..., endpoint) then strip the endpoints.
  const working = path.map((point) => ({ ...point }));
  const startIndex = segmentIndex;
  const endIndex = segmentIndex + 1;

  const movedStart = { x: working[startIndex].x + shift.x, y: working[startIndex].y + shift.y };
  const movedEnd = { x: working[endIndex].x + shift.x, y: working[endIndex].y + shift.y };

  if (startIndex === 0) {
    // The wire is anchored here, so add a corner rather than moving the endpoint.
    working.splice(1, 0, { ...working[0] });
    working[1] = movedStart;
    working[2] = movedEnd;
  } else {
    working[startIndex] = movedStart;
  }

  const shiftedEndIndex = startIndex === 0 ? 2 : endIndex;
  if (shiftedEndIndex === working.length - 1) {
    working.splice(working.length - 1, 0, movedEnd);
  } else {
    working[shiftedEndIndex] = movedEnd;
  }

  return working.slice(1, working.length - 1).map((point) => ({ ...point }));
}

/** Drop corners that no longer bend anything, so a dragged wire stays tidy. */
export function simplifyCorners(start: GridPoint, corners: GridPoint[], end: GridPoint): GridPoint[] {
  const points = [start, ...corners, end];
  const kept: GridPoint[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = kept.length > 0 ? kept[kept.length - 1] : points[0];
    const next = points[i + 1];
    const current = points[i];
    if (samePoint(previous, current)) continue;
    const collinear =
      (Math.abs(previous.y - current.y) < EPSILON && Math.abs(current.y - next.y) < EPSILON) ||
      (Math.abs(previous.x - current.x) < EPSILON && Math.abs(current.x - next.x) < EPSILON);
    if (collinear) continue;
    kept.push({ ...current });
  }
  return kept;
}
