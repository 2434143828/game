import { z } from 'zod';
import type { AnomalyId, Location, Point } from '../../contracts/data-contract';
import definition from '../../config/facility.json';
import { distance } from './path';
import type { CorridorSegment, Navigation } from './navigation';

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const rectSchema = pointSchema.extend({ width: z.number().positive(), height: z.number().positive() });
const roomSchema = z.object({
  workNodeId: z.string(), doorNodeId: z.string(), entryNodeId: z.string(),
  rect: rectSchema, creaturePoint: pointSchema,
});
const definitionSchema = z.object({
  id: z.string(), bounds: rectSchema,
  camera: z.object({ center: pointSchema, zoom: z.number().positive(), minZoom: z.number().positive(), maxZoom: z.number().positive() }),
  ambient: z.object({ speedMultiplier: z.number().positive(), waitMinSec: z.number().nonnegative(), waitMaxSec: z.number().nonnegative() }),
  safePoint: pointSchema, safeRect: rectSchema,
  nodes: z.array(pointSchema.extend({
    id: z.string(), zone: z.enum(['ROOM', 'CORRIDOR', 'TRANSIT', 'SAFE']),
    roomId: z.enum(['N01', 'N02', 'N03', 'N04', 'N05']).optional(), floorId: z.string().optional(),
  })).min(1),
  edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(['ROOM', 'CORRIDOR', 'TRANSIT', 'SAFE']) })),
  rooms: z.object({ N01: roomSchema, N02: roomSchema, N03: roomSchema, N04: roomSchema, N05: roomSchema }),
  halls: z.array(z.object({ id: z.string(), name: z.string(), subtitle: z.string(), rect: rectSchema, accent: z.string() })),
  idleNodeIds: z.array(z.string()), patrolNodeIds: z.array(z.string()),
});
export type FacilityDefinition = z.infer<typeof definitionSchema>;
export type FacilityNode = FacilityDefinition['nodes'][number];
interface Edge { id: string; a: FacilityNode; b: FacilityNode; kind: FacilityDefinition['edges'][number]['kind']; length: number }
type RoutePoint = Point & { segmentId?: string };
const epsilon = 1e-6;
const onEdge = (p: Point, edge: Edge): boolean => Math.abs(edge.a.x - edge.b.x) < epsilon
  ? Math.abs(p.x - edge.a.x) < epsilon && p.y >= Math.min(edge.a.y, edge.b.y) - epsilon && p.y <= Math.max(edge.a.y, edge.b.y) + epsilon
  : Math.abs(p.y - edge.a.y) < epsilon && p.x >= Math.min(edge.a.x, edge.b.x) - epsilon && p.x <= Math.max(edge.a.x, edge.b.x) + epsilon;
const asPoint = (p: Point): Point => ({ x: p.x, y: p.y });

export class GraphNavigation implements Navigation {
  readonly nodes: ReadonlyMap<string, FacilityNode>;
  readonly edges: readonly Edge[];
  readonly bounds;
  readonly safePoint;
  readonly idlePoints: readonly Point[];
  readonly patrolPoints: readonly Point[];
  private readonly corridors = new Map<string, CorridorSegment>();
  constructor(readonly definition: FacilityDefinition) {
    this.bounds = definition.bounds;
    this.safePoint = definition.safePoint;
    this.nodes = new Map(definition.nodes.map(node => [node.id, node]));
    if (this.nodes.size !== definition.nodes.length) throw new Error('config/facility.json nodes: duplicate node ID');
    if (definition.ambient.waitMaxSec < definition.ambient.waitMinSec) throw new Error('config/facility.json ambient: invalid wait range');
    this.edges = definition.edges.map((edge, index) => {
      const a = this.node(edge.from), b = this.node(edge.to), length = distance(a, b);
      if (length <= epsilon) throw new Error(`config/facility.json edges.${index}: zero-length edge`);
      if (Math.abs(a.x - b.x) > epsilon && Math.abs(a.y - b.y) > epsilon) throw new Error(`config/facility.json edges.${index}: only orthogonal walkways are supported`);
      if (edge.kind === 'CORRIDOR' && (Math.abs(a.y - b.y) > epsilon || a.floorId !== b.floorId)) throw new Error(`config/facility.json edges.${index}: corridor must stay on one horizontal floor`);
      return { id: `edge:${edge.from}:${edge.to}`, a, b, kind: edge.kind, length };
    });
    this.buildCorridors();
    this.idlePoints = definition.idleNodeIds.map(id => asPoint(this.node(id)));
    this.patrolPoints = definition.patrolNodeIds.map(id => asPoint(this.node(id)));
    const safe = this.locate(this.safePoint);
    if (!safe || safe.zone !== 'SAFE') throw new Error('config/facility.json safePoint: must be inside the safe walkway');
    for (const node of this.nodes.values()) {
      if (!this.contains(node) || this.route(safe, node) === null) throw new Error(`config/facility.json nodes.${node.id}: outside bounds or unreachable`);
    }
    for (const id of Object.keys(definition.rooms) as AnomalyId[]) {
      if (this.node(definition.rooms[id].workNodeId).roomId !== id || !this.corridorAt(this.doorPoint(id))) throw new Error(`config/facility.json rooms.${id}: invalid work or corridor entry node`);
      this.node(definition.rooms[id].doorNodeId);
    }
    for (const id of [...definition.idleNodeIds, ...definition.patrolNodeIds]) {
      if (this.node(id).zone !== 'CORRIDOR') throw new Error(`config/facility.json waypoint ${id}: must be a public corridor`);
    }
  }
  private node(id: string): FacilityNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`config/facility.json: unknown node ${id}`);
    return node;
  }
  private contains(p: Point): boolean {
    const b = this.bounds;
    return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  }
  workPoint(id: AnomalyId): Point { return asPoint(this.node(this.definition.rooms[id].workNodeId)); }
  doorPoint(id: AnomalyId): Point { return asPoint(this.node(this.definition.rooms[id].entryNodeId)); }
  locate(point: Point, from?: Location, towards?: Point): Location | null {
    if (!this.contains(point)) return null;
    const hint = (towards as RoutePoint | undefined)?.segmentId ?? (point as RoutePoint).segmentId ?? from?.segmentId;
    const hintedEdge = this.edges.find(edge => edge.id === hint && onEdge(point, edge));
    const exact = [...this.nodes.values()].find(node => distance(node, point) < epsilon);
    if (exact && (!hintedEdge || hintedEdge.a.id === exact.id || hintedEdge.b.id === exact.id)) return { ...asPoint(point), zone: exact.zone, ...(exact.roomId ? { roomId: exact.roomId } : {}), ...(exact.floorId ? { floorId: exact.floorId } : {}) };
    const candidates = this.edges.filter(edge => onEdge(point, edge));
    const edge = candidates.find(edge => edge.id === hint)
      ?? candidates.find(edge => towards && onEdge(towards, edge) && (!from || onEdge(from, edge)))
      ?? candidates[0];
    if (!edge) return null;
    const floorId = edge.a.floorId === edge.b.floorId ? edge.a.floorId : undefined;
    const roomId = edge.kind === 'ROOM' ? edge.a.roomId ?? edge.b.roomId : undefined;
    // The short threshold before the safe door is vulnerable; only the actual room heals/protects.
    const zone = edge.kind === 'SAFE' && (edge.a.zone !== 'SAFE' || edge.b.zone !== 'SAFE') ? 'SAFE_CONNECTOR' : edge.kind;
    return { ...asPoint(point), zone, segmentId: edge.id, ...(floorId ? { floorId } : {}), ...(roomId ? { roomId } : {}) };
  }
  private attachments(point: Point): Array<{ id: string; cost: number; edgeId?: string }> {
    const hint = (point as RoutePoint).segmentId;
    const hintedEdge = this.edges.find(edge => edge.id === hint && onEdge(point, edge));
    const exact = [...this.nodes.values()].find(node => distance(node, point) < epsilon);
    if (exact && (!hintedEdge || hintedEdge.a.id === exact.id || hintedEdge.b.id === exact.id)) return [{ id: exact.id, cost: 0 }];
    const edges = this.edges.filter(edge => (!hint || edge.id === hint) && onEdge(point, edge));
    return edges.flatMap(edge => [
      { id: edge.a.id, cost: distance(point, edge.a), edgeId: edge.id },
      { id: edge.b.id, cost: distance(point, edge.b), edgeId: edge.id },
    ]);
  }
  route(from: Location, to: Point): Point[] | null {
    const starts = this.attachments(from), ends = this.attachments(to);
    if (!starts.length || !ends.length) return null;
    if (distance(from, to) < epsilon && starts.some(start => start.cost < epsilon && ends.some(end => end.id === start.id && end.cost < epsilon))) return [];
    const fromHint = from.segmentId, toHint = (to as RoutePoint).segmentId;
    const common = this.edges.find(edge => (!fromHint || edge.id === fromHint) && (!toHint || edge.id === toHint)
      && onEdge(from, edge) && onEdge(to, edge)
      && starts.some(start => start.id === edge.a.id || start.id === edge.b.id)
      && ends.some(end => end.id === edge.a.id || end.id === edge.b.id));
    if (common) return distance(from, to) < epsilon ? [] : [{ ...asPoint(to), segmentId: common.id } as RoutePoint];
    const costs = new Map<string, number>(), previous = new Map<string, { nodeId: string | null; edgeId?: string }>(), visited = new Set<string>();
    for (const start of starts) if (start.cost < (costs.get(start.id) ?? Infinity)) {
      costs.set(start.id, start.cost); previous.set(start.id, { nodeId: null, edgeId: start.edgeId });
    }
    while (visited.size < this.nodes.size) {
      const next = [...costs.entries()].filter(([id]) => !visited.has(id)).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
      if (!next) break;
      const [id, cost] = next;
      visited.add(id);
      for (const edge of this.edges) {
        const other = edge.a.id === id ? edge.b.id : edge.b.id === id ? edge.a.id : null;
        if (other && cost + edge.length < (costs.get(other) ?? Infinity) - epsilon) {
          costs.set(other, cost + edge.length); previous.set(other, { nodeId: id, edgeId: edge.id });
        }
      }
    }
    const finish = ends.map(end => ({ ...end, total: (costs.get(end.id) ?? Infinity) + end.cost })).sort((a, b) => a.total - b.total)[0];
    if (!finish || !Number.isFinite(finish.total)) return null;
    const reversed: RoutePoint[] = [];
    let cursor: string | null = finish.id;
    while (cursor !== null) {
      const predecessor = previous.get(cursor);
      if (!predecessor) return null;
      reversed.push({ ...asPoint(this.node(cursor)), ...(predecessor.edgeId ? { segmentId: predecessor.edgeId } : {}) });
      cursor = predecessor.nodeId;
    }
    const path = reversed.reverse();
    if (distance(path[path.length - 1], to) > epsilon) path.push({ ...asPoint(to), segmentId: finish.edgeId });
    return path.filter((p, index) => distance(p, index === 0 ? from : path[index - 1]) > epsilon);
  }
  private buildCorridors(): void {
    const pending = new Set(this.edges.filter(edge => edge.kind === 'CORRIDOR').map(edge => edge.id));
    while (pending.size) {
      const seed = this.edges.find(edge => edge.id === pending.values().next().value)!;
      const connected = [seed], nodeIds = new Set([seed.a.id, seed.b.id]);
      pending.delete(seed.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of this.edges) if (pending.has(edge.id) && Math.abs(edge.a.y - seed.a.y) < epsilon && (nodeIds.has(edge.a.id) || nodeIds.has(edge.b.id))) {
          pending.delete(edge.id); connected.push(edge); nodeIds.add(edge.a.id); nodeIds.add(edge.b.id); changed = true;
        }
      }
      const xs = connected.flatMap(edge => [edge.a.x, edge.b.x]);
      const corridor = { id: `corridor:${seed.a.floorId ?? 'floor'}:${seed.a.id}`, minX: Math.min(...xs), maxX: Math.max(...xs), y: seed.a.y };
      for (const edge of connected) this.corridors.set(edge.id, corridor);
    }
  }
  corridorAt(point: Point): CorridorSegment | null {
    if (!this.contains(point)) return null;
    const hint = (point as RoutePoint).segmentId;
    const edges = this.edges.filter(edge => edge.kind === 'CORRIDOR' && (!hint || edge.id === hint) && onEdge(point, edge));
    return edges.length ? this.corridors.get(edges[0].id)! : null;
  }
  travelDistance(from: Location, to: Point): number {
    const path = this.route(from, to);
    if (!path) return Infinity;
    let previous: Point = from;
    return path.reduce((sum, next) => { const length = distance(previous, next); previous = next; return sum + length; }, 0);
  }
  nearestCorridor(from: Location): Location | null {
    if (from.zone === 'CORRIDOR' && this.corridorAt(from)) return { ...from };
    const candidates = [...this.nodes.values()].filter(node => node.zone === 'CORRIDOR' && this.corridorAt(node))
      .map(node => ({ node, distance: this.travelDistance(from, node) }))
      .filter(candidate => Number.isFinite(candidate.distance))
      .sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id));
    return candidates.length ? this.locate(candidates[0].node) : null;
  }
  combatDistance(from: Location, to: Location): number {
    if (from.zone !== 'CORRIDOR' || to.zone !== 'CORRIDOR') return Infinity;
    const a = this.corridorAt(from), b = this.corridorAt(to);
    return a && b && a.id === b.id ? distance(from, to) : Infinity;
  }
  knockback(from: Location, offsetX: number): Location {
    const corridor = this.corridorAt(from);
    if (!corridor) return { ...from };
    return this.locate({ x: Math.max(corridor.minX, Math.min(corridor.maxX, from.x + offsetX)), y: corridor.y })!;
  }
}

const parsed = definitionSchema.safeParse(definition);
if (!parsed.success) throw new Error(`config/facility.json: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
export const facilityDefinition: FacilityDefinition = parsed.data;
export const largeFacilityNavigation = new GraphNavigation(facilityDefinition);
