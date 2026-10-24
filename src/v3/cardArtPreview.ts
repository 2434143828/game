import type { AnomalyId, ArmorId, WeaponId } from '../../contracts/data-contract';
import type { Navigation } from '../simulation/navigation';
import { createV3State, V3Simulation } from './engine';

export const cardArtGroups = ['T', 'N01', 'N02', 'N03', 'N04', 'N05'] as const;
export type CardArtGroup = typeof cardArtGroups[number];

export function cardArtPreviewTarget(search: string, development: boolean): CardArtGroup | null {
  if (!development) return null;
  const value = new URLSearchParams(search).get('cardArtPreview');
  return cardArtGroups.find(id => id === value) ?? null;
}

/** Isolated visual fixture: equipment and opening draw are explicit, all subsequent actions use the normal simulation. */
export function createCardArtPreview(group: CardArtGroup, navigation: Navigation): V3Simulation {
  const state = createV3State(navigation);
  state.rooms.forEach(room => { room.owned = true; room.rank = 2; room.state = 'STABLE'; });
  state.ownedWeapons = ['W00', 'W01', 'W02', 'W03', 'W04', 'W05'];
  state.ownedArmors = ['A00', 'A01', 'A02', 'A03', 'A04', 'A05'];
  state.wallet = 1000;
  const simulation = new V3Simulation(state, { navigation });
  const suffix = group === 'T' ? '00' : group.slice(1);
  const equipped = simulation.equip('E01', `W${suffix}` as WeaponId, `A${suffix}` as ArmorId);
  if (!equipped.ok) throw new Error(equipped.message);
  const target: AnomalyId = group === 'T' ? 'N01' : group;
  const room = simulation.state.rooms.find(r => r.anomalyId === target)!;
  room.owned = false; room.rank = 0; room.state = 'LOCKED';
  const started = simulation.startEncounter('CAPTURE', target);
  if (!started.ok) throw new Error(started.message);
  const deck = simulation.state.encounter!.deck;
  const cards = [...deck.hand, ...deck.drawPile];
  deck.hand = cards.filter(card => card.ownerId === 'E01').sort((a, b) => a.cardId.localeCompare(b.cardId));
  deck.drawPile = cards.filter(card => card.ownerId !== 'E01');
  simulation.setPaused(true);
  return simulation;
}
