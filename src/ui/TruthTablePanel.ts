/**
 * Truth table panel.
 *
 * Shows the table produced by actually running the circuit through every input
 * combination, and offers it as text for a lab report.
 */

import type { TruthTableResult } from '../suite/TruthTable';
import { truthTableToText } from '../suite/TruthTable';
import { clear, el } from './dom';

export interface TruthTableCallbacks {
  onGenerate(): void;
  onCopy(text: string): void;
  onClose(): void;
}

export class TruthTablePanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private latest: TruthTableResult | undefined;

  constructor(
    host: HTMLElement,
    private callbacks: TruthTableCallbacks,
  ) {
    this.body = el('div', { class: 'truth-body' });
    this.root = el('section', { class: 'truth-panel', hidden: true }, [
      el('div', { class: 'analyzer-header' }, [
        el('h2', { text: 'Truth Table' }),
        el('div', { class: 'analyzer-actions' }, [
          el('button', { class: 'btn', type: 'button', text: 'Generate', onclick: () => this.callbacks.onGenerate() }),
          el('button', {
            class: 'btn',
            type: 'button',
            text: 'Copy as text',
            onclick: () => {
              if (this.latest) this.callbacks.onCopy(truthTableToText(this.latest));
            },
          }),
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onclick: () => this.callbacks.onClose() }),
        ]),
      ]),
      this.body,
    ]);
    host.append(this.root);
    this.showPlaceholder();
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private showPlaceholder(): void {
    clear(this.body);
    this.body.append(
      el('p', {
        class: 'note',
        text:
          'Press Generate to sweep every combination of the switches and logic sources in the circuit and record what the LEDs and probes do. The circuit is put back exactly as you left it afterwards.',
      }),
    );
  }

  show(result: TruthTableResult): void {
    this.latest = result;
    clear(this.body);
    if (result.note) this.body.append(el('p', { class: 'note note-warn', text: result.note }));
    if (result.rows.length === 0) return;

    const head = el('tr', {}, [
      ...result.inputs.map((input) => el('th', { class: 'th-input', text: input.label })),
      ...result.outputs.map((output) => el('th', { class: 'th-output', text: output.label })),
    ]);
    const rows = result.rows.map((row) =>
      el('tr', {}, [
        ...row.inputs.map((bit) => el('td', { class: `td-bit ${bit ? 'is-high' : 'is-low'}`, text: String(bit) })),
        ...row.outputs.map((value) =>
          el('td', { class: `td-out ${value === 'ON' || value === 'H' ? 'is-high' : ''}`, text: value }),
        ),
      ]),
    );

    this.body.append(
      el('table', { class: 'truth-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
    );
  }
}
