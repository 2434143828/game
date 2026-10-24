import type { AnomalyId } from '../../contracts/data-contract';
import type { Navigation } from '../simulation/navigation';
import { anomalyIds } from './config';
import { createV3State, V3Simulation } from './engine';

/** Explicit art fixture. This module never reads or writes browser storage. */
export function fieldPreviewTarget(search: string, development: boolean): AnomalyId | null {
  if (!development) return null;
  const value = new URLSearchParams(search).get('fieldPreview');
  return anomalyIds.find(id => id === value) ?? null;
}

export function createFieldPreview(target: AnomalyId, navigation: Navigation): V3Simulation {
  const state = createV3State(navigation);
  // Unlock prerequisites in the fixture only. The target remains uncaptured,
  // including N01, whose normal campaign starts with it already contained.
  state.rooms.forEach(room => {
    room.owned = room.anomalyId !== target;
    room.rank = room.owned ? 2 : 0;
    room.state = room.owned ? 'STABLE' : 'LOCKED';
  });
  state.wallet = 1000;
  const simulation = new V3Simulation(state, { navigation });
  const result = simulation.startEncounter('CAPTURE', target);
  if (!result.ok) throw new Error(`外勤美术预览无法启动：${result.message}`);
  simulation.setPaused(true);
  return simulation;
}
