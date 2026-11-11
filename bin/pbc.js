#!/usr/bin/env node
'use strict';

/**
 * pbc — power-budget-calculator command line entry point.
 * All logic lives in src/cli.js; this file only wires up argv and the
 * exit code so the library stays testable without spawning processes.
 */

const { run } = require('../src/cli');

try {
  run(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`pbc: ${err.message}\n`);
  process.exit(1);
}
