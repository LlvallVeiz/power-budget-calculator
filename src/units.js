'use strict';

/**
 * units.js — unit conversions and human-friendly formatting.
 *
 * Canonical internal units (kept consistent across every module):
 *   current     milliamperes (mA)
 *   capacity    milliampere-hours (mAh)
 *   voltage     volts (V)
 *   power       milliwatts (mW)
 *   energy      milliwatt-hours (mWh)
 *   time        hours for lifetimes, seconds inside a load-profile cycle
 *
 * Hours in a month use the mean Gregorian month (365.25 / 12 days), which is
 * what self-discharge rates ("per month") are converted against.
 */

const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365.25;
const HOURS_PER_MONTH = (DAYS_PER_YEAR / 12) * HOURS_PER_DAY; // 730.5 h

/** mA -> uA. */
function maToUa(ma) {
  return ma * 1000;
}

/** mAh -> Ah. */
function mahToAh(mah) {
  return mah / 1000;
}

/** mW -> W. */
function mwToW(mw) {
  return mw / 1000;
}

/** Energy (mWh) from average power (mW) over a duration in hours. */
function energyMwh(powerMw, hours) {
  return powerMw * hours;
}

/**
 * Format a lifetime in hours as a human-readable string, picking the most
 * sensible unit (hours / days / years) automatically.
 *
 * @param {number} hours lifetime in hours
 * @returns {string} e.g. "81.4 hours", "266.9 days", "2.39 years"
 */
function formatLifetime(hours) {
  if (!Number.isFinite(hours) || hours < 0) return 'n/a';
  if (hours < 48) return `${round(hours, 1)} hours`;
  const days = hours / HOURS_PER_DAY;
  if (days < 730) return `${round(days, 1)} days`;
  return `${round(days / DAYS_PER_YEAR, 2)} years`;
}

/**
 * Format a current, choosing mA or uA depending on magnitude.
 *
 * @param {number} ma current in milliamperes
 * @returns {string} e.g. "0.385 mA" or "54.6 uA"
 */
function formatCurrent(ma) {
  if (!Number.isFinite(ma)) return 'n/a';
  if (Math.abs(ma) < 1) return `${round(maToUa(ma), 1)} uA`;
  return `${round(ma, 3)} mA`;
}

/** Format an energy value in mWh (switches to Wh above 10 000 mWh). */
function formatEnergy(mwh) {
  if (!Number.isFinite(mwh)) return 'n/a';
  if (Math.abs(mwh) >= 10000) return `${round(mwToW(mwh), 2)} Wh`;
  return `${round(mwh, 1)} mWh`;
}

/**
 * Round to a fixed number of decimals, returning a number (not a string).
 * Guards against -0 and non-finite input.
 */
function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

module.exports = {
  HOURS_PER_DAY,
  DAYS_PER_YEAR,
  HOURS_PER_MONTH,
  maToUa,
  mahToAh,
  mwToW,
  energyMwh,
  formatLifetime,
  formatCurrent,
  formatEnergy,
  round,
};
