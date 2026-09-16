/**
 * The workbench: the controller that ties the model, the simulator, the canvas and
 * the panels together.
 *
 * Interaction rules worth knowing when reading this file:
 *
 *  - wiring is modeless. Pressing on any pin or hole starts a wire; there is no wire
 *    tool to enter or leave;
 *  - dragging a part is "sticky": the part only moves to positions the placement
 *    validator accepts, and the status bar says why a position was refused;
 *  - every change to the circuit goes through a command so that undo restores the
 *    model rather than a picture of it;
 *  - in Simulate mode the board is live: clicking a switch flips it immediately.
 *    Those runtime flips are not pushed onto the undo stack, because they are
 *    operating the circuit rather than editing it.
 */

import {
  BREADBOARD_DEFINITIONS,
  getBreadboardDefinition,
} from '../breadboard/BreadboardDefinition';
import {
  findNearestLegalPlacement,
  validatePlacement,
} from '../breadboard/PlacementValidator';
import { bodyOf, defaultProperties } from '../components/ComponentDefinition';
import { componentRegistry } from '../components/ComponentRegistry';
import { Circuit, ComponentInstance, Wire } from '../core/Circuit';
import {
  ConnectionRef,
  Diagnostic,
  GridPoint,
  PropertyValue,
  Rotation,
  rectsOverlap,
} from '../core/types';
import { EditorState, Selection } from '../editor/EditorState';
import { UndoManager } from '../editor/UndoManager';
import {
  AddBoardCommand,
  AddComponentCommand,
  AddJunctionCommand,
  AddWireCommand,
  Command,
  CompositeCommand,
  DeleteCommand,
  MoveComponentCommand,
  SetPropertyCommand,
  UpdateWireCommand,
} from '../editor/commands';
import { LogicAnalyzer } from '../instruments/LogicAnalyzer';
import {
  loadProjectFromJson,
  projectToJson,
  serializeProject,
} from '../persistence/ProjectSerializer';
import { ProjectMetadata, ProjectValidationError } from '../persistence/schema';
import { CanvasRenderer, PlacementPreview, Scene, WireDraft } from '../rendering/CanvasRenderer';
import { SimulationEngine } from '../simulation/SimulationEngine';
import {
  ConnectionTarget,
  describeWireProblem,
  findConnectionTarget,
  snapToGrid,
} from '../wiring/ConnectionFinder';
import { dragSegment, hitTestPath, routeOrthogonal, simplifyCorners } from '../wiring/WireRouter';
import { collectInputs, collectOutputs, generateTruthTable } from '../suite/TruthTable';
import { AnalyzerPanel } from '../ui/AnalyzerPanel';
import { ComponentPalette } from '../ui/ComponentPalette';
import { Dialogs, ShortcutEntry } from '../ui/Dialogs';
import { InspectorPanel } from '../ui/InspectorPanel';
import { StatusBar } from '../ui/StatusBar';
import { Toolbar } from '../ui/Toolbar';
import { TruthTablePanel } from '../ui/TruthTablePanel';
import { WIRE_COLORS } from '../rendering/theme';
import { EXAMPLES, buildEmptyProject } from './examples';
import { SHORTCUTS } from './shortcuts';

type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; lastScreen: { x: number; y: number } }
  | { kind: 'marquee'; start: { x: number; y: number }; current: { x: number; y: number }; additive: boolean }
  | {
      kind: 'dragParts';
      ids: string[];
      grabWorld: GridPoint;
      originals: Map<string, { position: GridPoint; rotation: Rotation }>;
      lastGood: Map<string, GridPoint>;
      moved: boolean;
    }
  | { kind: 'dragBoard'; boardId: string; grabWorld: GridPoint; original: GridPoint }
  | {
      kind: 'wire';
      from: ConnectionRef;
      /** Junction to create when the wire commits, if it started on a wire. */
      startJunction?: { wireId: string; position: GridPoint };
      points: GridPoint[];
      downScreen: { x: number; y: number };
    }
  | {
      kind: 'dragSegment';
      wireId: string;
      segment: number;
      grabWorld: GridPoint;
      originalCorners: GridPoint[];
      originalPath: GridPoint[];
      moved: boolean;
    }
  | { kind: 'press'; componentId: string };

interface ClipboardEntry {
  defId: string;
  offset: GridPoint;
  rotation: Rotation;
  properties: Record<string, PropertyValue>;
  localId: string;
}

interface ClipboardWire {
  from: { localId: string; pin: number };
  to: { localId: string; pin: number };
  corners: GridPoint[];
  color: string;
}

export class Workbench {
  circuit: Circuit;
  engine: SimulationEngine;
  readonly editor = new EditorState();
  undo: UndoManager;

  private renderer: CanvasRenderer;
  private canvas: HTMLCanvasElement;
  private toolbar: Toolbar;
  private palette: ComponentPalette;
  private inspector: InspectorPanel;
  private status: StatusBar;
  private dialogs: Dialogs;
  private analyzerPanel: AnalyzerPanel;
  private truthPanel: TruthTablePanel;
  readonly analyzer = new LogicAnalyzer();

  private metadata: ProjectMetadata = { name: 'Untitled experiment' };
  private dirty = false;
  private interaction: Interaction = { kind: 'idle' };
  private hoverTarget: ConnectionTarget | undefined;
  private pointerScreen = { x: 0, y: 0 };
  private pointerWorld: GridPoint = { x: 0, y: 0 };
  private statusHint = 'Pick a part from the library, or hover a pin to start a wire.';
  private diagnostics: Diagnostic[] = [];
  private running = false;
  private simTimeMs = 0;
  private needsRender = true;
  private lastFrame = 0;
  private lastDiagnosticRefresh = 0;
  private spaceHeld = false;
  private clipboard: { parts: ClipboardEntry[]; wires: ClipboardWire[] } | undefined;

  constructor(private host: HTMLElement) {
    const layout = this.buildLayout();
    this.canvas = layout.canvas;
    this.renderer = new CanvasRenderer(this.canvas);

    this.circuit = buildEmptyProject();
    this.engine = new SimulationEngine(this.circuit);
    this.undo = new UndoManager(this.circuit);

    this.dialogs = new Dialogs(document.body);
    this.toolbar = new Toolbar(layout.toolbarHost, {
      onMode: (mode) => this.setMode(mode),
      onNew: () => this.newProject(),
      onOpen: () => this.openProject(),
      onSave: () => this.saveProject(),
      onExport: () => this.exportMenu(),
      onUndo: () => this.doUndo(),
      onRedo: () => this.doRedo(),
      onRun: () => this.toggleRun(),
      onStep: () => this.stepSimulation(),
      onResetSimulation: () => this.resetSimulation(),
      onToggleAnalyzer: () => this.toggleAnalyzer(),
      onToggleTruthTable: () => this.toggleTruthTable(),
      onToggleTheme: () => this.toggleTheme(),
      onHelp: () => this.dialogs.showShortcuts(SHORTCUTS as ShortcutEntry[]),
      onZoom: (delta) => this.zoomStep(delta),
      onFit: () => this.fitToView(),
    });

    this.palette = new ComponentPalette(layout.paletteHost, {
      onPlaceComponent: (id) => this.armPlacement(id),
      onPlaceBoard: (id) => this.armPlacement(id),
      onSelectTool: (tool) => {
        this.editor.setTool(tool);
        this.refreshPanels();
      },
      onWireColor: (color) => {
        this.editor.wireColor = color;
        this.refreshPanels();
      },
    });

    this.inspector = new InspectorPanel(layout.inspectorHost, {
      onProperty: (componentId, key, value) => this.setProperty(componentId, key, value),
      onSelect: (selection) => {
        this.editor.select(selection);
        this.refreshPanels();
      },
      onWireColor: (wireId, color) => this.setWireColor(wireId, color),
      onDelete: () => this.deleteSelection(),
      onRotate: () => this.rotateSelection(),
    });

    this.status = new StatusBar(layout.statusHost, {
      onSelectDiagnostic: (diagnostic) => this.focusDiagnostic(diagnostic),
    });

    this.analyzerPanel = new AnalyzerPanel(layout.bottomHost, {
      onAddSelected: () => this.addSelectedNetToAnalyzer(),
      onRemove: (netId) => {
        this.analyzer.removeChannel(netId);
        this.requestRender();
      },
      onClear: () => this.analyzer.clear(),
      onToggleCapture: () => {
        this.analyzer.capturing = !this.analyzer.capturing;
      },
      onClose: () => this.toggleAnalyzer(false),
      onWindow: (ms) => {
        this.analyzer.windowMs = ms;
      },
    });

    this.truthPanel = new TruthTablePanel(layout.bottomHost, {
      onGenerate: () => this.generateTruthTable(),
      onCopy: (text) => this.copyText(text),
      onClose: () => this.toggleTruthTable(false),
    });

    this.bindCanvas();
    this.bindKeyboard();
    this.bindCircuit();
    this.editor.onChange(() => this.requestRender());
    this.undo.onChange(() => this.refreshPanels());

    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();
    this.refreshPanels();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------------------------------------------------------- *
   * Layout
   * ---------------------------------------------------------------- */

  private buildLayout() {
    this.host.classList.add('workbench');
    const toolbarHost = document.createElement('div');
    toolbarHost.className = 'region-toolbar';
    const paletteHost = document.createElement('aside');
    paletteHost.className = 'region-palette';
    paletteHost.setAttribute('aria-label', 'Component library');
    const canvasHost = document.createElement('main');
    canvasHost.className = 'region-canvas';
    const canvas = document.createElement('canvas');
    canvas.className = 'workspace-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Circuit workspace');
    canvasHost.append(canvas);
    const bottomHost = document.createElement('div');
    bottomHost.className = 'region-bottom';
    canvasHost.append(bottomHost);
    const inspectorHost = document.createElement('aside');
    inspectorHost.className = 'region-inspector';
    inspectorHost.setAttribute('aria-label', 'Inspector');
    const statusHost = document.createElement('div');
    statusHost.className = 'region-status';

    this.host.append(toolbarHost, paletteHost, canvasHost, inspectorHost, statusHost);
    return { toolbarHost, paletteHost, canvasHost, bottomHost, inspectorHost, statusHost, canvas };
  }

  private handleResize(): void {
    const host = this.canvas.parentElement!;
    this.renderer.resize(host.clientWidth, host.clientHeight);
    this.requestRender();
  }

  private bindCircuit(): void {
    this.circuit.onChange(() => {
      this.dirty = true;
      this.requestRender();
      this.refreshPanels();
    });
  }

  /* ---------------------------------------------------------------- *
   * Frame loop
   * ---------------------------------------------------------------- */

  private requestRender(): void {
    this.needsRender = true;
  }

  private frame(timestamp: number): void {
    const dtMs = this.lastFrame === 0 ? 0 : Math.min(100, timestamp - this.lastFrame);
    this.lastFrame = timestamp;

    this.engine.syncTopology();

    if (this.editor.mode === 'simulate' && this.running && dtMs > 0) {
      // One millisecond of wall clock is one millisecond of simulated time, so a
      // 1 Hz clock really does tick once a second.
      this.engine.advance(dtMs * 1e6);
      this.simTimeMs += dtMs;
      this.analyzer.sample(this.engine, this.simTimeMs);
      this.needsRender = true;
    }

    if (timestamp - this.lastDiagnosticRefresh > 180) {
      this.lastDiagnosticRefresh = timestamp;
      const next = this.engine.refreshDiagnostics();
      if (!sameDiagnostics(next, this.diagnostics)) {
        this.diagnostics = next;
        this.updateStatus();
      } else {
        this.diagnostics = next;
      }
      if (this.analyzerPanel.isOpen) {
        this.analyzerPanel.update(this.analyzer, this.engine, this.editor.theme, this.simTimeMs);
      }
      // While the circuit is live the inspector is an instrument, so it has to keep
      // up with the solver rather than only refreshing when the model is edited.
      if (this.editor.mode === 'simulate') {
        this.inspector.update({ circuit: this.circuit, engine: this.engine, editor: this.editor });
      }
    }

    if (this.needsRender) {
      this.needsRender = false;
      this.render();
      this.updateStatus();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private render(): void {
    const scene: Scene = {
      circuit: this.circuit,
      engine: this.engine,
      editor: this.editor,
      hoverTarget: this.hoverTarget,
      placement: this.placementPreview(),
      wireDraft: this.wireDraft(),
      marquee: this.marqueeRect(),
      highlightNet: this.highlightedNet(),
    };
    this.renderer.draw(scene);
  }

  private placementPreview(): PlacementPreview | undefined {
    const pending = this.editor.pendingPlacement;
    if (!pending || isBoardDefinition(pending)) return undefined;
    const definition = componentRegistry.get(pending);
    if (!definition) return undefined;
    const properties = defaultProperties(definition);
    const position = this.placementPosition(pending);
    const result = validatePlacement(this.circuit, {
      definition,
      position,
      rotation: this.placementRotation,
      properties,
    });
    return { definitionId: pending, position, rotation: this.placementRotation, properties, valid: result.valid };
  }

  private placementRotation: Rotation = 0;

  private placementPosition(definitionId: string): GridPoint {
    const definition = componentRegistry.get(definitionId);
    if (!definition) return snapToGrid(this.pointerWorld);
    if (definition.footprint.requiresBoard) return snapToGrid(this.pointerWorld);
    // Bench modules are grabbed by the middle of their body.
    const body = bodyOf(definition, defaultProperties(definition));
    return snapToGrid({
      x: this.pointerWorld.x - body.width / 2,
      y: this.pointerWorld.y - body.height / 2,
    });
  }

  private wireDraft(): WireDraft | undefined {
    if (this.interaction.kind !== 'wire') return undefined;
    const cursor = this.hoverTarget ? this.hoverTarget.position : snapToGrid(this.pointerWorld);
    const points = [...this.interaction.points, cursor];
    const valid = this.hoverTarget
      ? !describeWireProblem(this.circuit, this.interaction.from, this.targetRef(this.hoverTarget))
      : true;
    return { points, color: this.editor.wireColor, valid };
  }

  private marqueeRect() {
    if (this.interaction.kind !== 'marquee') return undefined;
    const { start, current } = this.interaction;
    return {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  }

  private highlightedNet(): string | undefined {
    const selection = this.editor.selection[0];
    if (!selection) return undefined;
    switch (selection.kind) {
      case 'net':
        return selection.id;
      case 'wire':
        return this.engine.netValueOfWire(selection.id)?.netId;
      case 'pin':
        return this.engine.netValueOfPin(selection.componentId, selection.pin)?.netId;
      case 'hole': {
        const board = this.circuit.getBoard(selection.boardId);
        const hole = board?.getHole(selection.hole);
        return hole ? this.engine.netValueOfGroup(hole.groupId)?.netId : undefined;
      }
      default:
        return undefined;
    }
  }

  /* ---------------------------------------------------------------- *
   * Panels
   * ---------------------------------------------------------------- */

  private refreshPanels(): void {
    this.toolbar.update({
      mode: this.editor.mode,
      running: this.running,
      canUndo: this.undo.canUndo,
      canRedo: this.undo.canRedo,
      undoLabel: this.undo.nextUndoLabel,
      redoLabel: this.undo.nextRedoLabel,
      analyzerOpen: this.analyzerPanel.isOpen,
      truthTableOpen: this.truthPanel.isOpen,
      theme: this.editor.theme,
      projectName: this.metadata.name,
      dirty: this.dirty,
    });
    this.palette.update({
      tool: this.editor.tool,
      pending: this.editor.pendingPlacement,
      wireColor: this.editor.wireColor,
    });
    this.inspector.update({ circuit: this.circuit, engine: this.engine, editor: this.editor });
    this.updateStatus();
  }

  private updateStatus(): void {
    this.status.update({
      hint: this.statusHint,
      hover: this.hoverTarget ? `${this.hoverTarget.label}${this.hoverTarget.detail ? ` — ${this.hoverTarget.detail}` : ''}` : undefined,
      diagnostics: this.diagnostics,
      zoom: this.editor.view.zoom,
      mode: this.editor.mode,
      running: this.running,
      simTimeMs: this.simTimeMs,
      components: this.circuit.components.length,
      nets: this.engine.nets.nets.length,
    });
  }

  /* ---------------------------------------------------------------- *
   * Canvas interaction
   * ---------------------------------------------------------------- */

  private bindCanvas(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('pointerleave', () => {
      this.hoverTarget = undefined;
      this.requestRender();
    });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onRightClick();
    });
  }

  private screenOf(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    this.canvas.focus();
    this.pointerScreen = this.screenOf(event);
    this.pointerWorld = this.editor.toWorld(this.pointerScreen);
    this.updateHover();

    if (event.button === 1 || this.spaceHeld) {
      this.interaction = { kind: 'pan', lastScreen: this.pointerScreen };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    // Finish or extend a wire that is already being routed.
    if (this.interaction.kind === 'wire') {
      this.continueWire();
      return;
    }

    if (this.editor.pendingPlacement) {
      this.commitPlacement(event.shiftKey);
      return;
    }

    if (this.editor.mode === 'simulate') {
      this.simulateModePress();
      return;
    }

    // Design mode.
    const target = this.hoverTarget;
    if (target && (target.kind === 'pin' || target.kind === 'hole' || target.kind === 'junction')) {
      this.beginWire(target);
      return;
    }
    if (target && target.kind === 'wire' && target.wireId) {
      // Pressing a wire selects it; dragging moves that segment.
      this.editor.select({ kind: 'wire', id: target.wireId }, event.shiftKey);
      this.beginSegmentDrag(target.wireId);
      this.refreshPanels();
      return;
    }

    const part = this.componentAt(this.pointerWorld);
    if (part) {
      if (!this.editor.isSelected({ kind: 'component', id: part.id }) && !event.shiftKey) {
        this.editor.select({ kind: 'component', id: part.id });
      } else if (event.shiftKey) {
        this.editor.select({ kind: 'component', id: part.id }, true);
      }
      this.beginPartDrag();
      this.refreshPanels();
      return;
    }

    const board = this.circuit.boardAt(this.pointerWorld.x, this.pointerWorld.y);
    if (board && this.editor.tool !== 'multiselect') {
      this.editor.select({ kind: 'board', id: board.id }, event.shiftKey);
      this.interaction = {
        kind: 'dragBoard',
        boardId: board.id,
        grabWorld: { ...this.pointerWorld },
        original: { ...board.position },
      };
      this.refreshPanels();
      return;
    }

    if (!event.shiftKey) this.editor.clearSelection();
    this.interaction = {
      kind: 'marquee',
      start: this.pointerScreen,
      current: this.pointerScreen,
      additive: event.shiftKey,
    };
    this.refreshPanels();
  }

  private onPointerMove(event: PointerEvent): void {
    this.pointerScreen = this.screenOf(event);
    this.pointerWorld = this.editor.toWorld(this.pointerScreen);

    switch (this.interaction.kind) {
      case 'pan': {
        const dx = this.pointerScreen.x - this.interaction.lastScreen.x;
        const dy = this.pointerScreen.y - this.interaction.lastScreen.y;
        this.interaction.lastScreen = this.pointerScreen;
        this.editor.panBy(dx, dy);
        return;
      }
      case 'marquee':
        this.interaction.current = this.pointerScreen;
        this.requestRender();
        return;
      case 'dragParts':
        this.updatePartDrag();
        return;
      case 'dragBoard': {
        const dx = Math.round(this.pointerWorld.x - this.interaction.grabWorld.x);
        const dy = Math.round(this.pointerWorld.y - this.interaction.grabWorld.y);
        const board = this.circuit.getBoard(this.interaction.boardId);
        board?.moveTo({ x: this.interaction.original.x + dx, y: this.interaction.original.y + dy });
        this.requestRender();
        return;
      }
      case 'dragSegment':
        this.updateSegmentDrag();
        return;
      default:
        break;
    }

    this.updateHover();
    this.requestRender();
  }

  private onPointerUp(event: PointerEvent): void {
    switch (this.interaction.kind) {
      case 'pan':
        this.interaction = { kind: 'idle' };
        return;
      case 'marquee': {
        this.finishMarquee();
        return;
      }
      case 'dragParts':
        this.finishPartDrag();
        return;
      case 'dragBoard':
        this.finishBoardDrag();
        return;
      case 'dragSegment':
        this.finishSegmentDrag();
        return;
      case 'press': {
        const instance = this.circuit.getComponent(this.interaction.componentId);
        if (instance && instance.defId === 'in-button') {
          instance.properties.pressed = false;
          this.circuit.emit('properties');
        }
        this.interaction = { kind: 'idle' };
        return;
      }
      case 'wire': {
        // A drag from a pin straight onto a target commits the wire; a short click
        // leaves the wire in routing mode so corners can be placed.
        const moved =
          Math.hypot(
            this.pointerScreen.x - this.interaction.downScreen.x,
            this.pointerScreen.y - this.interaction.downScreen.y,
          ) > 6;
        if (moved && this.hoverTarget) this.continueWire();
        return;
      }
      default:
        void event;
        return;
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const screen = this.screenOf(event);
    if (event.ctrlKey || event.metaKey || !event.shiftKey) {
      this.editor.zoomAt(screen, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    } else {
      this.editor.panBy(-event.deltaY, 0);
    }
  }

  private onRightClick(): void {
    if (this.interaction.kind === 'wire') {
      if (this.interaction.points.length > 1) {
        this.interaction.points.pop();
        this.requestRender();
      } else {
        this.cancelInteraction();
      }
      return;
    }
    if (this.editor.pendingPlacement) this.cancelInteraction();
  }

  private updateHover(): void {
    const includeWires = this.editor.mode === 'design';
    this.hoverTarget = findConnectionTarget(this.circuit, this.pointerWorld, {
      includeWires,
      tolerance: 0.55,
    });
    const part = this.componentAt(this.pointerWorld);
    this.editor.hover = part ? { kind: 'component', id: part.id } : undefined;
    if (!this.editor.hover && this.hoverTarget?.kind === 'wire' && this.hoverTarget.wireId) {
      this.editor.hover = { kind: 'wire', id: this.hoverTarget.wireId };
    }
  }

  private componentAt(point: GridPoint): ComponentInstance | undefined {
    // Later parts are drawn on top, so search backwards.
    for (let i = this.circuit.components.length - 1; i >= 0; i--) {
      const instance = this.circuit.components[i];
      const bounds = this.circuit.componentBounds(instance);
      if (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      ) {
        return instance;
      }
    }
    return undefined;
  }

  /* ---------------------------------------------------------------- *
   * Placement
   * ---------------------------------------------------------------- */

  private armPlacement(definitionId: string): void {
    this.placementRotation = 0;
    this.editor.beginPlacement(definitionId);
    const definition = componentRegistry.get(definitionId);
    const boardDefinition = getBreadboardDefinition(definitionId);
    this.statusHint = boardDefinition
      ? `Click to drop the ${boardDefinition.name}. Esc cancels.`
      : `Click a legal position to place the ${definition?.name ?? definitionId}. R rotates, Esc cancels.`;
    this.refreshPanels();
  }

  private commitPlacement(keepArmed: boolean): void {
    const pending = this.editor.pendingPlacement;
    if (!pending) return;

    if (isBoardDefinition(pending)) {
      const definition = getBreadboardDefinition(pending)!;
      const position = snapToGrid(this.pointerWorld);
      const overlapping = this.circuit.boards.some((board) =>
        rectsOverlap(board.bounds(), {
          x: position.x + definition.body.x,
          y: position.y + definition.body.y,
          width: definition.body.width,
          height: definition.body.height,
        }),
      );
      if (overlapping) {
        this.dialogs.toast('Boards cannot overlap. Drop it somewhere clear.', 'warn');
        return;
      }
      const command = new AddBoardCommand(pending, position, definition.name);
      this.undo.execute(command);
      if (!keepArmed) this.editor.cancelPlacement();
      this.markDirty();
      return;
    }

    const definition = componentRegistry.get(pending);
    if (!definition) return;
    const position = this.placementPosition(pending);
    const properties = defaultProperties(definition);
    const result = validatePlacement(this.circuit, {
      definition,
      position,
      rotation: this.placementRotation,
      properties,
    });
    if (!result.valid) {
      this.statusHint = result.reasons[0];
      this.dialogs.toast(result.reasons[0], 'warn');
      this.updateStatus();
      return;
    }
    const instance = this.circuit.createComponent(pending, position, this.placementRotation, properties);
    this.undo.execute(new AddComponentCommand(instance));
    this.editor.select({ kind: 'component', id: instance.id });
    if (!keepArmed) this.editor.cancelPlacement();
    this.markDirty();
    this.statusHint = `Placed ${instance.reference}.`;
  }

  /* ---------------------------------------------------------------- *
   * Dragging parts
   * ---------------------------------------------------------------- */

  private beginPartDrag(): void {
    const ids = this.editor.selectedComponents;
    if (ids.length === 0) return;
    const originals = new Map<string, { position: GridPoint; rotation: Rotation }>();
    const lastGood = new Map<string, GridPoint>();
    for (const id of ids) {
      const instance = this.circuit.getComponent(id);
      if (!instance) continue;
      originals.set(id, { position: { ...instance.position }, rotation: instance.rotation });
      lastGood.set(id, { ...instance.position });
    }
    this.interaction = {
      kind: 'dragParts',
      ids,
      grabWorld: { ...this.pointerWorld },
      originals,
      lastGood,
      moved: false,
    };
  }

  private updatePartDrag(): void {
    if (this.interaction.kind !== 'dragParts') return;
    const drag = this.interaction;
    const dx = Math.round(this.pointerWorld.x - drag.grabWorld.x);
    const dy = Math.round(this.pointerWorld.y - drag.grabWorld.y);
    if (dx === 0 && dy === 0) return;
    drag.moved = true;

    // Try the candidate positions. The move is applied only if *every* part in the
    // selection lands somewhere legal, so a group never half-moves.
    const candidates = new Map<string, GridPoint>();
    for (const id of drag.ids) {
      const original = drag.originals.get(id)!;
      candidates.set(id, { x: original.position.x + dx, y: original.position.y + dy });
    }

    const saved = new Map<string, GridPoint>();
    for (const id of drag.ids) {
      const instance = this.circuit.getComponent(id)!;
      saved.set(id, { ...instance.position });
      instance.position = candidates.get(id)!;
    }

    let firstProblem: string | undefined;
    for (const id of drag.ids) {
      const instance = this.circuit.getComponent(id)!;
      const result = validatePlacement(this.circuit, {
        definition: this.circuit.definitionOf(instance),
        position: instance.position,
        rotation: instance.rotation,
        properties: instance.properties,
        excludeComponentId: id,
      });
      if (!result.valid) {
        firstProblem = result.reasons[0];
        break;
      }
    }

    if (firstProblem) {
      for (const id of drag.ids) this.circuit.getComponent(id)!.position = saved.get(id)!;
      this.statusHint = firstProblem;
    } else {
      for (const id of drag.ids) drag.lastGood.set(id, { ...candidates.get(id)! });
      this.statusHint = 'Release to drop.';
    }
    this.circuit.emit('geometry');
    this.requestRender();
    this.updateStatus();
  }

  private finishPartDrag(): void {
    if (this.interaction.kind !== 'dragParts') return;
    const drag = this.interaction;
    this.interaction = { kind: 'idle' };
    if (!drag.moved) return;

    const commands: Command[] = [];
    for (const id of drag.ids) {
      const instance = this.circuit.getComponent(id);
      const original = drag.originals.get(id);
      if (!instance || !original) continue;
      if (instance.position.x === original.position.x && instance.position.y === original.position.y) continue;
      commands.push(
        new MoveComponentCommand(
          id,
          original,
          { position: { ...instance.position }, rotation: instance.rotation },
          `Move ${instance.reference}`,
        ),
      );
    }
    if (commands.length === 0) return;
    // The model already holds the new positions, so record rather than re-apply.
    this.undo.push(
      commands.length === 1 ? commands[0] : new CompositeCommand(`Move ${commands.length} parts`, commands),
    );
    this.markDirty();
    this.statusHint = 'Moved. Wires that were plugged into those holes stayed where they were.';
  }

  private finishBoardDrag(): void {
    if (this.interaction.kind !== 'dragBoard') return;
    const drag = this.interaction;
    this.interaction = { kind: 'idle' };
    const board = this.circuit.getBoard(drag.boardId);
    if (!board) return;
    if (board.position.x === drag.original.x && board.position.y === drag.original.y) return;
    // Parts sitting on the board move with it; their pins keep the same holes.
    const delta = { x: board.position.x - drag.original.x, y: board.position.y - drag.original.y };
    const commands: Command[] = [];
    for (const instance of this.circuit.components) {
      const definition = this.circuit.definitionOf(instance);
      if (!definition.footprint.requiresBoard) continue;
      const before = { position: { ...instance.position }, rotation: instance.rotation };
      instance.position = { x: instance.position.x + delta.x, y: instance.position.y + delta.y };
      commands.push(
        new MoveComponentCommand(instance.id, before, {
          position: { ...instance.position },
          rotation: instance.rotation,
        }),
      );
    }
    const boardId = drag.boardId;
    const original = drag.original;
    const after = { ...board.position };
    const moveBoard: Command = {
      label: 'Move breadboard',
      apply: (circuit) => circuit.getBoard(boardId)?.moveTo(after),
      revert: (circuit) => circuit.getBoard(boardId)?.moveTo(original),
    };
    this.undo.push(new CompositeCommand('Move breadboard', [moveBoard, ...commands]));
    this.markDirty();
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  private beginWire(target: ConnectionTarget): void {
    this.interaction = {
      kind: 'wire',
      from: this.targetRef(target),
      points: [target.position],
      downScreen: this.pointerScreen,
    };
    this.statusHint = 'Click to place a corner, click a pin or hole to finish, Esc to cancel.';
    this.requestRender();
    this.updateStatus();
  }

  private targetRef(target: ConnectionTarget): ConnectionRef {
    return target.ref;
  }

  private continueWire(): void {
    if (this.interaction.kind !== 'wire') return;
    const draft = this.interaction;
    const target = this.hoverTarget;

    if (target && target.kind === 'wire' && target.wireId) {
      // Branching onto an existing wire creates a real junction.
      const junctionId = this.circuit.ids.next('J');
      const junction = { id: junctionId, wireId: target.wireId, position: target.position };
      const wire = this.circuit.createWire(
        draft.from,
        { kind: 'junction', junctionId },
        this.editor.wireColor,
        simplifyCorners(draft.points[0], draft.points.slice(1), target.position),
      );
      this.undo.execute(
        new CompositeCommand('Branch wire', [new AddJunctionCommand(junction), new AddWireCommand(wire)]),
      );
      this.interaction = { kind: 'idle' };
      this.markDirty();
      return;
    }

    if (target && (target.kind === 'pin' || target.kind === 'hole' || target.kind === 'junction')) {
      const problem = describeWireProblem(this.circuit, draft.from, target.ref);
      if (problem) {
        this.dialogs.toast(problem, 'warn');
        this.statusHint = problem;
        this.updateStatus();
        return;
      }
      const wire = this.circuit.createWire(
        draft.from,
        target.ref,
        this.editor.wireColor,
        simplifyCorners(draft.points[0], draft.points.slice(1), target.position),
      );
      this.undo.execute(new AddWireCommand(wire));
      this.editor.select({ kind: 'wire', id: wire.id });
      this.interaction = { kind: 'idle' };
      this.markDirty();
      this.statusHint = `Connected ${this.circuit.describeConnection(wire.from)} to ${this.circuit.describeConnection(wire.to)}.`;
      this.updateStatus();
      return;
    }

    // Nothing under the cursor: drop a corner.
    draft.points.push(snapToGrid(this.pointerWorld));
    this.requestRender();
  }

  private beginSegmentDrag(wireId: string): void {
    const wire = this.circuit.getWire(wireId);
    if (!wire) return;
    const path = this.circuit.wirePath(wire);
    if (!path) return;
    const routed = routeOrthogonal(path);
    const hit = hitTestPath(routed, this.pointerWorld);
    if (!hit) return;
    this.interaction = {
      kind: 'dragSegment',
      wireId,
      segment: hit.segment,
      grabWorld: { ...this.pointerWorld },
      originalCorners: wire.corners.map((c) => ({ ...c })),
      originalPath: routed,
      moved: false,
    };
  }

  private updateSegmentDrag(): void {
    if (this.interaction.kind !== 'dragSegment') return;
    const drag = this.interaction;
    const wire = this.circuit.getWire(drag.wireId);
    if (!wire) return;
    const delta = {
      x: this.pointerWorld.x - drag.grabWorld.x,
      y: this.pointerWorld.y - drag.grabWorld.y,
    };
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;
    drag.moved = true;
    wire.corners = dragSegment(drag.originalPath, drag.originalCorners, drag.segment, delta);
    this.circuit.emit('geometry');
    this.requestRender();
  }

  private finishSegmentDrag(): void {
    if (this.interaction.kind !== 'dragSegment') return;
    const drag = this.interaction;
    this.interaction = { kind: 'idle' };
    const wire = this.circuit.getWire(drag.wireId);
    if (!wire || !drag.moved) return;
    const start = this.circuit.resolvePosition(wire.from);
    const end = this.circuit.resolvePosition(wire.to);
    if (start && end) wire.corners = simplifyCorners(start, wire.corners, end);
    this.undo.push(
      new UpdateWireCommand(
        drag.wireId,
        { corners: drag.originalCorners, color: wire.color, from: wire.from, to: wire.to },
        { corners: wire.corners.map((c) => ({ ...c })), color: wire.color, from: wire.from, to: wire.to },
        'Move wire segment',
      ),
    );
    this.markDirty();
  }

  /* ---------------------------------------------------------------- *
   * Simulate-mode interaction
   * ---------------------------------------------------------------- */

  private simulateModePress(): void {
    const part = this.componentAt(this.pointerWorld);
    if (!part) {
      const target = this.hoverTarget;
      if (target?.kind === 'hole' && target.ref.kind === 'hole') {
        this.editor.select({ kind: 'hole', boardId: target.ref.boardId, hole: target.ref.hole });
      } else if (target?.kind === 'wire' && target.wireId) {
        this.editor.select({ kind: 'wire', id: target.wireId });
      } else {
        this.editor.clearSelection();
      }
      this.refreshPanels();
      return;
    }

    // Operating the circuit: these are runtime actions, not edits, so they are not
    // pushed onto the undo stack.
    switch (part.defId) {
      case 'in-toggle':
        part.properties.position = part.properties.position === 'A' ? 'B' : 'A';
        this.circuit.emit('properties');
        this.statusHint = `${part.reference} is now in position ${part.properties.position}.`;
        break;
      case 'in-logic':
        part.properties.level = part.properties.level === 'H' ? 'L' : 'H';
        this.circuit.emit('properties');
        this.statusHint = `${part.reference} is driving ${part.properties.level === 'H' ? 'HIGH' : 'LOW'}.`;
        break;
      case 'in-button':
        part.properties.pressed = true;
        this.circuit.emit('properties');
        this.interaction = { kind: 'press', componentId: part.id };
        break;
      case 'pwr-supply':
      case 'pwr-battery':
        part.properties.enabled = part.properties.enabled === false;
        this.circuit.emit('properties');
        this.statusHint = `${part.reference} output ${part.properties.enabled ? 'on' : 'off'}.`;
        break;
      case 'in-clock':
        part.properties.enabled = part.properties.enabled === false;
        this.circuit.emit('properties');
        break;
      default:
        break;
    }
    this.editor.select({ kind: 'component', id: part.id });
    this.refreshPanels();
  }

  /* ---------------------------------------------------------------- *
   * Selection helpers
   * ---------------------------------------------------------------- */

  private finishMarquee(): void {
    if (this.interaction.kind !== 'marquee') return;
    const rect = this.marqueeRect()!;
    this.interaction = { kind: 'idle' };
    if (rect.width < 3 && rect.height < 3) {
      this.requestRender();
      return;
    }
    const topLeft = this.editor.toWorld({ x: rect.x, y: rect.y });
    const bottomRight = this.editor.toWorld({ x: rect.x + rect.width, y: rect.y + rect.height });
    const world = {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
    const hits: Selection[] = [];
    for (const instance of this.circuit.components) {
      if (rectsOverlap(this.circuit.componentBounds(instance), world)) {
        hits.push({ kind: 'component', id: instance.id });
      }
    }
    for (const wire of this.circuit.wires) {
      const path = this.circuit.wirePath(wire);
      if (!path) continue;
      if (path.some((point) => point.x >= world.x && point.x <= world.x + world.width && point.y >= world.y && point.y <= world.y + world.height)) {
        hits.push({ kind: 'wire', id: wire.id });
      }
    }
    this.editor.select(hits, this.interactionAdditive);
    this.refreshPanels();
  }

  private interactionAdditive = false;

  private deleteSelection(): void {
    if (this.editor.mode !== 'design') {
      this.dialogs.toast('Switch to Design mode to change the circuit.', 'warn');
      return;
    }
    const components = this.editor.selection.filter((s) => s.kind === 'component').map((s) => s.id);
    const wires = this.editor.selection.filter((s) => s.kind === 'wire').map((s) => s.id);
    const junctions = this.editor.selection.filter((s) => s.kind === 'junction').map((s) => s.id);
    const boards = this.editor.selection.filter((s) => s.kind === 'board').map((s) => s.id);
    if (components.length + wires.length + junctions.length + boards.length === 0) return;
    this.undo.execute(new DeleteCommand({ components, wires, junctions, boards }));
    this.editor.clearSelection();
    this.markDirty();
    this.statusHint = 'Deleted.';
  }

  private rotateSelection(): void {
    if (this.editor.pendingPlacement) {
      const definition = componentRegistry.get(this.editor.pendingPlacement);
      if (definition) {
        const allowed = definition.footprint.allowedRotations;
        const index = allowed.indexOf(this.placementRotation);
        this.placementRotation = allowed[(index + 1) % allowed.length];
        this.requestRender();
      }
      return;
    }
    if (this.editor.mode !== 'design') return;
    const commands: Command[] = [];
    for (const id of this.editor.selectedComponents) {
      const instance = this.circuit.getComponent(id);
      if (!instance) continue;
      const definition = this.circuit.definitionOf(instance);
      const allowed = definition.footprint.allowedRotations;
      if (allowed.length < 2) {
        this.dialogs.toast(`${instance.reference} cannot be rotated.`, 'warn');
        continue;
      }
      const next = allowed[(allowed.indexOf(instance.rotation) + 1) % allowed.length];
      const result = validatePlacement(this.circuit, {
        definition,
        position: instance.position,
        rotation: next,
        properties: instance.properties,
        excludeComponentId: id,
      });
      if (!result.valid) {
        this.dialogs.toast(result.reasons[0], 'warn');
        continue;
      }
      commands.push(
        new MoveComponentCommand(
          id,
          { position: { ...instance.position }, rotation: instance.rotation },
          { position: { ...instance.position }, rotation: next },
          `Rotate ${instance.reference}`,
        ),
      );
    }
    if (commands.length === 0) return;
    this.undo.execute(
      commands.length === 1 ? commands[0] : new CompositeCommand('Rotate parts', commands),
    );
    this.markDirty();
  }

  private setProperty(componentId: string, key: string, value: PropertyValue): void {
    const instance = this.circuit.getComponent(componentId);
    if (!instance) return;
    const before = instance.properties[key];
    if (before === value) return;
    this.undo.execute(new SetPropertyCommand(componentId, key, before, value));
    this.markDirty();
  }

  private setWireColor(wireId: string, color: string): void {
    const wire = this.circuit.getWire(wireId);
    if (!wire || wire.color === color) return;
    const snapshot = (w: Wire) => ({ corners: w.corners.map((c) => ({ ...c })), color: w.color, from: w.from, to: w.to });
    const before = snapshot(wire);
    this.undo.execute(new UpdateWireCommand(wireId, before, { ...before, color }, 'Change wire colour'));
    this.markDirty();
  }

  /* ---------------------------------------------------------------- *
   * Clipboard
   * ---------------------------------------------------------------- */

  private copySelection(): void {
    const ids = this.editor.selectedComponents;
    if (ids.length === 0) return;
    const instances = ids.map((id) => this.circuit.getComponent(id)).filter(Boolean) as ComponentInstance[];
    if (instances.length === 0) return;
    const originX = Math.min(...instances.map((i) => i.position.x));
    const originY = Math.min(...instances.map((i) => i.position.y));
    const parts: ClipboardEntry[] = instances.map((instance) => ({
      defId: instance.defId,
      offset: { x: instance.position.x - originX, y: instance.position.y - originY },
      rotation: instance.rotation,
      properties: { ...instance.properties },
      localId: instance.id,
    }));
    const set = new Set(ids);
    const wires: ClipboardWire[] = [];
    for (const wire of this.circuit.wires) {
      if (wire.from.kind !== 'pin' || wire.to.kind !== 'pin') continue;
      if (!set.has(wire.from.componentId) || !set.has(wire.to.componentId)) continue;
      wires.push({
        from: { localId: wire.from.componentId, pin: wire.from.pin },
        to: { localId: wire.to.componentId, pin: wire.to.pin },
        corners: wire.corners.map((c) => ({ ...c })),
        color: wire.color,
      });
    }
    this.clipboard = { parts, wires };
    this.dialogs.toast(`Copied ${parts.length} part${parts.length === 1 ? '' : 's'}.`);
  }

  private pasteClipboard(): void {
    if (!this.clipboard || this.editor.mode !== 'design') return;
    const anchor = snapToGrid(this.pointerWorld);
    const commands: Command[] = [];
    const idMap = new Map<string, string>();

    for (const part of this.clipboard.parts) {
      const definition = componentRegistry.get(part.defId);
      if (!definition) continue;
      const wanted = { x: anchor.x + part.offset.x, y: anchor.y + part.offset.y };
      const request = {
        definition,
        position: wanted,
        rotation: part.rotation,
        properties: part.properties,
      };
      const direct = validatePlacement(this.circuit, request);
      const spot = direct.valid ? { position: wanted } : findNearestLegalPlacement(this.circuit, request, 4);
      if (!spot) {
        this.dialogs.toast(`No legal spot near the cursor for ${definition.name}.`, 'warn');
        continue;
      }
      const instance = this.circuit.createComponent(part.defId, spot.position, part.rotation, part.properties);
      idMap.set(part.localId, instance.id);
      const command = new AddComponentCommand(instance, `Paste ${instance.reference}`);
      command.apply(this.circuit);
      commands.push(command);
    }

    for (const wire of this.clipboard.wires) {
      const fromId = idMap.get(wire.from.localId);
      const toId = idMap.get(wire.to.localId);
      if (!fromId || !toId) continue;
      const created = this.circuit.createWire(
        { kind: 'pin', componentId: fromId, pin: wire.from.pin },
        { kind: 'pin', componentId: toId, pin: wire.to.pin },
        wire.color,
      );
      const command = new AddWireCommand(created);
      command.apply(this.circuit);
      commands.push(command);
    }

    if (commands.length === 0) return;
    this.undo.push(new CompositeCommand('Paste', commands));
    this.editor.select([...idMap.values()].map((id) => ({ kind: 'component', id }) as Selection));
    this.markDirty();
  }

  /* ---------------------------------------------------------------- *
   * Modes, simulation and instruments
   * ---------------------------------------------------------------- */

  private setMode(mode: 'design' | 'simulate'): void {
    this.editor.setMode(mode);
    if (mode === 'simulate') {
      this.engine.rebuild();
      this.running = true;
      this.statusHint = 'Simulating. Click a switch to flip it; click a wire or hole to probe it.';
    } else {
      this.running = false;
      this.statusHint = 'Design mode. Hover a pin or hole to start a wire.';
    }
    this.refreshPanels();
    this.requestRender();
  }

  private toggleRun(): void {
    if (this.editor.mode !== 'simulate') return;
    this.running = !this.running;
    this.refreshPanels();
  }

  private stepSimulation(): void {
    if (this.editor.mode !== 'simulate') return;
    this.running = false;
    this.engine.advance(1e6); // one millisecond of simulated time
    this.simTimeMs += 1;
    this.analyzer.sample(this.engine, this.simTimeMs);
    this.refreshPanels();
    this.requestRender();
  }

  private resetSimulation(): void {
    this.engine.reset();
    this.simTimeMs = 0;
    this.analyzer.clear();
    this.requestRender();
    this.refreshPanels();
    this.dialogs.toast('Simulation reset to time zero.');
  }

  private toggleAnalyzer(force?: boolean): void {
    const open = force ?? !this.analyzerPanel.isOpen;
    this.analyzerPanel.setOpen(open);
    if (open) {
      this.truthPanel.setOpen(false);
      this.analyzerPanel.update(this.analyzer, this.engine, this.editor.theme, this.simTimeMs);
    }
    this.handleResize();
    this.refreshPanels();
  }

  private toggleTruthTable(force?: boolean): void {
    const open = force ?? !this.truthPanel.isOpen;
    this.truthPanel.setOpen(open);
    if (open) this.analyzerPanel.setOpen(false);
    this.handleResize();
    this.refreshPanels();
  }

  private addSelectedNetToAnalyzer(): void {
    const netId = this.highlightedNet();
    if (!netId) {
      this.dialogs.toast('Select a wire, pin or breadboard hole first.', 'warn');
      return;
    }
    const net = this.engine.nets.get(netId);
    const label = net ? `${this.engine.netLabel(net)} (${netId})` : netId;
    if (this.analyzer.addChannel(netId, label)) {
      this.dialogs.toast(`Probing ${label}.`);
    } else {
      this.dialogs.toast('That net is already on a channel, or all twelve channels are in use.', 'warn');
    }
    this.analyzerPanel.update(this.analyzer, this.engine, this.editor.theme, this.simTimeMs);
  }

  private generateTruthTable(): void {
    const pins = this.editor.selection
      .filter((s) => s.kind === 'pin')
      .map((s) => ({ componentId: (s as { componentId: string }).componentId, pin: (s as { pin: number }).pin }));
    const wasRunning = this.running;
    this.running = false;
    const result = generateTruthTable(
      this.circuit,
      this.engine,
      collectInputs(this.circuit),
      collectOutputs(this.circuit, pins),
    );
    this.truthPanel.show(result);
    this.running = wasRunning;
    this.requestRender();
  }

  private copyText(text: string): void {
    navigator.clipboard?.writeText(text).then(
      () => this.dialogs.toast('Truth table copied to the clipboard.'),
      () => this.dialogs.showMessage('Copy failed', ['The browser refused clipboard access.', text]),
    );
  }

  private toggleTheme(): void {
    this.editor.theme = this.editor.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = this.editor.theme;
    this.refreshPanels();
    this.requestRender();
  }

  private zoomStep(delta: number): void {
    const center = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
    this.editor.zoomAt(center, delta > 0 ? 1.2 : 1 / 1.2);
  }

  private fitToView(): void {
    const bounds = this.contentBounds();
    if (!bounds) return;
    const padding = 60;
    const width = this.canvas.clientWidth - padding * 2;
    const height = this.canvas.clientHeight - padding * 2;
    const zoom = Math.min(width / (bounds.width * 14), height / (bounds.height * 14));
    this.editor.view.zoom = Math.min(4, Math.max(0.25, zoom));
    this.editor.view.panX = padding - bounds.x * this.editor.scale;
    this.editor.view.panY = padding - bounds.y * this.editor.scale;
    this.editor.notify();
  }

  private contentBounds() {
    const rects = [
      ...this.circuit.boards.map((board) => board.bounds()),
      ...this.circuit.components.map((instance) => this.circuit.componentBounds(instance)),
    ];
    if (rects.length === 0) return undefined;
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private focusDiagnostic(diagnostic: Diagnostic): void {
    const subject = diagnostic.subjects[0];
    if (!subject) return;
    if (this.circuit.getComponent(subject)) {
      this.editor.select({ kind: 'component', id: subject });
      const instance = this.circuit.getComponent(subject)!;
      const center = this.circuit.componentBounds(instance);
      this.editor.view.panX = this.canvas.clientWidth / 2 - (center.x + center.width / 2) * this.editor.scale;
      this.editor.view.panY = this.canvas.clientHeight / 2 - (center.y + center.height / 2) * this.editor.scale;
      this.editor.notify();
    } else if (this.engine.nets.get(subject)) {
      this.editor.select({ kind: 'net', id: subject });
    }
    this.refreshPanels();
  }

  /* ---------------------------------------------------------------- *
   * Files
   * ---------------------------------------------------------------- */

  private markDirty(): void {
    this.dirty = true;
    this.refreshPanels();
  }

  private replaceCircuit(circuit: Circuit, metadata: ProjectMetadata): void {
    this.circuit = circuit;
    this.engine = new SimulationEngine(circuit);
    this.undo = new UndoManager(circuit);
    this.undo.onChange(() => this.refreshPanels());
    this.metadata = metadata;
    this.dirty = false;
    this.simTimeMs = 0;
    this.analyzer.reset();
    this.editor.clearSelection();
    this.bindCircuit();
    this.refreshPanels();
    this.fitToView();
    this.requestRender();
  }

  private newProject(): void {
    const start = () => {
      this.dialogs.choose('New project', 'What would you like to start from?', [
        {
          label: 'Empty breadboard',
          description: 'A half-size board with a bench supply already wired to the rails.',
          primary: true,
          onSelect: () => this.replaceCircuit(buildEmptyProject(), { name: 'Untitled experiment' }),
        },
        ...EXAMPLES.map((example) => ({
          label: example.name,
          description: example.description,
          onSelect: () => this.replaceCircuit(example.build(), { name: example.name }),
        })),
      ]);
    };
    if (this.dirty) {
      this.dialogs.confirm(
        'Discard unsaved changes?',
        `"${this.metadata.name}" has changes that have not been saved.`,
        'Discard and continue',
        start,
      );
    } else {
      start();
    }
  }

  private saveProject(): void {
    const file = serializeProject(this.circuit, {
      metadata: this.metadata,
      view: { panX: this.editor.view.panX, panY: this.editor.view.panY, zoom: this.editor.view.zoom },
    });
    const json = projectToJson(file);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.metadata.name.replace(/[^\w.-]+/g, '_') || 'experiment'}.protolab.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.dirty = false;
    this.refreshPanels();
    this.dialogs.toast('Project exported as JSON.');
  }

  /** Export offers the two formats that exist, and says which one is the project. */
  private exportMenu(): void {
    this.dialogs.choose('Export', 'JSON is the project itself. The image is a picture of the workspace.', [
      {
        label: 'Project JSON',
        description: 'The complete circuit: boards, parts, wires, junctions and settings.',
        primary: true,
        onSelect: () => this.saveProject(),
      },
      {
        label: 'Workspace image (PNG)',
        description: 'A screenshot of the canvas exactly as it looks now. Not a project file.',
        onSelect: () => this.exportImage(),
      },
    ]);
  }

  private exportImage(): void {
    this.render();
    this.canvas.toBlob((blob) => {
      if (!blob) {
        this.dialogs.toast('The browser could not produce an image of the canvas.', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.metadata.name.replace(/[^\w.-]+/g, '_') || 'experiment'}.png`;
      link.click();
      URL.revokeObjectURL(url);
      this.dialogs.toast('Workspace image saved.');
    }, 'image/png');
  }

  private openProject(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = loadProjectFromJson(text);
        this.replaceCircuit(result.circuit, result.metadata);
        if (result.view) {
          this.editor.view = { panX: result.view.panX, panY: result.view.panY, zoom: result.view.zoom };
          this.editor.notify();
        }
        if (result.warnings.length > 0) {
          this.dialogs.showMessage('Project loaded with notes', result.warnings);
        } else {
          this.dialogs.toast(`Loaded "${result.metadata.name}".`);
        }
      } catch (error) {
        if (error instanceof ProjectValidationError) {
          this.dialogs.showMessage('That project could not be loaded', error.problems, 'error');
        } else {
          this.dialogs.showMessage('That project could not be loaded', [(error as Error).message], 'error');
        }
      }
    });
    input.click();
  }

  /** Load a worked example. Used by the first-run bootstrap. */
  loadExample(id: string): void {
    const example = EXAMPLES.find((entry) => entry.id === id);
    if (!example) return;
    this.replaceCircuit(example.build(), { name: example.name });
  }

  renameProject(): void {
    this.dialogs.prompt('Project name', 'Name', this.metadata.name, (name) => {
      this.metadata = { ...this.metadata, name };
      this.markDirty();
    });
  }

  /* ---------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------- */

  private cancelInteraction(): void {
    this.interaction = { kind: 'idle' };
    this.editor.cancelPlacement();
    this.statusHint = 'Cancelled.';
    this.refreshPanels();
    this.requestRender();
  }

  private doUndo(): void {
    const command = this.undo.undo();
    if (!command) return;
    this.engine.rebuild();
    this.markDirty();
    this.dialogs.toast(`Undid: ${command.label}`);
  }

  private doRedo(): void {
    const command = this.undo.redo();
    if (!command) return;
    this.engine.rebuild();
    this.markDirty();
    this.dialogs.toast(`Redid: ${command.label}`);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.key === ' ') this.spaceHeld = true;
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
      if (typing) {
        if (event.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }

      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl) {
        switch (key) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) this.doRedo();
            else this.doUndo();
            return;
          case 'y':
            event.preventDefault();
            this.doRedo();
            return;
          case 's':
          case 'e':
            event.preventDefault();
            this.saveProject();
            return;
          case 'o':
            event.preventDefault();
            this.openProject();
            return;
          case 'n':
            event.preventDefault();
            this.newProject();
            return;
          case 'c':
            event.preventDefault();
            this.copySelection();
            return;
          case 'v':
            event.preventDefault();
            this.pasteClipboard();
            return;
          case 'x':
            event.preventDefault();
            this.copySelection();
            this.deleteSelection();
            return;
          case 'a':
            event.preventDefault();
            this.editor.select(this.circuit.components.map((c) => ({ kind: 'component', id: c.id }) as Selection));
            this.refreshPanels();
            return;
          case 'f':
            event.preventDefault();
            this.palette.focusSearch();
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case 'Escape':
          if (this.dialogs.isOpen) this.dialogs.close();
          else this.cancelInteraction();
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          this.deleteSelection();
          return;
        case '?':
          this.dialogs.showShortcuts(SHORTCUTS as ShortcutEntry[]);
          return;
        case '+':
        case '=':
          this.zoomStep(1);
          return;
        case '-':
          this.zoomStep(-1);
          return;
        case '0':
          this.editor.setZoom(1);
          return;
        default:
          break;
      }

      switch (key) {
        case 'v':
          this.editor.setTool('select');
          this.refreshPanels();
          return;
        case 'm':
          this.editor.setTool('multiselect');
          this.refreshPanels();
          return;
        case 'r':
          this.rotateSelection();
          return;
        case 'd':
          this.setMode('design');
          return;
        case 's':
          this.setMode('simulate');
          return;
        case 'p':
          this.toggleRun();
          return;
        case 'n':
          this.stepSimulation();
          return;
        case 'a':
          this.toggleAnalyzer();
          return;
        case 't':
          this.toggleTruthTable();
          return;
        case 'l':
          this.editor.showLabels = !this.editor.showLabels;
          this.requestRender();
          return;
        case 'k':
          this.toggleTheme();
          return;
        case 'f':
          this.fitToView();
          return;
        default:
          break;
      }

      // Wire colours on the number row.
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const color = WIRE_COLORS[digit - 1];
        if (color) {
          this.editor.wireColor = color.key;
          this.refreshPanels();
          this.dialogs.toast(`Wire colour: ${color.label}`);
        }
      }
    });

    window.addEventListener('keyup', (event) => {
      if (event.key === ' ') this.spaceHeld = false;
    });
  }
}

function isBoardDefinition(id: string): boolean {
  return BREADBOARD_DEFINITIONS.some((definition) => definition.id === id);
}

function sameDiagnostics(a: Diagnostic[], b: Diagnostic[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].message !== b[i].message) return false;
  return true;
}
