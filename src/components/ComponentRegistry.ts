/**
 * The component library.
 *
 * One registry holds every definition. The palette, the factory, the serializer and
 * the validator all read from here, so a part exists in exactly one place.
 */

import type { ComponentCategory, ComponentDefinition } from './ComponentDefinition';
import { DISCRETE_DEFINITIONS } from './discrete';
import { TTL_74XX_DEFINITIONS } from './ttl74xx';

/**
 * A palette entry. Most entries are a definition shown under its own category; an
 * alias shows a real part under a second, friendlier heading - the AND gate in the
 * "Logic Gates" list *is* a 7408, not a separate idealised component.
 */
export interface LibraryEntry {
  key: string;
  definitionId: string;
  label: string;
  sublabel: string;
  category: ComponentCategory;
  keywords: string[];
}

class Registry {
  private byId = new Map<string, ComponentDefinition>();
  private entries: LibraryEntry[] = [];

  register(def: ComponentDefinition): void {
    if (this.byId.has(def.id)) throw new Error(`Duplicate component definition: ${def.id}`);
    this.byId.set(def.id, def);
    this.entries.push({
      key: def.id,
      definitionId: def.id,
      label: def.partNumber ? def.partNumber : def.name,
      sublabel: def.partNumber ? def.name.replace(`${def.partNumber} `, '') : def.description,
      category: def.category,
      keywords: def.keywords,
    });
  }

  alias(entry: LibraryEntry): void {
    if (!this.byId.has(entry.definitionId)) {
      throw new Error(`Alias ${entry.key} points at unknown definition ${entry.definitionId}`);
    }
    this.entries.push(entry);
  }

  get(id: string): ComponentDefinition | undefined {
    return this.byId.get(id);
  }

  require(id: string): ComponentDefinition {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown component definition: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): ComponentDefinition[] {
    return [...this.byId.values()];
  }

  allEntries(): LibraryEntry[] {
    return [...this.entries];
  }
}

export const componentRegistry = new Registry();

for (const def of DISCRETE_DEFINITIONS) componentRegistry.register(def);
for (const def of TTL_74XX_DEFINITIONS) componentRegistry.register(def);

/**
 * Basic gates are shown as the real chips that implement them. A student who picks
 * "AND gate" gets a 7408 with fourteen numbered pins, which is the whole point.
 */
const GATE_ALIASES: { label: string; part: string; note: string; keywords: string[] }[] = [
  { label: 'AND', part: '7408', note: 'Quad 2-input AND', keywords: ['and'] },
  { label: 'OR', part: '7432', note: 'Quad 2-input OR', keywords: ['or'] },
  { label: 'NOT', part: '7404', note: 'Hex inverter', keywords: ['not', 'inverter'] },
  { label: 'NAND', part: '7400', note: 'Quad 2-input NAND', keywords: ['nand'] },
  { label: 'NOR', part: '7402', note: 'Quad 2-input NOR', keywords: ['nor'] },
  { label: 'XOR', part: '7486', note: 'Quad 2-input XOR', keywords: ['xor'] },
];

for (const alias of GATE_ALIASES) {
  componentRegistry.alias({
    key: `gate-${alias.label.toLowerCase()}`,
    definitionId: `ic-${alias.part.toLowerCase()}`,
    label: `${alias.label} (${alias.part})`,
    sublabel: alias.note,
    category: 'logic-gates',
    keywords: [...alias.keywords, 'gate', 'logic', alias.part],
  });
}

const SEQUENTIAL_ALIASES: { label: string; part: string; note: string; keywords: string[] }[] = [
  { label: 'D Flip-Flop', part: '7474', note: 'Dual D type with preset and clear', keywords: ['d', 'flip flop', 'dff'] },
  { label: 'JK Flip-Flop', part: '7476', note: 'Dual JK type with preset and clear', keywords: ['jk', 'flip flop'] },
  { label: 'Binary Counter', part: '74163', note: 'Synchronous 4-bit counter', keywords: ['counter', 'binary'] },
  { label: 'Decade Counter', part: '7490', note: 'Divide by 2 and divide by 5', keywords: ['counter', 'decade', 'bcd'] },
  { label: 'Shift Register', part: '74195', note: '4-bit parallel access', keywords: ['shift', 'register'] },
];

for (const alias of SEQUENTIAL_ALIASES) {
  componentRegistry.alias({
    key: `seq-${alias.part}`,
    definitionId: `ic-${alias.part.toLowerCase()}`,
    label: `${alias.label} (${alias.part})`,
    sublabel: alias.note,
    category: 'sequential',
    keywords: [...alias.keywords, 'sequential', alias.part],
  });
}
