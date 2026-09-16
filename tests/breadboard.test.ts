import { describe, expect, it } from 'vitest';

import { Breadboard } from '../src/breadboard/Breadboard';
import {
  BREADBOARD_DEFINITIONS,
  getBreadboardDefinition,
} from '../src/breadboard/BreadboardDefinition';

function board(id: string): Breadboard {
  const definition = getBreadboardDefinition(id);
  if (!definition) throw new Error(`no board ${id}`);
  return new Breadboard('BB1', definition, { x: 0, y: 0 });
}

describe('breadboard connectivity', () => {
  it('connects the five holes of one column in one bank', () => {
    const bb = board('bb-half');
    const groups = new Set(['a10', 'b10', 'c10', 'd10', 'e10'].map((h) => bb.getHole(h)!.groupId));
    expect(groups.size).toBe(1);
    expect(bb.groupOfHole('c10')!.holeIds).toEqual(['a10', 'b10', 'c10', 'd10', 'e10']);
  });

  it('keeps the two sides of the centre trench apart', () => {
    const bb = board('bb-half');
    expect(bb.getHole('a10')!.groupId).not.toBe(bb.getHole('f10')!.groupId);
    expect(bb.getHole('e10')!.groupId).not.toBe(bb.getHole('f10')!.groupId);
  });

  it('keeps adjacent columns apart', () => {
    const bb = board('bb-half');
    expect(bb.getHole('a10')!.groupId).not.toBe(bb.getHole('a11')!.groupId);
  });

  it('puts row e and row f exactly 0.3 inch apart so a narrow DIP straddles the trench', () => {
    const bb = board('bb-half');
    const e = bb.worldPosition(bb.getHole('e10')!);
    const f = bb.worldPosition(bb.getHole('f10')!);
    expect(f.y - e.y).toBe(3);
    expect(f.x).toBe(e.x);
  });

  it('gives each rail its own group, separate from the terminal strips', () => {
    const bb = board('bb-half');
    const railGroup = bb.getHole('TP1')!.groupId;
    expect(railGroup).not.toBe(bb.getHole('a1')!.groupId);
    expect(bb.getHole('TP1')!.groupId).not.toBe(bb.getHole('TN1')!.groupId);
  });

  it('runs a continuous rail the length of a half board', () => {
    const bb = board('bb-half');
    expect(bb.getHole('TP1')!.groupId).toBe(bb.getHole('TP29')!.groupId);
  });

  it('splits the rails of a full board so the far half needs a jumper', () => {
    const bb = board('bb-full');
    expect(bb.getHole('TP1')!.groupId).not.toBe(bb.getHole('TP62')!.groupId);
    expect(bb.getHole('TP1')!.groupId).toBe(bb.getHole('TP29')!.groupId);
  });

  it('leaves a gap in the rail every sixth column, like the real thing', () => {
    const bb = board('bb-half');
    expect(bb.getHole('TP6')).toBeUndefined();
    expect(bb.getHole('TP5')).toBeDefined();
  });

  it('has no rails at all on the mini board', () => {
    const bb = board('bb-mini');
    expect(bb.definition.rails).toHaveLength(0);
    expect(bb.getHole('TP1')).toBeUndefined();
  });

  it('gives the double board two independent bank pairs', () => {
    const bb = board('bb-double');
    expect(bb.getHole('a10')!.groupId).not.toBe(bb.getHole('k10')!.groupId);
    expect(bb.getHole('f10')!.groupId).not.toBe(bb.getHole('p10')!.groupId);
    expect(bb.getHole('k10')!.groupId).toBe(bb.getHole('o10')!.groupId);
  });

  it('resolves a grid coordinate back to the hole that sits there', () => {
    const bb = new Breadboard('BB2', getBreadboardDefinition('bb-half')!, { x: 7, y: -3 });
    const hole = bb.getHole('c12')!;
    const world = bb.worldPosition(hole);
    expect(bb.holeAtGrid(world.x, world.y)).toBe(hole);
    expect(bb.holeAtGrid(world.x + 0.5, world.y)).toBeUndefined();
  });

  it('counts the advertised number of tie points', () => {
    expect(board('bb-half').tiePointCount).toBe(30 * 10 + 4 * 25);
    expect(board('bb-mini').tiePointCount).toBe(17 * 10);
  });

  it('never lets a hole belong to two groups', () => {
    for (const definition of BREADBOARD_DEFINITIONS) {
      const bb = new Breadboard('X', definition, { x: 0, y: 0 });
      const seen = new Set<string>();
      for (const group of bb.allGroups()) {
        for (const holeId of group.holeIds) {
          expect(seen.has(holeId)).toBe(false);
          seen.add(holeId);
        }
      }
      expect(seen.size).toBe(bb.tiePointCount);
    }
  });
});
