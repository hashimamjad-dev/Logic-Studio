/**
 * The project file format.
 *
 * JSON is the source of truth for a ProtoLab experiment: human readable, versioned,
 * and validated on the way in. Nothing in a project file is ever executed, and every
 * field is checked against this schema before it reaches the circuit model, so a
 * damaged or hostile file produces a clear error rather than a broken circuit.
 */

import type { PropertyValue, Rotation } from '../core/types';

export const PROJECT_FORMAT = 'protolab-project';
export const PROJECT_VERSION = 1;

export interface ProjectMetadata {
  name: string;
  description?: string;
  author?: string;
  created?: string;
  modified?: string;
}

export type SerializedConnection =
  | { type: 'hole'; board: string; hole: string }
  | { type: 'pin'; component: string; pin: number }
  | { type: 'junction'; junction: string };

export interface SerializedBoard {
  id: string;
  definition: string;
  position: { x: number; y: number };
}

export interface SerializedComponent {
  id: string;
  reference: string;
  definition: string;
  position: { x: number; y: number };
  rotation: Rotation;
  properties: Record<string, PropertyValue>;
}

export interface SerializedWire {
  id: string;
  from: SerializedConnection;
  to: SerializedConnection;
  corners: { x: number; y: number }[];
  color: string;
}

export interface SerializedJunction {
  id: string;
  wire: string;
  position: { x: number; y: number };
}

export interface SerializedView {
  panX: number;
  panY: number;
  zoom: number;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  project: ProjectMetadata;
  boards: SerializedBoard[];
  components: SerializedComponent[];
  wires: SerializedWire[];
  junctions: SerializedJunction[];
  settings: Record<string, PropertyValue>;
  view?: SerializedView;
}

export class ProjectValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`This file is not a valid ProtoLab project:\n- ${problems.join('\n- ')}`);
    this.name = 'ProjectValidationError';
    this.problems = problems;
  }
}

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: Json): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value: Json, where: string, problems: string[]): { x: number; y: number } {
  if (!isObject(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    problems.push(`${where} must be a point with numeric x and y.`);
    return { x: 0, y: 0 };
  }
  return { x: value.x, y: value.y };
}

function readRotation(value: Json, where: string, problems: string[]): Rotation {
  if (value === 0 || value === 90 || value === 180 || value === 270) return value;
  problems.push(`${where} must be a rotation of 0, 90, 180 or 270.`);
  return 0;
}

function readProperties(value: Json, where: string, problems: string[]): Record<string, PropertyValue> {
  if (value === undefined) return {};
  if (!isObject(value)) {
    problems.push(`${where} must be an object of property values.`);
    return {};
  }
  const out: Record<string, PropertyValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'boolean' || isFiniteNumber(raw)) {
      out[key] = raw;
    } else {
      // Anything that is not a plain scalar is dropped rather than trusted. Project
      // files never carry structured data into a component.
      problems.push(`${where}.${key} was ignored: only text, numbers and true/false are allowed.`);
    }
  }
  return out;
}

function readConnection(value: Json, where: string, problems: string[]): SerializedConnection | undefined {
  if (!isObject(value)) {
    problems.push(`${where} must be a connection object.`);
    return undefined;
  }
  switch (value.type) {
    case 'hole':
      if (typeof value.board !== 'string' || typeof value.hole !== 'string') {
        problems.push(`${where} is a hole connection but is missing the board or hole name.`);
        return undefined;
      }
      return { type: 'hole', board: value.board, hole: value.hole };
    case 'pin':
      if (typeof value.component !== 'string' || !isFiniteNumber(value.pin)) {
        problems.push(`${where} is a pin connection but is missing the component id or pin number.`);
        return undefined;
      }
      return { type: 'pin', component: value.component, pin: value.pin };
    case 'junction':
      if (typeof value.junction !== 'string') {
        problems.push(`${where} is a junction connection but is missing the junction id.`);
        return undefined;
      }
      return { type: 'junction', junction: value.junction };
    default:
      problems.push(`${where} has an unknown connection type ${JSON.stringify(value.type)}.`);
      return undefined;
  }
}

/**
 * Turn arbitrary parsed JSON into a `ProjectFile`, or throw with every problem
 * found. The caller gets all the errors at once, which is far more useful than
 * failing at the first bad field.
 */
export function parseProjectFile(raw: Json): ProjectFile {
  const problems: string[] = [];
  if (!isObject(raw)) throw new ProjectValidationError(['The file does not contain a JSON object.']);

  if (raw.format !== PROJECT_FORMAT) {
    problems.push(
      `Expected a "${PROJECT_FORMAT}" file but found ${JSON.stringify(raw.format ?? 'nothing')}.`,
    );
  }
  const version = isFiniteNumber(raw.version) ? raw.version : 0;
  if (version < 1) problems.push('The file does not declare a format version.');
  if (version > PROJECT_VERSION) {
    problems.push(
      `This project was written by a newer version of ProtoLab (format ${version}, this build understands ${PROJECT_VERSION}).`,
    );
  }
  if (problems.length > 0) throw new ProjectValidationError(problems);

  const metaSource = isObject(raw.project) ? raw.project : {};
  const project: ProjectMetadata = {
    name: typeof metaSource.name === 'string' && metaSource.name.trim() ? metaSource.name : 'Untitled experiment',
    ...(typeof metaSource.description === 'string' ? { description: metaSource.description } : {}),
    ...(typeof metaSource.author === 'string' ? { author: metaSource.author } : {}),
    ...(typeof metaSource.created === 'string' ? { created: metaSource.created } : {}),
    ...(typeof metaSource.modified === 'string' ? { modified: metaSource.modified } : {}),
  };

  const boards: SerializedBoard[] = [];
  for (const [index, entry] of asArray(raw.boards).entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.definition !== 'string') {
      problems.push(`boards[${index}] must have an id and a definition.`);
      continue;
    }
    boards.push({
      id: entry.id,
      definition: entry.definition,
      position: readPoint(entry.position, `boards[${index}].position`, problems),
    });
  }

  const components: SerializedComponent[] = [];
  for (const [index, entry] of asArray(raw.components).entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.definition !== 'string') {
      problems.push(`components[${index}] must have an id and a definition.`);
      continue;
    }
    components.push({
      id: entry.id,
      reference: typeof entry.reference === 'string' ? entry.reference : entry.id,
      definition: entry.definition,
      position: readPoint(entry.position, `components[${index}].position`, problems),
      rotation: readRotation(entry.rotation ?? 0, `components[${index}].rotation`, problems),
      properties: readProperties(entry.properties, `components[${index}].properties`, problems),
    });
  }

  const wires: SerializedWire[] = [];
  for (const [index, entry] of asArray(raw.wires).entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      problems.push(`wires[${index}] must have an id.`);
      continue;
    }
    const from = readConnection(entry.from, `wires[${index}].from`, problems);
    const to = readConnection(entry.to, `wires[${index}].to`, problems);
    if (!from || !to) continue;
    wires.push({
      id: entry.id,
      from,
      to,
      corners: asArray(entry.corners).map((corner, cornerIndex) =>
        readPoint(corner, `wires[${index}].corners[${cornerIndex}]`, problems),
      ),
      color: typeof entry.color === 'string' ? entry.color : 'black',
    });
  }

  const junctions: SerializedJunction[] = [];
  for (const [index, entry] of asArray(raw.junctions).entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.wire !== 'string') {
      problems.push(`junctions[${index}] must have an id and the wire it sits on.`);
      continue;
    }
    junctions.push({
      id: entry.id,
      wire: entry.wire,
      position: readPoint(entry.position, `junctions[${index}].position`, problems),
    });
  }

  let view: SerializedView | undefined;
  if (isObject(raw.view) && isFiniteNumber(raw.view.zoom)) {
    view = {
      panX: isFiniteNumber(raw.view.panX) ? raw.view.panX : 0,
      panY: isFiniteNumber(raw.view.panY) ? raw.view.panY : 0,
      zoom: Math.min(8, Math.max(0.1, raw.view.zoom)),
    };
  }

  if (problems.length > 0) throw new ProjectValidationError(problems);

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    project,
    boards,
    components,
    wires,
    junctions,
    settings: readProperties(raw.settings, 'settings', problems),
    ...(view ? { view } : {}),
  };
}

function asArray(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Bring an older file up to the current format.
 *
 * There is only one format so far, so this is a pass-through - but the hook exists,
 * is called on every load and is covered by a test, so the first real migration has
 * somewhere to go.
 */
export function migrateProjectFile(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  let migrated = raw;
  // Future migrations chain here: if (version < 2) migrated = v1ToV2(migrated);
  if (version > 0 && version < PROJECT_VERSION) {
    migrated = { ...migrated, version: PROJECT_VERSION };
  }
  return migrated;
}
