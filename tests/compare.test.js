'use strict';

/**
 * compare.test.js — scenario comparison and variant building.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareScenarios, buildVariants } = require('../src/compare');
const { ValidationError } = require('../src/errors');

const BASE = {
  name: 'base',
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

function withBattery(name, battery) {
  return { ...BASE, name, battery: { ...BASE.battery, ...battery } };
}

test('comparison ranks scenarios by lifetime, best first', () => {
  const c = compareScenarios([
    withBattery('18650 2600 mAh', { capacity_mAh: 2600 }),
    withBattery('18650 3400 mAh', { capacity_mAh: 3400 }),
    withBattery('LiPo 2000 mAh', { chemistry: 'lipo', capacity_mAh: 2000 }),
  ]);
  assert.equal(c.best, '18650 3400 mAh');
  assert.deepEqual(
    c.summary.map((s) => s.name),
    ['18650 3400 mAh', '18650 2600 mAh', 'LiPo 2000 mAh'],
  );
  assert.equal(c.summary[0].lifetimeVsBest, 1);
  assert.ok(c.summary[2].lifetimeVsBest < c.summary[1].lifetimeVsBest);
  // 3400 mAh result must equal the hand-checked 266.9 days.
  assert.ok(Math.abs(c.summary[0].lifetimeDays - 266.9) < 0.1);
});

test('a bigger battery is not always better when self-discharge dominates', () => {
  // Same node, two coin cells: the 1000 mAh one self-discharges at
  // 1000*0.02/730.5 = 0.0274 mA while the load is only 0.385 mA, so the
  // lifetime gain is far below the 4.4x capacity ratio.
  const c = compareScenarios([
    withBattery('CR2032 225 mAh', { capacity_mAh: 225, selfDischargePerMonth: 0.01 }),
    withBattery('LiPo 1000 mAh', { chemistry: 'lipo', capacity_mAh: 1000 }),
  ]);
  const ratio = c.summary[0].lifetimeDays / c.summary[1].lifetimeDays;
  assert.ok(ratio < 4.4, `lifetime ratio ${ratio} should be below the capacity ratio`);
});

test('buildVariants overrides dotted paths without touching the base', () => {
  const variants = buildVariants(BASE, [
    { name: 'tx every 1 min', overrides: { 'load.cycle_s': 60, 'load.modes[0].duration_s': 57, 'load.modes[1].duration_s': 2, 'load.modes[2].duration_s': 1 } },
    { name: 'tx every 1 hour', overrides: { 'load.cycle_s': 3600, 'load.modes[0].duration_s': 3597 } },
  ]);
  assert.equal(variants.length, 2);
  assert.equal(variants[0].load.cycle_s, 60);
  assert.equal(variants[1].load.cycle_s, 3600);
  assert.equal(BASE.load.cycle_s, 600); // base untouched
  const c = compareScenarios(variants);
  // Longer TX interval must live longer.
  assert.equal(c.best, 'tx every 1 hour');
});

test('compare needs at least two scenarios', () => {
  assert.throws(() => compareScenarios([BASE]), ValidationError);
  assert.throws(() => compareScenarios([]), ValidationError);
});

test('unknown override paths are rejected', () => {
  assert.throws(
    () => buildVariants(BASE, [{ name: 'x', overrides: { 'battery.nope': 1 } }]),
    ValidationError,
  );
});
