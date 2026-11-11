'use strict';

/**
 * compare.js — side-by-side comparison of scenarios.
 *
 * Typical uses: the same node on different batteries (AA vs 18650 vs LiPo),
 * or the same battery with different TX intervals. Each scenario is run
 * through the full budget calculation, then ranked by lifetime and annotated
 * with the lifetime ratio against the best scenario.
 */

const { ValidationError } = require('./errors');
const { round } = require('./units');
const { validateScenario, calculateBudget } = require('./calculator');

/**
 * Compare a list of scenarios.
 *
 * @param {Array<object>} rawScenarios array of raw scenario objects
 * @returns {object} { scenarios: [budget results, ranked best first],
 *   best: name of the longest-lived scenario, summary rows }
 */
function compareScenarios(rawScenarios) {
  if (!Array.isArray(rawScenarios) || rawScenarios.length < 2) {
    throw new ValidationError('compare needs an array of at least 2 scenarios', 'scenarios');
  }
  const results = rawScenarios.map((raw) => calculateBudget(validateScenario(raw)));
  const ranked = [...results].sort((a, b) => b.lifetimeDays - a.lifetimeDays);
  const bestDays = ranked[0].lifetimeDays;
  const summary = ranked.map((r) => ({
    name: r.name,
    battery: r.battery.ratedCapacity_mAh,
    batteryVoltage_V: r.battery.nominalVoltage_V,
    avgDrain_mA: r.drain.total_mA,
    lifetimeDays: r.lifetimeDays,
    lifetimeVsBest: bestDays > 0 ? round(r.lifetimeDays / bestDays, 3) : 0,
    meetsTarget: r.meetsTarget,
    warnings: r.warnings.length,
  }));
  return {
    scenarios: ranked,
    best: ranked[0].name,
    bestLifetimeDays: round(bestDays, 1),
    summary,
  };
}

/**
 * Build comparison variants from one base scenario by overriding fields.
 * Handy for "same node, different battery" or "same node, different TX
 * interval" sweeps without duplicating the whole scenario file.
 *
 * Overrides use dotted paths, e.g. { "battery.capacity_mAh": 3400 } or
 * { "load.modes[2].duration_s": 2 }. Only the fields the caller names are
 * replaced; everything else is copied from the base.
 *
 * @param {object} base raw base scenario
 * @param {Array<{ name: string, overrides: object }>} variants
 * @returns {Array<object>} raw scenario objects ready for compareScenarios
 */
function buildVariants(base, variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new ValidationError('variants must be a non-empty array', 'variants');
  }
  return variants.map((v) => {
    if (typeof v.name !== 'string' || v.name.trim() === '') {
      throw new ValidationError('each variant needs a "name"', 'variants[].name');
    }
    if (v.overrides === null || typeof v.overrides !== 'object') {
      throw new ValidationError('each variant needs an "overrides" object', 'variants[].overrides');
    }
    const scenario = JSON.parse(JSON.stringify(base));
    scenario.name = v.name;
    for (const [path, value] of Object.entries(v.overrides)) {
      setPath(scenario, path, value);
    }
    return scenario;
  });
}

/** Set a value at a dotted path like "battery.capacity_mAh" or "load.modes[1].duration_s". */
function setPath(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cursor[key] === undefined) {
      throw new ValidationError(`override path "${path}" does not exist in the base scenario`, 'overrides');
    }
    cursor = cursor[key];
  }
  const last = parts[parts.length - 1];
  if (!(last in cursor)) {
    throw new ValidationError(`override path "${path}" does not exist in the base scenario`, 'overrides');
  }
  cursor[last] = value;
}

module.exports = { compareScenarios, buildVariants, setPath };
