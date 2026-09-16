/**
 * Truth table generator.
 *
 * This does not analyse the circuit symbolically: it *runs* it. Every combination of
 * the input switches is applied to the real model, the engine settles, and the real
 * outputs are read back. The table is therefore a record of what the circuit on the
 * bench actually does, including the effect of a missing ground or a floating input.
 */

import type { Circuit } from '../core/Circuit';
import type { PropertyValue } from '../core/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';

export interface TableInput {
  componentId: string;
  label: string;
  /** Property that carries the level, and the two values it takes. */
  key: string;
  lowValue: PropertyValue;
  highValue: PropertyValue;
}

export interface TableOutput {
  id: string;
  label: string;
  read(engine: SimulationEngine): string;
}

export interface TruthTableResult {
  inputs: TableInput[];
  outputs: TableOutput[];
  rows: { inputs: number[]; outputs: string[] }[];
  /** Set when the circuit has more inputs than we are willing to sweep. */
  truncated: boolean;
  note?: string;
}

export const MAX_SWEEP_INPUTS = 8;

/** Anything the student can flip: logic sources and SPDT switches. */
export function collectInputs(circuit: Circuit): TableInput[] {
  const inputs: TableInput[] = [];
  for (const instance of circuit.components) {
    if (instance.defId === 'in-logic') {
      inputs.push({
        componentId: instance.id,
        label: instance.reference,
        key: 'level',
        lowValue: 'L',
        highValue: 'H',
      });
    } else if (instance.defId === 'in-toggle') {
      inputs.push({
        componentId: instance.id,
        label: instance.reference,
        key: 'position',
        lowValue: 'B',
        highValue: 'A',
      });
    } else if (instance.defId === 'in-button') {
      inputs.push({
        componentId: instance.id,
        label: instance.reference,
        key: 'pressed',
        lowValue: false,
        highValue: true,
      });
    }
  }
  return inputs;
}

/** Anything that shows a result: LEDs, lamps and logic probes. */
export function collectOutputs(circuit: Circuit, extraPins: { componentId: string; pin: number }[] = []): TableOutput[] {
  const outputs: TableOutput[] = [];
  for (const instance of circuit.components) {
    if (instance.defId === 'out-led' || instance.defId === 'out-lamp') {
      outputs.push({
        id: instance.id,
        label: instance.reference,
        read: (engine) => (engine.runtime(instance.id).display.lit === true ? 'ON' : 'off'),
      });
    } else if (instance.defId === 'inst-probe') {
      outputs.push({
        id: instance.id,
        label: instance.reference,
        read: (engine) => String(engine.runtime(instance.id).display.reading ?? 'Z'),
      });
    }
  }
  for (const pin of extraPins) {
    const instance = circuit.getComponent(pin.componentId);
    if (!instance) continue;
    outputs.push({
      id: `${pin.componentId}#${pin.pin}`,
      label: `${instance.reference}.${pin.pin}`,
      read: (engine) => engine.netValueOfPin(pin.componentId, pin.pin)?.value ?? 'Z',
    });
  }
  return outputs;
}

/**
 * Sweep the inputs and record the outputs.
 *
 * The circuit is restored to exactly the state it started in, so generating a table
 * never disturbs what the student was doing.
 */
export function generateTruthTable(
  circuit: Circuit,
  engine: SimulationEngine,
  inputs: TableInput[],
  outputs: TableOutput[],
): TruthTableResult {
  const truncated = inputs.length > MAX_SWEEP_INPUTS;
  const sweptInputs = inputs.slice(0, MAX_SWEEP_INPUTS);
  const rows: TruthTableResult['rows'] = [];

  if (sweptInputs.length === 0 || outputs.length === 0) {
    return {
      inputs: sweptInputs,
      outputs,
      rows,
      truncated,
      note:
        outputs.length === 0
          ? 'Add an LED or a logic probe so there is something to record.'
          : 'Add a toggle switch, push button or logic source so there is something to sweep.',
    };
  }

  const saved = sweptInputs.map((input) => ({
    input,
    value: circuit.getComponent(input.componentId)?.properties[input.key],
  }));

  const combinations = 1 << sweptInputs.length;
  for (let mask = 0; mask < combinations; mask++) {
    const bits: number[] = [];
    sweptInputs.forEach((input, index) => {
      // Count with the first input as the most significant bit, which is how a
      // textbook truth table is laid out.
      const bit = (mask >> (sweptInputs.length - 1 - index)) & 1;
      bits.push(bit);
      const instance = circuit.getComponent(input.componentId);
      if (instance) instance.properties[input.key] = bit ? input.highValue : input.lowValue;
    });
    engine.rebuild();
    engine.advance(2e6);
    rows.push({ inputs: bits, outputs: outputs.map((output) => output.read(engine)) });
  }

  for (const entry of saved) {
    const instance = circuit.getComponent(entry.input.componentId);
    if (instance && entry.value !== undefined) instance.properties[entry.input.key] = entry.value;
  }
  engine.rebuild();
  engine.advance(2e6);

  return {
    inputs: sweptInputs,
    outputs,
    rows,
    truncated,
    ...(truncated
      ? { note: `Only the first ${MAX_SWEEP_INPUTS} inputs are swept; ${inputs.length} were found.` }
      : {}),
  };
}

/** Render the table as text, for copying into a lab report. */
export function truthTableToText(result: TruthTableResult): string {
  const header = [...result.inputs.map((i) => i.label), ...result.outputs.map((o) => o.label)];
  const widths = header.map((h) => h.length);
  const body = result.rows.map((row) => [...row.inputs.map(String), ...row.outputs]);
  for (const row of body) row.forEach((cell, index) => (widths[index] = Math.max(widths[index], cell.length)));
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}
