'use strict';

/**
 * presets.js — ready-made batteries and node profiles.
 *
 * Every number here comes from the sources documented in docs/RESEARCH.md:
 * ESP32 sleep/active currents are Espressif datasheet figures, 18650
 * capacity and self-discharge are the usual 2500-3400 mAh / 1-3%/month
 * ranges, alkaline AA is ~2500 mAh at 1.5 V with ~0.25%/month. Presets are
 * starting points for a first estimate, not a substitute for measuring
 * your own board — a dev board with an AMS1117 regulator and a USB-UART
 * chip draws milliamps in deep sleep where the bare chip draws ~10 uA.
 */

const { CHEMISTRY_DEFAULTS } = require('./battery');

/** Common batteries, keyed by preset name. */
const BATTERY_PRESETS = {
  '18650-3400': {
    name: 'Panasonic NCR18650B 3400 mAh',
    chemistry: 'li-ion',
    capacity_mAh: 3400,
    nominalVoltage_V: 3.7,
    peukertExponent: 1.02,
    selfDischargePerMonth: 0.02,
    usableFraction: 0.9,
    maxContinuousCurrent_mA: 4900,
  },
  '18650-2600': {
    name: 'Generic 18650 2600 mAh',
    chemistry: 'li-ion',
    capacity_mAh: 2600,
    nominalVoltage_V: 3.7,
    peukertExponent: 1.02,
    selfDischargePerMonth: 0.02,
    usableFraction: 0.9,
    maxContinuousCurrent_mA: 2600,
  },
  'lipo-2000': {
    name: 'LiPo 2000 mAh single cell',
    chemistry: 'lipo',
    capacity_mAh: 2000,
    nominalVoltage_V: 3.7,
    peukertExponent: 1.02,
    selfDischargePerMonth: 0.02,
    usableFraction: 0.9,
    maxContinuousCurrent_mA: 2000,
  },
  'lipo-1000': {
    name: 'LiPo 1000 mAh single cell',
    chemistry: 'lipo',
    capacity_mAh: 1000,
    nominalVoltage_V: 3.7,
    peukertExponent: 1.02,
    selfDischargePerMonth: 0.02,
    usableFraction: 0.9,
    maxContinuousCurrent_mA: 1000,
  },
  'aa-alkaline-2s': {
    name: '2x AA alkaline in series (3 V)',
    chemistry: 'alkaline',
    capacity_mAh: 2500,
    cells: 2,
    series: true,
    nominalVoltage_V: 3.0,
    peukertExponent: 1.15,
    selfDischargePerMonth: 0.0025,
    usableFraction: 0.8,
    maxContinuousCurrent_mA: 500,
  },
  'aa-alkaline-3s': {
    name: '3x AA alkaline in series (4.5 V)',
    chemistry: 'alkaline',
    capacity_mAh: 2500,
    cells: 3,
    series: true,
    nominalVoltage_V: 4.5,
    peukertExponent: 1.15,
    selfDischargePerMonth: 0.0025,
    usableFraction: 0.8,
    maxContinuousCurrent_mA: 500,
  },
  'cr2032': {
    name: 'CR2032 coin cell 225 mAh',
    chemistry: 'li-ion',
    capacity_mAh: 225,
    nominalVoltage_V: 3.0,
    peukertExponent: 1.05,
    selfDischargePerMonth: 0.01,
    usableFraction: 0.9,
    maxContinuousCurrent_mA: 15,
  },
};

/** Common node load profiles, keyed by preset name. */
const NODE_PRESETS = {
  'esp32-lora-10min': {
    name: 'ESP32 + LoRa node, TX every 10 min',
    load: {
      cycle_s: 600,
      modes: [
        { name: 'sleep', current_mA: 0.05, duration_s: 597 },
        { name: 'sense', current_mA: 40, duration_s: 2 },
        { name: 'tx', current_mA: 120, duration_s: 1 },
      ],
    },
  },
  'ble-beacon-1s': {
    name: 'BLE beacon, advertising every 1 s',
    load: {
      cycle_s: 1,
      modes: [
        { name: 'sleep', current_mA: 0.01, duration_s: 0.995 },
        { name: 'tx', current_mA: 15, duration_s: 0.005 },
      ],
    },
  },
  'esp32cam-1min': {
    name: 'ESP32-CAM node, photo + Wi-Fi TX every 1 min',
    load: {
      cycle_s: 60,
      modes: [
        { name: 'sleep', current_mA: 0.2, duration_s: 55 },
        { name: 'capture-tx', current_mA: 250, duration_s: 5 },
      ],
    },
  },
};

/** Common regulators, keyed by preset name. */
const REGULATOR_PRESETS = {
  'buck-90': {
    name: 'Synchronous buck 3.7 V -> 3.3 V, 90% efficient',
    type: 'buck',
    inputVoltage_V: 3.7,
    outputVoltage_V: 3.3,
    efficiency: 0.9,
    quiescentCurrent_mA: 0.005,
  },
  'buck-85': {
    name: 'Synchronous buck 3.7 V -> 3.3 V, 85% efficient',
    type: 'buck',
    inputVoltage_V: 3.7,
    outputVoltage_V: 3.3,
    efficiency: 0.85,
    quiescentCurrent_mA: 0.01,
  },
  'ldo-45-33': {
    name: 'Ultra-low-Iq LDO 4.5 V -> 3.3 V',
    type: 'ldo',
    inputVoltage_V: 4.5,
    outputVoltage_V: 3.3,
    quiescentCurrent_mA: 0.002,
  },
  'ldo-ams1117': {
    name: 'AMS1117 LDO 5 V -> 3.3 V (typical dev board)',
    type: 'ldo',
    inputVoltage_V: 5,
    outputVoltage_V: 3.3,
    quiescentCurrent_mA: 5,
  },
  direct: { name: 'Direct battery connection', type: 'direct', quiescentCurrent_mA: 0 },
};

/** List all presets (for `pbc presets`). */
function listPresets() {
  return {
    batteries: Object.fromEntries(
      Object.entries(BATTERY_PRESETS).map(([k, v]) => [k, v.name]),
    ),
    nodes: Object.fromEntries(
      Object.entries(NODE_PRESETS).map(([k, v]) => [k, v.name]),
    ),
    regulators: Object.fromEntries(
      Object.entries(REGULATOR_PRESETS).map(([k, v]) => [k, v.name]),
    ),
    chemistries: Object.fromEntries(
      Object.entries(CHEMISTRY_DEFAULTS).map(([k, v]) => [k, v]),
    ),
  };
}

module.exports = { BATTERY_PRESETS, NODE_PRESETS, REGULATOR_PRESETS, listPresets };
