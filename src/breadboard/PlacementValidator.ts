/**
 * Placement rules.
 *
 * One function answers "can this part go here?" for every part in the library. The
 * rules are expressed in terms of holes, connectivity groups and trenches, so a new
 * package gets the checks for free and no renderer or editor code has to know what a
 * DIP is.
 *
 * Failures come back as sentences a student can act on, never as a bare boolean.
 */

import type { Circuit, ComponentInstance } from '../core/Circuit';
import type { ComponentDefinition } from '../components/ComponentDefinition';
import { bodyOf, pinsOf } from '../components/ComponentDefinition';
import {
  GridPoint,
  PropertyValue,
  Rect,
  Rotation,
  rectContains,
  rectsOverlap,
  rotateOffset,
  rotateRect,
} from '../core/types';

export interface PinPlacement {
  pinNumber: number;
  pinName: string;
  position: GridPoint;
  /** Global hole id (`BB1:a10`) when the pin landed in a hole. */
  holeId?: string;
  boardId?: string;
  groupId?: string;
}

export interface PlacementResult {
  valid: boolean;
  /** Ordered, most important first. Shown verbatim in the status bar. */
  reasons: string[];
  boardId?: string;
  pins: PinPlacement[];
}

export interface PlacementRequest {
  definition: ComponentDefinition;
  position: GridPoint;
  rotation: Rotation;
  properties: Record<string, PropertyValue>;
  /** When moving an existing part, ignore its own pins and body. */
  excludeComponentId?: string;
}

export function validatePlacement(circuit: Circuit, request: PlacementRequest): PlacementResult {
  const { definition: def, position, rotation, properties } = request;
  const reasons: string[] = [];
  const label = def.partNumber ?? def.name;

  if (!def.footprint.allowedRotations.includes(rotation)) {
    reasons.push(
      def.footprint.requiresTrenchStraddle
        ? `${label} cannot be rotated to ${rotation} degrees: both pin rows would land in the same column group and short together.`
        : `${label} cannot be rotated to ${rotation} degrees.`,
    );
  }

  const pins = pinsOf(def, properties).map((pin) => {
    const offset = rotateOffset(pin.offset, rotation);
    const world = { x: position.x + offset.x, y: position.y + offset.y };
    const placement: PinPlacement = { pinNumber: pin.number, pinName: pin.name, position: world };
    const found = circuit.holeAt(world.x, world.y);
    if (found) {
      placement.holeId = `${found.board.id}:${found.hole.id}`;
      placement.boardId = found.board.id;
      placement.groupId = found.hole.groupId;
    }
    return placement;
  });

  const body = worldBody(def, properties, position, rotation);

  if (def.footprint.requiresBoard) {
    checkThroughHole(circuit, request, pins, body, label, reasons);
  } else {
    checkFreePart(circuit, body, label, reasons);
  }

  checkBodyOverlap(circuit, request, body, label, reasons);

  const boardId = pins.find((p) => p.boardId)?.boardId;
  return {
    valid: reasons.length === 0,
    reasons,
    ...(boardId ? { boardId } : {}),
    pins,
  };
}

function worldBody(
  def: ComponentDefinition,
  properties: Record<string, PropertyValue>,
  position: GridPoint,
  rotation: Rotation,
): Rect {
  const local = rotateRect(bodyOf(def, properties), rotation);
  return {
    x: position.x + local.x,
    y: position.y + local.y,
    width: local.width,
    height: local.height,
  };
}

function checkThroughHole(
  circuit: Circuit,
  request: PlacementRequest,
  pins: PinPlacement[],
  body: Rect,
  label: string,
  reasons: string[],
): void {
  const { definition: def } = request;

  // Rule 1: every lead must be in a hole.
  const missing = pins.filter((p) => !p.holeId);
  if (missing.length > 0) {
    const names = missing.slice(0, 3).map((p) => `${p.pinNumber}`).join(', ');
    const more = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
    reasons.push(
      pins.every((p) => !p.holeId)
        ? `${label} is not over a breadboard. Every lead has to go into a hole.`
        : `Pin ${names}${more} of ${label} is not over a breadboard hole.`,
    );
    return;
  }

  // Rule 2: one board, and the body has to fit on it.
  const boardIds = new Set(pins.map((p) => p.boardId));
  if (boardIds.size > 1) {
    reasons.push(`${label} would span two breadboards. Place it on a single board.`);
    return;
  }
  const board = circuit.getBoard([...boardIds][0]!);
  if (board && !rectContains(board.bounds(), body)) {
    reasons.push(`${label} extends past the edge of the board.`);
  }

  // Rule 3: a two-row package has to straddle a trench.
  if (def.footprint.requiresTrenchStraddle && board) {
    const banks = new Set<string>();
    for (const pin of pins) {
      const hole = board.getHole(pin.holeId!.split(':')[1]);
      if (hole?.bankId) banks.add(hole.bankId);
      else if (hole?.railId) banks.add(`rail:${hole.railId}`);
    }
    const bankList = [...banks];
    if (bankList.length !== 2 || !board.trenchBetween(bankList[0], bankList[1])) {
      reasons.push(
        `${label} must straddle the centre trench, with one row of pins on each side. ` +
          `Both rows are currently on the same side, which would short every pin pair together.`,
      );
    }
  }

  // Rule 4: two pins of one part may never share a clip, unless the package bonds
  // them internally. This is the general form of "a DIP cannot be rotated".
  const bonds = def.footprint.internalBonds ?? [];
  const byGroup = new Map<string, PinPlacement[]>();
  for (const pin of pins) {
    if (!pin.groupId) continue;
    const list = byGroup.get(pin.groupId) ?? [];
    list.push(pin);
    byGroup.set(pin.groupId, list);
  }
  for (const [groupId, group] of byGroup) {
    if (group.length < 2) continue;
    const bonded = group.every((a) =>
      group.every(
        (b) =>
          a.pinNumber === b.pinNumber ||
          bonds.some(
            ([x, y]) =>
              (x === a.pinNumber && y === b.pinNumber) || (y === a.pinNumber && x === b.pinNumber),
          ),
      ),
    );
    if (bonded) continue;
    const groupLabel = board?.getGroup(groupId)?.label ?? groupId;
    const numbers = group.map((p) => p.pinNumber).join(' and ');
    reasons.push(
      `Pins ${numbers} of ${label} would be shorted together in group ${groupLabel}.`,
    );
  }

  // Rule 5: a hole holds one lead.
  const occupancy = circuit.holeOccupancy(request.excludeComponentId);
  for (const pin of pins) {
    const taken = occupancy.get(pin.holeId!);
    if (!taken) continue;
    const other = circuit.getComponent(taken.componentId);
    const holeName = pin.holeId!.split(':')[1];
    reasons.push(
      `Hole ${holeName} is already taken by ${other?.reference ?? taken.componentId} pin ${taken.pin}.`,
    );
  }
}

function checkFreePart(circuit: Circuit, body: Rect, label: string, reasons: string[]): void {
  for (const board of circuit.boards) {
    if (rectsOverlap(board.bounds(), body)) {
      reasons.push(`${label} is a bench module: place it beside the breadboard, not on top of it.`);
      return;
    }
  }
}

function checkBodyOverlap(
  circuit: Circuit,
  request: PlacementRequest,
  body: Rect,
  label: string,
  reasons: string[],
): void {
  // Only rigid packages fight over space. Axial parts lean over their neighbours on
  // a real board all the time, so their outlines are allowed to cross.
  if (request.definition.footprint.rigidBody === false) return;
  for (const other of circuit.components) {
    if (other.id === request.excludeComponentId) continue;
    const otherDef = circuit.definitionOf(other);
    if (otherDef.footprint.rigidBody === false) continue;
    if (rectsOverlap(circuit.componentBounds(other), body, 0.2)) {
      reasons.push(`${label} overlaps ${other.reference}.`);
      return;
    }
  }
}

/**
 * Find the nearest legal position for a part being dragged, searching outwards from
 * the pointer. Returns undefined when nothing nearby works, so the caller can show a
 * rejected preview instead of silently teleporting the part.
 */
export function findNearestLegalPlacement(
  circuit: Circuit,
  request: PlacementRequest,
  searchRadius = 3,
): { position: GridPoint; result: PlacementResult } | undefined {
  const origin = { x: Math.round(request.position.x), y: Math.round(request.position.y) };
  const candidates: GridPoint[] = [];
  for (let radius = 0; radius <= searchRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        candidates.push({ x: origin.x + dx, y: origin.y + dy });
      }
    }
  }
  for (const position of candidates) {
    const result = validatePlacement(circuit, { ...request, position });
    if (result.valid) return { position, result };
  }
  return undefined;
}

export function placementOf(circuit: Circuit, instance: ComponentInstance): PlacementResult {
  return validatePlacement(circuit, {
    definition: circuit.definitionOf(instance),
    position: instance.position,
    rotation: instance.rotation,
    properties: instance.properties,
    excludeComponentId: instance.id,
  });
}
