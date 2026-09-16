/**
 * Modals and transient messages.
 *
 * The help dialog lists only shortcuts that are really bound - there is a test that
 * keeps the list and the key handler in step.
 */

import { el, clear } from './dom';

export interface ShortcutEntry {
  keys: string;
  description: string;
  group: string;
}

export class Dialogs {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private toastHost: HTMLElement;
  private onDismiss: (() => void) | undefined;

  constructor(host: HTMLElement) {
    this.panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
    this.overlay = el('div', {
      class: 'dialog-overlay',
      hidden: true,
      onclick: (event: Event) => {
        if (event.target === this.overlay) this.close();
      },
    }, [this.panel]);
    this.toastHost = el('div', { class: 'toast-host', 'aria-live': 'polite' });
    host.append(this.overlay, this.toastHost);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  close(): void {
    this.overlay.hidden = true;
    clear(this.panel);
    const callback = this.onDismiss;
    this.onDismiss = undefined;
    callback?.();
  }

  private open(children: HTMLElement[], onDismiss?: () => void): void {
    clear(this.panel);
    this.panel.append(...children);
    this.overlay.hidden = false;
    this.onDismiss = onDismiss;
    const focusable = this.panel.querySelector<HTMLElement>('input, button, select, textarea');
    focusable?.focus();
  }

  showShortcuts(entries: ShortcutEntry[]): void {
    const groups = new Map<string, ShortcutEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.group) ?? [];
      list.push(entry);
      groups.set(entry.group, list);
    }
    this.open([
      el('h2', { class: 'dialog-title', text: 'Keyboard shortcuts' }),
      el('p', { class: 'dialog-lead', text: 'Every shortcut listed here is bound. Nothing here is aspirational.' }),
      el(
        'div',
        { class: 'shortcut-grid' },
        [...groups.entries()].map(([group, items]) =>
          el('div', { class: 'shortcut-group' }, [
            el('h3', { text: group }),
            ...items.map((item) =>
              el('div', { class: 'shortcut-row' }, [
                el('kbd', { text: item.keys }),
                el('span', { text: item.description }),
              ]),
            ),
          ]),
        ),
      ),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Close', onclick: () => this.close() }),
      ]),
    ]);
  }

  showMessage(title: string, lines: string[], tone: 'info' | 'error' = 'info'): void {
    this.open([
      el('h2', { class: `dialog-title ${tone === 'error' ? 'is-error' : ''}`, text: title }),
      ...lines.map((line) => el('p', { class: 'dialog-lead', text: line })),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Close', onclick: () => this.close() }),
      ]),
    ]);
  }

  confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
    this.open([
      el('h2', { class: 'dialog-title', text: title }),
      el('p', { class: 'dialog-lead', text: message }),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => this.close() }),
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: confirmLabel,
          onclick: () => {
            this.close();
            onConfirm();
          },
        }),
      ]),
    ]);
  }

  /** A dialog with more than two ways forward, e.g. "empty board" or "worked example". */
  choose(
    title: string,
    message: string,
    choices: { label: string; description?: string; primary?: boolean; onSelect: () => void }[],
  ): void {
    this.open([
      el('h2', { class: 'dialog-title', text: title }),
      el('p', { class: 'dialog-lead', text: message }),
      el(
        'div',
        { class: 'choice-list' },
        choices.map((choice) =>
          el('button', {
            class: `choice${choice.primary ? ' is-primary' : ''}`,
            type: 'button',
            onclick: () => {
              this.close();
              choice.onSelect();
            },
          }, [
            el('span', { class: 'choice-label', text: choice.label }),
            choice.description ? el('span', { class: 'choice-description', text: choice.description }) : undefined,
          ]),
        ),
      ),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => this.close() }),
      ]),
    ]);
  }

  prompt(title: string, label: string, value: string, onSubmit: (value: string) => void): void {
    const input = el('input', { class: 'prop-input', type: 'text', value, 'aria-label': label });
    const submit = () => {
      const result = input.value.trim();
      this.close();
      if (result) onSubmit(result);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    this.open([
      el('h2', { class: 'dialog-title', text: title }),
      el('label', { class: 'prop-label', text: label }),
      input,
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => this.close() }),
        el('button', { class: 'btn btn-primary', type: 'button', text: 'OK', onclick: submit }),
      ]),
    ]);
  }

  toast(message: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
    const node = el('div', { class: `toast toast-${tone}`, text: message });
    this.toastHost.append(node);
    window.setTimeout(() => {
      node.classList.add('is-leaving');
      window.setTimeout(() => node.remove(), 250);
    }, tone === 'error' ? 6000 : 3200);
  }
}
