import raw from '../../config/gameplay-v3.json';
import { z } from 'zod';
import type { AnomalyId, WeaponId } from '../../contracts/data-contract';
import type { CardDefinition } from './model';

export const anomalyIds: AnomalyId[] = ['N01', 'N02', 'N03', 'N04', 'N05'];
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const integer = positive.int();
const text = z.string().trim().min(1);
const cardId = z.string().regex(/^(T0[1-3]|N0[1-5]_[1-3])$/, '未知卡牌 ID');
const damage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FLAT'), type: z.enum(['RED', 'WHITE', 'BLACK']), amount: positive }).strict(),
  z.object({ kind: z.literal('MAX_RATIO'), type: z.literal('PALE'), amount: positive.max(1) }).strict(),
]);
const cardBase = z.object({ id: cardId, name: text, description: text, rangePx: positive, windupSec: positive });
// Effect-specific schemas prevent silent no-op cards and parameters the engine would ignore.
const cardSchema = z.discriminatedUnion('effect', [
  cardBase.extend({ effect: z.literal('DAMAGE'), target: z.literal('ENEMY'), damage, radiusPx: positive.optional() }).strict(),
  cardBase.extend({ effect: z.literal('BLOCK'), target: z.literal('SELF'), amount: positive.max(1), durationSec: positive }).strict(),
  cardBase.extend({ effect: z.literal('HEAL'), target: z.enum(['ALLY', 'TEAM']), amount: positive }).strict(),
  cardBase.extend({ effect: z.literal('STUN'), target: z.literal('ENEMY'), durationSec: positive }).strict(),
  cardBase.extend({ effect: z.literal('COPY'), target: z.literal('ENEMY'), amount: positive.max(1) }).strict(),
  cardBase.extend({ effect: z.literal('COUNTER'), target: z.literal('SELF'), amount: positive, durationSec: positive }).strict(),
  cardBase.extend({ effect: z.literal('KNOCKBACK'), target: z.literal('ENEMY'), amount: positive }).strict(),
  cardBase.extend({ effect: z.literal('DELAY'), target: z.literal('ENEMY'), durationSec: positive }).strict(),
  cardBase.extend({ effect: z.literal('AMPLIFY'), target: z.literal('TEAM'), amount: positive }).strict(),
]);
const enemyBase = z.object({
  hp: positive, rankHpMultiplier: nonnegative, attackPeriodSec: positive,
  rangePx: positive, moveSpeedPxPerSec: nonnegative, windupSec: positive,
  firstAttackDelaySec: nonnegative, specialEvery: integer, specialName: text,
  specialDamageMultiplier: positive, specialRangeMultiplier: positive,
});
const ordinaryEnemy = enemyBase.extend({ cloneCount: z.literal(0) }).strict();
const cloneEnemy = enemyBase.extend({
  cloneCount: z.literal(2), cloneHp: positive, cloneDamageMultiplier: positive,
  cloneAttackPeriodSec: positive, cloneSpawnOffsets: z.array(finite).length(2),
}).strict();
const threeCards = z.array(cardId).length(3);
const configSchema = z.object({
  version: z.literal('0.3.0'),
  combat: z.object({
    squadSize: z.literal(3), startingHand: z.literal(3), handLimit: z.literal(4),
    drawIntervalSec: positive, globalCardCooldownSec: positive,
    panicDurationSec: positive, panicRecoverFraction: positive.max(1),
    hitFeedbackSec: positive, actionFeedbackSec: positive,
  }).strict(),
  facility: z.object({
    offlineEarningCapSec: nonnegative, maxRank: z.literal(3),
    idleWaitSec: nonnegative, idleSpeedMultiplier: positive,
  }).strict(),
  arena: z.object({
    minX: finite, maxX: finite, y: finite, employeeSpawnX: z.array(finite).length(3), enemySpawnX: finite,
  }).strict(),
  tier: z.object({ damageMultipliers: z.array(positive), armorMultipliers: z.array(positive) }).strict(),
  production: z.object({ N01: z.array(nonnegative), N02: z.array(nonnegative), N03: z.array(nonnegative), N04: z.array(nonnegative), N05: z.array(nonnegative) }).strict(),
  captureCosts: z.object({ N01: z.literal(0), N02: nonnegative, N03: nonnegative, N04: nonnegative, N05: nonnegative }).strict(),
  // Capture confirmation is deliberately separate from combat damage.  Keeping
  // these values in config lets balance iterate without changing the state
  // machine or making 20% a hidden universal rule.
  capture: z.object({
    thresholdFraction: z.object({ N01: positive.max(1), N02: positive.max(1), N03: positive.max(1), N04: positive.max(1), N05: positive.max(1) }).strict(),
    deviceRangePx: positive,
    progressSec: positive,
    timeoutSec: positive,
    progressRetainFraction: positive.max(1),
  }).strict(),
  weaponCards: z.object({ W00: threeCards, W01: threeCards, W02: threeCards, W03: threeCards, W04: threeCards, W05: threeCards }).strict(),
  cards: z.record(cardId, cardSchema),
  enemies: z.object({ N01: cloneEnemy, N02: ordinaryEnemy, N03: ordinaryEnemy, N04: ordinaryEnemy, N05: ordinaryEnemy }).strict(),
}).strict().superRefine((value, context) => {
  const fail = (path: (string | number)[], message: string): void => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const expectedIds = ['T01', 'T02', 'T03', ...anomalyIds.flatMap(id => [1, 2, 3].map(n => `${id}_${n}`))];
  for (const id of expectedIds) if (!value.cards[id]) fail(['cards', id], '缺少卡牌定义');
  for (const [key, card] of Object.entries(value.cards)) if (key !== card.id) fail(['cards', key, 'id'], '卡牌键与 ID 不一致');
  for (const [weapon, ids] of Object.entries(value.weaponCards)) {
    if (new Set(ids).size !== 3) fail(['weaponCards', weapon], '同一把武器必须恰好提供三种卡');
    const expected = weapon === 'W00' ? ['T01', 'T02', 'T03'] : [1, 2, 3].map(n => `N${weapon.slice(1)}_${n}`);
    ids.forEach((id, index) => {
      if (!value.cards[id]) fail(['weaponCards', weapon, index], '卡牌引用不存在');
      if (!expected.includes(id)) fail(['weaponCards', weapon, index], '卡牌来源与武器不一致');
    });
  }
  for (const [name, multipliers] of Object.entries(value.tier)) {
    if (multipliers.length !== value.facility.maxRank) fail(['tier', name], '阶级倍率数量必须与 maxRank 一致');
  }
  for (const id of anomalyIds) {
    if (value.production[id].length !== value.facility.maxRank) fail(['production', id], '每个阶级都必须有产能');
    if (value.enemies[id].windupSec > value.enemies[id].attackPeriodSec) fail(['enemies', id, 'windupSec'], '前摇不能大于攻击周期');
  }
  const arena = value.arena;
  if (arena.minX >= arena.maxX) fail(['arena', 'maxX'], '场地右界必须大于左界');
  const inArena = (x: number): boolean => x >= arena.minX && x <= arena.maxX;
  arena.employeeSpawnX.forEach((x, index) => { if (!inArena(x)) fail(['arena', 'employeeSpawnX', index], '员工出生点不在场地内'); });
  if (new Set(arena.employeeSpawnX).size !== value.combat.squadSize) fail(['arena', 'employeeSpawnX'], '员工出生点不能重叠');
  if (!inArena(arena.enemySpawnX)) fail(['arena', 'enemySpawnX'], '敌人出生点不在场地内');
  value.enemies.N01.cloneSpawnOffsets.forEach((offset, index) => {
    if (!inArena(arena.enemySpawnX + offset)) fail(['enemies', 'N01', 'cloneSpawnOffsets', index], '分身出生点不在场地内');
  });
  if (new Set([0, ...value.enemies.N01.cloneSpawnOffsets]).size !== 3) fail(['enemies', 'N01', 'cloneSpawnOffsets'], '主样本和分身出生点不能重叠');
});

export type V3Config = z.infer<typeof configSchema>;
/** Reject before simulation starts; each diagnostic names the file and exact offending field. */
export function validateV3Config(value: unknown): V3Config {
  const result = configSchema.safeParse(value);
  if (!result.success) throw new Error(`config/gameplay-v3.json 配置校验失败：\n${result.error.issues.map(issue => `${issue.path.join('.') || '$'}: ${issue.message}`).join('\n')}`);
  return result.data;
}
export const v3Config = validateV3Config(raw);
export const cardById: Record<string, CardDefinition> = v3Config.cards;
export const weaponCards: Record<WeaponId, string[]> = v3Config.weaponCards;
