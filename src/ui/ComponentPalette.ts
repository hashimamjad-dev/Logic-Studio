/**
 * The component library panel.
 *
 * Categories, a working search, and a wire-colour picker. Clicking an entry arms a
 * placement: the part follows the cursor and is dropped only where the placement
 * validator allows it.
 */

import { BREADBOARD_DEFINITIONS } from '../breadboard/BreadboardDefinition';
import { CATEGORY_LABELS, CATEGORY_ORDER, ComponentCategory } from '../components/ComponentDefinition';
import { componentRegistry, LibraryEntry } from '../components/ComponentRegistry';
import { WIRE_COLORS, wireColorHex } from '../rendering/theme';
import { ICONS, clear, el, icon } from './dom';

export interface PaletteCallbacks {
  onPlaceComponent(definitionId: string): void;
  onPlaceBoard(definitionId: string): void;
  onSelectTool(tool: 'select' | 'multiselect'): void;
  onWireColor(color: string): void;
}

interface PaletteView {
  tool: string;
  pending: string | undefined;
  wireColor: string;
}

export class ComponentPalette {
  private root: HTMLElement;
  private listHost: HTMLElement;
  private searchInput: HTMLInputElement;
  private query = '';
  private collapsed = new Set<string>();
  private view: PaletteView = { tool: 'select', pending: undefined, wireColor: 'red' };

  constructor(
    host: HTMLElement,
    private callbacks: PaletteCallbacks,
  ) {
    this.searchInput = el('input', {
      type: 'search',
      class: 'palette-search-input',
      placeholder: 'Search parts, e.g. 7400 or flip flop',
      'aria-label': 'Search components',
      oninput: (event: Event) => {
        this.query = (event.target as HTMLInputElement).value.trim().toLowerCase();
        this.renderList();
      },
    });

    this.listHost = el('div', { class: 'palette-list' });
    this.root = el('div', { class: 'palette' }, [
      el('div', { class: 'palette-search' }, [icon(ICONS.search, 14), this.searchInput]),
      this.listHost,
    ]);
    host.append(this.root);
    this.renderList();
  }

  update(view: PaletteView): void {
    this.view = view;
    this.renderList();
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  private renderList(): void {
    clear(this.listHost);
    if (this.query) {
      const results = this.search(this.query);
      this.listHost.append(
        el('div', { class: 'palette-group' }, [
          el('div', { class: 'palette-group-title' }, [
            el('span', { text: `${results.length} result${results.length === 1 ? '' : 's'}` }),
          ]),
          ...results.map((entry) => this.entryButton(entry)),
        ]),
      );
      if (results.length === 0) {
        this.listHost.append(
          el('p', { class: 'palette-empty', text: `Nothing in the library matches "${this.query}".` }),
        );
      }
      return;
    }

    this.listHost.append(this.toolsGroup());
    this.listHost.append(this.wiresGroup());
    this.listHost.append(this.boardsGroup());

    const entries = componentRegistry.allEntries();
    for (const category of CATEGORY_ORDER) {
      if (category === 'breadboards') continue;
      const inCategory = entries.filter((entry) => entry.category === category);
      if (inCategory.length === 0) continue;
      this.listHost.append(
        this.group(CATEGORY_LABELS[category], category, inCategory.map((entry) => this.entryButton(entry))),
      );
    }
  }

  private search(query: string): LibraryEntry[] {
    const terms = query.split(/\s+/).filter(Boolean);
    const scored: { entry: LibraryEntry; score: number }[] = [];
    for (const entry of componentRegistry.allEntries()) {
      const haystack = `${entry.label} ${entry.sublabel} ${entry.keywords.join(' ')}`.toLowerCase();
      let score = 0;
      let matchedAll = true;
      for (const term of terms) {
        if (entry.label.toLowerCase().startsWith(term)) score += 10;
        else if (entry.keywords.some((k) => k.toLowerCase() === term)) score += 6;
        else if (haystack.includes(term)) score += 2;
        else matchedAll = false;
      }
      if (matchedAll) scored.push({ entry, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label)).map((s) => s.entry);
  }

  private group(title: string, key: string, children: HTMLElement[]): HTMLElement {
    const collapsed = this.collapsed.has(key);
    const header = el('button', {
      class: `palette-group-title${collapsed ? ' is-collapsed' : ''}`,
      type: 'button',
      'aria-expanded': String(!collapsed),
      onclick: () => {
        if (this.collapsed.has(key)) this.collapsed.delete(key);
        else this.collapsed.add(key);
        this.renderList();
      },
    }, [el('span', { class: 'palette-caret', text: collapsed ? '▸' : '▾' }), el('span', { text: title })]);

    return el('div', { class: 'palette-group' }, [header, !collapsed && el('div', { class: 'palette-items' }, children)]);
  }

  private toolsGroup(): HTMLElement {
    const tool = (
      id: 'select' | 'multiselect',
      label: string,
      shortcut: string,
      path: string,
    ): HTMLElement =>
      el('button', {
        class: `palette-item${this.view.tool === id && !this.view.pending ? ' is-active' : ''}`,
        type: 'button',
        onclick: () => this.callbacks.onSelectTool(id),
      }, [
        el('span', { class: 'palette-item-icon' }, [icon(path, 14)]),
        el('span', { class: 'palette-item-label', text: label }),
        el('kbd', { text: shortcut }),
      ]);

    return this.group('Tools', 'tools', [
      tool('select', 'Select and drag', 'V', ICONS.cursor),
      tool('multiselect', 'Multi-select', 'M', ICONS.marquee),
    ]);
  }

  private wiresGroup(): HTMLElement {
    const swatches = WIRE_COLORS.map((color) =>
      el('button', {
        class: `palette-item palette-wire${this.view.wireColor === color.key ? ' is-active' : ''}`,
        type: 'button',
        title: `${color.label} wire`,
        onclick: () => this.callbacks.onWireColor(color.key),
      }, [
        el('span', { class: 'wire-swatch', style: `background:${wireColorHex(color.key)}` }),
        el('span', { class: 'palette-item-label', text: `${color.label} wire` }),
      ]),
    );
    return this.group('Wires', 'wires', [
      el('p', { class: 'palette-note', text: 'Start a wire by clicking any pin or hole. Colour is cosmetic only.' }),
      ...swatches,
    ]);
  }

  private boardsGroup(): HTMLElement {
    return this.group(
      'Breadboards',
      'boards',
      BREADBOARD_DEFINITIONS.map((definition) =>
        el('button', {
          class: `palette-item${this.view.pending === definition.id ? ' is-active' : ''}`,
          type: 'button',
          title: definition.description,
          onclick: () => this.callbacks.onPlaceBoard(definition.id),
        }, [
          el('span', { class: 'palette-item-icon' }, [icon(ICONS.marquee, 14)]),
          el('span', { class: 'palette-item-body' }, [
            el('span', { class: 'palette-item-label', text: definition.name.replace('Breadboard ', '') }),
            el('span', { class: 'palette-item-sub', text: `${definition.columns} columns` }),
          ]),
        ]),
      ),
    );
  }

  private entryButton(entry: LibraryEntry): HTMLElement {
    const definition = componentRegistry.require(entry.definitionId);
    return el('button', {
      class: `palette-item${this.view.pending === entry.definitionId ? ' is-active' : ''}`,
      type: 'button',
      title: `${definition.name} - ${definition.description}`,
      onclick: () => this.callbacks.onPlaceComponent(entry.definitionId),
    }, [
      el('span', { class: 'palette-item-icon' }, [icon(iconFor(entry.category), 14)]),
      el('span', { class: 'palette-item-body' }, [
        el('span', { class: 'palette-item-label', text: entry.label }),
        el('span', { class: 'palette-item-sub', text: entry.sublabel }),
      ]),
      el('span', { class: 'palette-item-pkg', text: definition.footprint.package }),
    ]);
  }
}

function iconFor(category: ComponentCategory): string {
  switch (category) {
    case 'ttl74xx':
    case 'logic-gates':
    case 'sequential':
      return ICONS.chip;
    case 'instruments':
      return ICONS.wave;
    case 'displays':
      return ICONS.table;
    default:
      return ICONS.chip;
  }
}
