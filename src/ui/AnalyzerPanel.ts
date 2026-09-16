/**
 * The logic analyser panel: channel list plus a waveform canvas.
 *
 * Nets are added from the selection, so the workflow is "click the wire you care
 * about, add it as a channel" - the same thing you would do with real probe clips.
 */

import type { LogicAnalyzer } from '../instruments/LogicAnalyzer';
import type { LogicValue } from '../core/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import { themeFor } from '../rendering/theme';
import { clear, el } from './dom';

export interface AnalyzerCallbacks {
  onAddSelected(): void;
  onRemove(netId: string): void;
  onClear(): void;
  onToggleCapture(): void;
  onClose(): void;
  onWindow(ms: number): void;
}

export class AnalyzerPanel {
  private root: HTMLElement;
  private channelList: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private captureButton: HTMLButtonElement;
  private windowSelect: HTMLSelectElement;

  constructor(
    host: HTMLElement,
    private callbacks: AnalyzerCallbacks,
  ) {
    this.channelList = el('div', { class: 'analyzer-channels' });
    this.canvas = el('canvas', { class: 'analyzer-canvas' });
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = context;

    this.captureButton = el('button', {
      class: 'btn',
      type: 'button',
      text: 'Pause capture',
      onclick: () => this.callbacks.onToggleCapture(),
    });

    this.windowSelect = el(
      'select',
      {
        class: 'prop-input',
        'aria-label': 'Time window',
        onchange: (event: Event) => this.callbacks.onWindow(Number((event.target as HTMLSelectElement).value)),
      },
      [
        el('option', { value: '500', text: '0.5 s' }),
        el('option', { value: '2000', text: '2 s' }),
        el('option', { value: '4000', text: '4 s', selected: true }),
        el('option', { value: '10000', text: '10 s' }),
        el('option', { value: '30000', text: '30 s' }),
      ],
    );

    this.root = el('section', { class: 'analyzer', hidden: true }, [
      el('div', { class: 'analyzer-header' }, [
        el('h2', { text: 'Logic Analyzer' }),
        el('div', { class: 'analyzer-actions' }, [
          el('button', { class: 'btn', type: 'button', text: 'Add selected net', onclick: () => this.callbacks.onAddSelected() }),
          this.captureButton,
          el('button', { class: 'btn', type: 'button', text: 'Clear', onclick: () => this.callbacks.onClear() }),
          this.windowSelect,
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onclick: () => this.callbacks.onClose() }),
        ]),
      ]),
      el('div', { class: 'analyzer-body' }, [this.channelList, el('div', { class: 'analyzer-plot' }, [this.canvas])]),
    ]);
    host.append(this.root);
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  update(analyzer: LogicAnalyzer, engine: SimulationEngine, theme: 'light' | 'dark', simTimeMs: number): void {
    if (this.root.hidden) return;
    this.captureButton.textContent = analyzer.capturing ? 'Pause capture' : 'Resume capture';
    this.windowSelect.value = String(analyzer.windowMs);

    clear(this.channelList);
    if (analyzer.channels.length === 0) {
      this.channelList.append(
        el('p', {
          class: 'note',
          text: 'Select a wire, pin or hole on the board and press "Add selected net" to probe it.',
        }),
      );
    }
    for (const channel of analyzer.channels) {
      const value = engine.netValue(channel.netId)?.value ?? 'Z';
      this.channelList.append(
        el('div', { class: 'analyzer-channel' }, [
          el('span', { class: 'analyzer-channel-name', text: channel.label }),
          el('span', { class: `badge badge-${badgeTone(value)}`, text: value === 'Z' ? 'FLOAT' : value }),
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: '✕',
            'aria-label': `Remove ${channel.label}`,
            onclick: () => this.callbacks.onRemove(channel.netId),
          }),
        ]),
      );
    }

    this.drawWaves(analyzer, theme, simTimeMs);
  }

  private drawWaves(analyzer: LogicAnalyzer, themeName: 'light' | 'dark', simTimeMs: number): void {
    const theme = themeFor(themeName);
    const host = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const windowMs = analyzer.windowMs;
    const endTime = Math.max(simTimeMs, windowMs * 0.1);
    const startTime = endTime - windowMs;
    const xFor = (t: number) => ((t - startTime) / windowMs) * width;

    // Time grid.
    ctx.strokeStyle = theme.gridDot;
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.stateFloating;
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    const divisions = 8;
    for (let i = 0; i <= divisions; i++) {
      const x = (i / divisions) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - 14);
      ctx.stroke();
      const label = ((startTime + (i / divisions) * windowMs) / 1000).toFixed(2);
      ctx.fillText(`${label}s`, Math.min(width - 16, Math.max(16, x)), height - 3);
    }

    const rows = analyzer.channels.length;
    if (rows === 0) return;
    const rowHeight = Math.max(18, (height - 20) / rows);

    analyzer.channels.forEach((channel, index) => {
      const top = index * rowHeight + 6;
      const high = top + 4;
      const low = top + rowHeight - 10;
      const trace = analyzer.traceOf(channel.netId);

      ctx.strokeStyle = theme.stateHigh;
      ctx.lineWidth = 1.6;
      ctx.beginPath();

      let value = analyzer.valueAt(channel.netId, startTime);
      let x = 0;
      let y = levelY(value, high, low);
      ctx.moveTo(x, y);
      for (const transition of trace) {
        if (transition.t < startTime) continue;
        if (transition.t > endTime) break;
        const tx = xFor(transition.t);
        ctx.lineTo(tx, y);
        y = levelY(transition.value, high, low);
        ctx.lineTo(tx, y);
        value = transition.value;
        x = tx;
      }
      ctx.lineTo(width, y);
      ctx.strokeStyle = value === 'X' ? theme.stateConflict : value === 'Z' ? theme.stateFloating : theme.stateHigh;
      ctx.stroke();

      ctx.fillStyle = theme.stateFloating;
      ctx.textAlign = 'left';
      ctx.fillText(channel.label, 4, top + 2);
    });
  }
}

function levelY(value: LogicValue, high: number, low: number): number {
  if (value === 'H') return high;
  if (value === 'L') return low;
  return (high + low) / 2;
}

function badgeTone(value: LogicValue): string {
  if (value === 'H') return 'high';
  if (value === 'L') return 'low';
  if (value === 'X') return 'bad';
  return 'idle';
}
