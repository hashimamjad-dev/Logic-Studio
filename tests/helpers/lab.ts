/**
 * Test helpers that build real circuits the same way the editor does: every part is
 * run through the placement validator and every wire terminates on a declared
 * connection point. If a helper throws, the circuit it describes is genuinely not
 * buildable on a real board, which is exactly what we want the tests to depend on.
 */

import { Breadboard } from '../../src/breadboard/Breadboard';
import { validatePlacement } from '../../src/breadboard/PlacementValidator';
import { defaultProperties, pinsOf } from '../../src/components/ComponentDefinition';
import { componentRegistry } from '../../src/components/ComponentRegistry';
import { Circuit, ComponentInstance } from '../../src/core/Circuit';
import { ConnectionRef, GridPoint, PropertyValue, Rotation, rotateOffset } from '../../src/core/types';
import { SimulationEngine } from '../../src/simulation/SimulationEngine';

export function holePosition(board: Breadboard, holeId: string): GridPoint {
  const hole = board.getHole(holeId);
  if (!hole) throw new Error(`No hole ${holeId} on ${board.definition.name}`);
  return board.worldPosition(hole);
}

export function holeRef(board: Breadboard, holeId: string): ConnectionRef {
  if (!board.getHole(holeId)) throw new Error(`No hole ${holeId} on ${board.definition.name}`);
  return { kind: 'hole', boardId: board.id, hole: holeId };
}

export function pinRef(component: ComponentInstance, pin: number): ConnectionRef {
  return { kind: 'pin', componentId: component.id, pin };
}

/** Place a part at a grid position, refusing to continue if the placement is illegal. */
export function place(
  circuit: Circuit,
  defId: string,
  position: GridPoint,
  options: { rotation?: Rotation; properties?: Record<string, PropertyValue> } = {},
): ComponentInstance {
  const definition = componentRegistry.require(defId);
  const rotation = options.rotation ?? 0;
  const instance = circuit.createComponent(defId, position, rotation, options.properties);
  const result = validatePlacement(circuit, {
    definition,
    position: instance.position,
    rotation,
    properties: instance.properties,
  });
  if (!result.valid) {
    throw new Error(`Illegal placement of ${defId} at ${position.x},${position.y}: ${result.reasons.join(' ')}`);
  }
  circuit.addComponent(instance);
  return instance;
}

/** Place a part so that a named pin lands in a named hole. */
export function plugInto(
  circuit: Circuit,
  board: Breadboard,
  defId: string,
  pinNumber: number,
  holeId: string,
  options: { rotation?: Rotation; properties?: Record<string, PropertyValue> } = {},
): ComponentInstance {
  const definition = componentRegistry.require(defId);
  const properties = {
    ...defaultProperties(definition),
    ...(options.properties ?? {}),
  };
  const pin = pinsOf(definition, properties).find((p) => p.number === pinNumber);
  if (!pin) throw new Error(`${defId} has no pin ${pinNumber}`);
  const offset = rotateOffset(pin.offset, options.rotation ?? 0);
  const target = holePosition(board, holeId);
  return place(circuit, defId, { x: target.x - offset.x, y: target.y - offset.y }, options);
}

export function connect(
  circuit: Circuit,
  from: ConnectionRef,
  to: ConnectionRef,
  color = 'black',
): void {
  circuit.addWire(circuit.createWire(from, to, color));
}

export interface NandLab {
  circuit: Circuit;
  engine: SimulationEngine;
  board: Breadboard;
  u1: ComponentInstance;
  supply: ComponentInstance;
  in1: ComponentInstance;
  in2: ComponentInstance;
  led: ComponentInstance;
  resistor: ComponentInstance;
  setInputs(a: boolean, b: boolean): void;
  outputValue(): string;
  ledLit(): boolean;
}

/**
 * The reference experiment: a 7400 on a half-size board, powered from a bench supply
 * through the rails, with two logic sources on the inputs of gate 1 and an LED plus
 * series resistor on the output.
 *
 *   PS+ -> top + rail -> a10 -> pin 14          PS- -> top - rail -> j16 -> pin 7
 *   IN1 -> h10 -> pin 1                         IN2 -> h11 -> pin 2
 *   pin 3 -> f12 group -> LED -> R -> - rail
 */
export function buildNandLab(): NandLab {
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-half', { x: 0, y: 0 });

  // Pin 1 of the DIP goes into f10, so the package straddles the trench with pins
  // 1-7 in row f and pins 8-14 in row e.
  const u1 = plugInto(circuit, board, 'ic-7400', 1, 'f10');

  const supply = place(circuit, 'pwr-supply', { x: -22, y: 4 });
  const in1 = place(circuit, 'in-logic', { x: -22, y: 14 });
  const in2 = place(circuit, 'in-logic', { x: -22, y: 19 });

  // Power distribution: supply to the rails, rails to the chip.
  connect(circuit, pinRef(supply, 1), holeRef(board, 'TP1'), 'red');
  connect(circuit, pinRef(supply, 2), holeRef(board, 'TN1'), 'black');
  connect(circuit, holeRef(board, 'TP10'), holeRef(board, 'a10'), 'red');
  connect(circuit, holeRef(board, 'TN16'), holeRef(board, 'j16'), 'black');

  // Inputs into gate 1.
  connect(circuit, pinRef(in1, 1), holeRef(board, 'h10'), 'yellow');
  connect(circuit, pinRef(in2, 1), holeRef(board, 'h11'), 'yellow');

  // Output through an LED and a current-limiting resistor back to the ground rail.
  // The LED is deliberately placed clear of columns 10-16, which the chip's own pins
  // occupy: sharing one of those clips would tie the LED to another gate's output.
  connect(circuit, holeRef(board, 'h12'), holeRef(board, 'h20'), 'amber');
  const led = plugInto(circuit, board, 'out-led', 1, 'j20', { properties: { span: 3 } });
  const resistor = plugInto(circuit, board, 'pas-resistor', 1, 'i23', { properties: { span: 4 } });
  connect(circuit, holeRef(board, 'j27'), holeRef(board, 'TN27'), 'black');

  const engine = new SimulationEngine(circuit);

  const lab: NandLab = {
    circuit,
    engine,
    board,
    u1,
    supply,
    in1,
    in2,
    led,
    resistor,
    setInputs(a, b) {
      in1.properties.level = a ? 'H' : 'L';
      in2.properties.level = b ? 'H' : 'L';
      engine.rebuild();
      engine.advance(1e6);
    },
    outputValue() {
      return engine.netValueOfPin(u1.id, 3)?.value ?? 'Z';
    },
    ledLit() {
      return engine.runtime(led.id).display.lit === true;
    },
  };
  return lab;
}
