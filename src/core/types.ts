/**
 * ProtoLab core vocabulary.
 *
 * Every coordinate in the model is expressed in *grid units*, where one unit is the
 * 0.1 inch pitch of a solderless breadboard. Pixels only appear in the renderer, so
 * zooming can never change electrical meaning.
 */

/** Position in grid units (1 unit = 0.1 in = one breadboard hole pitch). */
export interface GridPoint {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Digital value carried by a net. */
export type LogicValue =
  | 'L' // solid logic low
  | 'H' // solid logic high
  | 'X' // contention / indeterminate
  | 'Z'; // floating, nothing is driving it

/**
 * How hard something is driving a net. `supply` beats everything (it is a power
 * source), `strong` is a push-pull output, `weak` is a pull-up/pull-down resistor,
 * `none` is a high-impedance output or an input.
 */
export type DriveStrength = 'none' | 'weak' | 'strong' | 'supply';

export interface Drive {
  value: LogicValue;
  strength: DriveStrength;
  /** Volts, only meaningful for `supply` strength drivers. */
  voltage?: number;
  /** Set by a supply's negative terminal: this net is the 0 V reference. */
  reference?: boolean;
  /** Connection point that produced this drive, used for error messages. */
  source: string;
}

export type PinType =
  | 'INPUT'
  | 'OUTPUT'
  | 'BIDIRECTIONAL'
  | 'POWER'
  | 'GROUND'
  | 'CLOCK'
  | 'RESET'
  | 'SET'
  | 'ENABLE'
  | 'TRISTATE'
  | 'PASSIVE';

export type ElectricalRole = 'VCC' | 'GND' | 'SIGNAL';

/** Power / health state of a physical part. */
export type ElectricalState =
  | 'POWERED'
  | 'UNPOWERED'
  | 'NO_GROUND'
  | 'UNDERVOLTAGE'
  | 'OVERVOLTAGE'
  | 'REVERSE_POLARITY'
  | 'OVER_CURRENT'
  | 'OVERHEATING'
  | 'DAMAGED';

export const ELECTRICAL_STATE_LABEL: Record<ElectricalState, string> = {
  POWERED: 'Powered',
  UNPOWERED: 'Unpowered',
  NO_GROUND: 'No ground reference',
  UNDERVOLTAGE: 'Undervoltage',
  OVERVOLTAGE: 'Overvoltage',
  REVERSE_POLARITY: 'Reverse polarity',
  OVER_CURRENT: 'Over current',
  OVERHEATING: 'Overheating',
  DAMAGED: 'Damaged',
};

export type Severity = 'info' | 'warning' | 'error';

/** A message the student can act on. Never silently mutates the circuit. */
export interface Diagnostic {
  id: string;
  severity: Severity;
  /** Short machine-readable reason, e.g. `ic.unpowered`. */
  code: string;
  message: string;
  /** Ids of the objects the message is about, for click-to-locate. */
  subjects: string[];
}

/** JSON-safe property value. Project files never contain functions or classes. */
export type PropertyValue = string | number | boolean;

export interface PropertyDefinition {
  key: string;
  label: string;
  kind: 'number' | 'text' | 'boolean' | 'choice' | 'color';
  default: PropertyValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: { value: string; label: string }[];
  help?: string;
}

/* ------------------------------------------------------------------ *
 * Connection points
 *
 * A connection point is anything a wire is allowed to terminate on. It is always
 * referenced symbolically - never by coordinate - so that moving objects around
 * cannot silently change what is connected to what.
 * ------------------------------------------------------------------ */

export type ConnectionRef =
  | { kind: 'hole'; boardId: string; hole: string }
  | { kind: 'pin'; componentId: string; pin: number }
  | { kind: 'junction'; junctionId: string };

export function connectionRefId(ref: ConnectionRef): string {
  switch (ref.kind) {
    case 'hole':
      return `h:${ref.boardId}:${ref.hole}`;
    case 'pin':
      return `p:${ref.componentId}:${ref.pin}`;
    case 'junction':
      return `j:${ref.junctionId}`;
  }
}

export function connectionRefsEqual(a: ConnectionRef, b: ConnectionRef): boolean {
  return connectionRefId(a) === connectionRefId(b);
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** Rotate an offset (grid units) about the component origin. */
export function rotateOffset(offset: GridPoint, rotation: Rotation): GridPoint {
  switch (rotation) {
    case 0:
      return { x: offset.x, y: offset.y };
    case 90:
      return { x: -offset.y, y: offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: offset.y, y: -offset.x };
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rotateRect(rect: Rect, rotation: Rotation): Rect {
  const corners: GridPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((p) => rotateOffset(p, rotation));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.001): boolean {
  return (
    a.x + a.width - tolerance > b.x &&
    b.x + b.width - tolerance > a.x &&
    a.y + a.height - tolerance > b.y &&
    b.y + b.height - tolerance > a.y
  );
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0.001): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}
