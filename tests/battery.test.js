'use strict';

/**
 * battery.test.js — Peukert, temperature derating, self-discharge.
 *
 * Hand-checked fixtures:
 * - Peukert, lead-acid 100 Ah, n=1.2, rated 20 h (I_rated = 5 A), load 10 A:
 *     C_eff = 100 * (5/10)^(0.2) = 100 * 0.87055 = 87.06 Ah
 * - Peukert cap: Li-ion 3400 mAh at 0.38 mA must NOT exceed 3400 mAh
 *   (classical law would predict ~3840 mAh — unphysical at tiny currents).
 * - Self-discharge: 3400 mAh * 2%/month / 730.5 h = 0.0931 mA.
 * - Temperature: 0 C factor 0.85, -20 C factor 0.55, 25 C factor 1.0.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBattery,
  temperatureFactor,
  peukertCapacity,
  selfDischargeCurrent,
  analyzeBattery,
} = require('../src/battery');
const { ValidationError } = require('../src/errors');

test('Peukert correction matches the hand calculation (lead-acid)', () => {
  const battery = validateBattery({
    chemistry: 'lead-acid',
    capacity_mAh: 100000,
    nominalVoltage_V: 12,
    peukertExponent: 1.2,
    ratedHours: 20,
  });
  // I_rated = 100000/20 = 5000 mA; load 10000 mA
  const c = peukertCapacity(battery, 10000);
  assert.ok(Math.abs(c - 87055) < 5, `got ${c}`);
});

test('Peukert capacity is capped at the rated capacity at tiny currents', () => {
  const battery = validateBattery({ chemistry: 'li-ion', capacity_mAh: 3400 });
  assert.equal(peukertCapacity(battery, 0.38), 3400);
  assert.equal(peukertCapacity(battery, 0), 3400);
});

test('Peukert exponent 1.0 means no correction at any current', () => {
  const battery = validateBattery({
    chemistry: 'li-ion', capacity_mAh: 3400, peukertExponent: 1.0,
  });
  assert.equal(peukertCapacity(battery, 500), 3400);
  assert.equal(peukertCapacity(battery, 3000), 3400);
});

test('temperature derating table interpolates and clamps', () => {
  assert.equal(temperatureFactor(25), 1);
  assert.equal(temperatureFactor(0), 0.85);
  assert.equal(temperatureFactor(-20), 0.55);
  assert.equal(temperatureFactor(-40), 0.55); // clamped at the cold end
  assert.equal(temperatureFactor(60), 1.02); // clamped at the hot end
  // halfway between 0 C (0.85) and 10 C (0.93) -> 0.89
  assert.ok(Math.abs(temperatureFactor(5) - 0.89) < 1e-9);
});

test('self-discharge current matches the hand calculation', () => {
  // 3400 mAh * 0.02 / 730.5 h = 0.09309 mA
  assert.ok(Math.abs(selfDischargeCurrent(3400, 0.02) - 0.09309) < 1e-5);
  // Alkaline AA: 2500 mAh * 0.0025 / 730.5 = 0.00856 mA
  assert.ok(Math.abs(selfDischargeCurrent(2500, 0.0025) - 0.00856) < 1e-5);
});

test('chemistry defaults fill in Peukert and self-discharge', () => {
  const li = validateBattery({ chemistry: 'li-ion', capacity_mAh: 3400 });
  assert.equal(li.peukertExponent, 1.02);
  assert.equal(li.selfDischargePerMonth, 0.02);
  assert.equal(li.nominalVoltage_V, 3.7);
  const aa = validateBattery({ chemistry: 'alkaline', capacity_mAh: 2500 });
  assert.equal(aa.peukertExponent, 1.15);
  assert.equal(aa.selfDischargePerMonth, 0.0025);
});

test('series cells add voltage, parallel cells add capacity', () => {
  const series = validateBattery({ chemistry: 'alkaline', capacity_mAh: 2500, cells: 2, series: true });
  assert.equal(series.nominalVoltage_V, 3.0);
  assert.equal(series.capacity_mAh, 2500);
  const parallel = validateBattery({ chemistry: 'alkaline', capacity_mAh: 2500, cells: 2, series: false });
  assert.equal(parallel.nominalVoltage_V, 1.5);
  assert.equal(parallel.capacity_mAh, 5000);
});

test('analyzeBattery combines all corrections', () => {
  const battery = validateBattery({
    chemistry: 'li-ion',
    capacity_mAh: 3400,
    usableFraction: 0.9,
  });
  const a = analyzeBattery(battery, 0.385, 25);
  assert.equal(a.peukertCapacity_mAh, 3400); // capped
  assert.equal(a.temperatureFactor, 1);
  assert.equal(a.usableCapacity_mAh, 3060);
  assert.equal(a.energy_mWh, 12580); // 3400 mAh * 3.7 V
  const cold = analyzeBattery(battery, 0.385, 0);
  assert.equal(cold.usableCapacity_mAh, 2601); // 3400 * 0.85 * 0.9
});

test('unknown chemistry and bad values are rejected', () => {
  assert.throws(() => validateBattery({ chemistry: 'unobtainium', capacity_mAh: 100 }), ValidationError);
  assert.throws(() => validateBattery({ chemistry: 'li-ion', capacity_mAh: -5 }), ValidationError);
  assert.throws(() => validateBattery({ chemistry: 'li-ion', capacity_mAh: 100, peukertExponent: 2 }), ValidationError);
  assert.throws(() => validateBattery({ chemistry: 'li-ion', capacity_mAh: 100, usableFraction: 1.5 }), ValidationError);
});
