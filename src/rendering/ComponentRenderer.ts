/**
 * Drawing physical parts.
 *
 * Each part is drawn in its own local coordinate system - origin at pin 1, one unit
 * per 0.1 in - and the canvas transform handles placement and rotation. That means
 * the drawing code and the electrical model agree about where pin 7 is by
 * construction rather than by coincidence.
 *
 * Nothing here is bitmap art; every symbol is drawn from primitives.
 */

import { bodyOf, pinsOf } from '../components/ComponentDefinition';
import type { ComponentDefinition, PinDefinition } from '../components/ComponentDefinition';
import type { ComponentInstance } from '../core/Circuit';
import type { GridPoint, LogicValue } from '../core/types';
import type { ComponentRuntime, ResolvedNet } from '../simulation/SimulationEngine';
import { roundRect } from './BreadboardRenderer';
import { Theme, ledColor, wireColorHex } from './theme';

export interface ComponentDrawContext {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  scale: number;
  /** Screen position of the component origin. */
  origin: { x: number; y: number };
  runtime?: ComponentRuntime;
  netOfPin?: (pin: number) => ResolvedNet | undefined;
  simulating: boolean;
  selected: boolean;
  hovered: boolean;
  /** Placement preview: draw translucent, tinted by whether the spot is legal. */
  ghost?: 'valid' | 'invalid';
  showLabels: boolean;
}

export function drawComponent(
  instance: ComponentInstance,
  definition: ComponentDefinition,
  draw: ComponentDrawContext,
): void {
  const { ctx, scale } = draw;
  ctx.save();
  ctx.translate(draw.origin.x, draw.origin.y);
  ctx.rotate((instance.rotation * Math.PI) / 180);

  if (draw.ghost) ctx.globalAlpha = 0.72;

  const pins = pinsOf(definition, instance.properties);
  const body = bodyOf(definition, instance.properties);

  switch (definition.visual.style) {
    case 'dip':
      drawDip(instance, definition, pins, body, draw);
      break;
    case 'led':
      drawLed(instance, pins, draw);
      break;
    case 'lamp':
      drawLamp(pins, draw);
      break;
    case 'resistor':
      drawResistor(instance, pins, draw);
      break;
    case 'switch':
      if (definition.id === 'in-toggle') drawToggle(instance, pins, draw);
      else drawModule(instance, definition, body, draw, moduleSummary(instance, definition, draw));
      break;
    case 'button':
      drawButton(instance, pins, draw);
      break;
    case 'supply':
    case 'clock':
    case 'probe':
      drawModule(instance, definition, body, draw, moduleSummary(instance, definition, draw));
      break;
    case 'ground':
      drawGroundSymbol(draw);
      break;
    case 'terminal':
      drawSupplyTerminal(instance, draw);
      break;
    case 'sevenseg':
      drawSevenSegment(instance, pins, body, draw);
      break;
  }

  // Pin state rings, drawn on top so they read against any body.
  if (draw.simulating && draw.netOfPin) {
    for (const pin of pins) {
      const net = draw.netOfPin(pin.number);
      if (!net || net.value === 'Z') continue;
      ctx.beginPath();
      ctx.arc(pin.offset.x * scale, pin.offset.y * scale, Math.max(1.6, scale * 0.2), 0, Math.PI * 2);
      ctx.fillStyle = stateColor(draw.theme, net.value, net);
      ctx.fill();
    }
  }

  if (draw.ghost) {
    ctx.globalAlpha = 1;
    const outline = draw.ghost === 'valid' ? draw.theme.validPlacement : draw.theme.invalidPlacement;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    roundRect(ctx, body.x * scale, body.y * scale, body.width * scale, body.height * scale, 3);
    ctx.stroke();
    ctx.setLineDash([]);
    // Mark every pin so it is obvious which holes the part will land in.
    for (const pin of pins) {
      ctx.beginPath();
      ctx.arc(pin.offset.x * scale, pin.offset.y * scale, Math.max(2, scale * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = outline;
      ctx.fill();
    }
  }

  ctx.restore();

  if ((draw.selected || draw.hovered) && !draw.ghost) {
    drawSelectionOutline(instance, body, draw);
  }
}

/* ------------------------------------------------------------------ *
 * DIP packages
 * ------------------------------------------------------------------ */

function drawDip(
  instance: ComponentInstance,
  definition: ComponentDefinition,
  pins: PinDefinition[],
  body: { x: number; y: number; width: number; height: number },
  draw: ComponentDrawContext,
): void {
  const { ctx, theme, scale } = draw;
  const runtime = draw.runtime;

  // Legs first, so the body sits on top of them.
  for (const pin of pins) {
    const px = pin.offset.x * scale;
    const py = pin.offset.y * scale;
    const towards = pin.offset.y === 0 ? -1 : 1;
    const legLength = scale * 0.85;
    ctx.fillStyle = theme.pinMetal;
    ctx.strokeStyle = theme.pinMetalEdge;
    ctx.lineWidth = 0.6;
    const legWidth = Math.max(1.6, scale * 0.28);
    ctx.beginPath();
    ctx.rect(px - legWidth / 2, Math.min(py, py + towards * legLength), legWidth, legLength);
    ctx.fill();
    ctx.stroke();
    // Pad where the lead meets the hole.
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.4, scale * 0.19), 0, Math.PI * 2);
    ctx.fillStyle = theme.pinMetal;
    ctx.fill();
  }

  const bx = body.x * scale;
  const by = body.y * scale;
  const bw = body.width * scale;
  const bh = body.height * scale;

  const gradient = ctx.createLinearGradient(0, by, 0, by + bh);
  gradient.addColorStop(0, theme.dipBodyTop);
  gradient.addColorStop(1, theme.dipBody);
  roundRect(ctx, bx, by, bw, bh, Math.min(3, scale * 0.16));
  ctx.fillStyle = runtime?.damaged ? theme.damaged : gradient;
  ctx.fill();
  ctx.strokeStyle = theme.dipEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Notch on the left edge, the orientation mark on a real package.
  ctx.beginPath();
  ctx.arc(bx, by + bh / 2, scale * 0.42, -Math.PI / 2, Math.PI / 2);
  ctx.fillStyle = theme.dipNotch;
  ctx.fill();

  // Pin 1 dot.
  ctx.beginPath();
  ctx.arc(bx + scale * 0.55, by + bh - scale * 0.5, Math.max(1.2, scale * 0.13), 0, Math.PI * 2);
  ctx.fillStyle = theme.dipText;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (runtime && draw.simulating) {
    if (runtime.damaged) {
      drawDamageMarks(ctx, bx, by, bw, bh, theme);
    } else if (runtime.electrical === 'OVERHEATING' || runtime.electrical === 'OVERVOLTAGE') {
      roundRect(ctx, bx, by, bw, bh, 3);
      ctx.fillStyle = theme.heat;
      ctx.fill();
    } else if (!runtime.powered) {
      roundRect(ctx, bx, by, bw, bh, 3);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
    }
  }

  if (draw.showLabels && scale > 8) {
    withUprightText(ctx, instance.rotation, bx + bw / 2, by + bh / 2, () => {
      ctx.fillStyle = theme.dipText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.max(7, scale * 0.78)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillText(definition.partNumber ?? definition.name, 0, -scale * 0.42);
      ctx.font = `500 ${Math.max(6, scale * 0.6)}px "Inter", system-ui, sans-serif`;
      ctx.globalAlpha = 0.72;
      ctx.fillText(instance.reference, 0, scale * 0.62);
      ctx.globalAlpha = 1;
    });
  }
}

function drawDamageMarks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: Theme,
): void {
  roundRect(ctx, x, y, width, height, 3);
  ctx.fillStyle = theme.damaged;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.25, y + height * 0.2);
  ctx.lineTo(x + width * 0.4, y + height * 0.55);
  ctx.lineTo(x + width * 0.3, y + height * 0.8);
  ctx.moveTo(x + width * 0.62, y + height * 0.25);
  ctx.lineTo(x + width * 0.72, y + height * 0.6);
  ctx.stroke();
}

/* ------------------------------------------------------------------ *
 * Indicators and passives
 * ------------------------------------------------------------------ */

function drawLeads(pins: PinDefinition[], draw: ComponentDrawContext, liftY = 0): void {
  const { ctx, theme, scale } = draw;
  ctx.strokeStyle = theme.pinMetalEdge;
  ctx.lineWidth = Math.max(1.2, scale * 0.14);
  ctx.lineCap = 'round';
  for (const pin of pins) {
    ctx.beginPath();
    ctx.moveTo(pin.offset.x * scale, pin.offset.y * scale);
    ctx.lineTo(pin.offset.x * scale, (pin.offset.y + liftY) * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pin.offset.x * scale, pin.offset.y * scale, Math.max(1.3, scale * 0.17), 0, Math.PI * 2);
    ctx.fillStyle = theme.pinMetal;
    ctx.fill();
  }
}

function drawLed(instance: ComponentInstance, pins: PinDefinition[], draw: ComponentDrawContext): void {
  const { ctx, scale } = draw;
  const anode = pins[0].offset;
  const cathode = pins[1].offset;
  const midX = ((anode.x + cathode.x) / 2) * scale;
  const baseY = anode.y * scale - scale * 0.9;
  const radius = scale * 1.05;

  drawLeads(pins, draw, -0.9);

  const colors = ledColor(String(instance.properties.color ?? 'red'));
  // Indicators only light while the simulation is running. In Design mode the board
  // shows what has been built, not what it would do.
  const lit = draw.simulating && draw.runtime?.display.lit === true;

  if (lit) {
    const glow = ctx.createRadialGradient(midX, baseY - radius * 0.3, radius * 0.2, midX, baseY - radius * 0.3, radius * 2.6);
    glow.addColorStop(0, colors.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(midX, baseY - radius * 0.3, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dome with a flat on the cathode side, like a real 5 mm LED.
  ctx.beginPath();
  ctx.arc(midX, baseY - radius * 0.25, radius, Math.PI, 0);
  ctx.lineTo(midX + radius, baseY + radius * 0.45);
  ctx.lineTo(midX - radius, baseY + radius * 0.45);
  ctx.closePath();
  ctx.fillStyle = lit ? colors.on : colors.off;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Flat marking the cathode.
  const cathodeSide = cathode.x > anode.x ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(midX + cathodeSide * radius * 0.78, baseY - radius * 0.7);
  ctx.lineTo(midX + cathodeSide * radius * 0.78, baseY + radius * 0.4);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = Math.max(1, scale * 0.1);
  ctx.stroke();

  if (draw.simulating && draw.runtime?.display.overCurrent === true) {
    drawWarningBadge(draw, midX, baseY - radius * 1.6);
  }
}

function drawLamp(pins: PinDefinition[], draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  drawLeads(pins, draw, -1.2);
  const midX = ((pins[0].offset.x + pins[1].offset.x) / 2) * scale;
  const cy = pins[0].offset.y * scale - scale * 1.9;
  const radius = scale * 1.25;
  const lit = draw.simulating && draw.runtime?.display.lit === true;

  if (lit) {
    const glow = ctx.createRadialGradient(midX, cy, radius * 0.2, midX, cy, radius * 3);
    glow.addColorStop(0, 'rgba(255, 226, 150, 0.7)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(midX, cy, radius * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(midX, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = lit ? '#ffe08a' : theme.bodyNeutral;
  ctx.fill();
  ctx.strokeStyle = theme.bodyNeutralEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Filament.
  ctx.beginPath();
  ctx.moveTo(midX - radius * 0.45, cy + radius * 0.3);
  ctx.lineTo(midX - radius * 0.15, cy - radius * 0.25);
  ctx.lineTo(midX + radius * 0.15, cy + radius * 0.25);
  ctx.lineTo(midX + radius * 0.45, cy - radius * 0.3);
  ctx.strokeStyle = lit ? '#b8791a' : theme.bodyNeutralEdge;
  ctx.lineWidth = Math.max(1, scale * 0.08);
  ctx.stroke();
}

const BAND_COLORS = [
  '#1c1c1c', '#7a4a1e', '#c0392b', '#e08c1a', '#e8c51c',
  '#3aa757', '#2f7fd0', '#8256c8', '#8b9199', '#f2f2f2',
];

/** Work out the four printed bands for a resistance value. */
export function resistorBands(ohms: number): string[] {
  const safe = Math.max(1, Math.round(ohms));
  let exponent = 0;
  let significant = safe;
  while (significant >= 100) {
    significant = Math.round(significant / 10);
    exponent++;
  }
  while (significant < 10) {
    significant *= 10;
    exponent--;
  }
  const first = Math.floor(significant / 10);
  const second = significant % 10;
  const multiplier = Math.max(0, Math.min(9, exponent));
  return [BAND_COLORS[first], BAND_COLORS[second], BAND_COLORS[multiplier], '#c9a227'];
}

function drawResistor(instance: ComponentInstance, pins: PinDefinition[], draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  drawLeads(pins, draw, 0);
  const x1 = pins[0].offset.x * scale;
  const x2 = pins[1].offset.x * scale;
  const y = pins[0].offset.y * scale;

  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.strokeStyle = theme.pinMetalEdge;
  ctx.lineWidth = Math.max(1.2, scale * 0.12);
  ctx.stroke();

  const bodyWidth = Math.abs(x2 - x1) * 0.62;
  const bodyHeight = scale * 0.95;
  const bodyX = Math.min(x1, x2) + (Math.abs(x2 - x1) - bodyWidth) / 2;
  roundRect(ctx, bodyX, y - bodyHeight / 2, bodyWidth, bodyHeight, bodyHeight / 2.4);
  ctx.fillStyle = '#d9c9a3';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const bands = resistorBands(Number(instance.properties.resistance ?? 330));
  const bandWidth = Math.max(1.5, bodyWidth * 0.08);
  bands.forEach((color, index) => {
    const offset = bodyX + bodyWidth * (0.16 + index * 0.2);
    ctx.fillStyle = color;
    ctx.fillRect(offset, y - bodyHeight / 2 + 1, bandWidth, bodyHeight - 2);
  });
}

/* ------------------------------------------------------------------ *
 * Switches
 * ------------------------------------------------------------------ */

function drawToggle(instance: ComponentInstance, pins: PinDefinition[], draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  drawLeads(pins, draw, 0);

  const left = pins[0].offset.x * scale;
  const right = pins[2].offset.x * scale;
  const y = pins[0].offset.y * scale;
  const bodyHeight = scale * 2.2;
  const bodyY = y - bodyHeight - scale * 0.3;

  roundRect(ctx, left - scale * 0.5, bodyY, right - left + scale, bodyHeight, scale * 0.3);
  ctx.fillStyle = theme.bodyNeutral;
  ctx.fill();
  ctx.strokeStyle = theme.bodyNeutralEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const up = String(instance.properties.position ?? 'B') === 'A';
  const centerX = (left + right) / 2;
  const leverX = up ? centerX - scale * 0.7 : centerX + scale * 0.7;
  roundRect(ctx, leverX - scale * 0.5, bodyY + scale * 0.25, scale, bodyHeight - scale * 0.5, scale * 0.25);
  ctx.fillStyle = up ? theme.stateHigh : theme.moduleEdge;
  ctx.fill();

  if (draw.showLabels && scale > 9) {
    withUprightText(ctx, instance.rotation, centerX, bodyY - scale * 0.5, () => {
      ctx.fillStyle = theme.boardText;
      ctx.font = `600 ${Math.max(6, scale * 0.6)}px "Inter", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${instance.reference} · ${up ? 'A' : 'B'}`, 0, 0);
    });
  }
}

function drawButton(instance: ComponentInstance, pins: PinDefinition[], draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  drawLeads(pins, draw, 0);
  const xs = pins.map((p) => p.offset.x * scale);
  const ys = pins.map((p) => p.offset.y * scale);
  const left = Math.min(...xs) - scale * 0.5;
  const right = Math.max(...xs) + scale * 0.5;
  const top = Math.min(...ys) + scale * 0.2;
  const bottom = Math.max(...ys) - scale * 0.2;

  roundRect(ctx, left, top, right - left, bottom - top, scale * 0.25);
  ctx.fillStyle = theme.bodyNeutral;
  ctx.fill();
  ctx.strokeStyle = theme.bodyNeutralEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const pressed = draw.runtime?.display.pressed === true || instance.properties.pressed === true;
  ctx.beginPath();
  ctx.arc((left + right) / 2, (top + bottom) / 2, scale * 0.75, 0, Math.PI * 2);
  ctx.fillStyle = pressed ? theme.stateHigh : '#4a4f57';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
}

/* ------------------------------------------------------------------ *
 * Bench modules and symbols
 * ------------------------------------------------------------------ */

function moduleSummary(
  instance: ComponentInstance,
  definition: ComponentDefinition,
  draw: ComponentDrawContext,
): string[] {
  const display = draw.runtime?.display ?? {};
  switch (definition.id) {
    case 'pwr-supply':
    case 'pwr-battery': {
      const enabled = instance.properties.enabled !== false;
      return [`${Number(instance.properties.voltage ?? 5).toFixed(1)} V`, enabled ? 'OUTPUT ON' : 'OUTPUT OFF'];
    }
    case 'in-clock': {
      const running = display.running === true;
      return [`${Number(instance.properties.frequency ?? 1)} Hz`, running ? (display.phase ? 'HIGH' : 'LOW') : 'STOPPED'];
    }
    case 'inst-probe': {
      const reading = (display.reading as LogicValue) ?? 'Z';
      return [readingLabel(reading), display.voltage !== undefined ? `${Number(display.voltage).toFixed(2)} V` : ''];
    }
    case 'in-logic':
      return [String(instance.properties.level ?? 'L') === 'H' ? 'HIGH' : 'LOW', ''];
    default:
      return [];
  }
}

function readingLabel(value: LogicValue): string {
  switch (value) {
    case 'H':
      return 'HIGH';
    case 'L':
      return 'LOW';
    case 'X':
      return 'CONFLICT';
    default:
      return 'FLOATING';
  }
}

function drawModule(
  instance: ComponentInstance,
  definition: ComponentDefinition,
  body: { x: number; y: number; width: number; height: number },
  draw: ComponentDrawContext,
  lines: string[],
): void {
  const { ctx, theme, scale } = draw;
  const bx = body.x * scale;
  const by = body.y * scale;
  const bw = body.width * scale;
  const bh = body.height * scale;

  roundRect(ctx, bx, by, bw, bh, Math.min(6, scale * 0.35));
  ctx.fillStyle = theme.moduleBody;
  ctx.fill();
  ctx.strokeStyle = theme.moduleEdge;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Terminals.
  for (const pin of pinsOf(definition, instance.properties)) {
    const px = pin.offset.x * scale;
    const py = pin.offset.y * scale;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, scale * 0.28), 0, Math.PI * 2);
    ctx.fillStyle =
      pin.electricalRole === 'VCC' ? theme.stateSupply : pin.electricalRole === 'GND' ? theme.stateGround : theme.pinMetal;
    ctx.fill();
    ctx.strokeStyle = theme.moduleEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (draw.showLabels && scale > 9) {
      ctx.fillStyle = theme.moduleText;
      ctx.font = `600 ${Math.max(6, scale * 0.55)}px "Inter", system-ui, sans-serif`;
      ctx.textAlign = px > bx + bw / 2 ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(pin.name, px > bx + bw / 2 ? px - scale * 0.6 : px + scale * 0.6, py);
    }
  }

  if (draw.showLabels && scale > 8) {
    ctx.fillStyle = theme.moduleText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${Math.max(7, scale * 0.62)}px "Inter", system-ui, sans-serif`;
    ctx.globalAlpha = 0.65;
    ctx.fillText(`${definition.visual.bodyLabel ?? definition.name}`, bx + scale * 0.5, by + scale * 0.35);
    ctx.globalAlpha = 1;
    ctx.font = `700 ${Math.max(9, scale * 0.95)}px "JetBrains Mono", ui-monospace, monospace`;
    if (lines[0]) ctx.fillText(lines[0], bx + scale * 0.5, by + scale * 1.35);
    ctx.font = `500 ${Math.max(6, scale * 0.55)}px "Inter", system-ui, sans-serif`;
    ctx.globalAlpha = 0.6;
    if (lines[1]) ctx.fillText(lines[1], bx + scale * 0.5, by + scale * 2.5);
    ctx.fillText(instance.reference, bx + scale * 0.5, by + bh - scale * 1.1);
    ctx.globalAlpha = 1;
  }
}

function drawGroundSymbol(draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  ctx.strokeStyle = theme.stateGround;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, scale * 0.9);
  ctx.lineWidth = Math.max(1.4, scale * 0.16);
  ctx.stroke();
  const widths = [1.3, 0.85, 0.4];
  widths.forEach((half, index) => {
    const y = scale * (0.9 + index * 0.45);
    ctx.beginPath();
    ctx.moveTo(-half * scale, y);
    ctx.lineTo(half * scale, y);
    ctx.lineWidth = Math.max(1.2, scale * 0.14);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, scale * 0.24), 0, Math.PI * 2);
  ctx.fillStyle = theme.stateGround;
  ctx.fill();
}

function drawSupplyTerminal(instance: ComponentInstance, draw: ComponentDrawContext): void {
  const { ctx, theme, scale } = draw;
  ctx.strokeStyle = theme.stateSupply;
  ctx.lineWidth = Math.max(1.4, scale * 0.16);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -scale * 1.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-scale * 1.1, -scale * 1.1);
  ctx.lineTo(scale * 1.1, -scale * 1.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, scale * 0.24), 0, Math.PI * 2);
  ctx.fillStyle = theme.stateSupply;
  ctx.fill();
  if (draw.showLabels && scale > 8) {
    withUprightText(ctx, instance.rotation, 0, -scale * 1.5, () => {
      ctx.fillStyle = theme.stateSupply;
      ctx.font = `700 ${Math.max(7, scale * 0.7)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`+${Number(instance.properties.voltage ?? 5)}V`, 0, 0);
    });
  }
}

/* ------------------------------------------------------------------ *
 * Seven-segment display
 * ------------------------------------------------------------------ */

const SEGMENT_SHAPES: Record<string, [number, number, number, number, 'h' | 'v']> = {
  //        x,    y,    length, thickness-ignored, orientation
  a: [0.18, 0.1, 0.64, 0, 'h'],
  b: [0.82, 0.16, 0.36, 0, 'v'],
  c: [0.82, 0.56, 0.36, 0, 'v'],
  d: [0.18, 0.92, 0.64, 0, 'h'],
  e: [0.18, 0.56, 0.36, 0, 'v'],
  f: [0.18, 0.16, 0.36, 0, 'v'],
  g: [0.18, 0.51, 0.64, 0, 'h'],
};

function drawSevenSegment(
  instance: ComponentInstance,
  pins: PinDefinition[],
  body: { x: number; y: number; width: number; height: number },
  draw: ComponentDrawContext,
): void {
  const { ctx, theme, scale } = draw;
  drawLeads(pins, draw, 0);

  const bx = body.x * scale;
  const by = body.y * scale;
  const bw = body.width * scale;
  const bh = body.height * scale;
  roundRect(ctx, bx, by, bw, bh, scale * 0.25);
  ctx.fillStyle = '#1b1d21';
  ctx.fill();
  ctx.strokeStyle = theme.dipEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const segments = draw.simulating
    ? ((draw.runtime?.display.segments as Record<string, boolean>) ?? {})
    : {};
  const colors = ledColor(String(instance.properties.color ?? 'red'));
  const thickness = Math.max(2, bw * 0.1);
  const padX = bw * 0.16;
  const padY = bh * 0.1;
  const innerW = bw - padX * 2;
  const innerH = bh - padY * 2;

  for (const [segment, shape] of Object.entries(SEGMENT_SHAPES)) {
    const [sx, sy, length, , orientation] = shape;
    const on = segments[segment] === true;
    ctx.fillStyle = on ? colors.on : 'rgba(255,255,255,0.06)';
    if (on) {
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = thickness * 1.6;
    }
    if (orientation === 'h') {
      ctx.fillRect(bx + padX + sx * innerW, by + padY + sy * innerH - thickness / 2, length * innerW, thickness);
    } else {
      ctx.fillRect(bx + padX + sx * innerW - thickness / 2, by + padY + sy * innerH, thickness, length * innerH);
    }
    ctx.shadowBlur = 0;
  }

  const dp = segments.dp === true;
  ctx.beginPath();
  ctx.arc(bx + bw * 0.9, by + bh * 0.9, thickness * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = dp ? colors.on : 'rgba(255,255,255,0.06)';
  ctx.fill();
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

function drawWarningBadge(draw: ComponentDrawContext, x: number, y: number): void {
  const { ctx, theme, scale } = draw;
  const size = Math.max(6, scale * 0.9);
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.6);
  ctx.lineTo(x + size * 0.6, y + size * 0.45);
  ctx.lineTo(x - size * 0.6, y + size * 0.45);
  ctx.closePath();
  ctx.fillStyle = theme.warning;
  ctx.fill();
  ctx.fillStyle = '#1b1d21';
  ctx.font = `700 ${size * 0.8}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + size * 0.08);
}

function drawSelectionOutline(
  instance: ComponentInstance,
  body: { x: number; y: number; width: number; height: number },
  draw: ComponentDrawContext,
): void {
  const { ctx, theme, scale } = draw;
  ctx.save();
  ctx.translate(draw.origin.x, draw.origin.y);
  ctx.rotate((instance.rotation * Math.PI) / 180);
  const pad = 2.5;
  roundRect(
    ctx,
    body.x * scale - pad,
    body.y * scale - pad,
    body.width * scale + pad * 2,
    body.height * scale + pad * 2,
    4,
  );
  ctx.strokeStyle = draw.selected ? theme.selection : theme.hover;
  ctx.lineWidth = draw.selected ? 2 : 1.4;
  if (!draw.selected) ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function withUprightText(
  ctx: CanvasRenderingContext2D,
  rotation: number,
  x: number,
  y: number,
  body: () => void,
): void {
  ctx.save();
  ctx.translate(x, y);
  // Keep text the right way up when the part is turned round.
  if (rotation === 180) ctx.rotate(Math.PI);
  else if (rotation === 90) ctx.rotate(-Math.PI / 2);
  else if (rotation === 270) ctx.rotate(Math.PI / 2);
  body();
  ctx.restore();
}

export function stateColor(theme: Theme, value: LogicValue, net?: ResolvedNet): string {
  if (net?.conflict) return theme.stateConflict;
  if (net?.isReference) return theme.stateGround;
  if (net?.strength === 'supply') return theme.stateSupply;
  switch (value) {
    case 'H':
      return theme.stateHigh;
    case 'L':
      return theme.stateLow;
    case 'X':
      return theme.stateConflict;
    default:
      return theme.stateFloating;
  }
}

export function pinScreenOffset(pin: PinDefinition, scale: number): GridPoint {
  return { x: pin.offset.x * scale, y: pin.offset.y * scale };
}

export { wireColorHex };
