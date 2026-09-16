/**
 * Editor state: what is selected, what the cursor is doing, where the view is.
 *
 * Nothing here belongs in the circuit model - a project file has no idea what is
 * selected or how far the canvas is zoomed in (beyond an optional saved view), which
 * keeps the model clean and the file diffable.
 */

import type { GridPoint } from '../core/types';

/** Pixels per grid unit at 100% zoom. One grid unit is 0.1 in on a real board. */
export const BASE_PITCH = 14;

export type AppMode = 'design' | 'simulate';

export type Tool = 'select' | 'multiselect' | 'place' | 'wire' | 'probe';

export type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'wire'; id: string }
  | { kind: 'board'; id: string }
  | { kind: 'junction'; id: string }
  | { kind: 'pin'; componentId: string; pin: number }
  | { kind: 'hole'; boardId: string; hole: string }
  | { kind: 'net'; id: string };

export function selectionKey(selection: Selection): string {
  switch (selection.kind) {
    case 'pin':
      return `pin:${selection.componentId}:${selection.pin}`;
    case 'hole':
      return `hole:${selection.boardId}:${selection.hole}`;
    default:
      return `${selection.kind}:${selection.id}`;
  }
}

export interface ViewTransform {
  panX: number;
  panY: number;
  zoom: number;
}

export class EditorState {
  mode: AppMode = 'design';
  tool: Tool = 'select';
  /** Definition id waiting to be placed, set by the palette. */
  pendingPlacement: string | undefined;
  /** Colour applied to the next wire. */
  wireColor = 'red';
  theme: 'light' | 'dark' = 'dark';
  showLabels = true;

  selection: Selection[] = [];
  hover: Selection | undefined;

  view: ViewTransform = { panX: 60, panY: 120, zoom: 1 };

  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  /* --- selection ------------------------------------------------- */

  select(selection: Selection | Selection[] | undefined, additive = false): void {
    const next = selection === undefined ? [] : Array.isArray(selection) ? selection : [selection];
    if (!additive) {
      this.selection = next;
    } else {
      const keys = new Set(this.selection.map(selectionKey));
      for (const item of next) {
        const key = selectionKey(item);
        if (keys.has(key)) {
          this.selection = this.selection.filter((s) => selectionKey(s) !== key);
        } else {
          this.selection.push(item);
          keys.add(key);
        }
      }
    }
    this.notify();
  }

  isSelected(selection: Selection): boolean {
    const key = selectionKey(selection);
    return this.selection.some((s) => selectionKey(s) === key);
  }

  clearSelection(): void {
    if (this.selection.length === 0) return;
    this.selection = [];
    this.notify();
  }

  get selectedComponents(): string[] {
    return this.selection.filter((s) => s.kind === 'component').map((s) => s.id);
  }

  get selectedWires(): string[] {
    return this.selection.filter((s) => s.kind === 'wire').map((s) => s.id);
  }

  /* --- view ------------------------------------------------------ */

  get scale(): number {
    return BASE_PITCH * this.view.zoom;
  }

  toScreen(point: GridPoint): { x: number; y: number } {
    return { x: point.x * this.scale + this.view.panX, y: point.y * this.scale + this.view.panY };
  }

  toWorld(point: { x: number; y: number }): GridPoint {
    return { x: (point.x - this.view.panX) / this.scale, y: (point.y - this.view.panY) / this.scale };
  }

  panBy(dx: number, dy: number): void {
    this.view.panX += dx;
    this.view.panY += dy;
    this.notify();
  }

  /** Zoom about a screen point, so the thing under the cursor stays put. */
  zoomAt(screen: { x: number; y: number }, factor: number): void {
    const before = this.toWorld(screen);
    this.view.zoom = Math.min(4, Math.max(0.25, this.view.zoom * factor));
    const after = this.toWorld(screen);
    this.view.panX += (after.x - before.x) * this.scale;
    this.view.panY += (after.y - before.y) * this.scale;
    this.notify();
  }

  setZoom(zoom: number, center?: { x: number; y: number }): void {
    const target = Math.min(4, Math.max(0.25, zoom));
    if (center) {
      this.zoomAt(center, target / this.view.zoom);
      return;
    }
    this.view.zoom = target;
    this.notify();
  }

  setMode(mode: AppMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'simulate') {
      this.pendingPlacement = undefined;
      this.tool = 'select';
    }
    this.notify();
  }

  setTool(tool: Tool): void {
    if (this.tool === tool && !this.pendingPlacement) return;
    this.tool = tool;
    if (tool !== 'place') this.pendingPlacement = undefined;
    this.notify();
  }

  beginPlacement(definitionId: string): void {
    this.pendingPlacement = definitionId;
    this.tool = 'place';
    this.notify();
  }

  cancelPlacement(): void {
    if (!this.pendingPlacement) return;
    this.pendingPlacement = undefined;
    this.tool = 'select';
    this.notify();
  }
}
