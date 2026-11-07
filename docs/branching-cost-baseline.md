<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Static Playwright checkpoint cost baseline

The automatic launcher uses the editable `PLAYWRIGHT_P0` constant in
[`baseline.rs`](../branching/planner/src/baseline.rs). It does **not** calibrate on
startup, read a performance profile, query hardware/database size, expire a cost
cache, or update the constants from run timings. Rust receives source-derived
unit counts and the selected consumer order. Reports distinguish estimates from
observations and include the exact baseline values/version used.

## Reference measurement, 2026-11-07

Three alternating L0/P0 pairs ran five guest search/category scenarios
against a disposable HTTP/MariaDB fixture. The external corpus and raw source
provenance are retained in ignored local research storage. All six runs passed, with equal semantic terminal
states, two snapshots and three restores per P0 run, no fallbacks, and cleanup at
the last consumer. A subsequent automatic run used L0 without snapshots.

Environment: Linux x86_64, Intel Core i5-12600H, XFS reflinks on the existing local
loop-backed CoW store, Playwright 1.65.0, Chrome for Testing 156.0.8078.80. The
runner was capped at 2 GiB and its private MariaDB at 512 MiB. The application was
a local HTTP contract fixture that writes real MariaDB/media/session state.
**This is an indicative fixture baseline, not a full Magento checkout benchmark.**
Small sample size, host load, database size and storage configuration limit its
portability. The constants are deliberately visible and manually replaceable.

| Observed operation | Samples | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Baseline reset | 15 | 1,148.94 ms | 2,050.92 ms | 3,533.15 ms |
| Guest consent fixture, category scope | 9 | 1.38 ms | 1.58 ms | 2.75 ms |
| Category shared stage | 9 | 172.26 ms | 184.38 ms | 197.41 ms |
| Guest consent fixture, search scope | 6 | 1.34 ms | 1.46 ms | 1.77 ms |
| Search shared stage | 6 | 161.76 ms | 176.32 ms | 200.19 ms |
| Category capture | 3 | 901.12 ms | 951.25 ms | 986.82 ms |
| Search capture | 3 | 885.55 ms | 889.95 ms | 951.92 ms |
| Category restore | 6 | 1,891.44 ms | 2,324.62 ms | 3,785.02 ms |
| Search restore | 3 | 2,551.43 ms | 2,579.13 ms | 2,920.23 ms |
| Category release | 3 | 5.90 ms | 10.07 ms | 10.29 ms |
| Search release | 3 | 5.91 ms | 6.42 ms | 7.03 ms |

Stage measurements include stage assertions and boundary checks. Capture includes
snapshot publication, hashing, verification, assertions and resume. Restore
includes manifest validation, application restart, page reconstruction and the
first actual reuse state check. Reset and last-consumer deletion are timed too.
Browser API instrumentation is enabled only by the explicit benchmark harness;
normal runs do not attach that listener. Timings never feed back into AUTO.

## Constants and unit definition

One source unit is one known awaited browser operation or browser assertion.
Locator construction and reviewed stateless constructors contribute zero. A
helper call is not assumed to be one operation: its adapter must account for its
body. The reference adapter counted guest consent as one, search navigation
as one, and category navigation as three (`goto`, `waitForLoadState`, visibility
assertion). Their full shared blocks are therefore two and four units.

The minimum category block was approximately 173.64 ms / 4 = 43.41 ms per source
unit; the search block was approximately 163.10 ms / 2 = 81.55 ms. The initial
constant rounds the lower figure down to **40 ms/unit**. This is a rough mixed
block estimate, not a claim that every API call takes 40 ms. Cookie-only work can
be much cheaper and real storefront navigation much slower. Diagnostic API-call
counts also include harness assertions and differ from these source units.

| Constant | Value | Derivation |
| --- | ---: | --- |
| Unit estimate | 40 ms | Lower measured block average, rounded down |
| Capture | 1,000 ms | Maximum observed capture, rounded up |
| Restore | 3,800 ms | Maximum observed restore, rounded up |
| Release | 11 ms | Maximum observed release, rounded up |
| Baseline reset | 1,100 ms | Minimum observed reset, rounded down |
| Overhead margin | 20% | Explicit policy reserve, not a measurement |
| Minimum saving | 50 ms | Explicit policy reserve, not a measurement |

For an isolated candidate with `n` consumers and complete prefix cost `P`, the
selection rule is:

```text
(n − 1) × (P + reset − 1.2 × restore) > 1.2 × (capture + release) + 50 ms
P = (fixture units + all preceding shared step units) × 40 ms
```

With this reference baseline, two consumers need at least **119 combined units**,
three need **103**, and nine need **91**. These are provisional reference thresholds,
not universal Playwright limits. The two measured tiny groups remain
linear. Repetition alone is insufficient. Small fixture and step fragments can
be combined into a larger profitable candidate. Unknown fixture/helper units
keep that candidate linear without deleting or disqualifying it.

For overlapping candidates, Rust simulates ordered first-branch continuation and
subsequent restores. It does not add standalone savings together and double-count
ancestors. A bounded 64-iteration improvement search starts from linear execution;
it can miss a profitable combination but never selects an estimated net loss.
Test suffixes and common run preparation/cleanup cancel in the estimate; this is
not a prediction of total suite duration or a speedup guarantee. Every original
stage and assertion still executes when its checkpoint is not selected.

## Deliberate updates only

Calibration is an explicit research operation on owned disposable resources.
The source-specific harness and raw evidence are retained in ignored local
research storage, not distributed with the planner. Normal launches never run
that harness or update these constants.

Inspect results, edit `PLAYWRIGHT_P0` and its version explicitly, then rebuild the
Rust driver and run the regression checks. Neither the benchmark nor AUTO edits
constants. Source/configuration verification and checkpoint state validation
remain active independently of this static performance policy. Forced `P0` and
`L0` remain available for research. Cypress needs its own measurements/adapter;
this baseline does not implement Cypress branching.
