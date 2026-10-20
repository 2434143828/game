/**
 * 《网梗收容：奶龙失效》v0.1 数据合同。
 * 只有类型声明，不是游戏实现。Codex应据此载入配置并补齐业务函数。
 * 所有时间单位为模拟秒；PALE比例使用0—1；UI文案与代码枚举分离。
 */
export type AnomalyId = 'N01' | 'N02' | 'N03' | 'N04' | 'N05';
export type WeaponId = 'W00' | 'W01' | 'W02' | 'W03' | 'W04' | 'W05';
export type ArmorId = 'A00' | 'A01' | 'A02' | 'A03' | 'A04' | 'A05';
export type SkillId = 'S01' | 'S02' | 'S03' | 'S04' | 'S05';
export type EmployeeId = 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06';
export type DamageType = 'RED' | 'WHITE' | 'BLACK' | 'PALE';
export type WorkType = 'OBSERVE' | 'INTERACT' | 'SOOTHE';
export type DayNumber = 1 | 2 | 3;
export type Resistances = Record<DamageType, number>;
export type DamageSpec =
  | { type: 'RED' | 'WHITE' | 'BLACK'; kind: 'FLAT'; amount: number }
  | { type: 'PALE'; kind: 'MAX_RATIO'; amount: number };
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }

export interface GameConfig {
  schemaVersion: 1;
  designVersion: string;
  title: string;
  scope: string;
  technicalDefault: {
    language: string; renderer: string; phaserVersion: string;
    buildTool: string; respectExistingProject: boolean;
  };
  simulation: {
    fixedStepSec: number; maxCatchupTicksPerFrame: number;
    allowedTimeScales: number[]; pauseOnHidden: boolean;
    pauseOnFirstBreachPerDay: boolean;
  };
  economy: {
    initialWallet: number; quotaCountsOnlyCompletedWork: boolean;
    spendingReducesQuotaProgress: boolean;
    archiveBehaviorCost: number; archiveCombatCost: number;
    equipmentPairCost: number; skillUnlockCost: number;
    equipmentCopiesPerAnomaly: number;
    breachReward: number; suppressionReward: number; dailyBonus: number;
  };
  work: {
    types: WorkType[]; maxWorkersPerRoom: number; automaticRepeat: boolean;
    payOnCompleteOnly: boolean; emergencyInterruptPressure: number;
    voluntaryCancelPressure: number;
  };
  pressure: {
    min: number; warning: number; danger: number; breachThreshold: number;
    afterRecovery: number; recoverySec: number;
  };
  employee: {
    hpMax: number; spMax: number; moveSpeedPxPerSec: number;
    panicAtSp: number; panicRecoverFraction: number;
    safeHpPerSec: number; safeSpPerSec: number; safeRecoveryDelaySec: number;
    incapacitatedReturnsNextDay: boolean; equipmentLostOnIncapacitation: boolean;
    friendlyFire: boolean; autoRetargetAfterSuppression: boolean;
  };
  combat: {
    enemyStat: string; normalDamageMinimum: number; breachSpawnGraceSec: number;
    attackPhases: AttackPhase[]; resistanceOrder: DamageType[];
    blackToEnemyAppliesOnce: boolean;
  };
  dayEnd: {
    requiresQuota: boolean; requiresNoBreaches: boolean; requiresIdleEmployees: boolean;
    extraReward: number; nextDayFullRecovery: boolean;
  };
  save: {
    key: string; boundary: 'DAY_PREP_ENTRY'; saveMidDay: boolean;
    retryRestoresDayEntrySnapshot: boolean;
  };
  layout: {
    width: number; height: number; minDisplayWidth: number; minDisplayHeight: number;
    sceneBounds: Rect; corridorY: number; corridorMinX: number; corridorMaxX: number;
    roomCenterY: number; roomCentersX: number[]; safeCenter: Point; safeEntrance: Point;
    inspectorX: number; toolbarY: number;
  };
  tutorial: { day: DayNumber; offerAtProduced: number; optional: boolean; anomalyId: AnomalyId; grantsEnergy: boolean };
  featuresOutOfScope: string[];
}
export interface DayConfig {
  id: string; day: DayNumber; title: string; quota: number; rosterCount: number;
  newAnomalyIds: AnomalyId[]; activeAnomalyIds: AnomalyId[];
  newEmployeeIds: EmployeeId[]; briefing: string; focus: string;
}
export interface WorkProfile {
  type: WorkType; durationSec: number; energy: number;
  pressureDelta: number; hazard: DamageSpec;
}
export type SpecialWorkRule =
  | { kind: 'REPEAT_INTERACT'; extraPressure: number; resetOnDifferentCompletedWork: boolean }
  | { kind: 'REPEAT_WORKER'; extraPressure: number; clearAfterIdleSec: number }
  | { kind: 'RAPID_RESTART'; gapSec: number; extraPressure: number }
  | { kind: 'NON_SOOTHE_STREAK'; threshold: number; extraPressure: number; resetAfterProc: boolean }
  | { kind: 'NEGLECT'; idleGraceSec: number; pressurePerSecAfterGrace: number; resetOnCompletedWork: boolean };
export type EnemyAI = 'CHASE' | 'APPROACH_AND_AOE' | 'STATIONARY_BROADCAST' | 'PATROL_AOE';
export interface BreachConfig {
  ai: EnemyAI; suppressionHpMax: number; moveSpeedPxPerSec: number;
  damage: DamageSpec; attackRangePx: number; attackPeriodSec: number;
  windupSec: number; firstAttackDelaySec: number;
  targetScope: 'CORRIDOR' | 'FACILITY_EXCEPT_SAFE';
  cloneCount?: number; cloneHp?: number; cloneSpeedPxPerSec?: number;
  cloneDamage?: DamageSpec; cloneAttackPeriodSec?: number; clonesCanSpawnClones?: boolean;
  knockbackPx?: number; interruptWork?: boolean;
}
export interface AnomalyConfig {
  id: AnomalyId; name: string; roomIndex: number; unlockDay: DayNumber;
  initialPressure: number; skillId: SkillId; weaponId: WeaponId; armorId: ArmorId;
  workProfiles: WorkProfile[]; specialWorkRule: SpecialWorkRule;
  breach: BreachConfig; resistances: Resistances;
  archive: { behavior: string; combat: string }; conceptNote: string;
}
export interface LinkConfig {
  id: string; sourceAnomalyId: AnomalyId; targetAnomalyId: AnomalyId;
  on: 'BREACH_ENTER'; oncePerSourceBreach: boolean;
  ifTargetContained: { pressureAdd: number };
  ifTargetBreached: 'REQUEST_ONE_HOWL'; ifTargetUnavailable: 'IGNORE'; reverseLink: boolean;
}
export interface AnomalyData { anomalies: AnomalyConfig[]; links: LinkConfig[] }
export interface WeaponConfig {
  id: WeaponId; name: string; sourceAnomalyId: AnomalyId | null;
  damage: DamageSpec; attackPeriodSec: number; rangePx: number;
  windupSec: number; unlimitedStarter: boolean;
}
export interface ArmorConfig {
  id: ArmorId; name: string; sourceAnomalyId: AnomalyId | null;
  resistances: Resistances; unlimitedStarter: boolean;
}
export interface EquipmentData { weapons: WeaponConfig[]; armors: ArmorConfig[] }
interface SkillBase {
  id: SkillId; name: string; sourceAnomalyId: AnomalyId; hotkey: string;
  energyCost: number; cooldownSec: number; description: string;
}
export type SkillConfig = SkillBase & (
  | { target: 'SINGLE_ENEMY'; effect: 'STUN'; durationSec: number }
  | { target: 'SINGLE_ENEMY'; effect: 'DAMAGE'; damage: DamageSpec }
  | { target: 'CORRIDOR_POINT'; effect: 'DAMAGE_AND_KNOCKBACK'; radiusPx: number; knockbackPx: number; damage: DamageSpec }
  | { target: 'ALL_ACTIVE_EMPLOYEES'; effect: 'MOVE_SPEED_BUFF'; durationSec: number; moveSpeedMultiplier: number }
  | { target: 'FACILITY_POINT'; effect: 'RESTORE_SP'; radiusPx: number; restoreSp: number }
);
export interface AssetsConfig {
  policy: string;
  characters: Array<{
    id: string; anomalyId: AnomalyId; displayName: string;
    placeholder: string; states: string[]; officialReferenceProvided: boolean;
  }>;
  employee: { id: string; states: string[]; variations: string };
  effects: string[]; ui: string[]; audio: string[]; notRequired: string[];
}
export interface ConfigBundle {
  game: GameConfig; days: DayConfig[]; anomalyData: AnomalyData;
  equipment: EquipmentData; skills: SkillConfig[]; assets: AssetsConfig;
  localization: Record<string, string>;
}

// 以下是运行状态的最小合同，允许添加实现必要字段，不得用显示状态替代业务状态。
export type RoomMode = 'LOCKED' | 'CONTAINED' | 'BREACHED' | 'RECOVERING';
export type EmployeeStatus = 'IDLE' | 'MOVING' | 'WORKING' | 'SUPPRESSING' | 'PANICKED' | 'INCAPACITATED';
export type GamePhase = 'MENU' | 'DAY_PREP' | 'RUNNING' | 'DAY_REPORT' | 'FAILED' | 'COMPLETE';
export type AttackPhase = 'WINDUP' | 'HIT' | 'RECOVERY';
export type Location = Point & {
  zone: 'ROOM' | 'CORRIDOR' | 'SAFE_CONNECTOR' | 'SAFE' | 'TRANSIT';
  roomId?: AnomalyId; floorId?: string; segmentId?: string;
};
export interface WorkMemory {
  lastCompletedWorkType: WorkType | null;
  lastCompletedEmployeeId: EmployeeId | null;
  lastCompletedAtSec: number | null;
  nonSootheCount: number;
  idleElapsedSec: number;
}
export interface WorkRuntime {
  workId: string; employeeId: EmployeeId; roomId: AnomalyId; type: WorkType;
  phase: 'TRAVELLING' | 'EXECUTING'; elapsedSec: number;
  rapidRestart: boolean; // 仅大狗真正开工时锁定，不在预约时锁定。
}
export interface RoomRuntime {
  anomalyId: AnomalyId; mode: RoomMode; pressure: number;
  work: WorkRuntime | null; memory: WorkMemory;
  recoveryRemainingSec: number;
  breachInstanceId: string | null; mainEnemyId: string | null;
}
export type EmployeeOrder =
  | { kind: 'IDLE' }
  | { kind: 'MOVE'; destination: Point }
  | { kind: 'WORK'; roomId: AnomalyId; workId: string }
  | { kind: 'SUPPRESS'; enemyId: string }
  | { kind: 'RETREAT' };
export interface EmployeeRuntime {
  id: EmployeeId; displayName: string; status: EmployeeStatus;
  hp: number; sp: number; hpMax: number; spMax: number;
  location: Location; path: Point[]; order: EmployeeOrder;
  weaponId: WeaponId; armorId: ArmorId;
  safeStayElapsedSec: number;
  moveBuffRemainingSec: number;
  attackPhase: AttackPhase; nextAttackStartAtSec: number;
  windupEndsAtSec: number | null;
}
export interface EnemyRuntime {
  id: string; sourceAnomalyId: AnomalyId; breachInstanceId: string;
  isClone: boolean; mainEnemyId: string | null;
  location: Location; suppressionHp: number; suppressionHpMax: number;
  targetEmployeeId: EmployeeId | null;
  attackPhase: AttackPhase; nextAttackStartAtSec: number;
  windupEndsAtSec: number | null; stunnedUntilSec: number;
  pendingForcedHowl: boolean;
}
export interface ResearchProgress { behavior: boolean; combat: boolean; equipmentDeveloped: boolean }
export interface PersistentProgress {
  wallet: number;
  research: Record<AnomalyId, ResearchProgress>;
  unlockedSkills: SkillId[];
  ownedWeapons: WeaponId[]; // 专属ID仅一次；制式可不存。
  ownedArmors: ArmorId[];
  employeeLoadouts: Partial<Record<EmployeeId, { weaponId: WeaponId; armorId: ArmorId }>>;
  tutorialOfferHandled: boolean;
}
export interface GameState {
  phase: GamePhase; day: DayNumber; timeScale: 0 | 1 | 2;
  simulationTimeSec: number; producedToday: number;
  progress: PersistentProgress;
  rooms: RoomRuntime[]; employees: EmployeeRuntime[]; enemies: EnemyRuntime[];
  skillCooldownRemainingSec: Record<SkillId, number>;
  processedCommandIds: Set<string>;
  processedWorkIncomeIds: Set<string>;
  processedLinkEventIds: Set<string>;
}
export interface DayEntrySnapshot {
  schemaVersion: 1; designVersion: string; saveBoundary: 'DAY_PREP_ENTRY';
  day: DayNumber; progress: PersistentProgress;
}
export interface SaveEnvelope {
  snapshot: DayEntrySnapshot; demoCompleted: boolean;
}
export type CastTarget =
  | { kind: 'ENEMY'; enemyId: string }
  | { kind: 'POINT'; point: Point }
  | { kind: 'GLOBAL' };
export type Command = { commandId: string } & (
  | { type: 'ASSIGN_WORK'; employeeId: EmployeeId; roomId: AnomalyId; workType: WorkType }
  | { type: 'MOVE'; employeeIds: EmployeeId[]; point: Point }
  | { type: 'STOP'; employeeIds: EmployeeId[] }
  | { type: 'RETREAT'; employeeIds: EmployeeId[] }
  | { type: 'SUPPRESS'; employeeIds: EmployeeId[]; enemyId: string }
  | { type: 'CAST_SKILL'; skillId: SkillId; target: CastTarget }
  | { type: 'PURCHASE'; anomalyId: AnomalyId; item: 'BEHAVIOR' | 'COMBAT' | 'EQUIPMENT' | 'SKILL' }
  | { type: 'EQUIP_WEAPON'; employeeId: EmployeeId; weaponId: WeaponId }
  | { type: 'EQUIP_ARMOR'; employeeId: EmployeeId; armorId: ArmorId }
  | { type: 'START_DAY' }
  | { type: 'FINISH_DAY' }
  | { type: 'RETRY_DAY' }
);
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
