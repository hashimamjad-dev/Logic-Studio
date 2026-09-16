/**
 * Builder for 74-series DIP parts.
 *
 * Every 74xx definition in ProtoLab is written as a datasheet pin table plus either a
 * gate list or the name of a device model. Nothing about a specific part number is
 * hard-coded anywhere else in the engine, so adding a part is adding data.
 */

import type { PinType } from '../../core/types';
import {
  ComponentDefinition,
  DatasheetInfo,
  GateSpec,
  PinDefinition,
  dipFootprint,
  dipPinOffsets,
} from '../ComponentDefinition';

/** Pin table entry: [name, type, direction, options]. Index 0 is pin 1. */
export type PinSpec = [
  name: string,
  type: PinType,
  direction: 'in' | 'out' | 'inout' | 'passive' | 'power',
  options?: { activeLow?: boolean; note?: string },
];

export interface TtlOptions {
  partNumber: string;
  name: string;
  description: string;
  keywords: string[];
  pinCount: number;
  /** 0.3 in for narrow packages, 0.6 in for wide ones. */
  rowSpacing?: number;
  pins: PinSpec[];
  gates?: GateSpec[];
  model?: string;
  propagationDelayNs: number;
  maxClockMHz?: number;
  datasheet: DatasheetInfo;
}

export function ttl(options: TtlOptions): ComponentDefinition {
  const rowSpacing = options.rowSpacing ?? 3;
  const offsets = dipPinOffsets(options.pinCount, rowSpacing);
  if (options.pins.length !== options.pinCount) {
    throw new Error(
      `${options.partNumber}: pin table has ${options.pins.length} entries but the package has ${options.pinCount} pins`,
    );
  }

  const pins: PinDefinition[] = options.pins.map((spec, index) => {
    const [name, type, direction, extra] = spec;
    const pin: PinDefinition = {
      number: index + 1,
      name,
      type,
      direction,
      offset: offsets[index],
    };
    if (name === 'VCC') pin.electricalRole = 'VCC';
    else if (name === 'GND') pin.electricalRole = 'GND';
    else pin.electricalRole = 'SIGNAL';
    if (extra?.activeLow) pin.activeLow = true;
    if (extra?.note) pin.note = extra.note;
    return pin;
  });

  const vccPins = pins.filter((p) => p.electricalRole === 'VCC').map((p) => p.number);
  const gndPins = pins.filter((p) => p.electricalRole === 'GND').map((p) => p.number);
  if (vccPins.length === 0 || gndPins.length === 0) {
    throw new Error(`${options.partNumber}: a TTL part must declare both VCC and GND pins`);
  }

  const definition: ComponentDefinition = {
    id: `ic-${options.partNumber.toLowerCase()}`,
    name: `${options.partNumber} ${options.name}`,
    partNumber: options.partNumber,
    category: 'ttl74xx',
    description: options.description,
    keywords: [options.partNumber, `74${options.partNumber.slice(2)}`, ...options.keywords],
    footprint: dipFootprint(options.pinCount, rowSpacing),
    pins,
    power: {
      vccPins,
      gndPins,
      nominalVoltage: 5,
      minVoltage: 4.75,
      maxVoltage: 5.25,
      absoluteMaxVoltage: 7,
      family: '74LS TTL',
    },
    timing: {
      propagationDelayNs: options.propagationDelayNs,
      ...(options.maxClockMHz !== undefined ? { maxClockMHz: options.maxClockMHz } : {}),
    },
    datasheet: options.datasheet,
    visual: { style: 'dip', bodyLabel: options.partNumber },
    refPrefix: 'U',
  };
  if (options.gates) definition.gates = options.gates;
  if (options.model) definition.model = options.model;
  return definition;
}

/** Shorthand for a gate in a quad/triple/hex package. */
export function gate(
  label: string,
  op: GateSpec['op'],
  inputs: number[],
  output: number,
): GateSpec {
  return { label, op, inputs, output };
}
