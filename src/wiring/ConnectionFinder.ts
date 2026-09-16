/**
 * What the cursor is over.
 *
 * Wiring is modeless: hovering a pin or a hole is enough to start a wire, so this
 * lookup runs on every mouse move. It answers with a *connection reference* - the
 * thing the model stores - plus enough description for the status bar.
 *
 * Outside the snap tolerance the answer is "nothing". There is deliberately no
 * notion of an endpoint that is near a hole: it is in the hole or it is not
 * connected.
 */

import type { Circuit } from '../core/Circuit';
import { pinsOf } from '../components/ComponentDefinition';
import type { ConnectionRef, GridPoint } from '../core/types';
import { hitTestPath } from './WireRouter';

export type TargetKind = 'pin' | 'hole' | 'wire' | 'junction';

export interface ConnectionTarget {
  kind: TargetKind;
  ref: ConnectionRef;
  position: GridPoint;
  /** One line for the status bar, e.g. "U1 pin 14 (VCC)". */
  label: string;
  /** Extra detail, e.g. the connectivity group a hole belongs to. */
  detail?: string;
  /** Set for wire hits: where along the wire the cursor is. */
  wireId?: string;
  segment?: number;
}

export const SNAP_TOLERANCE = 0.55;

export function findConnectionTarget(
  circuit: Circuit,
  point: GridPoint,
  options: { includeWires?: boolean; tolerance?: number } = {},
): ConnectionTarget | undefined {
  const tolerance = options.tolerance ?? SNAP_TOLERANCE;

  // 1. Component pins win: they are the thing a student is aiming at.
  let bestPin: ConnectionTarget | undefined;
  let bestPinDistance = tolerance;
  for (const instance of circuit.components) {
    const definition = circuit.definitionOf(instance);
    for (const location of circuit.pinPositions(instance)) {
      const distance = Math.hypot(location.position.x - point.x, location.position.y - point.y);
      if (distance > bestPinDistance) continue;
      const pin = pinsOf(definition, instance.properties).find((p) => p.number === location.pinNumber);
      bestPinDistance = distance;
      bestPin = {
        kind: 'pin',
        ref: { kind: 'pin', componentId: instance.id, pin: location.pinNumber },
        position: location.position,
        label: `${instance.reference} pin ${location.pinNumber} (${location.pinName})`,
        ...(pin?.note ? { detail: pin.note } : {}),
      };
    }
  }
  if (bestPin) return bestPin;

  // 2. Breadboard holes.
  for (const board of circuit.boards) {
    const found = board.nearestHole(point.x, point.y, tolerance);
    if (!found) continue;
    const group = board.getGroup(found.hole.groupId);
    return {
      kind: 'hole',
      ref: { kind: 'hole', boardId: board.id, hole: found.hole.id },
      position: board.worldPosition(found.hole),
      label: `${board.definition.name} hole ${found.hole.id}`,
      ...(group ? { detail: `Connected to ${group.label}` } : {}),
    };
  }

  // 3. Existing junctions, then wires (a wire hit offers to make a junction).
  for (const junction of circuit.junctions) {
    const distance = Math.hypot(junction.position.x - point.x, junction.position.y - point.y);
    if (distance <= tolerance) {
      return {
        kind: 'junction',
        ref: { kind: 'junction', junctionId: junction.id },
        position: { ...junction.position },
        label: `Junction on wire ${junction.wireId}`,
      };
    }
  }

  if (options.includeWires !== false) {
    for (const wire of circuit.wires) {
      const path = circuit.wirePath(wire);
      if (!path) continue;
      const hit = hitTestPath(path, point);
      if (!hit || hit.distance > tolerance) continue;
      return {
        kind: 'wire',
        // A wire is not itself a connection point: committing here creates a junction.
        ref: { kind: 'junction', junctionId: '' },
        position: snapToGrid(hit.point),
        label: `Wire ${wire.id}`,
        detail: 'Click to branch here with a junction',
        wireId: wire.id,
        segment: hit.segment,
      };
    }
  }

  return undefined;
}

export function snapToGrid(point: GridPoint): GridPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/**
 * Would this wire actually connect anything?
 *
 * A wire whose two ends are already the same node is not a connection, it is a
 * decoration, and pretending otherwise teaches the wrong lesson.
 */
export function describeWireProblem(
  circuit: Circuit,
  from: ConnectionRef,
  to: ConnectionRef,
): string | undefined {
  const fromNode = nodeKey(circuit, from);
  const toNode = nodeKey(circuit, to);
  if (!fromNode || !toNode) return 'That endpoint is not a valid connection point.';
  if (fromNode === toNode) {
    return `Both ends of this wire land on the same connection (${circuit.describeConnection(from)}), so it would not connect anything.`;
  }
  return undefined;
}

function nodeKey(circuit: Circuit, ref: ConnectionRef): string | undefined {
  switch (ref.kind) {
    case 'hole': {
      const board = circuit.getBoard(ref.boardId);
      const hole = board?.getHole(ref.hole);
      return hole ? `g:${hole.groupId}` : undefined;
    }
    case 'pin': {
      const instance = circuit.getComponent(ref.componentId);
      if (!instance) return undefined;
      // A pin in a hole is the same node as the hole it sits in.
      const position = circuit.pinPosition(ref.componentId, ref.pin);
      if (position) {
        const found = circuit.holeAt(position.x, position.y);
        if (found) return `g:${found.hole.groupId}`;
      }
      return `p:${ref.componentId}:${ref.pin}`;
    }
    case 'junction':
      return `j:${ref.junctionId}`;
  }
}
