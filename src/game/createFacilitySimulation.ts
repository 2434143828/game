import type { DayEntrySnapshot } from '../../contracts/data-contract';
import { Simulation } from '../simulation/engine';
import { initialProgress, makeSnapshot } from '../simulation/state';
import { facilityDefinition, largeFacilityNavigation } from '../simulation/graphNavigation';

export type FacilityMode = 'campaign' | 'sandbox';

/** 演练只开放原配置第三日的阵容和房间，经济、装备和技能仍从原始进度开始。 */
export function createFacilitySimulation(mode: FacilityMode = 'campaign', snapshot?: DayEntrySnapshot): Simulation {
  const simulation = new Simulation(snapshot ?? (mode === 'sandbox' ? makeSnapshot(3, initialProgress()) : undefined), {
    navigation: largeFacilityNavigation,
    ambient: facilityDefinition.ambient,
  });
  if (mode === 'sandbox') simulation.command({ type: 'START_DAY', commandId: 'facility-sandbox-start' });
  return simulation;
}
