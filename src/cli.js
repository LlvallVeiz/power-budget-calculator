'use strict';

/**
 * cli.js — command-line interface.
 *
 *   pbc calc <scenario.json> [--format text|json] [--out file]
 *   pbc compare <file.json>  [--format text|csv] [--out file]
 *   pbc report <scenario.json> [--format text|json] [--out file]
 *   pbc presets
 *
 * Input files:
 * - calc / report: a single scenario object, or { "scenario": {...} }.
 * - compare: either a JSON array of scenarios, or
 *   { "base": {...}, "variants": [{ "name", "overrides" }, ...] }.
 *
 * The CLI is a thin shell over the library modules: it reads JSON, calls
 * the calculation, and prints or writes the report. Exit code is 1 with
 * the error message on stderr for any validation or calculation failure.
 */

const fs = require('fs');
const { ValidationError, CalculationError } = require('./errors');
const { validateScenario, calculateBudget } = require('./calculator');
const { compareScenarios, buildVariants } = require('./compare');
const { renderText, renderJson, renderComparisonCsv, renderComparisonText } = require('./report');
const { listPresets } = require('./presets');

const USAGE = `power-budget-calculator — battery lifetime budgets for IoT sensor nodes

Usage:
  pbc calc <scenario.json> [--format text|json] [--out <file>]
  pbc compare <file.json>  [--format text|csv] [--out <file>]
  pbc report <scenario.json> [--format text|json] [--out <file>]
  pbc presets

calc / report take one scenario; compare takes an array of scenarios or
{ "base": <scenario>, "variants": [{ "name", "overrides" }] }.
See examples/ for ready-made scenario files.`;

/** Parse `--flag value` / `--flag=value` options from argv. */
function parseOptions(argv) {
  const options = { format: null, out: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format' || arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ValidationError(`option ${arg} needs a value`);
      }
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    } else if (arg.startsWith('--')) {
      throw new ValidationError(`unknown option "${arg}"`);
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

function readJsonFile(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    throw new ValidationError(`cannot read file "${path}": ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(`file "${path}" is not valid JSON: ${err.message}`);
  }
}

function loadScenario(path) {
  const data = readJsonFile(path);
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && data.scenario) {
    return data.scenario;
  }
  return data;
}

function loadComparison(path) {
  const data = readJsonFile(path);
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object' && data.base && data.variants) {
    return buildVariants(data.base, data.variants);
  }
  throw new ValidationError('compare file must be an array of scenarios or { "base", "variants" }');
}

function emit(text, outPath) {
  if (outPath) {
    fs.writeFileSync(outPath, `${text}\n`, 'utf8');
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function cmdCalc(file, options) {
  const format = options.format || 'text';
  if (!['text', 'json'].includes(format)) {
    throw new ValidationError('--format for calc must be "text" or "json"');
  }
  const result = calculateBudget(validateScenario(loadScenario(file)));
  emit(format === 'json' ? renderJson(result) : renderText(result), options.out);
  return result;
}

function cmdCompare(file, options) {
  const format = options.format || 'text';
  if (!['text', 'csv'].includes(format)) {
    throw new ValidationError('--format for compare must be "text" or "csv"');
  }
  const comparison = compareScenarios(loadComparison(file));
  emit(format === 'csv' ? renderComparisonCsv(comparison) : renderComparisonText(comparison), options.out);
  return comparison;
}

function cmdPresets() {
  const presets = listPresets();
  const lines = ['Built-in presets', ''];
  for (const [group, entries] of Object.entries(presets)) {
    lines.push(`${group}:`);
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`  ${key} — ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    lines.push('');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return presets;
}

/**
 * Run the CLI. Returns the computed result (for programmatic use / tests).
 *
 * @param {string[]} argv arguments after the program name
 * @returns {*} command result
 */
function run(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return null;
  }
  if (command === 'presets') {
    if (rest.length > 0) throw new ValidationError('presets takes no arguments');
    return cmdPresets();
  }
  const { options, positional } = parseOptions(rest);
  if (positional.length !== 1) {
    throw new ValidationError(`${command} needs exactly one input file`);
  }
  switch (command) {
    case 'calc':
    case 'report':
      return cmdCalc(positional[0], options);
    case 'compare':
      return cmdCompare(positional[0], options);
    default:
      throw new ValidationError(`unknown command "${command}" (expected calc, compare, report or presets)`);
  }
}

module.exports = { run, USAGE, parseOptions, loadScenario, loadComparison };
