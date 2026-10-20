import type { AnomalyId, Point, Rect } from '../../../contracts/data-contract';
import facilityMap from '../../../config/facility.json';

/** Shared authored world geometry. Camera projection belongs to the scene. */
export const MAP_DEFINITION = facilityMap;
export const FACILITY_GEOMETRY = {
  view: { x: 16, y: 76, width: 1328, height: 720 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
  safe: MAP_DEFINITION.safeRect,
  corridorClickBand: { minY: 1270, maxY: 1380 },
  employeeHeight: 66,
  menuWidth: 238,
  menuRowHeight: 44,
} as const;
export const ROOM_COLORS: Record<AnomalyId, number> = {
  N01: 0xf3bd36, N02: 0xc66961, N03: 0x7c9b70, N04: 0x9a82c0, N05: 0x67a9bf,
};
/** Legacy names are identity: the Phaser camera performs the only projection. */
export function worldToScreen(point: Point): Point { return { x: point.x, y: point.y }; }
export function screenToWorld(point: Point): Point { return { x: point.x, y: point.y }; }
export const ROOM_RECTS = Object.fromEntries(Object.entries(MAP_DEFINITION.rooms).map(([id, room]) => [id, room.rect])) as Record<AnomalyId, Rect>;
export const MAP_NODES = Object.fromEntries(MAP_DEFINITION.nodes.map(node => [node.id, node]));
export function roomWorkFeet(id: AnomalyId): Point {
  const node = MAP_NODES[MAP_DEFINITION.rooms[id].workNodeId];
  return { x: node.x, y: node.y };
}
export function creatureFeet(id: AnomalyId): Point { return { ...MAP_DEFINITION.rooms[id].creaturePoint }; }
export function roomClickPoint(id: AnomalyId): Point {
  const rect = ROOM_RECTS[id];
  return { x: rect.x + rect.width / 2, y: rect.y + 72 };
}
/** Compatibility helper for the operations gallery. New input projects to map edges. */
export function corridorPoint(worldX: number): Point {
  return { x: Math.max(1040, Math.min(2480, worldX)), y: 1360 };
}
export const corridorFeetY = 1360;
export const safeFeet = { ...MAP_DEFINITION.safePoint };
/** Stable presentation lanes prevent a group sharing a logical point from becoming one body. */
export function employeeOffset(index: number): Point {
  return { x: [-45, -15, 15, 45, -30, 30][index % 6], y: index < 4 ? 0 : -12 };
}
export const inRect = (point: Point, rect: Rect): boolean => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
