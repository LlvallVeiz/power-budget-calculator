'use strict';

/**
 * cli.test.js — end-to-end CLI behaviour via child processes.
 * Uses the real example files, so these tests also guard the examples.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'pbc.js');

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('calc on the LoRa example prints 266.9 days', async () => {
  const { code, stdout } = await runCli(['calc', 'examples/esp32-lora-node.json']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('266.9 days'), stdout);
  assert.ok(stdout.includes('TARGET_NOT_MET'));
});

test('calc --format json returns parseable JSON with the same lifetime', async () => {
  const { code, stdout } = await runCli(['calc', 'examples/esp32-lora-node.json', '--format', 'json']);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.ok(Math.abs(parsed.lifetimeDays - 266.9) < 0.1);
});

test('compare on the battery comparison prints the best scenario first', async () => {
  const { code, stdout } = await runCli(['compare', 'examples/compare-batteries.json']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('Best: 18650 3400 mAh'));
});

test('compare --format csv prints a header plus one row per scenario', async () => {
  const { code, stdout } = await runCli(['compare', 'examples/compare-batteries.json', '--format', 'csv']);
  assert.equal(code, 0);
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 4); // header + 3 scenarios
  assert.ok(lines[0].startsWith('name,battery_mAh'));
});

test('calc --out writes the report to a file', async () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pbc-')), 'report.txt');
  const { code } = await runCli(['calc', 'examples/ble-beacon.json', '--out', tmp]);
  assert.equal(code, 0);
  const text = fs.readFileSync(tmp, 'utf8');
  assert.ok(text.includes('2.39 years')); // 872.5 days, formatted in years
});

test('presets lists batteries, nodes and regulators', async () => {
  const { code, stdout } = await runCli(['presets']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('18650-3400'));
  assert.ok(stdout.includes('esp32-lora-10min'));
  assert.ok(stdout.includes('ldo-ams1117'));
});

test('missing file and bad format exit non-zero with a message', async () => {
  const missing = await runCli(['calc', 'examples/nope.json']);
  assert.equal(missing.code, 1);
  assert.ok(missing.stderr.includes('cannot read file'));
  const badFormat = await runCli(['calc', 'examples/ble-beacon.json', '--format', 'yaml']);
  assert.equal(badFormat.code, 1);
  assert.ok(badFormat.stderr.includes('--format'));
});

test('unknown command and --help behave', async () => {
  const unknown = await runCli(['frob', 'examples/ble-beacon.json']);
  assert.equal(unknown.code, 1);
  assert.ok(unknown.stderr.includes('unknown command'));
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.ok(help.stdout.includes('Usage:'));
});
