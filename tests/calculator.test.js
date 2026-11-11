'use strict';

/**
 * calculator.test.js — end-to-end budgets, hand-verified.
 *
 * Fixture A — ESP32 + LoRa node, TX every 10 min, 18650 3400 mAh, buck 90%:
 *   load avg 0.383083 mA, battery avg 0.384632 mA (see regulator.test.js)
 *   usable 3400 * 0.9 = 3060 mAh (Peukert capped, 25 C)
 *   self-discharge 3400 * 0.02 / 730.5 = 0.09309 mA
 *   total drain 0.47772 mA
 *   lifetime 3060 / 0.47772 = 6405.2 h = 266.9 days  (< 365 d target)
 *   required capacity for 365 d: solve 0.9*C / (0.384632 + C*0.02/730.5)
 *   = 8760 h -> C = 5104 mAh (see the algebra in docs/RESEARCH.md)
 *
 * Fixture B — BLE beacon, 3x AA alkaline, LDO:
 *   load avg 0.08495 mA, battery avg 0.08695 mA, usable 2000 mAh
 *   self-discharge 0.00856 mA, total 0.09551 mA
 *   lifetime 2000 / 0.09551 = 20941 h = 872.5 days  (> 365 d target)
 *
 * Fixture C — ESP32-CAM, LiPo 2000 mAh, buck 85%:
 *   load avg 21.0167 mA, battery avg 22.0624 mA, usable 1800 mAh
 *   self-discharge 0.05476 mA, total 22.117 mA
 *   lifetime 1800 / 22.117 = 81.4 h = 3.4 days  (< 30 d target)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateScenario, calculateBudget, requiredCapacity } = require('../src/calculator');

const LORA = {
  name: 'ESP32 + LoRa, TX every 10 min',
  load: {
    cycle_s: 600,
    modes: [
      { name: 'sleep', current_mA: 0.05, duration_s: 597 },
      { name: 'sense', current_mA: 40, duration_s: 2 },
      { name: 'tx', current_mA: 120, duration_s: 1 },
    ],
  },
  battery: { chemistry: 'li-ion', capacity_mAh: 3400, nominalVoltage_V: 3.7, usableFraction: 0.9 },
  regulator: {
    type: 'buck', inputVoltage_V: 3.7, outputVoltage_V: 3.3, efficiency: 0.9, quiescentCurrent_mA: 0.005,
  },
  temperature_C: 25,
  targetLifetimeDays: 365,
};

const BLE = {
  name: 'BLE beacon, 3x AA',
  load: {
    cycle_s: 1,
    modes: [
      { name: 'sleep', current_mA: 0.01, duration_s: 0.995 },
      { name: 'tx', current_mA: 15, duration_s: 0.005 },
    ],
  },
  battery: {
    chemistry: 'alkaline', capacity_mAh: 2500, cells: 3, series: true,
    nominalVoltage_V: 4.5, usableFraction: 0.8,
  },
  regulator: {
    type: 'ldo', inputVoltage_V: 4.5, outputVoltage_V: 3.3, quiescentCurrent_mA: 0.002,
  },
  temperature_C: 25,
  targetLifetimeDays: 365,
};

const CAMERA = {
  name: 'ESP32-CAM, photo every 1 min',
  load: {
    cycle_s: 60,
    modes: [
      { name: 'sleep', current_mA: 0.2, duration_s: 55 },
      { name: 'capture-tx', current_mA: 250, duration_s: 5 },
    ],
  },
  battery: { chemistry: 'lipo', capacity_mAh: 2000, nominalVoltage_V: 3.7, usableFraction: 0.9 },
  regulator: {
    type: 'buck', inputVoltage_V: 3.7, outputVoltage_V: 3.3, efficiency: 0.85, quiescentCurrent_mA: 0.01,
  },
  temperature_C: 25,
  targetLifetimeDays: 30,
};

test('ESP32+LoRa lifetime matches the hand calculation (266.9 days)', () => {
  const r = calculateBudget(validateScenario(LORA));
  assert.ok(Math.abs(r.lifetimeHours - 6405.2) < 1, `got ${r.lifetimeHours}`);
  assert.ok(Math.abs(r.lifetimeDays - 266.9) < 0.1, `got ${r.lifetimeDays}`);
  assert.equal(r.meetsTarget, false);
  assert.ok(Math.abs(r.drain.total_mA - 0.47772) < 1e-4);
  assert.ok(r.warnings.some((w) => w.code === 'TARGET_NOT_MET'));
});

test('required capacity for the LoRa target is ~5104 mAh and verified by re-running', () => {
  const scenario = validateScenario(LORA);
  const needed = requiredCapacity(scenario, 365);
  assert.ok(needed > 5000 && needed < 5200, `got ${needed}`);
  // The capacity the solver returns must actually meet the target.
  const rerun = calculateBudget(validateScenario({
    ...LORA,
    battery: { ...LORA.battery, capacity_mAh: needed },
  }));
  assert.ok(rerun.lifetimeHours >= 365 * 24, `got ${rerun.lifetimeHours}`);
  // One mAh less must fall short (bisection converged tightly).
  // Compare in hours: lifetimeDays is rounded to 1 decimal and would
  // hide a sub-day shortfall.
  const oneLess = calculateBudget(validateScenario({
    ...LORA,
    battery: { ...LORA.battery, capacity_mAh: needed - 1 },
  }));
  assert.ok(oneLess.lifetimeHours < 365 * 24, `got ${oneLess.lifetimeHours}`);
});

test('BLE beacon lifetime matches the hand calculation (872.5 days)', () => {
  const r = calculateBudget(validateScenario(BLE));
  assert.ok(Math.abs(r.lifetimeHours - 20941) < 2, `got ${r.lifetimeHours}`);
  assert.ok(Math.abs(r.lifetimeDays - 872.5) < 0.2, `got ${r.lifetimeDays}`);
  assert.equal(r.meetsTarget, true);
  assert.equal(r.requiredCapacity_mAh, undefined);
});

test('ESP32-CAM lifetime matches the hand calculation (3.4 days)', () => {
  const r = calculateBudget(validateScenario(CAMERA));
  assert.ok(Math.abs(r.lifetimeHours - 81.4) < 0.2, `got ${r.lifetimeHours}`);
  assert.ok(Math.abs(r.lifetimeDays - 3.4) < 0.05, `got ${r.lifetimeDays}`);
  assert.equal(r.meetsTarget, false);
  assert.ok(r.warnings.some((w) => w.code === 'TARGET_NOT_MET'));
});

test('cold temperature derates the lifetime', () => {
  const warm = calculateBudget(validateScenario(LORA));
  const cold = calculateBudget(validateScenario({ ...LORA, temperature_C: 0 }));
  // 0 C factor is 0.85, so lifetime should be ~85% of warm (self-discharge
  // is unchanged, so the ratio is slightly above 0.85).
  const ratio = cold.lifetimeDays / warm.lifetimeDays;
  assert.ok(ratio > 0.85 && ratio < 0.9, `got ${ratio}`);
  assert.ok(cold.warnings.some((w) => w.code === 'COLD_TEMPERATURE'));
});

test('self-discharge dominating the drain raises a warning', () => {
  const r = calculateBudget(validateScenario({
    name: 'coin-cell beacon, almost always asleep',
    load: { cycle_s: 60, modes: [{ name: 'sleep', current_mA: 0.001, duration_s: 60 }] },
    battery: { chemistry: 'li-ion', capacity_mAh: 225, nominalVoltage_V: 3.0, selfDischargePerMonth: 0.01 },
    regulator: { type: 'direct' },
  }));
  assert.ok(r.drain.selfDischargeShare > 0.5);
  assert.ok(r.warnings.some((w) => w.code === 'SELF_DISCHARGE_DOMINATES'));
});

test('peak current above the battery rating raises a warning', () => {
  const r = calculateBudget(validateScenario({
    ...LORA,
    battery: { ...LORA.battery, capacity_mAh: 225, maxContinuousCurrent_mA: 15 },
  }));
  assert.ok(r.warnings.some((w) => w.code === 'PEAK_CURRENT_EXCEEDED'));
});

test('AMS1117 quiescent current dominating sleep raises a warning', () => {
  const r = calculateBudget(validateScenario({
    ...LORA,
    regulator: {
      type: 'ldo', inputVoltage_V: 5, outputVoltage_V: 3.3, quiescentCurrent_mA: 5,
    },
  }));
  assert.ok(r.warnings.some((w) => w.code === 'REGULATOR_IQ_DOMINATES_SLEEP'));
});

test('no target means meetsTarget is null and no capacity is required', () => {
  const { targetLifetimeDays, ...noTarget } = LORA;
  const r = calculateBudget(validateScenario(noTarget));
  assert.equal(r.meetsTarget, null);
  assert.equal(r.targetLifetimeDays, null);
  assert.equal(r.requiredCapacity_mAh, undefined);
});

test('invalid scenarios are rejected', () => {
  assert.throws(() => validateScenario({ ...LORA, temperature_C: 200 }));
  assert.throws(() => validateScenario({ ...LORA, targetLifetimeDays: -3 }));
  assert.throws(() => validateScenario(null));
});
