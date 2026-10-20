import { describe, expect, it } from 'vitest';
import type { SaveEnvelope } from '../contracts/data-contract';
import { config, validateConfigBundle } from '../src/data/config';
import { loadSave, validateSave, writeSave } from '../src/save/storage';

const freshEnvelope = (): SaveEnvelope => ({
  snapshot: {
    schemaVersion: 1,
    designVersion: config.game.designVersion,
    saveBoundary: 'DAY_PREP_ENTRY',
    day: 1,
    progress: {
      wallet: config.game.economy.initialWallet,
      research: {
        N01: { behavior: false, combat: false, equipmentDeveloped: false },
        N02: { behavior: false, combat: false, equipmentDeveloped: false },
        N03: { behavior: false, combat: false, equipmentDeveloped: false },
        N04: { behavior: false, combat: false, equipmentDeveloped: false },
        N05: { behavior: false, combat: false, equipmentDeveloped: false },
      },
      unlockedSkills: [], ownedWeapons: [], ownedArmors: [], employeeLoadouts: {}, tutorialOfferHandled: false,
    },
  },
  demoCompleted: false,
});

function storageFixture(initial: string | null = null): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  raw: () => string | null;
  writes: () => number;
} {
  let raw = initial;
  let writes = 0;
  return {
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; writes += 1; },
    raw: () => raw,
    writes: () => writes,
  };
}

describe('runtime configuration boundary', () => {
  it('loads the seven validated documents with all five content sources', () => {
    expect(config.anomalyData.anomalies.map(a => a.name)).toEqual(['奶龙', '耄耋', '大狗', '叮咚鸡', '咕咕嘎嘎']);
    expect(config.skills).toHaveLength(5);
    expect(config.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(validateConfigBundle(config)).toEqual(config);
  });

  it('diagnoses the exact file and field for invalid numeric values', () => {
    const value = structuredClone(config);
    value.skills[0]!.cooldownSec = -2;
    expect(() => validateConfigBundle(value)).toThrow(/config\/skills.json :: 0.cooldownSec/);
  });

  it('rejects unknown content, equipment passive fields and mismatched source references', () => {
    const value = structuredClone(config);
    value.anomalyData.anomalies[0]!.weaponId = 'W02';
    expect(() => validateConfigBundle(value)).toThrow(/weaponId.*来源不一致/);
    const withPassive = structuredClone(config);
    Object.assign(withPassive.equipment.weapons[0]!, { passive: 'heal' });
    expect(() => validateConfigBundle(withPassive)).toThrow(/equipment.json/);
    const unknown = structuredClone(config);
    Object.assign(unknown.anomalyData.anomalies[0]!, { id: 'N06' });
    expect(() => validateConfigBundle(unknown)).toThrow(/anomalies.json/);
  });

  it('checks damage units, uniqueness, immutable resource and single-link boundaries', () => {
    const wrongUnit = structuredClone(config);
    Object.assign(wrongUnit.equipment.weapons[5]!.damage, { amount: 4 });
    expect(() => validateConfigBundle(wrongUnit)).toThrow(/amount/);
    const duplicate = structuredClone(config);
    duplicate.skills[1]!.id = duplicate.skills[0]!.id;
    expect(() => validateConfigBundle(duplicate)).toThrow(/重复/);
    const reward = structuredClone(config);
    reward.game.economy.suppressionReward = 1;
    expect(() => validateConfigBundle(reward)).toThrow(/suppressionReward/);
    const reversed = structuredClone(config);
    reversed.anomalyData.links[0]!.reverseLink = true;
    expect(() => validateConfigBundle(reversed)).toThrow(/reverseLink/);
  });

  it('uses IDs instead of requiring array order for associations', () => {
    const shuffled = structuredClone(config);
    shuffled.anomalyData.anomalies.reverse();
    shuffled.days.reverse();
    shuffled.skills.reverse();
    expect(() => validateConfigBundle(shuffled)).not.toThrow();
  });

  it('rejects a broken cumulative day roster and out-of-period initial pressure', () => {
    const roster = structuredClone(config);
    roster.days[1]!.newEmployeeIds = ['E04'];
    expect(() => validateConfigBundle(roster)).toThrow(/days.json/);
    const pressure = structuredClone(config);
    pressure.anomalyData.anomalies[0]!.initialPressure = config.game.pressure.breachThreshold;
    expect(() => validateConfigBundle(pressure)).toThrow(/initialPressure/);
  });
});

describe('day-entry JSON save boundary', () => {
  it('round-trips a clean snapshot and returns null for a missing slot', () => {
    const storage = storageFixture();
    expect(loadSave(storage)).toEqual({ ok: true, value: null });
    const envelope = freshEnvelope();
    expect(writeSave(envelope, storage).ok).toBe(true);
    expect(loadSave(storage)).toEqual({ ok: true, value: envelope });
    expect(storage.writes()).toBe(1);
  });

  it('detaches data from the caller and stores no runtime counters or entities', () => {
    const envelope = freshEnvelope();
    const result = validateSave(envelope);
    expect(result.ok).toBe(true);
    envelope.snapshot.progress.wallet = 1;
    if (result.ok) expect(result.value.snapshot.progress.wallet).toBe(config.game.economy.initialWallet);
    const runtimeInjected = { ...freshEnvelope(), enemies: [] };
    expect(validateSave(runtimeInjected).ok).toBe(false);
    const progressInjected = freshEnvelope();
    Object.assign(progressInjected.snapshot.progress, { producedToday: 150 });
    expect(validateSave(progressInjected).ok).toBe(false);
  });

  it('preserves malformed JSON verbatim without any implicit write', () => {
    const raw = '{"wallet": damaged!';
    const storage = storageFixture(raw);
    expect(loadSave(storage)).toMatchObject({ ok: false, code: 'INVALID_SAVE_JSON' });
    expect(storage.raw()).toBe(raw);
    expect(storage.writes()).toBe(0);
  });

  it.each([
    ['schemaVersion', 2], ['designVersion', 'next-version'], ['saveBoundary', 'MID_DAY'], ['day', 4],
  ])('rejects incompatible %s without overwriting original text', (field, value) => {
    const envelope = freshEnvelope();
    Object.assign(envelope.snapshot, { [field]: value });
    const raw = JSON.stringify(envelope);
    const storage = storageFixture(raw);
    expect(loadSave(storage)).toMatchObject({ ok: false, code: 'INVALID_SAVE' });
    expect(storage.raw()).toBe(raw);
    expect(storage.writes()).toBe(0);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid wallet %s', wallet => {
    const envelope = freshEnvelope();
    envelope.snapshot.progress.wallet = wallet;
    expect(validateSave(envelope).ok).toBe(false);
  });

  it('rejects unknown employee, anomaly, weapon and skill IDs', () => {
    const envelope = freshEnvelope();
    Object.assign(envelope.snapshot.progress.employeeLoadouts, { E07: { weaponId: 'W00', armorId: 'A00' } });
    expect(validateSave(envelope).ok).toBe(false);
    const research = freshEnvelope();
    Object.assign(research.snapshot.progress.research, { N06: { behavior: false, combat: false, equipmentDeveloped: false } });
    expect(validateSave(research).ok).toBe(false);
    const skill = freshEnvelope();
    Object.assign(skill.snapshot.progress, { unlockedSkills: ['S06'] });
    expect(validateSave(skill).ok).toBe(false);
    const weapon = freshEnvelope();
    Object.assign(weapon.snapshot.progress, { ownedWeapons: ['W99'] });
    expect(validateSave(weapon).ok).toBe(false);
  });

  it('rejects closed sources and inactive employees but permits partial starter loadouts', () => {
    const envelope = freshEnvelope();
    envelope.snapshot.progress.employeeLoadouts.E01 = { weaponId: 'W00', armorId: 'A00' };
    expect(validateSave(envelope).ok).toBe(true);
    envelope.snapshot.progress.employeeLoadouts.E06 = { weaponId: 'W00', armorId: 'A00' };
    expect(validateSave(envelope).ok).toBe(false);
    delete envelope.snapshot.progress.employeeLoadouts.E06;
    envelope.snapshot.progress.unlockedSkills = ['S03'];
    expect(validateSave(envelope).ok).toBe(false);
    envelope.snapshot.progress.unlockedSkills = [];
    envelope.snapshot.progress.research.N03.behavior = true;
    expect(validateSave(envelope).ok).toBe(false);
  });

  it('enforces archive prerequisites while allowing skill unlock before any incident or archive', () => {
    const envelope = freshEnvelope();
    envelope.snapshot.progress.unlockedSkills = ['S01'];
    expect(validateSave(envelope).ok).toBe(true);
    envelope.snapshot.progress.research.N01.combat = true;
    expect(validateSave(envelope).ok).toBe(false);
    envelope.snapshot.progress.research.N01.behavior = true;
    expect(validateSave(envelope).ok).toBe(true);
  });

  it('requires owned equipment, complete developed pairs and unique specialty holders', () => {
    const envelope = freshEnvelope();
    const progress = envelope.snapshot.progress;
    progress.employeeLoadouts.E01 = { weaponId: 'W01', armorId: 'A00' };
    expect(validateSave(envelope).ok).toBe(false);
    progress.research.N01 = { behavior: true, combat: false, equipmentDeveloped: true };
    progress.ownedWeapons = ['W01'];
    expect(validateSave(envelope).ok).toBe(false);
    progress.ownedArmors = ['A01'];
    expect(validateSave(envelope).ok).toBe(true);
    progress.employeeLoadouts.E02 = { weaponId: 'W01', armorId: 'A00' };
    expect(validateSave(envelope).ok).toBe(false);
    progress.employeeLoadouts.E02 = { weaponId: 'W00', armorId: 'A01' };
    expect(validateSave(envelope).ok).toBe(true);
    progress.employeeLoadouts.E03 = { weaponId: 'W00', armorId: 'A01' };
    expect(validateSave(envelope).ok).toBe(false);
  });

  it('rejects duplicate inventory entries and duplicate unlocked skill IDs', () => {
    const envelope = freshEnvelope();
    envelope.snapshot.progress.unlockedSkills = ['S01', 'S01'];
    expect(validateSave(envelope).ok).toBe(false);
    envelope.snapshot.progress.unlockedSkills = [];
    envelope.snapshot.progress.ownedWeapons = ['W00', 'W00'];
    expect(validateSave(envelope).ok).toBe(false);
  });

  it('completion is a separate third-day marker and survives reload', () => {
    const envelope = freshEnvelope();
    envelope.demoCompleted = true;
    expect(validateSave(envelope).ok).toBe(false);
    envelope.snapshot.day = 3;
    const storage = storageFixture();
    expect(writeSave(envelope, storage).ok).toBe(true);
    expect(loadSave(storage)).toEqual({ ok: true, value: envelope });
  });

  it('validates before touching the current slot and reports storage failures', () => {
    const storage = storageFixture('original');
    const envelope = freshEnvelope();
    envelope.snapshot.progress.wallet = -1;
    expect(writeSave(envelope, storage).ok).toBe(false);
    expect(storage.raw()).toBe('original');
    expect(storage.writes()).toBe(0);
    const unavailable = {
      getItem: (): never => { throw new Error('blocked'); },
      setItem: (): never => { throw new Error('quota'); },
    };
    expect(loadSave(unavailable)).toMatchObject({ ok: false, code: 'STORAGE_READ_FAILED' });
    expect(writeSave(freshEnvelope(), unavailable)).toMatchObject({ ok: false, code: 'STORAGE_WRITE_FAILED' });
  });
});
