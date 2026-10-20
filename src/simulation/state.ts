import type { DayEntrySnapshot, DayNumber, GameState, Location, PersistentProgress, WorkMemory } from '../../contracts/data-contract';
import { config, dayByNumber } from '../data/config';

export interface LogEntry { id: string; timeSec: number; kind: string; message: string }
export interface DayReport { day: DayNumber; produced: number; spent: number; breaches: number; unresolved: number; incapacitated: number; skillUses: number }
export interface RuntimeState extends GameState {
  logs: LogEntry[]; tutorialPending: boolean; firstBreachOccurred: boolean;
  report?: DayReport; entrySnapshot: DayEntrySnapshot;
}
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function freshMemory(): WorkMemory {
  return { lastCompletedWorkType: null, lastCompletedEmployeeId: null, lastCompletedAtSec: null, nonSootheCount: 0, idleElapsedSec: 0 };
}
export function initialProgress(): PersistentProgress {
  const research = {} as PersistentProgress['research'];
  config.anomalyData.anomalies.forEach(a => { research[a.id] = { behavior: false, combat: false, equipmentDeveloped: false }; });
  return { wallet: config.game.economy.initialWallet, research, unlockedSkills: [], ownedWeapons: [], ownedArmors: [], employeeLoadouts: {}, tutorialOfferHandled: false };
}
export function makeSnapshot(day: DayNumber, progress: PersistentProgress): DayEntrySnapshot {
  return { schemaVersion: 1, designVersion: config.game.designVersion, saveBoundary: config.game.save.boundary, day, progress: copy(progress) };
}
export function makeState(snapshot = makeSnapshot(1, initialProgress()), spawn: Location = { ...config.game.layout.safeCenter, zone: 'SAFE' }): RuntimeState {
  const day = dayByNumber[snapshot.day];
  const base = config.game.employee;
  const progress = copy(snapshot.progress);
  const employees = config.days.filter(d => d.day <= day.day).flatMap(d => d.newEmployeeIds).map((id) => ({
    id, displayName: `A-${id.slice(1)}`, status: 'IDLE' as const,
    hp: base.hpMax, sp: base.spMax, hpMax: base.hpMax, spMax: base.spMax,
    location: { ...spawn }, path: [], order: { kind: 'IDLE' as const },
    weaponId: progress.employeeLoadouts[id]?.weaponId ?? 'W00' as const,
    armorId: progress.employeeLoadouts[id]?.armorId ?? 'A00' as const,
    safeStayElapsedSec: 0, moveBuffRemainingSec: 0,
    attackPhase: 'RECOVERY' as const, nextAttackStartAtSec: 0, windupEndsAtSec: null,
  }));
  return {
    phase: 'DAY_PREP', day: day.day, timeScale: 1, simulationTimeSec: 0, producedToday: 0, progress,
    rooms: config.anomalyData.anomalies.map(a => ({ anomalyId: a.id, mode: day.activeAnomalyIds.includes(a.id) ? 'CONTAINED' : 'LOCKED', pressure: a.initialPressure, work: null, memory: freshMemory(), recoveryRemainingSec: 0, breachInstanceId: null, mainEnemyId: null })),
    employees, enemies: [], skillCooldownRemainingSec: { S01: 0, S02: 0, S03: 0, S04: 0, S05: 0 },
    processedCommandIds: new Set(), processedWorkIncomeIds: new Set(), processedLinkEventIds: new Set(),
    logs: [], tutorialPending: false, firstBreachOccurred: false, entrySnapshot: copy(snapshot),
  };
}
