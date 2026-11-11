'use strict';

/**
 * report.test.js — text / JSON / CSV rendering.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateScenario, calculateBudget } = require('../src/calculator');
const { compareScenarios } = require('../src/compare');
const {
  renderText,
  renderJson,
  renderComparisonCsv,
  renderComparisonText,
  CSV_HEADER,
} = require('../src/report');

const SCENARIO = {
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

test('text report contains the key numbers and the warning', () => {
  const r = calculateBudget(validateScenario(SCENARIO));
  const text = renderText(r);
  assert.ok(text.includes('266.9 days'));
  assert.ok(text.includes('3400 mAh'));
  assert.ok(text.includes('TARGET_NOT_MET'));
  assert.ok(text.includes('5105 mAh') || text.includes('Capacity needed for target'));
  assert.ok(text.includes('tx: 120 mA'));
});

test('JSON render round-trips the result object', () => {
  const r = calculateBudget(validateScenario(SCENARIO));
  const parsed = JSON.parse(renderJson(r));
  assert.equal(parsed.lifetimeDays, r.lifetimeDays);
  assert.equal(parsed.name, SCENARIO.name);
});

test('CSV comparison has the header and one row per scenario', () => {
  const c = compareScenarios([
    SCENARIO,
    { ...SCENARIO, name: 'smaller cell', battery: { ...SCENARIO.battery, capacity_mAh: 2000 } },
  ]);
  const csv = renderComparisonCsv(c);
  const lines = csv.split('\n');
  assert.equal(lines[0], CSV_HEADER);
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes('ESP32 + LoRa'));
  assert.ok(lines[1].includes('266.9'));
});

test('text comparison ranks best first and shows the best', () => {
  const c = compareScenarios([
    SCENARIO,
    { ...SCENARIO, name: 'smaller cell', battery: { ...SCENARIO.battery, capacity_mAh: 2000 } },
  ]);
  const text = renderComparisonText(c);
  assert.ok(text.includes('Best: ESP32 + LoRa'));
  assert.ok(text.indexOf('ESP32 + LoRa') < text.indexOf('smaller cell'));
});
