import { describe, expect, it } from 'vitest';
import { config } from '../src/data/config';
import { initialProgress, makeSnapshot } from '../src/simulation/state';
import { largeFacilityNavigation } from '../src/simulation/graphNavigation';
import { createV3State, V3Simulation } from '../src/v3/engine';
import { LEGACY_BACKUP_KEY, V3_SAVE_KEY, loadV3, migrateLegacy, saveV3, validateV3Save } from '../src/v3/save';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const legacy = (day: 1 | 2 | 3 = 1) => {
  const progress = initialProgress(); progress.wallet = 367;
  progress.research.N01 = { behavior: true, combat: true, equipmentDeveloped: true };
  progress.ownedWeapons.push('W01'); progress.ownedArmors.push('A01');
  progress.employeeLoadouts.E04 = { weaponId: 'W01', armorId: 'A01' };
  return JSON.stringify({ snapshot: makeSnapshot(day, progress), demoCompleted: false });
};

describe('v0.3 versioned storage and legacy compatibility', () => {
  it('returns an explicit load status so callers never overwrite blocked saves', () => {
    expect(loadV3(storage(), 1000).status).toBe('EMPTY');
    expect(loadV3(storage({ [V3_SAVE_KEY]: '{bad' }), 1000).status).toBe('BLOCKED');
    const port = storage(); saveV3(port, createV3State(), 1000);
    expect(loadV3(port, 1000).status).toBe('LOADED');
    port.setItem = () => { throw new Error('blocked'); };
    expect(loadV3(port, 61000)).toMatchObject({ status: 'BLOCKED', state: expect.any(Object) });
  });
  it('backs up raw legacy before writing new key and preserves wallet, equipment and all legacy employees', () => {
    const raw = legacy(3); const port = storage({ [config.game.save.key]: raw });
    const writes: string[] = []; const setter = port.setItem;
    port.setItem = (key, value) => { writes.push(key); setter(key, value); };
    const result = loadV3(port, 1000);
    expect(writes).toEqual([LEGACY_BACKUP_KEY, V3_SAVE_KEY]);
    expect(port.getItem(config.game.save.key)).toBe(raw);
    expect(port.getItem(LEGACY_BACKUP_KEY)).toBe(raw);
    expect(result.state?.wallet).toBe(367);
    expect(result.state?.employees).toHaveLength(6);
    expect(result.state?.employees.every(e => largeFacilityNavigation.locate(e.location) !== null)).toBe(true);
    expect(result.state?.employees.find(e => e.id === 'E04')).toMatchObject({ weaponId: 'W01', armorId: 'A01', weaponTier: 1 });
    expect(result.state?.ownedWeapons).toContain('W01');
    expect(result.state?.rooms.every(r => r.owned && r.rank === 1 && r.state === 'STABLE')).toBe(true);
    expect(result.message).toContain('没有中途生命');
  });

  it('maps actual day-one active rooms, not all configured anomalies, to owned rank one', () => {
    const result = migrateLegacy(legacy()); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rooms.filter(r => r.owned).map(r => r.anomalyId)).toEqual(['N01', 'N02']);
    expect(result.value.rooms.find(r => r.anomalyId === 'N03')).toMatchObject({ owned: false, rank: 0, state: 'LOCKED' });
  });

  it('refuses migration if backup fails; never clears or replaces legacy data', () => {
    const raw = legacy(); const port = storage({ [config.game.save.key]: raw });
    port.setItem = () => { throw new Error('quota exceeded'); };
    expect(loadV3(port, 1000)).toMatchObject({ message: expect.stringContaining('备份失败') });
    expect(port.getItem(config.game.save.key)).toBe(raw); expect(port.getItem(V3_SAVE_KEY)).toBeNull();
  });

  it('retains backup and old save if new-save write fails', () => {
    const raw = legacy(); const port = storage({ [config.game.save.key]: raw }); const setter = port.setItem;
    port.setItem = (key, value) => { if (key === V3_SAVE_KEY) throw new Error('quota'); setter(key, value); };
    expect(loadV3(port, 1000).state).toBeUndefined();
    expect(port.getItem(LEGACY_BACKUP_KEY)).toBe(raw); expect(port.getItem(config.game.save.key)).toBe(raw);
  });

  it('preserves unknown legacy equipment as raw backup instead of deleting it or guessing a mapping', () => {
    const value = JSON.parse(legacy()); value.snapshot.progress.ownedWeapons.push('W99'); const raw = JSON.stringify(value);
    const port = storage({ [config.game.save.key]: raw });
    expect(loadV3(port, 1000).state).toBeUndefined();
    expect(port.getItem(LEGACY_BACKUP_KEY)).toBe(raw); expect(port.getItem(V3_SAVE_KEY)).toBeNull();
  });

  it('does not overwrite a different previously archived raw save', () => {
    const raw = legacy(2); const port = storage({ [config.game.save.key]: raw, [LEGACY_BACKUP_KEY]: 'previous raw' });
    expect(loadV3(port, 7000).state).toBeDefined();
    expect(port.getItem(LEGACY_BACKUP_KEY)).toBe('previous raw'); expect(port.getItem(`${LEGACY_BACKUP_KEY}.7000`)).toBe(raw);
  });

  it('keeps corrupt new JSON intact and does not silently fall back to an older legacy snapshot', () => {
    const port = storage({ [V3_SAVE_KEY]: '{broken', [config.game.save.key]: legacy() });
    expect(loadV3(port, 1000).state).toBeUndefined(); expect(port.getItem(V3_SAVE_KEY)).toBe('{broken');
    expect(port.getItem(LEGACY_BACKUP_KEY)).toBeNull();
  });

  it('rejects non-finite values, unknown IDs, duplicate rooms and unsupported rank', () => {
    for (const change of [
      (s: ReturnType<typeof createV3State>) => { s.wallet = NaN; },
      (s: ReturnType<typeof createV3State>) => { s.employees[0]!.location.x = Infinity; },
      (s: ReturnType<typeof createV3State>) => { Object.assign(s.employees[0]!, { weaponId: 'W99' }); },
      (s: ReturnType<typeof createV3State>) => { s.rooms[1]!.anomalyId = 'N01'; },
      (s: ReturnType<typeof createV3State>) => { s.rooms[0]!.rank = 9; },
    ]) {
      const state = createV3State(); change(state);
      const port = storage(); expect(saveV3(port, state, 1000).ok).toBe(false); expect(port.getItem(V3_SAVE_KEY)).toBeNull();
    }
  });

  it('validates inventory ownership and equipment tier against room ranks', () => {
    const state = createV3State(); state.employees[0]!.weaponId = 'W01'; state.employees[0]!.weaponTier = 2;
    expect(validateV3Save({ saveVersion: 3, savedAtMs: 1000, state }).ok).toBe(false);
    state.rooms[0]!.rank = 2;
    expect(validateV3Save({ saveVersion: 3, savedAtMs: 1000, state }).ok).toBe(true);
    state.ownedWeapons = [];
    expect(validateV3Save({ saveVersion: 3, savedAtMs: 1000, state }).ok).toBe(false);
  });

  it('rejects inventory from an unowned room even when no employee has equipped it', () => {
    const state = createV3State(); state.ownedWeapons.push('W05');
    expect(saveV3(storage(), state, 1000).ok).toBe(false);
  });
});

describe('v0.3 offline boundaries and battle exits', () => {
  it('caps stable offline production at two hours and commits credit exactly once', () => {
    const port = storage(); const state = createV3State(); state.wallet = 13; state.rooms[0]!.rank = 2;
    state.employees[0]!.hp = 42; state.employees[0]!.sp = 23;
    expect(saveV3(port, state, 1000).ok).toBe(true);
    const first = loadV3(port, 1000 + 12 * 3600 * 1000);
    expect(first.state?.wallet).toBe(493); expect(first.state?.rooms[0]!.rank).toBe(2);
    expect(first.state?.employees[0]).toMatchObject({ hp: 42, sp: 23 });
    const second = loadV3(port, 1000 + 12 * 3600 * 1000);
    expect(second.state?.wallet).toBe(493);
    expect(second.state?.simulationTimeSec).toBe(0);
  });

  it('does not credit a paused facility or negative elapsed time', () => {
    const port = storage(); const state = createV3State(); state.timeScale = 0;
    saveV3(port, state, 2000); expect(loadV3(port, 2000000).state?.wallet).toBe(state.wallet);
    state.timeScale = 1; saveV3(port, state, 2000);
    expect(loadV3(port, 1000).state?.wallet).toBe(state.wallet);
    expect(loadV3(port, 2000).state?.wallet).toBe(state.wallet);
  });

  it('does not expose uncommitted offline credit on storage failure', () => {
    const port = storage(); const state = createV3State(); saveV3(port, state, 1000);
    const original = port.getItem(V3_SAVE_KEY); port.setItem = () => { throw new Error('full'); };
    const loaded = loadV3(port, 61000);
    expect(loaded.state?.wallet).toBe(state.wallet); expect(loaded.message).toContain('离线收益未领取');
    expect(port.getItem(V3_SAVE_KEY)).toBe(original);
  });

  it('abandons pending challenge with no rank/reward/offline gain; restores rooms, actor homes and keeps health/equipment', () => {
    const sim = new V3Simulation(); sim.equip('E01', 'W01', 'A01');
    expect(sim.startEncounter('BREACH_CHALLENGE', 'N01').ok).toBe(true);
    sim.state.employees[0]!.hp = 35; sim.state.employees[0]!.sp = 24;
    const card = sim.state.encounter!.deck.hand[0]!;
    sim.state.encounter!.deck.pendingCast = { instanceId: card.instanceId, targetId: sim.state.encounter!.enemies[0]!.id, requestId: 'pending', phase: 'WINDUP', resolvesAtSec: 2 };
    sim.setPaused(true);
    const wallet = sim.state.wallet; const home = { ...sim.state.employees[0]!.home }; const port = storage();
    expect(saveV3(port, sim.state, 1000).ok).toBe(true);
    const loaded = loadV3(port, 7201000);
    expect(loaded.state).toMatchObject({ wallet, phase: 'FACILITY', encounter: null });
    expect(loaded.state?.rooms[0]).toMatchObject({ state: 'STABLE', rank: 1 });
    expect(loaded.state?.employees[0]).toMatchObject({ location: home, hp: 35, sp: 24, weaponId: 'W01', armorId: 'A01', status: 'IDLE', path: [], order: { kind: 'IDLE' } });
    expect(loaded.message).toContain('放弃');
    expect(loadV3(port, 7201000).state?.wallet).toBe(wallet);
  });

  it('does not grant an uncaught target on capture refresh and does not refund entrance energy', () => {
    const sim = new V3Simulation(); sim.state.rooms[0]!.rank = 2; sim.state.wallet = 80;
    expect(sim.startEncounter('CAPTURE', 'N02').ok).toBe(true);
    const port = storage(); expect(saveV3(port, sim.state, 1000).ok).toBe(true);
    const loaded = loadV3(port, 9000000);
    expect(loaded.state?.wallet).toBe(30);
    expect(loaded.state?.rooms[1]).toMatchObject({ owned: false, rank: 0, state: 'LOCKED' });
    expect(loaded.state?.ownedWeapons).not.toContain('W02');
  });

  it('keeps injured squad status until recovery and does not teleport noncombat employees on reload', () => {
    const migrated = migrateLegacy(legacy(3)); expect(migrated.ok).toBe(true); if (!migrated.ok) return;
    const sim = new V3Simulation(migrated.value, { navigation: largeFacilityNavigation });
    const bystander = sim.state.employees[3]!;
    const destination = largeFacilityNavigation.idlePoints[0]!;
    bystander.location = largeFacilityNavigation.locate(destination)!;
    bystander.path = [{ ...largeFacilityNavigation.idlePoints[1]! }];
    bystander.status = 'MOVING';
    bystander.order = { kind: 'MOVE', destination: { ...bystander.path[0]! } };
    const expectedBystander = structuredClone(bystander);
    expect(sim.startEncounter('BREACH_CHALLENGE', 'N01').ok).toBe(true);
    sim.state.employees[0]!.hp = 0; sim.state.employees[0]!.status = 'INCAPACITATED';
    sim.state.employees[1]!.sp = 0; sim.state.employees[1]!.status = 'PANICKED';
    const port = storage(); expect(saveV3(port, sim.state, 1000).ok).toBe(true);
    const loaded = loadV3(port, 7201000);
    expect(loaded.state?.employees[0]).toMatchObject({ hp: 0, status: 'INCAPACITATED' });
    expect(loaded.state?.employees[1]).toMatchObject({ sp: 0, status: 'PANICKED' });
    expect(loaded.state?.employees[3]).toEqual(expectedBystander);
    expect(loaded.state?.rooms[0]!.rank).toBe(1);
    expect(loaded.state?.wallet).toBe(sim.state.wallet);
  });

  it('handles unavailable storage without throwing', () => {
    const port = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(loadV3(port, 1000).state).toBeUndefined(); expect(loadV3(port, NaN).state).toBeUndefined();
  });

  it('accepts actual encounter snapshots through movement, attacks, casualties and outcome', () => {
    const sim = new V3Simulation(); sim.startEncounter('BREACH_CHALLENGE', 'N01'); const port = storage();
    for (let seconds = 0; seconds < 130; seconds++) {
      sim.update(1000);
      expect(saveV3(port, sim.state, 1000 + seconds * 1000), `save at ${seconds}s`).toMatchObject({ ok: true });
    }
  });

  it('round trips card cast presentation metadata used by the live card effects', () => {
    const sim = new V3Simulation();
    expect(sim.equip('E01', 'W01', 'A01').ok).toBe(true);
    expect(sim.startEncounter('BREACH_CHALLENGE', 'N01').ok).toBe(true);
    sim.state.logs.push({ id: 'event-card-art', timeSec: 1, kind: 'CARD', message: '技能命中', sourceId: 'E01', targetId: 'enemy-1', cardId: 'N01_1', instanceId: 'card-1', sourcePoint: { x: 10, y: 20 }, targetPoint: { x: 30, y: 40 } });
    const port = storage();
    expect(saveV3(port, sim.state, 1000).ok).toBe(true);
    const loaded = loadV3(port, 1000);
    expect(loaded.status).toBe('LOADED');
    expect(loaded.state?.logs.at(-1)).toMatchObject({ cardId: 'N01_1', instanceId: 'card-1', sourcePoint: { x: 10, y: 20 }, targetPoint: { x: 30, y: 40 } });
  });

  it('round trips real multi-floor navigation metadata during 600 seconds of ambient walking and continues the same route', () => {
    const sim = new V3Simulation(undefined, { navigation: largeFacilityNavigation });
    const port = storage(); let waypointCount = 0; const locationKeys = new Set<string>();
    for (let second = 1; second <= 600; second++) {
      sim.update(1000);
      for (const e of sim.state.employees) {
        for (const p of e.path) if ('segmentId' in p) waypointCount++;
        for (const key of Object.keys(e.location)) locationKeys.add(key);
      }
      expect(saveV3(port, sim.state, second * 1000), `large facility save at ${second}s`).toMatchObject({ ok: true });
      const loaded = loadV3(port, second * 1000);
      expect(loaded.status).toBe('LOADED');
      expect(loaded.state).toEqual(sim.state);
    }
    expect(waypointCount).toBeGreaterThan(0);
    expect(locationKeys.has('floorId')).toBe(true);
    expect(locationKeys.has('segmentId')).toBe(true);
    const loaded = loadV3(port, 600000);
    const continued = new V3Simulation(loaded.state, { navigation: largeFacilityNavigation });
    for (let second = 0; second < 20; second++) { sim.update(1000); continued.update(1000); }
    expect(continued.state).toEqual(sim.state);
  });
});
