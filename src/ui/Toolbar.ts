/**
 * The top toolbar: modes, file actions, history, simulation transport and view.
 *
 * Every button here does something. Nothing is a placeholder.
 */

import type { AppMode } from '../editor/EditorState';
import { ICONS, el, icon } from './dom';

export interface ToolbarCallbacks {
  onMode(mode: AppMode): void;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onExport(): void;
  onUndo(): void;
  onRedo(): void;
  onRun(): void;
  onStep(): void;
  onResetSimulation(): void;
  onToggleAnalyzer(): void;
  onToggleTruthTable(): void;
  onToggleTheme(): void;
  onHelp(): void;
  onZoom(delta: number): void;
  onFit(): void;
}

export interface ToolbarView {
  mode: AppMode;
  running: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string | undefined;
  redoLabel?: string | undefined;
  analyzerOpen: boolean;
  truthTableOpen: boolean;
  theme: 'light' | 'dark';
  projectName: string;
  dirty: boolean;
}

export class Toolbar {
  private root: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private title: HTMLElement;

  constructor(
    host: HTMLElement,
    private callbacks: ToolbarCallbacks,
  ) {
    this.title = el('span', { class: 'project-name', text: 'Untitled experiment' });

    const brand = el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark', text: 'PL' }),
      el('span', { class: 'brand-name' }, [
        el('strong', { text: 'ProtoLab' }),
        el('span', { class: 'brand-sub', text: 'Virtual Digital Electronics Laboratory' }),
      ]),
    ]);

    const modes = el('div', { class: 'toolbar-group segmented' }, [
      this.button('design', 'Design', ICONS.cursor, () => this.callbacks.onMode('design'), 'D'),
      this.button('simulate', 'Simulate', ICONS.play, () => this.callbacks.onMode('simulate'), 'S'),
    ]);

    const file = el('div', { class: 'toolbar-group' }, [
      this.button('new', 'New', ICONS.file, () => this.callbacks.onNew(), 'Ctrl+N'),
      this.button('open', 'Open', ICONS.folder, () => this.callbacks.onOpen(), 'Ctrl+O'),
      this.button('save', 'Save', ICONS.save, () => this.callbacks.onSave(), 'Ctrl+S'),
      this.button('export', 'Export JSON', ICONS.export, () => this.callbacks.onExport(), 'Ctrl+E'),
    ]);

    const history = el('div', { class: 'toolbar-group' }, [
      this.button('undo', 'Undo', ICONS.undo, () => this.callbacks.onUndo(), 'Ctrl+Z'),
      this.button('redo', 'Redo', ICONS.redo, () => this.callbacks.onRedo(), 'Ctrl+Shift+Z'),
    ]);

    const transport = el('div', { class: 'toolbar-group transport' }, [
      this.button('run', 'Run', ICONS.play, () => this.callbacks.onRun(), 'P'),
      this.button('step', 'Step', ICONS.step, () => this.callbacks.onStep(), 'N'),
      this.button('resetSim', 'Reset', ICONS.reset, () => this.callbacks.onResetSimulation()),
    ]);

    const instruments = el('div', { class: 'toolbar-group' }, [
      this.button('analyzer', 'Logic Analyzer', ICONS.wave, () => this.callbacks.onToggleAnalyzer(), 'A'),
      this.button('truth', 'Truth Table', ICONS.table, () => this.callbacks.onToggleTruthTable(), 'T'),
    ]);

    const view = el('div', { class: 'toolbar-group' }, [
      this.button('zoomOut', 'Zoom out', ICONS.zoomOut, () => this.callbacks.onZoom(-1), '-'),
      this.button('zoomIn', 'Zoom in', ICONS.zoomIn, () => this.callbacks.onZoom(1), '+'),
      this.button('fit', 'Fit to view', ICONS.fit, () => this.callbacks.onFit(), 'F'),
      this.button('theme', 'Theme', ICONS.moon, () => this.callbacks.onToggleTheme()),
      this.button('help', 'Help', ICONS.help, () => this.callbacks.onHelp(), '?'),
    ]);

    this.root = el('header', { class: 'toolbar' }, [
      brand,
      modes,
      el('div', { class: 'toolbar-divider' }),
      file,
      history,
      transport,
      instruments,
      el('div', { class: 'toolbar-spacer' }, [this.title]),
      view,
    ]);
    host.append(this.root);
  }

  private button(
    key: string,
    label: string,
    path: string,
    onClick: () => void,
    shortcut?: string,
  ): HTMLButtonElement {
    const node = el('button', {
      class: 'tool-btn',
      type: 'button',
      title: shortcut ? `${label} (${shortcut})` : label,
      'aria-label': label,
      onclick: onClick,
    }, [icon(path, 15), el('span', { class: 'tool-btn-label', text: label })]);
    this.buttons.set(key, node);
    return node;
  }

  update(view: ToolbarView): void {
    this.setActive('design', view.mode === 'design');
    this.setActive('simulate', view.mode === 'simulate');
    this.setDisabled('undo', !view.canUndo);
    this.setDisabled('redo', !view.canRedo);
    this.setActive('analyzer', view.analyzerOpen);
    this.setActive('truth', view.truthTableOpen);

    const undo = this.buttons.get('undo');
    if (undo) undo.title = view.undoLabel ? `Undo ${view.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
    const redo = this.buttons.get('redo');
    if (redo) redo.title = view.redoLabel ? `Redo ${view.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';

    const run = this.buttons.get('run');
    if (run) {
      const label = view.running ? 'Pause' : 'Run';
      run.title = `${label} (P)`;
      run.setAttribute('aria-label', label);
      const svg = run.querySelector('svg path');
      svg?.setAttribute('d', view.running ? ICONS.pause : ICONS.play);
      const text = run.querySelector('.tool-btn-label');
      if (text) text.textContent = label;
      run.classList.toggle('is-running', view.running);
    }

    const transportDisabled = view.mode !== 'simulate';
    for (const key of ['run', 'step', 'resetSim']) this.setDisabled(key, transportDisabled);

    const theme = this.buttons.get('theme');
    if (theme) {
      theme.querySelector('svg path')?.setAttribute('d', view.theme === 'dark' ? ICONS.sun : ICONS.moon);
      theme.title = view.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }

    this.title.textContent = `${view.projectName}${view.dirty ? ' •' : ''}`;
  }

  private setActive(key: string, active: boolean): void {
    this.buttons.get(key)?.classList.toggle('is-active', active);
  }

  private setDisabled(key: string, disabled: boolean): void {
    const node = this.buttons.get(key);
    if (node) node.disabled = disabled;
  }
}
