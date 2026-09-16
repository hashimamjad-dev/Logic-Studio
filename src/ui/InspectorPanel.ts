/**
 * The inspector.
 *
 * Whatever is selected, this panel explains it in the terms the lab cares about:
 * which pin, which hole, which clip, which net, what voltage, what state. Being able
 * to follow a connection from a pin through a group to a net is most of what makes
 * debugging a breadboard possible.
 */

import { placementOf } from '../breadboard/PlacementValidator';
import { pinsOf } from '../components/ComponentDefinition';
import type { PinDefinition } from '../components/ComponentDefinition';
import type { Circuit } from '../core/Circuit';
import type { EditorState, Selection } from '../editor/EditorState';
import { ELECTRICAL_STATE_LABEL, LogicValue, PropertyDefinition, PropertyValue } from '../core/types';
import type { ResolvedNet, SimulationEngine } from '../simulation/SimulationEngine';
import { WIRE_COLORS, wireColorHex } from '../rendering/theme';
import { pathLength } from '../wiring/WireRouter';
import { clear, el } from './dom';

export interface InspectorCallbacks {
  onProperty(componentId: string, key: string, value: PropertyValue): void;
  onSelect(selection: Selection): void;
  onWireColor(wireId: string, color: string): void;
  onDelete(): void;
  onRotate(): void;
}

export interface InspectorContext {
  circuit: Circuit;
  engine: SimulationEngine;
  editor: EditorState;
}

export class InspectorPanel {
  private body: HTMLElement;

  constructor(
    host: HTMLElement,
    private callbacks: InspectorCallbacks,
  ) {
    this.body = el('div', { class: 'inspector-body' });
    host.append(el('div', { class: 'inspector' }, [this.body]));
  }

  update(context: InspectorContext): void {
    clear(this.body);
    const selection = context.editor.selection;
    if (selection.length === 0) {
      this.body.append(emptyState());
      return;
    }
    if (selection.length > 1) {
      this.body.append(this.multiSelection(context, selection));
      return;
    }
    const only = selection[0];
    switch (only.kind) {
      case 'component':
        this.body.append(this.componentView(context, only.id));
        break;
      case 'pin':
        this.body.append(this.pinView(context, only.componentId, only.pin));
        break;
      case 'wire':
        this.body.append(this.wireView(context, only.id));
        break;
      case 'hole':
        this.body.append(this.holeView(context, only.boardId, only.hole));
        break;
      case 'board':
        this.body.append(this.boardView(context, only.id));
        break;
      case 'junction':
        this.body.append(this.junctionView(context, only.id));
        break;
      case 'net':
        this.body.append(this.netView(context, only.id));
        break;
    }
  }

  /* ---------------------------------------------------------------- */

  private componentView(context: InspectorContext, componentId: string): HTMLElement {
    const { circuit, engine, editor } = context;
    const instance = circuit.getComponent(componentId);
    if (!instance) return emptyState();
    const definition = circuit.definitionOf(instance);
    const runtime = engine.runtime(instance.id);
    const simulating = editor.mode === 'simulate';

    const sections: HTMLElement[] = [
      header(definition.partNumber ?? definition.name, instance.reference, definition.description),
    ];

    const facts: [string, string][] = [
      ['Package', definition.footprint.package],
      ['Category', definition.category],
    ];
    if (definition.power) {
      facts.push(['Family', definition.power.family]);
      facts.push(['Supply', `${definition.power.nominalVoltage.toFixed(1)} V (${definition.power.minVoltage}-${definition.power.maxVoltage} V)`]);
      facts.push(['VCC pin', definition.power.vccPins.join(', ')]);
      facts.push(['GND pin', definition.power.gndPins.join(', ')]);
    }
    if (definition.timing) facts.push(['Propagation delay', `${definition.timing.propagationDelayNs} ns typ.`]);
    facts.push(['Position', `${instance.position.x}, ${instance.position.y} (grid)`]);
    facts.push(['Rotation', `${instance.rotation}°`]);
    sections.push(factTable(facts));

    if (definition.power || simulating) {
      const label = ELECTRICAL_STATE_LABEL[runtime.electrical];
      const tone = runtime.electrical === 'POWERED' ? 'ok' : runtime.damaged ? 'bad' : 'warn';
      sections.push(
        section('Electrical state', [
          el('div', { class: `state-chip state-${tone}` }, [
            el('span', { class: 'state-dot' }),
            el('span', { text: label }),
            definition.power && runtime.supplyVoltage > 0
              ? el('span', { class: 'state-meta', text: `${runtime.supplyVoltage.toFixed(2)} V` })
              : undefined,
          ]),
        ]),
      );
    }

    const placement = placementOf(circuit, instance);
    if (!placement.valid) {
      sections.push(
        section('Placement', placement.reasons.map((reason) => el('p', { class: 'note note-bad', text: reason }))),
      );
    }

    if (definition.properties && definition.properties.length > 0) {
      sections.push(
        section(
          'Properties',
          definition.properties.map((property) => this.propertyRow(instance.id, property, instance.properties[property.key])),
        ),
      );
    }

    sections.push(this.pinTable(context, instance.id));

    if (definition.datasheet) {
      const notes: HTMLElement[] = [el('p', { class: 'note', text: definition.datasheet.functionSummary })];
      for (const note of definition.datasheet.notes ?? []) notes.push(el('p', { class: 'note note-warn', text: note }));
      sections.push(section('Datasheet notes', notes));
    }

    const warnings = engine.currentDiagnostics.filter((d) => d.subjects.includes(instance.id));
    sections.push(
      section(
        'Warnings',
        warnings.length === 0
          ? [el('p', { class: 'note note-ok', text: 'None.' })]
          : warnings.map((d) => el('p', { class: `note note-${d.severity === 'error' ? 'bad' : 'warn'}`, text: d.message })),
      ),
    );

    if (editor.mode === 'design') {
      sections.push(
        el('div', { class: 'inspector-actions' }, [
          el('button', { class: 'btn', type: 'button', text: 'Rotate', onclick: () => this.callbacks.onRotate() }),
          el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete', onclick: () => this.callbacks.onDelete() }),
        ]),
      );
    }

    return el('div', {}, sections);
  }

  private propertyRow(componentId: string, property: PropertyDefinition, value: PropertyValue): HTMLElement {
    const id = `prop-${componentId}-${property.key}`;
    let input: HTMLElement;
    switch (property.kind) {
      case 'boolean':
        input = el('input', {
          id,
          type: 'checkbox',
          class: 'prop-checkbox',
          checked: value === true,
          onchange: (event: Event) =>
            this.callbacks.onProperty(componentId, property.key, (event.target as HTMLInputElement).checked),
        });
        break;
      case 'choice':
        input = el(
          'select',
          {
            id,
            class: 'prop-input',
            onchange: (event: Event) =>
              this.callbacks.onProperty(componentId, property.key, (event.target as HTMLSelectElement).value),
          },
          (property.choices ?? []).map((choice: { value: string; label: string }) =>
            el('option', { value: choice.value, selected: choice.value === value, text: choice.label }),
          ),
        );
        break;
      case 'number':
        input = el('input', {
          id,
          type: 'number',
          class: 'prop-input',
          value: String(value ?? ''),
          min: property.min,
          max: property.max,
          step: property.step ?? 1,
          onchange: (event: Event) => {
            const raw = Number((event.target as HTMLInputElement).value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(property.max ?? raw, Math.max(property.min ?? raw, raw));
            this.callbacks.onProperty(componentId, property.key, clamped);
          },
        });
        break;
      default:
        input = el('input', {
          id,
          type: 'text',
          class: 'prop-input',
          value: String(value ?? ''),
          onchange: (event: Event) =>
            this.callbacks.onProperty(componentId, property.key, (event.target as HTMLInputElement).value),
        });
    }

    return el('div', { class: 'prop-row' }, [
      el('label', { class: 'prop-label', for: id }, [
        el('span', { text: property.label }),
        property.unit ? el('span', { class: 'prop-unit', text: property.unit }) : undefined,
      ]),
      input,
      property.help ? el('p', { class: 'prop-help', text: property.help }) : undefined,
    ]);
  }

  private pinTable(context: InspectorContext, componentId: string): HTMLElement {
    const { circuit, engine, editor } = context;
    const instance = circuit.getComponent(componentId)!;
    const definition = circuit.definitionOf(instance);
    const simulating = editor.mode === 'simulate';

    const rows = pinsOf(definition, instance.properties).map((pin) => {
      const net = engine.netValueOfPin(componentId, pin.number);
      const location = circuit.pinPosition(componentId, pin.number);
      const hole = location ? circuit.holeAt(location.x, location.y) : undefined;
      return el('tr', {
        class: 'pin-row',
        tabindex: '0',
        onclick: () => this.callbacks.onSelect({ kind: 'pin', componentId, pin: pin.number }),
      }, [
        el('td', { class: 'pin-number', text: String(pin.number) }),
        el('td', { class: 'pin-name' }, [
          el('span', { text: pin.name }),
          pin.activeLow ? el('span', { class: 'pin-flag', text: 'active low' }) : undefined,
        ]),
        el('td', { class: 'pin-role', text: shortRole(pin) }),
        el('td', { class: 'pin-hole', text: hole ? hole.hole.id : '—' }),
        el('td', { class: 'pin-state' }, [stateBadge(net, simulating)]),
      ]);
    });

    return section('Pins', [
      el('table', { class: 'pin-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: '#' }),
            el('th', { text: 'Name' }),
            el('th', { text: 'Type' }),
            el('th', { text: 'Hole' }),
            el('th', { text: 'State' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  private pinView(context: InspectorContext, componentId: string, pinNumber: number): HTMLElement {
    const { circuit, engine } = context;
    const instance = circuit.getComponent(componentId);
    if (!instance) return emptyState();
    const definition = circuit.definitionOf(instance);
    const pin = pinsOf(definition, instance.properties).find((p) => p.number === pinNumber);
    if (!pin) return emptyState();
    const net = engine.netValueOfPin(componentId, pinNumber);
    const location = circuit.pinPosition(componentId, pinNumber);
    const hole = location ? circuit.holeAt(location.x, location.y) : undefined;
    const group = hole ? hole.board.getGroup(hole.hole.groupId) : undefined;

    const facts: [string, string][] = [
      ['Part', `${instance.reference} (${definition.partNumber ?? definition.name})`],
      ['Pin number', String(pin.number)],
      ['Pin name', pin.name + (pin.activeLow ? ' (active low)' : '')],
      ['Type', pin.type],
      ['Direction', pin.direction],
      ['Electrical role', pin.electricalRole ?? 'SIGNAL'],
      ['Hole', hole ? `${hole.board.definition.name} ${hole.hole.id}` : 'Not in a hole'],
      ['Clip', group ? group.label : '—'],
      ['Net', net ? net.netId : 'Not connected'],
    ];

    return el('div', {}, [
      header(`Pin ${pin.number}`, `${instance.reference} · ${pin.name}`, pin.note ?? ''),
      factTable(facts),
      section('Signal', [netSummary(net, true)]),
      net
        ? el('button', {
            class: 'btn',
            type: 'button',
            text: `Inspect net ${net.netId}`,
            onclick: () => this.callbacks.onSelect({ kind: 'net', id: net.netId }),
          })
        : el('p', { class: 'note', text: 'Nothing is connected to this pin yet.' }),
      el('button', {
        class: 'btn',
        type: 'button',
        text: `Back to ${instance.reference}`,
        onclick: () => this.callbacks.onSelect({ kind: 'component', id: componentId }),
      }),
    ]);
  }

  private wireView(context: InspectorContext, wireId: string): HTMLElement {
    const { circuit, engine, editor } = context;
    const wire = circuit.getWire(wireId);
    if (!wire) return emptyState();
    const path = circuit.wirePath(wire);
    const net = engine.netValueOfWire(wireId);

    const facts: [string, string][] = [
      ['From', circuit.describeConnection(wire.from)],
      ['To', circuit.describeConnection(wire.to)],
      ['Corners', String(wire.corners.length)],
      ['Length', path ? `${(pathLength(path) * 0.1).toFixed(2)} in` : '—'],
      ['Net', net ? net.netId : 'Unresolved'],
    ];

    const swatches = WIRE_COLORS.map((color) =>
      el('button', {
        class: `swatch${wire.color === color.key ? ' is-active' : ''}`,
        type: 'button',
        title: color.label,
        'aria-label': `${color.label} wire`,
        style: `background:${wireColorHex(color.key)}`,
        onclick: () => this.callbacks.onWireColor(wireId, color.key),
      }),
    );

    return el('div', {}, [
      header('Wire', wireId, 'Colour is presentation only; it never changes the circuit.'),
      factTable(facts),
      section('Colour', [el('div', { class: 'swatch-row' }, swatches)]),
      section('Signal', [netSummary(net, editor.mode === 'simulate')]),
      net
        ? el('button', {
            class: 'btn',
            type: 'button',
            text: `Inspect net ${net.netId}`,
            onclick: () => this.callbacks.onSelect({ kind: 'net', id: net.netId }),
          })
        : undefined,
      editor.mode === 'design'
        ? el('div', { class: 'inspector-actions' }, [
            el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete wire', onclick: () => this.callbacks.onDelete() }),
          ])
        : undefined,
    ]);
  }

  private holeView(context: InspectorContext, boardId: string, holeId: string): HTMLElement {
    const { circuit, engine } = context;
    const board = circuit.getBoard(boardId);
    const hole = board?.getHole(holeId);
    if (!board || !hole) return emptyState();
    const group = board.getGroup(hole.groupId)!;
    const net = engine.netValueOfGroup(hole.groupId);

    const connected: string[] = [];
    for (const instance of circuit.components) {
      for (const location of circuit.pinPositions(instance)) {
        const found = circuit.holeAt(location.position.x, location.position.y);
        if (found && found.hole.groupId === hole.groupId) {
          connected.push(`${instance.reference} pin ${location.pinNumber} (${location.pinName}) in ${found.hole.id}`);
        }
      }
    }
    for (const wire of circuit.wires) {
      for (const end of [wire.from, wire.to]) {
        if (end.kind === 'hole' && end.boardId === boardId) {
          const other = board.getHole(end.hole);
          if (other?.groupId === hole.groupId) connected.push(`Wire ${wire.id} in ${end.hole}`);
        }
      }
    }

    return el('div', {}, [
      header(`Hole ${hole.id}`, board.definition.name, `Everything in ${group.label} is one electrical node.`),
      factTable([
        ['Board', board.definition.name],
        ['Position', hole.kind === 'rail' ? `${hole.railId} column ${hole.column}` : `row ${hole.row}, column ${hole.column}`],
        ['Clip', group.label],
        ['Holes in clip', group.holeIds.join(' ')],
        ['Net', net ? net.netId : 'Not connected'],
      ]),
      section('Signal', [netSummary(net, true)]),
      section(
        'Connected here',
        connected.length === 0
          ? [el('p', { class: 'note', text: 'Nothing is plugged into this clip.' })]
          : connected.map((line) => el('p', { class: 'note', text: line })),
      ),
    ]);
  }

  private boardView(context: InspectorContext, boardId: string): HTMLElement {
    const board = context.circuit.getBoard(boardId);
    if (!board) return emptyState();
    const definition = board.definition;
    const railSegments = definition.rails.reduce((sum, rail) => sum + rail.segments.length, 0);
    return el('div', {}, [
      header(definition.name, boardId, definition.description),
      factTable([
        ['Columns', String(definition.columns)],
        ['Banks', definition.banks.map((b) => `${b.rows[0]}-${b.rows[b.rows.length - 1]}`).join(', ')],
        ['Trenches', String(definition.trenches.length)],
        ['Rails', definition.rails.length === 0 ? 'None' : `${definition.rails.length} (${railSegments} isolated segments)`],
        ['Tie points', String(board.tiePointCount)],
        ['Position', `${board.position.x}, ${board.position.y} (grid)`],
      ]),
      definition.rails.some((rail) => rail.segments.length > 1)
        ? el('p', {
            class: 'note note-warn',
            text: 'The power rails on this board are split near the middle. The far half is dead until you bridge it with a jumper.',
          })
        : undefined,
      el('div', { class: 'inspector-actions' }, [
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Remove board', onclick: () => this.callbacks.onDelete() }),
      ]),
    ]);
  }

  private junctionView(context: InspectorContext, junctionId: string): HTMLElement {
    const junction = context.circuit.getJunction(junctionId);
    if (!junction) return emptyState();
    const net = context.engine.nets.netOfJunction(junctionId);
    return el('div', {}, [
      header('Junction', junctionId, 'A junction is a real connection. Wires that merely cross are not connected.'),
      factTable([
        ['On wire', junction.wireId],
        ['Position', `${junction.position.x}, ${junction.position.y}`],
        ['Net', net ? net.id : '—'],
      ]),
      el('div', { class: 'inspector-actions' }, [
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete junction', onclick: () => this.callbacks.onDelete() }),
      ]),
    ]);
  }

  private netView(context: InspectorContext, netId: string): HTMLElement {
    const { circuit, engine } = context;
    const net = engine.nets.get(netId);
    if (!net) return emptyState();
    const value = engine.netValue(netId);

    const members: HTMLElement[] = [];
    for (const pin of net.pins) {
      const instance = circuit.getComponent(pin.componentId);
      if (!instance) continue;
      members.push(
        el('button', {
          class: 'link-row',
          type: 'button',
          text: `${instance.reference} pin ${pin.pin}`,
          onclick: () => this.callbacks.onSelect({ kind: 'pin', componentId: pin.componentId, pin: pin.pin }),
        }),
      );
    }
    for (const groupId of net.groupIds) {
      const board = circuit.boards.find((b) => b.getGroup(groupId));
      const group = board?.getGroup(groupId);
      if (group) members.push(el('div', { class: 'link-row is-static', text: `${board!.definition.name} ${group.label}` }));
    }
    for (const wireId of net.wireIds) {
      members.push(
        el('button', {
          class: 'link-row',
          type: 'button',
          text: `Wire ${wireId}`,
          onclick: () => this.callbacks.onSelect({ kind: 'wire', id: wireId }),
        }),
      );
    }

    return el('div', {}, [
      header(`Net ${netId}`, engine.netLabel(net), 'Everything listed below is electrically the same point.'),
      section('Signal', [netSummary(value, true)]),
      factTable([
        ['Pins', String(net.pins.length)],
        ['Breadboard clips', String(net.groupIds.length)],
        ['Wires', String(net.wireIds.length)],
        ['Junctions', String(net.junctionIds.length)],
      ]),
      section('Members', members.length ? members : [el('p', { class: 'note', text: 'Nothing on this net.' })]),
    ]);
  }

  private multiSelection(context: InspectorContext, selection: Selection[]): HTMLElement {
    const counts = new Map<string, number>();
    for (const item of selection) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return el('div', {}, [
      header(`${selection.length} items selected`, '', 'Rotate, move or delete them together.'),
      factTable([...counts.entries()].map(([kind, count]) => [kind, String(count)] as [string, string])),
      context.editor.mode === 'design'
        ? el('div', { class: 'inspector-actions' }, [
            el('button', { class: 'btn', type: 'button', text: 'Rotate', onclick: () => this.callbacks.onRotate() }),
            el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete', onclick: () => this.callbacks.onDelete() }),
          ])
        : undefined,
    ]);
  }
}

/* ------------------------------------------------------------------ *
 * Small building blocks
 * ------------------------------------------------------------------ */

function emptyState(): HTMLElement {
  return el('div', { class: 'inspector-empty' }, [
    el('p', { class: 'inspector-empty-title', text: 'Nothing selected' }),
    el('p', {
      text: 'Click a chip, a wire, a breadboard hole or a pin to inspect it. Hovering shows what is under the cursor in the status bar.',
    }),
  ]);
}

function header(title: string, subtitle: string, description: string): HTMLElement {
  return el('div', { class: 'inspector-header' }, [
    el('h2', { class: 'inspector-title', text: title }),
    subtitle ? el('p', { class: 'inspector-subtitle', text: subtitle }) : undefined,
    description ? el('p', { class: 'inspector-description', text: description }) : undefined,
  ]);
}

function section(title: string, children: (HTMLElement | undefined)[]): HTMLElement {
  return el('section', { class: 'inspector-section' }, [
    el('h3', { class: 'inspector-section-title', text: title }),
    ...children,
  ]);
}

function factTable(facts: [string, string][]): HTMLElement {
  return el(
    'dl',
    { class: 'fact-list' },
    facts.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]),
  );
}

function shortRole(pin: PinDefinition): string {
  if (pin.electricalRole === 'VCC') return 'POWER';
  if (pin.electricalRole === 'GND') return 'GROUND';
  return pin.type;
}

function stateBadge(net: ResolvedNet | undefined, simulating: boolean): HTMLElement {
  if (!simulating) return el('span', { class: 'badge badge-idle', text: '—' });
  const value: LogicValue = net?.value ?? 'Z';
  const label = net?.conflict ? 'CONFLICT' : value === 'Z' ? 'FLOAT' : value === 'X' ? 'X' : value;
  const tone = net?.conflict || value === 'X' ? 'bad' : value === 'H' ? 'high' : value === 'L' ? 'low' : 'idle';
  return el('span', { class: `badge badge-${tone}`, text: label });
}

function netSummary(net: ResolvedNet | undefined, simulating: boolean): HTMLElement {
  if (!simulating) {
    return el('p', { class: 'note', text: 'Switch to Simulate to see live values.' });
  }
  if (!net) return el('p', { class: 'note', text: 'Not part of any net yet.' });
  const rows: [string, string][] = [
    ['Logic', net.conflict ? 'CONFLICT' : net.value === 'Z' ? 'FLOATING' : net.value],
    ['Voltage', net.voltage === undefined ? 'floating' : `${net.voltage.toFixed(2)} V`],
    ['Drive', net.strength],
    ['Drivers', String(net.driverCount)],
  ];
  if (net.isReference) rows.push(['Reference', 'This net is circuit ground']);
  return el('div', {}, [
    factTable(rows),
    net.conflict ? el('p', { class: 'note note-bad', text: net.conflict }) : undefined,
  ]);
}
