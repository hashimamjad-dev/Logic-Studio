/**
 * Drawing a breadboard.
 *
 * Everything drawn here comes from the board definition: if a hole is painted, the
 * model has a hole there, and if two rail segments are drawn with a gap between them
 * it is because they really are two separate clips. There is no background image.
 */

import type { Breadboard } from '../breadboard/Breadboard';
import { railHasHole } from '../breadboard/BreadboardDefinition';
import type { ResolvedNet } from '../simulation/SimulationEngine';
import type { Theme } from './theme';

export interface BoardDrawContext {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  scale: number;
  /** Screen position of the board origin. */
  originX: number;
  originY: number;
  /** Simulation values, when running. Undefined in design mode. */
  netOfGroup?: (groupId: string) => ResolvedNet | undefined;
  showLabels: boolean;
}

export function drawBreadboard(board: Breadboard, draw: BoardDrawContext): void {
  const { ctx, theme, scale, originX, originY } = draw;
  const definition = board.definition;
  const body = definition.body;

  const x = originX + body.x * scale;
  const y = originY + body.y * scale;
  const width = body.width * scale;
  const height = body.height * scale;

  ctx.save();

  // Body
  ctx.shadowColor = theme.boardShadow;
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, width, height, Math.min(10, scale * 0.6));
  ctx.fillStyle = theme.boardBody;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = theme.boardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rail stripes, one per segment so a split rail visibly breaks.
  for (const rail of definition.rails) {
    const stripeColor = rail.polarity === 'positive' ? theme.railPositive : theme.railNegative;
    const railY = originY + rail.y * scale;
    const offset = rail.polarity === 'positive' ? -0.75 : 0.75;
    for (const segment of rail.segments) {
      const from = originX + (segment.fromColumn - 1.4) * scale;
      const to = originX + (segment.toColumn - 0.6) * scale;
      ctx.beginPath();
      ctx.moveTo(from, railY + offset * scale);
      ctx.lineTo(to, railY + offset * scale);
      ctx.strokeStyle = stripeColor;
      ctx.lineWidth = Math.max(1, scale * 0.09);
      ctx.stroke();
    }
    if (draw.showLabels) {
      ctx.fillStyle = stripeColor;
      ctx.font = `700 ${Math.max(8, scale * 0.85)}px "Inter", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rail.label, originX - scale * 1.2, railY);
      ctx.fillText(rail.label, originX + (definition.columns + 0.2) * scale, railY);
    }
  }

  // Centre trenches: a recessed channel, which is the whole reason a DIP works.
  for (const trench of definition.trenches) {
    const trenchY = originY + trench.y * scale;
    const trenchHeight = trench.height * scale;
    ctx.fillStyle = theme.boardTrench;
    ctx.fillRect(x + scale * 0.4, trenchY, width - scale * 0.8, trenchHeight);
    ctx.strokeStyle = theme.boardEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + scale * 0.4, trenchY);
    ctx.lineTo(x + width - scale * 0.4, trenchY);
    ctx.moveTo(x + scale * 0.4, trenchY + trenchHeight);
    ctx.lineTo(x + width - scale * 0.4, trenchY + trenchHeight);
    ctx.stroke();
  }

  // Column numbers and row letters.
  if (draw.showLabels && scale > 7) {
    ctx.fillStyle = theme.boardTextMuted;
    ctx.font = `600 ${Math.max(7, scale * 0.68)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const firstBank = definition.banks[0];
    for (let column = 1; column <= definition.columns; column++) {
      if (column !== 1 && column % definition.labelEvery !== 0) continue;
      const labelX = originX + (column - 1) * scale;
      ctx.fillText(String(column), labelX, originY + (firstBank.y - 0.65) * scale);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const bank of definition.banks) {
      bank.rows.forEach((row, index) => {
        const rowY = originY + (bank.y + index) * scale;
        ctx.fillText(row, originX - scale * 0.7, rowY);
        ctx.textAlign = 'left';
        ctx.fillText(row, originX + (definition.columns - 0.35) * scale, rowY);
        ctx.textAlign = 'right';
      });
    }
  }

  // Holes.
  const holeSize = Math.max(2, scale * 0.42);
  for (const bank of definition.banks) {
    bank.rows.forEach((_, rowIndex) => {
      for (let column = 1; column <= definition.columns; column++) {
        const hole = board.getHole(`${bank.rows[rowIndex]}${column}`);
        if (!hole) continue;
        drawHole(
          draw,
          originX + hole.local.x * scale,
          originY + hole.local.y * scale,
          holeSize,
          hole.groupId,
        );
      }
    });
  }
  for (const rail of definition.rails) {
    for (const segment of rail.segments) {
      for (let column = segment.fromColumn; column <= segment.toColumn; column++) {
        if (!railHasHole(column)) continue;
        const hole = board.getHole(`${rail.id}${column}`);
        if (!hole) continue;
        drawHole(
          draw,
          originX + hole.local.x * scale,
          originY + hole.local.y * scale,
          holeSize,
          hole.groupId,
        );
      }
    }
  }

  ctx.restore();
}

function drawHole(
  draw: BoardDrawContext,
  cx: number,
  cy: number,
  size: number,
  groupId: string,
): void {
  const { ctx, theme } = draw;
  const half = size / 2;

  // A live net gets a coloured ring, so you can see at a glance which clips are
  // carrying something. Nothing is drawn for a clip with nothing attached.
  const net = draw.netOfGroup?.(groupId);
  if (net && net.value !== 'Z') {
    ctx.beginPath();
    ctx.arc(cx, cy, half * 2.1, 0, Math.PI * 2);
    ctx.fillStyle = stateTint(theme, net);
    ctx.fill();
  }

  ctx.fillStyle = theme.holeRim;
  ctx.fillRect(cx - half - 1, cy - half - 1, size + 2, size + 2);
  ctx.fillStyle = theme.hole;
  ctx.fillRect(cx - half, cy - half, size, size);
}

function stateTint(theme: Theme, net: ResolvedNet): string {
  if (net.conflict) return withAlpha(theme.stateConflict, 0.5);
  if (net.isReference) return withAlpha(theme.stateGround, 0.25);
  if (net.strength === 'supply') return withAlpha(theme.stateSupply, 0.45);
  if (net.value === 'H') return withAlpha(theme.stateHigh, 0.4);
  if (net.value === 'L') return withAlpha(theme.stateLow, 0.3);
  if (net.value === 'X') return withAlpha(theme.stateConflict, 0.45);
  return 'transparent';
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
