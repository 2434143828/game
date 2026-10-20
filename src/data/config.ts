import { z } from 'zod';
import type {
  AnomalyConfig, AnomalyId, ArmorConfig, ArmorId, ConfigBundle, DayConfig,
  DayNumber, SkillConfig, SkillId, WeaponConfig, WeaponId,
} from '../../contracts/data-contract';
import rawGame from '../../config/game.json';
import rawDays from '../../config/days.json';
import rawAnomalies from '../../config/anomalies.json';
import rawEquipment from '../../config/equipment.json';
import rawSkills from '../../config/skills.json';
import rawAssets from '../../config/assets.json';
import rawLocalization from '../../config/localization.zh-CN.json';

export const anomalyIdSchema = z.enum(['N01', 'N02', 'N03', 'N04', 'N05']);
export const weaponIdSchema = z.enum(['W00', 'W01', 'W02', 'W03', 'W04', 'W05']);
export const armorIdSchema = z.enum(['A00', 'A01', 'A02', 'A03', 'A04', 'A05']);
export const skillIdSchema = z.enum(['S01', 'S02', 'S03', 'S04', 'S05']);
export const employeeIdSchema = z.enum(['E01', 'E02', 'E03', 'E04', 'E05', 'E06']);
export const dayNumberSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const workType = z.enum(['OBSERVE', 'INTERACT', 'SOOTHE']);
const damageType = z.enum(['RED', 'WHITE', 'BLACK', 'PALE']);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const positive = finite.positive();
const energy = nonnegative.int().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const rect = point.extend({ width: positive, height: positive }).strict();
const damage = z.discriminatedUnion('kind', [
  z.object({ type: z.enum(['RED', 'WHITE', 'BLACK']), kind: z.literal('FLAT'), amount: nonnegative }).strict(),
  z.object({ type: z.literal('PALE'), kind: z.literal('MAX_RATIO'), amount: positive.max(1) }).strict(),
]);
const resistances = z.object({ RED: positive.max(3), WHITE: positive.max(3), BLACK: positive.max(3), PALE: positive.max(3) }).strict();

const gameSchema = z.object({
  schemaVersion: z.literal(1), designVersion: text, title: text, scope: text,
  technicalDefault: z.object({ language: text, renderer: text, phaserVersion: text, buildTool: text, respectExistingProject: z.boolean() }).strict(),
  simulation: z.object({
    fixedStepSec: positive, maxCatchupTicksPerFrame: positive.int(),
    allowedTimeScales: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).length(3),
    pauseOnHidden: z.literal(true), pauseOnFirstBreachPerDay: z.boolean(),
  }).strict(),
  economy: z.object({
    initialWallet: energy, quotaCountsOnlyCompletedWork: z.literal(true), spendingReducesQuotaProgress: z.literal(false),
    archiveBehaviorCost: energy, archiveCombatCost: energy, equipmentPairCost: energy, skillUnlockCost: energy,
    equipmentCopiesPerAnomaly: z.literal(1), breachReward: z.literal(0), suppressionReward: z.literal(0), dailyBonus: z.literal(0),
  }).strict(),
  work: z.object({
    types: z.array(workType).length(3), maxWorkersPerRoom: z.literal(1), automaticRepeat: z.literal(false),
    payOnCompleteOnly: z.literal(true), emergencyInterruptPressure: nonnegative, voluntaryCancelPressure: z.literal(0),
  }).strict(),
  pressure: z.object({ min: nonnegative, warning: positive, danger: positive, breachThreshold: positive, afterRecovery: nonnegative, recoverySec: positive }).strict(),
  employee: z.object({
    hpMax: positive, spMax: positive, moveSpeedPxPerSec: positive, panicAtSp: z.literal(0),
    panicRecoverFraction: positive.max(1), safeHpPerSec: positive, safeSpPerSec: positive, safeRecoveryDelaySec: nonnegative,
    incapacitatedReturnsNextDay: z.literal(true), equipmentLostOnIncapacitation: z.literal(false),
    friendlyFire: z.literal(false), autoRetargetAfterSuppression: z.literal(false),
  }).strict(),
  combat: z.object({
    enemyStat: z.literal('suppressionHp'), normalDamageMinimum: nonnegative, breachSpawnGraceSec: nonnegative,
    attackPhases: z.array(z.enum(['WINDUP', 'HIT', 'RECOVERY'])).length(3),
    resistanceOrder: z.array(damageType).length(4), blackToEnemyAppliesOnce: z.literal(true),
  }).strict(),
  dayEnd: z.object({ requiresQuota: z.literal(true), requiresNoBreaches: z.literal(false), requiresIdleEmployees: z.literal(false), extraReward: z.literal(0), nextDayFullRecovery: z.literal(true) }).strict(),
  save: z.object({ key: text, boundary: z.literal('DAY_PREP_ENTRY'), saveMidDay: z.literal(false), retryRestoresDayEntrySnapshot: z.literal(true) }).strict(),
  layout: z.object({
    width: positive, height: positive, minDisplayWidth: positive, minDisplayHeight: positive,
    sceneBounds: rect, corridorY: finite, corridorMinX: finite, corridorMaxX: finite,
    roomCenterY: finite, roomCentersX: z.array(finite).length(5), safeCenter: point, safeEntrance: point,
    inspectorX: finite, toolbarY: finite,
  }).strict(),
  tutorial: z.object({ day: dayNumberSchema, offerAtProduced: energy, optional: z.literal(true), anomalyId: anomalyIdSchema, grantsEnergy: z.literal(false) }).strict(),
  featuresOutOfScope: z.array(text),
}).strict();

const daySchema = z.object({
  id: text, day: dayNumberSchema, title: text, quota: energy.positive(), rosterCount: positive.int().max(6),
  newAnomalyIds: z.array(anomalyIdSchema), activeAnomalyIds: z.array(anomalyIdSchema),
  newEmployeeIds: z.array(employeeIdSchema), briefing: text, focus: text,
}).strict();
const specialRule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('REPEAT_INTERACT'), extraPressure: nonnegative, resetOnDifferentCompletedWork: z.literal(true) }).strict(),
  z.object({ kind: z.literal('REPEAT_WORKER'), extraPressure: nonnegative, clearAfterIdleSec: positive }).strict(),
  z.object({ kind: z.literal('RAPID_RESTART'), gapSec: positive, extraPressure: nonnegative }).strict(),
  z.object({ kind: z.literal('NON_SOOTHE_STREAK'), threshold: positive.int(), extraPressure: nonnegative, resetAfterProc: z.literal(true) }).strict(),
  z.object({ kind: z.literal('NEGLECT'), idleGraceSec: nonnegative, pressurePerSecAfterGrace: positive, resetOnCompletedWork: z.literal(true) }).strict(),
]);
const breach = z.object({
  ai: z.enum(['CHASE', 'APPROACH_AND_AOE', 'STATIONARY_BROADCAST', 'PATROL_AOE']),
  suppressionHpMax: positive, moveSpeedPxPerSec: nonnegative, damage, attackRangePx: nonnegative,
  attackPeriodSec: positive, windupSec: positive, firstAttackDelaySec: nonnegative,
  targetScope: z.enum(['CORRIDOR', 'FACILITY_EXCEPT_SAFE']),
  cloneCount: z.literal(2).optional(), cloneHp: positive.optional(), cloneSpeedPxPerSec: positive.optional(),
  cloneDamage: damage.optional(), cloneAttackPeriodSec: positive.optional(), clonesCanSpawnClones: z.literal(false).optional(),
  knockbackPx: nonnegative.optional(), interruptWork: z.boolean().optional(),
}).strict();
const anomalySchema = z.object({
  id: anomalyIdSchema, name: text, roomIndex: nonnegative.int().max(4), unlockDay: dayNumberSchema,
  initialPressure: nonnegative, skillId: skillIdSchema, weaponId: weaponIdSchema, armorId: armorIdSchema,
  workProfiles: z.array(z.object({ type: workType, durationSec: positive, energy: energy.positive(), pressureDelta: finite, hazard: damage }).strict()).length(3),
  specialWorkRule: specialRule, breach, resistances,
  archive: z.object({ behavior: text, combat: text }).strict(), conceptNote: text,
}).strict();
const anomalyDataSchema = z.object({
  anomalies: z.array(anomalySchema).length(5),
  links: z.array(z.object({
    id: text, sourceAnomalyId: z.literal('N04'), targetAnomalyId: z.literal('N03'), on: z.literal('BREACH_ENTER'),
    oncePerSourceBreach: z.literal(true), ifTargetContained: z.object({ pressureAdd: positive }).strict(),
    ifTargetBreached: z.literal('REQUEST_ONE_HOWL'), ifTargetUnavailable: z.literal('IGNORE'), reverseLink: z.literal(false),
  }).strict()).length(1),
}).strict();
const weaponSchema = z.object({
  id: weaponIdSchema, name: text, sourceAnomalyId: anomalyIdSchema.nullable(), damage,
  attackPeriodSec: positive, rangePx: positive, windupSec: positive, unlimitedStarter: z.boolean(),
}).strict();
const armorSchema = z.object({ id: armorIdSchema, name: text, sourceAnomalyId: anomalyIdSchema.nullable(), resistances, unlimitedStarter: z.boolean() }).strict();
const equipmentSchema = z.object({ weapons: z.array(weaponSchema).length(6), armors: z.array(armorSchema).length(6) }).strict();
const skillBase = z.object({
  id: skillIdSchema, name: text, sourceAnomalyId: anomalyIdSchema, hotkey: z.enum(['1', '2', '3', '4', '5']),
  energyCost: energy.positive(), cooldownSec: positive, description: text,
});
const skillSchema = z.discriminatedUnion('effect', [
  skillBase.extend({ target: z.literal('SINGLE_ENEMY'), effect: z.literal('STUN'), durationSec: positive }).strict(),
  skillBase.extend({ target: z.literal('SINGLE_ENEMY'), effect: z.literal('DAMAGE'), damage }).strict(),
  skillBase.extend({ target: z.literal('CORRIDOR_POINT'), effect: z.literal('DAMAGE_AND_KNOCKBACK'), radiusPx: positive, knockbackPx: positive, damage }).strict(),
  skillBase.extend({ target: z.literal('ALL_ACTIVE_EMPLOYEES'), effect: z.literal('MOVE_SPEED_BUFF'), durationSec: positive, moveSpeedMultiplier: positive }).strict(),
  skillBase.extend({ target: z.literal('FACILITY_POINT'), effect: z.literal('RESTORE_SP'), radiusPx: positive, restoreSp: positive }).strict(),
]);
const assetsSchema = z.object({
  policy: text,
  characters: z.array(z.object({ id: text, anomalyId: anomalyIdSchema, displayName: text, placeholder: text, states: z.array(text).nonempty(), officialReferenceProvided: z.boolean() }).strict()).length(5),
  employee: z.object({ id: text, states: z.array(text).nonempty(), variations: text }).strict(),
  effects: z.array(text), ui: z.array(text), audio: z.array(text), notRequired: z.array(text),
}).strict();

const bundleSchema = z.object({
  game: gameSchema, days: z.array(daySchema).length(3), anomalyData: anomalyDataSchema,
  equipment: equipmentSchema, skills: z.array(skillSchema).length(5), assets: assetsSchema,
  localization: z.record(z.string()),
}).strict().superRefine((bundle, ctx) => {
  const fail = (path: (string | number)[], message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const unique = (values: readonly (string | number)[], path: (string | number)[]): void => {
    if (new Set(values).size !== values.length) fail(path, '存在重复 ID 或枚举');
  };
  const sameSet = <T>(left: readonly T[], right: readonly T[]): boolean => left.length === right.length && left.every(value => right.includes(value));
  const { game, days, anomalyData, equipment, skills, assets } = bundle;
  unique(days.map(d => d.day), ['days']); unique(days.map(d => d.id), ['days']);
  unique(anomalyData.anomalies.map(a => a.id), ['anomalyData', 'anomalies']);
  unique(anomalyData.anomalies.map(a => a.roomIndex), ['anomalyData', 'anomalies', 'roomIndex']);
  unique(equipment.weapons.map(w => w.id), ['equipment', 'weapons']);
  unique(equipment.armors.map(a => a.id), ['equipment', 'armors']);
  unique(skills.map(s => s.id), ['skills']); unique(skills.map(s => s.hotkey), ['skills', 'hotkey']);
  unique(assets.characters.map(a => a.anomalyId), ['assets', 'characters']);
  unique(game.simulation.allowedTimeScales, ['game', 'simulation', 'allowedTimeScales']);
  unique(game.work.types, ['game', 'work', 'types']);
  unique(game.combat.attackPhases, ['game', 'combat', 'attackPhases']);
  unique(game.combat.resistanceOrder, ['game', 'combat', 'resistanceOrder']);
  const p = game.pressure;
  if (!(p.min < p.warning && p.warning < p.danger && p.danger < p.breachThreshold)) fail(['game', 'pressure'], '压力阈值必须严格递增');
  if (p.afterRecovery < p.min || p.afterRecovery >= p.breachThreshold) fail(['game', 'pressure', 'afterRecovery'], '恢复压力必须处于收容范围');
  const seenAnomalies = new Set<AnomalyId>();
  const seenEmployees = new Set<string>();
  for (const day of [...days].sort((a, b) => a.day - b.day)) {
    const index = days.indexOf(day);
    unique(day.newAnomalyIds, ['days', index, 'newAnomalyIds']);
    unique(day.activeAnomalyIds, ['days', index, 'activeAnomalyIds']);
    unique(day.newEmployeeIds, ['days', index, 'newEmployeeIds']);
    for (const id of day.newAnomalyIds) {
      if (seenAnomalies.has(id)) fail(['days', index, 'newAnomalyIds'], `${id} 已在此前开放`);
      seenAnomalies.add(id);
    }
    for (const id of day.newEmployeeIds) {
      if (seenEmployees.has(id)) fail(['days', index, 'newEmployeeIds'], `${id} 已在此前入队`);
      seenEmployees.add(id);
    }
    if (!sameSet([...seenAnomalies], day.activeAnomalyIds)) fail(['days', index, 'activeAnomalyIds'], '开放对象必须累计');
    if (day.rosterCount !== seenEmployees.size) fail(['days', index, 'rosterCount'], '员工数量与累计名单不一致');
  }
  if (seenAnomalies.size !== 5 || seenEmployees.size !== 6) fail(['days'], '第三日应开放五物与六名员工');
  const expectedNames: Record<AnomalyId, string> = { N01: '奶龙', N02: '耄耋', N03: '大狗', N04: '叮咚鸡', N05: '咕咕嘎嘎' };
  const expectedRules = ['REPEAT_INTERACT', 'REPEAT_WORKER', 'RAPID_RESTART', 'NON_SOOTHE_STREAK', 'NEGLECT'];
  for (const [index, anomaly] of anomalyData.anomalies.entries()) {
    const path = ['anomalyData', 'anomalies', index];
    if (anomaly.name !== expectedNames[anomaly.id]) fail([...path, 'name'], '收容物名称与 ID 不匹配');
    const ordinal = anomalyIdSchema.options.indexOf(anomaly.id);
    if (anomaly.specialWorkRule.kind !== expectedRules[ordinal]) fail([...path, 'specialWorkRule'], '该收容物的专属规则不匹配');
    if (anomaly.initialPressure < p.min || anomaly.initialPressure >= p.breachThreshold) fail([...path, 'initialPressure'], '初始压力必须处于收容范围');
    if (!days.find(d => d.day === anomaly.unlockDay)?.newAnomalyIds.includes(anomaly.id)) fail([...path, 'unlockDay'], '开放日与 days.json 不一致');
    unique(anomaly.workProfiles.map(w => w.type), [...path, 'workProfiles']);
    if ((anomaly.workProfiles.find(w => w.type === 'SOOTHE')?.pressureDelta ?? 0) >= 0) fail([...path, 'workProfiles'], '安抚必须降低压力');
    const weapon = equipment.weapons.find(w => w.id === anomaly.weaponId);
    const armor = equipment.armors.find(a => a.id === anomaly.armorId);
    const skill = skills.find(s => s.id === anomaly.skillId);
    if (weapon?.sourceAnomalyId !== anomaly.id) fail([...path, 'weaponId'], '专属武器来源不一致');
    if (armor?.sourceAnomalyId !== anomaly.id) fail([...path, 'armorId'], '专属防具来源不一致');
    if (skill?.sourceAnomalyId !== anomaly.id) fail([...path, 'skillId'], '专属技能来源不一致');
    if (anomaly.breach.windupSec > anomaly.breach.attackPeriodSec) fail([...path, 'breach', 'windupSec'], '前摇不能大于攻击周期');
    if (anomaly.breach.firstAttackDelaySec < game.combat.breachSpawnGraceSec) fail([...path, 'breach', 'firstAttackDelaySec'], '首次攻击不能早于保护时间');
    if (anomaly.id === 'N01') {
      const b = anomaly.breach;
      if (b.cloneCount !== 2 || b.cloneHp === undefined || b.cloneDamage === undefined || b.cloneSpeedPxPerSec === undefined || b.cloneAttackPeriodSec === undefined || b.clonesCanSpawnClones !== false) fail([...path, 'breach'], '奶龙必须配置两个不可复制的分身');
    } else if (anomaly.breach.cloneCount !== undefined) fail([...path, 'breach', 'cloneCount'], '只有奶龙生成分身');
  }
  equipment.weapons.forEach((weapon, index) => {
    if (weapon.windupSec > weapon.attackPeriodSec) fail(['equipment', 'weapons', index, 'windupSec'], '前摇不能大于攻击周期');
    if (weapon.unlimitedStarter !== (weapon.id === 'W00') || (weapon.sourceAnomalyId === null) !== (weapon.id === 'W00')) fail(['equipment', 'weapons', index], '仅制式武器无限且无来源');
  });
  equipment.armors.forEach((armor, index) => {
    if (armor.unlimitedStarter !== (armor.id === 'A00') || (armor.sourceAnomalyId === null) !== (armor.id === 'A00')) fail(['equipment', 'armors', index], '仅制式防具无限且无来源');
  });
  const layout = game.layout;
  if (layout.corridorMinX >= layout.corridorMaxX || layout.roomCenterY >= layout.corridorY) fail(['game', 'layout'], '房间与走廊节点范围无效');
  if (layout.roomCentersX.some(x => x < layout.corridorMinX || x > layout.corridorMaxX)) fail(['game', 'layout', 'roomCentersX'], '房间门口必须在走廊内');
  if (layout.safeEntrance.x !== layout.corridorMaxX || layout.safeEntrance.y !== layout.corridorY || layout.safeCenter.x !== layout.safeEntrance.x || layout.safeCenter.y <= layout.corridorY) fail(['game', 'layout', 'safeCenter'], '安全室必须接在走廊右侧垂直支路');
  if (!days.find(d => d.day === game.tutorial.day)?.activeAnomalyIds.includes(game.tutorial.anomalyId)) fail(['game', 'tutorial', 'anomalyId'], '教学来源在指定日未开放');
  for (const key of ['energy.wallet', 'energy.quota', 'day.finish', 'hint.noEnergyOnBreach', 'error.invalidSkillTarget']) {
    if (!bundle.localization[key]) fail(['localization', key], '缺少必要文案');
  }
});

const fileByRoot: Record<string, string> = {
  game: 'game.json', days: 'days.json', anomalyData: 'anomalies.json', equipment: 'equipment.json',
  skills: 'skills.json', assets: 'assets.json', localization: 'localization.zh-CN.json',
};

/** Validate before exposing data to simulation. Every error names its source file and field. */
export function validateConfigBundle(value: unknown): ConfigBundle {
  const result = bundleSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map(issue => {
      const [root, ...path] = issue.path;
      return `config/${fileByRoot[String(root)] ?? String(root ?? 'bundle')} :: ${path.join('.') || '$'} — ${issue.message}`;
    });
    throw new Error(`配置校验失败：\n${details.join('\n')}`);
  }
  return result.data;
}

export const config: ConfigBundle = validateConfigBundle({
  game: rawGame, days: rawDays, anomalyData: rawAnomalies, equipment: rawEquipment,
  skills: rawSkills, assets: rawAssets, localization: rawLocalization,
});

function indexById<T extends { id: string }>(items: readonly T[]): Record<T['id'], T> {
  // Validation above proves that the finite ID sets are present exactly once.
  return Object.fromEntries(items.map(item => [item.id, item])) as Record<T['id'], T>;
}
export const anomalyById: Record<AnomalyId, AnomalyConfig> = indexById(config.anomalyData.anomalies);
export const weaponById: Record<WeaponId, WeaponConfig> = indexById(config.equipment.weapons);
export const armorById: Record<ArmorId, ArmorConfig> = indexById(config.equipment.armors);
export const skillById: Record<SkillId, SkillConfig> = indexById(config.skills);
export const dayByNumber = Object.fromEntries(config.days.map(day => [day.day, day])) as Record<DayNumber, DayConfig>;
