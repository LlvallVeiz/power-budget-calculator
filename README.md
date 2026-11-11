# power-budget-calculator

A power budget and battery lifetime calculator for IoT / embedded sensor
nodes — JavaScript (Node.js), zero runtime dependencies.

A sensor node is not a steady load: it sleeps for minutes, wakes to sense
for seconds, and transmits in short, high-current bursts. This tool turns
that duty-cycled behaviour into a battery lifetime estimate, honestly:
multi-mode load profiles, Peukert-corrected battery capacity, self-discharge
as an equivalent drain current, temperature derating, and LDO / buck
regulator losses — with warnings when the design misses its target, the
peak current exceeds the cell rating, or the regulator's own quiescent
current eats the sleep budget.

## Background

The lifetime of a battery-powered node is decided by four things:

1. **Duty cycle** — average current is the charge-weighted mean over one
   cycle: `I_avg = sum(I_mode * t_mode) / T_cycle`. A node sleeping at
   50 uA but transmitting at 120 mA for 1 s every 10 minutes averages
   0.383 mA, and the TX burst alone is 52% of the charge per cycle.
2. **Peukert's law** — usable capacity falls as discharge current rises:
   `C_eff = C_rated * (I_rated / I)^(n-1)`, with n ≈ 1.02 for Li-ion and
   1.1–1.3 for lead-acid. The correction is capped at the rated capacity:
   the classical law predicts infinite capacity at tiny currents, which
   is unphysical (Galushkin et al., 2020).
3. **Self-discharge** — modelled as an equivalent current,
   `I_sd = C * ratePerMonth / 730.5 h`. A 3400 mAh Li-ion at 2 %/month
   self-discharges at 93 uA — 19.5% of the example node's total drain.
4. **Regulator** — an LDO wastes `(Vin - Vout)` as heat (`eta ≈ Vout/Vin`)
   and adds its quiescent current to the battery drain; a buck conserves
   power (`I_bat = Vout*I_load / (Vin*eta) + Iq`). The AMS1117 on most
   dev boards burns ~5 mA just existing — 500x the ESP32's own 10 uA
   deep-sleep current.

Full sources, tables and hand-verification: [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Project structure

```
power-budget-calculator/
├── bin/pbc.js                 CLI entry point (calc / compare / report / presets)
├── src/
│   ├── index.js               public library API
│   ├── cli.js                 argument parsing + command dispatch
│   ├── loadProfile.js         multi-mode duty-cycle profiles
│   ├── battery.js             Peukert, self-discharge, temperature derating
│   ├── regulator.js           direct / LDO / buck power paths
│   ├── calculator.js          the budget pipeline + warnings + required capacity
│   ├── compare.js             scenario comparison + variant builder
│   ├── report.js              text / JSON / CSV rendering
│   ├── presets.js             batteries, nodes and regulators from RESEARCH.md
│   ├── errors.js              ValidationError / CalculationError
│   └── units.js               conversions + formatting
├── tests/                     node:test suites (no external dependencies)
├── examples/                  scenario JSONs + real outputs from running them
└── docs/RESEARCH.md           sources, formulas, hand verification
```

## Requirements

Node.js 18+ (developed and tested on Node v24.22.1). No dependencies to
install — `npm test` works straight after checkout.

## Usage

```bash
# One scenario, text report
node bin/pbc.js calc examples/esp32-lora-node.json

# Same scenario as JSON (for scripts)
node bin/pbc.js calc examples/esp32-lora-node.json --format json

# Compare scenarios (array, or { base, variants })
node bin/pbc.js compare examples/compare-batteries.json
node bin/pbc.js compare examples/compare-batteries.json --format csv

# Write the report to a file instead of stdout
node bin/pbc.js calc examples/ble-beacon.json --out report.txt

# List the built-in battery / node / regulator presets
node bin/pbc.js presets
```

A scenario file is plain JSON:

```json
{
  "name": "ESP32 + LoRa node, TX every 10 min",
  "load": {
    "cycle_s": 600,
    "modes": [
      { "name": "sleep", "current_mA": 0.05, "duration_s": 597 },
      { "name": "sense", "current_mA": 40,   "duration_s": 2 },
      { "name": "tx",    "current_mA": 120,  "duration_s": 1 }
    ]
  },
  "battery": { "chemistry": "li-ion", "capacity_mAh": 3400,
               "nominalVoltage_V": 3.7, "usableFraction": 0.9 },
  "regulator": { "type": "buck", "inputVoltage_V": 3.7,
                 "outputVoltage_V": 3.3, "efficiency": 0.9,
                 "quiescentCurrent_mA": 0.005 },
  "temperature_C": 25,
  "targetLifetimeDays": 365
}
```

Mode durations must add up to `cycle_s`. Any field the battery omits
(Peukert exponent, self-discharge, voltage) is filled from the chemistry
defaults in `src/battery.js`. Use it as a library too:

```js
const { validateScenario, calculateBudget } = require('power-budget-calculator');
const result = calculateBudget(validateScenario(scenario));
console.log(result.lifetimeDays); // 266.9
```

## Example output

Real output of `node bin/pbc.js calc examples/esp32-lora-node.json`
(ESP32 + LoRa, TX every 10 min, 18650 3400 mAh, buck 90%):

```
Power budget — ESP32 + LoRa node, TX every 10 min
============================================================

Lifetime: 266.9 days
Target:   365 days — NOT MET
Capacity needed for target: 5104 mAh (currently 3400 mAh)

Load profile (per cycle)
  cycle: 600 s, 144 cycles/day
  average current: 383.1 uA  peak: 120 mA
  average power: 1.264 mW  energy: 30.3 mWh/day
  dominant mode: tx
    - sleep: 50 uA for 597 s (99.50% duty, 13.0% of charge)
    - sense: 40 mA for 2 s (0.33% duty, 34.8% of charge)
    - tx: 120 mA for 1 s (0.17% duty, 52.2% of charge)

Regulator — Synchronous buck 3.7 V -> 3.3 V, 90% efficient
  type: buck, efficiency: 90.0% (effective 88.8%), Iq: 5 uA
  average battery-side current: 384.6 uA
  average loss: 0.159 mW

Battery
  rated: 3400 mAh at 3.7 V (12.58 Wh)
  Peukert capacity: 3400 mAh (n = 1.02)
  temperature: 25 C (factor 1)
  usable capacity: 3060 mAh (90% usable)
  self-discharge: 2.00%/month = 93.1 uA

Drain breakdown
  load: 384.6 uA (80.5%)
  self-discharge: 93.1 uA (19.5%)
  total: 477.7 uA
  peak battery current: 118.924 mA

Warnings
  [ERROR] TARGET_NOT_MET: Lifetime 266.9 days is below the target of 365 days — increase capacity, lengthen the sleep cycle, or cut TX current.
  [INFO] TX_DOMINATES: Transmission dominates the energy budget (tx mode) — lengthening the TX interval is the highest-leverage change.
```

The other two examples, same command:

| Example | Setup | Lifetime | Target |
| --- | --- | --- | --- |
| `ble-beacon.json` | BLE beacon every 1 s, 3x AA alkaline, LDO | **872.5 days (2.39 years)** | 365 d — MET |
| `camera-node.json` | ESP32-CAM photo + Wi-Fi TX every 1 min, LiPo 2000 mAh, buck 85% | **3.4 days** | 30 d — NOT MET (needs 18046 mAh) |

Comparison — same LoRa node, three batteries
(`node bin/pbc.js compare examples/compare-batteries.json`):

```
Best: 18650 3400 mAh — 266.9 days

Scenario                           Battery      Drain       Lifetime     vs best
--------------------------------------------------------------------------------
18650 3400 mAh                     3400 mAh     477.7 uA    266.9 d      100.0%
3x AA alkaline 2500 mAh            2500 mAh     393.6 uA    211.7 d      79.3%
LiPo 2000 mAh                      2000 mAh     439.4 uA    170.7 d      64.0%
```

Comparison — TX interval sweep on the same 18650
(`examples/compare-intervals.json`):

```
Best: TX every 6 hours — 813.1 days

TX every 6 hours                   3400 mAh     156.8 uA    813.1 d      100.0%
TX every 1 hour                    3400 mAh     202.7 uA    629.2 d      77.4%
TX every 10 min                    3400 mAh     477.7 uA    266.9 d      32.8%
TX every 1 min                     3400 mAh     3.448 mA    37 d         4.6%
```

The lesson in one line: stretching the TX interval from 1 minute to
6 hours takes the same battery from 37 days to 813 days — interval, not
battery size, is the dominant lever.

## Verification

```bash
npm test   # node --test, 55 tests, 0 failures
```

Every key number is checked against an independent hand calculation
written into the test files and `docs/RESEARCH.md` (§7): the LoRa
lifetime (266.9 days), the BLE lifetime (872.5 days), the camera lifetime
(3.4 days), the Peukert correction for a lead-acid cell (87.06 Ah from
100 Ah at 2x the rated current), the buck current conversion, and the
required-capacity solver (5104 mAh — re-running the budget with 5104 mAh
meets the 365-day target, with 5103 mAh it falls short).

## Design decisions

- **Zero dependencies.** The whole tool is Node's standard library plus
  `node:test`, so it runs anywhere Node 18+ exists and never breaks on a
  registry outage.
- **Mode-by-mode regulator conversion.** Battery current is computed per
  mode, not from the average load current — a buck's input current
  depends on the load, and the TX peak is where the loss actually is.
- **Peukert capped at rated capacity.** The classical law over-predicts
  at the sub-milliamp currents of a sleeping node; the cap keeps the
  estimate conservative and is documented with its source.
- **Self-discharge as a current.** It makes the lifetime limit visible in
  the drain breakdown instead of hiding it in a fudge factor.
- **Warnings, not just a number.** A lifetime figure without the reason
  it is short is not actionable, so the calculator names the dominant
  drain, the peak-current violation, and the regulator-Iq trap.
- **Fail loudly on bad input.** Unknown chemistries, durations that do
  not add up to the cycle, an LDO wired backwards — all throw a
  `ValidationError` naming the field instead of silently computing a
  wrong answer.

## Limitations & future work

- **Fixed regulator efficiency.** Real bucks have a load-dependent
  efficiency curve (poor at light load); this version uses one efficiency
  number per regulator. A future version should accept an
  efficiency-vs-load table.
- **Temperature derating is a conservative table**, not a per-cell
  datasheet curve. Check your cell's own curve for a real design.
- **No ageing / cycle-life model.** Capacity fade over charge cycles and
  calendar ageing are not modelled; `usableFraction` is the crude
  stand-in.
- **No voltage-sag model.** Peak current is checked against the
  continuous rating, but the voltage drop under a TX burst (which can
  brown out the MCU) is not simulated.
- **Energy harvesting not modelled.** A solar or piezo trickle-charge
  input would be a natural extension (`solar-sizing-tool` in the same
  series covers the sizing side).

## License

MIT — see [LICENSE](LICENSE).
