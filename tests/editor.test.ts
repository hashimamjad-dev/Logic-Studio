import { describe, expect, it } from 'vitest';

import { EXAMPLES } from '../src/app/examples';
import {
  AddComponentCommand,
  AddJunctionCommand,
  AddWireCommand,
  CompositeCommand,
  DeleteCommand,
  MoveComponentCommand,
  SetPropertyCommand,
  UpdateWireCommand,
} from '../src/editor/commands';
import { UndoManager } from '../src/editor/UndoManager';
import { Circuit } from '../src/core/Circuit';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { buildNandLab, holeRef } from './helpers/lab';

function lab() {
  const built = buildNandLab();
  return { ...built, undo: new UndoManager(built.circuit) };
}

describe('undo and redo', () => {
  it('restores the model, not a picture of it', () => {
    const { circuit, engine, board, undo } = lab();
    const before = circuit.topologyKey();

    const instance = circuit.createComponent('out-led', boardHole(circuit, board.id, 'b20'), 0, { span: 3 });
    undo.execute(new AddComponentCommand(instance));
    expect(circuit.components).toHaveLength(7);
    expect(circuit.topologyKey()).not.toBe(before);

    undo.undo();
    expect(circuit.components).toHaveLength(6);
    expect(circuit.topologyKey()).toBe(before);

    undo.redo();
    expect(circuit.getComponent(instance.id)).toBeDefined();
    engine.rebuild();
    expect(circuit.topologyKey()).not.toBe(before);
  });

  it('brings back the wires that went with a deleted part', () => {
    const { circuit, undo, u1 } = lab();
    const wiresBefore = circuit.wires.length;
    const attached = circuit.wires.filter(
      (w) =>
        (w.from.kind === 'pin' && w.from.componentId === u1.id) ||
        (w.to.kind === 'pin' && w.to.componentId === u1.id),
    ).length;

    undo.execute(new DeleteCommand({ components: [u1.id] }));
    expect(circuit.getComponent(u1.id)).toBeUndefined();
    expect(circuit.wires).toHaveLength(wiresBefore - attached);

    undo.undo();
    expect(circuit.getComponent(u1.id)).toBeDefined();
    expect(circuit.wires).toHaveLength(wiresBefore);
  });

  it('takes junctions and their branches with the wire they sit on', () => {
    const { circuit, undo, board } = lab();
    const branchStart = circuit.wires[0];
    const junction = { id: 'J1', wireId: branchStart.id, position: { x: 5, y: 5 } };
    const branch = circuit.createWire(
      { kind: 'junction', junctionId: 'J1' },
      holeRef(board, 'a25'),
      'teal',
    );
    undo.execute(new CompositeCommand('branch', [new AddJunctionCommand(junction), new AddWireCommand(branch)]));
    expect(circuit.junctions).toHaveLength(1);

    undo.execute(new DeleteCommand({ wires: [branchStart.id] }));
    expect(circuit.junctions).toHaveLength(0);
    expect(circuit.getWire(branch.id)).toBeUndefined();

    undo.undo();
    expect(circuit.junctions).toHaveLength(1);
    expect(circuit.getWire(branch.id)).toBeDefined();
  });

  it('keeps the circuit electrically identical through undo and redo', () => {
    const { circuit, engine, undo, u1 } = lab();
    engine.advance(1e6);
    expect(engine.runtime(u1.id).electrical).toBe('POWERED');

    const vccWire = circuit.wires.find((w) => w.from.kind === 'hole' && w.from.hole === 'TP10')!;
    undo.execute(new DeleteCommand({ wires: [vccWire.id] }));
    engine.rebuild();
    expect(engine.runtime(u1.id).electrical).toBe('UNPOWERED');

    undo.undo();
    engine.rebuild();
    expect(engine.runtime(u1.id).electrical).toBe('POWERED');

    undo.redo();
    engine.rebuild();
    expect(engine.runtime(u1.id).electrical).toBe('UNPOWERED');

    undo.undo();
    engine.rebuild();
    expect(engine.runtime(u1.id).electrical).toBe('POWERED');
  });

  it('undoes a move and a rotation together', () => {
    const { undo, u1 } = lab();
    const before = { position: { ...u1.position }, rotation: u1.rotation };
    const after = { position: { x: u1.position.x + 2, y: u1.position.y }, rotation: 180 as const };
    undo.execute(new MoveComponentCommand(u1.id, before, after));
    expect(u1.position.x).toBe(before.position.x + 2);
    expect(u1.rotation).toBe(180);
    undo.undo();
    expect(u1.position).toEqual(before.position);
    expect(u1.rotation).toBe(0);
  });

  it('undoes a property change', () => {
    const { circuit, undo, led } = lab();
    undo.execute(new SetPropertyCommand(led.id, 'color', 'red', 'green'));
    expect(circuit.getComponent(led.id)!.properties.color).toBe('green');
    undo.undo();
    expect(circuit.getComponent(led.id)!.properties.color).toBe('red');
  });

  it('undoes a wire edit without touching the endpoints', () => {
    const { circuit, undo } = lab();
    const wire = circuit.wires[2];
    const before = { corners: [], color: wire.color, from: wire.from, to: wire.to };
    const after = { corners: [{ x: 3, y: 3 }], color: 'teal', from: wire.from, to: wire.to };
    undo.execute(new UpdateWireCommand(wire.id, before, after));
    expect(wire.corners).toHaveLength(1);
    expect(wire.color).toBe('teal');
    undo.undo();
    expect(wire.corners).toHaveLength(0);
    expect(wire.color).toBe(before.color);
    expect(wire.from).toEqual(before.from);
  });

  it('clears the redo stack once a new command is executed', () => {
    const { circuit, undo, board } = lab();
    const first = circuit.createComponent('out-led', boardHole(circuit, board.id, 'b20'), 0, { span: 3 });
    undo.execute(new AddComponentCommand(first));
    undo.undo();
    expect(undo.canRedo).toBe(true);
    const second = circuit.createComponent('out-led', boardHole(circuit, board.id, 'b25'), 0, { span: 3 });
    undo.execute(new AddComponentCommand(second));
    expect(undo.canRedo).toBe(false);
  });

  it('reports what the next undo will do', () => {
    const { circuit, undo, led } = lab();
    expect(undo.nextUndoLabel).toBeUndefined();
    undo.execute(new SetPropertyCommand(led.id, 'color', 'red', 'blue', 'Change colour'));
    expect(undo.nextUndoLabel).toBe('Change colour');
    void circuit;
  });
});

describe('deleting a board', () => {
  it('takes the wires that plugged into it, and puts them back on undo', () => {
    const { circuit, undo, board } = lab();
    const wiresBefore = circuit.wires.length;
    undo.execute(new DeleteCommand({ boards: [board.id] }));
    expect(circuit.boards).toHaveLength(0);
    expect(circuit.wires.length).toBeLessThan(wiresBefore);
    undo.undo();
    expect(circuit.boards).toHaveLength(1);
    expect(circuit.wires).toHaveLength(wiresBefore);
    // ...and the restored board still knows its own topology.
    expect(circuit.getBoard(board.id)!.getHole('a10')!.groupId).toBe(
      circuit.getBoard(board.id)!.getHole('e10')!.groupId,
    );
  });
});

describe('the worked example survives a full edit cycle', () => {
  it('moves the chip away and back with the model intact', () => {
    const circuit = EXAMPLES[0].build();
    const engine = new SimulationEngine(circuit);
    const undo = new UndoManager(circuit);
    const chip = circuit.components.find((c) => c.defId === 'ic-7400')!;
    engine.advance(1e6);
    expect(engine.runtime(chip.id).electrical).toBe('POWERED');

    const before = { position: { ...chip.position }, rotation: chip.rotation };
    undo.execute(
      new MoveComponentCommand(chip.id, before, {
        position: { x: before.position.x, y: before.position.y },
        rotation: 180,
      }),
    );
    engine.rebuild();
    // Turned round, pin 14 is now where pin 1 was: the chip loses its supply.
    expect(engine.runtime(chip.id).electrical).not.toBe('POWERED');

    undo.undo();
    engine.rebuild();
    expect(engine.runtime(chip.id).electrical).toBe('POWERED');
  });
});

function boardHole(circuit: Circuit, boardId: string, holeId: string) {
  const board = circuit.getBoard(boardId)!;
  return board.worldPosition(board.getHole(holeId)!);
}
