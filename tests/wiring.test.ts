import { describe, expect, it } from 'vitest';

import {
  dragSegment,
  hitTestPath,
  pathLength,
  routeOrthogonal,
  segmentsOf,
  simplifyCorners,
} from '../src/wiring/WireRouter';
import {
  describeWireProblem,
  findConnectionTarget,
  snapToGrid,
} from '../src/wiring/ConnectionFinder';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { buildNandLab, connect, holeRef, pinRef } from './helpers/lab';

describe('orthogonal routing', () => {
  it('leaves an already straight run alone', () => {
    const path = routeOrthogonal([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('inserts one elbow between points that do not line up', () => {
    const path = routeOrthogonal([
      { x: 0, y: 0 },
      { x: 4, y: 3 },
    ]);
    expect(path).toHaveLength(3);
    for (const segment of segmentsOf(path)) expect(segment.axis).not.toBe('diagonal');
  });

  it('keeps every segment orthogonal however many corners are clicked', () => {
    const path = routeOrthogonal([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 8, y: 1 },
      { x: 12, y: 9 },
    ]);
    for (const segment of segmentsOf(path)) expect(segment.axis).not.toBe('diagonal');
  });

  it('alternates the turn direction so a run does not double back', () => {
    const path = routeOrthogonal([
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      { x: 8, y: 6 },
    ]);
    const axes = segmentsOf(path).map((s) => s.axis);
    for (let i = 1; i < axes.length; i++) expect(axes[i]).not.toBe(axes[i - 1]);
  });

  it('measures the length of the routed path', () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(7);
  });
});

describe('wire hit testing', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ];

  it('finds the nearest point on the nearest segment', () => {
    const hit = hitTestPath(path, { x: 4, y: 0.3 })!;
    expect(hit.segment).toBe(0);
    expect(hit.distance).toBeCloseTo(0.3, 5);
    expect(hit.point).toEqual({ x: 4, y: 0 });
  });

  it('reports a large distance for a point nowhere near the wire', () => {
    const hit = hitTestPath(path, { x: 4, y: 9 })!;
    expect(hit.distance).toBeGreaterThan(4);
  });
});

describe('segment dragging', () => {
  it('moves a horizontal segment vertically and keeps the run orthogonal', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 6 },
      { x: 8, y: 6 },
    ];
    const corners = [
      { x: 4, y: 0 },
      { x: 4, y: 6 },
    ];
    const next = dragSegment(path, corners, 1, { x: 3, y: 0 });
    const routed = routeOrthogonal([path[0], ...next, path[path.length - 1]]);
    for (const segment of segmentsOf(routed)) expect(segment.axis).not.toBe('diagonal');
    // The vertical segment kept its orientation and moved sideways.
    expect(next[0].x).toBe(7);
    expect(next[1].x).toBe(7);
  });

  it('adds a corner when the segment being dragged touches an endpoint', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ];
    const next = dragSegment(path, [], 0, { x: 0, y: 2 });
    expect(next.length).toBeGreaterThan(0);
    const routed = routeOrthogonal([path[0], ...next, path[1]]);
    for (const segment of segmentsOf(routed)) expect(segment.axis).not.toBe('diagonal');
  });

  it('refuses to move a segment along its own axis', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ];
    expect(dragSegment(path, [], 0, { x: 3, y: 0 })).toEqual([]);
  });
});

describe('corner tidying', () => {
  it('drops corners that no longer bend anything', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 10, y: 0 };
    const corners = [
      { x: 3, y: 0 },
      { x: 7, y: 0 },
    ];
    expect(simplifyCorners(start, corners, end)).toEqual([]);
  });

  it('keeps a real corner', () => {
    const kept = simplifyCorners({ x: 0, y: 0 }, [{ x: 5, y: 0 }], { x: 5, y: 6 });
    expect(kept).toEqual([{ x: 5, y: 0 }]);
  });
});

describe('finding what the cursor is over', () => {
  it('snaps to a pin before anything else', () => {
    const lab = buildNandLab();
    const pin = lab.circuit.pinPosition(lab.u1.id, 1)!;
    const target = findConnectionTarget(lab.circuit, { x: pin.x + 0.2, y: pin.y - 0.1 })!;
    expect(target.kind).toBe('pin');
    expect(target.label).toContain('pin 1');
  });

  it('snaps to a hole and says which clip it belongs to', () => {
    const lab = buildNandLab();
    const hole = lab.board.worldPosition(lab.board.getHole('c25')!);
    const target = findConnectionTarget(lab.circuit, { x: hole.x + 0.2, y: hole.y })!;
    expect(target.kind).toBe('hole');
    expect(target.detail).toContain('a25-e25');
  });

  it('finds nothing at all outside the snap tolerance', () => {
    const lab = buildNandLab();
    const hole = lab.board.worldPosition(lab.board.getHole('c25')!);
    // The tolerance is radial: roughly half a hole pitch from the centre.
    expect(findConnectionTarget(lab.circuit, { x: hole.x + 0.3, y: hole.y + 0.3 })).toBeDefined();
    expect(findConnectionTarget(lab.circuit, { x: hole.x + 0.45, y: hole.y + 0.45 })).toBeUndefined();
  });

  it('offers a junction when the cursor is over a wire', () => {
    const lab = buildNandLab();
    const wire = lab.circuit.wires.find((w) => w.from.kind === 'hole' && w.from.hole === 'TP10')!;
    const path = lab.circuit.wirePath(wire)!;
    const middle = { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2 };
    const target = findConnectionTarget(lab.circuit, middle, { includeWires: true })!;
    expect(target.kind).toBe('wire');
    expect(target.detail).toContain('junction');
  });

  it('rounds a free position to the grid', () => {
    expect(snapToGrid({ x: 4.4, y: -2.6 })).toEqual({ x: 4, y: -3 });
  });
});

describe('refusing pointless wires', () => {
  it('rejects a wire whose ends are already the same node', () => {
    const lab = buildNandLab();
    const problem = describeWireProblem(
      lab.circuit,
      holeRef(lab.board, 'a5'),
      holeRef(lab.board, 'c5'),
    );
    expect(problem).toContain('same connection');
  });

  it('rejects a wire from a pin to the hole that pin is already in', () => {
    const lab = buildNandLab();
    const problem = describeWireProblem(lab.circuit, pinRef(lab.u1, 1), holeRef(lab.board, 'j10'));
    expect(problem).toContain('same connection');
  });

  it('allows a wire across the trench, because that is a real connection', () => {
    const lab = buildNandLab();
    expect(
      describeWireProblem(lab.circuit, holeRef(lab.board, 'a5'), holeRef(lab.board, 'f5')),
    ).toBeUndefined();
  });
});

describe('junctions', () => {
  it('joins a branch to the net of the wire it sits on', () => {
    const lab = buildNandLab();
    const host = lab.circuit.wires.find((w) => w.from.kind === 'hole' && w.from.hole === 'TP10')!;
    const junction = { id: 'J1', wireId: host.id, position: { x: 9, y: 1 } };
    lab.circuit.addJunction(junction);
    connect(lab.circuit, { kind: 'junction', junctionId: 'J1' }, holeRef(lab.board, 'a25'), 'red');

    const engine = new SimulationEngine(lab.circuit);
    const branchNet = engine.netValueOfGroup(lab.board.getHole('a25')!.groupId);
    const vccNet = engine.netValueOfPin(lab.u1.id, 14);
    expect(branchNet?.netId).toBe(vccNet?.netId);
    expect(branchNet?.voltage).toBeCloseTo(5, 2);
  });

  it('does not connect two wires that merely cross', () => {
    const lab = buildNandLab();
    const engine = new SimulationEngine(lab.circuit);
    // The VCC jumper and the input wire cross on screen but share no node.
    const vccNet = engine.netValueOfPin(lab.u1.id, 14);
    const inputNet = engine.netValueOfPin(lab.u1.id, 1);
    expect(vccNet?.netId).not.toBe(inputNet?.netId);
  });
});
