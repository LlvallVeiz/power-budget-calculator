'use strict';

/**
 * report.js — render a budget result as text, JSON or CSV.
 *
 * - text: a plain-language report a designer can paste into a design doc.
 * - json: the full result object, pretty-printed.
 * - csv:  one summary row per scenario (used by `compare` for spreadsheets).
 */

const { formatLifetime, formatCurrent, formatEnergy, round } = require('./units');

/** Render one budget result as a human-readable text report. */
function renderText(result) {
  const lines = [];
  const { load, regulator, battery, drain } = result;
  lines.push(`Power budget — ${result.name}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Lifetime: ${formatLifetime(result.lifetimeHours)}`);
  if (result.targetLifetimeDays !== null) {
    lines.push(`Target:   ${result.targetLifetimeDays} days — ${result.meetsTarget ? 'MET' : 'NOT MET'}`);
    if (!result.meetsTarget) {
      lines.push(`Capacity needed for target: ${result.requiredCapacity_mAh} mAh (currently ${battery.ratedCapacity_mAh} mAh)`);
    }
  }
  lines.push('');
  lines.push('Load profile (per cycle)');
  lines.push(`  cycle: ${load.cycle_s} s, ${load.cyclesPerDay} cycles/day`);
  lines.push(`  average current: ${formatCurrent(load.averageCurrent_mA)}  peak: ${formatCurrent(load.peakCurrent_mA)}`);
  lines.push(`  average power: ${round(load.averagePower_mW, 3)} mW  energy: ${formatEnergy(load.energyPerDay_mWh)}/day`);
  lines.push(`  dominant mode: ${load.dominantMode}`);
  for (const m of load.modes) {
    lines.push(`    - ${m.name}: ${formatCurrent(m.current_mA)} for ${m.duration_s} s `
      + `(${(m.dutyCycle * 100).toFixed(2)}% duty, ${(m.shareOfCharge * 100).toFixed(1)}% of charge)`);
  }
  lines.push('');
  lines.push(`Regulator — ${regulator.regulator}`);
  lines.push(`  type: ${regulator.type}, efficiency: ${(regulator.efficiency * 100).toFixed(1)}% `
    + `(effective ${(regulator.effectiveEfficiency * 100).toFixed(1)}%), Iq: ${formatCurrent(regulator.quiescentCurrent_mA)}`);
  lines.push(`  average battery-side current: ${formatCurrent(regulator.averageBatteryCurrent_mA)}`);
  lines.push(`  average loss: ${round(regulator.averageLoss_mW, 3)} mW`);
  lines.push('');
  lines.push('Battery');
  lines.push(`  rated: ${battery.ratedCapacity_mAh} mAh at ${battery.nominalVoltage_V} V (${formatEnergy(battery.energy_mWh)})`);
  lines.push(`  Peukert capacity: ${battery.peukertCapacity_mAh} mAh (n = ${battery.peukertExponent})`);
  lines.push(`  temperature: ${battery.temperature_C} C (factor ${battery.temperatureFactor})`);
  lines.push(`  usable capacity: ${battery.usableCapacity_mAh} mAh (${(battery.usableFraction * 100).toFixed(0)}% usable)`);
  lines.push(`  self-discharge: ${(battery.selfDischargePerMonth * 100).toFixed(2)}%/month = ${formatCurrent(battery.selfDischargeCurrent_mA)}`);
  lines.push('');
  lines.push('Drain breakdown');
  lines.push(`  load: ${formatCurrent(drain.load_mA)} (${(drain.loadShare * 100).toFixed(1)}%)`);
  lines.push(`  self-discharge: ${formatCurrent(drain.selfDischarge_mA)} (${(drain.selfDischargeShare * 100).toFixed(1)}%)`);
  lines.push(`  total: ${formatCurrent(drain.total_mA)}`);
  lines.push(`  peak battery current: ${formatCurrent(result.peakBatteryCurrent_mA)}`);
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const w of result.warnings) {
      lines.push(`  [${w.severity.toUpperCase()}] ${w.code}: ${w.message}`);
    }
  }
  return lines.join('\n');
}

/** Render one budget result (or a comparison) as JSON. */
function renderJson(result) {
  return JSON.stringify(result, null, 2);
}

const CSV_HEADER = 'name,battery_mAh,battery_V,avg_drain_mA,lifetime_days,meets_target,warnings';

/** Render a comparison result as a CSV summary table. */
function renderComparisonCsv(comparison) {
  const rows = comparison.summary.map((s) => [
    `"${s.name.replace(/"/g, '""')}"`,
    s.battery,
    s.batteryVoltage_V,
    s.avgDrain_mA,
    s.lifetimeDays,
    s.meetsTarget === null ? '' : s.meetsTarget,
    s.warnings,
  ].join(','));
  return [CSV_HEADER, ...rows].join('\n');
}

/** Render a comparison result as a text table. */
function renderComparisonText(comparison) {
  const lines = [];
  lines.push('Scenario comparison (ranked by lifetime)');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Best: ${comparison.best} — ${comparison.bestLifetimeDays} days`);
  lines.push('');
  const header = `${'Scenario'.padEnd(34)} ${'Battery'.padEnd(12)} ${'Drain'.padEnd(11)} ${'Lifetime'.padEnd(12)} ${'vs best'}`;
  lines.push(header);
  lines.push('-'.repeat(header.length));
  for (const s of comparison.summary) {
    lines.push(
      `${s.name.padEnd(34)} `
      + `${`${s.battery} mAh`.padEnd(12)} `
      + `${formatCurrent(s.avgDrain_mA).padEnd(11)} `
      + `${`${s.lifetimeDays} d`.padEnd(12)} `
      + `${(s.lifetimeVsBest * 100).toFixed(1)}%`,
    );
  }
  return lines.join('\n');
}

module.exports = { renderText, renderJson, renderComparisonCsv, renderComparisonText, CSV_HEADER };
