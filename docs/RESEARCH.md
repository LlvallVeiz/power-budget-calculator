# Research — Power Budget & Battery Lifetime for IoT Sensor Nodes

This document records the sources behind every number the calculator uses
by default, the formulas it implements, and the hand-verification of the
three example scenarios. No default value in this project is invented:
each one is either taken from a cited source below or explicitly labelled
a conservative engineering estimate.

## 1. Background: why a sensor node is not a steady load

An IoT sensor node spends most of its life asleep and wakes briefly to
sense and transmit. The average current — the number that decides battery
life — is therefore a duty-cycle average, not any single datasheet
current:

    I_avg = sum(I_mode * t_mode) / T_cycle

The classic trap is to budget with the active current, or with the sleep
current, instead of the weighted average. A node that sleeps at 50 uA
99.5% of the time but transmits at 120 mA for 1 s every 10 minutes draws
0.383 mA on average — nearly 8x its sleep current — and the 1-second TX
burst alone is 52% of the charge per cycle (see §7).

## 2. ESP32 currents (chip vs. dev board)

Espressif's datasheets give bare-chip figures at 3.3 V, 25 C:

| Mode | ESP32 (original) | ESP32-S3 | ESP32-C3 / C6 |
| --- | --- | --- | --- |
| Active (CPU, no radio) | 95–240 mA | — | — |
| Wi-Fi TX | 180–240 mA | 283–340 mA | 252–354 mA |
| Modem sleep | 20–68 mA | ~27.6 mA | ~17 mA |
| Light sleep | 0.8 mA | 240 uA | 130–180 uA |
| Deep sleep (RTC on) | ~10 uA | ~7 uA | 5–7 uA |
| Hibernation | ~5 uA | — | — |

Sources: Espressif ESP32 series datasheet via
[deepbluembedded.com](https://deepbluembedded.com/esp32-sleep-modes-power-consumption/)
and [luisllamas.es](https://www.luisllamas.es/en/esp32-power-consumption/).

**Chip vs. board is the critical distinction.** A bare ESP32-S3 module
measured with a Joulescope draws 8.14 uA in deep sleep, but a stock
DevKitC draws 5–15 mA in the same state: the AMS1117 regulator burns
~5 mA of quiescent current, the CP2102N USB-UART bridge 2–5 mA, and the
power LED 2–3 mA. Espressif states plainly that measuring module current
through a development board is not recommended. The presets in this
project therefore use chip-level sleep currents (10–50 uA, with margin)
and a separate `ldo-ams1117` regulator preset (Iq = 5 mA) so the board
penalty can be modelled explicitly.

Source: [codesprintconsulting.com](https://www.codesprintconsulting.com/blog/esp32-deep-sleep-power-consumption)
(measured DevKitC 3.8 mA, SparkFun Thing Plus 4.1 mA in deep sleep).

## 3. Battery capacity and self-discharge

| Cell | Nominal V | Typical capacity | Self-discharge |
| --- | --- | --- | --- |
| 18650 Li-ion | 3.7 V | 1500–3500 mAh (NCR18650B: 3400 mAh) | 1–3 %/month (typ. 1.5–2 %) |
| LiPo pouch | 3.7 V | 500–5000+ mAh | ~2 %/month |
| Alkaline AA (LR6) | 1.5 V | 1800–3000 mAh (typ. ~2500 mAh) | 2–3 %/year (~0.25 %/month) |
| NiMH AA (low self-discharge) | 1.2 V | 2000–2500 mAh | ~2 %/month |
| CR2032 coin cell | 3.0 V | ~225 mAh | ~1 %/month |

Sources: [large-battery.com](https://www.large-battery.com/blog/3-7v-lithium-ion-battery-characteristics-usage-18650-safety/),
[electricity-magnetism.org](http://www.electricity-magnetism.org/characteristics-of-lithium-ion-batteries-en/)
(1.5–2 %/month for Li-ion),
[electricity-magnetism.org](https://www.electricity-magnetism.org/characteristics-of-aa-batteries-en/)
(alkaline 2–3 %/year),
[theengineeringprojects.com](https://www.theengineeringprojects.com/tool/electronics/battery-life-calculator)
(alkaline AA 2500 mAh, 80 % usable, 0.3 %/month).

Self-discharge is modelled as an equivalent constant current,
`I_sd = C * ratePerMonth / 730.5 h`, added to the load drain — the same
approach used by theengineeringprojects.com's calculator. For a node
designed to run for years this term, not the sleep current, often sets
the lifetime limit: a 3400 mAh Li-ion at 2 %/month self-discharges at
93 uA, which is 19.5 % of the ESP32+LoRa example's total drain.

## 4. Peukert's law

Peukert's law (1897) relates usable capacity to discharge current:

    C_eff = C_rated * (I_rated / I)^(n - 1),   t = C_eff / I

where `I_rated = C_rated / ratedHours` (ratedHours defaults to 20 h, the
standard 0.05C rating) and `n` is the Peukert exponent:

| Chemistry | n (typical) |
| --- | --- |
| Li-ion | 1.00–1.05 (Battle Born cells: 1.05) |
| NiMH | ~1.05–1.10 |
| Lead-acid | 1.10–1.30 |

Sources: [ajdesigner.com](https://www.ajdesigner.com/battery-life/)
(n = 1.0 ideal, 1.1–1.3 lead-acid, ~1.0 Li-ion),
[battlebornbatteries.com](https://battlebornbatteries.com/peukert-effect/),
Rudy et al. (Peukert exponents 1.0–1.3 across chemistries).

**Important limitation, implemented in the code:** the classical law
predicts infinite capacity as I → 0, which is unphysical. Galushkin et
al. showed experimentally that the classical Peukert equation is not
applicable at small discharge currents for lithium-ion cells and proposed
generalised forms (J. Electrochem. Soc. 167, 120516, 2020 —
[iopscience.iop.org](https://beta.iopscience.iop.org/article/10.1149/1945-7111/abad69/pdf)).
This calculator therefore **caps the Peukert-corrected capacity at the
rated capacity**: the correction can only reduce capacity, never inflate
it. At the sub-milliamp average currents of a sleeping sensor node the
cap is what keeps the estimate honest.

## 5. Temperature derating

Capacity falls in the cold because ion mobility drops and internal
resistance rises. Published behaviour for Li-ion:

| Temperature | Capacity retained |
| --- | --- |
| 25 C | 100 % (baseline) |
| 0 C | ~78–90 % depending on chemistry |
| −10 C | ~65–80 % |
| −20 C | ~48–60 % (LFP ~55 %, NMC ~48 %) |

Sources: Bressan et al., *Batteries* 11(12), 439 (2025) — capacity −15 %
at −10 C and −35 % at −20 C for a commercial LiFePO4 module
([iris.polito.it](https://iris.polito.it/retrieve/handle/11583/3005569/949890));
[bonnenbatteries.com](https://www.bonnenbatteries.com/battery-capacity-vs-temperature-how-temperature-affects-lithium-ion-battery-capacity/);
[wiltsonenergy.com](https://www.wiltsonenergy.com/newsinfo24.html).

The calculator's default table is a conservative interpolation of these
figures (0 C: 85 %, −10 C: 70 %, −20 C: 55 %, 25 C: 100 %, 45 C: 102 %)
and is explicitly labelled an estimate: a real design must use the
cell's own datasheet curve. Below −20 C and above 45 C the end values
are held constant rather than extrapolated.

## 6. Regulators: LDO vs. buck

**LDO.** Efficiency is set by the voltage ratio, `eta ≈ Vout / Vin`
(e.g. 5 V → 3.3 V is ~66 %), and the battery current is the load
current plus the quiescent current: `I_bat = I_load + Iq`. The quiescent
current is the whole story for a sleeping node: an ultra-low-Iq LDO can
idle at ~1 uA, while the AMS1117 on most dev boards burns ~5 mA — over
500x the ESP32's own deep-sleep current.

**Buck (switching step-down).** Power is (nearly) conserved, so
`I_bat = (Vout * I_load) / (Vin * eta) + Iq`. Peak efficiencies of
85–95 % are typical for synchronous bucks (e.g. LTC3103: up to 95 %,
Iq 1.8 uA), but efficiency collapses at very light load unless the part
is designed for it — research converters hold >86 % down to 50–500 uA,
and a 2026 wide-load-range design holds 93.69 % even at 10 uA.

Sources: [xmagelec.com](https://www.xmagelec.com/blog/ultra-low-iq-ldo-vs-synchronous-buck-regulator-iot-battery-life)
(LDO eta = Vout/Vin; 1 uA Iq ≈ 8.76 mAh/year),
[powersystemsdesign.com](https://www.powersystemsdesign.com/articles/15v-300ma-synchronous-buck-converters-with-only-1-8ua-quiescent-current/6/2085)
(LTC3103, 95 %, Iq 1.8 uA),
[researchgate.net](https://www.researchgate.net/publication/220091640_Achieving_High_Efficiency_Under_Micro-Watt_Loads_with_Switching_Buck_DC-DC_Converters)
(85–95 % across the micropower range).

Rule of thumb encoded in the warnings: use an ultra-low-Iq LDO when Vin
is close to Vout and the node sleeps most of the time; use a buck when
Vin >> Vout or the active current is large.

## 7. Hand verification of the examples

All three examples were verified by hand before being committed. The
algebra for the ESP32+LoRa node (600 s cycle, 18650 3400 mAh, buck 90 %,
Iq 5 uA, 25 C, target 365 days):

    load avg  = (597*0.05 + 2*40 + 1*120)/600 = 229.85/600 = 0.383083 mA
    I_bat TX  = (3.3*120)/(3.7*0.90) + 0.005 = 118.924 mA
    I_bat avg = (597*0.05455 + 2*39.645 + 1*118.924)/600 = 0.384632 mA
    Peukert   = min(3400, 3400*(170/0.3846)^0.02) = 3400 mAh (capped)
    usable    = 3400 * 0.9 = 3060 mAh
    I_sd      = 3400 * 0.02 / 730.5 = 0.09309 mA
    lifetime  = 3060 / (0.384632 + 0.09309) = 6405 h = 266.9 days
    required C for 365 d: 0.9*C/(0.384632 + C*0.02/730.5) = 8760 h
                          -> C = 5104 mAh (solver returns 5104; re-running
                             with 5104 mAh gives >= 365 days, with 5103 mAh
                             gives < 365 days — see tests/calculator.test.js)

BLE beacon (3x AA alkaline, LDO): load avg 0.08495 mA, battery avg
0.08695 mA, usable 2000 mAh, I_sd 0.00856 mA, lifetime 20941 h =
872.5 days. ESP32-CAM (LiPo 2000 mAh, buck 85 %): load avg 21.017 mA,
battery avg 22.062 mA, usable 1800 mAh, lifetime 81.4 h = 3.4 days.

The comparison examples were also checked: the same LoRa node on 3x AA
alkaline lasts 211.7 days and on LiPo 2000 mAh 170.7 days; stretching
the TX interval from 1 min to 6 h takes the same 18650 node from 37 days
to 813.1 days — TX interval, not battery size, is the dominant lever.

## 8. References

1. Espressif Systems. *ESP32 Series Datasheet* (power consumption tables).
   Via https://deepbluembedded.com/esp32-sleep-modes-power-consumption/
2. Espressif Systems. *ESP32-S3 / ESP32-C3 / ESP32-C6 datasheets* (deep-sleep 5–7 uA).
   Via https://www.luisllamas.es/en/esp32-power-consumption/
3. CodeSprint Consulting. "ESP32 Deep Sleep Power Consumption: Datasheet vs Reality."
   https://www.codesprintconsulting.com/blog/esp32-deep-sleep-power-consumption
4. AJ Designer. "Battery Life Calculator" (Peukert's law, T = C / I^n).
   https://www.ajdesigner.com/battery-life/
5. Battle Born Batteries. "What Is Peukert's Law and What Is Its Effect on Batteries?"
   https://battlebornbatteries.com/peukert-effect/
6. Galushkin, N. E., Yazvinskaya, N. N., Galushkin, D. N. "A Critical Review of Using
   the Peukert Equation and its Generalizations for Lithium-Ion Cells."
   *J. Electrochem. Soc.* 167, 120516 (2020).
   https://beta.iopscience.iop.org/article/10.1149/1945-7111/abad69/pdf
7. Rudy, A. S., Skundin, A. M., Mironenko, A. A., Naumov, V. V. "Current Effect on
   the Performances of All-Solid-State Lithium-Ion Batteries — Peukert's Law."
   https://www.thefreelibrary.com/Current+Effect+on+the+Performances+of+All-Solid-State+Lithium-Ion...-a0758857472
8. Bressan, M., Campagnoli, E., Giaretto, V. "Experimental Evidence on the Effect
   of Temperature on the Performance of a Lithium-Ion Battery." *Batteries* 11(12), 439 (2025).
   https://iris.polito.it/retrieve/handle/11583/3005569/949890
9. Bonnen Battery. "Battery Capacity vs Temperature: How Heat and Cold Affect Li-Ion."
   https://www.bonnenbatteries.com/battery-capacity-vs-temperature-how-temperature-affects-lithium-ion-battery-capacity/
10. "Characteristics of Lithium-ion Batteries." Electricity-Magnetism.org.
    http://www.electricity-magnetism.org/characteristics-of-lithium-ion-batteries-en/
11. "Characteristics of Alkaline Batteries." Electricity-Magnetism.org.
    https://www.electricity-magnetism.org/electric-battery/characteristics-of-alkaline-batteries/
12. The Engineering Projects. "Battery Life Calculator."
    https://www.theengineeringprojects.com/tool/electronics/battery-life-calculator
13. "Ultra-Low Iq LDO vs Synchronous Buck Regulator for IoT Battery Life."
    https://www.xmagelec.com/blog/ultra-low-iq-ldo-vs-synchronous-buck-regulator-iot-battery-life
14. Linear Technology. "15V, 300mA Synchronous Buck Converters with Only 1.8 uA
    Quiescent Current" (LTC3103/LTC3104).
    https://www.powersystemsdesign.com/articles/15v-300ma-synchronous-buck-converters-with-only-1-8ua-quiescent-current/6/2085
15. "Achieving High Efficiency Under Micro-Watt Loads with Switching Buck DC-DC
    Converters." ResearchGate.
    https://www.researchgate.net/publication/220091640_Achieving_High_Efficiency_Under_Micro-Watt_Loads_with_Switching_Buck_DC-DC_Converters
