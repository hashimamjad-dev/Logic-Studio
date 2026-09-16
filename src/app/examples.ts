/**
 * Worked examples.
 *
 * These are built with the same calls the editor makes, through the same placement
 * validator, so an example is by construction something the student could have built
 * by hand. If a placement here were illegal the example would refuse to load, and a
 * test builds every one of them for exactly that reason.
 *
 * The wire corners are chosen the way they would be on a real bench: jumpers run in
 * clear channels rather than over the top of a chip, and the bottom rails are fed
 * from the top ones with a pair of jumpers instead of being powered by magic.
 */

import { validatePlacement } from '../breadboard/PlacementValidator';
import { defaultProperties, pinsOf } from '../components/ComponentDefinition';
import { componentRegistry } from '../components/ComponentRegistry';
import { Circuit, ComponentInstance } from '../core/Circuit';
import { ConnectionRef, GridPoint, PropertyValue, Rotation, rotateOffset } from '../core/types';

interface PlaceOptions {
  rotation?: Rotation;
  properties?: Record<string, PropertyValue>;
}

function place(circuit: Circuit, defId: string, position: GridPoint, options: PlaceOptions = {}): ComponentInstance {
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
    throw new Error(`Example places ${defId} illegally: ${result.reasons.join(' ')}`);
  }
  circuit.addComponent(instance);
  return instance;
}

function plug(
  circuit: Circuit,
  boardId: string,
  defId: string,
  pinNumber: number,
  holeId: string,
  options: PlaceOptions = {},
): ComponentInstance {
  const board = circuit.getBoard(boardId);
  if (!board) throw new Error(`No board ${boardId}`);
  const target = board.getHole(holeId);
  if (!target) throw new Error(`No hole ${holeId} on ${board.definition.name}`);
  const definition = componentRegistry.require(defId);
  const properties = { ...defaultProperties(definition), ...(options.properties ?? {}) };
  const pin = pinsOf(definition, properties).find((p) => p.number === pinNumber);
  if (!pin) throw new Error(`${defId} has no pin ${pinNumber}`);
  const offset = rotateOffset(pin.offset, options.rotation ?? 0);
  const world = board.worldPosition(target);
  return place(circuit, defId, { x: world.x - offset.x, y: world.y - offset.y }, options);
}

function hole(boardId: string, holeId: string): ConnectionRef {
  return { kind: 'hole', boardId, hole: holeId };
}

function pinRef(instance: ComponentInstance, pinNumber: number): ConnectionRef {
  return { kind: 'pin', componentId: instance.id, pin: pinNumber };
}

function wire(
  circuit: Circuit,
  from: ConnectionRef,
  to: ConnectionRef,
  color: string,
  corners: GridPoint[] = [],
): void {
  circuit.addWire(circuit.createWire(from, to, color, corners));
}

export interface Example {
  id: string;
  name: string;
  description: string;
  build(): Circuit;
}

/**
 * The reference experiment: a 7400 quad NAND on a half board.
 *
 *   supply -> top rails -> jumpers -> bottom rails
 *   top + rail  -> a10 -> pin 14          bottom - rail -> j16 -> pin 7
 *   two SPDT switches, one throw on +5 V and one on ground, into pins 1 and 2
 *   pin 3 -> LED -> 330 ohm -> bottom - rail
 */
function buildNandExample(): Circuit {
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
  const b = board.id;

  // Pin 1 in f10, so pins 1-7 sit in row f and pins 8-14 in row e.
  plug(circuit, b, 'ic-7400', 1, 'f10');

  const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
  wire(circuit, pinRef(supply, 1), hole(b, 'TP1'), 'red');
  wire(circuit, pinRef(supply, 2), hole(b, 'TN1'), 'black');

  // Carry the supply down to the bottom rails, past the working area.
  wire(circuit, hole(b, 'TP29'), hole(b, 'BP29'), 'red');
  wire(circuit, hole(b, 'TN28'), hole(b, 'BN28'), 'black');

  // Power into the chip: pin 14 from the top + rail, pin 7 to the bottom - rail.
  wire(circuit, hole(b, 'TP10'), hole(b, 'a10'), 'red');
  wire(circuit, hole(b, 'BN16'), hole(b, 'j16'), 'black');

  // Switch 1: throw A to +5 V, throw B to ground, common into pin 1.
  plug(circuit, b, 'in-toggle', 1, 'd3');
  wire(circuit, hole(b, 'a3'), hole(b, 'TP3'), 'red');
  wire(circuit, hole(b, 'a7'), hole(b, 'TN7'), 'black');
  wire(circuit, hole(b, 'c5'), hole(b, 'h10'), 'yellow', [{ x: 4, y: 12 }]);

  // Switch 2 into pin 2, routed round the other side of the chip.
  plug(circuit, b, 'in-toggle', 1, 'd17');
  wire(circuit, hole(b, 'a17'), hole(b, 'TP17'), 'red');
  wire(circuit, hole(b, 'a21'), hole(b, 'TN21'), 'black');
  wire(circuit, hole(b, 'c19'), hole(b, 'h11'), 'green', [{ x: 18, y: 12 }]);

  // Output: pin 3 out to a clear column, then the LED and its series resistor.
  wire(circuit, hole(b, 'g12'), hole(b, 'g20'), 'amber');
  plug(circuit, b, 'out-led', 1, 'j20', { properties: { span: 3 } });
  plug(circuit, b, 'pas-resistor', 1, 'i23', { properties: { span: 4, resistance: 330 } });
  wire(circuit, hole(b, 'j27'), hole(b, 'BN27'), 'black');

  return circuit;
}

/**
 * A 7474 wired as a divide-by-two: Q-bar back to D, clocked at 2 Hz, with Q and
 * Q-bar on LEDs so the division is visible.
 */
function buildFlipFlopExample(): Circuit {
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
  const b = board.id;

  // Pin 1 in f8: pins 1-7 in row f columns 8-14, pins 8-14 in row e columns 14-8.
  plug(circuit, b, 'ic-7474', 1, 'f8');

  const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
  wire(circuit, pinRef(supply, 1), hole(b, 'TP1'), 'red');
  wire(circuit, pinRef(supply, 2), hole(b, 'TN1'), 'black');
  wire(circuit, hole(b, 'TP29'), hole(b, 'BP29'), 'red');
  wire(circuit, hole(b, 'TN28'), hole(b, 'BN28'), 'black');

  wire(circuit, hole(b, 'TP8'), hole(b, 'a8'), 'red'); // pin 14, VCC
  wire(circuit, hole(b, 'BN14'), hole(b, 'j14'), 'black'); // pin 7, GND

  // CLR (pin 1) and PRE (pin 4) are active low, so they are tied high.
  wire(circuit, hole(b, 'j8'), hole(b, 'BP8'), 'red');
  wire(circuit, hole(b, 'j11'), hole(b, 'BP11'), 'red');

  // A clock module, powered from the same rails as everything else. Its supply
  // wires go over the top of the board rather than across it.
  const clock = place(circuit, 'in-clock', { x: -24, y: 9 });
  clock.properties.frequency = 2;
  wire(circuit, pinRef(clock, 1), hole(b, 'TP3'), 'red', [
    { x: -27, y: 11 },
    { x: -27, y: -4 },
    { x: 2, y: -4 },
  ]);
  wire(circuit, pinRef(clock, 2), hole(b, 'TN4'), 'black', [
    { x: -29, y: 13 },
    { x: -29, y: -6 },
    { x: 3, y: -6 },
  ]);
  wire(circuit, pinRef(clock, 3), hole(b, 'h10'), 'amber'); // pin 3, CLK

  // Q-bar (pin 6) back into D (pin 2) divides the clock by two.
  wire(circuit, hole(b, 'g13'), hole(b, 'g9'), 'blue');

  // Q on a green LED, out in the clear columns to the right.
  wire(circuit, hole(b, 'h12'), hole(b, 'h20'), 'green');
  plug(circuit, b, 'out-led', 1, 'j20', { properties: { span: 3, color: 'green' } });
  plug(circuit, b, 'pas-resistor', 1, 'i23', { properties: { span: 4, resistance: 330 } });
  wire(circuit, hole(b, 'j27'), hole(b, 'BN27'), 'black');

  // Q-bar on a red LED in the upper bank, routed round the left of the chip.
  wire(circuit, hole(b, 'i13'), hole(b, 'd2'), 'red', [{ x: 1, y: 13 }]);
  plug(circuit, b, 'out-led', 1, 'c2', { properties: { span: 3, color: 'red' } });
  plug(circuit, b, 'pas-resistor', 1, 'b5', { properties: { span: 2, resistance: 330 } });
  wire(circuit, hole(b, 'a7'), hole(b, 'TN7'), 'black');

  return circuit;
}

export const EXAMPLES: Example[] = [
  {
    id: 'nand-7400',
    name: '7400 NAND gate lab',
    description: 'A 7400 with two switches, an LED and a proper power path through the rails.',
    build: buildNandExample,
  },
  {
    id: 'dff-7474',
    name: '7474 D flip-flop divider',
    description: 'A 7474 dividing a 2 Hz clock by two, with Q and Q-bar on LEDs.',
    build: buildFlipFlopExample,
  },
];

export function buildExample(id: string): Circuit {
  const example = EXAMPLES.find((entry) => entry.id === id);
  if (!example) throw new Error(`No example called ${id}`);
  return example.build();
}

/** A fresh project: one board and a supply already wired to the rails. */
export function buildEmptyProject(): Circuit {
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
  const supply = place(circuit, 'pwr-supply', { x: -24, y: 2 });
  wire(circuit, pinRef(supply, 1), hole(board.id, 'TP1'), 'red');
  wire(circuit, pinRef(supply, 2), hole(board.id, 'TN1'), 'black');
  return circuit;
}
