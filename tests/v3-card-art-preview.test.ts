import { describe, expect, it } from 'vitest';
import { largeFacilityNavigation } from '../src/simulation/graphNavigation';
import { cardArtGroups, cardArtPreviewTarget, createCardArtPreview } from '../src/v3/cardArtPreview';
import { weaponCards } from '../src/v3/config';

describe('isolated card art fixture', () => {
  it('is unavailable in production and rejects invalid groups', () => {
    expect(cardArtPreviewTarget('?cardArtPreview=N01', false)).toBeNull();
    expect(cardArtPreviewTarget('?cardArtPreview=N06', true)).toBeNull();
    expect(cardArtPreviewTarget('?cardArtPreview=N01', true)).toBe('N01');
  });
  it.each(cardArtGroups)('%s preserves a real nine-card owner-bound deck and starts frozen', group => {
    const simulation = createCardArtPreview(group, largeFacilityNavigation);
    const deck = simulation.state.encounter!.deck;
    expect(deck.hand).toHaveLength(3);
    expect(deck.drawPile).toHaveLength(6);
    for (const card of [...deck.hand, ...deck.drawPile]) {
      expect(weaponCards[card.sourceWeaponId]).toContain(card.cardId);
      expect(simulation.state.employees.find(e => e.id === card.ownerId)?.weaponId).toBe(card.sourceWeaponId);
    }
    expect(new Set(deck.hand.map(card => card.cardId)).size).toBe(3);
    expect(deck.hand.every(card => card.ownerId === 'E01')).toBe(true);
    const before = structuredClone(simulation.state);
    simulation.update(1000);
    expect(simulation.state).toEqual(before);
  });
});
