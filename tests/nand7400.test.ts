import { describe, expect, it } from 'vitest';

import { buildNandLab, connect, holeRef } from './helpers/lab';

describe('7400 NAND experiment', () => {
  it('follows the NAND truth table on the physical board', () => {
    const lab = buildNandLab();
    const table: [boolean, boolean, string][] = [
      [false, false, 'H'],
      [false, true, 'H'],
      [true, false, 'H'],
      [true, true, 'L'],
    ];
    for (const [a, b, expected] of table) {
      lab.setInputs(a, b);
      expect(lab.outputValue(), `A=${a} B=${b}`).toBe(expected);
    }
  });

  it('lights the LED exactly when the output is high', () => {
    const lab = buildNandLab();
    lab.setInputs(false, false);
    expect(lab.ledLit()).toBe(true);
    lab.setInputs(true, true);
    expect(lab.ledLit()).toBe(false);
  });

  it('reports the chip as powered once both supply pins are wired', () => {
    const lab = buildNandLab();
    const runtime = lab.engine.runtime(lab.u1.id);
    expect(runtime.electrical).toBe('POWERED');
    expect(runtime.supplyVoltage).toBeCloseTo(5, 2);
  });

  it('routes power through the rail, not by magic', () => {
    const lab = buildNandLab();
    // Pin 14 and the + rail must be the same net; the - rail must be a different one.
    const vccNet = lab.engine.nets.netIdOfPin(lab.u1.id, 14);
    const railNet = lab.engine.nets.netOfGroup(lab.board.getHole('TP10')!.groupId)?.id;
    const gndNet = lab.engine.nets.netIdOfPin(lab.u1.id, 7);
    expect(vccNet).toBe(railNet);
    expect(gndNet).not.toBe(vccNet);
    expect(lab.engine.netValue(vccNet!)?.voltage).toBeCloseTo(5, 2);
    expect(lab.engine.netValue(gndNet!)?.isReference).toBe(true);
  });

  it('does not connect the two sides of the trench', () => {
    const lab = buildNandLab();
    const pin1Net = lab.engine.nets.netIdOfPin(lab.u1.id, 1); // row f, column 10
    const pin14Net = lab.engine.nets.netIdOfPin(lab.u1.id, 14); // row e, column 10
    expect(pin1Net).not.toBe(pin14Net);
  });

  it('goes unpowered when the VCC wire is removed, and recovers when it is put back', () => {
    const lab = buildNandLab();
    lab.setInputs(true, true);
    expect(lab.outputValue()).toBe('L');

    const vccWire = lab.circuit.wires.find(
      (w) => w.from.kind === 'hole' && w.from.hole === 'TP10',
    )!;
    lab.circuit.removeWire(vccWire.id);
    lab.engine.rebuild();

    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('UNPOWERED');
    expect(lab.outputValue()).toBe('Z');
    expect(lab.ledLit()).toBe(false);

    const messages = lab.engine.refreshDiagnostics().map((d) => d.message);
    expect(messages.join(' ')).toContain('unpowered');
    expect(messages.join(' ')).toContain('pin 14');

    connect(lab.circuit, holeRef(lab.board, 'TP10'), holeRef(lab.board, 'a10'), 'red');
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('POWERED');
    expect(lab.outputValue()).toBe('L');
  });

  it('reports a missing ground reference separately from missing power', () => {
    const lab = buildNandLab();
    const gndWire = lab.circuit.wires.find(
      (w) => w.from.kind === 'hole' && w.from.hole === 'TN16',
    )!;
    lab.circuit.removeWire(gndWire.id);
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('NO_GROUND');
    const messages = lab.engine.refreshDiagnostics().map((d) => d.message).join(' ');
    expect(messages).toContain('no ground reference');
  });

  it('stops working when the supply output is switched off', () => {
    const lab = buildNandLab();
    lab.supply.properties.enabled = false;
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('UNPOWERED');
    lab.supply.properties.enabled = true;
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('POWERED');
  });

  it('warns about the unused gates whose inputs are left floating', () => {
    const lab = buildNandLab();
    const floating = lab.engine
      .refreshDiagnostics()
      .filter((d) => d.code === 'ic.floatingInput');
    // Gate 1 is wired; the other three gates have six unconnected inputs.
    expect(floating.length).toBe(6);
    expect(floating[0].message).toContain('floating');
  });

  it('keeps the chip powered after it is moved to a new legal position', () => {
    const lab = buildNandLab();
    lab.setInputs(true, true);
    expect(lab.outputValue()).toBe('L');

    // Pull the chip out and plug it in one column to the right. The wires that went
    // into the old holes stay where they are - which is physically what happens.
    lab.u1.position = { x: lab.u1.position.x + 1, y: lab.u1.position.y };
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('UNPOWERED');

    lab.u1.position = { x: lab.u1.position.x - 1, y: lab.u1.position.y };
    lab.engine.rebuild();
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('POWERED');
    expect(lab.outputValue()).toBe('L');
  });
});
