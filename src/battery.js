'use strict';

/**
 * battery.js — battery model for lifetime estimation.
 *
 * A battery is described by its rated capacity, nominal voltage, chemistry,
 * Peukert exponent, self-discharge rate and the share of its capacity that
 * the design is willing to use (usable fraction — the rest is reserve for
 * voltage sag, cutoff headroom and ageing).
 *
 * Three corrections turn the nameplate capacity into a usable capacity:
 *
 * 1. Peukert — usable capacity falls as the discharge current rises:
 *      C_eff = C_rated * (I_rated / I)^(n - 1)
 *    with I_rated = C_rated / ratedHours (ratedHours defaults to 20 h, the
 *    standard 0.05C rating used for alkaline and lead-acid cells). The
 *    correction is CAPPED at the rated capacity: the classical Peukert law
 *    predicts infinite capacity as I -> 0, which is unphysical, and it is
 *    known to fail at very small currents (Galushkin et al., J. Electrochem.
 *    Soc. 167, 120516, 2020). Lithium-ion cells have n ~ 1.0-1.05, so the
 *    correction is small for them and large for lead-acid (n ~ 1.1-1.3).
 *
 * 2. Temperature derating — capacity falls in the cold. The default table
 *    is a conservative interpolation of published Li-ion behaviour
 *    (~85% at 0 C, ~50-60% at -20 C; see docs/RESEARCH.md). The table is
 *    chemistry-agnostic on purpose: it is a derating *estimate*, and any
 *    cell used in a real design should be checked against its own
 *    datasheet curve. Outside -20..45 C the end values are held constant.
 *
 * 3. Self-discharge — modelled as an equivalent constant current
 *    I_sd = C_rated * ratePerMonth / hoursPerMonth, added to the load
 *    current. For multi-year nodes this term, not the sleep current, is
 *    often what sets the lifetime limit.
 */

const { ValidationError } = require('./errors');
const { HOURS_PER_MONTH, round } = require('./units');

/** Default temperature derating table: [temperature_C, capacity fraction]. */
const DEFAULT_TEMP_TABLE = [
  [-20, 0.55],
  [-10, 0.7],
  [0, 0.85],
  [10, 0.93],
  [25, 1.0],
  [45, 1.02],
];

/** Known chemistries with conservative default parameters (see RESEARCH.md). */
const CHEMISTRY_DEFAULTS = {
  'li-ion': { peukertExponent: 1.02, selfDischargePerMonth: 0.02, nominalVoltage_V: 3.7 },
  lipo: { peukertExponent: 1.02, selfDischargePerMonth: 0.02, nominalVoltage_V: 3.7 },
  lifepo4: { peukertExponent: 1.03, selfDischargePerMonth: 0.02, nominalVoltage_V: 3.2 },
  alkaline: { peukertExponent: 1.15, selfDischargePerMonth: 0.0025, nominalVoltage_V: 1.5 },
  nimh: { peukertExponent: 1.08, selfDischargePerMonth: 0.02, nominalVoltage_V: 1.2 },
  'lead-acid': { peukertExponent: 1.2, selfDischargePerMonth: 0.04, nominalVoltage_V: 12 },
};

/**
 * Validate and normalise a battery description, filling chemistry defaults
 * for any field the user leaves out.
 *
 * @param {object} raw battery description
 * @returns {object} normalised battery
 */
function validateBattery(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('battery must be an object', 'battery');
  }
  const chemistry = typeof raw.chemistry === 'string' ? raw.chemistry.toLowerCase() : '';
  if (!CHEMISTRY_DEFAULTS[chemistry]) {
    throw new ValidationError(
      `unknown chemistry "${raw.chemistry}" (known: ${Object.keys(CHEMISTRY_DEFAULTS).join(', ')})`,
      'battery.chemistry',
    );
  }
  const defaults = CHEMISTRY_DEFAULTS[chemistry];

  const capacity_mAh = raw.capacity_mAh;
  if (typeof capacity_mAh !== 'number' || !Number.isFinite(capacity_mAh) || capacity_mAh <= 0) {
    throw new ValidationError('capacity_mAh must be a finite number > 0', 'battery.capacity_mAh');
  }
  const cells = raw.cells === undefined ? 1 : raw.cells;
  if (!Number.isInteger(cells) || cells < 1) {
    throw new ValidationError('cells must be an integer >= 1', 'battery.cells');
  }
  const series = raw.series === undefined ? true : raw.series;
  if (typeof series !== 'boolean') {
    throw new ValidationError('series must be a boolean', 'battery.series');
  }
  const nominalVoltage_V = raw.nominalVoltage_V === undefined
    ? defaults.nominalVoltage_V * (series ? cells : 1)
    : raw.nominalVoltage_V;
  if (typeof nominalVoltage_V !== 'number' || !Number.isFinite(nominalVoltage_V) || nominalVoltage_V <= 0) {
    throw new ValidationError('nominalVoltage_V must be a finite number > 0', 'battery.nominalVoltage_V');
  }
  const totalCapacity_mAh = series ? capacity_mAh : capacity_mAh * cells;

  const peukertExponent = raw.peukertExponent === undefined ? defaults.peukertExponent : raw.peukertExponent;
  if (typeof peukertExponent !== 'number' || !Number.isFinite(peukertExponent) || peukertExponent < 1 || peukertExponent > 1.6) {
    throw new ValidationError('peukertExponent must be between 1 and 1.6', 'battery.peukertExponent');
  }
  const selfDischargePerMonth = raw.selfDischargePerMonth === undefined
    ? defaults.selfDischargePerMonth
    : raw.selfDischargePerMonth;
  if (typeof selfDischargePerMonth !== 'number' || !Number.isFinite(selfDischargePerMonth)
    || selfDischargePerMonth < 0 || selfDischargePerMonth >= 1) {
    throw new ValidationError('selfDischargePerMonth must be a fraction in [0, 1)', 'battery.selfDischargePerMonth');
  }
  const usableFraction = raw.usableFraction === undefined ? 0.9 : raw.usableFraction;
  if (typeof usableFraction !== 'number' || !Number.isFinite(usableFraction)
    || usableFraction <= 0 || usableFraction > 1) {
    throw new ValidationError('usableFraction must be in (0, 1]', 'battery.usableFraction');
  }
  const ratedHours = raw.ratedHours === undefined ? 20 : raw.ratedHours;
  if (typeof ratedHours !== 'number' || !Number.isFinite(ratedHours) || ratedHours <= 0) {
    throw new ValidationError('ratedHours must be a finite number > 0', 'battery.ratedHours');
  }
  const maxContinuousCurrent_mA = raw.maxContinuousCurrent_mA === undefined
    ? null
    : raw.maxContinuousCurrent_mA;
  if (maxContinuousCurrent_mA !== null
    && (typeof maxContinuousCurrent_mA !== 'number' || !Number.isFinite(maxContinuousCurrent_mA) || maxContinuousCurrent_mA <= 0)) {
    throw new ValidationError('maxContinuousCurrent_mA must be a finite number > 0', 'battery.maxContinuousCurrent_mA');
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : `${chemistry} ${totalCapacity_mAh} mAh`,
    chemistry,
    capacity_mAh: totalCapacity_mAh,
    cellCapacity_mAh: capacity_mAh,
    cells,
    series,
    nominalVoltage_V,
    peukertExponent,
    selfDischargePerMonth,
    usableFraction,
    ratedHours,
    maxContinuousCurrent_mA,
  };
}

/**
 * Linear interpolation of the temperature derating table.
 *
 * @param {number} temp_C operating temperature in degrees Celsius
 * @param {Array<Array<number>>} [table] optional custom [temp, factor] table
 * @returns {number} capacity factor (fraction of the 25 C capacity)
 */
function temperatureFactor(temp_C, table = DEFAULT_TEMP_TABLE) {
  if (typeof temp_C !== 'number' || !Number.isFinite(temp_C)) {
    throw new ValidationError('temperature must be a finite number', 'temperature_C');
  }
  const sorted = [...table].sort((a, b) => a[0] - b[0]);
  if (temp_C <= sorted[0][0]) return sorted[0][1];
  if (temp_C >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const [t0, f0] = sorted[i];
    const [t1, f1] = sorted[i + 1];
    if (temp_C >= t0 && temp_C <= t1) {
      return f0 + ((f1 - f0) * (temp_C - t0)) / (t1 - t0);
    }
  }
  return 1;
}

/**
 * Peukert-corrected capacity at a given average discharge current.
 * Capped at the rated capacity (see module header for why).
 *
 * @param {object} battery validated battery
 * @param {number} avgCurrent_mA average discharge current in mA
 * @returns {number} effective capacity in mAh
 */
function peukertCapacity(battery, avgCurrent_mA) {
  if (typeof avgCurrent_mA !== 'number' || !Number.isFinite(avgCurrent_mA) || avgCurrent_mA < 0) {
    throw new ValidationError('avgCurrent_mA must be a finite number >= 0', 'avgCurrent_mA');
  }
  if (avgCurrent_mA === 0) return battery.capacity_mAh;
  const ratedCurrent = battery.capacity_mAh / battery.ratedHours;
  const factor = (ratedCurrent / avgCurrent_mA) ** (battery.peukertExponent - 1);
  return Math.min(battery.capacity_mAh, battery.capacity_mAh * factor);
}

/**
 * Equivalent self-discharge current (mA) for a battery of the given capacity.
 * I_sd = C * ratePerMonth / hoursPerMonth.
 */
function selfDischargeCurrent(capacity_mAh, ratePerMonth) {
  return (capacity_mAh * ratePerMonth) / HOURS_PER_MONTH;
}

/**
 * Full battery analysis at a given average load current and temperature.
 *
 * @param {object} battery validated battery
 * @param {number} avgCurrent_mA average battery-side current in mA
 * @param {number} temp_C operating temperature (default 25)
 * @returns {object} Peukert capacity, temperature factor, usable capacity,
 *   self-discharge current, total drain and energy content
 */
function analyzeBattery(battery, avgCurrent_mA, temp_C = 25) {
  const tempFactor = temperatureFactor(temp_C);
  const peukert_mAh = peukertCapacity(battery, avgCurrent_mA);
  const derated_mAh = peukert_mAh * tempFactor;
  const usable_mAh = derated_mAh * battery.usableFraction;
  const sdCurrent_mA = selfDischargeCurrent(battery.capacity_mAh, battery.selfDischargePerMonth);
  const energy_mWh = battery.capacity_mAh * battery.nominalVoltage_V;

  return {
    ratedCapacity_mAh: battery.capacity_mAh,
    nominalVoltage_V: battery.nominalVoltage_V,
    energy_mWh: round(energy_mWh, 1),
    temperature_C: temp_C,
    temperatureFactor: round(tempFactor, 4),
    peukertCapacity_mAh: round(peukert_mAh, 1),
    deratedCapacity_mAh: round(derated_mAh, 1),
    usableCapacity_mAh: round(usable_mAh, 1),
    selfDischargeCurrent_mA: round(sdCurrent_mA, 6),
    selfDischargePerMonth: battery.selfDischargePerMonth,
    peukertExponent: battery.peukertExponent,
    usableFraction: battery.usableFraction,
  };
}

module.exports = {
  DEFAULT_TEMP_TABLE,
  CHEMISTRY_DEFAULTS,
  validateBattery,
  temperatureFactor,
  peukertCapacity,
  selfDischargeCurrent,
  analyzeBattery,
};
