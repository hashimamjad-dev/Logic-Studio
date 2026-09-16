import { describe, expect, it } from 'vitest';

import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { buildNandLab, connect, holeRef, place, pinRef, plugInto } from './helpers/lab';
import { Circuit } from '../src/core/Circuit';

describe('supply faults', () => {
  it('warns about an over-voltage supply and destroys the chip if it is left there', () => {
    const lab = buildNandLab();
    lab.supply.properties.voltage = 12;
    lab.engine.rebuild();

    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('OVERVOLTAGE');
    const warning = lab.engine.refreshDiagnostics().find((d) => d.code === 'ic.overvoltage');
    expect(warning?.message).toContain('absolute maximum');
    expect(lab.engine.runtime(lab.u1.id).damaged).toBe(false);

    // Leaving it there long enough destroys the part.
    for (let i = 0; i < 12; i++) lab.engine.advance(50e6);
    expect(lab.engine.runtime(lab.u1.id).damaged).toBe(true);
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('DAMAGED');

    // A destroyed chip stops driving, and fixing the supply does not revive it.
    expect(lab.outputValue()).toBe('Z');
    lab.supply.properties.voltage = 5;
    lab.engine.rebuild();
    lab.engine.advance(1e6);
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('DAMAGED');
    const message = lab.engine.refreshDiagnostics().find((d) => d.code === 'part.damaged');
    expect(message?.message).toContain('Delete');
  });

  it('gives a part a moment to be rescued before it dies', () => {
    const lab = buildNandLab();
    lab.supply.properties.voltage = 12;
    lab.engine.rebuild();
    lab.engine.advance(100e6); // 100 ms of abuse
    expect(lab.engine.runtime(lab.u1.id).damaged).toBe(false);
    lab.supply.properties.voltage = 5;
    lab.engine.rebuild();
    lab.engine.advance(500e6);
    expect(lab.engine.runtime(lab.u1.id).damaged).toBe(false);
    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('POWERED');
  });

  it('detects a supply wired backwards', () => {
    const lab = buildNandLab();
    // Swap the two rail jumpers so the chip sees the supply the wrong way round.
    const vccWire = lab.circuit.wires.find((w) => w.from.kind === 'hole' && w.from.hole === 'TP10')!;
    const gndWire = lab.circuit.wires.find((w) => w.from.kind === 'hole' && w.from.hole === 'TN16')!;
    vccWire.from = holeRef(lab.board, 'TN10');
    gndWire.from = holeRef(lab.board, 'TP16');
    lab.engine.rebuild();

    expect(lab.engine.runtime(lab.u1.id).electrical).toBe('REVERSE_POLARITY');
    const messages = lab.engine.refreshDiagnostics().map((d) => d.message).join(' ');
    expect(messages).toContain('backwards');
  });

  it('reports a short across the supply rather than picking a winner', () => {
    const lab = buildNandLab();
    connect(lab.circuit, holeRef(lab.board, 'TP25'), holeRef(lab.board, 'TN25'), 'white');
    lab.engine.rebuild();
    const errors = lab.engine.refreshDiagnostics().filter((d) => d.code === 'net.conflict');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Short circuit');
  });

  it('reports two outputs fighting over one net', () => {
    const lab = buildNandLab();
    // Gate 1 has both inputs high, so its output (pin 3) is low. Pulling one of
    // gate 2's inputs (pin 4) down makes its output (pin 6) high. Tie the two
    // outputs together and they fight.
    connect(lab.circuit, holeRef(lab.board, 'g13'), holeRef(lab.board, 'TN13'), 'black');
    connect(lab.circuit, holeRef(lab.board, 'g12'), holeRef(lab.board, 'g15'), 'purple');
    lab.setInputs(true, true);
    const conflict = lab.engine.refreshDiagnostics().find((d) => d.code === 'net.conflict');
    expect(conflict?.message).toContain('opposite levels');
  });
});

describe('LED faults', () => {
  it('warns when an LED is put straight across the rails with no resistor', () => {
    const circuit = new Circuit();
    const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
    const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
    connect(circuit, pinRef(supply, 1), holeRef(board, 'TP1'), 'red');
    connect(circuit, pinRef(supply, 2), holeRef(board, 'TN1'), 'black');

    const led = plugInto(circuit, board, 'out-led', 1, 'a10', { properties: { span: 3 } });
    connect(circuit, holeRef(board, 'b10'), holeRef(board, 'TP10'), 'red');
    connect(circuit, holeRef(board, 'b13'), holeRef(board, 'TN13'), 'black');

    const engine = new SimulationEngine(circuit);
    engine.advance(1e6);
    expect(engine.runtime(led.id).display.lit).toBe(true);
    const warning = engine.refreshDiagnostics().find((d) => d.code === 'led.overcurrent');
    expect(warning?.message).toContain('series resistor');
  });

  it('stays dark when it is fitted the wrong way round, and says so', () => {
    const circuit = new Circuit();
    const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
    const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
    connect(circuit, pinRef(supply, 1), holeRef(board, 'TP1'), 'red');
    connect(circuit, pinRef(supply, 2), holeRef(board, 'TN1'), 'black');

    // Cathode on the positive side: the LED blocks.
    const led = plugInto(circuit, board, 'out-led', 2, 'a10', { properties: { span: 3 } });
    connect(circuit, holeRef(board, 'b10'), holeRef(board, 'TP10'), 'red');
    connect(circuit, holeRef(board, 'b7'), holeRef(board, 'TN7'), 'black');

    const engine = new SimulationEngine(circuit);
    engine.advance(1e6);
    expect(engine.runtime(led.id).display.lit).toBe(false);
    const warning = engine.refreshDiagnostics().find((d) => d.code === 'led.reversed');
    expect(warning?.message).toContain('wrong way round');
  });
});

describe('oscillation', () => {
  it('reports a ring oscillator instead of hanging', () => {
    const circuit = new Circuit();
    const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
    const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
    connect(circuit, pinRef(supply, 1), holeRef(board, 'TP1'), 'red');
    connect(circuit, pinRef(supply, 2), holeRef(board, 'TN1'), 'black');

    const chip = plugInto(circuit, board, 'ic-7404', 1, 'f10');
    connect(circuit, holeRef(board, 'TP10'), holeRef(board, 'a10'), 'red');
    connect(circuit, holeRef(board, 'TN16'), holeRef(board, 'j16'), 'black');
    // Inverter output straight back to its own input.
    connect(circuit, pinRef(chip, 2), pinRef(chip, 1), 'purple');

    const engine = new SimulationEngine(circuit);
    // A 7404 inverting into itself oscillates at roughly 1/(2 x 9 ns) = 55 MHz.
    // Ten milliseconds of that is far more events than we will replay.
    engine.advance(10e6);
    expect(engine.oscillating).toBe(true);
    const message = engine.refreshDiagnostics().find((d) => d.code === 'sim.oscillating');
    expect(message?.message).toContain('oscillating');
  });
});
