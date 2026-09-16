import { describe, expect, it } from 'vitest';

import { validatePlacement } from '../src/breadboard/PlacementValidator';
import { componentRegistry } from '../src/components/ComponentRegistry';
import { Circuit } from '../src/core/Circuit';
import { holePosition, place, plugInto } from './helpers/lab';

function newBoard() {
  const circuit = new Circuit();
  const board = circuit.addBoard('bb-half', { x: 0, y: 0 });
  return { circuit, board };
}

function check(
  circuit: Circuit,
  defId: string,
  position: { x: number; y: number },
  rotation: 0 | 90 | 180 | 270 = 0,
  properties: Record<string, never> | Record<string, string | number | boolean> = {},
) {
  const definition = componentRegistry.require(defId);
  return validatePlacement(circuit, {
    definition,
    position,
    rotation,
    properties: { ...Object.fromEntries((definition.properties ?? []).map((p) => [p.key, p.default])), ...properties },
  });
}

describe('DIP placement', () => {
  it('accepts a 7400 whose pin 1 sits in row f, straddling the trench', () => {
    const { circuit, board } = newBoard();
    const result = check(circuit, 'ic-7400', holePosition(board, 'f10'));
    expect(result.valid).toBe(true);
    expect(result.pins).toHaveLength(14);
    expect(result.pins[0].holeId).toBe('BB1:f10');
    expect(result.pins[13].holeId).toBe('BB1:e10'); // pin 14 lands opposite pin 1
    expect(result.pins[6].holeId).toBe('BB1:f16'); // pin 7, GND
    expect(result.pins[7].holeId).toBe('BB1:e16'); // pin 8
  });

  it('refuses a 7400 with both pin rows on the same side of the trench', () => {
    const { circuit, board } = newBoard();
    // Pin 1 in row b puts pins 8-14 in row... nothing: three rows up is off the bank.
    const result = check(circuit, 'ic-7400', holePosition(board, 'd10'));
    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not over a breadboard hole|straddle the centre trench/);
  });

  it('refuses a 7400 shifted off the hole grid', () => {
    const { circuit, board } = newBoard();
    const base = holePosition(board, 'f10');
    const result = check(circuit, 'ic-7400', { x: base.x + 0.5, y: base.y });
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toContain('not over a breadboard');
  });

  it('refuses a 7400 that hangs off the end of the board', () => {
    const { circuit, board } = newBoard();
    const result = check(circuit, 'ic-7400', holePosition(board, 'f28'));
    expect(result.valid).toBe(false);
  });

  it('refuses a 90 degree rotation, because both rows would short together', () => {
    const { circuit, board } = newBoard();
    const result = check(circuit, 'ic-7400', holePosition(board, 'f10'), 90);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toContain('short');
  });

  it('accepts a 180 degree rotation, which is just the chip turned round', () => {
    const { circuit, board } = newBoard();
    const anchor = holePosition(board, 'e16');
    const result = check(circuit, 'ic-7400', anchor, 180);
    expect(result.valid).toBe(true);
  });

  it('refuses a second chip in holes the first one already occupies', () => {
    const { circuit, board } = newBoard();
    plugInto(circuit, board, 'ic-7400', 1, 'f10');
    const result = check(circuit, 'ic-7402', holePosition(board, 'f12'));
    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/already taken by U1|overlaps U1/);
  });

  it('places two chips side by side when they do not share holes', () => {
    const { circuit, board } = newBoard();
    plugInto(circuit, board, 'ic-7400', 1, 'f2');
    const result = check(circuit, 'ic-7486', holePosition(board, 'f12'));
    expect(result.valid).toBe(true);
  });
});

describe('other footprints', () => {
  it('requires a push button to straddle the trench like a DIP', () => {
    const { circuit, board } = newBoard();
    expect(check(circuit, 'in-button', holePosition(board, 'f5')).valid).toBe(true);
    expect(check(circuit, 'in-button', holePosition(board, 'b5')).valid).toBe(false);
  });

  it('refuses an axial part with both leads in the same column group', () => {
    const { circuit, board } = newBoard();
    const result = check(circuit, 'pas-resistor', holePosition(board, 'a5'), 90, { span: 4 });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/shorted together|not over a breadboard hole/);
  });

  it('accepts a resistor whose leads span four columns', () => {
    const { circuit, board } = newBoard();
    expect(check(circuit, 'pas-resistor', holePosition(board, 'a5'), 0, { span: 4 }).valid).toBe(true);
  });

  it('keeps bench modules off the board', () => {
    const { circuit, board } = newBoard();
    const onBoard = check(circuit, 'pwr-supply', holePosition(board, 'a5'));
    expect(onBoard.valid).toBe(false);
    expect(onBoard.reasons[0]).toContain('beside the breadboard');
    expect(check(circuit, 'pwr-supply', { x: -30, y: 4 }).valid).toBe(true);
  });

  it('refuses a through-hole part placed on bare canvas', () => {
    const circuit = new Circuit();
    circuit.addBoard('bb-half', { x: 0, y: 0 });
    const result = check(circuit, 'out-led', { x: -40, y: -40 });
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toContain('not over a breadboard');
  });

  it('lets an LED lean over a resistor, because leads bend', () => {
    const { circuit, board } = newBoard();
    place(circuit, 'out-led', holePosition(board, 'h12'), { properties: { span: 3 } });
    expect(check(circuit, 'pas-resistor', holePosition(board, 'i15'), 0, { span: 4 }).valid).toBe(true);
  });
});
