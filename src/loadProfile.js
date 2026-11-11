'use strict';

/**
 * loadProfile.js — multi-mode load profile of a sensor node.
 *
 * A node does not draw one steady current. It sleeps most of the time,
 * wakes to sense, and occasionally transmits — each mode with its own
 * current and duration. A profile is a list of modes that repeat every
 * `cycle_s` seconds:
 *
 *   { cycle_s: 600,
 *     modes: [
 *       { name: "sleep", current_mA: 0.05, duration_s: 597 },
 *       { name: "sense", current_mA: 40,   duration_s: 2 },
 *       { name: "tx",    current_mA: 120,  duration_s: 1 },
 *     ] }
 *
 * From the profile we derive the average load current, the duty cycle of
 * each mode, the average power at a given rail voltage, and the energy
 * consumed per cycle and per day. The regulator module later converts these
 * load-side currents into battery-side currents mode by mode.
 */

const { ValidationError } = require('./errors');
const { round } = require('./units');

/**
 * Validate a single mode object.
 *
 * @param {object} mode raw mode object
 * @param {number} index position in the modes array (for error messages)
 * @returns {{ name: string, current_mA: number, duration_s: number }}
 */
function validateMode(mode, index) {
  const where = `load.modes[${index}]`;
  if (mode === null || typeof mode !== 'object' || Array.isArray(mode)) {
    throw new ValidationError('mode must be an object', where);
  }
  if (typeof mode.name !== 'string' || mode.name.trim() === '') {
    throw new ValidationError('mode needs a non-empty "name"', `${where}.name`);
  }
  if (typeof mode.current_mA !== 'number' || !Number.isFinite(mode.current_mA) || mode.current_mA < 0) {
    throw new ValidationError('current_mA must be a finite number >= 0', `${where}.current_mA`);
  }
  if (typeof mode.duration_s !== 'number' || !Number.isFinite(mode.duration_s) || mode.duration_s <= 0) {
    throw new ValidationError('duration_s must be a finite number > 0', `${where}.duration_s`);
  }
  return { name: mode.name, current_mA: mode.current_mA, duration_s: mode.duration_s };
}

/**
 * Validate and normalise a load profile.
 *
 * @param {object} raw { cycle_s, modes: [...] }
 * @returns {{ cycle_s: number, modes: Array }} validated copy
 * @throws {ValidationError} on missing fields, empty modes, or durations
 *   that do not add up to the cycle length (within 1 ms of rounding slack)
 */
function validateProfile(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('load profile must be an object', 'load');
  }
  if (typeof raw.cycle_s !== 'number' || !Number.isFinite(raw.cycle_s) || raw.cycle_s <= 0) {
    throw new ValidationError('cycle_s must be a finite number > 0', 'load.cycle_s');
  }
  if (!Array.isArray(raw.modes) || raw.modes.length === 0) {
    throw new ValidationError('modes must be a non-empty array', 'load.modes');
  }
  const modes = raw.modes.map((m, i) => validateMode(m, i));
  const total = modes.reduce((sum, m) => sum + m.duration_s, 0);
  if (Math.abs(total - raw.cycle_s) > 0.001) {
    throw new ValidationError(
      `mode durations add up to ${total} s but cycle_s is ${raw.cycle_s} s`,
      'load.cycle_s',
    );
  }
  return { cycle_s: raw.cycle_s, modes };
}

/**
 * Average load current over one cycle (mA).
 * I_avg = sum(I_mode * t_mode) / T_cycle
 */
function averageCurrent(profile) {
  const charge = profile.modes.reduce((sum, m) => sum + m.current_mA * m.duration_s, 0);
  return charge / profile.cycle_s;
}

/** Peak (largest) mode current in the profile (mA). */
function peakCurrent(profile) {
  return Math.max(...profile.modes.map((m) => m.current_mA));
}

/**
 * Duty cycle of each mode as a fraction of the cycle (0..1), plus the
 * charge each mode consumes per cycle (mA*s, i.e. millicoulombs / 3.6 = uAh).
 */
function modeBreakdown(profile) {
  return profile.modes.map((m) => ({
    name: m.name,
    current_mA: m.current_mA,
    duration_s: m.duration_s,
    dutyCycle: round(m.duration_s / profile.cycle_s, 6),
    charge_uAh: round((m.current_mA * m.duration_s) / 3.6, 4),
    shareOfCharge: 0, // filled in below
  }));
}

/**
 * Full analysis of a load profile at a given load-rail voltage.
 *
 * @param {object} profile validated profile (see validateProfile)
 * @param {number} voltage_V rail voltage the load runs at (default 3.3 V)
 * @returns {object} averages, per-mode breakdown with charge shares,
 *   energy per cycle / per day, and cycles per day
 */
function analyzeProfile(profile, voltage_V = 3.3) {
  if (typeof voltage_V !== 'number' || !Number.isFinite(voltage_V) || voltage_V <= 0) {
    throw new ValidationError('voltage_V must be a finite number > 0', 'voltage_V');
  }
  const avgCurrent = averageCurrent(profile);
  const peak = peakCurrent(profile);
  const breakdown = modeBreakdown(profile);
  const totalCharge_uAh = breakdown.reduce((sum, b) => sum + b.charge_uAh, 0);
  for (const b of breakdown) {
    b.shareOfCharge = totalCharge_uAh > 0 ? round(b.charge_uAh / totalCharge_uAh, 4) : 0;
  }
  const cyclesPerDay = 86400 / profile.cycle_s;
  const avgPowerMw = avgCurrent * voltage_V;
  const energyPerCycleMwh = (avgPowerMw * profile.cycle_s) / 3600;
  const energyPerDayMwh = avgPowerMw * 24;
  // Dominant mode = the one eating the largest share of charge per cycle.
  const dominant = breakdown.reduce((a, b) => (b.charge_uAh > a.charge_uAh ? b : a));

  return {
    cycle_s: profile.cycle_s,
    averageCurrent_mA: round(avgCurrent, 6),
    peakCurrent_mA: peak,
    averagePower_mW: round(avgPowerMw, 4),
    energyPerCycle_mWh: round(energyPerCycleMwh, 4),
    energyPerDay_mWh: round(energyPerDayMwh, 2),
    cyclesPerDay: round(cyclesPerDay, 2),
    dominantMode: dominant.name,
    modes: breakdown,
  };
}

module.exports = { validateProfile, validateMode, averageCurrent, peakCurrent, analyzeProfile };
