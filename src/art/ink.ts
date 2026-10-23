import type Phaser from 'phaser';
import type { Point } from '../../contracts/data-contract';

/** Shared, authored ink language. No randomness, wall time or gameplay mutations. */
export const PALETTE = {
  ink: 0x12161c,
  void: 0x12161c,
  distant: 0x1e2630,
  paper: 0xd9e1ea,
  paperShade: 0x9cabbc,
  wall: 0xb9c8d7,
  wallDark: 0x506176,
  steel: 0x39424e,
  rust: 0xff8a3d,
  moss: 0x78bdb6,
  cyan: 0x57b8ff,
  alarm: 0xff5b6e,
  panic: 0x9c6bff,
  pale: 0x8edcf0,
  gold: 0xffd84d,
} as const;

type Graphics = Phaser.GameObjects.Graphics;
const grain = (index: number, seed: number): number =>
  Math.sin(index * 2.73 + seed * 1.17) * 0.65 + Math.sin(index * 5.13 + seed * 0.41) * 0.35;

/** Stable irregularity is relative to the asset, so moving shapes do not crawl. */
export function inkPolygon(g: Graphics, points: readonly Point[], fill: number,
  width = 3, seed = 0, alpha = 1): void {
  if (points.length < 3) return;
  const outline: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    outline.push({ ...a });
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length > 18) {
      const bend = grain(i, seed) * Math.min(1.5, length * 0.018);
      outline.push({ x: (a.x + b.x) / 2 - dy / length * bend, y: (a.y + b.y) / 2 + dx / length * bend });
    }
  }
  g.fillStyle(fill, alpha).fillPoints(outline, true);
  if (width > 0) g.lineStyle(width, PALETTE.ink, alpha).strokePoints(outline, true);
}

export function inkBox(g: Graphics, x: number, y: number, w: number, h: number,
  fill: number, width = 3, seed = 0, alpha = 1): void {
  const bend = Math.min(1.7, w * 0.025, h * 0.04);
  inkPolygon(g, [
    { x, y: y + grain(1, seed) * bend },
    { x: x + w, y: y + grain(2, seed) * bend },
    { x: x + w + grain(3, seed) * bend, y: y + h },
    { x: x + grain(4, seed) * bend, y: y + h },
  ], fill, width, seed, alpha);
}

export function inkEllipse(g: Graphics, x: number, y: number, w: number, h: number,
  fill: number, width = 3, seed = 0, alpha = 1): void {
  const points: Point[] = [];
  const count = Math.max(12, Math.min(28, Math.ceil((w + h) / 5)));
  for (let i = 0; i < count; i++) {
    const theta = i * Math.PI * 2 / count;
    const uneven = 1 + grain(i, seed) * 0.024;
    points.push({ x: x + Math.cos(theta) * w / 2 * uneven, y: y + Math.sin(theta) * h / 2 * uneven });
  }
  g.fillStyle(fill, alpha).fillPoints(points, true);
  if (width > 0) g.lineStyle(width, PALETTE.ink, alpha).strokePoints(points, true);
}

export function inkLine(g: Graphics, x1: number, y1: number, x2: number, y2: number,
  width = 2, color: number = PALETTE.ink, seed = 0, alpha = 1): void {
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
  if (!length) return;
  const points: Point[] = [];
  for (let i = 0; i <= 3; i++) {
    const bend = i === 0 || i === 3 ? 0 : grain(i, seed) * Math.min(1.5, length * 0.016);
    points.push({ x: x1 + dx * i / 3 - dy / length * bend, y: y1 + dy * i / 3 + dx / length * bend });
  }
  g.lineStyle(width, color, alpha).strokePoints(points, false);
}

/** Sparse local hatching; callers provide a clear, non-interactive shadow patch. */
export function hatch(g: Graphics, x: number, y: number, w: number, h: number,
  color: number = PALETTE.ink, spacing = 9, alpha = 0.3): void {
  for (let i = 0, dx = 0; dx < w; dx += Math.max(5, spacing), i++) {
    const reach = Math.min(h * 0.55, w - dx);
    inkLine(g, x + dx, y + h, x + dx + reach, y + Math.max(0, h - reach * 1.5), 1, color, i, alpha);
  }
}
