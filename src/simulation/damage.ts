import type { DamageSpec, Resistances } from '../../contracts/data-contract';

/** 黑伤对员工双条各扣一次；苍白始终使用最大值。 */
export function resolveEmployeeDamage(hp: number, sp: number, hpMax: number, damage: DamageSpec, resistances: Resistances): { hp: number; sp: number } {
  const amount = resolveEnemyDamage(hpMax, damage, resistances);
  return {
    hp: Math.max(0, hp - (damage.type === 'WHITE' ? 0 : amount)),
    sp: Math.max(0, sp - (damage.type === 'WHITE' || damage.type === 'BLACK' ? amount : 0)),
  };
}
export function resolveEnemyDamage(maximum: number, damage: DamageSpec, resistances: Resistances): number {
  return (damage.kind === 'MAX_RATIO' ? maximum * damage.amount : damage.amount) * resistances[damage.type];
}
