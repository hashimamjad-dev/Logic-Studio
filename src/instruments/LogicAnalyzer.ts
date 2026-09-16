/**
 * Logic analyser.
 *
 * Channels are nets, and samples come from the simulation engine itself - this is a
 * view of what the solver actually computed, not a re-simulation. Only transitions
 * are stored, which keeps a long capture cheap and the drawing exact.
 */

import type { LogicValue } from '../core/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';

export interface AnalyzerChannel {
  netId: string;
  label: string;
}

interface Transition {
  /** Simulated time in milliseconds. */
  t: number;
  value: LogicValue;
}

const MAX_TRANSITIONS = 4000;

export class LogicAnalyzer {
  channels: AnalyzerChannel[] = [];
  capturing = true;
  /** Visible window in milliseconds. */
  windowMs = 4000;

  private traces = new Map<string, Transition[]>();
  private lastValue = new Map<string, LogicValue>();

  addChannel(netId: string, label: string): boolean {
    if (this.channels.some((c) => c.netId === netId)) return false;
    if (this.channels.length >= 12) return false;
    this.channels.push({ netId, label });
    this.traces.set(netId, []);
    return true;
  }

  removeChannel(netId: string): void {
    this.channels = this.channels.filter((c) => c.netId !== netId);
    this.traces.delete(netId);
    this.lastValue.delete(netId);
  }

  clear(): void {
    for (const netId of this.traces.keys()) this.traces.set(netId, []);
    this.lastValue.clear();
  }

  reset(): void {
    this.channels = [];
    this.traces.clear();
    this.lastValue.clear();
  }

  /** Record a sample. Called once per frame while the simulation is running. */
  sample(engine: SimulationEngine, timeMs: number): void {
    if (!this.capturing) return;
    for (const channel of this.channels) {
      const value = engine.netValue(channel.netId)?.value ?? 'Z';
      if (this.lastValue.get(channel.netId) === value) continue;
      this.lastValue.set(channel.netId, value);
      const trace = this.traces.get(channel.netId) ?? [];
      trace.push({ t: timeMs, value });
      if (trace.length > MAX_TRANSITIONS) trace.splice(0, trace.length - MAX_TRANSITIONS);
      this.traces.set(channel.netId, trace);
    }
  }

  traceOf(netId: string): Transition[] {
    return this.traces.get(netId) ?? [];
  }

  /** Value of a channel at a given time, for drawing the leading edge of the window. */
  valueAt(netId: string, timeMs: number): LogicValue {
    const trace = this.traceOf(netId);
    let value: LogicValue = 'Z';
    for (const transition of trace) {
      if (transition.t > timeMs) break;
      value = transition.value;
    }
    return value;
  }
}
