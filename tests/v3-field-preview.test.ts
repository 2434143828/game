import { describe, expect, it } from 'vitest';
import { largeFacilityNavigation } from '../src/simulation/graphNavigation';
import { createFieldPreview, fieldPreviewTarget } from '../src/v3/fieldPreview';

describe('development-only field art fixture', () => {
  it('ignores preview queries outside development and rejects unknown IDs', () => {
    expect(fieldPreviewTarget('?fieldPreview=N01', false)).toBeNull();
    expect(fieldPreviewTarget('?fieldPreview=N06', true)).toBeNull();
    expect(fieldPreviewTarget('?fieldPreview=N01', true)).toBe('N01');
  });
  it.each(['N01','N02','N03','N04','N05'] as const)('starts a real paused CAPTURE for %s with no result or reward', id => {
    const sim = createFieldPreview(id, largeFacilityNavigation);
    expect(sim.state.encounter?.mode).toBe('CAPTURE');
    expect(sim.state.encounter?.targetAnomalyId).toBe(id);
    expect(sim.state.rooms.find(room => room.anomalyId === id)?.owned).toBe(false);
    expect(sim.state.encounter?.result).toBeNull();
    expect(sim.state.encounter?.rewardApplied).toBe(false);
    expect(sim.state.encounter?.squadIds).toHaveLength(3);
    const before = structuredClone(sim.state);
    sim.update(1000);
    expect(sim.state).toEqual(before);
  });
});
