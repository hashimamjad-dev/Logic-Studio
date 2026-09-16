/**
 * A breadboard placed on the workspace.
 *
 * This class turns a {@link BreadboardDefinition} into the two indexes the rest of
 * the application needs:
 *
 *  - a position index, so a grid coordinate can be resolved to a hole;
 *  - a connectivity index, so a hole can be resolved to the clip (group) it shares
 *    with its neighbours.
 *
 * Nothing else in the codebase is allowed to decide that two holes are connected.
 */

import type { GridPoint, Rect } from '../core/types';
import {
  BreadboardDefinition,
  BankDefinition,
  RailDefinition,
  RailSegmentDefinition,
  railHasHole,
} from './BreadboardDefinition';

export interface Hole {
  /** Board-local name, e.g. `a10` for a terminal hole or `TP10` for a rail hole. */
  id: string;
  boardId: string;
  kind: 'terminal' | 'rail';
  row?: string;
  bankId?: string;
  railId?: string;
  segmentId?: string;
  column: number;
  /** Connectivity group: the clip this hole belongs to. */
  groupId: string;
  /** Offset from the board origin, in grid units. */
  local: GridPoint;
}

export interface ConnectivityGroup {
  id: string;
  kind: 'terminal' | 'rail';
  label: string;
  holeIds: string[];
  boardId: string;
}

export class Breadboard {
  readonly id: string;
  readonly definition: BreadboardDefinition;
  /** Position of the board origin (column 1 / first rail row) in grid units. */
  position: GridPoint;

  private holesById = new Map<string, Hole>();
  private holesByLocalKey = new Map<string, Hole>();
  private groups = new Map<string, ConnectivityGroup>();

  constructor(id: string, definition: BreadboardDefinition, position: GridPoint) {
    this.id = id;
    this.definition = definition;
    this.position = { x: Math.round(position.x), y: Math.round(position.y) };
    this.build();
  }

  private build(): void {
    for (const bank of this.definition.banks) this.buildBank(bank);
    for (const rail of this.definition.rails) this.buildRail(rail);
  }

  private buildBank(bank: BankDefinition): void {
    for (let column = 1; column <= this.definition.columns; column++) {
      const groupId = `${this.id}/${bank.id}/${column}`;
      const first = bank.rows[0];
      const last = bank.rows[bank.rows.length - 1];
      const group: ConnectivityGroup = {
        id: groupId,
        kind: 'terminal',
        label: `${first}${column}-${last}${column}`,
        holeIds: [],
        boardId: this.id,
      };
      bank.rows.forEach((row, index) => {
        const hole: Hole = {
          id: `${row}${column}`,
          boardId: this.id,
          kind: 'terminal',
          row,
          bankId: bank.id,
          column,
          groupId,
          local: { x: column - 1, y: bank.y + index },
        };
        this.register(hole);
        group.holeIds.push(hole.id);
      });
      this.groups.set(groupId, group);
    }
  }

  private buildRail(rail: RailDefinition): void {
    rail.segments.forEach((segment: RailSegmentDefinition, index) => {
      const groupId = `${this.id}/${rail.id}/${segment.id}`;
      const segmentSuffix = rail.segments.length > 1 ? ` segment ${index + 1}` : '';
      const group: ConnectivityGroup = {
        id: groupId,
        kind: 'rail',
        label: `${rail.label} rail (${railPositionLabel(rail)}${segmentSuffix})`,
        holeIds: [],
        boardId: this.id,
      };
      for (let column = segment.fromColumn; column <= segment.toColumn; column++) {
        if (!railHasHole(column)) continue;
        const hole: Hole = {
          id: `${rail.id}${column}`,
          boardId: this.id,
          kind: 'rail',
          railId: rail.id,
          segmentId: segment.id,
          column,
          groupId,
          local: { x: column - 1, y: rail.y },
        };
        this.register(hole);
        group.holeIds.push(hole.id);
      }
      this.groups.set(groupId, group);
    });
  }

  private register(hole: Hole): void {
    this.holesById.set(hole.id, hole);
    this.holesByLocalKey.set(localKey(hole.local.x, hole.local.y), hole);
  }

  /** Move the board. Hole geometry is relative, so only the origin changes. */
  moveTo(position: GridPoint): void {
    this.position = { x: Math.round(position.x), y: Math.round(position.y) };
  }

  getHole(holeId: string): Hole | undefined {
    return this.holesById.get(holeId);
  }

  /**
   * Resolve a workspace grid coordinate to a hole, if one sits *exactly* there.
   *
   * This is intentionally strict: the placement validator uses it to decide whether a
   * lead is in a hole, and "nearly in a hole" is not a thing on a real board. Cursor
   * snapping is a separate, deliberately forgiving operation - see `nearestHole`.
   */
  holeAtGrid(x: number, y: number): Hole | undefined {
    const localX = x - this.position.x;
    const localY = y - this.position.y;
    if (Math.abs(localX - Math.round(localX)) > 1e-6) return undefined;
    if (Math.abs(localY - Math.round(localY)) > 1e-6) return undefined;
    return this.holesByLocalKey.get(localKey(localX, localY));
  }

  /** Nearest hole within a snapping tolerance, for the cursor rather than for physics. */
  nearestHole(x: number, y: number, tolerance = 0.5): { hole: Hole; distance: number } | undefined {
    const localX = Math.round(x - this.position.x);
    const localY = Math.round(y - this.position.y);
    const hole = this.holesByLocalKey.get(localKey(localX, localY));
    if (!hole) return undefined;
    const world = this.worldPosition(hole);
    const distance = Math.hypot(world.x - x, world.y - y);
    return distance <= tolerance ? { hole, distance } : undefined;
  }

  worldPosition(hole: Hole): GridPoint {
    return { x: this.position.x + hole.local.x, y: this.position.y + hole.local.y };
  }

  allHoles(): Hole[] {
    return [...this.holesById.values()];
  }

  allGroups(): ConnectivityGroup[] {
    return [...this.groups.values()];
  }

  getGroup(groupId: string): ConnectivityGroup | undefined {
    return this.groups.get(groupId);
  }

  groupOfHole(holeId: string): ConnectivityGroup | undefined {
    const hole = this.holesById.get(holeId);
    return hole ? this.groups.get(hole.groupId) : undefined;
  }

  /** Board outline in world grid units. */
  bounds(): Rect {
    const b = this.definition.body;
    return {
      x: this.position.x + b.x,
      y: this.position.y + b.y,
      width: b.width,
      height: b.height,
    };
  }

  /**
   * Which bank a hole belongs to, and which trench (if any) separates it from a
   * second hole. Used by the placement validator to check DIP straddling without
   * hard-coding "the middle of the board".
   */
  trenchBetween(bankA: string | undefined, bankB: string | undefined): string | undefined {
    if (!bankA || !bankB) return undefined;
    for (const trench of this.definition.trenches) {
      const straddles =
        (trench.upperBankId === bankA && trench.lowerBankId === bankB) ||
        (trench.upperBankId === bankB && trench.lowerBankId === bankA);
      if (straddles) return trench.id;
    }
    return undefined;
  }

  get tiePointCount(): number {
    return this.holesById.size;
  }
}

function localKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

function railPositionLabel(rail: RailDefinition): string {
  if (rail.id.startsWith('T')) return 'top';
  if (rail.id.startsWith('M')) return 'middle';
  return 'bottom';
}
