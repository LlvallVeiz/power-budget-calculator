'use strict';

/**
 * regulator.test.js — LDO, buck and direct power paths.
 *
 * Hand-checked fixtures (buck 3.7 V -> 3.3 V, eta 0.90, Iq 0.005 mA):
 *   I_bat = (3.3 * I_load) / (3.7 * 0.90) + 0.005
 *   I_load = 120 mA -> 396/3.33 + 0.005 = 118.9239 mA
 *   I_load = 0.05 mA -> 0.165/3.33 + 0.005 = 0.05455 mA
 * LDO 4.5 V -> 3.3 V: eta = 3.3/4.5 = 0.7333, I_bat = I_load + Iq.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRegulator,
  batteryCurrent,
  powerLossMw,
  analyzeRegulator,
} = require('../src/regulator');
const { validateProfile } = require('../src/loadProfile');
const { ValidationError } = require('../src/errors');

const BUCK = {
  type: 'buck', inputVoltage_V: 3.7, outputVoltage_V: 3.3, efficiency: 0.9, quiescentCurrent_mA: 0.005,
};
const LDO = {
  type: 'ldo', inputVoltage_V: 4.5, outputVoltage_V: 3.3, quiescentCurrent_mA: 0.002,
};

test('buck battery current matches the power-balance hand calculation', () => {
  const reg = validateRegulator(BUCK);
  assert.ok(Math.abs(batteryCurrent(reg, 120) - 118.9239) < 1e-3);
  assert.ok(Math.abs(batteryCurrent(reg, 0.05) - 0.05455) < 1e-4);
  // At the same load, a buck draws LESS from the battery than the load itself
  assert.ok(batteryCurrent(reg, 120) < 120);
});

test('LDO battery current is load plus quiescent, efficiency is Vout/Vin', () => {
  const reg = validateRegulator(LDO);
  assert.equal(reg.efficiency, 3.3 / 4.5);
  assert.equal(batteryCurrent(reg, 15), 15.002);
  assert.equal(batteryCurrent(reg, 0.01), 0.012);
});

test('LDO efficiency cannot exceed the voltage ratio', () => {
  assert.throws(
    () => validateRegulator({ type: 'ldo', inputVoltage_V: 4.5, outputVoltage_V: 3.3, efficiency: 0.9 }),
    ValidationError,
  );
});

test('direct connection passes the load current through', () => {
  const reg = validateRegulator({ type: 'direct' });
  assert.equal(batteryCurrent(reg, 42), 42);
  assert.equal(powerLossMw(reg, 42), 0);
});

test('buck loss equals input minus output power', () => {
  const reg = validateRegulator(BUCK);
  // P_in = 118.9239 * 3.7 = 440.02 mW; P_out = 120 * 3.3 = 396 mW
  const loss = powerLossMw(reg, 120);
  assert.ok(Math.abs(loss - 44.02) < 0.05, `got ${loss}`);
});

test('analyzeRegulator averages mode by mode over the profile', () => {
  const profile = validateProfile({
    cycle_s: 600,
    modes: [
      { name: 'sleep', current_mA: 0.05, duration_s: 597 },
      { name: 'sense', current_mA: 40, duration_s: 2 },
      { name: 'tx', current_mA: 120, duration_s: 1 },
    ],
  });
  const a = analyzeRegulator(validateRegulator(BUCK), profile);
  // (597*0.0545495 + 2*39.64464 + 1*118.92392) / 600 = 0.384632 mA
  assert.ok(Math.abs(a.averageBatteryCurrent_mA - 0.384632) < 1e-5, `got ${a.averageBatteryCurrent_mA}`);
  // Effective efficiency: P_out / P_in at the average load
  assert.ok(a.effectiveEfficiency > 0.85 && a.effectiveEfficiency < 0.92);
});

test('invalid regulator descriptions are rejected', () => {
  assert.throws(() => validateRegulator({ type: 'boost', inputVoltage_V: 3, outputVoltage_V: 5 }), ValidationError);
  assert.throws(() => validateRegulator({ type: 'buck', inputVoltage_V: 3.3, outputVoltage_V: 3.3 }), ValidationError);
  assert.throws(() => validateRegulator({ type: 'ldo', inputVoltage_V: 3.0, outputVoltage_V: 3.3 }), ValidationError);
  assert.throws(() => validateRegulator({ type: 'buck', inputVoltage_V: 3.7, outputVoltage_V: 3.3, efficiency: 1.2 }), ValidationError);
});
