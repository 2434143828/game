import type { AnomalyId, ArmorId, DamageSpec, EmployeeId, EmployeeRuntime, EnemyRuntime, Location, Point, WeaponId } from '../../contracts/data-contract';

export interface ContainmentProgress { anomalyId: AnomalyId; owned: boolean; rank: number; state: 'LOCKED' | 'STABLE' | 'IN_CHALLENGE' }
export type CardEffect = 'DAMAGE' | 'BLOCK' | 'HEAL' | 'STUN' | 'COPY' | 'COUNTER' | 'KNOCKBACK' | 'DELAY' | 'AMPLIFY';
export interface CardDefinition { id: string; name: string; description: string; target: 'ENEMY' | 'ALLY' | 'SELF' | 'TEAM'; effect: CardEffect; damage?: DamageSpec; amount?: number; durationSec?: number; radiusPx?: number; rangePx: number; windupSec: number }
export interface CombatCardInstance { instanceId: string; cardId: string; ownerId: EmployeeId; sourceWeaponId: WeaponId; tier: number }
export interface PendingCast { instanceId: string; targetId: string; requestId: string; phase: 'APPROACH' | 'WINDUP'; resolvesAtSec: number | null }
export interface DeckState { drawPile: CombatCardInstance[]; hand: CombatCardInstance[]; discardPile: CombatCardInstance[]; exhausted: CombatCardInstance[]; drawTimer: number; globalCooldown: number; pendingCast: PendingCast | null }
export interface V3Employee extends EmployeeRuntime { weaponTier: number; armorTier: number; hitUntilSec: number; actionUntilSec: number; panicUntilSec: number; blockUntilSec: number; blockReduction: number; counterUntilSec: number; counterDamage: number; removedCards: boolean; home: Location; idleNextAtSec: number; idleCycle: number; attackTargetId: string | null }
export type CapturePhase = 'COMBAT' | 'CAPTURABLE' | 'CAPTURING' | 'CAPTURED';
export type CaptureState = 'ACTIVE' | 'CAPTURABLE' | 'CAPTURED';
export interface V3Enemy extends EnemyRuntime { hitUntilSec: number; actionUntilSec: number; attackOrdinal: number; intent: string; specialAttack: boolean; warningRangePx: number; captureState?: CaptureState }
export interface CombatEvent { id: string; timeSec: number; kind: string; message: string; sourceId?: string; targetId?: string; amount?: number; cardId?: string; instanceId?: string; sourcePoint?: Point; targetPoint?: Point }
/** Facility-facing progression target derived from the same room/economy state as the engine. */
export interface NextTarget {
  anomalyId: AnomalyId;
  mode: 'CAPTURE' | 'BREACH_CHALLENGE';
  label: string;
  currentRank: number;
  nextRank: number;
  energyCost: number;
  requirement: string | null;
  available: boolean;
}
/** Snapshot shown by the result card. Values are derived from the completed encounter and room state. */
export interface VictorySummary {
  encounterId: string;
  result: NonNullable<EncounterState['result']>;
  anomalyId: AnomalyId;
  mode: EncounterState['mode'];
  previousOwned: boolean;
  currentOwned: boolean;
  previousRank: number;
  currentRank: number;
  productionBefore: number;
  productionAfter: number;
  egoTier: number;
  rewards: string[];
  nextTarget: NextTarget;
}
export interface EncounterState { id: string; mode: 'CAPTURE' | 'BREACH_CHALLENGE'; targetAnomalyId: AnomalyId; startRank: number; squadIds: EmployeeId[]; paused: boolean; speed: 1 | 2; deck: DeckState; enemies: V3Enemy[]; focusEnemyId: string | null; result: 'VICTORY' | 'DEFEAT' | 'ABANDONED' | null; rewardApplied: boolean; elapsedSec: number; lastAttackCard: { damage: DamageSpec; targetId: string } | null; nextAttackMultiplier: number; casualties: EmployeeId[]; capturePhase?: CapturePhase; captureEmployeeId?: EmployeeId | null; captureProgressSec?: number; captureDeadlineSec?: number | null }
export interface V3State { saveVersion: 3; phase: 'FACILITY' | 'ENCOUNTER'; wallet: number; simulationTimeSec: number; timeScale: 0 | 1 | 2; speed: 1 | 2; rooms: ContainmentProgress[]; employees: V3Employee[]; encounter: EncounterState | null; rngState: number; sequence: number; logs: CombatEvent[]; ownedWeapons: WeaponId[]; ownedArmors: ArmorId[]; migrationSummary: string[] }
export interface V3SaveEnvelope { saveVersion: 3; savedAtMs: number; state: V3State }
