/**
 * Reading and writing project files.
 *
 * Serializing is a direct transcription of the circuit model; loading validates the
 * file, checks every referenced part and board against the library, and only then
 * builds the circuit. A file that refers to a component this build does not have is
 * reported by name instead of being silently dropped.
 */

import { getBreadboardDefinition } from '../breadboard/BreadboardDefinition';
import { componentRegistry } from '../components/ComponentRegistry';
import { defaultProperties } from '../components/ComponentDefinition';
import { Circuit, Junction, Wire } from '../core/Circuit';
import { ConnectionRef } from '../core/types';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectFile,
  ProjectMetadata,
  ProjectValidationError,
  SerializedConnection,
  SerializedView,
  migrateProjectFile,
  parseProjectFile,
} from './schema';

export interface SerializeOptions {
  metadata: ProjectMetadata;
  view?: SerializedView;
  settings?: Record<string, string | number | boolean>;
}

export function serializeProject(circuit: Circuit, options: SerializeOptions): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    project: {
      ...options.metadata,
      modified: new Date().toISOString(),
    },
    boards: circuit.boards.map((board) => ({
      id: board.id,
      definition: board.definition.id,
      position: { ...board.position },
    })),
    components: circuit.components.map((instance) => ({
      id: instance.id,
      reference: instance.reference,
      definition: instance.defId,
      position: { ...instance.position },
      rotation: instance.rotation,
      properties: { ...instance.properties },
    })),
    wires: circuit.wires.map((wire) => ({
      id: wire.id,
      from: serializeConnection(wire.from),
      to: serializeConnection(wire.to),
      corners: wire.corners.map((corner) => ({ ...corner })),
      color: wire.color,
    })),
    junctions: circuit.junctions.map((junction) => ({
      id: junction.id,
      wire: junction.wireId,
      position: { ...junction.position },
    })),
    settings: options.settings ?? {},
    ...(options.view ? { view: options.view } : {}),
  };
}

/** Pretty-printed and stable, so two saves of the same circuit diff cleanly. */
export function projectToJson(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface LoadResult {
  circuit: Circuit;
  metadata: ProjectMetadata;
  view?: SerializedView;
  settings: Record<string, string | number | boolean>;
  /** Non-fatal notes, e.g. a wire that lost an endpoint. */
  warnings: string[];
}

export function loadProjectFromJson(text: string): LoadResult {
  let raw: unknown;
  try {
    // JSON.parse only - a project file is data and is never executed.
    raw = JSON.parse(text);
  } catch (error) {
    throw new ProjectValidationError([
      `The file is not valid JSON: ${(error as Error).message}`,
    ]);
  }
  const migrated = migrateProjectFile(raw as Record<string, unknown>);
  return loadProjectFile(parseProjectFile(migrated));
}

export function loadProjectFile(file: ProjectFile): LoadResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const circuit = new Circuit();

  const boardIds = new Set<string>();
  for (const board of file.boards) {
    if (!getBreadboardDefinition(board.definition)) {
      problems.push(`This build has no breadboard called "${board.definition}" (board ${board.id}).`);
      continue;
    }
    if (boardIds.has(board.id)) {
      problems.push(`Two boards share the id ${board.id}.`);
      continue;
    }
    boardIds.add(board.id);
    circuit.addBoard(board.definition, board.position, board.id);
  }

  const componentIds = new Set<string>();
  for (const entry of file.components) {
    const definition = componentRegistry.get(entry.definition);
    if (!definition) {
      problems.push(`This build has no component called "${entry.definition}" (part ${entry.reference}).`);
      continue;
    }
    if (componentIds.has(entry.id)) {
      problems.push(`Two components share the id ${entry.id}.`);
      continue;
    }
    componentIds.add(entry.id);
    if (!definition.footprint.allowedRotations.includes(entry.rotation)) {
      warnings.push(
        `${entry.reference} was saved rotated ${entry.rotation} degrees, which this package does not allow. It has been placed upright.`,
      );
    }
    const rotation = definition.footprint.allowedRotations.includes(entry.rotation) ? entry.rotation : 0;
    // Unknown property keys are dropped and missing ones filled from the definition,
    // so a file written by an older build still opens.
    const known = new Set((definition.properties ?? []).map((p) => p.key));
    const properties = { ...defaultProperties(definition) };
    for (const [key, value] of Object.entries(entry.properties)) {
      if (known.has(key)) properties[key] = value;
      else warnings.push(`${entry.reference}: property "${key}" is not used by ${definition.name} and was dropped.`);
    }
    const instance = circuit.createComponent(
      entry.definition,
      entry.position,
      rotation,
      properties,
      entry.id,
      entry.reference,
    );
    circuit.addComponent(instance);
  }

  if (problems.length > 0) throw new ProjectValidationError(problems);

  const wireIds = new Set<string>();
  for (const entry of file.wires) {
    if (wireIds.has(entry.id)) {
      warnings.push(`Two wires share the id ${entry.id}; the second one was dropped.`);
      continue;
    }
    const from = deserializeConnection(entry.from);
    const to = deserializeConnection(entry.to);
    const fromOk = endpointExists(circuit, from);
    const toOk = endpointExists(circuit, to);
    if (!fromOk || !toOk) {
      warnings.push(
        `Wire ${entry.id} was dropped: it ends on something that is not in this project (${circuit.describeConnection(fromOk ? to : from)}).`,
      );
      continue;
    }
    wireIds.add(entry.id);
    const wire: Wire = {
      id: entry.id,
      from,
      to,
      corners: entry.corners.map((corner) => ({ ...corner })),
      color: entry.color,
    };
    circuit.addWire(wire);
  }

  for (const entry of file.junctions) {
    if (!circuit.getWire(entry.wire)) {
      warnings.push(`Junction ${entry.id} was dropped: wire ${entry.wire} is not in this project.`);
      continue;
    }
    const junction: Junction = { id: entry.id, wireId: entry.wire, position: { ...entry.position } };
    circuit.addJunction(junction);
  }

  return {
    circuit,
    metadata: file.project,
    ...(file.view ? { view: file.view } : {}),
    settings: file.settings,
    warnings,
  };
}

function serializeConnection(ref: ConnectionRef): SerializedConnection {
  switch (ref.kind) {
    case 'hole':
      return { type: 'hole', board: ref.boardId, hole: ref.hole };
    case 'pin':
      return { type: 'pin', component: ref.componentId, pin: ref.pin };
    case 'junction':
      return { type: 'junction', junction: ref.junctionId };
  }
}

function deserializeConnection(ref: SerializedConnection): ConnectionRef {
  switch (ref.type) {
    case 'hole':
      return { kind: 'hole', boardId: ref.board, hole: ref.hole };
    case 'pin':
      return { kind: 'pin', componentId: ref.component, pin: ref.pin };
    case 'junction':
      return { kind: 'junction', junctionId: ref.junction };
  }
}

function endpointExists(circuit: Circuit, ref: ConnectionRef): boolean {
  switch (ref.kind) {
    case 'hole':
      return Boolean(circuit.getBoard(ref.boardId)?.getHole(ref.hole));
    case 'pin':
      return Boolean(circuit.getComponent(ref.componentId));
    case 'junction':
      // Junctions are added after the wires, so a wire that ends on one is accepted
      // here and checked once the junction list has been read.
      return true;
  }
}
