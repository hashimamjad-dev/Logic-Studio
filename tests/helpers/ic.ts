/**
 * A bench harness for testing one chip.
 *
 * The chip is really placed on a real board and really powered from a supply; only
 * the stimulus is simplified, with an idealised logic source wired straight onto each
 * input pin. That keeps the pin numbering honest - every test addresses pins by their
 * datasheet number - without making each test lay out a board.
 */

import { componentRegistry } from '../../src/components/ComponentRegistry';
import { Circuit, ComponentInstance } from '../../src/core/Circuit';
import { LogicValue } from '../../src/core/types';
import { SimulationEngine } from '../../src/simulation/SimulationEngine';
import { connect, pinRef, place, plugInto } from './lab';

export interface IcHarness {
  circuit: Circuit;
  engine: SimulationEngine;
  chip: ComponentInstance;
  /** Drive an input pin. */
  set(pin: number, value: boolean): void;
  setAll(values: Record<number, boolean>): void;
  /** Read the resolved value of the net at a pin. */
  read(pin: number): LogicValue;
  /** Read a pin as a bit, treating anything but a solid high as low. */
  bit(pin: number): number;
  /** Take a clock pin low then high, letting the part settle after each edge. */
  pulse(pin: number): void;
  settle(): void;
}

export function icHarness(defId: string, drivenPins: number[]): IcHarness {
  const definition = componentRegistry.require(defId);
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-full', { x: 0, y: 0 });
  const chip = plugInto(circuit, board, defId, 1, 'f5');

  const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
  const power = definition.power;
  if (!power) throw new Error(`${defId} has no power pins`);
  connect(circuit, pinRef(supply, 1), pinRef(chip, power.vccPins[0]), 'red');
  connect(circuit, pinRef(supply, 2), pinRef(chip, power.gndPins[0]), 'black');

  const sources = new Map<number, ComponentInstance>();
  drivenPins.forEach((pin, index) => {
    const source = place(circuit, 'in-logic', { x: -24, y: 12 + index * 4 });
    connect(circuit, pinRef(source, 1), pinRef(chip, pin), 'yellow');
    sources.set(pin, source);
  });

  const engine = new SimulationEngine(circuit);

  const harness: IcHarness = {
    circuit,
    engine,
    chip,
    set(pin, value) {
      const source = sources.get(pin);
      if (!source) throw new Error(`Pin ${pin} is not driven by this harness`);
      source.properties.level = value ? 'H' : 'L';
      engine.rebuild();
      engine.advance(1e6);
    },
    setAll(values) {
      for (const [pin, value] of Object.entries(values)) {
        const source = sources.get(Number(pin));
        if (!source) throw new Error(`Pin ${pin} is not driven by this harness`);
        source.properties.level = value ? 'H' : 'L';
      }
      engine.rebuild();
      engine.advance(1e6);
    },
    read(pin) {
      return engine.netValueOfPin(chip.id, pin)?.value ?? 'Z';
    },
    bit(pin) {
      return engine.netValueOfPin(chip.id, pin)?.value === 'H' ? 1 : 0;
    },
    pulse(pin) {
      harness.set(pin, false);
      harness.set(pin, true);
    },
    settle() {
      engine.advance(1e6);
    },
  };
  return harness;
}

/** Read a group of pins as a binary number, least significant pin first. */
export function readWord(harness: IcHarness, pins: number[]): number {
  return pins.reduce((acc, pin, index) => acc | (harness.bit(pin) << index), 0);
}
