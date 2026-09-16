/**
 * Everything on the bench that is not a 74-series chip: supplies, switches, LEDs,
 * resistors, displays and probes.
 *
 * Board-mounted parts declare a through-hole footprint and are validated exactly like
 * an IC. Bench instruments and supplies are `free` parts: they sit on the canvas next
 * to the board and are reached with wires, which is how a real bench is laid out.
 */

import type { PropertyValue, Rect } from '../core/types';
import type { ComponentDefinition, PinDefinition } from './ComponentDefinition';

const WIRE_COLOR_CHOICES = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue', label: 'Blue' },
  { value: 'white', label: 'White' },
];

function num(props: Record<string, PropertyValue>, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * Power
 * ------------------------------------------------------------------ */

const BENCH_SUPPLY: ComponentDefinition = {
  id: 'pwr-supply',
  name: 'DC Power Supply',
  category: 'power',
  description:
    'Adjustable bench supply with a positive and a negative terminal. It powers nothing until both terminals are wired into the circuit.',
  keywords: ['power', 'supply', 'psu', 'dc', 'volt', '5v', 'vcc', 'source'],
  footprint: {
    package: 'Bench instrument',
    mount: 'free',
    pinCount: 2,
    rows: 1,
    pitch: 2,
    body: { x: 0, y: 0, width: 10, height: 6 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0],
  },
  pins: [
    { number: 1, name: '+', type: 'POWER', direction: 'power', offset: { x: 10, y: 2 }, electricalRole: 'VCC' },
    { number: 2, name: '-', type: 'GROUND', direction: 'power', offset: { x: 10, y: 4 }, electricalRole: 'GND' },
  ],
  properties: [
    { key: 'voltage', label: 'Voltage', kind: 'number', default: 5, min: 0, max: 24, step: 0.1, unit: 'V' },
    { key: 'currentLimit', label: 'Current limit', kind: 'number', default: 500, min: 10, max: 5000, step: 10, unit: 'mA' },
    { key: 'enabled', label: 'Output enabled', kind: 'boolean', default: true },
  ],
  model: 'supply',
  visual: { style: 'supply', bodyLabel: 'DC SUPPLY' },
  refPrefix: 'PS',
  datasheet: {
    functionSummary: 'Holds the positive terminal at the set voltage above the negative terminal.',
    notes: ['The negative terminal is the circuit ground reference.'],
  },
};

const BATTERY: ComponentDefinition = {
  id: 'pwr-battery',
  name: 'Battery',
  category: 'power',
  description: 'A battery with a positive and a negative terminal and a configurable cell voltage.',
  keywords: ['battery', 'cell', 'power', 'dc', '9v', 'source'],
  footprint: {
    package: 'Battery',
    mount: 'free',
    pinCount: 2,
    rows: 1,
    pitch: 2,
    body: { x: 0, y: 0, width: 7, height: 4 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0],
  },
  pins: [
    { number: 1, name: '+', type: 'POWER', direction: 'power', offset: { x: 7, y: 1 }, electricalRole: 'VCC' },
    { number: 2, name: '-', type: 'GROUND', direction: 'power', offset: { x: 7, y: 3 }, electricalRole: 'GND' },
  ],
  properties: [
    { key: 'voltage', label: 'Voltage', kind: 'number', default: 9, min: 0.5, max: 24, step: 0.1, unit: 'V' },
    { key: 'currentLimit', label: 'Current limit', kind: 'number', default: 300, min: 10, max: 5000, step: 10, unit: 'mA' },
    { key: 'enabled', label: 'Connected', kind: 'boolean', default: true },
  ],
  model: 'supply',
  visual: { style: 'supply', bodyLabel: 'BATTERY' },
  refPrefix: 'BT',
};

const VCC_TERMINAL: ComponentDefinition = {
  id: 'pwr-vcc',
  name: '+5V Supply Terminal',
  category: 'power',
  description:
    'A fixed +5 V source terminal, measured against the circuit ground. Still needs a ground reference somewhere in the circuit.',
  keywords: ['vcc', '5v', 'power', 'rail', 'positive', 'supply'],
  footprint: {
    package: 'Terminal',
    mount: 'free',
    pinCount: 1,
    rows: 1,
    pitch: 1,
    body: { x: -1.5, y: -2.5, width: 3, height: 2.5 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: [
    { number: 1, name: '+5V', type: 'POWER', direction: 'power', offset: { x: 0, y: 0 }, electricalRole: 'VCC' },
  ],
  properties: [
    { key: 'voltage', label: 'Voltage', kind: 'number', default: 5, min: 1, max: 15, step: 0.1, unit: 'V' },
  ],
  model: 'vccTerminal',
  visual: { style: 'terminal', bodyLabel: '+5V' },
  refPrefix: 'VCC',
};

const GND_TERMINAL: ComponentDefinition = {
  id: 'pwr-gnd',
  name: 'Ground Terminal',
  category: 'power',
  description: 'The 0 V reference for the whole circuit. Every supply needs a return path to it.',
  keywords: ['gnd', 'ground', '0v', 'earth', 'reference', 'negative'],
  footprint: {
    package: 'Terminal',
    mount: 'free',
    pinCount: 1,
    rows: 1,
    pitch: 1,
    body: { x: -1.5, y: 0, width: 3, height: 2.5 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: [
    { number: 1, name: 'GND', type: 'GROUND', direction: 'power', offset: { x: 0, y: 0 }, electricalRole: 'GND' },
  ],
  model: 'gndTerminal',
  visual: { style: 'ground', bodyLabel: 'GND' },
  refPrefix: 'GND',
};

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

const TOGGLE_SWITCH: ComponentDefinition = {
  id: 'in-toggle',
  name: 'Toggle Switch (SPDT)',
  category: 'inputs',
  description:
    'Single-pole double-throw switch. The common terminal is connected to throw A or throw B; wire one throw to +5 V and the other to ground to make a clean logic level.',
  keywords: ['switch', 'toggle', 'spdt', 'input', 'logic level', 'slide'],
  footprint: {
    package: 'SPDT-3',
    mount: 'through-hole',
    pinCount: 3,
    rows: 1,
    pitch: 2,
    body: { x: -0.8, y: -3.2, width: 5.6, height: 3.6 },
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: true,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: [
    { number: 1, name: 'A', type: 'PASSIVE', direction: 'passive', offset: { x: 0, y: 0 }, note: 'Throw A: selected when the switch is up.' },
    { number: 2, name: 'COM', type: 'PASSIVE', direction: 'passive', offset: { x: 2, y: 0 }, note: 'Common terminal.' },
    { number: 3, name: 'B', type: 'PASSIVE', direction: 'passive', offset: { x: 4, y: 0 }, note: 'Throw B: selected when the switch is down.' },
  ],
  properties: [
    {
      key: 'position',
      label: 'Position',
      kind: 'choice',
      default: 'B',
      choices: [
        { value: 'A', label: 'A (up)' },
        { value: 'B', label: 'B (down)' },
      ],
    },
  ],
  model: 'toggleSwitch',
  visual: { style: 'switch' },
  refPrefix: 'SW',
};

const PUSH_BUTTON: ComponentDefinition = {
  id: 'in-button',
  name: 'Push Button',
  category: 'inputs',
  description:
    'Momentary tactile switch. The two pins on each side are bonded inside the package, and the body straddles the trench exactly like a DIP.',
  keywords: ['button', 'push', 'momentary', 'tactile', 'input', 'switch'],
  footprint: {
    package: 'TACT-4',
    mount: 'through-hole',
    pinCount: 4,
    rows: 2,
    pitch: 2,
    rowSpacing: 3,
    requiresTrenchStraddle: true,
    body: { x: -0.8, y: -3.8, width: 3.6, height: 4.6 },
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: true,
    allowedRotations: [0, 180],
    internalBonds: [
      [1, 2],
      [3, 4],
    ],
  },
  pins: [
    { number: 1, name: '1a', type: 'PASSIVE', direction: 'passive', offset: { x: 0, y: 0 }, note: 'Bonded to pin 2 inside the package.' },
    { number: 2, name: '1b', type: 'PASSIVE', direction: 'passive', offset: { x: 2, y: 0 }, note: 'Bonded to pin 1 inside the package.' },
    { number: 3, name: '2b', type: 'PASSIVE', direction: 'passive', offset: { x: 2, y: -3 }, note: 'Bonded to pin 4 inside the package.' },
    { number: 4, name: '2a', type: 'PASSIVE', direction: 'passive', offset: { x: 0, y: -3 }, note: 'Bonded to pin 3 inside the package.' },
  ],
  properties: [{ key: 'pressed', label: 'Pressed', kind: 'boolean', default: false }],
  model: 'pushButton',
  visual: { style: 'button' },
  refPrefix: 'SW',
};

const LOGIC_SOURCE: ComponentDefinition = {
  id: 'in-logic',
  name: 'Logic Level Source',
  category: 'inputs',
  description:
    'An idealised bench source that drives a single output HIGH or LOW directly. Useful for quick tests; use a real switch when the experiment is about wiring.',
  keywords: ['logic', 'input', 'source', 'high', 'low', 'level', 'ideal'],
  footprint: {
    package: 'Bench module',
    mount: 'free',
    pinCount: 1,
    rows: 1,
    pitch: 1,
    body: { x: 0, y: 0, width: 5, height: 3 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0],
  },
  pins: [{ number: 1, name: 'OUT', type: 'OUTPUT', direction: 'out', offset: { x: 5, y: 1.5 } }],
  properties: [
    { key: 'level', label: 'Level', kind: 'choice', default: 'L', choices: [{ value: 'H', label: 'HIGH' }, { value: 'L', label: 'LOW' }] },
    { key: 'voltage', label: 'High level', kind: 'number', default: 5, min: 1, max: 15, step: 0.1, unit: 'V' },
  ],
  model: 'logicSource',
  visual: { style: 'switch', bodyLabel: 'LOGIC' },
  refPrefix: 'IN',
};

const CLOCK_GENERATOR: ComponentDefinition = {
  id: 'in-clock',
  name: 'Clock Generator',
  category: 'inputs',
  description:
    'A square-wave generator module. It has to be powered like any other bench module: wire VCC and GND before expecting an output.',
  keywords: ['clock', 'oscillator', 'square wave', 'pulse', 'frequency', 'timer'],
  footprint: {
    package: 'Bench module',
    mount: 'free',
    pinCount: 3,
    rows: 1,
    pitch: 2,
    body: { x: 0, y: 0, width: 8, height: 6 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0],
  },
  pins: [
    { number: 1, name: 'VCC', type: 'POWER', direction: 'power', offset: { x: 0, y: 2 }, electricalRole: 'VCC' },
    { number: 2, name: 'GND', type: 'GROUND', direction: 'power', offset: { x: 0, y: 4 }, electricalRole: 'GND' },
    { number: 3, name: 'OUT', type: 'OUTPUT', direction: 'out', offset: { x: 8, y: 3 } },
  ],
  power: {
    vccPins: [1],
    gndPins: [2],
    nominalVoltage: 5,
    minVoltage: 4.5,
    maxVoltage: 5.5,
    absoluteMaxVoltage: 7,
    family: 'Bench module',
  },
  properties: [
    { key: 'frequency', label: 'Frequency', kind: 'number', default: 1, min: 0.1, max: 1000, step: 0.1, unit: 'Hz' },
    { key: 'duty', label: 'Duty cycle', kind: 'number', default: 50, min: 5, max: 95, step: 1, unit: '%' },
    { key: 'enabled', label: 'Running', kind: 'boolean', default: true },
  ],
  model: 'clock',
  visual: { style: 'clock', bodyLabel: 'CLK' },
  refPrefix: 'CLK',
};

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

function axialPins(
  span: number,
  names: [string, string],
  notes: [string?, string?] = [],
): PinDefinition[] {
  return [
    { number: 1, name: names[0], type: 'PASSIVE', direction: 'passive', offset: { x: 0, y: 0 }, ...(notes[0] ? { note: notes[0] } : {}) },
    { number: 2, name: names[1], type: 'PASSIVE', direction: 'passive', offset: { x: span, y: 0 }, ...(notes[1] ? { note: notes[1] } : {}) },
  ];
}

function axialBody(span: number, height: number, top: number): Rect {
  return { x: -0.6, y: top, width: span + 1.2, height };
}

const LED: ComponentDefinition = {
  id: 'out-led',
  name: 'LED',
  category: 'outputs',
  description:
    'A polarised indicator. The long lead is the anode: current flows from anode to cathode, and a reversed LED simply stays dark.',
  keywords: ['led', 'light', 'indicator', 'diode', 'output', 'lamp'],
  footprint: {
    package: 'LED-2',
    mount: 'through-hole',
    pinCount: 2,
    rows: 1,
    pitch: 1,
    body: axialBody(3, 3.2, -2.6),
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: false,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: axialPins(3, ['A', 'K'], ['Anode, the long lead.', 'Cathode, the flat side.']),
  properties: [
    { key: 'color', label: 'Colour', kind: 'choice', default: 'red', choices: WIRE_COLOR_CHOICES },
    { key: 'span', label: 'Lead span', kind: 'number', default: 3, min: 1, max: 10, step: 1, unit: 'holes' },
    { key: 'forwardVoltage', label: 'Forward voltage', kind: 'number', default: 2, min: 1.5, max: 3.6, step: 0.1, unit: 'V' },
  ],
  model: 'led',
  visual: { style: 'led' },
  refPrefix: 'LED',
  resolvePins: (props) => axialPins(num(props, 'span', 3), ['A', 'K'], ['Anode, the long lead.', 'Cathode, the flat side.']),
  resolveBody: (props) => axialBody(num(props, 'span', 3), 3.2, -2.6),
};

const LAMP: ComponentDefinition = {
  id: 'out-lamp',
  name: 'Indicator Lamp',
  category: 'outputs',
  description: 'A non-polarised filament indicator. It lights whenever there is a voltage across it.',
  keywords: ['lamp', 'bulb', 'light', 'indicator', 'output'],
  footprint: {
    package: 'LAMP-2',
    mount: 'through-hole',
    pinCount: 2,
    rows: 1,
    pitch: 1,
    body: axialBody(4, 4, -3.4),
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: false,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: axialPins(4, ['1', '2']),
  properties: [
    { key: 'span', label: 'Lead span', kind: 'number', default: 4, min: 2, max: 10, step: 1, unit: 'holes' },
    { key: 'threshold', label: 'Turn-on voltage', kind: 'number', default: 2.5, min: 0.5, max: 12, step: 0.1, unit: 'V' },
  ],
  model: 'lamp',
  visual: { style: 'lamp' },
  refPrefix: 'LP',
  resolvePins: (props) => axialPins(num(props, 'span', 4), ['1', '2']),
  resolveBody: (props) => axialBody(num(props, 'span', 4), 4, -3.4),
};

const RESISTOR: ComponentDefinition = {
  id: 'pas-resistor',
  name: 'Resistor',
  category: 'passive',
  description:
    'An axial resistor. ProtoLab models it as a weak link: it passes a level between two nets without overriding anything that is driving them hard, which is exactly what a pull-up, pull-down or series limiter does.',
  keywords: ['resistor', 'pull up', 'pulldown', 'ohm', 'passive', 'limit'],
  footprint: {
    package: 'AXIAL-2',
    mount: 'through-hole',
    pinCount: 2,
    rows: 1,
    pitch: 1,
    body: axialBody(4, 1.8, -0.9),
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: false,
    allowedRotations: [0, 90, 180, 270],
  },
  pins: axialPins(4, ['1', '2']),
  properties: [
    { key: 'resistance', label: 'Resistance', kind: 'number', default: 330, min: 1, max: 1000000, step: 1, unit: 'ohm' },
    { key: 'span', label: 'Lead span', kind: 'number', default: 4, min: 2, max: 12, step: 1, unit: 'holes' },
  ],
  model: 'resistor',
  visual: { style: 'resistor' },
  refPrefix: 'R',
  resolvePins: (props) => axialPins(num(props, 'span', 4), ['1', '2']),
  resolveBody: (props) => axialBody(num(props, 'span', 4), 1.8, -0.9),
};

const LOGIC_PROBE: ComponentDefinition = {
  id: 'inst-probe',
  name: 'Logic Probe',
  category: 'instruments',
  description: 'Touch it to any net to read HIGH, LOW, floating or contention without disturbing the circuit.',
  keywords: ['probe', 'logic probe', 'measure', 'test', 'instrument', 'debug'],
  footprint: {
    package: 'Bench instrument',
    mount: 'free',
    pinCount: 1,
    rows: 1,
    pitch: 1,
    body: { x: 0, y: 0, width: 6, height: 3 },
    allowFreePlacement: true,
    requiresBoard: false,
    rigidBody: true,
    allowedRotations: [0],
  },
  pins: [{ number: 1, name: 'TIP', type: 'INPUT', direction: 'in', offset: { x: 6, y: 1.5 } }],
  model: 'logicProbe',
  visual: { style: 'probe', bodyLabel: 'PROBE' },
  refPrefix: 'LP',
};

/* ------------------------------------------------------------------ *
 * Displays
 * ------------------------------------------------------------------ */

const SEVEN_SEGMENT: ComponentDefinition = {
  id: 'disp-7seg',
  name: '7-Segment Display',
  category: 'displays',
  description:
    'A single-digit seven-segment display in a wide 0.6 in package, so it straddles the trench with three spare columns on each side.',
  keywords: ['seven segment', '7 segment', 'display', 'digit', 'numeric', 'output'],
  footprint: {
    package: 'DIP-10 (0.6 in)',
    mount: 'through-hole',
    pinCount: 10,
    rows: 2,
    pitch: 1,
    rowSpacing: 6,
    requiresTrenchStraddle: true,
    body: { x: -0.5, y: -6, width: 5, height: 6 },
    allowFreePlacement: false,
    requiresBoard: true,
    rigidBody: true,
    allowedRotations: [0, 180],
  },
  pins: [
    { number: 1, name: 'E', type: 'INPUT', direction: 'in', offset: { x: 0, y: 0 } },
    { number: 2, name: 'D', type: 'INPUT', direction: 'in', offset: { x: 1, y: 0 } },
    { number: 3, name: 'COM', type: 'PASSIVE', direction: 'passive', offset: { x: 2, y: 0 }, note: 'Common pin, bonded to pin 8.' },
    { number: 4, name: 'C', type: 'INPUT', direction: 'in', offset: { x: 3, y: 0 } },
    { number: 5, name: 'DP', type: 'INPUT', direction: 'in', offset: { x: 4, y: 0 }, note: 'Decimal point.' },
    { number: 6, name: 'B', type: 'INPUT', direction: 'in', offset: { x: 4, y: -6 } },
    { number: 7, name: 'A', type: 'INPUT', direction: 'in', offset: { x: 3, y: -6 } },
    { number: 8, name: 'COM', type: 'PASSIVE', direction: 'passive', offset: { x: 2, y: -6 }, note: 'Common pin, bonded to pin 3.' },
    { number: 9, name: 'F', type: 'INPUT', direction: 'in', offset: { x: 1, y: -6 } },
    { number: 10, name: 'G', type: 'INPUT', direction: 'in', offset: { x: 0, y: -6 } },
  ],
  properties: [
    {
      key: 'common',
      label: 'Common',
      kind: 'choice',
      default: 'cathode',
      choices: [
        { value: 'cathode', label: 'Common cathode' },
        { value: 'anode', label: 'Common anode' },
      ],
      help: 'Common cathode ties COM to ground and lights a segment on HIGH. Common anode ties COM to +5 V and lights on LOW.',
    },
    { key: 'color', label: 'Colour', kind: 'choice', default: 'red', choices: WIRE_COLOR_CHOICES },
  ],
  model: 'sevenSegment',
  visual: { style: 'sevenseg' },
  refPrefix: 'DS',
};

// The two COM pins really are one node inside the package.
SEVEN_SEGMENT.footprint.internalBonds = [[3, 8]];

export const DISCRETE_DEFINITIONS: ComponentDefinition[] = [
  BENCH_SUPPLY,
  BATTERY,
  VCC_TERMINAL,
  GND_TERMINAL,
  TOGGLE_SWITCH,
  PUSH_BUTTON,
  LOGIC_SOURCE,
  CLOCK_GENERATOR,
  LED,
  LAMP,
  RESISTOR,
  LOGIC_PROBE,
  SEVEN_SEGMENT,
];
