import { z } from 'zod';
import type { AnomalyId, EmployeeId, Result, SaveEnvelope } from '../../contracts/data-contract';
import {
  anomalyIdSchema, armorById, armorIdSchema, config, employeeIdSchema,
  skillById, skillIdSchema, weaponById, weaponIdSchema, dayNumberSchema,
} from '../data/config';

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const researchSchema = z.object({ behavior: z.boolean(), combat: z.boolean(), equipmentDeveloped: z.boolean() }).strict();
const loadoutSchema = z.object({ weaponId: weaponIdSchema, armorId: armorIdSchema }).strict();
const progressSchema = z.object({
  wallet: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  research: z.object({
    N01: researchSchema, N02: researchSchema, N03: researchSchema, N04: researchSchema, N05: researchSchema,
  }).strict(),
  unlockedSkills: z.array(skillIdSchema).max(5),
  ownedWeapons: z.array(weaponIdSchema).max(6),
  ownedArmors: z.array(armorIdSchema).max(6),
  employeeLoadouts: z.object({
    E01: loadoutSchema.optional(), E02: loadoutSchema.optional(), E03: loadoutSchema.optional(),
    E04: loadoutSchema.optional(), E05: loadoutSchema.optional(), E06: loadoutSchema.optional(),
  }).strict(),
  tutorialOfferHandled: z.boolean(),
}).strict();
const envelopeSchema = z.object({
  snapshot: z.object({
    schemaVersion: z.literal(1),
    designVersion: z.literal(config.game.designVersion),
    saveBoundary: z.literal('DAY_PREP_ENTRY'),
    day: dayNumberSchema,
    progress: progressSchema,
  }).strict(),
  demoCompleted: z.boolean(),
}).strict().superRefine((envelope, ctx) => {
  const fail = (path: (string | number)[], message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const { day, progress } = envelope.snapshot;
  const root = ['snapshot', 'progress'];
  const activeAnomalies = new Set(config.days.find(d => d.day === day)?.activeAnomalyIds);
  const activeEmployees = new Set<EmployeeId>(config.days.filter(d => d.day <= day).flatMap(d => d.newEmployeeIds));
  const unique = (values: readonly string[], field: string): void => {
    if (values.length !== new Set(values).size) fail([...root, field], 'ID 不得重复');
  };
  unique(progress.unlockedSkills, 'unlockedSkills');
  unique(progress.ownedWeapons, 'ownedWeapons');
  unique(progress.ownedArmors, 'ownedArmors');
  for (const id of anomalyIdSchema.options) {
    const research = progress.research[id];
    if (!activeAnomalies.has(id) && (research.behavior || research.combat || research.equipmentDeveloped)) {
      fail([...root, 'research', id], '未开放收容物不能拥有研究内容');
    }
    if (!research.behavior && (research.combat || research.equipmentDeveloped)) {
      fail([...root, 'research', id], '镇压档案和装备开发需要行为档案');
    }
    const anomaly = config.anomalyData.anomalies.find(a => a.id === id);
    if (anomaly && (progress.ownedWeapons.includes(anomaly.weaponId) !== research.equipmentDeveloped || progress.ownedArmors.includes(anomaly.armorId) !== research.equipmentDeveloped)) {
      fail([...root, 'research', id, 'equipmentDeveloped'], '开发标记必须与专属武器、防具各一份同时一致');
    }
  }
  progress.unlockedSkills.forEach((id, index) => {
    if (!activeAnomalies.has(skillById[id].sourceAnomalyId)) fail([...root, 'unlockedSkills', index], '技能来源尚未开放');
  });
  const checkSource = (source: AnomalyId | null, field: string, index: number): void => {
    if (source !== null && !activeAnomalies.has(source)) fail([...root, field, index], '装备来源尚未开放');
  };
  progress.ownedWeapons.forEach((id, index) => checkSource(weaponById[id].sourceAnomalyId, 'ownedWeapons', index));
  progress.ownedArmors.forEach((id, index) => checkSource(armorById[id].sourceAnomalyId, 'ownedArmors', index));
  const heldWeapons = new Set<string>();
  const heldArmors = new Set<string>();
  for (const id of employeeIdSchema.options) {
    const loadout = progress.employeeLoadouts[id];
    if (!loadout) continue;
    const path = [...root, 'employeeLoadouts', id];
    if (!activeEmployees.has(id)) fail(path, '员工尚未加入当日名单');
    if (loadout.weaponId !== 'W00') {
      if (!progress.ownedWeapons.includes(loadout.weaponId)) fail([...path, 'weaponId'], '未拥有这件专属武器');
      if (heldWeapons.has(loadout.weaponId)) fail([...path, 'weaponId'], '一件专属武器只能由一人持有');
      heldWeapons.add(loadout.weaponId);
    }
    if (loadout.armorId !== 'A00') {
      if (!progress.ownedArmors.includes(loadout.armorId)) fail([...path, 'armorId'], '未拥有这件专属防具');
      if (heldArmors.has(loadout.armorId)) fail([...path, 'armorId'], '一件专属防具只能由一人持有');
      heldArmors.add(loadout.armorId);
    }
  }
  if (envelope.demoCompleted && day !== 3) fail(['demoCompleted'], '完成标记只能对应第三日日初快照');
});

/** Pure validation returns detached data: loading never exposes mutable caller references. */
export function validateSave(value: unknown): Result<SaveEnvelope> {
  const result = envelopeSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      code: 'INVALID_SAVE',
      message: `存档格式或版本不兼容，原文已保留：${result.error.issues.map(issue => `${issue.path.join('.') || '$'} — ${issue.message}`).join('；')}`,
    };
  }
  return { ok: true, value: result.data };
}

/** Reads only. Corrupt or old-version content is never removed or overwritten. */
export function loadSave(storage?: StoragePort): Result<SaveEnvelope | null> {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return { ok: false, code: 'STORAGE_UNAVAILABLE', message: '此环境没有可用的本地存储。' };
    const raw = target.getItem(config.game.save.key);
    if (raw === null) return { ok: true, value: null };
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, code: 'INVALID_SAVE_JSON', message: '存档 JSON 损坏，原文已保留。可检查原文，或明确选择新建游戏。' };
    }
    return validateSave(value);
  } catch (error: unknown) {
    return { ok: false, code: 'STORAGE_READ_FAILED', message: `无法读取本地存储：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Call only for a day-entry transition, completion marker, or confirmed new game. */
export function writeSave(envelope: SaveEnvelope, storage?: StoragePort): Result<void> {
  const validated = validateSave(envelope);
  if (!validated.ok) return validated;
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return { ok: false, code: 'STORAGE_UNAVAILABLE', message: '此环境没有可用的本地存储。' };
    // Web Storage replaces one key atomically; validation and serialization precede the only write.
    const serialized = JSON.stringify(validated.value);
    target.setItem(config.game.save.key, serialized);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return { ok: false, code: 'STORAGE_WRITE_FAILED', message: `无法保存日初快照：${error instanceof Error ? error.message : String(error)}` };
  }
}
