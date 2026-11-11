'use strict';

/**
 * units.test.js — unit conversions and formatting.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HOURS_PER_MONTH,
  maToUa,
  mahToAh,
  formatLifetime,
  formatCurrent,
  formatEnergy,
  round,
} = require('../src/units');

test('month length is the mean Gregorian month', () => {
  // 365.25 / 12 * 24 = 730.5 h
  assert.equal(HOURS_PER_MONTH, 730.5);
});

test('maToUa and mahToAh convert correctly', () => {
  assert.equal(maToUa(0.05), 50);
  assert.equal(maToUa(2.5), 2500);
  assert.equal(mahToAh(3400), 3.4);
});

test('formatLifetime picks hours, days, then years', () => {
  assert.equal(formatLifetime(30), '30 hours');
  assert.equal(formatLifetime(266.9 * 24), '266.9 days');
  assert.equal(formatLifetime(872.5 * 24), '2.39 years');
  assert.equal(formatLifetime(-1), 'n/a');
});

test('formatCurrent switches to uA below 1 mA', () => {
  assert.equal(formatCurrent(0.0546), '54.6 uA');
  assert.equal(formatCurrent(22.06), '22.06 mA');
});

test('formatEnergy switches to Wh above 10 000 mWh', () => {
  assert.equal(formatEnergy(12580), '12.58 Wh');
  assert.equal(formatEnergy(500), '500 mWh');
});

test('round avoids -0', () => {
  assert.equal(round(-0.0001, 2), 0);
  assert.equal(Object.is(round(-0.0001, 2), -0), false);
  assert.equal(round(1.23456, 2), 1.23);
});
