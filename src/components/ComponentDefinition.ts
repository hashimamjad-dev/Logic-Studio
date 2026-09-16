/**
 * What a physical part *is*.
 *
 * A definition describes the package, the pins and the behaviour. It never contains
 * any position, state or project data: an instance stores only its definition id,
 * placement and properties, which is why project files stay small and portable.
 *
 * Behaviour comes in three flavours and a part may use more than one:
 *
 *  - `gates`   pure combinational logic expressed as data (covers most 74xx gate
 *              packages with no code at all);
 *  - `model`   a named device model registered in code, for sequential and complex
 *              parts (flip-flops, counters, adders, decoders, displays);
 *  - `links`   conductive paths inside the part (switch contacts, bonded pins,
 *              resistors), returned by the model so they can change with state.
 */

import type {
  ElectricalRole,
  GridPoint,
  PinType,
  PropertyDefinition,
  PropertyValue,
  Rect,
  Rotation,
} from '../core/types';

export type ComponentCategory =
  | 'breadboards'
  | 'power'
  | 'inputs'
  | 'outputs'
  | 'logic-gates'
  | 'sequential'
  | 'ttl74xx'
  | 'displays'
  | 'instruments'
  | 'passive';

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  breadboards: 'Breadboards',
  power: 'Power',
  inputs: 'Inputs',
  outputs: 'Outputs',
  'logic-gates': 'Logic Gates',
  sequential: 'Sequential',
  ttl74xx: '74xx Integrated Circuits',
  displays: 'Displays',
  instruments: 'Instruments',
  passive: 'Passive',
};

export const CATEGORY_ORDER: ComponentCategory[] = [
  'breadboards',
  'power',
  'inputs',
  'outputs',
  'logic-gates',
  'sequential',
  'ttl74xx',
  'displays',
  'passive',
  'instruments',
];

export interface PinDefinition {
  number: number;
  name: string;
  type: PinType;
  direction: 'in' | 'out' | 'inout' | 'passive' | 'power';
  /** True when the pin is asserted low, e.g. CLR on a 7474. */
  activeLow?: boolean;
  /** Position relative to the component origin, in grid units, at rotation 0. */
  offset: GridPoint;
  electricalRole?: ElectricalRole;
  /** Free-text note shown in the pin inspector. */
  note?: string;
}

export type MountKind = 'through-hole' | 'free';

export interface FootprintDefinition {
  /** Human name of the package, e.g. `DIP-14`. */
  package: string;
  mount: MountKind;
  pinCount: number;
  /** Rows of pins, 1 for inline parts, 2 for DIP-style packages. */
  rows: number;
  /** Pin pitch along a row, in grid units. */
  pitch: number;
  /** Distance between the two pin rows, in grid units (3 = 0.3 in). */
  rowSpacing?: number;
  /** A two-row package must sit across a trench or its rows would be shorted. */
  requiresTrenchStraddle?: boolean;
  /** Body outline relative to the origin, in grid units, at rotation 0. */
  body: Rect;
  /** Off-board parts (supplies, instruments) may sit anywhere on the canvas. */
  allowFreePlacement: boolean;
  /** Board-mounted parts must have every pin in a hole. */
  requiresBoard: boolean;
  allowedRotations: Rotation[];
  /** Pairs of pin numbers bonded inside the package (tactile switch legs). */
  internalBonds?: [number, number][];
  /**
   * A rigid part sits flat on the board and cannot share its outline with another
   * rigid part. Axial parts - resistors, LEDs, lamps - have flexible leads and lean
   * over their neighbours all the time on a real board, so they are not rigid and
   * their outlines are allowed to cross.
   */
  rigidBody?: boolean;
}

export interface PowerRequirement {
  vccPins: number[];
  gndPins: number[];
  nominalVoltage: number;
  minVoltage: number;
  maxVoltage: number;
  /** Beyond this the part is destroyed rather than merely out of spec. */
  absoluteMaxVoltage: number;
  family: string;
}

export interface TimingSpec {
  /** Typical propagation delay, nanoseconds. */
  propagationDelayNs: number;
  /** Maximum clock frequency in MHz, for sequential parts. */
  maxClockMHz?: number;
}

export type GateOperation =
  | 'and'
  | 'or'
  | 'not'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'buffer';

export interface GateSpec {
  /** Label used in the inspector, e.g. `Gate 1`. */
  label: string;
  op: GateOperation;
  /** Pin numbers feeding the gate. */
  inputs: number[];
  /** Pin number driven by the gate. */
  output: number;
  /** Open-collector outputs cannot drive high; they need a pull-up. */
  openCollector?: boolean;
  /** Invert the output after the operation (used by decoders built from gates). */
  invertOutput?: boolean;
}

export interface DatasheetInfo {
  /** Short factual description of the function, from the datasheet. */
  functionSummary: string;
  /** Notes worth showing a student, e.g. unusual power pins. */
  notes?: string[];
}

export interface VisualHints {
  /** Fill colour family used by the renderer. */
  style:
    | 'dip'
    | 'led'
    | 'resistor'
    | 'switch'
    | 'button'
    | 'supply'
    | 'ground'
    | 'sevenseg'
    | 'probe'
    | 'clock'
    | 'lamp'
    | 'terminal';
  /** Text printed on the body. */
  bodyLabel?: string;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  /** Manufacturer part number where the part is a real device. */
  partNumber?: string;
  category: ComponentCategory;
  description: string;
  keywords: string[];
  footprint: FootprintDefinition;
  pins: PinDefinition[];
  power?: PowerRequirement;
  timing?: TimingSpec;
  properties?: PropertyDefinition[];
  /** Data-driven combinational behaviour. */
  gates?: GateSpec[];
  /** Named device model registered in `deviceModels.ts`. */
  model?: string;
  datasheet?: DatasheetInfo;
  visual: VisualHints;
  /** Prefix used when allocating instance ids: U1, R1, LED1... */
  refPrefix: string;
  /**
   * Parts whose pin layout depends on a property (axial parts with a lead span)
   * regenerate their pins here. Definitions are code, never project data.
   */
  resolvePins?: (properties: Record<string, PropertyValue>) => PinDefinition[];
  /** Same, for the body outline. */
  resolveBody?: (properties: Record<string, PropertyValue>) => Rect;
}

export function defaultProperties(def: ComponentDefinition): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const prop of def.properties ?? []) out[prop.key] = prop.default;
  return out;
}

export function pinsOf(
  def: ComponentDefinition,
  properties: Record<string, PropertyValue>,
): PinDefinition[] {
  return def.resolvePins ? def.resolvePins(properties) : def.pins;
}

export function bodyOf(
  def: ComponentDefinition,
  properties: Record<string, PropertyValue>,
): Rect {
  return def.resolveBody ? def.resolveBody(properties) : def.footprint.body;
}

/**
 * Standard DIP pin geometry. With the notch to the left and the part seen from
 * above, pin 1 is the lower-left pin, numbering runs left to right along the bottom
 * row, then right to left along the top row. The origin is pin 1.
 *
 * Chips are therefore laid out *horizontally*: the long axis of the package runs
 * across the columns and the two pin rows straddle the trench, exactly as a real
 * chip sits on a real board.
 */
export function dipPinOffsets(pinCount: number, rowSpacing = 3): GridPoint[] {
  if (pinCount % 2 !== 0) throw new Error(`DIP pin count must be even, got ${pinCount}`);
  const perRow = pinCount / 2;
  const offsets: GridPoint[] = [];
  for (let n = 1; n <= pinCount; n++) {
    if (n <= perRow) offsets.push({ x: n - 1, y: 0 });
    else offsets.push({ x: pinCount - n, y: -rowSpacing });
  }
  return offsets;
}

export function dipBody(pinCount: number, rowSpacing = 3): Rect {
  const perRow = pinCount / 2;
  return { x: -0.5, y: -rowSpacing, width: perRow, height: rowSpacing };
}

export function dipFootprint(pinCount: number, rowSpacing = 3): FootprintDefinition {
  return {
    package: `DIP-${pinCount}`,
    mount: 'through-hole',
    pinCount,
    rows: 2,
    pitch: 1,
    rowSpacing,
    requiresTrenchStraddle: true,
    body: dipBody(pinCount, rowSpacing),
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: true,
    // A DIP rotated by 90 degrees would put both pin rows in one column group,
    // which is a dead short across the package. Only 0 and 180 are physical.
    allowedRotations: [0, 180],
  };
}
