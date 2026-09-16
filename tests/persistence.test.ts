import { describe, expect, it } from 'vitest';

import { SimulationEngine } from '../src/simulation/SimulationEngine';
import {
  loadProjectFromJson,
  projectToJson,
  serializeProject,
} from '../src/persistence/ProjectSerializer';
import { ProjectValidationError } from '../src/persistence/schema';
import { buildNandLab } from './helpers/lab';

function saveLab() {
  const lab = buildNandLab();
  lab.setInputs(true, true);
  const json = projectToJson(
    serializeProject(lab.circuit, { metadata: { name: '7400 NAND Experiment' } }),
  );
  return { lab, json };
}

describe('project files', () => {
  it('round-trips the whole experiment and keeps it working', () => {
    const { lab, json } = saveLab();
    expect(lab.outputValue()).toBe('L');

    const loaded = loadProjectFromJson(json);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.metadata.name).toBe('7400 NAND Experiment');

    // Same model.
    expect(loaded.circuit.components).toHaveLength(lab.circuit.components.length);
    expect(loaded.circuit.wires).toHaveLength(lab.circuit.wires.length);
    expect(loaded.circuit.boards).toHaveLength(1);
    expect(loaded.circuit.topologyKey()).toBe(lab.circuit.topologyKey());

    // Same behaviour.
    const engine = new SimulationEngine(loaded.circuit);
    const chip = loaded.circuit.components.find((c) => c.defId === 'ic-7400')!;
    expect(engine.runtime(chip.id).electrical).toBe('POWERED');
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('L');

    const in1 = loaded.circuit.components.find((c) => c.reference === 'IN1')!;
    in1.properties.level = 'L';
    engine.rebuild();
    expect(engine.netValueOfPin(chip.id, 3)?.value).toBe('H');
  });

  it('writes a readable, stable file', () => {
    const { json } = saveLab();
    expect(json.startsWith('{\n  "format": "protolab-project"')).toBe(true);
    const again = projectToJson(
      serializeProject(loadProjectFromJson(json).circuit, {
        metadata: { name: '7400 NAND Experiment' },
      }),
    );
    // The only field that legitimately differs between two saves is the timestamp.
    const strip = (text: string) => text.replace(/"modified": "[^"]*"/, '"modified": "-"');
    expect(strip(again)).toBe(strip(json));
  });

  it('preserves pin, hole and junction endpoints exactly', () => {
    const { json } = saveLab();
    const file = JSON.parse(json);
    const holeWire = file.wires.find((w: { to: { type: string } }) => w.to.type === 'hole');
    expect(holeWire.to).toEqual({ type: 'hole', board: 'BB1', hole: 'TP1' });
    const pinEnd = holeWire.from;
    expect(pinEnd.type).toBe('pin');
    expect(typeof pinEnd.pin).toBe('number');
  });

  it('rejects a file that is not a project', () => {
    expect(() => loadProjectFromJson('{"hello":"world"}')).toThrow(ProjectValidationError);
    expect(() => loadProjectFromJson('not json at all')).toThrow(ProjectValidationError);
  });

  it('refuses a project written by a newer build instead of guessing', () => {
    const { json } = saveLab();
    const future = JSON.parse(json);
    future.version = 99;
    expect(() => loadProjectFromJson(JSON.stringify(future))).toThrow(/newer version/);
  });

  it('names the part it cannot find rather than dropping it quietly', () => {
    const { json } = saveLab();
    const file = JSON.parse(json);
    file.components[0].definition = 'ic-99999';
    expect(() => loadProjectFromJson(JSON.stringify(file))).toThrow(/ic-99999/);
  });

  it('never carries structured data into a component property', () => {
    const { json } = saveLab();
    const file = JSON.parse(json);
    file.components[0].properties = { evil: { toString: 'nope' } };
    expect(() => loadProjectFromJson(JSON.stringify(file))).toThrow(/only text, numbers/);
  });

  it('drops a wire whose endpoint no longer exists, and says so', () => {
    const { json } = saveLab();
    const file = JSON.parse(json);
    file.wires.push({
      id: 'W99',
      from: { type: 'hole', board: 'BB1', hole: 'a1' },
      to: { type: 'hole', board: 'BB1', hole: 'zz99' },
      corners: [],
      color: 'blue',
    });
    const loaded = loadProjectFromJson(JSON.stringify(file));
    expect(loaded.warnings.join(' ')).toContain('W99');
    expect(loaded.circuit.getWire('W99')).toBeUndefined();
  });

  it('keeps allocating fresh ids after a load', () => {
    const { json } = saveLab();
    const loaded = loadProjectFromJson(json);
    const highest = Math.max(
      ...loaded.circuit.components.map((c) => Number(c.id.replace(/\D/g, ''))),
    );
    const fresh = loaded.circuit.createComponent('out-led', { x: 0, y: 0 });
    expect(Number(fresh.id.replace(/\D/g, ''))).toBeGreaterThan(highest);
    expect(loaded.circuit.components.some((c) => c.id === fresh.id)).toBe(false);
  });
});
