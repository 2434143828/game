import { z } from 'zod';
import type { Result } from '../../contracts/data-contract';
import { anomalyIdSchema, armorById, armorIdSchema, config, employeeIdSchema, weaponById, weaponIdSchema } from '../data/config';
import { validateSave } from '../save/storage';
import { makeState } from '../simulation/state';
import { largeFacilityNavigation } from '../simulation/graphNavigation';
import { createV3State } from './engine';
import { cardById, v3Config, weaponCards } from './config';
import type { V3SaveEnvelope, V3State } from './model';

export type V3Storage = Pick<Storage, 'getItem' | 'setItem'>;
export const V3_SAVE_KEY = 'wanggeng.demo.v3';
export const LEGACY_BACKUP_KEY = `${V3_SAVE_KEY}.legacy-backup`;
const n = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integer = n.int();
const text = z.string().max(2000);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const combatEventPoint = point;
// GraphNavigation emits route edges as metadata to disambiguate crossings on different floors.
// Keep that metadata through JSON round trips; stripping it changes the actual route.
const waypoint = point.extend({ segmentId: text.optional() });
const location = point.extend({ zone: z.enum(['ROOM', 'CORRIDOR', 'SAFE_CONNECTOR', 'SAFE', 'TRANSIT']), roomId: anomalyIdSchema.optional(), floorId: text.optional(), segmentId: text.optional() });
const tier = z.number().int().min(1).max(v3Config.facility.maxRank);
const damage = z.discriminatedUnion('kind', [
  z.object({ type: z.enum(['RED', 'WHITE', 'BLACK']), kind: z.literal('FLAT'), amount: n }).strict(),
  z.object({ type: z.literal('PALE'), kind: z.literal('MAX_RATIO'), amount: n.max(1) }).strict(),
]);
const attack = z.enum(['WINDUP', 'HIT', 'RECOVERY']);
const employee = z.object({
  id: employeeIdSchema, displayName: text, status: z.enum(['IDLE', 'MOVING', 'WORKING', 'SUPPRESSING', 'PANICKED', 'INCAPACITATED']),
  hp: n, sp: n, hpMax: n.positive(), spMax: n.positive(), location, path: z.array(waypoint).max(500),
  order: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('IDLE') }).strict(), z.object({ kind: z.literal('MOVE'), destination: point }).strict(),
    z.object({ kind: z.literal('WORK'), roomId: anomalyIdSchema, workId: text }).strict(),
    z.object({ kind: z.literal('SUPPRESS'), enemyId: text }).strict(), z.object({ kind: z.literal('RETREAT') }).strict(),
  ]),
  weaponId: weaponIdSchema, armorId: armorIdSchema, safeStayElapsedSec: n, moveBuffRemainingSec: n,
  attackPhase: attack, nextAttackStartAtSec: n, windupEndsAtSec: n.nullable(),
  weaponTier: tier, armorTier: tier, hitUntilSec: n, actionUntilSec: n, panicUntilSec: n,
  blockUntilSec: n, blockReduction: n.max(1), counterUntilSec: n, counterDamage: n, removedCards: z.boolean(),
  home: location, idleNextAtSec: n, idleCycle: integer, attackTargetId: text.nullable(),
}).strict().refine(e => e.hp <= e.hpMax && e.sp <= e.spMax, '生命和精神不得超过上限');
const card = z.object({ instanceId: text, cardId: text.refine(id => Object.prototype.hasOwnProperty.call(cardById, id)), ownerId: employeeIdSchema, sourceWeaponId: weaponIdSchema, tier }).strict()
  .refine(c => weaponCards[c.sourceWeaponId].includes(c.cardId), '卡牌必须属于来源武器');
const cards = z.array(card).max(9);
const enemy = z.object({
  id: text, sourceAnomalyId: anomalyIdSchema, breachInstanceId: text, isClone: z.boolean(), mainEnemyId: text.nullable(), location,
  suppressionHp: n, suppressionHpMax: n.positive(), targetEmployeeId: employeeIdSchema.nullable(), attackPhase: attack,
  nextAttackStartAtSec: n, windupEndsAtSec: n.nullable(), stunnedUntilSec: n, pendingForcedHowl: z.boolean(),
  hitUntilSec: n, actionUntilSec: n, attackOrdinal: integer, intent: text, specialAttack: z.boolean(), warningRangePx: n,
  // Optional for v0.3 saves; v0.4 capture encounters persist this state.
  captureState: z.enum(['ACTIVE', 'CAPTURABLE', 'CAPTURED']).optional(),
}).strict();
const encounter = z.object({
  id: text, mode: z.enum(['CAPTURE', 'BREACH_CHALLENGE']), targetAnomalyId: anomalyIdSchema, startRank: integer.max(v3Config.facility.maxRank),
  squadIds: z.array(employeeIdSchema).length(3), paused: z.boolean(), speed: z.union([z.literal(1), z.literal(2)]),
  deck: z.object({ drawPile: cards, hand: cards.max(v3Config.combat.handLimit), discardPile: cards, exhausted: cards, drawTimer: n, globalCooldown: n,
    pendingCast: z.object({ instanceId: text, targetId: text, requestId: text, phase: z.enum(['APPROACH', 'WINDUP']), resolvesAtSec: n.nullable() }).strict().nullable(),
  }).strict(),
  enemies: z.array(enemy).max(3), focusEnemyId: text.nullable(), result: z.enum(['VICTORY', 'DEFEAT', 'ABANDONED']).nullable(),
  rewardApplied: z.boolean(), elapsedSec: n, lastAttackCard: z.object({ damage, targetId: text }).strict().nullable(),
  nextAttackMultiplier: n, casualties: z.array(employeeIdSchema).max(3),
  // Optional for old v0.3 snapshots. Runtime normalizes missing fields to COMBAT.
  capturePhase: z.enum(['COMBAT', 'CAPTURABLE', 'CAPTURING', 'CAPTURED']).optional(),
  captureEmployeeId: employeeIdSchema.nullable().optional(), captureProgressSec: n.optional(), captureDeadlineSec: n.nullable().optional(),
}).strict();
const stateSchema = z.object({
  saveVersion: z.literal(3), phase: z.enum(['FACILITY', 'ENCOUNTER']), wallet: n, simulationTimeSec: n,
  timeScale: z.union([z.literal(0), z.literal(1), z.literal(2)]), speed: z.union([z.literal(1), z.literal(2)]),
  rooms: z.array(z.object({ anomalyId: anomalyIdSchema, owned: z.boolean(), rank: integer.max(v3Config.facility.maxRank), state: z.enum(['LOCKED', 'STABLE', 'IN_CHALLENGE']) }).strict()).length(5),
  employees: z.array(employee).min(3).max(6), encounter: encounter.nullable(), rngState: integer.max(0xffffffff), sequence: integer,
  // Card presentation metadata is persisted with the event so a reload cannot
  // silently roll back the battle immediately after a successful cast.
  logs: z.array(z.object({ id: text, timeSec: n, kind: text, message: text, sourceId: text.optional(), targetId: text.optional(), amount: n.optional(), cardId: text.optional(), instanceId: text.optional(), sourcePoint: combatEventPoint.optional(), targetPoint: combatEventPoint.optional() }).strict()).max(1000),
  ownedWeapons: z.array(weaponIdSchema).max(6), ownedArmors: z.array(armorIdSchema).max(6), migrationSummary: z.array(text).max(100),
}).strict().superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  for (const values of [s.rooms.map(r => r.anomalyId), s.employees.map(e => e.id), s.ownedWeapons, s.ownedArmors]) {
    if (new Set(values).size !== values.length) fail('存档 ID 重复');
  }
  for (const room of s.rooms) {
    if (room.owned ? room.rank < 1 || room.state === 'LOCKED' : room.rank !== 0 || room.state !== 'LOCKED') fail('收容进度不一致');
  }
  for (const source of [...s.ownedWeapons.map(id => weaponById[id].sourceAnomalyId), ...s.ownedArmors.map(id => armorById[id].sourceAnomalyId)]) {
    if (source !== null && !s.rooms.find(r => r.anomalyId === source)?.owned) fail('库存装备来源尚未收容');
  }
  const weapons = new Set<string>(); const armors = new Set<string>();
  for (const e of s.employees) {
    for (const [id, source, owned, used, equipTier] of [
      [e.weaponId, weaponById[e.weaponId].sourceAnomalyId, s.ownedWeapons, weapons, e.weaponTier],
      [e.armorId, armorById[e.armorId].sourceAnomalyId, s.ownedArmors, armors, e.armorTier],
    ] as const) {
      if (source === null) { if (equipTier !== 1) fail('训练装备只有 I 阶'); continue; }
      if (!(owned as readonly string[]).includes(id) || used.has(id)) fail('专属装备必须已拥有且不能重复配置');
      used.add(id);
      if ((s.rooms.find(r => r.anomalyId === source)?.rank ?? 0) < equipTier) fail('装备阶级超出收容进度');
    }
  }
  if ((s.phase === 'ENCOUNTER') !== (s.encounter !== null)) fail('战斗状态不一致');
  if (!s.encounter && s.rooms.some(r => r.state === 'IN_CHALLENGE')) fail('无战斗时不能保留挑战房间');
  if (s.encounter) {
    const battle = s.encounter;
    if (new Set(battle.squadIds).size !== 3 || battle.squadIds.some(id => !s.employees.some(e => e.id === id))) fail('小队不合法');
    const all = [...battle.deck.drawPile, ...battle.deck.hand, ...battle.deck.discardPile, ...battle.deck.exhausted];
    if (all.length !== 9 || new Set(all.map(c => c.instanceId)).size !== 9) fail('共享牌组必须恰好九张唯一实例');
    for (const c of all) {
      const owner = s.employees.find(e => e.id === c.ownerId);
      if (!battle.squadIds.includes(c.ownerId) || owner?.weaponId !== c.sourceWeaponId || owner.weaponTier !== c.tier) fail('卡牌所有者或装备不一致');
    }
    if (battle.mode === 'CAPTURE') {
      const phase = battle.capturePhase ?? 'COMBAT';
      const main = battle.enemies.find(enemy => !enemy.isClone);
      if (battle.captureEmployeeId !== undefined && battle.captureEmployeeId !== null && !battle.squadIds.includes(battle.captureEmployeeId)) fail('收容员工必须属于当前小队');
      if (phase === 'CAPTURING' && !battle.captureEmployeeId) fail('收容进行中必须绑定操作员工');
      if (phase !== 'CAPTURING' && battle.captureEmployeeId) fail('非收容进行阶段不能绑定操作员工');
      if ((battle.captureProgressSec ?? 0) > v3Config.capture.progressSec + 1e-7) fail('收容进度超出配置上限');
      if (phase === 'COMBAT' && (battle.captureProgressSec ?? 0) > 1e-7) fail('战斗阶段不能保留收容进度');
      if (phase !== 'COMBAT' && !main) fail('收容阶段缺少主目标');
      if (phase !== 'COMBAT' && main && main.captureState !== (phase === 'CAPTURED' ? 'CAPTURED' : 'CAPTURABLE')) fail('收容阶段与目标状态不一致');
      if (phase === 'COMBAT' && main?.captureState !== undefined && main.captureState !== 'ACTIVE') fail('战斗阶段目标必须处于活动状态');
      if (phase === 'CAPTURING' && (battle.captureDeadlineSec === undefined || battle.captureDeadlineSec === null)) fail('收容进行中必须保存截止时间');
      if (phase !== 'CAPTURING' && battle.captureDeadlineSec !== undefined && battle.captureDeadlineSec !== null) fail('非收容进行阶段不能保留截止时间');
      if (phase === 'CAPTURED' && Math.abs((battle.captureProgressSec ?? 0) - v3Config.capture.progressSec) > 1e-7) fail('收容完成但进度未达上限');
    }
  }
});
const envelopeSchema = z.object({ saveVersion: z.literal(3), savedAtMs: n, state: stateSchema }).strict();
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Boundary validation never mutates or removes the original stored text. */
export function validateV3Save(value: unknown): Result<V3SaveEnvelope> {
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data as V3SaveEnvelope } : { ok: false, code: 'INVALID_V3_SAVE', message: `新版存档格式不兼容，原文保留：${parsed.error.issues.slice(0, 4).map(i => `${i.path.join('.')}: ${i.message}`).join('；')}` };
}

export function saveV3(storage: V3Storage, state: V3State, nowMs: number): Result<void> {
  const validated = validateV3Save({ saveVersion: 3, savedAtMs: nowMs, state });
  if (!validated.ok) return validated;
  try {
    storage.setItem(V3_SAVE_KEY, JSON.stringify(validated.value));
    return { ok: true, value: undefined };
  } catch (error) { return { ok: false, code: 'STORAGE_WRITE_FAILED', message: `新版存档未写入，原数据保留：${errorText(error)}` }; }
}

/** Migration is deliberately limited to the actual legacy day-entry contract. */
export function migrateLegacy(raw: string): Result<V3State> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, code: 'INVALID_LEGACY_JSON', message: '旧存档 JSON 损坏，原文保留。' }; }
  const valid = validateSave(parsed);
  if (!valid.ok) return valid;
  const { day, progress } = valid.value.snapshot;
  const state = createV3State(largeFacilityNavigation);
  const template = state.employees[0]!;
  state.employees = makeState(valid.value.snapshot, template.home).employees.map((e, index) => ({ ...structuredClone(template), ...e, home: { ...template.home }, idleCycle: index }));
  state.wallet = progress.wallet;
  const activeIds = config.days.find(d => d.day === day)!.activeAnomalyIds;
  for (const room of state.rooms) {
    room.owned = activeIds.includes(room.anomalyId); room.rank = room.owned ? 1 : 0; room.state = room.owned ? 'STABLE' : 'LOCKED';
  }
  state.ownedWeapons = [...progress.ownedWeapons]; state.ownedArmors = [...progress.ownedArmors];
  // v0.3 unlocks one equipment pair for every previously available containment.
  for (const anomaly of config.anomalyData.anomalies.filter(a => activeIds.includes(a.id))) {
    if (!state.ownedWeapons.includes(anomaly.weaponId)) state.ownedWeapons.push(anomaly.weaponId);
    if (!state.ownedArmors.includes(anomaly.armorId)) state.ownedArmors.push(anomaly.armorId);
  }
  for (const e of state.employees) {
    const loadout = progress.employeeLoadouts[e.id];
    e.weaponId = loadout?.weaponId ?? 'W00'; e.armorId = loadout?.armorId ?? 'A00'; e.weaponTier = 1; e.armorTier = 1;
  }
  state.migrationSummary = [
    `已迁移旧版第 ${day} 日的能量 ${progress.wallet}、装备库存与员工配装。`,
    `旧档没有独立拥有标记，按该日已开放的 ${activeIds.join('、')} 映射为稳定 I 阶，并开放对应 E.G.O.。`,
    '旧档仅有日初快照，没有中途生命、精神和时间戳；按日初状态恢复，不结算离线收益。旧研究、技能及其它原文完整保留在备份中。',
  ];
  return { ok: true, value: state };
}

export interface V3LoadResult { status: 'EMPTY' | 'LOADED' | 'BLOCKED'; state?: V3State; message: string }

export function loadV3(storage: V3Storage, nowMs: number): V3LoadResult {
  if (!Number.isFinite(nowMs) || nowMs < 0) return { status: 'BLOCKED', message: '当前时间无效，未读取存档。' };
  try {
    const raw = storage.getItem(V3_SAVE_KEY);
    if (raw !== null) {
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return { status: 'BLOCKED', message: '新版存档 JSON 损坏，原文保留。' }; }
      const valid = validateV3Save(value);
      if (!valid.ok) return { status: 'BLOCKED', message: valid.message };
      const { state, savedAtMs } = valid.value;
      let message = '已恢复 v0.3 存档。';
      const inBattle = state.encounter !== null;
      if (inBattle) {
        const squadIds = state.encounter!.squadIds;
        state.encounter = null; state.phase = 'FACILITY'; state.timeScale = state.speed;
        state.rooms.forEach(r => { r.state = r.owned ? 'STABLE' : 'LOCKED'; });
        for (const e of state.employees.filter(employee => squadIds.includes(employee.id))) {
          e.location = { ...e.home }; e.path = []; e.order = { kind: 'IDLE' };
          e.status = e.hp <= 0 ? 'INCAPACITATED' : e.sp <= 0 ? 'PANICKED' : 'IDLE';
          e.attackPhase = 'RECOVERY'; e.attackTargetId = null; e.windupEndsAtSec = null;
          e.nextAttackStartAtSec = state.simulationTimeSec; e.hitUntilSec = 0; e.actionUntilSec = 0;
          e.panicUntilSec = 0; e.blockUntilSec = 0; e.blockReduction = 0; e.counterUntilSec = 0; e.counterDamage = 0;
          e.removedCards = false;
        }
        message = '退出中的战斗按放弃处理：无挑战奖励、无离线产能，已返回设施；能量、装备、阶级及生命精神保留。';
      }
      const beforeWallet = state.wallet;
      const offlineSec = !inBattle && state.timeScale !== 0 ? Math.min(v3Config.facility.offlineEarningCapSec, Math.max(0, (nowMs - savedAtMs) / 1000)) : 0;
      const perMinute = state.rooms.filter(r => r.owned && r.state === 'STABLE').reduce((sum, r) => sum + v3Config.production[r.anomalyId][r.rank - 1]!, 0);
      state.wallet = Math.min(Number.MAX_SAFE_INTEGER, state.wallet + perMinute * offlineSec / 60);
      // Claim the boundary before exposing the credit: an immediate reload cannot claim it twice.
      const persisted = saveV3(storage, state, Math.max(nowMs, savedAtMs));
      if (!persisted.ok) {
        state.wallet = beforeWallet;
        return { status: 'BLOCKED', state, message: `${message} 离线收益未领取（无法保存结算边界）。${persisted.message}` };
      }
      if (offlineSec > 0) message += ` 离线 ${Math.floor(offlineSec)} 秒，获得 ${(state.wallet - beforeWallet).toFixed(2)} 能量。`;
      return { status: 'LOADED', state, message };
    }
    const legacyRaw = storage.getItem(config.game.save.key);
    if (legacyRaw === null) return { status: 'EMPTY', message: '没有本地存档。' };
    // Backup is mandatory even for unrecognized legacy data; never touch the legacy key.
    const previousBackup = storage.getItem(LEGACY_BACKUP_KEY);
    const backupKey = previousBackup === null || previousBackup === legacyRaw ? LEGACY_BACKUP_KEY : `${LEGACY_BACKUP_KEY}.${nowMs}`;
    if (storage.getItem(backupKey) !== legacyRaw) {
      if (storage.getItem(backupKey) !== null) return { status: 'BLOCKED', message: '旧档备份键冲突，未迁移；原文保留。' };
      storage.setItem(backupKey, legacyRaw);
    }
    const migrated = migrateLegacy(legacyRaw);
    if (!migrated.ok) return { status: 'BLOCKED', message: `${migrated.message} 旧档原文已备份。` };
    const saved = saveV3(storage, migrated.value, nowMs);
    if (!saved.ok) return { status: 'BLOCKED', message: saved.message };
    return { status: 'LOADED', state: migrated.value, message: migrated.value.migrationSummary.join(' ') };
  } catch (error) { return { status: 'BLOCKED', message: `存储读取或旧档备份失败，未迁移、未覆盖原数据：${errorText(error)}` }; }
}
