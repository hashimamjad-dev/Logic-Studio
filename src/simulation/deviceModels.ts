/**
 * Device models.
 *
 * Combinational gate packages are pure data (`ComponentDefinition.gates`) and are
 * handled by the engine. Everything with internal state, internal wiring or a
 * physical behaviour beyond logic lives here, behind one small interface.
 *
 * A model never touches the renderer, the circuit or the net list directly: it reads
 * its pins, writes its pins, and puts anything the renderer needs into `display`.
 */

import type { DriveStrength, LogicValue, PropertyValue } from '../core/types';

export interface DeviceLink {
  a: number;
  b: number;
  /** `conductor` merges the two pins into one net; `resistor` couples them weakly. */
  kind: 'conductor' | 'resistor';
}

export interface LinkContext {
  properties: Record<string, PropertyValue>;
  state: Record<string, unknown>;
}

export interface DriveOptions {
  strength?: DriveStrength;
  voltage?: number;
  /** Marks the net as the circuit's 0 V reference. */
  reference?: boolean;
}

export interface DeviceContext extends LinkContext {
  componentId: string;
  reference: string;
  /** Resolved logic value of the net attached to this pin. */
  value(pin: number): LogicValue;
  /** Resolved net voltage, or undefined when the net is floating. */
  voltage(pin: number): number | undefined;
  /** How hard the net at this pin is being held, `supply` meaning a rail. */
  strength(pin: number): DriveStrength;
  /** True when the pin's net is the circuit ground reference. */
  isGroundReference(pin: number): boolean;
  drive(pin: number, value: LogicValue, options?: DriveOptions): void;
  /** True when the part's declared power pins are within spec. */
  powered: boolean;
  /** Voltage measured on the part's VCC pin, used as its output high level. */
  supplyVoltage: number;
  /** Simulation time in nanoseconds. */
  now: number;
  /** Ask to be evaluated again at an absolute simulation time. */
  scheduleAt(timeNs: number): void;
  warn(code: string, message: string): void;
  /** Anything the renderer or inspector should show: lit segments, probe reading. */
  display: Record<string, unknown>;
}

export interface DeviceModel {
  id: string;
  links?(ctx: LinkContext): DeviceLink[];
  evaluate(ctx: DeviceContext): void;
}

const models = new Map<string, DeviceModel>();

export function registerModel(model: DeviceModel): void {
  if (models.has(model.id)) throw new Error(`Duplicate device model: ${model.id}`);
  models.set(model.id, model);
}

export function getModel(id: string | undefined): DeviceModel | undefined {
  return id ? models.get(id) : undefined;
}

/* ------------------------------------------------------------------ *
 * Small helpers shared by the models
 * ------------------------------------------------------------------ */

function propNumber(ctx: LinkContext, key: string, fallback: number): number {
  const value = ctx.properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function propBool(ctx: LinkContext, key: string, fallback: boolean): boolean {
  const value = ctx.properties[key];
  return typeof value === 'boolean' ? value : fallback;
}

function propText(ctx: LinkContext, key: string, fallback: string): string {
  const value = ctx.properties[key];
  return typeof value === 'string' ? value : fallback;
}

function stateNumber(ctx: DeviceContext, key: string, fallback: number): number {
  const value = ctx.state[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stateBool(ctx: DeviceContext, key: string, fallback: boolean): boolean {
  const value = ctx.state[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Read a pin as a boolean.
 *
 * A floating TTL input really does behave as a logic high, so that is what we model,
 * but the engine raises a "floating input" warning separately: relying on it is a
 * bug in the student's circuit even though the chip appears to work.
 */
function bit(ctx: DeviceContext, pin: number): boolean | undefined {
  const value = ctx.value(pin);
  if (value === 'H' || value === 'Z') return true;
  if (value === 'L') return false;
  return undefined;
}

/** Same, but an active-low pin: returns true when the function is *asserted*. */
function asserted(ctx: DeviceContext, pin: number): boolean | undefined {
  const value = bit(ctx, pin);
  return value === undefined ? undefined : !value;
}

function driveBit(ctx: DeviceContext, pin: number, value: boolean | undefined): void {
  if (value === undefined) {
    ctx.drive(pin, 'X', { strength: 'strong' });
    return;
  }
  ctx.drive(pin, value ? 'H' : 'L', { strength: 'strong', voltage: value ? ctx.supplyVoltage : 0 });
}

/** Put every output into high impedance, which is what an unpowered part does. */
function floatPins(ctx: DeviceContext, pins: number[]): void {
  for (const pin of pins) ctx.drive(pin, 'Z', { strength: 'none' });
}

function risingEdge(ctx: DeviceContext, key: string, level: boolean | undefined): boolean {
  const previous = ctx.state[key];
  ctx.state[key] = level;
  return previous === false && level === true;
}

function fallingEdge(ctx: DeviceContext, key: string, level: boolean | undefined): boolean {
  const previous = ctx.state[key];
  ctx.state[key] = level;
  return previous === true && level === false;
}

/* ------------------------------------------------------------------ *
 * Power and bench modules
 * ------------------------------------------------------------------ */

registerModel({
  id: 'supply',
  evaluate(ctx) {
    const enabled = propBool(ctx, 'enabled', true);
    const voltage = propNumber(ctx, 'voltage', 5);
    if (!enabled) {
      floatPins(ctx, [1, 2]);
      ctx.display.enabled = false;
      return;
    }
    ctx.display.enabled = true;
    ctx.display.voltage = voltage;
    ctx.drive(1, voltage > 0 ? 'H' : 'L', { strength: 'supply', voltage });
    ctx.drive(2, 'L', { strength: 'supply', voltage: 0, reference: true });
  },
});

registerModel({
  id: 'vccTerminal',
  evaluate(ctx) {
    const voltage = propNumber(ctx, 'voltage', 5);
    ctx.drive(1, 'H', { strength: 'supply', voltage });
    ctx.display.voltage = voltage;
  },
});

registerModel({
  id: 'gndTerminal',
  evaluate(ctx) {
    ctx.drive(1, 'L', { strength: 'supply', voltage: 0, reference: true });
  },
});

registerModel({
  id: 'logicSource',
  evaluate(ctx) {
    const level = propText(ctx, 'level', 'L');
    const voltage = propNumber(ctx, 'voltage', 5);
    ctx.drive(1, level === 'H' ? 'H' : 'L', {
      strength: 'strong',
      voltage: level === 'H' ? voltage : 0,
    });
    ctx.display.level = level;
  },
});

registerModel({
  id: 'clock',
  evaluate(ctx) {
    const running = propBool(ctx, 'enabled', true);
    if (!ctx.powered || !running) {
      floatPins(ctx, [3]);
      ctx.state.phase = false;
      ctx.state.nextEdge = undefined;
      ctx.display.phase = false;
      ctx.display.running = false;
      return;
    }
    const frequency = Math.max(0.01, propNumber(ctx, 'frequency', 1));
    const duty = Math.min(95, Math.max(5, propNumber(ctx, 'duty', 50)));
    const periodNs = 1e9 / frequency;
    const highNs = (periodNs * duty) / 100;
    const lowNs = periodNs - highNs;

    let phase = stateBool(ctx, 'phase', false);
    let nextEdge = ctx.state.nextEdge as number | undefined;
    if (nextEdge === undefined || nextEdge <= ctx.now) {
      phase = !phase;
      nextEdge = ctx.now + (phase ? highNs : lowNs);
      ctx.state.phase = phase;
      ctx.state.nextEdge = nextEdge;
    }
    ctx.display.phase = phase;
    ctx.display.running = true;
    ctx.drive(3, phase ? 'H' : 'L', {
      strength: 'strong',
      voltage: phase ? ctx.supplyVoltage : 0,
    });
    ctx.scheduleAt(nextEdge);
  },
});

/* ------------------------------------------------------------------ *
 * Switches - these change the topology, not the signal
 * ------------------------------------------------------------------ */

registerModel({
  id: 'toggleSwitch',
  links(ctx) {
    const position = propText(ctx, 'position', 'B');
    return position === 'A'
      ? [{ a: 2, b: 1, kind: 'conductor' }]
      : [{ a: 2, b: 3, kind: 'conductor' }];
  },
  evaluate(ctx) {
    ctx.display.position = propText(ctx, 'position', 'B');
  },
});

registerModel({
  id: 'pushButton',
  links(ctx) {
    // Pins 1-2 and 3-4 are bonded by the package itself; pressing bridges the sides.
    return propBool(ctx, 'pressed', false) ? [{ a: 1, b: 4, kind: 'conductor' }] : [];
  },
  evaluate(ctx) {
    ctx.display.pressed = propBool(ctx, 'pressed', false);
  },
});

registerModel({
  id: 'resistor',
  links() {
    return [{ a: 1, b: 2, kind: 'resistor' }];
  },
  evaluate(ctx) {
    ctx.display.resistance = propNumber(ctx, 'resistance', 330);
  },
});

/* ------------------------------------------------------------------ *
 * Indicators
 * ------------------------------------------------------------------ */

registerModel({
  id: 'led',
  evaluate(ctx) {
    const forward = propNumber(ctx, 'forwardVoltage', 2);
    const anode = ctx.voltage(1);
    const cathode = ctx.voltage(2);
    let lit = false;
    if (anode !== undefined && cathode !== undefined) {
      const across = anode - cathode;
      lit = across >= forward;
      if (!lit && cathode - anode >= forward) {
        ctx.warn(
          'led.reversed',
          `${ctx.reference} has a voltage across it the wrong way round. The anode (pin 1, the long lead) has to be the positive side.`,
        );
      }
      // Straight across the rails with nothing to limit the current: a rail is
      // holding the anode up rather than a current-limited logic output.
      const supplyDriven = ctx.strength(1) === 'supply' && ctx.strength(2) === 'supply';
      if (lit && supplyDriven && across >= forward + 1.5) {
        ctx.warn(
          'led.overcurrent',
          `${ctx.reference} is connected across ${across.toFixed(1)} V with no series resistor. A real LED would draw far too much current. Add a resistor of a few hundred ohms.`,
        );
        ctx.display.overCurrent = true;
      } else {
        ctx.display.overCurrent = false;
      }
    }
    ctx.display.lit = lit;
    ctx.display.color = propText(ctx, 'color', 'red');
  },
});

registerModel({
  id: 'lamp',
  evaluate(ctx) {
    const threshold = propNumber(ctx, 'threshold', 2.5);
    const a = ctx.voltage(1);
    const b = ctx.voltage(2);
    const lit = a !== undefined && b !== undefined && Math.abs(a - b) >= threshold;
    ctx.display.lit = lit;
  },
});

registerModel({
  id: 'logicProbe',
  evaluate(ctx) {
    ctx.display.reading = ctx.value(1);
    ctx.display.voltage = ctx.voltage(1);
  },
});

const SEGMENT_PINS: { pin: number; segment: string }[] = [
  { pin: 7, segment: 'a' },
  { pin: 6, segment: 'b' },
  { pin: 4, segment: 'c' },
  { pin: 2, segment: 'd' },
  { pin: 1, segment: 'e' },
  { pin: 9, segment: 'f' },
  { pin: 10, segment: 'g' },
  { pin: 5, segment: 'dp' },
];

registerModel({
  id: 'sevenSegment',
  evaluate(ctx) {
    const common = propText(ctx, 'common', 'cathode');
    const commonValue = ctx.value(3);
    const segments: Record<string, boolean> = {};
    // A common-cathode digit needs its common pin at ground; a common-anode digit
    // needs it at the positive rail. Get it wrong and nothing lights, exactly as on
    // a real bench.
    const commonReady =
      common === 'cathode' ? commonValue === 'L' : commonValue === 'H';
    for (const { pin, segment } of SEGMENT_PINS) {
      const value = ctx.value(pin);
      segments[segment] =
        commonReady && (common === 'cathode' ? value === 'H' : value === 'L');
    }
    ctx.display.segments = segments;
    ctx.display.common = common;
    ctx.display.commonReady = commonReady;
    ctx.display.color = propText(ctx, 'color', 'red');
    if (!commonReady && commonValue === 'Z') {
      ctx.warn(
        'display.commonFloating',
        `${ctx.reference}: the common pin (3 or 8) is not connected. A common-${common} display needs it tied to ${common === 'cathode' ? 'ground' : '+5 V'}.`,
      );
    }
  },
});

/* ------------------------------------------------------------------ *
 * 74xx parts with internal state or non-trivial decoding
 * ------------------------------------------------------------------ */

/** 7447: BCD to seven-segment, active-low open-collector outputs. */
const SEVEN_SEG_PATTERNS: string[] = [
  'abcdef', // 0
  'bc', // 1
  'abdeg', // 2
  'abcdg', // 3
  'bcfg', // 4
  'acdfg', // 5
  'cdefg', // 6
  'abc', // 7
  'abcdefg', // 8
  'abcfg', // 9
  'deg', // 10
  'cdg', // 11
  'bfg', // 12
  'adfg', // 13
  'defg', // 14
  '', // 15
];

const SEG_OUTPUT_PINS: Record<string, number> = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };

registerModel({
  id: 'ic7447',
  evaluate(ctx) {
    const outputs = Object.values(SEG_OUTPUT_PINS);
    if (!ctx.powered) {
      floatPins(ctx, [...outputs, 4]);
      return;
    }
    const lampTest = asserted(ctx, 3);
    const blanking = asserted(ctx, 4);
    const rippleBlank = asserted(ctx, 5);
    const a = bit(ctx, 7);
    const b = bit(ctx, 1);
    const c = bit(ctx, 2);
    const d = bit(ctx, 6);

    let pattern: string;
    if (blanking === true) pattern = '';
    else if (lampTest === true) pattern = 'abcdefg';
    else if (a === undefined || b === undefined || c === undefined || d === undefined) {
      for (const pin of outputs) ctx.drive(pin, 'X', { strength: 'strong' });
      return;
    } else {
      const value = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      pattern = rippleBlank === true && value === 0 ? '' : SEVEN_SEG_PATTERNS[value];
    }

    for (const [segment, pin] of Object.entries(SEG_OUTPUT_PINS)) {
      const on = pattern.includes(segment);
      // Active low and open collector: it can pull down but never drive high.
      if (on) ctx.drive(pin, 'L', { strength: 'strong', voltage: 0 });
      else ctx.drive(pin, 'Z', { strength: 'none' });
    }
    ctx.display.pattern = pattern;
  },
});

/** 7474: dual positive-edge-triggered D flip-flop with async preset and clear. */
registerModel({
  id: 'ic7474',
  evaluate(ctx) {
    const sections = [
      { clr: 1, d: 2, clk: 3, pre: 4, q: 5, qbar: 6, key: 'ff1' },
      { clr: 13, d: 12, clk: 11, pre: 10, q: 9, qbar: 8, key: 'ff2' },
    ];
    if (!ctx.powered) {
      floatPins(ctx, sections.flatMap((s) => [s.q, s.qbar]));
      return;
    }
    for (const section of sections) {
      const preset = asserted(ctx, section.pre);
      const clear = asserted(ctx, section.clr);
      let q = stateBool(ctx, section.key, false);
      let forbidden = false;

      if (preset === true && clear === true) {
        // Datasheet calls this unstable: both outputs go high.
        forbidden = true;
        ctx.warn(
          'ff.forbidden',
          `${ctx.reference}: PRE and CLR are both asserted, so Q and Q-bar are both high. Tie the unused one to +5 V.`,
        );
      } else if (preset === true) q = true;
      else if (clear === true) q = false;
      else {
        const clk = bit(ctx, section.clk);
        if (risingEdge(ctx, `${section.key}.clk`, clk)) {
          const d = bit(ctx, section.d);
          if (d === undefined) {
            ctx.drive(section.q, 'X', { strength: 'strong' });
            ctx.drive(section.qbar, 'X', { strength: 'strong' });
            continue;
          }
          q = d;
        }
      }
      // Keep the edge detector in step even when preset or clear won this pass.
      if (preset === true || clear === true) ctx.state[`${section.key}.clk`] = bit(ctx, section.clk);
      ctx.state[section.key] = q;
      driveBit(ctx, section.q, forbidden ? true : q);
      driveBit(ctx, section.qbar, forbidden ? true : !q);
    }
  },
});

/** 7476: dual JK master-slave. Data is taken while the clock is high and appears on the falling edge. */
registerModel({
  id: 'ic7476',
  evaluate(ctx) {
    const sections = [
      { clk: 1, pre: 2, clr: 3, j: 4, k: 14, q: 16, qbar: 15, key: 'jk1' },
      { clk: 6, pre: 7, clr: 8, j: 9, k: 10, q: 11, qbar: 12, key: 'jk2' },
    ];
    if (!ctx.powered) {
      floatPins(ctx, sections.flatMap((s) => [s.q, s.qbar]));
      return;
    }
    for (const section of sections) {
      const preset = asserted(ctx, section.pre);
      const clear = asserted(ctx, section.clr);
      let q = stateBool(ctx, section.key, false);
      let forbidden = false;

      if (preset === true && clear === true) {
        forbidden = true;
        ctx.warn(
          'ff.forbidden',
          `${ctx.reference}: PRE and CLR are both asserted on one flip-flop. Tie the unused one to +5 V.`,
        );
      } else if (preset === true) q = true;
      else if (clear === true) q = false;
      else {
        const clk = bit(ctx, section.clk);
        const falling = fallingEdge(ctx, `${section.key}.clk`, clk);
        if (falling) {
          const j = bit(ctx, section.j);
          const k = bit(ctx, section.k);
          if (j === undefined || k === undefined) {
            ctx.drive(section.q, 'X', { strength: 'strong' });
            ctx.drive(section.qbar, 'X', { strength: 'strong' });
            continue;
          }
          if (j && k) q = !q;
          else if (j) q = true;
          else if (k) q = false;
        }
      }
      if (preset === true || clear === true) ctx.state[`${section.key}.clk`] = bit(ctx, section.clk);
      ctx.state[section.key] = q;
      driveBit(ctx, section.q, forbidden ? true : q);
      driveBit(ctx, section.qbar, forbidden ? true : !q);
    }
  },
});

/** 7483: 4-bit binary full adder. */
registerModel({
  id: 'ic7483',
  evaluate(ctx) {
    const sumPins = [9, 6, 2, 15];
    if (!ctx.powered) {
      floatPins(ctx, [...sumPins, 14]);
      return;
    }
    const aPins = [10, 8, 3, 1];
    const bPins = [11, 7, 4, 16];
    let carry = bit(ctx, 13);
    const bits: (boolean | undefined)[] = [];
    let unknown = carry === undefined;
    for (let i = 0; i < 4; i++) {
      const a = bit(ctx, aPins[i]);
      const b = bit(ctx, bPins[i]);
      if (a === undefined || b === undefined || carry === undefined) {
        unknown = true;
        bits.push(undefined);
        carry = undefined;
        continue;
      }
      const sum = Number(a) + Number(b) + Number(carry);
      bits.push((sum & 1) === 1);
      carry = sum > 1;
    }
    if (unknown) {
      for (const pin of [...sumPins, 14]) ctx.drive(pin, 'X', { strength: 'strong' });
      return;
    }
    sumPins.forEach((pin, index) => driveBit(ctx, pin, bits[index]));
    driveBit(ctx, 14, carry);
  },
});

/** 7490: divide-by-two plus divide-by-five, falling-edge clocked. */
registerModel({
  id: 'ic7490',
  evaluate(ctx) {
    const outputs = [12, 9, 8, 11];
    if (!ctx.powered) {
      floatPins(ctx, outputs);
      return;
    }
    const reset0 = bit(ctx, 2) === true && bit(ctx, 3) === true;
    const reset9 = bit(ctx, 6) === true && bit(ctx, 7) === true;
    let qa = stateBool(ctx, 'qa', false);
    let count = stateNumber(ctx, 'count5', 0);

    if (reset9) {
      qa = true;
      count = 4; // QD QC QB = 100 -> the 9 in BCD together with QA
    } else if (reset0) {
      qa = false;
      count = 0;
    } else {
      if (fallingEdge(ctx, 'cka', bit(ctx, 14))) qa = !qa;
      if (fallingEdge(ctx, 'ckb', bit(ctx, 1))) count = (count + 1) % 5;
    }
    ctx.state.qa = qa;
    ctx.state.count5 = count;

    driveBit(ctx, 12, qa);
    driveBit(ctx, 9, (count & 1) === 1);
    driveBit(ctx, 8, (count & 2) === 2);
    driveBit(ctx, 11, (count & 4) === 4);
  },
});

/** 74138: 3-to-8 decoder with three enables, active-low outputs. */
registerModel({
  id: 'ic74138',
  evaluate(ctx) {
    const outputPins = [15, 14, 13, 12, 11, 10, 9, 7];
    if (!ctx.powered) {
      floatPins(ctx, outputPins);
      return;
    }
    const e1 = asserted(ctx, 4);
    const e2 = asserted(ctx, 5);
    const e3 = bit(ctx, 6);
    const a0 = bit(ctx, 1);
    const a1 = bit(ctx, 2);
    const a2 = bit(ctx, 3);
    const enabled = e1 === true && e2 === true && e3 === true;

    if (!enabled) {
      for (const pin of outputPins) driveBit(ctx, pin, true);
      ctx.display.selected = -1;
      return;
    }
    if (a0 === undefined || a1 === undefined || a2 === undefined) {
      for (const pin of outputPins) ctx.drive(pin, 'X', { strength: 'strong' });
      return;
    }
    const index = (a0 ? 1 : 0) | (a1 ? 2 : 0) | (a2 ? 4 : 0);
    outputPins.forEach((pin, i) => driveBit(ctx, pin, i !== index));
    ctx.display.selected = index;
  },
});

/** 74151: 8-to-1 multiplexer with a complementary output. */
registerModel({
  id: 'ic74151',
  evaluate(ctx) {
    if (!ctx.powered) {
      floatPins(ctx, [5, 6]);
      return;
    }
    const dataPins = [4, 3, 2, 1, 15, 14, 13, 12];
    const strobe = asserted(ctx, 7);
    if (strobe !== true) {
      driveBit(ctx, 5, false);
      driveBit(ctx, 6, true);
      ctx.display.selected = -1;
      return;
    }
    const s0 = bit(ctx, 11);
    const s1 = bit(ctx, 10);
    const s2 = bit(ctx, 9);
    if (s0 === undefined || s1 === undefined || s2 === undefined) {
      ctx.drive(5, 'X', { strength: 'strong' });
      ctx.drive(6, 'X', { strength: 'strong' });
      return;
    }
    const index = (s0 ? 1 : 0) | (s1 ? 2 : 0) | (s2 ? 4 : 0);
    const value = bit(ctx, dataPins[index]);
    driveBit(ctx, 5, value);
    driveBit(ctx, 6, value === undefined ? undefined : !value);
    ctx.display.selected = index;
  },
});

/** 74163: fully synchronous 4-bit binary counter. */
registerModel({
  id: 'ic74163',
  evaluate(ctx) {
    const outputs = [14, 13, 12, 11];
    if (!ctx.powered) {
      floatPins(ctx, [...outputs, 15]);
      return;
    }
    let count = stateNumber(ctx, 'count', 0);
    const clk = bit(ctx, 2);
    if (risingEdge(ctx, 'clk', clk)) {
      const clear = asserted(ctx, 1);
      const load = asserted(ctx, 9);
      const enp = bit(ctx, 7);
      const ent = bit(ctx, 10);
      if (clear === true) count = 0;
      else if (load === true) {
        const a = bit(ctx, 3);
        const b = bit(ctx, 4);
        const c = bit(ctx, 5);
        const d = bit(ctx, 6);
        count = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      } else if (enp === true && ent === true) count = (count + 1) & 0xf;
    }
    ctx.state.count = count;
    outputs.forEach((pin, index) => driveBit(ctx, pin, ((count >> index) & 1) === 1));
    driveBit(ctx, 15, count === 15 && bit(ctx, 10) === true);
    ctx.display.count = count;
  },
});

/** 74195: 4-bit shift register with parallel load and a JK serial input. */
registerModel({
  id: 'ic74195',
  evaluate(ctx) {
    const outputs = [15, 14, 13, 12];
    if (!ctx.powered) {
      floatPins(ctx, [...outputs, 11]);
      return;
    }
    let bits = [
      stateBool(ctx, 'qa', false),
      stateBool(ctx, 'qb', false),
      stateBool(ctx, 'qc', false),
      stateBool(ctx, 'qd', false),
    ];
    if (asserted(ctx, 1) === true) {
      bits = [false, false, false, false];
      ctx.state.clk = bit(ctx, 10);
    } else if (risingEdge(ctx, 'clk', bit(ctx, 10))) {
      const shift = bit(ctx, 9);
      if (shift === false) {
        bits = [bit(ctx, 4) === true, bit(ctx, 5) === true, bit(ctx, 6) === true, bit(ctx, 7) === true];
      } else {
        const j = bit(ctx, 2) === true;
        const kbar = bit(ctx, 3) === true;
        const first = (j && !bits[0]) || (kbar && bits[0]);
        bits = [first, bits[0], bits[1], bits[2]];
      }
    }
    ctx.state.qa = bits[0];
    ctx.state.qb = bits[1];
    ctx.state.qc = bits[2];
    ctx.state.qd = bits[3];
    outputs.forEach((pin, index) => driveBit(ctx, pin, bits[index]));
    driveBit(ctx, 11, !bits[3]);
    ctx.display.bits = bits.map((b) => (b ? 1 : 0)).join('');
  },
});
