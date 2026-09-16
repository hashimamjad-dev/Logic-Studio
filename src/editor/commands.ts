/**
 * Undoable operations.
 *
 * Every change to the circuit goes through a command, and every command knows how to
 * put the model back exactly as it was. Undo restores the model, not a picture of it,
 * so a circuit that is undone and redone is electrically identical - the tests check
 * exactly that.
 *
 * Commands that have side effects (deleting a part takes its wires with it) capture
 * those side effects when they run, so the inverse is complete.
 */

import type { Circuit, ComponentInstance, Junction, Wire } from '../core/Circuit';
import type { GridPoint, PropertyValue, Rotation } from '../core/types';

export interface Command {
  /** Shown in the status bar and the undo tooltip. */
  label: string;
  apply(circuit: Circuit): void;
  revert(circuit: Circuit): void;
}

function cloneComponent(instance: ComponentInstance): ComponentInstance {
  return {
    ...instance,
    position: { ...instance.position },
    properties: { ...instance.properties },
  };
}

function cloneWire(wire: Wire): Wire {
  return { ...wire, corners: wire.corners.map((c) => ({ ...c })) };
}

export class AddComponentCommand implements Command {
  readonly label: string;
  private snapshot: ComponentInstance;

  constructor(instance: ComponentInstance, label?: string) {
    this.snapshot = cloneComponent(instance);
    this.label = label ?? `Place ${instance.reference}`;
  }

  apply(circuit: Circuit): void {
    circuit.addComponent(cloneComponent(this.snapshot));
  }

  revert(circuit: Circuit): void {
    circuit.removeComponent(this.snapshot.id);
  }

  get componentId(): string {
    return this.snapshot.id;
  }
}

export class AddBoardCommand implements Command {
  readonly label: string;
  private boardId: string | undefined;

  constructor(
    private definitionId: string,
    private position: GridPoint,
    private name: string,
  ) {
    this.label = `Add ${this.name}`;
  }

  apply(circuit: Circuit): void {
    const board = circuit.addBoard(this.definitionId, this.position, this.boardId);
    this.boardId = board.id;
  }

  revert(circuit: Circuit): void {
    if (this.boardId) circuit.removeBoard(this.boardId);
  }

  get id(): string | undefined {
    return this.boardId;
  }
}

export class AddWireCommand implements Command {
  readonly label: string;
  private snapshot: Wire;

  constructor(wire: Wire) {
    this.snapshot = cloneWire(wire);
    this.label = 'Add wire';
  }

  apply(circuit: Circuit): void {
    circuit.addWire(cloneWire(this.snapshot));
  }

  revert(circuit: Circuit): void {
    circuit.removeWire(this.snapshot.id);
  }

  get wireId(): string {
    return this.snapshot.id;
  }
}

export class AddJunctionCommand implements Command {
  readonly label = 'Add junction';
  private snapshot: Junction;

  constructor(junction: Junction) {
    this.snapshot = { ...junction, position: { ...junction.position } };
  }

  apply(circuit: Circuit): void {
    circuit.addJunction({ ...this.snapshot, position: { ...this.snapshot.position } });
  }

  revert(circuit: Circuit): void {
    circuit.removeJunction(this.snapshot.id);
  }
}

export class MoveComponentCommand implements Command {
  readonly label: string;

  constructor(
    private componentId: string,
    private before: { position: GridPoint; rotation: Rotation },
    private after: { position: GridPoint; rotation: Rotation },
    label?: string,
  ) {
    this.label = label ?? 'Move part';
  }

  apply(circuit: Circuit): void {
    this.set(circuit, this.after);
  }

  revert(circuit: Circuit): void {
    this.set(circuit, this.before);
  }

  private set(circuit: Circuit, state: { position: GridPoint; rotation: Rotation }): void {
    const instance = circuit.getComponent(this.componentId);
    if (!instance) return;
    instance.position = { ...state.position };
    instance.rotation = state.rotation;
    circuit.emit('geometry');
  }
}

export class MoveBoardCommand implements Command {
  readonly label = 'Move breadboard';

  constructor(
    private boardId: string,
    private before: GridPoint,
    private after: GridPoint,
  ) {}

  apply(circuit: Circuit): void {
    circuit.getBoard(this.boardId)?.moveTo(this.after);
    circuit.emit('geometry');
  }

  revert(circuit: Circuit): void {
    circuit.getBoard(this.boardId)?.moveTo(this.before);
    circuit.emit('geometry');
  }
}

export class SetPropertyCommand implements Command {
  readonly label: string;

  constructor(
    private componentId: string,
    private key: string,
    private before: PropertyValue,
    private after: PropertyValue,
    label?: string,
  ) {
    this.label = label ?? `Change ${key}`;
  }

  apply(circuit: Circuit): void {
    this.set(circuit, this.after);
  }

  revert(circuit: Circuit): void {
    this.set(circuit, this.before);
  }

  private set(circuit: Circuit, value: PropertyValue): void {
    const instance = circuit.getComponent(this.componentId);
    if (!instance) return;
    instance.properties[this.key] = value;
    circuit.emit('properties');
  }
}

export class UpdateWireCommand implements Command {
  readonly label: string;

  constructor(
    private wireId: string,
    private before: Pick<Wire, 'corners' | 'color' | 'from' | 'to'>,
    private after: Pick<Wire, 'corners' | 'color' | 'from' | 'to'>,
    label = 'Edit wire',
  ) {
    this.label = label;
  }

  apply(circuit: Circuit): void {
    this.set(circuit, this.after);
  }

  revert(circuit: Circuit): void {
    this.set(circuit, this.before);
  }

  private set(circuit: Circuit, state: Pick<Wire, 'corners' | 'color' | 'from' | 'to'>): void {
    const wire = circuit.getWire(this.wireId);
    if (!wire) return;
    wire.corners = state.corners.map((c) => ({ ...c }));
    wire.color = state.color;
    wire.from = state.from;
    wire.to = state.to;
    circuit.emit('wires');
  }
}

/**
 * Delete a selection.
 *
 * Deleting a part also deletes the wires plugged into it and any junctions on those
 * wires. All of that is captured here before anything is removed, so undo restores
 * the whole thing.
 */
export class DeleteCommand implements Command {
  readonly label: string;
  private components: ComponentInstance[] = [];
  private wires: Wire[] = [];
  private junctions: Junction[] = [];
  private boards: { id: string; definition: string; position: GridPoint }[] = [];

  constructor(
    private targets: { components?: string[]; wires?: string[]; junctions?: string[]; boards?: string[] },
    label?: string,
  ) {
    const count =
      (targets.components?.length ?? 0) +
      (targets.wires?.length ?? 0) +
      (targets.junctions?.length ?? 0) +
      (targets.boards?.length ?? 0);
    this.label = label ?? (count === 1 ? 'Delete' : `Delete ${count} items`);
  }

  apply(circuit: Circuit): void {
    const componentIds = new Set(this.targets.components ?? []);
    const boardIds = new Set(this.targets.boards ?? []);
    const wireIds = new Set(this.targets.wires ?? []);

    // Wires that lose an endpoint go too.
    for (const wire of circuit.wires) {
      const touchesComponent =
        (wire.from.kind === 'pin' && componentIds.has(wire.from.componentId)) ||
        (wire.to.kind === 'pin' && componentIds.has(wire.to.componentId));
      const touchesBoard =
        (wire.from.kind === 'hole' && boardIds.has(wire.from.boardId)) ||
        (wire.to.kind === 'hole' && boardIds.has(wire.to.boardId));
      if (touchesComponent || touchesBoard) wireIds.add(wire.id);
    }

    const junctionIds = new Set(this.targets.junctions ?? []);
    for (const junction of circuit.junctions) {
      if (wireIds.has(junction.wireId)) junctionIds.add(junction.id);
    }
    // ...and wires that ended on one of those junctions.
    for (const wire of circuit.wires) {
      if (
        (wire.from.kind === 'junction' && junctionIds.has(wire.from.junctionId)) ||
        (wire.to.kind === 'junction' && junctionIds.has(wire.to.junctionId))
      ) {
        wireIds.add(wire.id);
      }
    }

    this.components = circuit.components.filter((c) => componentIds.has(c.id)).map(cloneComponent);
    this.wires = circuit.wires.filter((w) => wireIds.has(w.id)).map(cloneWire);
    this.junctions = circuit.junctions
      .filter((j) => junctionIds.has(j.id))
      .map((j) => ({ ...j, position: { ...j.position } }));
    this.boards = circuit.boards
      .filter((b) => boardIds.has(b.id))
      .map((b) => ({ id: b.id, definition: b.definition.id, position: { ...b.position } }));

    for (const id of junctionIds) circuit.junctions = circuit.junctions.filter((j) => j.id !== id);
    for (const id of wireIds) circuit.wires = circuit.wires.filter((w) => w.id !== id);
    for (const id of componentIds) circuit.components = circuit.components.filter((c) => c.id !== id);
    for (const id of boardIds) circuit.removeBoard(id);
    circuit.emit('components');
    circuit.emit('wires');
  }

  revert(circuit: Circuit): void {
    for (const board of this.boards) circuit.addBoard(board.definition, board.position, board.id);
    for (const component of this.components) circuit.addComponent(cloneComponent(component));
    for (const wire of this.wires) circuit.addWire(cloneWire(wire));
    for (const junction of this.junctions) {
      circuit.addJunction({ ...junction, position: { ...junction.position } });
    }
  }
}

export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private commands: Command[],
  ) {}

  apply(circuit: Circuit): void {
    for (const command of this.commands) command.apply(circuit);
  }

  revert(circuit: Circuit): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].revert(circuit);
  }
}
