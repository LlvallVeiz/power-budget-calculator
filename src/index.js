'use strict';

/**
 * index.js — public library entry point.
 *
 * The CLI (bin/pbc.js) is a thin shell over these modules; anything it can
 * do can also be done programmatically:
 *
 *   const { validateScenario, calculateBudget } = require('power-budget-calculator');
 *   const result = calculateBudget(validateScenario(scenario));
 */

const { validateProfile, analyzeProfile } = require('./loadProfile');
const {
  validateBattery,
  analyzeBattery,
  temperatureFactor,
  peukertCapacity,
  selfDischargeCurrent,
  CHEMISTRY_DEFAULTS,
} = require('./battery');
const {
  validateRegulator,
  batteryCurrent,
  powerLossMw,
  analyzeRegulator,
} = require('./regulator');
const { validateScenario, calculateBudget, requiredCapacity } = require('./calculator');
const { compareScenarios, buildVariants } = require('./compare');
const {
  renderText,
  renderJson,
  renderComparisonCsv,
  renderComparisonText,
} = require('./report');
const {
  BATTERY_PRESETS,
  NODE_PRESETS,
  REGULATOR_PRESETS,
  listPresets,
} = require('./presets');
const { ValidationError, CalculationError } = require('./errors');
const units = require('./units');

module.exports = {
  // errors
  ValidationError,
  CalculationError,
  // load profile
  validateProfile,
  analyzeProfile,
  // battery
  validateBattery,
  analyzeBattery,
  temperatureFactor,
  peukertCapacity,
  selfDischargeCurrent,
  CHEMISTRY_DEFAULTS,
  // regulator
  validateRegulator,
  batteryCurrent,
  powerLossMw,
  analyzeRegulator,
  // calculator
  validateScenario,
  calculateBudget,
  requiredCapacity,
  // compare
  compareScenarios,
  buildVariants,
  // reports
  renderText,
  renderJson,
  renderComparisonCsv,
  renderComparisonText,
  // presets
  BATTERY_PRESETS,
  NODE_PRESETS,
  REGULATOR_PRESETS,
  listPresets,
  // units
  units,
};
