import type { AnomalyId, Location, Point, Rect } from '../../contracts/data-contract';
import { anomalyById, config } from '../data/config';
import { clampCorridor, distance, locate, makePath } from './path';

export interface AmbientConfig {
  speedMultiplier: number;
  waitMinSec: number;
  waitMaxSec: number;
}
export interface CorridorSegment {
  id: string;
  minX: number;
  maxX: number;
  y: number;
}
export interface Navigation {
  readonly bounds: Rect;
  readonly safePoint: Point;
  readonly idlePoints: readonly Point[];
  readonly patrolPoints: readonly Point[];
  workPoint(id: AnomalyId): Point;
  doorPoint(id: AnomalyId): Point;
  locate(point: Point, from?: Location, towards?: Point): Location | null;
  /** null means unreachable; [] means already at the destination. */
  route(from: Location, to: Point): Point[] | null;
  corridorAt(point: Point): CorridorSegment | null;
  /** Closest reachable legal combat landing, measured along the navigation graph. */
  nearestCorridor(from: Location): Location | null;
  travelDistance(from: Location, to: Point): number;
  /** Ordinary weapons/AOE cannot cross floors or intervening walls. */
  combatDistance(from: Location, to: Location): number;
  knockback(from: Location, offsetX: number): Location;
}

const layout = config.game.layout;
/** Existing slice and simulation tests retain the original one-corridor world. */
export const legacyNavigation: Navigation = {
  bounds: layout.sceneBounds,
  safePoint: layout.safeCenter,
  idlePoints: [],
  patrolPoints: [
    { x: layout.corridorMaxX, y: layout.corridorY },
    { x: layout.corridorMinX, y: layout.corridorY },
  ],
  workPoint: id => ({ x: layout.roomCentersX[anomalyById[id].roomIndex], y: layout.roomCenterY }),
  doorPoint: id => ({ x: layout.roomCentersX[anomalyById[id].roomIndex], y: layout.corridorY }),
  locate,
  route: makePath,
  corridorAt(point) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.y - layout.corridorY) > 1e-7
      || point.x < layout.corridorMinX || point.x > layout.corridorMaxX) return null;
    return { id: 'legacy-corridor', minX: layout.corridorMinX, maxX: layout.corridorMaxX, y: layout.corridorY };
  },
  nearestCorridor: from => locate({ x: clampCorridor(from.x), y: layout.corridorY }),
  travelDistance(from, to) {
    let previous: Point = from;
    return makePath(from, to).reduce((total, next) => {
      const length = distance(previous, next);
      previous = next;
      return total + length;
    }, 0);
  },
  combatDistance: (from, to) => from.zone === 'CORRIDOR' && to.zone === 'CORRIDOR'
    ? distance(from, to) : Number.POSITIVE_INFINITY,
  knockback: (from, offsetX) => locate({ x: clampCorridor(from.x + offsetX), y: from.y }),
};
