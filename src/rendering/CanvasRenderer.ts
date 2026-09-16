/**
 * The workspace renderer.
 *
 * One canvas, drawn back to front: grid, boards, wires, parts, then overlays for
 * whatever the cursor is doing. The renderer is a pure function of the model plus the
 * editor state - it never stores circuit information of its own, so what you see is
 * always what the model says.
 */

import type { Circuit, ComponentInstance, Wire } from '../core/Circuit';
import { bodyOf, defaultProperties, pinsOf } from '../components/ComponentDefinition';
import { componentRegistry } from '../components/ComponentRegistry';
import type { EditorState, Selection } from '../editor/EditorState';
import type { GridPoint, PropertyValue, Rotation } from '../core/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { ConnectionTarget } from '../wiring/ConnectionFinder';
import { routeOrthogonal } from '../wiring/WireRouter';
import { drawBreadboard } from './BreadboardRenderer';
import { drawComponent, stateColor } from './ComponentRenderer';
import { Theme, themeFor, wireColorHex } from './theme';

export interface PlacementPreview {
  definitionId: string;
  position: GridPoint;
  rotation: Rotation;
  properties: Record<string, PropertyValue>;
  valid: boolean;
}

export interface WireDraft {
  points: GridPoint[];
  color: string;
  valid: boolean;
}

export interface Scene {
  circuit: Circuit;
  engine: SimulationEngine;
  editor: EditorState;
  hoverTarget?: ConnectionTarget | undefined;
  placement?: PlacementPreview | undefined;
  wireDraft?: WireDraft | undefined;
  marquee?: { x: number; y: number; width: number; height: number } | undefined;
  /** Net highlighted because it is selected or hovered. */
  highlightNet?: string | undefined;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = context;
  }

  resize(width: number, height: number, dpr = window.devicePixelRatio || 1): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  draw(scene: Scene): void {
    const theme = themeFor(scene.editor.theme);
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = theme.canvasBackground;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawGrid(scene, theme);
    this.drawBoards(scene, theme);
    this.drawWires(scene, theme);
    this.drawComponents(scene, theme);
    this.drawOverlays(scene, theme);
  }

  /* ---------------------------------------------------------------- */

  private drawGrid(scene: Scene, theme: Theme): void {
    const { ctx } = this;
    const scale = scene.editor.scale;
    if (scale < 6) return;
    const { panX, panY } = scene.editor.view;
    const startX = Math.floor(-panX / scale) - 1;
    const startY = Math.floor(-panY / scale) - 1;
    const countX = Math.ceil(this.width / scale) + 2;
    const countY = Math.ceil(this.height / scale) + 2;

    ctx.save();
    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countY; j++) {
        const gx = startX + i;
        const gy = startY + j;
        const major = gx % 5 === 0 && gy % 5 === 0;
        if (!major && scale < 11) continue;
        ctx.fillStyle = major ? theme.gridDotMajor : theme.gridDot;
        const x = gx * scale + panX;
        const y = gy * scale + panY;
        ctx.fillRect(x - 0.5, y - 0.5, major ? 1.6 : 1, major ? 1.6 : 1);
      }
    }
    ctx.restore();
  }

  private drawBoards(scene: Scene, theme: Theme): void {
    const editor = scene.editor;
    const simulating = editor.mode === 'simulate';
    for (const board of scene.circuit.boards) {
      const origin = editor.toScreen(board.position);
      drawBreadboard(board, {
        ctx: this.ctx,
        theme,
        scale: editor.scale,
        originX: origin.x,
        originY: origin.y,
        showLabels: editor.showLabels,
        ...(simulating
          ? { netOfGroup: (groupId: string) => scene.engine.netValueOfGroup(groupId) }
          : {}),
      });

      if (editor.isSelected({ kind: 'board', id: board.id })) {
        const bounds = board.bounds();
        const topLeft = editor.toScreen({ x: bounds.x, y: bounds.y });
        this.ctx.strokeStyle = theme.selection;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
          topLeft.x - 2,
          topLeft.y - 2,
          bounds.width * editor.scale + 4,
          bounds.height * editor.scale + 4,
        );
      }
    }
  }

  private drawWires(scene: Scene, theme: Theme): void {
    const { ctx } = this;
    const editor = scene.editor;
    const simulating = editor.mode === 'simulate';

    for (const wire of scene.circuit.wires) {
      const path = scene.circuit.wirePath(wire);
      if (!path) continue;
      const routed = routeOrthogonal(path);
      const screen = routed.map((point) => editor.toScreen(point));
      const selected = editor.isSelected({ kind: 'wire', id: wire.id });
      const hovered = isHovered(editor.hover, { kind: 'wire', id: wire.id });
      const net = simulating ? scene.engine.netValueOfWire(wire.id) : undefined;
      const highlighted = scene.highlightNet !== undefined && net?.netId === scene.highlightNet;

      const thickness = Math.max(2, editor.scale * 0.3);

      if (selected || hovered || highlighted) {
        strokePath(ctx, screen, thickness + 6, selected ? theme.selection : theme.hover, 0.35);
      }

      // Jacket in the colour the user chose. This never means anything electrically.
      strokePath(ctx, screen, thickness + 1.5, 'rgba(0,0,0,0.25)', 1);
      strokePath(ctx, screen, thickness, wireColorHex(wire.color), 1);

      // In simulate mode a thin core shows the state of the net. It is an overlay on
      // top of the jacket, never a replacement for it.
      if (net && net.value !== 'Z') {
        strokePath(ctx, screen, Math.max(1, thickness * 0.34), stateColor(theme, net.value, net), 0.95);
      }
    }

    for (const junction of scene.circuit.junctions) {
      const point = editor.toScreen(junction.position);
      const radius = Math.max(2.5, editor.scale * 0.3);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = theme.junction;
      ctx.fill();
      ctx.strokeStyle = editor.isSelected({ kind: 'junction', id: junction.id })
        ? theme.selection
        : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  private drawComponents(scene: Scene, theme: Theme): void {
    const editor = scene.editor;
    const simulating = editor.mode === 'simulate';
    for (const instance of scene.circuit.components) {
      const definition = scene.circuit.definitionOf(instance);
      const origin = editor.toScreen(instance.position);
      drawComponent(instance, definition, {
        ctx: this.ctx,
        theme,
        scale: editor.scale,
        origin,
        runtime: scene.engine.runtime(instance.id),
        netOfPin: (pin) => scene.engine.netValueOfPin(instance.id, pin),
        simulating,
        selected: editor.isSelected({ kind: 'component', id: instance.id }),
        hovered: isHovered(editor.hover, { kind: 'component', id: instance.id }),
        showLabels: editor.showLabels,
      });
    }
  }

  private drawOverlays(scene: Scene, theme: Theme): void {
    const { ctx } = this;
    const editor = scene.editor;

    // Placement preview.
    if (scene.placement) {
      const definition = componentRegistry.get(scene.placement.definitionId);
      if (definition) {
        const origin = editor.toScreen(scene.placement.position);
        const instance: ComponentInstance = {
          id: '__preview__',
          defId: scene.placement.definitionId,
          reference: definition.refPrefix,
          position: scene.placement.position,
          rotation: scene.placement.rotation,
          properties: { ...defaultProperties(definition), ...scene.placement.properties },
        };
        drawComponent(instance, definition, {
          ctx,
          theme,
          scale: editor.scale,
          origin,
          simulating: false,
          selected: false,
          hovered: false,
          ghost: scene.placement.valid ? 'valid' : 'invalid',
          showLabels: editor.showLabels,
        });
      }
    }

    // Wire being routed.
    if (scene.wireDraft && scene.wireDraft.points.length > 1) {
      const routed = routeOrthogonal(scene.wireDraft.points);
      const screen = routed.map((point) => editor.toScreen(point));
      const thickness = Math.max(2, editor.scale * 0.3);
      strokePath(ctx, screen, thickness, wireColorHex(scene.wireDraft.color), 0.85);
      if (!scene.wireDraft.valid) {
        strokePath(ctx, screen, thickness + 4, theme.invalidPlacement, 0.3);
      }
      for (const corner of screen.slice(1, -1)) {
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, Math.max(2, editor.scale * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = wireColorHex(scene.wireDraft.color);
        ctx.fill();
      }
    }

    // What the cursor is over.
    if (scene.hoverTarget) {
      const point = editor.toScreen(scene.hoverTarget.position);
      const radius = Math.max(4, editor.scale * 0.5);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = theme.hover;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = theme.hover;
      ctx.fill();
    }

    // Marquee selection.
    if (scene.marquee) {
      ctx.fillStyle = theme.selectionFill;
      ctx.strokeStyle = theme.selection;
      ctx.lineWidth = 1;
      ctx.fillRect(scene.marquee.x, scene.marquee.y, scene.marquee.width, scene.marquee.height);
      ctx.strokeRect(scene.marquee.x, scene.marquee.y, scene.marquee.width, scene.marquee.height);
    }

    // Selected pins and holes get a ring so the inspector selection is visible.
    for (const selection of editor.selection) {
      if (selection.kind === 'pin') {
        const position = scene.circuit.pinPosition(selection.componentId, selection.pin);
        if (position) this.ring(editor.toScreen(position), theme.selection, editor.scale);
      } else if (selection.kind === 'hole') {
        const board = scene.circuit.getBoard(selection.boardId);
        const hole = board?.getHole(selection.hole);
        if (board && hole) this.ring(editor.toScreen(board.worldPosition(hole)), theme.selection, editor.scale);
      }
    }
  }

  private ring(point: { x: number; y: number }, color: string, scale: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(5, scale * 0.55), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** Hit test a wire from screen coordinates, used by the editor. */
  static wireAt(circuit: Circuit, point: GridPoint, tolerance: number): Wire | undefined {
    let best: { wire: Wire; distance: number } | undefined;
    for (const wire of circuit.wires) {
      const path = circuit.wirePath(wire);
      if (!path) continue;
      const routed = routeOrthogonal(path);
      for (let i = 0; i < routed.length - 1; i++) {
        const distance = distanceToSegment(routed[i], routed[i + 1], point);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { wire, distance };
      }
    }
    return best?.wire;
  }

  /** Bounding box of a part in world units, used for marquee selection. */
  static componentBounds(circuit: Circuit, instance: ComponentInstance) {
    const definition = circuit.definitionOf(instance);
    const body = bodyOf(definition, instance.properties);
    const pins = pinsOf(definition, instance.properties);
    void body;
    void pins;
    return circuit.componentBounds(instance);
  }
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  width: number,
  color: string,
  alpha: number,
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function distanceToSegment(a: GridPoint, b: GridPoint, p: GridPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function isHovered(hover: Selection | undefined, candidate: Selection): boolean {
  if (!hover) return false;
  if (hover.kind !== candidate.kind) return false;
  if (hover.kind === 'pin' || hover.kind === 'hole') return false;
  return (hover as { id: string }).id === (candidate as { id: string }).id;
}
