'use strict';

/**
 * calculator.js — the power budget itself.
 *
 * Pipeline (all in mA / mAh / hours):
 *   1. Load profile  -> average + peak load current, per-mode charge shares.
 *   2. Regulator     -> load-side currents become battery-side currents.
 *   3. Battery       -> Peukert + temperature derating + usable fraction
 *                       give the usable capacity; self-discharge becomes an
 *                       equivalent extra drain current.
 *   4. Lifetime      -> usableCapacity / (avgBatteryCurrent + I_selfDischarge)
 *
 * The result also answers the design questions that matter in practice:
 * does the node meet its target lifetime, how much capacity would it need
 * to meet it, is the peak current inside the battery's continuous rating,
 * and where is the charge actually going (sleep vs. TX vs. self-discharge)?
 */

const { ValidationError, CalculationError } = require('./errors');
const { HOURS_PER_DAY, round } = require('./units');
const { validateProfile, analyzeProfile } = require('./loadProfile');
const { validateBattery, analyzeBattery } = require('./battery');
const { validateRegulator, analyzeRegulator, batteryCurrent } = require('./regulator');

/**
 * Validate a full scenario object.
 *
 * @param {object} raw scenario { name?, load, battery, regulator, temperature_C?, targetLifetimeDays? }
 * @returns {object} normalised scenario
 */
function validateScenario(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('scenario must be an object', 'scenario');
  }
  const temperature_C = raw.temperature_C === undefined ? 25 : raw.temperature_C;
  if (typeof temperature_C !== 'number' || !Number.isFinite(temperature_C)
    || temperature_C < -40 || temperature_C > 85) {
    throw new ValidationError('temperature_C must be between -40 and 85', 'temperature_C');
  }
  const targetLifetimeDays = raw.targetLifetimeDays === undefined ? null : raw.targetLifetimeDays;
  if (targetLifetimeDays !== null
    && (typeof targetLifetimeDays !== 'number' || !Number.isFinite(targetLifetimeDays) || targetLifetimeDays <= 0)) {
    throw new ValidationError('targetLifetimeDays must be a finite number > 0', 'targetLifetimeDays');
  }
  return {
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : 'unnamed scenario',
    load: validateProfile(raw.load),
    battery: validateBattery(raw.battery),
    regulator: validateRegulator(raw.regulator),
    temperature_C,
    targetLifetimeDays,
  };
}

/**
 * Run the full budget calculation for one scenario.
 *
 * @param {object} scenario validated scenario (see validateScenario)
 * @returns {object} complete budget: load analysis, regulator analysis,
 *   battery analysis, lifetime, drain breakdown and warnings
 */
function calculateBudget(scenario) {
  const load = analyzeProfile(scenario.load, scenario.regulator.outputVoltage_V || 3.3);
  const reg = analyzeRegulator(scenario.regulator, scenario.load);
  const avgBatteryCurrent = reg.averageBatteryCurrent_mA;
  const battery = analyzeBattery(scenario.battery, avgBatteryCurrent, scenario.temperature_C);

  const totalDrain_mA = avgBatteryCurrent + battery.selfDischargeCurrent_mA;
  if (totalDrain_mA <= 0) {
    throw new CalculationError('total drain current is zero — lifetime is unbounded, check the load profile');
  }
  const lifetimeHours = battery.usableCapacity_mAh / totalDrain_mA;
  const lifetimeDays = lifetimeHours / HOURS_PER_DAY;

  // Where does the charge go? (fractions of the total drain)
  const drain = {
    load_mA: round(avgBatteryCurrent, 6),
    selfDischarge_mA: battery.selfDischargeCurrent_mA,
    total_mA: round(totalDrain_mA, 6),
    loadShare: round(avgBatteryCurrent / totalDrain_mA, 4),
    selfDischargeShare: round(battery.selfDischargeCurrent_mA / totalDrain_mA, 4),
  };

  // Peak battery current (worst mode through the regulator).
  const peakBatteryCurrent = Math.max(
    ...scenario.load.modes.map((m) => batteryCurrent(scenario.regulator, m.current_mA)),
  );

  const warnings = buildWarnings(scenario, {
    lifetimeDays,
    totalDrain_mA,
    peakBatteryCurrent,
    drain,
    load,
    battery,
  });

  const target = scenario.targetLifetimeDays;
  const result = {
    name: scenario.name,
    load,
    regulator: reg,
    battery,
    drain,
    peakBatteryCurrent_mA: round(peakBatteryCurrent, 3),
    lifetimeHours: round(lifetimeHours, 1),
    lifetimeDays: round(lifetimeDays, 1),
    targetLifetimeDays: target,
    meetsTarget: target === null ? null : lifetimeDays >= target,
    warnings,
  };

  if (target !== null && lifetimeDays < target) {
    result.requiredCapacity_mAh = requiredCapacity(scenario, target);
  }
  return result;
}

/**
 * Warnings a designer should act on. Each warning has a stable code, a
 * severity, and a plain-language message.
 */
function buildWarnings(scenario, ctx) {
  const warnings = [];
  const { lifetimeDays, peakBatteryCurrent, drain, load } = ctx;

  if (scenario.targetLifetimeDays !== null && lifetimeDays < scenario.targetLifetimeDays) {
    warnings.push({
      code: 'TARGET_NOT_MET',
      severity: 'error',
      message: `Lifetime ${round(lifetimeDays, 1)} days is below the target of `
        + `${scenario.targetLifetimeDays} days — increase capacity, lengthen the sleep cycle, or cut TX current.`,
    });
  }
  if (drain.selfDischargeShare >= 0.5) {
    warnings.push({
      code: 'SELF_DISCHARGE_DOMINATES',
      severity: 'warning',
      message: `Self-discharge is ${round(drain.selfDischargeShare * 100, 1)}% of the total drain — `
        + 'a bigger battery barely helps; reduce the self-discharge rate (different chemistry) or accept the limit.',
    });
  }
  const maxI = scenario.battery.maxContinuousCurrent_mA;
  if (maxI !== null && peakBatteryCurrent > maxI) {
    warnings.push({
      code: 'PEAK_CURRENT_EXCEEDED',
      severity: 'error',
      message: `Peak battery current ${round(peakBatteryCurrent, 1)} mA exceeds the battery's `
        + `continuous rating of ${maxI} mA — the cell will sag or trip its protection circuit.`,
    });
  }
  const sleepMode = scenario.load.modes.find((m) => m.name.toLowerCase().includes('sleep'));
  if (sleepMode && scenario.regulator.type === 'ldo'
    && scenario.regulator.quiescentCurrent_mA > sleepMode.current_mA) {
    warnings.push({
      code: 'REGULATOR_IQ_DOMINATES_SLEEP',
      severity: 'warning',
      message: `Regulator quiescent current (${scenario.regulator.quiescentCurrent_mA} mA) exceeds the `
        + `sleep current (${sleepMode.current_mA} mA) — pick an ultra-low-Iq regulator or a load switch.`,
    });
  }
  if (load.dominantMode.toLowerCase().includes('tx') || load.dominantMode.toLowerCase().includes('transmit')) {
    warnings.push({
      code: 'TX_DOMINATES',
      severity: 'info',
      message: `Transmission dominates the energy budget (${load.dominantMode} mode) — `
        + 'lengthening the TX interval is the highest-leverage change.',
    });
  }
  if (scenario.temperature_C <= 0) {
    warnings.push({
      code: 'COLD_TEMPERATURE',
      severity: 'warning',
      message: `Operating at ${scenario.temperature_C} C derates capacity to `
        + `${round(ctx.battery.temperatureFactor * 100, 0)}% of the 25 C rating — check the cell datasheet curve; the estimate uses a conservative table.`,
    });
  }
  return warnings;
}

/**
 * Capacity (mAh) needed to reach a target lifetime, found by bisection.
 * Peukert, temperature and self-discharge all scale with capacity, so the
 * equation has no closed form — but lifetime is monotonically increasing
 * in capacity, so bisection converges. The returned capacity is verified
 * by re-running the budget with it (see tests).
 *
 * @param {object} scenario validated scenario
 * @param {number} targetDays target lifetime in days
 * @returns {number} required rated capacity in mAh (rounded up to whole mAh)
 */
function requiredCapacity(scenario, targetDays) {
  const targetHours = targetDays * HOURS_PER_DAY;
  const lifetimeFor = (capacity_mAh) => {
    const variant = {
      ...scenario,
      battery: { ...scenario.battery, capacity_mAh },
    };
    const reg = analyzeRegulator(variant.regulator, variant.load);
    const bat = analyzeBattery(variant.battery, reg.averageBatteryCurrent_mA, variant.temperature_C);
    const total = reg.averageBatteryCurrent_mA + bat.selfDischargeCurrent_mA;
    return total > 0 ? bat.usableCapacity_mAh / total : Infinity;
  };

  let lo = scenario.battery.capacity_mAh;
  let hi = lo * 2;
  while (lifetimeFor(hi) < targetHours && hi < 1e9) hi *= 2;
  if (lifetimeFor(hi) < targetHours) {
    throw new CalculationError('target lifetime is unreachable: self-discharge alone exceeds the budget');
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (lifetimeFor(mid) >= targetHours) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

module.exports = { validateScenario, calculateBudget, requiredCapacity, buildWarnings };
