/**
 * The circuit: boards, parts, wires and junctions.
 *
 * This is the single source of truth. The renderer reads it, the simulator reads it,
 * the serializer writes it out verbatim. Nothing in here knows about pixels, and
 * nothing in here decides electrical connectivity - that is the net resolver's job,
 * working from the structures stored here.
 */

import { Breadboard, Hole } from '../breadboard/Breadboard';
import {
  BreadboardDefinition,
  getBreadboardDefinition,
} from '../breadboard/BreadboardDefinition';
import {
  ComponentDefinition,
  bodyOf,
  defaultProperties,
  pinsOf,
} from '../components/ComponentDefinition';
import { componentRegistry } from '../components/ComponentRegistry';
import { IdGenerator } from './ids';
import {
  ConnectionRef,
  GridPoint,
  PropertyValue,
  Rect,
  Rotation,
  connectionRefId,
  rotateOffset,
  rotateRect,
} from './types';

export interface ComponentInstance {
  id: string;
  defId: string;
  /** Designator shown on the body and in the inspector, e.g. `U1`. */
  reference: string;
  /** Position of the component origin (pin 1 for a DIP) in world grid units. */
  position: GridPoint;
  rotation: Rotation;
  properties: Record<string, PropertyValue>;
}

export interface Wire {
  id: string;
  from: ConnectionRef;
  to: ConnectionRef;
  /** User-chosen corners, in world grid units, between the two endpoints. */
  corners: GridPoint[];
  /** Purely cosmetic. Colour never influences the electrical model. */
  color: string;
}

export interface Junction {
  id: string;
  wireId: string;
  position: GridPoint;
}

export interface PinLocation {
  component: ComponentInstance;
  definition: ComponentDefinition;
  pinNumber: number;
  pinName: string;
  position: GridPoint;
}

export interface HoleLocation {
  board: Breadboard;
  hole: Hole;
  position: GridPoint;
}

export type CircuitChange =
  | 'components'
  | 'wires'
  | 'boards'
  | 'properties'
  | 'geometry';

export class Circuit {
  readonly ids = new IdGenerator();

  boards: Breadboard[] = [];
  components: ComponentInstance[] = [];
  wires: Wire[] = [];
  junctions: Junction[] = [];

  private listeners = new Set<(change: CircuitChange) => void>();

  onChange(listener: (change: CircuitChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: CircuitChange): void {
    for (const listener of this.listeners) listener(change);
  }

  clear(): void {
    this.boards = [];
    this.components = [];
    this.wires = [];
    this.junctions = [];
    this.ids.reset();
    this.emit('boards');
  }

  /* ---------------------------------------------------------------- *
   * Boards
   * ---------------------------------------------------------------- */

  addBoard(definitionId: string, position: GridPoint, id?: string): Breadboard {
    const definition = getBreadboardDefinition(definitionId);
    if (!definition) throw new Error(`Unknown breadboard definition: ${definitionId}`);
    const boardId = id ?? this.ids.next('BB');
    this.ids.observe(boardId);
    const board = new Breadboard(boardId, definition, position);
    this.boards.push(board);
    this.emit('boards');
    return board;
  }

  removeBoard(boardId: string): void {
    this.boards = this.boards.filter((b) => b.id !== boardId);
    this.emit('boards');
  }

  getBoard(boardId: string): Breadboard | undefined {
    return this.boards.find((b) => b.id === boardId);
  }

  boardDefinitions(): BreadboardDefinition[] {
    return this.boards.map((b) => b.definition);
  }

  /* ---------------------------------------------------------------- *
   * Components
   * ---------------------------------------------------------------- */

  createComponent(
    defId: string,
    position: GridPoint,
    rotation: Rotation = 0,
    properties?: Record<string, PropertyValue>,
    id?: string,
    reference?: string,
  ): ComponentInstance {
    const def = componentRegistry.require(defId);
    const instanceId = id ?? this.ids.next('U');
    this.ids.observe(instanceId);
    const ref = reference ?? this.nextReference(def.refPrefix);
    const instance: ComponentInstance = {
      id: instanceId,
      defId,
      reference: ref,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      rotation,
      properties: { ...defaultProperties(def), ...(properties ?? {}) },
    };
    return instance;
  }

  addComponent(instance: ComponentInstance): void {
    this.components.push(instance);
    this.ids.observe(instance.id);
    this.ids.observe(instance.reference);
    this.emit('components');
  }

  removeComponent(componentId: string): void {
    this.components = this.components.filter((c) => c.id !== componentId);
    // Wires that landed on this part's pins have lost their endpoint and go with it.
    const doomed = this.wires.filter((w) => wireTouchesComponent(w, componentId));
    for (const wire of doomed) this.removeWire(wire.id);
    this.emit('components');
  }

  getComponent(componentId: string): ComponentInstance | undefined {
    return this.components.find((c) => c.id === componentId);
  }

  definitionOf(instance: ComponentInstance): ComponentDefinition {
    return componentRegistry.require(instance.defId);
  }

  private nextReference(prefix: string): string {
    let n = 1;
    const used = new Set(this.components.map((c) => c.reference));
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  /* ---------------------------------------------------------------- *
   * Geometry helpers
   * ---------------------------------------------------------------- */

  pinPositions(instance: ComponentInstance): PinLocation[] {
    const def = this.definitionOf(instance);
    return pinsOf(def, instance.properties).map((pin) => {
      const offset = rotateOffset(pin.offset, instance.rotation);
      return {
        component: instance,
        definition: def,
        pinNumber: pin.number,
        pinName: pin.name,
        position: { x: instance.position.x + offset.x, y: instance.position.y + offset.y },
      };
    });
  }

  pinPosition(componentId: string, pinNumber: number): GridPoint | undefined {
    const instance = this.getComponent(componentId);
    if (!instance) return undefined;
    const def = this.definitionOf(instance);
    const pin = pinsOf(def, instance.properties).find((p) => p.number === pinNumber);
    if (!pin) return undefined;
    const offset = rotateOffset(pin.offset, instance.rotation);
    return { x: instance.position.x + offset.x, y: instance.position.y + offset.y };
  }

  /** Body outline of a part in world grid units, after rotation. */
  componentBounds(instance: ComponentInstance): Rect {
    const def = this.definitionOf(instance);
    const local = rotateRect(bodyOf(def, instance.properties), instance.rotation);
    return {
      x: instance.position.x + local.x,
      y: instance.position.y + local.y,
      width: local.width,
      height: local.height,
    };
  }

  /* ---------------------------------------------------------------- *
   * Lookups used by placement, wiring and hit testing
   * ---------------------------------------------------------------- */

  holeAt(x: number, y: number): HoleLocation | undefined {
    for (const board of this.boards) {
      const hole = board.holeAtGrid(x, y);
      if (hole) return { board, hole, position: board.worldPosition(hole) };
    }
    return undefined;
  }

  /** Which board, if any, covers this grid point. */
  boardAt(x: number, y: number): Breadboard | undefined {
    for (const board of this.boards) {
      const b = board.bounds();
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return board;
    }
    return undefined;
  }

  pinAt(x: number, y: number, tolerance = 0.45): PinLocation | undefined {
    let best: PinLocation | undefined;
    let bestDistance = tolerance;
    for (const instance of this.components) {
      for (const pin of this.pinPositions(instance)) {
        const distance = Math.hypot(pin.position.x - x, pin.position.y - y);
        if (distance <= bestDistance) {
          best = pin;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /** Every hole currently occupied by a pin, keyed by the global hole id. */
  holeOccupancy(excludeComponentId?: string): Map<string, { componentId: string; pin: number }> {
    const map = new Map<string, { componentId: string; pin: number }>();
    for (const instance of this.components) {
      if (instance.id === excludeComponentId) continue;
      const def = this.definitionOf(instance);
      if (def.footprint.mount !== 'through-hole') continue;
      for (const pin of this.pinPositions(instance)) {
        const found = this.holeAt(pin.position.x, pin.position.y);
        if (found) {
          map.set(`${found.board.id}:${found.hole.id}`, {
            componentId: instance.id,
            pin: pin.pinNumber,
          });
        }
      }
    }
    return map;
  }

  /* ---------------------------------------------------------------- *
   * Wires and junctions
   * ---------------------------------------------------------------- */

  createWire(from: ConnectionRef, to: ConnectionRef, color: string, corners: GridPoint[] = [], id?: string): Wire {
    const wireId = id ?? this.ids.next('W');
    this.ids.observe(wireId);
    return { id: wireId, from, to, corners: corners.map((c) => ({ ...c })), color };
  }

  addWire(wire: Wire): void {
    this.wires.push(wire);
    this.ids.observe(wire.id);
    this.emit('wires');
  }

  removeWire(wireId: string): void {
    this.wires = this.wires.filter((w) => w.id !== wireId);
    this.junctions = this.junctions.filter((j) => j.wireId !== wireId);
    this.emit('wires');
  }

  getWire(wireId: string): Wire | undefined {
    return this.wires.find((w) => w.id === wireId);
  }

  addJunction(junction: Junction): void {
    this.junctions.push(junction);
    this.ids.observe(junction.id);
    this.emit('wires');
  }

  removeJunction(junctionId: string): void {
    this.junctions = this.junctions.filter((j) => j.id !== junctionId);
    // A wire that ended on this junction no longer has a valid endpoint.
    const doomed = this.wires.filter(
      (w) =>
        (w.from.kind === 'junction' && w.from.junctionId === junctionId) ||
        (w.to.kind === 'junction' && w.to.junctionId === junctionId),
    );
    for (const wire of doomed) this.removeWire(wire.id);
    this.emit('wires');
  }

  getJunction(junctionId: string): Junction | undefined {
    return this.junctions.find((j) => j.id === junctionId);
  }

  /**
   * Where a connection reference physically sits. Returns undefined when the
   * reference is dangling, which the validator reports rather than hiding.
   */
  resolvePosition(ref: ConnectionRef): GridPoint | undefined {
    switch (ref.kind) {
      case 'hole': {
        const board = this.getBoard(ref.boardId);
        const hole = board?.getHole(ref.hole);
        return board && hole ? board.worldPosition(hole) : undefined;
      }
      case 'pin':
        return this.pinPosition(ref.componentId, ref.pin);
      case 'junction': {
        const junction = this.getJunction(ref.junctionId);
        return junction ? { ...junction.position } : undefined;
      }
    }
  }

  /** Full polyline of a wire in world grid units, endpoints included. */
  wirePath(wire: Wire): GridPoint[] | undefined {
    const start = this.resolvePosition(wire.from);
    const end = this.resolvePosition(wire.to);
    if (!start || !end) return undefined;
    return [start, ...wire.corners.map((c) => ({ ...c })), end];
  }

  describeConnection(ref: ConnectionRef): string {
    switch (ref.kind) {
      case 'hole': {
        const board = this.getBoard(ref.boardId);
        return board ? `${board.definition.name} ${ref.hole}` : `${ref.boardId} ${ref.hole}`;
      }
      case 'pin': {
        const instance = this.getComponent(ref.componentId);
        if (!instance) return `${ref.componentId} pin ${ref.pin}`;
        const def = this.definitionOf(instance);
        const pin = pinsOf(def, instance.properties).find((p) => p.number === ref.pin);
        return `${instance.reference} pin ${ref.pin}${pin ? ` (${pin.name})` : ''}`;
      }
      case 'junction':
        return `junction ${ref.junctionId}`;
    }
  }

  /** Cheap structural fingerprint; the simulator uses it to know when to rebuild. */
  topologyKey(): string {
    const parts: string[] = [];
    for (const board of this.boards) parts.push(`B${board.id}@${board.position.x},${board.position.y}`);
    for (const c of this.components) {
      // Properties are part of the key because some of them change the topology -
      // a switch position opens or closes a contact - and all of them change what a
      // device model does, so the simulator has to notice.
      const props = Object.keys(c.properties)
        .sort()
        .map((key) => `${key}=${c.properties[key]}`)
        .join(';');
      parts.push(`C${c.id}:${c.defId}@${c.position.x},${c.position.y}r${c.rotation}{${props}}`);
    }
    for (const w of this.wires) {
      parts.push(`W${w.id}:${connectionRefId(w.from)}>${connectionRefId(w.to)}`);
    }
    for (const j of this.junctions) parts.push(`J${j.id}:${j.wireId}`);
    return parts.join('|');
  }
}

function wireTouchesComponent(wire: Wire, componentId: string): boolean {
  return (
    (wire.from.kind === 'pin' && wire.from.componentId === componentId) ||
    (wire.to.kind === 'pin' && wire.to.componentId === componentId)
  );
}
