'use strict';

/**
 * regulator.js — power-path models between battery and load.
 *
 * Three topologies are supported:
 *
 * - "direct": battery wired straight to the load (no regulator). Battery
 *   current equals load current; efficiency is 100% by definition. Only
 *   valid when the battery voltage already matches the load rail.
 *
 * - "ldo": linear low-dropout regulator. The pass element burns the voltage
 *   difference as heat, so efficiency is approximately Vout / Vin and the
 *   battery current is the load current plus the regulator's own quiescent
 *   current:
 *       I_bat = I_load + Iq ;  eta ~= Vout / Vin
 *   LDOs win when Vin is close to Vout and the node sleeps most of the
 *   time — a modern ultra-low-Iq LDO can idle at ~1 uA, while an old
 *   AMS1117 burns ~5 mA just existing (see docs/RESEARCH.md).
 *
 * - "buck": synchronous switching step-down converter. Power is (nearly)
 *   conserved, so the battery current is set by the power balance:
 *       I_bat = (Vout * I_load) / (Vin * eta) + Iq
 *   Bucks win when Vin >> Vout or the load current is large, but their
 *   efficiency collapses at very light load unless the part is designed
 *   for it — hence the per-regulator efficiency and Iq parameters instead
 *   of a single magic number.
 *
 * All currents are converted mode by mode: the regulator sees the sleep
 * current and the TX peak separately, which matters because a buck's
 * efficiency (and therefore the battery current) depends on the load.
 * A single fixed efficiency is used here as a deliberate simplification;
 * see README "Limitations" for the load-dependent efficiency curve that a
 * future version should add.
 */

const { ValidationError } = require('./errors');
const { round } = require('./units');

/** Regulator types and the fields each one needs. */
const REGULATOR_TYPES = ['direct', 'ldo', 'buck'];

/**
 * Validate and normalise a regulator description.
 *
 * @param {object} raw regulator description
 * @returns {object} normalised regulator
 */
function validateRegulator(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('regulator must be an object', 'regulator');
  }
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  if (!REGULATOR_TYPES.includes(type)) {
    throw new ValidationError(
      `unknown regulator type "${raw.type}" (known: ${REGULATOR_TYPES.join(', ')})`,
      'regulator.type',
    );
  }
  const quiescentCurrent_mA = raw.quiescentCurrent_mA === undefined ? 0 : raw.quiescentCurrent_mA;
  if (typeof quiescentCurrent_mA !== 'number' || !Number.isFinite(quiescentCurrent_mA) || quiescentCurrent_mA < 0) {
    throw new ValidationError('quiescentCurrent_mA must be a finite number >= 0', 'regulator.quiescentCurrent_mA');
  }

  if (type === 'direct') {
    return {
      type,
      name: typeof raw.name === 'string' ? raw.name : 'direct (no regulator)',
      quiescentCurrent_mA,
      inputVoltage_V: null,
      outputVoltage_V: null,
      efficiency: 1,
    };
  }

  const inputVoltage_V = raw.inputVoltage_V;
  const outputVoltage_V = raw.outputVoltage_V;
  if (typeof inputVoltage_V !== 'number' || !Number.isFinite(inputVoltage_V) || inputVoltage_V <= 0) {
    throw new ValidationError('inputVoltage_V must be a finite number > 0', 'regulator.inputVoltage_V');
  }
  if (typeof outputVoltage_V !== 'number' || !Number.isFinite(outputVoltage_V) || outputVoltage_V <= 0) {
    throw new ValidationError('outputVoltage_V must be a finite number > 0', 'regulator.outputVoltage_V');
  }
  if (type === 'ldo' && inputVoltage_V < outputVoltage_V) {
    throw new ValidationError('LDO input voltage must be >= output voltage', 'regulator.inputVoltage_V');
  }
  if (type === 'buck' && inputVoltage_V <= outputVoltage_V) {
    throw new ValidationError('buck input voltage must be > output voltage', 'regulator.inputVoltage_V');
  }

  let efficiency = raw.efficiency;
  if (type === 'ldo') {
    // LDO efficiency is set by the voltage ratio; an explicit value may
    // only make it worse (extra losses), never better.
    const ideal = outputVoltage_V / inputVoltage_V;
    efficiency = efficiency === undefined ? ideal : efficiency;
    if (typeof efficiency !== 'number' || !Number.isFinite(efficiency) || efficiency <= 0 || efficiency > ideal + 1e-9) {
      throw new ValidationError(`LDO efficiency must be in (0, ${round(ideal, 4)}]`, 'regulator.efficiency');
    }
  } else {
    efficiency = efficiency === undefined ? 0.9 : efficiency;
    if (typeof efficiency !== 'number' || !Number.isFinite(efficiency) || efficiency <= 0 || efficiency >= 1) {
      throw new ValidationError('buck efficiency must be in (0, 1)', 'regulator.efficiency');
    }
  }

  return {
    type,
    name: typeof raw.name === 'string'
      ? raw.name
      : `${type} ${inputVoltage_V}V -> ${outputVoltage_V}V`,
    quiescentCurrent_mA,
    inputVoltage_V,
    outputVoltage_V,
    efficiency,
  };
}

/**
 * Convert one load-side current into the current drawn from the battery.
 *
 * @param {object} regulator validated regulator
 * @param {number} loadCurrent_mA current the load draws, in mA
 * @returns {number} current drawn from the battery, in mA
 */
function batteryCurrent(regulator, loadCurrent_mA) {
  if (typeof loadCurrent_mA !== 'number' || !Number.isFinite(loadCurrent_mA) || loadCurrent_mA < 0) {
    throw new ValidationError('loadCurrent_mA must be a finite number >= 0', 'loadCurrent_mA');
  }
  switch (regulator.type) {
    case 'direct':
      return loadCurrent_mA + regulator.quiescentCurrent_mA;
    case 'ldo':
      return loadCurrent_mA + regulator.quiescentCurrent_mA;
    case 'buck': {
      const { inputVoltage_V: vin, outputVoltage_V: vout, efficiency: eta } = regulator;
      return (vout * loadCurrent_mA) / (vin * eta) + regulator.quiescentCurrent_mA;
    }
    default:
      throw new ValidationError(`unknown regulator type "${regulator.type}"`, 'regulator.type');
  }
}

/**
 * Power lost in the regulator for one load current (mW).
 * LDO: (Vin - Vout) * I_load + Vin * Iq.  Buck: P_in - P_out.
 */
function powerLossMw(regulator, loadCurrent_mA) {
  if (regulator.type === 'direct') return 0;
  const iBat = batteryCurrent(regulator, loadCurrent_mA);
  const pIn = iBat * regulator.inputVoltage_V;
  const pOut = loadCurrent_mA * regulator.outputVoltage_V;
  return Math.max(0, pIn - pOut);
}

/**
 * Convert a whole load profile to battery-side currents, mode by mode.
 *
 * @param {object} regulator validated regulator
 * @param {object} profile validated load profile
 * @returns {object} per-mode battery currents, average battery current,
 *   average loss, and the regulator's effective efficiency at the average load
 */
function analyzeRegulator(regulator, profile) {
  const modes = profile.modes.map((m) => {
    const iBat = batteryCurrent(regulator, m.current_mA);
    return {
      name: m.name,
      loadCurrent_mA: m.current_mA,
      batteryCurrent_mA: round(iBat, 6),
      duration_s: m.duration_s,
      loss_mW: round(powerLossMw(regulator, m.current_mA), 4),
    };
  });
  const avgBatteryCurrent = modes.reduce((sum, m) => sum + m.batteryCurrent_mA * m.duration_s, 0)
    / profile.cycle_s;
  const avgLoss = modes.reduce((sum, m) => sum + m.loss_mW * m.duration_s, 0) / profile.cycle_s;
  const avgLoadCurrent = profile.modes.reduce((sum, m) => sum + m.current_mA * m.duration_s, 0)
    / profile.cycle_s;

  let effectiveEfficiency = 1;
  if (regulator.type !== 'direct' && avgBatteryCurrent > 0) {
    const pOut = avgLoadCurrent * regulator.outputVoltage_V;
    const pIn = avgBatteryCurrent * regulator.inputVoltage_V;
    effectiveEfficiency = pIn > 0 ? pOut / pIn : 1;
  }

  return {
    regulator: regulator.name,
    type: regulator.type,
    efficiency: round(regulator.efficiency, 4),
    quiescentCurrent_mA: regulator.quiescentCurrent_mA,
    averageBatteryCurrent_mA: round(avgBatteryCurrent, 6),
    averageLoss_mW: round(avgLoss, 4),
    effectiveEfficiency: round(effectiveEfficiency, 4),
    modes,
  };
}

module.exports = { REGULATOR_TYPES, validateRegulator, batteryCurrent, powerLossMw, analyzeRegulator };
