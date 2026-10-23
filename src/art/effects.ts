import type Phaser from 'phaser';
import type { Point, Rect } from '../../contracts/data-contract';
import { inkLine, inkPolygon, PALETTE } from './ink';

/** vfx_hit_ink_a: brief brush marks and cut-paper chips, tied to actual hurt time. */
export function drawInkImpact(g: Phaser.GameObjects.Graphics, point: Point, remaining: number,
  color: number, seed = 0): void {
  const alpha = Math.min(1, remaining / 0.3);
  const spread = (1 - alpha) * 11;
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + seed * 0.37;
    const r = 8 + i % 3 * 3 + spread;
    const a = { x: point.x + Math.cos(angle) * r, y: point.y + Math.sin(angle) * r * 0.72 };
    const b = { x: point.x + Math.cos(angle) * (r + 7 + i % 3 * 3), y: point.y + Math.sin(angle) * (r + 7) * 0.72 };
    inkLine(g, a.x, a.y, b.x, b.y, 4, PALETTE.ink, i, alpha);
    if (i % 2) inkLine(g, a.x + 1, a.y - 1, b.x + 1, b.y - 1, 1.4, color, i, alpha);
    else inkPolygon(g, [b, { x: b.x + 4, y: b.y - 6 }, { x: b.x + 7, y: b.y + 1 }], color, 1, i, alpha);
  }
}

/** vfx_panic_smear_a: an actual panicked employee's irregular thought loop. */
export function drawPanicMarks(g: Phaser.GameObjects.Graphics, foot: Point, time: number): void {
  const marks: Point[] = [];
  const phase = Math.floor(time * 5) % 4;
  for (let i = 0; i < 15; i++) {
    const a = i * Math.PI * 2 / 14;
    marks.push({ x: foot.x + Math.cos(a) * (17 + (i + phase) % 3 * 2),
      y: foot.y - 72 + Math.sin(a) * 7 });
  }
  g.lineStyle(2, PALETTE.panic, 0.85).strokePoints(marks, false);
  inkLine(g, foot.x - 20, foot.y - 60, foot.x - 27, foot.y - 67, 2, PALETTE.panic, 4);
  inkLine(g, foot.x + 23, foot.y - 62, foot.x + 29, foot.y - 72, 2, PALETTE.panic, 5);
}

/** vfx_breach_frame_a: restrained scan tears at the actual breached room's edges. */
export function drawBreachFrame(g: Phaser.GameObjects.Graphics, rect: Rect, time: number): void {
  const phase = Math.floor(time * 4) % 5;
  const left = rect.x + 19, right = rect.x + rect.width - 19;
  for (let i = 0; i < 4; i++) {
    const y = rect.y + 92 + i * Math.max(23, (rect.height - 112) / 4);
    const reach = 16 + ((i + phase) % 4) * 8;
    inkLine(g, left, y, left + reach, y, 3, PALETTE.alarm, i, 0.65);
    inkLine(g, right - reach, y + 4, right, y + 4, 2, PALETTE.paper, i, 0.4);
  }
  const width = Math.min(96, rect.width / 4);
  for (const x of [left, right - width]) {
    inkLine(g, x, rect.y + 60, x + width, rect.y + 60, 4, PALETTE.alarm, phase);
  }
}
