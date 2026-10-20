import type { Location, Point } from '../../contracts/data-contract';
import { config } from '../data/config';

const layout = config.game.layout;
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clampCorridor = (x: number): number => Math.max(layout.corridorMinX, Math.min(layout.corridorMaxX, x));
export function locate(point: Point): Location {
  if (distance(point, layout.safeCenter) < 0.001) return { ...point, zone: 'SAFE' };
  if (Math.abs(point.y - layout.corridorY) < 0.001) return { ...point, zone: 'CORRIDOR' };
  if (point.y > layout.corridorY) return { ...point, zone: 'SAFE_CONNECTOR' };
  const anomaly = config.anomalyData.anomalies.find(a => Math.abs(layout.roomCentersX[a.roomIndex] - point.x) < 0.001);
  return { ...point, zone: 'ROOM', roomId: anomaly?.id };
}
/** 树状节点图：房间支路、连续走廊、右侧安全室支路。 */
export function makePath(from: Location, to: Point): Point[] {
  if (distance(from, to) < 0.001) return [];
  if (Math.abs(from.x - to.x) < 0.001 && ((from.y <= layout.corridorY && to.y <= layout.corridorY) || (from.y >= layout.corridorY && to.y >= layout.corridorY))) return [{ ...to }];
  const points: Point[] = [];
  if (from.zone === 'ROOM') points.push({ x: from.x, y: layout.corridorY });
  else if (from.zone === 'SAFE' || from.zone === 'SAFE_CONNECTOR') points.push({ ...layout.safeEntrance });
  points.push({ x: to.x, y: layout.corridorY });
  if (Math.abs(to.y - layout.corridorY) > 0.001) points.push({ ...to });
  return points.filter((p, i, arr) => distance(p, i === 0 ? from : arr[i - 1]) > 0.001);
}
