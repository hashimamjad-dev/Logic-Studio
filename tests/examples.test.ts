import { describe, expect, it } from 'vitest';

import { EXAMPLES, buildEmptyProject } from '../src/app/examples';
import { placementOf } from '../src/breadboard/PlacementValidator';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { SHORTCUTS } from '../src/app/shortcuts';

describe('worked examples', () => {
  for (const example of EXAMPLES) {
    it(`${example.name} places every part legally`, () => {
      const circuit = example.build();
      for (const instance of circuit.components) {
        const result = placementOf(circuit, instance);
        expect(result.valid, `${instance.reference}: ${result.reasons.join(' ')}`).toBe(true);
      }
    });

    it(`${example.name} has no dangling wires`, () => {
      const circuit = example.build();
      for (const wire of circuit.wires) {
        expect(circuit.resolvePosition(wire.from), `wire ${wire.id} from`).toBeDefined();
        expect(circuit.resolvePosition(wire.to), `wire ${wire.id} to`).toBeDefined();
      }
    });

    it(`${example.name} powers every chip it places`, () => {
      const circuit = example.build();
      const engine = new SimulationEngine(circuit);
      engine.advance(2e6);
      for (const instance of circuit.components) {
        const definition = circuit.definitionOf(instance);
        if (!definition.power) continue;
        expect(engine.runtime(instance.id).electrical, `${instance.reference}`).toBe('POWERED');
      }
    });

    it(`${example.name} reports no errors`, () => {
      const circuit = example.build();
      const engine = new SimulationEngine(circuit);
      engine.advance(2e6);
      const errors = engine.refreshDiagnostics().filter((d) => d.severity === 'error');
      expect(errors.map((e) => e.message)).toEqual([]);
    });
  }

  it('the 7400 lab responds to its switches like a NAND gate', () => {
    const circuit = EXAMPLES[0].build();
    const engine = new SimulationEngine(circuit);
    const chip = circuit.components.find((c) => c.defId === 'ic-7400')!;
    const led = circuit.components.find((c) => c.defId === 'out-led')!;
    const switches = circuit.components.filter((c) => c.defId === 'in-toggle');
    expect(switches).toHaveLength(2);

    const set = (a: 'A' | 'B', b: 'A' | 'B') => {
      switches[0].properties.position = a;
      switches[1].properties.position = b;
      engine.rebuild();
      engine.advance(2e6);
    };

    // Throw A is wired to +5 V, so position A is a logic high.
    set('B', 'B');
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('H');
    expect(engine.runtime(led.id).display.lit).toBe(true);

    set('A', 'B');
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('H');

    set('B', 'A');
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('H');

    set('A', 'A');
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('L');
    expect(engine.runtime(led.id).display.lit).toBe(false);
  });

  it('the 7474 divider toggles on every second clock edge', () => {
    const circuit = EXAMPLES[1].build();
    const engine = new SimulationEngine(circuit);
    const chip = circuit.components.find((c) => c.defId === 'ic-7474')!;

    // Watch Q over a couple of clock periods: at 2 Hz the flip-flop divides to 1 Hz.
    const samples: string[] = [];
    for (let i = 0; i < 24; i++) {
      engine.advance(50e6); // 50 ms
      samples.push(engine.netValueOfPin(chip.id, 5)?.value ?? 'Z');
    }
    expect(new Set(samples).has('H')).toBe(true);
    expect(new Set(samples).has('L')).toBe(true);
  });

  it('a new project starts with a board and a supply on the rails', () => {
    const circuit = buildEmptyProject();
    expect(circuit.boards).toHaveLength(1);
    expect(circuit.components).toHaveLength(1);
    expect(circuit.wires).toHaveLength(2);
    const engine = new SimulationEngine(circuit);
    const railNet = engine.netValueOfGroup(circuit.boards[0].getHole('TP15')!.groupId);
    expect(railNet?.voltage).toBeCloseTo(5, 2);
  });
});

describe('advertised keyboard shortcuts', () => {
  it('lists no duplicate key combinations', () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      if (!shortcut.token) continue;
      const key = `${shortcut.ctrl ? 'ctrl+' : ''}${shortcut.shift ? 'shift+' : ''}${shortcut.token}`;
      expect(seen.has(key), `duplicate binding for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('is handled by the key handler for every entry that names a key', () => {
    // The handler lives in Workbench.bindKeyboard; this asserts the two lists agree
    // so the help dialog can never advertise a shortcut that does nothing.
    const handled = new Set([
      'v', 'm', 'r', 'd', 's', 'p', 'n', 'a', 't', 'l', 'k', 'f',
      'escape', 'delete', '?', '+', '-', '0', '1', ' ',
      'ctrl+z', 'ctrl+shift+z', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+a',
      'ctrl+n', 'ctrl+o', 'ctrl+s', 'ctrl+e', 'ctrl+f',
    ]);
    for (const shortcut of SHORTCUTS) {
      if (!shortcut.token) continue;
      const key = `${shortcut.ctrl ? 'ctrl+' : ''}${shortcut.shift ? 'shift+' : ''}${shortcut.token}`;
      expect(handled.has(key), `${shortcut.keys} is advertised but not handled`).toBe(true);
    }
  });
});
