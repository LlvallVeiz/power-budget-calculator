'use strict';

/**
 * loadProfile.test.js — multi-mode duty-cycle profiles.
 *
 * Hand-checked fixture: ESP32 + LoRa node, 600 s cycle.
 *   sleep 597 s @ 0.05 mA, sense 2 s @ 40 mA, tx 1 s @ 120 mA
 *   avg current = (597*0.05 + 2*40 + 1*120) / 600
 *               = (29.85 + 80 + 120) / 600 = 229.85 / 600
 *               = 0.383083... mA
 *   charge per cycle = 229.85 mA*s = 63.847 uAh
 *   energy per day at 3.3 V = 0.383083 * 3.3 * 24 = 30.34 mWh
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, averageCurrent, peakCurrent, analyzeProfile } = require('../src/loadProfile');
const { ValidationError } = require('../src/errors');

const LORA_PROFILE = {
  cycle_s: 600,
  modes: [
    { name: 'sleep', current_mA: 0.05, duration_s: 597 },
    { name: 'sense', current_mA: 40, duration_s: 2 },
    { name: 'tx', current_mA: 120, duration_s: 1 },
  ],
};

test('average current matches the hand calculation', () => {
  const profile = validateProfile(LORA_PROFILE);
  assert.ok(Math.abs(averageCurrent(profile) - 0.3830833) < 1e-6);
});

test('peak current is the TX mode', () => {
  assert.equal(peakCurrent(validateProfile(LORA_PROFILE)), 120);
});

test('analyzeProfile reports duty cycles, charge shares and energy', () => {
  const a = analyzeProfile(validateProfile(LORA_PROFILE), 3.3);
  assert.equal(a.cyclesPerDay, 144);
  assert.ok(Math.abs(a.energyPerDay_mWh - 30.34) < 0.01);
  assert.equal(a.dominantMode, 'tx');
  const tx = a.modes.find((m) => m.name === 'tx');
  assert.ok(Math.abs(tx.charge_uAh - 120 / 3.6) < 1e-3); // rounded to 4 decimals
  // TX is 1 s of 600 s but 52.2% of the charge: 120/229.85
  assert.ok(Math.abs(tx.shareOfCharge - 120 / 229.85) < 1e-3);
  const sleep = a.modes.find((m) => m.name === 'sleep');
  assert.ok(Math.abs(sleep.dutyCycle - 0.995) < 1e-9);
});

test('durations must add up to the cycle length', () => {
  assert.throws(
    () => validateProfile({ cycle_s: 600, modes: [{ name: 'sleep', current_mA: 1, duration_s: 100 }] }),
    ValidationError,
  );
});

test('negative current, zero duration and empty modes are rejected', () => {
  assert.throws(
    () => validateProfile({ cycle_s: 10, modes: [{ name: 'x', current_mA: -1, duration_s: 10 }] }),
    ValidationError,
  );
  assert.throws(
    () => validateProfile({ cycle_s: 10, modes: [{ name: 'x', current_mA: 1, duration_s: 0 }] }),
    ValidationError,
  );
  assert.throws(() => validateProfile({ cycle_s: 10, modes: [] }), ValidationError);
  assert.throws(() => validateProfile({ cycle_s: 0, modes: [{ name: 'x', current_mA: 1, duration_s: 1 }] }), ValidationError);
});

test('a single-mode profile is just a steady load', () => {
  const a = analyzeProfile(validateProfile({
    cycle_s: 60,
    modes: [{ name: 'on', current_mA: 10, duration_s: 60 }],
  }), 5);
  assert.equal(a.averageCurrent_mA, 10);
  assert.equal(a.averagePower_mW, 50);
  assert.equal(a.energyPerDay_mWh, 1200);
});
