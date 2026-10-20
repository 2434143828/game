import type { Point } from '../../../contracts/data-contract';
import { config } from '../../data/config';

/** One affine map is shared by feet, input, paths, weapon ranges and telegraphs. */
export const SLICE_GEOMETRY = {
  view: { x: 16, y: 76, width: 1328, height: 720 },
  transform: { x: 35, y: 130, scaleX: 1.05, scaleY: 1 },
  room: { x: 56, y: 128, width: 670, height: 277 },
  services: { x: 758, y: 128, width: 560, height: 277 },
  safe: { x: 1008, y: 620, width: 310, height: 110 },
  workMenu: { x: 474, y: 218, width: 242, rowHeight: 42 },
  corridorClickBand: { minY: 478, maxY: 590 },
  employeeHeight: 66,
} as const;

export function worldToScreen(point: Point): Point {
  const t = SLICE_GEOMETRY.transform;
  return { x: t.x + point.x * t.scaleX, y: t.y + point.y * t.scaleY };
}
export function screenToWorld(point: Point): Point {
  const t = SLICE_GEOMETRY.transform;
  return { x: (point.x - t.x) / t.scaleX, y: (point.y - t.y) / t.scaleY };
}
export function corridorPoint(screenX: number): Point {
  return {
    x: Math.max(config.game.layout.corridorMinX, Math.min(config.game.layout.corridorMaxX, screenToWorld({ x: screenX, y: 0 }).x)),
    y: config.game.layout.corridorY,
  };
}
export const workClickPoint: Point = { x: 480, y: 320 };
export const roomWorkFeet = worldToScreen({ x: config.game.layout.roomCentersX[0], y: config.game.layout.roomCenterY });
export const corridorFeetY = worldToScreen({ x: 0, y: config.game.layout.corridorY }).y;
export const safeFeet = worldToScreen(config.game.layout.safeCenter);
export const employeeDepthOffset = (index: number): number => index % 2 === 0 ? 0 : -8;
/** Constant presentation lanes, including ladder travel. They never change logical distance. */
export const employeeLateralOffset = (index: number): number => index % 2 === 0 ? -14 : 14;

