/**
 * The simulation engine.
 *
 * Event driven, in nanoseconds of simulated time. A tick of the animation loop hands
 * the engine a slice of real time; the engine replays every event that falls inside
 * that slice, in order, re-resolving the affected nets after each timestamp.
 *
 * The pipeline for one timestamp is always the same:
 *
 *   apply scheduled drives  ->  resolve net values  ->  work out which parts saw a
 *   change  ->  evaluate those parts  ->  schedule their outputs one propagation
 *   delay into the future.
 *
 * Power is resolved from the same net values as everything else: a part is powered
 * because its VCC pin sits on a net a supply is holding up, never because a supply
 * exists somewhere on the canvas.
 */

import type { Circuit, ComponentInstance } from '../core/Circuit';
import type { ComponentDefinition, GateSpec } from '../components/ComponentDefinition';
import { pinsOf } from '../components/ComponentDefinition';
import {
  Diagnostic,
  Drive,
  DriveStrength,
  ElectricalState,
  LogicValue,
} from '../core/types';
import { NetList, Net, resolveNets } from './NetResolver';
import {
  DeviceContext,
  DeviceLink,
  DriveOptions,
  getModel,
} from './deviceModels';

export interface ResolvedNet {
  netId: string;
  value: LogicValue;
  strength: DriveStrength;
  /** Undefined when nothing is holding the net at any particular voltage. */
  voltage?: number;
  /** True when a supply is holding this net as the 0 V reference. */
  isReference: boolean;
  /** Set when two things fight over the net. */
  conflict?: string;
  driverCount: number;
}

export interface ComponentRuntime {
  state: Record<string, unknown>;
  display: Record<string, unknown>;
  electrical: ElectricalState;
  supplyVoltage: number;
  powered: boolean;
  /** Simulated nanoseconds spent in a destructive condition. */
  stressNs: number;
  damaged: boolean;
}

interface ScheduledDrive {
  time: number;
  componentId: string;
  pin: number;
  drive: Drive;
}

interface ScheduledEval {
  time: number;
  componentId: string;
}

/** How long a part survives an out-of-spec condition before it is destroyed. */
const DAMAGE_THRESHOLD_NS = 400e6; // 0.4 s of simulated time
const MAX_EVENT_STEPS = 20000;
const DEFAULT_LOGIC_VOLTAGE = 5;

export class SimulationEngine {
  private circuit: Circuit;

  now = 0;
  running = false;
  oscillating = false;

  private netList: NetList;
  private netValues = new Map<string, ResolvedNet>();
  private runtimes = new Map<string, ComponentRuntime>();
  private applied = new Map<string, Map<number, Drive>>();
  private driveQueue: ScheduledDrive[] = [];
  private evalQueue: ScheduledEval[] = [];
  private diagnostics: Diagnostic[] = [];
  private frameWarnings = new Map<string, Diagnostic>();
  private topologyKey = '';

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    this.netList = new NetList([], new Map());
    this.rebuild();
  }

  /* ---------------------------------------------------------------- *
   * Topology
   * ---------------------------------------------------------------- */

  /** Recompute the net list. Called whenever the circuit structure changes. */
  rebuild(): void {
    const links = new Map<string, DeviceLink[]>();
    for (const instance of this.circuit.components) {
      const def = this.circuit.definitionOf(instance);
      const model = getModel(def.model);
      if (!model?.links) continue;
      const runtime = this.runtimeOf(instance.id);
      links.set(instance.id, model.links({ properties: instance.properties, state: runtime.state }));
    }
    this.netList = resolveNets(this.circuit, { links });
    this.topologyKey = this.circuit.topologyKey();

    // Drop drives that belong to parts that no longer exist.
    const live = new Set(this.circuit.components.map((c) => c.id));
    for (const id of [...this.applied.keys()]) if (!live.has(id)) this.applied.delete(id);
    for (const id of [...this.runtimes.keys()]) if (!live.has(id)) this.runtimes.delete(id);
    this.driveQueue = this.driveQueue.filter((e) => live.has(e.componentId));
    this.evalQueue = this.evalQueue.filter((e) => live.has(e.componentId));

    this.initialSettle();
  }

  /**
   * Bring a freshly built circuit to rest at the current time.
   *
   * Startup is deliberately instantaneous: every part is evaluated with zero delay
   * and the nets are re-resolved until nothing moves, so the board is already in a
   * consistent state before the first frame is drawn. After that the normal
   * event-driven path with real propagation delays takes over.
   */
  private initialSettle(): void {
    for (let pass = 0; pass < 16; pass++) {
      const before = this.netValues;
      for (const instance of this.circuit.components) this.evaluate(instance, true);
      this.resolveValues();
      if (sameValues(before, this.netValues)) break;
    }
    this.settle();
  }

  /** Cheap check used by the app loop: has anything structural changed? */
  syncTopology(): void {
    if (this.circuit.topologyKey() !== this.topologyKey) this.rebuild();
  }

  /** Full reset: time back to zero, all internal state cleared. */
  reset(): void {
    this.now = 0;
    this.oscillating = false;
    this.applied.clear();
    this.runtimes.clear();
    this.driveQueue = [];
    this.evalQueue = [];
    this.netValues.clear();
    this.diagnostics = [];
    this.rebuild();
  }

  /* ---------------------------------------------------------------- *
   * Time
   * ---------------------------------------------------------------- */

  /** Advance simulated time by `dtNs`, replaying every event inside the slice. */
  advance(dtNs: number): void {
    const target = this.now + Math.max(0, dtNs);
    let steps = 0;
    for (;;) {
      const next = this.nextEventTime();
      if (next === undefined || next > target) break;
      this.now = next;
      this.processTimestamp(next);
      if (++steps > MAX_EVENT_STEPS) {
        this.oscillating = true;
        this.addDiagnostic({
          id: 'sim.oscillating',
          severity: 'error',
          code: 'sim.oscillating',
          message:
            'The circuit is oscillating faster than it can be simulated. Look for an inverting loop with no clock, or an output wired back to its own input.',
          subjects: [],
        });
        this.driveQueue = [];
        this.evalQueue = [];
        break;
      }
    }
    this.now = target;
    this.applyStress(dtNs);
  }

  /**
   * Run forward until nothing is left to do inside a short horizon.
   *
   * The horizon matters: a clock generator always has an edge scheduled, so without
   * one this would chase a 1 Hz square wave forever. A hundred microseconds is far
   * more than any chain of gate delays needs and far less than any clock period a
   * student will use.
   */
  settle(horizonNs = 1e5): void {
    const limit = this.now + horizonNs;
    let steps = 0;
    for (;;) {
      const next = this.nextEventTime();
      if (next === undefined || next > limit) break;
      this.now = next;
      this.processTimestamp(next);
      if (++steps > MAX_EVENT_STEPS) {
        this.oscillating = true;
        break;
      }
    }
  }

  /** One clean step: settle, then advance a small slice. */
  step(stepNs = 1e6): void {
    this.advance(stepNs);
  }

  private nextEventTime(): number | undefined {
    let best: number | undefined;
    for (const event of this.driveQueue) if (best === undefined || event.time < best) best = event.time;
    for (const event of this.evalQueue) if (best === undefined || event.time < best) best = event.time;
    return best;
  }

  private processTimestamp(time: number): void {
    const dirty = new Set<string>();

    const dueDrives = this.driveQueue.filter((e) => e.time <= time);
    this.driveQueue = this.driveQueue.filter((e) => e.time > time);
    for (const event of dueDrives) {
      const map = this.applied.get(event.componentId) ?? new Map<number, Drive>();
      map.set(event.pin, event.drive);
      this.applied.set(event.componentId, map);
    }

    const dueEvals = this.evalQueue.filter((e) => e.time <= time);
    this.evalQueue = this.evalQueue.filter((e) => e.time > time);
    for (const event of dueEvals) dirty.add(event.componentId);

    // Parts with no propagation delay of their own (indicators, supplies, switches)
    // settle inside this timestamp, so keep going until the nets stop moving.
    for (let pass = 0; pass < 16; pass++) {
      const changedNets = this.resolveValues();
      for (const netId of changedNets) {
        const net = this.netList.get(netId);
        if (!net) continue;
        for (const pin of net.pins) dirty.add(pin.componentId);
      }
      if (dirty.size === 0) break;
      const todo = [...dirty];
      dirty.clear();
      for (const componentId of todo) {
        const instance = this.circuit.getComponent(componentId);
        if (instance) this.evaluate(instance, false);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Net value resolution
   * ---------------------------------------------------------------- */

  /** Recompute every net value. Returns the ids of the nets that changed. */
  private resolveValues(): string[] {
    let current = this.netValues;
    let next = current;
    // Resistors couple two nets weakly, so a couple of relaxation passes are needed
    // before pull-ups and pull-downs settle. Four is plenty for any practical board.
    for (let pass = 0; pass < 4; pass++) {
      next = this.resolvePass(current);
      if (sameValues(current, next)) break;
      current = next;
    }
    const changed: string[] = [];
    for (const [netId, value] of next) {
      const before = this.netValues.get(netId);
      if (!before || !sameNet(before, value)) changed.push(netId);
    }
    this.netValues = next;
    return changed;
  }

  private resolvePass(previous: Map<string, ResolvedNet>): Map<string, ResolvedNet> {
    const result = new Map<string, ResolvedNet>();
    for (const net of this.netList.nets) {
      const drives: Drive[] = [];
      for (const pinRef of net.pins) {
        const drive = this.applied.get(pinRef.componentId)?.get(pinRef.pin);
        if (drive && drive.strength !== 'none') drives.push(drive);
      }
      for (const link of net.resistiveLinks) {
        const otherNetId = this.netList.netIdOfPin(link.componentId, link.there);
        const other = otherNetId ? previous.get(otherNetId) : undefined;
        if (!other || other.value === 'Z' || other.value === 'X') continue;
        drives.push({
          value: other.value,
          strength: 'weak',
          ...(other.voltage !== undefined ? { voltage: other.voltage } : {}),
          source: `${link.componentId}#${link.there}`,
        });
      }
      result.set(net.id, resolveDrives(net, drives));
    }
    return result;
  }

  /* ---------------------------------------------------------------- *
   * Component evaluation
   * ---------------------------------------------------------------- */

  private runtimeOf(componentId: string): ComponentRuntime {
    let runtime = this.runtimes.get(componentId);
    if (!runtime) {
      runtime = {
        state: {},
        display: {},
        electrical: 'UNPOWERED',
        supplyVoltage: DEFAULT_LOGIC_VOLTAGE,
        powered: false,
        stressNs: 0,
        damaged: false,
      };
      this.runtimes.set(componentId, runtime);
    }
    return runtime;
  }

  private evaluate(instance: ComponentInstance, immediate: boolean): void {
    const def = this.circuit.definitionOf(instance);
    const runtime = this.runtimeOf(instance.id);
    this.updatePowerState(instance, def, runtime);

    const desired = new Map<number, Drive>();
    const ctx = this.makeContext(instance, runtime, desired);

    if (runtime.damaged) {
      // A destroyed part stops driving anything at all.
      for (const pin of pinsOf(def, instance.properties)) {
        if (pin.direction === 'out' || pin.direction === 'inout') {
          desired.set(pin.number, { value: 'Z', strength: 'none', source: instance.id });
        }
      }
    } else if (def.gates) {
      evaluateGates(def.gates, ctx, runtime.powered);
    } else {
      const model = getModel(def.model);
      model?.evaluate(ctx);
    }

    const delay = immediate ? 0 : def.timing?.propagationDelayNs ?? 0;
    const appliedMap = this.applied.get(instance.id) ?? new Map<number, Drive>();
    for (const [pin, drive] of desired) {
      const current = appliedMap.get(pin);
      if (current && sameDrive(current, drive)) continue;
      if (delay <= 0) {
        appliedMap.set(pin, drive);
      } else {
        // Inertial delay: a newer decision replaces a pending one for the same pin.
        this.driveQueue = this.driveQueue.filter(
          (e) => !(e.componentId === instance.id && e.pin === pin),
        );
        this.driveQueue.push({ time: this.now + delay, componentId: instance.id, pin, drive });
      }
    }
    if (desired.size > 0) this.applied.set(instance.id, appliedMap);
  }

  private makeContext(
    instance: ComponentInstance,
    runtime: ComponentRuntime,
    desired: Map<number, Drive>,
  ): DeviceContext {
    const netFor = (pin: number): ResolvedNet | undefined => {
      const netId = this.netList.netIdOfPin(instance.id, pin);
      return netId ? this.netValues.get(netId) : undefined;
    };
    return {
      componentId: instance.id,
      reference: instance.reference,
      properties: instance.properties,
      state: runtime.state,
      display: runtime.display,
      powered: runtime.powered,
      supplyVoltage: runtime.supplyVoltage,
      now: this.now,
      value: (pin) => netFor(pin)?.value ?? 'Z',
      voltage: (pin) => netFor(pin)?.voltage,
      strength: (pin) => netFor(pin)?.strength ?? 'none',
      isGroundReference: (pin) => netFor(pin)?.isReference ?? false,
      drive: (pin, value, options?: DriveOptions) => {
        desired.set(pin, {
          value,
          strength: options?.strength ?? 'strong',
          ...(options?.voltage !== undefined ? { voltage: options.voltage } : {}),
          ...(options?.reference ? { reference: true } : {}),
          source: `${instance.id}#${pin}`,
        } as Drive);
      },
      scheduleAt: (timeNs) => {
        const time = Math.max(timeNs, this.now + 1);
        if (!this.evalQueue.some((e) => e.componentId === instance.id && e.time === time)) {
          this.evalQueue.push({ time, componentId: instance.id });
        }
      },
      warn: (code, message) => {
        this.addDiagnostic({
          id: `${instance.id}:${code}`,
          severity: 'warning',
          code,
          message,
          subjects: [instance.id],
        });
      },
    };
  }

  /* ---------------------------------------------------------------- *
   * Power
   * ---------------------------------------------------------------- */

  private updatePowerState(
    instance: ComponentInstance,
    def: ComponentDefinition,
    runtime: ComponentRuntime,
  ): void {
    if (runtime.damaged) {
      runtime.electrical = 'DAMAGED';
      runtime.powered = false;
      return;
    }
    const spec = def.power;
    if (!spec) {
      runtime.electrical = 'POWERED';
      runtime.powered = true;
      runtime.supplyVoltage = DEFAULT_LOGIC_VOLTAGE;
      return;
    }

    const vccNet = this.netValueOfPin(instance.id, spec.vccPins[0]);
    const gndNet = this.netValueOfPin(instance.id, spec.gndPins[0]);
    const vcc = vccNet?.voltage;
    const gnd = gndNet?.voltage;
    const groundReferenced = gndNet?.isReference === true || gnd === 0;

    if (vcc !== undefined && gnd !== undefined && gnd - vcc > 1) {
      runtime.electrical = 'REVERSE_POLARITY';
      runtime.powered = false;
      runtime.supplyVoltage = 0;
      return;
    }
    if (vcc === undefined) {
      runtime.electrical = 'UNPOWERED';
      runtime.powered = false;
      runtime.supplyVoltage = 0;
      return;
    }
    if (!groundReferenced) {
      runtime.electrical = 'NO_GROUND';
      runtime.powered = false;
      runtime.supplyVoltage = 0;
      return;
    }

    const across = vcc - (gnd ?? 0);
    runtime.supplyVoltage = across;
    if (across > spec.absoluteMaxVoltage) {
      runtime.electrical = 'OVERVOLTAGE';
      runtime.powered = true;
      return;
    }
    if (across > spec.maxVoltage) {
      runtime.electrical = 'OVERVOLTAGE';
      runtime.powered = true;
      return;
    }
    if (across < spec.minVoltage) {
      runtime.electrical = across < spec.minVoltage * 0.5 ? 'UNPOWERED' : 'UNDERVOLTAGE';
      runtime.powered = false;
      return;
    }
    runtime.electrical = 'POWERED';
    runtime.powered = true;
  }

  /**
   * Parts do not die instantly. Time spent over the absolute maximum, or with the
   * supply backwards, accumulates until the part is destroyed - which gives the
   * student a chance to notice the warning and fix the wiring first.
   */
  private applyStress(dtNs: number): void {
    for (const instance of this.circuit.components) {
      const def = this.circuit.definitionOf(instance);
      const spec = def.power;
      const runtime = this.runtimeOf(instance.id);
      if (runtime.damaged || !spec) continue;

      const destructive =
        runtime.electrical === 'REVERSE_POLARITY' ||
        (runtime.electrical === 'OVERVOLTAGE' && runtime.supplyVoltage > spec.absoluteMaxVoltage);

      if (!destructive) {
        runtime.stressNs = Math.max(0, runtime.stressNs - dtNs * 0.5);
        continue;
      }
      const cause = runtime.electrical;
      runtime.stressNs += dtNs;
      if (runtime.stressNs > DAMAGE_THRESHOLD_NS) {
        runtime.damaged = true;
        runtime.electrical = 'DAMAGED';
        runtime.powered = false;
        this.addDiagnostic({
          id: `${instance.id}:damaged`,
          severity: 'error',
          code: 'part.damaged',
          message:
            cause === 'REVERSE_POLARITY'
              ? `${instance.reference} has been destroyed by reversed supply polarity. Delete and replace it, then check which pin is VCC.`
              : `${instance.reference} has been destroyed: the supply stayed above its absolute maximum of ${spec.absoluteMaxVoltage} V. Delete and replace it.`,
          subjects: [instance.id],
        });
      } else {
        runtime.electrical = 'OVERHEATING';
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Diagnostics
   * ---------------------------------------------------------------- */

  private addDiagnostic(diagnostic: Diagnostic): void {
    this.frameWarnings.set(diagnostic.id, diagnostic);
  }

  /** Recompute the diagnostics list. Called once per frame by the app. */
  refreshDiagnostics(): Diagnostic[] {
    const list: Diagnostic[] = [];

    for (const instance of this.circuit.components) {
      const def = this.circuit.definitionOf(instance);
      const runtime = this.runtimeOf(instance.id);
      const spec = def.power;
      if (spec) {
        const vccPin = spec.vccPins[0];
        const gndPin = spec.gndPins[0];
        switch (runtime.electrical) {
          case 'UNPOWERED':
            list.push({
              id: `${instance.id}:unpowered`,
              severity: 'error',
              code: 'ic.unpowered',
              message: `${instance.reference} (${def.partNumber ?? def.name}) is unpowered. Connect pin ${vccPin} to +5 V and pin ${gndPin} to ground.`,
              subjects: [instance.id],
            });
            break;
          case 'NO_GROUND':
            list.push({
              id: `${instance.id}:noground`,
              severity: 'error',
              code: 'ic.noGround',
              message: `${instance.reference} has +5 V on pin ${vccPin} but no ground reference on pin ${gndPin}. Current needs a return path.`,
              subjects: [instance.id],
            });
            break;
          case 'UNDERVOLTAGE':
            list.push({
              id: `${instance.id}:undervoltage`,
              severity: 'warning',
              code: 'ic.undervoltage',
              message: `${instance.reference} is at ${runtime.supplyVoltage.toFixed(2)} V, below the ${spec.minVoltage} V minimum for ${spec.family}. Outputs are unreliable.`,
              subjects: [instance.id],
            });
            break;
          case 'OVERVOLTAGE':
          case 'OVERHEATING':
            list.push({
              id: `${instance.id}:overvoltage`,
              severity: 'error',
              code: 'ic.overvoltage',
              message: `${instance.reference} is at ${runtime.supplyVoltage.toFixed(2)} V. The absolute maximum for ${spec.family} is ${spec.absoluteMaxVoltage} V; the part will be destroyed if this continues.`,
              subjects: [instance.id],
            });
            break;
          case 'REVERSE_POLARITY':
            list.push({
              id: `${instance.id}:reverse`,
              severity: 'error',
              code: 'ic.reversePolarity',
              message: `${instance.reference} has its supply backwards: pin ${gndPin} is more positive than pin ${vccPin}.`,
              subjects: [instance.id],
            });
            break;
          case 'DAMAGED':
            list.push({
              id: `${instance.id}:damaged`,
              severity: 'error',
              code: 'part.damaged',
              message: `${instance.reference} is damaged and no longer working. Delete it and place a new one.`,
              subjects: [instance.id],
            });
            break;
          default:
            break;
        }

        // Floating inputs on a powered part: it will appear to work and then fail
        // the moment someone touches the board.
        if (runtime.powered) {
          for (const pin of pinsOf(def, instance.properties)) {
            if (pin.direction !== 'in') continue;
            const net = this.netValueOfPin(instance.id, pin.number);
            const unconnected = !net || net.value === 'Z';
            if (!unconnected) continue;
            list.push({
              id: `${instance.id}:float:${pin.number}`,
              severity: 'warning',
              code: 'ic.floatingInput',
              message: `${instance.reference} pin ${pin.number} (${pin.name}) is floating. A TTL input left open reads high but picks up noise: tie it to +5 V or ground.`,
              subjects: [instance.id],
            });
          }
        }
      }
    }

    for (const net of this.netList.nets) {
      const value = this.netValues.get(net.id);
      if (value?.conflict) {
        list.push({
          id: `${net.id}:conflict`,
          severity: 'error',
          code: 'net.conflict',
          message: value.conflict,
          subjects: [net.id],
        });
      }
    }

    for (const warning of this.frameWarnings.values()) list.push(warning);
    this.frameWarnings.clear();

    // Stable order so the panel does not jump around between frames.
    list.sort((a, b) => (a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === 'error' ? -1 : 1));
    this.diagnostics = list;
    return list;
  }

  /* ---------------------------------------------------------------- *
   * Read-only access for the renderer, inspector and instruments
   * ---------------------------------------------------------------- */

  get nets(): NetList {
    return this.netList;
  }

  netValue(netId: string): ResolvedNet | undefined {
    return this.netValues.get(netId);
  }

  netValueOfPin(componentId: string, pin: number): ResolvedNet | undefined {
    const netId = this.netList.netIdOfPin(componentId, pin);
    return netId ? this.netValues.get(netId) : undefined;
  }

  netValueOfGroup(groupId: string): ResolvedNet | undefined {
    const net = this.netList.netOfGroup(groupId);
    return net ? this.netValues.get(net.id) : undefined;
  }

  netValueOfWire(wireId: string): ResolvedNet | undefined {
    const net = this.netList.netOfWire(wireId);
    return net ? this.netValues.get(net.id) : undefined;
  }

  runtime(componentId: string): ComponentRuntime {
    return this.runtimeOf(componentId);
  }

  get currentDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  /** Human label for a net: the supply nets get names, the rest get their id. */
  netLabel(net: Net): string {
    const value = this.netValues.get(net.id);
    if (!value) return net.id;
    if (value.isReference) return 'GND';
    if (value.strength === 'supply' && value.voltage !== undefined) {
      return `+${value.voltage.toFixed(value.voltage % 1 === 0 ? 0 : 1)}V`;
    }
    return net.id;
  }
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

function resolveDrives(net: Net, drives: Drive[]): ResolvedNet {
  const base: ResolvedNet = {
    netId: net.id,
    value: 'Z',
    strength: 'none',
    isReference: false,
    driverCount: drives.length,
  };
  if (drives.length === 0) return base;

  const supplies = drives.filter((d) => d.strength === 'supply');
  if (supplies.length > 0) {
    const voltages = supplies.map((d) => d.voltage ?? 0);
    const min = Math.min(...voltages);
    const max = Math.max(...voltages);
    const isReference = supplies.some((d) => d.reference);
    if (max - min > 0.05) {
      return {
        ...base,
        value: 'X',
        strength: 'supply',
        voltage: max,
        isReference,
        conflict: `Short circuit: two supplies are fighting on the same net (${min.toFixed(2)} V against ${max.toFixed(2)} V). Disconnect one of them before anything is damaged.`,
      };
    }
    return {
      ...base,
      value: max >= 2 ? 'H' : 'L',
      strength: 'supply',
      voltage: max,
      isReference,
    };
  }

  for (const level of ['strong', 'weak'] as const) {
    const active = drives.filter((d) => d.strength === level && d.value !== 'Z');
    if (active.length === 0) continue;
    const hasHigh = active.some((d) => d.value === 'H');
    const hasLow = active.some((d) => d.value === 'L');
    const hasUnknown = active.some((d) => d.value === 'X');
    if (hasUnknown || (hasHigh && hasLow)) {
      return {
        ...base,
        value: 'X',
        strength: level,
        ...(hasHigh && hasLow
          ? {
              conflict:
                'Two outputs are driving the same net to opposite levels. Only one push-pull output may drive a net.',
            }
          : {}),
      };
    }
    const voltage = hasHigh
      ? Math.max(...active.map((d) => d.voltage ?? DEFAULT_LOGIC_VOLTAGE))
      : 0;
    return { ...base, value: hasHigh ? 'H' : 'L', strength: level, voltage };
  }

  return base;
}

function evaluateGates(gates: GateSpec[], ctx: DeviceContext, powered: boolean): void {
  if (!powered) {
    for (const spec of gates) ctx.drive(spec.output, 'Z', { strength: 'none' });
    return;
  }
  for (const spec of gates) {
    const values = spec.inputs.map((pin) => {
      const value = ctx.value(pin);
      // An open TTL input floats high. The engine warns about it separately.
      if (value === 'H' || value === 'Z') return true;
      if (value === 'L') return false;
      return undefined;
    });
    if (values.some((v) => v === undefined)) {
      ctx.drive(spec.output, 'X', { strength: 'strong' });
      continue;
    }
    const inputs = values as boolean[];
    let result: boolean;
    switch (spec.op) {
      case 'and':
        result = inputs.every(Boolean);
        break;
      case 'nand':
        result = !inputs.every(Boolean);
        break;
      case 'or':
        result = inputs.some(Boolean);
        break;
      case 'nor':
        result = !inputs.some(Boolean);
        break;
      case 'xor':
        result = inputs.reduce((acc, v) => acc !== v, false);
        break;
      case 'xnor':
        result = !inputs.reduce((acc, v) => acc !== v, false);
        break;
      case 'not':
        result = !inputs[0];
        break;
      case 'buffer':
        result = inputs[0];
        break;
    }
    if (spec.invertOutput) result = !result;
    if (spec.openCollector && result) {
      ctx.drive(spec.output, 'Z', { strength: 'none' });
    } else {
      ctx.drive(spec.output, result ? 'H' : 'L', {
        strength: 'strong',
        voltage: result ? ctx.supplyVoltage : 0,
      });
    }
  }
}

function sameDrive(a: Drive, b: Drive): boolean {
  return a.value === b.value && a.strength === b.strength && a.voltage === b.voltage;
}

function sameNet(a: ResolvedNet, b: ResolvedNet): boolean {
  return (
    a.value === b.value &&
    a.strength === b.strength &&
    a.voltage === b.voltage &&
    a.isReference === b.isReference &&
    a.conflict === b.conflict
  );
}

function sameValues(a: Map<string, ResolvedNet>, b: Map<string, ResolvedNet>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || !sameNet(value, other)) return false;
  }
  return true;
}
