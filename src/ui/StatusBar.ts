/**
 * The status bar.
 *
 * Three jobs: say what the cursor is over, say what the circuit is complaining about,
 * and show the view state. Error text here is written for a student - what is wrong
 * and which pin to move - not "simulation error".
 */

import type { Diagnostic } from '../core/types';
import { clear, el } from './dom';

export interface StatusView {
  hint: string;
  hover?: string | undefined;
  diagnostics: Diagnostic[];
  zoom: number;
  mode: 'design' | 'simulate';
  running: boolean;
  simTimeMs: number;
  components: number;
  nets: number;
}

export interface StatusCallbacks {
  onSelectDiagnostic(diagnostic: Diagnostic): void;
}

export class StatusBar {
  private hintNode: HTMLElement;
  private issuesNode: HTMLElement;
  private statsNode: HTMLElement;
  private panel: HTMLElement;
  private panelOpen = false;
  private current: Diagnostic[] = [];

  constructor(
    host: HTMLElement,
    private callbacks: StatusCallbacks,
  ) {
    this.hintNode = el('div', { class: 'status-hint' });
    this.issuesNode = el('button', {
      class: 'status-issues',
      type: 'button',
      onclick: () => {
        this.panelOpen = !this.panelOpen;
        this.renderPanel();
      },
    });
    this.statsNode = el('div', { class: 'status-stats' });
    this.panel = el('div', { class: 'diagnostics-panel', hidden: true });

    host.append(
      this.panel,
      el('footer', { class: 'status-bar' }, [this.hintNode, this.issuesNode, this.statsNode]),
    );
  }

  update(view: StatusView): void {
    this.hintNode.textContent = view.hover ? `${view.hover} · ${view.hint}` : view.hint;

    const errors = view.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = view.diagnostics.filter((d) => d.severity === 'warning').length;
    this.current = view.diagnostics;
    clear(this.issuesNode);
    this.issuesNode.append(
      el('span', { class: `pill ${errors ? 'pill-bad' : 'pill-ok'}`, text: `${errors} error${errors === 1 ? '' : 's'}` }),
      el('span', { class: `pill ${warnings ? 'pill-warn' : 'pill-ok'}`, text: `${warnings} warning${warnings === 1 ? '' : 's'}` }),
    );
    this.issuesNode.title = view.diagnostics.length
      ? 'Click to list every problem found in the circuit'
      : 'No problems found';

    clear(this.statsNode);
    this.statsNode.append(
      el('span', { text: `${view.components} parts` }),
      el('span', { text: `${view.nets} nets` }),
      el('span', {
        class: view.mode === 'simulate' ? (view.running ? 'sim-on' : 'sim-paused') : '',
        text:
          view.mode === 'simulate'
            ? `${view.running ? 'Running' : 'Paused'} · ${formatTime(view.simTimeMs)}`
            : 'Design mode',
      }),
      el('span', { text: `${Math.round(view.zoom * 100)}%` }),
    );

    if (this.panelOpen) this.renderPanel();
  }

  private renderPanel(): void {
    this.panel.hidden = !this.panelOpen;
    if (!this.panelOpen) return;
    clear(this.panel);
    this.panel.append(
      el('div', { class: 'diagnostics-header' }, [
        el('span', { text: 'Circuit checks' }),
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: 'Close',
          onclick: () => {
            this.panelOpen = false;
            this.renderPanel();
          },
        }),
      ]),
    );
    if (this.current.length === 0) {
      this.panel.append(
        el('p', { class: 'note note-ok', text: 'No problems found. Every powered part has a supply and a ground.' }),
      );
      return;
    }
    for (const diagnostic of this.current) {
      this.panel.append(
        el('button', {
          class: `diagnostic diagnostic-${diagnostic.severity}`,
          type: 'button',
          onclick: () => this.callbacks.onSelectDiagnostic(diagnostic),
        }, [
          el('span', { class: 'diagnostic-tag', text: diagnostic.severity === 'error' ? 'ERROR' : 'WARNING' }),
          el('span', { class: 'diagnostic-text', text: diagnostic.message }),
        ]),
      );
    }
  }
}

function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
