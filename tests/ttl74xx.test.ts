import { describe, expect, it } from 'vitest';

import { componentRegistry } from '../src/components/ComponentRegistry';
import { TTL_74XX_DEFINITIONS } from '../src/components/ttl74xx';
import { icHarness, readWord } from './helpers/ic';

describe('74xx pin tables', () => {
  it('declares VCC and GND on every part and never reuses a pin number', () => {
    for (const def of TTL_74XX_DEFINITIONS) {
      expect(def.power, def.partNumber).toBeDefined();
      const numbers = def.pins.map((p) => p.number);
      expect(new Set(numbers).size, def.partNumber).toBe(def.footprint.pinCount);
      expect(Math.max(...numbers), def.partNumber).toBe(def.footprint.pinCount);
    }
  });

  it('puts the 7400 power pins where the datasheet puts them', () => {
    const def = componentRegistry.require('ic-7400');
    expect(def.power!.vccPins).toEqual([14]);
    expect(def.power!.gndPins).toEqual([7]);
    expect(def.pins.find((p) => p.number === 3)!.name).toBe('1Y');
  });

  it('keeps the odd power pins of the 7483, 7476 and 7490', () => {
    expect(componentRegistry.require('ic-7483').power!.vccPins).toEqual([5]);
    expect(componentRegistry.require('ic-7483').power!.gndPins).toEqual([12]);
    expect(componentRegistry.require('ic-7476').power!.vccPins).toEqual([5]);
    expect(componentRegistry.require('ic-7476').power!.gndPins).toEqual([13]);
    expect(componentRegistry.require('ic-7490').power!.vccPins).toEqual([5]);
    expect(componentRegistry.require('ic-7490').power!.gndPins).toEqual([10]);
  });

  it('lays every DIP out horizontally with pin 1 at the lower left', () => {
    const def = componentRegistry.require('ic-7400');
    const pin1 = def.pins[0];
    const pin14 = def.pins[13];
    const pin7 = def.pins[6];
    expect(pin1.offset).toEqual({ x: 0, y: 0 });
    expect(pin14.offset).toEqual({ x: 0, y: -3 }); // directly opposite pin 1
    expect(pin7.offset).toEqual({ x: 6, y: 0 }); // six columns along the bottom row
  });
});

describe('combinational gate packages', () => {
  const cases: { part: string; inputs: number[]; output: number; fn: (v: boolean[]) => boolean }[] = [
    { part: 'ic-7400', inputs: [1, 2], output: 3, fn: (v) => !(v[0] && v[1]) },
    { part: 'ic-7402', inputs: [2, 3], output: 1, fn: (v) => !(v[0] || v[1]) },
    { part: 'ic-7404', inputs: [1], output: 2, fn: (v) => !v[0] },
    { part: 'ic-7408', inputs: [1, 2], output: 3, fn: (v) => v[0] && v[1] },
    { part: 'ic-7432', inputs: [1, 2], output: 3, fn: (v) => v[0] || v[1] },
    { part: 'ic-7486', inputs: [1, 2], output: 3, fn: (v) => v[0] !== v[1] },
    { part: 'ic-7410', inputs: [1, 2, 13], output: 12, fn: (v) => !(v[0] && v[1] && v[2]) },
    { part: 'ic-7427', inputs: [1, 2, 13], output: 12, fn: (v) => !(v[0] || v[1] || v[2]) },
    { part: 'ic-7420', inputs: [1, 2, 4, 5], output: 6, fn: (v) => !v.every(Boolean) },
  ];

  for (const testCase of cases) {
    it(`${testCase.part} matches its truth table on every input combination`, () => {
      const harness = icHarness(testCase.part, testCase.inputs);
      const combinations = 1 << testCase.inputs.length;
      for (let mask = 0; mask < combinations; mask++) {
        const values = testCase.inputs.map((_, index) => ((mask >> index) & 1) === 1);
        harness.setAll(Object.fromEntries(testCase.inputs.map((pin, i) => [pin, values[i]])));
        const expected = testCase.fn(values) ? 'H' : 'L';
        expect(harness.read(testCase.output), `${testCase.part} inputs ${values.join(',')}`).toBe(expected);
      }
    });
  }

  it('drives all four gates of a 7400 independently', () => {
    const harness = icHarness('ic-7400', [1, 2, 4, 5, 9, 10, 12, 13]);
    harness.setAll({ 1: true, 2: true, 4: true, 5: false, 9: false, 10: false, 12: true, 13: true });
    expect(harness.read(3)).toBe('L');
    expect(harness.read(6)).toBe('H');
    expect(harness.read(8)).toBe('H');
    expect(harness.read(11)).toBe('L');
  });
});

describe('7474 dual D flip-flop', () => {
  it('captures D on the rising clock edge', () => {
    const h = icHarness('ic-7474', [1, 2, 3, 4]);
    h.setAll({ 1: true, 4: true, 3: false, 2: true }); // CLR and PRE released, D high
    expect(h.read(5)).toBe('L');
    h.set(3, true);
    expect(h.read(5)).toBe('H');
    expect(h.read(6)).toBe('L');

    h.set(2, false); // D low, but no edge yet
    expect(h.read(5)).toBe('H');
    h.set(3, false);
    h.set(3, true);
    expect(h.read(5)).toBe('L');
  });

  it('clears and presets asynchronously, without a clock', () => {
    const h = icHarness('ic-7474', [1, 2, 3, 4]);
    h.setAll({ 1: true, 4: true, 2: true, 3: false });
    h.pulse(3);
    expect(h.read(5)).toBe('H');
    h.set(1, false); // CLR asserted
    expect(h.read(5)).toBe('L');
    h.set(1, true);
    h.set(4, false); // PRE asserted
    expect(h.read(5)).toBe('H');
  });

  it('drives both outputs high when preset and clear are asserted together', () => {
    const h = icHarness('ic-7474', [1, 2, 3, 4]);
    h.setAll({ 1: false, 4: false, 2: false, 3: false });
    expect(h.read(5)).toBe('H');
    expect(h.read(6)).toBe('H');
    expect(h.engine.refreshDiagnostics().some((d) => d.code === 'ff.forbidden')).toBe(true);
  });
});

describe('7476 dual JK flip-flop', () => {
  it('toggles when J and K are both high, on the falling edge', () => {
    const h = icHarness('ic-7476', [1, 2, 3, 4, 14]);
    h.setAll({ 2: true, 3: true, 4: true, 14: true, 1: false });
    h.set(1, true);
    h.set(1, false); // falling edge
    expect(h.read(16)).toBe('H');
    h.set(1, true);
    h.set(1, false);
    expect(h.read(16)).toBe('L');
  });

  it('sets and clears from the J and K inputs', () => {
    const h = icHarness('ic-7476', [1, 2, 3, 4, 14]);
    h.setAll({ 2: true, 3: true, 4: true, 14: false, 1: false });
    h.set(1, true);
    h.set(1, false);
    expect(h.read(16)).toBe('H');
    h.setAll({ 4: false, 14: true });
    h.set(1, true);
    h.set(1, false);
    expect(h.read(16)).toBe('L');
  });
});

describe('7483 four-bit adder', () => {
  const A = [10, 8, 3, 1];
  const B = [11, 7, 4, 16];
  const S = [9, 6, 2, 15];

  it('adds every pair of nibbles with carry in', () => {
    const h = icHarness('ic-7483', [...A, ...B, 13]);
    for (const [a, b, carryIn] of [
      [0, 0, false],
      [1, 1, false],
      [7, 8, false],
      [9, 6, true],
      [15, 15, true],
      [5, 10, false],
    ] as [number, number, boolean][]) {
      const values: Record<number, boolean> = { 13: carryIn };
      A.forEach((pin, i) => (values[pin] = ((a >> i) & 1) === 1));
      B.forEach((pin, i) => (values[pin] = ((b >> i) & 1) === 1));
      h.setAll(values);
      const total = a + b + (carryIn ? 1 : 0);
      expect(readWord(h, S), `${a}+${b}+${carryIn ? 1 : 0}`).toBe(total & 0xf);
      expect(h.bit(14), `carry out of ${a}+${b}`).toBe(total > 15 ? 1 : 0);
    }
  });
});

describe('74138 decoder', () => {
  it('pulls exactly the addressed output low', () => {
    const h = icHarness('ic-74138', [1, 2, 3, 4, 5, 6]);
    const outputs = [15, 14, 13, 12, 11, 10, 9, 7];
    for (let address = 0; address < 8; address++) {
      h.setAll({
        4: false,
        5: false,
        6: true,
        1: (address & 1) === 1,
        2: (address & 2) === 2,
        3: (address & 4) === 4,
      });
      outputs.forEach((pin, index) => {
        expect(h.read(pin), `address ${address} output Y${index}`).toBe(index === address ? 'L' : 'H');
      });
    }
  });

  it('holds every output high while disabled', () => {
    const h = icHarness('ic-74138', [1, 2, 3, 4, 5, 6]);
    h.setAll({ 4: true, 5: false, 6: true, 1: false, 2: false, 3: false });
    expect(h.read(15)).toBe('H');
  });
});

describe('74151 multiplexer', () => {
  it('routes the selected input to Y and its complement to W', () => {
    const dataPins = [4, 3, 2, 1, 15, 14, 13, 12];
    const h = icHarness('ic-74151', [...dataPins, 9, 10, 11, 7]);
    for (let select = 0; select < 8; select++) {
      const values: Record<number, boolean> = {
        7: false,
        11: (select & 1) === 1,
        10: (select & 2) === 2,
        9: (select & 4) === 4,
      };
      dataPins.forEach((pin, index) => (values[pin] = index === select));
      h.setAll(values);
      expect(h.read(5), `select ${select}`).toBe('H');
      expect(h.read(6), `select ${select} complement`).toBe('L');
    }
  });

  it('forces the output low while the strobe is high', () => {
    const dataPins = [4, 3, 2, 1, 15, 14, 13, 12];
    const h = icHarness('ic-74151', [...dataPins, 9, 10, 11, 7]);
    const values: Record<number, boolean> = { 7: true, 9: false, 10: false, 11: false };
    dataPins.forEach((pin) => (values[pin] = true));
    h.setAll(values);
    expect(h.read(5)).toBe('L');
    expect(h.read(6)).toBe('H');
  });
});

describe('74163 synchronous counter', () => {
  const Q = [14, 13, 12, 11];

  it('counts up on rising edges while both enables are high', () => {
    const h = icHarness('ic-74163', [1, 2, 3, 4, 5, 6, 7, 9, 10]);
    h.setAll({ 1: true, 9: true, 7: true, 10: true, 2: false, 3: false, 4: false, 5: false, 6: false });
    h.set(1, false); // synchronous clear needs an edge
    h.pulse(2);
    h.set(1, true);
    expect(readWord(h, Q)).toBe(0);
    for (let expected = 1; expected <= 16; expected++) {
      h.pulse(2);
      expect(readWord(h, Q)).toBe(expected & 0xf);
    }
  });

  it('holds its count when the enables go low', () => {
    const h = icHarness('ic-74163', [1, 2, 3, 4, 5, 6, 7, 9, 10]);
    h.setAll({ 1: true, 9: true, 7: true, 10: true, 2: false, 3: false, 4: false, 5: false, 6: false });
    h.pulse(2);
    h.pulse(2);
    const before = readWord(h, Q);
    h.set(7, false);
    h.pulse(2);
    expect(readWord(h, Q)).toBe(before);
  });

  it('loads the parallel inputs synchronously and raises RCO at fifteen', () => {
    const h = icHarness('ic-74163', [1, 2, 3, 4, 5, 6, 7, 9, 10]);
    h.setAll({ 1: true, 9: false, 7: true, 10: true, 2: false, 3: true, 4: true, 5: true, 6: true });
    h.pulse(2);
    expect(readWord(h, Q)).toBe(15);
    expect(h.read(15)).toBe('H');
    h.set(9, true);
    h.pulse(2);
    expect(readWord(h, Q)).toBe(0);
    expect(h.read(15)).toBe('L');
  });
});

describe('74195 shift register', () => {
  const Q = [15, 14, 13, 12];

  it('loads in parallel and then shifts one place per clock', () => {
    const h = icHarness('ic-74195', [1, 2, 3, 4, 5, 6, 7, 9, 10]);
    h.setAll({ 1: true, 9: false, 10: false, 2: false, 3: true, 4: true, 5: false, 6: false, 7: false });
    h.pulse(10);
    expect(readWord(h, Q)).toBe(0b0001);
    // Shift mode. J low with K-bar low is the JK "reset" case, so zeros march in
    // behind the one; J low with K-bar high would hold QA instead.
    h.setAll({ 9: true, 2: false, 3: false });
    h.pulse(10);
    expect(readWord(h, Q)).toBe(0b0010);
    h.pulse(10);
    expect(readWord(h, Q)).toBe(0b0100);
  });

  it('clears asynchronously', () => {
    const h = icHarness('ic-74195', [1, 2, 3, 4, 5, 6, 7, 9, 10]);
    h.setAll({ 1: true, 9: false, 10: false, 2: false, 3: true, 4: true, 5: true, 6: true, 7: true });
    h.pulse(10);
    expect(readWord(h, Q)).toBe(0b1111);
    h.set(1, false);
    expect(readWord(h, Q)).toBe(0);
  });
});

describe('7490 decade counter', () => {
  it('divides by two on the A section', () => {
    const h = icHarness('ic-7490', [1, 2, 3, 6, 7, 14]);
    h.setAll({ 2: false, 3: false, 6: false, 7: false, 14: true, 1: false });
    h.set(14, false); // falling edge
    expect(h.read(12)).toBe('H');
    h.set(14, true);
    h.set(14, false);
    expect(h.read(12)).toBe('L');
  });

  it('clears when both reset inputs go high', () => {
    const h = icHarness('ic-7490', [1, 2, 3, 6, 7, 14]);
    h.setAll({ 2: false, 3: false, 6: false, 7: false, 14: true, 1: false });
    h.set(14, false);
    expect(h.read(12)).toBe('H');
    h.setAll({ 2: true, 3: true });
    expect(h.read(12)).toBe('L');
  });
});

describe('7447 seven-segment decoder', () => {
  const segments = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };

  it('drives the segment outputs low for the lit segments of each digit', () => {
    const h = icHarness('ic-7447', [7, 1, 2, 6, 3, 4, 5]);
    const expected: Record<number, string> = {
      0: 'abcdef',
      1: 'bc',
      2: 'abdeg',
      3: 'abcdg',
      4: 'bcfg',
      7: 'abc',
      8: 'abcdefg',
    };
    for (const [digit, lit] of Object.entries(expected)) {
      const value = Number(digit);
      h.setAll({
        3: true,
        4: true,
        5: true,
        7: (value & 1) === 1,
        1: (value & 2) === 2,
        2: (value & 4) === 4,
        6: (value & 8) === 8,
      });
      for (const [segment, pin] of Object.entries(segments)) {
        const shouldBeLit = lit.includes(segment);
        expect(h.read(pin), `digit ${digit} segment ${segment}`).toBe(shouldBeLit ? 'L' : 'Z');
      }
    }
  });

  it('lights every segment for a lamp test', () => {
    const h = icHarness('ic-7447', [7, 1, 2, 6, 3, 4, 5]);
    h.setAll({ 3: false, 4: true, 5: true, 7: false, 1: false, 2: false, 6: false });
    for (const pin of Object.values(segments)) expect(h.read(pin)).toBe('L');
  });
});

describe('unpowered parts', () => {
  it('stops driving its outputs when the supply is removed', () => {
    const h = icHarness('ic-7408', [1, 2]);
    h.setAll({ 1: true, 2: true });
    expect(h.read(3)).toBe('H');
    const supplyWire = h.circuit.wires.find((w) => w.color === 'red')!;
    h.circuit.removeWire(supplyWire.id);
    h.engine.rebuild();
    expect(h.read(3)).toBe('Z');
    expect(h.engine.runtime(h.chip.id).electrical).toBe('UNPOWERED');
  });
});
